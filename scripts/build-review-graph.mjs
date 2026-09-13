#!/usr/bin/env node
// Grafo de revisão do KUROI: arquivos, funções, chamadas, referências e as fronteiras
// entre camadas (IPC do Electron, rotas HTTP, ferramentas MCP). Serve para revisar uma
// mudança: quem depende desta função, o que ela alcança, se algum teste passa por ela.
//
// Análise estática aproximada, por leitura do texto: sem dependências e sem executar o
// código analisado. Chamadas feitas por nome montado em tempo de execução não aparecem.
//
// Uso: node scripts/build-review-graph.mjs   (ou npm run review-graph)
// Saída: outputs/review-graph.json e outputs/review-graph.html (abra no navegador).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posix = caminho => caminho.split(path.sep).join('/');

const CAMADAS = {
  'app.js': 'interface', 'dev/reload.js': 'dev', 'domain.js': 'dominio', 'vault.cjs': 'persistencia',
  'server.mjs': 'servidor', 'dev/devtools.mjs': 'dev', 'dev/seed.cjs': 'dev',
  'electron/main.cjs': 'electron', 'electron/preload.cjs': 'electron', 'mcp/server.mjs': 'agentes',
};
for (const a of fs.readdirSync(path.join(raiz, 'agent'))) if (/\.c?js$/.test(a)) CAMADAS[`agent/${a}`] = 'agentes';
for (const t of fs.readdirSync(path.join(raiz, 'tests'))) if (/\.c?js$/.test(t)) CAMADAS[`tests/${t}`] = 'testes';
const arquivos = Object.keys(CAMADAS).filter(a => fs.existsSync(path.join(raiz, a)));
const texto = Object.fromEntries(arquivos.map(a => [a, fs.readFileSync(path.join(raiz, a), 'utf8').replace(/\r\n/g, '\n')]));
const linhaDe = (fonte, indice) => fonte.slice(0, indice).split('\n').length;

// ---- Leitor que entende comentários, strings, templates aninhados e regex ----
function pular(fonte, i) {
  const c = fonte[i];
  if (c === '/' && fonte[i + 1] === '/') { const f = fonte.indexOf('\n', i); return f < 0 ? fonte.length : f; }
  if (c === '/' && fonte[i + 1] === '*') return fonte.indexOf('*/', i + 2) + 1;
  if (c === '"' || c === "'") { for (i++; i < fonte.length && fonte[i] !== c && fonte[i] !== '\n'; i++) if (fonte[i] === '\\') i++; return i; }
  if (c === '`') {
    for (i++; i < fonte.length; i++) {
      if (fonte[i] === '\\') { i++; continue; }
      if (fonte[i] === '`') return i;
      if (fonte[i] === '$' && fonte[i + 1] === '{') i = fechamento(fonte, i + 1);
    }
    return fonte.length;
  }
  if (c === '/') {
    let k = i - 1;
    while (k >= 0 && /\s/.test(fonte[k])) k--;
    if (k < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(fonte[k]) || /\b(return|typeof|case)$/.test(fonte.slice(Math.max(0, k - 6), k + 1))) {
      let classe = false;
      for (i++; i < fonte.length && fonte[i] !== '\n'; i++) {
        if (fonte[i] === '\\') { i++; continue; }
        if (fonte[i] === '[') classe = true;
        else if (fonte[i] === ']') classe = false;
        else if (fonte[i] === '/' && !classe) return i;
      }
      return i;
    }
  }
  return -1;
}
function fechamento(fonte, abre) {
  const abreC = fonte[abre], fechaC = abreC === '(' ? ')' : '}';
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i++) {
    const pulo = pular(fonte, i);
    if (pulo >= 0) { i = pulo; continue; }
    if (fonte[i] === abreC) profundidade++;
    else if (fonte[i] === fechaC && --profundidade === 0) return i;
  }
  return fonte.length;
}

// ---- Definições ----
const PALAVRAS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor', 'else', 'do', 'try', 'with', 'new', 'typeof', 'await', 'async', 'const', 'let', 'var', 'of', 'in']);
const nos = [], arestas = [], defs = new Map(), porId = new Map();
function definir(arquivo, nome, inicio, abre, tipo) {
  const fonte = texto[arquivo];
  const fim = abre >= 0 ? fechamento(fonte, abre) : Math.max(fonte.indexOf('\n', inicio), inicio);
  const id = `${arquivo}#${nome}@${linhaDe(fonte, inicio)}`;
  if (porId.has(id)) return;
  const no = { id, nome, arquivo, camada: CAMADAS[arquivo], linha: linhaDe(fonte, inicio), linhas: linhaDe(fonte, fim) - linhaDe(fonte, inicio) + 1, tipo, inicio, fim };
  nos.push(no); porId.set(id, no);
  if (!defs.has(nome)) defs.set(nome, []);
  defs.get(nome).push(id);
}
for (const arquivo of arquivos) {
  if (CAMADAS[arquivo] === 'testes') continue;
  const fonte = texto[arquivo];
  for (const m of fonte.matchAll(/(?:async\s+)?function\s+([\w$]+)\s*\(/g))
    definir(arquivo, m[1], m.index, fonte.indexOf('{', fechamento(fonte, m.index + m[0].length - 1)), 'funcao');
  for (const m of fonte.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(\(|[\w$]+\s*=>)/g)) {
    let depois;
    if (m[2] === '(') {
      const fecha = fechamento(fonte, m.index + m[0].length - 1);
      const seta = fonte.slice(fecha + 1).match(/^\s*=>\s*/);
      if (!seta) continue;
      depois = fecha + 1 + seta[0].length;
    } else depois = m.index + m[0].length + fonte.slice(m.index + m[0].length).match(/^\s*/)[0].length;
    definir(arquivo, m[1], m.index, fonte[depois] === '{' ? depois : -1, 'seta');
  }
  for (const m of fonte.matchAll(/^[ \t]+(?:async\s+)?#?([a-zA-Z_$][\w$]*)\s*\(/gm)) {
    if (PALAVRAS.has(m[1])) continue;
    const fecha = fechamento(fonte, m.index + m[0].length - 1);
    if (/^\s*\{/.test(fonte.slice(fecha + 1))) definir(arquivo, m[1], m.index, fonte.indexOf('{', fecha), 'metodo');
  }
}
const estaDefinindo = (no, indice) => indice >= no.inicio && indice <= no.inicio + no.nome.length + 30;
function dono(arquivo, indice) {
  let melhor = null;
  for (const no of nos) if (no.arquivo === arquivo && no.inicio <= indice && indice <= no.fim && !estaDefinindo(no, indice) && (!melhor || no.fim - no.inicio < melhor.fim - melhor.inicio)) melhor = no;
  return melhor;
}

// ---- Importações, com fechamento transitivo ----
const importa = new Map(arquivos.map(a => [a, new Set()]));
for (const arquivo of arquivos) {
  for (const m of texto[arquivo].matchAll(/(?:require\(|from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const alvo = path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), m[1]));
    if (texto[alvo]) { importa.get(arquivo).add(alvo); arestas.push({ de: `arquivo:${arquivo}`, para: `arquivo:${alvo}`, tipo: 'importa' }); }
  }
}
importa.get('app.js')?.add('domain.js');     // global Kuroi, carregado antes pelo index.html
importa.get('dev/reload.js')?.add('app.js'); // lê editorDirty e salvarNota do escopo global
const alcancaveis = new Map(arquivos.map(arquivo => {
  const vistos = new Set(), fila = [...importa.get(arquivo)];
  while (fila.length) { const a = fila.pop(); if (!vistos.has(a)) { vistos.add(a); fila.push(...importa.get(a)); } }
  return [arquivo, vistos];
}));

// ---- Chamadas e referências ----
// Métodos de Array, Map, String e afins: .map( não é a função "map" do projeto.
const EMBUTIDOS = new Set(['map', 'filter', 'find', 'findIndex', 'get', 'set', 'has', 'add', 'delete', 'push', 'pop', 'shift', 'slice', 'splice', 'join', 'split', 'replace', 'includes', 'indexOf', 'forEach', 'some', 'every', 'reduce', 'sort', 'keys', 'values', 'entries', 'then', 'catch', 'finally', 'call', 'apply', 'bind', 'test', 'match', 'matchAll', 'toString', 'trim', 'concat', 'at', 'flat', 'fill', 'from', 'of', 'assign', 'parse', 'stringify', 'resolve', 'reject', 'all', 'emit', 'on', 'once', 'close', 'end', 'write', 'read', 'open', 'list', 'record', 'load', 'save', 'run', 'status', 'text', 'json']);
const RECEPTORES = { vault: 'vault.cjs', audit: 'agent/audit.cjs', agentConfig: 'agent/config.cjs', config: 'agent/config.cjs', toolkit: 'agent/tools.cjs', api: 'agent/api.cjs' };
function resolver(arquivo, indice, nome, membro) {
  const candidatos = defs.get(nome).map(id => porId.get(id));
  if (membro) {
    const receptor = (texto[arquivo].slice(Math.max(0, indice - 40), indice).match(/([\w$]+)\s*$/) || [])[1] || '';
    if (receptor !== 'this' && EMBUTIDOS.has(nome)) return candidatos.find(c => c.arquivo === RECEPTORES[receptor]) || null;
  }
  // No próprio arquivo: a definição mais próxima antes do uso (homônimas em escopos diferentes).
  const locais = candidatos.filter(c => c.arquivo === arquivo).sort((a, b) => a.inicio - b.inicio);
  if (locais.length) return locais.filter(c => c.inicio <= indice).pop() || locais[0];
  const importados = candidatos.filter(c => alcancaveis.get(arquivo).has(c.arquivo));
  if (importados.length) return importados[0];
  // Método num objeto injetado (toolkit.call, api.createNote): nome único fora da interface.
  if (membro && candidatos.length === 1 && CAMADAS[candidatos[0].arquivo] !== 'interface') return candidatos[0];
  return null;
}
const vistas = new Set();
function ligar(arquivo, indice, nome, tipo, membro) {
  if (!defs.has(nome) || PALAVRAS.has(nome)) return;
  const alvo = resolver(arquivo, indice, nome, membro);
  if (!alvo || (alvo.arquivo === arquivo && estaDefinindo(alvo, indice))) return;
  const quem = dono(arquivo, indice);
  if (quem && quem.id === alvo.id) return;
  const de = quem ? quem.id : `arquivo:${arquivo}`;
  if (vistas.has(`${de}>${alvo.id}`)) return;
  vistas.add(`${de}>${alvo.id}`);
  arestas.push({ de, para: alvo.id, tipo: CAMADAS[arquivo] === 'testes' ? 'testa' : tipo });
}
for (const arquivo of arquivos) {
  const fonte = texto[arquivo];
  for (const m of fonte.matchAll(/(\.)?(?<![\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) ligar(arquivo, m.index, m[2], 'chama', Boolean(m[1]));
  for (const m of fonte.matchAll(/(?<![\w$.])([a-zA-Z_$][\w$]*)(?![\w$]*\s*[(=])/g))
    if ((defs.get(m[1]) || []).some(id => porId.get(id).arquivo === arquivo)) ligar(arquivo, m.index, m[1], 'referencia', false);
}

// ---- Fronteiras entre camadas ----
function fronteira(rotulo, sub, pontas) {
  const id = `fronteira:${rotulo}`;
  nos.push({ id, nome: rotulo, arquivo: '', camada: 'fronteira', linha: 0, linhas: 0, tipo: 'fronteira', sub });
  const unicas = new Set();
  for (const { de, para } of pontas) {
    if (unicas.has(`${de}>${para}`)) continue;
    unicas.add(`${de}>${para}`);
    if (de) arestas.push({ de, para: id, tipo: 'atravessa' });
    if (para) arestas.push({ de: id, para, tipo: 'atravessa' });
  }
}
const em = (arquivo, nome) => (defs.get(nome) || []).map(id => porId.get(id)).find(n => n.arquivo === arquivo);
const origem = (arquivo, indice) => dono(arquivo, indice)?.id || `arquivo:${arquivo}`;
const destinos = trecho => [
  ...[...trecho.matchAll(/vault\.([\w$]+)\(/g)].map(v => em('vault.cjs', v[1])),
  ...[...trecho.matchAll(/agentConfig\.([\w$]+)\(/g)].map(v => em('agent/config.cjs', v[1])),
].filter(Boolean).map(alvo => ({ para: alvo.id }));
const preload = texto['electron/preload.cjs'] || '', main = texto['electron/main.cjs'] || '', app = texto['app.js'] || '', servidor = texto['server.mjs'] || '';

for (const m of preload.matchAll(/([\w$]+):\s*[^\n]*?ipcRenderer\.invoke\('([^']+)'/g)) {
  const [, metodo, canal] = m;
  const pontas = [...app.matchAll(new RegExp(`cadernoDesktop\\.${metodo}\\(`, 'g'))].map(u => ({ de: origem('app.js', u.index) }));
  const h = main.indexOf(`ipcMain.handle('${canal}'`);
  if (h >= 0) {
    const fim = main.indexOf('ipcMain.handle(', h + 10);
    const trecho = main.slice(h, fim < 0 ? main.length : fim);
    pontas.push(...destinos(trecho));
    if (/shell\.openPath|dialog\.showOpenDialog|vault\.directory/.test(trecho)) pontas.push({ para: 'arquivo:electron/main.cjs' });
  }
  fronteira(`IPC ${canal}`, 'ipc', pontas);
}
const rotas = [...servidor.matchAll(/if \(request\.url === '\/api\/([\w-]+)' && request\.method === '(GET|POST)'\)/g)];
rotas.forEach((m, k) => {
  const [, rota, metodo] = m;
  const fim = k + 1 < rotas.length ? rotas[k + 1].index : servidor.indexOf('const rota', m.index);
  const padrao = metodo === 'GET' ? `api\\('${rota}'\\)` : `api\\('${rota}',|fetch\\('\\/api\\/${rota}'`;
  const pontas = [...app.matchAll(new RegExp(padrao, 'g'))].map(u => ({ de: origem('app.js', u.index) }));
  pontas.push(...destinos(servidor.slice(m.index, fim < 0 ? m.index + 600 : fim)));
  fronteira(`HTTP ${metodo} /api/${rota}`, 'http', pontas);
});
fronteira('GET /anexo/* · kuroi-anexo://', 'http', [
  ...[...app.matchAll(/urlDoAnexo\(/g)].map(u => dono('app.js', u.index)).filter(q => q && q.nome !== 'urlDoAnexo').map(q => ({ de: q.id })),
  ...(em('vault.cjs', 'readAttachment') ? [{ para: em('vault.cjs', 'readAttachment').id }] : []),
]);
fronteira('MCP stdio (ferramentas kuroi_*)', 'mcp', [
  { de: em('mcp/server.mjs', 'main')?.id || 'arquivo:mcp/server.mjs' },
  ...(em('agent/tools.cjs', 'call') ? [{ para: em('agent/tools.cjs', 'call').id }] : []),
]);
for (const arquivo of arquivos) nos.push({ id: `arquivo:${arquivo}`, nome: arquivo, arquivo, camada: CAMADAS[arquivo], linha: 1, linhas: texto[arquivo].split('\n').length, tipo: 'arquivo' });

// ---- Métricas ----
const entrada = new Map(), saida = new Map(), seguintes = new Map();
for (const a of arestas) {
  if (a.tipo === 'importa') continue;
  saida.set(a.de, (saida.get(a.de) || 0) + 1);
  entrada.set(a.para, (entrada.get(a.para) || 0) + 1);
  if (!seguintes.has(a.de)) seguintes.set(a.de, []);
  seguintes.get(a.de).push(a.para);
}
// Cobertura: tudo que é alcançável a partir do que os testes chamam. Uma função que
// despacha por tabela (ferramenta.run(...)) alcança os manipuladores do próprio arquivo.
const testados = new Set(arestas.filter(a => a.tipo === 'testa').map(a => a.para));
for (const fila = [...testados]; fila.length;) {
  const atual = fila.pop();
  const no = porId.get(atual);
  const extras = no && no.inicio !== undefined && /\.run\(|\[[\w$]+\]\(/.test(texto[no.arquivo].slice(no.inicio, no.fim)) ? [`arquivo:${no.arquivo}`] : [];
  for (const prox of [...(seguintes.get(atual) || []), ...extras]) if (!testados.has(prox)) { testados.add(prox); fila.push(prox); }
}
for (const no of nos) {
  no.chamadoPor = entrada.get(no.id) || 0;
  no.chama = saida.get(no.id) || 0;
  no.testado = testados.has(no.id);
  delete no.inicio; delete no.fim;
}
const funcoes = nos.filter(n => ['funcao', 'seta', 'metodo'].includes(n.tipo));
const rotulo = n => `${n.nome} (${n.arquivo}:${n.linha})`;
const resumo = {
  arquivos: arquivos.length,
  funcoes: funcoes.length,
  arestas: arestas.length,
  maisDependidas: [...funcoes].sort((a, b) => b.chamadoPor - a.chamadoPor).slice(0, 12).map(n => `${rotulo(n)} ← ${n.chamadoPor}`),
  maiores: [...funcoes].sort((a, b) => b.linhas - a.linhas).slice(0, 10).map(n => `${rotulo(n)} · ${n.linhas} linhas`),
  semUso: funcoes.filter(n => !n.chamadoPor && n.camada !== 'dev').map(rotulo),
  fronteirasSemUso: nos.filter(n => n.tipo === 'fronteira' && !arestas.some(a => a.para === n.id)).map(n => n.nome),
  coberturaPorCamada: Object.fromEntries(['dominio', 'persistencia', 'servidor', 'agentes', 'electron', 'interface'].map(c => {
    const f = funcoes.filter(n => n.camada === c);
    return [c, `${f.filter(n => n.testado).length}/${f.length}`];
  })),
  foraDosTestes: funcoes.filter(n => !n.testado && ['dominio', 'persistencia', 'servidor', 'agentes'].includes(n.camada)).map(rotulo),
};

const pastaSaida = path.join(raiz, 'outputs');
fs.mkdirSync(pastaSaida, { recursive: true });
const dados = { gerado: new Date().toISOString(), resumo, nos, arestas };
fs.writeFileSync(path.join(pastaSaida, 'review-graph.json'), JSON.stringify(dados, null, 1));
const modelo = fs.readFileSync(path.join(raiz, 'scripts', 'review-graph.html'), 'utf8');
fs.writeFileSync(path.join(pastaSaida, 'review-graph.html'), modelo.replace('/*__DADOS__*/null', JSON.stringify(dados).replace(/</g, '\\u003c')));

console.log(`Grafo de revisão: ${resumo.arquivos} arquivos, ${resumo.funcoes} funções, ${resumo.arestas} ligações.`);
console.log('Cobertura por camada:', Object.entries(resumo.coberturaPorCamada).map(([c, v]) => `${c} ${v}`).join(' · '));
if (resumo.semUso.length) console.log('Sem uso:', resumo.semUso.join(', '));
if (resumo.fronteirasSemUso.length) console.log('Fronteiras que ninguém usa:', resumo.fronteirasSemUso.join(', '));
console.log(`\nAbra ${posix(path.relative(process.cwd(), path.join(pastaSaida, 'review-graph.html')))} no navegador.`);
