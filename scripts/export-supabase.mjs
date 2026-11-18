import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('Set SUPABASE_DB_URL to the direct Supabase PostgreSQL connection string.');
const output = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || 'supabase-export.json';
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 2 });
const tables = [
  'businesses','profiles','owner_accounts','invitation_keys','categories','products','customers','orders',
  'order_items','inventory_movements','expenses','payment_history','notifications','activity_logs','owner_messages',
];
try {
  const exported = { exported_at: new Date().toISOString(), tables: {}, auth_users: [] };
  for (const table of tables) {
    const result = await pool.query('select * from public.' + '"' + table + '"');
    exported.tables[table] = result.rows;
    console.log('Exported', table, result.rowCount, 'rows');
  }
  const users = await pool.query(`select id, email, encrypted_password, raw_user_meta_data, email_confirmed_at, created_at, updated_at from auth.users`);
  exported.auth_users = users.rows;
  console.log('Exported auth.users', users.rowCount, 'rows');
  await writeFile(output, JSON.stringify(exported, null, 2), 'utf8');
  console.log('Supabase export written to', output);
} finally {
  await pool.end();
}
