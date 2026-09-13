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
  const fonte=await fetch(base+'/fonts/ibm-plex-sans-latin.woff2');
  assert.equal(fonte.status,200);assert.equal(fonte.headers.get('content-type'),'font/woff2');
  assert.equal((await fetch(base+'/fonts/..%2Fcaderno.json')).status,404);
  assert.equal((await fetch(base+'/fonts/nao-existe.woff2')).status,404);
  assert.equal((await fetch(base+'/vendor/katex/katex.min.js')).status,200);
  assert.equal((await fetch(base+'/vendor/katex/fonts/KaTeX_Main-Regular.woff2')).status,200);
  assert.equal((await fetch(base+'/vendor/katex/package.json')).status,404);
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  const state=await (await fetch(base+'/api/state')).json();
  state.notes=[{id:'http-note',title:'HTTP',body:'Conteúdo',links:[],updatedAt:Date.now()}];
  const saved=await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
  assert.equal(saved.status,200);assert.equal((await saved.json()).notes[0].body,'Conteúdo');

  // exclusão e restauração pela API: é o caminho que a lixeira da interface usa
  let atual=await (await fetch(base+'/api/state')).json();
  atual=await (await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...atual,notes:[]})})).json();
  const lixeira=await (await fetch(base+'/api/trash')).json();
  assert.equal(lixeira.length,1);
  assert.equal((await fetch(base+'/api/restore',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  const restaurada=await fetch(base+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryId:lixeira[0].entryId,revision:atual.revision})});
  assert.equal(restaurada.status,200);
  const volta=await restaurada.json();
  assert.equal(volta.notes.length,1);
  assert.equal(volta.notes[0].body,'Conteúdo');
});

test('modo de desenvolvimento injeta a recarga ao vivo; o normal não a expõe', async t => {
  const raiz=path.join(__dirname,'..');
  const iniciar=async(args)=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kuroi-dev-'));
    const port=14000+Math.floor(Math.random()*20000);
    const child=spawn(process.execPath,['server.mjs',...args],{cwd:raiz,env:{...process.env,PORT:String(port),KUROI_VAULT:directory},windowsHide:true});
    t.after(async()=>{
      if(child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}
      await fs.rm(directory,{recursive:true,force:true});
    });
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Servidor não iniciou')),8000);
      child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Servidor terminou: ${code}`));});
    });
    return {base:`http://127.0.0.1:${port}`,directory};
  };

  const normal=await iniciar([]);
  assert.doesNotMatch(await (await fetch(normal.base+'/')).text(),/dev\/reload\.js/);
  assert.equal((await fetch(normal.base+'/dev/reload.js')).status,404);
  assert.equal((await fetch(normal.base+'/dev/events')).status,404);

  const dev=await iniciar(['--dev']);
  assert.match(await (await fetch(dev.base+'/')).text(),/<script src="\/dev\/reload\.js"><\/script>/);
  assert.equal((await fetch(dev.base+'/dev/reload.js')).status,200);
  // a troca de estilo pede styles.css?v=<hora>
  assert.equal((await fetch(dev.base+'/styles.css?v=123')).status,200);
  const eventos=new AbortController();
  const resposta=await fetch(dev.base+'/dev/events',{signal:eventos.signal});
  assert.match(resposta.headers.get('content-type'),/text\/event-stream/);
  const leitor=resposta.body.getReader();
  assert.match(new TextDecoder().decode((await leitor.read()).value),/^event: boot\ndata: \w+/);
  eventos.abort();
  // com KUROI_VAULT apontado, o modo dev não semeia exemplo em pasta alheia
  assert.deepEqual(await fs.readdir(dev.directory).then(n=>n.filter(x=>!x.startsWith('.'))),[]);
  // o que o instalador empacota nunca inclui as ferramentas de desenvolvimento
  const {build}=require('../package.json');
  assert.ok(build.files.includes('!dev/**')&&build.files.includes('!dev-vault/**'));
});
