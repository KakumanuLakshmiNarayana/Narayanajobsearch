"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-8 rounded-xl shadow space-y-4">
        <h1 className="text-xl font-semibold">Log in</h1>
        <input className="w-full border rounded-lg px-3 py-2" type="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="w-full border rounded-lg px-3 py-2" type="password" placeholder="Password"
          value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={loading} className="w-full bg-slate-900 text-white rounded-lg py-2 disabled:opacity-50">
          {loading ? "Signing in..." : "Log in"}
        </button>
        <p className="text-sm text-slate-500">No account? <a className="underline" href="/signup">Sign up</a></p>
      </form>
    </div>
  );
}
