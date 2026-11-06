import { redirect } from 'next/navigation';
import { getProfile, isOwnerUser } from '@/lib/auth';
import { getRoleWorkspace } from '@/lib/access';
export default async function DashboardRedirect(){
  if(await isOwnerUser()){const secret=process.env.OWNER_ROUTE_SECRET;if(!secret)redirect('/login?message=Owner route is not configured.');redirect('/owner/'+secret);}
  const {profile}=await getProfile();
  if(!profile||!profile.active||!profile.business_id)redirect('/login?message=Account invitation is not active.');
  if(profile.role==='order_booker')redirect('/booker');
  const key=getRoleWorkspace(profile.role);if(!key)redirect('/login?message=Workspace URL is not configured.');
  redirect('/workspace/'+key);
}