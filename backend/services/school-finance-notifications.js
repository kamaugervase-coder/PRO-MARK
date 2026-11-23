'use strict';

async function notifyPaymentGuardians({db,deliverSms,schoolId,payment,actorId}){
 const context=(await db.query(`
  SELECT s.name school_name,l.id learner_id,l.admission_no,
    concat_ws(' ',l.first_name,l.middle_name,l.last_name) learner_name
  FROM school_fee_payments p
  JOIN schools s ON s.id=p.school_id
  JOIN learners l ON l.id=p.learner_id AND l.school_id=p.school_id
  WHERE p.school_id=$1 AND p.id=$2
 `,[schoolId,payment.id])).rows[0];
 if(!context)throw new Error('Saved payment could not be found while preparing guardian notification.');
 const [guardians,balance,charges,recentPayments]=await Promise.all([
  db.query(`SELECT DISTINCT pg.id,pg.phone
    FROM parent_guardians pg
    JOIN learner_guardians lg ON lg.parent_guardian_id=pg.id
    WHERE pg.school_id=$1 AND lg.learner_id=$2
      AND COALESCE(pg.is_active,false)=true
      AND COALESCE(pg.sms_enabled,false)=true
      AND COALESCE(pg.communication_consent,false)=true
      AND NULLIF(btrim(pg.phone),'') IS NOT NULL
    ORDER BY pg.id`,[schoolId,context.learner_id]),
  db.query(`SELECT
    COALESCE((SELECT sum(amount) FROM school_fee_charges WHERE school_id=$1 AND learner_id=$2),0)
      +COALESCE((SELECT sum(amount) FROM school_finance_adjustments WHERE school_id=$1 AND learner_id=$2 AND status='APPROVED' AND direction='DEBIT'),0) charged,
    COALESCE((SELECT sum(p.amount) FROM school_fee_payments p WHERE p.school_id=$1 AND p.learner_id=$2 AND p.status='CONFIRMED'
      AND NOT EXISTS(SELECT 1 FROM school_fee_payment_reversals r WHERE r.school_id=p.school_id AND r.payment_id=p.id)),0)
      +COALESCE((SELECT sum(amount) FROM school_finance_adjustments WHERE school_id=$1 AND learner_id=$2 AND status='APPROVED' AND direction='CREDIT'),0) credited`,
   [schoolId,context.learner_id]),
  db.query(`SELECT description,amount,due_on FROM school_fee_charges
    WHERE school_id=$1 AND learner_id=$2 ORDER BY due_on NULLS LAST,created_at DESC LIMIT 5`,
   [schoolId,context.learner_id]),
  db.query(`SELECT receipt_no,payment_date,amount,payment_method FROM school_fee_payments
    WHERE school_id=$1 AND learner_id=$2 AND status='CONFIRMED'
      AND NOT EXISTS(SELECT 1 FROM school_fee_payment_reversals r WHERE r.school_id=school_fee_payments.school_id AND r.payment_id=school_fee_payments.id)
    ORDER BY payment_date DESC,created_at DESC LIMIT 5`,[schoolId,context.learner_id])
 ]);
 const totals=balance.rows[0]||{charged:0,credited:0};
 const outstanding=Number(totals.charged)-Number(totals.credited);
 const balanceLabel=outstanding<0?'Credit balance':outstanding>0?'Outstanding balance':'Balance';
 const detail=charges.rows.map(row=>`${row.description}: KES ${Number(row.amount).toFixed(2)}`).join('; ');
 const payments=recentPayments.rows.map(row=>`${row.receipt_no} ${String(row.payment_date).slice(0,10)} KES ${Number(row.amount).toFixed(2)}`).join('; ');
 const message=[
  `${String(context.school_name||'School')}: PAYMENT RECEIPT ${payment.receipt_no}`,
  `Learner: ${String(context.learner_name||context.admission_no||'Learner')}${context.admission_no?` (${context.admission_no})`:''}.`,
  payment.payer_name?`Payer: ${payment.payer_name}${payment.payer_relationship?` (${payment.payer_relationship})`:''}.`:'',
  `Received KES ${Number(payment.amount).toFixed(2)} by ${payment.payment_method}${payment.reference?`; Ref ${payment.reference}`:''}.`,
  `Updated statement: charges KES ${Number(totals.charged).toFixed(2)}; payments/credits KES ${Number(totals.credited).toFixed(2)}.`,
  `${balanceLabel}: KES ${Math.abs(outstanding).toFixed(2)}.`,
  detail?`Recent charges: ${detail}.`:'No fee charges recorded yet.',
  payments?`Recent payments: ${payments}.`:'',
  'Automatically generated payment receipt and account statement summary.'
 ].filter(Boolean).join(' ');
 const result={sent:0,queued:0,failed:0,skipped:guardians.rows.length?0:1,recipients:[]};
 for(const guardian of guardians.rows){
  let status='FAILED',provider=String(process.env.SMS_PROVIDER||'UNCONFIGURED'),failure=null,providerMessageId=null;
  try{
   const delivery=await deliverSms({phone:guardian.phone,message,school_id:schoolId,learner_id:context.learner_id});
   provider=delivery.provider||provider;
   providerMessageId=delivery.providerMessageId||null;
   status=delivery.status;
   if(status==='QUEUED'&&provider!=='INFOBIP'){
    status='FAILED';
    failure='SMS provider did not confirm delivery; this receipt and statement summary were not delivered.';
   }
  }catch(error){status='FAILED';failure=error.message||'SMS delivery failed.';}
  try{
   await db.query(`INSERT INTO communication_messages(
     school_id,learner_id,parent_guardian_id,channel,message_type,body,status,provider,
     provider_message_id,failure_reason,created_by,sent_at
    ) VALUES($1,$2,$3,'SMS','FEE_PAYMENT_RECEIPT',$4,$5,$6,$7,$8,$9,CASE WHEN $5='SENT' THEN now() ELSE NULL END)`,
    [schoolId,context.learner_id,guardian.id,message,status,provider,providerMessageId,failure,actorId]);
  }catch(error){
   console.error('Unable to record fee receipt notification history:',error);
   failure=[failure,`Notification history could not be saved: ${error.message}`].filter(Boolean).join(' ');
  }
  if(status==='SENT')result.sent++;
  else if(status==='QUEUED')result.queued++;
  else result.failed++;
  result.recipients.push({parent_guardian_id:guardian.id,status,failure});
 }
 return result;
}

module.exports={notifyPaymentGuardians};
