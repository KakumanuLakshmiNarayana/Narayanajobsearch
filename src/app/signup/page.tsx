"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: fullName } }
    });
    setLoading(false);
    if (error) return setError(error.message);
    if (data.session) {
      router.push("/onboarding");
    } else {
      setDone(true); // email confirmation required
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="max-w-sm text-center">Check your email to confirm your account, then log in.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-8 rounded-xl shadow space-y-4">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <input className="w-full border rounded-lg px-3 py-2" placeholder="Full name"
          value={fullName} onChange={e => setFullName(e.target.value)} required />
        <input className="w-full border rounded-lg px-3 py-2" type="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="w-full border rounded-lg px-3 py-2" type="password" placeholder="Password (min 6 chars)"
          value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={loading} className="w-full bg-slate-900 text-white rounded-lg py-2 disabled:opacity-50">
          {loading ? "Creating..." : "Sign up"}
        </button>
        <p className="text-sm text-slate-500">Already have an account? <a className="underline" href="/login">Log in</a></p>
      </form>
    </div>
  );
}
