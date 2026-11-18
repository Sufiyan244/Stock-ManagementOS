import type { Document, Db } from 'mongodb';
import type { SessionUser } from '@/lib/session';

export type DbContext = {
  user: SessionUser | null;
  profile: Document | null;
  business: Document | null;
  owner: boolean;
};
export type DbHandle = Db;
