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
  const ehPdf = f => tipoDoArquivo(f) === 'pdf';
  // Cópia independente dos cartões (e das setas entre eles) para colar depois, em qualquer canvas.
  function copiarCartoes(c, ids) {
    const alvo = new Set(ids);
    const nodes = c.nodes.filter(n => alvo.has(n.id)), dentro = new Set(nodes.map(n => n.id));
    return structuredClone({ nodes, edges: c.edges.filter(e => dentro.has(e.fromNode) && dentro.has(e.toNode)) });
  }
  // Cola o trecho com ids novos, o canto superior esquerdo do conjunto em (x, y). Grupos vão para
  // o início da lista (ficam atrás) e os demais para o fim (ficam na frente). O trecho não muda.
  function colarCartoes(c, trecho, x, y) {
    const ocupados = usados(c), novos = new Map();
    const reservar = () => { const id = novoId(ocupados); ocupados.add(id); return id; };
    const dx = x - Math.min(...trecho.nodes.map(n => n.x)), dy = y - Math.min(...trecho.nodes.map(n => n.y));
    for (const n of trecho.nodes) novos.set(n.id, { ...structuredClone(n), id: reservar(), x: n.x + dx, y: n.y + dy });
    const setas = trecho.edges.filter(e => novos.has(e.fromNode) && novos.has(e.toNode))
      .map(e => ({ ...structuredClone(e), id: reservar(), fromNode: novos.get(e.fromNode).id, toNode: novos.get(e.toNode).id }));
    const lista = [...novos.values()];
    return {
      canvas: { ...c, nodes: [...lista.filter(n => n.type === 'group'), ...c.nodes, ...lista.filter(n => n.type !== 'group')], edges: [...c.edges, ...setas] },
      ids: lista.map(n => n.id),
    };
  }
  // Texto para a área de transferência: o conteúdo de cada cartão, separado por linha em branco.
  function textoDoTrecho(trecho) {
    const partes = trecho.nodes.map(n => n.text ?? n.file ?? n.url ?? n.label).filter(Boolean);
    return partes.length ? partes.join('\n\n') : 'Cartões do Kiro';
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
  // Aplica `campos` ao cartão em todas as fotos do histórico que o têm: dado que chega depois (prévia de link)
  // não entra no desfazer, mas desfazer também não o apaga.
  function editarNoHistorico(h, id, campos) {
    const foto = c => (c.nodes.some(n => n.id === id) ? editarCartao(c, id, campos) : c);
    return { antes: h.antes.map(foto), depois: h.depois.map(foto) };
  }
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

  // ---- Cofre ----
  // Cartão de arquivo acompanha a nota quando ela muda de pasta: `destino(caminho)` devolve o
  // caminho novo ou undefined (fica como está). Sem mudança, volta o mesmo objeto.
  function renomearArquivos(c, destino) {
    let mudou = false;
    const nodes = c.nodes.map(n => {
      if (!n || n.type !== 'file' || typeof n.file !== 'string') return n;
      const novo = destino(n.file);
      if (!novo || novo === n.file) return n;
      mudou = true;
      return { ...n, file: novo };
    });
    return mudou ? { ...c, nodes } : c;
  }
  // Só caminho relativo ao cofre vira <img>: nada de subir pastas nem começar na raiz do disco.
  const caminhoSeguro = f => str(f) && f.length > 0 && !/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(f);
  // As mesmas extensões que o domain.js trata como imagem nas notas.
  const ehImagem = f => str(f) && tipoDoArquivo(f.trim()) === 'imagem';
  // Grupo do arquivo pela extensão; o que não é reconhecido abre como nota.
  const EXTENSOES = { pdf: 'pdf', png: 'imagem', jpg: 'imagem', jpeg: 'imagem', gif: 'imagem', webp: 'imagem', avif: 'imagem', bmp: 'imagem', txt: 'texto', csv: 'tabela', mp3: 'audio', wav: 'audio', webm: 'audio', m4a: 'audio', mp4: 'video' };
  const tipoDoArquivo = f => EXTENSOES[(/\.([^.\\/]+)$/.exec(String(f ?? '')) || [])[1]?.toLowerCase()] || 'nota';
  // ID de 11 caracteres de um link do YouTube (watch, youtu.be, shorts, embed); qualquer outro endereço vira null.
  function idDoYoutube(url) {
    let u;
    try { u = new URL(String(url).trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m)\./, '');
    const id = host === 'youtu.be' ? u.pathname.slice(1)
      : host === 'youtube.com' && u.pathname === '/watch' ? u.searchParams.get('v')
      : (host === 'youtube.com' || host === 'youtube-nocookie.com') ? (/^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(u.pathname) || [])[1]
      : null;
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? '') ? id : null;
  }
  const ALTURA_RECOLHIDA = 40;
  // Recolhe o cartão à barra de título guardando a altura; abrir devolve a altura guardada.
  function alternarRecolhido(c, id) {
    const n = c.nodes.find(x => x.id === id);
    if (!n) return c;
    return n.kiroRecolhido
      ? editarCartao(c, id, { kiroRecolhido: undefined, kiroAlturaAberta: undefined, height: n.kiroAlturaAberta ?? tamanhoPadrao(n).height })
      : editarCartao(c, id, { kiroRecolhido: true, kiroAlturaAberta: n.height, height: ALTURA_RECOLHIDA });
  }
  // CSV simples: separador (vírgula ou ponto e vírgula) pela primeira linha, aspas duplas, quebra de linha dentro de aspas.
  function lerCsv(texto, { linhas: maxLinhas = 200, colunas: maxColunas = 30 } = {}) {
    const t = String(texto ?? '').replace(/^﻿/, '');
    const primeira = t.split(/\r?\n/, 1)[0];
    const sep = primeira.split(';').length > primeira.split(',').length ? ';' : ',';
    const linhas = [];
    let linha = [], campo = '', aspas = false;
    const fechaLinha = () => { linha.push(campo); linhas.push(linha); linha = []; campo = ''; };
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (aspas) {
        if (ch !== '"') campo += ch;
        else if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else if (ch === '"') aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; fechaLinha(); }
      else campo += ch;
    }
    if (campo || linha.length) fechaLinha();
    return { linhas: linhas.slice(0, maxLinhas).map(l => l.slice(0, maxColunas)), restantes: Math.max(0, linhas.length - maxLinhas) };
  }
  // Cartões inteiramente dentro de um grupo (menos o próprio): andam com ele.
  const contidos = (nodes, g) => nodes.filter(n => n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).map(n => n.id);
  function caixaDe(nodes, margem = GRADE * 2) {
    const x0 = Math.min(...nodes.map(n => n.x)) - margem, y0 = Math.min(...nodes.map(n => n.y)) - margem;
    const x1 = Math.max(...nodes.map(n => n.x + n.width)) + margem, y1 = Math.max(...nodes.map(n => n.y + n.height)) + margem;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  // Altura inicial de um cartão de texto: ~40 caracteres por linha, 24 px por linha, mais uma
  // linha de margem; o editor ajusta ao conteúdo real quando o texto é editado.
  function alturaEstimada(texto) {
    const linhas = String(texto).split('\n').reduce((soma, l) => soma + Math.max(1, Math.ceil(l.length / 40)), 0);
    return Math.min(600, Math.max(60, (linhas + 1) * 24));
  }

  // ---- Layout automático (IA) ----
  const LARGURA_PADRAO = 280, ENTRE_COLUNAS = 80, ENTRE_IRMAOS = 20;
  const praCima = v => Math.ceil(v / GRADE) * GRADE;
  // Tamanho de um cartão que chega sem tamanho (da IA): o mesmo dos cartões criados na tela.
  const TAMANHO_POR_TIPO = { pdf: { width: 480, height: 640 }, imagem: { width: 320, height: 240 }, texto: { width: 320, height: 240 }, tabela: { width: 480, height: 280 }, audio: { width: 320, height: 100 }, video: { width: 480, height: 300 }, nota: { width: 400, height: 280 } };
  function tamanhoPadrao(c) {
    if (c.type === 'text') return { width: LARGURA_PADRAO, height: praCima(alturaEstimada(c.text ?? '')) };
    if (c.type === 'file') return TAMANHO_POR_TIPO[tipoDoArquivo(c.file)];
    if (c.type === 'link') return idDoYoutube(c.url) ? { width: 480, height: 300 } : { width: 320, height: 100 };
    return { width: 400, height: 300 };
  }
  // Raiz implícita: o primeiro cartão sem seta chegando de outro; se todos têm, o primeiro.
  function raizDe(nodes, edges) {
    const ids = new Set(nodes.map(n => n.id));
    const chegam = new Set(edges.filter(e => e.fromNode !== e.toNode && ids.has(e.fromNode)).map(e => e.toNode));
    return (nodes.find(n => !chegam.has(n.id)) || nodes[0])?.id;
  }
  // Árvore da esquerda para a direita: cada nível é uma coluna (80 px entre colunas), irmãos
  // empilhados a 20 px, e o pai centrado na altura do ramo, então nada se sobrepõe. Busca em
  // largura a partir da raiz, nas setas em ordem: cada cartão entra pela primeira seta que o
  // alcança, e as outras (ciclos, ligações cruzadas) não contam. Quem a raiz não alcança vai
  // para uma fileira embaixo. Recebe cartões com width/height; devolve Map id → { x, y }.
  function layout(nodes, edges, { raiz } = {}) {
    const posicoes = new Map();
    if (!nodes.length) return posicoes;
    const porId = new Map(nodes.map(n => [n.id, n]));
    const inicio = porId.has(raiz) ? raiz : raizDe(nodes, edges);
    const filhos = new Map([[inicio, []]]), nivel = new Map([[inicio, 0]]), fila = [inicio];
    while (fila.length) {
      const pai = fila.shift();
      for (const e of edges) {
        if (e.fromNode !== pai || !porId.has(e.toNode) || nivel.has(e.toNode)) continue;
        nivel.set(e.toNode, nivel.get(pai) + 1);
        filhos.get(pai).push(e.toNode);
        filhos.set(e.toNode, []);
        fila.push(e.toNode);
      }
    }
    const larguras = [];
    for (const [id, k] of nivel) larguras[k] = Math.max(larguras[k] || 0, porId.get(id).width);
    const colunas = [0];
    for (let k = 1; k < larguras.length; k++) colunas[k] = colunas[k - 1] + larguras[k - 1] + ENTRE_COLUNAS;
    const alturas = new Map();
    const somaDosFilhos = id => filhos.get(id).reduce((t, f) => t + alturas.get(f), 0) + ENTRE_IRMAOS * Math.max(0, filhos.get(id).length - 1);
    const alturaDoRamo = id => {
      for (const f of filhos.get(id)) alturaDoRamo(f);
      alturas.set(id, Math.max(porId.get(id).height, somaDosFilhos(id)));
    };
    alturaDoRamo(inicio);
    const posicionar = (id, topo) => {
      const h = alturas.get(id);
      posicoes.set(id, { x: encaixar(colunas[nivel.get(id)]), y: encaixar(topo + (h - porId.get(id).height) / 2) });
      let y = topo + (h - somaDosFilhos(id)) / 2;
      for (const f of filhos.get(id)) { posicionar(f, y); y += alturas.get(f) + ENTRE_IRMAOS; }
    };
    posicionar(inicio, 0);
    const fileira = alturas.get(inicio) + ENTRE_COLUNAS;
    let x = 0;
    for (const n of nodes) {
      if (posicoes.has(n.id)) continue;
      posicoes.set(n.id, { x: encaixar(x), y: encaixar(fileira) });
      x += n.width + ENTRE_IRMAOS;
    }
    return posicoes;
  }

  const sobrepoe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Cartões novos (com tamanho, sem posição) entram sem mexer em nenhum que já está no canvas:
  // à direita do cartão de onde sai a primeira seta que chega a eles, abaixo dos irmãos; sem
  // seta, embaixo de tudo. Descem na grade até achar lugar livre. Devolve os novos posicionados.
  function inserirPerto(c, novos, edges) {
    const postos = [...c.nodes], lugar = new Map(postos.map(n => [n.id, n])), saida = [];
    const chegam = new Map();
    for (const e of edges) { if (!chegam.has(e.toNode)) chegam.set(e.toNode, []); chegam.get(e.toNode).push(e.fromNode); }
    const paiDe = n => (chegam.get(n.id) || []).map(id => lugar.get(id)).find(Boolean);
    const pendentes = [...novos];
    while (pendentes.length) {
      // Primeiro quem já tem o pai no lugar: um filho não vai parar embaixo de tudo só por ter
      // vindo antes do pai na lista.
      const [novo] = pendentes.splice(Math.max(0, pendentes.findIndex(n => paiDe(n))), 1);
      const pai = paiDe(novo);
      let x, y;
      if (pai) {
        x = pai.x + pai.width + ENTRE_COLUNAS;
        const irmaos = edges.filter(e => e.fromNode === pai.id).map(e => lugar.get(e.toNode)).filter(Boolean);
        y = Math.max(pai.y, ...irmaos.map(n => n.y + n.height + ENTRE_IRMAOS));
      } else {
        x = postos.length ? Math.min(...postos.map(n => n.x)) : 0;
        y = postos.length ? Math.max(...postos.map(n => n.y + n.height)) + ENTRE_COLUNAS : 0;
      }
      const posto = { ...novo, x: encaixar(x), y: praCima(y) };
      for (let bate; (bate = postos.find(n => n.type !== 'group' && sobrepoe(n, posto)));) posto.y = praCima(bate.y + bate.height + ENTRE_IRMAOS);
      postos.push(posto); lugar.set(posto.id, posto); saida.push(posto);
    }
    return saida;
  }

  // Desce `base` na grade até o retângulo não cobrir nenhum cartão (grupos não contam).
  function lugarLivre(c, base) {
    const posto = { ...base, y: praCima(base.y) };
    for (let bate; (bate = c.nodes.find(n => n.type !== 'group' && sobrepoe(n, posto)));) posto.y = praCima(bate.y + bate.height + ENTRE_IRMAOS);
    return { x: posto.x, y: posto.y };
  }
  // Guias ao arrastar: encaixa começo/centro/fim da caixa nos do outro cartão, no menor
  // deslocamento dentro da tolerância (por eixo), e devolve uma linha por coincidência exata (a extensão da linha usa a caixa já deslocada no outro eixo).
  function guiasDeAlinhamento(caixa, outros, tolerancia) {
    const tres = (o, p, t, d = 0) => [o[p] + d, o[p] + o[t] / 2 + d, o[p] + o[t] + d];
    const menor = (p, t) => {
      let melhor = 0, dist = Infinity;
      for (const o of outros) for (const a of tres(caixa, p, t)) for (const b of tres(o, p, t)) {
        if (Math.abs(b - a) <= tolerancia && Math.abs(b - a) < dist) { dist = Math.abs(b - a); melhor = b - a; }
      }
      return melhor;
    };
    const dx = menor('x', 'width'), dy = menor('y', 'height'), linhas = [];
    for (const [eixo, p, t, d, q, u, dq] of [['x', 'x', 'width', dx, 'y', 'height', dy], ['y', 'y', 'height', dy, 'x', 'width', dx]]) {
      for (const o of outros) for (const a of tres(caixa, p, t, d)) for (const b of tres(o, p, t)) {
        if (a === b) linhas.push({ eixo, pos: b, de: Math.min(caixa[q] + dq, o[q]), ate: Math.max(caixa[q] + dq + caixa[u], o[q] + o[u]) });
      }
    }
    return { dx, dy, linhas };
  }

  const api = { TIPOS, LADOS, CORES, GRADE, ZOOM, OPOSTO, corValida, ler, serializar, adicionarCartao, moverCartoes, redimensionar, editarCartao, removerCartoes, duplicarCartoes, ligar, editarSeta, removerSetas, encaixar, historicoVazio, empilhar, editarNoHistorico, desfazer, refazer, vistaValida, paraCanvas, zoomEm, enquadrar, pontoDoLado, ladoMaisProximo, ladosDaSeta, caminhoDaSeta, geometriaDaSeta, dentro, renomearArquivos, caminhoSeguro, ehImagem, contidos, caixaDe, alturaEstimada, tamanhoPadrao, raizDe, layout, inserirPerto, novoId, ehPdf, copiarCartoes, colarCartoes, textoDoTrecho, lugarLivre, guiasDeAlinhamento, tipoDoArquivo, idDoYoutube, ALTURA_RECOLHIDA, alternarRecolhido, lerCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroFluxo = api;
})(globalThis);
