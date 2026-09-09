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
  const wikiLinks = body => [...body.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => ({ target: match[1].split('|')[0].split('#')[0].trim(), label: (match[1].split('|')[1] || match[1]).trim() }));
  const tags = note => [...new Set([...(note.tags || []), ...[...note.body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1])])];
  const findLinkedNote = (notes, target) => notes.find(n => normalize(n.title) === normalize(target) || normalize((n.file || '').replace(/\.md$/i, '')) === normalize(target) || normalize((n.file || '').split('/').pop().replace(/\.md$/i, '')) === normalize(target));
  const api = { localDate, safeUrl, validateState, normalize, wikiLinks, tags, findLinkedNote, validFolderName, folderPaths, descendants, upgradeBackup, pathKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Kuroi = api;
})(globalThis);
