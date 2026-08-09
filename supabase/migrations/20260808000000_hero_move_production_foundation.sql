-- HERO Move production foundation
-- Multi-tenant PostgreSQL schema, tenant RLS, immutable rewards ledger,
-- availability constraints, operational settings, payments and ESG records.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  legal_name text,
  logo_url text,
  primary_color text not null default '#071a36',
  accent_color text not null default '#ff8618',
  reward_color text not null default '#0f8a70',
  default_language text not null default 'en' check (default_language in ('en','th','zh')),
  timezone text not null default 'Asia/Bangkok',
  currency text not null default 'THB',
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  mobile text,
  preferred_language text not null default 'en' check (preferred_language in ('en','th','zh')),
  status text not null default 'active' check (status in ('active','invited','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operator_users (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','operator','dispatcher','finance','customer','corporate_user','driver','partner_owner')),
  status text not null default 'active' check (status in ('active','invited','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,user_id,role)
);

create table if not exists public.operator_invitations (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','admin','operator','dispatcher','finance','driver','partner_owner')),
  status text not null default 'pending' check (status in ('pending','claimed','revoked','expired')),
  invited_by uuid references public.users(id) on delete set null,
  claimed_by uuid references public.users(id) on delete set null,
  expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists operator_invitations_email_role_idx on public.operator_invitations(operator_id,lower(email),role) where status='pending';

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  member_number text not null,
  referral_code text not null,
  membership_type text not null check (membership_type in ('individual','corporate')),
  display_name text not null,
  email text,
  mobile text,
  status text not null default 'active' check (status in ('active','pending','suspended','inactive')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,member_number),
  unique(operator_id,referral_code),
  unique(operator_id,user_id)
);

create table if not exists public.individual_profiles (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  first_name text,
  last_name text,
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_mobile text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.corporate_accounts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  account_code text not null,
  legal_company_name text not null,
  trading_name text,
  tax_id text,
  branch_type text not null default 'head_office' check (branch_type in ('head_office','branch')),
  branch_number text not null default '00000',
  billing_address jsonb not null default '{}'::jsonb,
  billing_email text,
  contact_person text,
  contact_mobile text,
  payment_terms text not null default 'deposit_and_balance',
  status text not null default 'active' check (status in ('active','pending','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,account_code)
);

create table if not exists public.corporate_users (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  corporate_account_id uuid not null references public.corporate_accounts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  role text not null default 'booker' check (role in ('admin','booker','traveller','finance','viewer')),
  status text not null default 'active' check (status in ('active','invited','suspended','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(corporate_account_id,user_id)
);

create table if not exists public.travellers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  corporate_account_id uuid references public.corporate_accounts(id) on delete cascade,
  full_name text not null,
  email text,
  mobile text,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_id is not null or corporate_account_id is not null)
);

create table if not exists public.saved_locations (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  corporate_account_id uuid references public.corporate_accounts(id) on delete cascade,
  label text not null,
  address text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  pickup_notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_id is not null or corporate_account_id is not null)
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  referrer_member_id uuid not null references public.members(id) on delete cascade,
  referred_member_id uuid references public.members(id) on delete set null,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending','qualified','rewarded','rejected','expired')),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,referred_member_id)
);

create index if not exists referrals_operator_code_idx on public.referrals(operator_id,referral_code);

create table if not exists public.hero_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  currency_code text not null default 'HERO_CREDIT',
  current_balance numeric(14,4) not null default 0,
  lifetime_earned numeric(14,4) not null default 0,
  lifetime_redeemed numeric(14,4) not null default 0,
  status text not null default 'active' check (status in ('active','frozen','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,member_id)
);

create table if not exists public.hero_credit_rules (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  rule_code text not null,
  tier smallint not null check (tier in (1,2)),
  spending_unit numeric(14,2) not null default 100 check (spending_unit > 0),
  credits_awarded numeric(14,4) not null default 1 check (credits_awarded >= 0),
  allow_fractional boolean not null default false,
  redemption_value_thb numeric(14,4) not null default 1 check (redemption_value_thb >= 0),
  max_redemption_percent numeric(5,2) not null default 100 check (max_redemption_percent between 0 and 100),
  eligible_reward_categories text[] not null default array['ride_discount','hero_insure','products','rewards','promotions','social_rewards'],
  expiry_days integer,
  welcome_bonus numeric(14,4) not null default 200,
  campaign_bonus numeric(14,4) not null default 0,
  referral_qualification jsonb not null default '{"requires_completed_transaction":true}'::jsonb,
  minimum_eligible_transaction numeric(14,2) not null default 100,
  maximum_credits_per_transaction numeric(14,4),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,rule_code)
);

create table if not exists public.hero_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  account_id uuid not null references public.hero_credit_accounts(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('welcome','ride_earn','referral_earn','campaign_earn','redeem','expire','adjustment','reversal')),
  amount numeric(14,4) not null check (amount <> 0),
  status text not null default 'posted' check (status in ('posted','pending','void')),
  source_product text not null default 'hero_move',
  source_type text,
  source_id uuid,
  description text not null,
  expires_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(operator_id,idempotency_key)
);

create table if not exists public.reward_catalog (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  reward_code text not null,
  category text not null,
  name text not null,
  description text,
  credits_cost numeric(14,4) not null check (credits_cost >= 0),
  monetary_value_thb numeric(14,2),
  inventory integer,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,reward_code)
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  reward_id uuid references public.reward_catalog(id) on delete set null,
  booking_id uuid,
  credits_used numeric(14,4) not null check (credits_used > 0),
  discount_amount_thb numeric(14,2) not null default 0,
  status text not null default 'reserved' check (status in ('reserved','applied','fulfilled','cancelled','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_products (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  service_type text not null,
  default_duration_minutes integer not null check (default_duration_minutes > 0),
  requires_destination boolean not null default true,
  allows_stops boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,code)
);

create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  service_product_id uuid not null references public.service_products(id) on delete cascade,
  vehicle_class text not null default 'any',
  base_fare numeric(14,2) not null check (base_fare >= 0),
  included_km numeric(10,2),
  per_km_rate numeric(14,2) not null default 0,
  included_minutes integer,
  overtime_per_hour numeric(14,2) not null default 0,
  waiting_per_hour numeric(14,2) not null default 0,
  airport_fee numeric(14,2) not null default 0,
  deposit_percent numeric(5,2) not null default 10 check (deposit_percent between 0 and 100),
  minimum_fare numeric(14,2) not null default 0,
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  vehicle_code text not null,
  plate_number text not null,
  brand text not null,
  model text not null,
  model_year integer,
  vehicle_class text not null,
  energy_type text not null check (energy_type in ('ev','phev','hybrid','petrol','diesel','other')),
  seats integer not null check (seats > 0),
  odometer_km numeric(12,1) not null default 0,
  availability_status text not null default 'available' check (availability_status in ('available','assigned','maintenance','out_of_service','inactive')),
  assigned_driver_id uuid,
  battery_health_percent numeric(5,2),
  insurance_expiry date,
  road_tax_expiry date,
  registration_expiry date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,vehicle_code),
  unique(operator_id,plate_number)
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  driver_code text not null,
  full_name text not null,
  mobile text,
  licence_number text,
  licence_expiry date,
  status text not null default 'available' check (status in ('available','assigned','off_duty','leave','suspended','inactive')),
  rating numeric(3,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,driver_code),
  unique(operator_id,user_id)
);

alter table public.vehicles drop constraint if exists vehicles_assigned_driver_id_fkey;
alter table public.vehicles add constraint vehicles_assigned_driver_id_fkey foreign key (assigned_driver_id) references public.drivers(id) on delete set null;

create table if not exists public.vehicle_documents (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade, document_type text not null,
  document_number text, file_path text, issued_at date, expires_at date, status text not null default 'valid',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade, maintenance_type text not null,
  starts_at timestamptz not null, ends_at timestamptz, odometer_km numeric(12,1), cost numeric(14,2) not null default 0,
  vendor text, status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.vehicle_charging (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade, started_at timestamptz not null,
  ended_at timestamptz, start_battery_percent numeric(5,2), end_battery_percent numeric(5,2), energy_kwh numeric(12,3),
  cost numeric(14,2), charging_location text, created_at timestamptz not null default now()
);

create table if not exists public.vehicle_insurance (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade, policy_type text not null,
  insurer text, policy_number text, starts_on date, expires_on date, premium numeric(14,2), status text not null default 'active',
  document_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade, document_type text not null,
  document_number text, file_path text, issued_at date, expires_at date, status text not null default 'valid',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  booking_number text not null,
  member_id uuid references public.members(id) on delete set null,
  corporate_account_id uuid references public.corporate_accounts(id) on delete set null,
  service_product_id uuid not null references public.service_products(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  customer_name text not null,
  customer_email text,
  customer_mobile text not null,
  pickup_address text not null,
  destination_address text,
  pickup_at timestamptz not null,
  estimated_end_at timestamptz not null,
  passenger_count integer not null default 1 check (passenger_count > 0),
  luggage_count integer not null default 0 check (luggage_count >= 0),
  vehicle_class text not null,
  flight_number text,
  passenger_notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','driver_assigned','vehicle_assigned','ready','driver_en_route','passenger_onboard','trip_in_progress','completed','cancelled')),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  deposit_percent numeric(5,2) not null default 10,
  deposit_amount numeric(14,2) not null default 0,
  balance_amount numeric(14,2) not null default 0,
  currency text not null default 'THB',
  payment_status text not null default 'pending' check (payment_status in ('pending','deposit_pending','deposit_paid','partially_paid','paid','failed','refunded','partially_refunded')),
  tax_invoice_requested boolean not null default false,
  tax_profile_snapshot jsonb,
  source text not null default 'web',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,booking_number),
  check (estimated_end_at > pickup_at),
  check (total_amount >= 0 and deposit_amount >= 0 and balance_amount >= 0)
);

alter table public.reward_redemptions drop constraint if exists reward_redemptions_booking_id_fkey;
alter table public.reward_redemptions add constraint reward_redemptions_booking_id_fkey foreign key (booking_id) references public.bookings(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='bookings_no_vehicle_overlap') then
    alter table public.bookings add constraint bookings_no_vehicle_overlap exclude using gist
      (operator_id with =, vehicle_id with =, tstzrange(pickup_at,estimated_end_at,'[)') with &&)
      where (vehicle_id is not null and status not in ('completed','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname='bookings_no_driver_overlap') then
    alter table public.bookings add constraint bookings_no_driver_overlap exclude using gist
      (operator_id with =, driver_id with =, tstzrange(pickup_at,estimated_end_at,'[)') with &&)
      where (driver_id is not null and status not in ('completed','cancelled'));
  end if;
end $$;

create table if not exists public.booking_passengers (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade, traveller_id uuid references public.travellers(id) on delete set null,
  full_name text not null, mobile text, email text, is_primary boolean not null default false, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.booking_stops (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade, stop_order integer not null,
  address text not null, latitude numeric(10,7), longitude numeric(10,7), planned_wait_minutes integer not null default 0,
  arrived_at timestamptz, departed_at timestamptz, notes text, unique(booking_id,stop_order)
);

create table if not exists public.driver_assignments (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade, driver_id uuid not null references public.drivers(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict, assigned_by uuid references public.users(id) on delete set null,
  assigned_at timestamptz not null default now(), unassigned_at timestamptz, status text not null default 'active' check (status in ('active','replaced','cancelled')),
  notes text
);

create table if not exists public.trip_status_history (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade, from_status text, to_status text not null,
  changed_by uuid references public.users(id) on delete set null, location jsonb, notes text, created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict, member_id uuid references public.members(id) on delete set null,
  payment_number text not null, payment_type text not null check (payment_type in ('deposit','balance','full','adjustment')),
  method text check (method in ('promptpay_qr','credit_card','debit_card','wallet','mobile_payment','payment_link','international','other')),
  amount numeric(14,2) not null check (amount >= 0), currency text not null default 'THB',
  status text not null default 'pending' check (status in ('pending','authorized','paid','failed','cancelled','refunded','partially_refunded')),
  provider_code text, provider_payment_id text, paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(operator_id,payment_number)
);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade, provider_code text, provider_reference text,
  status text not null, request_summary jsonb not null default '{}'::jsonb, response_summary jsonb not null default '{}'::jsonb,
  error_code text, error_message text, attempted_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete restrict, amount numeric(14,2) not null check (amount > 0),
  reason text, status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  provider_reference text, requested_by uuid references public.users(id) on delete set null, requested_at timestamptz not null default now(), completed_at timestamptz
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict, payment_id uuid references public.payments(id) on delete set null,
  receipt_number text not null, issued_at timestamptz not null default now(), amount numeric(14,2) not null,
  file_path text, delivery_email text, status text not null default 'issued', unique(operator_id,receipt_number)
);

create table if not exists public.tax_profiles (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade, corporate_account_id uuid references public.corporate_accounts(id) on delete cascade,
  legal_name text not null, tax_id text, branch_type text not null default 'head_office', branch_number text not null default '00000',
  billing_address jsonb not null default '{}'::jsonb, billing_email text, is_default boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (member_id is not null or corporate_account_id is not null)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete restrict, corporate_account_id uuid references public.corporate_accounts(id) on delete set null,
  tax_profile_id uuid references public.tax_profiles(id) on delete set null, invoice_number text not null, invoice_type text not null default 'tax_invoice',
  billing_snapshot jsonb not null default '{}'::jsonb,
  issued_on date not null default current_date, due_on date, subtotal numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0, status text not null default 'draft' check (status in ('draft','issued','paid','void','cancelled')),
  file_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(operator_id,invoice_number)
);

create table if not exists public.esg_methodology (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  methodology_code text not null, name text not null, description text,
  ice_baseline_kg_co2_per_km numeric(10,6) not null, ev_operational_kg_co2_per_km numeric(10,6) not null,
  tree_absorption_kg_co2_per_year numeric(10,4) not null, source_notes text,
  verified boolean not null default false, active boolean not null default true, effective_from date not null default current_date,
  effective_until date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(operator_id,methodology_code)
);

create table if not exists public.esg_trip_records (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete restrict, vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  methodology_id uuid not null references public.esg_methodology(id) on delete restrict, distance_km numeric(12,3) not null check (distance_km >= 0),
  estimated_co2_avoided_kg numeric(14,6) not null, estimated_tree_year_equivalent numeric(14,8) not null,
  calculation_inputs jsonb not null default '{}'::jsonb, calculated_at timestamptz not null default now(),
  disclaimer text not null default 'Estimated operational figures based on the configured methodology. Not certified carbon credits.'
);

create table if not exists public.operator_settings (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  setting_group text not null, settings jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(operator_id,setting_group)
);

create table if not exists public.payment_settings (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  provider_code text not null default 'unconfigured', provider_mode text not null default 'disabled' check (provider_mode in ('disabled','test','live')),
  enabled_methods text[] not null default array['promptpay_qr','credit_card','debit_card','wallet','international'],
  deposit_percent numeric(5,2) not null default 10 check (deposit_percent between 0 and 100),
  balance_due_hours_before integer not null default 24, allow_full_payment boolean not null default true,
  public_configuration jsonb not null default '{}'::jsonb, secret_reference text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(operator_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null, actor_role text, action text not null,
  entity_type text, entity_id uuid, before_data jsonb, after_data jsonb, ip_hash text, user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), operator_id uuid not null references public.operators(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade, member_id uuid references public.members(id) on delete cascade,
  channel text not null check (channel in ('email','sms','line','push','in_app')), template_code text not null,
  subject text, body text not null, status text not null default 'queued' check (status in ('queued','sent','delivered','failed','cancelled')),
  related_type text, related_id uuid, scheduled_at timestamptz not null default now(), sent_at timestamptz,
  provider_reference text, created_at timestamptz not null default now()
);

create index if not exists bookings_operator_pickup_idx on public.bookings(operator_id,pickup_at);
create index if not exists bookings_vehicle_schedule_idx on public.bookings(operator_id,vehicle_id,pickup_at,estimated_end_at) where vehicle_id is not null;
create index if not exists bookings_driver_schedule_idx on public.bookings(operator_id,driver_id,pickup_at,estimated_end_at) where driver_id is not null;
create index if not exists bookings_member_idx on public.bookings(operator_id,member_id,created_at desc);
create index if not exists credit_transactions_account_idx on public.hero_credit_transactions(account_id,created_at desc);
create index if not exists payments_booking_idx on public.payments(operator_id,booking_id,created_at desc);
create index if not exists maintenance_vehicle_dates_idx on public.vehicle_maintenance(operator_id,vehicle_id,starts_at,ends_at);
create index if not exists notifications_queue_idx on public.notifications(status,scheduled_at) where status='queued';

-- Index every tenant-domain foreign key used by joins, relationship checks, and cascade operations.
do $$ declare rec record; index_name text; begin
  for rec in
    select c.relname as table_name,
           string_agg(a.attname,'_' order by keys.ordinality) as column_key,
           string_agg(format('%I',a.attname),',' order by keys.ordinality) as columns_sql
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral unnest(con.conkey) with ordinality as keys(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=keys.attnum
    where con.contype='f' and n.nspname='public'
      and c.relname=any(array['operators','users','operator_users','operator_invitations','members','individual_profiles','corporate_accounts','corporate_users','travellers','saved_locations','referrals','hero_credit_accounts','hero_credit_rules','hero_credit_transactions','reward_catalog','reward_redemptions','service_products','pricing_rules','vehicles','vehicle_documents','vehicle_maintenance','vehicle_charging','vehicle_insurance','drivers','driver_documents','bookings','booking_passengers','booking_stops','driver_assignments','trip_status_history','payments','payment_attempts','refunds','receipts','invoices','tax_profiles','esg_trip_records','esg_methodology','operator_settings','payment_settings','audit_logs','notifications'])
    group by c.relname,con.oid
  loop
    index_name=left(format('%s_%s_fk_idx',rec.table_name,rec.column_key),63);
    execute format('create index if not exists %I on public.%I (%s)',index_name,rec.table_name,rec.columns_sql);
  end loop;
end $$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['operators','users','operator_users','operator_invitations','members','individual_profiles','corporate_accounts','corporate_users','travellers','saved_locations','referrals','hero_credit_accounts','hero_credit_rules','reward_catalog','reward_redemptions','service_products','pricing_rules','vehicles','drivers','vehicle_documents','vehicle_maintenance','vehicle_insurance','driver_documents','bookings','booking_passengers','driver_assignments','payments','invoices','tax_profiles','esg_methodology','operator_settings','payment_settings'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I',t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
  end loop;
end $$;

create or replace function private.post_credit_transaction()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='posted' then
    update public.hero_credit_accounts
      set current_balance=current_balance+new.amount,
          lifetime_earned=lifetime_earned+case when new.amount>0 then new.amount else 0 end,
          lifetime_redeemed=lifetime_redeemed+case when new.amount<0 then abs(new.amount) else 0 end,
          updated_at=now()
      where id=new.account_id and operator_id=new.operator_id and member_id=new.member_id;
    if not found then raise exception 'HERO Credits account mismatch'; end if;
    if (select current_balance from public.hero_credit_accounts where id=new.account_id)<0 then
      raise exception 'Insufficient HERO Credits';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.post_credit_transaction() from public,anon,authenticated;
drop trigger if exists post_credit_transaction on public.hero_credit_transactions;
create trigger post_credit_transaction after insert on public.hero_credit_transactions for each row execute function private.post_credit_transaction();

create or replace function private.prevent_ledger_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Ledger and audit records are immutable; create a reversal entry instead'; end $$;
drop trigger if exists immutable_credit_ledger on public.hero_credit_transactions;
create trigger immutable_credit_ledger before update or delete on public.hero_credit_transactions for each row execute function private.prevent_ledger_mutation();
drop trigger if exists immutable_audit_log on public.audit_logs;
create trigger immutable_audit_log before update or delete on public.audit_logs for each row execute function private.prevent_ledger_mutation();

create or replace function private.has_operator_role(target_operator uuid, allowed_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.operator_users ou
    where ou.operator_id=target_operator and ou.user_id=(select auth.uid()) and ou.status='active'
      and (allowed_roles is null or ou.role=any(allowed_roles))
  )
$$;
revoke all on function private.has_operator_role(uuid,text[]) from public,anon;
grant execute on function private.has_operator_role(uuid,text[]) to authenticated;

alter table public.operators enable row level security;
alter table public.users enable row level security;
alter table public.operator_users enable row level security;

drop policy if exists operators_tenant_read on public.operators;
create policy operators_tenant_read on public.operators for select to authenticated using (private.has_operator_role(id,null));
drop policy if exists users_self_read on public.users;
create policy users_self_read on public.users for select to authenticated using ((select auth.uid())=id);
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
drop policy if exists operator_users_tenant_read on public.operator_users;
create policy operator_users_tenant_read on public.operator_users for select to authenticated using (user_id=(select auth.uid()) or private.has_operator_role(operator_id,array['owner','admin']));

do $$ declare t text; begin
  foreach t in array array['operator_invitations','members','individual_profiles','corporate_accounts','corporate_users','travellers','saved_locations','referrals','hero_credit_accounts','hero_credit_rules','hero_credit_transactions','reward_catalog','reward_redemptions','service_products','pricing_rules','vehicles','vehicle_documents','vehicle_maintenance','vehicle_charging','vehicle_insurance','drivers','driver_documents','bookings','booking_passengers','booking_stops','driver_assignments','trip_status_history','payments','payment_attempts','refunds','receipts','invoices','tax_profiles','esg_trip_records','esg_methodology','operator_settings','payment_settings','audit_logs','notifications'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists tenant_read on public.%I',t);
    execute format('drop policy if exists tenant_staff_read on public.%I',t);
    execute format('create policy tenant_staff_read on public.%I for select to authenticated using (private.has_operator_role(operator_id,array[''owner'',''admin'',''operator'',''dispatcher'',''finance'']))',t);
  end loop;
end $$;

-- Role-scoped self-service reads. The browser receives no direct write grants.
create policy member_self_read on public.members for select to authenticated using (user_id=(select auth.uid()));
create policy individual_profile_self_read on public.individual_profiles for select to authenticated using (exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())));
create policy corporate_account_user_read on public.corporate_accounts for select to authenticated using (exists(select 1 from public.corporate_users cu where cu.corporate_account_id=corporate_accounts.id and cu.user_id=(select auth.uid()) and cu.status='active'));
create policy corporate_user_account_read on public.corporate_users for select to authenticated using (user_id=(select auth.uid()));
create policy traveller_owner_read on public.travellers for select to authenticated using (
  exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())) or
  exists(select 1 from public.corporate_users cu where cu.corporate_account_id=corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active')
);
create policy saved_location_owner_read on public.saved_locations for select to authenticated using (
  exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())) or
  exists(select 1 from public.corporate_users cu where cu.corporate_account_id=corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active')
);
create policy referral_member_read on public.referrals for select to authenticated using (exists(select 1 from public.members m where m.user_id=(select auth.uid()) and m.id in (referrer_member_id,referred_member_id)));
create policy credit_account_member_read on public.hero_credit_accounts for select to authenticated using (exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())));
create policy credit_transaction_member_read on public.hero_credit_transactions for select to authenticated using (exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())));
create policy reward_redemption_member_read on public.reward_redemptions for select to authenticated using (exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())));
create policy tenant_reward_rules_read on public.hero_credit_rules for select to authenticated using (private.has_operator_role(operator_id,null));
create policy tenant_reward_catalog_read on public.reward_catalog for select to authenticated using (private.has_operator_role(operator_id,null));
create policy tenant_service_product_read on public.service_products for select to authenticated using (private.has_operator_role(operator_id,null));
create policy tenant_pricing_rule_read on public.pricing_rules for select to authenticated using (private.has_operator_role(operator_id,null));
create policy driver_self_read on public.drivers for select to authenticated using (user_id=(select auth.uid()));
create policy driver_document_self_read on public.driver_documents for select to authenticated using (exists(select 1 from public.drivers d where d.id=driver_id and d.user_id=(select auth.uid())));
create policy booking_participant_read on public.bookings for select to authenticated using (
  exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())) or
  exists(select 1 from public.corporate_users cu where cu.corporate_account_id=corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active') or
  exists(select 1 from public.drivers d where d.id=driver_id and d.user_id=(select auth.uid()))
);
create policy booking_passenger_participant_read on public.booking_passengers for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (
  exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active') or exists(select 1 from public.drivers d where d.id=b.driver_id and d.user_id=(select auth.uid()))
)));
create policy booking_stop_participant_read on public.booking_stops for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (
  exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active') or exists(select 1 from public.drivers d where d.id=b.driver_id and d.user_id=(select auth.uid()))
)));
create policy driver_assignment_self_read on public.driver_assignments for select to authenticated using (exists(select 1 from public.drivers d where d.id=driver_id and d.user_id=(select auth.uid())));
create policy trip_status_participant_read on public.trip_status_history for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (
  exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active') or exists(select 1 from public.drivers d where d.id=b.driver_id and d.user_id=(select auth.uid()))
)));
create policy payment_participant_read on public.payments for select to authenticated using (
  exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.bookings b join public.corporate_users cu on cu.corporate_account_id=b.corporate_account_id where b.id=booking_id and cu.user_id=(select auth.uid()) and cu.status='active')
);
create policy receipt_participant_read on public.receipts for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active'))));
create policy invoice_participant_read on public.invoices for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active'))));
create policy tax_profile_owner_read on public.tax_profiles for select to authenticated using (exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active'));
create policy esg_trip_participant_read on public.esg_trip_records for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (exists(select 1 from public.members m where m.id=b.member_id and m.user_id=(select auth.uid())) or exists(select 1 from public.corporate_users cu where cu.corporate_account_id=b.corporate_account_id and cu.user_id=(select auth.uid()) and cu.status='active'))));
create policy notification_self_read on public.notifications for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.members m where m.id=member_id and m.user_id=(select auth.uid())));

-- Keep production tables out of direct REST/GraphQL discovery. All application access uses the Edge API;
-- RLS remains enabled as defense in depth.
grant usage on schema public to anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['operators','users','operator_users','operator_invitations','members','individual_profiles','corporate_accounts','corporate_users','travellers','saved_locations','referrals','hero_credit_accounts','hero_credit_rules','hero_credit_transactions','reward_catalog','reward_redemptions','service_products','pricing_rules','vehicles','vehicle_documents','vehicle_maintenance','vehicle_charging','vehicle_insurance','drivers','driver_documents','bookings','booking_passengers','booking_stops','driver_assignments','trip_status_history','payments','payment_attempts','refunds','receipts','invoices','tax_profiles','esg_trip_records','esg_methodology','operator_settings','payment_settings','audit_logs','notifications'] loop
    execute format('revoke select,insert,update,delete on public.%I from anon,authenticated',t);
  end loop;
end $$;

-- Seed only tenant configuration and business rules; no demo customers, vehicles, drivers or trips.
insert into public.operators(slug,display_name,legal_name,default_language)
values('hero-move','HERO Move','HERO Move','en')
on conflict(slug) do update set display_name=excluded.display_name,default_language='en';

with op as (select id from public.operators where slug='hero-move')
insert into public.operator_invitations(operator_id,email,role,status)
select id,'thomas@successconnection.co.th','owner','pending' from op
on conflict do nothing;

with op as (select id from public.operators where slug='hero-move'), products(code,name,service_type,duration,needs_dest,stops,sort_order) as (
  values
  ('airport_transfer','Airport Transfer','airport_transfer',120,true,false,10),
  ('point_to_point','Point-to-Point','point_to_point',120,true,false,20),
  ('hourly_chauffeur','Hourly Chauffeur','hourly',120,false,true,30),
  ('package_3h','3-Hour Package','package',180,false,true,40),
  ('package_5h','5-Hour Package','package',300,false,true,50),
  ('package_8h','8-Hour Package','package',480,false,true,60),
  ('full_day','Full-Day Chauffeur','package',600,false,true,70),
  ('corporate_transfer','Corporate Executive Transfer','corporate',120,true,false,80),
  ('multi_stop','Multi-stop / City / Province','multi_stop',240,true,true,90)
)
insert into public.service_products(operator_id,code,name,service_type,default_duration_minutes,requires_destination,allows_stops,sort_order)
select op.id,p.code,p.name,p.service_type,p.duration,p.needs_dest,p.stops,p.sort_order from op cross join products p
on conflict(operator_id,code) do update set name=excluded.name,service_type=excluded.service_type,default_duration_minutes=excluded.default_duration_minutes,requires_destination=excluded.requires_destination,allows_stops=excluded.allows_stops,sort_order=excluded.sort_order;

with fares(code,base_fare) as (
  values ('airport_transfer',1200::numeric),('point_to_point',900),('hourly_chauffeur',800),('package_3h',1100),('package_5h',1800),('package_8h',2600),('full_day',3500),('corporate_transfer',1500),('multi_stop',1500)
)
insert into public.pricing_rules(operator_id,service_product_id,vehicle_class,base_fare,deposit_percent,minimum_fare)
select p.operator_id,p.id,'any',f.base_fare,10,f.base_fare
from public.service_products p join fares f on f.code=p.code join public.operators o on o.id=p.operator_id and o.slug='hero-move'
where not exists (select 1 from public.pricing_rules r where r.operator_id=p.operator_id and r.service_product_id=p.id and r.vehicle_class='any');

with op as (select id from public.operators where slug='hero-move')
insert into public.hero_credit_rules(operator_id,rule_code,tier,spending_unit,credits_awarded,allow_fractional,redemption_value_thb,max_redemption_percent,welcome_bonus,minimum_eligible_transaction)
select id,'ride_and_earn',1,100,1,false,1,100,200,100 from op
union all select id,'refer_and_earn',2,100,1,false,1,100,200,100 from op
on conflict(operator_id,rule_code) do nothing;

with op as (select id from public.operators where slug='hero-move')
insert into public.payment_settings(operator_id,provider_code,provider_mode,deposit_percent,balance_due_hours_before,allow_full_payment)
select id,'unconfigured','disabled',10,24,true from op on conflict(operator_id) do nothing;

with op as (select id from public.operators where slug='hero-move')
insert into public.esg_methodology(operator_id,methodology_code,name,description,ice_baseline_kg_co2_per_km,ev_operational_kg_co2_per_km,tree_absorption_kg_co2_per_year,source_notes,verified)
select id,'operational_estimate_v1','HERO Move Operational Estimate','Configurable estimate for operational reporting only.',0.192,0.053,21.77,'Operator-configured assumptions. Validate before formal reporting.',false from op
on conflict(operator_id,methodology_code) do nothing;

with op as (select id from public.operators where slug='hero-move'), defaults(group_name,payload) as (
  values
  ('booking','{"minimum_lead_minutes":120,"buffer_minutes":30,"default_currency":"THB"}'::jsonb),
  ('rewards','{"distinct_color":"#0f8a70","source_product":"hero_move"}'::jsonb),
  ('esg','{"claim_certified_carbon_credits":false}'::jsonb),
  ('localization','{"default":"en","supported":["en","th","zh"]}'::jsonb)
)
insert into public.operator_settings(operator_id,setting_group,settings)
select op.id,d.group_name,d.payload from op cross join defaults d
on conflict(operator_id,setting_group) do nothing;
