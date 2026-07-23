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
  }

  useEffect(() => { loadAll(); }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function runIngest() {
    setBusy("ingest");
    const { data: { user } } = await supabase.auth.getUser();
    await fetch("/api/jobs/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: user!.id }) });
    await fetch("/api/jobs/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: user!.id }) });
    await loadAll();
    setBusy(null);
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
          <div className="bg-white p-6 rounded-xl shadow max-w-xl space-y-2 text-sm">
            {filters ? (
              <>
                <div><span className="font-medium">Titles:</span> {filters.titles?.join(", ")}</div>
                <div><span className="font-medium">Locations:</span> {filters.locations?.join(", ")}</div>
                <div><span className="font-medium">Remote only:</span> {String(filters.remote_only)}</div>
                <div><span className="font-medium">Job type:</span> {filters.job_type}</div>
                <div><span className="font-medium">Sources:</span> {filters.sources?.join(", ")}</div>
                <a href="/onboarding" className="underline text-slate-500 inline-block mt-2">Edit via onboarding flow</a>
              </>
            ) : <p className="text-slate-400">No filters set yet.</p>}
          </div>
        )}
      </main>
    </div>
  );
}
