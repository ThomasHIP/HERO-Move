const HM={
  config:{
    supabaseUrl:'https://xuygpfswpimhtvtmoljg.supabase.co',
    publishableKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1eWdwZnN3cGltaHR2dG1vbGpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM3NDExMzEsImV4cCI6MjA2OTMxNzEzMX0.1Vr4IfsNyr2JrInzkBqFuDeTV2VRB8a3EJn75YzliQA',
    operatorSlug:'hero-move'
  },
  key:{lang:'hm_lang',vehicles:'hm_vehicles',bookings:'hm_bookings',maintenance:'hm_maintenance',drivers:'hm_drivers',customers:'hm_customers',members:'hm_members',session:'hm_session',credits:'hm_credits',creditLedger:'hm_credits',invoices:'hm_invoices',pricing:'hm_pricing',settings:'hm_settings',payments:'hm_payments',rewards:'hm_rewards',auth:'hm_auth_session'},
  state:new Map(),
  bootData:null,
  bootPromise:null,
  mode:new URLSearchParams(location.search).get('demo')==='1'?'demo':'production',
  money(n){return new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB',maximumFractionDigits:2}).format(Number(n||0))},
  uid(prefix){return `${prefix}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`},
  taxIdValid(v){return /^\d{13}$/.test(String(v||'').replace(/\D/g,''))},
  serviceHours(service=''){if(service.includes('3-Hour')||service.includes('3 Hours'))return 3;if(service.includes('5-Hour')||service.includes('5 Hours'))return 5;if(service.includes('8-Hour')||service.includes('8 Hours'))return 8;if(service.includes('Full-Day')||service.includes('Full Day'))return 10;return 2},
  overlap(a,b){const a0=new Date(a.pickupAt||`${a.date}T${a.time||'00:00'}:00+07:00`),a1=new Date(a.estimatedEndAt||a0.getTime()+this.serviceHours(a.service)*36e5),b0=new Date(b.pickupAt||`${b.date}T${b.time||'00:00'}:00+07:00`),b1=new Date(b.estimatedEndAt||b0.getTime()+this.serviceHours(b.service)*36e5);return a0<b1&&b0<a1},
  get(k,f=[]){
    if(this.state.has(k))return this.state.get(k);
    if(this.mode==='demo'){try{return JSON.parse(sessionStorage.getItem(`demo:${k}`))??f}catch{return f}}
    return f;
  },
  set(k,v){
    this.state.set(k,v);
    if(this.mode==='demo'){sessionStorage.setItem(`demo:${k}`,JSON.stringify(v));return Promise.resolve(v)}
    const entity=Object.entries(this.key).find(([,value])=>value===k)?.[0];
    if(!['vehicles','drivers','customers','pricing','invoices','maintenance'].includes(entity))return Promise.resolve(v);
    const rows=(Array.isArray(v)?v:[v]).filter(data=>!data?.id||!/^[0-9a-f-]{36}$/i.test(String(data.id)));
    if(!rows.length)return Promise.resolve(v);
    return Promise.all(rows.map(data=>this.api('save_entity',{entity,data}))).then(()=>this.refresh()).catch(error=>this.notify(error.message,'error'));
  },
  audit(){},
  invoiceNo(){return `INV-${new Date().toISOString().slice(0,7).replace('-','')}-${String(this.get(this.key.invoices).length+1).padStart(5,'0')}`},
  currentMember(){return this.get(this.key.members,[])[0]||null},
  creditBalance(memberId){
    const account=this.bootData?.creditAccount;
    if(account&&(!memberId||account.member_id===memberId))return Number(account.current_balance||0);
    return this.get(this.key.credits,[]).filter(x=>!memberId||x.member_id===memberId||x.memberId===memberId).reduce((sum,x)=>sum+Number(x.amount||0),0)
  },
  addCredits(){throw new Error('HERO Credits are awarded only by the secured server ledger')},
  isResourceBusy(type,id,bookingId){const target=this.get(this.key.bookings).find(b=>b.id===bookingId);return !!target&&this.get(this.key.bookings).filter(b=>b.id!==bookingId&&!['Cancelled','Completed'].includes(b.status)).some(b=>this.overlap(target,b)&&b[`${type}Id`]===id)},
  auth:{
    session(){try{return JSON.parse(localStorage.getItem(HM.key.auth))}catch{return null}},
    token(){return this.session()?.access_token||null},
    async request(path,body){
      const res=await fetch(`${HM.config.supabaseUrl}/auth/v1${path}`,{method:'POST',headers:{apikey:HM.config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await res.json();if(!res.ok)throw new Error(data.error_description||data.msg||data.message||'Authentication failed');
      if(data.access_token)localStorage.setItem(HM.key.auth,JSON.stringify(data));return data
    },
    signIn(email,password){return this.request('/token?grant_type=password',{email,password})},
    signUp(email,password,metadata={}){return this.request('/signup',{email,password,data:metadata})},
    async refresh(){const s=this.session();if(!s?.refresh_token)return null;return this.request('/token?grant_type=refresh_token',{refresh_token:s.refresh_token})},
    async signOut(){const token=this.token();if(token)await fetch(`${HM.config.supabaseUrl}/auth/v1/logout`,{method:'POST',headers:{apikey:HM.config.publishableKey,Authorization:`Bearer ${token}`}}).catch(()=>{});localStorage.removeItem(HM.key.auth);location.href='index.html'}
  },
  async api(action,input={}){
    const token=this.auth.token()||this.config.publishableKey;
    const res=await fetch(`${this.config.supabaseUrl}/functions/v1/hero-move-api`,{method:'POST',headers:{apikey:this.config.publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-HERO-Operator':this.config.operatorSlug},body:JSON.stringify({action,input,operatorSlug:this.config.operatorSlug})});
    let payload;try{payload=await res.json()}catch{throw new Error('The HERO Move service returned an invalid response')}
    if(res.status===401&&this.auth.session()?.refresh_token){await this.auth.refresh();return this.api(action,input)}
    if(!res.ok||!payload.ok)throw new Error(payload.error||'HERO Move service request failed');return payload.data
  },
  mapBootstrap(data){
    this.bootData=data;
    const pairs=[[this.key.vehicles,data.vehicles],[this.key.bookings,data.bookings],[this.key.maintenance,data.maintenance],[this.key.drivers,data.drivers],[this.key.customers,data.customers],[this.key.members,data.members],[this.key.credits,data.credits],[this.key.invoices,data.invoices],[this.key.pricing,data.pricing],[this.key.settings,data.settings],[this.key.payments,data.payments],[this.key.rewards,data.rewards]];
    pairs.forEach(([key,value])=>this.state.set(key,value??(key===this.key.settings?{}:[])));
    return data
  },
  seedDemo(){
    const now=new Date(),later=new Date(now.getTime()+864e5);
    const demo={mode:'demo',auth:{authenticated:true,roles:['owner']},operator:{displayName:'HERO Move Demo'},vehicles:[{id:'demo-vehicle-1',vehicleCode:'DEMO-EV-01',plate:'DEMO-001',brand:'Premium',model:'Executive EV',year:2026,vehicleClass:'Executive EV',energy:'EV',seats:4,odometer:18500,status:'Available',battery:96,notes:'Demo mode record'}],drivers:[{id:'demo-driver-1',driverCode:'DEMO-DRV-01',name:'Demo Chauffeur',mobile:'08x-xxx-0001',status:'Available',rating:4.9}],bookings:[],maintenance:[],customers:[],members:[],credits:[],invoices:[],payments:[],rewards:[],pricing:[{id:'demo-price-1',service:'Airport Transfer',serviceCode:'airport_transfer',vehicleClass:'any',price:1200,depositPct:10,active:true}],serviceProducts:[{id:'demo-service-1',code:'airport_transfer',name:'Airport Transfer',default_duration_minutes:120,active:true}],rewardRules:[{tier:1,spending_unit:100,credits_awarded:1,welcome_bonus:200}],settings:{booking:{minimum_lead_minutes:120},localization:{default:'en',supported:['en','th','zh']}},paymentSettings:{provider_mode:'disabled',deposit_percent:10,enabled_methods:['promptpay_qr','credit_card','debit_card','wallet','international']},demoExpiresAt:later.toISOString()};
    return this.mapBootstrap(demo)
  },
  async bootstrap(force=false){
    if(this.bootPromise&&!force)return this.bootPromise;
    this.bootPromise=(async()=>{try{return this.mode==='demo'?this.seedDemo():this.mapBootstrap(await this.api('bootstrap'))}catch(error){this.renderServiceError(error);throw error}})();return this.bootPromise
  },
  async refresh(){this.bootPromise=null;return this.bootstrap(true)},
  domReady(){return document.readyState==='loading'?new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true})):Promise.resolve()},
  onReady(callback){return Promise.all([this.domReady(),this.bootstrap()]).then(()=>{applyLang(localStorage.getItem(this.key.lang)||'en');if(this.guard())return callback()}).catch(()=>{})},
  guard(){
    const required=(document.body.dataset.requiresRole||'').split(',').map(x=>x.trim()).filter(Boolean);if(!required.length)return true;
    const auth=this.bootData?.auth||{};if(auth.authenticated&&auth.roles?.some(role=>required.includes(role))){document.body.classList.add('hm-authorized');return true}
    const next=encodeURIComponent(location.pathname.split('/').pop()||'admin.html');
    document.querySelector('main')?.replaceWith(Object.assign(document.createElement('main'),{className:'page-shell access-gate',innerHTML:`<section class="form-card"><span class="eyebrow">SECURE ROLE-BASED ACCESS</span><h1>${auth.authenticated?'Access restricted':'Sign in required'}</h1><p>${auth.authenticated?'This account does not have permission to view this portal.':'Operator, driver and corporate records are protected by production authentication.'}</p><div class="hero-actions"><a class="btn btn-primary" href="login.html?next=${next}">Secure Sign In</a><a class="btn btn-outline" href="index.html">Return Home</a></div></section>`}));
    document.body.classList.add('hm-authorized');return false
  },
  notify(message,type='success'){
    let box=document.getElementById('hmToast');if(!box){box=document.createElement('div');box.id='hmToast';box.className='hm-toast';document.body.appendChild(box)}box.className=`hm-toast ${type}`;box.textContent=message;box.hidden=false;setTimeout(()=>box.hidden=true,6000)
  },
  renderServiceError(error){
    if(document.getElementById('hmServiceError'))return;const box=document.createElement('div');box.id='hmServiceError';box.className='service-alert';box.innerHTML=`<strong>Secure service temporarily unavailable</strong><span>${String(error.message||error)}</span><button type="button">Retry</button>`;box.querySelector('button').onclick=()=>location.reload();document.body.prepend(box)
  },
  checkAvailability(input){return this.mode==='demo'?this.demoAvailability(input):this.api('check_availability',input)},
  calculatePricing(input){return this.mode==='demo'?this.demoQuote(input):this.api('calculate_pricing',input)},
  createBooking(input){return this.mode==='demo'?this.demoBooking(input):this.api('create_booking',input)},
  createMember(input){return this.api('create_member',input)},
  assignResources(input){return this.api('assign_resources',input)},
  updateTripStatus(input){return this.api('update_trip_status',input)},
  redeemCredits(input){return this.api('redeem_credits',input)},
  updateSettings(section,values){return this.api('update_settings',{section,values})},
  saveServiceProduct(values){return this.api('save_service_product',values)},
  saveProfileItem(values){return this.api('save_profile_item',values)},
  updatePaymentStatus(values){return this.api('update_payment_status',values)},
  createInvoice(values){return this.api('create_invoice',values)},
  generateEsgTrip(values){return this.api('generate_esg_trip',values)},
  demoQuote(input){const p=this.get(this.key.pricing).find(x=>x.serviceCode===input.serviceCode||x.service===input.service)||this.get(this.key.pricing)[0],total=Number(p?.price||1200),deposit=total*Number(p?.depositPct||10)/100;return Promise.resolve({service:{id:'demo-service-1',name:p?.service||'Airport Transfer',code:p?.serviceCode||'airport_transfer',default_duration_minutes:120},total,subtotal:total,depositPercent:p?.depositPct||10,deposit,balance:total-deposit,creditsToEarn:Math.floor(total/100),payment:this.bootData.paymentSettings})},
  async demoAvailability(input){const quote=await this.demoQuote(input),start=new Date(input.pickupAt),end=new Date(start.getTime()+Number(quote.service.default_duration_minutes)*6e4);return {quote,availability:{available:true,availableVehicleCount:1,availableDriverCount:1,pickupAt:start.toISOString(),estimatedEndAt:end.toISOString(),vehicles:this.get(this.key.vehicles),drivers:this.get(this.key.drivers)}}},
  async demoBooking(input){const result=await this.demoAvailability(input),rec={id:this.uid('DEMO-BK'),bookingNumber:this.uid('DEMO'),customer:input.customerName,mobile:input.mobile,email:input.email,pickup:input.pickup,dest1:input.destination,pickupAt:result.availability.pickupAt,estimatedEndAt:result.availability.estimatedEndAt,date:result.availability.pickupAt.slice(0,10),time:result.availability.pickupAt.slice(11,16),service:result.quote.service.name,serviceProductId:result.quote.service.id,vehicleClass:input.vehicleClass,passengers:input.passengers,status:'Pending',price:result.quote.total,deposit:result.quote.deposit,balance:result.quote.balance,paymentStatus:'Deposit Pending'};const list=this.get(this.key.bookings);list.unshift(rec);this.state.set(this.key.bookings,list);sessionStorage.setItem(`demo:${this.key.bookings}`,JSON.stringify(list));return {booking:rec,quote:result.quote,availability:result.availability,payment:{id:this.uid('DEMO-PAY'),status:'pending'}}}
};

const translations={
en:{navServices:'Services',navEnterprise:'Enterprise',navFleet:'Fleet',bookNow:'Book Now',tryBooking:'Book a Ride',openDashboard:'Open Dashboard'},
th:{navServices:'บริการ',navEnterprise:'องค์กร',navFleet:'รถในระบบ',bookNow:'จองเลย',tryBooking:'จองรถ',openDashboard:'เปิดแดชบอร์ด'},
zh:{navServices:'服务',navEnterprise:'企业版',navFleet:'车队',bookNow:'立即预订',tryBooking:'立即预订',openDashboard:'打开仪表板'}
};
function applyLang(lang='en'){if(!translations[lang])lang='en';document.documentElement.lang=lang;localStorage.setItem(HM.key.lang,lang);document.querySelectorAll('[data-i18n]').forEach(el=>{const value=translations[lang]?.[el.dataset.i18n];if(value)el.textContent=value});const sel=document.getElementById('language');if(sel)sel.value=lang}

HM.domReady().then(()=>{const lang=localStorage.getItem(HM.key.lang)||'en';applyLang(lang);const sel=document.getElementById('language');if(sel)sel.addEventListener('change',e=>applyLang(e.target.value));document.querySelectorAll('[data-demo-link]').forEach(a=>{const url=new URL(a.href,location.href);url.searchParams.set('demo','1');a.href=url.href})});
