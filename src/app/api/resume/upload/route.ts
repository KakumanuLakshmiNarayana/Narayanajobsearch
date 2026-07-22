import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL, extractJson } from "@/lib/anthropic";
import { SECTION_TYPES } from "@/lib/sectionTypes";

export const runtime = "nodejs";

async function extractText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const res = await pdfParse(buf);
    return res.text;
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value;
  }
  return buf.toString("utf-8");
}

// POST multipart/form-data { file } -> stores resume, parses into fixed sections
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const rawText = await extractText(file);

  // Upload original file to storage: <user_id>/<timestamp>-<filename>
  const path = `${user.id}/${Date.now()}-${file.name}`;
  const { error: uploadErr } = await supabase.storage
    .from("resumes")
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream"
    });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: resume, error: resumeErr } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, file_name: file.name, file_url: path, raw_text: rawText, is_base: true })
    .select()
    .single();
  if (resumeErr) return NextResponse.json({ error: resumeErr.message }, { status: 500 });

  const headerList = SECTION_TYPES.map(s => `${s.key} ("${s.label}")${s.repeatable ? " [repeatable]" : ""}`).join("\n");

  const prompt = `You split a resume's raw text into FIXED sections. You must ONLY use these section keys/headers (never invent new ones, never rename them):
${headerList}

For repeatable sections (experience, education, projects, certifications, achievements, publications), output one entry PER item (e.g. one entry per job held, one per degree).
Skip a section entirely if it's not present in the resume.

For "experience" entries, populate "meta" with {"company","title","location","start_date","end_date"} extracted from the text (best effort, empty string if unknown). Put the responsibilities/bullet text in "subject".
For "contact_info", subject should be the raw contact block (name, phone, email, links).

Return ONLY a JSON array, no prose, of objects: {"section_key": string, "subject": string, "meta": object, "sort_order": number}

Resume text:
"""
${rawText.slice(0, 15000)}
"""`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  });
  const textBlock = msg.content.find(b => b.type === "text") as any;
  const sections = extractJson<any[]>(textBlock.text);

  const keyToLabel = Object.fromEntries(SECTION_TYPES.map(s => [s.key, s.label]));
  const rows = sections
    .filter(s => keyToLabel[s.section_key])
    .map((s, i) => ({
      resume_id: resume.id,
      user_id: user.id,
      section_key: s.section_key,
      header: keyToLabel[s.section_key], // header is always derived from the fixed list, never from the model
      subject: s.subject ?? "",
      meta: s.meta ?? {},
      sort_order: s.sort_order ?? i
    }));

  const { error: sectionsErr } = await supabase.from("resume_sections").insert(rows);
  if (sectionsErr) return NextResponse.json({ error: sectionsErr.message }, { status: 500 });

  return NextResponse.json({ resume_id: resume.id, sections: rows });
}
