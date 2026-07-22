import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

// Maps Apify actor dataset items -> our jobs schema. Swap actor IDs for
// whichever scrapers you subscribe to on Apify (search "linkedin jobs
// scraper", "indeed scraper", "glassdoor jobs scraper" in the Apify Store).
const SOURCE_ACTORS: Record<string, string> = {
  linkedin: "bebity~linkedin-jobs-scraper",
  indeed: "misceres~indeed-scraper",
  glassdoor: "bebity~glassdoor-jobs-scraper"
};

function fingerprint(source: string, sourceJobId: string | undefined, title: string, company: string, location: string) {
  const base = sourceJobId ? `${source}:${sourceJobId}` : `${source}:${title}:${company}:${location}`.toLowerCase();
  return crypto.createHash("sha256").update(base).digest("hex");
}

async function runApifyActor(actorId: string, input: any) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not configured");
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
  if (!runRes.ok) throw new Error(`Apify actor ${actorId} failed: ${runRes.status} ${await runRes.text()}`);
  return runRes.json();
}

function normalize(source: string, item: any) {
  // Best-effort field mapping; actual field names vary by actor — adjust
  // to match the specific Apify actor's dataset schema you use.
  return {
    title: item.title ?? item.jobTitle ?? item.position ?? "Unknown title",
    company: item.companyName ?? item.company ?? "Unknown company",
    location: item.location ?? item.jobLocation ?? "",
    work_mode: item.remote ? "remote" : (item.workMode ?? null),
    job_type: item.jobType ?? item.employmentType ?? null,
    salary_range: item.salary ?? item.salaryRange ?? null,
    jd_full: item.description ?? item.jobDescription ?? "",
    jd_summary: (item.description ?? "").slice(0, 500),
    source,
    source_job_id: item.id ?? item.jobId ?? item.postingId ?? undefined,
    apply_url: item.applyUrl ?? item.jobUrl ?? item.url ?? ""
  };
}

// POST { user_id } — pulls jobs for one user's saved filters from all
// their configured sources, dedupes into the global `jobs` pool, and
// creates `user_jobs` rows for anything new. Call this from the daily
// cron (see /api/cron/daily) or manually per-user from onboarding.
export async function POST(req: NextRequest) {
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: filters } = await admin.from("job_filters").select("*").eq("user_id", user_id).single();
  if (!filters || !filters.is_active) {
    return NextResponse.json({ error: "no active filters for user" }, { status: 400 });
  }

  let totalNew = 0;
  for (const source of filters.sources as string[]) {
    const actorId = SOURCE_ACTORS[source];
    if (!actorId) continue;
    const logRow = { source, triggered_by: user_id, jobs_found: 0, jobs_new: 0, jobs_dupes: 0, status: "running" as string, error_msg: null as string | null };
    try {
      const items = await runApifyActor(actorId, {
        title: filters.titles?.[0] ?? "",
        location: filters.locations?.[0] ?? "",
        remoteOnly: filters.remote_only,
        maxItems: 50
      });
      logRow.jobs_found = items.length;

      for (const raw of items) {
        const mapped = normalize(source, raw);
        const fp = fingerprint(source, mapped.source_job_id, mapped.title, mapped.company, mapped.location);

        const { data: existing } = await admin.from("jobs").select("id").eq("fingerprint", fp).maybeSingle();
        let jobId = existing?.id;
        if (!jobId) {
          const { data: inserted, error } = await admin
            .from("jobs")
            .insert({ ...mapped, fingerprint: fp })
            .select("id")
            .single();
          if (error) throw error;
          jobId = inserted.id;
          logRow.jobs_new++;
          totalNew++;
        } else {
          logRow.jobs_dupes++;
        }

        await admin.from("user_jobs")
          .upsert({ user_id, job_id: jobId, status: "sourced" }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
      }
      logRow.status = "success";
    } catch (e: any) {
      logRow.status = "failed";
      logRow.error_msg = e.message;
    }
    await admin.from("fetch_log").insert(logRow);
  }

  return NextResponse.json({ new_jobs: totalNew });
}
