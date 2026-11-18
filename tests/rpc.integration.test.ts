import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { executeRpc, processOwnerMessages } from '../lib/db/rpc';
import { executeQuery } from '../lib/db/queries';
import type { DbContext } from '../lib/db/types';

const uri = process.env.MONGODB_TEST_URI;
test('MongoDB data layer integration', { skip: !uri }, async (suite) => {
  const client = new MongoClient(uri!);
  await client.connect();
  const dbName = 'stockos_test_' + randomUUID().replaceAll('-', '');
  const db = client.db(dbName);
  const businessId = randomUUID(), adminId = randomUUID(), bookerId = randomUUID(), ownerId = randomUUID();
  const now = new Date();
  await db.collection('businesses').insertOne({ _id: businessId, name: 'Test business', is_suspended: false, created_at: now });
  await db.collection('profiles').insertMany([
    { _id: adminId, user_id: adminId, business_id: businessId, display_name: 'Admin', email: 'admin@test.local', role: 'admin', active: true, created_at: now },
    { _id: bookerId, user_id: bookerId, business_id: businessId, display_name: 'Booker', email: 'booker@test.local', role: 'order_booker', active: true, created_at: now },
  ]);
  await db.collection('owner_accounts').insertOne({ _id: ownerId, user_id: ownerId, created_at: now });
  const admin: DbContext = { user: { id: adminId, email: 'admin@test.local', display_name: 'Admin' }, profile: await db.collection('profiles').findOne({ _id: adminId }), business: await db.collection('businesses').findOne({ _id: businessId }), owner: false };
  const booker: DbContext = { user: { id: bookerId, email: 'booker@test.local', display_name: 'Booker' }, profile: await db.collection('profiles').findOne({ _id: bookerId }), business: admin.business, owner: false };
  const owner: DbContext = { user: { id: ownerId, email: 'owner@test.local', display_name: 'Owner' }, profile: null, business: null, owner: true };
  const productId = randomUUID();
  await db.collection('products').insertOne({ _id: productId, business_id: businessId, name: 'Test stock', sku: 'TEST-1', stock_quantity: 20, reserved_quantity: 0, low_stock_level: 2, cost_price: 5, selling_price: 10, active: true, created_at: now, updated_at: now });

  try {
    await suite.test('tenant-scoped queries, CRUD, and role checks', async () => {
      const otherBusinessId = randomUUID();
      await db.collection('businesses').insertOne({ _id: otherBusinessId, name: 'Other tenant', is_suspended: false, created_at: now });
      await db.collection('products').insertOne({ _id: randomUUID(), business_id: otherBusinessId, name: 'Private stock', stock_quantity: 9, reserved_quantity: 0, active: true });
      const read = await executeQuery(db, admin, { table: 'products', action: 'select', selection: 'id,name,stock_quantity', filters: [], sort: [], limit: 10 });
      assert.equal(read.error, null);
      assert.equal((read.data as any[]).length, 1);

      const spoofedTenant = await executeQuery(db, admin, {
        table: 'products', action: 'select', selection: '*',
        filters: [{ op: 'eq', field: 'business_id', value: otherBusinessId }], sort: [],
      });
      assert.equal((spoofedTenant.data as any[]).length, 0);

      const spoofedProfile = await executeQuery(db, booker, {
        table: 'profiles', action: 'select', selection: 'user_id,email',
        filters: [{ op: 'eq', field: 'id', value: adminId }], sort: [], single: true,
      });
      assert.equal(spoofedProfile.data, null);

      assert.equal((await executeQuery(db, admin, { table: 'categories', action: 'insert', selection: '*', filters: [], sort: [], payload: { name: 'Beverages' } })).error, null);
      const category = await db.collection('categories').findOne({ business_id: businessId, name: 'Beverages' });
      assert.ok(category);
      const inserted = await executeQuery(db, admin, { table: 'products', action: 'insert', selection: '*', filters: [], sort: [], payload: { name: 'New product', category_id: category!._id, stock_quantity: 4, low_stock_level: 1, cost_price: 2, selling_price: 4 } });
      assert.equal(inserted.error, null);
      const newProduct = await db.collection('products').findOne({ business_id: businessId, name: 'New product' });
      assert.equal(newProduct?.reserved_quantity, 0);
      assert.equal(await db.collection('inventory_movements').countDocuments({ product_id: newProduct?._id, movement_type: 'opening' }), 1);

      const update = await executeQuery(db, admin, { table: 'products', action: 'update', selection: '*', filters: [{ op: 'eq', field: 'id', value: productId }], sort: [], payload: { selling_price: 12 } });
      assert.equal(update.error, null);
      assert.equal((await db.collection('products').findOne({ _id: productId }))?.selling_price, 12);
      assert.equal((await executeQuery(db, admin, { table: 'categories', action: 'delete', selection: '*', filters: [{ op: 'eq', field: 'id', value: String(category!._id) }], sort: [] })).error, null);
      assert.equal((await db.collection('products').findOne({ _id: newProduct!._id }))?.category_id, null);

      assert.equal((await executeQuery(db, admin, { table: 'expenses', action: 'insert', selection: '*', filters: [], sort: [], payload: { title: 'Fuel', amount: 15, expense_date: '2026-11-18', notes: null } })).error, null);
      assert.equal(await db.collection('expenses').countDocuments({ business_id: businessId, title: 'Fuel', created_by: adminId }), 1);
      const denied = await executeQuery(db, booker, { table: 'expenses', action: 'select', selection: '*', filters: [], sort: [] });
      assert.ok(denied.error);
    });

    let orderId = '';
    await suite.test('create and confirm order reserves stock', async () => {
      const created = await executeRpc(db, admin, 'create_order', { p_customer_name: 'Customer', p_items: [{ product_id: productId, quantity: 3 }], p_notes: null });
      assert.equal(created.error, null);
      orderId = String(created.data);
      assert.equal((await db.collection('orders').findOne({ _id: orderId }))?.total_amount, 36);
      const confirmed = await executeRpc(db, admin, 'confirm_order', { p_order_id: orderId });
      assert.equal(confirmed.error, null);
      assert.equal((await db.collection('products').findOne({ _id: productId }))?.reserved_quantity, 3);
    });

    await suite.test('allocation, dispatch and delivery preserve stock rules', async () => {
      const allocated = await executeRpc(db, admin, 'allocate_order', { p_order_id: orderId, p_assigned_order_booker_id: bookerId, p_delivery_person_name: 'Driver', p_delivery_person_phone: null });
      assert.equal(allocated.error, null);
      assert.equal((await executeRpc(db, admin, 'mark_order_on_the_way', { p_order_id: orderId })).error, null);
      assert.equal((await executeRpc(db, admin, 'deliver_order', { p_order_id: orderId })).error, null);
      const product = await db.collection('products').findOne({ _id: productId });
      assert.equal(product?.stock_quantity, 17);
      assert.equal(product?.reserved_quantity, 0);
    });

    await suite.test('payment history and stock adjustment', async () => {
      assert.equal((await executeRpc(db, admin, 'update_order_payment', { p_order_id: orderId, p_status: 'partial', p_amount_received: 10 })).error, null);
      assert.equal(await db.collection('payment_history').countDocuments({ order_id: orderId }), 1);
      assert.equal((await executeRpc(db, admin, 'adjust_stock', { p_product_id: productId, p_delta: 2, p_note: 'Test adjustment' })).error, null);
      assert.equal((await db.collection('products').findOne({ _id: productId }))?.stock_quantity, 19);
    });

    await suite.test('pending edit, cancellation, and deletion release reservations', async () => {
      const cancelled = await executeRpc(db, admin, 'create_order', { p_customer_name: 'Second customer', p_items: [{ product_id: productId, quantity: 2 }], p_notes: null });
      assert.equal(cancelled.error, null);
      const cancelledId = String(cancelled.data);
      assert.equal((await executeRpc(db, admin, 'update_order_details', { p_order_id: cancelledId, p_customer_name: 'Updated customer', p_notes: 'Edited before confirmation' })).error, null);
      assert.equal((await db.collection('orders').findOne({ _id: cancelledId }))?.customer_name, 'Updated customer');
      assert.equal((await executeRpc(db, admin, 'confirm_order', { p_order_id: cancelledId })).error, null);
      assert.equal((await executeRpc(db, admin, 'cancel_order', { p_order_id: cancelledId })).error, null);
      assert.equal((await db.collection('orders').findOne({ _id: cancelledId }))?.status, 'cancelled');
      assert.equal((await db.collection('products').findOne({ _id: productId }))?.reserved_quantity, 0);

      const deleted = await executeRpc(db, admin, 'create_order', { p_customer_name: 'Third customer', p_items: [{ product_id: productId, quantity: 1 }], p_notes: null });
      assert.equal(deleted.error, null);
      const deletedId = String(deleted.data);
      assert.equal((await executeRpc(db, admin, 'confirm_order', { p_order_id: deletedId })).error, null);
      assert.equal((await executeRpc(db, admin, 'delete_order', { p_order_id: deletedId })).error, null);
      assert.equal(await db.collection('orders').countDocuments({ _id: deletedId }), 0);
      assert.equal((await db.collection('products').findOne({ _id: productId }))?.reserved_quantity, 0);
    });

    await suite.test('invitation lifecycle and notification delivery', async () => {
      const invitation = await executeRpc(db, admin, 'create_invitation', { p_email: 'new@test.local', p_role: 'cashier' });
      assert.equal(invitation.error, null);
      const invitedId = randomUUID();
      const invitedContext: DbContext = { user: { id: invitedId, email: 'new@test.local', display_name: 'New staff' }, profile: null, business: null, owner: false };
      assert.equal((await executeRpc(db, invitedContext, 'accept_invitation', { p_key: invitation.data })).error, null);
      const notifications = await executeRpc(db, admin, 'send_notification', { p_target: 'cashier', p_title: 'Update', p_message: 'Hello' });
      assert.equal(notifications.error, null);
      assert.equal(await db.collection('notifications').countDocuments({ recipient_id: invitedId }), 1);
    });

    await suite.test('owner operations and scheduled reminder delivery', async () => {
      assert.equal((await executeRpc(db, owner, 'owner_list_businesses')).error, null);
      assert.equal((await executeRpc(db, owner, 'owner_schedule_message', { p_business_id: businessId, p_message: 'Reminder', p_scheduled_for: new Date(Date.now()-1000).toISOString(), p_repeat_monthly: false })).error, null);
      assert.equal(await processOwnerMessages(db), 1);
      assert.equal(await db.collection('notifications').countDocuments({ business_id: businessId, title: 'Rental payment reminder' }), 1);
      assert.equal((await executeRpc(db, owner, 'owner_set_business_suspension', { p_business_id: businessId, p_suspended: true })).error, null);
    });
  } finally {
    await client.db(dbName).dropDatabase();
    await client.close();
  }
});
