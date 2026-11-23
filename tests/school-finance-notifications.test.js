'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {notifyPaymentGuardians}=require('../backend/services/school-finance-notifications');

function fakeDb(guardians=[{id:'guardian-1',phone:'+254700000000'}]){
 const logged=[];
 return {
  logged,
  async query(sql,params){
   if(sql.includes('SELECT s.name school_name'))return {rows:[{
    school_name:'Example School',learner_id:'learner-1',admission_no:'ADM-1',learner_name:'Learner One'
   }]};
   if(sql.includes('SELECT DISTINCT pg.id,pg.phone'))return {rows:guardians};
   if(sql.includes(') charged,'))return {rows:[{charged:'1000.00',credited:'650.00'}]};
   if(sql.includes('SELECT description,amount,due_on'))return {rows:[{description:'Tuition',amount:'1000.00'}]};
   if(sql.includes('SELECT receipt_no,payment_date,amount,payment_method'))return {rows:[
    {receipt_no:'R-001',payment_date:'2026-11-23',amount:'500.00',payment_method:'CASH'}
   ]};
   if(sql.includes('INSERT INTO communication_messages')){
    logged.push({sql,params});
    return {rowCount:1};
   }
   throw new Error(`Unexpected query: ${sql}`);
  }
 };
}

test('sends and records receipt plus current statement and balance for opted-in guardians',async()=>{
 const db=fakeDb(),sent=[];
 const result=await notifyPaymentGuardians({
  db,schoolId:'school-1',actorId:'staff-1',
  payment:{id:'payment-1',receipt_no:'R-002',amount:'150.00',payment_method:'CASH',payer_name:'Parent One',payer_relationship:'Guardian'},
  deliverSms:async input=>{sent.push(input);return {status:'SENT',provider:'TEST_SMS',providerMessageId:'provider-1'};}
 });
 assert.equal(result.sent,1);
 assert.equal(result.failed,0);
 assert.equal(sent.length,1);
 assert.match(sent[0].message,/PAYMENT RECEIPT R-002/);
 assert.match(sent[0].message,/Payer: Parent One \(Guardian\)/);
 assert.match(sent[0].message,/Updated statement: charges KES 1000\.00; payments\/credits KES 650\.00/);
 assert.match(sent[0].message,/Outstanding balance: KES 350\.00/);
 assert.match(sent[0].message,/Tuition: KES 1000\.00/);
 assert.equal(db.logged.length,1);
 assert.equal(db.logged[0].params[4],'SENT');
});

test('does not send to guardians without consent and reports skipped notification',async()=>{
 const db=fakeDb([]);let sends=0;
 const result=await notifyPaymentGuardians({
  db,schoolId:'school-1',actorId:'staff-1',
  payment:{id:'payment-1',receipt_no:'R-002',amount:'150.00',payment_method:'CASH'},
  deliverSms:async()=>{sends++;return {status:'SENT',provider:'TEST_SMS'};}
 });
 assert.equal(sends,0);
 assert.equal(result.skipped,1);
 assert.equal(result.sent,0);
 assert.equal(db.logged.length,0);
});

test('reports provider delivery failures while preserving notification history',async()=>{
 const db=fakeDb();
 const result=await notifyPaymentGuardians({
  db,schoolId:'school-1',actorId:'staff-1',
  payment:{id:'payment-1',receipt_no:'R-002',amount:'150.00',payment_method:'CASH'},
  deliverSms:async()=>{throw new Error('Provider unavailable');}
 });
 assert.equal(result.failed,1);
 assert.equal(result.recipients[0].status,'FAILED');
 assert.match(result.recipients[0].failure,/Provider unavailable/);
 assert.equal(db.logged.length,1);
 assert.equal(db.logged[0].params[4],'FAILED');
});

test('does not report an unconfigured SMS provider as delivered or queued',async()=>{
 const db=fakeDb();
 const result=await notifyPaymentGuardians({
  db,schoolId:'school-1',actorId:'staff-1',
  payment:{id:'payment-1',receipt_no:'R-002',amount:'150.00',payment_method:'CASH'},
  deliverSms:async()=>({status:'QUEUED',provider:'UNCONFIGURED'})
 });
 assert.equal(result.failed,1);
 assert.equal(result.queued,0);
 assert.match(result.recipients[0].failure,/did not confirm delivery/);
 assert.equal(db.logged[0].params[4],'FAILED');
});
