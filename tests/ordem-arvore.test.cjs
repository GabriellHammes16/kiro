const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');
const { ordenarPelaOrdem, reordenar, validateState, mesclarEstados } = require('../domain.js');

const porTitulo = (a, b) => a.title.localeCompare(b.title);
const itens = titulos => titulos.map(t => ({ id: t.toLowerCase(), title: t }));

test('sem ordem manual, a árvore segue o título; com ordem, quem está nela vem primeiro', () => {
  const pastas = itens(['Mira', 'Git', 'Utilidades']);
  assert.deepEqual(ordenarPelaOrdem(pastas, undefined, porTitulo).map(x => x.id), ['git', 'mira', 'utilidades']);
  assert.deepEqual(ordenarPelaOrdem(pastas, ['utilidades'], porTitulo).map(x => x.id), ['utilidades', 'git', 'mira']);
});

test('reordenar põe o item antes do alvo, ou no fim, e tira o item da pasta antiga', () => {
  const irmaos = ['git', 'mira', 'utilidades'];
  assert.deepEqual(reordenar({}, '', irmaos, 'utilidades', 'git')[''], ['utilidades', 'git', 'mira']);
  assert.deepEqual(reordenar({}, '', irmaos, 'git', null)[''], ['mira', 'utilidades', 'git']);
  const ordem = reordenar({ p1: ['n1', 'n2'] }, 'p2', ['n3'], 'n1', 'n3');
  assert.deepEqual(ordem, { p1: ['n2'], p2: ['n1', 'n3'] });
});

test('validateState recusa ordem malformada', () => {
  const base = { notes: [], tasks: [], folders: [] };
  assert.doesNotThrow(() => validateState({ ...base, ordem: { '': ['a', 'b'] } }));
  assert.throws(() => validateState({ ...base, ordem: [] }));
  assert.throws(() => validateState({ ...base, ordem: { '': 'a' } }));
});

test('mescla: a ordem mudada nesta janela vale sobre a do disco; sem mudança, fica a do disco', () => {
  const vazio = { notes: [], tasks: [], habits: [], habitLog: {}, folders: [], fluxos: [] };
  const base = { ...vazio, ordem: { '': ['a', 'b'] } };
  assert.deepEqual(mesclarEstados(base, { ...vazio, ordem: { '': ['b', 'a'] } }, { ...vazio, ordem: { '': ['a', 'b'] } }).estado.ordem, { '': ['b', 'a'] });
  assert.deepEqual(mesclarEstados(base, base, { ...vazio, ordem: { '': ['c'] } }).estado.ordem, { '': ['c'] });
});

test('o cofre guarda a ordem no caderno.json e descarta ids que não existem mais', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-ordem-'));
  try {
    const v = new Vault(dir);
    const atual = await v.load();
    const folders = [{ id: 'f-mira', title: 'Mira', parentId: '', color: '#AABBCC' }, { id: 'f-util', title: 'Utilidades', parentId: '', color: 'url(x)' }];
    await v.save({ ...atual, folders, ordem: { '': ['f-util', 'f-mira', 'sumiu'] } });
    const lido = await v.load();
    assert.deepEqual(lido.ordem, { '': ['f-util', 'f-mira'] });
    assert.equal(lido.folders.find(f => f.id === 'f-mira').color, '#aabbcc', 'cor livre #rrggbb fica guardada');
    assert.equal(lido.folders.find(f => f.id === 'f-util').color, '', 'qualquer outra coisa vira sem cor');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'caderno.json'), 'utf8')).ordem, { '': ['f-util', 'f-mira'] });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
