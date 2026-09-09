const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('servidor restringe acesso e persiste o cofre pela API', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kuroi-http-'));
  const port=14000+Math.floor(Math.random()*20000);
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),KUROI_VAULT:directory},windowsHide:true});
  t.after(async()=>{
    if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
    await fs.rm(directory,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Servidor não iniciou')),8000);
    child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
    child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Servidor terminou: ${code}`));});
  });
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/vault/caderno.json')).status,404);
  assert.equal((await fetch(base+'/package.json')).status,404);
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  const state=await (await fetch(base+'/api/state')).json();
  state.notes=[{id:'http-note',title:'HTTP',body:'Conteúdo',links:[],updatedAt:Date.now()}];
  const saved=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
  assert.equal(saved.status,200);assert.equal((await saved.json()).notes[0].body,'Conteúdo');
});
