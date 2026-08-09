const HERO_MOVE = {
  SHEETS: {
    Members: ['member_id','type','name','mobile','email','language','hero_credits','customer_id','status','created_at','updated_at'],
    Customers: ['customer_id','member_id','type','legal_name_th','legal_name_en','tax_id','branch_type','branch_no','contact_person','mobile','email','billing_email','address_line','subdistrict','district','province','postal_code','country','status','created_at','updated_at'],
    Bookings: ['booking_id','member_id','customer_id','service','vehicle_class','pickup','destination_1','destination_2','trip_date','pickup_time','passengers','luggage','flight_no','customer_name','mobile','email','company','fare','deposit','balance','payment_method','payment_status','tax_invoice','status','vehicle_id','driver_id','trip_distance_km','trip_hours','co2_avoided_kg','tree_year','tree_days','notes','created_at','updated_at'],
    Vehicles: ['vehicle_id','plate','brand','model','year','energy','seats','odometer','status','battery_health','revenue','trips','operating_hours','next_service_km','insurance_expiry','registration_expiry','notes','created_at','updated_at'],
    Drivers: ['driver_id','name','mobile','licence_no','licence_expiry','status','vehicle_id','rating','trips','operating_hours','notes','created_at','updated_at'],
    Maintenance: ['maintenance_id','vehicle_id','type','due_date','due_km','status','cost','notes','created_at','updated_at'],
    Payments: ['payment_id','booking_id','member_id','method','amount','payment_type','provider_reference','status','paid_at','created_at','updated_at'],
    Invoices: ['invoice_id','invoice_number','booking_id','invoice_date','customer_name','tax_id','branch','billing_address','billing_email','amount','status','created_at','updated_at'],
    HeroCredits: ['credit_id','member_id','booking_id','amount','reason','created_at'],
    Partners: ['partner_id','name','mobile','vehicle_plate','vehicle_model','energy','available_from','available_until','status','created_at','updated_at'],
    AuditLog: ['log_id','actor_type','actor_id','action','detail','created_at']
  }
};

function setupHeroMoveBackend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(HERO_MOVE.SHEETS).forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  });
  return `HERO Move backend initialized: ${Object.keys(HERO_MOVE.SHEETS).length} sheets`;
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'health');
    if (action === 'health') return json_({ok:true,service:'HERO Move Backend',version:'1.0'});
    if (action === 'list') return list_(e.parameter.entity, e.parameter.limit);
    return json_({ok:false,error:'Unsupported action'});
  } catch (err) {
    return json_({ok:false,error:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    validateApiKey_(payload.api_key);
    const action = String(payload.action || '');
    if (action === 'create') return create_(payload.entity, payload.data || {});
    if (action === 'update') return update_(payload.entity, payload.id, payload.data || {});
    if (action === 'upsert') return upsert_(payload.entity, payload.id, payload.data || {});
    return json_({ok:false,error:'Unsupported action'});
  } catch (err) {
    return json_({ok:false,error:String(err.message || err)});
  }
}

function validateApiKey_(provided) {
  const required = PropertiesService.getScriptProperties().getProperty('HERO_MOVE_API_KEY');
  if (required && provided !== required) throw new Error('Unauthorized');
}

function entity_(name) {
  if (!HERO_MOVE.SHEETS[name]) throw new Error(`Unknown entity: ${name}`);
  return {name,headers:HERO_MOVE.SHEETS[name],sheet:SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)};
}

function create_(entityName, data) {
  const x = entity_(entityName);
  const now = new Date().toISOString();
  if (x.headers.includes('created_at') && !data.created_at) data.created_at = now;
  if (x.headers.includes('updated_at')) data.updated_at = now;
  x.sheet.appendRow(x.headers.map(h => value_(data[h])));
  return json_({ok:true,entity:entityName,data});
}

function update_(entityName, id, data) {
  const x = entity_(entityName);
  const idHeader = x.headers[0];
  if (!id) throw new Error('Missing id');
  const values = x.sheet.getDataRange().getValues();
  const rowIndex = values.findIndex((r,i) => i>0 && String(r[0]) === String(id));
  if (rowIndex < 1) throw new Error(`${entityName} record not found: ${id}`);
  const current = {};
  x.headers.forEach((h,i)=>current[h]=values[rowIndex][i]);
  Object.assign(current,data);
  if (x.headers.includes('updated_at')) current.updated_at = new Date().toISOString();
  x.sheet.getRange(rowIndex+1,1,1,x.headers.length).setValues([x.headers.map(h=>value_(current[h]))]);
  return json_({ok:true,entity:entityName,id,current});
}

function upsert_(entityName, id, data) {
  const x = entity_(entityName);
  const values = x.sheet.getDataRange().getValues();
  const exists = values.some((r,i)=>i>0 && String(r[0])===String(id));
  if (exists) return update_(entityName,id,data);
  data[x.headers[0]] = id;
  return create_(entityName,data);
}

function list_(entityName, limit) {
  const x = entity_(entityName);
  const values = x.sheet.getDataRange().getValues();
  const headers = values.shift() || x.headers;
  const rows = values.slice(0,Math.max(1,Math.min(Number(limit||100),500))).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
  return json_({ok:true,entity:entityName,rows});
}

function value_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
