import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

// Configure in vercel.json as a daily cron hitting this route with
// Authorization: Bearer $CRON_SECRET. Fans out to /api/jobs/ingest and
// /api/jobs/score for every user with active filters.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: activeFilters } = await admin.from("job_filters").select("user_id").eq("is_active", true);

  const origin = req.nextUrl.origin;
  const results = [];
  for (const f of activeFilters ?? []) {
    const ingestRes = await fetch(`${origin}/api/jobs/ingest`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: f.user_id })
    }).then(r => r.json()).catch(e => ({ error: String(e) }));

    const scoreRes = await fetch(`${origin}/api/jobs/score`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: f.user_id })
    }).then(r => r.json()).catch(e => ({ error: String(e) }));

    results.push({ user_id: f.user_id, ingestRes, scoreRes });
  }

  return NextResponse.json({ ran_for: results.length, results });
}
