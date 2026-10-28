const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Executa a função real de electron/main.cjs; só a plataforma é substituída.
function opcoes(suportado) {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const inicio = fonte.indexOf('function opcoesDoVidro(');
  assert.ok(inicio >= 0, 'opcoesDoVidro deve existir');
  const contexto = { VIDRO_NATIVO: suportado };
  vm.runInNewContext(fonte.slice(inicio, fonte.indexOf('\n}', inicio) + 2), contexto);
  return contexto.opcoesDoVidro;
}

test('vidro cria a janela transparente, para o desktop aparecer atrás do véu', () => {
  assert.deepEqual({ ...opcoes(true)(true) }, { transparent: true, backgroundColor: '#00000000' });
});

test('sem vidro, ou sem suporte na plataforma, a janela segue opaca', () => {
  assert.deepEqual({ ...opcoes(true)(false) }, { backgroundColor: '#0a0a0a' });
  assert.deepEqual({ ...opcoes(false)(true) }, { backgroundColor: '#0a0a0a' });
});
