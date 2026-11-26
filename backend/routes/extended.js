const express=require('express');
const db=require('../db');
const {authenticate,roles,schoolBoundary}=require('../middleware/auth');
const router=express.Router();router.use(authenticate);
const ADMIN=['SCHOOL_ADMIN','ADMIN','HEADTEACHER','DEPUTY_HEADTEACHER','SENIOR_TEACHER'];
const types={
 transport_routes:['name','route_code','pickup_point','driver_name','vehicle_registration','fee_amount','notes'],
 transport_allocations:['learner_id','route_id','pickup_point','status','notes'],
 boarding_rooms:['name','dormitory','capacity','gender','notes'],
 boarding_allocations:['learner_id','room_id','bed_number','status','notes'],
 hr_leave:['staff_name','leave_type','start_date','end_date','status','reason'],
 hr_training:['title','staff_name','training_date','provider','status','notes'],
 transport_trips:['route_id','trip_date','departure_time','arrival_time','driver_name','status','notes'],
 transport_maintenance:['vehicle_registration','service_date','service_type','cost','next_service_date','notes'],
 transport_incidents:['incident_date','vehicle_registration','description','action_taken','reported_by','status'],
 boarding_rollcalls:['rollcall_date','dormitory','supervisor','present_count','absent_count','notes'],
 boarding_welfare:['learner_id','record_date','category','description','action_taken','recorded_by'],
 boarding_supplies:['item_name','quantity','unit','issued_date','issued_to','notes'],
 hr_recruitment:['position','department','opening_date','closing_date','status','notes'],
 hr_appraisals:['staff_name','review_date','reviewer','rating','strengths','development_plan'],
 hr_documents:['staff_name','document_type','reference','expiry_date','notes']
};
const valid=(v)=>typeof v==='string'&&v.trim().length>0&&v.length<=300;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses={transport_allocations:['ACTIVE','INACTIVE'],boarding_allocations:['ACTIVE','INACTIVE'],hr_leave:['PENDING','APPROVED','REJECTED','CANCELLED']};
async function verifyRecord(sid,type,id,executor=db){
 if(!UUID.test(String(id||'')))throw Object.assign(new Error('Invalid record identifier'),{status:400});
 const q=await executor.query('SELECT id,data FROM school_module_records WHERE id=$1 AND school_id=$2 AND record_type=$3',[id,sid,type]);
 if(!q.rows.length)throw Object.assign(new Error('Related record not found in this school'),{status:400});
 return q.rows[0];
}
function normalizeRecordData(type,input,partial=false){
 const fields=types[type];if(!fields)throw Object.assign(new Error('Unknown module'),{status:404});
 const data={};
 for(const field of fields){
  const value=input?.[field];
  if(partial&&value===undefined)continue;
  if(!partial&&(value===undefined||value===null))continue;
  if(typeof value!=='string'&&typeof value!=='number')throw Object.assign(new Error('Invalid '+field),{status:400});
  const normalized=String(value).trim().slice(0,300);
  if(field==='status'&&statuses[type]&&!statuses[type].includes(normalized.toUpperCase())){
   throw Object.assign(new Error('Invalid status'),{status:400});
  }
  data[field]=field==='status'?normalized.toUpperCase():normalized;
 }
 return data;
}
async function withRecordLock(sid,callback){
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize linked-record checks and writes so concurrent allocations cannot overbook.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`zelimu-school-module-records:${sid}`]);
  const result=await callback(client);
  await client.query('COMMIT');
  return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }
}
async function validateBusiness(sid,type,data,excludeId=null,executor=db){
 if(data.learner_id){if(!UUID.test(data.learner_id))throw Error('Invalid learner ID');const q=await executor.query('SELECT id FROM learners WHERE id=$1 AND school_id=$2 AND is_active=true',[data.learner_id,sid]);if(!q.rows.length)throw Error('Active learner not found in this school');}
 if(data.route_id)await verifyRecord(sid,'transport_routes',data.route_id,executor);
 if(data.room_id)await verifyRecord(sid,'boarding_rooms',data.room_id,executor);
 if(data.capacity!==undefined&&(!Number.isInteger(Number(data.capacity))||Number(data.capacity)<1||Number(data.capacity)>2000))throw Error('Room capacity must be a whole number from 1 to 2000');
 if(data.fee_amount!==undefined&&(!Number.isFinite(Number(data.fee_amount))||Number(data.fee_amount)<0))throw Error('Route fee must be nonnegative');
 if(data.start_date&&data.end_date&&data.end_date<data.start_date)throw Error('Leave end date must be on or after start date');
 if(statuses[type]&&data.status&&!statuses[type].includes(String(data.status).toUpperCase()))throw Error('Invalid status');
 if(type==='boarding_allocations'&&data.room_id&&data.learner_id&&String(data.status||'ACTIVE').toUpperCase()==='ACTIVE'){
  const room=await verifyRecord(sid,'boarding_rooms',data.room_id,executor);
  const q=await executor.query(`SELECT id,data FROM school_module_records WHERE school_id=$1 AND record_type='boarding_allocations' AND ($2::uuid IS NULL OR id<>$2) AND upper(COALESCE(NULLIF(trim(data->>'status'),''),'ACTIVE'))='ACTIVE' AND (data->>'room_id'=$3 OR data->>'learner_id'=$4)`,[sid,excludeId,data.room_id,data.learner_id]);
  if(q.rows.some(r=>r.data.learner_id===data.learner_id))throw Object.assign(new Error('Learner already has an active boarding allocation'),{status:409});
  if(q.rows.filter(r=>r.data.room_id===data.room_id).length>=Number(room.data.capacity||0))throw Object.assign(new Error('Boarding room is at full capacity'),{status:409});
 }
 if(type==='transport_allocations'&&data.learner_id&&String(data.status||'ACTIVE').toUpperCase()==='ACTIVE'){
  const q=await executor.query(`SELECT id FROM school_module_records WHERE school_id=$1 AND record_type='transport_allocations' AND ($2::uuid IS NULL OR id<>$2) AND data->>'learner_id'=$3 AND upper(COALESCE(NULLIF(trim(data->>'status'),''),'ACTIVE'))='ACTIVE' LIMIT 1`,[sid,excludeId,data.learner_id]);
  if(q.rows.length)throw Object.assign(new Error('Learner already has an active transport allocation'),{status:409});
 }
}
router.get('/:schoolId/:type',schoolBoundary,roles(...ADMIN),async(req,res)=>{
 try{if(!types[req.params.type])return res.status(404).json({error:'Unknown module'});
 const q=await db.query('SELECT id,data,created_at,updated_at FROM school_module_records WHERE school_id=$1 AND record_type=$2 ORDER BY created_at DESC LIMIT 500',[req.params.schoolId,req.params.type]);res.json(q.rows)}catch(e){res.status(500).json({error:e.message})}
});
router.post('/:schoolId/:type',schoolBoundary,roles(...ADMIN),async(req,res)=>{
 try{const fields=types[req.params.type];if(!fields)return res.status(404).json({error:'Unknown module'});
 const data=normalizeRecordData(req.params.type,req.body||{});
 const required={transport_routes:'name',transport_allocations:'learner_id',boarding_rooms:'name',boarding_allocations:'learner_id',hr_leave:'staff_name',hr_training:'title',transport_trips:'trip_date',transport_maintenance:'vehicle_registration',transport_incidents:'incident_date',boarding_rollcalls:'rollcall_date',boarding_welfare:'learner_id',boarding_supplies:'item_name',hr_recruitment:'position',hr_appraisals:'staff_name',hr_documents:'staff_name'}[req.params.type];if(!valid(data[required]))return res.status(400).json({error:'Required: '+required});
 const q=await withRecordLock(req.params.schoolId,async client=>{
  await validateBusiness(req.params.schoolId,req.params.type,data,null,client);
  return client.query('INSERT INTO school_module_records(school_id,record_type,data,created_by) VALUES($1,$2,$3,$4) RETURNING *',[req.params.schoolId,req.params.type,JSON.stringify(data),req.user.user_id]);
 });res.status(201).json(q.rows[0]);}catch(e){res.status(e.status||400).json({error:e.message})}
});
router.patch('/:schoolId/:type/:id',schoolBoundary,roles(...ADMIN),async(req,res)=>{
 try{const fields=types[req.params.type];if(!fields)return res.status(404).json({error:'Unknown module'});const data=normalizeRecordData(req.params.type,req.body||{},true);
 const q=await withRecordLock(req.params.schoolId,async client=>{
  const old=await verifyRecord(req.params.schoolId,req.params.type,req.params.id,client);
  await validateBusiness(req.params.schoolId,req.params.type,{...old.data,...data},req.params.id,client);
  return client.query('UPDATE school_module_records SET data=data || $4::jsonb,updated_at=now() WHERE school_id=$1 AND record_type=$2 AND id=$3 RETURNING *',[req.params.schoolId,req.params.type,req.params.id,JSON.stringify(data)]);
 });if(!q.rows.length)return res.status(404).json({error:'Record not found'});res.json(q.rows[0])}catch(e){res.status(e.status||400).json({error:e.message})}
});
router.delete('/:schoolId/:type/:id',schoolBoundary,roles(...ADMIN),async(req,res)=>{try{
 const type=req.params.type,sid=req.params.schoolId,id=req.params.id;
 if(!types[type])return res.status(404).json({error:'Unknown module'});
 if(!UUID.test(id))return res.status(400).json({error:'Invalid record identifier'});
 const q=await withRecordLock(sid,async client=>{
  const childType=type==='boarding_rooms'?'boarding_allocations':type==='transport_routes'?'transport_allocations':null;
  if(childType){const refField=type==='boarding_rooms'?'room_id':'route_id';const children=await client.query(`SELECT 1 FROM school_module_records WHERE school_id=$1 AND record_type=$2 AND data->>$3=$4 LIMIT 1`,[sid,childType,refField,id]);if(children.rows.length)throw Object.assign(new Error('Remove linked learner allocations before deleting this record'),{status:409});}
  return client.query('DELETE FROM school_module_records WHERE school_id=$1 AND record_type=$2 AND id=$3 RETURNING id',[sid,type,id]);
 });res.status(q.rows.length?200:404).json(q.rows.length?{deleted:true}:{error:'Not found'});
 }catch(e){res.status(e.status||400).json({error:e.message})}});
module.exports=router;
module.exports.normalizeRecordData=normalizeRecordData;
