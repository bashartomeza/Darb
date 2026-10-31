import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import fs from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const evidenceDir=resolve(root,'.staging-data/cargo-batching-evidence');
fs.mkdirSync(evidenceDir,{recursive:true});
const require=createRequire(root+'/package.json');
const express=require('express'),mysql=require('mysql2/promise');
const db=new URL(process.env.DATABASE_URL);
assert(['127.0.0.1','localhost'].includes(db.hostname)&&db.pathname.endsWith('_ci')&&process.env.MERCHANT_ORDER_INTEGRATION_CONFIRM_DISPOSABLE==='true','explicit_disposable_database_required');
const {prisma}=await import(pathToFileURL(root+'/apps/api/dist/lib/prisma.js'));
const {createApp}=await import(pathToFileURL(root+'/apps/api/dist/app.js'));
const {signAuthToken}=await import(pathToFileURL(root+'/apps/api/dist/middleware/auth.js'));
const {expireLegacyDispatches}=await import(pathToFileURL(root+'/apps/api/dist/services/legacyDispatch.js'));
const {LOCKED_CORRIDOR_KEY}=await import(pathToFileURL(root+'/apps/api/dist/modules/demoReset.js'));
const prefix='task14a_'+randomUUID();
const actors=[],tokens=new Map(),orderIds=[],routeIds=[],failures=[],scenarios=[],snapshots=[];
let assertions=0,server,origin,dropBatch=false,droppedResponses=0;
const ddl=await mysql.createConnection(db.toString());
const trigger='t14a_'+randomUUID().replaceAll('-','');
let triggerCreated=false,canonicalCatalog,canonicalVersion;const canonicalStops=[];
function check(value,message){assertions++;if(!value)failures.push(message);}
async function actor(role='merchant'){
 const id=prefix+'_'+actors.length;
 await prisma.user.create({data:{id,name:'SYNTHETIC Task14A',phone:'+1202'+String(1000000+Math.floor(Math.random()*8999999)),email:id+'@example.invalid',role,profile_state:'complete',email_verified_at:new Date()}});
 const session=await prisma.authSession.create({data:{user_id:id,client_type:'mobile',security_version_at_issue:1,expires_at:new Date(Date.now()+3600000)}});
 actors.push(id);tokens.set(id,signAuthToken({id,role,sessionId:session.id,securityVersion:1}));return id;
}
async function start(){
 const app=express();app.use((req,res,next)=>{const send=res.json.bind(res);res.json=body=>{if(dropBatch&&req.method==='POST'&&req.originalUrl.endsWith('/batch')&&res.statusCode===201){dropBatch=false;droppedResponses++;res.destroy();return res;}return send(body);};next();});app.use(createApp());
 server=app.listen(0,'127.0.0.1');await new Promise(ok=>server.once('listening',ok));origin='http://127.0.0.1:'+server.address().port+'/api/v1';
}
async function stop(){server?.closeAllConnections();await new Promise(ok=>server.close(ok));}
async function call(who,method,path,body,headers={}){
 const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(tokens.has(who)?{authorization:'Bearer '+tokens.get(who)}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 return {status:response.status,body:await response.json()};
}
function payload(n=1,lat=31.5326){return{pickup_label:'SYNTHETIC Task14A pickup',pickup_lat:lat,pickup_lng:35.0998,parcels:Array.from({length:n},()=>({destination_label:'SYNTHETIC Bethlehem',destination_lat:31.7054,destination_lng:35.2024,size:'S',priority:'normal'}))};}
async function order(who,n=1,lat=31.5326){const r=await call(who,'POST','/merchant/orders',payload(n,lat),{'idempotency-key':'task14a-'+randomUUID()});assert.equal(r.status,201,'order fixture');orderIds.push(r.body.order.id);return r.body.order.id;}
const batch=(who,id)=>call(who,'POST','/merchant/orders/'+id+'/batch',{});
const cancel=(who,id)=>call(who,'PATCH','/merchant/orders/'+id+'/cancel',{});
const match=(who,id)=>call(who,'POST','/matches/run',{merchantOrderId:id});
async function inspect(label,ids,routeId){
 const orders=await prisma.merchantOrder.findMany({where:{id:{in:ids}},select:{id:true,merchant_id:true,status:true}});
 const members=await prisma.parcelBatchOrder.findMany({where:{merchant_order_id:{in:ids}},select:{parcel_batch_id:true,merchant_order_id:true,active:true,active_membership_key:true}});
 const parcels=await prisma.parcel.findMany({where:{order_id:{in:ids}},select:{id:true,order_id:true,status:true,batch_id:true}});
 const batches=await prisma.parcelBatch.findMany({where:{id:{in:[...new Set(members.map(m=>m.parcel_batch_id))]}},select:{id:true,status:true,driver_route_id:true}});
 const matches=await prisma.match.findMany({where:{merchant_order_id:{in:ids}},select:{id:true,status:true,legacy_capacity_held:true,parcel_batch_id:true}});
 const audits=await prisma.auditEvent.groupBy({by:['action'],where:{user_id:{in:orders.map(o=>o.merchant_id)}},_count:true});
 const route=routeId?await prisma.driverRoute.findUnique({where:{id:routeId},select:{id:true,seats_available:true,parcel_capacity_available:true,status:true}}):null;
 const value={label,orders,members,parcels,batches,matches,audits,route};snapshots.push(value);
 check(ids.every(id=>members.filter(m=>m.merchant_order_id===id&&m.active).length<=1),label+': at most one active membership per order');
 console.log(JSON.stringify({phase:label,orders:orders.length,parcels:parcels.length,batches:batches.length,active_memberships:members.filter(m=>m.active).length,held_matches:matches.filter(m=>m.legacy_capacity_held).length,parcel_capacity:route?.parcel_capacity_available}));return value;
}
async function scenario(name,run){const before=failures.length;await run();const value={name,result:failures.length===before?'PASS':'FAIL'};scenarios.push(value);fs.writeFileSync(evidenceDir+'/cargo-integrity-progress.json',JSON.stringify({result:'INCOMPLETE',assertions,failures,scenarios,snapshots},null,2)+'\n');console.log(JSON.stringify({scenario:name,result:value.result,new_failures:failures.slice(before)}));}
// These barriers only schedule real Prisma reads/transactions. They never mock
// query results or writes and are always removed before another scenario.
async function pauseRead(model,method,predicate,startOperation,concurrent){
 const transaction=prisma.$transaction.bind(prisma);let observed,release,paused=false;
 const seen=new Promise(ok=>observed=ok),resume=new Promise(ok=>release=ok);
 prisma.$transaction=(callback,options)=>transaction(tx=>callback(new Proxy(tx,{get(target,key){if(key!==model)return Reflect.get(target,key);return new Proxy(target[key],{get(delegate,query){if(query!==method)return Reflect.get(delegate,query);return async args=>{const value=await delegate[query](args);if(!paused&&predicate(args)){paused=true;observed();await resume;}return value;};}});}})),options);
 let pending;try{pending=startOperation();await Promise.race([seen,new Promise((_,fail)=>setTimeout(()=>fail(Error('scheduling_barrier_not_reached')),10000))]);await concurrent();release();return await pending;}finally{release();if(pending)await pending.catch(()=>{});prisma.$transaction=transaction;}
}
let driver,profile;
async function supply(who=driver){
 await prisma.driverRoute.updateMany({where:{operational_mode:'legacy',status:'active'},data:{status:'inactive'}});
 const r=await call(who,'POST','/driver/routes',{seats_available:4,parcel_capacity_available:20});assert.equal(r.status,201,'supply fixture');routeIds.push(r.body.route.id);return r.body.route.id;
}
const originalRoutes=await prisma.driverRoute.findMany({where:{operational_mode:'legacy'},select:{id:true,status:true}});
await start();
try{
 driver=await actor('driver');profile=await prisma.driverProfile.create({data:{user_id:driver,vehicle_type:'van',verified:true,seats_total:4,parcel_capacity:20}});
 await scenario('compatible real orders, ownership and pickup isolation',async()=>{
  const a=await actor(),b=await actor(),ids=[await order(a,2),await order(a,3)],far=await order(a,1,31.56),other=await order(b,2);
  check((await batch(b,ids[0])).status===403,'other merchant cannot batch owner order');check((await batch(driver,ids[0])).status===403,'driver cannot batch');check((await batch('anonymous',ids[0])).status===401,'anonymous cannot batch');
  const made=await batch(a,ids[0]);assert.equal(made.status,201);const s=await inspect('compatible', [...ids,far,other]);
  check(s.batches.length===1&&s.members.length===2&&s.parcels.filter(p=>p.batch_id===made.body.batch.id).length===5,'two compatible real orders and five parcels only');
  check(s.orders.find(o=>o.id===far).status==='submitted'&&s.orders.find(o=>o.id===other).status==='submitted','incompatible and cross-owner orders remain eligible');
  check((await batch(a,ids[1])).status===409,'duplicate through secondary order rejected');check(await prisma.auditEvent.count({where:{action:'parcel_batch_created',entity_id:made.body.batch.id}})===1,'single batch audit');
  assert.equal((await cancel(a,ids[1])).status,200);const ended=await inspect('cancel-whole-batch',ids);check(ended.orders.every(o=>o.status==='cancelled')&&ended.parcels.every(p=>p.status==='cancelled')&&ended.members.every(m=>!m.active&&m.active_membership_key===null),'secondary cancellation cancels every member, preserves whole-batch rule');
  check(await prisma.auditEvent.count({where:{user_id:a,action:'admin_action',entity_type:'MerchantOrder'}})===1,'whole-batch cancellation has exactly one cancellation audit');
 });
 await scenario('concurrent batching from different starting orders and double clicks',async()=>{
  const a=await actor(),ids=[await order(a,2),await order(a,1)];
  const responses=await Promise.all(Array.from({length:8},(_,i)=>batch(a,ids[i%2])));
  check(responses.filter(r=>r.status===201).length===1,'one batch creation under concurrent starting orders');check(responses.every(r=>r.status===201||r.status===409),'concurrent batching returns only success/conflict');
  const s=await inspect('concurrent-eight',ids);check(s.batches.length===1&&s.members.length===2&&s.parcels.every(p=>p.batch_id===s.batches[0].id&&p.status==='batched'),'exact one two-order batch without partial membership');
 });
 await scenario('fifty order and fifty parcel bounds preserve remaining orders',async()=>{
  const a=await actor(),ids=[];for(let i=0;i<51;i++)ids.push(await order(a));
  const made=await batch(a,ids[50]);assert.equal(made.status,201);const s=await inspect('fifty-orders',ids);
  check(s.members.length===50&&s.parcels.filter(p=>p.batch_id).length===50,'batch capped at fifty orders');check(s.orders.filter(o=>o.status==='submitted').length===1,'unselected order remains submitted');
  const b=await actor(),many=[];for(let i=0;i<6;i++)many.push(await order(b,10));
  const fifty=await batch(b,many[0]);assert.equal(fifty.status,201);const f=await inspect('fifty-parcels',many);
  check(f.members.length===5&&f.parcels.filter(p=>p.batch_id).length===50,'batch capped at fifty parcels');check(f.parcels.filter(p=>!p.batch_id&&p.status==='pending').length===10,'overflow parcels preserved pending');
  await supply();check((await match(b,many[0])).status===404,'fifty-unit batch does not invent supply above existing twenty-unit route limit');
 });
 await scenario('cancellation wins before batching conditional claim',async()=>{
  const a=await actor(),ids=[await order(a),await order(a)];
  const r=await pauseRead('merchantOrder','findUnique',args=>args.where.id===ids[0],()=>batch(a,ids[0]),async()=>assert.equal((await cancel(a,ids[0])).status,200));
  check(r.status===409,'stale batch rejects cancelled seed');const s=await inspect('cancel-before-claim',ids);check(!s.batches.length&&!s.members.length&&s.orders.find(o=>o.id===ids[1]).status==='submitted','failed batch leaves no rows and preserves other order');
  const retry=await batch(a,ids[1]);check(retry.status===201,'remaining eligible order batches normally');
 });
 await scenario('batching wins against stale unbatched cancellation',async()=>{
  const a=await actor(),ids=[await order(a),await order(a)];
  const r=await pauseRead('merchantOrder','findFirst',args=>args.where.id===ids[0],()=>cancel(a,ids[0]),async()=>assert.equal((await batch(a,ids[0])).status,201));
  check(r.status===409,'stale cancellation does not partially cancel newly batched demand');const s=await inspect('batch-before-cancel',ids);check(s.orders.every(o=>o.status==='batched')&&s.parcels.every(p=>p.status==='batched')&&s.members.every(m=>m.active),'batch remains consistent after stale cancellation');
  assert.equal((await cancel(a,ids[0])).status,200);
 });
 await scenario('database audit failure rolls back batch, memberships, parcels and claims',async()=>{
  const a=await actor(),ids=[await order(a,2),await order(a)];
  await ddl.query(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_events FOR EACH ROW BEGIN IF NEW.user_id = ${ddl.escape(a)} AND NEW.action = 'parcel_batch_created' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic_task14a_rollback'; END IF; END`);triggerCreated=true;
  const r=await batch(a,ids[0]);check(r.status===500,'real MySQL audit trigger rejects transaction');await ddl.query(`DROP TRIGGER \`${trigger}\``);triggerCreated=false;
  const s=await inspect('audit-rollback',ids);check(!s.batches.length&&!s.members.length&&s.orders.every(o=>o.status==='submitted')&&s.parcels.every(p=>p.status==='pending'&&p.batch_id===null),'no partial batch or changed order/parcel survives rollback');
  check((await batch(a,ids[0])).status===201,'eligible orders retry safely after rollback');
 });
 await scenario('committed lost batch response reconciles and survives API restart',async()=>{
  const a=await actor(),ids=[await order(a,2),await order(a)];dropBatch=true;await assert.rejects(batch(a,ids[0]));assertions++;
  const recovered=await call(a,'GET','/merchant/orders/'+ids[0]);check(recovered.status===200&&recovered.body.order.status==='batched'&&recovered.body.order.parcel_batches.length===1,'read-only recovery finds original saved batch');
  const original=recovered.body.order.parcel_batches[0].id;await stop();await start();
  const restarted=await call(a,'GET','/merchant/orders/'+ids[1]);check(restarted.status===200&&restarted.body.order.parcel_batches[0].id===original,'secondary order recovers same batch after API application restart');
  check((await batch(a,ids[0])).status===409,'explicit duplicate after authoritative read cannot create another batch');
  const s=await inspect('lost-response-recovery',ids);check(s.batches.length===1&&s.members.length===2&&await prisma.auditEvent.count({where:{entity_id:original,action:'parcel_batch_created'}})===1&&droppedResponses===1,'one batch/membership set/audit across response loss and restart');
 });
 await scenario('rejection, retry, concurrent rejection and offered-batch cancellation',async()=>{
  const a=await actor(),route=await supply(),ids=[await order(a,2),await order(a)];assert.equal((await batch(a,ids[0])).status,201);
  const offer=await match(a,ids[0]);assert.equal(offer.status,201);let s=await inspect('offered',ids,route);check(s.route.parcel_capacity_available===17&&s.route.seats_available===4,'offer holds exactly three parcel units and zero seats');
  const rejects=await Promise.all(Array.from({length:6},()=>call(driver,'POST','/matches/'+offer.body.match.id+'/reject',{})));
  check(rejects.filter(r=>r.status===200).length===1&&rejects.every(r=>r.status===200||r.status===409),'only one concurrent rejection commits');
  s=await inspect('rejected-once',ids,route);check(s.route.parcel_capacity_available===20&&s.orders.every(o=>o.status==='batched')&&s.batches[0].status==='created'&&s.matches.every(m=>!m.legacy_capacity_held),'rejection releases exactly once and restores manual-match eligibility');
  check(await prisma.auditEvent.count({where:{entity_id:offer.body.match.id,action:'match_rejected'}})===1,'concurrent rejection creates exactly one rejection audit');
  const retry=await match(a,ids[1]);assert.equal(retry.status,201);check(retry.body.match.parcel_batch_id===s.batches[0].id,'secondary-order retry matches original batch');
  const cancelled=await Promise.all([cancel(a,ids[0]),cancel(a,ids[1])]);check(cancelled.filter(r=>r.status===200).length===1&&cancelled.every(r=>r.status===200||r.status===409),'competing whole-batch cancellations have one winner');
  s=await inspect('offered-batch-cancelled',ids,route);check(s.route.parcel_capacity_available===20&&s.orders.every(o=>o.status==='cancelled')&&s.parcels.every(p=>p.status==='cancelled')&&s.members.every(m=>!m.active)&&s.matches.every(m=>!m.legacy_capacity_held),'one release, all members cancelled, no held offers');
  check(await prisma.auditEvent.count({where:{user_id:a,action:'admin_action',entity_type:'MerchantOrder'}})===1,'competing cancellations create exactly one cancellation audit');
  check((await match(a,ids[0])).status===409,'invalidated batch cannot rematch');
 });
 await scenario('driver acceptance wins against secondary-member cancellation',async()=>{
  const a=await actor(),route=await supply(),ids=[await order(a,2),await order(a)];assert.equal((await batch(a,ids[0])).status,201);const offer=await match(a,ids[0]);assert.equal(offer.status,201);let accepted;
  const r=await pauseRead('merchantOrder','findFirst',args=>args.where.id===ids[1],()=>cancel(a,ids[1]),async()=>{accepted=await call(driver,'POST','/matches/'+offer.body.match.id+'/accept',{});assert.equal(accepted.status,201);});
  check(r.status===409,'stale secondary cancellation rejects after acceptance');let s=await inspect('acceptance-winner',ids,route);check(s.orders.every(o=>o.status==='assigned')&&s.parcels.every(p=>p.status==='assigned')&&s.batches[0].status==='assigned'&&s.route.parcel_capacity_available===17,'accepted batch is not returned to pending or released');
  const tripPath='/trips/'+accepted.body.trip.id;for(const status of ['pickup_started','picked_up','in_transit'])assert.equal((await call(driver,'POST',tripPath+'/status',{status})).status,200,'existing trip progression');
  check((await call(driver,'POST',tripPath+'/status',{status:'delivered'})).status===409,'parcel delivery needs receiver confirmation');
  const confirmed=await call(driver,'POST',tripPath+'/delivery-confirmation',{method:'receiver_unavailable',reason:'Receiver did not answer door or phone'});check(confirmed.status===200&&confirmed.body.delivered===true,'receiver-unavailable fallback delivers every order on the batch trip');
  assert.equal((await call(driver,'POST',tripPath+'/status',{status:'completed'})).status,200,'existing trip progression');
  s=await inspect('completed-never-rebatched',ids,route);check(s.orders.every(o=>o.status==='completed')&&s.parcels.every(p=>p.status==='delivered'),'completed order and delivered parcels retained');check((await batch(a,ids[0])).status===409&&(await cancel(a,ids[1])).status===409&&(await match(a,ids[0])).status===409,'completed delivery cannot reenter batching/matching/cancellation');
 });
 await scenario('cancellation wins before driver acceptance locks',async()=>{
  const a=await actor(),route=await supply(),ids=[await order(a,2),await order(a)];assert.equal((await batch(a,ids[0])).status,201);const offer=await match(a,ids[0]);assert.equal(offer.status,201);
  const r=await pauseRead('match','findUnique',args=>args.where.id===offer.body.match.id,()=>call(driver,'POST','/matches/'+offer.body.match.id+'/accept',{}),async()=>assert.equal((await cancel(a,ids[1])).status,200));
  check(r.status===409,'acceptance rejects after cancellation commits');const s=await inspect('cancellation-winner',ids,route);check(s.orders.every(o=>o.status==='cancelled')&&s.route.parcel_capacity_available===20&&s.matches.every(m=>!m.legacy_capacity_held),'cancel winner holds no capacity');check(await prisma.trip.count({where:{parcel_batch_id:s.batches[0].id}})===0,'cancel winner creates no trip');
 });
 await scenario('offer expiry preserves batch and permits manual retry without duplicate release',async()=>{
  const a=await actor(),route=await supply(),ids=[await order(a,2),await order(a)];assert.equal((await batch(a,ids[0])).status,201);const offer=await match(a,ids[0]);assert.equal(offer.status,201);
  await prisma.match.update({where:{id:offer.body.match.id},data:{expires_at:new Date(Date.now()-1000)}});await expireLegacyDispatches(prisma);await expireLegacyDispatches(prisma);
  const s=await inspect('offer-expired-twice',ids,route);check(s.route.parcel_capacity_available===20&&s.batches[0].status==='created'&&s.members.every(m=>m.active)&&s.orders.every(o=>o.status==='batched')&&s.parcels.every(p=>p.status==='batched'),'expiry releases one hold and preserves eligible batch');check(s.matches.every(m=>m.status==='expired'&&!m.legacy_capacity_held),'expiry terminal offer retains no hold');
  check(await prisma.auditEvent.count({where:{entity_id:offer.body.match.id,action:'match_decision'}})===2,'one creation decision and one expiry decision, with no duplicate expiry audit');
  const retry=await match(a,ids[0]);check(retry.status===201,'explicit matching retry after offer expiry succeeds');assert.equal((await cancel(a,ids[0])).status,200);check((await prisma.driverRoute.findUnique({where:{id:route}})).parcel_capacity_available===20,'retry then cancellation releases exactly original allocation');
 });
 await scenario('invalidated standalone offer preserves eligible order for manual batching',async()=>{
  const a=await actor(),b=await actor(),route=await supply(),solo=await order(a,2),group=[await order(b),await order(b)];
  const old=await match(a,solo);assert.equal(old.status,201);assert.equal((await batch(b,group[0])).status,201);const competing=await match(b,group[0]);assert.equal(competing.status,201);
  assert.equal((await call(driver,'POST','/matches/'+competing.body.match.id+'/accept',{})).status,201);
  const s=await inspect('standalone-invalidated',[solo,...group],route);
  check(s.orders.find(o=>o.id===solo).status==='submitted','invalidated standalone cargo returns to submitted');
  check(s.orders.filter(o=>group.includes(o.id)).every(o=>o.status==='assigned')&&s.route.parcel_capacity_available===18,'accepted competing batch retains assigned state and its two-unit hold');
  check(s.matches.find(m=>m.id===old.body.match.id).status==='invalidated'&&!s.matches.find(m=>m.id===old.body.match.id).legacy_capacity_held,'obsolete standalone offer is invalidated without a hold');
  check(s.parcels.filter(p=>p.order_id===solo).every(p=>p.status==='pending'&&p.batch_id===null),'standalone parcels remain eligible and unbatched');
  const recovered=await batch(a,solo);check(recovered.status===201,'public API standalone order can enter manual batching after invalidation');
  if(recovered.status===201){
   const duplicateSupply=await call(driver,'POST','/driver/routes',{seats_available:4,parcel_capacity_available:20});
   check(duplicateSupply.status===409&&duplicateSupply.body.error==='route_already_active','assigned Driver cannot create a conflicting active route');
   const otherDriver=await actor('driver');
   await prisma.driverProfile.create({data:{user_id:otherDriver,vehicle_type:'van',verified:true,seats_total:4,parcel_capacity:20}});
   const nextRoute=await supply(otherDriver),again=await match(a,solo);
   check((await prisma.driverRoute.findUnique({where:{id:route}})).status==='assigned','alternate supply leaves accepted Driver route assigned');check(again.status===201,'recovered cargo can explicitly match available supply');assert.equal((await cancel(a,solo)).status,200);check((await prisma.driverRoute.findUnique({where:{id:nextRoute}})).parcel_capacity_available===20,'recovered demand cancellation releases only its current hold');}
  check((await prisma.driverRoute.findUnique({where:{id:route}})).parcel_capacity_available===18,'recovery does not release accepted competitor capacity');
 });
 await scenario('canonical records and feature gates remain isolated',async()=>{
  const a=await actor(),admin=await actor('admin'),id=prefix+'_canonical';
  const catalog=await prisma.serviceRoute.create({data:{route_key:prefix,route_group_key:prefix,service_region_key:prefix,direction:'outbound',created_by_user_id:admin}});canonicalCatalog=catalog.id;
  const version=await prisma.serviceRouteVersion.create({data:{service_route_id:catalog.id,version_number:1,name_ar:'SYNTHETIC',name_en:'SYNTHETIC',created_by_user_id:admin}});canonicalVersion=version.id;
  for(let i=0;i<2;i++){const stop=await prisma.stop.create({data:{stop_key:prefix+'_'+i,service_region_key:prefix,name_ar:'SYNTHETIC',name_en:'SYNTHETIC',latitude:'31.5',longitude:'35.1',created_by_user_id:admin}});canonicalStops.push(stop.id);await prisma.routeVersionStop.create({data:{service_route_version_id:version.id,stop_id:stop.id,sequence:i+1}});}
  const from=new Date(Date.now()+5400000),until=new Date(from.getTime()+3600000);
  await prisma.merchantOrder.create({data:{id,merchant_id:a,pickup_label:'SYNTHETIC canonical boundary',pickup_lat:'31.532600',pickup_lng:'35.099800',canonical_entry_version:'canonical_route_v1',operational_mode:'canonical_route_v1',route_version_id:version.id,pickup_stop_id:canonicalStops[0],requested_departure_from:from,requested_departure_until:until,canonical_created_at:new Date()}});orderIds.push(id);
  await prisma.parcel.create({data:{order_id:id,destination_label:'SYNTHETIC canonical',destination_lat:'31.705400',destination_lng:'35.202400',size:'S',priority:'normal',canonical_entry_version:'canonical_route_v1',operational_mode:'canonical_route_v1',route_version_id:version.id,destination_stop_id:canonicalStops[1]}});
  const legacy=await order(a);check((await batch(a,id)).status===409,'canonical marker never enters legacy batching');const made=await batch(a,legacy);assert.equal(made.status,201);const s=await inspect('canonical-boundary',[legacy,id]);check(s.members.length===1&&s.members[0].merchant_order_id===legacy&&s.orders.find(o=>o.id===id).status==='submitted','legacy pooling leaves canonical record untouched');
  check(process.env.CANONICAL_SHARED_TRIPS_ENABLED==='false'&&process.env.MULTI_ROUTE_MATCHING_ENABLED==='false','legacy run keeps canonical matching/shared gates disabled');
  await assert.rejects(prisma.merchantOrder.update({where:{id:legacy},data:{requested_departure_until:new Date(Date.now()-1000)}}),error=>JSON.stringify(error).includes('merchant_orders_canonical_shape_chk'));assertions++;
  check((await prisma.merchantOrder.findUnique({where:{id:legacy}})).requested_departure_until===null,'existing shape CHECK prevents unsupported legacy deadline rows; do not fabricate expiry policy');
 });
 const result={suite:'legacy_cargo_batch_integrity_real_mysql',result:failures.length?'FAIL':'PASS',assertions,failures,scenarios,snapshots,dropped_committed_batch_responses:droppedResponses,scope:'Real API/Prisma/MySQL; test-only read scheduling barriers, synthetic audit trigger and committed response loss. No external provider; canonical gates remain false. HTTP application restart here, OS/browser restart separately.'};
 fs.writeFileSync(evidenceDir+'/cargo-integrity-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({suite:result.suite,result:result.result,assertions,failures,scenarios:scenarios.length}));process.exitCode=failures.length?1:0;
}finally{
 if(triggerCreated)await ddl.query(`DROP TRIGGER \`${trigger}\``).catch(()=>{});
 const batches=await prisma.parcelBatch.findMany({where:{merchant_order_id:{in:orderIds}},select:{id:true}}),batchIds=batches.map(b=>b.id);
 await prisma.idempotencyRecord.deleteMany({where:{operation:'legacy_merchant_order_create_v1',resource_id:{in:orderIds}}});
 await prisma.trip.deleteMany({where:{driver_route_id:{in:routeIds}}});await prisma.match.deleteMany({where:{OR:[{merchant_order_id:{in:orderIds}},{driver_route_id:{in:routeIds}}]}});
 await prisma.parcelBatchOrder.deleteMany({where:{parcel_batch_id:{in:batchIds}}});await prisma.parcelBatch.deleteMany({where:{id:{in:batchIds}}});await prisma.parcel.deleteMany({where:{order_id:{in:orderIds}}});await prisma.merchantOrder.deleteMany({where:{id:{in:orderIds}}});
 await prisma.driverRoute.deleteMany({where:{id:{in:routeIds}}});await prisma.driverProfile.deleteMany({where:{user_id:{in:actors}}});
 if(canonicalVersion){await prisma.routeVersionStop.deleteMany({where:{service_route_version_id:canonicalVersion}});await prisma.serviceRouteVersion.delete({where:{id:canonicalVersion}});}if(canonicalCatalog)await prisma.serviceRoute.delete({where:{id:canonicalCatalog}});await prisma.stop.deleteMany({where:{id:{in:canonicalStops}}});
 await prisma.auditEvent.deleteMany({where:{user_id:{in:actors}}});await prisma.user.deleteMany({where:{id:{in:actors}}});
 for(const original of originalRoutes)await prisma.driverRoute.update({where:{id:original.id},data:{status:original.status}});
 await ddl.end();await stop();await prisma.$disconnect();
}
