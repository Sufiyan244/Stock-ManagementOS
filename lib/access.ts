import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import type { AppRole } from '@/lib/types';
const workspaceKeys: Record<string, AppRole> = {
  [process.env.ADMIN_WORKSPACE_KEY || '']: 'admin',
  [process.env.MANAGER_WORKSPACE_KEY || '']: 'manager',
  [process.env.CASHIER_WORKSPACE_KEY || '']: 'cashier',
};
export async function requireWorkspace(key: string) {
  const role = workspaceKeys[key];
  if (!key || !role) notFound();
  const context = await requireProfile([role]);
  return { ...context, workspaceKey: key, expectedRole: role };
}
export function getRoleWorkspace(role: AppRole) {
  if (role === 'admin') return process.env.ADMIN_WORKSPACE_KEY;
  if (role === 'manager') return process.env.MANAGER_WORKSPACE_KEY;
  if (role === 'cashier') return process.env.CASHIER_WORKSPACE_KEY;
  return null;
}