import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createJobboardClient, JOBBOARD_EXCLUDED_SOURCES } from "@/lib/jobboard";

export const runtime = "nodejs";
export const maxDuration = 300;

function fingerprint(jobboardId: string) {
  // jobboard rows have a stable UUID id — reuse it directly so re-syncs
  // are naturally idempotent (same job never gets inserted twice).
  return crypto.createHash("sha256").update(`jobboard:${jobboardId}`).digest("hex");
}

// POST { user_id } — syncs jobs matching this user's saved filters from the
// existing `jobboard` Supabase project (already scraped/refreshed daily by
// a separate pipeline) into our own `jobs` pool, then creates `user_jobs`
// rows for anything new. Call this from the daily cron or manually from
// the dashboard's "Fetch jobs now" button.
export async function POST(req: NextRequest) {
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: filters } = await admin.from("job_filters").select("*").eq("user_id", user_id).single();
  if (!filters || !filters.is_active) {
    return NextResponse.json({ error: "no active filters for user — set them on the Filters tab first" }, { status: 400 });
  }
  if (!filters.titles?.length) {
    return NextResponse.json({ error: "no job titles saved in filters" }, { status: 400 });
  }

  const logRow = {
    source: "jobboard_sync", triggered_by: user_id,
    jobs_found: 0, jobs_new: 0, jobs_dupes: 0,
    status: "running" as string, error_msg: null as string | null
  };

  let totalNew = 0;
  try {
    const jobboard = createJobboardClient();

    let query = jobboard
      .from("jobs")
      .select("id, title, company, location, salary_range, job_type, work_mode, jd_full, jd_summary, source, source_job_id, apply_url, posted_date")
      .not("source", "in", `(${JOBBOARD_EXCLUDED_SOURCES.join(",")})`)
      .order("posted_date", { ascending: false })
      .limit(200);

    // Match any of the user's saved titles against the jobboard title (OR of ilike)
    const titleOr = filters.titles.map((t: string) => `title.ilike.%${t}%`).join(",");
    query = query.or(titleOr);

    if (filters.remote_only) {
      query = query.or("work_mode.ilike.%remote%,location.ilike.%remote%");
    }

    const { data: jobboardJobs, error: jbError } = await query;
    if (jbError) throw jbError;

    logRow.jobs_found = jobboardJobs?.length ?? 0;

    for (const raw of jobboardJobs ?? []) {
      const fp = fingerprint(raw.id);
      const { data: existing } = await admin.from("jobs").select("id").eq("fingerprint", fp).maybeSingle();
      let jobId = existing?.id;

      if (!jobId) {
        const { data: inserted, error } = await admin
          .from("jobs")
          .insert({
            title: raw.title,
            company: raw.company,
            location: raw.location,
            work_mode: raw.work_mode,
            job_type: raw.job_type,
            salary_range: raw.salary_range,
            jd_full: raw.jd_full ?? raw.jd_summary ?? "",
            jd_summary: raw.jd_summary ?? (raw.jd_full ?? "").slice(0, 500),
            source: raw.source,
            source_job_id: raw.source_job_id ?? raw.id,
            apply_url: raw.apply_url,
            posted_date: raw.posted_date,
            fingerprint: fp
          })
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

  if (logRow.status === "failed") {
    return NextResponse.json({ error: logRow.error_msg }, { status: 500 });
  }
  return NextResponse.json({ new_jobs: totalNew, found: logRow.jobs_found, dupes: logRow.jobs_dupes });
}
