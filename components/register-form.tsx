'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
export function RegisterForm() {
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [key,setKey]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage('');const supabase=createClient();
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:window.location.origin+'/login?invite='+encodeURIComponent(key.trim())}});
    if(error){setMessage(error.message);setBusy(false);return;}
    if(data.session){const {error:inviteError}=await supabase.rpc('accept_invitation',{p_key:key.trim()});if(inviteError){setMessage('Account created, but invitation failed: '+inviteError.message);setBusy(false);return;}window.location.assign('/dashboard');return;}
    setMessage('Account created. Verify your email, then sign in using the same invitation key: '+key);setBusy(false);
  }
  return <form onSubmit={submit} className="surface space-y-4 p-6 shadow-sm">{message&&<p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    <label className="block text-sm font-semibold">Full name<input className="field mt-2" required value={name} onChange={e=>setName(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Work email<input className="field mt-2" type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Invitation key<input className="field mt-2" required value={key} onChange={e=>setKey(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Password<input className="field mt-2" type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <button className="btn w-full" disabled={busy}>{busy?'Creating account...':'Create account'}</button>
  </form>;
}