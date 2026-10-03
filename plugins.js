// plugins.js — parte pura do sistema de plug-ins: validação do manifesto,
// comparação de permissões e consentimento. Roda no navegador e no Node, como o
// domain.js. A API pública dos plug-ins é em inglês; o resto segue em português.
(function (root) {
  // Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
  const frase = f => f;
  const PERMISSOES = ['notes:read', 'notes:write', 'tasks:read', 'tasks:write', 'habits:read', 'habits:write', 'folders:write', 'network'];
  const ROTULOS = {
    'notes:read': frase('ler suas notas'), 'notes:write': frase('criar e alterar notas'),
    'tasks:read': frase('ver suas tarefas'), 'tasks:write': frase('criar e alterar tarefas'),
    'habits:read': frase('ver seus hábitos'), 'habits:write': frase('criar e alterar hábitos'),
    'folders:write': frase('criar e renomear pastas'), network: frase('acessar a internet'),
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

  // ---- Rede (etapa 3) ----
  // Primeira barreira do kiro.fetch. O executor revalida o que depende da rede.
  const CABECALHOS_PROIBIDOS = new Set(['cookie', 'cookie2', 'set-cookie', 'host', 'origin', 'referer', 'authorization', 'proxy-authorization', 'connection', 'content-length', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'keep-alive', 'expect']);
  const METODOS_DE_REDE = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const LIMITE_CORPO = 1024 * 1024;
  const nomeDeSegredo = v => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(v);
  const nomeDeCabecalho = v => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
  const cabecalhoProibido = nome => { const n = nome.toLowerCase(); return CABECALHOS_PROIBIDOS.has(n) || n.startsWith('proxy-') || n.startsWith('sec-'); };
  // Controles (inclui CR, LF, NUL e DEL) quebram a linha do cabeçalho: injeção.
  const temControle = v => /[\x00-\x1f\x7f]/.test(v);
  // Depois do new URL, decimal/octal/hex já viraram a.b.c.d; IPv6 vem entre colchetes.
  const ipLiteral = host => /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  // Tamanho em bytes sem Buffer (roda também no navegador).
  const bytes = s => new TextEncoder().encode(s).length;

  // ---- Opções de painéis (Hoje configurável) ----
  // Opções de um painel (4º argumento de kiro.panel). O Kiro desenha o formulário; aqui só se
  // confere a declaração. Sem declaração: painel sem opções. `width: 'full'` é só a sugestão
  // inicial de largura — quem decide depois é a pessoa, na Hoje.
  const TIPOS_DE_OPCAO = ['boolean', 'number', 'select', 'text'];
  function validarOpcoesDoPainel(options, width) {
    const recusa = erro => ({ ok: false, erro });
    if (width !== undefined && width !== 'normal' && width !== 'full') return recusa(frase('width precisa ser "normal" ou "full".'));
    const largura = width === 'full' ? 'inteira' : 'normal';
    if (options === undefined) return { ok: true, opcoes: [], largura };
    if (!Array.isArray(options) || options.length > 12) return recusa(frase('options precisa ser uma lista de até 12 opções.'));
    const chaves = new Set(), opcoes = [];
    const finito = v => v === undefined || (typeof v === 'number' && Number.isFinite(v));
    for (const o of options) {
      if (!o || typeof o !== 'object') return recusa(frase('Cada opção precisa ser um objeto.'));
      if (typeof o.key !== 'string' || !/^[a-z][a-zA-Z0-9]{0,31}$/.test(o.key) || chaves.has(o.key)) return recusa(`Chave de opção inválida ou repetida: ${String(o.key).slice(0, 40)}.`);
      chaves.add(o.key);
      if (!TIPOS_DE_OPCAO.includes(o.type)) return recusa(`Tipo de opção desconhecido em ${o.key}.`);
      if (!texto(o.label, 40) || temControle(o.label)) return recusa(`O rótulo de ${o.key} é obrigatório e vai até 40 caracteres.`);
      const saida = { key: o.key, type: o.type, label: o.label, default: o.default };
      if (o.type === 'boolean' && typeof o.default !== 'boolean') return recusa(`O padrão de ${o.key} precisa ser true ou false.`);
      if (o.type === 'text' && (typeof o.default !== 'string' || o.default.length > 80)) return recusa(`O padrão de ${o.key} precisa ser um texto de até 80 caracteres.`);
      if (o.type === 'number') {
        if (typeof o.default !== 'number' || !Number.isFinite(o.default) || !finito(o.min) || !finito(o.max)
          || (o.min !== undefined && o.default < o.min) || (o.max !== undefined && o.default > o.max)) return recusa(`${o.key} precisa de um padrão numérico entre min e max.`);
        if (o.min !== undefined) saida.min = o.min;
        if (o.max !== undefined) saida.max = o.max;
      }
      if (o.type === 'select') {
        if (!Array.isArray(o.choices) || !o.choices.length || o.choices.length > 20
          || !o.choices.every(c => texto(c, 40) && !temControle(c)) || !o.choices.includes(o.default)) return recusa(`${o.key} precisa de 1 a 20 escolhas de texto, e o padrão entre elas.`);
        saida.choices = [...o.choices];
      }
      opcoes.push(saida);
    }
    return { ok: true, opcoes, largura };
  }

  // ---- Molduras isoladas (etapa 4) ----
  const ALTURA_DA_MOLDURA = { min: 40, max: 2000, padrao: 240 };
  const arquivoDeTela = nome => typeof nome === 'string' && /^[a-z0-9][a-z0-9._-]{0,60}\.html$/i.test(nome) && !nome.includes('..');
  const TIPOS_DE_ARQUIVO = { js: 'text/javascript; charset=utf-8', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8' };
  const tipoDoArquivoDoPlugin = nome => {
    const m = /\.([a-z]+)$/i.exec(String(nome || ''));
    return (m && TIPOS_DE_ARQUIVO[m[1].toLowerCase()]) || null;
  };
  function validarMoldura(valor) {
    if (!valor || typeof valor !== 'object' || !arquivoDeTela(valor.frame)) return { ok: false, erro: frase('A moldura precisa de um arquivo .html da pasta do plug-in.') };
    const { min, max, padrao } = ALTURA_DA_MOLDURA;
    const altura = Number.isFinite(valor.height) ? Math.min(max, Math.max(min, Math.round(valor.height))) : padrao;
    return { ok: true, frame: valor.frame, height: altura, data: valor.data === undefined ? null : valor.data };
  }
  /**
   * CSP do .html do plug-in. `origem` é a origem explícita dos arquivos do Kiro
   * ('http://127.0.0.1:4180' na web, 'kiro-plugin:' no Electron): numa moldura de
   * origem opaca 'self' é ambíguo, e esquema inteiro (http:) abriria vazamento por
   * <script src>/<img src>. `sandbox` isola mesmo se a URL for aberta direto.
   */
  function cspDaMoldura(origem) {
    const partes = [
      'sandbox allow-scripts', "default-src 'none'", `script-src ${origem}`, `style-src ${origem} 'unsafe-inline'`,
      `img-src ${origem} data:`, `font-src ${origem} data:`, "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
    ];
    // No Electron a página é file://, que nenhuma fonte de frame-ancestors casa: lá fica sem.
    if (/^https?:\/\//.test(origem)) partes.push(`frame-ancestors ${origem}`);
    return partes.join('; ');
  }
  // O runtime da tela entra antes de qualquer script do plug-in: sempre no início do
  // documento, ou logo após um <!doctype> inicial. Nunca procura <head>: um "<head>"
  // dentro de comentário ou texto enganaria uma busca por posição.
  function injetarScriptsDaMoldura(html, urlDoScript) {
    const tag = `<script src="${urlDoScript}"></script>`;
    const texto = String(html);
    const doctype = /^[\s﻿]*<!doctype[^>]*>/i.exec(texto);
    if (doctype) return texto.slice(0, doctype[0].length) + tag + texto.slice(doctype[0].length);
    return tag + texto;
  }
  const VARIAVEIS_DO_TEMA = ['--bg', '--panel', '--panel-raised', '--sidebar-bg', '--content-bg', '--campo', '--ink', '--muted', '--line',
    '--acento', '--acento-2', '--acento-forte', '--acento-escuro', '--acento-texto', '--primario-texto', '--fonte-interface', '--fonte-leitura', '--fonte-codigo',
    // Tokens derivados (styles.css): estados, cores semânticas e forma, para o plug-in seguir destaque, skin e claro/escuro sem cor fixa.
    '--accent-soft', '--accent-text', '--focus-ring', '--surface-hover', '--surface-active', '--selected', '--border-strong', '--text-disabled', '--placeholder',
    '--danger', '--warning', '--success', '--info', '--shadow-sm', '--shadow-md', '--raio-controle', '--raio-card'];

  // Ícone do plug-in (manifest.icon): o nome de um ícone do Kiro (segue o pacote de ícones do tema) ou o
  // desenho de um <path> em 24×24 (o atributo d), traçado no estilo dos outros ícones. Nunca SVG/HTML do
  // plug-in: o ícone é desenhado na janela do Kiro, fora da moldura isolada, então só passam letras de path.
  const NOME_DE_ICONE = /^[a-z][a-z0-9-]{1,39}$/;
  const CAMINHO_DE_ICONE = /^\s*[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]{0,1999}$/;
  const iconeValido = v => typeof v === 'string' && (NOME_DE_ICONE.test(v) || CAMINHO_DE_ICONE.test(v));

  function validarManifesto(bruto, { versaoDoKiro } = {}) {
    const recusa = erro => ({ ok: false, erro });
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return recusa(frase('O manifesto precisa ser um objeto JSON.'));
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(bruto.id || '')) return recusa(frase('O campo id deve ter de 2 a 40 caracteres, em minúsculas, números e hífen.'));
    for (const campo of ['name', 'author']) if (!texto(bruto[campo], 200)) return recusa(`O campo ${campo} é obrigatório e vai até 200 caracteres.`);
    if (bruto.description !== undefined && !texto(bruto.description, 200)) return recusa(frase('A descrição vai até 200 caracteres.'));
    if (!versao(bruto.version)) return recusa(frase('A versão deve ser no formato 1.0.0.'));
    if (!versao(bruto.minKiro)) return recusa(frase('O campo minKiro deve ser no formato 1.0.0.'));
    if (versaoDoKiro && compararVersoes(bruto.minKiro, versaoDoKiro) > 0) return recusa(`Este plug-in precisa do Kiro ${bruto.minKiro} ou mais novo.`);
    if (bruto.permissions !== undefined && !Array.isArray(bruto.permissions)) return recusa(frase('O campo permissions deve ser uma lista de permissões.'));
    if (bruto.network !== undefined && !Array.isArray(bruto.network)) return recusa(frase('O campo network deve ser uma lista de endereços.'));
    const permissions = lista(bruto.permissions);
    const estranha = permissions.find(p => !PERMISSOES.includes(p));
    if (estranha !== undefined) return recusa(`Permissão desconhecida: ${estranha}.`);
    const network = lista(bruto.network);
    // O esquema vem antes do formato: quem escreveu "http://exemplo.com" merece o aviso do https.
    if (network.some(h => typeof h === 'string' && /^[a-z]+:\/\//i.test(h))) return recusa(frase('Em network, use só o host, sem https:// na frente.'));
    const ruim = network.find(h => !hostValido(h));
    if (ruim !== undefined) return recusa(`Endereço de rede inválido: ${ruim}. Use o host exato, como api.exemplo.com.`);
    if (network.length && !permissions.includes('network')) return recusa(frase('Para usar rede, declare a permissão network.'));
    if (bruto.secrets !== undefined && !Array.isArray(bruto.secrets)) return recusa(frase('O campo secrets precisa ser uma lista.'));
    const secrets = [];
    for (const s of lista(bruto.secrets)) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return recusa(frase('Cada item de secrets precisa ser um objeto.'));
      if (!nomeDeSegredo(s.name)) return recusa(`Nome de segredo inválido: ${String(s.name)}.`);
      if (secrets.some(x => x.name === s.name)) return recusa(`Segredo repetido: ${s.name}.`);
      if (!texto(s.label, 80)) return recusa(`O segredo ${s.name} precisa de label até 80 caracteres.`);
      if (!network.includes(s.host)) return recusa(`O host do segredo ${s.name} precisa estar em network.`);
      // authorization é proibido ao plug-in, mas é justamente o uso esperado de um segredo.
      if (!nomeDeCabecalho(s.header) || (cabecalhoProibido(s.header) && s.header.toLowerCase() !== 'authorization')) return recusa(`Cabeçalho inválido no segredo ${s.name}.`);
      if (typeof s.format !== 'string' || s.format.length > 120 || temControle(s.format) || s.format.split('{value}').length !== 2) return recusa(`O format do segredo ${s.name} precisa ter {value} exatamente uma vez, sem quebra de linha.`);
      secrets.push({ name: s.name, label: s.label, host: s.host, header: s.header, format: s.format });
    }
    // Configurações do plug-in: o Kiro desenha o formulário em Configurações → Plug-ins, no mesmo
    // formato das opções de painel; o plug-in lê os valores com kiro.settings.get().
    let settings = [];
    if (bruto.settings !== undefined) {
      const v = validarOpcoesDoPainel(bruto.settings);
      if (!v.ok) return recusa(`Em settings: ${v.erro}`);
      settings = v.opcoes;
    }
    let page = null;
    if (bruto.page !== undefined) {
      const p = bruto.page;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return recusa(frase('O campo page precisa ser um objeto { title, file }.'));
      if (!texto(p.title, 40) || temControle(p.title)) return recusa(frase('O título da página (page.title) é obrigatório e vai até 40 caracteres.'));
      if (!arquivoDeTela(p.file)) return recusa(frase('page.file precisa ser um arquivo .html da pasta do plug-in, sem barra.'));
      page = { title: p.title, file: p.file };
    }
    if (bruto.icon !== undefined && !iconeValido(bruto.icon)) return recusa(frase('O campo icon precisa ser o nome de um ícone do Kiro ou o desenho de um caminho SVG (o atributo d de um path), com até 2000 caracteres.'));
    const icon = bruto.icon === undefined ? '' : bruto.icon.trim();
    return { ok: true, manifesto: { id: bruto.id, name: bruto.name, author: bruto.author, description: bruto.description || '', version: bruto.version, minKiro: bruto.minKiro, permissions, network, secrets, settings, page, icon } };
  }

  /**
   * Pedido do plug-in → pedido normalizado, ou recusa. Na dúvida, recusa:
   * nada é convertido por String() para não aceitar objeto com toString esperto.
   */
  function validarPedidoDeRede(pedido, { hostsConcedidos = [], segredos = [] } = {}) {
    const recusa = erro => ({ ok: false, erro });
    const p = pedido && typeof pedido === 'object' ? pedido : {};
    const bruta = p.url;
    if (typeof bruta !== 'string' || bruta.length > 8192) return recusa(frase('Endereço (URL) inválido ou longo demais.'));
    // O parser do URL apaga espaço, tab e quebra de linha e troca \ por /: o que ele
    // "conserta" em silêncio pode não ser o que o plug-in mostrou. Recusa antes.
    if (/[\s\\\x00-\x1f\x7f-\x9f]/.test(bruta)) return recusa(frase('Endereço (URL) inválido: espaço, barra invertida ou caractere de controle.'));
    let url;
    try { url = new URL(bruta); } catch { return recusa(frase('Endereço (URL) inválido.')); }
    if (url.protocol !== 'https:') return recusa(frase('Só endereços https são permitidos.'));
    // "https:api.x" e "https:/api.x" são aceitos pelo parser; exige a forma inteira.
    if (!/^https:\/\//i.test(bruta)) return recusa(frase('Endereço (URL) inválido: use https://host/caminho.'));
    if (url.port && url.port !== '443') return recusa(frase('Só a porta 443 é permitida.'));
    if (url.username || url.password) return recusa(frase('URL com usuário ou senha (credenciais) não é permitida.'));
    const host = url.hostname.toLowerCase();
    if (ipLiteral(host.replace(/\.$/, ''))) return recusa(frase('Use o nome do host, não um endereço IP.'));
    // Comparação exata: "api.x.com." (ponto final) e punycode não casam com "api.x.com".
    if (!lista(hostsConcedidos).some(h => typeof h === 'string' && h.toLowerCase() === host)) return recusa(`Host não liberado: ${host}.`);
    const method = p.method === undefined || p.method === null ? 'GET' : typeof p.method === 'string' ? p.method.toUpperCase() : '';
    if (!METODOS_DE_REDE.has(method)) return recusa(`Método não permitido: ${typeof p.method === 'string' ? p.method : typeof p.method}.`);
    const headers = {};
    if (p.headers !== undefined && p.headers !== null && (typeof p.headers !== 'object' || Array.isArray(p.headers) || Object.getPrototypeOf(p.headers) !== Object.prototype))
      return recusa(frase('Os cabeçalhos precisam ser um objeto simples.'));
    for (const [nome, valor] of Object.entries(p.headers || {})) {
      if (!nomeDeCabecalho(nome) || cabecalhoProibido(nome)) return recusa(`Cabeçalho não permitido: ${nome}.`);
      const chave = nome.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(headers, chave)) return recusa(`Cabeçalho repetido: ${nome}.`);
      if (typeof valor !== 'string' || valor.length > 4096 || temControle(valor)) return recusa(`Valor inválido no cabeçalho ${nome}: texto até 4096 caracteres, sem quebra de linha.`);
      headers[chave] = valor;
    }
    if (p.body !== undefined && p.body !== null && typeof p.body !== 'string') return recusa(frase('O corpo precisa ser texto.'));
    const body = p.body ?? null;
    if (body && bytes(body) > LIMITE_CORPO) return recusa(frase('O corpo passa de 1 MB.'));
    let secret = null;
    if (p.secret !== undefined && p.secret !== null) {
      const s = typeof p.secret === 'string' ? lista(segredos).find(x => x && x.name === p.secret) : undefined;
      if (!s) return recusa(`Segredo (chave) não declarado: ${typeof p.secret === 'string' ? p.secret : typeof p.secret}.`);
      if (String(s.host).toLowerCase() !== host) return recusa(`O segredo ${s.name} só vale para o host ${s.host}.`);
      secret = s.name;
    }
    url.hash = ''; // o fragmento nunca sai do computador
    return { ok: true, pedido: { url: url.href, host, method, headers, body, secret } };
  }

  const comparar = (concedidas, pedidas) => ({
    novas: lista(pedidas).filter(p => !lista(concedidas).includes(p)),
    removidas: lista(concedidas).filter(p => !lista(pedidas).includes(p)),
  });
  // Só pergunta de novo quando o plug-in passou a pedir mais do que já tinha.
  const precisaConsentir = (registro, manifesto) =>
    comparar(registro && registro.permissions, manifesto.permissions).novas.length > 0 ||
    comparar(registro && registro.network, manifesto.network).novas.length > 0 ||
    lista(manifesto.secrets).some(s => !lista(registro && registro.secrets).includes(s.name));
  const rotuloDaPermissao = nome => ROTULOS[nome] || nome;

  // Cada método da API pede uma permissão; storage e interface não pedem nada.
  // Esta lista é a fronteira: o que não está aqui o plug-in nunca alcança.
  const METODOS = {
    'notes.list': 'notes:read', 'notes.get': 'notes:read', 'notes.current': 'notes:read', 'notes.search': 'notes:read',
    'notes.create': 'notes:write', 'notes.update': 'notes:write', 'notes.trash': 'notes:write', 'notes.move': 'notes:write',
    'tasks.list': 'tasks:read', 'tasks.create': 'tasks:write', 'tasks.update': 'tasks:write',
    'habits.list': 'habits:read', 'habits.mark': 'habits:write',
    'folders.create': 'folders:write',
    'storage.get': '', 'storage.set': '', 'settings.get': '', 'notify': '',
    'fetch': 'network',
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
      if (manifesto.id !== achado.id) { plano.problemas.push({ id: achado.id, erro: frase('O id do manifesto é diferente do nome da pasta.') }); continue; }
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
    const v = decodificar(valor).replace(/[\x00-\x20\x7f]/g, '').toLowerCase();
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

  const api = { CAMINHO_DE_ICONE, PERMISSOES, METODOS, CABECALHOS_PROIBIDOS, validarPedidoDeRede, eventosDaGravacao, deveEntregar, painelParaHtml, higienizarHtml, planoDeCarga, validarManifesto, compararVersoes, comparar, precisaConsentir, rotuloDaPermissao, metodosPermitidos, podeChamar, ALTURA_DA_MOLDURA, VARIAVEIS_DO_TEMA, validarMoldura, validarOpcoesDoPainel, arquivoDeTela, tipoDoArquivoDoPlugin, cspDaMoldura, injetarScriptsDaMoldura };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroPlugins = api;
})(globalThis);
