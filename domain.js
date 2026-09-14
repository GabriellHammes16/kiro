(function (root) {
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const text = value => typeof value === 'string';
  const id = value => text(value) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const date = value => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function validateState(value) {
    const fail = () => { throw new Error('Dados inválidos. O cofre não foi alterado.'); };
    if (!value || typeof value !== 'object') fail();
    for (const key of ['notes', 'tasks', 'routine', value.folders ? 'folders' : 'studies']) {
      if (!Array.isArray(value[key])) fail();
      const ids = new Set();
      for (const item of value[key]) {
        if (!item || !id(item.id) || ids.has(item.id) || !text(item.title)) fail();
        ids.add(item.id);
      }
    }
    for (const n of value.notes) {
      if (!text(n.body) || !Array.isArray(n.links) || !n.links.every(text) || !Number.isFinite(n.updatedAt) || Math.abs(n.updatedAt) > 8.64e15) fail();
      if (n.createdAt !== undefined && (!Number.isFinite(n.createdAt) || Math.abs(n.createdAt) > 8.64e15)) fail();
      if (n.tags !== undefined && (!Array.isArray(n.tags) || !n.tags.every(text))) fail();
      if (n.file !== undefined && (!text(n.file) || /(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))/.test(n.file) || !/\.md$/i.test(n.file))) fail();
      if (n.folderId && !id(n.folderId)) fail();
    }
    for (const t of value.tasks) if (!date(t.due) || !['Baixa', 'Média', 'Alta'].includes(t.priority) || typeof t.done !== 'boolean' || (t.noteId && !id(t.noteId))) fail();
    for (const r of value.routine) if (!date(r.date) || typeof r.done !== 'boolean') fail();
    for (const s of value.studies || []) if (s.description !== undefined && !text(s.description)) fail();
    if (value.folders) {
      folderPaths(value.folders);
      for (const n of value.notes) if (n.folderId && !value.folders.some(f => f.id === n.folderId)) fail();
    }
    return value;
  }
  function validFolderName(name) {
    return text(name) && name.length > 0 && name.length <= 120 && name === name.trim() && !name.startsWith('.') && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  }
  const pathKey = value => value.normalize('NFC').toLowerCase();
  function folderPaths(folders) {
    const byId = new Map(folders.map(f => [f.id, f])), paths = new Map(), active = new Set(), siblings = new Set();
    if (byId.size !== folders.length) throw new Error('Identificadores de pasta duplicados.');
    for (const f of folders) {
      if (!id(f.id) || !validFolderName(f.title)) throw new Error('Nome de pasta inválido. Evite caracteres especiais, nomes reservados e espaços no início ou no final.');
      const key = `${f.parentId || ''}/${pathKey(f.title)}`;
      if (siblings.has(key)) throw new Error('Já existe uma pasta com esse nome neste local.');
      siblings.add(key);
    }
    function visit(folder) {
      if (paths.has(folder.id)) return paths.get(folder.id);
      if (active.has(folder.id)) throw new Error('Uma pasta não pode ficar dentro dela mesma ou de suas descendentes.');
      active.add(folder.id);
      const parent = folder.parentId ? byId.get(folder.parentId) : null;
      if (folder.parentId && !parent) throw new Error('A pasta de destino não existe.');
      const result = parent ? `${visit(parent)}/${folder.title}` : folder.title;
      active.delete(folder.id); paths.set(folder.id, result); return result;
    }
    for (const f of folders) visit(f);
    return paths;
  }
  function descendants(folders, id) {
    const found = new Set([id]);
    let changed = true;
    while (changed) { changed = false; for (const f of folders) if (found.has(f.parentId) && !found.has(f.id)) { found.add(f.id); changed = true; } }
    return found;
  }
  function upgradeBackup(input) {
    const data = structuredClone(validateState(input));
    if (!data.folders) {
      data.folders = (data.studies || []).map(s => ({ id: s.id, title: s.title, parentId: '', description: s.description || '' }));
      // Legacy study names were unrestricted. Make only incompatible names portable.
      const used = new Set();
      for (const folder of data.folders) {
        let name = folder.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().replace(/^\.+|[. ]+$/g, '') || 'Pasta';
        if (!validFolderName(name)) name = `Pasta ${name}`.slice(0, 110);
        const base = name; let i = 2;
        while (used.has(pathKey(name))) name = `${base} (${i++})`;
        used.add(pathKey(name)); folder.title = name;
      }
      data.notes = data.notes.map(n => ({ ...n, folderId: data.folders.some(f => f.id === n.folderId) ? n.folderId : '' }));
    }
    delete data.studies; data.formatVersion = 3;
    return validateState(data);
  }
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isImagePath = value => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(value.trim());
  // ![[imagem.png]] embute uma imagem; não é ligação entre notas, então fica fora do grafo e dos backlinks.
  const wikiLinks = body => [...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)].filter(match => !(match[1] && isImagePath(match[2].split('|')[0]))).map(match => ({ target: match[2].split('|')[0].split('#')[0].trim(), label: (match[2].split('|')[1] || match[2]).trim() }));
  const tags = note => [...new Set([...(note.tags || []), ...[...note.body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1])])];
  const findLinkedNote = (notes, target) => notes.find(n => normalize(n.title) === normalize(target) || normalize((n.file || '').replace(/\.md$/i, '')) === normalize(target) || normalize((n.file || '').split('/').pop().replace(/\.md$/i, '')) === normalize(target));
  // Notas que citam `note` com [[...]]; a própria nota não conta.
  const mentions = (notes, note) => notes.filter(n => n.id !== note.id && wikiLinks(n.body).some(l => findLinkedNote(notes, l.target)?.id === note.id));
  const inInbox = note => tags(note).includes('inbox');
  // Arquivar tira só a etiqueta: o token #inbox some com o espaço que o separava, o resto do texto fica igual.
  const withoutInbox = note => ({ ...note, tags: (note.tags || []).filter(t => t !== 'inbox'), body: note.body.replace(/^#inbox(?![\p{L}\p{N}_/-])[ \t]*|[ \t]+#inbox(?![\p{L}\p{N}_/-])/gmu, '') });
  // Para revisar: "soltas" não se ligam a nada e ninguém as cita; "esquecidas" estão paradas há mais de 30 dias.
  // ponytail: menções recebidas varrem todas as notas (O(n²) no pior caso); indexar alvos se o cofre ficar grande.
  const toReview = (notes, now = Date.now(), limit = 5) => {
    const cited = new Set(notes.flatMap(n => wikiLinks(n.body).map(l => findLinkedNote(notes, l.target)?.id).filter(id => id && id !== n.id)));
    // Diárias e capturas pendentes já têm lugar próprio no Hoje: ficam fora das duas listas.
    const revisavel = n => !inInbox(n) && !/^\d{4}-\d{2}-\d{2}$/.test(n.title);
    const loose = notes.filter(n => revisavel(n) && !n.folderId && !wikiLinks(n.body).length && !cited.has(n.id)).slice(0, limit);
    const forgotten = notes.filter(n => revisavel(n) && now - n.updatedAt > 30 * 864e5).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, limit);
    return { loose, forgotten };
  };
  // Texto digitado depois de um [[ ainda aberto na linha do cursor; null fora de um link e em ![[ (imagem).
  const linkQuery = before => before.match(/(?<!!)\[\[([^\[\]\n]*)$/)?.[1] ?? null;
  // Títulos que começam com o texto vêm antes dos que só o contêm.
  const linkSuggestions = (notes, query, limit = 8) => {
    const q = normalize(query.trim());
    const titulos = [...new Set(notes.map(n => n.title).filter(Boolean))];
    const comeca = titulos.filter(t => normalize(t).startsWith(q));
    return [...comeca, ...titulos.filter(t => !comeca.includes(t) && normalize(t).includes(q))].slice(0, limit);
  };
  // Cores de pasta são nomes de uma paleta fixa: nada de CSS livre vindo do arquivo do cofre.
  const FOLDER_COLORS = ['azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'rosa', 'roxo', 'cinza'];
  const folderColor = value => FOLDER_COLORS.includes(value) ? value : '';
  const api = { FOLDER_COLORS, folderColor, localDate, safeUrl, validateState, normalize, isImagePath, wikiLinks, tags, findLinkedNote, mentions, inInbox, withoutInbox, toReview, linkQuery, linkSuggestions, validFolderName, folderPaths, descendants, upgradeBackup, pathKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Kuroi = api;
})(globalThis);
