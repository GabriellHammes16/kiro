const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TEMAS, SKINS, APARENCIA_PADRAO, contraste, aparenciaValida, classesDaAparencia } = require('../domain.js');

const raiz = path.join(__dirname, '..');
const ler = nome => fs.readFileSync(path.join(raiz, nome), 'utf8');
const VARIAVEIS = ['bg', 'panel', 'panel-raised', 'sidebar-bg', 'content-bg', 'campo', 'ink', 'muted', 'line',
  'acento', 'acento-2', 'acento-forte', 'acento-escuro', 'acento-texto', 'primario-texto'];
const PADRAO = { tema: 'escuro-classico', skin: 'padrao' };

// Lê `--nome:#hex` de um trecho de CSS.
const variaveis = trecho => Object.fromEntries([...trecho.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2].toUpperCase()]));
// Junta todos os blocos cujo seletor contém `.tema-<id>` (ex.: `.tema-x,.tema-y{...}`).
function blocoDoTema(css, id) {
  const re = new RegExp(`([^{}]*\\.tema-${id}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');
  return Object.assign({}, ...[...css.matchAll(re)].map(m => variaveis(m[2])));
}

test('aparência padrão: vazio, lixo ou nada viram Escuro Clássico + Padrão', () => {
  for (const salvo of [undefined, null, {}, 'lixo', 42, [], { tema: 7, skin: {} }]) {
    const a = aparenciaValida(salvo);
    assert.equal(a.tema, PADRAO.tema, `tema para ${JSON.stringify(salvo)}`);
    assert.equal(a.skin, PADRAO.skin, `skin para ${JSON.stringify(salvo)}`);
  }
  assert.deepEqual(APARENCIA_PADRAO, { tema: 'escuro-classico', skin: 'padrao', sidebar: '#1A1A20', content: '#141418', acento: '#C77DFF' });
  assert.deepEqual(classesDaAparencia(aparenciaValida(undefined)), ['tema-escuro-classico', 'skin-padrao']);
});

test('tema e skin sobrevivem à ida e volta por JSON e são independentes', () => {
  for (const [tema, skin] of [['neon-tokyo', 'neon'], ['sakura-night', 'suave'], ['alto-contraste', 'terminal'], ['escuro-classico', 'paper']]) {
    const salvo = JSON.parse(JSON.stringify(aparenciaValida({ ...APARENCIA_PADRAO, tema, skin })));
    const a = aparenciaValida(salvo);
    assert.equal(a.tema, tema);
    assert.equal(a.skin, skin);
    assert.deepEqual(classesDaAparencia(a), [`tema-${tema}`, `skin-${skin}`]);
  }
  const p = aparenciaValida(JSON.parse(JSON.stringify({ tema: 'personalizado', skin: 'sharp', sidebar: '#112233', content: '#0A0B0C', acento: '#FF8800' })));
  assert.equal(p.tema, 'personalizado');
  assert.equal(p.skin, 'sharp');
  assert.equal(p.sidebar.toUpperCase(), '#112233');
  assert.equal(p.content.toUpperCase(), '#0A0B0C');
  assert.equal(p.acento.toUpperCase(), '#FF8800');
  assert.deepEqual(classesDaAparencia(p), ['tema-personalizado', 'skin-sharp']);
});

test('ids desconhecidos e cores inválidas caem no padrão', () => {
  const a = aparenciaValida({ tema: 'nao-existe', skin: 'tambem-nao', sidebar: 'red', content: '#12', acento: 'url(x)' });
  assert.equal(a.tema, PADRAO.tema);
  assert.equal(a.skin, PADRAO.skin);
  const p = aparenciaValida({ tema: 'personalizado', skin: 'padrao', sidebar: 'red', content: '#12', acento: 'url(x)' });
  assert.equal(p.sidebar, APARENCIA_PADRAO.sidebar);
  assert.equal(p.content, APARENCIA_PADRAO.content);
  assert.equal(p.acento, APARENCIA_PADRAO.acento);
});

test('migração: salvo antigo sem tema vira personalizado só se tinha cores próprias', () => {
  assert.equal(aparenciaValida({ sidebar: '#223344', content: '#141418', acento: '#C77DFF' }).tema, 'personalizado');
  assert.equal(aparenciaValida({ sidebar: '#1A1A20', content: '#141418', acento: '#5AB0FF' }).tema, 'personalizado');
  assert.equal(aparenciaValida({ sidebar: '#0E0E0E', content: '#0A0A0A', acento: '#C77DFF' }).tema, 'escuro-classico');
  assert.equal(aparenciaValida({ sidebar: '#1A1A20', content: '#141418', acento: '#C77DFF' }).tema, 'escuro-classico');
  assert.equal(aparenciaValida({ sidebar: '#223344' }).skin, 'padrao');
});

test('temas.css define todas as variáveis para cada tema e o seletor de cada skin', () => {
  const css = ler('temas.css');
  for (const id of [...TEMAS.map(([id]) => id), 'personalizado']) {
    const bloco = blocoDoTema(css, id);
    const faltando = VARIAVEIS.filter(v => !bloco[v]);
    assert.deepEqual(faltando, [], `tema ${id}: variáveis faltando em temas.css`);
  }
  for (const [id] of SKINS) assert.match(css, new RegExp(`\\.skin-${id}(?![\\w-])`), `skin ${id}: seletor .skin-${id} ausente em temas.css`);
});

test('Escuro Clássico em temas.css bate com o :root de styles.css', () => {
  const classico = blocoDoTema(ler('temas.css'), 'escuro-classico');
  assert.equal(classico.acento, '#C77DFF');
  const root = Object.assign({}, ...[...ler('styles.css').matchAll(/:root\s*\{([^}]*)\}/g)].map(m => variaveis(m[1])));
  for (const v of ['bg', 'panel', 'ink', 'muted', 'line', 'acento']) assert.equal(classico[v], root[v], `--${v}`);
});

test('index.html carrega temas.css depois de styles.css', () => {
  const html = ler('index.html');
  const estilos = html.indexOf('href="styles.css"'), temas = html.indexOf('href="temas.css"');
  assert.ok(estilos >= 0 && temas > estilos, 'temas.css deve vir depois de styles.css');
});

test('contraste mínimo de 4.5:1 em todos os temas', () => {
  const css = ler('temas.css');
  const pares = [
    ...['bg', 'panel', 'panel-raised', 'sidebar-bg', 'content-bg', 'campo'].map(f => ['ink', f]),
    ...['bg', 'panel', 'panel-raised', 'content-bg'].map(f => ['muted', f]),
    ['acento', 'content-bg'], ['acento', 'panel'],
    ['primario-texto', 'acento-forte'], ['primario-texto', 'acento-escuro'],
    ['acento-texto', 'acento'],
  ];
  const falhas = [];
  for (const [id] of TEMAS) {
    const t = blocoDoTema(css, id);
    for (const [frente, fundo] of pares) {
      if (!t[frente] || !t[fundo]) continue; // variável faltando já falha no teste acima
      const valor = contraste(t[frente], t[fundo]);
      if (valor < 4.5) falhas.push(`${id}: --${frente} ${t[frente]} sobre --${fundo} ${t[fundo]} = ${valor.toFixed(2)}`);
    }
  }
  assert.deepEqual(falhas, []);
});

test('skins terminal e sharp: fonte mono e cantos retos', () => {
  const css = ler('temas.css');
  const regras = id => [...css.matchAll(new RegExp(`[^{}]*\\.skin-${id}(?![\\w-])[^{}]*\\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(';');
  assert.match(regras('terminal'), /mono|--fonte-codigo/i, 'skin terminal deve usar fonte mono');
  for (const id of ['terminal', 'sharp']) assert.match(regras(id), /--raio-(controle|card)\s*:\s*0(px)?\s*(;|!|$)/, `skin ${id} deve zerar o raio`);
});

// Lista o que aparece mais de uma vez (com a contagem), para a mensagem de falha dizer o quê.
const repetidos = lista => [...lista.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].filter(([, n]) => n > 1).map(([x, n]) => `${x} (${n}x)`);
// Agrupa itens pelo mesmo valor e devolve os grupos com mais de um, ex.: 'tema-a = tema-b'.
const colisoes = (itens, valor, rotulo) => [...Map.groupBy(itens, valor).values()].filter(g => g.length > 1).map(g => g.map(rotulo).join(' = '));
const normalizar = nome => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Blocos de variáveis de tema: seletor único `.tema-<id>` no começo da linha, com --content-bg dentro.
const blocosDeTema = css => [...css.matchAll(/^\.tema-([\w-]+)\s*\{([^}]*)\}/gm)].filter(m => /--content-bg\s*:/.test(m[2])).map(m => ({ id: m[1], vars: variaveis(m[2]) }));
const IDS_COM_PERSONALIZADO = () => [...TEMAS.map(([id]) => id), 'personalizado'];

test('sem temas nem skins duplicados em domain.js (ids e nomes, ignorando caixa e acento)', () => {
  assert.deepEqual(repetidos(TEMAS.map(([id]) => id)), [], 'ids de TEMAS duplicados');
  assert.deepEqual(repetidos(TEMAS.map(([, nome]) => normalizar(nome))), [], 'nomes de TEMAS duplicados');
  assert.deepEqual(repetidos(SKINS.map(([id]) => id)), [], 'ids de SKINS duplicados');
  assert.deepEqual(repetidos(SKINS.map(([, nome]) => normalizar(nome))), [], 'nomes de SKINS duplicados');
  assert.ok(!TEMAS.some(([id]) => id === 'personalizado'), 'personalizado não deve estar em TEMAS (é opção à parte)');
});

test('temas.css: um bloco de variáveis por tema, nenhum órfão, nenhuma paleta repetida', () => {
  const blocos = blocosDeTema(ler('temas.css'));
  const ids = IDS_COM_PERSONALIZADO();
  assert.deepEqual(repetidos(blocos.map(b => `.tema-${b.id}`)), [], 'blocos de variáveis repetidos em temas.css');
  assert.deepEqual(blocos.map(b => b.id).filter(id => !ids.includes(id)), [], 'blocos .tema-<id> em temas.css sem id em TEMAS');
  assert.deepEqual(ids.filter(id => !blocos.some(b => b.id === id)), [], 'temas sem bloco .tema-<id> { em temas.css');
  const paletas = colisoes(blocos.filter(b => b.id !== 'personalizado'), b => `${b.vars['content-bg']}+${b.vars.acento}`, b => b.id);
  assert.deepEqual(paletas, [], 'temas com o mesmo par --content-bg + --acento');
});

test('ícones: TRACOS tem um desenho próprio, sem emoji, para cada tema e o personalizado', () => {
  const app = ler('app.js');
  const inicio = app.indexOf('const TRACOS = {');
  assert.ok(inicio >= 0, 'const TRACOS não encontrado em app.js');
  const bloco = app.slice(inicio, app.indexOf('\n};', inicio));
  const entradas = [...bloco.matchAll(/^\s*'(tema-[\w-]+)'\s*:\s*(['"`])(.*?)\2\s*,?\s*$/gm)].map(m => ({ chave: m[1], traco: m[3].trim() }));
  assert.deepEqual(repetidos(entradas.map(e => e.chave)), [], 'chaves tema-* repetidas em TRACOS (a última sobrescreve)');
  const faltando = IDS_COM_PERSONALIZADO().map(id => `tema-${id}`).filter(k => !entradas.some(e => e.chave === k));
  assert.deepEqual(faltando, [], 'ícones de tema faltando em TRACOS');
  const vazios = entradas.filter(e => !/<(path|circle|rect|line|polyline|polygon|ellipse)\b/.test(e.traco)).map(e => e.chave);
  assert.deepEqual(vazios, [], 'ícones de tema sem traço SVG');
  assert.deepEqual(colisoes(entradas, e => e.traco, e => e.chave), [], 'ícones de tema com traço idêntico');
  const emojis = [...new Set(bloco.match(/\p{Extended_Pictographic}/gu) || [])];
  assert.deepEqual(emojis, [], 'emoji dentro de TRACOS');
});

test('card de tema: opcaoTema desenha a mini-janela com ícone e temas.css a estiliza', () => {
  const app = ler('app.js');
  const inicio = app.indexOf('const opcaoTema');
  assert.ok(inicio >= 0, 'opcaoTema não encontrado em app.js');
  const card = app.slice(inicio, app.indexOf('</label>', inicio));
  assert.match(card, /icone\(\s*`tema-\$\{id\}`\s*,\s*['"]tema-icone['"]\s*\)|icone\(\s*['"]tema-['"]\s*\+\s*id\s*,\s*['"]tema-icone['"]\s*\)/, "opcaoTema deve chamar icone('tema-<id>', 'tema-icone')");
  for (const classe of ['tema-lateral', 'tema-tela']) assert.ok(card.includes(classe), `opcaoTema sem o elemento .${classe}`);
  const css = ler('temas.css');
  const semEstilo = ['tema-icone', 'tema-lateral', 'tema-tela'].filter(c => !new RegExp(`\\.${c}(?![\\w-])[^{}]*\\{`).test(css));
  assert.deepEqual(semEstilo, [], 'classes do card sem regra em temas.css');
});
