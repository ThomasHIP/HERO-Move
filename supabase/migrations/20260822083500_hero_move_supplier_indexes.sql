-- Cover supplier-operation foreign keys used by staff workflow and settlement reporting.
create index if not exists booking_supplier_assignments_supplier_idx
  on public.booking_supplier_assignments(supplier_id);
create index if not exists booking_supplier_assignments_created_by_idx
  on public.booking_supplier_assignments(created_by) where created_by is not null;
create index if not exists supplier_payables_supplier_idx
  on public.supplier_payables(supplier_id);
create index if not exists supplier_payables_booking_idx
  on public.supplier_payables(booking_id);
