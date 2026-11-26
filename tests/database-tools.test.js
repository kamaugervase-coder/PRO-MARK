const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {loadMigrations,runMigrations}=require('../scripts/db-migrate');
const {buildPgDumpConfig}=require('../scripts/db-backup');

function migrationDirectory(t,files){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zelimu-migrations-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  for(const [name,sql] of Object.entries(files))fs.writeFileSync(path.join(directory,name),sql);
  return directory;
}

function fakePool(applied=new Map()){
  const statements=[];
  let released=false;
  const client={
    async query(sql,params=[]){
      statements.push(sql);
      if(sql.startsWith('SELECT name,checksum FROM zelimu_schema_migrations')){
        return {rows:[...applied].map(([name,checksum])=>({name,checksum}))};
      }
      if(sql.startsWith('INSERT INTO zelimu_schema_migrations')){
        applied.set(params[0],params[1]);
        return {rows:[],rowCount:1};
      }
      return {rows:[]};
    },
    release(){released=true;}
  };
  return {pool:{connect:async()=>client},statements,applied,isReleased:()=>released};
}

test('loads tracked migrations in numeric order and checks transaction ownership',t=>{
  const directory=migrationDirectory(t,{
    '1000_final.sql':'SELECT 1000;',
    '999_previous.sql':'SELECT 999;',
    '001_initial.sql':'SELECT 1;'
  });
  assert.deepEqual(loadMigrations(directory).map(item=>item.name),[
    '001_initial.sql','999_previous.sql','1000_final.sql'
  ]);
  const invalid=migrationDirectory(t,{'002_nested_transaction.sql':'BEGIN; SELECT 1;'});
  assert.throws(()=>loadMigrations(invalid),/must not manage its own transaction/);
});

test('applies each migration once and rejects changed applied SQL',async t=>{
  const directory=migrationDirectory(t,{'001_initial.sql':'CREATE TABLE example(id integer);'});
  const fake=fakePool();
  const result=await runMigrations({pool:fake.pool,directory,log:()=>{}});
  assert.deepEqual(result,{applied:1,pending:0});
  assert.ok(fake.statements.includes('BEGIN'));
  assert.ok(fake.statements.includes('COMMIT'));
  assert.equal(fake.isReleased(),true);

  const second=await runMigrations({pool:fake.pool,directory,log:()=>{}});
  assert.deepEqual(second,{applied:0,pending:0});
  assert.equal(fake.statements.filter(sql=>sql==='CREATE TABLE example(id integer);').length,1);

  fs.writeFileSync(path.join(directory,'001_initial.sql'),'CREATE TABLE example(id bigint);');
  await assert.rejects(runMigrations({pool:fake.pool,directory,log:()=>{}}),/Applied migration was modified/);
});

test('keeps database passwords out of pg_dump arguments',()=>{
  const config=buildPgDumpConfig(
    'postgresql://backup%40user:secret%2Fvalue@db.example:5433/school%20data?sslmode=require',
    '/tmp/school.dump',
    {DATABASE_URL:'must-not-be-forwarded',PATH:'/usr/bin'}
  );
  assert.equal(config.args.includes('secret/value'),false);
  assert.equal(config.args.includes('postgresql://backup%40user:secret%2Fvalue@db.example:5433/school%20data?sslmode=require'),false);
  assert.equal(config.env.PGPASSWORD,'secret/value');
  assert.equal(config.env.DATABASE_URL,undefined);
  assert.equal(config.env.PGSSLMODE,'require');
  assert.equal(config.args[config.args.indexOf('--username')+1],'backup@user');
  assert.equal(config.args[config.args.indexOf('--dbname')+1],'school data');
});
