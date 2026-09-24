// Fluxo: o canvas de ideias do Kiro, no formato aberto JSON Canvas 1.0 (jsoncanvas.org).
// Só o modelo, sem DOM. Imutável: toda operação devolve um canvas novo. Campos que o Kiro
// não conhece passam intactos, para o arquivo continuar abrindo igual no Obsidian.
// Roda no navegador (KiroFluxo) e no Node (vault.cjs e testes).
(function (root) {
  const TIPOS = ['text', 'file', 'link', 'group'];
  const LADOS = ['top', 'right', 'bottom', 'left'];
  const PONTAS = ['none', 'arrow'];
  const CORES = ['1', '2', '3', '4', '5', '6'];
  const GRADE = 20;
  const LIMITE_HISTORICO = 100;
  const MINIMO = { width: 80, height: 40 };
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const str = v => typeof v === 'string';
  const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // A cor vai para um atributo style: só os dois formatos da especificação passam.
  const corValida = c => c === undefined || CORES.includes(c) || (str(c) && /^#[0-9a-f]{6}$/i.test(c));

  function novoId(usados) {
    let id;
    do id = Array.from(root.crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    while (usados.has(id));
    return id;
  }
  const usados = c => new Set([...c.nodes.map(n => n.id), ...c.edges.map(e => e.id)]);

  function problemaDoCartao(n) {
    if (!obj(n) || !str(n.id) || !n.id) return 'Cartão sem id.';
    if (!TIPOS.includes(n.type)) return `Cartão ${n.id}: tipo desconhecido "${n.type}".`;
    if (![n.x, n.y, n.width, n.height].every(num) || n.width <= 0 || n.height <= 0) return `Cartão ${n.id}: posição ou tamanho inválido.`;
    if (!corValida(n.color)) return `Cartão ${n.id}: cor inválida.`;
    if (n.type === 'text' && !str(n.text)) return `Cartão ${n.id}: texto ausente.`;
    if (n.type === 'file' && !str(n.file)) return `Cartão ${n.id}: arquivo ausente.`;
    if (n.type === 'link' && !str(n.url)) return `Cartão ${n.id}: URL ausente.`;
    if (n.type === 'group' && n.label !== undefined && !str(n.label)) return `Cartão ${n.id}: rótulo inválido.`;
    return null;
  }
  function problemaDaSeta(e) {
    if (!obj(e) || !str(e.id) || !e.id || !str(e.fromNode) || !str(e.toNode)) return 'Seta sem id, fromNode ou toNode.';
    if ([e.fromSide, e.toSide].some(l => l !== undefined && !LADOS.includes(l))) return `Seta ${e.id}: lado inválido.`;
    if ([e.fromEnd, e.toEnd].some(p => p !== undefined && !PONTAS.includes(p))) return `Seta ${e.id}: ponta inválida.`;
    if (!corValida(e.color)) return `Seta ${e.id}: cor inválida.`;
    if (e.label !== undefined && !str(e.label)) return `Seta ${e.id}: rótulo inválido.`;
    return null;
  }

  // { canvas, avisos } ou { erro }. Seta para cartão que não existe sai, com aviso: o resto
  // do fluxo continua utilizável. Cartões e setas têm espaços de id separados, como na spec.
  function ler(texto) {
    let bruto;
    try { bruto = JSON.parse(String(texto).replace(/^﻿/, '').trim() || '{}'); }
    catch (e) { return { erro: `JSON inválido: ${e.message}` }; }
    if (!obj(bruto)) return { erro: 'O arquivo não é um JSON Canvas.' };
    const nodes = bruto.nodes ?? [], edges = bruto.edges ?? [];
    if (!Array.isArray(nodes) || !Array.isArray(edges)) return { erro: '"nodes" e "edges" precisam ser listas.' };
    const cartoes = new Set();
    for (const n of nodes) {
      const problema = problemaDoCartao(n);
      if (problema) return { erro: problema };
      if (cartoes.has(n.id)) return { erro: `Id de cartão repetido: ${n.id}.` };
      cartoes.add(n.id);
    }
    const setas = new Set(), avisos = [], validas = [];
    for (const e of edges) {
      const problema = problemaDaSeta(e);
      if (problema) return { erro: problema };
      if (setas.has(e.id)) return { erro: `Id de seta repetido: ${e.id}.` };
      setas.add(e.id);
      if (!cartoes.has(e.fromNode) || !cartoes.has(e.toNode)) { avisos.push(`A seta ${e.id} aponta para um cartão que não existe e foi ignorada.`); continue; }
      validas.push(e);
    }
    return { canvas: { ...bruto, nodes, edges: validas }, avisos };
  }
  const serializar = c => JSON.stringify(c, null, '\t');

  // Campo com valor undefined sai do item (ex.: tirar a cor).
  function mesclar(item, campos) {
    const r = { ...item };
    for (const [k, v] of Object.entries(campos)) { if (v === undefined) delete r[k]; else r[k] = v; }
    return r;
  }
  const mapearCartoes = (c, ids, fn) => ({ ...c, nodes: c.nodes.map(n => (ids.has(n.id) ? fn(n) : n)) });

  function adicionarCartao(c, cartao) {
    const id = novoId(usados(c));
    return { canvas: { ...c, nodes: [...c.nodes, { ...cartao, id }] }, id };
  }
  const moverCartoes = (c, ids, dx, dy) => mapearCartoes(c, new Set(ids), n => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const redimensionar = (c, id, width, height) => mapearCartoes(c, new Set([id]), n => ({ ...n, width: Math.max(MINIMO.width, width), height: Math.max(MINIMO.height, height) }));
  const editarCartao = (c, id, campos) => mapearCartoes(c, new Set([id]), n => mesclar(n, campos));
  function removerCartoes(c, ids) {
    const fora = new Set(ids);
    return { ...c, nodes: c.nodes.filter(n => !fora.has(n.id)), edges: c.edges.filter(e => !fora.has(e.fromNode) && !fora.has(e.toNode)) };
  }
  function duplicarCartoes(c, ids, dx = GRADE * 2, dy = GRADE * 2) {
    const alvo = new Set(ids), ocupados = usados(c), novos = new Map();
    const reservar = () => { const id = novoId(ocupados); ocupados.add(id); return id; };
    for (const n of c.nodes) if (alvo.has(n.id)) novos.set(n.id, { ...n, id: reservar(), x: n.x + dx, y: n.y + dy });
    const setas = c.edges.filter(e => novos.has(e.fromNode) && novos.has(e.toNode))
      .map(e => ({ ...e, id: reservar(), fromNode: novos.get(e.fromNode).id, toNode: novos.get(e.toNode).id }));
    return { canvas: { ...c, nodes: [...c.nodes, ...novos.values()], edges: [...c.edges, ...setas] }, ids: [...novos.values()].map(n => n.id) };
  }
  function ligar(c, seta) {
    const existe = id => c.nodes.some(n => n.id === id);
    if (seta.fromNode === seta.toNode || !existe(seta.fromNode) || !existe(seta.toNode)) return { canvas: c, id: null };
    const id = novoId(usados(c));
    return { canvas: { ...c, edges: [...c.edges, { ...seta, id }] }, id };
  }
  const editarSeta = (c, id, campos) => ({ ...c, edges: c.edges.map(e => (e.id === id ? mesclar(e, campos) : e)) });
  const removerSetas = (c, ids) => { const fora = new Set(ids); return { ...c, edges: c.edges.filter(e => !fora.has(e.id)) }; };
  const encaixar = (v, grade = GRADE) => Math.round(v / grade) * grade;

  // Desfazer guarda canvas inteiros: são imutáveis, então cada passo custa só as referências.
  const historicoVazio = () => ({ antes: [], depois: [] });
  const empilhar = (h, anterior) => ({ antes: [...h.antes, anterior].slice(-LIMITE_HISTORICO), depois: [] });
  function desfazer(h, atual) {
    if (!h.antes.length) return null;
    return { historico: { antes: h.antes.slice(0, -1), depois: [...h.depois, atual] }, canvas: h.antes.at(-1) };
  }
  function refazer(h, atual) {
    if (!h.depois.length) return null;
    return { historico: { antes: [...h.antes, atual], depois: h.depois.slice(0, -1) }, canvas: h.depois.at(-1) };
  }

  const api = { TIPOS, LADOS, CORES, GRADE, corValida, ler, serializar, adicionarCartao, moverCartoes, redimensionar, editarCartao, removerCartoes, duplicarCartoes, ligar, editarSeta, removerSetas, encaixar, historicoVazio, empilhar, desfazer, refazer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroFluxo = api;
})(globalThis);
