const express=require('express');
const PDFDocument=require('pdfkit');
const db=require('../db');
const {authenticate,roles,schoolBoundary}=require('../middleware/auth');
const financeDocumentPdf=require('../services/school-finance-document-pdf');
const router=express.Router();router.use(authenticate);
const VIEW=['SCHOOL_ADMIN','ADMIN','HEADTEACHER','DEPUTY_HEADTEACHER','SENIOR_TEACHER','BURSAR'];
const WRITE=['SCHOOL_ADMIN','ADMIN','HEADTEACHER','DEPUTY_HEADTEACHER'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(v,n=250)=>String(v||'').trim().slice(0,n);
async function school(sid){const q=await db.query(`SELECT s.name,s.code,si.motto,si.address,si.contact_phone,si.contact_email,si.logo_url,si.primary_color,si.secondary_color,
 (SELECT file_url FROM school_document_assets da WHERE da.school_id=s.id AND da.asset_type='STAMP' AND da.is_active=true ORDER BY da.effective_from DESC,da.created_at DESC LIMIT 1) stamp_url
 FROM schools s LEFT JOIN school_identity si ON si.school_id=s.id WHERE s.id=$1`,[sid]);if(!q.rows[0])throw Object.assign(new Error('School not found'),{status:404});return q.rows[0]}
function pdfStart(res,name){res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${name}"`);const p=new PDFDocument({size:'A4',margin:50,info:{Title:name,Author:'ZELIMU CBC'}});p.pipe(res);return p}
function header(p,s,title){p.rect(0,0,595,12).fill('#2264c9');p.fillColor('#17345b').font('Helvetica-Bold').fontSize(18).text(s.name,{align:'center'});p.font('Helvetica').fontSize(9).fillColor('#475569').text([s.address,s.contact_phone,s.contact_email].filter(Boolean).join('  |  '),{align:'center'});p.moveDown(.7);p.strokeColor('#d6e2ef').moveTo(50,p.y).lineTo(545,p.y).stroke();p.moveDown(.8);p.fillColor('#143d75').font('Helvetica-Bold').fontSize(15).text(title,{align:'center'});p.moveDown(1.3)}
function line(p,k,v){p.font('Helvetica-Bold').fontSize(10).fillColor('#243449').text(k,55,p.y,{continued:true});p.font('Helvetica').text('  '+String(v||'—'));p.moveDown(.5)}
router.get('/:schoolId/fee-structures/:id/pdf',schoolBoundary,roles(...VIEW),async(req,res)=>{try{
 const sid=req.params.schoolId;
 if(!uuid.test(req.params.id))return res.status(400).json({error:'Invalid fee structure ID'});
 const q=await db.query(`SELECT f.*,a.year_label,t.name term_name,c.name class_name,c.stream
  FROM school_fee_structures f
  LEFT JOIN academic_years a ON a.id=f.academic_year_id AND a.school_id=f.school_id
  LEFT JOIN terms t ON t.id=f.term_id AND t.school_id=f.school_id
  LEFT JOIN classes c ON c.id=f.class_id AND c.school_id=f.school_id
  WHERE f.school_id=$1 AND f.id=$2`,[sid,req.params.id]);
 const fee=q.rows[0];
 if(!fee)return res.status(404).json({error:'Fee structure not found'});
 const [schoolInfo,items]=await Promise.all([
  school(sid),
  db.query(`SELECT id,name,amount,print_notes FROM school_fee_structures
   WHERE school_id=$1
    AND academic_year_id IS NOT DISTINCT FROM $2
    AND term_id IS NOT DISTINCT FROM $3
    AND class_id IS NOT DISTINCT FROM $4
    AND learner_category=$5
    AND applicability=$6
    AND (is_active=true OR id=$7)
   ORDER BY created_at,id`,[sid,fee.academic_year_id,fee.term_id,fee.class_id,fee.learner_category,fee.applicability,fee.id])
 ]);
 financeDocumentPdf.renderFeeStructure({res,school:schoolInfo,fee,items:items.rows});
 }catch(e){if(!res.headersSent)res.status(e.status||500).json({error:e.message});else res.end()}});
async function loadLearnerStatement(schoolId,learnerId){
 const [learner,charges,payments,adjustments]=await Promise.all([
  db.query(`SELECT l.id,l.admission_no,l.first_name,l.middle_name,l.last_name,COALESCE(l.is_active,true) is_active,c.name class_name,c.stream
   FROM learners l LEFT JOIN classes c ON c.id=l.class_id AND c.school_id=l.school_id
   WHERE l.school_id=$1 AND l.id=$2`,[schoolId,learnerId]),
  db.query(`SELECT id,description,amount,created_at,due_on FROM school_fee_charges
   WHERE school_id=$1 AND learner_id=$2 ORDER BY created_at,id`,[schoolId,learnerId]),
  db.query(`SELECT p.id,p.receipt_no,p.amount,p.payment_date,p.payment_method,p.reference,p.created_at,p.status,
    r.credit_note_no,r.created_at reversed_at
   FROM school_fee_payments p LEFT JOIN school_fee_payment_reversals r
    ON r.school_id=p.school_id AND r.payment_id=p.id
   WHERE p.school_id=$1 AND p.learner_id=$2 AND p.status='CONFIRMED'
   ORDER BY p.payment_date,p.created_at,p.id`,[schoolId,learnerId]),
  db.query(`SELECT id,adjustment_type,direction,amount,reason,created_at,status
   FROM school_finance_adjustments
   WHERE school_id=$1 AND learner_id=$2 AND status='APPROVED'
   ORDER BY created_at,id`,[schoolId,learnerId])
 ]);
 if(!learner.rows[0])return null;
 return {learner:learner.rows[0],ledger:financeDocumentPdf.buildLedger({
  charges:charges.rows,payments:payments.rows,adjustments:adjustments.rows
 })};
}

router.get('/:schoolId/fee-statements/:learnerId/pdf',schoolBoundary,roles(...VIEW),async(req,res)=>{try{
 const sid=req.params.schoolId,learnerId=req.params.learnerId;
 if(!uuid.test(learnerId))return res.status(400).json({error:'Invalid learner ID'});
 const data=await loadLearnerStatement(sid,learnerId);
 if(!data)return res.status(404).json({error:'Learner not found in this school'});
 const schoolInfo=await school(sid);
 const safeAdmission=String(data.learner.admission_no||data.learner.id).replace(/[^a-zA-Z0-9_-]/g,'-');
 const pdf=financeDocumentPdf.startPdf(res,`fee-statement-${safeAdmission}.pdf`,schoolInfo);
 financeDocumentPdf.drawStatement({pdf,school:schoolInfo,...data,reference:financeDocumentPdf.newStatementReference(data.learner)});
 pdf.end();
}catch(e){if(!res.headersSent)res.status(e.status||500).json({error:e.message});else res.end()}});
router.get('/:schoolId/fee-statements/bulk/pdf',schoolBoundary,roles(...VIEW),async(req,res)=>{try{
 const sid=req.params.schoolId,classId=String(req.query.class_id||''),balance=String(req.query.balance||'ALL').toUpperCase();
 if(classId&&(!uuid.test(classId)))return res.status(400).json({error:'Invalid class ID'});
 if(!['ALL','OUTSTANDING','CLEARED','CREDIT'].includes(balance))return res.status(400).json({error:'Invalid balance filter'});
 const learners=await db.query(`SELECT l.id FROM learners l
  WHERE l.school_id=$1 AND COALESCE(l.is_active,true)=true
   AND ($2::uuid IS NULL OR l.class_id=$2)
  ORDER BY l.class_id,l.last_name,l.first_name,l.admission_no`,[sid,classId||null]);
 const schoolInfo=await school(sid);
 const pdf=financeDocumentPdf.startPdf(res,'learner-fee-statements.pdf',schoolInfo);
 let count=0;
 for(const row of learners.rows){
  const data=await loadLearnerStatement(sid,row.id);
  if(!data)continue;
  if(balance==='OUTSTANDING'&&data.ledger.status!=='OUTSTANDING')continue;
  if(balance==='CLEARED'&&data.ledger.status!=='CLEARED')continue;
  if(balance==='CREDIT'&&data.ledger.status!=='CREDIT')continue;
  if(count++)pdf.addPage();
  financeDocumentPdf.drawStatement({pdf,school:schoolInfo,...data,reference:financeDocumentPdf.newStatementReference(data.learner)});
 }
 if(!count){
  schoolHeader(pdf,schoolInfo,'LEARNER FEE STATEMENTS');
  pdf.fillColor('#475569').font('Helvetica').fontSize(10).text('No learners matched the selected statement filter.',{align:'center'});
 }
 pdf.end();
 }catch(e){if(!res.headersSent)res.status(e.status||500).json({error:e.message});else res.end()}});

router.get('/:schoolId/receipts/:paymentId/pdf',schoolBoundary,roles(...VIEW),async(req,res)=>{try{
 const sid=req.params.schoolId,paymentId=req.params.paymentId;
 if(!uuid.test(paymentId))return res.status(400).json({error:'Invalid payment ID'});
 const format=String(req.query.format||'A5').toUpperCase();
 if(!['A5','A6','THERMAL'].includes(format))return res.status(400).json({error:'Choose A5, A6, or THERMAL receipt format.'});
 const q=await db.query(`SELECT p.*,l.admission_no,l.first_name,l.middle_name,l.last_name,c.name class_name,c.stream,r.credit_note_no,r.reason reversal_reason,
   ay.year_label,t.name term_name,rec.first_name recorder_first_name,rec.last_name recorder_last_name
  FROM school_fee_payments p JOIN learners l ON l.id=p.learner_id AND l.school_id=p.school_id
  LEFT JOIN classes c ON c.id=l.class_id AND c.school_id=l.school_id
  LEFT JOIN school_fee_payment_reversals r ON r.school_id=p.school_id AND r.payment_id=p.id
  LEFT JOIN academic_years ay ON ay.id=p.academic_year_id AND ay.school_id=p.school_id
  LEFT JOIN terms t ON t.id=p.term_id AND t.school_id=p.school_id
  LEFT JOIN users rec ON rec.id=p.recorded_by
  WHERE p.school_id=$1 AND p.id=$2 AND p.status='CONFIRMED'`,[sid,paymentId]);
 if(!q.rows[0])return res.status(404).json({error:'Receipt not found in this school'});
 const payment=q.rows[0],schoolInfo=await school(sid);
 const data=await loadLearnerStatement(sid,payment.learner_id);
 if(!data)return res.status(404).json({error:'Learner account not found in this school'});
 financeDocumentPdf.renderReceipt({res,school:schoolInfo,payment,learner:data.learner,ledger:data.ledger,format});
 }catch(e){if(!res.headersSent)res.status(e.status||500).json({error:e.message});else res.end()}});

router.get('/:schoolId/leaving-certificates',schoolBoundary,roles(...VIEW),async(req,res)=>{try{const q=await db.query(`SELECT r.id,r.data,r.created_at,l.admission_no,l.first_name,l.middle_name,l.last_name FROM school_module_records r LEFT JOIN learners l ON l.id=(r.data->>'learner_id')::uuid AND l.school_id=r.school_id WHERE r.school_id=$1 AND r.record_type='leaving_certificate' ORDER BY r.created_at DESC LIMIT 250`,[req.params.schoolId]);res.json(q.rows)}catch(e){res.status(500).json({error:'Unable to load certificates'})}});
router.post('/:schoolId/leaving-certificates',schoolBoundary,roles(...WRITE),async(req,res)=>{try{
 const sid=req.params.schoolId,b=req.body||{};if(!uuid.test(b.learner_id))return res.status(400).json({error:'Select a valid learner'});
 const l=await db.query('SELECT id FROM learners WHERE school_id=$1 AND id=$2',[sid,b.learner_id]);if(!l.rows.length)return res.status(404).json({error:'Learner not found in this school'});
 const leaving=clean(b.leaving_date,10),admitted=clean(b.admission_date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(leaving)||!Number.isFinite(Date.parse(leaving)))return res.status(400).json({error:'A valid leaving date is required'});
 if(admitted&&(!/^\d{4}-\d{2}-\d{2}$/.test(admitted)||Date.parse(admitted)>Date.parse(leaving)))return res.status(400).json({error:'Admission date must be valid and not later than leaving date'});
 const data={learner_id:b.learner_id,admission_date:admitted,leaving_date:leaving,reason:clean(b.reason),conduct:clean(b.conduct),destination:clean(b.destination),headteacher:clean(b.headteacher,120),remarks:clean(b.remarks),certificate_number:'ZLC-'+new Date().getFullYear()+'-'+require('crypto').randomUUID().slice(0,8).toUpperCase()};
 const q=await db.query(`INSERT INTO school_module_records(school_id,record_type,data,created_by) VALUES($1,'leaving_certificate',$2,$3) RETURNING *`,[sid,JSON.stringify(data),req.user.user_id]);res.status(201).json(q.rows[0]);
 }catch(e){res.status(400).json({error:e.message})}});
router.get('/:schoolId/leaving-certificates/:id/pdf',schoolBoundary,roles(...VIEW),async(req,res)=>{try{
 const sid=req.params.schoolId;if(!uuid.test(req.params.id))return res.status(400).json({error:'Invalid certificate ID'});
 const q=await db.query(`SELECT r.*,l.admission_no,l.first_name,l.middle_name,l.last_name,l.gender,c.name class_name,c.stream FROM school_module_records r JOIN learners l ON l.id=(r.data->>'learner_id')::uuid AND l.school_id=r.school_id LEFT JOIN classes c ON c.id=l.class_id AND c.school_id=r.school_id WHERE r.school_id=$1 AND r.record_type='leaving_certificate' AND r.id=$2`,[sid,req.params.id]);if(!q.rows[0])return res.status(404).json({error:'Certificate not found'});
 const r=q.rows[0],d=r.data,s=await school(sid),p=pdfStart(res,'leaving-certificate-'+r.id+'.pdf');header(p,s,'SCHOOL LEAVING CERTIFICATE');
 p.font('Helvetica').fontSize(10).fillColor('#334155').text('This is to certify that the learner named below was enrolled at this school, according to the school records.',{align:'left'});p.moveDown(1.5);
 line(p,'Certificate number:',d.certificate_number);line(p,'Learner:',[r.first_name,r.middle_name,r.last_name].filter(Boolean).join(' '));line(p,'Admission number:',r.admission_no);line(p,'Class / stream at issue:',[r.class_name,r.stream].filter(Boolean).join(' '));line(p,'Date of admission:',d.admission_date||'Not recorded');line(p,'Date of leaving:',d.leaving_date);line(p,'Reason for leaving:',d.reason||'Not recorded');line(p,'Conduct:',d.conduct||'Not recorded');line(p,'Next institution / destination:',d.destination||'Not recorded');line(p,'Remarks:',d.remarks||'None');p.moveDown(3);
 p.strokeColor('#9aa9b8').moveTo(55,p.y).lineTo(260,p.y).stroke();p.moveDown(.5);p.font('Helvetica').fontSize(10).text('Headteacher: '+(d.headteacher||'________________'),55);p.moveDown(1.5);p.text('Official school stamp: __________________________',55);p.moveDown(2);p.fillColor('#64748b').fontSize(8).text('Generated by ZELIMU CBC. Validate this certificate against the school register. A signature and stamp must be applied by an authorised officer.',{align:'center'});p.end();
 }catch(e){if(!res.headersSent)res.status(e.status||500).json({error:e.message});else res.end()}});
module.exports=router;
