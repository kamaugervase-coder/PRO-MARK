'use strict';

const PDFDocument=require('pdfkit');
const crypto=require('crypto');

const money=value=>Math.round((Number(value)||0)*100)/100;
const fmt=value=>money(value).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const timestamp=value=>value instanceof Date?value.toISOString():String(value||'');
const dateOnly=value=>value?timestamp(value).slice(0,10):'—';
const safeColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?value:'#17365D';

function dataUrlBuffer(value){
 const match=/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(value||''));
 if(!match)return null;
 if(match[1].toLowerCase()==='webp'){
  console.warn('School financial PDFs cannot embed WebP logos or stamps; use PNG or JPEG artwork.');
  return null;
 }
 return Buffer.from(match[2],'base64');
}

function drawImage(pdf,source,x,y,fit,label){
 const buffer=dataUrlBuffer(source);
 if(!buffer)return false;
 try{pdf.image(buffer,x,y,{fit});return true;}
 catch(error){console.warn(`Unable to embed school ${label} in a finance PDF: ${error.message}`);return false;}
}

function startPdf(res,name,school,{size='A4',margin=42,marginBottom=54}={}){
 res.setHeader('Content-Type','application/pdf');
 res.setHeader('Content-Disposition',`inline; filename="${name}"`);
 const pdf=new PDFDocument({size,margin,marginTop:margin,marginBottom,marginLeft:margin,marginRight:margin,info:{Title:name,Author:school.name||'PRO-MARK'}});
 let page=0;
 const footer=()=>{
  page++;
  const y=pdf.page.height-31,oldY=pdf.y,oldX=pdf.x;
  const oldBottomMargin=pdf.page.margins.bottom;
  pdf.page.margins.bottom=0;
  pdf.save();
  pdf.strokeColor('#d7dee8').lineWidth(.5).moveTo(pdf.page.margins.left,y-7).lineTo(pdf.page.width-pdf.page.margins.right,y-7).stroke();
  pdf.fillColor('#64748b').font('Helvetica').fontSize(7).text(
   [school.contact_phone,school.contact_email].filter(Boolean).join(' · ')||school.address||'',
   pdf.page.margins.left,y,{width:pdf.page.width-pdf.page.margins.left-pdf.page.margins.right-55,lineBreak:false}
  );
  pdf.text(`Page ${page}`,pdf.page.width-pdf.page.margins.right-50,y,{width:50,align:'right',lineBreak:false});
  pdf.restore();pdf.page.margins.bottom=oldBottomMargin;pdf.x=oldX;pdf.y=oldY;
 };
 pdf.on('pageAdded',footer);
 pdf.pipe(res);
 footer();
 return pdf;
}

function schoolHeader(pdf,school,title,{continued=false}={}){
 const left=pdf.page.margins.left,right=pdf.page.width-pdf.page.margins.right,width=right-left;
 const primary=safeColor(school.primary_color);
 const logo=dataUrlBuffer(school.logo_url);
 const top=pdf.y;
 if(logo)drawImage(pdf,school.logo_url,left,top,[48,43],'logo');
 const textX=logo?left+54:left;
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(15).text(school.name||'School',textX,top+1,{width:width-(textX-left),align:'center',lineBreak:false});
 const contacts=[school.address,school.contact_phone,school.contact_email].filter(Boolean).join('  ·  ');
 pdf.fillColor('#475569').font('Helvetica').fontSize(8).text(contacts,textX,top+20,{width:width-(textX-left),align:'center'});
 if(school.motto)pdf.fillColor('#64748b').font('Helvetica-Oblique').fontSize(8).text(school.motto,textX,pdf.y+1,{width:width-(textX-left),align:'center'});
 pdf.moveDown(.5);
 pdf.strokeColor(safeColor(school.secondary_color)).lineWidth(1.5).moveTo(left,pdf.y).lineTo(right,pdf.y).stroke();
 pdf.moveDown(.55);
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(14).text(`${title}${continued?' · CONTINUED':''}`,{align:'center'});
 pdf.moveDown(.65);
}

function drawTableHeader(pdf,columns,primary,{height=23,fontSize=8}={}){
 const left=columns[0].x,right=columns[columns.length-1].x+columns[columns.length-1].width;
 const y=pdf.y;
 pdf.save().rect(left,y,right-left,height).fill(safeColor(primary));
 columns.forEach(column=>{
  pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(fontSize).text(column.label,column.x+4,y+6,{width:column.width-8,align:column.align||'left',lineBreak:false});
 });
 pdf.restore();pdf.y=y+height;
}

function tableRow(pdf,columns,values,{fontSize=8,padding=5,index=0,bold=false}={}){
 const heights=values.map((value,i)=>pdf.heightOfString(String(value??'—'),{width:columns[i].width-10,font:bold?'Helvetica-Bold':'Helvetica',fontSize}));
 const height=Math.max(19,...heights.map(value=>value+padding*2));
 const left=columns[0].x,right=columns[columns.length-1].x+columns[columns.length-1].width,y=pdf.y;
 if(index%2===1)pdf.save().rect(left,y,right-left,height).fill('#f7f9fc').restore();
 pdf.save().fillColor('#243449').font(bold?'Helvetica-Bold':'Helvetica').fontSize(fontSize);
 values.forEach((value,i)=>pdf.text(String(value??'—'),columns[i].x+5,y+padding,{width:columns[i].width-10,align:columns[i].align||'left'}));
 pdf.restore();
 pdf.strokeColor('#dbe3ec').lineWidth(.5).moveTo(left,y+height).lineTo(right,y+height).stroke();
 pdf.y=y+height;
}

function drawLabelValue(pdf,label,value,x,y,width,{labelWidth=105,fontSize=9}={}){
 pdf.save().fillColor('#475569').font('Helvetica-Bold').fontSize(fontSize).text(label,x,y,{width:labelWidth});
 pdf.fillColor('#243449').font('Helvetica').fontSize(fontSize).text(String(value??'—')||'—',x+labelWidth,y,{width:width-labelWidth});
 pdf.restore();
}

function ensurePage(pdf,school,title,needed,options={}){
 if(pdf.y+needed>pdf.page.height-pdf.page.margins.bottom){
  pdf.addPage();
  schoolHeader(pdf,school,title,{continued:true});
  if(options.tableColumns)drawTableHeader(pdf,options.tableColumns,school.primary_color,options.tableOptions);
 }
}

function drawSignatureBlocks(pdf,school,{stamp=false,secondLabel='VERIFIED BY'}={}){
 const left=pdf.page.margins.left,right=pdf.page.width-pdf.page.margins.right,width=(right-left-30)/2,y=pdf.y;
 pdf.save().strokeColor('#94a3b8').lineWidth(.7);
 for(let i=0;i<2;i++){
  const x=left+i*(width+30);
  pdf.moveTo(x,y+24).lineTo(x+width,y+24).stroke();
  pdf.fillColor('#475569').font('Helvetica').fontSize(8).text(i?secondLabel:'PREPARED BY',x,y+28,{width});
  pdf.moveTo(x,y+56).lineTo(x+width,y+56).stroke();
  pdf.text('Signature / Date',x,y+60,{width});
 }
 if(stamp){
  const image=dataUrlBuffer(school.stamp_url);
  if(image)drawImage(pdf,school.stamp_url,right-70,y-6,[65,65],'stamp');
  else pdf.rect(right-72,y-8,72,70).stroke().fillColor('#64748b').font('Helvetica').fontSize(7).text('OFFICIAL STAMP',right-69,y+21,{width:66,align:'center'});
 }
 pdf.restore();pdf.y=y+77;
}

function renderFeeStructure({res,school,fee,items}){
 const pdf=startPdf(res,`fee-structure-${fee.id}.pdf`,school);
 schoolHeader(pdf,school,'SCHOOL FEE STRUCTURE');
 const left=pdf.page.margins.left,width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
 const context=[
  ['ACADEMIC YEAR',fee.year_label||'Not specified'],
  ['TERM',fee.term_name||'Not specified'],
  ['CLASS / GRADE',[fee.class_name,fee.stream].filter(Boolean).join(' ')||'All classes']
 ];
 let x=left;
 const contextY=pdf.y;
 context.forEach(([label,value],index)=>{
  const cellWidth=width/3;
  pdf.save().fillColor('#475569').font('Helvetica-Bold').fontSize(7).text(label,x,contextY,{width:cellWidth-9,align:index===0?'left':'center'});
  pdf.fillColor('#243449').font('Helvetica-Bold').fontSize(9).text(value,x,contextY+11,{width:cellWidth-9,align:index===0?'left':'center'});
  pdf.restore();
  x+=cellWidth;
 });
 pdf.y=contextY+25;
 pdf.moveDown(3);
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(10).text('FEE BREAKDOWN');
 pdf.moveDown(.4);
 const leftEdge=pdf.page.margins.left;
 const cols=[
  {label:'NO.',x:leftEdge,width:36,align:'center'},
  {label:'DESCRIPTION OF FEE',x:leftEdge+36,width:width-36-145},
  {label:'AMOUNT (KES)',x:leftEdge+width-145,width:145,align:'right'}
 ];
 drawTableHeader(pdf,cols,school.primary_color);
 let total=0,index=0;
 for(const item of items){
  const amount=Number(item.amount)||0;total=money(total+amount);
  ensurePage(pdf,school,'SCHOOL FEE STRUCTURE',25,{tableColumns:cols});
  tableRow(pdf,cols,[String(++index),item.name,fmt(amount)],{index:index-1,fontSize:9,padding:6});
 }
 ensurePage(pdf,school,'SCHOOL FEE STRUCTURE',30,{tableColumns:cols});
 tableRow(pdf,cols,['','TOTAL FEES PAYABLE',fmt(total)],{index,bold:true,fontSize:10,padding:7});
 pdf.moveDown(.85);
 const note=[...new Set(items.map(item=>String(item.print_notes||'').trim()).filter(Boolean))].join('\n');
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(9).text('OFFICIAL PAYMENT DETAILS');
 pdf.moveDown(.3);
 pdf.fillColor('#334155').font('Helvetica').fontSize(8).text(note||'Please contact the school bursar for currently authorised payment methods and account details.',{width});
 pdf.moveDown(.65);
 pdf.save().roundedRect(left,pdf.y,width,42,3).fill('#f1f5f9').restore();
 const noticeY=pdf.y+8;
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(8).text('IMPORTANT NOTICE',left+9,noticeY,{width:width-18});
 pdf.fillColor('#334155').font('Helvetica').fontSize(8).text('Use the learner admission number as the payment reference where applicable. Retain official receipts and confirm payments through authorised school channels.',left+9,noticeY+12,{width:width-18});
 pdf.y+=51;
 ensurePage(pdf,school,'SCHOOL FEE STRUCTURE',86);
 drawSignatureBlocks(pdf,school,{stamp:true,secondLabel:'APPROVED BY'});
 pdf.end();
}

function buildLedger({charges=[],payments=[],adjustments=[]}){
 const opening=adjustments.filter(row=>row.adjustment_type==='OPENING_BALANCE'&&row.status==='APPROVED');
 const openingBalance=money(opening.reduce((sum,row)=>sum+(row.direction==='CREDIT'?-1:1)*Number(row.amount||0),0));
 const events=[];
 for(const row of charges){
  events.push({date:dateOnly(row.created_at||row.due_on),sortDate:timestamp(row.created_at||row.due_on),id:String(row.id||''),type:'DEBIT',amount:money(row.amount),description:row.description||'Fee charge'});
 }
 for(const row of payments){
  if(row.status&&row.status!=='CONFIRMED')continue;
  events.push({
   date:dateOnly(row.payment_date),sortDate:timestamp(row.created_at||row.payment_date),id:String(row.id||''),paymentId:row.id,
   type:'CREDIT',amount:money(row.amount),
   description:['Payment received',row.receipt_no,row.payment_method?String(row.payment_method).replaceAll('_',' '):'',row.reference?`Ref ${row.reference}`:''].filter(Boolean).join(' · ')
  });
  if(row.credit_note_no){
   events.push({date:dateOnly(row.reversed_at),sortDate:timestamp(row.reversed_at),id:`${row.id||''}-reversal`,type:'DEBIT',amount:money(row.amount),description:`Reversal${row.credit_note_no?` · ${row.credit_note_no}`:''}`});
  }
 }
 for(const row of adjustments){
  if(row.status!=='APPROVED'||row.adjustment_type==='OPENING_BALANCE')continue;
  events.push({date:dateOnly(row.created_at),sortDate:timestamp(row.created_at),id:String(row.id||''),type:row.direction,amount:money(row.amount),description:`${String(row.adjustment_type||'ADJUSTMENT').replaceAll('_',' ')}${row.reason?` · ${row.reason}`:''}`});
 }
 events.sort((a,b)=>a.date.localeCompare(b.date)||a.sortDate.localeCompare(b.sortDate)||a.id.localeCompare(b.id));
 let balance=openingBalance,totalDebits=0,totalCredits=0;
 const transactions=[{
  date:'—',description:'Opening Balance',debit:openingBalance>0?openingBalance:0,
  credit:openingBalance<0?Math.abs(openingBalance):0,balance
 }];
 for(const event of events){
  const debit=event.type==='DEBIT'?event.amount:0;
  const credit=event.type==='CREDIT'?event.amount:0;
  balance=money(balance+debit-credit);
  totalDebits=money(totalDebits+debit);totalCredits=money(totalCredits+credit);
  transactions.push({...event,debit,credit,balance});
 }
 return {
  openingBalance,totalDebits,totalCredits,closingBalance:balance,transactions,
  status:balance>0.009?'OUTSTANDING':balance< -0.009?'CREDIT':'CLEARED'
 };
}

function drawStatement({pdf,school,learner,ledger,reference}){
 schoolHeader(pdf,school,'INDIVIDUAL LEARNER FEE STATEMENT');
 const left=pdf.page.margins.left,width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
 const referenceY=pdf.y;
 pdf.fillColor('#475569').font('Helvetica').fontSize(8).text(`STATEMENT REFERENCE: ${reference}`,left,referenceY,{width:width/2});
 pdf.text(`DATE GENERATED: ${new Date().toISOString().slice(0,10)}`,left+width/2,referenceY,{width:width/2,align:'right'});
 pdf.moveDown(1);
 const learnerName=[learner.first_name,learner.middle_name,learner.last_name].filter(Boolean).join(' ')||'—';
 const boxY=pdf.y;
 pdf.save().roundedRect(left,boxY,width,72,3).stroke('#cbd5e1');
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(11).text(learnerName,left+10,boxY+8,{width:width-20});
 drawLabelValue(pdf,'Admission Number',learner.admission_no,left+10,boxY+27,width/2-12,{labelWidth:105,fontSize:8});
 drawLabelValue(pdf,'Class / Grade',[learner.class_name,learner.stream].filter(Boolean).join(' ')||'Not assigned',left+width/2,boxY+27,width/2-10,{labelWidth:76,fontSize:8});
 drawLabelValue(pdf,'Academic Period','All ledger records',left+10,boxY+46,width/2-12,{labelWidth:105,fontSize:8});
 drawLabelValue(pdf,'Account Status',learner.is_active===false?'Inactive':'Active',left+width/2,boxY+46,width/2-10,{labelWidth:76,fontSize:8});
 pdf.y=boxY+82;
 const cards=[
  ['OPENING BALANCE',ledger.openingBalance],
  ['TOTAL DEBITS / CHARGES',ledger.totalDebits],
  ['TOTAL CREDITS / PAYMENTS',ledger.totalCredits],
  [ledger.status==='OUTSTANDING'?'OUTSTANDING BALANCE':ledger.status==='CREDIT'?'CREDIT BALANCE':'FEES CLEARED',ledger.closingBalance]
 ];
 const cardsY=pdf.y,gap=10,cardWidth=(width-gap)/2,cardHeight=39;
 cards.forEach((card,index)=>{
  const row=Math.floor(index/2),column=index%2,x=left+column*(cardWidth+gap),y=cardsY+row*(cardHeight+6);
  pdf.save().roundedRect(x,y,cardWidth,cardHeight,3).fill(index===3?'#eaf3ff':'#f1f5f9');
  pdf.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text(card[0],x+8,y+5,{width:cardWidth-16});
  const amount=Number(card[1]),text=`KES ${fmt(Math.abs(amount))}${index===3&&amount< -0.009?' CR':''}`;
  pdf.fillColor(index===3?safeColor(school.primary_color):'#243449').font('Helvetica-Bold').fontSize(index===3?11:9).text(text,x+8,y+18,{width:cardWidth-16});
  pdf.restore();
 });
 pdf.y=cardsY+cardHeight*2+15;
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(9).text('DETAILED ACCOUNT TRANSACTIONS');
 pdf.moveDown(.4);
 const columns=[
  {label:'DATE',x:left,width:70},
  {label:'DESCRIPTION',x:left+70,width:174},
  {label:'DEBIT (KES)',x:left+244,width:83,align:'right'},
  {label:'CREDIT (KES)',x:left+327,width:83,align:'right'},
  {label:'RUNNING BALANCE (KES)',x:left+410,width:width-410,align:'right'}
 ];
 const tableOptions={height:24,fontSize:7};
 drawTableHeader(pdf,columns,school.primary_color,tableOptions);
 ledger.transactions.forEach((entry,index)=>{
  const row=[entry.date,entry.description,entry.debit?fmt(entry.debit):'—',entry.credit?fmt(entry.credit):'—',fmt(entry.balance)];
  const rowHeight=Math.max(20,...row.map((value,i)=>pdf.heightOfString(String(value),{width:columns[i].width-10,font:'Helvetica',fontSize:7})+8));
  ensurePage(pdf,school,'INDIVIDUAL LEARNER FEE STATEMENT',rowHeight,{tableColumns:columns,tableOptions});
  tableRow(pdf,columns,row,{index,fontSize:7,padding:4});
 });
 ensurePage(pdf,school,'INDIVIDUAL LEARNER FEE STATEMENT',95);
 pdf.moveDown(.6);
 const totalRows=[
  ['Opening Balance',fmt(ledger.openingBalance)],
  ['Total Debit / Charges',fmt(ledger.totalDebits)],
  ['Total Credit / Payments',fmt(ledger.totalCredits)],
  ['CLOSING BALANCE',`${ledger.closingBalance<0?'CREDIT: KES ':'KES '}${fmt(Math.abs(ledger.closingBalance))}`]
 ];
 const totalWidth=Math.min(265,width),totalX=pdf.page.margins.left+width-totalWidth;
 totalRows.forEach((row,index)=>{
  const y=pdf.y;
  if(index===3)pdf.save().rect(totalX,y-2,totalWidth,20).fill('#eaf3ff');
  pdf.fillColor(index===3?safeColor(school.primary_color):'#334155').font(index===3?'Helvetica-Bold':'Helvetica').fontSize(index===3?9:8).text(row[0],totalX+5,y,{width:totalWidth*.61});
  pdf.text(row[1],totalX+totalWidth*.61,y,{width:totalWidth*.36,align:'right'});
  if(index===3)pdf.restore();
  pdf.y=y+17;
 });
 ensurePage(pdf,school,'INDIVIDUAL LEARNER FEE STATEMENT',115);
 pdf.moveDown(.5);
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(8).text("BURSAR'S REMARKS");
 const remarksY=pdf.y+5;
 pdf.strokeColor('#cbd5e1').rect(pdf.page.margins.left,remarksY,width,30).stroke();
 pdf.y=remarksY+38;
 drawSignatureBlocks(pdf,school);
}

function amountInWords(value){
 const amount=Math.round(Number(value||0)*100),whole=Math.floor(amount/100),cents=amount%100;
 const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
 const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
 const underThousand=n=>{
  if(n<20)return ones[n];
  if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');
  return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+underThousand(n%100):'');
 };
 let remaining=whole,words='';
 for(const [scale,label] of [[1000000000,'Billion'],[1000000,'Million'],[1000,'Thousand']]){
  if(remaining>=scale){const count=Math.floor(remaining/scale);words+=(words?' ':'')+underThousand(count)+' '+label;remaining%=scale;}
 }
 if(remaining||!words)words+=(words?' ':'')+underThousand(remaining);
 return `${words} Kenya Shillings${cents?` and ${underThousand(cents)} Cents`:''} Only`;
}

function renderReceipt({res,school,payment,ledger,format='A5'}){
 const settings=format==='A6'?{size:'A6',margin:12,marginBottom:22}:format==='THERMAL'?{size:[226.77,900],margin:17,marginBottom:42}:{size:'A5',margin:31,marginBottom:48};
 const pdf=startPdf(res,`${format.toLowerCase()}-receipt-${payment.receipt_no}.pdf`,school,settings);
 if(format==='A6'){
  renderA6Receipt(pdf,school,payment,ledger);
  pdf.end();
  return;
 }
 const thermal=format==='THERMAL',left=pdf.page.margins.left,width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
 schoolHeader(pdf,school,'OFFICIAL PAYMENT RECEIPT');
 const size=thermal?7:format==='A6'?7:8;
 const created=payment.created_at?new Date(payment.created_at):null;
 const time=created&&!Number.isNaN(created.getTime())?created.toLocaleTimeString('en-KE',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'}):'—';
 const receiptBoxY=pdf.y,receiptBoxHeight=thermal||format==='A6'?33:39;
 pdf.save().roundedRect(left,receiptBoxY,width,receiptBoxHeight,3).fill('#f1f5f9');
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(thermal?8:format==='A6'?9:11).text(`RECEIPT NO: ${payment.receipt_no}`,left+8,receiptBoxY+5,{width:width-16,align:'center'});
 pdf.fillColor('#334155').font('Helvetica').fontSize(size).text(`DATE: ${dateOnly(payment.payment_date)}   TIME: ${time}`,left+8,receiptBoxY+(thermal||format==='A6'?19:23),{width:width-16,align:'center'});
 pdf.restore();pdf.y=receiptBoxY+receiptBoxHeight+7;
 const learnerName=[payment.first_name,payment.middle_name,payment.last_name].filter(Boolean).join(' ')||'—';
 const details=[
  ['Received From',payment.payer_name||'Not recorded'],
  ...(payment.payer_relationship?[['Relationship',payment.payer_relationship]]:[]),
  ['Learner Name',learnerName],
  ['Admission Number',payment.admission_no||'—'],
  ['Class', [payment.class_name,payment.stream].filter(Boolean).join(' ')||'Not assigned'],
  ['Academic Year',payment.year_label||'—'],
  ['Term',payment.term_name||'—']
 ];
 details.forEach(([label,value])=>{
  const y=pdf.y;
  if(thermal){
   pdf.fillColor('#64748b').font('Helvetica-Bold').fontSize(size).text(`${label}:`,left,y,{width:width});
   pdf.fillColor('#243449').font('Helvetica').fontSize(size).text(String(value),left,y+9,{width});
   pdf.y=y+18;
  }else{
   drawLabelValue(pdf,label,value,left,y,width,{labelWidth:format==='A6'?78:104,fontSize:size});
   pdf.y=y+(format==='A6'?11:17);
  }
 });
 pdf.moveDown(.45);
 const cols=thermal?[
  {label:'DESCRIPTION',x:left,width:width*.51},
  {label:'REFERENCE',x:left+width*.51,width:width*.26,align:'left'},
  {label:'AMOUNT',x:left+width*.77,width:width*.23,align:'right'}
 ]:[
  {label:'DESCRIPTION',x:left,width:width*.47},
  {label:'REFERENCE',x:left+width*.47,width:width*.31},
  {label:'AMOUNT (KES)',x:left+width*.78,width:width*.22,align:'right'}
 ];
 drawTableHeader(pdf,cols,school.primary_color,{height:thermal?19:21,fontSize:thermal?6:7});
 tableRow(pdf,cols,[payment.notes||'School fees payment',payment.reference||'—',fmt(payment.amount)],{fontSize:thermal?6:7,padding:4});
 pdf.moveDown(.6);
 const amountY=pdf.y,amountBoxHeight=thermal||format==='A6'?46:58;
 pdf.save().roundedRect(left,amountY,width,amountBoxHeight,3).fill('#eaf3ff');
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(thermal?7:format==='A6'?8:9).text('AMOUNT RECEIVED',left+6,amountY+5,{width:width-12,align:'center'});
 pdf.fontSize(thermal?11:format==='A6'?13:17).text(`KES ${fmt(payment.amount)}`,left+6,amountY+(thermal||format==='A6'?18:22),{width:width-12,align:'center'});
 pdf.restore();pdf.y=amountY+amountBoxHeight+5;
 pdf.fillColor('#475569').font('Helvetica').fontSize(thermal?6:7).text(amountInWords(payment.amount),left,pdf.y,{width,align:'center'});
 pdf.moveDown(.7);
 drawLabelValue(pdf,'Payment Method',String(payment.payment_method||'').replaceAll('_',' '),left,pdf.y,width,{labelWidth:format==='A6'?75:102,fontSize:size});pdf.moveDown(1.35);
 if(payment.reference){
  drawLabelValue(pdf,'Transaction Reference',payment.reference,left,pdf.y,width,{labelWidth:format==='A6'?75:102,fontSize:size});pdf.moveDown(1.35);
 }
 const receiverName=[payment.recorder_first_name,payment.recorder_last_name].filter(Boolean).join(' ');
 if(receiverName){
  drawLabelValue(pdf,'Received By',receiverName,left,pdf.y,width,{labelWidth:format==='A6'?75:102,fontSize:size});
  pdf.moveDown(1.4);
 }
 const event=ledger.transactions.find(row=>row.paymentId===payment.id);
 const previousBalance=event?money(event.balance+Number(payment.amount)):ledger.closingBalance;
 const remainingBalance=event?event.balance:ledger.closingBalance;
 const reversed=Boolean(payment.credit_note_no);
 const balanceY=pdf.y;
 pdf.fillColor(safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(size).text('ACCOUNT BALANCE',left,balanceY,{width});
 const balanceLabel=remainingBalance< -0.009?'CREDIT BALANCE':Math.abs(remainingBalance)<=0.009?'ACCOUNT CLEARED':'OUTSTANDING BALANCE';
 const balanceText=reversed?'RECEIPT REVERSED':`${balanceLabel}: KES ${fmt(Math.abs(remainingBalance))}`;
 pdf.fillColor(reversed?'#b91c1c':balanceLabel==='OUTSTANDING BALANCE'?'#9a3412':safeColor(school.primary_color)).font('Helvetica-Bold').fontSize(thermal?size:format==='A6'?7:9).text(balanceText,left,balanceY+11,{width,align:'center'});
 pdf.font('Helvetica').fontSize(size).fillColor('#334155').text(`Previous balance: ${previousBalance< -0.009?'CREDIT ':''}KES ${fmt(Math.abs(previousBalance))}  ·  Received: KES ${fmt(payment.amount)}`,left,balanceY+23,{width,align:'center'});
 if(reversed)pdf.font('Helvetica-Bold').fontSize(size).fillColor('#b91c1c').text(`Credit note ${payment.credit_note_no}: ${payment.reversal_reason||'Receipt reversed'}`,left,balanceY+34,{width,align:'center'});
 pdf.y=balanceY+(reversed?46:35);
 pdf.fillColor('#334155').font('Helvetica-Bold').fontSize(size).text('Received with thanks.',{align:'center'});
 pdf.moveDown(.5);
 const signY=pdf.y,leftHalf=width*.52;
 pdf.strokeColor('#94a3b8').lineWidth(.7).moveTo(left,signY+20).lineTo(left+leftHalf-5,signY+20).stroke();
 pdf.fillColor('#475569').font('Helvetica').fontSize(size).text('Received by · Signature',left,signY+22,{width:leftHalf-5,align:'center'});
 const stamp=dataUrlBuffer(school.stamp_url);
 if(stamp)drawImage(pdf,school.stamp_url,left+width*.73,signY-2,[width*.25,39],'stamp');
 else{
  pdf.rect(left+width*.72,signY-2,width*.27,39).stroke();
  pdf.font('Helvetica').fontSize(Math.max(6,size-1)).fillColor('#64748b').text('OFFICIAL STAMP',left+width*.72,signY+14,{width:width*.27,align:'center'});
 }
 pdf.end();
}

function renderA6Receipt(pdf,school,payment,ledger){
 const left=pdf.page.margins.left,width=pdf.page.width-pdf.page.margins.left-pdf.page.margins.right;
 const primary=safeColor(school.primary_color),logo=dataUrlBuffer(school.logo_url);
 let y=pdf.page.margins.top;
 if(logo)drawImage(pdf,school.logo_url,left,y,[28,26],'logo');
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(10).text(school.name||'School',left+30,y,{width:width-30,align:'center',lineBreak:false});
 pdf.fillColor('#475569').font('Helvetica').fontSize(6).text([school.address,school.contact_phone,school.contact_email].filter(Boolean).join(' · '),left+30,y+12,{width:width-30,align:'center'});
 y+=27;
 if(school.motto){pdf.fillColor('#64748b').font('Helvetica-Oblique').fontSize(6).text(school.motto,left,y,{width,align:'center'});y+=9;}
 pdf.strokeColor(safeColor(school.secondary_color)).lineWidth(1).moveTo(left,y).lineTo(left+width,y).stroke();
 y+=5;
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(9).text('OFFICIAL PAYMENT RECEIPT',left,y,{width,align:'center'});
 y+=14;
 const created=payment.created_at?new Date(payment.created_at):null;
 const time=created&&!Number.isNaN(created.getTime())?created.toLocaleTimeString('en-KE',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'}):'—';
 pdf.save().roundedRect(left,y,width,25,2).fill('#f1f5f9');
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(7).text(`RECEIPT NO: ${payment.receipt_no}`,left+4,y+3,{width:width-8,align:'center'});
 pdf.fillColor('#334155').font('Helvetica').fontSize(6).text(`${dateOnly(payment.payment_date)}  ·  ${time}`,left+4,y+13,{width:width-8,align:'center'});
 pdf.restore();y+=30;
 const fields=[
  ['Payer',payment.payer_name||'Not recorded'],
  ['Relationship',payment.payer_relationship||'Not recorded'],
  ['Learner',[payment.first_name,payment.middle_name,payment.last_name].filter(Boolean).join(' ')||'—'],
  ['Admission',payment.admission_no||'—'],
  ['Class',[payment.class_name,payment.stream].filter(Boolean).join(' ')||'Not assigned'],
  ['Academic Year',payment.year_label||'—'],
  ['Term',payment.term_name||'—']
 ];
 for(const [label,value] of fields){
  const labelWidth=68,valueWidth=width-labelWidth-4;
  pdf.fillColor('#475569').font('Helvetica-Bold').fontSize(6).text(label,left,y,{width:labelWidth});
  pdf.fillColor('#243449').font('Helvetica').fontSize(6).text(String(value),left+labelWidth,y,{width:valueWidth});
  const height=pdf.heightOfString(String(value),{width:valueWidth,font:'Helvetica',fontSize:6});
  y+=Math.max(8,height)+1;
 }
 y+=2;
 const columns=[
  {label:'DESCRIPTION',x:left,width:width*.46},
  {label:'REFERENCE',x:left+width*.46,width:width*.31},
  {label:'AMOUNT',x:left+width*.77,width:width*.23,align:'right'}
 ];
 pdf.y=y;drawTableHeader(pdf,columns,primary,{height:17,fontSize:5.5});
 tableRow(pdf,columns,[payment.notes||'School fees payment',payment.reference||'—',fmt(payment.amount)],{fontSize:6,padding:3});
 y=pdf.y+4;
 pdf.save().roundedRect(left,y,width,39,2).fill('#eaf3ff');
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(7).text('AMOUNT RECEIVED',left+4,y+4,{width:width-8,align:'center'});
 pdf.fontSize(13).text(`KES ${fmt(payment.amount)}`,left+4,y+17,{width:width-8,align:'center'});
 pdf.restore();y+=42;
 pdf.fillColor('#475569').font('Helvetica').fontSize(5.5).text(amountInWords(payment.amount),left,y,{width,align:'center'});
 y+=Math.max(9,pdf.heightOfString(amountInWords(payment.amount),{width,font:'Helvetica',fontSize:5.5})+2);
 for(const [label,value] of [
  ['Payment Method',String(payment.payment_method||'').replaceAll('_',' ')],
  ...(payment.reference?[['Transaction Reference',payment.reference]]:[]),
  ...([payment.recorder_first_name,payment.recorder_last_name].filter(Boolean).length
   ?[['Received By',[payment.recorder_first_name,payment.recorder_last_name].filter(Boolean).join(' ')]]
   :[])
 ]){
  pdf.fillColor('#475569').font('Helvetica-Bold').fontSize(6).text(`${label}:`,left,y,{width:75});
  pdf.fillColor('#243449').font('Helvetica').fontSize(6).text(value,left+75,y,{width:width-75});
  y+=9;
 }
 const event=ledger.transactions.find(row=>row.paymentId===payment.id);
 const previousBalance=event?money(event.balance+Number(payment.amount)):ledger.closingBalance;
 const remainingBalance=event?event.balance:ledger.closingBalance;
 const reversed=Boolean(payment.credit_note_no);
 y+=2;
 pdf.fillColor(primary).font('Helvetica-Bold').fontSize(6).text('ACCOUNT BALANCE',left,y,{width,align:'center'});y+=9;
 const status=remainingBalance< -0.009?'CREDIT BALANCE':Math.abs(remainingBalance)<=0.009?'ACCOUNT CLEARED':'OUTSTANDING BALANCE';
 pdf.fillColor(reversed?'#b91c1c':status==='OUTSTANDING BALANCE'?'#9a3412':primary).font('Helvetica-Bold').fontSize(6.5).text(
  reversed?`RECEIPT REVERSED · ${payment.credit_note_no}`:`${status}: KES ${fmt(Math.abs(remainingBalance))}`,left,y,{width,align:'center'}
 );y+=9;
 pdf.fillColor('#334155').font('Helvetica').fontSize(5.5).text(`Previous: ${previousBalance< -0.009?'CREDIT ':''}KES ${fmt(Math.abs(previousBalance))}  ·  Received: KES ${fmt(payment.amount)}`,left,y,{width,align:'center'});y+=12;
 pdf.fillColor('#334155').font('Helvetica-Bold').fontSize(6).text('Received with thanks.',left,y,{width,align:'center'});y+=10;
 pdf.strokeColor('#94a3b8').lineWidth(.6).moveTo(left+5,y+7).lineTo(left+width*.55,y+7).stroke();
 pdf.fillColor('#475569').font('Helvetica').fontSize(5).text('Received by · Signature',left+5,y+9,{width:width*.55-5,align:'center'});
 const stamp=dataUrlBuffer(school.stamp_url);
 if(stamp)drawImage(pdf,school.stamp_url,left+width*.73,y-2,[width*.25,27],'stamp');
 else{
  pdf.rect(left+width*.73,y-2,width*.25,27).stroke();
  pdf.fontSize(5).text('OFFICIAL STAMP',left+width*.73,y+8,{width:width*.25,align:'center'});
 }
}

function newStatementReference(learner){
 const year=new Date().getUTCFullYear(),admission=String(learner.admission_no||'LEARNER').replace(/[^a-zA-Z0-9]/g,'').slice(-10);
 return `ST-${year}-${admission||'LEARNER'}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
}

module.exports={
 buildLedger,drawStatement,fmt,money,newStatementReference,renderFeeStructure,renderReceipt,schoolHeader,startPdf
};
