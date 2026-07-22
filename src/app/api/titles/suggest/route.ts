import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL, extractJson } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { resume_id } = await req.json();
  const { data: sections } = await supabase
    .from("resume_sections")
    .select("header, subject")
    .eq("resume_id", resume_id);

  const resumeText = (sections ?? []).map(s => `${s.header}:\n${s.subject}`).join("\n\n");

  const prompt = `Based on this resume, suggest 6-10 job titles this person should search for (mix of exact-match and one-level-up stretch titles). For each, give a one-sentence rationale.
Return ONLY JSON: [{"title": string, "rationale": string}]

Resume:
"""
${resumeText.slice(0, 12000)}
"""`;

  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: 1500,
    messages: [{ role: "user", content: prompt }]
  });
  const textBlock = msg.content.find(b => b.type === "text") as any;
  const titles = extractJson<any[]>(textBlock.text);

  await supabase.from("suggested_job_titles").delete().eq("user_id", user.id);
  const rows = titles.map(t => ({ user_id: user.id, title: t.title, rationale: t.rationale }));
  const { error } = await supabase.from("suggested_job_titles").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ titles: rows });
}
