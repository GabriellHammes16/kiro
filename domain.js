(function (root) {
  // Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
  const frase = f => f;
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const text = value => typeof value === 'string';
  const id = value => text(value) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const date = value => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function validateState(value) {
    const fail = () => { throw new Error(frase('Dados inválidos. O cofre não foi alterado.')); };
    if (!value || typeof value !== 'object') fail();
    for (const key of ['notes', 'tasks', value.folders ? 'folders' : 'studies', ...(value.routine !== undefined ? ['routine'] : []), ...(value.habits !== undefined ? ['habits'] : [])]) {
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
    for (const r of value.routine || []) if (!date(r.date) || typeof r.done !== 'boolean') fail();
    for (const h of value.habits || []) {
      if (!validFrequency(h.frequency) || (h.createdAt !== undefined && (!Number.isFinite(h.createdAt) || Math.abs(h.createdAt) > 8.64e15))) fail();
    }
    if (value.habitLog !== undefined) {
      if (!value.habitLog || typeof value.habitLog !== 'object' || Array.isArray(value.habitLog)) fail();
      for (const [chave, dias] of Object.entries(value.habitLog)) if (!id(chave) || !Array.isArray(dias) || !dias.every(date)) fail();
    }
    for (const s of value.studies || []) if (s.description !== undefined && !text(s.description)) fail();
    if (value.folders) {
      folderPaths(value.folders);
      for (const n of value.notes) if (n.folderId && !value.folders.some(f => f.id === n.folderId)) fail();
    }
    if (value.fluxos !== undefined) {
      if (!Array.isArray(value.fluxos)) fail();
      // Abas guardam ids de nota e de fluxo misturados: um id não pode servir aos dois.
      const usados = new Set(value.notes.map(n => n.id));
      for (const f of value.fluxos) {
        if (!f || !id(f.id) || usados.has(f.id) || !text(f.title) || !f.title) fail();
        usados.add(f.id);
        if (f.erro !== undefined ? !text(f.erro) : !(f.canvas && typeof f.canvas === 'object' && Array.isArray(f.canvas.nodes) && Array.isArray(f.canvas.edges))) fail();
        if (f.file !== undefined && (!text(f.file) || /(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))/.test(f.file) || !/\.canvas$/i.test(f.file))) fail();
        if (f.folderId && (!id(f.folderId) || (value.folders && !value.folders.some(x => x.id === f.folderId)))) fail();
      }
    }
    return value;
  }
  function validFolderName(name) {
    return text(name) && name.length > 0 && name.length <= 120 && name === name.trim() && !name.startsWith('.') && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  }
  const pathKey = value => value.normalize('NFC').toLowerCase();
  function folderPaths(folders) {
    const byId = new Map(folders.map(f => [f.id, f])), paths = new Map(), active = new Set(), siblings = new Set();
    if (byId.size !== folders.length) throw new Error(frase('Identificadores de pasta duplicados.'));
    for (const f of folders) {
      if (!id(f.id) || !validFolderName(f.title)) throw new Error(frase('Nome de pasta inválido. Evite caracteres especiais, nomes reservados e espaços no início ou no final.'));
      const key = `${f.parentId || ''}/${pathKey(f.title)}`;
      if (siblings.has(key)) throw new Error(frase('Já existe uma pasta com esse nome neste local.'));
      siblings.add(key);
    }
    function visit(folder) {
      if (paths.has(folder.id)) return paths.get(folder.id);
      if (active.has(folder.id)) throw new Error(frase('Uma pasta não pode ficar dentro dela mesma ou de suas descendentes.'));
      active.add(folder.id);
      const parent = folder.parentId ? byId.get(folder.parentId) : null;
      if (folder.parentId && !parent) throw new Error(frase('A pasta de destino não existe.'));
      const result = parent ? `${visit(parent)}/${folder.title}` : folder.title;
      active.delete(folder.id); paths.set(folder.id, result); return result;
    }
    for (const f of folders) visit(f);
    return paths;
  }
  // ---- Hábitos: frequência, histórico por dia (AAAA-MM-DD local) e estatísticas ----
  // Frequência: todo dia, em dias da semana (0 = domingo) ou X vezes por semana (semana de segunda a domingo).
  function validFrequency(f) {
    if (!f || typeof f !== 'object') return false;
    if (f.type === 'daily') return true;
    if (f.type === 'days') return Array.isArray(f.days) && f.days.length > 0 && f.days.length <= 7 && new Set(f.days).size === f.days.length && f.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (f.type === 'weekly') return Number.isInteger(f.times) && f.times >= 1 && f.times <= 7;
    return false;
  }
  const partes = dia => dia.split('-').map(Number);
  const addDays = (dia, n) => { const [y, m, d] = partes(dia); return localDate(new Date(y, m - 1, d + n)); };
  const weekday = dia => { const [y, m, d] = partes(dia); return new Date(y, m - 1, d).getDay(); };
  // Os n dias que terminam em "hoje", cada um dizendo se era dia do hábito e se foi feito.
  function habitDays(habit, dias = [], hoje = localDate(), n = 7) {
    const feitos = new Set(dias), inicio = habit.createdAt ? localDate(new Date(habit.createdAt)) : '';
    const f = habit.frequency;
    return Array.from({ length: n }, (_, i) => {
      const dia = addDays(hoje, i - n + 1);
      return { date: dia, done: feitos.has(dia), due: (!inicio || dia >= inicio) && (f.type !== 'days' || f.days.includes(weekday(dia))) };
    });
  }
  function habitStats(habit, dias = [], hoje = localDate()) {
    const feitos = new Set(dias), f = habit.frequency, inicio = habit.createdAt ? localDate(new Date(habit.createdAt)) : '';
    const existe = dia => !inicio || dia >= inicio;
    const devido = dia => existe(dia) && (f.type !== 'days' || f.days.includes(weekday(dia)));
    const segunda = dia => addDays(dia, -((weekday(dia) + 6) % 7));
    const naSemana = seg => Array.from({ length: 7 }, (_, i) => addDays(seg, i)).filter(d => feitos.has(d)).length;
    let streak = 0;
    if (f.type === 'weekly') {
      // A semana atual só entra quando a meta já foi batida; ainda em aberto, não quebra a sequência.
      let seg = segunda(hoje);
      if (naSemana(seg) < f.times) seg = addDays(seg, -7);
      for (let i = 0; i < 520 && (!inicio || addDays(seg, 6) >= inicio) && naSemana(seg) >= f.times; i++, seg = addDays(seg, -7)) streak++;
    } else {
      // Hoje ainda por fazer não quebra: a contagem começa em ontem.
      let dia = devido(hoje) && !feitos.has(hoje) ? addDays(hoje, -1) : hoje;
      for (let i = 0; i < 3650 && existe(dia); i++, dia = addDays(dia, -1)) {
        if (!devido(dia)) continue;
        if (!feitos.has(dia)) break;
        streak++;
      }
    }
    // Cumprimento nos últimos 30 dias; hoje só entra depois de feito.
    let esperados = 0, cumpridos = 0;
    if (f.type === 'weekly') {
      const existentes = Array.from({ length: 28 }, (_, i) => addDays(hoje, -i)).filter(existe);
      cumpridos = existentes.filter(d => feitos.has(d)).length;
      esperados = Math.max(1, Math.round(existentes.length / 7 * f.times));
    } else {
      for (let i = 0; i < 30; i++) {
        const dia = addDays(hoje, -i);
        if (!devido(dia) || (dia === hoje && !feitos.has(dia))) continue;
        esperados++; if (feitos.has(dia)) cumpridos++;
      }
    }
    return {
      dueToday: f.type === 'weekly' ? existe(hoje) : devido(hoje),
      doneToday: feitos.has(hoje),
      streak,
      rate30: esperados ? Math.min(100, Math.round(cumpridos / esperados * 100)) : null,
      totalDone: [...feitos].filter(d => d <= hoje).length,
      week: habitDays(habit, dias, hoje, 7),
      ...(f.type === 'weekly' ? { weekCount: naSemana(segunda(hoje)) } : {}),
    };
  }
  // Cofres e backups antigos têm "routine" (só "feito hoje"): vira hábito diário com o dia marcado.
  // Também limpa o histórico: dias repetidos, datas inválidas e hábitos que não existem mais.
  function withHabits(value) {
    if (!value || typeof value !== 'object') return value;
    const { routine, ...resto } = value;
    const habits = Array.isArray(resto.habits) ? resto.habits : (Array.isArray(routine) ? routine : [])
      .filter(r => r && id(r.id) && text(r.title))
      .map(r => ({ id: r.id, title: r.title, frequency: { type: 'daily' }, ...(date(r.date) ? { createdAt: new Date(...partes(r.date).map((v, i) => i === 1 ? v - 1 : v)).getTime() } : {}) }));
    const origem = Array.isArray(resto.habits)
      ? (resto.habitLog && typeof resto.habitLog === 'object' && !Array.isArray(resto.habitLog) ? resto.habitLog : {})
      : Object.fromEntries((Array.isArray(routine) ? routine : []).filter(r => r && r.done && date(r.date)).map(r => [r.id, [r.date]]));
    const ids = new Set(habits.map(h => h && h.id));
    const habitLog = {};
    for (const [chave, dias] of Object.entries(origem)) {
      if (!ids.has(chave) || !Array.isArray(dias)) continue;
      const limpos = [...new Set(dias.filter(date))].sort();
      if (limpos.length) habitLog[chave] = limpos;
    }
    return { ...resto, habits, habitLog };
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
    return validateState(withHabits(data));
  }
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isImagePath = value => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(value.trim());
  // ![[imagem.png]] embute uma imagem; não é ligação entre notas, então fica fora do grafo e dos backlinks.
  const wikiLinks = body => [...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)].filter(match => !(match[1] && isImagePath(match[2].split('|')[0]))).map(match => ({ target: match[2].split('|')[0].split('#')[0].trim(), label: (match[2].split('|')[1] || match[2]).trim() }));
  const tags = note => [...new Set([...(note.tags || []), ...[...note.body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1])])];
  const findLinkedNote = (notes, target) => notes.find(n => normalize(n.title) === normalize(target) || normalize((n.file || '').replace(/\.md$/i, '')) === normalize(target) || normalize((n.file || '').split('/').pop().replace(/\.md$/i, '')) === normalize(target));
  // Notas que citam `note` com [[...]]; a própria nota não conta.
  const mentions = (notes, note) => notes.filter(n => n.id !== note.id && wikiLinks(n.body).some(l => findLinkedNote(notes, l.target)?.id === note.id));
  // Fluxos que citam a nota: um cartão de arquivo com o caminho dela ou um [[link]] para ela
  // num cartão de texto. Fluxo com erro (sem canvas) não conta. Base do "Aparece nos fluxos".
  function fluxosQueCitam(state, nota) {
    if (!nota || !nota.id) return [];
    const arquivo = nota.file ? pathKey(nota.file) : '';
    const cita = n => (n && n.type === 'file' && arquivo && typeof n.file === 'string' && pathKey(n.file) === arquivo)
      || (n && n.type === 'text' && typeof n.text === 'string' && wikiLinks(n.text).some(l => findLinkedNote(state.notes, l.target)?.id === nota.id));
    return (state.fluxos || []).filter(f => f.canvas && f.canvas.nodes.some(cita));
  }
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
  // ---- Aparência: temas, skins e cores manuais (preferência da instalação, em localStorage) ----
  const TEMAS = [
    ['kiro', 'Kiro', 'classicos'], ['grafite', frase('Grafite'), 'classicos'], ['claro', frase('Claro'), 'classicos'], ['escuro-azul', frase('Escuro Azul'), 'classicos'], ['escuro-verde', frase('Escuro Verde'), 'classicos'],
    ['escuro-ambar', frase('Escuro Âmbar'), 'classicos'], ['alto-contraste', frase('Alto Contraste'), 'classicos'], ['meia-noite', frase('Meia-noite'), 'classicos'], ['floresta', frase('Floresta'), 'classicos'],
    ['neon-tokyo', 'Neon Tokyo', 'anime'], ['sakura-night', 'Sakura Night', 'anime'], ['shonen-fire', 'Shonen Fire', 'anime'], ['studio-ghibli', 'Studio Ghibli', 'anime'],
    ['evangelion', 'Evangelion', 'anime'], ['sailor-moon', 'Sailor Moon', 'anime'], ['violet-evergarden', 'Violet Evergarden', 'anime'], ['demon-blood', 'Demon Blood', 'anime'],
    ['cyber-lain', 'Cyber Lain', 'anime'], ['makoto-shinkai', 'Makoto Shinkai', 'anime'], ['jojo-stand', 'JoJo Stand', 'anime'],
  ];
  const SKINS = [
    ['padrao', frase('Padrão'), frase('O visual de sempre.')], ['minimal', 'Minimal', frase('Menos bordas, mais respiro.')], ['compacto', frase('Compacto'), frase('Mais coisa na tela.')],
    ['terminal', 'Terminal', frase('Fonte mono e cantos retos.')], ['suave', frase('Suave'), frase('Cantos redondos e sombras leves.')], ['sharp', 'Sharp', frase('Cantos retos, bordas marcadas.')],
    ['neon', 'Neon', frase('Brilho sutil no destaque.')], ['paper', 'Paper', frase('Textura de papel ilustrado.')],
  ];
  // destaque: '' segue a cor do tema; um hex vale por cima de qualquer tema (acento é só a base do Personalizado).
  const APARENCIA_PADRAO = Object.freeze({ tema: 'kiro', skin: 'padrao', sidebar: '#11161D', content: '#0B0F14', acento: '#9273FF', destaque: '' });
  const corValida = v => text(v) && /^#[0-9a-f]{6}$/i.test(v);
  // Luminância relativa e razão de contraste (WCAG).
  function luminancia(hex) {
    const [r, g, b] = [1, 3, 5].map(i => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // Sempre devolve um objeto completo; o que vier estranho do localStorage vira padrão.
  function aparenciaValida(salvo) {
    const s = salvo && typeof salvo === 'object' && !Array.isArray(salvo) ? salvo : {};
    // Fundos de versões anteriores (inclusive de quando o aplicativo se chamava KUROI)
    // contam como padrão: quem nunca escolheu cor recebe a identidade atual.
    const ANTIGAS = { sidebar: ['#0e0e0e', '#1a1a20'], content: ['#0a0a0a', '#141418'], acento: ['#c77dff'] };
    const cores = {};
    for (const chave of ['sidebar', 'content', 'acento']) {
      const v = corValida(s[chave]) && !ANTIGAS[chave].includes(s[chave].toLowerCase()) ? s[chave] : APARENCIA_PADRAO[chave];
      cores[chave] = v;
    }
    // Salvo de antes dos temas: cor própria vira "personalizado"; quem nunca mexeu fica no clássico.
    // 'escuro-classico' era o id do tema padrão antes da identidade Kiro.
    if (s.tema === 'escuro-classico') s = { ...s, tema: 'kiro' };
    const tema = s.tema === 'personalizado' || TEMAS.some(([id]) => id === s.tema) ? s.tema
      : s.tema === undefined && ['sidebar', 'content', 'acento'].some(k => cores[k].toLowerCase() !== APARENCIA_PADRAO[k].toLowerCase()) ? 'personalizado'
      : APARENCIA_PADRAO.tema;
    const skin = SKINS.some(([id]) => id === s.skin) ? s.skin : APARENCIA_PADRAO.skin;
    return { tema, skin, ...cores, destaque: corValida(s.destaque) ? s.destaque : '' };
  }
  const classesDaAparencia = a => { const v = aparenciaValida(a); return [`tema-${v.tema}`, `skin-${v.skin}`]; };
  // ---- Painel da direita: menções não vinculadas, sumário e árvore de etiquetas ----
  // Compara sem maiúsculas nem acentos, caractere a caractere, mantendo o tamanho do
  // texto: os índices achados valem no texto original.
  const umPraUm = c => { const s = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return s.length === c.length ? s : c; };
  const semAcento = texto => [...texto].map(umPraUm).join('');
  const LETRA = /[\p{L}\p{N}_]/u;
  // Posições onde o título aparece como palavra inteira fora de [[links]].
  function ocorrenciasSoltas(corpo, titulo) {
    const alvo = semAcento(String(titulo || '').trim());
    if (alvo.length < 3) return [];
    // Título com |, [ ou ] não pode virar [[link]] seguro: wikiLinks não vai parsear.
    if (/[|[\]]/.test(String(titulo || '').trim())) return [];
    // ponytail: descarte rápido antes da varredura char a char abaixo (O(n) por nota, a cada
    // render); normalize().includes() é superconjunto estrito das ocorrências soltas, então o
    // resultado não muda. Indexar alvos se o cofre crescer muito.
    if (!normalize(String(corpo || '')).includes(normalize(String(titulo || '').trim()))) return [];
    const texto = semAcento(String(corpo || '').replace(/\[\[[^\]\n]*\]\]/g, m => ' '.repeat(m.length)));
    const achadas = [];
    for (let i = texto.indexOf(alvo); i !== -1; i = texto.indexOf(alvo, i + 1)) {
      const antes = texto[i - 1], depois = texto[i + alvo.length];
      if ((antes && LETRA.test(antes)) || (depois && LETRA.test(depois))) continue;
      achadas.push(i);
    }
    return achadas;
  }
  function mencoesNaoVinculadas(notas, nota) {
    return notas.filter(n => n.id !== nota.id).flatMap(n => {
      const corpo = n.body || '';
      const [i] = ocorrenciasSoltas(corpo, nota.title);
      if (i === undefined) return [];
      const ini = corpo.lastIndexOf('\n', i) + 1, fim = corpo.indexOf('\n', i);
      return [{ nota: n, trecho: corpo.slice(ini, fim === -1 ? undefined : fim).trim() }];
    });
  }
  function vincularMencao(corpo, titulo) {
    const t = String(titulo || '').trim();
    const [i] = ocorrenciasSoltas(corpo, t);
    if (i === undefined) return corpo;
    const original = corpo.slice(i, i + t.length);
    return corpo.slice(0, i) + (original === t ? `[[${t}]]` : `[[${t}|${original}]]`) + corpo.slice(i + t.length);
  }
  // Títulos Markdown (# a ######) fora de blocos de código cercados. Alinhado com
  // renderizarMarkdown (app.js): título e cerca só valem na coluna 0 (sem recuo), e a única
  // cerca reconhecida é ``` (o renderizador não trata ~~~ como bloco de código). `pos` é o
  // índice, no corpo original, do início da linha do título — a mesma âncora que
  // renderizarMarkdown grava em `data-pos`, para rolar até o título certo sem contar posições.
  function sumario(corpo) {
    const itens = [];
    let cerca = false;
    let pos = 0;
    for (const linha of String(corpo || '').split('\n')) {
      if (/^`{3,}/.test(linha)) { cerca = !cerca; pos += linha.length + 1; continue; }
      if (!cerca) {
        const h = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(linha);
        if (h && h[2].trim()) itens.push({ nivel: h[1].length, texto: h[2].trim(), indice: itens.length, pos });
      }
      pos += linha.length + 1;
    }
    return itens;
  }
  // Só vincular quando a nota em edição está salva (tem id) e sem alterações pendentes: sem
  // isso, a outra nota ficaria com um [[link]] para um título que o cofre ainda não tem.
  function podeVincular(editing, editorDirty) { return Boolean(editing && editing.id) && !editorDirty; }
  // Etiquetas aninhadas por "/": cada nó conta as notas dele e das filhas, sem repetir nota.
  function arvoreDeEtiquetas(notas) {
    const raiz = new Map();
    for (const nota of notas) for (const tag of tags(nota)) {
      let nivel = raiz, caminho = '';
      for (const parte of String(tag).split('/').filter(Boolean)) {
        caminho = caminho ? `${caminho}/${parte}` : parte;
        if (!nivel.has(parte)) nivel.set(parte, { nome: parte, caminho, notas: new Set(), filhos: new Map() });
        const no = nivel.get(parte);
        no.notas.add(nota.id);
        nivel = no.filhos;
      }
    }
    const saida = mapa => [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map(no => ({ nome: no.nome, caminho: no.caminho, total: no.notas.size, filhos: saida(no.filhos) }));
    return saida(raiz);
  }
  // ---- Atalhos de teclado (os que dá para trocar em Configurações → Atalhos) ----
  // Combinação é texto: modificadores na ordem Ctrl, Alt, Shift e depois a tecla ("Ctrl+Shift+K").
  const ATALHOS_EDITAVEIS = [
    ['captura', frase('Captura rápida'), frase('De qualquer tela, direto para a caixa de entrada.'), 'Ctrl+Space'],
    ['irPara', frase('Ir para nota'), frase('Busca uma nota pelo título.'), 'Ctrl+O'],
    ['novaNota', frase('Nova nota'), '', 'Ctrl+N'],
    ['salvar', frase('Salvar a nota aberta'), '', 'Ctrl+S'],
    ['lateral', frase('Recolher a barra lateral'), frase('Alterna entre a barra completa e só os ícones.'), 'Ctrl+\\'],
    ['painelDireito', frase('Painel da direita'), frase('Links, sumário e etiquetas da nota, na tela de Pastas.'), 'Ctrl+Shift+L'],
  ];
  // Teclas que o sistema e o editor já usam: trocá-las quebraria copiar, colar, desfazer…
  const RESERVADOS = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+Shift+Z', 'Ctrl+W', 'Ctrl+T', 'Ctrl+R', 'Ctrl+P', 'Ctrl+F', 'Alt+F4']);
  const MODIFICADORES = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
  function combinacaoDoEvento(e) {
    if (!e || MODIFICADORES.has(e.key) || !e.key) return null;
    const tecla = e.code === 'Space' || e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', tecla].filter(Boolean).join('+');
  }
  // `traduzir` (o t() da página) traduz o nome da tecla; sem ele, sai em português.
  const rotuloDaCombinacao = (c, traduzir = f => f) => String(c).split(/\+(?=.)/).map(p => p === 'Space' ? traduzir(frase('Espaço')) : p).join(' + ');
  // Sem Ctrl ou Alt, a tecla atrapalharia a escrita; F1–F12 sozinhas não atrapalham.
  const combinacaoAceita = c => typeof c === 'string' && c.length <= 40 && (/^(Ctrl|Alt)\+./.test(c) || /^(Shift\+)?F([1-9]|1[0-2])$/.test(c));
  function problemaDoAtalho(combinacao, atuais, id) {
    if (!combinacaoAceita(combinacao)) return frase('Use uma combinação com Ctrl ou Alt (ou uma tecla F1–F12).');
    if (RESERVADOS.has(combinacao)) return `${rotuloDaCombinacao(combinacao)} é reservado do sistema ou do editor.`;
    const dono = ATALHOS_EDITAVEIS.find(([outro]) => outro !== id && atuais[outro] === combinacao);
    return dono ? `${rotuloDaCombinacao(combinacao)} já é o atalho de ${dono[1]}.` : '';
  }
  function atalhosValidos(salvos) {
    const s = salvos && typeof salvos === 'object' && !Array.isArray(salvos) ? salvos : {};
    const padrao = id => ATALHOS_EDITAVEIS.find(([x]) => x === id)[3];
    const atalhos = Object.fromEntries(ATALHOS_EDITAVEIS.map(([id]) => {
      const c = s[id];
      return [id, combinacaoAceita(c) && !RESERVADOS.has(c) ? c : padrao(id)];
    }));
    // Repetido: quem não está no padrão volta para ele, até sobrar tudo distinto.
    for (let volta = 0; volta < ATALHOS_EDITAVEIS.length; volta++) {
      const repetidos = ATALHOS_EDITAVEIS.filter(([id]) => atalhos[id] !== padrao(id) && Object.keys(atalhos).some(o => o !== id && atalhos[o] === atalhos[id]));
      if (!repetidos.length) break;
      for (const [id] of repetidos) atalhos[id] = padrao(id);
    }
    return atalhos;
  }

  const api = { ATALHOS_EDITAVEIS, combinacaoDoEvento, rotuloDaCombinacao, problemaDoAtalho, atalhosValidos, TEMAS, SKINS, APARENCIA_PADRAO, luminancia, contraste, corValida, aparenciaValida, classesDaAparencia, FOLDER_COLORS, folderColor, habitStats, habitDays, withHabits, validFrequency, localDate, safeUrl, validateState, normalize, isImagePath, wikiLinks, tags, findLinkedNote, mentions, fluxosQueCitam, inInbox, withoutInbox, toReview, linkQuery, linkSuggestions, validFolderName, folderPaths, descendants, upgradeBackup, pathKey, mencoesNaoVinculadas, vincularMencao, sumario, arvoreDeEtiquetas, podeVincular };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Kiro = api;
})(globalThis);
