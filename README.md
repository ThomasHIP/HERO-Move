# HERO Move

HERO Move is a production-oriented multi-tenant Smart Mobility Platform for advance chauffeur booking, fleet and driver operations, corporate mobility, HERO Credits, connected payments and estimated EV / ESG reporting.

## Architecture

- Frontend: static HTML/CSS/JavaScript on Cloudflare Pages
- Database/Auth/API: Supabase PostgreSQL, Auth, RLS and Edge Functions
- Production data mode: database-backed by default
- Demo data mode: explicit `?demo=1`, isolated from production

## Production setup

1. Apply `supabase/migrations/20260808000000_hero_move_production_foundation.sql` to the connected Supabase project.
2. Deploy `supabase/functions/hero-move-api/index.ts` as `hero-move-api` with JWT verification enabled.
3. Configure `HERO_MOVE_ALLOWED_ORIGINS` for any approved custom or preview domains.
4. Provision the first owner by linking an authenticated `users` record to the seeded `hero-move` operator in `operator_users` with role `owner`.
5. Configure actual vehicles, drivers, service prices and approved payment provider credentials through protected owner/operator workflows.
6. Push to `main`; the connected Cloudflare Pages project deploys the static site.

Do not expose a Supabase secret/service-role key in the frontend. The key in `app.js` is the project’s publishable legacy anon key and is protected by RLS and the Edge API authorization layer.

## Key production pages

- `/` — booking-first landing page
- `/booking.html` — fare, availability and booking
- `/payment.html` — provider-neutral secure-payment experience
- `/customer-portal.html` — individual customer portal
- `/corporate-portal.html` — corporate customer portal
- `/driver-portal.html` — assigned-driver workspace
- `/admin.html` — protected operator dashboard
- `/settings.html` — owner-only payments and HERO Credits economics
- `/presentation.html` — 15-section executive presentation

See `backend/README.md` for the security and business-function map.
