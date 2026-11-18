# StockOS database architecture

## Request and data flow

```text
Unchanged Next.js pages and client components
        |
        | existing .from(...) / .rpc(...) call shape
        v
lib/db/client.ts ----------------------> /api/db/query and /api/db/rpc
        |                                           |
        | lib/db/server.ts                          |
        | (server pages/actions)                    |
        +----------------------+--------------------+
                               |
                               v
                   lib/db/queries.ts / rpc.ts
                               |
                    session + profile + role
                               |
                               v
                         lib/mongodb.ts
                               |
                               v
                            MongoDB
```

The UI keeps its current data call signatures and the Supabase-style `{ data, error }` result shape. In the browser, the adapter sends same-origin authenticated requests to Next.js route handlers. In server components and server actions, the server adapter invokes the same query/RPC handlers directly without an HTTP round trip.

MongoDB is never imported into client components. The URI is only read in server modules. Authentication and data mutations execute in Node.js route handlers/server actions.

## Modules

| Module | Responsibility |
| --- | --- |
| `lib/mongodb.ts` | Reuses a MongoDB driver connection pool across Next.js requests. |
| `lib/session.ts` | Issues and validates HMAC-signed, HTTP-only session cookies. |
| `lib/db/client.ts` | Browser compatibility adapter for queries, RPC calls, sign-in, registration, sign-out, and password change. |
| `lib/db/server.ts` | Server-side compatibility adapter used by pages, auth guards, and server actions. |
| `lib/db/query-builder.ts` | Small chainable query builder that records select/filter/sort/limit/mutation requests. |
| `lib/db/queries.ts` | MongoDB query execution, relation expansion, tenant scoping, role permissions, and basic CRUD. |
| `lib/db/rpc.ts` | Named business operations and transactional stock/order/payment workflows. |
| `lib/db/schema.ts` | Collection names and index setup helper. |
| `app/api/auth/*` | Local account authentication and session endpoints. |
| `app/api/db/*` | Authenticated query and RPC endpoints. |
| `app/api/cron/owner-messages` | Scheduled rental-message dispatch endpoint. |

## Data model

All business-owned documents have a `business_id` string. Original PostgreSQL UUIDs are preserved as string MongoDB `_id` fields during import. This keeps route IDs and references stable.

- `users` stores identity and password hashes.
- `profiles` links one user to one active business and role.
- `businesses` and `owner_accounts` form the platform control plane.
- `products`, `categories`, and `customers` are tenant-scoped operational collections.
- `orders` embeds its line items. Each embedded line stores product ID and price/cost snapshots.
- `inventory_movements`, `payment_history`, `activity_logs`, and `notifications` are separate append/history collections.
- `invitation_keys` stores only token hashes; the plaintext key is returned once to the admin.
- `owner_messages` stores platform reminder schedules.

The server expands the same relation fields used by the old UI: order-to-customer, order-to-line-to-product, and payment-to-order. This is a targeted lookup performed only when the corresponding nested relation is requested.

## Authorization boundary

The browser can submit filters but cannot choose its own business scope. The authenticated session identifies the user; `profiles` determines business and role; `businesses.is_suspended` gates business operations. Query handlers add the tenant and role predicates on the server and reject writes not allowed for that role.

Supabase RLS policies are no longer present. MongoDB does not provide equivalent row policies, so server-side query scoping is the authorization boundary. The MongoDB URI must remain server-only, and the application database user should be least-privileged and restricted to this database.

## Atomic workflows

The following workflows use MongoDB transactions because they update more than one document:

- Order creation plus customer/order/audit writes
- Order confirmation plus product reservation and movement records
- Delivery plus on-hand/reserved quantity changes and audit records
- Cancellation/deletion plus reservation release and audit records
- Payment status plus payment-history and activity records
- Invitation acceptance plus profile activation and invitation consumption
- Stock adjustment plus movement and activity records
- Scheduled notification delivery

Use a replica-set MongoDB deployment (MongoDB Atlas satisfies this requirement). A standalone MongoDB server cannot run these multi-document transactions.

## Authentication

Passwords are stored as bcrypt hashes. Existing Supabase `auth.users.encrypted_password` hashes are imported as-is; new MongoDB accounts are hashed with bcryptjs. The server signs a seven-day HMAC session token and stores it in an HTTP-only, SameSite=Lax cookie. The browser cannot read the session token through JavaScript.

Email verification and password recovery are not implemented because the original repository did not contain an email provider or recovery flow. This is the documented behavior difference in `MIGRATION.md`.

## Realtime and scheduled work

There were no Supabase Realtime channel subscriptions in the inspected application. The existing screens use server fetches and explicit refresh actions. No realtime substitute is needed for those existing paths.

Scheduled owner messages are processed by `POST /api/cron/owner-messages`, protected by `CRON_SECRET`. An external scheduler should invoke it once per minute to replace the old optional pg_cron schedule.
