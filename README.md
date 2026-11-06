# Stock Management OS

A multi-tenant stock, order, and rental-distribution management application built with the Next.js App Router and Supabase.

## Main modules

- **Inventory:** Products, categories, stock on hand, reserved quantities, available stock, low-stock warnings, price updates, stock adjustments, and inventory movement history.
- **Orders / POS:** Multi-product pending orders, customer names, order notes, order detail edits before confirmation, and printable invoices.
- **Order allocation:** Managers assign confirmed orders to an order booker and delivery person, then move the order through allocation, dispatch, and delivery.
- **Payments:** Paid, unpaid, and partial status are tracked separately from order status. Payment history is stored. No payment gateway or payment method is included.
- **Reports:** Delivered sales, daily collections, monthly summaries, estimated profit, expenses, and stock valuation.
- **Activity log:** Tracks product, category, inventory, order, invitation, expense, and notification actions.
- **Notifications:** Admins can send messages to managers, order bookers, cashiers, or all staff.
- **Staff invitations:** Single-use invitation keys are tied to an email address and expire after seven days.

## Roles

| Role | Main permissions |
| --- | --- |
| Admin | Full business access, staff invitations, products/categories, stock, orders, payments, expenses, reports, notifications, and activity history. |
| Manager | Inventory and stock operations, order creation/editing, allocation and delivery progress, and sales/inventory reports. Cannot cancel or delete orders or invite staff. |
| Order booker | Live product availability, multi-product order creation, own and assigned order history. Cannot update stock, cancel orders, or change payments. |
| Cashier | Confirmed/in-progress order details, invoices, receipts, payment-status updates, payment history, and sales/collection reports. Cannot update inventory or prices. |

## Order and stock rules

1. Creating an order makes it **pending**. No stock is reserved at this point.
2. An admin or manager confirms it. Confirmation checks available stock and increases the reserved quantity.
3. A manager or admin allocates the order to an order booker and delivery person.
4. The order moves from **allocated** to **on the way** and then **delivered**.
5. Delivery reduces on-hand stock and releases the reservation.
6. Admin cancellation releases a reservation when one exists. It does not change payment status.
7. Payment status changes never change the order status.
8. Delivered orders are retained for accounting and inventory history. Admins can delete undelivered orders; delivered orders cannot be deleted.

Available stock is calculated as:

`available stock = stock on hand - reserved quantity`

## Technology

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS 4
- Supabase Auth and PostgreSQL
- Supabase Row Level Security (RLS)
- Supabase SSR cookies and request proxy for session refresh

No ORM, state manager, payment SDK, or complex UI framework is used.

## Setup

### 1. Requirements

- Node.js 20.9 or newer
- npm
- A Supabase project

### 2. Create the database

Open your Supabase project, go to **SQL Editor**, and run the complete file:

`supabase/schema.sql`

This creates the tenant tables, indexes, RPC functions, triggers, and RLS policies.

### 3. Create the first business admin

The first admin is provisioned by the project administrator. This avoids public self-registration as a business administrator.

1. In Supabase **Authentication → Users**, create the first admin user with the intended email address and password.
2. Copy that Auth user's UUID.
3. Run the SQL below in the Supabase SQL Editor after replacing the three values.

```sql
do $$
declare
  new_business_id uuid;
  admin_auth_user_id uuid := 'REPLACE_WITH_AUTH_USER_UUID';
begin
  insert into public.businesses (name)
  values ('Your Business Name')
  returning id into new_business_id;

  insert into public.profiles (
    user_id, business_id, display_name, email, role, active
  )
  values (
    admin_auth_user_id,
    new_business_id,
    'Business Admin',
    'admin@example.com',
    'admin',
    true
  );
end $$;
```

Use the exact email address belonging to the Auth user. Do not create a business employee by inserting an arbitrary user ID that does not exist in `auth.users`.

### 4. Configure environment variables

Copy `.env.example` to `.env.local` and set your Supabase URL, public anon/publishable key, and independent random workspace keys.

Generate a different value for each workspace key. For example:

```bash
openssl rand -hex 32
```

Required values:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key |
| `ADMIN_WORKSPACE_KEY` | Random admin workspace path |
| `MANAGER_WORKSPACE_KEY` | Random manager workspace path |
| `CASHIER_WORKSPACE_KEY` | Random cashier workspace path |

Never put a Supabase service-role key in a `NEXT_PUBLIC_*` variable or in client-side code. The starter application uses the public key with RLS; the service-role key is not needed by the browser.

### 5. Configure Supabase Auth

Set the local site URL to `http://localhost:3000` in Supabase Auth settings. Add the deployed application URL to the allowed redirect URLs when deploying.

Staff members use the invitation key generated by the business admin. The invited email must match the email used for registration/sign-in. Invitation keys are single-use and expire after seven days. When email verification is enabled, the verification link returns the staff member to the sign-in flow with the invitation key.

### 6. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run lint
npm run build
npm start
```

## Application routes

- `/login` — staff sign-in
- `/register` — invited staff registration
- `/dashboard` — sends the signed-in user to the correct role workspace
- `/workspace/<configured-key>` — protected admin, manager, or cashier workspace
- `/booker` — protected order-booker workspace

The role-specific workspace key is not an authorization mechanism by itself. The server verifies the signed-in Supabase user, active profile, business status, and role on every protected page. Database RLS is the final tenant boundary.

## Database security model

Every business-owned row has a `business_id`. Tenant policies compare it with the authenticated user's active profile business ID. Business staff cannot choose another tenant's ID to read or write its rows.

The platform-level `businesses` directory and `owner_accounts` are control-plane records rather than rows owned by one tenant. The platform owner uses separate Auth identity records; owner functions return only the business name and rental access state for the business list.

Sensitive order transitions are performed through PostgreSQL functions so stock reservation, delivery reduction, cancellation, and payment-history writes happen in a transaction. Direct table policies do not allow staff to bypass those transitions.

## Reports and exports

The report screen provides:

- Daily sales and collections
- Monthly sales, collections, and expenses
- Delivered sales, item cost snapshots, expenses, and estimated profit
- Available stock units and stock value at recorded cost

**Excel:** the export is CSV, which opens in Excel and other spreadsheet applications.  
**PDF:** use **Print / Save PDF** and choose Save as PDF in the browser print dialog.  
**Print:** the same print view is formatted to omit the app navigation.

The displayed profit is an estimate based on delivered order cost snapshots and recorded expenses. It is not an audited accounting ledger.

## Deployment notes

1. Deploy the Next.js project to a Node.js-compatible host.
2. Add all required environment variables to the deployment environment.
3. Add the production URL to Supabase Auth's allowed redirect URLs.
4. Keep the Supabase database migrations/schema and Auth configuration in sync across environments.
5. Rotate any workspace path key if it is exposed. RLS and role checks must remain enabled even when paths are changed.

