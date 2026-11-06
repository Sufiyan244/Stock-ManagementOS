-- Stock Management OS: tenant-isolated PostgreSQL schema.
-- Run this file in the Supabase SQL Editor for a new project.

create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('admin','manager','order_booker','cashier'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_state as enum ('pending','confirmed','allocated','on_the_way','delivered','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_state as enum ('paid','unpaid','partial'); exception when duplicate_object then null; end $$;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  display_name text not null default '',
  email text not null,
  role public.app_role,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Platform owner identities are kept separate from business employee profiles.
create table if not exists public.owner_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.invitation_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role public.app_role not null check (role <> 'admin'),
  token_hash text not null unique,
  created_by uuid not null references public.profiles(user_id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  sku text,
  description text,
  unit text not null default 'piece',
  stock_quantity numeric(14,2) not null default 0 check (stock_quantity >= 0),
  reserved_quantity numeric(14,2) not null default 0 check (reserved_quantity >= 0),
  low_stock_level numeric(14,2) not null default 5 check (low_stock_level >= 0),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  check (reserved_quantity <= stock_quantity)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  status public.order_state not null default 'pending',
  payment_status public.payment_state not null default 'unpaid',
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  cost_total numeric(14,2) not null default 0 check (cost_total >= 0),
  amount_received numeric(14,2) not null default 0 check (amount_received >= 0),
  assigned_order_booker_id uuid references public.profiles(user_id),
  delivery_person_name text,
  delivery_person_phone text,
  notes text,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number),
  check (amount_received <= total_amount)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  cost_price numeric(14,2) not null check (cost_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  line_cost numeric(14,2) not null check (line_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null,
  delta_on_hand numeric(14,2) not null default 0,
  delta_reserved numeric(14,2) not null default 0,
  note text,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  notes text,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  previous_status public.payment_state,
  new_status public.payment_state not null,
  amount_received numeric(14,2) not null,
  changed_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid references public.profiles(user_id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Rental messages are written only by platform-owner RPCs; business admins see them
-- after their scheduled time through the notifications created by the scheduler.
create table if not exists public.owner_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  message text not null,
  scheduled_for timestamptz not null,
  repeat_monthly boolean not null default false,
  sent_at timestamptz,
  created_by uuid not null references public.owner_accounts(user_id),
  created_at timestamptz not null default now()
);

create index if not exists profiles_business_role_idx on public.profiles(business_id, role);
create index if not exists products_business_name_idx on public.products(business_id, name);
create index if not exists orders_business_created_idx on public.orders(business_id, created_at desc);
create index if not exists orders_business_status_idx on public.orders(business_id, status);
create index if not exists order_items_order_idx on public.order_items(business_id, order_id);
create index if not exists inventory_business_product_idx on public.inventory_movements(business_id, product_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications(recipient_id, created_at desc);
create index if not exists owner_messages_schedule_idx on public.owner_messages(scheduled_for) where sent_at is null;

create or replace function public.current_business_id()
returns uuid language sql stable security definer set search_path = public
as $$ select p.business_id from public.profiles p where p.user_id = auth.uid() and p.active = true limit 1 $$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select p.role from public.profiles p where p.user_id = auth.uid() and p.active = true limit 1 $$;

create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.owner_accounts a where a.user_id = auth.uid()) $$;

create or replace function public.business_is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.businesses b where b.id = public.current_business_id() and b.is_suspended = false) $$;

create or replace function public.log_activity(p_action text, p_entity text, p_entity_id uuid default null, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.current_business_id() is null or auth.uid() is null then return; end if;
  insert into public.activity_logs(business_id, actor_id, action, entity, entity_id, details)
  values (public.current_business_id(), auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

create or replace function public.record_product_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  hand_delta numeric(14,2) := 0;
  reserve_delta numeric(14,2) := 0;
begin
  if tg_op = 'INSERT' then
    hand_delta := new.stock_quantity;
    reserve_delta := new.reserved_quantity;
    insert into public.inventory_movements(business_id, product_id, movement_type, delta_on_hand, delta_reserved, note, created_by)
    values(new.business_id, new.id, 'opening', hand_delta, reserve_delta, 'Opening product quantity', auth.uid());
    perform public.log_activity('Created product', 'product', new.id, jsonb_build_object('name', new.name));
    return new;
  end if;

  hand_delta := new.stock_quantity - old.stock_quantity;
  reserve_delta := new.reserved_quantity - old.reserved_quantity;
  if hand_delta <> 0 or reserve_delta <> 0 then
    insert into public.inventory_movements(business_id, product_id, movement_type, delta_on_hand, delta_reserved, note, created_by)
    values(new.business_id, new.id,
      case when reserve_delta > 0 then 'reserved' when reserve_delta < 0 and hand_delta = 0 then 'reservation_released'
           when hand_delta < 0 then 'delivered_or_adjusted' else 'stock_adjustment' end,
      hand_delta, reserve_delta, 'Inventory quantity changed', auth.uid());
  end if;
  if new.name is distinct from old.name or new.selling_price is distinct from old.selling_price or new.cost_price is distinct from old.cost_price then
    perform public.log_activity('Updated product', 'product', new.id, jsonb_build_object('name', new.name));
  end if;
  return new;
end;
$$;

drop trigger if exists products_touch_updated on public.products;
create trigger products_touch_updated before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch_updated on public.orders;
create trigger orders_touch_updated before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists products_audit_change on public.products;
create trigger products_audit_change after insert or update on public.products for each row execute function public.record_product_change();

-- A staff member can only activate an invitation addressed to their verified auth email.
create or replace function public.accept_invitation(p_key text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  invite public.invitation_keys%rowtype;
  auth_email text;
  auth_name text;
begin
  if auth.uid() is null then raise exception 'Sign in before accepting an invitation.'; end if;
  auth_email := lower(coalesce(auth.jwt()->>'email', ''));
  auth_name := coalesce(auth.jwt()->'user_metadata'->>'display_name', '');
  select * into invite from public.invitation_keys
  where token_hash = encode(digest(lower(trim(p_key)), 'sha256'), 'hex')
  for update;
  if not found then raise exception 'Invitation key is invalid.'; end if;
  if invite.used_at is not null then raise exception 'Invitation key has already been used.'; end if;
  if invite.expires_at < now() then raise exception 'Invitation key has expired.'; end if;
  if lower(invite.email) <> auth_email then raise exception 'This invitation belongs to a different email address.'; end if;
  if exists(select 1 from public.businesses b where b.id=invite.business_id and b.is_suspended) then raise exception 'This business is suspended.'; end if;

  insert into public.profiles(user_id, business_id, display_name, email, role, active)
  values(auth.uid(), invite.business_id, auth_name, auth_email, invite.role, true)
  on conflict(user_id) do update set business_id=excluded.business_id, display_name=excluded.display_name,
    email=excluded.email, role=excluded.role, active=true;
  update public.invitation_keys set used_at=now() where id=invite.id;
  insert into public.activity_logs(business_id, actor_id, action, entity, details)
  values(invite.business_id, auth.uid(), 'Accepted staff invitation', 'profile', jsonb_build_object('role',invite.role));
  return true;
end;
$$;

create or replace function public.create_invitation(p_email text, p_role text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  token text;
  role_value public.app_role;
  bid uuid := public.current_business_id();
begin
  if public.current_app_role() <> 'admin' or not public.business_is_active() then raise exception 'Only an active business admin can create invitations.'; end if;
  if p_role not in ('manager','order_booker','cashier') then raise exception 'Invalid staff role.'; end if;
  if length(trim(p_email)) < 5 or position('@' in p_email) < 2 then raise exception 'Enter a valid staff email.'; end if;
  role_value := p_role::public.app_role;
  token := encode(gen_random_bytes(24), 'hex');
  insert into public.invitation_keys(business_id,email,role,token_hash,created_by)
  values(bid,lower(trim(p_email)),role_value,encode(digest(token,'sha256'),'hex'),auth.uid());
  perform public.log_activity('Generated staff invitation','invitation',null,jsonb_build_object('email',lower(trim(p_email)),'role',p_role));
  return token;
end;
$$;

create or replace function public.create_order(p_customer_name text, p_items jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  bid uuid := public.current_business_id();
  order_id uuid;
  customer_id uuid;
  item jsonb;
  product_row public.products%rowtype;
  quantity_value numeric(14,2);
  sale_total numeric(14,2) := 0;
  cost_total_value numeric(14,2) := 0;
  order_no text;
  customer_label text := trim(coalesce(p_customer_name,''));
begin
  if auth.uid() is null or public.current_app_role() not in ('admin','manager','order_booker') or not public.business_is_active() then raise exception 'You cannot create orders.'; end if;
  if customer_label = '' then raise exception 'Customer name is required.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one product.'; end if;

  select c.id into customer_id from public.customers c
  where c.business_id=bid and lower(c.full_name)=lower(customer_label) limit 1;
  if customer_id is null then
    insert into public.customers(business_id,full_name) values(bid,customer_label) returning id into customer_id;
  end if;

  order_no := 'SO-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.orders(business_id,order_number,customer_id,customer_name,created_by,notes)
  values(bid,order_no,customer_id,customer_label,auth.uid(),nullif(trim(p_notes),''))
  returning id into order_id;

  for item in select * from jsonb_array_elements(p_items) loop
    quantity_value := (item->>'quantity')::numeric;
    if quantity_value <= 0 then raise exception 'Product quantity must be greater than zero.'; end if;
    select * into product_row from public.products
    where id=(item->>'product_id')::uuid and business_id=bid and active=true;
    if not found then raise exception 'A selected product is unavailable.'; end if;
    insert into public.order_items(business_id,order_id,product_id,quantity,unit_price,cost_price,line_total,line_cost)
    values(bid,order_id,product_row.id,quantity_value,product_row.selling_price,product_row.cost_price,
      quantity_value*product_row.selling_price,quantity_value*product_row.cost_price);
    sale_total := sale_total + quantity_value*product_row.selling_price;
    cost_total_value := cost_total_value + quantity_value*product_row.cost_price;
  end loop;

  update public.orders set total_amount=sale_total,cost_total=cost_total_value where id=order_id;
  perform public.log_activity('Created order','order',order_id,jsonb_build_object('order_number',order_no,'total',sale_total));
  return order_id;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  o public.orders%rowtype;
  line record;
  p public.products%rowtype;
  available numeric(14,2);
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then raise exception 'Only admin or manager can confirm orders.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status <> 'pending' then raise exception 'Only pending orders can be confirmed.'; end if;

  for line in select * from public.order_items where order_id=o.id and business_id=o.business_id order by product_id loop
    select * into p from public.products where id=line.product_id and business_id=o.business_id for update;
    available := p.stock_quantity - p.reserved_quantity;
    if available < line.quantity then raise exception 'Insufficient available stock for product: % (available: %, requested: %)',p.name,available,line.quantity; end if;
    update public.products set reserved_quantity=reserved_quantity+line.quantity where id=p.id;
  end loop;

  update public.orders set status='confirmed' where id=o.id;
  perform public.log_activity('Confirmed order','order',o.id,jsonb_build_object('order_number',o.order_number));
  return true;
end;
$$;

create or replace function public.allocate_order(p_order_id uuid,p_assigned_order_booker_id uuid,p_delivery_person_name text,p_delivery_person_phone text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype;
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then raise exception 'Only admin or manager can allocate orders.'; end if;
  if not exists(select 1 from public.profiles where user_id=p_assigned_order_booker_id and business_id=public.current_business_id() and role='order_booker' and active=true) then raise exception 'Select an active order booker from this business.'; end if;
  if trim(coalesce(p_delivery_person_name,''))='' then raise exception 'Delivery person name is required.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status<>'confirmed' then raise exception 'Only confirmed orders can be allocated.'; end if;
  update public.orders set status='allocated',assigned_order_booker_id=p_assigned_order_booker_id,
    delivery_person_name=trim(p_delivery_person_name),delivery_person_phone=nullif(trim(p_delivery_person_phone),'') where id=o.id;
  perform public.log_activity('Allocated order','order',o.id,jsonb_build_object('delivery_person',p_delivery_person_name));
  return true;
end;
$$;

create or replace function public.mark_order_on_the_way(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype;
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then raise exception 'Only admin or manager can update delivery status.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status<>'allocated' then raise exception 'Allocate an order before marking it on the way.'; end if;
  update public.orders set status='on_the_way' where id=o.id;
  perform public.log_activity('Order is on the way','order',o.id);
  return true;
end;
$$;

create or replace function public.deliver_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; line record;
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then raise exception 'Only admin or manager can complete delivery.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status<>'on_the_way' then raise exception 'Only orders on the way can be delivered.'; end if;
  for line in select * from public.order_items where order_id=o.id and business_id=o.business_id order by product_id loop
    update public.products set stock_quantity=stock_quantity-line.quantity,reserved_quantity=reserved_quantity-line.quantity
    where id=line.product_id and business_id=o.business_id and stock_quantity>=line.quantity and reserved_quantity>=line.quantity;
    if not found then raise exception 'Stock reservation is inconsistent for product %.',line.product_id; end if;
  end loop;
  update public.orders set status='delivered' where id=o.id;
  perform public.log_activity('Delivered order','order',o.id,jsonb_build_object('order_number',o.order_number));
  return true;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; line record;
begin
  if public.current_app_role() <> 'admin' or not public.business_is_active() then raise exception 'Only an active admin can cancel orders.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status not in ('pending','confirmed','allocated','on_the_way') then raise exception 'This order cannot be cancelled.'; end if;
  if o.status in ('confirmed','allocated','on_the_way') then
    for line in select * from public.order_items where order_id=o.id and business_id=o.business_id order by product_id loop
      update public.products set reserved_quantity=reserved_quantity-line.quantity
      where id=line.product_id and business_id=o.business_id and reserved_quantity>=line.quantity;
      if not found then raise exception 'Reservation is inconsistent for product %.',line.product_id; end if;
    end loop;
  end if;
  update public.orders set status='cancelled' where id=o.id;
  perform public.log_activity('Cancelled order','order',o.id,jsonb_build_object('order_number',o.order_number));
  return true;
end;
$$;

create or replace function public.update_order_payment(p_order_id uuid,p_status text,p_amount_received numeric)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; new_status public.payment_state;
begin
  if public.current_app_role() not in ('admin','manager','cashier') or not public.business_is_active() then raise exception 'You cannot update payment status.'; end if;
  if p_status not in ('paid','unpaid','partial') then raise exception 'Invalid payment status.'; end if;
  new_status := p_status::public.payment_state;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status='cancelled' then raise exception 'Order not found or cancelled.'; end if;
  if p_amount_received<0 or p_amount_received>o.total_amount then raise exception 'Received amount must be between zero and order total.'; end if;
  if new_status='paid' and p_amount_received<>o.total_amount then raise exception 'Paid status requires the full order amount.'; end if;
  if new_status='unpaid' and p_amount_received<>0 then raise exception 'Unpaid status requires zero received amount.'; end if;
  if new_status='partial' and (p_amount_received<=0 or p_amount_received>=o.total_amount) then raise exception 'Partial status requires an amount between zero and total.'; end if;
  update public.orders set payment_status=new_status,amount_received=p_amount_received where id=o.id;
  insert into public.payment_history(business_id,order_id,previous_status,new_status,amount_received,changed_by)
  values(o.business_id,o.id,o.payment_status,new_status,p_amount_received,auth.uid());
  perform public.log_activity('Updated order payment','order',o.id,jsonb_build_object('payment_status',new_status,'received',p_amount_received));
  return true;
end;
$$;

create or replace function public.adjust_stock(p_product_id uuid,p_delta numeric,p_note text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare p public.products%rowtype;
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then raise exception 'Only admin or manager can adjust stock.'; end if;
  if p_delta=0 then raise exception 'Enter a non-zero stock adjustment.'; end if;
  select * into p from public.products where id=p_product_id and business_id=public.current_business_id() for update;
  if not found then raise exception 'Product not found.'; end if;
  if p.stock_quantity+p_delta<p.reserved_quantity then raise exception 'Stock cannot be reduced below the reserved quantity.'; end if;
  update public.products set stock_quantity=stock_quantity+p_delta where id=p.id;
  perform public.log_activity('Adjusted stock','product',p.id,jsonb_build_object('delta',p_delta,'note',p_note));
  return true;
end;
$$;

create or replace function public.send_notification(p_target text,p_title text,p_message text)
returns integer language plpgsql security definer set search_path = public
as $$
declare bid uuid:=public.current_business_id(); inserted integer;
begin
  if public.current_app_role()<>'admin' or not public.business_is_active() then raise exception 'Only the business admin can send notifications.'; end if;
  if p_target not in ('everyone','manager','order_booker','cashier') then raise exception 'Invalid notification audience.'; end if;
  if length(trim(coalesce(p_message,'')))=0 then raise exception 'Notification message is required.'; end if;
  insert into public.notifications(business_id,recipient_id,title,message)
  select bid,p.user_id,coalesce(nullif(trim(p_title),''),'Business update'),trim(p_message)
  from public.profiles p
  where p.business_id=bid and p.active=true and p.user_id<>auth.uid()
    and (p_target='everyone' or p.role::text=p_target);
  get diagnostics inserted = row_count;
  perform public.log_activity('Sent notification','notification',null,jsonb_build_object('audience',p_target,'recipient_count',inserted));
  return inserted;
end;
$$;

create or replace function public.owner_list_businesses()
returns table(id uuid,name text,is_suspended boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_owner() then raise exception 'Owner access required.'; end if;
  return query select b.id,b.name,b.is_suspended from public.businesses b order by b.created_at desc;
end;
$$;

create or replace function public.owner_set_business_suspension(p_business_id uuid,p_suspended boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_platform_owner() then raise exception 'Owner access required.'; end if;
  update public.businesses set is_suspended=p_suspended where id=p_business_id;
  if not found then raise exception 'Business not found.'; end if;
  return true;
end;
$$;

create or replace function public.owner_schedule_message(p_business_id uuid,p_message text,p_scheduled_for timestamptz,p_repeat_monthly boolean default false)
returns uuid language plpgsql security definer set search_path = public
as $$
declare message_id uuid;
begin
  if not public.is_platform_owner() then raise exception 'Owner access required.'; end if;
  if not exists(select 1 from public.businesses where id=p_business_id) then raise exception 'Business not found.'; end if;
  if length(trim(coalesce(p_message,'')))=0 then raise exception 'Message is required.'; end if;
  insert into public.owner_messages(business_id,message,scheduled_for,repeat_monthly,created_by)
  values(p_business_id,trim(p_message),p_scheduled_for,p_repeat_monthly,auth.uid()) returning id into message_id;
  return message_id;
end;
$$;

-- Execute this function every minute with Supabase pg_cron, if available.
-- Repeating reminders move forward by one calendar month after each delivery.
create or replace function public.process_owner_messages()
returns integer language plpgsql security definer set search_path = public
as $$
declare item record; delivered integer:=0;
begin
  for item in select * from public.owner_messages where scheduled_for<=now() and sent_at is null for update skip locked loop
    insert into public.notifications(business_id,recipient_id,title,message)
    select item.business_id,p.user_id,'Rental payment reminder',item.message
    from public.profiles p where p.business_id=item.business_id and p.role='admin' and p.active=true;
    if item.repeat_monthly then
      update public.owner_messages set scheduled_for=item.scheduled_for+interval '1 month',sent_at=null where id=item.id;
    else
      update public.owner_messages set sent_at=now() where id=item.id;
    end if;
    delivered:=delivered+1;
  end loop;
  return delivered;
end;
$$;

-- Row Level Security: every tenant-owned table checks the signed-in business ID.
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.owner_accounts enable row level security;
alter table public.invitation_keys enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.payment_history enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.owner_messages enable row level security;

drop policy if exists business_read_own on public.businesses;
create policy business_read_own on public.businesses for select to authenticated using(id=public.current_business_id() and public.business_is_active() or id=public.current_business_id());

drop policy if exists profile_read_scoped on public.profiles;
create policy profile_read_scoped on public.profiles for select to authenticated
using(user_id=auth.uid() or (business_id=public.current_business_id() and public.current_app_role() in ('admin','manager')));

drop policy if exists owner_account_read_self on public.owner_accounts;
create policy owner_account_read_self on public.owner_accounts for select to authenticated using(user_id=auth.uid());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using(business_id=public.current_business_id());
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active());
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active()) with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager'));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated using(business_id=public.current_business_id() and public.current_app_role()='admin' and public.business_is_active());

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using(business_id=public.current_business_id() and public.business_is_active());
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active());
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active()) with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager'));
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete to authenticated using(business_id=public.current_business_id() and public.current_app_role()='admin' and public.business_is_active());

drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','order_booker','cashier') and public.business_is_active());
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','order_booker') and public.business_is_active());
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active()) with check(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager'));

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','order_booker','cashier') and public.business_is_active());
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','order_booker','cashier') and public.business_is_active());

drop policy if exists inventory_read on public.inventory_movements;
create policy inventory_read on public.inventory_movements for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','cashier') and public.business_is_active());

drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active());
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated with check(business_id=public.current_business_id() and public.current_app_role()='admin' and created_by=auth.uid() and public.business_is_active());

drop policy if exists payments_read on public.payment_history;
create policy payments_read on public.payment_history for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager','cashier') and public.business_is_active());

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated using(business_id=public.current_business_id() and recipient_id=auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated using(business_id=public.current_business_id() and recipient_id=auth.uid()) with check(business_id=public.current_business_id() and recipient_id=auth.uid());

drop policy if exists activity_read on public.activity_logs;
create policy activity_read on public.activity_logs for select to authenticated using(business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active());

drop policy if exists owner_messages_admin_read on public.owner_messages;
create policy owner_messages_admin_read on public.owner_messages for select to authenticated using(business_id=public.current_business_id() and public.current_app_role()='admin' and scheduled_for<=now());

-- Do not grant direct access to invitation tokens or platform owner messages.
revoke all on public.invitation_keys from anon, authenticated;
revoke all on public.owner_messages from anon, authenticated;
revoke all on public.owner_accounts from anon, authenticated;
grant select on public.owner_accounts to authenticated;

grant select on public.businesses, public.profiles, public.categories, public.products, public.customers,
  public.orders, public.order_items, public.inventory_movements, public.expenses, public.payment_history,
  public.notifications, public.activity_logs to authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.products to authenticated;
grant insert, update on public.customers to authenticated;
grant insert on public.expenses to authenticated;
grant update on public.notifications to authenticated;

revoke all on function public.accept_invitation(text) from public;
revoke all on function public.create_invitation(text,text) from public;
revoke all on function public.create_order(text,jsonb,text) from public;
revoke all on function public.confirm_order(uuid) from public;
revoke all on function public.allocate_order(uuid,uuid,text,text) from public;
revoke all on function public.mark_order_on_the_way(uuid) from public;
revoke all on function public.deliver_order(uuid) from public;
revoke all on function public.cancel_order(uuid) from public;
revoke all on function public.update_order_payment(uuid,text,numeric) from public;
revoke all on function public.adjust_stock(uuid,numeric,text) from public;
revoke all on function public.send_notification(text,text,text) from public;
revoke all on function public.owner_list_businesses() from public;
revoke all on function public.owner_set_business_suspension(uuid,boolean) from public;
revoke all on function public.owner_schedule_message(uuid,text,timestamptz,boolean) from public;
revoke all on function public.process_owner_messages() from public;

grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.create_invitation(text,text) to authenticated;
grant execute on function public.create_order(text,jsonb,text) to authenticated;
grant execute on function public.confirm_order(uuid) to authenticated;
grant execute on function public.allocate_order(uuid,uuid,text,text) to authenticated;
grant execute on function public.mark_order_on_the_way(uuid) to authenticated;
grant execute on function public.deliver_order(uuid) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.update_order_payment(uuid,text,numeric) to authenticated;
grant execute on function public.adjust_stock(uuid,numeric,text) to authenticated;
grant execute on function public.send_notification(text,text,text) to authenticated;
grant execute on function public.owner_list_businesses() to authenticated;
grant execute on function public.owner_set_business_suspension(uuid,boolean) to authenticated;
grant execute on function public.owner_schedule_message(uuid,text,timestamptz,boolean) to authenticated;
grant execute on function public.process_owner_messages() to service_role;

-- The platform owner creates a separate Auth identity, then adds its UUID to
-- owner_accounts. Never add owner rows to profiles or give owner a staff role.


-- Fine-grained staff visibility and admin-only order deletion.
drop policy if exists profile_read_scoped on public.profiles;
create policy profile_read_scoped on public.profiles for select to authenticated
using (
  user_id=auth.uid()
  or (business_id=public.current_business_id() and public.current_app_role() in ('admin','manager') and public.business_is_active())
);

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated
using(business_id=public.current_business_id() and public.business_is_active());

drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
using (
  business_id=public.current_business_id() and public.business_is_active()
  and (
    public.current_app_role() in ('admin','manager','cashier')
    or (public.current_app_role()='order_booker' and exists (
      select 1 from public.orders o where o.business_id=customers.business_id
      and o.customer_id=customers.id
      and (o.created_by=auth.uid() or o.assigned_order_booker_id=auth.uid())
    ))
  )
);

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
using (
  business_id=public.current_business_id() and public.business_is_active()
  and (
    public.current_app_role() in ('admin','manager')
    or (public.current_app_role()='cashier' and status<>'pending')
    or (public.current_app_role()='order_booker' and (created_by=auth.uid() or assigned_order_booker_id=auth.uid()))
  )
);

drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to authenticated
using (
  business_id=public.current_business_id() and public.business_is_active()
  and exists (
    select 1 from public.orders o where o.id=order_items.order_id and o.business_id=order_items.business_id
    and (
      public.current_app_role() in ('admin','manager','cashier')
      or (public.current_app_role()='order_booker' and (o.created_by=auth.uid() or o.assigned_order_booker_id=auth.uid()))
    )
  )
);

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
using(business_id=public.current_business_id() and recipient_id=auth.uid() and public.business_is_active());
drop policy if exists notifications_update_own on public.notifications;

revoke update on public.notifications from authenticated;

create or replace function public.delete_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; line record;
begin
  if public.current_app_role() <> 'admin' or not public.business_is_active() then
    raise exception 'Only an active business admin can delete orders.';
  end if;
  select * into o from public.orders
  where id=p_order_id and business_id=public.current_business_id()
  for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.status='delivered' then
    raise exception 'Delivered orders are retained for accounting. Cancel or retain them instead of deleting.';
  end if;
  if o.status in ('confirmed','allocated','on_the_way') then
    for line in select * from public.order_items where order_id=o.id and business_id=o.business_id order by product_id loop
      update public.products set reserved_quantity=reserved_quantity-line.quantity
      where id=line.product_id and business_id=o.business_id and reserved_quantity>=line.quantity;
      if not found then raise exception 'Reservation is inconsistent for product %.',line.product_id; end if;
    end loop;
  end if;
  perform public.log_activity('Deleted order','order',o.id,jsonb_build_object('order_number',o.order_number));
  delete from public.orders where id=o.id;
  return true;
end;
$$;
revoke all on function public.delete_order(uuid) from public;
grant execute on function public.delete_order(uuid) to authenticated;


-- Pending-order detail editing is allowed to admins and managers only.
create or replace function public.update_order_details(p_order_id uuid,p_customer_name text,p_notes text default null)
returns boolean language plpgsql security definer set search_path = public
as $$
declare o public.orders%rowtype; customer_label text := trim(coalesce(p_customer_name,''));
begin
  if public.current_app_role() not in ('admin','manager') or not public.business_is_active() then
    raise exception 'Only an active admin or manager can edit order details.';
  end if;
  if customer_label='' then raise exception 'Customer name is required.'; end if;
  select * into o from public.orders where id=p_order_id and business_id=public.current_business_id() for update;
  if not found or o.status<>'pending' then raise exception 'Only pending orders can be edited.'; end if;
  update public.orders set customer_name=customer_label,notes=nullif(trim(p_notes),'') where id=o.id;
  perform public.log_activity('Updated order details','order',o.id,jsonb_build_object('customer_name',customer_label));
  return true;
end;
$$;
revoke all on function public.update_order_details(uuid,text,text) from public;
grant execute on function public.update_order_details(uuid,text,text) to authenticated;

-- Keep product categories inside the same tenant.
create or replace function public.check_product_category_business()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id=new.category_id and c.business_id=new.business_id
  ) then
    raise exception 'Product category must belong to the same business.';
  end if;
  return new;
end;
$$;
drop trigger if exists product_category_business_check on public.products;
create trigger product_category_business_check before insert or update of category_id,business_id
on public.products for each row execute function public.check_product_category_business();

create or replace function public.record_category_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op='INSERT' then
    insert into public.activity_logs(business_id,actor_id,action,entity,entity_id,details)
    values(new.business_id,auth.uid(),'Created category','category',new.id,jsonb_build_object('name',new.name));
    return new;
  end if;
  if tg_op='UPDATE' then
    insert into public.activity_logs(business_id,actor_id,action,entity,entity_id,details)
    values(new.business_id,auth.uid(),'Updated category','category',new.id,jsonb_build_object('name',new.name));
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists categories_activity on public.categories;
create trigger categories_activity after insert or update on public.categories
for each row execute function public.record_category_activity();

create or replace function public.record_expense_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.activity_logs(business_id,actor_id,action,entity,entity_id,details)
  values(new.business_id,auth.uid(),'Recorded expense','expense',new.id,jsonb_build_object('title',new.title,'amount',new.amount));
  return new;
end;
$$;
drop trigger if exists expenses_activity on public.expenses;
create trigger expenses_activity after insert on public.expenses
for each row execute function public.record_expense_activity();
