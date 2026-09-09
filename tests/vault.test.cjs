const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');
const domain = require('../domain.js');
const note = (overrides = {}) => ({ id: 'note-1', title: 'Minha nota', body: 'Conteúdo original', links: [], tags: [], folderId: '', updatedAt: Date.now(), ...overrides });
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kuroi-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new Vault(directory);
}
async function seed(vault, notes = [note()]) { const state = await vault.load(); return vault.save({ ...state, notes }); }

test('Markdown é a fonte principal; JSON guarda somente dados auxiliares', async t => {
  const vault = await setup(t); const state = await seed(vault);
  const meta = JSON.parse(await fs.readFile(path.join(vault.directory,'caderno.json'),'utf8'));
  assert.equal(meta.notes, undefined); assert.equal(meta.formatVersion,3);
  assert.equal(meta.studies, undefined); assert.ok(Array.isArray(meta.folders));
  const file = path.join(vault.directory,state.notes[0].file);
  await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('Conteúdo original','Editado por outro editor'));
  assert.equal((await vault.load()).notes[0].body,'Editado por outro editor');
});
test('salvamento obsoleto não sobrescreve edição externa', async t => {
  const vault=await setup(t);const state=await seed(vault);
  const file=path.join(vault.directory,state.notes[0].file);
  await fs.appendFile(file,'\nAlteração externa');
  state.notes[0].body='Alteração antiga';
  await assert.rejects(vault.save(state),/mudou/);
  assert.match(await fs.readFile(file,'utf8'),/Alteração externa/);
});
test('salvamentos concorrentes rejeitam a versão antiga', async t => {
  const vault=await setup(t);const state=await seed(vault);
  const a=structuredClone(state), b=structuredClone(state);a.notes[0].body='A';b.notes[0].body='B';
  const result=await Promise.allSettled([vault.save(a),vault.save(b)]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');
  assert.equal((await vault.load()).notes[0].body,'A');
});
test('exclusão vai para lixeira e pode ser restaurada', async t => {
  const vault=await setup(t);let state=await seed(vault);const file=state.notes[0].file;
  state=await vault.save({...state,notes:[]});
  await assert.rejects(fs.access(path.join(vault.directory,file)));
  const trash=await vault.trash();assert.equal(trash[0].body,'Conteúdo original');
  state=await vault.save({...state,notes:[{...trash[0],file:undefined}]});
  assert.equal(state.notes.length,1);assert.equal((await vault.trash()).length,0);
});
test('mover ou renomear pasta remove o arquivo antigo', async t => {
  const vault=await setup(t);let state=await seed(vault);const old=state.notes[0].file;
  state.folders=[{id:'folder-1',title:'Java',parentId:'',description:''}];state.notes[0].folderId='folder-1';
  state=await vault.save(state);assert.match(state.notes[0].file,/^Java\//);
  await assert.rejects(fs.access(path.join(vault.directory,old)));
  const moved=state.notes[0].file;state.folders[0].title='Programação';state=await vault.save(state);
  assert.match(state.notes[0].file,/^Programação\//);
  await assert.rejects(fs.access(path.join(vault.directory,moved)));
  // Renomear move o diretório: o antigo não pode sobrar vazio no cofre.
  await assert.rejects(fs.access(path.join(vault.directory,'Java')));
});
test('migração preserva IDs e usa o corpo Markdown mais recente', async t => {
  const vault=await setup(t);await fs.mkdir(path.join(vault.directory,'Notas'));
  await fs.writeFile(path.join(vault.directory,'caderno.json'),JSON.stringify({notes:[note({file:'legado.md'})],tasks:[],routine:[],studies:[]}));
  await fs.writeFile(path.join(vault.directory,'Notas/legado.md'),'---\ncaderno-id: note-1\ntitle: "Título externo"\nlinks: []\n---\n\nMais recente\n');
  let state=await vault.load();assert.equal(state.notes.length,1);assert.equal(state.notes[0].body,'Mais recente');
  state=await vault.save(state);assert.equal(state.notes[0].id,'note-1');
  const history=await fs.readdir(path.join(vault.directory,'.history'));assert.equal(history.length,1);
  assert.match(await fs.readFile(path.join(vault.directory,'.history',history[0],'caderno.json'),'utf8'),/Conteúdo original/);
});
test('notas adicionadas e removidas externamente são reconhecidas', async t => {
  const vault=await setup(t);await seed(vault,[]);
  await fs.writeFile(path.join(vault.directory,'Externa.md'),'# Uma ideia\n\nSem metadados.');
  let state=await vault.load();assert.equal(state.notes[0].title,'Externa');
  state.tasks.push({id:'task-1',title:'Ler',due:'2026-09-09',priority:'Alta',done:false,noteId:state.notes[0].id});
  await vault.save(state);
  await fs.unlink(path.join(vault.directory,'Externa.md'));assert.equal((await vault.load()).notes.length,0);
});
test('JSON corrompido não é substituído', async t => {
  const vault=await setup(t);await fs.writeFile(path.join(vault.directory,'caderno.json'),'{corrompido');
  await assert.rejects(vault.load());assert.equal(await fs.readFile(path.join(vault.directory,'caderno.json'),'utf8'),'{corrompido');
});
test('backup inválido e caminhos perigosos são rejeitados antes de escrever', async t => {
  const vault=await setup(t);const state=await seed(vault);
  assert.throws(()=>vault.save({...state,routine:{}}),/inválidos/);
  assert.throws(()=>vault.save({...state,notes:[note({file:'../../fora.md'})]}),/inválidos/);
  await assert.rejects(vault.safePath('../fora.md'),/inválido/);
  assert.equal((await vault.load()).revision,state.revision);
});
test('salvamento preserva metadados desconhecidos', async t => {
  const vault=await setup(t);await fs.writeFile(path.join(vault.directory,'Externa.md'),'---\nauthor: "Gabriel"\ncustom:\n  value: 42\n---\n\nTexto');
  const state=await vault.load();state.notes[0].body='Novo texto';await vault.save(state);
  const raw=await fs.readFile(path.join(vault.directory,'Externa.md'),'utf8');assert.match(raw,/author: ("Gabriel"|Gabriel)/);assert.match(raw,/custom:\n  value: 42/);
});
test('tags YAML em bloco e valores personalizados sobrevivem à edição', async t => {
  const vault=await setup(t);
  await fs.writeFile(path.join(vault.directory,'Externa.md'),'---\ntags:\n- java\n- estudos\ncustom: [um, dois]\n---\n\nTexto');
  let state=await vault.load();assert.deepEqual(state.notes[0].tags,['java','estudos']);
  state.notes[0].body='Texto editado';state=await vault.save(state);
  assert.deepEqual(state.notes[0].tags,['java','estudos']);
  assert.match(await fs.readFile(path.join(vault.directory,'Externa.md'),'utf8'),/custom:\n  - um\n  - dois/);
});
test('journal de falha interrompe carregamento sem sobrescrita', async t => {
  const vault=await setup(t);await seed(vault);await fs.writeFile(path.join(vault.directory,'.transaction.json'),'{}');
  await assert.rejects(vault.load(),/interrompido/);
});
test('datas locais, links entre notas, tags e URLs seguras', () => {
  const d=new Date(2026,8,8,23,30);assert.equal(domain.localDate(d),'2026-09-08');
  assert.equal(domain.safeUrl('javascript:alert(1)'),'');assert.match(domain.safeUrl('https://example.com'),/^https:/);
  assert.deepEqual(domain.wikiLinks('Veja [[Java|linguagem]] e [[Outra#seção]]'),[{target:'Java',label:'linguagem'},{target:'Outra',label:'Outra#seção'}]);
  assert.deepEqual(domain.tags(note({body:'Estudar #programação e #java',tags:['java']})),['java','programação']);
  assert.equal(domain.findLinkedNote([note({title:'Programação'})],'programacao').id,'note-1');
});
