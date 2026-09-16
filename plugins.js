// plugins.js — parte pura do sistema de plug-ins: validação do manifesto,
// comparação de permissões e consentimento. Roda no navegador e no Node, como o
// domain.js. A API pública dos plug-ins é em inglês; o resto segue em português.
(function (root) {
  const PERMISSOES = ['notes:read', 'notes:write', 'tasks:read', 'tasks:write', 'habits:read', 'habits:write', 'folders:write', 'network'];
  const ROTULOS = {
    'notes:read': 'ler suas notas', 'notes:write': 'criar e alterar notas',
    'tasks:read': 'ver suas tarefas', 'tasks:write': 'criar e alterar tarefas',
    'habits:read': 'ver seus hábitos', 'habits:write': 'criar e alterar hábitos',
    'folders:write': 'criar e renomear pastas', network: 'acessar a internet',
  };
  const texto = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const versao = v => typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
  const partes = v => v.split('.').map(Number);
  // Compara versões no formato maior.menor.correcao: -1, 0 ou 1.
  function compararVersoes(a, b) {
    const [x, y] = [partes(a), partes(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  const lista = v => Array.isArray(v) ? v : [];
  // Host exato, sem curinga, sem esquema e sem caminho: "api.exemplo.com".
  const hostValido = v => typeof v === 'string' && /^[a-z0-9.-]{3,253}$/i.test(v) && v.includes('.');

  function validarManifesto(bruto, { versaoDoKiro } = {}) {
    const recusa = erro => ({ ok: false, erro });
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return recusa('O manifesto precisa ser um objeto JSON.');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(bruto.id || '')) return recusa('O campo id deve ter de 2 a 40 caracteres, em minúsculas, números e hífen.');
    for (const campo of ['name', 'author']) if (!texto(bruto[campo], 200)) return recusa(`O campo ${campo} é obrigatório e vai até 200 caracteres.`);
    if (bruto.description !== undefined && !texto(bruto.description, 200)) return recusa('A descrição vai até 200 caracteres.');
    if (!versao(bruto.version)) return recusa('A versão deve ser no formato 1.0.0.');
    if (!versao(bruto.minKiro)) return recusa('O campo minKiro deve ser no formato 1.0.0.');
    if (versaoDoKiro && compararVersoes(bruto.minKiro, versaoDoKiro) > 0) return recusa(`Este plug-in precisa do Kiro ${bruto.minKiro} ou mais novo.`);
    if (bruto.permissions !== undefined && !Array.isArray(bruto.permissions)) return recusa('O campo permissions deve ser uma lista de permissões.');
    if (bruto.network !== undefined && !Array.isArray(bruto.network)) return recusa('O campo network deve ser uma lista de endereços.');
    const permissions = lista(bruto.permissions);
    const estranha = permissions.find(p => !PERMISSOES.includes(p));
    if (estranha !== undefined) return recusa(`Permissão desconhecida: ${estranha}.`);
    const network = lista(bruto.network);
    // O esquema vem antes do formato: quem escreveu "http://exemplo.com" merece o aviso do https.
    if (network.some(h => typeof h === 'string' && /^[a-z]+:\/\//i.test(h))) return recusa('Em network, use só o host, sem https:// na frente.');
    const ruim = network.find(h => !hostValido(h));
    if (ruim !== undefined) return recusa(`Endereço de rede inválido: ${ruim}. Use o host exato, como api.exemplo.com.`);
    if (network.length && !permissions.includes('network')) return recusa('Para usar rede, declare a permissão network.');
    return { ok: true, manifesto: { id: bruto.id, name: bruto.name, author: bruto.author, description: bruto.description || '', version: bruto.version, minKiro: bruto.minKiro, permissions, network } };
  }

  const comparar = (concedidas, pedidas) => ({
    novas: lista(pedidas).filter(p => !lista(concedidas).includes(p)),
    removidas: lista(concedidas).filter(p => !lista(pedidas).includes(p)),
  });
  // Só pergunta de novo quando o plug-in passou a pedir mais do que já tinha.
  const precisaConsentir = (registro, manifesto) =>
    comparar(registro && registro.permissions, manifesto.permissions).novas.length > 0 ||
    comparar(registro && registro.network, manifesto.network).novas.length > 0;
  const rotuloDaPermissao = nome => ROTULOS[nome] || nome;

  // Cada método da API pede uma permissão; storage e interface não pedem nada.
  // Esta lista é a fronteira: o que não está aqui o plug-in nunca alcança.
  const METODOS = {
    'notes.list': 'notes:read', 'notes.get': 'notes:read', 'notes.current': 'notes:read', 'notes.search': 'notes:read',
    'notes.create': 'notes:write', 'notes.update': 'notes:write', 'notes.trash': 'notes:write', 'notes.move': 'notes:write',
    'tasks.list': 'tasks:read', 'tasks.create': 'tasks:write', 'tasks.update': 'tasks:write',
    'habits.list': 'habits:read', 'habits.mark': 'habits:write',
    'folders.create': 'folders:write',
    'storage.get': '', 'storage.set': '', 'notify': '',
  };
  const tem = (objeto, chave) => Object.prototype.hasOwnProperty.call(objeto, chave);
  const metodosPermitidos = permissoes => Object.keys(METODOS).filter(m => !METODOS[m] || lista(permissoes).includes(METODOS[m]));
  const podeChamar = (permissoes, metodo) => tem(METODOS, metodo) && (!METODOS[metodo] || lista(permissoes).includes(METODOS[metodo]));

  /**
   * Decide o que carregar: só plug-in ativado, com manifesto válido e permissões
   * já concedidas. O resto volta como pendente (espera consentimento) ou problema.
   */
  function planoDeCarga(achados, escolhas, { versaoDoKiro } = {}) {
    const plano = { carregar: [], pendentes: [], problemas: [] };
    for (const achado of achados || []) {
      if (achado.erro) { plano.problemas.push({ id: achado.id, erro: achado.erro }); continue; }
      const { ok, manifesto, erro } = validarManifesto(achado.manifesto, { versaoDoKiro });
      if (!ok) { plano.problemas.push({ id: achado.id, erro }); continue; }
      // A rota serve pelo nome da pasta: id diferente enganaria quem lê as permissões.
      if (manifesto.id !== achado.id) { plano.problemas.push({ id: achado.id, erro: 'O id do manifesto é diferente do nome da pasta.' }); continue; }
      const registro = (escolhas || {})[achado.id];
      if (!registro || !registro.enabled) { plano.pendentes.push({ id: achado.id, manifesto, motivo: 'desligado' }); continue; }
      if (precisaConsentir(registro, manifesto)) { plano.pendentes.push({ id: achado.id, manifesto, motivo: 'permissoes-novas' }); continue; }
      // Vale o que o usuário concedeu, não o que o manifesto pede.
      plano.carregar.push({ id: achado.id, manifesto, permissoes: lista(registro.permissions) });
    }
    return plano;
  }

  const escapar = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const itens = v => Array.isArray(v) ? v : [];
  /**
   * O plug-in manda dados, nunca HTML: aqui eles viram marcação com todo texto
   * escapado, usando as classes do próprio Kiro para herdar tema e skin. Esta é a
   * fronteira: nada que venha do plug-in chega ao DOM sem passar por escapar().
   */
  function painelParaHtml(dados, { pluginId } = {}) {
    const alvo = ` data-plugin="${escapar(pluginId)}"`;
    const clicavel = acao => acao ? `${alvo} data-acao="${escapar(acao)}" role="button" tabindex="0"` : '';
    const d = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    switch (d.type) {
      case 'text':
        return `<p class="plugin-texto">${escapar(d.text)}</p>`;
      case 'list':
        return `<ul class="plugin-lista">${itens(d.items).map(i => `<li class="plugin-item"${clicavel(i && i.action)}><span class="plugin-titulo">${escapar(i && i.title)}</span>${i && i.detail ? `<span class="small-muted">${escapar(i.detail)}</span>` : ''}</li>`).join('')}</ul>`;
      case 'cards':
        return `<div class="plugin-cards">${itens(d.items).map(i => `<article class="plugin-card"${clicavel(i && i.action)}><h4>${escapar(i && i.title)}</h4><p>${escapar(i && i.body)}</p></article>`).join('')}</div>`;
      case 'table':
        return `<div class="plugin-tabela-rolagem"><table class="plugin-tabela"><thead><tr>${itens(d.columns).map(c => `<th scope="col">${escapar(c)}</th>`).join('')}</tr></thead><tbody>${itens(d.rows).map(l => `<tr>${itens(l).map(c => `<td>${escapar(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      case 'form':
        // O tipo do campo sai de uma lista fixa: virar atributo livre abriria a porta de novo.
        return `<form class="plugin-form"${alvo} data-acao="${escapar(d.submit)}">${itens(d.fields).map(f => {
          const campo = f && typeof f === 'object' ? f : {};
          const nome = ` name="${escapar(campo.name)}"`;
          const entrada = campo.type === 'select'
            ? `<select${nome}>${itens(campo.options).map(o => `<option value="${escapar(o)}">${escapar(o)}</option>`).join('')}</select>`
            : `<input${nome} type="${campo.type === 'number' ? 'number' : 'text'}" />`;
          return `<label class="field"><span>${escapar(campo.label)}</span>${entrada}</label>`;
        }).join('')}<button class="primary" type="submit">Enviar</button></form>`;
      case 'stack':
        return `<div class="plugin-pilha">${itens(d.children).map(c => painelParaHtml(c, { pluginId })).join('')}</div>`;
      default:
        return `<p class="cfg-aviso">Formato de painel não reconhecido: ${escapar(d.type)}.</p>`;
    }
  }

  // ---- Higienizador de HTML dos blocos (etapa 2) ----
  // Lista de permitidos. A segurança não depende de ler o HTML igual ao navegador:
  // a saída é remontada do zero (tag permitida, atributo permitido entre aspas duplas,
  // todo texto e valor escapados), então nenhum truque de sintaxe sobrevive à volta.
  const TAGS = new Set(['p', 'br', 'hr', 'span', 'div', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text']);
  const VAZIAS = new Set(['br', 'hr', 'img']);
  // Somem com todo o conteúdo, não só a tag.
  const DESCARTAR = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'foreignobject', 'textarea', 'title']);
  const ATRIBUTOS = new Set(['class', 'title', 'alt', 'colspan', 'rowspan', 'href', 'src', 'width', 'height', 'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'points', 'text-anchor', 'font-size', 'transform']);
  const CANONICO = { viewbox: 'viewBox' }; // SVG diferencia maiúsculas
  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decodificar = v => v.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== '#') return ENTIDADES[e.toLowerCase()];
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  function valorPermitido(nome, valor) {
    // Espaços e controles somem antes de comparar: "java\tscript:" e " javascript:" contam como javascript:.
    const v = decodificar(valor).replace(/[ - ]/g, '').toLowerCase();
    if (nome === 'href') return /^(https?:|#)/.test(v);
    // svg+xml fica: em <img> o SVG roda em modo seguro, sem script nem recurso externo.
    if (nome === 'src') return /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(v);
    return !/(javascript|vbscript|data):|expression\(|url\(/.test(v);
  }
  // Nome e valor usam o truque (?=(…))\N, que imita grupo atômico: sem ele,
  // "x=a/b/c" teria muitas leituras e uma entrada sem ">" travaria a página.
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:(?:[\s/]+|(?<=["']))(?=([^\s"'<>/=]+))\4(?:\s*=\s*(?=("[^"]*"|'[^']*'|[^\s"'<>]+))\5)?)*)[\s/]*>/y;
  const ATRIBUTO = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  /**
   * HTML de plug-in → HTML seguro para innerHTML. Sem DOM: roda no Node e no navegador.
   * Tag fora da lista some e deixa o texto; as de DESCARTAR levam o conteúdo junto.
   */
  function higienizarHtml(html) {
    const entrada = String(html ?? '').slice(0, 200 * 1024).replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<![^>]*>/g, '');
    const saida = [], abertas = [];
    let descartando = null, i = 0;
    while (i < entrada.length) {
      TAG.lastIndex = i;
      const m = entrada[i] === '<' ? TAG.exec(entrada) : null;
      if (!m) {
        // Texto até o próximo "<" (ou o próprio "<" solto), decodificado e escapado de novo.
        const fim = entrada.indexOf('<', i + 1);
        const texto = entrada.slice(i, fim < 0 ? entrada.length : fim);
        if (!descartando) saida.push(escapar(decodificar(texto)));
        i += texto.length;
        continue;
      }
      i = TAG.lastIndex;
      const [bruto, barra, nomeBruto, atributos] = m;
      const nome = nomeBruto.toLowerCase(), fechando = barra === '/', autoFechada = /\/\s*>$/.test(bruto);
      if (descartando) { if (fechando && nome === descartando) descartando = null; continue; }
      if (DESCARTAR.has(nome)) { if (!fechando && !autoFechada) descartando = nome; continue; }
      if (!TAGS.has(nome)) continue;
      if (fechando) {
        const pos = abertas.lastIndexOf(nome);
        while (pos >= 0 && abertas.length > pos) saida.push(`</${abertas.pop()}>`);
        continue;
      }
      const attrs = [];
      for (const a of atributos.matchAll(ATRIBUTO)) {
        const chave = a[1].toLowerCase(), valor = a[2] ?? a[3] ?? a[4] ?? '';
        if (!ATRIBUTOS.has(chave) || !valorPermitido(chave, valor)) continue;
        attrs.push(` ${CANONICO[chave] || chave}="${escapar(decodificar(valor))}"`);
      }
      if (nome === 'a' && attrs.some(a => a.startsWith(' href='))) attrs.push(' rel="noopener noreferrer"');
      saida.push(`<${nome}${attrs.join('')}>`);
      if (VAZIAS.has(nome)) continue;
      if (autoFechada) saida.push(`</${nome}>`);
      else abertas.push(nome);
    }
    while (abertas.length) saida.push(`</${abertas.pop()}>`);
    return saida.join('');
  }

  // Eventos: compara as notas de antes e de depois de uma gravação (ou recarga)
  // pelo updatedAt. Nota apagada não gera evento.
  function eventosDaGravacao(antes, depois) {
    const anterior = new Map((antes || []).map(n => [n.id, n.updatedAt]));
    const criadas = [], alteradas = [];
    for (const n of depois || []) {
      if (!anterior.has(n.id)) criadas.push(n.id);
      else if (anterior.get(n.id) !== n.updatedAt) alteradas.push(n.id);
    }
    return { criadas, alteradas };
  }
  // save e create levam a nota inteira: só quem pode ler notas recebe. day não leva nada.
  const deveEntregar = (evento, permissoes) =>
    evento === 'day' ? true : (evento === 'save' || evento === 'create') && (permissoes || []).includes('notes:read');

  const api = { PERMISSOES, METODOS, eventosDaGravacao, deveEntregar, painelParaHtml, higienizarHtml, planoDeCarga, validarManifesto, compararVersoes, comparar, precisaConsentir, rotuloDaPermissao, metodosPermitidos, podeChamar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroPlugins = api;
})(globalThis);
