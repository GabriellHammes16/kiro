(function (root) {
  // Marca a frase para tradução na tela (idiomas.js); aqui o texto segue em português.
  const frase = f => f;
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const text = value => typeof value === 'string';
  const id = value => text(value) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const date = value => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const dataLocal = (ano, mes, dia) => { const d = new Date(0); d.setFullYear(ano, mes - 1, dia); d.setHours(12, 0, 0, 0); return d; };
  function calendarioDoMes(valor) {
    if (!date(valor)) return null;
    const [ano, mes] = valor.split('-').map(Number), deslocamento = (dataLocal(ano, mes, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = dataLocal(ano, mes, i - deslocamento + 1);
      return { date: localDate(d), inMonth: d.getFullYear() === ano && d.getMonth() === mes - 1 };
    });
  }
  function somarMeses(valor, n) {
    if (!date(valor) || !Number.isInteger(n)) return null;
    const [ano, mes, dia] = valor.split('-').map(Number), indice = mes - 1 + n;
    const novoAno = ano + Math.floor(indice / 12), novoMes = (indice % 12 + 12) % 12;
    if (novoAno < 0 || novoAno > 9999) return null;
    const ultimoDia = dataLocal(novoAno, novoMes + 2, 0).getDate();
    return localDate(dataLocal(novoAno, novoMes + 1, Math.min(dia, ultimoDia)));
  }
  function safeUrl(value) {
    // new URL aceita aspas e < > no host e as devolve cruas em href, o que abriria atributos no HTML.
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !/["'`<>]/.test(url.hostname) ? url.href : ''; } catch { return ''; }
  }
  // Status da tarefa além de feita/não feita: só 'andamento' e 'pausado' são guardados (status da tarefa).
  // Sem campo é "não começado"; done=true é "concluído" e mantém o status de antes, para reabrir onde estava.
  const STATUS_GUARDADOS = ['andamento', 'pausado'];
  const STATUS_DA_TAREFA = ['nao-comecado', 'andamento', 'pausado', 'concluido'];
  const statusDaTarefa = t => t.done ? 'concluido' : STATUS_GUARDADOS.includes(t.status) ? t.status : 'nao-comecado';
  function moverTarefa(t, destino) {
    if (!STATUS_DA_TAREFA.includes(destino)) return t;
    if (destino === 'concluido') return { ...t, done: true };
    const nova = { ...t, done: false };
    if (STATUS_GUARDADOS.includes(destino)) nova.status = destino; else delete nova.status;
    return nova;
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
    for (const t of value.tasks) if (!date(t.due) || !['Baixa', 'Média', 'Alta'].includes(t.priority) || typeof t.done !== 'boolean' || (t.noteId && !id(t.noteId)) || (t.description !== undefined && (!text(t.description) || t.description.length > 5000)) || (t.status !== undefined && !STATUS_GUARDADOS.includes(t.status)) || (t.repeat !== undefined && !validRepeat(t.repeat)) || (t.repeatNextId !== undefined && !id(t.repeatNextId))) fail();
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
  // Tarefa recorrente: repeat = { every: 'day'|'week'|'month' } ou { every: 'days', n: 2..365 }. Sem o campo, não repete.
  function validRepeat(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    if (r.every === 'days') return Number.isInteger(r.n) && r.n >= 1 && r.n <= 365;
    return ['day', 'week', 'month'].includes(r.every) && r.n === undefined;
  }
  // Próximo prazo depois de `due`. Mês sem o dia (31 em fevereiro) cai no último dia do mês.
  // shortcut: o mês parte do prazo anterior e não volta a 31, rever se houver escolha do dia fixo.
  function proximoPrazo(due, repeat) {
    if (!date(due) || !validRepeat(repeat)) return null;
    if (repeat.every === 'day') return addDays(due, 1);
    if (repeat.every === 'week') return addDays(due, 7);
    if (repeat.every === 'days') return addDays(due, repeat.n);
    const [y, m, d] = partes(due);
    return localDate(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())));
  }
  // Ao concluir uma tarefa recorrente, a próxima ocorrência (aberta, com o prazo seguinte); senão null.
  function proximaOcorrencia(tarefa, novoId) {
    const due = tarefa && tarefa.repeat && proximoPrazo(tarefa.due, tarefa.repeat);
    if (!due) return null;
    const { status, repeatNextId, ...resto } = tarefa;
    return { ...resto, id: novoId, due, done: false };
  }
  // O vínculo fica mesmo se a próxima tarefa for apagada: reabrir não emite outra ocorrência.
  function criarProximas(tarefas, antes, novoId) {
    const novas = [];
    const atualizadas = tarefas.map(tarefa => {
      if (!tarefa.done || !tarefa.repeat || tarefa.repeatNextId || !antes.some(a => a.id === tarefa.id && !a.done)) return tarefa;
      const proxima = proximaOcorrencia(tarefa, novoId());
      if (!proxima) return tarefa;
      novas.push(proxima);
      return { ...tarefa, repeatNextId: proxima.id };
    });
    return [...novas, ...atualizadas];
  }
  // Lembretes: quais avisos sair agora. `ultimo` guarda o dia do último aviso de cada tipo.
  // Avisa a partir do horário (HH:MM) e no máximo uma vez por dia; só se houver algo a avisar.
  function avisosDeHoje({ agora = new Date(), tarefas = [], habitos = [], habitLog = {}, horas = {}, ultimo = {} } = {}) {
    const hoje = localDate(agora), hm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const pendentes = tarefas.filter(t => !t.done && t.due <= hoje).length;
    const faltam = habitos.filter(h => { const d = habitStats(h, habitLog[h.id] || [], hoje); return d.dueToday && !d.doneToday && (h.frequency.type !== 'weekly' || d.weekCount < h.frequency.times); }).length;
    return {
      tarefas: ultimo.tarefas !== hoje && hm >= (horas.tarefas || '09:00') ? pendentes : 0,
      habitos: ultimo.habitos !== hoje && hm >= (horas.habitos || '20:00') ? faltam : 0,
    };
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
  const isImagePath = value => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(String(value || '').trim());
  const isPdfPath = value => /\.pdf$/i.test(String(value || '').split('#')[0].trim());
  const isAudioPath = value => /\.(wav|mp3|webm)$/i.test(String(value || '').trim());
  const isAttachmentPath = value => isImagePath(value) || isPdfPath(value) || isAudioPath(value);
  function csvParaTabela(texto) {
    if(typeof texto!=='string'||texto.length>1024*1024)return null;
    const linhas=[], linha=[];let campo='',aspas=false,fechado=false;
    for(let i=0;i<texto.length;i++){
      const c=texto[i];
      if(aspas){if(c==='"'){if(texto[i+1]==='"'){campo+='"';i++;}else{aspas=false;fechado=true;}}else campo+=c;continue;}
      if(c==='"'){if(campo||fechado)return null;aspas=true;continue;}
      if(c===','||c==='\n'||c==='\r'){
        linha.push(campo);campo='';fechado=false;
        if(c!==','){if(c==='\r'&&texto[i+1]==='\n')i++;linhas.push(linha.splice(0));}
      }else{if(fechado)return null;campo+=c;}
    }
    if(aspas)return null;
    if(campo||linha.length||fechado)linhas.push([...linha,campo]);
    if(linhas.length<2||linhas[0].length<2||linhas.some(l=>l.length!==linhas[0].length)||linhas.some(l=>l.every(c=>!c.trim())))return null;
    if(linhas.every(l=>l.every(c=>c.trim().split(/\s+/).length>=3)))return null;
    if(linhas.every(l=>l.every(c=>c.trim().split(/\s+/).length>=3)))return null;
    const celula=c=>c.replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
    const formatar=l=>'| '+l.map(celula).join(' | ')+' |';
    return [formatar(linhas[0]),formatar(linhas[0].map(()=> '---')),...linhas.slice(1).map(formatar)].join('\n');
  }
  function celulasTabela(linha){
    if(!/^\s*\|/.test(linha)||! /\|\s*$/.test(linha))return null;
    const texto=linha.trim().slice(1,-1), celulas=[];let campo='';
    for(let i=0;i<texto.length;i++){if(texto[i]==='\\'&&i+1<texto.length){campo+=texto[i]+texto[++i];}else if(texto[i]==='|'){celulas.push(campo.trim());campo='';}else campo+=texto[i];}
    celulas.push(campo.trim());return celulas;
  }
  function lerPdf(dentro) {
    const partes = String(dentro || '').split('|').map(s => s.trim());
    const primeiro = partes[0] || '';
    const hash = primeiro.indexOf('#');
    const arquivo = (hash >= 0 ? primeiro.slice(0, hash) : primeiro).trim();
    if (!isPdfPath(arquivo) || /[:\\]|\.\./.test(arquivo)) return null;
    const frag = hash >= 0 ? primeiro.slice(hash + 1) : '';
    const mPag = /^page=(\d+)$/i.exec(frag.trim());
    const pagina = mPag ? Math.max(1, Number(mPag[1])) : null;
    let altura = null;
    for (const p of partes.slice(1)) {
      if (/^\d{2,4}$/.test(p)) { const n = Number(p); if (n >= 120 && n <= 2000) altura = n; }
    }
    return { arquivo, pagina, altura };
  }
  // ![[imagem.png]] embute uma imagem; não é ligação entre notas, então fica fora do grafo e dos backlinks.
  // [[tarefa:id|Título]] cita uma tarefa, não uma nota: fica fora do grafo de notas e dos backlinks (ver taskLinks).
  const CITACAO_DE_TAREFA = /(?<!!)\[\[tarefa:([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/gi;
  const taskLinks = body => [...String(body).matchAll(CITACAO_DE_TAREFA)].map(m => m[1].trim());
  const notesCitingTask = (notes, taskId) => notes.filter(n => taskLinks(n.body).includes(taskId));
  // Citação pronta para colar numa nota: o id não muda quando a tarefa troca de nome; o título é só o rótulo.
  const taskReference = task => `[[tarefa:${task.id}|${String(task.title).replace(/[\[\]|\n]+/g, ' ').replace(/\s+/g, ' ').trim()}]]`;
  const wikiLinks = body => [...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)].filter(match => !(match[1] && isAttachmentPath(match[2].split('|')[0])) && !/^tarefa:/i.test(match[2])).map(match => ({ target: match[2].split('|')[0].split('#')[0].trim(), label: (match[2].split('|')[1] || match[2]).trim() }));
  const tags = note => [...new Set([...(note.tags || []), ...[...note.body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(m => m[1])])];
  const findLinkedNote = (notes, target) => { const alvo = normalize(String(target || '').split('#')[0].trim()); return alvo ? notes.find(n => normalize(n.title) === alvo || normalize((n.file || '').replace(/\.md$/i, '')) === alvo || normalize((n.file || '').split('/').pop().replace(/\.md$/i, '')) === alvo) : undefined; };
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
  const linkSuggestions = (notes, query, limit = 8, notaAtual = null) => {
    const bruto = String(query ?? '');
    if (bruto.includes('#')) {
      const hash = bruto.indexOf('#');
      const alvoNota = bruto.slice(0, hash).trim();
      const filtroBruto = bruto.slice(hash + 1);
      const todas = notaAtual && !notes.some(n => n.id === notaAtual.id) ? [notaAtual, ...notes] : notes;
      const nota = alvoNota ? findLinkedNote(todas, alvoNota) : notaAtual;
      if (!nota || typeof nota.body !== 'string') return [];
      const prefixo = alvoNota ? nota.title : '';
      if (filtroBruto.startsWith('^')) {
        const fq = normalize(filtroBruto.slice(1).trim());
        const ids = [...new Set(blocosDaNota(nota.body).map(b => b.id))];
        const comeca = ids.filter(id => normalize(id).startsWith(fq));
        return [...comeca, ...ids.filter(id => !comeca.includes(id) && normalize(id).includes(fq))].slice(0, limit).map(id => `${prefixo}#^${id}`);
      }
      const fq = normalize(filtroBruto.trim());
      const secs = [...new Set(sumario(nota.body).map(h => h.texto))];
      const comeca = secs.filter(s => normalize(s).startsWith(fq));
      return [...comeca, ...secs.filter(s => !comeca.includes(s) && normalize(s).includes(fq))].slice(0, limit).map(s => `${prefixo}#${s}`);
    }
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
    ['liquid-glass', 'Liquid Glass', 'classicos'],
    ['kiro', 'Kiro', 'classicos'], ['grafite', frase('Areia'), 'classicos'], ['claro', frase('Claro'), 'classicos'], ['escuro-azul', frase('Oceano'), 'classicos'], ['escuro-verde', frase('Jade'), 'classicos'],
    ['escuro-ambar', frase('Café'), 'classicos'], ['alto-contraste', frase('Alto Contraste'), 'classicos'], ['meia-noite', frase('Meia-noite'), 'classicos'], ['floresta', frase('Floresta'), 'classicos'],
    ['neon-tokyo', 'Neon Tokyo', 'anime'], ['sakura-night', 'Sakura Blossom', 'anime'], ['shonen-fire', 'Shonen Fire', 'anime'], ['studio-ghibli', 'Studio Ghibli', 'anime'],
    ['evangelion', 'Evangelion', 'anime'], ['sailor-moon', 'Sailor Moon', 'anime'], ['violet-evergarden', 'Violet Evergarden', 'anime'], ['demon-blood', 'Demon Blood', 'anime'],
    ['cyber-lain', 'Cyber Lain', 'anime'], ['makoto-shinkai', 'Makoto Shinkai', 'anime'], ['jojo-stand', 'JoJo Stand', 'anime'],
  ];
  const SKINS = [
    ['padrao', frase('Padrão'), frase('O visual de sempre.')], ['minimal', 'Minimal', frase('Menos bordas, mais respiro.')], ['compacto', frase('Compacto'), frase('Mais coisa na tela.')],
    ['terminal', 'Terminal', frase('Fonte mono e cantos retos.')], ['suave', frase('Suave'), frase('Cantos redondos e sombras leves.')], ['sharp', 'Sharp', frase('Cantos retos, bordas marcadas.')],
    ['neon', 'Neon', frase('Brilho sutil no destaque.')], ['paper', 'Paper', frase('Textura de papel ilustrado.')],
  ];
  // destaque: '' segue a cor do tema; um hex vale por cima de qualquer tema (acento é só a base do Personalizado).
  const APARENCIA_PADRAO = Object.freeze({ tema: 'kiro', skin: 'padrao', sidebar: '#11161D', content: '#0B0F14', acento: '#9273FF', destaque: '', transparencia: 35 });
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
    const transparencia = Number.isFinite(s.transparencia) ? Math.min(80, Math.max(0, Math.round(s.transparencia))) : APARENCIA_PADRAO.transparencia;
    return { tema, skin, ...cores, destaque: corValida(s.destaque) ? s.destaque : '', transparencia };
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
    ['acoesRapidas', frase('Ações rápidas'), '', 'Ctrl+K'],
    ['fecharAba', frase('Fechar a aba'), '', 'Ctrl+W'],
    ['novaAba', frase('Nova nota em outra aba'), '', 'Ctrl+T'],
    ['imprimir', frase('Imprimir a nota aberta'), '', 'Ctrl+P'],
    ['configuracoes', frase('Configurações'), '', 'Ctrl+,'],
  ];
  // Teclas que o sistema e o editor já usam: trocá-las quebraria copiar, colar, desfazer…
  const RESERVADOS = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+Shift+Z', 'Ctrl+R', 'Ctrl+F', 'Ctrl+H', 'Ctrl+B', 'Ctrl+I', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0', 'Alt+F4']);
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
    if (!Object.hasOwn(s, 'acoesRapidas')) {
      const candidatos = ['Ctrl+K', 'Ctrl+Shift+P', 'Ctrl+Alt+K', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
      atalhos.acoesRapidas = candidatos.find(c => !RESERVADOS.has(c) && !Object.entries(atalhos).some(([id, valor]) => id !== 'acoesRapidas' && valor === c)) || 'Ctrl+K';
    }
    // Repetido: quem não está no padrão volta para ele, até sobrar tudo distinto.
    for (let volta = 0; volta < ATALHOS_EDITAVEIS.length; volta++) {
      const repetidos = ATALHOS_EDITAVEIS.filter(([id]) => atalhos[id] !== padrao(id) && Object.keys(atalhos).some(o => o !== id && atalhos[o] === atalhos[id]));
      if (!repetidos.length) break;
      for (const [id] of repetidos) atalhos[id] = padrao(id);
    }
    return atalhos;
  }
  function filtrarAcoes(acoes, consulta, limite = 12) {
    const termos = normalize(consulta).trim().split(/\s+/).filter(Boolean);
    const encontradas = acoes.filter(a => {
      const texto = normalize(`${a.titulo} ${a.categoria}`);
      return termos.every(termo => texto.includes(termo));
    });
    if (!termos.length) return encontradas.slice(0, limite);
    const inicio = normalize(consulta).trim();
    return [
      ...encontradas.filter(a => normalize(a.titulo).startsWith(inicio)),
      ...encontradas.filter(a => !normalize(a.titulo).startsWith(inicio)),
    ].slice(0, limite);
  }
  const modelosPessoais = notas => notas.filter(n => (n.tags || []).some(tag => normalize(tag) === 'modelo'));
  const expandirModelo = (corpo, valores) => String(corpo ?? '').replace(/\{\{(title|date)\}\}/g, (_, chave) => valores[chave]);

  // ---- Mescla em três vias, quando o cofre mudou por fora (outro editor, sincronização, um assistente) ----
  // base = o que esta janela leu por último; local = a janela agora; disco = o cofre agora.
  // Por item (nota, tarefa, hábito, pasta, fluxo, dia de hábito): só um lado mudou → vale esse lado;
  // os dois mudaram igual → tanto faz; os dois mudaram diferente → conflito, e quem chama não salva.
  // Compara só o conteúdo: arquivo e data de modificação mudam sozinhos quando o disco é relido.
  const CONTEUDO = {
    notes: n => [n.title, n.body, n.tags || [], n.links || [], n.folderId || ''],
    folders: f => [f.title, f.parentId || '', f.description || '', f.color || ''],
    fluxos: f => [f.title, f.folderId || '', f.canvas ?? null],
  };
  function mesclarLista(colecao, base, local, disco, conflitos) {
    const porId = lista => new Map((lista || []).map(x => [x.id, x]));
    const B = porId(base), L = porId(local), D = porId(disco), saida = [];
    const conteudo = x => x === undefined ? undefined : JSON.stringify((CONTEUDO[colecao] || (y => y))(x));
    for (const id of new Set([...L.keys(), ...D.keys()])) {
      const b = conteudo(B.get(id)), l = conteudo(L.get(id)), d = conteudo(D.get(id));
      let fica = L.get(id);
      if (l === b) fica = D.get(id);
      else if (d !== b && d !== l) conflitos.push({ colecao, id, titulo: (L.get(id) || D.get(id) || B.get(id))?.title || id });
      if (fica) saida.push(fica);
    }
    return saida;
  }
  function mesclarEstados(base, local, disco) {
    const conflitos = [];
    const lista = chave => mesclarLista(chave, base[chave], local[chave], disco[chave], conflitos);
    const comoLista = log => Object.entries(log || {}).map(([id, dias]) => ({ id, dias }));
    const habitLog = Object.fromEntries(mesclarLista('habitLog', comoLista(base.habitLog), comoLista(local.habitLog), comoLista(disco.habitLog), conflitos).map(x => [x.id, x.dias]));
    const estado = { ...disco, notes: lista('notes'), tasks: lista('tasks'), habits: lista('habits'), habitLog, folders: lista('folders'), fluxos: lista('fluxos'), revision: disco.revision };
    return { estado, conflitos };
  }
  // Reescreve [[Título Antigo]], [[Título Antigo|apelido]] e [[Título Antigo#seção]] fora de blocos
  // de código cercados (``` ou ~~~) e fora de código em linha (`...`).
  function reescreverLinksPorTitulo(corpo, tituloAntigo, tituloNovo, { podeTrocar } = {}) {
    const original = String(corpo ?? '');
    const antigo = normalize(String(tituloAntigo || '').trim());
    const novo = String(tituloNovo || '').trim();
    if (!antigo || !novo || String(tituloAntigo || '').trim() === novo || /[|[\]#\n]/.test(novo)) {
      return { corpo: original, trocas: 0 };
    }
    let cerca = null, trocas = 0;
    const linhas = original.split('\n').map(linha => {
      const mCerca = /^\s*(`{3,}|~{3,})/.exec(linha);
      if (mCerca) {
        if (!cerca) cerca = mCerca[1][0];
        else if (mCerca[1][0] === cerca) cerca = null;
        return linha;
      }
      if (cerca) return linha;
      return linha.replace(/(`+[^`\n]*`+)|(?<!!)\[\[([^\]\n]+)\]\]/g, (m, codigo, inner) => {
        if (codigo || /^tarefa:/i.test(inner)) return m;
        const pipe = inner.indexOf('|');
        const antesDoPipe = pipe < 0 ? inner : inner.slice(0, pipe);
        const sufixoPipe = pipe < 0 ? '' : inner.slice(pipe);
        const hash = antesDoPipe.indexOf('#');
        const alvo = (hash < 0 ? antesDoPipe : antesDoPipe.slice(0, hash)).trim();
        const sufixoHash = hash < 0 ? '' : antesDoPipe.slice(hash);
        if (!alvo || normalize(alvo) !== antigo) return m;
        if (podeTrocar && !podeTrocar(alvo)) return m;
        const atualizado = `[[${novo}${sufixoHash}${sufixoPipe}]]`;
        if (atualizado !== m) trocas++;
        return atualizado;
      });
    });
    return { corpo: linhas.join('\n'), trocas };
  }
  // Aplica a atualização de [[links]] em todas as notas e cartões de texto do Fluxo quando uma nota muda de título.
  function aplicarRenomeacaoDeLinks(state, notaId, tituloAntigo, tituloNovo) {
    if (!state || !notaId || !tituloAntigo || !tituloNovo || String(tituloAntigo).trim() === String(tituloNovo).trim()) {
      return { state, notasAfetadas: 0, fluxosAfetados: 0, totalLinks: 0 };
    }
    const notasComTituloAntigo = (state.notes || []).map(n => n.id === notaId ? { ...n, title: tituloAntigo } : n);
    const podeTrocar = alvo => {
      const resolvida = findLinkedNote(notasComTituloAntigo, alvo);
      return !resolvida || resolvida.id === notaId;
    };
    let notasAfetadas = 0, fluxosAfetados = 0, totalLinks = 0;
    const notes = (state.notes || []).map(n => {
      const { corpo, trocas } = reescreverLinksPorTitulo(n.body, tituloAntigo, tituloNovo, { podeTrocar });
      if (!trocas) return n;
      notasAfetadas++;
      totalLinks += trocas;
      return { ...n, body: corpo };
    });
    const fluxos = Array.isArray(state.fluxos) ? state.fluxos.map(f => {
      if (!f || !f.canvas || !Array.isArray(f.canvas.nodes)) return f;
      let mudouFluxo = false;
      const nodes = f.canvas.nodes.map(no => {
        if (!no || no.type !== 'text' || typeof no.text !== 'string') return no;
        const { corpo, trocas } = reescreverLinksPorTitulo(no.text, tituloAntigo, tituloNovo, { podeTrocar });
        if (!trocas) return no;
        mudouFluxo = true;
        totalLinks += trocas;
        return { ...no, text: corpo };
      });
      if (mudouFluxo) fluxosAfetados++;
      return mudouFluxo ? { ...f, canvas: { ...f.canvas, nodes } } : f;
    }) : state.fluxos;
    return { state: { ...state, notes, ...(fluxos !== undefined ? { fluxos } : {}) }, notasAfetadas, fluxosAfetados, totalLinks };
  }
  // Separa um alvo de [[wikilink]] em { target, anchor, blockId, ref }.
  function parseWikiLink(alvoBruto) {
    const texto = String(alvoBruto || '').split('|')[0].trim();
    const hash = texto.indexOf('#');
    if (hash < 0) return { target: texto, anchor: '', blockId: '', ref: '' };
    const target = texto.slice(0, hash).trim();
    const resto = texto.slice(hash + 1).trim();
    if (resto.startsWith('^') && resto.slice(1).trim()) {
      const blockId = resto.slice(1).trim();
      return { target, anchor: '', blockId, ref: `#^${blockId}` };
    }
    return { target, anchor: resto, blockId: '', ref: resto ? `#${resto}` : '' };
  }
  // Identificadores de bloco (^meu-bloco no fim da linha) fora de blocos de código cercados.
  function blocosDaNota(corpo) {
    const itens = [];
    let cerca = false, pos = 0, linhaNum = 0;
    for (const linha of String(corpo || '').split('\n')) {
      if (/^`{3,}/.test(linha)) { cerca = !cerca; pos += linha.length + 1; linhaNum++; continue; }
      if (!cerca) {
        const m = /(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/.exec(linha);
        if (m) itens.push({ id: m[1], pos, linha: linhaNum, texto: linha.slice(0, m.index).trim() });
      }
      pos += linha.length + 1;
      linhaNum++;
    }
    return itens;
  }
  // Resolve uma âncora (#Subtítulo ou #^bloco) para { tipo, pos, linha, texto } dentro do corpo da nota.
  function resolverAncoraNaNota(corpo, referencia) {
    const ref = String(referencia || '').trim().replace(/^#/, '');
    if (!ref) return null;
    if (ref.startsWith('^')) {
      const id = ref.slice(1).trim().toLowerCase();
      if (!id) return null;
      const b = blocosDaNota(corpo).find(x => x.id.toLowerCase() === id);
      return b ? { tipo: 'bloco', id: b.id, pos: b.pos, linha: b.linha, texto: b.texto } : null;
    }
    const alvo = normalize(ref);
    let cerca = false, pos = 0, linhaNum = 0;
    for (const linha of String(corpo || '').split('\n')) {
      if (/^`{3,}/.test(linha)) { cerca = !cerca; pos += linha.length + 1; linhaNum++; continue; }
      if (!cerca) {
        const h = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(linha);
        if (h && h[2].trim() && normalize(h[2].trim()) === alvo) {
          return { tipo: 'titulo', nivel: h[1].length, texto: h[2].trim(), pos, linha: linhaNum };
        }
      }
      pos += linha.length + 1;
      linhaNum++;
    }
    return null;
  }
  // ---- Etapa 2: Localizar e Substituir dentro da nota (Ctrl+F / Ctrl+H) ----
  function buscarNoTexto(texto, termo, { diferenciarMaiusculas = false } = {}) {
    const corpo = String(texto ?? ''), busca = String(termo ?? '');
    if (!busca) return [];
    const fonte = diferenciarMaiusculas ? corpo : corpo.toLowerCase();
    const alvo = diferenciarMaiusculas ? busca : busca.toLowerCase();
    const faixas = [];
    let i = 0;
    while (i <= fonte.length - alvo.length) {
      const achou = fonte.indexOf(alvo, i);
      if (achou < 0) break;
      faixas.push({ de: achou, ate: achou + alvo.length });
      i = achou + Math.max(1, alvo.length);
    }
    return faixas;
  }
  function substituirNoTexto(texto, faixa, substituto) {
    const corpo = String(texto ?? ''), sub = String(substituto ?? '');
    if (!faixa || typeof faixa.de !== 'number' || typeof faixa.ate !== 'number' || faixa.de < 0 || faixa.ate < faixa.de || faixa.ate > corpo.length) {
      return { texto: corpo, novoCursor: 0 };
    }
    const novo = corpo.slice(0, faixa.de) + sub + corpo.slice(faixa.ate);
    return { texto: novo, novoCursor: faixa.de + sub.length };
  }
  function substituirTodosNoTexto(texto, termo, substituto, opcoes = {}) {
    const corpo = String(texto ?? ''), sub = String(substituto ?? '');
    const faixas = buscarNoTexto(corpo, termo, opcoes);
    if (!faixas.length) return { texto: corpo, trocas: 0 };
    let out = '', ult = 0;
    for (const f of faixas) {
      out += corpo.slice(ult, f.de) + sub;
      ult = f.ate;
    }
    out += corpo.slice(ult);
    return { texto: out, trocas: faixas.length };
  }

  // ---- Etapa 5: Favoritos (Bookmarks) e grupos ----
  const TIPOS_FAVORITO = ['nota', 'pasta', 'fluxo', 'busca'];
  function limparItensFavoritos(itens) {
    if (!Array.isArray(itens)) return [];
    const vistos = new Set(), saida = [];
    for (const it of itens) {
      if (!it || typeof it !== 'object') continue;
      if (it.tipo === 'grupo') {
        const gid = text(it.id) ? it.id.trim() : '';
        const titulo = text(it.titulo) ? it.titulo.trim() : '';
        if (!gid || !titulo || vistos.has(`grupo:${gid}`)) continue;
        vistos.add(`grupo:${gid}`);
        saida.push({ tipo: 'grupo', id: gid, titulo, aberto: it.aberto !== false, itens: limparItensFavoritos(it.itens) });
      } else if (TIPOS_FAVORITO.includes(it.tipo) && text(it.alvo)) {
        const alvo = it.alvo.trim();
        const chave = `${it.tipo}:${alvo}`;
        if (!alvo || vistos.has(chave)) continue;
        vistos.add(chave);
        saida.push({ tipo: it.tipo, alvo, ...(text(it.titulo) ? { titulo: it.titulo.trim() } : {}) });
      }
    }
    return saida;
  }
  function validarFavoritos(raw) {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return { itens: limparItensFavoritos(obj.itens) };
  }
  function ehFavorito(favoritos, tipo, alvo) {
    const val = validarFavoritos(favoritos);
    const chaveAlvo = String(alvo || '').trim();
    const achar = lista => lista.some(it => it.tipo === 'grupo' ? achar(it.itens || []) : (it.tipo === tipo && it.alvo === chaveAlvo));
    return achar(val.itens);
  }
  function alternarFavorito(favoritos, item) {
    const val = validarFavoritos(favoritos);
    if (!item || !TIPOS_FAVORITO.includes(item.tipo) || !text(item.alvo)) return val;
    const alvo = item.alvo.trim();
    if (ehFavorito(val, item.tipo, alvo)) {
      const filtrar = lista => lista
        .filter(it => !(it.tipo === item.tipo && it.alvo === alvo))
        .map(it => it.tipo === 'grupo' ? { ...it, itens: filtrar(it.itens || []) } : it);
      return { itens: filtrar(val.itens) };
    }
    const novo = { tipo: item.tipo, alvo, ...(text(item.titulo) ? { titulo: item.titulo.trim() } : {}) };
    return { itens: [...val.itens, novo] };
  }
  function criarGrupoFavorito(favoritos, titulo, idGrupo = `grp-${Date.now().toString(36)}`) {
    const val = validarFavoritos(favoritos);
    const t = String(titulo || '').trim();
    if (!t) return val;
    return { itens: [...val.itens, { tipo: 'grupo', id: idGrupo, titulo: t, aberto: true, itens: [] }] };
  }
  function removerGrupoFavorito(favoritos, grupoId) {
    const val = validarFavoritos(favoritos);
    return { itens: val.itens.filter(it => !(it.tipo === 'grupo' && it.id === grupoId)) };
  }
  function moverParaGrupoFavorito(favoritos, item, grupoId) {
    const val = validarFavoritos(favoritos);
    if (!item || !TIPOS_FAVORITO.includes(item.tipo) || !text(item.alvo)) return val;
    const alvo = item.alvo.trim();
    let achado = { tipo: item.tipo, alvo, ...(text(item.titulo) ? { titulo: item.titulo.trim() } : {}) };
    const semItem = val.itens
      .filter(it => { if (it.tipo === item.tipo && it.alvo === alvo) { achado = it; return false; } return true; })
      .map(it => {
        if (it.tipo !== 'grupo') return it;
        const rest = (it.itens || []).filter(sub => { if (sub.tipo === item.tipo && sub.alvo === alvo) { achado = sub; return false; } return true; });
        return { ...it, itens: rest };
      });
    if (!grupoId) return { itens: [...semItem, achado] };
    return {
      itens: semItem.map(it => it.tipo === 'grupo' && it.id === grupoId ? { ...it, itens: [...(it.itens || []), achado] } : it),
    };
  }

  // ---- Etapa 6: Linguagem de Consulta Rica (Busca e Grafo) ----
  function tokenizarConsulta(str) {
    const tokens = [];
    const s = String(str ?? '');
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      let negado = false;
      if (s[i] === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) { negado = true; i++; }
      if (s[i] === '(' || s[i] === ')') {
        tokens.push({ tipo: s[i], negado });
        i++;
        continue;
      }
      let buf = '';
      while (i < s.length && !/\s|[()]/.test(s[i])) {
        if (s[i] === '"') {
          i++;
          buf += '"';
          while (i < s.length && s[i] !== '"') buf += s[i++];
          if (i < s.length && s[i] === '"') { buf += '"'; i++; }
        } else {
          buf += s[i++];
        }
      }
      if (!negado && buf === 'OR') tokens.push({ tipo: 'OR' });
      else if (buf) tokens.push({ tipo: 'ATOM', texto: buf, negado });
    }
    return tokens;
  }
  function criarAtomoConsulta(tok) {
    const bruta = tok.texto;
    const mOp = /^(tag|path|file|title|content):(.*)$/i.exec(bruta);
    if (mOp) {
      const campo = mOp[1].toLowerCase();
      const val = mOp[2].replace(/^"(.*)"$/, '$1').trim();
      return { tipo: 'OP', campo, valor: normalize(val), negado: Boolean(tok.negado) };
    }
    if (bruta.startsWith('#') && bruta.length > 1 && !bruta.includes(' ')) {
      return { tipo: 'OP', campo: 'tag', valor: normalize(bruta.slice(1)), negado: Boolean(tok.negado) };
    }
    const fraseExata = bruta.startsWith('"') && bruta.endsWith('"') && bruta.length >= 2;
    const limpo = fraseExata ? bruta.slice(1, -1) : bruta;
    return { tipo: 'TERMO', valor: normalize(limpo), exato: fraseExata, negado: Boolean(tok.negado) };
  }
  function compilarConsulta(query) {
    const tokens = tokenizarConsulta(query);
    if (!tokens.length) return { tipo: 'VAZIA' };
    let pos = 0;
    function lerOu() {
      let esq = lerE();
      while (pos < tokens.length && tokens[pos].tipo === 'OR') {
        pos++;
        const dir = lerE();
        if (dir) esq = esq ? { tipo: 'OR', esq, dir } : dir;
      }
      return esq;
    }
    function lerE() {
      let esq = null;
      while (pos < tokens.length && tokens[pos].tipo !== 'OR' && tokens[pos].tipo !== ')') {
        const termo = lerPrimario();
        if (termo) esq = esq ? { tipo: 'AND', esq, dir: termo } : termo;
      }
      return esq;
    }
    function lerPrimario() {
      if (pos >= tokens.length) return null;
      const t = tokens[pos++];
      if (t.tipo === '(') {
        const sub = lerOu();
        if (pos < tokens.length && tokens[pos].tipo === ')') pos++;
        if (!sub) return null;
        return t.negado ? { ...sub, negado: !sub.negado } : sub;
      }
      if (t.tipo === 'ATOM') return criarAtomoConsulta(t);
      return null;
    }
    return lerOu() || { tipo: 'VAZIA' };
  }
  function avaliarConsulta(ast, nota, contexto = {}) {
    if (!ast || ast.tipo === 'VAZIA') return true;
    if (!nota) return false;
    const inv = (res, neg) => neg ? !res : res;
    if (ast.tipo === 'AND') return inv(avaliarConsulta(ast.esq, nota, contexto) && avaliarConsulta(ast.dir, nota, contexto), ast.negado);
    if (ast.tipo === 'OR') return inv(avaliarConsulta(ast.esq, nota, contexto) || avaliarConsulta(ast.dir, nota, contexto), ast.negado);
    const titulo = normalize(nota.title || '');
    const corpo = normalize(nota.body || '');
    const arq = normalize((nota.file || nota.title || '').replace(/\.md$/i, ''));
    const pasta = normalize(typeof contexto.caminhoDaPasta === 'function' ? (contexto.caminhoDaPasta(nota) || '') : (contexto.pasta || (nota.file && nota.file.includes('/') ? nota.file.slice(0, nota.file.lastIndexOf('/')) : '') || ''));
    const etiqs = tags(nota).map(normalize);
    if (ast.tipo === 'TERMO') {
      if (!ast.valor) return inv(true, ast.negado);
      const bate = titulo.includes(ast.valor) || corpo.includes(ast.valor) || etiqs.some(t => t.includes(ast.valor)) || pasta.includes(ast.valor);
      return inv(bate, ast.negado);
    }
    if (ast.tipo === 'OP') {
      const v = ast.valor;
      if (!v) return inv(true, ast.negado);
      let bate = false;
      if (ast.campo === 'tag') {
        const semHash = v.replace(/^#/, '');
        bate = etiqs.some(t => t === semHash || t.startsWith(`${semHash}/`));
      } else if (ast.campo === 'path') {
        bate = pasta.includes(v) || normalize(nota.file || '').includes(v);
      } else if (ast.campo === 'file' || ast.campo === 'title') {
        bate = titulo.includes(v) || arq.includes(v);
      } else if (ast.campo === 'content') {
        bate = corpo.includes(v);
      }
      return inv(bate, ast.negado);
    }
    return true;
  }
  function filtrarNotasPorConsulta(notas, folders, query) {
    const ast = compilarConsulta(query);
    if (ast.tipo === 'VAZIA') return notas || [];
    const caminhos = Array.isArray(folders) ? folderPaths(folders) : new Map();
    const caminhoDaPasta = n => (n && n.folderId && caminhos.get(n.folderId)) || '';
    return (notas || []).filter(n => avaliarConsulta(ast, n, { caminhoDaPasta }));
  }

  // ---- Etapa 7: Sincronia de rolagem entre linhas e posições ----
  function posicaoParaLinha(corpo, pos) {
    const texto = String(corpo ?? '');
    const p = Math.max(0, Math.min(Number(pos) || 0, texto.length));
    let linha = 0;
    for (let i = 0; i < p; i++) if (texto.charCodeAt(i) === 10) linha++;
    return linha;
  }
  function linhaParaPosicao(corpo, linhaFracionaria) {
    const texto = String(corpo ?? '');
    const alvo = Math.max(0, Math.floor(Number(linhaFracionaria) || 0));
    if (alvo === 0) return 0;
    let linha = 0;
    for (let i = 0; i < texto.length; i++) {
      if (texto.charCodeAt(i) === 10) {
        linha++;
        if (linha === alvo) return i + 1;
      }
    }
    return texto.length;
  }

  const api = { criarProximas, validRepeat, proximoPrazo, proximaOcorrencia, avisosDeHoje, mesclarEstados, filtrarAcoes, modelosPessoais, expandirModelo, STATUS_DA_TAREFA, statusDaTarefa, moverTarefa, taskLinks, notesCitingTask, taskReference, ATALHOS_EDITAVEIS, combinacaoDoEvento, rotuloDaCombinacao, problemaDoAtalho, atalhosValidos, TEMAS, SKINS, APARENCIA_PADRAO, luminancia, contraste, corValida, aparenciaValida, classesDaAparencia, FOLDER_COLORS, folderColor, calendarioDoMes, somarMeses, habitStats, habitDays, withHabits, validFrequency, localDate, safeUrl, validateState, normalize, isImagePath, isPdfPath, isAudioPath, isAttachmentPath, csvParaTabela, celulasTabela, lerPdf, wikiLinks, parseWikiLink, blocosDaNota, resolverAncoraNaNota, tags, findLinkedNote, mentions, fluxosQueCitam, reescreverLinksPorTitulo, aplicarRenomeacaoDeLinks, buscarNoTexto, substituirNoTexto, substituirTodosNoTexto, validarFavoritos, ehFavorito, alternarFavorito, criarGrupoFavorito, removerGrupoFavorito, moverParaGrupoFavorito, compilarConsulta, avaliarConsulta, filtrarNotasPorConsulta, posicaoParaLinha, linhaParaPosicao, inInbox, withoutInbox, toReview, linkQuery, linkSuggestions, validFolderName, folderPaths, descendants, upgradeBackup, pathKey, mencoesNaoVinculadas, vincularMencao, sumario, arvoreDeEtiquetas, podeVincular };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Kiro = api;
})(globalThis);
