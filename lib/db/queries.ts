import { randomUUID } from 'node:crypto';
import type { Db, Document, Filter } from 'mongodb';
import type { DbContext } from '@/lib/db/types';
import type { QueryRequest, QueryResult } from '@/lib/db/query-builder';

const staff = ['admin', 'manager', 'order_booker', 'cashier'];
const managers = ['admin', 'manager'];

function fail(message: string): QueryResult<null> { return { data: null, error: { message } }; }
function fieldName(field: string) { return field === 'id' ? '_id' : field; }
function splitFields(input: string): string[] {
  const parts: string[] = []; let depth = 0; let start = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') depth++;
    if (input[i] === ')') depth--;
    if (input[i] === ',' && depth === 0) { parts.push(input.slice(start, i).trim()); start = i + 1; }
  }
  const last = input.slice(start).trim(); if (last) parts.push(last);
  return parts;
}
function selectedFields(selection: string) {
  return splitFields(selection).filter((part) => part && !part.includes('('));
}
function normalize(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '_id') { out.id = String(item); continue; }
      out[key] = normalize(item);
    }
    return out;
  }
  return value;
}
function project(document: Document, selection: string): any {
  if (selection.trim() === '*' || selection.includes('*')) return normalize(document);
  const out: Record<string, any> = { id: String(document._id) };
  if (document.user_id) out.user_id = document.user_id;
  for (const field of selectedFields(selection)) {
    if (field === 'id') continue;
    if (field in document) out[field] = normalize(document[field]);
  }
  return out;
}
function parseOr(value: unknown): Document[] {
  if (typeof value !== 'string') return [];
  return value.split(',').map((part) => {
    const [field, op, ...rest] = part.split('.');
    if (!field || op !== 'eq') return {};
    return { [fieldName(field)]: rest.join('.') };
  }).filter((item) => Object.keys(item).length);
}
function roleOf(context: DbContext) { return String(context.profile?.role || ''); }
function assertActive(context: DbContext) {
  if (!context.user || !context.profile?.business_id || context.profile.active !== true) throw new Error('Your account is not active. Check your invitation.');
  if (context.business?.is_suspended) throw new Error('This business is suspended.');
  if (!staff.includes(roleOf(context))) throw new Error('Your account does not have an active staff role.');
}
function canRead(table: string, context: DbContext, _query: QueryRequest): boolean {
  if (!context.user) return false;
  const role = roleOf(context);
  if (table === 'profiles') return context.profile?._id === context.user.id || (managers.includes(role) && context.profile?.active === true && Boolean(context.profile?.business_id) && !context.business?.is_suspended);
  if (table === 'businesses') return Boolean(context.profile?.business_id);
  if (table === 'owner_accounts') return context.owner && true;
  if (table === 'products' || table === 'categories') return staff.includes(role);
  if (table === 'orders') return staff.includes(role);
  if (table === 'customers') return ['admin','manager','cashier'].includes(role) || role === 'order_booker';
  if (table === 'inventory_movements') return ['admin','manager','cashier'].includes(role);
  if (table === 'expenses') return managers.includes(role);
  if (table === 'payment_history') return ['admin','manager','cashier'].includes(role);
  if (table === 'notifications') return true;
  if (table === 'activity_logs') return managers.includes(role);
  return false;
}
function scopeFor(table: string, context: DbContext): Document {
  const role = roleOf(context), businessId = context.profile?.business_id;
  if (table === 'profiles') {
    return context.profile?._id === context.user?.id ? { _id: context.user.id } : { business_id: businessId };
  }
  if (table === 'businesses') return { _id: businessId };
  if (table === 'owner_accounts') return { _id: context.user?.id };
  if (table === 'notifications') return { business_id: businessId, recipient_id: context.user?.id };
  if (table === 'orders' && role === 'cashier') return { business_id: businessId, status: { $ne: 'pending' } };
  if (table === 'orders' && role === 'order_booker') return { business_id: businessId, $or: [{ created_by: context.user?.id }, { assigned_order_booker_id: context.user?.id }] };
  if (table === 'customers' && role === 'order_booker') {
    return { business_id: businessId, _id: { $in: [] } };
  }
  return businessId ? { business_id: businessId } : {};
}
function canWrite(table: string, action: QueryRequest['action'], context: DbContext) {
  const role = roleOf(context);
  if (action === 'insert') return (table === 'products' || table === 'categories') ? managers.includes(role) : table === 'expenses' && role === 'admin';
  if (action === 'update') return (table === 'products' || table === 'categories') && managers.includes(role);
  if (action === 'delete') return table === 'categories' && role === 'admin';
  return false;
}

async function expandRelations(db: Db, table: string, document: Document, selection: string) {
  const out = project(document, selection);
  if (table === 'orders' && selection.includes('customers(')) {
    const customer = document.customer_id ? await db.collection('customers').findOne({ _id: document.customer_id }) : null;
    const spec = selection.match(/customers\((.*?)\)/)?.[1] || '*';
    out.customers = customer ? project(customer, spec) : null;
  }
  if (table === 'orders' && selection.includes('order_items(')) {
    const spec = selection.match(/order_items\((.*)\)/)?.[1] || '*';
    const productSpec = spec.match(/products\((.*?)\)/)?.[1] || '*';
    out.order_items = await Promise.all((document.order_items || []).map(async (line: Document) => {
      const item = project(line, spec);
      if (spec.includes('products(')) {
        const product = await db.collection('products').findOne({ _id: line.product_id });
        item.products = product ? project(product, productSpec) : null;
      }
      return item;
    }));
  }
  if (table === 'payment_history' && selection.includes('orders(')) {
    const spec = selection.match(/orders\((.*?)\)/)?.[1] || '*';
    const order = await db.collection('orders').findOne({ _id: document.order_id });
    out.orders = order ? project(order, spec) : null;
  }
  return out;
}

export async function executeQuery(db: Db, context: DbContext, query: QueryRequest): Promise<QueryResult> {
  try {
    if (!['businesses','profiles','owner_accounts','categories','products','customers','orders','inventory_movements','expenses','payment_history','notifications','activity_logs'].includes(query.table)) return fail('Unknown data collection.');
    if (query.table !== 'profiles' && query.table !== 'owner_accounts') assertActive(context);
    const collection = db.collection(query.table);
    if (query.action === 'select') {
      if (!canRead(query.table, context, query)) return fail('You do not have permission to view these records.');
      const scope = scopeFor(query.table, context);
      const filter: Document = { ...scope };
      for (const item of query.filters) {
        if (item.op === 'eq' && item.field) filter[fieldName(item.field)] = item.value;
        if (item.op === 'gte' && item.field) filter[fieldName(item.field)] = { $gte: item.value };
      }
      const orFilter = query.filters.find((item) => item.op === 'or');
      // Order-booker visibility is always constrained to their own/assigned orders.
      // Do not let a client-supplied .or() replace the mandatory tenant/owner predicate.
      if (orFilter && !(query.table === 'orders' && roleOf(context) === 'order_booker')) {
        filter.$or = parseOr(orFilter.value);
      }
      if (query.table === 'customers' && roleOf(context) === 'order_booker') {
        const visibleOrders = await db.collection('orders').find({ business_id: context.profile!.business_id, $or: [{ created_by: context.user!.id }, { assigned_order_booker_id: context.user!.id }] }, { projection: { customer_id: 1 } }).toArray();
        filter._id = { $in: visibleOrders.map((order) => order.customer_id).filter(Boolean) };
      }
      const cursor = collection.find(filter as Filter<Document>);
      if (query.sort.length) cursor.sort(Object.fromEntries(query.sort.map((item) => [fieldName(item.field), item.direction])));
      if (query.limit !== undefined) cursor.limit(Math.max(0, query.limit));
      const rows = await cursor.toArray();
      const result = await Promise.all(rows.map((row) => expandRelations(db, query.table, row, query.selection)));
      return { data: query.single ? (result[0] ?? null) : result, error: null };
    }
    assertActive(context);
    if (!canWrite(query.table, query.action, context)) return fail('You do not have permission to make this change.');
    if (query.action === 'insert') {
      const inputs = Array.isArray(query.payload) ? query.payload : [query.payload || {}];
      const now = new Date();
      for (const input of inputs as Document[]) {
        const document: Document = { ...input, _id: randomUUID(), business_id: context.profile!.business_id, created_at: now };
        if (query.table === 'products') {
          document.reserved_quantity = 0; document.active = true; document.updated_at = now;
          document.stock_quantity = Number(document.stock_quantity || 0);
          document.low_stock_level = Number(document.low_stock_level ?? 5);
          document.cost_price = Number(document.cost_price || 0);
          document.selling_price = Number(document.selling_price || 0);
          if (!document.name || !Number.isFinite(document.stock_quantity) || !Number.isFinite(document.low_stock_level) || !Number.isFinite(document.cost_price) || !Number.isFinite(document.selling_price) || document.stock_quantity < 0 || document.low_stock_level < 0 || document.cost_price < 0 || document.selling_price < 0) throw new Error('Enter valid product details.');
          if (document.category_id && !await db.collection('categories').findOne({ _id: document.category_id, business_id: document.business_id })) throw new Error('Product category must belong to the same business.');
        }
        if (query.table === 'categories' && !String(document.name || '').trim()) throw new Error('Category name is required.');
        if (query.table === 'expenses') {
          document.amount = Number(document.amount);
          document.created_by = context.user!.id;
          if (!document.title || !Number.isFinite(document.amount) || document.amount <= 0) throw new Error('Enter a title and an amount greater than zero.');
        }
        await collection.insertOne(document);
        if (query.table === 'products') {
          await db.collection('inventory_movements').insertOne({
            _id: randomUUID(), business_id: document.business_id, product_id: document._id, movement_type: 'opening',
            delta_on_hand: document.stock_quantity, delta_reserved: 0, note: 'Opening product quantity',
            created_by: context.user!.id, created_at: now,
          });
          await db.collection('activity_logs').insertOne({ _id: randomUUID(), business_id: document.business_id, actor_id: context.user!.id, action: 'Created product', entity: 'product', entity_id: document._id, details: { name: document.name }, created_at: now });
        }
        if (query.table === 'categories') await db.collection('activity_logs').insertOne({ _id: randomUUID(), business_id: document.business_id, actor_id: context.user!.id, action: 'Created category', entity: 'category', entity_id: document._id, details: { name: document.name }, created_at: now });
        if (query.table === 'expenses') await db.collection('activity_logs').insertOne({ _id: randomUUID(), business_id: document.business_id, actor_id: context.user!.id, action: 'Recorded expense', entity: 'expense', entity_id: document._id, details: { title: document.title, amount: document.amount }, created_at: now });
      }
      return { data: null, error: null };
    }
    const filter: Document = { ...scopeFor(query.table, context) };
    for (const item of query.filters) if (item.op === 'eq' && item.field) filter[fieldName(item.field)] = item.value;
    if (query.action === 'update') {
      const patch = { ...((query.payload || {}) as Document), updated_at: new Date() };
      if (query.table === 'products' && ('stock_quantity' in patch || 'reserved_quantity' in patch)) throw new Error('Use the stock adjustment workflow to change inventory quantities.');
      if (query.table === 'products') {
        if (patch.selling_price !== undefined) patch.selling_price = Number(patch.selling_price);
        if (patch.cost_price !== undefined) patch.cost_price = Number(patch.cost_price);
        if (patch.selling_price !== undefined && (!Number.isFinite(patch.selling_price) || patch.selling_price < 0) || patch.cost_price !== undefined && (!Number.isFinite(patch.cost_price) || patch.cost_price < 0)) throw new Error('Product prices cannot be negative.');
        if (patch.category_id && !await db.collection('categories').findOne({ _id: patch.category_id, business_id: context.profile!.business_id })) throw new Error('Product category must belong to the same business.');
      }
      if (query.table === 'categories' && patch.name !== undefined && !String(patch.name).trim()) throw new Error('Category name is required.');
      const rows = await collection.find(filter).toArray();
      for (const row of rows) {
        const updated = await collection.findOneAndUpdate({ _id: row._id, business_id: context.profile!.business_id }, { $set: patch }, { returnDocument: 'after' });
        if (query.table === 'categories') await db.collection('activity_logs').insertOne({ _id: randomUUID(), business_id: context.profile!.business_id, actor_id: context.user!.id, action: 'Updated category', entity: 'category', entity_id: row._id, details: { name: patch.name || row.name }, created_at: new Date() });
        if (query.table === 'products' && (patch.name || patch.selling_price !== undefined || patch.cost_price !== undefined)) await db.collection('activity_logs').insertOne({ _id: randomUUID(), business_id: context.profile!.business_id, actor_id: context.user!.id, action: 'Updated product', entity: 'product', entity_id: row._id, details: { name: patch.name || row.name }, created_at: new Date() });
        void updated;
      }
      return { data: null, error: null };
    }
    if (query.action === 'delete') {
      const rows = await collection.find(filter).toArray();
      for (const row of rows) {
        if (query.table === 'categories') await db.collection('products').updateMany({ business_id: context.profile!.business_id, category_id: row._id }, { $set: { category_id: null } });
        await collection.deleteOne({ _id: row._id, business_id: context.profile!.business_id });
      }
      return { data: null, error: null };
    }
    return fail('Unsupported database operation.');
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Database operation failed.');
  }
}
