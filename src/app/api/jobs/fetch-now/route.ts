import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createJobboardClient, JOBBOARD_EXCLUDED_SOURCES } from "@/lib/jobboard";
import { getJobboardRunStatus, setJobboardRunStatus, setJobboardConfig, triggerJobboardRun } from "@/lib/jobboardControl";

export const runtime = "nodejs";
export const maxDuration = 60;

const STALE_MINUTES = 90;

function fingerprint(jobboardId: string) {
  return crypto.createHash("sha256").update(`jobboard:${jobboardId}`).digest("hex");
}

async function syncNewJobsForUser(admin: ReturnType<typeof createAdminClient>, userId: string, sinceIso: string, titles: string[]) {
  const jobboard = createJobboardClient();
  let query = jobboard
    .from("jobs")
    .select("id, title, company, location, salary_range, job_type, work_mode, jd_full, jd_summary, source, source_job_id, apply_url, posted_date, fetched_at")
    .not("source", "in", `(${JOBBOARD_EXCLUDED_SOURCES.join(",")})`)
    .gte("fetched_at", sinceIso)
    .order("fetched_at", { ascending: false })
    .limit(300);

  if (titles.length) {
    query = query.or(titles.map(t => `title.ilike.%${t}%`).join(","));
  }

  const { data: jobboardJobs } = await query;
  let newCount = 0;

  for (const raw of jobboardJobs ?? []) {
    const fp = fingerprint(raw.id);
    const { data: existing } = await admin.from("jobs").select("id").eq("fingerprint", fp).maybeSingle();
    let jobId = existing?.id;

    if (!jobId) {
      const { data: inserted, error } = await admin.from("jobs").insert({
        title: raw.title, company: raw.company, location: raw.location,
        work_mode: raw.work_mode, job_type: raw.job_type, salary_range: raw.salary_range,
        jd_full: raw.jd_full ?? raw.jd_summary ?? "",
        jd_summary: raw.jd_summary ?? (raw.jd_full ?? "").slice(0, 500),
        source: raw.source, source_job_id: raw.source_job_id ?? raw.id,
        apply_url: raw.apply_url, posted_date: raw.posted_date, fingerprint: fp
      }).select("id").single();
      if (error) continue;
      jobId = inserted.id;
      newCount++;
    }

    await admin.from("user_jobs")
      .upsert({ user_id: userId, job_id: jobId, status: "sourced" }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
  }

  return newCount;
}

// POST { user_id } — ensures a queued fetch_requests row exists for this
// user, then advances the shared queue by one step (idempotent — safe to
// call repeatedly from the dashboard's poll loop). Only one jobboard run
// is ever in flight at a time; everyone else waits their turn.
export async function POST(req: NextRequest) {
  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const admin = createAdminClient();

  // Ensure this user has an active request (dedupe repeat clicks)
  let { data: myRequest } = await admin
    .from("fetch_requests")
    .select("*")
    .eq("user_id", user_id)
    .in("status", ["queued", "running", "syncing"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!myRequest) {
    const { data: filters } = await admin.from("job_filters").select("titles").eq("user_id", user_id).maybeSingle();
    if (!filters?.titles?.length) {
      return NextResponse.json({ error: "no job titles saved in filters — set them on the Filters tab first" }, { status: 400 });
    }
    const { data: inserted } = await admin.from("fetch_requests").insert({ user_id, status: "queued" }).select().single();
    myRequest = inserted;
  }

  // ── Advance the queue by one step ──
  const jbStatus = await getJobboardRunStatus();

  // Heal a stale/crashed run
  if (jbStatus?.is_running && jbStatus.started_at) {
    const minutesRunning = (Date.now() - new Date(jbStatus.started_at).getTime()) / 60000;
    if (minutesRunning > STALE_MINUTES) {
      await setJobboardRunStatus({ is_running: false });
      await admin.from("fetch_requests").update({ status: "failed", error_msg: "jobboard run timed out", completed_at: new Date().toISOString() }).eq("status", "running");
    }
  }

  const freshStatus = await getJobboardRunStatus();

  // If a request of ours is "running" and jobboard just went idle, sync results
  const { data: runningReq } = await admin.from("fetch_requests").select("*").eq("status", "running").order("started_at", { ascending: true }).limit(1).maybeSingle();

  if (runningReq && freshStatus && !freshStatus.is_running) {
    await admin.from("fetch_requests").update({ status: "syncing" }).eq("id", runningReq.id);
    const { data: filters } = await admin.from("job_filters").select("titles").eq("user_id", runningReq.user_id).maybeSingle();
    let newCount = 0;
    try {
      newCount = await syncNewJobsForUser(admin, runningReq.user_id, runningReq.started_at, filters?.titles ?? []);
      // Score the newly sourced jobs right away
      await fetch(new URL("/api/jobs/score", req.url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: runningReq.user_id })
      }).catch(() => {});
      await admin.from("fetch_requests").update({
        status: "done", completed_at: new Date().toISOString(), new_jobs_count: newCount
      }).eq("id", runningReq.id);
    } catch (e: any) {
      await admin.from("fetch_requests").update({
        status: "failed", error_msg: e.message, completed_at: new Date().toISOString()
      }).eq("id", runningReq.id);
    }
  } else if (!runningReq && freshStatus && !freshStatus.is_running) {
    // Nothing running — promote the oldest queued request
    const { data: nextQueued } = await admin.from("fetch_requests").select("*").eq("status", "queued").order("requested_at", { ascending: true }).limit(1).maybeSingle();
    if (nextQueued) {
      const { data: filters } = await admin.from("job_filters").select("titles, locations, remote_only").eq("user_id", nextQueued.user_id).single();
      try {
        await setJobboardConfig({
          titles: filters?.titles ?? [],
          location: (filters?.locations ?? [])[0] ?? "",
          remoteOnly: !!filters?.remote_only
        });
        await triggerJobboardRun(nextQueued.user_id);
        await setJobboardRunStatus({ is_running: true, started_at: new Date().toISOString(), started_by: `job-agent:${nextQueued.user_id}` });
        await admin.from("fetch_requests").update({ status: "running", started_at: new Date().toISOString() }).eq("id", nextQueued.id);
      } catch (e: any) {
        await admin.from("fetch_requests").update({ status: "failed", error_msg: e.message, completed_at: new Date().toISOString() }).eq("id", nextQueued.id);
      }
    }
  }

  // Return the caller's own current status + queue position
  const { data: finalMine } = await admin.from("fetch_requests").select("*").eq("id", myRequest.id).single();
  let queuePosition: number | null = null;
  if (finalMine?.status === "queued") {
    const { count } = await admin.from("fetch_requests").select("*", { count: "exact", head: true })
      .eq("status", "queued").lt("requested_at", finalMine.requested_at);
    queuePosition = (count ?? 0) + 1;
  }

  return NextResponse.json({ request: finalMine, queuePosition });
}
