import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH { application_id, status, apply_link, notes } — human-in-the-loop
// action: user reviews the tailored resume/job on the dashboard, applies
// on the job board themselves, then marks it applied here. This is what
// stamps applied_at and finalizes the log entry.
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { application_id, status, apply_link, notes } = await req.json();
  const patch: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (apply_link !== undefined) patch.apply_link = apply_link;
  if (notes !== undefined) patch.notes = notes;
  if (status === "applied") patch.applied_at = new Date().toISOString();

  const { data: app, error } = await supabase
    .from("applications").update(patch)
    .eq("id", application_id).eq("user_id", user.id)
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (status === "applied") {
    await supabase.from("user_jobs").update({ status: "applied", updated_at: new Date().toISOString() }).eq("id", app.user_job_id);
  }
  return NextResponse.json({ application: app });
}
