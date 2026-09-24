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

  // ---- Geometria da tela ----
  // Vista: translação (x, y) em pixels da tela e zoom. Ponto do canvas = (tela - x) / zoom.
  const ZOOM = { min: 0.1, max: 4 };
  const OPOSTO = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const limitarZoom = z => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
  const vistaValida = v => obj(v) && num(v.x) && num(v.y) && num(v.zoom) && v.zoom >= ZOOM.min && v.zoom <= ZOOM.max;
  const paraCanvas = (v, px, py) => ({ x: (px - v.x) / v.zoom, y: (py - v.y) / v.zoom });
  function zoomEm(v, fator, px, py) {
    const zoom = limitarZoom(v.zoom * fator), k = zoom / v.zoom;
    return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, zoom };
  }
  function enquadrar(nodes, largura, altura, margem = 40) {
    if (!nodes.length) return { x: largura / 2, y: altura / 2, zoom: 1 };
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    const x1 = Math.max(...nodes.map(n => n.x + n.width)), y1 = Math.max(...nodes.map(n => n.y + n.height));
    const zoom = limitarZoom(Math.min(1, (largura - 2 * margem) / (x1 - x0), (altura - 2 * margem) / (y1 - y0)));
    return { x: largura / 2 - ((x0 + x1) / 2) * zoom, y: altura / 2 - ((y0 + y1) / 2) * zoom, zoom };
  }
  function pontoDoLado(n, lado) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    return { top: { x: cx, y: n.y }, bottom: { x: cx, y: n.y + n.height }, left: { x: n.x, y: cy }, right: { x: n.x + n.width, y: cy } }[lado];
  }
  function ladoMaisProximo(n, p) {
    let melhor = 'right', menor = Infinity;
    for (const lado of LADOS) { const q = pontoDoLado(n, lado), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < menor) { menor = d; melhor = lado; } }
    return melhor;
  }
  function ladosDaSeta(a, b) {
    const dx = (b.x + b.width / 2) - (a.x + a.width / 2), dy = (b.y + b.height / 2) - (a.y + a.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  const NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  // Curva cúbica que sai perpendicular ao lado de origem e chega perpendicular ao de destino.
  function caminhoDaSeta(p1, l1, p2, l2) {
    const f = Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3);
    const c1 = { x: p1.x + NORMAL[l1][0] * f, y: p1.y + NORMAL[l1][1] * f };
    const c2 = { x: p2.x + NORMAL[l2][0] * f, y: p2.y + NORMAL[l2][1] * f };
    const r = v => Math.round(v * 10) / 10 + 0;   // + 0 troca -0 por 0 no texto
    const meio = { x: r((p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8), y: r((p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8) };
    return { d: `M${r(p1.x)} ${r(p1.y)} C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`, meio };
  }
  function geometriaDaSeta(nodes, e) {
    const a = nodes.find(n => n.id === e.fromNode), b = nodes.find(n => n.id === e.toNode);
    if (!a || !b) return null;
    const [la, lb] = ladosDaSeta(a, b);
    const l1 = e.fromSide || la, l2 = e.toSide || lb;
    return caminhoDaSeta(pontoDoLado(a, l1), l1, pontoDoLado(b, l2), l2);
  }
  function dentro(nodes, r) {
    const x0 = Math.min(r.x, r.x + r.width), x1 = Math.max(r.x, r.x + r.width);
    const y0 = Math.min(r.y, r.y + r.height), y1 = Math.max(r.y, r.y + r.height);
    return nodes.filter(n => n.x < x1 && n.x + n.width > x0 && n.y < y1 && n.y + n.height > y0).map(n => n.id);
  }

  const api = { TIPOS, LADOS, CORES, GRADE, ZOOM, OPOSTO, corValida, ler, serializar, adicionarCartao, moverCartoes, redimensionar, editarCartao, removerCartoes, duplicarCartoes, ligar, editarSeta, removerSetas, encaixar, historicoVazio, empilhar, desfazer, refazer, vistaValida, paraCanvas, zoomEm, enquadrar, pontoDoLado, ladoMaisProximo, ladosDaSeta, caminhoDaSeta, geometriaDaSeta, dentro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroFluxo = api;
})(globalThis);
