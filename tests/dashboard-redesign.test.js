const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const dashboard=fs.readFileSync(path.join(__dirname,'../public/dashboard.html'),'utf8');

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
