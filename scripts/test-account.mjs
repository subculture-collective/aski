import { spawn, spawnSync, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const browser = process.argv.includes('--browser');
const name = 'aski-account-test-' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
function docker(args) { const p = spawnSync('docker',args,{encoding:'utf8',env:{...process.env,POSTGRES_PASSWORD:password}}); if(p.status!==0) throw new Error('Disposable test database command failed'); return p.stdout.trim(); }
function run(command,args,env) { return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:'inherit',env});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error('Account check failed')));}); }
let server;
try {
  docker(['run','-d','--rm','--name',name,'--label','subcult.tv.aski-test='+name,'--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=aski_test','-p','127.0.0.1::5432','postgres:17-alpine']);
  let ready=false;
  for(let i=0;i<100;i++) { const p=spawnSync('docker',['exec',name,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d aski_test'],{stdio:'ignore'}); if(p.status===0){ready=true;break;} await new Promise(r=>setTimeout(r,200)); }
  if(!ready) throw new Error('Disposable test database did not become ready');
  const port=docker(['port',name,'5432/tcp']).split(':').at(-1);
  const env={...process.env,ASKI_TEST_DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${port}/aski_test`,ASKI_ACCOUNT_TEST:'1'};
  if(browser) {
    server=fork('server/test-server.ts',[],{env,stdio:['ignore','ignore','inherit','ipc']});
    const port = await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Capture server startup timed out')),15000);
      server.once('message',value=>{clearTimeout(timer);resolve(value.port);});
      server.once('exit',()=>{clearTimeout(timer);reject(new Error('Capture server startup failed'));});
    });
    env.ASKI_API_URL=`http://127.0.0.1:${port}`;
    await run('npx',['playwright','test','tests/account.spec.ts','--project=chromium','--project=firefox','--project=phone'],env);
  } else await run(process.execPath,['--test','server/account.test.ts'],env);
} finally {
  if(server && server.exitCode === null) { const stopped = new Promise(r=>server.once('exit',r)); server.kill('SIGTERM'); await stopped; }
  spawnSync('docker',['rm','-f',name],{stdio:'ignore'});
}
