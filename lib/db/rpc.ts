import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import type { DbContext } from '@/lib/db/types';

const allowedRoles = ['admin','manager','order_booker','cashier'];
const managerRoles = ['admin','manager'];
function ensureStaff(context: DbContext, roles: string[]) {
  if (!context.user || !context.profile?.business_id || context.profile.active !== true) throw new Error('Your account is not active. Check your invitation.');
  if (!context.business) throw new Error('Business not found.');
  if (context.business.is_suspended) throw new Error('This business is suspended.');
  if (!allowedRoles.includes(String(context.profile.role)) || !roles.includes(String(context.profile.role))) throw new Error('You do not have permission to perform this action.');
}
function log(db: Db, context: DbContext, action: string, entity: string, entityId: string | null, details: Document = {}, session?: any) {
  if (!context.profile?.business_id || !context.user) return Promise.resolve();
  return db.collection('activity_logs').insertOne({
    _id: randomUUID(), business_id: context.profile.business_id, actor_id: context.user.id,
    action, entity, entity_id: entityId, details, created_at: new Date(),
  }, { session });
}
async function transaction<T>(db: Db, work: (session: any) => Promise<T>): Promise<T> {
  const client = db.client;
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
}
function collection(db: Db, name: string) { return db.collection(name); }
function round2(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function dateString(date: Date) { const y=String(date.getFullYear()).slice(-2),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0'); return y+m+d; }

export async function executeRpc(db: Db, context: DbContext, name: string, args: Record<string, any> = {}) {
  try {
    const bid = String(context.profile?.business_id || '');
    const userId = context.user?.id || '';
    const now = new Date();
    switch (name) {
      case 'accept_invitation': {
        if (!context.user) throw new Error('Sign in before accepting an invitation.');
        const key = String(args.p_key || '').trim().toLowerCase();
        const invite = await collection(db,'invitation_keys').findOne({ token_hash: createHash('sha256').update(key).digest('hex') });
        if (!invite) throw new Error('Invitation key is invalid.');
        if (invite.used_at) throw new Error('Invitation key has already been used.');
        if (new Date(invite.expires_at) < now) throw new Error('Invitation key has expired.');
        if (String(invite.email).toLowerCase() !== context.user.email.toLowerCase()) throw new Error('This invitation belongs to a different email address.');
        const business = await collection(db,'businesses').findOne({ _id: invite.business_id });
        if (!business || business.is_suspended) throw new Error('This business is suspended.');
        await transaction(db, async (session) => {
          const claimed = await collection(db,'invitation_keys').updateOne({ _id: invite._id, used_at: null, expires_at: { $gt: now } }, { $set: { used_at: now } }, { session });
          if (!claimed.matchedCount) throw new Error('Invitation key has already been used or has expired.');
          await collection(db,'profiles').updateOne({ _id: userId }, { $set: { user_id: userId, business_id: invite.business_id, display_name: context.user!.display_name, email: context.user!.email, role: invite.role, active: true }, $setOnInsert: { _id: userId, created_at: now } }, { upsert: true, session });
          await collection(db,'activity_logs').insertOne({ _id: randomUUID(), business_id: invite.business_id, actor_id: userId, action: 'Accepted staff invitation', entity: 'profile', details: { role: invite.role }, created_at: now }, { session });
        });
        return { data: true, error: null };
      }
      case 'create_invitation': {
        ensureStaff(context,['admin']);
        const email = String(args.p_email || '').trim().toLowerCase(), role = String(args.p_role || '');
        if (role === 'admin' || !['manager','order_booker','cashier'].includes(role)) throw new Error('Invalid staff role.');
        if (email.length < 5 || email.indexOf('@') < 2) throw new Error('Enter a valid staff email.');
        const token = randomBytes(24).toString('hex');
        await collection(db,'invitation_keys').insertOne({ _id: randomUUID(), business_id: bid, email, role, token_hash: createHash('sha256').update(token).digest('hex'), created_by: userId, expires_at: new Date(Date.now()+7*24*60*60*1000), used_at: null, created_at: now });
        await log(db,context,'Generated staff invitation','invitation',null,{email,role});
        return { data: token, error: null };
      }
      case 'create_order': {
        ensureStaff(context,['admin','manager','order_booker']);
        const customerName = String(args.p_customer_name || '').trim(), items = args.p_items;
        if (!customerName) throw new Error('Customer name is required.');
        if (!Array.isArray(items) || items.length === 0) throw new Error('Add at least one product.');
        return await transaction(db, async (session) => {
          let customer = await collection(db,'customers').findOne({ business_id: bid, full_name: { $regex: '^'+customerName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$', $options: 'i' } }, { session });
          if (!customer) {
            customer = { _id: randomUUID(), business_id: bid, full_name: customerName, phone: null, address: null, created_at: now };
            await collection(db,'customers').insertOne(customer,{session});
          }
          const orderId = randomUUID(), orderItems: Document[] = [];
          let sale = 0, cost = 0;
          for (const item of items) {
            const quantity = Number(item.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Product quantity must be greater than zero.');
            const product = await collection(db,'products').findOne({ _id: String(item.product_id), business_id: bid, active: true }, { session });
            if (!product) throw new Error('A selected product is unavailable.');
            const lineTotal = round2(quantity * Number(product.selling_price)), lineCost = round2(quantity * Number(product.cost_price));
            orderItems.push({ _id: randomUUID(), product_id: product._id, quantity, unit_price: product.selling_price, cost_price: product.cost_price, line_total: lineTotal, line_cost: lineCost, created_at: now });
            sale = round2(sale + lineTotal); cost = round2(cost + lineCost);
          }
          const orderNumber = 'SO-'+dateString(now)+'-'+randomBytes(3).toString('hex').toUpperCase();
          await collection(db,'orders').insertOne({ _id: orderId, business_id: bid, order_number: orderNumber, customer_id: customer._id, customer_name: customerName, status: 'pending', payment_status: 'unpaid', total_amount: sale, cost_total: cost, amount_received: 0, assigned_order_booker_id: null, delivery_person_name: null, delivery_person_phone: null, notes: String(args.p_notes || '').trim() || null, created_by: userId, created_at: now, updated_at: now, order_items: orderItems }, { session });
          await log(db,context,'Created order','order',orderId,{order_number:orderNumber,total:sale},session);
          return { data: orderId, error: null };
        });
      }
      case 'confirm_order': {
        ensureStaff(context,managerRoles);
        return await transaction(db,async(session)=>{
          const order=await collection(db,'orders').findOne({_id:String(args.p_order_id),business_id:bid},{session});
          if(!order||order.status!=='pending')throw new Error('Only pending orders can be confirmed.');
          for(const line of [...(order.order_items||[])].sort((a:Document,b:Document)=>String(a.product_id).localeCompare(String(b.product_id)))){
            const product=await collection(db,'products').findOne({_id:line.product_id,business_id:bid},{session});
            if(!product)throw new Error('A selected product is unavailable.');
            const available=Number(product.stock_quantity)-Number(product.reserved_quantity);
            if(available<Number(line.quantity))throw new Error(`Insufficient available stock for product: ${product.name} (available: ${available}, requested: ${line.quantity})`);
            await collection(db,'products').updateOne({_id:product._id,business_id:bid,stock_quantity:{$gte:Number(line.quantity)-0},reserved_quantity:product.reserved_quantity},{$inc:{reserved_quantity:Number(line.quantity)},$set:{updated_at:now}},{session});
            await collection(db,'inventory_movements').insertOne({_id:randomUUID(),business_id:bid,product_id:product._id,movement_type:'reserved',delta_on_hand:0,delta_reserved:line.quantity,note:'Inventory quantity changed',created_by:userId,created_at:now},{session});
          }
          await collection(db,'orders').updateOne({_id:order._id},{ $set:{status:'confirmed',updated_at:now}},{session});
          await log(db,context,'Confirmed order','order',order._id,{order_number:order.order_number},session);
          return {data:true,error:null};
        });
      }
      case 'allocate_order': {
        ensureStaff(context,managerRoles);
        const bookerId=String(args.p_assigned_order_booker_id||''), delivery=String(args.p_delivery_person_name||'').trim();
        const booker=await collection(db,'profiles').findOne({_id:bookerId,business_id:bid,role:'order_booker',active:true});
        if(!booker)throw new Error('Select an active order booker from this business.');
        if(!delivery)throw new Error('Delivery person name is required.');
        const result=await collection(db,'orders').updateOne({_id:String(args.p_order_id),business_id:bid,status:'confirmed'},{$set:{status:'allocated',assigned_order_booker_id:bookerId,delivery_person_name:delivery,delivery_person_phone:String(args.p_delivery_person_phone||'').trim()||null,updated_at:now}});
        if(!result.matchedCount)throw new Error('Only confirmed orders can be allocated.');
        await log(db,context,'Allocated order','order',String(args.p_order_id),{delivery_person:delivery});
        return {data:true,error:null};
      }
      case 'mark_order_on_the_way': {
        ensureStaff(context,managerRoles);
        const result=await collection(db,'orders').updateOne({_id:String(args.p_order_id),business_id:bid,status:'allocated'},{$set:{status:'on_the_way',updated_at:now}});
        if(!result.matchedCount)throw new Error('Allocate an order before marking it on the way.');
        await log(db,context,'Order is on the way','order',String(args.p_order_id));
        return {data:true,error:null};
      }
      case 'deliver_order': {
        ensureStaff(context,managerRoles);
        return await transaction(db,async(session)=>{
          const order=await collection(db,'orders').findOne({_id:String(args.p_order_id),business_id:bid},{session});
          if(!order||order.status!=='on_the_way')throw new Error('Only orders on the way can be delivered.');
          for(const line of order.order_items||[]){
            const result=await collection(db,'products').updateOne({_id:line.product_id,business_id:bid,stock_quantity:{$gte:Number(line.quantity)},reserved_quantity:{$gte:Number(line.quantity)}},{$inc:{stock_quantity:-Number(line.quantity),reserved_quantity:-Number(line.quantity)},$set:{updated_at:now}},{session});
            if(!result.matchedCount)throw new Error(`Stock reservation is inconsistent for product ${line.product_id}.`);
            await collection(db,'inventory_movements').insertOne({_id:randomUUID(),business_id:bid,product_id:line.product_id,movement_type:'delivered_or_adjusted',delta_on_hand:-line.quantity,delta_reserved:-line.quantity,note:'Inventory quantity changed',created_by:userId,created_at:now},{session});
          }
          await collection(db,'orders').updateOne({_id:order._id},{$set:{status:'delivered',updated_at:now}},{session});
          await log(db,context,'Delivered order','order',order._id,{order_number:order.order_number},session);
          return {data:true,error:null};
        });
      }
      case 'cancel_order':
      case 'delete_order': {
        ensureStaff(context,['admin']);
        return await transaction(db,async(session)=>{
          const order=await collection(db,'orders').findOne({_id:String(args.p_order_id),business_id:bid},{session});
          if(!order)throw new Error('Order not found.');
          if(name==='cancel_order'&&!['pending','confirmed','allocated','on_the_way'].includes(order.status))throw new Error('This order cannot be cancelled.');
          if(name==='delete_order'&&order.status==='delivered')throw new Error('Delivered orders are retained for accounting. Cancel or retain them instead of deleting.');
          if(['confirmed','allocated','on_the_way'].includes(order.status)){
            for(const line of order.order_items||[]){
              const result=await collection(db,'products').updateOne({_id:line.product_id,business_id:bid,reserved_quantity:{$gte:Number(line.quantity)}},{$inc:{reserved_quantity:-Number(line.quantity)},$set:{updated_at:now}},{session});
              if(!result.matchedCount)throw new Error(`Reservation is inconsistent for product ${line.product_id}.`);
              await collection(db,'inventory_movements').insertOne({_id:randomUUID(),business_id:bid,product_id:line.product_id,movement_type:'reservation_released',delta_on_hand:0,delta_reserved:-line.quantity,note:'Inventory quantity changed',created_by:userId,created_at:now},{session});
            }
          }
          if(name==='cancel_order')await collection(db,'orders').updateOne({_id:order._id},{$set:{status:'cancelled',updated_at:now}},{session});
          else { await log(db,context,'Deleted order','order',order._id,{order_number:order.order_number},session); await collection(db,'orders').deleteOne({_id:order._id},{session}); }
          if(name==='cancel_order')await log(db,context,'Cancelled order','order',order._id,{order_number:order.order_number},session);
          return {data:true,error:null};
        });
      }
      case 'update_order_details': {
        ensureStaff(context,managerRoles);
        const customer=String(args.p_customer_name||'').trim();
        if(!customer)throw new Error('Customer name is required.');
        const result=await collection(db,'orders').updateOne({_id:String(args.p_order_id),business_id:bid,status:'pending'},{$set:{customer_name:customer,notes:String(args.p_notes||'').trim()||null,updated_at:now}});
        if(!result.matchedCount)throw new Error('Only pending orders can be edited.');
        await log(db,context,'Updated order details','order',String(args.p_order_id),{customer_name:customer});
        return {data:true,error:null};
      }
      case 'update_order_payment': {
        ensureStaff(context,['admin','manager','cashier']);
        const status=String(args.p_status||''), amount=Number(args.p_amount_received);
        if(!['paid','unpaid','partial'].includes(status))throw new Error('Invalid payment status.');
        const order=await collection(db,'orders').findOne({_id:String(args.p_order_id),business_id:bid});
        if(!order||order.status==='cancelled')throw new Error('Order not found or cancelled.');
        if(!Number.isFinite(amount)||amount<0||amount>Number(order.total_amount))throw new Error('Received amount must be between zero and order total.');
        if(status==='paid'&&amount!==Number(order.total_amount))throw new Error('Paid status requires the full order amount.');
        if(status==='unpaid'&&amount!==0)throw new Error('Unpaid status requires zero received amount.');
        if(status==='partial'&&(amount<=0||amount>=Number(order.total_amount)))throw new Error('Partial status requires an amount between zero and total.');
        await transaction(db,async(session)=>{
          const changed = await collection(db,'orders').updateOne({_id:order._id,business_id:bid,payment_status:order.payment_status,amount_received:order.amount_received},{$set:{payment_status:status,amount_received:round2(amount),updated_at:now}},{session});
          if (!changed.matchedCount) throw new Error('Payment status changed during this update. Refresh and try again.');
          await collection(db,'payment_history').insertOne({_id:randomUUID(),business_id:bid,order_id:order._id,previous_status:order.payment_status,new_status:status,amount_received:round2(amount),changed_by:userId,created_at:now},{session});
          await log(db,context,'Updated order payment','order',order._id,{payment_status:status,received:amount},session);
        });
        return {data:true,error:null};
      }
      case 'adjust_stock': {
        ensureStaff(context,managerRoles);
        const delta=round2(Number(args.p_delta));
        if(!Number.isFinite(delta)||delta===0)throw new Error('Enter a non-zero stock adjustment.');
        const product=await collection(db,'products').findOne({_id:String(args.p_product_id),business_id:bid});
        if(!product)throw new Error('Product not found.');
        if(Number(product.stock_quantity)+delta<Number(product.reserved_quantity))throw new Error('Stock cannot be reduced below the reserved quantity.');
        await transaction(db,async(session)=>{
          const result=await collection(db,'products').updateOne({_id:product._id,business_id:bid,stock_quantity:product.stock_quantity,reserved_quantity:product.reserved_quantity},{$inc:{stock_quantity:delta},$set:{updated_at:now}},{session});
          if(!result.matchedCount)throw new Error('Stock changed during this adjustment. Refresh and try again.');
          await collection(db,'inventory_movements').insertOne({_id:randomUUID(),business_id:bid,product_id:product._id,movement_type:'stock_adjustment',delta_on_hand:delta,delta_reserved:0,note:String(args.p_note||'Manual stock adjustment'),created_by:userId,created_at:now},{session});
          await log(db,context,'Adjusted stock','product',product._id,{delta,note:args.p_note||null},session);
        });
        return {data:true,error:null};
      }
      case 'send_notification': {
        ensureStaff(context,['admin']);
        const target=String(args.p_target||''), message=String(args.p_message||'').trim();
        if(!['everyone','manager','order_booker','cashier'].includes(target))throw new Error('Invalid notification audience.');
        if(!message)throw new Error('Notification message is required.');
        const recipients=await collection(db,'profiles').find({business_id:bid,active:true,_id:{$ne:userId},...(target==='everyone'?{}:{role:target})}).toArray();
        if(recipients.length)await collection(db,'notifications').insertMany(recipients.map((profile)=>({_id:randomUUID(),business_id:bid,recipient_id:profile._id,title:String(args.p_title||'').trim()||'Business update',message,read_at:null,created_at:now})));
        await log(db,context,'Sent notification','notification',null,{audience:target,recipient_count:recipients.length});
        return {data:recipients.length,error:null};
      }
      case 'owner_list_businesses': {
        if(!context.user||!context.owner)throw new Error('Owner access required.');
        const rows=await collection(db,'businesses').find({}).sort({created_at:-1}).toArray();
        return {data:rows.map((b)=>({id:String(b._id),name:b.name,is_suspended:Boolean(b.is_suspended)})),error:null};
      }
      case 'owner_set_business_suspension': {
        if(!context.user||!context.owner)throw new Error('Owner access required.');
        const result=await collection(db,'businesses').updateOne({_id:String(args.p_business_id)},{$set:{is_suspended:Boolean(args.p_suspended)}});
        if(!result.matchedCount)throw new Error('Business not found.');
        return {data:true,error:null};
      }
      case 'owner_schedule_message': {
        if(!context.user||!context.owner)throw new Error('Owner access required.');
        const message=String(args.p_message||'').trim(), date=new Date(String(args.p_scheduled_for||''));
        if(!message)throw new Error('Message is required.');
        if(Number.isNaN(date.getTime()))throw new Error('A valid reminder date is required.');
        if(!await collection(db,'businesses').findOne({_id:String(args.p_business_id)}))throw new Error('Business not found.');
        const id=randomUUID();
        await collection(db,'owner_messages').insertOne({_id:id,business_id:String(args.p_business_id),message,scheduled_for:date,repeat_monthly:Boolean(args.p_repeat_monthly),sent_at:null,created_by:userId,created_at:now});
        return {data:id,error:null};
      }
      default: throw new Error('Unknown database operation: '+name);
    }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Database operation failed.' } };
  }
}

export async function processOwnerMessages(db: Db) {
  const now=new Date();
  const due=await collection(db,'owner_messages').find({scheduled_for:{$lte:now},sent_at:null}).toArray();
  let delivered=0;
  for(const item of due){
    await transaction(db,async(session)=>{
      const admins=await collection(db,'profiles').find({business_id:item.business_id,role:'admin',active:true},{session}).toArray();
      if(admins.length)await collection(db,'notifications').insertMany(admins.map((admin)=>({_id:randomUUID(),business_id:item.business_id,recipient_id:admin._id,title:'Rental payment reminder',message:item.message,read_at:null,created_at:now})),{session});
      if(item.repeat_monthly){
        const current=new Date(item.scheduled_for), day=current.getDate();
        current.setDate(1); current.setMonth(current.getMonth()+1);
        const lastDay=new Date(current.getFullYear(),current.getMonth()+1,0).getDate();
        current.setDate(Math.min(day,lastDay));
        await collection(db,'owner_messages').updateOne({_id:item._id,sent_at:null},{$set:{scheduled_for:current}},{session});
      }
      else await collection(db,'owner_messages').updateOne({_id:item._id,sent_at:null},{$set:{sent_at:now}},{session});
    });
    delivered++;
  }
  return delivered;
}
