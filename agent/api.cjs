'use strict';
/**
 * Kiro Agent API — a única camada autorizada a mexer no cofre em nome de terceiros.
 *
 * Não reimplementa persistência: toda escrita passa por Vault.save(), que já faz
 * gravação atômica, checagem de revisão, snapshot em .history e arquivamento em
 * .trash. Aqui ficam só resolução de alvos, validação e composição do estado.
 *
 * Esta camada é agnóstica de interface e de fornecedor de IA. Não conhece a Mico,
 * não conhece MCP e não fala com nenhum serviço externo.
 */
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const domain = require('../domain.js');
const KiroFluxo = require('../fluxo.js');
const { AgentError, vaultRelativePath, folderSegments, noteTitle, tagList } = require('./security.cjs');
const { KiroEvents } = require('./events.cjs');

const { pathKey, normalize, wikiLinks, findLinkedNote, localDate, habitStats, tags: tagsDaNota, validFolderName, safeUrl } = domain;

const CONFLITO = /mudou|ocupado/i;
const MAX_LIMITE = 200;

/** Normaliza caractere a caractere mantendo o índice original, para recortar trechos. */
function dobrarComIndices(texto) {
  let saida = '';
  const indices = [];
  for (let i = 0; i < texto.length; i++) {
    const dobrado = normalize(texto[i]);
    saida += dobrado;
    for (let k = 0; k < dobrado.length; k++) indices.push(i);
  }
  return { saida, indices };
}

function recortar(corpo, consulta) {
  const { saida, indices } = dobrarComIndices(corpo);
  const posicao = saida.indexOf(normalize(consulta));
  if (posicao < 0) return corpo.slice(0, 160).trim();
  const centro = indices[posicao];
  const inicio = Math.max(0, centro - 60);
  const fim = Math.min(corpo.length, centro + 120);
  return `${inicio > 0 ? '…' : ''}${corpo.slice(inicio, fim).replace(/\s+/g, ' ').trim()}${fim < corpo.length ? '…' : ''}`;
}

// Cartão do canvas no formato que a IA lê. Cartão de arquivo .md é "note" com o caminho da
// nota; imagem e outros arquivos ficam "file".
function cartaoParaIA(n, posicoes) {
  const saida = { id: n.id };
  if (n.type === 'text') Object.assign(saida, { type: 'text', text: n.text });
  else if (n.type === 'file') Object.assign(saida, /\.md$/i.test(n.file) ? { type: 'note', note: n.file } : { type: 'file', file: n.file });
  else if (n.type === 'link') Object.assign(saida, { type: 'link', url: n.url });
  else Object.assign(saida, { type: 'group' }, n.label !== undefined ? { label: n.label } : {});
  if (n.color) saida.color = n.color;
  if (posicoes) Object.assign(saida, { x: n.x, y: n.y, width: n.width, height: n.height });
  return saida;
}
const setaParaIA = e => ({ id: e.id, from: e.fromNode, to: e.toNode, ...(e.label ? { label: e.label } : {}), ...(e.color ? { color: e.color } : {}) });

// ---- Entrada da IA para fluxos. O schema só confere o topo; cada cartão é validado aqui.
const MAX_TEXTO_CARTAO = 5000;
const CAMPOS_DO_CARTAO = ['id', 'type', 'text', 'note', 'url', 'label', 'color', 'x', 'y', 'width', 'height'];

function objeto(valor, onde) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new AgentError('INVALID_INPUT', `${onde} deve ser um objeto.`);
  return valor;
}
function textoDoCartao(valor, campo, onde) {
  if (typeof valor !== 'string') throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" deve ser texto.`);
  if (valor.length > MAX_TEXTO_CARTAO) throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" passa de ${MAX_TEXTO_CARTAO} caracteres. Divida o conteúdo em mais cartões.`);
  return valor;
}
// Posição e tamanho: números finitos; tamanho a partir do mínimo do editor (80 × 40).
function geometria(e, onde) {
  const saida = {};
  for (const campo of ['x', 'y', 'width', 'height']) {
    if (e[campo] === undefined || e[campo] === null) continue;
    if (typeof e[campo] !== 'number' || !Number.isFinite(e[campo]) || Math.abs(e[campo]) > 1e6) {
      throw new AgentError('INVALID_INPUT', `${onde}: "${campo}" deve ser um número.`);
    }
    saida[campo] = e[campo];
  }
  if ((saida.width !== undefined && saida.width < 80) || (saida.height !== undefined && saida.height < 40)) {
    throw new AgentError('INVALID_INPUT', `${onde}: largura mínima 80 e altura mínima 40.`);
  }
  return saida;
}
function corDoCartao(valor, onde) {
  if (valor === undefined || valor === null) return undefined;
  if (!KiroFluxo.corValida(valor)) throw new AgentError('INVALID_INPUT', `${onde}: "color" deve ser "1" a "6" (vermelho, laranja, amarelo, verde, ciano, roxo) ou #rrggbb.`);
  return valor;
}
function apelido(e, onde, vistos) {
  objeto(e, onde);
  if (typeof e.id !== 'string' || !e.id.trim() || e.id.length > 100) {
    throw new AgentError('INVALID_INPUT', `${onde}: "id" é obrigatório (um apelido seu, como "raiz" ou "ideia-1"; o Kiro troca pelo id real).`);
  }
  if (vistos.has(e.id)) throw new AgentError('INVALID_INPUT', `${onde}: o id "${e.id}" se repete.`);
  vistos.add(e.id);
  return e.id;
}
// Ligação pedida pela IA. `resolver` troca a referência (apelido ou id real) pelo id do cartão.
function setaDaIA(e, onde, resolver, dica) {
  objeto(e, onde);
  const extras = Object.keys(e).filter(k => !['from', 'to', 'label', 'color'].includes(k));
  if (extras.length) throw new AgentError('INVALID_INPUT', `${onde}: campo desconhecido "${extras[0]}". Aceitos: from, to, label, color.`);
  const de = typeof e.from === 'string' ? resolver(e.from) : undefined;
  const para = typeof e.to === 'string' ? resolver(e.to) : undefined;
  if (!de || !para) throw new AgentError('INVALID_INPUT', `${onde}: "from" e "to" precisam ser ${dica}.`);
  if (de === para) throw new AgentError('INVALID_INPUT', `${onde}: uma ligação não pode sair e chegar no mesmo cartão.`);
  const cor = corDoCartao(e.color, onde);
  const rotulo = e.label === undefined || e.label === null ? '' : textoDoCartao(e.label, 'label', onde);
  return { fromNode: de, toNode: para, ...(rotulo ? { label: rotulo } : {}), ...(cor ? { color: cor } : {}) };
}
// O título vira o nome do arquivo .canvas: mesmas regras de um nome de pasta.
function tituloDoFluxo(valor) {
  const titulo = noteTitle(valor);
  if (!validFolderName(titulo)) {
    throw new AgentError('INVALID_NAME', `"${titulo}" não serve como nome de arquivo. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.`);
  }
  return titulo;
}

class KiroAgentApi {
  constructor(vault, { events } = {}) {
    if (!vault || typeof vault.load !== 'function') throw new Error('KiroAgentApi precisa de um Vault.');
    this.vault = vault;
    this.events = events || new KiroEvents();

    // Fachada no formato pedido: kiro.notes.create(), kiro.folders.list()...
    this.notes = {
      create: (a, c) => this.createNote(a, c),
      read: (a, c) => this.readNote(a, c),
      update: (a, c) => this.updateNote(a, c),
      delete: (a, c) => this.deleteNote(a, c),
      list: (a, c) => this.listNotes(a, c),
      search: (a, c) => this.searchNotes(a, c),
      move: (a, c) => this.moveNote(a, c),
      recent: (a, c) => this.getRecentNotes(a, c),
      daily: (a, c) => this.getDailyNote(a, c),
    };
    this.folders = { create: (a, c) => this.createFolder(a, c), list: (a, c) => this.listFolders(a, c) };
    this.links = {
      outgoing: (a, c) => this.getOutgoingLinks(a, c),
      backlinks: (a, c) => this.getBacklinks(a, c),
      create: (a, c) => this.createNoteLink(a, c),
    };
    this.tags = {
      add: (a, c) => this.addTag(a, c),
      remove: (a, c) => this.removeTag(a, c),
      search: (a, c) => this.searchByTag(a, c),
    };
    this.metadata = { read: (a, c) => this.readMetadata(a, c), update: (a, c) => this.updateMetadata(a, c) };
    this.trash = { list: (a, c) => this.listTrash(a, c), restore: (a, c) => this.restoreNote(a, c) };
  }

  // ---------------------------------------------------------------- internos

  load() { return this.vault.load(); }

  /**
   * Ciclo ler-alterar-gravar. O Vault recusa gravação sobre revisão vencida;
   * outra janela do Kiro salvando ao mesmo tempo é motivo de nova tentativa,
   * não de erro para o agente.
   */
  async #mutate(alterar) {
    let ultimoErro;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const antes = await this.vault.load();
      const resultado = alterar(antes);
      try {
        const depois = await this.vault.save(antes);
        return { antes, depois, resultado };
      } catch (erro) {
        if (!CONFLITO.test(erro.message) || tentativa === 2) throw erro;
        ultimoErro = erro;
      }
    }
    throw ultimoErro;
  }

  #acharNota(state, { id, path: caminho }) {
    if (id !== undefined && id !== null && String(id).trim()) {
      const alvo = String(id).trim();
      const achada = state.notes.find(n => n.id === alvo);
      if (achada) return achada;
      throw new AgentError('NOTE_NOT_FOUND', `Nenhuma nota com o id "${alvo}".`);
    }
    if (caminho !== undefined && caminho !== null && String(caminho).trim()) {
      const relativo = vaultRelativePath(caminho, { campo: 'path', extensao: 'md' });
      const achada = state.notes.find(n => n.file && pathKey(n.file) === pathKey(relativo));
      if (achada) return achada;
      throw new AgentError('NOTE_NOT_FOUND', `Nenhuma nota em "${relativo}".`);
    }
    throw new AgentError('INVALID_INPUT', 'Informe "id" ou "path" da nota.');
  }

  #acharPasta(state, segmentos) {
    let paiId = '';
    for (const segmento of segmentos) {
      const achada = state.folders.find(f => (f.parentId || '') === paiId && pathKey(f.title) === pathKey(segmento));
      if (!achada) throw new AgentError('FOLDER_NOT_FOUND', `A pasta "${segmentos.join('/')}" não existe.`);
      paiId = achada.id;
    }
    return paiId;
  }

  #garantirPasta(state, segmentos) {
    const criadas = [];
    let paiId = '';
    for (const segmento of segmentos) {
      const achada = state.folders.find(f => (f.parentId || '') === paiId && pathKey(f.title) === pathKey(segmento));
      if (achada) { paiId = achada.id; continue; }
      const nova = { id: randomUUID(), title: segmento, parentId: paiId, description: '' };
      state.folders.push(nova);
      criadas.push(nova);
      paiId = nova.id;
    }
    return { folderId: paiId, criadas };
  }

  #caminhoDaPasta(state, folderId) {
    if (!folderId) return '';
    const pasta = state.folders.find(f => f.id === folderId);
    return pasta ? (pasta.path || pasta.title) : '';
  }

  async #datas(nota) {
    const createdAt = nota.createdAt ? new Date(nota.createdAt).toISOString() : null;
    if (!nota.file) return { createdAt, modifiedAt: new Date(nota.updatedAt).toISOString() };
    try {
      const info = await fs.stat(await this.vault.safePath(nota.file));
      return { createdAt: createdAt || new Date(info.birthtimeMs).toISOString(), modifiedAt: new Date(info.mtimeMs).toISOString() };
    } catch {
      return { createdAt, modifiedAt: new Date(nota.updatedAt).toISOString() };
    }
  }

  #resumo(state, nota) {
    return {
      id: nota.id,
      path: nota.file || null,
      title: nota.title,
      folder: this.#caminhoDaPasta(state, nota.folderId),
      tags: tagsDaNota(nota),
      createdAt: nota.createdAt ? new Date(nota.createdAt).toISOString() : null,
      modifiedAt: new Date(nota.updatedAt).toISOString(),
    };
  }

  // since/until em dias locais (AAAA-MM-DD): a nota entra se foi criada ou alterada no período.
  #noPeriodo(args) {
    const dia = (valor, campo, fim) => {
      if (valor === undefined || valor === null || valor === '') return fim ? Infinity : -Infinity;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor));
      if (!m) throw new AgentError('INVALID_INPUT', `${campo} deve estar no formato AAAA-MM-DD.`);
      return fim ? new Date(+m[1], m[2] - 1, +m[3], 23, 59, 59, 999).getTime() : new Date(+m[1], m[2] - 1, +m[3]).getTime();
    };
    const inicio = dia(args.since, 'since', false), fim = dia(args.until, 'until', true);
    const dentro = t => Number.isFinite(t) && t >= inicio && t <= fim;
    return nota => dentro(nota.createdAt ?? nota.updatedAt) || dentro(nota.updatedAt);
  }

  #limite(valor, padrao) {
    const n = Number.isInteger(valor) ? valor : padrao;
    return Math.max(1, Math.min(MAX_LIMITE, n));
  }

  // ------------------------------------------------------------------ notas

  async createNote(args = {}, contexto = {}) {
    const titulo = noteTitle(args.title);
    const segmentos = folderSegments(args.folder);
    const etiquetas = tagList(args.tags) || [];
    const conteudo = args.content === undefined || args.content === null ? '' : String(args.content);

    const id = randomUUID();
    const { antes, depois, resultado } = await this.#mutate(state => {
      const { folderId, criadas } = this.#garantirPasta(state, segmentos);
      const duplicada = state.notes.find(n => (n.folderId || '') === folderId && pathKey(n.title) === pathKey(titulo));
      if (duplicada) {
        throw new AgentError('NOTE_EXISTS', `Já existe a nota "${titulo}" em "${segmentos.join('/') || 'raiz do cofre'}". Use update_note para alterá-la.`, { id: duplicada.id, path: duplicada.file });
      }
      state.notes.push({ id, title: titulo, body: conteudo, links: [], tags: etiquetas, folderId, createdAt: Date.now(), updatedAt: Date.now() });
      return { criadas };
    });

    const criada = depois.notes.find(n => n.id === id);
    for (const pasta of resultado.criadas) {
      this.events.emitVaultEvent('folder.created', { id: pasta.id, path: this.#caminhoDaPasta(depois, pasta.id), source: 'agent', clientId: contexto.clientId });
    }
    this.events.emitVaultEvent('note.created', { id, path: criada?.file, source: 'agent', clientId: contexto.clientId });
    return { success: true, note: this.#resumo(depois, criada), revisionBefore: antes.revision, revision: depois.revision };
  }

  async readNote(args = {}) {
    const state = await this.load();
    const nota = this.#acharNota(state, args);
    const datas = await this.#datas(nota);
    return {
      id: nota.id,
      path: nota.file || null,
      title: nota.title,
      content: nota.body,
      metadata: {
        folder: this.#caminhoDaPasta(state, nota.folderId),
        folderId: nota.folderId || '',
        tags: tagsDaNota(nota),
        frontmatterTags: nota.tags || [],
        attachedLinks: nota.links || [],
      },
      ...datas,
    };
  }

  async updateNote(args = {}, contexto = {}) {
    const modo = args.mode || 'replace';
    if (!['replace', 'append', 'prepend'].includes(modo)) {
      throw new AgentError('INVALID_INPUT', 'mode deve ser replace, append ou prepend.');
    }
    const temConteudo = args.content !== undefined && args.content !== null;
    const novoTitulo = args.title === undefined || args.title === null ? null : noteTitle(args.title);
    const novasTags = tagList(args.tags);
    const mudaPasta = args.folder !== undefined && args.folder !== null;
    const segmentos = mudaPasta ? folderSegments(args.folder) : null;
    if (!temConteudo && !novoTitulo && !novasTags && !mudaPasta) {
      throw new AgentError('INVALID_INPUT', 'Nada para alterar: informe content, title, tags ou folder.');
    }

    const { antes, depois, resultado } = await this.#mutate(state => {
      const nota = this.#acharNota(state, args);
      const anterior = { path: nota.file, folderId: nota.folderId || '' };
      if (temConteudo) {
        const texto = String(args.content);
        if (modo === 'replace') nota.body = texto;
        else if (modo === 'append') nota.body = nota.body ? `${nota.body.replace(/\s*$/, '')}\n\n${texto}` : texto;
        else nota.body = nota.body ? `${texto}\n\n${nota.body.replace(/^\s*/, '')}` : texto;
      }
      if (novoTitulo) nota.title = novoTitulo;
      if (novasTags) nota.tags = novasTags;
      if (mudaPasta) nota.folderId = this.#garantirPasta(state, segmentos).folderId;
      nota.updatedAt = Date.now();
      return { id: nota.id, anterior };
    });

    const atual = depois.notes.find(n => n.id === resultado.id);
    if (resultado.anterior.path && atual?.file && resultado.anterior.path !== atual.file) {
      this.events.emitVaultEvent('note.moved', { id: atual.id, from: resultado.anterior.path, path: atual.file, source: 'agent', clientId: contexto.clientId });
    }
    this.events.emitVaultEvent('note.updated', { id: resultado.id, path: atual?.file, mode: modo, source: 'agent', clientId: contexto.clientId });
    return { success: true, note: this.#resumo(depois, atual), revisionBefore: antes.revision, revision: depois.revision };
  }

  async moveNote(args = {}, contexto = {}) {
    const segmentos = folderSegments(args.folder);
    const { antes, depois, resultado } = await this.#mutate(state => {
      const nota = this.#acharNota(state, args);
      const de = nota.file;
      const { folderId } = this.#garantirPasta(state, segmentos);
      const duplicada = state.notes.find(n => n.id !== nota.id && (n.folderId || '') === folderId && pathKey(n.title) === pathKey(nota.title));
      if (duplicada) throw new AgentError('NOTE_EXISTS', `Já existe a nota "${nota.title}" no destino.`, { id: duplicada.id });
      nota.folderId = folderId;
      nota.updatedAt = Date.now();
      return { id: nota.id, de };
    });
    const atual = depois.notes.find(n => n.id === resultado.id);
    this.events.emitVaultEvent('note.moved', { id: resultado.id, from: resultado.de, path: atual?.file, source: 'agent', clientId: contexto.clientId });
    return { success: true, note: this.#resumo(depois, atual), movedFrom: resultado.de, revisionBefore: antes.revision, revision: depois.revision };
  }

  /** Exclusão sempre reversível: o Vault arquiva a nota em .trash na mesma gravação. */
  async deleteNote(args = {}, contexto = {}) {
    const { antes, depois, resultado } = await this.#mutate(state => {
      const nota = this.#acharNota(state, args);
      state.notes = state.notes.filter(n => n.id !== nota.id);
      return { id: nota.id, title: nota.title, path: nota.file };
    });
    const naLixeira = (await this.vault.trash()).find(item => item.id === resultado.id);
    this.events.emitVaultEvent('note.deleted', { id: resultado.id, path: resultado.path, source: 'agent', clientId: contexto.clientId });
    return {
      success: true,
      deleted: { id: resultado.id, title: resultado.title, path: resultado.path || null },
      recoverable: Boolean(naLixeira),
      trashEntryId: naLixeira?.entryId || null,
      revisionBefore: antes.revision,
      revision: depois.revision,
    };
  }

  async listTrash() {
    const itens = await this.vault.trash();
    return {
      items: itens.map(i => ({
        entryId: i.entryId,
        id: i.id,
        title: i.title,
        kind: i.kind,
        deletedAt: new Date(i.deletedAt).toISOString(),
        noteCount: i.noteCount,
        folderCount: i.folderCount,
      })),
    };
  }

  async restoreNote(args = {}, contexto = {}) {
    if (typeof args.entryId !== 'string' || !args.entryId.trim()) {
      throw new AgentError('INVALID_INPUT', 'Informe o entryId devolvido por delete_note ou list_trash.');
    }
    const state = await this.load();
    const depois = await this.vault.restore({ entryId: args.entryId.trim(), revision: state.revision });
    this.events.emitVaultEvent('note.restored', { entryId: args.entryId, source: 'agent', clientId: contexto.clientId });
    return { success: true, revisionBefore: state.revision, revision: depois.revision };
  }

  async listNotes(args = {}) {
    const state = await this.load();
    const limite = this.#limite(args.limit, 50);
    const deslocamento = Math.max(0, Number.isInteger(args.offset) ? args.offset : 0);
    let notas = state.notes.filter(this.#noPeriodo(args));
    if (args.folder !== undefined && args.folder !== null && String(args.folder).trim()) {
      const folderId = this.#acharPasta(state, folderSegments(args.folder));
      notas = notas.filter(n => (n.folderId || '') === folderId);
    }
    const ordenadas = [...notas].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      total: ordenadas.length,
      notes: ordenadas.slice(deslocamento, deslocamento + limite).map(n => this.#resumo(state, n)),
    };
  }

  async getRecentNotes(args = {}) {
    return this.listNotes({ limit: this.#limite(args.limit, 10) });
  }

  /** Hábitos com o progresso já calculado, para o agente não interpretar o histórico cru. Só leitura. */
  async getHabits(args = {}) {
    const hoje = args.date ? String(args.date) : localDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new AgentError('INVALID_INPUT', 'date deve estar no formato AAAA-MM-DD.');
    const state = await this.load();
    return {
      date: hoje,
      habits: (state.habits || []).map(h => {
        const s = habitStats(h, state.habitLog?.[h.id] || [], hoje);
        return {
          id: h.id, title: h.title, frequency: h.frequency, createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
          dueToday: s.dueToday, doneToday: s.doneToday, streak: s.streak, rate30: s.rate30, totalDone: s.totalDone,
          ...(s.weekCount !== undefined ? { weekCount: s.weekCount } : {}), last7: s.week,
        };
      }),
    };
  }

  /** A nota diária do Kiro é a nota cujo título é a data local. Só leitura. */
  async getDailyNote(args = {}) {
    const state = await this.load();
    const data = args.date ? String(args.date) : localDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new AgentError('INVALID_INPUT', 'date deve estar no formato AAAA-MM-DD.');
    const nota = state.notes.find(n => n.title === data);
    if (!nota) return { date: data, exists: false, note: null };
    return { date: data, exists: true, note: { ...this.#resumo(state, nota), content: nota.body } };
  }

  // ------------------------------------------------------------------ busca

  /**
   * Busca textual local sobre título, caminho, tags e corpo.
   * Sem embeddings: a pontuação fica isolada aqui para que uma busca semântica
   * possa ser somada depois sem mudar a assinatura da ferramenta.
   */
  async searchNotes(args = {}) {
    const consulta = typeof args.query === 'string' ? args.query.trim() : '';
    if (!consulta) throw new AgentError('INVALID_INPUT', 'Informe "query".');
    const state = await this.load();
    const limite = this.#limite(args.limit, 20);
    const alvo = normalize(consulta);

    const achados = [];
    for (const nota of state.notes.filter(this.#noPeriodo(args))) {
      const titulo = normalize(nota.title);
      const caminho = normalize(nota.file || '');
      const etiquetas = tagsDaNota(nota).map(normalize);
      const corpo = normalize(nota.body);
      let pontos = 0;
      if (titulo === alvo) pontos += 100;
      else if (titulo.includes(alvo)) pontos += 60;
      if (etiquetas.some(t => t === alvo)) pontos += 40;
      else if (etiquetas.some(t => t.includes(alvo))) pontos += 20;
      if (caminho.includes(alvo)) pontos += 15;
      if (corpo.includes(alvo)) pontos += 10;
      if (!pontos) continue;
      achados.push({ nota, pontos, noCorpo: corpo.includes(alvo) });
    }

    achados.sort((a, b) => b.pontos - a.pontos || b.nota.updatedAt - a.nota.updatedAt);
    return {
      query: consulta,
      total: achados.length,
      results: achados.slice(0, limite).map(({ nota, noCorpo }) => ({
        ...this.#resumo(state, nota),
        snippet: noCorpo ? recortar(nota.body, consulta) : nota.body.slice(0, 160).replace(/\s+/g, ' ').trim(),
      })),
    };
  }

  // ----------------------------------------------------------------- pastas

  async createFolder(args = {}, contexto = {}) {
    const segmentos = folderSegments(args.path, { campo: 'path' });
    if (!segmentos.length) throw new AgentError('INVALID_INPUT', 'Informe o caminho da pasta.');
    const { antes, depois, resultado } = await this.#mutate(state => this.#garantirPasta(state, segmentos));
    const folderId = this.#acharPasta(depois, segmentos);
    for (const pasta of resultado.criadas) {
      this.events.emitVaultEvent('folder.created', { id: pasta.id, path: this.#caminhoDaPasta(depois, pasta.id), source: 'agent', clientId: contexto.clientId });
    }
    return {
      success: true,
      folder: { id: folderId, path: this.#caminhoDaPasta(depois, folderId) },
      created: resultado.criadas.map(f => this.#caminhoDaPasta(depois, f.id)),
      alreadyExisted: resultado.criadas.length === 0,
      revisionBefore: antes.revision,
      revision: depois.revision,
    };
  }

  async listFolders() {
    const state = await this.load();
    const contar = id => state.notes.filter(n => (n.folderId || '') === id).length;
    return {
      folders: [...state.folders]
        .sort((a, b) => (a.path || a.title).localeCompare(b.path || b.title, 'pt-BR'))
        .map(f => ({ id: f.id, path: f.path || f.title, name: f.title, parentId: f.parentId || '', noteCount: contar(f.id), description: f.description || '' })),
    };
  }

  // ------------------------------------------------------------------ links

  async getOutgoingLinks(args = {}) {
    const state = await this.load();
    const nota = this.#acharNota(state, args);
    const vistos = new Set();
    const saidas = [];
    for (const link of wikiLinks(nota.body)) {
      const chave = pathKey(link.target);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const alvo = findLinkedNote(state.notes, link.target);
      saidas.push({ target: link.target, label: link.label, resolved: Boolean(alvo), note: alvo ? this.#resumo(state, alvo) : null });
    }
    return { note: this.#resumo(state, nota), links: saidas, attachedLinks: nota.links || [] };
  }

  /** Backlinks são derivados na leitura, como na interface. Não há índice a manter. */
  async getBacklinks(args = {}) {
    const state = await this.load();
    const nota = this.#acharNota(state, args);
    const apontam = state.notes.filter(outra => outra.id !== nota.id
      && wikiLinks(outra.body).some(link => findLinkedNote(state.notes, link.target)?.id === nota.id));
    return { note: this.#resumo(state, nota), total: apontam.length, backlinks: apontam.map(n => this.#resumo(state, n)) };
  }

  async createNoteLink(args = {}, contexto = {}) {
    const rotulo = args.label === undefined || args.label === null ? null : String(args.label).trim();
    const state = await this.load();
    const origem = this.#acharNota(state, { id: args.fromId, path: args.fromPath });
    let titulo, alvo = null, rotuloFinal = rotulo;
    if (args.toId || args.toPath) {
      alvo = this.#acharNota(state, { id: args.toId, path: args.toPath });
      titulo = alvo.title;
      // Outra nota com o mesmo título ganharia o [[Título]]: o link vai pelo caminho do
      // arquivo (que o Kiro também resolve) e o título fica como rótulo visível.
      if (findLinkedNote(state.notes, titulo)?.id !== alvo.id && alvo.file) {
        titulo = alvo.file.replace(/\.md$/i, '');
        rotuloFinal = rotulo || alvo.title;
      }
    } else if (typeof args.toTitle === 'string' && args.toTitle.trim()) titulo = args.toTitle.trim();
    else throw new AgentError('INVALID_INPUT', 'Informe o destino por toId, toPath ou toTitle.');
    if (titulo.includes(']]') || titulo.includes('[[')) throw new AgentError('INVALID_INPUT', 'O destino do link não pode conter colchetes.');

    const marcacao = rotuloFinal ? `[[${titulo}|${rotuloFinal}]]` : `[[${titulo}]]`;
    // Com a nota de destino conhecida, "já ligada" é apontar para ela, escrito de qualquer jeito.
    const jaLigada = alvo
      ? wikiLinks(origem.body).some(l => findLinkedNote(state.notes, l.target)?.id === alvo.id)
      : wikiLinks(origem.body).some(l => pathKey(l.target) === pathKey(titulo));
    if (jaLigada) {
      return { success: true, alreadyLinked: true, markup: marcacao, note: this.#resumo(state, origem) };
    }
    const resultado = await this.updateNote({ id: origem.id, content: marcacao, mode: 'append' }, contexto);
    return { success: true, alreadyLinked: false, markup: marcacao, note: resultado.note, revision: resultado.revision };
  }

  // ------------------------------------------------------------------- tags

  async addTag(args = {}, contexto = {}) {
    const etiquetas = tagList(args.tags, { campo: 'tags' });
    if (!etiquetas || !etiquetas.length) throw new AgentError('INVALID_INPUT', 'Informe ao menos uma tag.');
    const state = await this.load();
    const nota = this.#acharNota(state, args);
    const atuais = nota.tags || [];
    const novas = [...new Set([...atuais, ...etiquetas])];
    if (novas.length === atuais.length) return { success: true, changed: false, tags: tagsDaNota(nota) };
    return this.updateNote({ id: nota.id, tags: novas }, contexto);
  }

  async removeTag(args = {}, contexto = {}) {
    const etiquetas = tagList(args.tags, { campo: 'tags' });
    if (!etiquetas || !etiquetas.length) throw new AgentError('INVALID_INPUT', 'Informe ao menos uma tag.');
    const state = await this.load();
    const nota = this.#acharNota(state, args);
    const remover = new Set(etiquetas.map(pathKey));
    const restantes = (nota.tags || []).filter(t => !remover.has(pathKey(t)));
    const resultado = restantes.length === (nota.tags || []).length
      ? { success: true, changed: false, note: this.#resumo(state, nota) }
      : await this.updateNote({ id: nota.id, tags: restantes }, contexto);
    // Uma tag escrita como #tag no meio do texto continua valendo; avisamos em vez de editar o corpo.
    const aindaNoCorpo = etiquetas.filter(t => tagsDaNota({ ...nota, tags: restantes }).some(x => pathKey(x) === pathKey(t)));
    return { ...resultado, stillInBody: aindaNoCorpo };
  }

  async searchByTag(args = {}) {
    const etiquetas = tagList(args.tags, { campo: 'tags' });
    if (!etiquetas || !etiquetas.length) throw new AgentError('INVALID_INPUT', 'Informe ao menos uma tag.');
    const state = await this.load();
    const alvo = etiquetas.map(pathKey);
    const limite = this.#limite(args.limit, 50);
    const achadas = state.notes.filter(n => {
      const daNota = tagsDaNota(n).map(pathKey);
      return args.matchAll ? alvo.every(t => daNota.includes(t)) : alvo.some(t => daNota.includes(t));
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    return { tags: etiquetas, total: achadas.length, notes: achadas.slice(0, limite).map(n => this.#resumo(state, n)) };
  }

  // -------------------------------------------------------------- metadados

  async readMetadata(args = {}) {
    const { metadata, id, path: caminho, title } = await this.readNote(args);
    return { id, path: caminho, title, metadata };
  }

  async updateMetadata(args = {}, contexto = {}) {
    const campos = {};
    if (args.title !== undefined && args.title !== null) campos.title = args.title;
    if (args.tags !== undefined && args.tags !== null) campos.tags = args.tags;
    if (args.folder !== undefined && args.folder !== null) campos.folder = args.folder;
    if (!Object.keys(campos).length) throw new AgentError('INVALID_INPUT', 'Informe title, tags ou folder.');
    return this.updateNote({ id: args.id, path: args.path, ...campos }, contexto);
  }

  // ----------------------------------------------------------------- fluxos

  #acharFluxo(state, { id, path: caminho }) {
    const fluxos = state.fluxos || [];
    if (id !== undefined && id !== null && String(id).trim()) {
      const alvo = String(id).trim();
      const achado = fluxos.find(f => f.id === alvo);
      if (achado) return achado;
      throw new AgentError('FLUXO_NOT_FOUND', `Nenhum fluxo com o id "${alvo}". Use list_fluxos.`);
    }
    if (caminho !== undefined && caminho !== null && String(caminho).trim()) {
      const relativo = vaultRelativePath(caminho, { campo: 'path', extensao: 'canvas' });
      const achado = fluxos.find(f => f.file && pathKey(f.file) === pathKey(relativo));
      if (achado) return achado;
      throw new AgentError('FLUXO_NOT_FOUND', `Nenhum fluxo em "${relativo}". Use list_fluxos.`);
    }
    throw new AgentError('INVALID_INPUT', 'Informe "id" ou "path" do fluxo.');
  }

  // Fluxo cujo .canvas não abriu: a IA não lê nem grava, para não piorar o arquivo.
  #fluxoLegivel(state, alvo) {
    const fluxo = this.#acharFluxo(state, alvo);
    if (fluxo.erro) {
      throw new AgentError('FLUXO_INVALID', `O arquivo "${fluxo.file}" não é um JSON Canvas válido (${fluxo.erro}). Ele precisa ser corrigido no Kiro ou no Obsidian antes.`);
    }
    return fluxo;
  }

  #resumoFluxo(state, f) {
    return {
      id: f.id,
      path: f.file || null,
      title: f.title,
      folder: this.#caminhoDaPasta(state, f.folderId),
      cards: f.canvas ? f.canvas.nodes.length : null,
      links: f.canvas ? f.canvas.edges.length : null,
      ...(f.erro ? { error: f.erro } : {}),
    };
  }

  async listFluxos() {
    const state = await this.load();
    const fluxos = [...(state.fluxos || [])].sort((a, b) => (a.file || a.title).localeCompare(b.file || b.title, 'pt-BR'));
    return { fluxos: fluxos.map(f => this.#resumoFluxo(state, f)) };
  }

  async readFluxo(args = {}) {
    const state = await this.load();
    const fluxo = this.#fluxoLegivel(state, args);
    return {
      ...this.#resumoFluxo(state, fluxo),
      nodes: fluxo.canvas.nodes.map(n => cartaoParaIA(n, args.positions === true)),
      edges: fluxo.canvas.edges.map(setaParaIA),
    };
  }

  // Nota por caminho ("Estudos/Python.md") ou por título ("Python"), como um [[link]].
  #notaPorReferencia(state, ref) {
    const alvo = String(ref).trim().replace(/\.md$/i, '');
    return alvo ? findLinkedNote(state.notes, alvo) : undefined;
  }

  // Cartão pedido pela IA → cartão do canvas, sem id; x/y só se vierem. Nota que não existe
  // entra em `faltando`: a chamada inteira é recusada depois, com a lista toda.
  #cartaoDaIA(state, e, onde, faltando) {
    objeto(e, onde);
    const extras = Object.keys(e).filter(k => !CAMPOS_DO_CARTAO.includes(k));
    if (extras.length) throw new AgentError('INVALID_INPUT', `${onde}: campo desconhecido "${extras[0]}".`);
    let cartao;
    if (e.type === 'text') cartao = { type: 'text', text: textoDoCartao(e.text ?? '', 'text', onde) };
    else if (e.type === 'note') {
      const ref = textoDoCartao(e.note, 'note', onde);
      const nota = this.#notaPorReferencia(state, ref);
      if (!nota) faltando.push(ref);
      cartao = { type: 'file', file: nota?.file || ref };
    } else if (e.type === 'link') {
      const url = safeUrl(textoDoCartao(e.url, 'url', onde));
      if (!url) throw new AgentError('INVALID_INPUT', `${onde}: "url" precisa começar com http:// ou https://.`);
      cartao = { type: 'link', url };
    } else if (e.type === 'group') {
      cartao = { type: 'group', ...(e.label !== undefined && e.label !== null ? { label: textoDoCartao(e.label, 'label', onde) } : {}) };
    } else throw new AgentError('INVALID_INPUT', `${onde}: "type" deve ser text, note, link ou group.`);
    const cor = corDoCartao(e.color, onde);
    return { ...cartao, ...(cor ? { color: cor } : {}), ...KiroFluxo.tamanhoPadrao(cartao), ...geometria(e, onde) };
  }

  async createFluxo(args = {}, contexto = {}) {
    const titulo = tituloDoFluxo(args.title);
    const temPasta = args.folder !== undefined && args.folder !== null;
    const segmentos = temPasta ? folderSegments(args.folder) : [];
    if (!Array.isArray(args.nodes) || !args.nodes.length) throw new AgentError('INVALID_INPUT', 'Informe ao menos um cartão em "nodes".');

    const id = randomUUID();
    const { antes, depois, resultado } = await this.#mutate(state => {
      const faltando = [], vistos = new Set();
      const pedidos = args.nodes.map((e, i) => ({ apelido: apelido(e, `nodes[${i}]`, vistos), cartao: this.#cartaoDaIA(state, e, `nodes[${i}]`, faltando) }));
      const temOrigem = args.sourceNote !== undefined && args.sourceNote !== null;
      const origem = temOrigem ? this.#notaPorReferencia(state, textoDoCartao(args.sourceNote, 'sourceNote', 'sourceNote')) : null;
      if (temOrigem && !origem) faltando.push(args.sourceNote);
      if (faltando.length) {
        throw new AgentError('NOTE_NOT_FOUND', `Notas não encontradas: ${faltando.join(', ')}. Confira os caminhos com search_notes ou list_notes.`, { missing: faltando });
      }
      const temRaiz = args.root !== undefined && args.root !== null;
      if (temRaiz && !vistos.has(args.root)) throw new AgentError('INVALID_INPUT', '"root" deve ser o id de um dos cartões de "nodes".');

      // Sem pasta, o fluxo vai para a pasta da nota de origem.
      const { folderId, criadas } = temPasta || !origem ? this.#garantirPasta(state, segmentos) : { folderId: origem.folderId || '', criadas: [] };
      state.fluxos = state.fluxos || [];
      if (state.fluxos.some(f => (f.folderId || '') === folderId && pathKey(f.title) === pathKey(titulo))) {
        throw new AgentError('FLUXO_EXISTS', `Já existe o fluxo "${titulo}" nesta pasta. Use update_fluxo para alterá-lo ou escolha outro título.`);
      }

      const ocupados = new Set(), real = new Map();
      const reservar = () => { const novo = KiroFluxo.novoId(ocupados); ocupados.add(novo); return novo; };
      const nodes = pedidos.map(({ apelido: a, cartao }) => { const idReal = reservar(); real.set(a, idReal); return { id: idReal, ...cartao }; });
      const edges = (args.edges || []).map((e, i) => ({ id: reservar(), ...setaDaIA(e, `edges[${i}]`, ref => real.get(ref), 'ids de cartões de "nodes"') }));
      let raiz = temRaiz ? real.get(args.root) : undefined;
      if (origem) {
        const cartao = { id: reservar(), type: 'file', file: origem.file, ...KiroFluxo.tamanhoPadrao({ type: 'file', file: origem.file }) };
        edges.push({ id: reservar(), fromNode: cartao.id, toNode: raiz || KiroFluxo.raizDe(nodes, edges) });
        nodes.unshift(cartao);
        raiz = cartao.id;
      }
      // Quem veio sem x/y é posicionado pelo layout; quem veio com posição fica onde a IA pôs.
      if (nodes.some(n => n.x === undefined || n.y === undefined)) {
        const posicoes = KiroFluxo.layout(nodes, edges, { raiz });
        for (const n of nodes) if (n.x === undefined || n.y === undefined) Object.assign(n, posicoes.get(n.id));
      }
      const canvas = { nodes, edges };
      const lido = KiroFluxo.ler(KiroFluxo.serializar(canvas));
      if (lido.erro) throw new AgentError('INVALID_INPUT', lido.erro);
      state.fluxos.push({ id, title: titulo, folderId, canvas });
      return { criadas, ids: Object.fromEntries(real) };
    });

    const criado = (depois.fluxos || []).find(f => f.id === id);
    for (const pasta of resultado.criadas) {
      this.events.emitVaultEvent('folder.created', { id: pasta.id, path: this.#caminhoDaPasta(depois, pasta.id), source: 'agent', clientId: contexto.clientId });
    }
    this.events.emitVaultEvent('fluxo.created', { id, path: criado?.file, source: 'agent', clientId: contexto.clientId });
    return { success: true, fluxo: this.#resumoFluxo(depois, criado), ids: resultado.ids, revisionBefore: antes.revision, revision: depois.revision };
  }

  async describeVault() {
    const state = await this.load();
    return {
      path: state.vaultPath,
      revision: state.revision,
      noteCount: state.notes.length,
      folderCount: state.folders.length,
      formatVersion: state.formatVersion,
    };
  }
}

module.exports = { KiroAgentApi, AgentError };
