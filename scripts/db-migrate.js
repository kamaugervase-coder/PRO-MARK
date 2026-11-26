require('dotenv').config();
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const MIGRATIONS_DIR=path.join(__dirname,'..','database','tracked');
const MIGRATION_NAME=/^(\d{3,})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const LOCK_KEY=[18492,27011];

function loadMigrations(directory=MIGRATIONS_DIR){
  if(!fs.existsSync(directory))return [];
  const files=fs.readdirSync(directory).filter(name=>name.endsWith('.sql'));
  const numbers=new Set();
  const migrations=files.map(name=>{
    const match=name.match(MIGRATION_NAME);
    if(!match)throw new Error(`Invalid tracked migration filename: ${name}`);
    if(numbers.has(match[1]))throw new Error(`Duplicate tracked migration number: ${match[1]}`);
    numbers.add(match[1]);
    const sql=fs.readFileSync(path.join(directory,name),'utf8').trim();
    if(!sql)throw new Error(`Tracked migration is empty: ${name}`);
    if(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)){
      throw new Error(`Tracked migration must not manage its own transaction: ${name}`);
    }
    return {
      name,
      checksum:crypto.createHash('sha256').update(sql).digest('hex'),
      sql
    };
  });
  return migrations.sort((a,b)=>Number(a.name.match(MIGRATION_NAME)[1])-Number(b.name.match(MIGRATION_NAME)[1]));
}

async function runMigrations({pool,directory=MIGRATIONS_DIR,log=console.log}){
  if(!pool||typeof pool.connect!=='function')throw new Error('A PostgreSQL pool is required.');
  const migrations=loadMigrations(directory);
  if(!migrations.length){
    log('No tracked database migrations to apply.');
    return {applied:0,pending:0};
  }

  const client=await pool.connect();
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock($1,$2)',LOCK_KEY);
    locked=true;
    await client.query(`CREATE TABLE IF NOT EXISTS zelimu_schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const result=await client.query('SELECT name,checksum FROM zelimu_schema_migrations');
    const appliedByName=new Map(result.rows.map(row=>[row.name,row.checksum.trim()]));
    for(const migration of migrations){
      const checksum=appliedByName.get(migration.name);
      if(checksum&&checksum!==migration.checksum){
        throw new Error(`Applied migration was modified: ${migration.name}`);
      }
    }
    const pending=migrations.filter(migration=>!appliedByName.has(migration.name));
    for(const migration of pending){
      await client.query('BEGIN');
      try{
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO zelimu_schema_migrations(name,checksum) VALUES($1,$2)',
          [migration.name,migration.checksum]
        );
        await client.query('COMMIT');
      }catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw new Error(`Migration failed (${migration.name}): ${error.message}`,{cause:error});
      }
      log(`Applied ${migration.name}`);
    }
    return {applied:pending.length,pending:0};
  }finally{
    try{
      if(locked)await client.query('SELECT pg_advisory_unlock($1,$2)',LOCK_KEY);
    }finally{
      client.release();
    }
  }
}

if(require.main===module){
  if(process.argv.length>2){
    console.error('db:migrate does not accept command-line options.');
    process.exitCode=2;
  }else{
    const {pool}=require('../backend/db');
    runMigrations({pool}).catch(error=>{
      console.error('Database migration failed:',error);
      process.exitCode=1;
    }).finally(()=>pool.end());
  }
}

module.exports={loadMigrations,runMigrations};
