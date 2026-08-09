# HERO Move Production Backend

HERO Move production mode uses Supabase PostgreSQL, Supabase Authentication, Row Level Security and the `hero-move-api` Edge Function.

## Source of truth

- Schema migration: `supabase/migrations/20260808000000_hero_move_production_foundation.sql`
- Secured API: `supabase/functions/hero-move-api/index.ts`
- Browser integration: `app.js`
- Production mode: default on `hero-move.pages.dev`
- Demo mode: explicit `?demo=1`; data remains isolated from production

Core customers, bookings, vehicles, drivers, payments, invoices and HERO Credits are never stored in browser localStorage. Browser storage is limited to authentication session material, language preference, explicit demo state and short-lived checkout continuity; PostgreSQL remains authoritative.

## Security model

- Every commercial record carries `operator_id`.
- RLS is enabled on every exposed production table.
- Tenant membership is stored in `operator_users`.
- Customer, corporate, driver, operator, administrator and future partner roles are separated.
- Browser clients receive only a publishable/legacy anon key.
- The service-role key stays inside the Edge Function runtime.
- Privileged writes are validated server-side and written to `audit_logs`.
- Vehicle and driver double-booking is blocked by PostgreSQL exclusion constraints in addition to API availability checks.

## Business functions

The Edge API provides:

- authoritative price calculation
- real vehicle/driver/maintenance availability checks
- guest or member booking creation
- individual and corporate membership creation
- welcome, Ride & Earn and Refer & Earn ledger entries
- resource assignment with conflict checks
- controlled trip-status transitions
- HERO Credits redemption
- owner service/pricing settings
- owner HERO Credits settings
- provider-neutral connected-payment settings
- ESG estimate generation at eligible trip completion
- tenant-scoped portal bootstrap data

## Payment status

The provider-neutral adapter supports PromptPay QR, cards, wallets, international methods, payment links, deposit, balance, full payment, failures, refunds, receipts and tax invoices. Live processing remains disabled until an approved provider and server-side credentials are configured by the operator.

## ESG status

ESG records use an operator-configured methodology and are clearly labeled as estimates. HERO Move does not claim certified carbon credits.

## Legacy reference

`legacy/Code.gs` is retained only as historical reference. It is not used by production mode and must not be deployed as the HERO Move production database.
