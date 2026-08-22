-- HERO Move Level 1 production launch: manual fleet-supplier confirmation,
-- lead-time pricing, supplier settlement, guest notifications and Bangkok airport scope.

alter table public.service_products
  add column if not exists fulfilment_mode text not null default 'internal'
    check (fulfilment_mode in ('internal','supplier_manual','supplier_api')),
  add column if not exists supplier_confirmation_required boolean not null default false,
  add column if not exists service_area jsonb not null default '{}'::jsonb;

alter table public.pricing_rules
  add column if not exists minimum_lead_minutes integer not null default 0 check (minimum_lead_minutes >= 0),
  add column if not exists maximum_lead_minutes integer check (maximum_lead_minutes is null or maximum_lead_minutes >= 0),
  add column if not exists pricing_label text,
  add column if not exists priority integer not null default 0;

alter table public.bookings
  add column if not exists confirmation_mode text not null default 'internal_availability'
    check (confirmation_mode in ('internal_availability','supplier_manual','supplier_api')),
  add column if not exists confirmation_deadline_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists service_area_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (status in (
  'pending','payment_pending','paid','pending_supplier_confirmation','supplier_confirmed','details_pending',
  'confirmed','driver_assigned','vehicle_assigned','ready','driver_en_route','passenger_onboard',
  'trip_in_progress','completed_by_driver','supplier_verified','completed','cancelled'
));

alter table public.notifications
  add column if not exists recipient_email text,
  add column if not exists recipient_mobile text,
  add column if not exists recipient_line_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.mobility_suppliers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  supplier_code text not null,
  legal_name text not null,
  display_name text not null,
  fulfilment_mode text not null default 'manual' check (fulfilment_mode in ('manual','api')),
  confirmation_sla_minutes integer,
  business_hours jsonb not null default '{}'::jsonb,
  contact_name text,
  contact_email text,
  contact_mobile text,
  line_contact text,
  settlement_cycle text not null default 'after_trip'
    check (settlement_cycle in ('before_trip','after_trip','daily','weekly','monthly')),
  status text not null default 'active' check (status in ('pending','active','suspended','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,supplier_code)
);

create table if not exists public.supplier_service_rates (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  supplier_id uuid not null references public.mobility_suppliers(id) on delete cascade,
  service_product_id uuid not null references public.service_products(id) on delete cascade,
  vehicle_class text not null default 'Premium MPV',
  duration_minutes integer not null check (duration_minutes > 0),
  cost_amount numeric(14,2) not null check (cost_amount >= 0),
  currency text not null default 'THB',
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(operator_id,supplier_id,service_product_id,vehicle_class,duration_minutes,valid_from)
);

create table if not exists public.booking_supplier_assignments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  supplier_id uuid not null references public.mobility_suppliers(id) on delete restrict,
  status text not null default 'request_pending' check (status in (
    'request_pending','sent_to_supplier','supplier_accepted','supplier_declined','details_pending',
    'ready','driver_completed','supplier_verified','settled','cancelled'
  )),
  supplier_reference text,
  estimated_supplier_cost numeric(14,2) not null default 0,
  final_supplier_cost numeric(14,2),
  actual_service_minutes integer,
  vehicle_plate text,
  vehicle_brand text,
  vehicle_model text,
  driver_name text,
  driver_mobile text,
  supplier_notes text,
  requested_at timestamptz,
  accepted_at timestamptz,
  details_received_at timestamptz,
  driver_completed_at timestamptz,
  supplier_verified_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  supplier_id uuid not null references public.mobility_suppliers(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  assignment_id uuid not null unique references public.booking_supplier_assignments(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'THB',
  status text not null default 'pending' check (status in ('pending','approved','paid','disputed','cancelled')),
  due_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_assignment_status_idx
  on public.booking_supplier_assignments(operator_id,status,created_at desc);
create index if not exists supplier_payables_status_idx
  on public.supplier_payables(operator_id,status,due_at);
create index if not exists supplier_rates_lookup_idx
  on public.supplier_service_rates(operator_id,supplier_id,service_product_id,vehicle_class,duration_minutes)
  where active;

alter table public.mobility_suppliers enable row level security;
alter table public.supplier_service_rates enable row level security;
alter table public.booking_supplier_assignments enable row level security;
alter table public.supplier_payables enable row level security;

drop policy if exists tenant_staff_read on public.mobility_suppliers;
create policy tenant_staff_read on public.mobility_suppliers for select to authenticated
  using (private.has_operator_role(operator_id,array['owner','admin','operator','dispatcher','finance']));
drop policy if exists tenant_staff_read on public.supplier_service_rates;
create policy tenant_staff_read on public.supplier_service_rates for select to authenticated
  using (private.has_operator_role(operator_id,array['owner','admin','operator','dispatcher','finance']));
drop policy if exists tenant_staff_read on public.booking_supplier_assignments;
create policy tenant_staff_read on public.booking_supplier_assignments for select to authenticated
  using (private.has_operator_role(operator_id,array['owner','admin','operator','dispatcher','finance']));
drop policy if exists tenant_staff_read on public.supplier_payables;
create policy tenant_staff_read on public.supplier_payables for select to authenticated
  using (private.has_operator_role(operator_id,array['owner','admin','operator','dispatcher','finance']));

revoke select,insert,update,delete on public.mobility_suppliers from anon,authenticated;
revoke select,insert,update,delete on public.supplier_service_rates from anon,authenticated;
revoke select,insert,update,delete on public.booking_supplier_assignments from anon,authenticated;
revoke select,insert,update,delete on public.supplier_payables from anon,authenticated;
grant select,insert,update,delete on public.mobility_suppliers to service_role;
grant select,insert,update,delete on public.supplier_service_rates to service_role;
grant select,insert,update,delete on public.booking_supplier_assignments to service_role;
grant select,insert,update,delete on public.supplier_payables to service_role;

-- Configure the real public airport product. The standard fare applies below 48 hours;
-- the advance fare applies from 48 hours. Both remain subject to BM confirmation.
with product as (
  update public.service_products p
  set name='EV Airport Transfer — MAXUS 9',
      description='One-way MAXUS 9 EV airport transfer between Suvarnabhumi or Don Mueang Airport and Bangkok.',
      default_duration_minutes=60,
      fulfilment_mode='supplier_manual',
      supplier_confirmation_required=true,
      service_area=jsonb_build_object(
        'type','airport_bangkok',
        'airports',jsonb_build_array('Suvarnabhumi Airport (BKK)','Don Mueang Airport (DMK)'),
        'destination_area','Bangkok',
        'direction','either',
        'one_way',true
      ),
      updated_at=now()
  where p.operator_id=(select id from public.operators where slug='hero-move')
    and p.code='airport_transfer'
  returning id,operator_id
)
update public.pricing_rules r
set active=false,updated_at=now()
where r.operator_id=(select operator_id from product)
  and r.service_product_id=(select id from product);

with op as (select id from public.operators where slug='hero-move'),
product as (select p.id,p.operator_id from public.service_products p join op on op.id=p.operator_id where p.code='airport_transfer')
insert into public.pricing_rules(
  operator_id,service_product_id,vehicle_class,base_fare,included_minutes,overtime_per_hour,
  deposit_percent,minimum_fare,minimum_lead_minutes,maximum_lead_minutes,pricing_label,priority,metadata
)
select operator_id,id,'Premium MPV',2500,60,700,100,2500,0,2879,'Standard fare — under 48 hours',20,
  '{"confirmation":"supplier_manual","advance_discount_percent":0}'::jsonb from product
union all
select operator_id,id,'Premium MPV',2250,60,700,100,2250,2880,null,'Advance fare — 48 hours or more',30,
  '{"confirmation":"supplier_manual","advance_discount_percent":10,"regular_fare":2500}'::jsonb from product;

with op as (select id from public.operators where slug='hero-move')
insert into public.mobility_suppliers(
  operator_id,supplier_code,legal_name,display_name,fulfilment_mode,confirmation_sla_minutes,
  business_hours,settlement_cycle,status,notes
)
select id,'BM','Borrow Mobility','Borrow Mobility','manual',960,
  '{"timezone":"Asia/Bangkok","provisional":{"opens":"09:00","closes":"17:00"},"final_confirmation_required":true}'::jsonb,
  'after_trip','active','Vehicle and driver details are supplied per accepted booking. Commercial terms remain operator-configurable.'
from op
on conflict(operator_id,supplier_code) do update set
  display_name=excluded.display_name,fulfilment_mode='manual',status='active',updated_at=now();

with op as (select id from public.operators where slug='hero-move'),
supplier as (select s.id,s.operator_id from public.mobility_suppliers s join op on op.id=s.operator_id where s.supplier_code='BM'),
product as (select p.id,p.operator_id from public.service_products p join op on op.id=p.operator_id where p.code='airport_transfer')
insert into public.supplier_service_rates(operator_id,supplier_id,service_product_id,vehicle_class,duration_minutes,cost_amount,metadata)
select supplier.operator_id,supplier.id,product.id,'Premium MPV',60,1100,'{"rate_source":"BM rack card","commission_excluded":true}'::jsonb from supplier join product using(operator_id)
union all
select supplier.operator_id,supplier.id,product.id,'Premium MPV',120,1800,'{"rate_source":"BM rack card","commission_excluded":true}'::jsonb from supplier join product using(operator_id)
on conflict(operator_id,supplier_id,service_product_id,vehicle_class,duration_minutes,valid_from) do nothing;

with op as (select id from public.operators where slug='hero-move')
insert into public.operator_settings(operator_id,setting_group,settings)
select id,'supplier_operations','{
  "default_supplier_code":"BM",
  "customer_confirmation":"booking_received_then_supplier_confirmed",
  "vehicle_details_timing":"after_supplier_confirmation",
  "short_notice_confirmation_required":true,
  "included_service_minutes":60,
  "customer_overtime_per_started_hour":700,
  "airport_scope":"BKK_DMK_to_from_Bangkok",
  "pending_bm_terms":["clock_start","airport_waiting","flight_delay","parking","tolls","cancellation","no_show","settlement_cycle"]
}'::jsonb from op
on conflict(operator_id,setting_group) do update set settings=excluded.settings,updated_at=now();

update public.operator_settings
set settings=settings || '{"minimum_lead_minutes":0,"advance_discount_lead_minutes":2880,"short_notice_confirmation_required":true}'::jsonb,
    updated_at=now()
where operator_id=(select id from public.operators where slug='hero-move') and setting_group='booking';
