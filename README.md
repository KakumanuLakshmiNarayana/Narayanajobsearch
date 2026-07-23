# Job Agent

Multi-tenant job search agent. Each user logs in, uploads a base resume, gets
it split into fixed sections (Professional Summary, Technical Skills, one
entry per Experience/Education/etc.), sets job search filters, and the agent
pulls matching jobs daily, scores them against the resume, and generates a
tailored resume per job (base resume/profile is never modified — tailored
versions are separate rows tagged to a specific job).

**Applying is human-in-the-loop by design.** The agent prepares everything
(match score, tailored resume, apply link) but a person clicks "Apply" on
the job board and then hits "Mark applied" here. This is deliberate: LinkedIn,
Indeed, and Glassdoor's Terms of Service prohibit automated scraping and
automated form submission, and fully autonomous auto-apply risks account
bans and legal exposure. Job *discovery* uses Apify actors (also technically
against those sites' ToS if you scrape directly — swap in official
partner/ATS APIs, e.g. Greenhouse/Lever/Workday job boards or Indeed's
publisher feed, if you want a lower-risk sourcing path).

## Stack
- Next.js 14 (App Router) + Tailwind
- Supabase (Postgres + Auth + Storage), multi-tenant via Row Level Security
- Anthropic Claude for resume parsing, title suggestions, match scoring, tailoring
- Job discovery: synced from the existing `jobboard` Supabase project (a separately-run
  daily pipeline pulling from Adzuna, Arbeitnow, USAJobs, Dice, LinkedIn, Indeed,
  Glassdoor, etc. — 57k+ jobs and growing). We read its public `jobs` table
  (`JOBBOARD_SUPABASE_URL` / `JOBBOARD_SUPABASE_ANON_KEY`) and copy matches into our
  own `jobs` pool, rather than re-scraping ourselves. See `src/lib/jobboard.ts` and
  `src/app/api/jobs/ingest/route.ts`.

## Data model (Supabase project: job-agent, id gkpwhyhjytjcutuyvwqf)
- `profiles` — 1:1 with auth.users
- `resumes` — base resume(s) per user, raw text + original file in Storage
- `resume_sections` — header (FIXED, from `section_types`) + subject (content), one row per section/experience entry
- `section_types` — the locked list of allowed headers
- `job_filters` — one row per user: titles, locations, remote, job type, sources
- `suggested_job_titles` — LLM-suggested titles shown at onboarding
- `jobs` — global deduped pool of scraped postings (fingerprint unique)
- `user_jobs` — per-user pipeline state: sourced -> scored -> ready_to_apply -> applied -> ...
- `tailored_resumes` — tailored section snapshot + score, tagged to a `user_job`
- `applications` — the audit log: job, base score, tailored score, apply link, applied_at, status
- `fetch_log` — ingestion run history per source

RLS: every per-user table is scoped with `auth.uid() = user_id`. `jobs` and
`section_types` are readable by any authenticated user (global reference
data); writes to `jobs` go through the service-role key from server routes
only.

## Setup
1. `cp .env.example .env.local` and fill in:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard > Project Settings > API
   - `ANTHROPIC_API_KEY` — console.anthropic.com
   - `JOBBOARD_SUPABASE_URL` / `JOBBOARD_SUPABASE_ANON_KEY` — already filled in with the shared `jobboard` project's public read credentials, no action needed
   - `CRON_SECRET` — any random string, used to authorize `/api/cron/daily`
2. `npm install`
3. `npm run dev`

## Daily job pulls
`vercel.json` defines a Vercel Cron hitting `/api/cron/daily` once a day,
which fans out to `/api/jobs/ingest` + `/api/jobs/score` for every user with
an active filter. Requires deploying on Vercel (or trigger that route from
any external scheduler with the `Authorization: Bearer $CRON_SECRET` header).

## Flow
1. Sign up -> `/onboarding`: upload resume -> review parsed sections -> pick
   suggested job titles -> set filters -> saved to `job_filters`.
2. `/dashboard` "Fetch jobs now" (or the daily cron) pulls jobs via Apify,
   dedupes into `jobs`, creates `user_jobs` rows, scores them against the
   base resume.
3. For any scored job, "Tailor resume" generates a tailored `.docx`,
   re-scores it, and creates a `pending_review` row in `applications`.
4. User reviews on the **Applications** tab, applies on the job board
   themselves, then clicks "Mark applied" and pastes the confirmation link —
   this stamps `applied_at` and finalizes the log entry (base score, tailored
   score, apply link, date, status).
