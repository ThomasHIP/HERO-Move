import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type Json = Record<string, unknown>;
type Actor = { userId: string | null; roles: string[]; operatorId: string; memberId: string | null; driverId: string | null; corporateAccountId: string | null };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const defaultOrigins = ["https://hero-move.pages.dev"];
const configuredOrigins = (Deno.env.get("HERO_MOVE_ALLOWED_ORIGINS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const pagesPreview = /^https:\/\/[a-z0-9-]+\.hero-move\.pages\.dev$/i.test(origin);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const approved = allowedOrigins.has(origin) || pagesPreview || local ? origin : defaultOrigins[0];
  return {
    "Access-Control-Allow-Origin": approved,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-hero-operator",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function response(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readJwtRole(token: string) {
  try {
    const value = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(value.padEnd(Math.ceil(value.length / 4) * 4, "="))).role as string;
  } catch { return "anon"; }
}

async function operatorBySlug(slug: string) {
  const { data, error } = await admin.from("operators").select("*").eq("slug", slug).eq("status", "active").single();
  if (error || !data) throw new Error("Operator is not available");
  return data;
}

async function actorFor(req: Request, operatorId: string): Promise<Actor> {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  let userId: string | null = null;
  let verifiedEmail: string | null = null;
  let authName: string | null = null;
  if (token && readJwtRole(token) !== "anon") {
    const { data } = await admin.auth.getUser(token);
    userId = data.user?.id ?? null;
    verifiedEmail = data.user?.email_confirmed_at ? (data.user.email ?? null) : null;
    authName = String(data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? "") || null;
  }
  if (!userId) return { userId: null, roles: [], operatorId, memberId: null, driverId: null, corporateAccountId: null };
  let { data: memberships } = await admin.from("operator_users").select("role").eq("operator_id", operatorId).eq("user_id", userId).eq("status", "active");
  if (!memberships?.length && verifiedEmail) {
    const { data: invitation } = await admin.from("operator_invitations").select("*").eq("operator_id", operatorId).ilike("email", verifiedEmail).eq("status", "pending").or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).limit(1).maybeSingle();
    if (invitation) {
      await admin.from("users").upsert({ id: userId, full_name: authName }, { onConflict: "id" });
      const { error: roleError } = await admin.from("operator_users").upsert({ operator_id: operatorId, user_id: userId, role: invitation.role, status: "active" }, { onConflict: "operator_id,user_id,role" });
      if (roleError) throw roleError;
      await admin.from("operator_invitations").update({ status: "claimed", claimed_by: userId, claimed_at: new Date().toISOString() }).eq("id", invitation.id);
      memberships = [{ role: invitation.role }];
    }
  }
  const [{ data: member }, { data: driver }, { data: corporate }] = await Promise.all([
    admin.from("members").select("id").eq("operator_id", operatorId).eq("user_id", userId).maybeSingle(),
    admin.from("drivers").select("id").eq("operator_id", operatorId).eq("user_id", userId).maybeSingle(),
    admin.from("corporate_users").select("corporate_account_id").eq("operator_id", operatorId).eq("user_id", userId).eq("status", "active").maybeSingle(),
  ]);
  return { userId, roles: (memberships ?? []).map((x) => x.role), operatorId, memberId: member?.id ?? null, driverId: driver?.id ?? null, corporateAccountId: corporate?.corporate_account_id ?? null };
}

const staffRoles = ["owner", "admin", "operator", "dispatcher", "finance"];
function requireUser(actor: Actor) { if (!actor.userId) throw new Error("Authentication required"); }
function requireRole(actor: Actor, roles: string[]) {
  requireUser(actor);
  if (!actor.roles.some((role) => roles.includes(role))) throw new Error("You do not have permission for this action");
}

async function audit(actor: Actor, action: string, entityType?: string, entityId?: string, afterData?: unknown) {
  await admin.from("audit_logs").insert({ operator_id: actor.operatorId, actor_user_id: actor.userId, actor_role: actor.roles[0] ?? "guest", action, entity_type: entityType, entity_id: entityId, after_data: afterData ?? null });
}

function publicOperator(operator: Json) {
  return { id: operator.id, slug: operator.slug, displayName: operator.display_name, logoUrl: operator.logo_url, primaryColor: operator.primary_color, accentColor: operator.accent_color, rewardColor: operator.reward_color, defaultLanguage: operator.default_language, timezone: operator.timezone, currency: operator.currency };
}

function memberView(x: Json) { return { id: x.id, userId: x.user_id, memberNumber: x.member_number, referralCode: x.referral_code, type: x.membership_type === "corporate" ? "Corporate" : "Individual", name: x.display_name, email: x.email, mobile: x.mobile, status: x.status, createdAt: x.created_at }; }
function vehicleView(x: Json) { return { id: x.id, vehicleCode: x.vehicle_code, plate: x.plate_number, brand: x.brand, model: x.model, year: x.model_year, vehicleClass: x.vehicle_class, energy: String(x.energy_type ?? "").toUpperCase(), seats: x.seats, odometer: x.odometer_km, status: String(x.availability_status ?? "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()), battery: x.battery_health_percent, insuranceExpiry: x.insurance_expiry, roadTaxExpiry: x.road_tax_expiry, registrationExpiry: x.registration_expiry, notes: x.notes }; }
function driverView(x: Json) { return { id: x.id, userId: x.user_id, driverCode: x.driver_code, name: x.full_name, mobile: x.mobile, licenceNo: x.licence_number, licenceExpiry: x.licence_expiry, status: String(x.status ?? "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()), rating: x.rating, notes: x.notes }; }
function bookingView(x: Json) { return { id: x.id, bookingNumber: x.booking_number, memberId: x.member_id, customerId: x.corporate_account_id, serviceProductId: x.service_product_id, service: (x.service_products as Json | null)?.name ?? x.service_name, vehicleId: x.vehicle_id, driverId: x.driver_id, customer: x.customer_name, email: x.customer_email, mobile: x.customer_mobile, pickup: x.pickup_address, dest1: x.destination_address, date: String(x.pickup_at ?? "").slice(0, 10), time: String(x.pickup_at ?? "").slice(11, 16), pickupAt: x.pickup_at, estimatedEndAt: x.estimated_end_at, passengers: x.passenger_count, luggage: x.luggage_count, vehicleClass: x.vehicle_class, flight: x.flight_number, notes: x.passenger_notes, status: String(x.status ?? "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()), price: x.total_amount, deposit: x.deposit_amount, balance: x.balance_amount, paymentStatus: String(x.payment_status ?? "").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()), taxInvoice: x.tax_invoice_requested ? "Yes" : "No", taxProfile: x.tax_profile_snapshot, createdAt: x.created_at }; }

async function rewardRule(operatorId: string, tier: number) {
  const { data, error } = await admin.from("hero_credit_rules").select("*").eq("operator_id", operatorId).eq("tier", tier).eq("active", true).lte("valid_from", new Date().toISOString()).order("valid_from", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(`Active HERO Credits tier ${tier} rule is not configured`);
  return data;
}

function calculateCredits(value: number, rule: Json) {
  if (value < Number(rule.minimum_eligible_transaction ?? 0)) return 0;
  const blocks = value / Number(rule.spending_unit || 100);
  const units = rule.allow_fractional ? blocks : Math.floor(blocks);
  let credits = units * Number(rule.credits_awarded || 0);
  if (rule.maximum_credits_per_transaction != null) credits = Math.min(credits, Number(rule.maximum_credits_per_transaction));
  return Math.max(0, Number(credits.toFixed(4)));
}

async function pricingQuote(operatorId: string, input: Json) {
  let query = admin.from("service_products").select("*").eq("operator_id", operatorId).eq("active", true);
  const requested = String(input.serviceCode ?? input.service ?? "airport_transfer");
  query = requested.includes(" ") ? query.ilike("name", requested) : query.eq("code", requested);
  const { data: service, error: serviceError } = await query.limit(1).maybeSingle();
  if (serviceError || !service) throw new Error("Selected service is unavailable");
  const vehicleClass = String(input.vehicleClass ?? "any");
  const { data: rules, error: rulesError } = await admin.from("pricing_rules").select("*").eq("operator_id", operatorId).eq("service_product_id", service.id).eq("active", true).lte("valid_from", new Date().toISOString()).or(`vehicle_class.eq.${vehicleClass},vehicle_class.eq.any`).order("vehicle_class", { ascending: false });
  if (rulesError || !rules?.length) throw new Error("Pricing has not been configured for this service and vehicle class");
  const rule = rules.find((r) => r.vehicle_class === vehicleClass) ?? rules[0];
  const distance = Math.max(0, Number(input.distanceKm ?? 0));
  const excessKm = Math.max(0, distance - Number(rule.included_km ?? distance));
  const subtotal = Math.max(Number(rule.minimum_fare ?? 0), Number(rule.base_fare) + excessKm * Number(rule.per_km_rate ?? 0));
  const { data: payment } = await admin.from("payment_settings").select("deposit_percent,allow_full_payment,enabled_methods,provider_mode").eq("operator_id", operatorId).maybeSingle();
  const depositPercent = Number(rule.deposit_percent ?? payment?.deposit_percent ?? 10);
  const total = Number(subtotal.toFixed(2));
  const deposit = Number((total * depositPercent / 100).toFixed(2));
  const rideRule = await rewardRule(operatorId, 1);
  return { service, pricingRule: rule, subtotal: total, total, depositPercent, deposit, balance: Number((total - deposit).toFixed(2)), creditsToEarn: calculateCredits(total, rideRule), payment: payment ?? null };
}

async function availability(operatorId: string, input: Json, quote: Json) {
  const pickupAt = new Date(String(input.pickupAt));
  if (Number.isNaN(pickupAt.getTime())) throw new Error("A valid pickup date and time is required");
  const duration = Number((quote.service as Json).default_duration_minutes ?? 120);
  const endAt = new Date(pickupAt.getTime() + duration * 60_000);
  const bufferStart = new Date(pickupAt.getTime() - 30 * 60_000).toISOString();
  const bufferEnd = new Date(endAt.getTime() + 30 * 60_000).toISOString();
  let busyQuery = admin.from("bookings").select("vehicle_id,driver_id,pickup_at,estimated_end_at").eq("operator_id", operatorId).not("status", "in", "(completed,cancelled)").lt("pickup_at", bufferEnd).gt("estimated_end_at", bufferStart);
  if (input.excludeBookingId) busyQuery = busyQuery.neq("id", input.excludeBookingId);
  const [{ data: vehicles }, { data: drivers }, { data: busy }, { data: maintenance }] = await Promise.all([
    admin.from("vehicles").select("id,vehicle_code,plate_number,brand,model,vehicle_class,seats,energy_type,availability_status").eq("operator_id", operatorId).eq("vehicle_class", String(input.vehicleClass)).in("availability_status", ["available", "assigned"]),
    admin.from("drivers").select("id,driver_code,full_name,status").eq("operator_id", operatorId).in("status", ["available", "assigned"]),
    busyQuery,
    admin.from("vehicle_maintenance").select("vehicle_id,starts_at,ends_at,status").eq("operator_id", operatorId).in("status", ["scheduled", "in_progress"]).lt("starts_at", bufferEnd).or(`ends_at.is.null,ends_at.gt.${bufferStart}`),
  ]);
  const busyVehicleIds = new Set([...(busy ?? []).map((x) => x.vehicle_id), ...(maintenance ?? []).map((x) => x.vehicle_id)].filter(Boolean));
  const busyDriverIds = new Set((busy ?? []).map((x) => x.driver_id).filter(Boolean));
  const availableVehicles = (vehicles ?? []).filter((x) => !busyVehicleIds.has(x.id));
  const availableDrivers = (drivers ?? []).filter((x) => !busyDriverIds.has(x.id));
  return { pickupAt: pickupAt.toISOString(), estimatedEndAt: endAt.toISOString(), available: availableVehicles.length > 0 && availableDrivers.length > 0, availableVehicleCount: availableVehicles.length, availableDriverCount: availableDrivers.length, vehicles: availableVehicles, drivers: availableDrivers };
}

async function bootstrap(operator: Json, actor: Actor) {
  const operatorId = String(operator.id);
  const [servicesResult, rulesResult, rewardsResult, paymentResult, settingsResult, methodologyResult] = await Promise.all([
    admin.from("service_products").select("*").eq("operator_id", operatorId).eq("active", true).order("sort_order"),
    admin.from("pricing_rules").select("*,service_products(code,name)").eq("operator_id", operatorId).eq("active", true),
    admin.from("hero_credit_rules").select("*").eq("operator_id", operatorId).eq("active", true),
    admin.from("payment_settings").select("provider_mode,enabled_methods,deposit_percent,balance_due_hours_before,allow_full_payment,public_configuration").eq("operator_id", operatorId).maybeSingle(),
    admin.from("operator_settings").select("setting_group,settings").eq("operator_id", operatorId),
    admin.from("esg_methodology").select("*").eq("operator_id", operatorId).eq("active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const base: Json = {
    mode: "production", operator: publicOperator(operator), auth: { authenticated: !!actor.userId, roles: actor.roles },
    serviceProducts: servicesResult.data ?? [], pricing: (rulesResult.data ?? []).map((x) => ({ id: x.id, serviceProductId: x.service_product_id, service: (x.service_products as Json)?.name, serviceCode: (x.service_products as Json)?.code, vehicleClass: x.vehicle_class, price: x.base_fare, depositPct: x.deposit_percent, active: x.active })),
    rewardRules: rewardsResult.data ?? [], paymentSettings: paymentResult.data ?? null, esgMethodology: methodologyResult.data ?? null, esgRecords: [],
    settings: Object.fromEntries((settingsResult.data ?? []).map((x) => [x.setting_group, x.settings])),
    vehicles: [], bookings: [], maintenance: [], drivers: [], customers: [], members: [], credits: [], invoices: [], payments: [], rewards: [], travellers: [], locations: [],
  };
  if (!actor.userId) return base;
  if (actor.roles.some((r) => staffRoles.includes(r))) {
    const [vehicles, bookings, maintenance, drivers, customers, members, credits, invoices, payments, catalog, esg] = await Promise.all([
      admin.from("vehicles").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("bookings").select("*,service_products(name)").eq("operator_id", operatorId).order("pickup_at", { ascending: false }).limit(500),
      admin.from("vehicle_maintenance").select("*").eq("operator_id", operatorId).order("starts_at", { ascending: false }),
      admin.from("drivers").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("corporate_accounts").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("members").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("hero_credit_transactions").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }).limit(1000),
      admin.from("invoices").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("payments").select("*").eq("operator_id", operatorId).order("created_at", { ascending: false }),
      admin.from("reward_catalog").select("*").eq("operator_id", operatorId).eq("active", true),
      admin.from("esg_trip_records").select("*,bookings(booking_number,pickup_at,customer_name),vehicles(plate_number,brand,model)").eq("operator_id", operatorId).order("calculated_at", { ascending: false }).limit(1000),
    ]);
    Object.assign(base, {
      vehicles: (vehicles.data ?? []).map(vehicleView), bookings: (bookings.data ?? []).map(bookingView),
      maintenance: (maintenance.data ?? []).map((x) => ({ id: x.id, vehicleId: x.vehicle_id, type: x.maintenance_type, dueDate: String(x.starts_at).slice(0, 10), startsAt: x.starts_at, endsAt: x.ends_at, status: x.status, cost: x.cost, notes: x.notes })),
      drivers: (drivers.data ?? []).map(driverView),
      customers: (customers.data ?? []).map((x) => ({ id: x.id, type: "Corporate", name: x.trading_name ?? x.legal_company_name, legalNameEn: x.legal_company_name, taxId: x.tax_id, branchType: x.branch_type, branchNo: x.branch_number, billingEmail: x.billing_email, contactPerson: x.contact_person, mobile: x.contact_mobile, status: x.status, addressLine: (x.billing_address as Json)?.line1, province: (x.billing_address as Json)?.province, postalCode: (x.billing_address as Json)?.postalCode })),
      members: (members.data ?? []).map(memberView), credits: credits.data ?? [], invoices: invoices.data ?? [], payments: payments.data ?? [], rewards: catalog.data ?? [], esgRecords: esg.data ?? [],
    });
  } else if (actor.driverId) {
    const [{ data: driver }, { data: bookings }] = await Promise.all([
      admin.from("drivers").select("*").eq("id", actor.driverId).single(),
      admin.from("bookings").select("*,service_products(name)").eq("operator_id", operatorId).eq("driver_id", actor.driverId).order("pickup_at"),
    ]);
    base.drivers = driver ? [driverView(driver)] : [];
    base.bookings = (bookings ?? []).map(bookingView);
  } else if (actor.corporateAccountId) {
    const { data: bookingIds } = await admin.from("bookings").select("id").eq("operator_id", operatorId).eq("corporate_account_id", actor.corporateAccountId);
    const ids = (bookingIds ?? []).map((x) => x.id);
    const [company, travellers, locations, bookings, invoices, payments, esg, member, account, credits, catalog] = await Promise.all([
      admin.from("corporate_accounts").select("*").eq("id", actor.corporateAccountId).single(),
      admin.from("travellers").select("*").eq("operator_id", operatorId).eq("corporate_account_id", actor.corporateAccountId).order("full_name"),
      admin.from("saved_locations").select("*").eq("operator_id", operatorId).eq("corporate_account_id", actor.corporateAccountId).order("label"),
      admin.from("bookings").select("*,service_products(name)").eq("operator_id", operatorId).eq("corporate_account_id", actor.corporateAccountId).order("pickup_at", { ascending: false }),
      ids.length ? admin.from("invoices").select("*").eq("operator_id", operatorId).in("booking_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      ids.length ? admin.from("payments").select("*").eq("operator_id", operatorId).in("booking_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      ids.length ? admin.from("esg_trip_records").select("*,bookings(booking_number,pickup_at)").eq("operator_id", operatorId).in("booking_id", ids) : Promise.resolve({ data: [] }),
      actor.memberId ? admin.from("members").select("*").eq("id", actor.memberId).single() : Promise.resolve({ data: null }),
      actor.memberId ? admin.from("hero_credit_accounts").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).maybeSingle() : Promise.resolve({ data: null }),
      actor.memberId ? admin.from("hero_credit_transactions").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
      admin.from("reward_catalog").select("*").eq("operator_id", operatorId).eq("active", true),
    ]);
    base.corporateAccount = company.data ?? null;
    base.travellers = travellers.data ?? [];
    base.locations = locations.data ?? [];
    base.bookings = (bookings.data ?? []).map(bookingView);
    base.invoices = invoices.data ?? [];
    base.payments = payments.data ?? [];
    base.esgRecords = esg.data ?? [];
    base.members = member.data ? [memberView(member.data)] : [];
    base.creditAccount = account.data ?? null;
    base.credits = credits.data ?? [];
    base.rewards = catalog.data ?? [];
  } else if (actor.memberId) {
    const [member, account, bookings, credits, invoices, payments, catalog, travellers, locations, esg] = await Promise.all([
      admin.from("members").select("*").eq("id", actor.memberId).single(),
      admin.from("hero_credit_accounts").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).maybeSingle(),
      admin.from("bookings").select("*,service_products(name)").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("pickup_at", { ascending: false }),
      admin.from("hero_credit_transactions").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("created_at", { ascending: false }),
      admin.from("invoices").select("*").eq("operator_id", operatorId).in("booking_id", (await admin.from("bookings").select("id").eq("member_id", actor.memberId)).data?.map((x) => x.id) ?? []),
      admin.from("payments").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("created_at", { ascending: false }),
      admin.from("reward_catalog").select("*").eq("operator_id", operatorId).eq("active", true),
      admin.from("travellers").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("full_name"),
      admin.from("saved_locations").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).order("label"),
      admin.from("esg_trip_records").select("*,bookings(booking_number,pickup_at)").eq("operator_id", operatorId).in("booking_id", (await admin.from("bookings").select("id").eq("member_id", actor.memberId)).data?.map((x) => x.id) ?? []),
    ]);
    base.members = member.data ? [memberView(member.data)] : [];
    base.creditAccount = account.data ?? null;
    base.bookings = (bookings.data ?? []).map(bookingView);
    base.credits = credits.data ?? [];
    base.invoices = invoices.data ?? [];
    base.payments = payments.data ?? [];
    base.rewards = catalog.data ?? [];
    base.travellers = travellers.data ?? [];
    base.locations = locations.data ?? [];
    base.esgRecords = esg.data ?? [];
  }
  return base;
}

async function createMember(actor: Actor, operatorId: string, input: Json) {
  requireUser(actor);
  const type = String(input.membershipType ?? "individual").toLowerCase();
  const memberNumber = `HM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: authUser } = await admin.auth.admin.getUserById(actor.userId!);
  await admin.from("users").upsert({ id: actor.userId, full_name: input.fullName, mobile: input.mobile, preferred_language: input.preferredLanguage ?? "en" }, { onConflict: "id" });
  const { data: member, error } = await admin.from("members").insert({ operator_id: operatorId, user_id: actor.userId, member_number: memberNumber, referral_code: memberNumber, membership_type: type, display_name: input.fullName, email: input.email ?? authUser.user?.email, mobile: input.mobile }).select().single();
  if (error) throw error;
  if (type === "corporate") {
    const { data: company, error: companyError } = await admin.from("corporate_accounts").insert({ operator_id: operatorId, account_code: `CORP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, legal_company_name: input.legalCompanyName, tax_id: input.taxId || null, branch_type: input.branchType ?? "head_office", branch_number: input.branchNumber ?? "00000", billing_address: input.billingAddress ?? {}, billing_email: input.billingEmail ?? input.email, contact_person: input.fullName, contact_mobile: input.mobile }).select().single();
    if (companyError) throw companyError;
    await admin.from("corporate_users").insert({ operator_id: operatorId, corporate_account_id: company.id, user_id: actor.userId, member_id: member.id, role: "admin" });
    await admin.from("operator_users").upsert({ operator_id: operatorId, user_id: actor.userId, role: "corporate_user", status: "active" }, { onConflict: "operator_id,user_id,role" });
  } else {
    await admin.from("individual_profiles").insert({ operator_id: operatorId, member_id: member.id });
    await admin.from("operator_users").upsert({ operator_id: operatorId, user_id: actor.userId, role: "customer", status: "active" }, { onConflict: "operator_id,user_id,role" });
  }
  const { data: account, error: accountError } = await admin.from("hero_credit_accounts").insert({ operator_id: operatorId, member_id: member.id }).select().single();
  if (accountError) throw accountError;
  const rule = await rewardRule(operatorId, 1);
  const welcome = Number(rule.welcome_bonus ?? 200);
  if (welcome > 0) await admin.from("hero_credit_transactions").insert({ operator_id: operatorId, account_id: account.id, member_id: member.id, transaction_type: "welcome", amount: welcome, description: "HERO Membership welcome bonus", idempotency_key: `welcome:${member.id}`, created_by: actor.userId });
  if (input.referralCode) {
    const { data: referrer } = await admin.from("members").select("id,referral_code").eq("operator_id", operatorId).eq("referral_code", String(input.referralCode).trim().toUpperCase()).eq("status", "active").maybeSingle();
    if (referrer && referrer.id !== member.id) {
      const { error: referralError } = await admin.from("referrals").insert({ operator_id: operatorId, referrer_member_id: referrer.id, referred_member_id: member.id, referral_code: referrer.referral_code, status: "pending" });
      if (referralError) throw referralError;
    }
  }
  await audit(actor, "member.created", "member", member.id, { membershipType: type, memberNumber });
  return { member: memberView(member), welcomeCredits: welcome };
}

async function createBooking(actor: Actor, operatorId: string, input: Json) {
  const quote = await pricingQuote(operatorId, input);
  const avail = await availability(operatorId, input, quote);
  const bookingNumber = `HM-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const payload = {
    operator_id: operatorId, booking_number: bookingNumber, member_id: actor.memberId,
    corporate_account_id: input.corporateAccountId ?? null, service_product_id: (quote.service as Json).id,
    customer_name: input.customerName, customer_email: input.email || null, customer_mobile: input.mobile,
    pickup_address: input.pickup, destination_address: input.destination || null,
    pickup_at: avail.pickupAt, estimated_end_at: avail.estimatedEndAt,
    passenger_count: Number(input.passengers ?? 1), luggage_count: Number(input.luggage ?? 0), vehicle_class: input.vehicleClass,
    flight_number: input.flightNumber || null, passenger_notes: input.notes || null,
    status: avail.available ? "pending" : "pending", subtotal: quote.subtotal, total_amount: quote.total,
    deposit_percent: quote.depositPercent, deposit_amount: quote.deposit, balance_amount: quote.balance,
    payment_status: "deposit_pending", tax_invoice_requested: !!input.taxInvoiceRequested,
    tax_profile_snapshot: input.taxProfile ?? null, created_by: actor.userId, source: "web",
  };
  const { data: booking, error } = await admin.from("bookings").insert(payload).select("*,service_products(name)").single();
  if (error) throw error;
  const { data: payment } = await admin.from("payments").insert({ operator_id: operatorId, booking_id: booking.id, member_id: actor.memberId, payment_number: `PAY-${bookingNumber}`, payment_type: quote.depositPercent >= 100 ? "full" : "deposit", amount: quote.deposit, status: "pending" }).select().single();
  await admin.from("trip_status_history").insert({ operator_id: operatorId, booking_id: booking.id, to_status: "pending", changed_by: actor.userId, notes: avail.available ? "Availability verified at booking" : "Awaiting operator resource confirmation" });
  await audit(actor, "booking.created", "booking", booking.id, { bookingNumber, total: quote.total, availability: avail.available });
  return { booking: bookingView(booking), quote, availability: avail, payment };
}

async function assignResources(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin", "operator", "dispatcher"]);
  const bookingId = String(input.bookingId);
  const { data: booking, error: bookingError } = await admin.from("bookings").select("*").eq("operator_id", operatorId).eq("id", bookingId).single();
  if (bookingError || !booking) throw new Error("Booking not found");
  const quote = { service: { default_duration_minutes: Math.max(1, Math.round((new Date(booking.estimated_end_at).getTime() - new Date(booking.pickup_at).getTime()) / 60000)) } };
  const avail = await availability(operatorId, { pickupAt: booking.pickup_at, vehicleClass: booking.vehicle_class, excludeBookingId: bookingId }, quote);
  if (!avail.vehicles.some((x) => x.id === input.vehicleId)) throw new Error("Selected vehicle is unavailable or has a schedule conflict");
  if (!avail.drivers.some((x) => x.id === input.driverId)) throw new Error("Selected driver is unavailable or has a schedule conflict");
  const status = input.driverId && input.vehicleId ? "ready" : input.driverId ? "driver_assigned" : "vehicle_assigned";
  const { data: updated, error } = await admin.from("bookings").update({ vehicle_id: input.vehicleId, driver_id: input.driverId, status }).eq("id", bookingId).select("*,service_products(name)").single();
  if (error) throw error;
  await admin.from("driver_assignments").update({ status: "replaced", unassigned_at: new Date().toISOString() }).eq("booking_id", bookingId).eq("status", "active");
  await admin.from("driver_assignments").insert({ operator_id: operatorId, booking_id: bookingId, driver_id: input.driverId, vehicle_id: input.vehicleId, assigned_by: actor.userId });
  await admin.from("trip_status_history").insert({ operator_id: operatorId, booking_id: bookingId, from_status: booking.status, to_status: status, changed_by: actor.userId, notes: input.notes ?? null });
  await audit(actor, "booking.resources_assigned", "booking", bookingId, { vehicleId: input.vehicleId, driverId: input.driverId });
  return bookingView(updated);
}

async function awardCredit(operatorId: string, memberId: string, tier: number, amountThb: number, sourceId: string, type: string, description: string, actor: Actor) {
  const [rule, accountResult] = await Promise.all([rewardRule(operatorId, tier), admin.from("hero_credit_accounts").select("*").eq("operator_id", operatorId).eq("member_id", memberId).single()]);
  const credits = calculateCredits(amountThb, rule);
  if (!credits) return 0;
  const { error } = await admin.from("hero_credit_transactions").insert({ operator_id: operatorId, account_id: accountResult.data.id, member_id: memberId, transaction_type: type, amount: credits, source_type: "booking", source_id: sourceId, description, idempotency_key: `${type}:${sourceId}:${memberId}`, created_by: actor.userId });
  if (error && error.code !== "23505") throw error;
  return credits;
}

async function updateTripStatus(actor: Actor, operatorId: string, input: Json) {
  requireUser(actor);
  const status = String(input.status).toLowerCase().replaceAll(" ", "_");
  const { data: booking, error: findError } = await admin.from("bookings").select("*,vehicles(energy_type),service_products(name)").eq("operator_id", operatorId).eq("id", input.bookingId).single();
  if (findError || !booking) throw new Error("Booking not found");
  const canOperate = actor.roles.some((r) => staffRoles.includes(r)) || (actor.driverId && actor.driverId === booking.driver_id);
  if (!canOperate) throw new Error("You cannot update this trip");
  const transitions: Record<string, string[]> = { pending: ["confirmed", "cancelled"], confirmed: ["driver_assigned", "vehicle_assigned", "ready", "cancelled"], driver_assigned: ["ready", "cancelled"], vehicle_assigned: ["ready", "cancelled"], ready: ["driver_en_route", "cancelled"], driver_en_route: ["passenger_onboard", "cancelled"], passenger_onboard: ["trip_in_progress"], trip_in_progress: ["completed"] };
  if (!(transitions[booking.status] ?? []).includes(status)) throw new Error(`Invalid trip transition from ${booking.status} to ${status}`);
  const { data: updated, error } = await admin.from("bookings").update({ status }).eq("id", booking.id).select("*,service_products(name)").single();
  if (error) throw error;
  await admin.from("trip_status_history").insert({ operator_id: operatorId, booking_id: booking.id, from_status: booking.status, to_status: status, changed_by: actor.userId, notes: input.notes ?? null, location: input.location ?? null });
  let rideCredits = 0, referralCredits = 0, esg = null;
  if (status === "completed") {
    if (booking.member_id) rideCredits = await awardCredit(operatorId, booking.member_id, 1, Number(booking.total_amount), booking.id, "ride_earn", "Ride & Earn — completed HERO Move trip", actor);
    if (booking.member_id) {
      const { data: referral } = await admin.from("referrals").select("*").eq("operator_id", operatorId).eq("referred_member_id", booking.member_id).in("status", ["pending", "qualified", "rewarded"]).maybeSingle();
      if (referral) {
        referralCredits = await awardCredit(operatorId, referral.referrer_member_id, 2, Number(booking.total_amount), booking.id, "referral_earn", "Refer & Earn — eligible referred-customer trip", actor);
        await admin.from("referrals").update({ status: "rewarded", qualified_at: new Date().toISOString() }).eq("id", referral.id);
      }
    }
    const energy = (booking.vehicles as Json | null)?.energy_type;
    const distance = Math.max(0, Number(input.distanceKm ?? 0));
    if ((energy === "ev" || energy === "phev") && distance > 0) {
      const { data: method } = await admin.from("esg_methodology").select("*").eq("operator_id", operatorId).eq("active", true).order("effective_from", { ascending: false }).limit(1).single();
      const avoided = Math.max(0, distance * (Number(method.ice_baseline_kg_co2_per_km) - Number(method.ev_operational_kg_co2_per_km)));
      const treeYear = avoided / Number(method.tree_absorption_kg_co2_per_year);
      const { data } = await admin.from("esg_trip_records").upsert({ operator_id: operatorId, booking_id: booking.id, vehicle_id: booking.vehicle_id, methodology_id: method.id, distance_km: distance, estimated_co2_avoided_kg: avoided, estimated_tree_year_equivalent: treeYear, calculation_inputs: { distanceKm: distance, iceBaseline: method.ice_baseline_kg_co2_per_km, evOperational: method.ev_operational_kg_co2_per_km, treeAbsorption: method.tree_absorption_kg_co2_per_year } }, { onConflict: "booking_id" }).select().single();
      esg = data;
    }
  }
  await audit(actor, "booking.status_updated", "booking", booking.id, { from: booking.status, to: status });
  return { booking: bookingView(updated), rideCredits, referralCredits, esg };
}

async function redeemCredits(actor: Actor, operatorId: string, input: Json) {
  requireUser(actor);
  if (!actor.memberId) throw new Error("Active HERO Membership required");
  const credits = Number(input.credits);
  if (!(credits > 0)) throw new Error("Credits must be greater than zero");
  const [accountResult, rule] = await Promise.all([admin.from("hero_credit_accounts").select("*").eq("operator_id", operatorId).eq("member_id", actor.memberId).single(), rewardRule(operatorId, 1)]);
  const maxPercent = Number(rule.max_redemption_percent ?? 100);
  const bookingAmount = Number(input.bookingAmount ?? 0);
  const value = credits * Number(rule.redemption_value_thb ?? 1);
  if (bookingAmount > 0 && value > bookingAmount * maxPercent / 100) throw new Error(`Maximum redemption is ${maxPercent}% of the eligible transaction`);
  const { data: redemption, error: redemptionError } = await admin.from("reward_redemptions").insert({ operator_id: operatorId, member_id: actor.memberId, reward_id: input.rewardId ?? null, booking_id: input.bookingId ?? null, credits_used: credits, discount_amount_thb: value, status: "applied" }).select().single();
  if (redemptionError) throw redemptionError;
  const { error } = await admin.from("hero_credit_transactions").insert({ operator_id: operatorId, account_id: accountResult.data.id, member_id: actor.memberId, transaction_type: "redeem", amount: -credits, source_type: "reward_redemption", source_id: redemption.id, description: String(input.description ?? "HERO Credits redemption"), idempotency_key: `redeem:${redemption.id}`, created_by: actor.userId });
  if (error) throw error;
  await audit(actor, "hero_credits.redeemed", "reward_redemption", redemption.id, { credits, value });
  return { redemption, creditsUsed: credits, valueThb: value };
}

async function saveEntity(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin", "operator", "dispatcher", "finance"]);
  const entity = String(input.entity);
  const row = (input.data ?? {}) as Json;
  let table = "", payload: Json = { operator_id: operatorId };
  if (entity === "vehicles") {
    const rawEnergy = String(row.energy ?? "ev").toLowerCase(); const energy = ["ev", "phev", "hybrid", "petrol", "diesel"].includes(rawEnergy) ? rawEnergy : "other";
    const rawStatus = String(row.status ?? "available").toLowerCase().replaceAll(" ", "_"); const vehicleStatus = rawStatus === "booked" ? "assigned" : rawStatus;
    table = "vehicles"; payload = { ...payload, vehicle_code: row.vehicleCode ?? row.id ?? `VEH-${crypto.randomUUID().slice(0, 8)}`, plate_number: row.plate, brand: row.brand, model: row.model, model_year: row.year || null, vehicle_class: row.vehicleClass ?? "Executive EV", energy_type: energy, seats: Number(row.seats ?? 4), odometer_km: Number(row.odometer ?? 0), availability_status: vehicleStatus, battery_health_percent: row.battery ?? null, insurance_expiry: row.insuranceExpiry || null, road_tax_expiry: row.roadTaxExpiry || null, registration_expiry: row.registrationExpiry || null, notes: row.notes || null };
  } else if (entity === "drivers") {
    table = "drivers"; payload = { ...payload, driver_code: row.driverCode ?? row.id ?? `DRV-${crypto.randomUUID().slice(0, 8)}`, full_name: row.name, mobile: row.mobile || null, licence_number: row.licenceNo || null, licence_expiry: row.licenceExpiry || null, status: String(row.status ?? "available").toLowerCase().replaceAll(" ", "_"), rating: Number(row.rating ?? 5), notes: row.notes || null };
  } else if (entity === "maintenance") {
    table = "vehicle_maintenance"; payload = { ...payload, vehicle_id: row.vehicleId, maintenance_type: row.type ?? "Scheduled Maintenance", starts_at: row.startsAt ?? (row.dueDate ? `${row.dueDate}T00:00:00+07:00` : new Date().toISOString()), ends_at: row.endsAt || null, odometer_km: row.dueKm || null, cost: Number(row.cost ?? 0), status: ["completed", "cancelled", "in_progress"].includes(String(row.status).toLowerCase().replaceAll(" ", "_")) ? String(row.status).toLowerCase().replaceAll(" ", "_") : "scheduled", notes: row.notes || null };
  } else if (entity === "customers") {
    const rawCustomerStatus = String(row.status ?? "active").toLowerCase(); const customerStatus = rawCustomerStatus === "prospect" ? "pending" : rawCustomerStatus;
    table = "corporate_accounts"; payload = { ...payload, account_code: row.accountCode ?? row.id ?? `CORP-${crypto.randomUUID().slice(0, 8)}`, legal_company_name: row.legalNameEn ?? row.legalNameTh ?? row.name, trading_name: row.name || null, tax_id: row.taxId || null, branch_type: String(row.branchType ?? "head_office").toLowerCase().replaceAll(" ", "_"), branch_number: row.branchNo ?? "00000", billing_address: { line1: row.addressLine, subdistrict: row.subdistrict, district: row.district, province: row.province, postalCode: row.postalCode, country: row.country ?? "Thailand" }, billing_email: row.billingEmail ?? row.email ?? null, contact_person: row.contactPerson ?? null, contact_mobile: row.mobile ?? null, status: customerStatus };
  } else if (entity === "pricing") {
    table = "pricing_rules"; payload = { ...payload, service_product_id: row.serviceProductId, vehicle_class: row.vehicleClass ?? "any", base_fare: Number(row.price ?? row.baseFare ?? 0), deposit_percent: Number(row.depositPct ?? 10), active: row.active !== false, valid_from: new Date().toISOString() };
  } else if (entity === "invoices") {
    table = "invoices"; payload = { ...payload, booking_id: row.bookingId || null, invoice_number: row.number ?? `INV-${Date.now()}`, issued_on: row.date ?? new Date().toISOString().slice(0, 10), total_amount: Number(row.amount ?? 0), status: String(row.status ?? "draft").toLowerCase() };
  } else throw new Error("Unsupported entity");
  const request = row.id && /^[0-9a-f-]{36}$/i.test(String(row.id)) ? admin.from(table).update(payload).eq("operator_id", operatorId).eq("id", row.id) : admin.from(table).insert(payload);
  const { data, error } = await request.select().single();
  if (error) throw error;
  await audit(actor, `${entity}.saved`, entity, data.id, payload);
  return data;
}

async function saveProfileItem(actor: Actor, operatorId: string, input: Json) {
  requireUser(actor);
  const kind = String(input.kind);
  const scope = String(input.scope ?? "member");
  const memberId = scope === "member" ? actor.memberId : null;
  const corporateAccountId = scope === "corporate" ? actor.corporateAccountId : null;
  if (!memberId && !corporateAccountId) throw new Error("A matching member or corporate account is required");
  let table: string;
  let payload: Json;
  if (kind === "traveller") {
    table = "travellers";
    payload = { operator_id: operatorId, member_id: memberId, corporate_account_id: corporateAccountId, full_name: String(input.fullName ?? "").trim(), email: input.email || null, mobile: input.mobile || null, notes: input.notes || null, is_default: !!input.isDefault };
    if (!payload.full_name) throw new Error("Traveller name is required");
  } else if (kind === "location") {
    table = "saved_locations";
    payload = { operator_id: operatorId, member_id: memberId, corporate_account_id: corporateAccountId, label: String(input.label ?? "").trim(), address: String(input.address ?? "").trim(), pickup_notes: input.pickupNotes || null, is_default: !!input.isDefault };
    if (!payload.label || !payload.address) throw new Error("Location label and address are required");
  } else throw new Error("Unsupported profile item");
  const query = input.id ? admin.from(table).update(payload).eq("operator_id", operatorId).eq("id", input.id).eq(memberId ? "member_id" : "corporate_account_id", memberId ?? corporateAccountId) : admin.from(table).insert(payload);
  const { data, error } = await query.select().single(); if (error) throw error;
  await audit(actor, `profile.${kind}_saved`, kind, data.id, { scope });
  return data;
}

async function updateSettings(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin"]);
  const section = String(input.section);
  const values = (input.values ?? {}) as Json;
  let data: unknown;
  if (section === "operator") {
    const payload = { display_name: values.displayName, legal_name: values.legalName || null, primary_color: values.primaryColor, accent_color: values.accentColor, reward_color: values.rewardColor, default_language: values.defaultLanguage ?? "en" };
    const result = await admin.from("operators").update(payload).eq("id", operatorId).select().single(); if (result.error) throw result.error; data = result.data;
  } else if (section === "payment") {
    const payload = { provider_code: values.providerCode ?? "unconfigured", provider_mode: values.providerMode ?? "disabled", enabled_methods: values.enabledMethods ?? [], deposit_percent: Number(values.depositPercent ?? 10), balance_due_hours_before: Number(values.balanceDueHoursBefore ?? 24), allow_full_payment: values.allowFullPayment !== false, public_configuration: values.publicConfiguration ?? {} };
    const result = await admin.from("payment_settings").update(payload).eq("operator_id", operatorId).select().single(); if (result.error) throw result.error; data = result.data;
  } else if (section === "credits") {
    const common = { spending_unit: Number(values.spendingUnit ?? 100), credits_awarded: Number(values.creditsAwarded ?? 1), allow_fractional: !!values.allowFractional, redemption_value_thb: Number(values.redemptionValue ?? 1), max_redemption_percent: Number(values.maxRedemptionPercent ?? 100), eligible_reward_categories: values.eligibleRewardCategories ?? [], expiry_days: values.expiryDays ? Number(values.expiryDays) : null, welcome_bonus: Number(values.welcomeBonus ?? 200), campaign_bonus: Number(values.campaignBonus ?? 0), referral_qualification: values.referralQualification ?? { requires_completed_transaction: true }, minimum_eligible_transaction: Number(values.minimumEligibleTransaction ?? 100), maximum_credits_per_transaction: values.maximumCreditsPerTransaction ? Number(values.maximumCreditsPerTransaction) : null };
    const result = await admin.from("hero_credit_rules").update(common).eq("operator_id", operatorId).eq("tier", Number(values.tier)).eq("active", true).select(); if (result.error) throw result.error; data = result.data;
  } else if (section === "booking") {
    const result = await admin.from("operator_settings").upsert({ operator_id: operatorId, setting_group: "booking", settings: values }, { onConflict: "operator_id,setting_group" }).select().single(); if (result.error) throw result.error; data = result.data;
  } else if (section === "esg") {
    const payload = { ice_baseline_kg_co2_per_km: Number(values.iceBaselineKgPerKm), ev_operational_kg_co2_per_km: Number(values.evOperationalKgPerKm), tree_absorption_kg_co2_per_year: Number(values.treeAbsorptionKgPerYear), source_notes: values.sourceNotes || "Operator-configured assumptions. Validate before formal reporting.", verified: false };
    const result = await admin.from("esg_methodology").update(payload).eq("operator_id", operatorId).eq("active", true).select().single(); if (result.error) throw result.error; data = result.data;
  } else throw new Error("Unsupported settings section");
  await audit(actor, `settings.${section}_updated`, "operator", operatorId, values);
  return data;
}

async function saveServiceProduct(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin", "operator"]);
  const productPayload = { operator_id: operatorId, code: String(input.code).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), name: input.name, description: input.description || null, service_type: input.serviceType ?? "custom", default_duration_minutes: Number(input.durationMinutes ?? 120), requires_destination: input.requiresDestination !== false, allows_stops: !!input.allowsStops, active: input.active !== false, sort_order: Number(input.sortOrder ?? 100) };
  const productQuery = input.id ? admin.from("service_products").update(productPayload).eq("operator_id", operatorId).eq("id", input.id) : admin.from("service_products").upsert(productPayload, { onConflict: "operator_id,code" });
  const { data: product, error } = await productQuery.select().single(); if (error) throw error;
  if (input.baseFare != null) {
    const { data: existing } = await admin.from("pricing_rules").select("id").eq("operator_id", operatorId).eq("service_product_id", product.id).eq("vehicle_class", input.vehicleClass ?? "any").eq("active", true).limit(1).maybeSingle();
    const pricePayload = { operator_id: operatorId, service_product_id: product.id, vehicle_class: input.vehicleClass ?? "any", base_fare: Number(input.baseFare), minimum_fare: Number(input.minimumFare ?? input.baseFare), deposit_percent: Number(input.depositPercent ?? 10), active: input.active !== false, valid_from: new Date().toISOString() };
    const priceResult = existing ? await admin.from("pricing_rules").update(pricePayload).eq("id", existing.id) : await admin.from("pricing_rules").insert(pricePayload); if (priceResult.error) throw priceResult.error;
  }
  await audit(actor, "service_product.saved", "service_product", product.id, productPayload);
  return product;
}

async function updatePaymentStatus(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin", "operator", "finance"]);
  const allowed = ["pending", "authorized", "paid", "failed", "cancelled", "refunded", "partially_refunded"];
  const status = String(input.status).toLowerCase(); if (!allowed.includes(status)) throw new Error("Unsupported payment status");
  const { data: payment, error: findError } = await admin.from("payments").select("*").eq("operator_id", operatorId).eq("id", input.paymentId).single(); if (findError || !payment) throw new Error("Payment not found");
  const { data: updated, error } = await admin.from("payments").update({ status, method: input.method ?? payment.method, provider_code: input.providerCode ?? payment.provider_code, provider_payment_id: input.providerPaymentId ?? payment.provider_payment_id, paid_at: status === "paid" ? (input.paidAt ?? new Date().toISOString()) : payment.paid_at }).eq("id", payment.id).select().single(); if (error) throw error;
  await admin.from("payment_attempts").insert({ operator_id: operatorId, payment_id: payment.id, provider_code: input.providerCode ?? null, provider_reference: input.providerPaymentId ?? null, status, response_summary: input.responseSummary ?? {} });
  const { data: booking } = await admin.from("bookings").select("*").eq("id", payment.booking_id).single();
  const { data: paidRows } = await admin.from("payments").select("amount").eq("operator_id", operatorId).eq("booking_id", payment.booking_id).eq("status", "paid");
  const paidTotal = (paidRows ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const bookingPaymentStatus = status === "failed" ? "failed" : status === "refunded" ? "refunded" : paidTotal >= Number(booking.total_amount) ? "paid" : paidTotal >= Number(booking.deposit_amount) ? "deposit_paid" : paidTotal > 0 ? "partially_paid" : "deposit_pending";
  await admin.from("bookings").update({ payment_status: bookingPaymentStatus }).eq("id", booking.id);
  if (status === "paid") {
    const { data: existing } = await admin.from("receipts").select("id").eq("payment_id", payment.id).maybeSingle();
    if (!existing) await admin.from("receipts").insert({ operator_id: operatorId, booking_id: booking.id, payment_id: payment.id, receipt_number: `RCT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, amount: payment.amount, delivery_email: booking.customer_email, status: "issued" });
  }
  await audit(actor, "payment.status_updated", "payment", payment.id, { from: payment.status, to: status, bookingPaymentStatus });
  return { payment: updated, bookingPaymentStatus, paidTotal };
}

async function createInvoice(actor: Actor, operatorId: string, input: Json) {
  requireRole(actor, ["owner", "admin", "operator", "finance"]);
  const { data: booking, error: bookingError } = await admin.from("bookings").select("*").eq("operator_id", operatorId).eq("id", input.bookingId).single(); if (bookingError || !booking) throw new Error("Booking not found");
  const invoiceNumber = String(input.invoiceNumber ?? `INV-${new Date().toISOString().slice(0, 7).replace("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);
  const subtotal = Number(input.subtotal ?? booking.total_amount); const vatRate = Number(input.vatRate ?? 7); const vatAmount = Number((subtotal * vatRate / (100 + vatRate)).toFixed(2));
  const { data: invoice, error } = await admin.from("invoices").insert({ operator_id: operatorId, booking_id: booking.id, corporate_account_id: booking.corporate_account_id, tax_profile_id: input.taxProfileId ?? null, invoice_number: invoiceNumber, invoice_type: input.invoiceType ?? "tax_invoice", billing_snapshot: input.billingSnapshot ?? booking.tax_profile_snapshot ?? {}, issued_on: input.issuedOn ?? new Date().toISOString().slice(0, 10), due_on: input.dueOn ?? null, subtotal: subtotal - vatAmount, vat_amount: vatAmount, total_amount: subtotal, status: input.status ?? "issued" }).select().single(); if (error) throw error;
  await audit(actor, "invoice.created", "invoice", invoice.id, { invoiceNumber, bookingId: booking.id });
  return invoice;
}

async function generateEsgTrip(actor: Actor, operatorId: string, input: Json) {
  requireUser(actor);
  const { data: booking, error } = await admin.from("bookings").select("*,vehicles(energy_type)").eq("operator_id", operatorId).eq("id", input.bookingId).single(); if (error || !booking) throw new Error("Booking not found");
  const allowedActor = actor.roles.some((r) => staffRoles.includes(r)) || (actor.driverId && actor.driverId === booking.driver_id); if (!allowedActor) throw new Error("You cannot calculate this trip");
  if (booking.status !== "completed") throw new Error("ESG impact is generated only for completed trips");
  const energy = (booking.vehicles as Json | null)?.energy_type; if (energy !== "ev" && energy !== "phev") throw new Error("This trip is not eligible for EV impact reporting");
  const distance = Math.max(0, Number(input.distanceKm)); if (!distance) throw new Error("Completed trip distance is required");
  const { data: method } = await admin.from("esg_methodology").select("*").eq("operator_id", operatorId).eq("active", true).order("effective_from", { ascending: false }).limit(1).single();
  const avoided = Math.max(0, distance * (Number(method.ice_baseline_kg_co2_per_km) - Number(method.ev_operational_kg_co2_per_km))); const treeYear = avoided / Number(method.tree_absorption_kg_co2_per_year);
  const { data: record, error: esgError } = await admin.from("esg_trip_records").upsert({ operator_id: operatorId, booking_id: booking.id, vehicle_id: booking.vehicle_id, methodology_id: method.id, distance_km: distance, estimated_co2_avoided_kg: avoided, estimated_tree_year_equivalent: treeYear, calculation_inputs: { distanceKm: distance, iceBaseline: method.ice_baseline_kg_co2_per_km, evOperational: method.ev_operational_kg_co2_per_km, treeAbsorption: method.tree_absorption_kg_co2_per_year } }, { onConflict: "booking_id" }).select().single(); if (esgError) throw esgError;
  await audit(actor, "esg.trip_calculated", "esg_trip_record", record.id, { bookingId: booking.id, distance, avoided, treeYear }); return record;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return response(req, { ok: false, error: "Method not allowed" }, 405);
  try {
    const body = await req.json() as Json;
    const action = String(body.action ?? "bootstrap");
    const operatorSlug = String(req.headers.get("x-hero-operator") ?? body.operatorSlug ?? "hero-move");
    const operator = await operatorBySlug(operatorSlug);
    const actor = await actorFor(req, String(operator.id));
    let data: unknown;
    switch (action) {
      case "health": data = { service: "HERO Move API", version: "2.0", database: "connected", operator: operatorSlug }; break;
      case "bootstrap": data = await bootstrap(operator, actor); break;
      case "calculate_pricing": data = await pricingQuote(String(operator.id), (body.input ?? body) as Json); break;
      case "check_availability": { const quote = await pricingQuote(String(operator.id), (body.input ?? body) as Json); data = { quote, availability: await availability(String(operator.id), (body.input ?? body) as Json, quote) }; break; }
      case "create_booking": data = await createBooking(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "create_member": data = await createMember(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "assign_resources": data = await assignResources(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "update_trip_status": data = await updateTripStatus(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "redeem_credits": data = await redeemCredits(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "save_entity": data = await saveEntity(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "save_profile_item": data = await saveProfileItem(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "update_settings": data = await updateSettings(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "save_service_product": data = await saveServiceProduct(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "update_payment_status": data = await updatePaymentStatus(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "create_invoice": data = await createInvoice(actor, String(operator.id), (body.input ?? body) as Json); break;
      case "generate_esg_trip": data = await generateEsgTrip(actor, String(operator.id), (body.input ?? body) as Json); break;
      default: return response(req, { ok: false, error: "Unsupported action" }, 404);
    }
    return response(req, { ok: true, data });
  } catch (error) {
    console.error(error);
    const message = errorMessage(error);
    const status = /Authentication required/.test(message) ? 401 : /permission|cannot update/i.test(message) ? 403 : 400;
    return response(req, { ok: false, error: message }, status);
  }
});
