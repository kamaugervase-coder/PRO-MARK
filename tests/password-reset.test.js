const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const test=require('node:test');
const {resetPassword}=require('../backend/services/password-reset');

function fakePool({valid=true}={}){
  const statements=[];
  let released=false;
  const client={
    async query(sql,params=[]){
      statements.push({sql,params});
      if(sql.startsWith('SELECT id,user_id FROM password_reset_tokens')){
        return {rows:valid?[{id:7,user_id:'user-1'}]:[]};
      }
      if(sql.startsWith('UPDATE password_reset_tokens SET used_at=now() WHERE id=')){
        return {rows:[{id:7}],rowCount:1};
      }
      return {rows:[],rowCount:1};
    },
    release(){released=true;}
  };
  return {pool:{connect:async()=>client},statements,isReleased:()=>released};
}

test('password reset consumes the token and updates the password in one transaction',async()=>{
  const fake=fakePool();
  let hashArgs;
  const result=await resetPassword(fake.pool,'one-time-token','strong-password',async(...args)=>{
    hashArgs=args;
    return 'new-password-hash';
  });
  assert.equal(result,true);
  assert.deepEqual(hashArgs,['strong-password',12]);
  assert.equal(fake.statements[0].sql,'BEGIN');
  assert.ok(fake.statements.some(({sql})=>sql.includes('FOR UPDATE')));
  assert.ok(fake.statements.some(({sql,params})=>sql.startsWith('UPDATE users')&&params[1]==='new-password-hash'));
  assert.equal(fake.statements.at(-1).sql,'COMMIT');
  assert.equal(fake.isReleased(),true);
  const tokenHash=crypto.createHash('sha256').update('one-time-token').digest('hex');
  assert.equal(fake.statements[1].params[0],tokenHash);
});

test('invalid or previously used reset tokens do not update accounts',async()=>{
  const fake=fakePool({valid:false});
  const result=await resetPassword(fake.pool,'expired-token','strong-password',async()=>{
    throw new Error('Hashing should not run for an invalid token.');
  });
  assert.equal(result,false);
  assert.equal(fake.statements.at(-1).sql,'ROLLBACK');
  assert.equal(fake.statements.some(({sql})=>sql.startsWith('UPDATE users')),false);
  assert.equal(fake.isReleased(),true);
});
