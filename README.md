# Stock Management OS

A multi-tenant stock, order, and rental-distribution management application built with the Next.js App Router and MongoDB.

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
- MongoDB with the official MongoDB Node.js driver
- Signed HTTP-only session cookies and bcrypt password hashes

The application uses the official MongoDB Node.js driver instead of Mongoose. The existing project has a small, explicit data layer and no ORM; the driver keeps collection operations and transactions direct, avoids adding model abstractions, and supports the current server-side repository design.

## Setup

### 1. Requirements

- Node.js 20.9 or newer
- npm
- MongoDB Atlas, or a self-hosted MongoDB replica set

The stock/order workflows use MongoDB multi-document transactions. Use MongoDB Atlas or a MongoDB deployment configured as a replica set; a standalone local `mongod` does not support these transactions.

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Private MongoDB connection string |
| `MONGODB_DB_NAME` | Database name (defaults to `stock_management_os`) |
| `SESSION_SECRET` | At least 32 characters used to sign sessions |
| `ADMIN_WORKSPACE_KEY` | Random admin workspace path |
| `MANAGER_WORKSPACE_KEY` | Random manager workspace path |
| `CASHIER_WORKSPACE_KEY` | Random cashier workspace path |
| `OWNER_ROUTE_SECRET` | Separate private owner route key |
| `CRON_SECRET` | Protects the optional owner-reminder scheduler endpoint |

Generate independent secrets with:

```bash
openssl rand -hex 32
```

Never expose `MONGODB_URI`, `SESSION_SECRET`, or the cron secret through a `NEXT_PUBLIC_*` variable or client-side code.

### 3. Create collections and indexes

```bash
npm install
npm run db:setup
```

The setup command creates the application collections and indexes. To create the first business and admin account at the same time, temporarily add these variables to `.env.local` before running the setup command:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-strong-password
BUSINESS_NAME=Your Business Name
```

All three values must be set together. The script creates one business, a bcrypt-hashed user account, and an active admin profile. Remove these three seed variables after the first run. Do not run this seed again against an existing admin email.

For an existing Supabase installation, import the Supabase data first (see [Supabase data migration](#supabase-data-migration)) and then run `npm run db:setup` to ensure indexes exist.

### 4. Install and run

```bash
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
- `/owner/<OWNER_ROUTE_SECRET>` — private platform-owner console

The role-specific workspace key is not an authorization mechanism by itself. Server-side session verification, active profile checks, business suspension checks, role checks, and tenant filters are enforced for protected data operations.

## Supabase data migration

The repository includes a one-time PostgreSQL export and MongoDB import path. The running application does not connect to Supabase; `pg` is a development dependency used only by the export utility.

1. Back up the Supabase project. Make sure the direct PostgreSQL database connection is enabled and accessible from the machine running the export.
2. Add the direct Supabase database connection string to `.env.local` as `SUPABASE_DB_URL`. It is used only by the export script.
3. Export the public StockOS tables and Supabase Auth user hashes:

   ```bash
   npm run db:export-supabase -- --out=./supabase-export.json
   ```

4. Set `MONGODB_URI` and `MONGODB_DB_NAME` to the destination MongoDB database, then import:

   ```bash
   npm run db:import-supabase -- --input=./supabase-export.json
   ```

5. The importer expects an empty StockOS database. To replace existing StockOS collections, back them up first and explicitly use `--replace`:

   ```bash
   npm run db:import-supabase -- --input=./supabase-export.json --replace
   ```

6. Create indexes and verify counts:

   ```bash
   npm run db:setup
   ```

The export contains user email addresses and password hashes. Keep it private, do not commit it, and securely delete it when the migration is verified. The importer preserves Supabase UUIDs as string document IDs and carries bcrypt-compatible Supabase password hashes into the MongoDB `users` collection.

The SQL `order_items` rows are converted into embedded `orders.order_items` arrays. Customer records remain in their own collection so the UI's `customers` relationship can still be resolved. Existing order lines retain product IDs and historical price/cost snapshots.

## Database and security model

Every business-owned document stores a `business_id`. The server derives the active user, profile, role, and business from a signed HTTP-only session and applies tenant/role filters in the MongoDB query layer. The browser never receives a MongoDB connection string or a direct database client.

MongoDB does not provide PostgreSQL Row Level Security policies. The application therefore enforces equivalent access rules in server-side query and RPC handlers. Keep the MongoDB database user private to the application and never expose an unrestricted database credential to the browser.

Orders embed their line items so order reads and state transitions can operate on a single order aggregate. Related customer and product display fields are resolved server-side to preserve the existing `customers`, `order_items`, and `products` result shapes expected by the screens.

## Scheduled rental reminders

Supabase pg_cron has been replaced by a protected Next.js endpoint. Configure an external scheduler to send a POST request to:

`/api/cron/owner-messages`

with header:

`Authorization: Bearer <CRON_SECRET>`

Run it once per minute to match the old scheduler cadence. The endpoint delivers due reminders to active business admins and advances monthly reminders.

## Tests

Set `MONGODB_TEST_URI` in your shell or CI environment to a disposable MongoDB replica-set connection string, then run:

```bash
npm test
```

The integration suite covers tenant-scoped queries, product updates, invitation acceptance, order creation, stock reservation, allocation, dispatch, delivery, payment history, stock adjustment, notifications, and owner operations. Tests are skipped when `MONGODB_TEST_URI` is not configured. Do not point the test URI at production data.

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
2. Configure a replica-set MongoDB URI, database name, session secret, workspace keys, owner route key, and cron secret.
3. Keep the MongoDB connection string and all session secrets server-only.
4. Configure the external scheduler for owner reminders if that feature is used.
5. Rotate any workspace or owner path key if it is exposed. Tenant and role checks must remain enabled even when paths are changed.

See [MIGRATION.md](./MIGRATION.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the data model and compatibility details.
