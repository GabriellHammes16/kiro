// Simulação: o cofre foi apagado e só sobrou o backup exportado pelo app ("Exportar dados").
// Tudo em pastas temporárias; nenhum cofre real é tocado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');
const { validateState, habitStats } = require('../domain.js');
const { createKiroAgent } = require('../agent/index.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
const pasta = async t => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-backup-')); t.after(() => fs.rm(d, { recursive: true, force: true })); return d; };
const dia = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// O mesmo que o app faz em "Importar dados": valida o JSON, descarta caminhos de arquivo e salva por cima do cofre aberto.
async function importarComoOApp(vault, texto) {
  const atual = await vault.load();
  const dados = validateState(JSON.parse(texto));
  dados.notes = dados.notes.map(n => { const copia = { ...n }; delete copia.file; return copia; });
  return vault.save({ ...dados, revision: atual.revision, vaultPath: atual.vaultPath });
}
// O que precisa sobreviver, sem campos que o cofre recalcula (arquivo, revisão, caminho no disco).
const essencial = s => ({
  notas: s.notes.map(n => ({ id: n.id, title: n.title, body: n.body, tags: n.tags, links: n.links, createdAt: n.createdAt, pasta: s.folders.find(f => f.id === n.folderId)?.path || '' })).sort((a, b) => a.id.localeCompare(b.id)),
  pastas: s.folders.map(f => ({ id: f.id, path: f.path, color: f.color, description: f.description })).sort((a, b) => a.id.localeCompare(b.id)),
  tarefas: s.tasks,
  habitos: s.habits,
  historico: s.habitLog,
});

test('cofre apagado: importar o backup exportado remonta notas, pastas, tarefas e hábitos com o progresso', async t => {
  // 1. Um cofre usado de verdade.
  const diretorioA = await pasta(t);
  const original = new Vault(diretorioA);
  let estado = await original.load();
  const anexo = await original.saveAttachment({ name: 'print.png', data: PNG });
  const criada = new Date(2026, 7, 2).getTime();
  estado = await original.save({
    ...estado,
    folders: [
      { id: 'estudos', title: 'Estudos', parentId: '', description: 'Faculdade', color: 'azul' },
      { id: 'python', title: 'Python', parentId: 'estudos', description: '', color: 'verde' },
    ],
    notes: [
      { id: 'n1', title: 'Listas em Python', body: `Listas guardam itens.\n\n![[${anexo.path}|300]]\n\nVer [[Plano]] #python`, links: ['https://docs.python.org'], tags: ['estudo'], folderId: 'python', createdAt: criada, updatedAt: Date.now() },
      { id: 'n2', title: 'Plano', body: '- [ ] Revisar listas', links: [], tags: ['inbox'], folderId: '', createdAt: criada, updatedAt: Date.now() },
    ],
    tasks: [{ id: 't1', title: 'Entregar trabalho', due: dia(-2), priority: 'Alta', noteId: 'n1', done: false }],
    habits: [
      { id: 'agua', title: 'Beber água', frequency: { type: 'daily' }, createdAt: new Date(2026, 0, 1).getTime() },
      { id: 'treino', title: 'Treino', frequency: { type: 'days', days: [1, 3, 5] }, createdAt: new Date(2026, 0, 1).getTime() },
      { id: 'ler', title: 'Ler', frequency: { type: 'weekly', times: 3 }, createdAt: new Date(2026, 0, 1).getTime() },
    ],
    habitLog: { agua: [dia(0), dia(1), dia(2), dia(4)], treino: [dia(3), dia(5)], ler: [dia(1), dia(2)] },
  });
  const antes = essencial(estado);
  const progressoAntes = estado.habits.map(h => habitStats(h, estado.habitLog[h.id] || []));
  const agenteAntes = await createKiroAgent({ vaultDirectory: diretorioA }).toolkit.call('get_habits', {}, { clientId: 'teste' });

  // 2. "Exportar dados" e 3. o cofre some.
  const backup = JSON.stringify(estado, null, 2);
  await fs.rm(diretorioA, { recursive: true, force: true });

  // 4. Cofre novo e vazio, e "Importar dados".
  const diretorioB = await pasta(t);
  await importarComoOApp(new Vault(diretorioB), backup);

  // 5. Abrir o Kiro de novo: lê do disco, não da memória.
  const lido = await new Vault(diretorioB).load();
  assert.deepEqual(essencial(lido), antes);
  assert.deepEqual(lido.habits.map(h => habitStats(h, lido.habitLog[h.id] || [])), progressoAntes);
  const agenteDepois = await createKiroAgent({ vaultDirectory: diretorioB }).toolkit.call('get_habits', {}, { clientId: 'teste' });
  assert.deepEqual(agenteDepois, agenteAntes);

  // Os arquivos Markdown voltam para as pastas certas.
  assert.match(lido.notes.find(n => n.id === 'n1').file, /^Estudos\/Python\/.+\.md$/);
  // Limite conhecido: o backup JSON não carrega as imagens coladas nas notas.
  await assert.rejects(new Vault(diretorioB).readAttachment(anexo.path));
});

test('backup antigo com "rotina" vira hábitos, e o dia marcado entra no histórico', async t => {
  const diretorio = await pasta(t);
  const antigo = JSON.stringify({
    formatVersion: 3, notes: [], tasks: [], folders: [],
    routine: [{ id: 'r1', title: 'Beber água', date: dia(0), done: true }, { id: 'r2', title: 'Meditar', date: dia(0), done: false }],
  });
  await importarComoOApp(new Vault(diretorio), antigo);
  const lido = await new Vault(diretorio).load();
  assert.deepEqual(lido.habits.map(h => [h.title, h.frequency.type]), [['Beber água', 'daily'], ['Meditar', 'daily']]);
  assert.deepEqual(lido.habitLog, { r1: [dia(0)] });
  assert.equal(lido.routine, undefined);
  assert.equal(JSON.parse(await fs.readFile(path.join(diretorio, 'caderno.json'), 'utf8')).routine, undefined);
});
