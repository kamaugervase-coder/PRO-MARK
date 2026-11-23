'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {PDFDocument}=require('pdf-lib');
const documents=require('../backend/services/school-finance-document-pdf');

const school={
 name:'Sample School',address:'P.O. Box 100',contact_phone:'0712345678',
 contact_email:'office@example.test',motto:'Learning for life',
 primary_color:'#17365D',secondary_color:'#D9A441'
};
const learner={
 id:'learner-1',admission_no:'ADM/001',first_name:'Amina',last_name:'Kamau',
 class_name:'Grade 7',is_active:true
};

async function createPdf(render){
 const response=new PassThrough();
 response.setHeader=()=>{};
 const chunks=[];
 response.on('data',chunk=>chunks.push(chunk));
 await new Promise((resolve,reject)=>{
  response.once('end',resolve);
  response.once('error',reject);
  try{render(response);}catch(error){reject(error);}
 });
 return PDFDocument.load(Buffer.concat(chunks));
}

test('ledger keeps opening balance, approved adjustments, and reversals in running totals',()=>{
 const ledger=documents.buildLedger({
  charges:[{id:'charge-1',description:'Tuition',amount:'12000.00',created_at:'2026-01-02T08:00:00Z'}],
  payments:[
   {id:'payment-1',receipt_no:'RCP-1',amount:'5000.00',payment_date:'2026-01-03',created_at:'2026-01-03T08:00:00Z',status:'CONFIRMED'},
   {id:'payment-2',receipt_no:'RCP-2',amount:'2000.00',payment_date:'2026-01-04',created_at:'2026-01-04T08:00:00Z',status:'CONFIRMED',credit_note_no:'CN-2',reversed_at:'2026-01-05T08:00:00Z'}
  ],
  adjustments:[
   {id:'opening',adjustment_type:'OPENING_BALANCE',direction:'DEBIT',amount:'5000.00',status:'APPROVED'},
   {id:'discount',adjustment_type:'DISCOUNT',direction:'CREDIT',amount:'500.00',reason:'Approved discount',created_at:'2026-01-06T08:00:00Z',status:'APPROVED'},
   {id:'pending',adjustment_type:'BURSARY',direction:'CREDIT',amount:'900.00',created_at:'2026-01-07T08:00:00Z',status:'PENDING'}
  ]
 });

 assert.equal(ledger.openingBalance,5000);
 assert.equal(ledger.totalDebits,14000);
 assert.equal(ledger.totalCredits,7500);
 assert.equal(ledger.closingBalance,11500);
 assert.equal(ledger.transactions.at(-1).balance,ledger.closingBalance);
 assert.equal(ledger.transactions.some(row=>row.description.includes('CN-2')),true);
 assert.equal(ledger.status,'OUTSTANDING');
});

test('credit balances are classified separately from outstanding balances',()=>{
 const ledger=documents.buildLedger({
  payments:[{id:'payment-1',amount:'250.00',payment_date:'2026-01-03',status:'CONFIRMED'}]
 });
 assert.equal(ledger.closingBalance,-250);
 assert.equal(ledger.status,'CREDIT');
});

test('database timestamps render as calendar dates instead of JavaScript date labels',()=>{
 const ledger=documents.buildLedger({
  charges:[{id:'charge-1',description:'Tuition',amount:'100.00',created_at:new Date('2026-01-02T08:00:00Z')}]
 });
 assert.equal(ledger.transactions[1].date,'2026-01-02');
});

test('financial PDFs use their selected physical page sizes and paginate statements',async()=>{
 const feePdf=await createPdf(res=>documents.renderFeeStructure({
  res,school,fee:{id:'fee-1',year_label:'2026',term_name:'Term 1',class_name:'Grade 7'},
  items:[{name:'Tuition Fees',amount:'12000.00'},{name:'Activity Fees',amount:'1500.00'}]
 }));
 assert.equal(feePdf.getPageCount(),1);
 assert.deepEqual(feePdf.getPage(0).getSize(),{width:595.28,height:841.89});

 const ledger=documents.buildLedger({
  charges:Array.from({length:80},(_,index)=>({
   id:`charge-${String(index).padStart(3,'0')}`,
   description:`Fee item ${index+1} with a detailed charge description`,
   amount:'100.00',created_at:`2026-${String(Math.floor(index/28)+1).padStart(2,'0')}-${String((index%28)+1).padStart(2,'0')}T08:00:00Z`
  }))
 });
 const statementPdf=await createPdf(res=>{
  const pdf=documents.startPdf(res,'statement.pdf',school);
  documents.drawStatement({pdf,school,learner,ledger,reference:'ST-2026-TEST-1'});
  pdf.end();
 });
 assert.ok(statementPdf.getPageCount()>1);
 assert.deepEqual(statementPdf.getPage(0).getSize(),{width:595.28,height:841.89});

 const payment={
  id:'payment-1',receipt_no:'RCP-1',amount:'5000.00',payment_date:'2026-01-03',
  created_at:'2026-01-03T08:00:00Z',payment_method:'MPESA',reference:'ABC123',
  notes:'School fees',payer_name:'Parent Name',payer_relationship:'Parent',
  ...learner,year_label:'2026',term_name:'Term 1',recorder_first_name:'Jane',recorder_last_name:'Bursar'
 };
 for(const [format,size] of [
  ['A5',{width:419.53,height:595.28}],
  ['A6',{width:297.64,height:419.53}],
  ['THERMAL',{width:226.77,height:900}]
 ]){
  const pdf=await createPdf(res=>documents.renderReceipt({res,school,payment,learner,ledger,format}));
  assert.equal(pdf.getPageCount(),1,`${format} should fit on one page`);
  assert.deepEqual(pdf.getPage(0).getSize(),size);
 }
});
