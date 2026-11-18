# Supabase to MongoDB migration

## Summary

The runtime data layer has moved from Supabase Auth/PostgreSQL to MongoDB. The UI, component structure, styling, route structure, form markup, navigation, and business-facing labels have been retained. Existing Supabase-shaped client calls are kept behind a local compatibility API so current components continue to receive `{ data, error }` results and existing RPC names/arguments.

The official MongoDB Node.js driver is used instead of Mongoose. This project has no ORM/model layer today; explicit collection operations make the migration easier to review and preserve the existing lightweight architecture.

## What changed

- Replaced Supabase SSR/browser SDK clients with the MongoDB server adapter under `lib/db`.
- Added MongoDB connection pooling in `lib/mongodb.ts`.
- Added signed HTTP-only sessions, password hashing, and local auth endpoints.
- Replaced direct client-side Supabase calls with same-origin API requests.
- Reimplemented the Supabase RPC operations in `lib/db/rpc.ts`.
- Added server-side tenant and role filters in `lib/db/queries.ts`.
- Replaced SQL schema/index setup with MongoDB collections and indexes.
- Replaced pg_cron reminder dispatch with a protected scheduler endpoint.
- Added a PostgreSQL export and MongoDB import utility for existing Supabase data.
- Removed Supabase runtime dependencies and the old SQL schema/scheduler files.

## MongoDB collections

| Collection | Purpose |
| --- | --- |
| `users` | Login identity, email, display name, and bcrypt password hash. |
| `businesses` | Business name, suspension state, and creation time. |
| `profiles` | Business membership, user role, active state, and display data. |
| `owner_accounts` | Separate platform-owner identities. |
| `invitation_keys` | Hashed, single-use invitation tokens, email, role, expiry, and use time. |
| `categories` | Tenant-scoped product categories. |
| `products` | Tenant-scoped stock, price, category, and active state. |
| `customers` | Tenant-scoped customer contact data. |
| `orders` | Order header plus embedded `order_items` array. |
| `inventory_movements` | Opening, reserved, released, delivery, and manual stock movement history. |
| `expenses` | Tenant expense entries. |
| `payment_history` | Append-only payment status changes associated with orders. |
| `notifications` | Per-recipient notifications. |
| `activity_logs` | Tenant activity audit records. |
| `owner_messages` | Platform-owner scheduled rental reminders. |

All tenant-owned documents carry `business_id`. UUID values from PostgreSQL are retained as string `_id` values where practical so existing foreign keys, URLs, and UI IDs do not need to be reformatted.

### Order document shape

```js
{
  _id: "existing-order-uuid",
  business_id: "business-uuid",
  order_number: "SO-YYMMDD-ABC123",
  customer_id: "customer-uuid",
  customer_name: "Customer",
  status: "pending",
  payment_status: "unpaid",
  total_amount: 0,
  cost_total: 0,
  amount_received: 0,
  created_by: "profile-user-uuid",
  order_items: [
    {
      _id: "order-line-uuid",
      product_id: "product-uuid",
      quantity: 1,
      unit_price: 0,
      cost_price: 0,
      line_total: 0,
      line_cost: 0
    }
  ]
}
```

The line item snapshots preserve the original sale price and cost at order creation. Current product name/SKU/unit data is resolved when the invoice or order screen requests the same nested relation fields as before. Customer details remain in the `customers` collection and are resolved into the existing `customers` response object.

## Operations migrated

The following RPC names and parameter shapes are handled by the MongoDB server layer:

- `accept_invitation(p_key)`
- `create_invitation(p_email, p_role)`
- `create_order(p_customer_name, p_items, p_notes)`
- `confirm_order(p_order_id)`
- `allocate_order(p_order_id, p_assigned_order_booker_id, p_delivery_person_name, p_delivery_person_phone)`
- `mark_order_on_the_way(p_order_id)`
- `deliver_order(p_order_id)`
- `cancel_order(p_order_id)`
- `delete_order(p_order_id)`
- `update_order_details(p_order_id, p_customer_name, p_notes)`
- `update_order_payment(p_order_id, p_status, p_amount_received)`
- `adjust_stock(p_product_id, p_delta, p_note)`
- `send_notification(p_target, p_title, p_message)`
- `owner_list_businesses()`
- `owner_set_business_suspension(p_business_id, p_suspended)`
- `owner_schedule_message(p_business_id, p_message, p_scheduled_for, p_repeat_monthly)`

Order creation, confirmation, delivery, cancellation/deletion, and payment-history writes use MongoDB transactions. These preserve the multi-document stock and audit-log effects that PostgreSQL previously performed inside stored procedures.

## Access control and RLS replacement

MongoDB does not offer a direct equivalent to PostgreSQL RLS. Its replacement is enforced server-side:

1. The browser stores only a signed, HTTP-only session cookie; it does not connect to MongoDB.
2. Server handlers resolve the current session user, profile, business, role, and suspension status.
3. Each query applies its tenant predicate from the authenticated profile rather than trusting a client-supplied `business_id`.
4. Role-specific predicates mirror the existing policies: order bookers see only created/assigned orders; cashiers do not see pending orders; notifications are recipient-scoped; expenses and activity are restricted to their existing roles.
5. Sensitive mutations are implemented as named server operations with explicit role checks.

Use a MongoDB database user restricted to the application's database. Do not expose the connection URI or administrative database credentials in browser code.

## Realtime behavior

The repository did not contain Supabase Realtime channel/subscription calls. Screens load their data through server page queries and explicit user actions, so no polling or change-stream layer was required to preserve the existing UI behavior. MongoDB change streams can be added later only if a screen introduces a true live push requirement.

## Supabase data export/import

The migration tools use the PostgreSQL `pg` driver only for the one-time export. The application runtime does not use Supabase packages.

1. Set `SUPABASE_DB_URL` to the direct PostgreSQL connection string and `MONGODB_URI` / `MONGODB_DB_NAME` to the destination.
2. Export all StockOS public tables plus the Auth user IDs and encrypted password hashes:

   ```bash
   npm run db:export-supabase -- --out=./supabase-export.json
   ```

3. Import into an empty destination database:

   ```bash
   npm run db:import-supabase -- --input=./supabase-export.json
   ```

4. If deliberately replacing already imported StockOS data, back up the target and add `--replace`.
5. Run `npm run db:setup` to create unique and query indexes.

The exporter requires direct PostgreSQL access to the Supabase database. The JSON contains private user data and password hashes; secure it as a credential-bearing backup and delete it after validation. The importer maps PostgreSQL `order_items` rows into embedded order arrays and imports `auth.users.encrypted_password` as `users.password_hash`. Supabase's stored password hashes are bcrypt-compatible; test representative accounts before switching production traffic.

### First admin on a clean MongoDB database

For a new installation without Supabase data, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `BUSINESS_NAME` in `.env.local` and run `npm run db:setup`. The script creates one business, user, and active admin profile. Remove those seed variables afterwards.

## Behavioral differences and mitigations

| Area | Difference | Mitigation / impact |
| --- | --- | --- |
| Email verification | The old signup flow could wait for Supabase Auth email confirmation. The MongoDB version creates a local account and session immediately because no SMTP/email provider or verification service was present in the repository. | Invitation acceptance still requires an exact email match and a valid single-use invitation, but it does not prove mailbox ownership. Configure a verified-email workflow before enabling public registration in production. |
| Password reset / recovery | Supabase Auth supplied managed recovery features; the repository did not include a password-reset screen. The MongoDB layer currently supports authenticated password change only. | Existing UI flow is unchanged; add a trusted email delivery and reset-token workflow before offering self-service recovery. |
| RLS | PostgreSQL RLS policies no longer execute in the database. | Server-only MongoDB access, tenant predicates, and role checks enforce the equivalent application rules. MongoDB credentials must never be shared with clients. |
| Transactions | PostgreSQL transactions worked on the Supabase database. | MongoDB multi-document transactions require a replica set or sharded cluster. Atlas is the recommended deployment. |
| Realtime | No Realtime subscription was present in the source. | Existing fetch/refresh behavior remains; no new subscription feature is introduced. |
| Scheduled reminders | Supabase pg_cron is removed. | An external scheduler calls `POST /api/cron/owner-messages` with the `CRON_SECRET` bearer token. |
| Numeric/date representation | PostgreSQL numeric/date types are converted into JavaScript numbers, ISO timestamps, and `YYYY-MM-DD` expense dates. | The UI already formats numeric values and timestamps. Check reports against the source database after importing. |

## Verification

Set `MONGODB_TEST_URI` to a disposable MongoDB replica-set database and run `npm test`. The integration suite covers query scoping and the principal order, stock, payment, invitation, notification, and owner operations. It is skipped without the test URI, so a skipped run is not a substitute for testing against your configured MongoDB instance.

After import, compare collection counts with the Supabase export and manually verify: one admin login, an order with multiple lines, reserve/dispatch/delivery stock movements, cancellation of a reserved order, payment history, and invoice rendering.
