"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Tab = "pipeline" | "applications" | "resume" | "filters";

export default function DashboardClient({ userEmail, fullName }: { userEmail: string; fullName: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pipeline");
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [filters, setFilters] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filterForm, setFilterForm] = useState({
    titles: "",
    locations: "Remote",
    remoteOnly: true,
    jobType: "full_time",
    sources: ["linkedin", "indeed"] as string[]
  });

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: uj } = await supabase
      .from("user_jobs")
      .select("id, status, base_match_score, discovered_at, jobs(title, company, location, apply_url, source, posted_date)")
      .order("discovered_at", { ascending: false })
      .limit(100);
    setPipeline(uj ?? []);

    const { data: apps } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });
    setApplications(apps ?? []);

    const { data: latestResume } = await supabase
      .from("resumes")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_base", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: sec } = latestResume
      ? await supabase
          .from("resume_sections")
          .select("*")
          .eq("resume_id", latestResume.id)
          .order("sort_order")
      : { data: [] };
    setSections(sec ?? []);

    const { data: f } = await supabase.from("job_filters").select("*").eq("user_id", user.id).maybeSingle();
    setFilters(f);
    if (f) {
      setFilterForm({
        titles: (f.titles ?? []).join(", "),
        locations: (f.locations ?? []).join(", "),
        remoteOnly: !!f.remote_only,
        jobType: f.job_type ?? "full_time",
        sources: f.sources ?? ["linkedin", "indeed"]
      });
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function pollFetchQueue(userId: string) {
    const res = await fetch("/api/jobs/fetch-now", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast(`Fetch failed: ${json.error ?? res.status}`);
      setBusy(null);
      return;
    }
    const status = json.request?.status;
    if (status === "queued") {
      setToast(`Queued — position ${json.queuePosition ?? "?"} in line. This waits for any other in-progress run to finish first.`);
      setTimeout(() => pollFetchQueue(userId), 6000);
    } else if (status === "running") {
      setToast("Fetching fresh jobs from jobboard (LinkedIn/Indeed/Glassdoor/Dice) for your filters — this can take a couple of minutes...");
      setTimeout(() => pollFetchQueue(userId), 6000);
    } else if (status === "syncing") {
      setToast("Run finished, syncing matching jobs into your pipeline...");
      setTimeout(() => pollFetchQueue(userId), 4000);
    } else if (status === "done") {
      setToast(`Done — ${json.request.new_jobs_count ?? 0} new job(s) added and scored.`);
      setBusy(null);
      await loadAll();
    } else if (status === "failed") {
      setToast(`Fetch failed: ${json.request.error_msg ?? "unknown error"}`);
      setBusy(null);
      await loadAll();
    } else {
      setBusy(null);
    }
  }

  async function runIngest() {
    setBusy("ingest");
    setToast(null);
    const { data: { user } } = await supabase.auth.getUser();
    await pollFetchQueue(user!.id);
  }

  async function saveFilters() {
    setBusy("filters");
    setToast(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("job_filters").upsert({
      user_id: user!.id,
      titles: filterForm.titles.split(",").map(s => s.trim()).filter(Boolean),
      locations: filterForm.locations.split(",").map(s => s.trim()).filter(Boolean),
      remote_only: filterForm.remoteOnly,
      job_type: filterForm.jobType,
      sources: filterForm.sources,
      is_active: true
    }, { onConflict: "user_id" });
    setBusy(null);
    if (error) return setToast(`Save failed: ${error.message}`);
    setToast("Filters saved.");
    await loadAll();
  }

  async function tailor(userJobId: string) {
    setBusy(userJobId);
    await fetch("/api/resume/tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_job_id: userJobId }) });
    await loadAll();
    setBusy(null);
  }

  async function markApplied(applicationId: string, applyLink: string) {
    setBusy(applicationId);
    await fetch("/api/applications", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: applicationId, status: "applied", apply_link: applyLink })
    });
    await loadAll();
    setBusy(null);
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center">
        <div>
          <div className="font-semibold">Job Agent</div>
          <div className="text-sm text-slate-500">{fullName || userEmail}</div>
        </div>
        <div className="flex gap-3 items-center">
          <button onClick={runIngest} disabled={busy === "ingest"} className="bg-slate-900 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">
            {busy === "ingest" ? "Fetching jobs..." : "Fetch jobs now"}
          </button>
          <button onClick={logout} className="text-sm text-slate-500 underline">Log out</button>
        </div>
      </header>

      {toast && (
        <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2 flex justify-between items-center">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-amber-500 ml-4">✕</button>
        </div>
      )}

      <nav className="flex gap-2 px-6 pt-4">
        {(["pipeline", "applications", "resume", "filters"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize ${tab === t ? "bg-slate-900 text-white" : "bg-white border"}`}>
            {t}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === "pipeline" && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3">Title</th><th className="p-3">Company</th><th className="p-3">Source</th>
                  <th className="p-3">Match</th><th className="p-3">Status</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map(uj => (
                  <tr key={uj.id} className="border-t">
                    <td className="p-3">{uj.jobs?.title}</td>
                    <td className="p-3">{uj.jobs?.company}</td>
                    <td className="p-3 capitalize">{uj.jobs?.source}</td>
                    <td className="p-3">{uj.base_match_score != null ? `${uj.base_match_score}%` : "—"}</td>
                    <td className="p-3 capitalize">{uj.status.replace("_", " ")}</td>
                    <td className="p-3">
                      {uj.status === "scored" && (
                        <button onClick={() => tailor(uj.id)} disabled={busy === uj.id}
                          className="text-xs bg-slate-900 text-white rounded px-2 py-1 disabled:opacity-50">
                          {busy === uj.id ? "Tailoring..." : "Tailor resume"}
                        </button>
                      )}
                      {uj.jobs?.apply_url && (
                        <a href={uj.jobs.apply_url} target="_blank" className="text-xs underline ml-2">Job posting</a>
                      )}
                    </td>
                  </tr>
                ))}
                {pipeline.length === 0 && <tr><td className="p-4 text-slate-400" colSpan={6}>No jobs yet — click "Fetch jobs now".</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "applications" && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-3">Title</th><th className="p-3">Company</th><th className="p-3">Base match</th>
                  <th className="p-3">Tailored match</th><th className="p-3">Applied</th><th className="p-3">Status</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.id} className="border-t">
                    <td className="p-3">{a.job_title}</td>
                    <td className="p-3">{a.company}</td>
                    <td className="p-3">{a.base_match_score != null ? `${a.base_match_score}%` : "—"}</td>
                    <td className="p-3">{a.tailored_match_score != null ? `${a.tailored_match_score}%` : "—"}</td>
                    <td className="p-3">{a.applied_at ? new Date(a.applied_at).toLocaleDateString() : "—"}</td>
                    <td className="p-3 capitalize">{a.status.replace("_", " ")}</td>
                    <td className="p-3">
                      {a.status === "pending_review" && (
                        <button
                          onClick={() => {
                            const link = prompt("Paste the apply link / confirmation URL:");
                            if (link) markApplied(a.id, link);
                          }}
                          disabled={busy === a.id}
                          className="text-xs bg-emerald-700 text-white rounded px-2 py-1 disabled:opacity-50">
                          {busy === a.id ? "Saving..." : "Mark applied"}
                        </button>
                      )}
                      {a.apply_link && <a href={a.apply_link} target="_blank" className="text-xs underline ml-2">Link</a>}
                    </td>
                  </tr>
                ))}
                {applications.length === 0 && <tr><td className="p-4 text-slate-400" colSpan={7}>Nothing tailored yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "resume" && (
          <div className="space-y-4 max-w-3xl">
            {sections.map(s => {
              const meta = s.meta ?? {};
              const metaLine = [meta.title, meta.company, meta.location].filter(Boolean).join(" · ");
              const dateLine = [meta.start_date, meta.end_date].filter(Boolean).join(" – ");
              return (
                <div key={s.id} className="bg-white p-4 rounded-xl shadow">
                  <div className="font-semibold text-slate-500 text-sm uppercase tracking-wide mb-2">{s.header}</div>
                  {(metaLine || dateLine) && (
                    <div className="text-sm text-slate-700 mb-1">
                      {metaLine && <span className="font-medium">{metaLine}</span>}
                      {dateLine && <span className="text-slate-400 ml-2">{dateLine}</span>}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap text-sm">{s.subject}</div>
                </div>
              );
            })}
            {sections.length === 0 && <p className="text-slate-400">No resume uploaded yet. Go through <a className="underline" href="/onboarding">onboarding</a>.</p>}
          </div>
        )}

        {tab === "filters" && (
          <div className="bg-white p-6 rounded-xl shadow max-w-xl space-y-4 text-sm">
            {!filters && <p className="text-amber-600">No filters saved yet — "Fetch jobs now" won't work until you save these.</p>}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Job titles (comma separated)</label>
              <input className="w-full border rounded-lg px-3 py-2"
                value={filterForm.titles}
                onChange={e => setFilterForm({ ...filterForm, titles: e.target.value })}
                placeholder="e.g. AI Engineer, Backend Engineer" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Locations (comma separated)</label>
              <input className="w-full border rounded-lg px-3 py-2"
                value={filterForm.locations}
                onChange={e => setFilterForm({ ...filterForm, locations: e.target.value })} />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filterForm.remoteOnly}
                onChange={e => setFilterForm({ ...filterForm, remoteOnly: e.target.checked })} /> Remote only
            </label>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Job type</label>
              <select className="w-full border rounded-lg px-3 py-2"
                value={filterForm.jobType}
                onChange={e => setFilterForm({ ...filterForm, jobType: e.target.value })}>
                <option value="full_time">Full-time</option>
                <option value="contract">Contract</option>
                <option value="part_time">Part-time</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Sources</label>
              {["linkedin", "indeed", "glassdoor"].map(src => (
                <label key={src} className="flex items-center gap-2 capitalize">
                  <input type="checkbox" checked={filterForm.sources.includes(src)}
                    onChange={e => setFilterForm({
                      ...filterForm,
                      sources: e.target.checked
                        ? [...filterForm.sources, src]
                        : filterForm.sources.filter(s => s !== src)
                    })} />
                  {src}
                </label>
              ))}
            </div>
            <button onClick={saveFilters} disabled={busy === "filters"}
              className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
              {busy === "filters" ? "Saving..." : "Save filters"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
