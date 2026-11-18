import 'dotenv/config';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI in .env.local before running this script.');
const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB_NAME || 'stock_management_os');
  const names = ['users','businesses','profiles','owner_accounts','invitation_keys','categories','products','customers','orders','inventory_movements','expenses','payment_history','notifications','activity_logs','owner_messages'];
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
  for (const name of names) if (!existing.has(name)) await db.createCollection(name);

  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('profiles').createIndex({ business_id: 1, role: 1 }),
    db.collection('invitation_keys').createIndex({ token_hash: 1 }, { unique: true }),
    db.collection('categories').createIndex({ business_id: 1, name: 1 }, { unique: true }),
    db.collection('products').createIndex({ business_id: 1, name: 1 }),
    db.collection('products').createIndex({ business_id: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } } }),
    db.collection('orders').createIndex({ business_id: 1, order_number: 1 }, { unique: true }),
    db.collection('orders').createIndex({ business_id: 1, created_at: -1 }),
    db.collection('orders').createIndex({ business_id: 1, status: 1 }),
    db.collection('orders').createIndex({ business_id: 1, created_by: 1, created_at: -1 }),
    db.collection('orders').createIndex({ business_id: 1, assigned_order_booker_id: 1, created_at: -1 }),
    db.collection('inventory_movements').createIndex({ business_id: 1, product_id: 1, created_at: -1 }),
    db.collection('expenses').createIndex({ business_id: 1, expense_date: -1 }),
    db.collection('payment_history').createIndex({ business_id: 1, created_at: -1 }),
    db.collection('notifications').createIndex({ recipient_id: 1, created_at: -1 }),
    db.collection('activity_logs').createIndex({ business_id: 1, created_at: -1 }),
    db.collection('owner_messages').createIndex({ scheduled_for: 1, sent_at: 1 }),
  ]);

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const businessName = process.env.BUSINESS_NAME?.trim();
  if (email || password || businessName) {
    if (!email || !password || !businessName) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and BUSINESS_NAME together to seed the first admin.');
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) throw new Error('That admin email already exists. Do not overwrite existing account data.');
    const userId = randomUUID(), businessId = randomUUID(), now = new Date();
    await db.collection('businesses').insertOne({ _id: businessId, name: businessName, is_suspended: false, created_at: now });
    await db.collection('users').insertOne({ _id: userId, email, display_name: 'Business Admin', password_hash: await bcrypt.hash(password, 12), created_at: now, updated_at: now });
    await db.collection('profiles').insertOne({ _id: userId, user_id: userId, business_id: businessId, display_name: 'Business Admin', email, role: 'admin', active: true, created_at: now });
    console.log('Created the first business and admin account.');
  }

  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD;
  const ownerName = process.env.OWNER_DISPLAY_NAME?.trim() || 'Platform Owner';
  if (ownerEmail || ownerPassword) {
    if (!ownerEmail || !ownerPassword) throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD together to seed a platform owner.');
    if (await db.collection('users').findOne({ email: ownerEmail })) throw new Error('That owner email already exists. Do not overwrite existing account data.');
    const ownerId = randomUUID(), now = new Date();
    await db.collection('users').insertOne({ _id: ownerId, email: ownerEmail, display_name: ownerName, password_hash: await bcrypt.hash(ownerPassword, 12), created_at: now, updated_at: now });
    await db.collection('owner_accounts').insertOne({ _id: ownerId, user_id: ownerId, created_at: now });
    console.log('Created the separate platform-owner account.');
  }

  console.log('MongoDB collections and indexes are ready.');
} finally {
  await client.close();
}
