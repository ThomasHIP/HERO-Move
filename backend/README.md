# HERO Move Backend — Ready for Notebook Connection

The frontend is currently functional with browser storage. This folder prepares the Google Apps Script + Google Sheets backend so the production connection can be completed without redesigning the data model.

## One-time setup

1. Create a Google Sheet named `HERO Move Backend`.
2. Open **Extensions → Apps Script**.
3. Replace the default script with `backend/Code.gs` from this repository.
4. Run `setupHeroMoveBackend()` once and authorize it.
5. In Apps Script **Project Settings → Script Properties**, add `HERO_MOVE_API_KEY` with a strong secret.
6. Deploy as **Web app**. Execute as the owner. Restrict access as appropriate for the production architecture.
7. Put the deployed endpoint and API key into protected Cloudflare environment variables / server-side integration. Do **not** expose the API key in public JavaScript.

## Sheets created automatically

- Members
- Customers
- Bookings
- Vehicles
- Drivers
- Maintenance
- Payments
- Invoices
- HeroCredits
- Partners
- AuditLog

## Frontend-to-backend mapping

- `membership.html` → Members, Customers, HeroCredits
- `booking.html` → Bookings
- `payment.html` → Payments (after HERO PAY connection)
- `fleet.html` → Vehicles, Maintenance
- `drivers.html` / `driver-portal.html` → Drivers, Bookings
- `customers.html` → Customers
- `dispatch.html` → Bookings, Vehicles, Drivers, HeroCredits, ESG fields
- `invoices.html` → Invoices + saved Customer tax profile
- `partner-portal.html` → Partners
- `esg.html` → completed Bookings + Vehicles

## Payment scope

HERO Move v1 exposes only:

- HERO PAY PromptPay QR
- Credit / Debit Card

Corporate Account / credit terms are intentionally excluded from the payment scope.

## ESG scope

The current frontend calculates an **estimated** operational CO2 avoided value and tree equivalent per completed EV trip. These figures are not certified carbon credits. Production ESG factors should be configured from verified sources before external formal reporting.

## Production requirements still needing credentials

- Google Apps Script deployment URL / production database endpoint
- HERO PAY merchant/API credentials
- Authentication provider / role configuration
- Email and LINE OA credentials
- Optional Google Maps API
- Cloudflare environment variables
