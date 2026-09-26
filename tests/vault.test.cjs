const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');
const domain = require('../domain.js');
const note = (overrides = {}) => ({ id: 'note-1', title: 'Minha nota', body: 'Conteúdo original', links: [], tags: [], folderId: '', updatedAt: Date.now(), ...overrides });
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-test-'));
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

test('salvamento concluído não deixa lixo em .staging', async t => {
  const vault=await setup(t);let state=await seed(vault);
  for(let i=0;i<3;i++){state.notes[0].body=`versão ${i}`;state=await vault.save(state);}
  await assert.rejects(fs.access(path.join(vault.directory,'.staging')),'.staging deveria sumir após o commit');
});

test('.history é podado ao passar do limite, sem tocar na lixeira', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kiro-hist-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const vault=new Vault(directory,{historyLimit:3});
  let state=await vault.load();
  state=await vault.save({...state,notes:[note(),note({id:'note-2',title:'Outra'})]});

  // uma exclusão precisa continuar recuperável depois da poda
  const apagada=state.notes.find(n=>n.id==='note-2');
  state=await vault.save({...state,notes:state.notes.filter(n=>n.id!=='note-2')});
  assert.equal((await vault.trash()).length,1);

  for(let i=0;i<6;i++){state.notes[0].body=`edição ${i}`;state=await vault.save(state);}
  const snapshots=await fs.readdir(path.join(directory,'.history'));
  assert.ok(snapshots.length<=3,`esperava no máximo 3 snapshots, veio ${snapshots.length}`);

  // o mais recente sobrevive e a lixeira segue intacta
  const maisNovo=snapshots.sort((a,b)=>Number(b.split('-')[0])-Number(a.split('-')[0]))[0];
  await fs.access(path.join(directory,'.history',maisNovo,'caderno.json'));
  const lixeira=await vault.trash();
  assert.equal(lixeira.length,1);
  assert.equal(lixeira[0].title,apagada.title);
  state=await vault.restore({entryId:lixeira[0].entryId,revision:state.revision});
  assert.equal(state.notes.length,2);
});

test('historyLimit 0 desliga a poda', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kiro-hist0-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const vault=new Vault(directory,{historyLimit:0});
  let state=await vault.load();
  state=await vault.save({...state,notes:[note()]});
  for(let i=0;i<4;i++){state.notes[0].body=`v${i}`;state=await vault.save(state);}
  // O primeiro salvamento num cofre vazio não gera snapshot: não há nada para copiar.
  // Sobram 4 — mais do que o padrão de 3 usado no teste anterior, provando que não houve poda.
  assert.equal((await fs.readdir(path.join(directory,'.history'))).length,4);
});

test('restaurar pasta traz de volta subpastas, notas e identificadores', async t => {
  const vault=await setup(t);
  let state=await vault.load();
  state=await vault.save({...state,
    folders:[{id:'pai',title:'Estudos',parentId:'',description:''},{id:'filha',title:'Python',parentId:'pai',description:''}],
    notes:[note({id:'n1',title:'Solta'}),note({id:'n2',title:'Na raiz da pasta',folderId:'pai'}),note({id:'n3',title:'Na subpasta',folderId:'filha'})]});
  const caminhoOriginal=state.notes.find(n=>n.id==='n3').file;
  assert.match(caminhoOriginal,/^Estudos\/Python\//);

  // remover a pasta-mãe leva junto a subpasta e as duas notas
  state=await vault.save({...state,folders:[],notes:state.notes.filter(n=>n.id==='n1')});
  await assert.rejects(fs.access(path.join(vault.directory,'Estudos')));

  const lixeira=await vault.trash();
  const entrada=lixeira.find(i=>i.kind==='folder');
  assert.ok(entrada,'a pasta deveria estar na lixeira');
  assert.equal(entrada.title,'Estudos');
  assert.equal(entrada.noteCount,2);
  assert.equal(entrada.folderCount,2);

  state=await vault.restore({entryId:entrada.entryId,revision:state.revision});
  assert.deepEqual(state.folders.map(f=>f.path).sort(),['Estudos','Estudos/Python']);
  assert.equal(state.notes.length,3);
  // os identificadores voltam, então as tarefas ligadas às notas seguem valendo
  assert.deepEqual(state.notes.map(n=>n.id).sort(),['n1','n2','n3']);
  assert.equal(state.notes.find(n=>n.id==='n3').file,caminhoOriginal);
  await fs.access(path.join(vault.directory,caminhoOriginal));
});

test('restaurar com revisão vencida é recusado sem alterar o cofre', async t => {
  const vault=await setup(t);
  let state=await seed(vault);
  const antiga=state.revision;
  state=await vault.save({...state,notes:[]});
  const entrada=(await vault.trash())[0];
  await assert.rejects(vault.restore({entryId:entrada.entryId,revision:antiga}),/mudou/);
  assert.equal((await vault.load()).notes.length,0);
  // com a revisão correta, funciona
  state=await vault.restore({entryId:entrada.entryId,revision:state.revision});
  assert.equal(state.notes.length,1);
});

test('restaurar pasta cujas notas foram movidas não duplica as notas', async t => {
  const vault=await setup(t);
  await fs.mkdir(path.join(vault.directory,'Estudos/Python'),{recursive:true});
  await fs.writeFile(path.join(vault.directory,'Estudos/basico.md'),'---\ntitle: Basico\n---\n\nx\n');
  await fs.writeFile(path.join(vault.directory,'Estudos/Python/listas.md'),'---\ntitle: Listas\n---\n\ny\n');
  await fs.writeFile(path.join(vault.directory,'Estudos/anexo.txt'),'um anexo');
  let state=await vault.load();
  const idsOriginais=state.notes.map(n=>n.id).sort();

  // é o que a interface faz ao excluir uma pasta: some com as pastas, notas vão para a raiz
  state=await vault.save({...state,folders:[],notes:state.notes.map(n=>({...n,folderId:''}))});
  const entrada=(await vault.trash()).find(i=>i.kind==='folder');
  state=await vault.restore({entryId:entrada.entryId,revision:state.revision});

  assert.deepEqual(state.folders.map(f=>f.path).sort(),['Estudos','Estudos/Python']);
  assert.equal(state.notes.length,2,'nenhuma nota pode ser duplicada pela restauração');
  assert.deepEqual(state.notes.map(n=>n.id).sort(),idsOriginais);
  assert.deepEqual(state.notes.map(n=>n.file).sort(),['basico.md','listas.md']);
  // anexos, que não são notas, voltam para dentro da pasta
  await fs.access(path.join(vault.directory,'Estudos/anexo.txt'));
});
test('cor da pasta sobrevive a salvar, renomear e reabrir; cor fora da paleta é descartada', async t => {
  const vault=await setup(t);let state=await seed(vault);
  state.folders=[{id:'f-azul',title:'Java',parentId:'',description:'',color:'azul'},{id:'f-ruim',title:'Outra',parentId:'',description:'',color:'red;background:url(x)'}];
  state=await vault.save(state);
  state.folders.find(f=>f.id==='f-azul').title='Programação';state=await vault.save(state);
  const reaberto=await new Vault(vault.directory).load();
  assert.equal(reaberto.folders.find(f=>f.id==='f-azul').color,'azul');
  assert.equal(reaberto.folders.find(f=>f.id==='f-ruim').color,'');
});
test('createdAt sobrevive à reabertura; nota antiga sem o campo recebe uma data válida', async t => {
  const vault=await setup(t);const criada=Date.UTC(2026,8,2);
  const state=await seed(vault,[note({createdAt:criada})]);
  assert.match(await fs.readFile(path.join(vault.directory,state.notes[0].file),'utf8'),/^createdAt: /m);
  assert.equal((await new Vault(vault.directory).load()).notes[0].createdAt,criada);
  await fs.writeFile(path.join(vault.directory,'antiga.md'),'---\ntitle: Antiga\n---\n\nSem data de criação\n');
  const antiga=(await new Vault(vault.directory).load()).notes.find(n=>n.title==='Antiga');
  assert.ok(Number.isFinite(antiga.createdAt)&&antiga.createdAt>0);
  assert.doesNotMatch(await fs.readFile(path.join(vault.directory,'antiga.md'),'utf8'),/createdAt/);
});
test('datas lidas do sistema de arquivos viram inteiros', async t => {
  const vault=await setup(t);await seed(vault,[]);
  const file=path.join(vault.directory,'Solta.md');
  await fs.writeFile(file,'Nota sem frontmatter');
  // Força milissegundos fracionários, como o Windows costuma devolver
  await fs.utimes(file,1789526443.1234567,1789526443.1234567);
  const solta=(await vault.load()).notes.find(n=>n.title==='Solta');
  assert.ok(Number.isInteger(solta.createdAt),`createdAt: ${solta.createdAt}`);
  assert.ok(Number.isInteger(solta.updatedAt),`updatedAt: ${solta.updatedAt}`);
});

test('layout da Hoje: ida e volta em .kiro/hoje.json; sem arquivo ou quebrado, null', async t => {
  const vault = await setup(t);
  assert.equal(await vault.readHomeLayout(), null);
  const layout = { colunas: 3, cartoes: [{ id: 'nativo:habitos', coluna: 2, largura: 'normal', opcoes: { mostrarSemana: false } }], ocultos: [] };
  await vault.writeHomeLayout(layout);
  assert.deepEqual(await vault.readHomeLayout(), layout);
  assert.ok((await fs.readFile(path.join(vault.directory, '.kiro', 'hoje.json'), 'utf8')).endsWith('\n'));
  await fs.writeFile(path.join(vault.directory, '.kiro', 'hoje.json'), '{quebrado');
  assert.equal(await vault.readHomeLayout(), null);
});

const escreverCanvas = async (vault, arquivo, conteudo) => {
  await fs.mkdir(path.dirname(path.join(vault.directory, arquivo)), { recursive: true });
  await fs.writeFile(path.join(vault.directory, arquivo), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
};
const umCartao = { id: 'a', type: 'text', text: 'Oi', x: 0, y: 0, width: 200, height: 60 };

test('fluxo: .canvas do disco entra em state.fluxos com título, pasta e canvas', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Ideias/Mapa.canvas', { nodes: [umCartao], edges: [] });
  const s = await vault.load();
  assert.equal(s.fluxos.length, 1);
  const f = s.fluxos[0];
  assert.equal(f.title, 'Mapa');
  assert.equal(f.file, 'Ideias/Mapa.canvas');
  assert.equal(f.folderId, s.folders.find(x => x.title === 'Ideias').id);
  assert.equal(f.canvas.nodes[0].text, 'Oi');
  assert.match(f.id, /^fluxo-[0-9a-f]{32}$/);
  assert.equal((await vault.load()).fluxos[0].id, f.id, 'id estável entre leituras');
});

test('fluxo: JSON inválido ou tipo desconhecido entra com erro, sem derrubar o cofre', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  await escreverCanvas(vault, 'Futuro.canvas', { nodes: [{ ...umCartao, type: 'video' }], edges: [] });
  const s = await vault.load();
  assert.equal(s.notes.length, 1);
  assert.match(s.fluxos.find(f => f.title === 'Quebrado').erro, /JSON inválido/);
  assert.match(s.fluxos.find(f => f.title === 'Futuro').erro, /tipo desconhecido/);
  assert.equal(s.fluxos.find(f => f.title === 'Quebrado').canvas, undefined);
});

test('fluxo: arquivos ocultos e fora de .canvas não viram fluxo', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, '.oculto/Mapa.canvas', { nodes: [], edges: [] });
  await escreverCanvas(vault, 'Mapa.json', { nodes: [], edges: [] });
  assert.deepEqual((await vault.load()).fluxos, []);
});

test('fluxo: arquivo recriado no caminho de um fluxo renomeado não colide de id com ele', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Z.canvas', { nodes: [], edges: [] });
  let s = await vault.load();
  const H = s.fluxos[0].id;
  assert.match(H, /^fluxo-[0-9a-f]{32}$/);
  await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], title: 'A' }] });
  await escreverCanvas(vault, 'Z.canvas', { nodes: [], edges: [] });
  const s2 = await vault.load();
  assert.equal(s2.fluxos.length, 2);
  assert.equal(new Set(s2.fluxos.map(f => f.id)).size, 2);
  assert.equal(s2.fluxos.find(f => f.file === 'A.canvas').id, H);
});

const pasta = { id: 'pasta-1', title: 'Ideias', parentId: '', description: '', color: '' };
async function comPasta(vault) { const s = await seed(vault); return vault.save({ ...s, folders: [pasta] }); }
const vazio = () => ({ nodes: [], edges: [] });

test('fluxo novo vira <pasta>/<título>.canvas com tabulação, e o id vai para o caderno.json', async t => {
  const vault = await setup(t); const s = await comPasta(vault);
  const salvo = await vault.save({ ...s, fluxos: [{ id: 'fluxo-novo', title: 'Plano', folderId: 'pasta-1', canvas: { nodes: [umCartao], edges: [] } }] });
  const texto = await fs.readFile(path.join(vault.directory, 'Ideias', 'Plano.canvas'), 'utf8');
  assert.match(texto, /\n\t"nodes"/);
  assert.equal(salvo.fluxos[0].id, 'fluxo-novo');
  const meta = JSON.parse(await fs.readFile(path.join(vault.directory, 'caderno.json'), 'utf8'));
  assert.deepEqual(meta.fluxos, [{ id: 'fluxo-novo', path: 'Ideias/Plano.canvas' }]);
});

test('renomear e mover um fluxo trocam o arquivo e mantêm o id', async t => {
  const vault = await setup(t); let s = await comPasta(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: '', canvas: vazio() }] });
  s = await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], title: 'Plano B', folderId: 'pasta-1' }] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Plano.canvas')));
  await fs.access(path.join(vault.directory, 'Ideias', 'Plano B.canvas'));
  assert.equal((await vault.load()).fluxos[0].id, 'fluxo-1');
});

test('renomear a pasta leva o fluxo junto, com o mesmo id', async t => {
  const vault = await setup(t); let s = await comPasta(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: 'pasta-1', canvas: vazio() }] });
  s = await vault.save({ ...s, folders: [{ ...pasta, title: 'Projetos' }] });
  assert.equal(s.fluxos[0].file, 'Projetos/Plano.canvas');
  assert.equal(s.fluxos[0].id, 'fluxo-1');
});

test('mover um fluxo pra fora de uma pasta apagada na mesma gravação não duplica o arquivo na lixeira', async t => {
  const vault = await setup(t); let s = await comPasta(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: 'pasta-1', canvas: vazio() }] });
  s = await vault.save({ ...s, folders: [], fluxos: [{ ...s.fluxos[0], folderId: '' }] });
  await fs.access(path.join(vault.directory, 'Plano.canvas'));
  const trash = await vault.trash();
  assert.equal(trash.length, 1);
  const entry = await vault.readTrash(trash[0].entryId);
  assert.ok(!entry.files.includes('Ideias/Plano.canvas'));
});

test('canvas sem mudança não é regravado; campos desconhecidos sobrevivem a uma edição', async t => {
  const vault = await setup(t); await seed(vault);
  const original = '{\n  "nodes": [{"id":"a","type":"text","text":"Oi","x":0,"y":0,"width":200,"height":60,"styleAttributes":{"shape":"pill"}},{"id":"c","type":"text","text":"Lá","x":300,"y":0,"width":200,"height":60}],\n  "edges": [{"id":"e1","fromNode":"a","toNode":"c","styleAttributes":{"pathfindingMethod":"square"}}],\n  "x-extra": 1\n}';
  await escreverCanvas(vault, 'Mapa.canvas', original);
  let s = await vault.load();
  s = await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, body: 'mudou' })) });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'), original);
  const c = s.fluxos[0].canvas;
  await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], canvas: { ...c, nodes: [...c.nodes, { ...umCartao, id: 'b' }] } }] });
  const gravado = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(gravado['x-extra'], 1);
  assert.deepEqual(gravado.nodes[0].styleAttributes, { shape: 'pill' });
  assert.equal(gravado.nodes.length, 3);
  assert.deepEqual(gravado.edges[0].styleAttributes, { pathfindingMethod: 'square' });
});

test('fluxo com erro nunca é regravado, nem se a interface mandar um canvas para ele', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  const s = await vault.load();
  const { erro, ...semErro } = s.fluxos[0];
  await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, body: 'x' })), fluxos: [{ ...semErro, canvas: vazio() }] });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Quebrado.canvas'), 'utf8'), '{nope');
});

test('fluxo com tipo de cartão desconhecido fica byte a byte intacto depois de um salvamento não relacionado', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Futuro.canvas', { nodes: [{ ...umCartao, type: 'video' }], edges: [] });
  const original = await fs.readFile(path.join(vault.directory, 'Futuro.canvas'), 'utf8');
  const s = await vault.load();
  await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, body: 'mudou outra vez' })) });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Futuro.canvas'), 'utf8'), original);
});

test('fluxo: salvamento sem a lista de fluxos (backup antigo) não exclui nenhum', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Mapa.canvas', { nodes: [], edges: [] });
  const s = await vault.load();
  const { fluxos, ...semFluxos } = s;
  await vault.save({ ...semFluxos, notes: s.notes.map(n => ({ ...n, body: 'y' })) });
  await fs.access(path.join(vault.directory, 'Mapa.canvas'));
  assert.equal((await vault.load()).fluxos.length, fluxos.length);
});

test('renomear um fluxo reescreve [[X.canvas]] nas notas que apontam pra ele', async t => {
  const vault = await setup(t);
  await seed(vault, [note({ body: 'Veja o mapa em [[Plano.canvas]].' })]);
  await escreverCanvas(vault, 'Plano.canvas', vazio());
  let s = await vault.load();
  s = await vault.save({ ...s, fluxos: [{ ...s.fluxos[0], title: 'Plano B' }] });
  assert.match(s.notes[0].body, /\[\[Plano B\.canvas\]\]/);
});

test('nome inválido, canvas inválido e nome repetido recusam o salvamento inteiro', async t => {
  const vault = await setup(t); const s = await comPasta(vault);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'a/b', canvas: vazio() }] }), /inválido/);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Ok', canvas: { nodes: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0, width: 10, height: 10, color: 'red;' }], edges: [] } }] }), /cor/);
  await assert.rejects(vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', canvas: vazio() }, { id: 'f2', title: 'mapa', canvas: vazio() }] }), /Já existe/);
  assert.deepEqual((await vault.load()).fluxos, []);
});

test('fluxo: cartão de nota acompanha a nota quando a pasta é renomeada e quando a nota muda de pasta', async t => {
  const vault = await setup(t);
  let s = await seed(vault, [note({ id: 'n1', title: 'Alvo' })]);   // a pasta ainda não existe: validateState recusaria folderId 'p1'
  s = await vault.save({ ...s, folders: [{ id: 'p1', title: 'Ideias', parentId: '', description: '', color: '' }], notes: s.notes.map(n => ({ ...n, folderId: 'p1' })) });
  const arquivo = s.notes[0].file;
  const outro = { id: 'x', type: 'text', text: 'solto', x: 0, y: 0, width: 200, height: 60 };
  s = await vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', folderId: '', canvas: { nodes: [{ id: 'c', type: 'file', file: arquivo, x: 0, y: 0, width: 400, height: 280 }], edges: [] } }, { id: 'f2', title: 'Sem nota', folderId: '', canvas: { nodes: [outro], edges: [] } }] });
  const bytesF2 = await fs.readFile(path.join(vault.directory, 'Sem nota.canvas'));
  // Renomear a pasta
  s = await vault.save({ ...s, folders: [{ ...s.folders[0], title: 'Projetos' }] });
  const novo = s.notes[0].file;
  assert.match(novo, /^Projetos\//);
  const lido = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(lido.nodes[0].file, novo);
  assert.deepEqual(await fs.readFile(path.join(vault.directory, 'Sem nota.canvas')), bytesF2);
  // Mover a nota para a raiz
  s = await vault.save({ ...s, notes: s.notes.map(n => ({ ...n, folderId: '' })) });
  assert.equal(JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8')).nodes[0].file, s.notes[0].file);
  assert.doesNotMatch(s.notes[0].file, /\//);
});

test('fluxo: nota apagada não apaga o cartão', async t => {
  const vault = await setup(t);
  let s = await seed(vault);
  const arquivo = s.notes[0].file;
  s = await vault.save({ ...s, fluxos: [{ id: 'f1', title: 'Mapa', folderId: '', canvas: { nodes: [{ id: 'c', type: 'file', file: arquivo, x: 0, y: 0, width: 400, height: 280 }], edges: [] } }] });
  s = await vault.save({ ...s, notes: [] });
  const lido = JSON.parse(await fs.readFile(path.join(vault.directory, 'Mapa.canvas'), 'utf8'));
  assert.equal(lido.nodes.length, 1);
  assert.equal(lido.nodes[0].file, arquivo);
});

test('fluxo: excluir manda para a lixeira; restaurar volta no mesmo lugar, com o mesmo id e o mesmo conteúdo', async t => {
  const vault = await setup(t); let s = await seed(vault);
  s = await vault.save({ ...s, folders: [{ id: 'p1', title: 'Ideias', parentId: '', description: '', color: '' }] });
  const conteudo = { nodes: [{ id: 'a', type: 'text', text: 'Oi', x: 0, y: 0, width: 200, height: 60 }], edges: [] };
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: 'p1', canvas: conteudo }] });
  s = await vault.save({ ...s, fluxos: [] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Ideias', 'Plano.canvas')));
  const lixeira = await vault.trash();
  const item = lixeira.find(i => i.kind === 'fluxo');
  assert.equal(item.title, 'Plano');
  const restaurado = await vault.restore({ entryId: item.entryId, revision: s.revision });
  const f = restaurado.fluxos.find(x => x.id === 'fluxo-1');
  assert.equal(f.file, 'Ideias/Plano.canvas');
  assert.deepEqual(f.canvas, conteudo);
  assert.equal((await vault.trash()).some(i => i.kind === 'fluxo'), false);
});

test('fluxo: restaurar recusa se o nome já foi reusado na mesma pasta, e nada muda', async t => {
  const vault = await setup(t); let s = await seed(vault);
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-1', title: 'Plano', folderId: '', canvas: { nodes: [], edges: [] } }] });
  s = await vault.save({ ...s, fluxos: [] });
  s = await vault.save({ ...s, fluxos: [{ id: 'fluxo-2', title: 'plano', folderId: '', canvas: { nodes: [], edges: [] } }] });
  const item = (await vault.trash()).find(i => i.kind === 'fluxo');
  await assert.rejects(vault.restore({ entryId: item.entryId, revision: s.revision }), /Já existe/);
  const depois = await vault.load();
  assert.deepEqual(depois.fluxos.map(f => f.id), ['fluxo-2']);
  assert.ok((await vault.trash()).some(i => i.kind === 'fluxo'));
});

test('fluxo com erro pode ser excluído: o arquivo vai intacto para a lixeira', async t => {
  const vault = await setup(t); await seed(vault);
  await escreverCanvas(vault, 'Quebrado.canvas', '{nope');
  const s = await vault.load();
  await vault.save({ ...s, fluxos: [] });
  await assert.rejects(fs.access(path.join(vault.directory, 'Quebrado.canvas')));
  const item = (await vault.trash()).find(i => i.kind === 'fluxo');
  const volta = await vault.restore({ entryId: item.entryId, revision: (await vault.load()).revision });
  assert.equal(await fs.readFile(path.join(vault.directory, 'Quebrado.canvas'), 'utf8'), '{nope');
  assert.match(volta.fluxos[0].erro, /JSON inválido/);
});
