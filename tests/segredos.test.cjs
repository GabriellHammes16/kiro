// tests/segredos.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { criarGuardaDeSegredos } = require('../segredos-plugins.cjs');

async function guarda(opcoes = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiro-segredos-'));
  const arquivo = path.join(dir, 'sub', 'plugin-secrets.json');
  const g = criarGuardaDeSegredos({ arquivo, cifrar: v => Buffer.from(v).toString('base64'), decifrar: v => Buffer.from(v, 'base64').toString(), ...opcoes });
  return { dir, arquivo, g };
}

test('define, lê, lista sem valor e remove', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await g.definir('C:/cofre', 'tradutor', 'apiKey', 'SEGREDO123');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), { apiKey: true });
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'apiKey'), 'SEGREDO123');
    assert.ok(!(await fs.readFile(arquivo, 'utf8')).includes('SEGREDO123'), 'o arquivo não guarda o valor em claro quando há cifra');
    assert.equal(await g.valor('C:/outro-cofre', 'tradutor', 'apiKey'), null, 'segredo é por cofre');
    await g.remover('C:/cofre', 'tradutor', 'apiKey');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), {});
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'apiKey'), null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('valor vazio ou enorme é recusado; arquivo corrompido não derruba', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', ''), /vazi/i);
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', 42), /texto/i);
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', 'x'.repeat(4097)), /tamanho|4096/i);
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    await fs.writeFile(arquivo, '{ quebrado');
    assert.deepEqual(await g.estado('C:/cofre', 'tradutor'), {});
    await g.definir('C:/cofre', 'tradutor', 'apiKey', 'novo');
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'apiKey'), 'novo');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('remover do plug-in apaga só os dele', async () => {
  const { dir, g } = await guarda();
  try {
    await g.definir('C:/cofre', 'a1', 'k', '1');
    await g.definir('C:/cofre', 'b1', 'k', '2');
    await g.definir('C:/cofre', 'a1-extra', 'k', '3');
    await g.removerDoPlugin('C:/cofre', 'a1');
    assert.deepEqual(await g.estado('C:/cofre', 'a1'), {});
    assert.deepEqual(await g.estado('C:/cofre', 'b1'), { k: true });
    assert.deepEqual(await g.estado('C:/cofre', 'a1-extra'), { k: true }, 'prefixo parecido não conta');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('pluginId e nome inválidos são recusados sem mostrar o valor', async () => {
  const { dir, g } = await guarda();
  try {
    for (const [id, nome] of [['A', 'k'], ['x:y', 'k'], ['ok-id', '1k'], ['ok-id', 'a:b'], ['../x', 'k'], ['ok-id', 'x'.repeat(41)]]) {
      await assert.rejects(g.definir('C:/cofre', id, nome, 'SEGREDO123'), erro => /inválid/i.test(erro.message) && !erro.message.includes('SEGREDO123'));
    }
    await assert.rejects(g.estado('C:/cofre', 'x:y'), /inválid/i);
    await assert.rejects(g.valor('C:/cofre', 'ok-id', 'a:b'), /inválid/i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('falha ao cifrar não vaza o valor', async () => {
  const { dir, g } = await guarda({ cifrar: v => { throw new Error(`falhou com ${v}`); } });
  try {
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'apiKey', 'SEGREDO123'), erro => /cifrar/i.test(erro.message) && !erro.message.includes('SEGREDO123'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('falha ao decifrar (arquivo de outro computador) devolve null e some do estado', async () => {
  const { dir, arquivo } = await guarda();
  try {
    const cifrar = v => Buffer.from(v).toString('base64');
    const outra = criarGuardaDeSegredos({ arquivo, cifrar, decifrar: v => Buffer.from(v, 'base64').toString() });
    await outra.definir('C:/cofre', 'tradutor', 'apiKey', 'SEGREDO123');
    const aqui = criarGuardaDeSegredos({ arquivo, cifrar, decifrar: () => { throw new Error('chave errada'); } });
    assert.equal(await aqui.valor('C:/cofre', 'tradutor', 'apiKey'), null);
    assert.deepEqual(await aqui.estado('C:/cofre', 'tradutor'), {});
    await aqui.definir('C:/cofre', 'tradutor', 'outra', 'y');
    assert.equal(await outra.valor('C:/cofre', 'tradutor', 'apiKey'), 'SEGREDO123', 'entrada ilegível não é apagada por outra gravação');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('gravações concorrentes não perdem entradas', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await Promise.all(Array.from({ length: 30 }, (_, i) => g.definir('C:/cofre', 'tradutor', `k${i}`, `v${i}`)));
    const estado = await g.estado('C:/cofre', 'tradutor');
    assert.equal(Object.keys(estado).length, 30);
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'k17'), 'v17');
    const sobra = (await fs.readdir(path.dirname(arquivo))).filter(f => f.endsWith('.tmp'));
    assert.deepEqual(sobra, []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('uma gravação que falha não trava a fila', async () => {
  const { dir, g } = await guarda();
  try {
    await assert.rejects(g.definir('C:/cofre', 'tradutor', 'k', ''));
    await g.definir('C:/cofre', 'tradutor', 'k', 'v');
    assert.equal(await g.valor('C:/cofre', 'tradutor', 'k'), 'v');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('arquivo só do dono onde o sistema suporta', { skip: process.platform === 'win32' }, async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    await g.definir('/cofre', 'tradutor', 'k', 'v');
    assert.equal((await fs.stat(arquivo)).mode & 0o777, 0o600);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('caminho do cofre é normalizado de forma estável', async () => {
  const { dir, arquivo, g } = await guarda();
  try {
    const cofre = path.join(dir, 'Cofre');
    await g.definir(cofre, 'tradutor', 'k', 'v');
    assert.equal(await g.valor(cofre + path.sep, 'tradutor', 'k'), 'v', 'barra final');
    assert.equal(await g.valor(path.join(cofre, 'x', '..'), 'tradutor', 'k'), 'v', 'segmentos ..');
    const bruto = await fs.readFile(arquivo, 'utf8');
    assert.ok(!bruto.includes('Cofre'), 'o caminho do cofre não aparece em claro');
    if (process.platform === 'win32') {
      await g.definir('C:\\Cofre', 'tradutor', 'win', 'w');
      assert.equal(await g.valor('c:/cofre/', 'tradutor', 'win'), 'w');
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
