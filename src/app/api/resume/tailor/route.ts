import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL, extractJson } from "@/lib/anthropic";
import { SECTION_TYPES } from "@/lib/sectionTypes";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { user_job_id } — generates a tailored resume for ONE job.
// The base resume + its section headers are never modified; this writes a
// new row in tailored_resumes tagged to this specific job.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { user_job_id } = await req.json();

  const { data: userJob } = await supabase
    .from("user_jobs").select("id, job_id, jobs(title, company, jd_full)")
    .eq("id", user_job_id).eq("user_id", user.id).single();
  if (!userJob) return NextResponse.json({ error: "not found" }, { status: 404 });
  const job = (userJob as any).jobs;

  const { data: resume } = await supabase.from("resumes").select("id").eq("user_id", user.id).eq("is_base", true).order("created_at", { ascending: false }).limit(1).single();
  const { data: sections } = await supabase.from("resume_sections").select("*").eq("resume_id", resume!.id).order("sort_order");

  const editableKeys = new Set(SECTION_TYPES.filter(s => s.editable).map(s => s.key));

  const prompt = `You tailor resume section CONTENT to a target job description. Hard rules:
- NEVER change a section's "header" — headers are fixed and must be copied verbatim.
- Only rewrite "subject" text for sections where editable=true. For editable=false sections, copy subject verbatim unchanged.
- Do not fabricate employers, titles, dates, or degrees. You may rephrase, reorder, and emphasize existing bullet points/skills, and mirror the job description's terminology where truthfully applicable.
- Aim for as close to a 100% keyword/skills match as truthfully possible without inventing experience.

Return ONLY a JSON array matching the input shape, with "subject" possibly rewritten:
[{"id": string, "section_key": string, "header": string, "subject": string, "editable": boolean}]

JOB (${job.title} at ${job.company}):
"""${(job.jd_full ?? "").slice(0, 6000)}"""

CURRENT SECTIONS:
${JSON.stringify(sections!.map(s => ({ id: s.id, section_key: s.section_key, header: s.header, subject: s.subject, editable: editableKeys.has(s.section_key) })))}`;

  const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: prompt }] });
  const textBlock = msg.content.find(b => b.type === "text") as any;
  const tailoredSections = extractJson<any[]>(textBlock.text);

  // Re-score the tailored version
  const tailoredText = tailoredSections.map(s => `${s.header}:\n${s.subject}`).join("\n\n");
  const scorePrompt = `Score 0-100 how well this resume matches the job. Return ONLY JSON: {"score": number}
JOB: """${(job.jd_full ?? "").slice(0, 6000)}"""
RESUME: """${tailoredText.slice(0, 8000)}"""`;
  const scoreMsg = await anthropic.messages.create({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: scorePrompt }] });
  const scoreBlock = scoreMsg.content.find(b => b.type === "text") as any;
  const { score: tailoredScore } = extractJson<{ score: number }>(scoreBlock.text);

  // Build a downloadable docx
  const doc = new Document({
    sections: [{
      children: tailoredSections.flatMap((s: any) => [
        new Paragraph({ text: s.header, heading: HeadingLevel.HEADING_2 }),
        ...s.subject.split("\n").map((line: string) => new Paragraph(line))
      ])
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  const filePath = `${user.id}/tailored/${userJob.id}-${Date.now()}.docx`;
  await supabase.storage.from("resumes").upload(filePath, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });

  const { data: tailored, error } = await supabase.from("tailored_resumes").insert({
    user_id: user.id,
    user_job_id: userJob.id,
    base_resume_id: resume!.id,
    sections: tailoredSections,
    tailored_match_score: tailoredScore,
    file_url: filePath
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("user_jobs").update({ status: "ready_to_apply", updated_at: new Date().toISOString() }).eq("id", userJob.id);

  // Pre-create the application log row in pending_review state
  await supabase.from("applications").insert({
    user_id: user.id,
    user_job_id: userJob.id,
    tailored_resume_id: tailored.id,
    job_title: job.title,
    company: job.company,
    base_match_score: (userJob as any).base_match_score ?? null,
    tailored_match_score: tailoredScore,
    status: "pending_review"
  });

  return NextResponse.json({ tailored_resume: tailored });
}
