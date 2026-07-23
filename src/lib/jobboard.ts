import { createClient } from "@supabase/supabase-js";

// Read-only client for the existing "jobboard" Supabase project, which
// already runs a working daily scrape (Adzuna, Arbeitnow, USAJobs, Dice,
// LinkedIn, Indeed, Glassdoor, etc.) into a public `jobs` table. Rather
// than re-implement job discovery here, we sync from that pool.
export function createJobboardClient() {
  return createClient(
    process.env.JOBBOARD_SUPABASE_URL!,
    process.env.JOBBOARD_SUPABASE_ANON_KEY!
  );
}

// Noisy source: raw LinkedIn post text run through a parser, titles are
// often garbage ("a sharp", "#tech #eng"). Excluded by default.
export const JOBBOARD_EXCLUDED_SOURCES = ["linkedin_post"];
