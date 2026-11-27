const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const dashboard=fs.readFileSync(path.join(__dirname,'../public/dashboard.html'),'utf8');
const approvedDashboard=fs.readFileSync(path.join(__dirname,'../public/js/zelimu-approved-dashboard.js'),'utf8');
const financeRoutes=fs.readFileSync(path.join(__dirname,'../backend/routes/finance.js'),'utf8');
const portalStyles=fs.readFileSync(path.join(__dirname,'../public/css/zelimu-approved-dashboard.css'),'utf8');

test('the approved portal stylesheet follows dashboard and module-specific styles',()=>{
  const moduleStyles=dashboard.indexOf('/css/assessment-hub.css');
  const portalStyle=dashboard.indexOf('/css/zelimu-approved-dashboard.css');
  const startupScript=dashboard.indexOf('<script defer src="/js/zelimu-gold-theme.js');

  assert.notEqual(moduleStyles,-1,'Assessment module stylesheet must be present.');
  assert.notEqual(portalStyle,-1,'Approved portal stylesheet must be present.');
  assert.notEqual(startupScript,-1,'Dashboard startup script must be present.');
  assert.ok(portalStyle>moduleStyles,'Shared portal styles must load after module-specific styles.');
  assert.ok(portalStyle<startupScript,'Shared portal styles must load before dashboard scripts run.');
});

test('communication recipient fields respect hidden state and the send action stays prominent',()=>{
  assert.match(dashboard,/#pm24Data\.cm-workspace>\.cm-compose-panel\{overflow-x:hidden;overflow-y:auto\}/);
  assert.match(dashboard,/\.cm-compose-panel \[data-cm-target\]\[hidden\]\{display:none!important\}/);
  assert.match(dashboard,/\.cm-compose-panel \.actions \.btn\{width:100%;min-height:48px/);
});

test('opening Communication scrolls to the module and exposes manual SMS sending',()=>{
  assert.match(dashboard,/if\(isCommunication\)panel\?\.scrollIntoView\(\{behavior:'auto',block:'start'\}\)/);
  assert.match(dashboard,/id="cmManualSmsOpen"[^>]*>SEND SMS TO ANY NUMBER/);
  assert.match(dashboard,/\$\('cmManualSmsOpen'\)\.onclick=async\(\)=>\{\s*\$\('cmRecipient'\)\.value='manual'/);
});

test('module workspaces are mounted outside the hidden legacy bridge',()=>{
  assert.match(dashboard,/const commandCentre=main\.querySelector\(':scope > \.zelimu-command-v1'\);[\s\S]*?commandCentre\.insertAdjacentElement\('afterend',display\)/);
});

test('opening modules jumps to the complete workspace without smooth-scroll delay',()=>{
  assert.match(dashboard,/#zelimuWorkspaceDisplay>\.nav-managed-section\.nav-active\{display:block!important;max-height:none;min-height:calc\(100dvh - 120px\);overflow:visible/);
  assert.match(dashboard,/display\.scrollIntoView\(\{behavior:'instant',block:'start'\}\)/);
  assert.doesNotMatch(dashboard,/if\(n===28\)\{\s*requestAnimationFrame\(\(\)=>panel\?\.scrollIntoView\(\{behavior:'smooth'/);
});

test('command-centre finance uses a compact role-protected summary endpoint',()=>{
  assert.match(financeRoutes,/router\.get\('\/:schoolId\/dashboard-overview',schoolBoundary,roles\(\.\.\.FINANCE_READ\)/);
  assert.match(financeRoutes,/res\.json\(\{summary:summary\.rows\[0\],payments:payments\.rows\}\)/);
  assert.match(approvedDashboard,/loadOptional\(canFinance,`\/api\/finance\/\$\{sid\}\/dashboard-overview`\)/);
  assert.doesNotMatch(approvedDashboard,/loadOptional\(canFinance,`\/api\/finance\/\$\{sid\}\/overview`\)/);
});

test('CSV and school-export downloads keep object URLs alive after click',()=>{
  assert.match(dashboard,/document\.body\.append\(link\);link\.click\(\);link\.remove\(\);setTimeout\(\(\)=>URL\.revokeObjectURL\(link\.href\),4000\)/);
  assert.match(dashboard,/document\.body\.append\(a\);a\.click\(\);a\.remove\(\);setTimeout\(\(\)=>URL\.revokeObjectURL\(a\.href\),4000\)/);
  assert.doesNotMatch(dashboard,/link\.click\(\);URL\.revokeObjectURL\(link\.href\)/);
  assert.doesNotMatch(dashboard,/a\.click\(\);URL\.revokeObjectURL\(a\.href\)/);
});

test('the command centre uses crisp readable type and softened panel surfaces',()=>{
  assert.match(portalStyles,/body \.z7,body \.z7 \*\{-webkit-font-smoothing:auto!important;text-rendering:auto!important\}/);
  assert.match(portalStyles,/body \.z7 \.z7-nav button\{font-size:14px!important\}/);
  assert.match(portalStyles,/body \.z7 \.z7-panel,\s*body \.z7 \.z7-ringinner\{background:#f8fbf9!important\}/);
});

test('communication history, terms and parent lists load independently',()=>{
  assert.match(dashboard,/await Promise\.all\(\[loadTerms\(\),loadParents\(\),loadHistory\(\)\]\)/);
  assert.match(dashboard,/Unable to load academic terms:/);
});
