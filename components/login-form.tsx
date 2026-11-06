'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
export function LoginForm({ inviteKey, message }: { inviteKey: string; message: string }) {
  const router = useRouter(); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(message);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); const supabase=createClient();
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) { setError(loginError.message); setBusy(false); return; }
    if (inviteKey) { const { error: inviteError } = await supabase.rpc('accept_invitation',{p_key:inviteKey}); if(inviteError){setError('Signed in, but invitation failed: '+inviteError.message);setBusy(false);return;} }
    router.push('/dashboard'); router.refresh();
  }
  return <form onSubmit={submit} className="surface space-y-4 p-6 shadow-sm">
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <label className="block text-sm font-semibold">Email address<input className="field mt-2" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Password<input className="field mt-2" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <button className="btn w-full" disabled={busy}>{busy?'Signing in...':'Sign in'}</button>
    <p className="muted text-center text-xs">Have an invitation key? <a className="font-semibold text-[var(--blue)]" href="/register">Create your account</a></p>
  </form>;
}