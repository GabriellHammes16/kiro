const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TEMAS, SKINS, APARENCIA_PADRAO, contraste, aparenciaValida, classesDaAparencia } = require('../domain.js');

const raiz = path.join(__dirname, '..');
const ler = nome => fs.readFileSync(path.join(raiz, nome), 'utf8');
// O padrão de docs/temas.md: estas são obrigatórias; as outras saem do bloco de derivação de temas.css.
const OBRIGATORIAS = ['bg', 'ink', 'acento', 'acento-texto'];
const VARIAVEIS = [...OBRIGATORIAS, 'panel', 'panel-raised', 'sidebar-bg', 'content-bg', 'campo', 'muted', 'line',
  'acento-2', 'acento-forte', 'acento-escuro', 'primario-texto'];
const PADRAO = { tema: 'kiro', skin: 'padrao' };

// Lê `--nome:#hex` de um trecho de CSS.
const variaveis = trecho => Object.fromEntries([...trecho.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2].toUpperCase()]));
// Junta todos os blocos cujo seletor contém `.tema-<id>` (ex.: `.tema-x,.tema-y{...}`).
function blocoDoTema(css, id) {
  const re = new RegExp(`([^{}]*\\.tema-${id}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');
  // .vidro-claro é um estado passageiro do Liquid Glass, não a paleta do tema.
  return Object.assign({}, ...[...css.matchAll(re)].filter(m => !m[1].includes('.vidro-claro')).map(m => variaveis(m[2])));
}

// Calcula as derivadas como o navegador: var(--x) ou color-mix(in srgb, var(--a) N%, var(--b)).
const canais = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const paraHex = c => `#${c.map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
function derivacao(css) {
  const bloco = css.match(/:where\(html, \.tema-opcao\)\[class\*="tema-"\]\s*\{([^}]*)\}/);
  assert.ok(bloco, 'bloco de derivação ausente em temas.css');
  return Object.fromEntries([...bloco[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
function completar(proprias, regras) {
  const t = { ...proprias };
  const valor = expressao => {
    const direto = expressao.match(/^var\(--([\w-]+)\)$/);
    if (direto) return obter(direto[1]);
    const mistura = expressao.match(/^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/);
    assert.ok(mistura, `derivação não reconhecida: ${expressao}`);
    const [a, p, b] = [canais(obter(mistura[1])), Number(mistura[2]) / 100, canais(obter(mistura[3]))];
    return paraHex(a.map((n, i) => n * p + b[i] * (1 - p)));
  };
  const obter = nome => t[nome] ?? (t[nome] = valor(regras[nome]));
  for (const nome of Object.keys(regras)) obter(nome);
  return t;
}

test('aparência padrão: vazio, lixo ou nada viram Escuro Clássico + Padrão', () => {
  for (const salvo of [undefined, null, {}, 'lixo', 42, [], { tema: 7, skin: {} }]) {
    const a = aparenciaValida(salvo);
    assert.equal(a.tema, PADRAO.tema, `tema para ${JSON.stringify(salvo)}`);
    assert.equal(a.skin, PADRAO.skin, `skin para ${JSON.stringify(salvo)}`);
  }
  assert.deepEqual(APARENCIA_PADRAO, { tema: 'kiro', skin: 'padrao', sidebar: '#11161D', content: '#0B0F14', acento: '#9273FF', destaque: '', transparencia: 35 });
  assert.deepEqual(classesDaAparencia(aparenciaValida(undefined)), ['tema-kiro', 'skin-padrao']);
});

test('tema e skin sobrevivem à ida e volta por JSON e são independentes', () => {
  for (const [tema, skin] of [['neon-tokyo', 'neon'], ['sakura-night', 'suave'], ['alto-contraste', 'terminal'], ['kiro', 'paper']]) {
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

test('paletas substituídas preservam escolhas salvas e oferecem famílias claras distintas', () => {
  for (const id of ['grafite', 'escuro-azul', 'escuro-verde', 'escuro-ambar', 'sakura-night']) {
    assert.equal(aparenciaValida({ tema: id, skin: 'paper' }).tema, id);
  }
  const css = ler('temas.css');
  const claros = TEMAS.filter(([id]) => {
    const cor = blocoDoTema(css, id)['content-bg'];
    return require('../domain.js').luminancia(cor) > .5;
  });
  assert.ok(claros.length >= 6, 'o catálogo deve oferecer opções claras além do branco');
});

test('Liquid Glass e transparência sobrevivem ao salvamento sem alterar outros temas', () => {
  const a = aparenciaValida(JSON.parse(JSON.stringify({ tema: 'liquid-glass', transparencia: 65 })));
  assert.equal(a.tema, 'liquid-glass');
  assert.equal(a.transparencia, 65);
  assert.deepEqual(classesDaAparencia(a), ['tema-liquid-glass', 'skin-padrao']);
  assert.equal(aparenciaValida({ ...a, tema: 'kiro' }).transparencia, 65);
});

test('transparência valida limites, zero e preferências antigas ou corrompidas', () => {
  for (const [entrada, esperado] of [[0, 0], [80, 80], [-20, 0], [150, 80], [32.6, 33], [undefined, 35], [null, 35], ['70', 35], [NaN, 35], [Infinity, 35]]) {
    assert.equal(aparenciaValida({ transparencia: entrada }).transparencia, esperado, String(entrada));
  }
});

test('destaque vale em qualquer tema e é independente dele; inválido volta a seguir o tema', () => {
  for (const tema of ['kiro', 'claro', 'neon-tokyo', 'personalizado']) {
    const a = aparenciaValida(JSON.parse(JSON.stringify({ tema, destaque: '#57CC99' })));
    assert.equal(a.tema, tema);
    assert.equal(a.destaque, '#57CC99');
  }
  for (const lixo of [undefined, '', 'red', '#12', 'url(x)', 7]) assert.equal(aparenciaValida({ tema: 'claro', destaque: lixo }).destaque, '');
  // Salvo de antes do destaque: segue a cor do tema, e o acento do Personalizado continua sendo a base dele.
  const antigo = aparenciaValida({ tema: 'personalizado', skin: 'padrao', sidebar: '#112233', content: '#0A0B0C', acento: '#FF8800' });
  assert.equal(antigo.destaque, '');
  assert.equal(antigo.acento, '#FF8800');
});

test('migração: salvo antigo sem tema vira personalizado só se tinha cores próprias', () => {
  assert.equal(aparenciaValida({ sidebar: '#223344', content: '#0B0F14', acento: '#9273FF' }).tema, 'personalizado');
  assert.equal(aparenciaValida({ sidebar: '#11161D', content: '#0B0F14', acento: '#5AB0FF' }).tema, 'personalizado');
  assert.equal(aparenciaValida({ sidebar: '#0E0E0E', content: '#0A0A0A', acento: '#C77DFF' }).tema, 'kiro');
  assert.equal(aparenciaValida({ sidebar: '#1A1A20', content: '#141418', acento: '#C77DFF' }).tema, 'kiro');
  assert.equal(aparenciaValida({ sidebar: '#223344' }).skin, 'padrao');
});

test('temas.css define as variáveis obrigatórias de cada tema e o seletor de cada skin', () => {
  const css = ler('temas.css');
  const regras = derivacao(css);
  assert.deepEqual(VARIAVEIS.filter(v => !OBRIGATORIAS.includes(v) && !regras[v]), [], 'variáveis opcionais sem derivação');
  assert.ok(css.indexOf(':where(html, .tema-opcao)') < css.indexOf('.tema-kiro {'), 'a derivação tem de vir antes dos temas para eles poderem sobrescrevê-la');
  for (const id of [...TEMAS.map(([id]) => id), 'personalizado']) {
    const bloco = blocoDoTema(css, id);
    const faltando = OBRIGATORIAS.filter(v => !bloco[v]);
    assert.deepEqual(faltando, [], `tema ${id}: variáveis obrigatórias faltando em temas.css`);
  }
  for (const [id] of SKINS) assert.match(css, new RegExp(`\\.skin-${id}(?![\\w-])`), `skin ${id}: seletor .skin-${id} ausente em temas.css`);
});

test('tema Kiro em temas.css bate com o :root de styles.css', () => {
  const classico = blocoDoTema(ler('temas.css'), 'kiro');
  assert.equal(classico.acento, '#EDEDED');
  const root = Object.assign({}, ...[...ler('styles.css').matchAll(/:root\s*\{([^}]*)\}/g)].map(m => variaveis(m[1])));
  for (const v of ['bg', 'panel', 'ink', 'muted', 'line', 'acento']) assert.equal(classico[v], root[v], `--${v}`);
});

test('Liquid Glass: botões de plug-ins têm contraste no destaque e nos estados de hover', () => {
  const cores = blocoDoTema(ler('temas.css'), 'liquid-glass');
  for (const fundo of ['acento', 'acento-forte', 'acento-escuro']) {
    assert.ok(contraste(cores['primario-texto'], cores[fundo]) >= 4.5, fundo);
  }
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
  const regras = derivacao(css);
  for (const [id] of TEMAS) {
    const t = completar(blocoDoTema(css, id), regras);
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
const blocosDeTema = css => [...css.matchAll(/^\.tema-([\w-]+)\s*\{([^}]*)\}/gm)].filter(m => /--bg\s*:/.test(m[2])).map(m => ({ id: m[1], vars: completar(variaveis(m[2]), derivacao(css)) }));
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

test('interface nova acompanha o tema: .plugin-* sem cor fixa e contador do card sem --acento puro', () => {
  const css = ler('styles.css');
  const regras = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].map(m => ({ seletor: m[1].trim(), corpo: m[2] }));
  const fixas = regras.filter(r => /\.plugin-/.test(r.seletor) && /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(r.corpo)).map(r => r.seletor);
  assert.deepEqual(fixas, [], 'regras .plugin-* com cor fixa');
  // --acento puro sobre --accent-soft fica abaixo de 4.5:1 em kiro, evangelion e demon-blood.
  const contadores = regras.filter(r => /\.card-head\s*\.small-muted/.test(r.seletor) && /(^|;)\s*color\s*:\s*var\(--acento\)/.test(r.corpo)).map(r => r.seletor);
  assert.deepEqual(contadores, [], 'contador do cabeçalho do card com color:var(--acento) (ilegível em alguns temas)');
});

test('padrão de tema: as quatro variáveis obrigatórias bastam, no escuro e no claro', () => {
  const regras = derivacao(ler('temas.css'));
  const exemplos = {
    escuro: { bg: '#101820', ink: '#F2F4F7', acento: '#7DD3C0', 'acento-texto': '#06201A' },
    claro: { bg: '#FBF7F0', ink: '#22262B', acento: '#8A3D1F', 'acento-texto': '#FFFFFF' },
  };
  const pares = [['ink', 'panel'], ['ink', 'panel-raised'], ['ink', 'sidebar-bg'], ['ink', 'campo'], ['ink', 'content-bg'],
    ['muted', 'bg'], ['muted', 'panel'], ['muted', 'panel-raised'], ['acento', 'panel'], ['primario-texto', 'acento-forte'], ['primario-texto', 'acento-escuro']];
  const falhas = [];
  for (const [nome, proprias] of Object.entries(exemplos)) {
    const t = completar(proprias, regras);
    assert.deepEqual(VARIAVEIS.filter(v => !t[v]), [], `tema ${nome}: variável sem valor`);
    for (const [frente, fundo] of pares) if (contraste(t[frente], t[fundo]) < 4.5) falhas.push(`${nome}: --${frente} sobre --${fundo} = ${contraste(t[frente], t[fundo]).toFixed(2)}`);
  }
  assert.deepEqual(falhas, []);
});

test('--danger tem 4.5:1 sobre todas as superfícies, em todo tema', () => {
  const mistura = ler('styles.css').match(/--danger:color-mix\(in srgb, (#[0-9A-Fa-f]{6}) (\d+)%, var\(--ink\)\)/);
  assert.ok(mistura, '--danger deve misturar o vermelho com --ink');
  const [vermelho, parte] = [canais(mistura[1]), Number(mistura[2]) / 100];
  const css = ler('temas.css'), regras = derivacao(css), falhas = [];
  for (const [id] of TEMAS) {
    const t = completar(blocoDoTema(css, id), regras);
    const perigo = t.danger ?? paraHex(vermelho.map((n, i) => n * parte + canais(t.ink)[i] * (1 - parte)));
    for (const fundo of ['bg', 'content-bg', 'panel', 'panel-raised', 'sidebar-bg', 'campo']) {
      const valor = contraste(perigo, t[fundo]);
      if (valor < 4.5) falhas.push(`${id}: --danger ${perigo} sobre --${fundo} ${t[fundo]} = ${valor.toFixed(2)}`);
    }
  }
  assert.deepEqual(falhas, []);
});

test('padrão de tema: fundo claro declara color-scheme:light', () => {
  const css = ler('temas.css');
  const regras = derivacao(css);
  const claros = [...css.matchAll(/([^{}]*)\{[^}]*color-scheme\s*:\s*light[^}]*\}/g)].map(m => m[1]).filter(s => !s.includes('.vidro-claro')).join(' ');
  const falhas = TEMAS.map(([id]) => id).filter(id => {
    const { bg } = completar(blocoDoTema(css, id), regras);
    const fundoClaro = contraste(bg, '#000000') > contraste(bg, '#FFFFFF');
    return fundoClaro !== new RegExp(`\\.tema-${id}(?![\\w-])`).test(claros);
  });
  assert.deepEqual(falhas, [], 'tema cujo color-scheme não combina com o fundo');
});

test('padrão de tema: só o Liquid Glass tem regras próprias por componente', () => {
  const ids = [...TEMAS.map(([id]) => id), 'personalizado'].filter(id => id !== 'liquid-glass');
  const fora = [];
  for (const arquivo of ['styles.css', 'temas.css']) for (const m of ler(arquivo).matchAll(/([^{}]*)\{/g)) {
    const seletor = m[1].trim();
    for (const id of ids) if (new RegExp(`\\.tema-${id}(?![\\w-])[^,)]*[ >+~]`).test(seletor) && !/:is\(\.tema-/.test(seletor)) fora.push(`${arquivo}: ${seletor}`);
  }
  assert.deepEqual(fora, [], 'um tema só escolhe cores: use uma variável em vez de regra por componente');
});

test('padrão de skin: skins não declaram cores do tema', () => {
  const css = ler('temas.css');
  const fora = [];
  for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (!/\.skin-/.test(m[1]) || /\.tema-/.test(m[1])) continue;
    for (const v of VARIAVEIS) if (new RegExp(`(^|[;\\s])--${v}\\s*:`).test(m[2])) fora.push(`${m[1].trim()}: --${v}`);
  }
  assert.deepEqual(fora, [], 'skin escolhe forma, não cor');
});

test('docs/temas.md cobre todas as variáveis de cor', () => {
  const doc = ler('docs/temas.md');
  assert.deepEqual(VARIAVEIS.filter(v => !doc.includes(`\`--${v}\``)), [], 'variáveis sem explicação em docs/temas.md');
});
