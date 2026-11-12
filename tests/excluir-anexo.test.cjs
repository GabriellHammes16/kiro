const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../vault.cjs');
const { quemUsaAnexo } = require('../domain.js');

const nota = (id, body) => ({ id, title: id, body, links: [], tags: [], folderId: '', updatedAt: 1 });

test('quemUsaAnexo acha outras notas e fluxos que usam o arquivo, menos a nota ignorada', () => {
  const state = {
    notes: [nota('a', 'Veja ![[Anexos/livro.pdf#page=3]]'), nota('b', '![[anexos/LIVRO.pdf|500]]'), nota('c', 'nada aqui')],
    fluxos: [{ id: 'f', title: 'Mapa', canvas: { nodes: [{ id: 'n', type: 'file', file: 'Anexos/livro.pdf' }], edges: [] } }],
  };
  assert.deepEqual(quemUsaAnexo(state, 'Anexos/livro.pdf', 'a'), ['b', 'Mapa']);
  assert.deepEqual(quemUsaAnexo({ notes: [nota('a', '![[Anexos/livro.pdf]]')], fluxos: [] }, 'Anexos/livro.pdf', 'a'), []);
});

test('excluirAnexo manda o PDF para a lixeira, e restaurar traz o arquivo de volta', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-anexo-'));
  try {
    const v = new Vault(dir);
    await fs.mkdir(path.join(dir, 'Anexos'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Anexos', 'livro.pdf'), '%PDF-1.4 teste');
    const antes = await v.load();
    const depois = await v.excluirAnexo({ caminho: 'Anexos/livro.pdf', revision: antes.revision });
    await assert.rejects(fs.access(path.join(dir, 'Anexos', 'livro.pdf')), 'o arquivo saiu da pasta');
    const lixeira = await v.trash();
    assert.equal(lixeira.length, 1);
    assert.equal(lixeira[0].kind, 'anexo');
    assert.equal(lixeira[0].title, 'livro.pdf');
    await v.restore({ entryId: lixeira[0].entryId, revision: depois.revision });
    assert.equal(await fs.readFile(path.join(dir, 'Anexos', 'livro.pdf'), 'utf8'), '%PDF-1.4 teste');
    assert.equal((await v.trash()).length, 0, 'restaurado não aparece mais na lixeira');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('excluirAnexo recusa caminho fora do cofre, nota e revisão velha', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-anexo-'));
  try {
    const v = new Vault(dir);
    const { revision } = await v.load();
    await assert.rejects(v.excluirAnexo({ caminho: '../fora.pdf', revision }));
    await assert.rejects(v.excluirAnexo({ caminho: 'C:/fora.pdf', revision }));
    await assert.rejects(v.excluirAnexo({ caminho: 'nota.md', revision }));
    await assert.rejects(v.excluirAnexo({ caminho: 'Anexos/nao-existe.pdf', revision }));
    await assert.rejects(v.excluirAnexo({ caminho: 'Anexos/x.pdf', revision: 'velha' }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
