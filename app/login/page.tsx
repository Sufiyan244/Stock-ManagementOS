import { LoginForm } from '@/components/login-form';
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string; invite?: string }> }) {
  const params = await searchParams;
  return <main className="min-h-screen flex items-center justify-center p-5"><div className="w-full max-w-md">
    <div className="mb-8 text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#164b86] text-xl font-bold text-white">S</div><h1 className="text-2xl font-bold">Stock Management OS</h1><p className="muted mt-2 text-sm">Sign in to your business workspace</p></div>
    <LoginForm inviteKey={params.invite || ''} message={params.message || ''} /><p className="muted mt-5 text-center text-xs">Access is provided by your business administrator.</p>
  </div></main>;
}