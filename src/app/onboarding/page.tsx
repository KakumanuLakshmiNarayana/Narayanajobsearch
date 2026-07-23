"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SOURCES = ["linkedin", "indeed", "glassdoor"];
const META_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "start_date", label: "Start date" },
  { key: "end_date", label: "End date" }
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resumeId, setResumeId] = useState<string | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [suggestedTitles, setSuggestedTitles] = useState<any[]>([]);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);

  const [locations, setLocations] = useState("Remote");
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [jobType, setJobType] = useState("full_time");
  const [sources, setSources] = useState<string[]>(["linkedin", "indeed"]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError(null);
    const fileInput = (e.target as HTMLFormElement).elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) { setLoading(false); return; }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/resume/upload", { method: "POST", body: form });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) return setError(json.error);
    setResumeId(json.resume_id);
    setSections(json.sections);
    setStep(2);
  }

  function hasMeta(s: any) {
    return s.meta && Object.keys(s.meta).some(k => (s.meta[k] ?? "").toString().trim() !== "");
  }

  function updateSubject(id: string, subject: string) {
    setSections(sections.map(s => s.id === id ? { ...s, subject } : s));
  }

  function updateMeta(id: string, key: string, value: string) {
    setSections(sections.map(s => s.id === id ? { ...s, meta: { ...s.meta, [key]: value } } : s));
  }

  async function persistSections() {
    setLoading(true);
    for (const s of sections) {
      if (s.id) await supabase.from("resume_sections").update({ subject: s.subject, meta: s.meta ?? {} }).eq("id", s.id);
    }
    setLoading(false);
    setStep(3);
    fetchTitles();
  }

  async function fetchTitles() {
    setLoading(true);
    const res = await fetch("/api/titles/suggest", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_id: resumeId })
    });
    const json = await res.json();
    setLoading(false);
    setSuggestedTitles(json.titles ?? []);
    setSelectedTitles((json.titles ?? []).slice(0, 3).map((t: any) => t.title));
  }

  async function saveFiltersAndFinish() {
    setLoading(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("job_filters").upsert({
      user_id: user!.id,
      titles: selectedTitles,
      locations: locations.split(",").map(s => s.trim()).filter(Boolean),
      remote_only: remoteOnly,
      job_type: jobType,
      sources,
      is_active: true
    }, { onConflict: "user_id" });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold mb-6">Set up your job agent</h1>

      {step === 1 && (
        <form onSubmit={handleUpload} className="bg-white p-6 rounded-xl shadow space-y-4">
          <p className="text-slate-600">Upload your base resume (PDF or DOCX). We'll split it into fixed sections you can review before anything is used for job matching.</p>
          <input type="file" name="file" accept=".pdf,.docx" required className="block" />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button disabled={loading} className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
            {loading ? "Parsing resume..." : "Upload & parse"}
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-slate-600">Review the parsed sections. Headers are fixed — you can only edit the content underneath.</p>
          {sections.map(s => (
            <div key={s.id} className="bg-white p-4 rounded-xl shadow">
              <div className="font-semibold text-slate-500 text-sm uppercase tracking-wide mb-2">{s.header}</div>

              {hasMeta(s) && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {META_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="text-xs text-slate-400">{f.label}</label>
                      <input
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        value={s.meta?.[f.key] ?? ""}
                        onChange={e => updateMeta(s.id, f.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}

              <textarea
                className="w-full border rounded-lg p-2 text-sm"
                rows={4}
                value={s.subject}
                onChange={e => updateSubject(s.id, e.target.value)}
              />
            </div>
          ))}
          <button disabled={loading} onClick={persistSections} className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
            {loading ? "Saving..." : "Save & continue"}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white p-6 rounded-xl shadow space-y-4">
          <p className="text-slate-600">Suggested job titles based on your resume — pick the ones to search for:</p>
          {loading && <p>Generating suggestions...</p>}
          <div className="space-y-2">
            {suggestedTitles.map(t => (
              <label key={t.title} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1"
                  checked={selectedTitles.includes(t.title)}
                  onChange={e => setSelectedTitles(e.target.checked
                    ? [...selectedTitles, t.title]
                    : selectedTitles.filter(x => x !== t.title))} />
                <span><span className="font-medium">{t.title}</span> — <span className="text-slate-500 text-sm">{t.rationale}</span></span>
              </label>
            ))}
          </div>
          <button onClick={() => setStep(4)} className="bg-slate-900 text-white rounded-lg px-4 py-2">Continue</button>
        </div>
      )}

      {step === 4 && (
        <div className="bg-white p-6 rounded-xl shadow space-y-4">
          <h2 className="font-semibold">Job search filters</h2>
          <div>
            <label className="text-sm text-slate-600">Locations (comma separated)</label>
            <input className="w-full border rounded-lg px-3 py-2" value={locations} onChange={e => setLocations(e.target.value)} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} /> Remote only
          </label>
          <div>
            <label className="text-sm text-slate-600">Job type</label>
            <select className="w-full border rounded-lg px-3 py-2" value={jobType} onChange={e => setJobType(e.target.value)}>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract</option>
              <option value="part_time">Part-time</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-600 block mb-1">Sources</label>
            {SOURCES.map(src => (
              <label key={src} className="flex items-center gap-2 capitalize">
                <input type="checkbox" checked={sources.includes(src)}
                  onChange={e => setSources(e.target.checked ? [...sources, src] : sources.filter(s => s !== src))} />
                {src}
              </label>
            ))}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button disabled={loading} onClick={saveFiltersAndFinish} className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">
            {loading ? "Saving..." : "Finish setup"}
          </button>
        </div>
      )}
    </div>
  );
}
