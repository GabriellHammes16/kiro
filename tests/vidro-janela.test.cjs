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

test('com cantos do sistema, o vidro não usa transparent: é o que deixa o Windows arredondar a janela e o acrylic', () => {
  assert.deepEqual({ ...opcoes(true)(true, true) }, { backgroundColor: '#00000000' });
  assert.deepEqual({ ...opcoes(true)(false, true) }, { backgroundColor: '#0a0a0a' });
});

test('com cantos do sistema, o acrylic é reaplicado ao perder o foco, senão o Windows o troca por cor lisa', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(fonte, /window\.on\('blur', \(\) => \{ if \(!window\.isDestroyed\(\)\) window\.setBackgroundMaterial\('acrylic'\); \}\)/);
});

test('o evento de fim de carga não toca na janela, que pode ter sido recriada enquanto a página carregava', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const evento = fonte.match(/once\('did-finish-load', \(\) => (.*)/)?.[1];
  assert.ok(evento, 'o evento deve existir');
  assert.doesNotMatch(evento, /\bwindow\./);
});

test('vidro adaptativo: clareia sobre fundo claro, escurece sobre fundo escuro, sem oscilar entre os dois', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const limites = fonte.match(/const BRILHO_PARA_CLAREAR = \d+, BRILHO_PARA_ESCURECER = \d+/)[0];
  const inicio = fonte.indexOf('function tomDoVidro(');
  const contexto = {};
  vm.runInNewContext(`${limites}; ${fonte.slice(inicio, fonte.indexOf('\n}', inicio) + 2)}; this.tomDoVidro = tomDoVidro;`, contexto);
  const { tomDoVidro } = contexto;
  // Brilhos medidos no app: vidro escuro sobre preto, azul e cinza-claro; vidro claro sobre preto, cinza e branco.
  assert.equal(tomDoVidro('escuro', 53), 'escuro');
  assert.equal(tomDoVidro('escuro', 82), 'escuro');
  assert.equal(tomDoVidro('escuro', 90), 'claro');
  assert.equal(tomDoVidro('claro', 191), 'escuro');
  assert.equal(tomDoVidro('claro', 215), 'escuro');
  assert.equal(tomDoVidro('claro', 227), 'claro');
  assert.equal(tomDoVidro('claro', 239), 'claro');
});

test('janela transparente no Windows maximiza pelo duplo clique, que chega como SC_MAXIMIZE', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(fonte, /hookWindowMessage\(WM_SYSCOMMAND, parametro => \{\s*if \(\(parametro\.readUInt32LE\(0\) & 0xFFF0\) === SC_MAXIMIZE\) window\.isMaximized\(\) \? window\.unmaximize\(\) : window\.maximize\(\);/);
});

test('sem vidro, ou sem suporte na plataforma, a janela segue opaca', () => {
  assert.deepEqual({ ...opcoes(true)(false) }, { backgroundColor: '#0a0a0a' });
  assert.deepEqual({ ...opcoes(false)(true) }, { backgroundColor: '#0a0a0a' });
});
