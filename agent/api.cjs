'use strict';
/**
 * Kuroi Agent API — a única camada autorizada a mexer no cofre em nome de terceiros.
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
const { AgentError, vaultRelativePath, folderSegments, noteTitle, tagList } = require('./security.cjs');
const { KuroiEvents } = require('./events.cjs');

const { pathKey, normalize, wikiLinks, findLinkedNote, localDate, tags: tagsDaNota } = domain;

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

class KuroiAgentApi {
  constructor(vault, { events } = {}) {
    if (!vault || typeof vault.load !== 'function') throw new Error('KuroiAgentApi precisa de um Vault.');
    this.vault = vault;
    this.events = events || new KuroiEvents();

    // Fachada no formato pedido: kuroi.notes.create(), kuroi.folders.list()...
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
   * outra janela do Kuroi salvando ao mesmo tempo é motivo de nova tentativa,
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
    if (!nota.file) return { createdAt: null, modifiedAt: new Date(nota.updatedAt).toISOString() };
    try {
      const info = await fs.stat(await this.vault.safePath(nota.file));
      return { createdAt: new Date(info.birthtimeMs).toISOString(), modifiedAt: new Date(info.mtimeMs).toISOString() };
    } catch {
      return { createdAt: null, modifiedAt: new Date(nota.updatedAt).toISOString() };
    }
  }

  #resumo(state, nota) {
    return {
      id: nota.id,
      path: nota.file || null,
      title: nota.title,
      folder: this.#caminhoDaPasta(state, nota.folderId),
      tags: tagsDaNota(nota),
      modifiedAt: new Date(nota.updatedAt).toISOString(),
    };
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
      state.notes.push({ id, title: titulo, body: conteudo, links: [], tags: etiquetas, folderId, updatedAt: Date.now() });
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
    let notas = state.notes;
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

  /** A nota diária do Kuroi é a nota cujo título é a data local. Só leitura. */
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
    for (const nota of state.notes) {
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
    let titulo;
    if (args.toId || args.toPath) titulo = this.#acharNota(state, { id: args.toId, path: args.toPath }).title;
    else if (typeof args.toTitle === 'string' && args.toTitle.trim()) titulo = args.toTitle.trim();
    else throw new AgentError('INVALID_INPUT', 'Informe o destino por toId, toPath ou toTitle.');
    if (titulo.includes(']]') || titulo.includes('[[')) throw new AgentError('INVALID_INPUT', 'O destino do link não pode conter colchetes.');

    const marcacao = rotulo ? `[[${titulo}|${rotulo}]]` : `[[${titulo}]]`;
    if (wikiLinks(origem.body).some(l => pathKey(l.target) === pathKey(titulo))) {
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

module.exports = { KuroiAgentApi, AgentError };
