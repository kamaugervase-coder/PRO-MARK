const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('report comments support subject-specific context',()=>{
 const route=fs.readFileSync(path.join(__dirname,'../backend/routes/reports.js'),'utf8');
 const migration=fs.readFileSync(path.join(__dirname,'../database/047_report_comment_subject_context.sql'),'utf8');
 assert.match(route,/subject_id/);
 assert.match(route,/SUBJECT_TEACHER/);
 assert.match(migration,/ADD COLUMN IF NOT EXISTS subject_id/);
 assert.match(migration,/uq_report_comments_subject_context/);
});

test('merit cache is invalidated after mark changes and supports subject filtering',()=>{
 const merit=fs.readFileSync(path.join(__dirname,'../backend/routes/merit.js'),'utf8');
 const assessments=fs.readFileSync(path.join(__dirname,'../backend/routes/assessments.js'),'utf8');
 assert.match(merit,/subject_id/);
 assert.match(merit,/clearMeritCache/);
 assert.match(assessments,/invalidateMeritCaches/);
 assert.match(assessments,/invalidateMeritCaches\(\)/);
});

test('hosted learner photos are supported by PDF asset hydration',()=>{
 const assets=fs.readFileSync(path.join(__dirname,'../backend/services/assets.js'),'utf8');
 const pdf=fs.readFileSync(path.join(__dirname,'../backend/services/report-pdf.js'),'utf8');
 assert.match(assets,/fetchHostedSource/);
 assert.match(assets,/Buffer\.isBuffer/);
 assert.match(pdf,/hydrateHostedReportImages/);
 assert.match(pdf,/passport_photo_url/);
});

test('merit assessment options use the selected period and group standard exams by type',()=>{
 const centre=fs.readFileSync(path.join(__dirname,'../public/js/results-centre.js'),'utf8');
 assert.match(centre,/function meritAssessmentOptions\(scope\)/);
 assert.match(centre,/return option\(type, MERIT_ASSESSMENT_LABELS\[type\], scope\.assessment\)/);
 assert.match(centre,/function applyMeritAssessment\(params, assessment\)/);
 assert.match(centre,/params\.assessment_type = selected/);
 assert.match(centre,/loadOptions\(\{ academic_year_id: yearId, term_id: termId \}\)\.then\(loadCommand\)/);
});
