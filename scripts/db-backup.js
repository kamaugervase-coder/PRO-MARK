require('dotenv').config();
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

function buildPgDumpConfig(databaseUrl,outputFile,baseEnv=process.env){
  const url=new URL(databaseUrl);
  if(!['postgres:','postgresql:'].includes(url.protocol)){
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }
  const database=decodeURIComponent(url.pathname.replace(/^\/+/,''));
  const username=decodeURIComponent(url.username);
  if(!url.hostname||!database||!username)throw new Error('DATABASE_URL must include a host, database and username.');
  const env={...baseEnv};
  delete env.DATABASE_URL;
  delete env.PGPASSWORD;
  if(url.password)env.PGPASSWORD=decodeURIComponent(url.password);
  if(url.searchParams.has('sslmode'))env.PGSSLMODE=url.searchParams.get('sslmode');
  const args=[
    '--host',url.hostname,
    '--port',url.port||'5432',
    '--username',username,
    '--dbname',database,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',outputFile
  ];
  return {args,env};
}

function runCommand(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','ignore','pipe'],...options});
    let stderr='';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      if(code===0)return resolve();
      reject(new Error(`${command} failed${signal?` (${signal})`:` with exit code ${code}`}${stderr.trim()?`: ${stderr.trim()}`:''}`));
    });
  });
}

async function createBackup({databaseUrl=process.env.DATABASE_URL,directory=process.env.DB_BACKUP_DIR||path.join(root,'backups'),now=new Date()}={}){
  if(!databaseUrl)throw new Error('DATABASE_URL is required to create a database backup.');
  const backupDirectory=path.resolve(directory);
  fs.mkdirSync(backupDirectory,{recursive:true,mode:0o700});
  const stamp=now.toISOString().replace(/[:.]/g,'-');
  const outputFile=path.join(backupDirectory,`pro-mark-${stamp}.dump`);
  const config=buildPgDumpConfig(databaseUrl,outputFile);
  const file=fs.openSync(outputFile,'wx',0o600);
  fs.closeSync(file);
  try{
    await runCommand('pg_dump',config.args,{env:config.env});
    fs.chmodSync(outputFile,0o600);
    await runCommand('pg_restore',['--list',outputFile],{env:config.env});
    return outputFile;
  }catch(error){
    fs.rmSync(outputFile,{force:true});
    throw error;
  }
}

if(require.main===module){
  if(process.argv.length>2){
    console.error('db:backup does not accept command-line options; configure DB_BACKUP_DIR instead.');
    process.exitCode=2;
  }else{
    createBackup().then(file=>{
      console.log(`Database backup created and archive-verified: ${file}`);
    }).catch(error=>{
      console.error('Database backup failed:',error);
      process.exitCode=1;
    });
  }
}

module.exports={buildPgDumpConfig,createBackup};
