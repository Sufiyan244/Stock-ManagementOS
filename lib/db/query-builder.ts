export type QueryFilter = { op: 'eq' | 'gte' | 'or'; field?: string; value: unknown };
export type QueryRequest = {
  table: string; action: 'select' | 'insert' | 'update' | 'delete';
  selection: string; filters: QueryFilter[]; sort: { field: string; direction: 1 | -1 }[];
  limit?: number; single?: boolean; payload?: unknown;
};
export type QueryResult<T = unknown> = { data: T; error: { message: string } | null };
export type QueryExecutor = (request: QueryRequest) => Promise<QueryResult>;

export class QueryBuilder implements PromiseLike<QueryResult> {
  private request: QueryRequest;

  constructor(table: string, private readonly executor: QueryExecutor) {
    this.request = { table, action: 'select', selection: '*', filters: [], sort: [] };
  }

  select(selection = '*') { this.request.selection = selection; return this; }
  eq(field: string, value: unknown) { this.request.filters.push({ op: 'eq', field, value }); return this; }
  gte(field: string, value: unknown) { this.request.filters.push({ op: 'gte', field, value }); return this; }
  or(expression: string) { this.request.filters.push({ op: 'or', value: expression }); return this; }
  order(field: string, options?: { ascending?: boolean }) {
    this.request.sort.push({ field, direction: options?.ascending === false ? -1 : 1 }); return this;
  }
  limit(value: number) { this.request.limit = value; return this; }
  maybeSingle() { this.request.single = true; return this; }
  insert(payload: unknown) { this.request.action = 'insert'; this.request.payload = payload; return this; }
  update(payload: unknown) { this.request.action = 'update'; this.request.payload = payload; return this; }
  delete() { this.request.action = 'delete'; return this; }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.executor(this.request).then(onfulfilled, onrejected);
  }
}
