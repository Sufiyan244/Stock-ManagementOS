import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI before running this importer.');
const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8) || 'supabase-export.json';
const replace = process.argv.includes('--replace');
const source = JSON.parse(await readFile(input, 'utf8'));
if (!source.tables || !Array.isArray(source.auth_users)) throw new Error('Input file is not a StockOS Supabase export.');
const numericFields = new Set(['stock_quantity','reserved_quantity','low_stock_level','cost_price','selling_price','quantity','unit_price','line_total','line_cost','total_amount','cost_total','amount_received','amount','delta_on_hand','delta_reserved']);
const dateFields = new Set(['created_at','updated_at','expires_at','used_at','read_at','scheduled_for','sent_at','email_confirmed_at']);
function convert(value, key='') {
  if (value === null || value === undefined) return value;
  if (numericFields.has(key)) return Number(value);
  if (dateFields.has(key) && value) return new Date(value);
  if (key === 'expense_date' && value) return String(value).slice(0,10);
  if (Array.isArray(value)) return value.map((item) => convert(item));
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, child] of Object.entries(value)) result[childKey] = convert(child, childKey);
    return result;
  }
  return value;
}
function documentFor(table, row) {
  const copy = convert(row);
  const key = table === 'profiles' || table === 'owner_accounts' ? row.user_id : row.id;
  delete copy.id;
  copy._id = String(key);
  return copy;
}
const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB_NAME || 'stock_management_os');
  const tableNames = ['businesses','profiles','owner_accounts','invitation_keys','categories','products','customers','orders','inventory_movements','expenses','payment_history','notifications','activity_logs','owner_messages'];
  const existingData = await Promise.all([...tableNames,'users'].map((name) => db.collection(name).estimatedDocumentCount()));
  if (existingData.some((count) => count > 0) && !replace) throw new Error('MongoDB already contains data. Back up first, then pass --replace to replace all StockOS collections.');
  if (replace) await Promise.all([...tableNames,'users'].map((name) => db.collection(name).deleteMany({})));

  const itemsByOrder = new Map();
  for (const item of source.tables.order_items || []) {
    const list = itemsByOrder.get(String(item.order_id)) || [];
    const document = documentFor('order_items', item);
    delete document.order_id;
    list.push(document);
    itemsByOrder.set(String(item.order_id), list);
  }
  for (const table of tableNames) {
    const rows = (source.tables[table] || []).map((row) => {
      const doc = documentFor(table, row);
      if (table === 'orders') doc.order_items = itemsByOrder.get(String(row.id)) || [];
      return doc;
    });
    if (rows.length) await db.collection(table).insertMany(rows, { ordered: false });
    console.log('Imported', table, rows.length, 'documents');
  }
  const authUsers = source.auth_users.map((row) => ({
    _id: String(row.id), email: String(row.email).toLowerCase(),
    display_name: String(row.raw_user_meta_data?.display_name || ''),
    password_hash: row.encrypted_password,
    email_confirmed_at: row.email_confirmed_at ? new Date(row.email_confirmed_at) : null,
    created_at: row.created_at ? new Date(row.created_at) : new Date(),
    updated_at: row.updated_at ? new Date(row.updated_at) : new Date(),
  }));
  if (authUsers.length) await db.collection('users').insertMany(authUsers, { ordered: false });
  console.log('Imported auth.users', authUsers.length, 'documents');
  console.log('Import complete. Run npm run db:setup to create indexes.');
} finally {
  await client.close();
}
