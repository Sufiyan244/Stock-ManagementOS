import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser, clearSessionCookie } from '@/lib/session';
import { QueryBuilder } from '@/lib/db/query-builder';
import { executeQuery } from '@/lib/db/queries';
import { executeRpc } from '@/lib/db/rpc';
import type { DbContext } from '@/lib/db/types';

export async function createClient() {
  const user = await getCurrentUser();
  const db = await getDb();
  const profile = user ? await db.collection('profiles').findOne({ _id: user.id }) : null;
  const business = profile?.business_id ? await db.collection('businesses').findOne({ _id: profile.business_id }) : null;
  const context: DbContext = {
    user,
    profile,
    business,
    owner: user ? Boolean(await db.collection('owner_accounts').findOne({ _id: user.id })) : false,
  };

  return {
    from(table: string) {
      return new QueryBuilder(table, (query) => executeQuery(db, context, query));
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      return executeRpc(db, context, name, args);
    },
    auth: {
      async getUser() {
        const current = user ? { id: user.id, email: user.email, user_metadata: { display_name: user.display_name } } : null;
        return { data: { user: current }, error: null };
      },
      async signOut() { await clearSessionCookie(); return { error: null }; },
      async updateUser(input: { password: string }) {
        if (!user) return { error: { message: 'You must be signed in.' } };
        if (input.password.length < 8) return { error: { message: 'Password must contain at least 8 characters.' } };
        await db.collection('users').updateOne(
          { _id: user.id },
          { $set: { password_hash: await bcrypt.hash(input.password, 12), updated_at: new Date() } },
        );
        return { error: null };
      },
    },
  };
}
