import type { Db } from 'mongodb';

export const collectionNames = [
  'users','businesses','profiles','owner_accounts','invitation_keys','categories','products','customers',
  'orders','inventory_movements','expenses','payment_history','notifications','activity_logs','owner_messages',
] as const;

export async function createMongoSchema(db: Db) {
  const existing = new Set(await db.listCollections({}, { nameOnly: true }).toArray().then((rows) => rows.map((row) => row.name)));
  for (const name of collectionNames) if (!existing.has(name)) await db.createCollection(name);

  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
    db.collection('profiles').createIndex({ business_id: 1, role: 1 }, { name: 'profiles_business_role_idx' }),
    db.collection('invitation_keys').createIndex({ token_hash: 1 }, { unique: true, name: 'invitation_token_unique' }),
    db.collection('invitation_keys').createIndex({ business_id: 1, email: 1, expires_at: 1 }, { name: 'invitation_business_email_idx' }),
    db.collection('categories').createIndex({ business_id: 1, name: 1 }, { unique: true, name: 'categories_business_name_unique' }),
    db.collection('products').createIndex({ business_id: 1, name: 1 }, { name: 'products_business_name_idx' }),
    db.collection('products').createIndex({ business_id: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } }, name: 'products_business_sku_unique' }),
    db.collection('customers').createIndex({ business_id: 1, full_name: 1 }, { name: 'customers_business_name_idx' }),
    db.collection('orders').createIndex({ business_id: 1, order_number: 1 }, { unique: true, name: 'orders_business_number_unique' }),
    db.collection('orders').createIndex({ business_id: 1, created_at: -1 }, { name: 'orders_business_created_idx' }),
    db.collection('orders').createIndex({ business_id: 1, status: 1 }, { name: 'orders_business_status_idx' }),
    db.collection('orders').createIndex({ business_id: 1, created_by: 1, created_at: -1 }, { name: 'orders_creator_idx' }),
    db.collection('orders').createIndex({ business_id: 1, assigned_order_booker_id: 1, created_at: -1 }, { name: 'orders_booker_idx' }),
    db.collection('inventory_movements').createIndex({ business_id: 1, product_id: 1, created_at: -1 }, { name: 'inventory_business_product_idx' }),
    db.collection('expenses').createIndex({ business_id: 1, expense_date: -1 }, { name: 'expenses_business_date_idx' }),
    db.collection('payment_history').createIndex({ business_id: 1, created_at: -1 }, { name: 'payments_business_created_idx' }),
    db.collection('notifications').createIndex({ recipient_id: 1, created_at: -1 }, { name: 'notifications_user_idx' }),
    db.collection('activity_logs').createIndex({ business_id: 1, created_at: -1 }, { name: 'activity_business_created_idx' }),
    db.collection('owner_messages').createIndex({ scheduled_for: 1, sent_at: 1 }, { name: 'owner_messages_schedule_idx' }),
  ]);
}
