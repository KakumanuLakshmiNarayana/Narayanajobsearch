import { createJobboardClient } from "@/lib/jobboard";

// Mirrors the exact protocol already used by jobboard's own control_panel.html:
// write config -> repository_dispatch -> flip run_status.is_running=true ->
// GitHub Actions runs puller_apify.py -> workflow resets is_running=false when done.
const GITHUB_OWNER = "KakumanuLakshmiNarayana";
const GITHUB_REPO = "jobboard";

export async function getJobboardRunStatus() {
  const jobboard = createJobboardClient();
  const { data } = await jobboard.from("run_status").select("*").eq("id", 1).single();
  return data as { is_running: boolean; started_at: string | null; started_by: string | null } | null;
}

export async function setJobboardRunStatus(patch: Record<string, any>) {
  const jobboard = createJobboardClient();
  await jobboard.from("run_status").update(patch).eq("id", 1);
}

export async function setJobboardConfig(cfg: {
  titles: string[];
  location: string;
  remoteOnly: boolean;
}) {
  const jobboard = createJobboardClient();
  await jobboard.from("config").update({
    job_titles: cfg.titles,
    location: cfg.location,
    remote_only: cfg.remoteOnly,
    sources_enabled: ["bestjob", "dice"],
    updated_by: "job-agent-app",
    updated_at: new Date().toISOString()
  }).eq("id", 1);
}

export async function triggerJobboardRun(userId: string) {
  const token = process.env.JOBBOARD_GITHUB_TOKEN;
  if (!token) throw new Error("JOBBOARD_GITHUB_TOKEN not configured");
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      event_type: "trigger-apify-pull",
      client_payload: { triggered_by: `job-agent:${userId}` }
    })
  });
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
}
