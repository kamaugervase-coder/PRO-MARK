const assert=require('node:assert/strict');
const test=require('node:test');
const {normalizeRecordData}=require('../backend/routes/extended');

test('operational record statuses are stored in the canonical uppercase form',()=>{
  assert.deepEqual(normalizeRecordData('transport_allocations',{
    learner_id:' learner-123 ',
    status:' active '
  }),{
    learner_id:'learner-123',
    status:'ACTIVE'
  });
});

test('partial operational updates preserve omitted fields and reject invalid values',()=>{
  assert.deepEqual(normalizeRecordData('hr_leave',{status:'approved'},true),{status:'APPROVED'});
  assert.throws(()=>normalizeRecordData('hr_leave',{status:null},true),/Invalid status/);
  assert.throws(()=>normalizeRecordData('transport_allocations',{status:''}),/Invalid status/);
  assert.throws(()=>normalizeRecordData('unknown_module',{}),/Unknown module/);
});
