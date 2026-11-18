'use client';
import { QueryBuilder, type QueryRequest, type QueryResult } from '@/lib/db/query-builder';

async function request(path: string, body?: unknown): Promise<any> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      const message = typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'Request failed.';
      return { data: null, error: { message } };
    }
    return result;
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Network request failed.' } };
  }
}

export function createClient() {
  return {
    from(table: string) {
      return new QueryBuilder(table, (query: QueryRequest) => request('/api/db/query', query) as Promise<QueryResult>);
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      return request('/api/db/rpc', { name, args });
    },
    auth: {
      async signInWithPassword(credentials: { email: string; password: string }) {
        return request('/api/auth/login', credentials);
      },
      async signUp(input: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
        return request('/api/auth/register', {
          email: input.email, password: input.password,
          display_name: String(input.options?.data?.display_name || ''),
        });
      },
      async signOut() { return request('/api/auth/logout', {}); },
      async updateUser(input: { password: string }) { return request('/api/auth/password', input); },
      async getUser() {
        const result = await request('/api/auth/me');
        return { data: { user: result.data?.user || null }, error: result.error };
      },
    },
  };
}
