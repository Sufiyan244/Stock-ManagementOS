import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
export async function getSignedInUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect('/login');
  return { supabase, user: data.user };
}
export async function getProfile() {
  const { supabase, user } = await getSignedInUser();
  const { data: profile } = await supabase.from('profiles').select('user_id,business_id,display_name,email,role,active').eq('user_id', user.id).maybeSingle();
  return { supabase, user, profile: profile as Profile | null };
}
export async function requireProfile(roles?: string[]) {
  const result = await getProfile();
  if (!result.profile || !result.profile.business_id || !result.profile.active) redirect('/login?message=Your account is not active. Check your invitation.');
  const { data: business } = await result.supabase.from('businesses').select('is_suspended').eq('id', result.profile.business_id).maybeSingle();
  if (business?.is_suspended) redirect('/suspended');
  if (roles && !roles.includes(result.profile.role)) redirect('/unauthorized');
  return { ...result, profile: result.profile };
}
export async function isOwnerUser() {
  const { supabase, user } = await getSignedInUser();
  const { data } = await supabase.from('owner_accounts').select('user_id').eq('user_id', user.id).maybeSingle();
  return Boolean(data);
}