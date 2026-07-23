import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic, MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { user_id } — scores every 'sourced' user_job for that user against
// their base resume (0-100 match). Uses the service-role client so it can
// run unattended from cron across all tenants.
export async function POST(req: NextRequest) {
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: latestResume } = await admin
    .from("resumes")
    .select("id")
    .eq("user_id", user_id)
    .eq("is_base", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestResume) return NextResponse.json({ error: "no base resume on file" }, { status: 400 });

  const { data: sections } = await admin
    .from("resume_sections").select("header, subject")
    .eq("resume_id", latestResume.id);
  if (!sections?.length) return NextResponse.json({ error: "no base resume on file" }, { status: 400 });
  const resumeText = sections.map(s => `${s.header}:\n${s.subject}`).join("\n\n");

  const { data: pending } = await admin
    .from("user_jobs")
    .select("id, job_id, jobs(title, company, jd_full)")
    .eq("user_id", user_id).eq("status", "sourced");

  let scored = 0;
  for (const uj of pending ?? []) {
    const job = (uj as any).jobs;
    const prompt = `Score how well this resume matches this job description, 0-100. Consider skills, years of experience, titles, and domain overlap. Be strict — 100 only for a near-perfect match.
Return ONLY JSON: {"score": number, "gaps": string[]}

JOB (${job.title} at ${job.company}):
"""${(job.jd_full ?? "").slice(0, 6000)}"""

RESUME:
"""${resumeText.slice(0, 8000)}"""`;

    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    const textBlock = msg.content.find(b => b.type === "text") as any;
    const { score } = extractJson<{ score: number }>(textBlock.text);

    await admin.from("user_jobs").update({ base_match_score: score, status: "scored", updated_at: new Date().toISOString() }).eq("id", uj.id);
    scored++;
  }

  return NextResponse.json({ scored });
}
