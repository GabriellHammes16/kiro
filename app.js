const today = () => Kiro.localDate();
const uid = () => crypto.randomUUID();
let state = { notes: [], tasks: [], habits: [], habitLog: {}, folders: [] };
let currentView = "today";

async function loadFromVault() { return window.cadernoDesktop ? window.cadernoDesktop.loadState() : api('state'); }
// `origem` é o id do plug-in que pediu a gravação (null quando vem da interface).
async function save(origem = null) {
  if (busy || failed || !loaded) return false;
  const snapshot = structuredClone(state);
  setBusy(true); status('Salvando…');
  try {
    Kiro.validateState(snapshot);
    state = window.cadernoDesktop ? await window.cadernoDesktop.saveState(snapshot) : await api('state', snapshot);
    status('Salvo no cofre'); render(); eventosDoCofre(origem); return true;
  } catch (error) {
    failed = true; status(error.message + ' Suas alterações continuam nesta janela. Exporte-as antes de recarregar.', true); return false;
  } finally { setBusy(false); }
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(date) { return new Intl.DateTimeFormat("pt-BR", { weekday:"long", day:"numeric", month:"long" }).format(new Date(`${date}T12:00:00`)); }
function dateLabel(date) { return date === today() ? "Hoje" : new Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"short" }).format(new Date(`${date}T12:00:00`)); }
function updateCount() { const open = state.tasks.filter(t => !t.done).length; document.querySelector("#task-count").textContent = open || ""; }
function getNote(id) { return state.notes.find(n => n.id === id); }
function render() {
  document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x.dataset.view === currentView));
  const views = { today: renderToday, notes: renderNotes, tasks: renderTasks, studies: renderCofre, graph: renderGraph };
  document.querySelector(".app-shell").classList.toggle("cofre-aberto", currentView === "studies");
  document.querySelector(".app-shell").classList.toggle("lateral-recolhida", lateralRecolhida);
  document.querySelector(".app-shell").classList.toggle("grafo-aberto", currentView === "graph");
  const app = document.querySelector("#app");
  cancelAnimationFrame(grafoRaf); grafoRaf = null; fecharSugestoes();
  app.innerHTML = views[currentView]();
  // Animar só na troca de tela: um redesenho comum não deve piscar.
  if (renderedView !== currentView) { app.classList.remove("view-enter"); void app.offsetWidth; app.classList.add("view-enter"); renderedView = currentView; }
  bindView(); updateCount();
}
function head(eyebrow, title, description, action="") { return `<header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${description}</p></div>${action}</header>`; }
function check(done, action, id) { return `<button class="check ${done ? "done" : ""}" aria-label="Marcar como ${done ? "não concluído" : "concluído"}" data-action="${action}" data-id="${id}"></button>`; }
function taskRow(task) { return `<div class="task-item">${check(task.done,"toggle-task",task.id)}<div class="task-title">${escapeHtml(task.title)}<div class="task-info">${dateLabel(task.due)}${task.noteId && getNote(task.noteId) ? ` · ${linkDaNota(getNote(task.noteId))}` : ""}</div></div>${task.priority === "Alta" ? '<span class="priority">Alta</span>' : ""}<div class="task-actions"><button class="icon-button" data-action="edit-task" data-id="${task.id}" title="Editar">${icone('renomear')}</button><button class="icon-button" data-action="delete-task" data-id="${task.id}" title="Excluir">${icone('lixeira')}</button></div></div>`; }
function renderToday() {
  const urgent = state.tasks.filter(t => !t.done && t.due <= today());
  const ultima = [...state.notes].sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  // Duas colunas por intenção: "Agora" é o que se marca todo dia; "Organizar" é o trabalho com as notas.
  return `${head(saudacao(), `<span class="frase-do-dia">${escapeHtml(fraseDoDia())}</span>`, `${formatDate(today())}.`)}<div class="today-grid"><div class="stack">${cardHabitos()}<section class="card"><div class="card-head"><h2>Para fazer agora</h2><a data-go="tasks">Ver tarefas</a></div>${urgent.map(taskRow).join("") || '<div class="empty">Nada urgente para hoje.</div>'}</section></div><div class="stack">${cardContinuar(ultima)}${cardCaixaDeEntrada()}${cardParaRevisar()}${cardsDosPlugins()}</div></div>`;
}
// Frase do dia no lugar do "Bom dia". Muda à meia-noite e não repete a de ontem:
// o passo 7 percorre as 20 frases antes de voltar à primeira.
const FRASES = [
  'Ara ara… não seja vagabundo, vamos trabalhar porque você é pobre.',
  'Ara ara~ o boleto não se paga sozinho, sabia?',
  'Levanta, guerreiro. O sofá não vai te pagar salário.',
  'Seus sonhos ligaram. Disseram que você está atrasado.',
  'Menos scroll, mais progresso.',
  'Ara ara… procrastinando de novo? Que decepção~',
  'O café já fez a parte dele. Agora é com você.',
  'Nem o Goku ficou forte deitado.',
  'Bora, protagonista. O arco de treinamento começa agora.',
  'Sua conta bancária pediu pra eu te lembrar: vai trabalhar.',
  'Disciplina é fazer mesmo sem vontade. Tipo agora.',
  'Ara ara~ quem não anota esquece. Quem esquece repete.',
  'Hoje não é dia de desistir. Amanhã também não.',
  'Senpai não vai te notar se as tarefas não estiverem feitas.',
  'Pobre de ideias você não é. De dinheiro, ainda. Bora mudar isso.',
  'Um hábito por vez, uma nota por vez, um boleto por vez.',
  'Menos "amanhã eu faço", mais "feito".',
  'O você do futuro está contando com você. Não passe vergonha.',
  'Ara ara… esse cérebro não vai se organizar sozinho.',
  'Trabalhe em silêncio. Deixe o saldo fazer barulho.',
];
function fraseDoDia(dia = today()) {
  const [a, m, d] = dia.split('-').map(Number);
  return FRASES[(Math.floor(Date.UTC(a, m - 1, d) / 864e5) * 7) % FRASES.length];
}
const saudacao = (hora = new Date().getHours()) => hora < 5 ? 'Boa madrugada' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
// Última nota editada, com o fim do texto: "Continuar" abre a nota já escrevendo no final.
function cardContinuar(nota) {
  if (!nota) return '';
  const ultimo = textoPlano(nota.body.trim().split(/\n\s*\n/).filter(p => textoPlano(p)).pop() || '');
  const trecho = ultimo === textoPlano(nota.title || '') ? '' : ultimo;
  const pasta = state.folders.find(f => f.id === nota.folderId);
  return `<section class="card continuar"><div class="card-head"><h2>Continuar de onde parei</h2><span class="continuar-quando">editada ${dateLabel(Kiro.localDate(new Date(nota.updatedAt))).toLowerCase()}</span></div><button type="button" class="continuar-nota" data-extra="continuar" data-id="${nota.id}"><span class="continuar-titulo">${pasta ? `<span class="pasta-chip"${pasta.color ? ` data-cor-pasta="${pasta.color}"` : ''}>${icone('pastas')}</span>` : icone('nota')} ${escapeHtml(nota.title || 'Sem título')}</span>${trecho ? `<span class="continuar-trecho">${trecho.length > 180 ? '…' : ''}${escapeHtml(trecho.slice(-180))}</span>` : ''}<span class="continuar-acao">Continuar escrevendo ${icone('direita')}</span></button></section>`;
}
// ---- Hábitos no Hoje: só os do dia, com a semana clicável e a sequência. ----
const DIAS_LETRA = ['D','S','T','Q','Q','S','S'], DIAS_CURTO = ['dom','seg','ter','qua','qui','sex','sáb'];
const rotuloDoDia = dia => new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'numeric', month:'short' }).format(new Date(`${dia}T12:00`));
function rotuloFrequencia(f) {
  if (f.type === 'weekly') return `${f.times}x por semana`;
  if (f.type !== 'days') return 'Todo dia';
  const ordem = [...f.days].sort((a,b) => ((a+6)%7) - ((b+6)%7));
  if (ordem.length === 7) return 'Todo dia';
  return ordem.join() === '1,2,3,4,5' ? 'Dias úteis' : ordem.join() === '6,0' ? 'Fim de semana' : ordem.map(d => DIAS_CURTO[d]).join(', ');
}
function cardHabitos() {
  const hoje = today();
  const [a, m, d] = hoje.split('-').map(Number), domingo = Kiro.localDate(new Date(a, m - 1, d + (7 - new Date(a, m - 1, d).getDay()) % 7));
  const doDia = state.habits.map(h => ({ h, s: Kiro.habitStats(h, state.habitLog[h.id] || [], hoje) })).filter(x => x.s.dueToday);
  const feitos = doDia.filter(x => x.s.doneToday).length;
  const linha = ({ h, s }) => {
    const semanal = h.frequency.type === 'weekly';
    const meta = [
      semanal ? `${s.weekCount}/${h.frequency.times} na semana` : rotuloFrequencia(h.frequency),
      s.streak ? `<span class="habito-sequencia">${icone('chama')} ${s.streak} ${semanal ? (s.streak === 1 ? 'semana' : 'semanas') : (s.streak === 1 ? 'dia' : 'dias')}</span>` : '',
    ].filter(Boolean).join(' · ');
    // Semana fixa de segunda a domingo: as letras não mudam de lugar; dias que ainda não chegaram ficam apagados.
    const dias = Kiro.habitDays(h, state.habitLog[h.id] || [], domingo, 7).map(d => d.date > hoje
      ? `<span class="habito-dia futuro" title="${rotuloDoDia(d.date)}">${DIAS_LETRA[new Date(`${d.date}T12:00`).getDay()]}</span>`
      : `<button type="button" class="habito-dia${d.done ? ' feito' : ''}${d.due ? '' : ' livre'}${d.date === hoje ? ' hoje' : ''}" data-action="toggle-habit-day" data-id="${h.id}|${d.date}" title="${rotuloDoDia(d.date)}${d.done ? ' · feito' : ''}" aria-label="${rotuloDoDia(d.date)}: ${d.done ? 'feito' : 'não feito'}" aria-pressed="${d.done}">${DIAS_LETRA[new Date(`${d.date}T12:00`).getDay()]}</button>`).join('');
    return `<div class="routine-item habito" data-habito="${h.id}">${check(s.doneToday, 'toggle-habit', h.id)}<div class="habito-texto"><span class="routine-title">${escapeHtml(h.title)}</span><span class="habito-meta">${meta}</span></div><div class="habito-semana">${dias}</div></div>`;
  };
  const vazio = state.habits.length
    ? '<div class="empty">Nenhum hábito para hoje.</div>'
    : `<div class="empty">Crie um hábito para acompanhar sua sequência. ${extraButton('add-habit', 'Criar hábito')}</div>`;
  return `<section class="card habitos"><div class="card-head"><h2>Hábitos</h2>${doDia.length ? `<span class="small-muted">${feitos}/${doDia.length}</span>` : ''}${extraButton('habit-stats', icone('grafico'), '', 'icon-button', 'Estatísticas dos hábitos')}${extraButton('add-habit', icone('mais'), '', 'icon-button', 'Novo hábito')}</div>${doDia.map(linha).join('') || vazio}</section>`;
}
function marcarHabito(id, dia = today()) {
  if (busy || failed || !loaded || dia > today() || !state.habits.some(h => h.id === id)) return;
  const dias = new Set(state.habitLog[id] || []);
  dias.has(dia) ? dias.delete(dia) : dias.add(dia);
  state.habitLog = { ...state.habitLog, [id]: [...dias].sort() };
  // Marcar um dia de antes da criação quer dizer que o hábito já existia: a data de início recua.
  const habito = state.habits.find(h => h.id === id), [a, m, d] = dia.split('-').map(Number), inicioDoDia = new Date(a, m - 1, d).getTime();
  if (dias.has(dia) && habito.createdAt && inicioDoDia < habito.createdAt) state.habits = state.habits.map(h => h.id === id ? { ...h, createdAt: inicioDoDia } : h);
  save();
}
function habitoModal(habito = { title: '', frequency: { type: 'daily' } }) {
  const f = habito.frequency, dias = f.type === 'days' ? f.days : [1, 3, 5];
  modal(habito.id ? 'Editar hábito' : 'Novo hábito', `<form class="form" id="habito-form">
    <div class="field"><label for="habito-titulo">Hábito</label><input id="habito-titulo" name="title" required maxlength="80" value="${escapeHtml(habito.title)}" placeholder="Ex.: Beber 2 litros de água" /></div>
    <div class="field"><span class="rotulo-campo" id="freq-rotulo">Frequência</span><div class="segmentos" role="radiogroup" aria-labelledby="freq-rotulo">${[['daily','Todo dia'],['days','Dias da semana'],['weekly','Vezes por semana']].map(([v, r]) => `<label class="segmento"><input type="radio" name="tipo" value="${v}" ${f.type === v ? 'checked' : ''} /><span>${r}</span></label>`).join('')}</div></div>
    <div class="field" id="freq-dias" ${f.type === 'days' ? '' : 'hidden'}><span class="rotulo-campo">Em quais dias</span><div class="dias-semana">${[1,2,3,4,5,6,0].map(d => `<label class="dia-chip" title="${DIAS_CURTO[d]}"><input type="checkbox" name="dias" value="${d}" ${dias.includes(d) ? 'checked' : ''} /><span>${DIAS_LETRA[d]}</span></label>`).join('')}</div></div>
    <div class="field" id="freq-vezes" ${f.type === 'weekly' ? '' : 'hidden'}><label for="habito-vezes">Quantas vezes por semana</label><input id="habito-vezes" name="vezes" type="number" min="1" max="7" value="${f.type === 'weekly' ? f.times : 3}" /></div>
    <p class="cfg-aviso" id="habito-erro" hidden>Escolha pelo menos um dia.</p>
    <div class="form-actions">${habito.id ? '<button type="button" class="secondary perigo" id="habito-excluir">Excluir</button>' : ''}<button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">${habito.id ? 'Salvar' : 'Criar hábito'}</button></div>
  </form>`);
  const form = $('#habito-form');
  form.querySelectorAll('[name="tipo"]').forEach(r => r.onchange = () => { $('#freq-dias').hidden = r.value !== 'days'; $('#freq-vezes').hidden = r.value !== 'weekly'; });
  $('#cancel').onclick = () => closeModal();
  $('#habito-excluir')?.addEventListener('click', () => { closeModal(true); excluirHabito(habito.id); });
  form.onsubmit = async e => {
    e.preventDefault();
    const dados = new FormData(form), tipo = dados.get('tipo');
    const frequency = tipo === 'days' ? { type: 'days', days: dados.getAll('dias').map(Number) } : tipo === 'weekly' ? { type: 'weekly', times: Math.min(7, Math.max(1, Number(dados.get('vezes')) || 1)) } : { type: 'daily' };
    if (!Kiro.validFrequency(frequency)) { $('#habito-erro').hidden = false; return; }
    const salvo = { ...habito, id: habito.id || uid(), title: String(dados.get('title')).trim(), frequency, createdAt: habito.createdAt || Date.now() };
    state.habits = habito.id ? state.habits.map(h => h.id === habito.id ? salvo : h) : [...state.habits, salvo];
    if (await save()) closeModal(true);
  };
}
// Confirmação dentro do Kiro, não o confirm() nativo: em alguns ambientes (Electron, navegador
// embutido) a caixa nativa não aparece ou fecha sozinha, e a exclusão parecia não fazer nada.
function excluirHabito(id) {
  const habito = state.habits.find(h => h.id === id);
  if (!habito || busy || failed || !loaded) return;
  const dias = (state.habitLog[id] || []).length;
  modal('Excluir hábito', `<p class="confirmar-texto">Excluir <strong>${escapeHtml(habito.title)}</strong>${dias ? ` e ${dias === 1 ? 'o dia marcado' : `os ${dias} dias marcados`}` : ''}? Isso não pode ser desfeito.</p><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button type="button" class="primary perigo-cheio" id="confirmar-exclusao">Excluir hábito</button></div>`);
  $('#cancel').onclick = () => closeModal(true);
  $('#confirmar-exclusao').onclick = async () => {
    state.habits = state.habits.filter(h => h.id !== id);
    const { [id]: _removido, ...resto } = state.habitLog;
    state.habitLog = resto;
    if (await save()) closeModal(true);
  };
  $('#confirmar-exclusao').focus();
}
// Botão direito num hábito (no Hoje ou nas estatísticas); o hábito é buscado na hora do clique.
function menuDoHabito(id) {
  const atual = () => state.habits.find(h => h.id === id);
  const feitoHoje = (state.habitLog[id] || []).includes(today());
  return [
    { rotulo: feitoHoje ? 'Desmarcar hoje' : 'Marcar como feito hoje', icone: icone('lista-tarefas'), acao: () => marcarHabito(id) },
    { rotulo: 'Editar hábito', icone: icone('renomear'), acao: () => atual() && habitoModal(atual()) },
    { rotulo: 'Novo hábito', icone: icone('mais'), acao: () => habitoModal() },
    { rotulo: 'Estatísticas', icone: icone('grafico'), acao: () => habitosModal() },
    { separador: true },
    { rotulo: 'Excluir hábito', icone: icone('lixeira'), acao: () => excluirHabito(id) },
  ];
}
const menuDosHabitos = () => [
  { rotulo: 'Novo hábito', icone: icone('mais'), acao: () => habitoModal() },
  { rotulo: 'Estatísticas', icone: icone('grafico'), acao: () => habitosModal() },
];
function habitosModal() {
  const hoje = today();
  const blocos = state.habits.map(h => {
    const dias = state.habitLog[h.id] || [], s = Kiro.habitStats(h, dias, hoje), semanal = h.frequency.type === 'weekly';
    const grade = Kiro.habitDays(h, dias, hoje, 35).map(d => `<span class="grade-dia${d.done ? ' feito' : ''}${d.due ? '' : ' livre'}${d.date === hoje ? ' hoje' : ''}" title="${rotuloDoDia(d.date)}${d.done ? ' · feito' : ''}"></span>`).join('');
    return `<section class="habito-stats" data-habito="${h.id}"><header><div class="cfg-texto"><span class="cfg-titulo">${escapeHtml(h.title)}</span><span class="small-muted">${rotuloFrequencia(h.frequency)}</span></div><button type="button" class="icon-button" data-editar-habito="${h.id}" aria-label="Editar hábito" title="Editar">${icone('renomear')}</button></header>
      <div class="habito-numeros"><div><b>${s.streak}</b><span>${semanal ? 'semanas seguidas' : 'dias seguidos'}</span></div><div><b>${s.rate30 === null ? '–' : s.rate30 + '%'}</b><span>nos últimos 30 dias</span></div><div><b>${s.totalDone}</b><span>vezes no total</span></div></div>
      <div class="habito-grade" aria-label="Últimas 5 semanas">${grade}</div></section>`;
  }).join('');
  modal('Seus hábitos', `<div class="habitos-lista">${blocos || '<div class="empty">Nenhum hábito ainda.</div>'}</div><div class="form-actions"><button type="button" class="secondary" id="cancel">Fechar</button><button type="button" class="primary" id="habito-novo">${icone('mais')} Novo hábito</button></div>`);
  $('#cancel').onclick = () => closeModal(true);
  $('#habito-novo').onclick = () => { closeModal(true); habitoModal(); };
  document.querySelectorAll('[data-editar-habito]').forEach(b => b.onclick = () => { const h = state.habits.find(x => x.id === b.dataset.editarHabito); closeModal(true); if (h) habitoModal(h); });
}
function renderNotes() { return `${head("Biblioteca", "Notas", "Escreva, revise e mantenha suas referências perto.", `<button class="primary" id="add-note">${icone('mais')} Nova nota</button>`)}<div class="toolbar"><input class="search" id="note-search" placeholder="Buscar texto ou #tag…" /></div><section class="notes-grid" id="notes-grid">${notesMarkup(state.notes)}</section>`; }
const linkDaNota = nota => `<a class="task-nota" data-action="edit-note" data-id="${nota.id}">${escapeHtml(nota.title || "Sem título")}</a>`;
// Prévia do card: o texto que a nota mostra, sem a sintaxe do Markdown.
function textoPlano(md) {
  return md
    .replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/!\[\[[^\]\n]*\]\]/g, '').replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2').replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]*(?:>[ \t]*)+(?:\[![^\]\n]*\][+-]?)?/gm, '')
    .replace(/^[ \t]*(?:#{1,6}|[-*+](?:[ \t]+\[[ xX]\])?|\d+\.)[ \t]+/gm, '')
    .replace(/\*\*|__|~~|`|==/g, '').replace(/\s+/g, ' ').trim();
}
function notesMarkup(notes) { return notes.length ? [...notes].sort((a,b)=>b.updatedAt-a.updatedAt).map(n=>{
  const folder=state.folders.find(f=>f.id===n.folderId);
  const ligacoes=new Set(Kiro.wikiLinks(n.body).map(l=>Kiro.normalize(l.target))).size;
  const meta=[
    folder && `<span class="pasta-chip"${folder.color?` data-cor-pasta="${folder.color}"`:""}>${icone('pastas')} ${escapeHtml(folder.path||folder.title)}</span>`,
    Kiro.tags(n).map(t=>`#${escapeHtml(t)}`).join(" "),
    ligacoes && `${ligacoes} ${ligacoes===1?"ligação":"ligações"}`,
    n.links.length && `${n.links.length} link${n.links.length===1?"":"s"} externo${n.links.length===1?"":"s"}`,
    ...(()=>{const dia=d=>new Intl.DateTimeFormat("pt-BR",{day:"numeric",month:"short"}).format(d);
      if(!n.createdAt)return [`atualizado ${dia(n.updatedAt)}`];
      return [`criada ${dia(n.createdAt)}`,new Date(n.createdAt).toDateString()!==new Date(n.updatedAt).toDateString()&&`atualizada ${dia(n.updatedAt)}`];})()
  ].filter(Boolean).join(" · ");
  return `<article class="note-card" data-action="edit-note" data-id="${n.id}"><h2>${escapeHtml(n.title || "Sem título")}</h2><p>${escapeHtml(textoPlano(n.body).slice(0,220) || "Nota vazia")}</p><div class="note-meta">${meta}</div></article>`;
}).join("") : '<div class="empty">Crie sua primeira nota para começar.</div>'; }
// Caixas "- [ ]" escritas dentro das notas, com a posição da linha para marcar sem abrir a nota.
function tarefasDasNotas() {
  const achadas = [];
  for (const nota of state.notes) {
    let pos = 0, cerca = false;
    for (const linha of nota.body.split('\n')) {
      if (/^\s*(```|~~~)/.test(linha)) cerca = !cerca;
      const m = !cerca && linha.match(/^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/);
      if (m) achadas.push({ nota, pos, feita: m[1] !== ' ', texto: textoPlano(m[2]) });
      pos += linha.length + 1;
    }
  }
  return achadas;
}
function marcarTarefaDaNota(chave) {
  const [id, pos] = [chave.slice(0, chave.lastIndexOf(':')), Number(chave.slice(chave.lastIndexOf(':') + 1))];
  const nota = getNote(id); if (!nota) return;
  const fim = nota.body.indexOf('\n', pos), linha = nota.body.slice(pos, fim < 0 ? undefined : fim);
  const trocada = linha.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/, (_, a, marca, b) => a + (marca === ' ' ? 'x' : ' ') + b);
  if (trocada === linha) return; // a nota mudou desde o desenho: não mexe em outra linha
  state.notes = state.notes.map(n => n.id === id ? { ...n, body: n.body.slice(0, pos) + trocada + n.body.slice(pos + linha.length), updatedAt: Date.now() } : n);
  save(); render();
}
function renderTasks() { const open = state.tasks.filter(t=>!t.done).sort((a,b)=>a.due.localeCompare(b.due)); const done = state.tasks.filter(t=>t.done); const dasNotas = tarefasDasNotas().filter(t=>!t.feita); return `${head("Organização", "Tarefas", "Concentre-se no que realmente importa hoje.", `<button class="primary" id="add-task">${icone('mais')} Nova tarefa</button>`)}<div class="task-layout"><section class="card"><div class="task-group"><h2>Em aberto</h2>${open.map(taskRow).join("") || '<div class="empty">Tudo concluído por aqui.</div>'}</div>${dasNotas.length ? `<div class="task-group"><h2>Nas notas</h2>${dasNotas.map(t=>`<div class="task-item">${check(false,"toggle-note-task",`${t.nota.id}:${t.pos}`)}<div class="task-title">${escapeHtml(t.texto)}<div class="task-info">${linkDaNota(t.nota)}</div></div></div>`).join("")}</div>` : ""}<div class="task-group"><h2>Concluídas</h2>${done.map(taskRow).join("") || '<div class="empty">As tarefas concluídas aparecerão aqui.</div>'}</div></section><aside class="card"><h2>Seu foco</h2><p class="subhead">Você tem <strong>${open.length}</strong> tarefa${open.length===1?"":"s"} em aberto.</p><div class="progress"><div style="width:${state.tasks.length ? done.length/state.tasks.length*100 : 0}%"></div></div><p class="small-muted">${done.length} de ${state.tasks.length} concluídas</p></aside></div>`; }
const byTitle = (a,b) => a.title.localeCompare(b.title,'pt-BR',{numeric:true});
const childFolders = id => state.folders.filter(f=>(f.parentId||"")===id).sort(byTitle);
const folderNotes = id => state.notes.filter(n=>(n.folderId||"")===id).sort(byTitle);
// Árvore no estilo de um explorador de arquivos: pastas aninhadas, notas como folhas.
// ---- Ícones ----
// Desenho vetorial no lugar de emoji e símbolos de texto: mesma grade de 24, mesma
// espessura de traço, e a cor vem do texto em volta (currentColor), então o ícone
// acompanha hover, foco e tema sem regra extra.
const TRACOS = {
  hoje: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  notas: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  tarefas: '<path d="M4 7.2 5.4 8.6 8 6M4 16.2 5.4 17.6 8 15"/><path d="M11 7h9M11 17h9"/>',
  pastas: '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  'pasta-aberta': '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v1.5"/><path d="M3.6 10.5h17.1l-2 7.2a2 2 0 0 1-1.9 1.3H6.2a2 2 0 0 1-1.9-1.4z"/>',
  'pasta-nova': '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  grafo: '<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="8" r="2.3"/><circle cx="11" cy="17.6" r="2.3"/><path d="M8.2 7.6 15.8 8.4M7.2 9.1l2.7 6.4M16.5 10.1l-4 5.5"/>',
  nota: '<path d="M12 3.6 20.4 12 12 20.4 3.6 12z"/>',
  mais: '<path d="M12 5.5v13M5.5 12h13"/>',
  calendario: '<rect x="3.5" y="5.5" width="17" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17"/>',
  exportar: '<path d="M12 4v10M8.2 10.8 12 14.5l3.8-3.7"/><path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"/>',
  importar: '<path d="M12 14.5v-10M8.2 7.7 12 4l3.8 3.7"/><path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"/>',
  recarregar: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9h-4.5"/>',
  casa: '<path d="M4 10.6 12 4l8 6.6"/><path d="M6.2 9.8V19a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.8"/><path d="M10 20v-5h4v5"/>',
  expandir: '<path d="M7 7 12 11.5 17 7M7 13 12 17.5 17 13"/>',
  recolher: '<path d="M7 17 12 12.5 17 17M7 11 12 6.5 17 11"/>',
  esquerda: '<path d="M14 5.5 7.5 12 14 18.5"/>',
  direita: '<path d="M10 5.5 16.5 12 10 18.5"/>',
  grafico: '<path d="M4 20h16M7 16.5V11M12 16.5V6M17 16.5v-3.5"/>',
  arquivar: '<path d="M4 5.5h16v4H4zM5.5 9.5V18a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.5M10 13.5h4"/>',
  chama: '<path d="M12 21c-3.6 0-6-2.5-6-5.9 0-3.2 2.3-5 3.5-7.6.4 1.7 1.4 2.8 2.4 3.1.3-2.4 1.6-4.3 3.1-5.6.5 2.7 3 4.6 3 8.5 0 4.3-2.5 7.5-6 7.5z"/>',
  fechar: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  lixeira: '<path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.8 7 7.6 19a1.5 1.5 0 0 0 1.5 1.4h5.8A1.5 1.5 0 0 0 16.4 19L17.2 7"/>',
  renomear: '<path d="M4 20h4l10.3-10.3a2.4 2.4 0 1 0-3.4-3.4L4.6 16.6z"/><path d="M13.6 7.2 16.8 10.4"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 1 0-5.1-5.1l-1.2 1.2"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 1 0 5.1 5.1l1.2-1.2"/>',
  'link-externo': '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11.5 12.5"/><path d="M18 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4.5"/>',
  'ir-para': '<path d="M4.5 12h13M12.5 7l5 5-5 5"/>',
  texto: '<path d="m5 19 6-14 6 14M7.6 14h6.8"/>',
  titulo: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  paragrafo: '<path d="M13 5v14M17.5 5v14"/><path d="M13 5h-3.2a3.6 3.6 0 0 0 0 7.2H13"/>',
  'lista-marcadores': '<path d="M9.5 7h10.5M9.5 12h10.5M9.5 17h10.5"/><circle cx="5.2" cy="7" r="1.1"/><circle cx="5.2" cy="12" r="1.1"/><circle cx="5.2" cy="17" r="1.1"/>',
  'lista-numerada': '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 6.2 5.6 5.4V10M4 14.6h2.6L4 18h2.8"/>',
  'lista-tarefas': '<path d="M11 7.5h9M11 16.5h9"/><path d="M4 7.4 5.3 8.7 7.8 6.2M4 16.4l1.3 1.3 2.5-2.5"/>',
  destaque: '<path d="M9.5 6.5h-3a2 2 0 0 0-2 2v3h5z"/><path d="M19.5 6.5h-3a2 2 0 0 0-2 2v3h5z"/><path d="M9.5 11.5c0 3.4-1.6 5.2-4.5 5.9M19.5 11.5c0 3.4-1.6 5.2-4.5 5.9"/>',
  realce: '<path d="M5 18.5h4.5l8.2-8.2a2.4 2.4 0 1 0-3.4-3.4L5 15.4z"/><path d="M4 21h6.5"/>',
  codigo: '<path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5"/>',
  plugin: '<path d="M5.5 7.5H9a2 2 0 1 1 4 0h3.5V11a2 2 0 1 1 0 4v4h-11z"/>',
  'codigo-bloco': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.2 9.8 7 12l2.2 2.2M14.8 9.8 17 12l-2.2 2.2"/>',
  tabela: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M9.6 10v9M15.2 10v9"/>',
  regua: '<path d="M4 12h16"/>',
  comentario: '<path d="M20 11.5a7 7 0 0 1-7 7H8.6L4 21.5l1.1-4.3A7 7 0 1 1 20 11.5z"/>',
  limpar: '<path d="M6 19.5h12"/><path d="M10 19.5 4.9 14.4a1.6 1.6 0 0 1 0-2.3l6.7-6.7a1.6 1.6 0 0 1 2.3 0l4.3 4.3a1.6 1.6 0 0 1 0 2.3l-7.5 7.5z"/>',
  rodape: '<path d="m4 18 4.8-11L13.5 18M6 14.4h5.6"/><circle cx="18" cy="8" r="2.2"/>',
  cortar: '<circle cx="6.2" cy="6.6" r="2.2"/><circle cx="6.2" cy="17.4" r="2.2"/><path d="M8.1 7.8 19 18.4M19 5.6 8.1 16.2"/>',
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5.6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.6"/>',
  colar: '<path d="M9.2 5.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2h-2.2"/><rect x="9.2" y="3.5" width="5.6" height="4" rx="1.2"/>',
  selecionar: '<path d="M5 8.5V6.8A1.8 1.8 0 0 1 6.8 5H8.5M15.5 5h1.7A1.8 1.8 0 0 1 19 6.8v1.7M19 15.5v1.7a1.8 1.8 0 0 1-1.8 1.8h-1.7M8.5 19H6.8A1.8 1.8 0 0 1 5 17.2v-1.7"/>',
  salvar: '<path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9L19 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="M8.5 5v4.5h6M8.5 19.5v-5h7v5"/>',
  detalhes: '<path d="M4.5 8h8M17 8h2.5M4.5 16h3M12 16h7.5"/><circle cx="14.5" cy="8" r="2.2"/><circle cx="9.5" cy="16" r="2.2"/>',
  // Temas (cards de Aparência): um desenho por tema; os de anime são homenagens em traço, sem logos.
  'tema-kiro': '<path d="M19 14.8A7.8 7.8 0 1 1 9.2 5a6.2 6.2 0 0 0 9.8 9.8z"/>',
  'tema-escuro-azul': '<path d="M12 3.5c3.3 4.1 5.8 7.2 5.8 10.6a5.8 5.8 0 0 1-11.6 0C6.2 10.7 8.7 7.6 12 3.5z"/>',
  'tema-escuro-verde': '<path d="M5.5 18.5C4.5 10.5 9.5 5 19.5 4.5 19 14.5 13.5 19.5 5.5 18.5z"/><path d="M4 20l9-9"/>',
  'tema-escuro-ambar': '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 5 4 5.5 4 8.5s-4 3.5-4 8.5M16 3.5c0 5-4 5.5-4 8.5s4 3.5 4 8.5"/><path d="M9.8 18.6h4.4" stroke-width="2.5"/>',
  'tema-alto-contraste': '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  'tema-meia-noite': '<path d="M15.5 17.2A6.8 6.8 0 1 1 8 8a5.4 5.4 0 0 0 7.5 9.2z"/><path d="M17.5 3.5v4.5M15.25 5.75h4.5"/><circle cx="20" cy="11.5" r=".8" fill="currentColor"/>',
  'tema-floresta': '<path d="M12 3.5 7 10h2.8L5.5 15.5h13L14.2 10H17z"/><path d="M12 15.5v5"/>',
  'tema-personalizado': '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.7 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6h2.1a3.9 3.9 0 0 0 3.9-3.9C20.5 6.9 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="12" r="1.1" fill="currentColor"/><circle cx="10" cy="7.6" r="1.1" fill="currentColor"/><circle cx="15" cy="7.8" r="1.1" fill="currentColor"/>',
  'tema-neon-tokyo': '<path d="M3.5 20.5h17"/><path d="M5 20.5V11h4M9 20.5V5.5h5v15M14 20.5V12h5v8.5"/><path d="M15.5 4.5h2.5v5.5h-2.5" stroke-width="1.5"/>',
  'tema-sakura-night': '<path d="M12 12C9.4 10 8.6 7.3 9.8 4.4L12 5.8l2.2-1.4c1.2 2.9.4 5.6-2.2 7.6z"/><path d="M12 12C9.4 10 8.6 7.3 9.8 4.4L12 5.8l2.2-1.4c1.2 2.9.4 5.6-2.2 7.6z" transform="rotate(72 12 12)"/><path d="M12 12C9.4 10 8.6 7.3 9.8 4.4L12 5.8l2.2-1.4c1.2 2.9.4 5.6-2.2 7.6z" transform="rotate(144 12 12)"/><path d="M12 12C9.4 10 8.6 7.3 9.8 4.4L12 5.8l2.2-1.4c1.2 2.9.4 5.6-2.2 7.6z" transform="rotate(216 12 12)"/><path d="M12 12C9.4 10 8.6 7.3 9.8 4.4L12 5.8l2.2-1.4c1.2 2.9.4 5.6-2.2 7.6z" transform="rotate(288 12 12)"/>',
  'tema-shonen-fire': '<path d="M12 21a6.2 6.2 0 0 1-6.2-6.2c0-3.1 1.9-4.6 2.1-7.6 1.6 1 2.6 2.5 2.7 4.1.4-3.2 2.1-5.8 4.6-7.8-.2 3.6 3 5.7 3 10.8A6.2 6.2 0 0 1 12 21z"/><path d="M12 21c-1.7 0-2.9-1.2-2.9-2.9 0-1.6 1.4-2.5 1.9-4.1 1.6 1 3 2.3 3 4.2 0 1.6-.8 2.8-2 2.8z"/>',
  'tema-studio-ghibli': '<path d="M12 4l1.8 2.3 2.7-1 .3 2.9 2.7.7-1.3 2.5 2 2.1-2.5 1.4.6 2.8-2.9-.1-1.1 2.7-2.3-1.7-2.3 1.7-1.1-2.7-2.9.1.6-2.8-2.5-1.4 2-2.1-1.3-2.5 2.7-.7.3-2.9 2.7 1z"/><circle cx="9.9" cy="12.3" r="1.3"/><circle cx="14.1" cy="12.3" r="1.3"/>',
  'tema-evangelion': '<path d="M8.4 4.4 12 6.5v4.2l-3.6 2.1-3.6-2.1V6.5zM15.6 4.4l3.6 2.1v4.2l-3.6 2.1-3.6-2.1M12 10.7l3.6 2.1V17L12 19.1 8.4 17v-4.2"/>',
  'tema-sailor-moon': '<path d="M5 8a7 7 0 0 0 14 0 9 9 0 0 1-14 0z"/><path d="M12 15v4"/><circle cx="12" cy="20.6" r="1.2"/><path d="M12 3.8l.6 1.6 1.7.1-1.3 1 .4 1.6-1.4-.8-1.4.8.4-1.6-1.3-1 1.7-.1z" fill="currentColor" stroke-width="1"/>',
  'tema-violet-evergarden': '<rect x="3.5" y="10" width="12.5" height="9.5" rx="1.5"/><path d="m3.8 11 6 4.3 6-4.3"/><path d="M20.5 3.5c-4.2.8-7.2 3.6-8.2 7.4 3.6-.9 6.7-3.6 8.2-7.4zM17.5 6.5l-5.5 5.5"/>',
  'tema-demon-blood': '<path d="M20.5 3.5C18 8 14.6 11.6 10.6 13.4"/><path d="M7.6 11.4l5 5"/><path d="M10.1 13.9 4 20"/><path d="M6.6 17.4l.9.9" stroke-width="2.6"/>',
  'tema-cyber-lain': '<path d="M3.5 4.5Q12 10.5 20.5 4.5M3.5 8Q12 13.5 20.5 8"/><path d="m5.5 14 3 2.5-3 2.5M11.5 19h6"/>',
  'tema-makoto-shinkai': '<path d="M3.5 19.5h6l2-2 2 2h7"/><circle cx="7.5" cy="12" r="2"/><path d="M9.2 10.9 19.5 4.5M9.5 12.4l11-2.9"/><circle cx="17" cy="14" r=".7" fill="currentColor"/>',
  'tema-jojo-stand': '<path d="M12 4.4l2.1 5.7 6.1.2-4.8 3.8 1.7 5.9-5.1-3.4-5.1 3.4 1.7-5.9-4.8-3.8 6.1-.2z"/><path d="M3.5 3.5l1.8 1.8M20.5 3.5l-1.8 1.8"/>',
};
const icone = (nome, classe = '') => `<svg class="icone${classe ? ' ' + classe : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TRACOS[nome] || ''}</svg>`;
// Ícones do HTML fixo: o marcador data-icone vira desenho quando o app abre.
function desenharIconesFixos() {
  for (const alvo of document.querySelectorAll('[data-icone]')) {
    if (!alvo.querySelector('svg')) alvo.insertAdjacentHTML('afterbegin', icone(alvo.dataset.icone));
  }
}

function treeMarkup(parentId, depth) {
  if (depth > 20) return ""; // guarda contra ciclo, mesmo que validateState já recuse
  const folders = childFolders(parentId).map(folder => {
    const open = expanded.has(folder.id);
    const temFilhos = childFolders(folder.id).length || folderNotes(folder.id).length;
    const tools = `<span class="tree-tools"><button class="icon-button" data-action="new-note-folder" data-id="${folder.id}" title="Nova nota nesta pasta">${icone('mais')}</button><button class="icon-button" data-action="new-subfolder" data-id="${folder.id}" title="Nova subpasta">${icone('pasta-nova')}</button><button class="icon-button" data-action="edit-folder" data-id="${folder.id}" title="Renomear ou mover">${icone('renomear')}</button><button class="icon-button" data-action="delete-folder" data-id="${folder.id}" title="Excluir">${icone('lixeira')}</button></span>`;
    // Filhos ficam sempre no DOM: abrir e fechar vira transição de CSS, sem redesenhar.
    return `<div class="tree-node${open?" open":""}" data-id="${folder.id}"${folder.color?` data-cor-pasta="${folder.color}"`:""}><div class="tree-row tree-folder" data-action="toggle-folder" data-id="${folder.id}" style="--depth:${depth}"${folder.description?` title="${escapeHtml(folder.description)}"`:""}><span class="twisty">${temFilhos?icone('direita'):""}</span><span class="tree-icone">${icone('pastas')}</span><span class="tree-name" title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</span>${tools}</div><div class="tree-children"><div class="tree-children-inner">${treeMarkup(folder.id,depth+1)}</div></div></div>`;
  }).join("");
  const notes = folderNotes(parentId).map(note => {
    const tags = Kiro.tags(note).slice(0,2).map(t=>`#${escapeHtml(t)}`).join(" ");
    return `<div class="tree-row tree-note${editing?.id === note.id ? " ativa" : ""}" draggable="true" data-action="edit-note" data-id="${note.id}" style="--depth:${depth}"><span class="twisty"></span><span class="tree-icone">${icone('nota')}</span><span class="tree-name" title="${escapeHtml(note.title||"Sem título")}">${escapeHtml(note.title||"Sem título")}</span><span class="tree-meta">${tags}</span></div>`;
  }).join("");
  return folders + notes;
}
// Anima a altura em pixels: height:auto não é interpolável, e o interpolate-size
// que resolveria isso é desligado pelo navegador sob "reduzir movimento".
function toggleFolder(id) {
  const node = document.querySelector(`.tree-node[data-id="${id}"]`);
  if (!node) return render();
  const caixa = node.querySelector(":scope > .tree-children");
  const abrir = !node.classList.contains("open");
  const alvo = caixa.firstElementChild.scrollHeight;
  node.classList.toggle("open", abrir);
  caixa.style.height = `${abrir ? 0 : alvo}px`;
  void caixa.offsetHeight; // fixa o ponto de partida antes de mudar o destino
  caixa.style.height = `${abrir ? alvo : 0}px`;
  clearTimeout(caixa._t);
  caixa._t = setTimeout(() => { if (node.classList.contains("open")) caixa.style.height = "auto"; }, 280);
}
// Barra lateral do cofre recolhível: recolhida, sobra só a casinha. A escolha fica
// no navegador (localStorage), como a aparência: é preferência de tela, não dado do cofre.
// Preferências de tela salvas por instalação. A chave antiga (kuroi.*) ainda é lida:
// quem usava o aplicativo com o nome anterior não perde o que tinha escolhido.
const lerPreferencia = chave => { try { return localStorage.getItem(`kiro.${chave}`) ?? localStorage.getItem(`kuroi.${chave}`); } catch { return null; } };
let lateralRecolhida = lerPreferencia('lateralRecolhida') === '1';
function botaoLateral() {
  const acao = lateralRecolhida ? 'Mostrar barra lateral' : 'Esconder barra lateral';
  return `<button class="icon-button cofre-alternar" data-cofre="alternar" title="${acao}" aria-label="${acao}" aria-expanded="${!lateralRecolhida}">${icone(lateralRecolhida ? 'direita' : 'esquerda')}</button>`;
}
function alternarLateral() {
  lateralRecolhida = !lateralRecolhida;
  try { localStorage.setItem('kiro.lateralRecolhida', lateralRecolhida ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
  document.querySelector('.app-shell').classList.toggle('lateral-recolhida', lateralRecolhida);
  // Atualiza o botão em vez de trocá-lo, para não tirar o foco de quem usa o teclado.
  const botao = document.querySelector('[data-cofre="alternar"]');
  if (!botao) return;
  const modelo = document.createElement('template');
  modelo.innerHTML = botaoLateral();
  const novo = modelo.content.firstElementChild;
  for (const nome of ['title', 'aria-label', 'aria-expanded']) botao.setAttribute(nome, novo.getAttribute(nome));
  botao.innerHTML = novo.innerHTML;
}
// Modo cofre: árvore à esquerda, nota à direita, sem a navegação principal.
// A casinha devolve o usuário à tela inicial, onde a navegação completa vive.
function renderCofre() {
  if (expanded === null) expanded = new Set(state.folders.map(f => f.id));
  const arvore = treeMarkup('', 0) || '<div class="empty">Crie uma pasta para começar.</div>';
  const direita = editing ? renderEditor() : `<div class="cofre-vazio">
    <p>Escolha uma nota na árvore ao lado.</p>
    <button class="secondary" id="add-note-cofre">${icone('mais')} Nova nota</button>
  </div>`;
  return `<div class="cofre">
  <aside class="cofre-lateral">
    <header class="cofre-topo">
      <button class="icon-button" data-cofre="casa" title="Voltar ao início" aria-label="Voltar ao início">${icone('casa')}</button>
      <span class="cofre-nome">Cofre</span>
      <span class="cofre-acoes">
        <button class="icon-button" id="add-folder" title="Nova pasta">${icone('pasta-nova')}</button>
        <button class="icon-button" id="expand-all" title="Expandir tudo">${icone('expandir')}</button>
        <button class="icon-button" id="collapse-all" title="Recolher tudo">${icone('recolher')}</button>
      </span>
      ${botaoLateral()}
    </header>
    <div class="tree">${arvore}</div>
    <footer class="cofre-rodape"><span class="small-muted">${state.folders.length} pasta${state.folders.length === 1 ? '' : 's'} · ${state.notes.length} nota${state.notes.length === 1 ? '' : 's'}</span></footer>
  </aside>
  <section class="cofre-nota">${direita}</section>
</div>`;
}
function bindView() {
  document.querySelector('#add-note')?.addEventListener('click',()=>abrirNota(notaVazia()));
  document.querySelector('#add-task')?.addEventListener('click',()=>taskModal());
  document.querySelector('#add-folder')?.addEventListener('click',()=>folderModal());
  // Limpar a altura embutida devolve o controle ao CSS (0 ou auto), sem animar em massa.
  const abrirTodas=abrir=>{expanded=abrir?new Set(state.folders.map(f=>f.id)):new Set();document.querySelectorAll('.tree-node').forEach(n=>{n.classList.toggle('open',abrir);const c=n.querySelector(':scope > .tree-children');if(c){clearTimeout(c._t);c.style.height='';}});};
  document.querySelector('#expand-all')?.addEventListener('click',()=>abrirTodas(true));
  document.querySelector('#collapse-all')?.addEventListener('click',()=>abrirTodas(false));
  document.querySelector('#note-search')?.addEventListener('input',e=>{
    const q=Kiro.normalize(e.target.value);
    document.querySelector('#notes-grid').innerHTML=notesMarkup(state.notes.filter(n=>q.startsWith('#') ? Kiro.tags(n).some(t=>Kiro.normalize(t).includes(q.slice(1))) : Kiro.normalize(n.title+' '+n.body+' '+Kiro.tags(n).join(' ')).includes(q)));
  });
  if(currentView==="graph"){bindGraph();return;}
  if(currentView==="studies"){
    document.querySelector('[data-cofre="casa"]')?.addEventListener('click',()=>irPara('today'));
    // Delegado: a seta esconde ou mostra; com a barra recolhida, clicar na faixa também reabre.
    document.querySelector('.cofre-lateral')?.addEventListener('click',e=>{if(e.target.closest('[data-cofre="alternar"]')||(lateralRecolhida&&!e.target.closest('button')))alternarLateral();});
    document.querySelector('#add-note-cofre')?.addEventListener('click',()=>abrirNota(notaVazia()));
    if(editing)bindEditor();
    return;
  }
  enhanceView();
}
function action(type,id) {
  // Abrir/fechar é só visual: continua funcionando durante um salvamento ou após falha.
  if(type==="toggle-folder"){
    if(!expanded)return;
    expanded.has(id)?expanded.delete(id):expanded.add(id);
    toggleFolder(id);
    return;
  }
  if (busy || failed || !loaded) return;
  if(type==="new-subfolder") folderModal({title:"",description:"",parentId:id}); if(type==="toggle-habit") marcarHabito(id); if(type==="toggle-habit-day"){const [habito,dia]=id.split("|");marcarHabito(habito,dia);} if(type==="toggle-task"){const t=state.tasks.find(x=>x.id===id);t.done=!t.done;save();render();} if(type==="toggle-note-task") marcarTarefaDaNota(id); if(type==="edit-note") abrirNota(getNote(id)); if(type==="new-note-folder") abrirNota(notaVazia({folderId:id})); if(type==="edit-task") taskModal(state.tasks.find(x=>x.id===id)); if(type==="edit-folder") folderModal(state.folders.find(x=>x.id===id)); if(type==="delete-task"){state.tasks=state.tasks.filter(x=>x.id!==id);save();render();} if(type==="delete-folder") deleteFolder(id); }
// Excluir uma pasta leva junto suas subpastas; as notas continuam no cofre, na raiz.
function deleteFolder(id) {
  const ids=Kiro.descendants(state.folders,id);
  const notes=state.notes.filter(n=>ids.has(n.folderId));
  if((ids.size>1||notes.length)&&!confirm(`Esta pasta contém ${ids.size-1} subpasta${ids.size===2?"":"s"} e ${notes.length} nota${notes.length===1?"":"s"}. As subpastas serão excluídas e as notas irão para a raiz do cofre. Continuar?`))return;
  state.notes=state.notes.map(n=>ids.has(n.folderId)?{...n,folderId:""}:n);
  state.folders=state.folders.filter(f=>!ids.has(f.id));
  save();render();
}
// Mover nota entre pastas: pelo arrastar na árvore ou pelo menu do botão direito.
async function moverNota(id, folderId) {
  if (busy || failed || !loaded) return;
  const nota = getNote(id);
  if (!nota || (nota.folderId || '') === folderId) return;
  if (folderId && expanded) expanded.add(folderId);
  // A nota aberta leva junto o que ainda não foi salvo.
  if (editing?.id === id) { editing.folderId = folderId; editorDirty = true; await salvarNota(); return; }
  state.notes = state.notes.map(n => n.id === id ? { ...n, folderId, updatedAt: Date.now() } : n);
  await save();
}
const bolinha = cor => `<svg class="icone" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" style="fill:${cor ? `var(--cor-pasta)` : 'none'};stroke:var(--muted)" data-cor-pasta="${cor}"/></svg>`;
// As ações buscam a nota ou a pasta na hora do clique: a releitura do cofre a cada 5 s troca
// os objetos de state, e alterar a cópia de quando o menu abriu não seria gravado.
function menuDaArvore(linha) {
  const id = linha.dataset.id, pastaAtual = () => state.folders.find(f => f.id === id);
  if (linha.classList.contains('tree-note')) {
    const destinos = [{ id: '', rotulo: 'Raiz do cofre' }, ...state.folders.slice().sort((a, b) => (a.path || a.title).localeCompare(b.path || b.title, 'pt-BR')).map(f => ({ id: f.id, rotulo: f.path || f.title }))];
    return [
      { rotulo: 'Abrir', icone: icone('nota'), acao: () => getNote(id) && abrirNota(getNote(id)) },
      { rotulo: 'Mover para', icone: icone('pastas'), filhos: destinos.map(d => ({ rotulo: d.rotulo, icone: icone(d.id ? 'pastas' : 'casa'), ativo: () => (getNote(id)?.folderId || '') !== d.id, acao: () => moverNota(id, d.id) })) },
    ];
  }
  return [
    { rotulo: 'Nova nota aqui', icone: icone('mais'), acao: () => abrirNota(notaVazia({ folderId: id })) },
    { rotulo: 'Nova subpasta', icone: icone('pasta-nova'), acao: () => folderModal({ title: '', description: '', parentId: id }) },
    { separador: true },
    { rotulo: 'Renomear ou mover', icone: icone('renomear'), acao: () => pastaAtual() && folderModal(pastaAtual()) },
    { rotulo: 'Cor', icone: icone('realce'), filhos: ['', ...Kiro.FOLDER_COLORS].map(cor => ({ rotulo: NOMES_DE_COR[cor], icone: bolinha(cor), ativo: () => (pastaAtual()?.color || '') !== cor, acao: () => { const pasta = pastaAtual(); if (pasta) { pasta.color = cor; save(); } } })) },
    { separador: true },
    { rotulo: 'Excluir pasta', icone: icone('lixeira'), acao: () => deleteFolder(id) },
  ];
}
function modal(title, body) { modalDirty=false; document.querySelector("#modal-root").innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h2>${title}</h2><button class="icon-button" id="close-modal" title="Fechar" aria-label="Fechar">${icone('fechar')}</button></header>${body}</section></div>`; document.querySelector(".modal").addEventListener("input",()=>modalDirty=true); document.querySelector(".modal").addEventListener("change",()=>modalDirty=true); document.querySelector("#close-modal").onclick=()=>closeModal(); document.querySelector(".modal-backdrop").onclick=e=>{if(e.target===e.currentTarget)closeModal();}; }
function closeModal(force=false){ if(!force && (busy || (modalDirty && !confirm('Descartar as alterações deste formulário?'))))return false; document.querySelector('#modal-root').innerHTML='';modalDirty=false;return true; }
function taskModal(task={title:"",due:today(),priority:"Média",noteId:""}) { modal(task.id?"Editar tarefa":"Nova tarefa", `<form class="form" id="task-form"><div class="field"><label>Tarefa</label><input name="title" required value="${escapeHtml(task.title)}" placeholder="O que precisa ser feito?" /></div><div class="two-cols"><div class="field"><label>Data</label><input name="due" type="date" value="${task.due}" required /></div><div class="field"><label>Prioridade</label><select name="priority">${["Baixa","Média","Alta"].map(p=>`<option ${p===task.priority?"selected":""}>${p}</option>`).join("")}</select></div></div><div class="field"><label>Nota associada (opcional)</label><select name="noteId"><option value="">Nenhuma</option>${state.notes.map(n=>`<option value="${n.id}" ${n.id===task.noteId?"selected":""}>${escapeHtml(n.title)}</option>`).join("")}</select></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Salvar tarefa</button></div></form>`);document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#task-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const saved={...task,id:task.id||uid(),title:f.get("title"),due:f.get("due"),priority:f.get("priority"),noteId:f.get("noteId"),done:task.done||false};state.tasks=task.id?state.tasks.map(t=>t.id===task.id?saved:t):[saved,...state.tasks];save();closeModal(true);render();}; }
const NOMES_DE_COR = { "":"Sem cor", azul:"Azul", verde:"Verde", amarelo:"Amarelo", laranja:"Laranja", vermelho:"Vermelho", rosa:"Rosa", roxo:"Roxo", cinza:"Cinza" };
function folderModal(folder={title:"",description:"",parentId:""}) { modal(folder.id?"Editar pasta":"Nova pasta de estudo", `<form class="form" id="folder-form"><div class="field"><label>Nome da pasta</label><input name="title" required value="${escapeHtml(folder.title)}" placeholder="Ex.: JAVA, Inglês, programação" /><small class="small-muted">Vira uma pasta de verdade no cofre: sem &lt; &gt; : " / \\ | ? * e sem ponto ou espaço no início ou no final.</small></div><div class="field"><label>Dentro de</label><select name="parentId"><option value="">Raiz do cofre</option>${state.folders.filter(f=>!(folder.id?Kiro.descendants(state.folders,folder.id):new Set()).has(f.id)).sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===(folder.parentId||"")?"selected":""}>${escapeHtml(f.path||f.title)}</option>`).join("")}</select></div><div class="field"><span class="rotulo-campo" id="cor-pasta-rotulo">Cor</span><div class="amostras" role="radiogroup" aria-labelledby="cor-pasta-rotulo">${["",...Kiro.FOLDER_COLORS].map(cor=>`<label class="amostra" data-cor-pasta="${cor}" title="${NOMES_DE_COR[cor]}"><input type="radio" name="color" value="${cor}" ${cor===(folder.color||"")?"checked":""} /><span class="sr-only">${NOMES_DE_COR[cor]}</span></label>`).join("")}</div></div><div class="field"><label>Descrição</label><textarea name="description" placeholder="Qual é seu objetivo com esta pasta?">${escapeHtml(folder.description||"")}</textarea></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Salvar pasta</button></div></form>`);document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#folder-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=f.get("title").trim();
  // Validar aqui evita que um nome inválido bloqueie a janela no salvamento.
  if(!Kiro.validFolderName(title)){alert('Nome de pasta inválido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.');return;}
  const parentId=f.get("parentId")||"";
  const saved={...folder,id:folder.id||uid(),title,parentId,description:f.get("description"),color:Kiro.folderColor(f.get("color"))};
  if(state.folders.some(x=>x.id!==saved.id&&(x.parentId||"")===parentId&&Kiro.pathKey(x.title)===Kiro.pathKey(title))){alert("Já existe uma pasta com esse nome neste local.");return;}
  state.folders=folder.id?state.folders.map(x=>x.id===folder.id?saved:x):[saved,...state.folders];
  // Deixar visível o que acabou de ser criado ou movido.
  if(expanded){expanded.add(saved.id);if(parentId)expanded.add(parentId);}
  save();closeModal(true);currentView="studies";render();}; }
let busy=false, failed=false, loaded=false, modalDirty=false, lastDay=today();
// null = ainda não semeado; na primeira exibição a árvore abre inteira.
let expanded=null, renderedView=null, editing=null, editorDirty=false, grafoRaf=null, blocoAberto=null;
const notaVazia = (extra={}) => ({title:"",body:"",links:[],tags:[],folderId:"",...extra});
const $ = selector => document.querySelector(selector);
const templates={
  study:{title:'Resumo de estudo',body:'# Objetivo\n\n## Ideias principais\n\n## Exemplos\n\n## Perguntas\n\n## Próximos passos\n- [ ] Revisar\n'},
  meeting:{title:'Reunião',body:'# Contexto\n\n## Anotações\n\n## Decisões\n\n## Ações\n- [ ] \n'},
  daily:{title:'Nota diária',body:'# Foco do dia\n\n## Capturas\n\n## O que aprendi\n\n## Amanhã\n'}
};
async function api(endpoint,data){
  const response=await fetch(`/api/${endpoint}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível acessar o cofre.');return result;
}
// Abertura: some assim que o cofre carrega, mas fica tempo suficiente para a marca ser vista.
const abertura=document.getElementById('abertura');
function fecharAbertura(){
  if(!abertura||!abertura.isConnected||abertura.classList.contains('saindo'))return;
  setTimeout(()=>{abertura.classList.add('saindo');setTimeout(()=>abertura.remove(),450);},Math.max(0,1200-performance.now()));
}
// Cofre lento ou com erro: a abertura sai de qualquer jeito, nunca prende a tela.
setTimeout(fecharAbertura,4000);
function status(message,error=false){$('#save-status').textContent=message;$('#save-status').classList.toggle('error',error);}
function setBusy(value){busy=value;document.body.classList.toggle('saving',value);$('.app-shell').inert=value;$('#modal-root').inert=value;}
async function reload(manual=false){
  if(busy||(!manual&&(failed||editorDirty||$('#modal-root').firstChild)))return;
  if(manual&&(failed||modalDirty||editorDirty)&&!confirm('Recarregar descarta alterações ainda não salvas nesta janela. Exporte seus dados ou copie o texto antes de continuar. Recarregar?'))return;
  setBusy(true);
  try{
    const saved=await loadFromVault();Kiro.validateState(saved);
    const changed=state.revision!==saved.revision||!loaded;
    state=saved;loaded=true;failed=false;eventosDoCofre(null);
    // Recarregar de propósito descarta a edição: a nota aberta volta ao que está no cofre.
    if(manual&&editing){const n=editing.id&&getNote(editing.id);editing=n?{...n,tags:[...(n.tags||[])],links:[...(n.links||[])]}:null;editorDirty=false;if(!editing)currentView='today';}
    if(manual)closeModal(true);if(changed||manual)render();status('Cofre atualizado');
  }catch(error){status('Não foi possível ler o cofre: '+error.message,true);}
  finally{setBusy(false);fecharAbertura();}
}
const itemQueAbre=n=>`<div class="routine-item"><span class="brand-mark">${icone('nota')}</span><a class="routine-title" data-action="edit-note" data-id="${n.id}">${escapeHtml(n.title||'Sem título')}</a></div>`;
function cardCaixaDeEntrada(){
  const notas=state.notes.filter(Kiro.inInbox).sort((a,b)=>(b.createdAt??b.updatedAt)-(a.createdAt??a.updatedAt));
  return `<section class="card caixa-entrada"><div class="card-head"><h2>Caixa de entrada</h2><span class="small-muted">${notas.length}</span></div>${notas.map(n=>`<div class="routine-item"><span class="brand-mark">${icone('nota')}</span><a class="routine-title" data-action="edit-note" data-id="${n.id}">${escapeHtml(n.title||'Sem título')}</a><span class="caixa-acoes">${extraButton('inbox-mover',icone('pastas'),n.id,'icon-button','Mover para pasta')}${extraButton('inbox-arquivar',icone('arquivar'),n.id,'icon-button','Arquivar (tirar da caixa)')}</span></div>`).join('')||'<div class="empty">Nada pendente. Tudo organizado.</div>'}</section>`;
}
function cardParaRevisar(){
  const {loose,forgotten}=Kiro.toReview(state.notes);
  if(!loose.length&&!forgotten.length)return '';
  const lista=(titulo,notas)=>notas.length?`<h3 class="revisar-titulo">${titulo}</h3>${notas.map(itemQueAbre).join('')}`:'';
  return `<section class="card para-revisar"><div class="card-head"><h2>Para revisar</h2></div>${lista('Soltas',loose)}${lista('Esquecidas',forgotten)}</section>`;
}
// Tirar da caixa de entrada (e, se vier uma pasta, mover para ela) numa gravação só.
async function tirarDaCaixa(id,folderId){
  if(busy||failed||!loaded)return;
  state.notes=state.notes.map(n=>n.id===id?{...Kiro.withoutInbox(n),...(folderId===undefined?{}:{folderId}),updatedAt:Date.now()}:n);
  if(folderId&&expanded)expanded.add(folderId);
  await save();
}
const extraButton=(action,label,id='',cls='secondary',nome='')=>`<button type="button" class="${cls}" data-extra="${action}" data-id="${escapeHtml(id)}"${nome?` aria-label="${nome}" title="${nome}"`:''}>${label}</button>`;
function enhanceView(){
  if(currentView!=='today')return;
  // Captura numa faixa própria logo abaixo da frase, na largura dos cards: não depende de quantas linhas a frase ocupa.
  $('.page-head').insertAdjacentHTML('afterend',`<div class="hoje-acoes"><form id="capture-form" class="capture add-link"><label for="capture-text" class="sr-only">Captura rápida</label>${icone('mais')}<input id="capture-text" required autocomplete="off" placeholder="Capturar uma ideia, pergunta ou lembrete…" /><kbd class="atalho" title="De qualquer tela">Ctrl + Espaço</kbd><button class="primary">Guardar</button></form>${extraButton('daily',`${icone('calendario')} Nota diária`,'','secondary')}</div>`);
  $('#capture-form').onsubmit=async e=>{e.preventDefault();if(await capturar($('#capture-text').value))$('#capture-text')?.focus();};
  desenharPaineisDosPlugins();
}
// Uma captura vira nota na caixa de entrada; o título é a primeira linha sem sintaxe.
async function capturar(texto){
  const body=String(texto||'').trim();if(!body||busy||failed||!loaded)return false;
  state.notes.unshift({id:uid(),title:(textoPlano(body.split('\n')[0]).replace(/(^|\s)#(?=[\p{L}\p{N}_/-])/gu,'$1')||body).slice(0,80),body,links:[],tags:['inbox'],createdAt:Date.now(),updatedAt:Date.now(),folderId:''});
  return save();
}
// Ctrl+Espaço de qualquer tela: no Hoje vai para a faixa de captura; fora dele abre uma janela pequena.
function capturaRapida(){
  if(!loaded||failed||busy)return;
  if(currentView==='today'&&$('#capture-text')&&!$('#modal-root').firstChild){$('#capture-text').focus();return;}
  if($('#modal-root').firstChild)return;
  modal('Captura rápida',`<form class="form" id="captura-janela"><input class="search captura-janela" id="captura-janela-texto" required autocomplete="off" placeholder="Capturar uma ideia, pergunta ou lembrete…" aria-label="Captura rápida" /><p class="small-muted">Vai para a caixa de entrada do Hoje. Enter guarda, Esc fecha.</p></form>`);
  const campo=$('#captura-janela-texto');
  campo.addEventListener('input',e=>e.stopPropagation()); // digitar não pede "descartar" ao fechar com Esc
  $('#captura-janela').onsubmit=async e=>{e.preventDefault();if(await capturar(campo.value))closeModal(true);};
  campo.focus();
}
// ---- Editor de documento: a nota ocupa a página inteira, como um processador de texto. ----
async function abrirNota(nota){
  if(editing&&editorDirty&&!await salvarNota())return;
  editing={...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]};
  if(editing.id)ultimaNota=editing.id; // centro do grafo local
  editorDirty=false;currentView='studies';render();
}
async function irPara(destino){ if(editing) return void await sairDoEditor(destino); currentView=destino; render(); }
async function sairDoEditor(destino){
  if(editorDirty&&!await salvarNota())return false;
  editing=null;currentView=destino;render();return true;
}
function renderEditor(){
  const nota=editing, pasta=state.folders.find(f=>f.id===nota.folderId);
  const opcoes=`<option value="">Raiz do cofre</option>`+state.folders.slice().sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===nota.folderId?'selected':''}>${escapeHtml(f.path||f.title)}</option>`).join('');
  const modelos=Object.entries(templates).map(([k,t])=>`<option value="${k}">${escapeHtml(t.title)}</option>`).join('');
  return `<header class="doc-bar"><div class="crumbs"><span>${pasta?escapeHtml(pasta.path||pasta.title):'Raiz do cofre'}</span><span>/</span><span class="crumb-atual">${escapeHtml(nota.title||'Sem título')}</span></div><span class="doc-ponto" id="doc-state" title="Alterações não salvas"></span></header>
<input class="doc-title" id="doc-title" value="${escapeHtml(nota.title)}" placeholder="Sem título" aria-label="Título da nota" />
<section class="doc-details" id="doc-details" hidden><div class="two-cols"><div class="field"><label for="doc-folder">Pasta</label><select id="doc-folder">${opcoes}</select></div><div class="field"><label for="doc-tags">Tags (separadas por vírgulas)</label><input id="doc-tags" value="${escapeHtml(nota.tags.join(', '))}" placeholder="ideias, estudos" /></div></div><div class="two-cols"><div class="field"><label for="doc-template">Modelo</label><select id="doc-template"><option value="">Escolher modelo…</option>${modelos}</select></div><div class="field"><label for="doc-link">Anexar link</label><div class="add-link"><input id="doc-link" placeholder="Cole um link de aula ou vídeo" /><button type="button" class="secondary" id="doc-link-add">Anexar</button></div></div></div><div class="links-list" id="doc-links"></div></section>
<div class="doc-corpo" id="doc-corpo" data-vazio="Clique para escrever. [[Nome da nota]] conecta ideias e #tag marca a nota.">${renderizarMarkdown(nota.body)}</div>${renderMencoes(nota)}`;
}
// Quem cita esta nota, com a linha do [[link]] como trecho. Nota ainda não salva não tem quem a cite.
function renderMencoes(nota){
  if(!nota.id)return '';
  const citam=Kiro.mentions(state.notes,nota); if(!citam.length)return '';
  const resolve=l=>Kiro.findLinkedNote(state.notes,l.target)?.id===nota.id;
  const itens=citam.map(n=>{
    const linha=n.body.split('\n').find(l=>Kiro.wikiLinks(l).some(resolve))||'';
    return `<div class="mencao">${linkDaNota(n)}<span class="small-muted">${escapeHtml(textoPlano(linha).slice(0,160))}</span></div>`;
  }).join('');
  return `<section class="doc-mencoes"><h2 class="small-muted">Mencionada em (${citam.length})</h2>${itens}</section>`;
}
function estadoDoc(){ $('#doc-state')?.classList.toggle('sujo', editorDirty); }
function desenharLinksDoc(){
  const caixa=$('#doc-links'); if(!caixa) return;
  caixa.innerHTML=editing.links.map((l,i)=>`<div class="link-row"><a href="${escapeHtml(Kiro.safeUrl(l)||'#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a><button class="icon-button" type="button" data-remove-link="${i}" title="Remover link" aria-label="Remover link">${icone('fechar')}</button></div>`).join('');
  caixa.querySelectorAll('[data-remove-link]').forEach(b=>b.onclick=()=>{editing.links.splice(+b.dataset.removeLink,1);editorDirty=true;estadoDoc();desenharLinksDoc();});
}
function bindEditor(){
  const titulo=$('#doc-title'), corpo=$('#doc-corpo');
  blocoAberto=null; // o campo da nota anterior saiu junto com o HTML antigo
  const sujar=()=>{editorDirty=true;estadoDoc();};
  titulo.oninput=()=>{editing.title=titulo.value;sujar();};
  // Enter ou seta para baixo no título descem para o texto, como num processador de texto.
  titulo.onkeydown=e=>{
    if(e.key!=='Enter'&&e.key!=='ArrowDown')return;
    e.preventDefault();
    const primeiro=corpo.querySelector(':scope > [data-pos]');
    primeiro?abrirBloco(primeiro,0):abrirNoFim();
  };
  $('#doc-folder').onchange=e=>{editing.folderId=e.target.value;sujar();};
  $('#doc-tags').oninput=e=>{editing.tags=e.target.value.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean);sujar();};
  $('#doc-template').onchange=e=>{
    if(!e.target.value)return;
    if(editing.body.trim()&&!confirm('Substituir o texto desta nota pelo modelo?')){e.target.value='';return;}
    blocoAberto=null;
    editing.body=templates[e.target.value].body;corpo.innerHTML=renderizarMarkdown(editing.body);sujar();
  };
  $('#doc-link-add').onclick=()=>{
    const campo=$('#doc-link'), valor=campo.value.trim();
    if(!Kiro.safeUrl(valor)){alert('Informe um endereço http:// ou https:// válido.');return;}
    editing.links.push(valor);campo.value='';sujar();desenharLinksDoc();
  };
  bindCorpo(corpo);
  document.querySelectorAll('[data-editor]').forEach(b=>b.onclick=()=>acaoEditor(b.dataset.editor));
  desenharLinksDoc();estadoDoc();
  $('.cofre-nota')?.scrollTo(0, 0);
  // Nota nova começa pelo título; nota existente sem texto já abre o campo para escrever.
  if(!editing.id)titulo.focus({preventScroll:true});
  else if(!editing.body.trim())abrirNoFim();
}
// ---- Grafo de conexões ----
// As ligações são derivadas do texto, como no resto do Kiro: não há índice a
// manter. Simulação de forças escrita à mão porque a CSP é script-src 'self':
// nada de biblioteca por CDN, e o app não tem etapa de build.
// As opções da tela ficam no navegador, como a aparência: são preferência de
// visualização, não dado do cofre.
const GRAFO_PADRAO = {
  busca: '', etiquetas: false, anexos: false, somenteExistentes: false, orfaos: true,
  setas: false, rotulos: 0.6, tamanho: 1, grossura: 1,
  centripeta: 0.5, repulsao: 1, forcaLinks: 1, distancia: 95,
  local: false, profundidade: 1,
  corSolta: '#FFFFFF', grupos: [], painel: false, secoes: { filtros: true, grupos: true, tela: true, forcas: true },
};
const CORES_DE_GRUPO = ['#4EA8DE', '#57CC99', '#FFB703', '#FF6B6B', '#F72585', '#C77DFF'];
const FILTROS = ['etiquetas', 'anexos', 'somenteExistentes', 'orfaos', 'local', 'profundidade'];
// A nota aberta mais recentemente é o centro do grafo local.
let ultimaNota = null;
let grafoOpcoes = { ...GRAFO_PADRAO, ...(() => { try { return JSON.parse(lerPreferencia('grafo') || '{}'); } catch { return {}; } })() };
let grafoObservador = null, grafoResize = null;
function gravarGrafoOpcoes() {
  try { localStorage.setItem('kiro.grafo', JSON.stringify(grafoOpcoes)); } catch { /* janela privada: vale só nesta sessão */ }
}
const valorDoGrafo = (nome, valor) => ['distancia', 'profundidade'].includes(nome) ? String(Math.round(valor)) : Number(valor).toFixed(2);

// Subpasta sem cor herda a cor da pasta de cima.
function corDaPasta(id) {
  for (let f = state.folders.find(x => x.id === id), i = 0; f && i < 50; f = state.folders.find(x => x.id === f.parentId), i++) if (f.color) return f.color;
  return '';
}
function grafoDados(op = grafoOpcoes) {
  const nos = new Map(), arestas = [];
  const ligar = (de, para) => { arestas.push({ de, para }); nos.get(de).grau++; nos.get(para).grau++; nos.get(para).entradas++; };
  for (const nota of state.notes) nos.set(nota.id, { id: nota.id, rotulo: nota.title || 'Sem título', tipo: 'nota', pasta: corDaPasta(nota.folderId), grau: 0, entradas: 0, procura: `${nota.title || ''} ${Kiro.tags(nota).join(' ')}` });
  for (const nota of state.notes) {
    const vistos = new Set();
    for (const link of Kiro.wikiLinks(nota.body)) {
      const alvo = Kiro.findLinkedNote(state.notes, link.target);
      const chave = alvo ? alvo.id : `fantasma:${Kiro.pathKey(link.target)}`;
      if (chave === nota.id || vistos.has(chave) || (!alvo && op.somenteExistentes)) continue;
      vistos.add(chave);
      // Link para nota inexistente vira nó fantasma: mostra o que você pretendia criar.
      if (!nos.has(chave)) nos.set(chave, { id: chave, rotulo: link.target, tipo: 'fantasma', grau: 0, entradas: 0 });
      ligar(nota.id, chave);
    }
    if (op.etiquetas) for (const etiqueta of Kiro.tags(nota)) {
      const chave = `etiqueta:${Kiro.pathKey(etiqueta)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (!nos.has(chave)) nos.set(chave, { id: chave, rotulo: `#${etiqueta}`, tipo: 'etiqueta', grau: 0, entradas: 0 });
      ligar(nota.id, chave);
    }
    if (op.anexos) for (const achado of imagensNaFonte(nota.body)) {
      const chave = `anexo:${Kiro.pathKey(achado.imagem.caminho)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      if (!nos.has(chave)) nos.set(chave, { id: chave, rotulo: achado.imagem.caminho.split('/').pop(), tipo: 'anexo', grau: 0, entradas: 0 });
      ligar(nota.id, chave);
    }
  }
  let lista = [...nos.values()];
  // Grafo local: parte da última nota aberta e caminha pelas ligações.
  if (op.local && nos.has(ultimaNota)) {
    const alcance = new Set([ultimaNota]);
    let borda = new Set([ultimaNota]);
    for (let salto = 0; salto < op.profundidade; salto++) {
      const proxima = new Set();
      for (const aresta of arestas) {
        if (borda.has(aresta.de) && !alcance.has(aresta.para)) { alcance.add(aresta.para); proxima.add(aresta.para); }
        if (borda.has(aresta.para) && !alcance.has(aresta.de)) { alcance.add(aresta.de); proxima.add(aresta.de); }
      }
      borda = proxima;
    }
    lista = lista.filter(no => alcance.has(no.id));
  }
  if (!op.orfaos) lista = lista.filter(no => no.grau > 0);
  const vivos = new Set(lista.map(no => no.id));
  return { nos: lista, arestas: arestas.filter(a => vivos.has(a.de) && vivos.has(a.para)) };
}

const grafoChave = (nome, rotulo) =>
  `<label class="grafo-linha"><span>${rotulo}</span><input type="checkbox" data-opcao="${nome}"${grafoOpcoes[nome] ? ' checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>`;
const grafoFaixa = (nome, rotulo, min, max, passo) =>
  `<div class="grafo-faixa"><div class="grafo-faixa-topo"><span>${rotulo}</span><span class="small-muted" data-valor="${nome}">${valorDoGrafo(nome, grafoOpcoes[nome])}</span></div>` +
  `<input type="range" data-opcao="${nome}" min="${min}" max="${max}" step="${passo}" value="${grafoOpcoes[nome]}" aria-label="${rotulo}" /></div>`;

const grafoSecao = (chave, titulo, conteudo, acoes = '') => {
  const aberta = grafoOpcoes.secoes?.[chave] !== false;
  return `<section class="grafo-secao${aberta ? ' aberta' : ''}" data-secao="${chave}">
      <h3><button type="button" class="grafo-secao-botao" data-alternar="${chave}" aria-expanded="${aberta}">${icone('direita', 'grafo-seta')}<span>${titulo}</span></button>${acoes}</h3>
      <div class="grafo-secao-corpo">${conteudo}</div>
    </section>`;
};

// Quantas notas o filtro deixou e, no grafo local, em volta de quem.
function textoDoResumo(nos, ligacoes) {
  const notas = nos.filter(no => no.tipo === 'nota').length;
  const centro = grafoOpcoes.local ? state.notes.find(nota => nota.id === ultimaNota) : null;
  const volta = grafoOpcoes.local
    ? (centro ? `ao redor de “${centro.title}” · ` : 'abra uma nota para centrar o grafo · ')
    : '';
  return `${volta}${notas} nota${notas === 1 ? '' : 's'} · ${ligacoes.length} ligaç${ligacoes.length === 1 ? 'ão' : 'ões'}`;
}

function renderGraph() {
  const { nos, arestas } = grafoDados();
  const resumo = escapeHtml(textoDoResumo(nos, arestas));
  const vazio = state.notes.length
    ? ''
    : '<div class="grafo-vazio">Escreva [[Nome da nota]] em alguma nota para as ligações aparecerem aqui.</div>';
  return `<div class="grafo-tela${grafoOpcoes.painel ? '' : ' sem-painel'}" id="grafo-tela">
  <svg id="graph-svg" role="img" aria-label="Grafo de conexões entre as notas"></svg>
  ${vazio}
  <span class="grafo-resumo small-muted">${resumo}</span>
  <button class="icon-button grafo-abrir" id="grafo-abrir" title="Mostrar opções" aria-label="Mostrar opções">${icone('detalhes')}</button>
  <aside class="grafo-painel" id="grafo-painel" aria-label="Opções do grafo">
    ${grafoSecao('filtros', 'Filtros', `
      <input class="grafo-busca" type="search" data-opcao="busca" value="${escapeHtml(grafoOpcoes.busca)}" placeholder="Procurar notas…" aria-label="Procurar notas" />
      ${grafoChave('etiquetas', 'Etiquetas')}
      ${grafoChave('anexos', 'Anexos')}
      ${grafoChave('somenteExistentes', 'Apenas notas existentes')}
      ${grafoChave('orfaos', 'Órfãs')}
      ${grafoChave('local', 'Somente ao redor da nota aberta')}
      ${grafoFaixa('profundidade', 'Passos a partir dela', 1, 3, 1)}`,
      `<span class="grafo-topo-acoes">
        <button class="icon-button" id="grafo-restaurar" title="Voltar ao padrão" aria-label="Voltar ao padrão">${icone('recarregar')}</button>
        <button class="icon-button" id="grafo-fechar" title="Esconder opções" aria-label="Esconder opções">${icone('fechar')}</button>
      </span>`)}
    ${grafoSecao('grupos', 'Grupos', `
      <div id="grafo-grupos"></div>
      <button class="secondary" id="grafo-novo-grupo">Criar novo grupo</button>`)}
    ${grafoSecao('tela', 'Tela', `
      ${grafoChave('setas', 'Setas')}
      ${grafoFaixa('rotulos', 'Limite dos rótulos', 0, 2, 0.05)}
      ${grafoFaixa('tamanho', 'Tamanho dos pontos', 0.4, 2.5, 0.05)}
      ${grafoFaixa('grossura', 'Grossura dos links', 0.3, 3, 0.05)}
      <label class="grafo-linha"><span>Notas sem cor de pasta</span><input type="color" class="grafo-cor-solta" data-opcao="corSolta" value="${corValida(grafoOpcoes.corSolta) ? grafoOpcoes.corSolta : GRAFO_PADRAO.corSolta}" aria-label="Cor das notas sem cor de pasta" /></label>
      <button class="secondary" id="grafo-animar">Animar</button>`)}
    ${grafoSecao('forcas', 'Forças', `
      ${grafoFaixa('centripeta', 'Força centrípeta', 0, 2, 0.02)}
      ${grafoFaixa('repulsao', 'Força de repulsão', 0.1, 4, 0.05)}
      ${grafoFaixa('forcaLinks', 'Força dos links', 0, 3, 0.05)}
      ${grafoFaixa('distancia', 'Distância dos links', 40, 400, 5)}`)}
  </aside>
</div>`;
}

function bindGraph() {
  const svg = $('#graph-svg'), tela = $('#grafo-tela');
  if (!svg || !tela) return;
  const ns = 'http://www.w3.org/2000/svg';
  const semMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AMORTECIMENTO = 0.86, MAXV = 12;
  let largura = 800, altura = 520, nos = [], ligacoes = [], vizinhos = new Map();
  let camera = null, grupoArestas = null, grupoNos = null;
  let escala = 1, deslocX = 0, deslocY = 0;
  let arrastando = null, arrastou = false, ultimo = null, quadros = 0, alfa = 1;

  // Tamanho pelo número de links recebidos: as notas mais citadas ficam maiores.
  // Raiz quadrada para que uma nota muito citada não vire um disco gigante.
  const raio = no => (4.5 + Math.sqrt(no.entradas || 0) * 3.4) * grafoOpcoes.tamanho;
  // "procura", não "texto": no.texto é o elemento <text> do rótulo, criado no desenho.
  const procuravel = no => Kiro.normalize(no.procura || no.rotulo);
  const corDoNo = no => grafoOpcoes.grupos.find(g => g.consulta.trim() && procuravel(no).includes(Kiro.normalize(g.consulta)))?.cor || '';

  function medir() {
    largura = Math.max(320, tela.clientWidth);
    altura = Math.max(260, tela.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  }
  function espalhar(embaralhar) {
    nos.forEach((no, i) => {
      if (!embaralhar && Number.isFinite(no.x)) return;
      const angulo = (i / nos.length) * Math.PI * 2 + (embaralhar ? Math.random() * 0.5 : 0);
      const r = Math.min(largura, altura) * 0.32;
      no.x = largura / 2 + Math.cos(angulo) * r;
      no.y = altura / 2 + Math.sin(angulo) * r;
      no.vx = 0; no.vy = 0;
    });
  }
  function destacar(id) {
    for (const no of nos) no.el.classList.toggle('apagado', Boolean(id) && no.id !== id && !vizinhos.get(id).has(no.id));
    for (const l of ligacoes) {
      l.el.classList.toggle('aceso', Boolean(id) && (l.a.id === id || l.b.id === id));
      l.el.classList.toggle('apagado', Boolean(id) && l.a.id !== id && l.b.id !== id);
    }
  }
  // Aparência sem refazer o desenho: tamanho, cor, grossura, setas, busca e rótulos.
  function pintar() {
    const busca = Kiro.normalize(grafoOpcoes.busca.trim());
    tela.style.setProperty('--grafo-solta', corValida(grafoOpcoes.corSolta) ? grafoOpcoes.corSolta : GRAFO_PADRAO.corSolta);
    for (const no of nos) {
      const r = raio(no);
      no.circulo.setAttribute('r', r);
      no.alvo.setAttribute('r', r + 9);
      no.texto.setAttribute('y', r + 13);
      no.circulo.style.fill = corDoNo(no);
      no.el.classList.toggle('filtrado', Boolean(busca) && !procuravel(no).includes(busca));
    }
    for (const l of ligacoes) {
      // Estilo embutido, não atributo: o atributo perde para a regra .graph-edge do CSS.
      l.el.style.strokeWidth = `${(1.2 * grafoOpcoes.grossura).toFixed(2)}px`;
      if (grafoOpcoes.setas) l.el.setAttribute('marker-end', 'url(#grafo-seta)');
      else l.el.removeAttribute('marker-end');
    }
    svg.classList.toggle('sem-rotulos', escala < grafoOpcoes.rotulos);
  }
  function montar() {
    const dados = grafoDados();
    nos = dados.nos;
    const porId = new Map(nos.map(no => [no.id, no]));
    ligacoes = dados.arestas.map(a => ({ a: porId.get(a.de), b: porId.get(a.para) })).filter(l => l.a && l.b);
    vizinhos = new Map(nos.map(no => [no.id, new Set()]));
    for (const l of ligacoes) { vizinhos.get(l.a.id).add(l.b.id); vizinhos.get(l.b.id).add(l.a.id); }
    // O resumo é refeito a cada filtro, junto com o desenho.
    const linhaResumo = $('.grafo-resumo');
    if (linhaResumo) linhaResumo.textContent = textoDoResumo(nos, ligacoes);
    medir();
    espalhar(false);
    svg.innerHTML = '<defs><marker id="grafo-seta" viewBox="0 0 8 8" refX="9" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8z" fill="#4a4a56" /></marker></defs>';
    camera = document.createElementNS(ns, 'g');
    grupoArestas = document.createElementNS(ns, 'g');
    grupoNos = document.createElementNS(ns, 'g');
    camera.append(grupoArestas, grupoNos);
    svg.appendChild(camera);
    for (const l of ligacoes) {
      l.el = document.createElementNS(ns, 'line');
      l.el.setAttribute('class', 'graph-edge');
      grupoArestas.appendChild(l.el);
    }
    for (const no of nos) {
      no.el = document.createElementNS(ns, 'g');
      no.el.setAttribute('class', `graph-node tipo-${no.tipo}`);
      if (no.pasta) no.el.setAttribute('data-cor-pasta', no.pasta);
      no.alvo = document.createElementNS(ns, 'circle');
      no.alvo.setAttribute('class', 'graph-hit');
      no.circulo = document.createElementNS(ns, 'circle');
      no.texto = document.createElementNS(ns, 'text');
      no.texto.textContent = no.rotulo.length > 26 ? `${no.rotulo.slice(0, 25)}…` : no.rotulo;
      no.el.append(no.alvo, no.circulo, no.texto);
      if (no.tipo === 'nota') no.el.addEventListener('click', () => { if (!arrastou) abrirNota(getNote(no.id)); });
      no.el.addEventListener('pointerenter', () => destacar(no.id));
      no.el.addEventListener('pointerleave', () => destacar(null));
      grupoNos.appendChild(no.el);
    }
    pintar();
    aplicarCamera();
    comecar();
  }

  // Um passo da simulação. As três forças do painel agem juntas, todas medidas
  // pelo alfa: ele começa em 1 e decai, então o desenho se acomoda em vez de
  // vibrar para sempre. Arrastar um nó reacende o alfa.
  function passo() {
    const repulsao = 5200 * grafoOpcoes.repulsao, mola = 0.018 * grafoOpcoes.forcaLinks;
    const comprimento = grafoOpcoes.distancia, gravidade = 0.012 * grafoOpcoes.centripeta;
    const raios = nos.map(raio);
    for (let i = 0; i < nos.length; i++) {
      for (let j = i + 1; j < nos.length; j++) {
        const a = nos[i], b = nos[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2), f = repulsao / d2 * alfa;
        a.vx -= f * dx / d; a.vy -= f * dy / d;
        b.vx += f * dx / d; b.vy += f * dy / d;
        // Encostaram: afasta na hora, metade do caminho para cada lado. É o que
        // impede dois pontos de ficarem um por cima do outro com a repulsão fraca.
        const minimo = raios[i] + raios[j] + 6;
        if (d < minimo) {
          const empurrao = (minimo - d) / 2, ux = dx / d, uy = dy / d;
          if (a !== arrastando) { a.x -= ux * empurrao; a.y -= uy * empurrao; }
          if (b !== arrastando) { b.x += ux * empurrao; b.y += uy * empurrao; }
        }
      }
    }
    for (const l of ligacoes) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - comprimento) * mola * alfa;
      l.a.vx += f * dx / d; l.a.vy += f * dy / d;
      l.b.vx -= f * dx / d; l.b.vy -= f * dy / d;
    }
    let energia = 0, somaX = 0, somaY = 0;
    for (const no of nos) {
      no.vx = (no.vx + (largura / 2 - no.x) * gravidade * alfa) * AMORTECIMENTO;
      no.vy = (no.vy + (altura / 2 - no.y) * gravidade * alfa) * AMORTECIMENTO;
      const v = Math.hypot(no.vx, no.vy);
      if (v > MAXV) { no.vx = no.vx / v * MAXV; no.vy = no.vy / v * MAXV; }
      if (no !== arrastando) { no.x += no.vx; no.y += no.vy; }
      energia += v; somaX += no.x; somaY += no.y;
    }
    // Recentraliza o conjunto inteiro em vez de apertar cada ponto contra o meio:
    // o desenho fica na tela sem achatar quem está na borda.
    const desvioX = somaX / nos.length - largura / 2, desvioY = somaY / nos.length - altura / 2;
    for (const no of nos) if (no !== arrastando) { no.x -= desvioX * 0.08; no.y -= desvioY * 0.08; }
    alfa *= 0.985;
    return nos.length ? energia / nos.length : 0;
  }
  function desenhar() {
    for (const l of ligacoes) {
      l.el.setAttribute('x1', l.a.x); l.el.setAttribute('y1', l.a.y);
      l.el.setAttribute('x2', l.b.x); l.el.setAttribute('y2', l.b.y);
    }
    for (const no of nos) no.el.setAttribute('transform', `translate(${no.x} ${no.y})`);
  }
  function animar() {
    const energia = passo();
    desenhar();
    if (alfa > 0.02 && energia > 0.05 && ++quadros < 3000) grafoRaf = requestAnimationFrame(animar);
    else grafoRaf = null;
  }
  function comecar() {
    cancelAnimationFrame(grafoRaf);
    // Rede de segurança: se a janela mudou de tamanho sem que o aviso chegasse,
    // a medida certa entra aqui, antes de a simulação recomeçar.
    medir();
    quadros = 0; alfa = 1;
    if (!nos.length) return;
    if (semMovimento) { for (let i = 0; i < 400; i++) passo(); desenhar(); }
    else animar();
  }

  // Câmera: arrastar o fundo move, roda do mouse aproxima.
  const aplicarCamera = () => {
    camera?.setAttribute('transform', `translate(${deslocX} ${deslocY}) scale(${escala})`);
    svg.classList.toggle('sem-rotulos', escala < grafoOpcoes.rotulos);
  };
  svg.addEventListener('pointerdown', evento => {
    arrastou = false;
    ultimo = { x: evento.clientX, y: evento.clientY };
    const alvo = evento.target.closest('.graph-node');
    arrastando = alvo ? nos.find(no => no.el === alvo) : null;
    if (arrastando) { arrastando.vx = 0; arrastando.vy = 0; destacar(arrastando.id); comecar(); }
    svg.setPointerCapture(evento.pointerId);
  });
  svg.addEventListener('pointermove', evento => {
    if (!ultimo) return;
    const dx = evento.clientX - ultimo.x, dy = evento.clientY - ultimo.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) arrastou = true;
    ultimo = { x: evento.clientX, y: evento.clientY };
    const proporcao = largura / (svg.clientWidth || largura);
    if (arrastando) {
      arrastando.x += dx * proporcao / escala;
      arrastando.y += dy * proporcao / escala;
      // Zerar a velocidade evita que o nó saia voando ao ser solto, e reiniciar a
      // contagem de quadros mantém os vizinhos acompanhando enquanto se arrasta.
      // Zerar a velocidade evita que o nó saia voando ao ser solto; reiniciar a
      // contagem de quadros mantém o grafo se reorganizando durante todo o arraste.
      arrastando.vx = 0; arrastando.vy = 0; quadros = 0; alfa = Math.max(alfa, 0.45);
      // Dois passos a cada movimento: os vizinhos se reorganizam junto com a mão,
      // sem depender do próximo quadro de animação.
      passo(); passo(); desenhar();
      if (!grafoRaf && !semMovimento) animar();
    } else {
      deslocX += dx * proporcao; deslocY += dy * proporcao;
      aplicarCamera();
    }
  });
  const soltar = evento => { if (arrastando) { arrastando.vx = 0; arrastando.vy = 0; destacar(null); comecar(); } arrastando = null; ultimo = null; try { svg.releasePointerCapture(evento.pointerId); } catch { /* já solto */ } };
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);
  svg.addEventListener('wheel', evento => {
    evento.preventDefault();
    const antes = escala;
    escala = Math.max(0.3, Math.min(3, escala * (evento.deltaY < 0 ? 1.12 : 0.89)));
    // Mantém o ponto sob o cursor parado durante o zoom.
    const caixa = svg.getBoundingClientRect();
    const px = (evento.clientX - caixa.left) * (largura / caixa.width);
    const py = (evento.clientY - caixa.top) * (altura / caixa.height);
    deslocX = px - (px - deslocX) * (escala / antes);
    deslocY = py - (py - deslocY) * (escala / antes);
    aplicarCamera();
  }, { passive: false });

  // Painel de opções.
  const painel = $('#grafo-painel');
  const mostrarPainel = mostrar => { grafoOpcoes.painel = mostrar; gravarGrafoOpcoes(); tela.classList.toggle('sem-painel', !mostrar); medir(); };
  $('#grafo-abrir').onclick = () => mostrarPainel(true);
  $('#grafo-fechar').onclick = () => mostrarPainel(false);
  $('#grafo-restaurar').onclick = () => { grafoOpcoes = { ...GRAFO_PADRAO, painel: grafoOpcoes.painel }; gravarGrafoOpcoes(); render(); };
  $('#grafo-animar').onclick = () => { escala = 1; deslocX = 0; deslocY = 0; aplicarCamera(); espalhar(true); comecar(); };
  for (const campo of painel.querySelectorAll('[data-opcao]')) {
    campo.addEventListener('input', () => {
      const nome = campo.dataset.opcao;
      grafoOpcoes[nome] = campo.type === 'checkbox' ? campo.checked : campo.type === 'range' ? Number(campo.value) : campo.value;
      gravarGrafoOpcoes();
      painel.querySelector(`[data-valor="${nome}"]`) && (painel.querySelector(`[data-valor="${nome}"]`).textContent = valorDoGrafo(nome, grafoOpcoes[nome]));
      // Filtro muda quem está no grafo; o resto é só aparência ou força.
      if (FILTROS.includes(nome)) montar();
      else if (['busca', 'rotulos', 'corSolta'].includes(nome)) pintar();
      else { pintar(); comecar(); }
    });
  }
  function desenharGrupos() {
    const caixa = $('#grafo-grupos');
    caixa.innerHTML = grafoOpcoes.grupos.map((grupo, i) =>
      `<div class="grafo-grupo"><button class="grafo-cor" data-cor="${i}" style="background:${grupo.cor}" title="Trocar a cor" aria-label="Trocar a cor"></button>` +
      `<input data-grupo="${i}" value="${escapeHtml(grupo.consulta)}" placeholder="palavra do título" aria-label="Palavra do grupo" />` +
      `<button class="icon-button" data-remover="${i}" title="Remover grupo" aria-label="Remover grupo">${icone('fechar')}</button></div>`).join('');
    for (const campo of caixa.querySelectorAll('[data-grupo]')) campo.addEventListener('input', () => {
      grafoOpcoes.grupos[+campo.dataset.grupo].consulta = campo.value; gravarGrafoOpcoes(); pintar();
    });
    for (const bolinha of caixa.querySelectorAll('[data-cor]')) bolinha.addEventListener('click', () => {
      const grupo = grafoOpcoes.grupos[+bolinha.dataset.cor];
      grupo.cor = CORES_DE_GRUPO[(CORES_DE_GRUPO.indexOf(grupo.cor) + 1) % CORES_DE_GRUPO.length];
      bolinha.style.background = grupo.cor; gravarGrafoOpcoes(); pintar();
    });
    for (const botao of caixa.querySelectorAll('[data-remover]')) botao.addEventListener('click', () => {
      grafoOpcoes.grupos.splice(+botao.dataset.remover, 1); gravarGrafoOpcoes(); desenharGrupos(); pintar();
    });
  }
  $('#grafo-novo-grupo').onclick = () => {
    grafoOpcoes.grupos.push({ consulta: '', cor: CORES_DE_GRUPO[grafoOpcoes.grupos.length % CORES_DE_GRUPO.length] });
    gravarGrafoOpcoes(); desenharGrupos();
    $('#grafo-grupos .grafo-grupo:last-child input')?.focus();
  };
  desenharGrupos();
  for (const botao of painel.querySelectorAll('[data-alternar]')) botao.addEventListener('click', () => {
    const secao = painel.querySelector(`[data-secao="${botao.dataset.alternar}"]`);
    const aberta = !secao.classList.contains('aberta');
    secao.classList.toggle('aberta', aberta);
    botao.setAttribute('aria-expanded', String(aberta));
    grafoOpcoes.secoes = { ...grafoOpcoes.secoes, [botao.dataset.alternar]: aberta };
    gravarGrafoOpcoes();
  });

  // A tela acompanha a janela: redimensionar recentraliza em vez de cortar o grafo.
  // O observador cobre mudanças de layout (esconder o painel, por exemplo), mas só
  // é avisado quando a página está sendo desenhada; o evento da janela chega sempre.
  grafoObservador?.disconnect();
  grafoObservador = new ResizeObserver(() => { medir(); comecar(); });
  grafoObservador.observe(tela);
  if (grafoResize) window.removeEventListener('resize', grafoResize);
  grafoResize = () => { if ($('#graph-svg') === svg) { medir(); comecar(); } };
  window.addEventListener('resize', grafoResize);
  montar();
}

// ---- Renderização de Markdown para leitura ----
// O corpo da nota continua sendo Markdown puro no disco. Isto só desenha.
// Tudo é escapado antes de qualquer transformação: nada do texto vira HTML.
const desescapar = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---- Imagens na nota ----
// Lê o miolo de ![[...]]. A largura é o último pedaço depois de "|" quando é número
// (300, ou 300x200 como no Obsidian); o resto é o caminho dentro do cofre.
function lerImagem(dentro) {
  const partes = dentro.split('|');
  const medida = partes.length > 1 && /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(partes[partes.length - 1]);
  const caminho = (medida ? partes.slice(0, -1) : partes).join('|').trim();
  if (!Kiro.isImagePath(caminho)) return null;
  return { caminho, largura: medida ? Number(medida[1]) : null };
}
// No desktop a imagem vem pelo esquema kiro-anexo://, no navegador pela rota /anexo/.
function urlDoAnexo(caminho) {
  const partes = caminho.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return window.cadernoDesktop ? `kiro-anexo://cofre/${partes}` : `/anexo/${partes}`;
}
function htmlDaImagem({ caminho, largura }) {
  const nome = escapeHtml(caminho.split('/').pop());
  return `<span class="md-imagem" data-nome="${nome}"><img src="${escapeHtml(urlDoAnexo(caminho))}" alt="${nome}" draggable="false"${largura ? ` style="width:${largura}px"` : ''} /><span class="md-alca" title="Arraste para redimensionar" aria-hidden="true"></span></span>`;
}
// As imagens de um trecho da fonte, na mesma ordem em que mdInline as desenha: as
// crases são mascaradas antes, porque o que está em código não vira imagem.
function imagensNaFonte(fonte) {
  const mascarada = fonte.replace(/`[^`\n]+`/g, trecho => ' '.repeat(trecho.length));
  return [...mascarada.matchAll(/!\[\[([^\][\n]+)\]\]/g)]
    .map(achado => ({ inicio: achado.index, fim: achado.index + achado[0].length, imagem: lerImagem(fonte.slice(achado.index + 3, achado.index + achado[0].length - 2)) }))
    .filter(achado => achado.imagem);
}

// ---- Equações ----
// O KaTeX desenha; ele vem embarcado em vendor/katex e não é buscado na internet.
// Sem ele, a fórmula continua visível como texto em vez de sumir da nota.
function matematica(fonte, bloco) {
  if (typeof katex === 'undefined') return `<code>${escapeHtml(fonte)}</code>`;
  try {
    return katex.renderToString(fonte, { displayMode: bloco, throwOnError: false, output: 'html', strict: false, trust: false });
  } catch (erro) {
    return `<span class="math-erro" title="${escapeHtml(erro.message)}">${escapeHtml(fonte)}</span>`;
  }
}

function mdInline(texto) {
  const guardado = [];
  const reservar = html => `\u0000${guardado.push(html) - 1}\u0000`;
  return texto
    // Código em linha primeiro: o que estiver dentro dele não sofre mais nenhuma troca.
    .replace(/`([^`\n]+)`/g, (_, c) => reservar(`<code>${c}</code>`))
    // $x^2$: equação na linha. O texto precisa estar colado aos cifrões, senão
    // "R$ 5 e R$ 10" viraria fórmula.
    .replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, (_, tex) => reservar(matematica(desescapar(tex), false)))
    // ![[caminho|largura]]: imagem do cofre, com alça para redimensionar. Antes dos
    // links, para o [[...]] de dentro não virar ligação entre notas.
    .replace(/!\[\[([^\][\n]+)\]\]/g, (inteiro, dentro) => {
      const imagem = lerImagem(desescapar(dentro));
      return imagem ? reservar(htmlDaImagem(imagem)) : inteiro;
    })
    .replace(/\[\[([^\][\n]+)\]\]/g, (_, dentro) => {
      const [alvoBruto, rotuloBruto] = dentro.split('|');
      const alvo = alvoBruto.split('#')[0].trim();
      const rotulo = (rotuloBruto || alvoBruto).trim();
      const nota = Kiro.findLinkedNote(state.notes, desescapar(alvo));
      return reservar(`<a class="wikilink${nota ? '' : ' ausente'}" data-alvo="${alvo}"${nota ? ` data-id="${nota.id}"` : ''} title="${nota ? 'Abrir nota' : 'Nota ainda não criada'}">${rotulo}</a>`);
    })
    .replace(/\[([^\][\n]*)\]\(([^)\s]+)\)/g, (inteiro, rotulo, url) => {
      const limpa = Kiro.safeUrl(desescapar(url));
      return limpa ? reservar(`<a href="${limpa}" target="_blank" rel="noopener noreferrer">${rotulo || url}</a>`) : inteiro;
    })
    .replace(/\*\*([^\n*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^\n~]+)~~/g, '<s>$1</s>')
    .replace(/==([^\n=]+)==/g, '<mark>$1</mark>')
    .replace(/%%([^\n%]+)%%/g, '<span class="md-comentario">$1</span>')
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1<span class="md-tag">#$2</span>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => guardado[+i]);
}

/** Converte o Markdown em HTML. Cada bloco guarda em data-pos e data-fim o trecho
 *  da fonte que ocupa, somado a `base` quando só um pedaço da nota é desenhado. */
function renderizarMarkdown(fonte, base = 0) {
  const linhas = fonte.split('\n');
  const saida = [];
  let posicao = 0, i = 0;
  const avancar = n => { for (let k = 0; k < n; k++) posicao += linhas[i + k].length + 1; };
  // Chamado antes de `i` avançar: o bloco vai da linha i até a linha anterior a `ate`.
  const abrir = (inicio, ate) => `data-pos="${base + inicio}" data-fim="${base + inicio + linhas.slice(i, ate).join('\n').length}"`;

  while (i < linhas.length) {
    const linha = linhas[i];
    const inicio = posicao;
    const cerca = linha.match(/^```([^\n`]*)$/);
    if (cerca) {
      const corpo = [];
      let j = i + 1;
      while (j < linhas.length && !/^```\s*$/.test(linhas[j])) corpo.push(linhas[j++]);
      const codigo = escapeHtml(corpo.join('\n'));
      const linguagem = escapeHtml(cerca[1].trim() || 'texto');
      const ate = Math.min(j + 1, linhas.length);
      // ```kiro:<id>: o plug-in desenha depois; a fonte fica na nota, intacta.
      const doPlugin = cerca[1].trim().match(/^kiro:([a-z0-9][a-z0-9-]{1,39})$/);
      if (doPlugin) {
        const fonteDoBloco = corpo.join('\n');
        saida.push(`<figure class="plugin-bloco" data-plugin="${doPlugin[1]}" data-fonte="${escapeHtml(fonteDoBloco)}" ${abrir(inicio, ate)}><div class="plugin-bloco-conteudo" data-desenho="${pluginsAtivos.has(doPlugin[1]) && conteudoDosBlocos.has(`${doPlugin[1]}\n${fonteDoBloco}`) ? 'pronto' : 'aviso'}">${conteudoDoBloco(doPlugin[1], fonteDoBloco)}</div></figure>`);
        agendarBlocosDosPlugins();
        avancar(ate - i);
        i = j + 1;
        continue;
      }
      saida.push(`<figure class="code-area" ${abrir(inicio, ate)}><figcaption><span class="code-lang">${linguagem}</span><button type="button" class="secondary code-copy">Copiar</button></figcaption><pre><code>${codigo}</code></pre></figure>`);
      avancar(ate - i);
      i = j + 1;
      continue;
    }
    // $$ … $$: equação em bloco, desenhada no lugar em que foi escrita.
    const equacao = linha.match(/^\$\$(.*)$/);
    if (equacao) {
      const corpo = [];
      let j;
      const numaLinha = equacao[1].trim();
      if (numaLinha.endsWith('$$') && numaLinha.length > 2) { corpo.push(numaLinha.slice(0, -2)); j = i + 1; }
      else {
        j = i + 1;
        while (j < linhas.length && !/^\$\$\s*$/.test(linhas[j])) corpo.push(linhas[j++]);
        j = Math.min(j + 1, linhas.length);
      }
      saida.push(`<div class="math-bloco" ${abrir(inicio, j)}>${matematica(corpo.join('\n').trim(), true)}</div>`);
      avancar(j - i); i = j; continue;
    }
    if (!linha.trim()) { avancar(1); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(linha)) { saida.push(`<hr ${abrir(inicio, i + 1)} />`); avancar(1); i++; continue; }
    const titulo = linha.match(/^(#{1,6})\s+(.*)$/);
    if (titulo) {
      const nivel = titulo[1].length;
      saida.push(`<h${nivel} ${abrir(inicio, i + 1)}>${mdInline(escapeHtml(titulo[2]))}</h${nivel}>`);
      avancar(1); i++; continue;
    }
    if (/^>\s?/.test(linha)) {
      const corpo = [];
      let j = i;
      while (j < linhas.length && /^>\s?/.test(linhas[j])) corpo.push(linhas[j++].replace(/^>\s?/, ''));
      const destaque = corpo[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      const conteudo = destaque ? [destaque[2], ...corpo.slice(1)] : corpo;
      const rotulo = destaque ? `<span class="md-destaque-tipo">${escapeHtml(destaque[1])}</span>` : '';
      saida.push(`<blockquote class="${destaque ? 'md-destaque' : ''}" ${abrir(inicio, j)}>${rotulo}${mdInline(escapeHtml(conteudo.join('\n'))).replace(/\n/g, '<br />')}</blockquote>`);
      avancar(j - i); i = j; continue;
    }
    const item = linha.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (item) {
      const numerada = /\d/.test(item[2]);
      const itens = [];
      let j = i, linhaDoItem = inicio;
      while (j < linhas.length) {
        const atual = linhas[j].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!atual || /\d/.test(atual[2]) !== numerada) break;
        // Cada item guarda o trecho da sua linha: clicar num item abre só aquela
        // linha, e o resto da lista continua desenhado.
        const marca = `data-pos="${base + linhaDoItem}" data-fim="${base + linhaDoItem + linhas[j].length}"`;
        const tarefa = atual[3].match(/^\[([ xX])\]\s*(.*)$/);
        itens.push(tarefa
          ? `<li class="md-tarefa" ${marca}><input type="checkbox" ${/[xX]/.test(tarefa[1]) ? 'checked' : ''} aria-label="Concluída" />${mdInline(escapeHtml(tarefa[2]))}</li>`
          : `<li ${marca}>${mdInline(escapeHtml(atual[3]))}</li>`);
        linhaDoItem += linhas[j].length + 1;
        j++;
      }
      saida.push(`<${numerada ? 'ol' : 'ul'} ${abrir(inicio, j)}>${itens.join('')}</${numerada ? 'ol' : 'ul'}>`);
      avancar(j - i); i = j; continue;
    }
    // A primeira linha entra sempre. Sem isso, uma linha como ```js` (cerca com
    // crase sobrando) não virava bloco nenhum e o laço nunca avançava.
    const paragrafo = [linhas[i]];
    let j = i + 1;
    while (j < linhas.length && linhas[j].trim() && !/^(#{1,6}\s|>|```|[-*+]\s|\d+\.\s|-{3,}\s*$)/.test(linhas[j])) paragrafo.push(linhas[j++]);
    saida.push(`<p ${abrir(inicio, j)}>${mdInline(escapeHtml(paragrafo.join('\n'))).replace(/\n/g, '<br />')}</p>`);
    avancar(j - i); i = j;
  }
  return saida.join('');
}

// ---- Blocos de código ----
// O corpo continua sendo Markdown puro: a área de código só insere as cercas ```,
// e o botão de copiar lê o bloco já desenhado.
function areaDeCodigo(area) {
  const v = area.value, i = area.selectionStart;
  const sel = v.slice(i, area.selectionEnd);
  const antes = i === 0 || v.slice(0, i).endsWith('\n\n') ? '' : v.slice(0, i).endsWith('\n') ? '\n' : '\n\n';
  const miolo = sel ? (sel.endsWith('\n') ? sel : sel + '\n') : '\n';
  inserirTexto(area, antes + '```\n' + miolo + '```\n');
  // Com seleção, o cursor fica na cerca de abertura para nomear a linguagem.
  // Sem seleção, fica na linha vazia de dentro, pronto para digitar o código.
  const posicao = i + antes.length + (sel ? 3 : 4);
  area.setSelectionRange(posicao, posicao);
}
// A API moderna exige contexto seguro e gesto do usuário; onde ela é negada,
// o textarea temporário com execCommand ainda funciona.
async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* tenta o modo antigo */ }
  const campo = document.createElement('textarea');
  campo.value = texto;
  campo.setAttribute('readonly', '');
  campo.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(campo);
  campo.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  campo.remove();
  return ok;
}
async function copiarBloco(botao) {
  const codigo = botao.closest('.code-area').querySelector('code').textContent;
  if (!await copiarTexto(codigo)) return void status('O navegador não liberou a área de transferência.', true);
  botao.textContent = 'Copiado';
  botao.classList.add('copiado');
  setTimeout(() => { botao.textContent = 'Copiar'; botao.classList.remove('copiado'); }, 1400);
}
// ---- Edição no lugar ----
// A nota fica sempre desenhada e não há modos para alternar. Clicar num bloco
// troca só aquele bloco pelo seu Markdown, num campo que cresce com o texto; ao
// sair dele, o bloco volta a ser desenhado. É o Live Preview do Obsidian.
// blocoAberto = { campo, inicio, tamanho, separador }: onde o campo está na fonte.

// Sai da nota pelo fluxo normal (salva se preciso) e filtra a tela Notas pela etiqueta.
async function buscarEtiqueta(texto) {
  await irPara('notes');
  const busca = !editing && $('#note-search');
  if (!busca) return;
  busca.value = texto;
  busca.dispatchEvent(new Event('input'));
}
function seguirWikilink(link) {
  const alvo = link.dataset.id ? getNote(link.dataset.id) : notaVazia({ title: link.dataset.alvo });
  return abrirNota(alvo);
}
const ajustarAltura = campo => { campo.style.height = 'auto'; campo.style.height = campo.scrollHeight + 'px'; };

// Enquanto se digita, os blocos seguintes mudam de lugar na fonte. Manter data-pos
// e data-fim em dia faz o próximo clique abrir o trecho certo sem redesenhar a nota.
function deslocarBlocos(depoisDe, delta) {
  if (!delta) return;
  for (const bloco of $('#doc-corpo').querySelectorAll('[data-pos]')) {
    const pos = Number(bloco.dataset.pos), fim = Number(bloco.dataset.fim);
    if (pos > depoisDe) { bloco.dataset.pos = pos + delta; bloco.dataset.fim = fim + delta; }
    // A lista em volta do item em edição cresce junto com ele.
    else if (fim >= depoisDe) bloco.dataset.fim = fim + delta;
  }
}

function montarCampo(valor) {
  const campo = document.createElement('textarea');
  campo.className = 'bloco-editor';
  campo.value = valor;
  campo.rows = 1;
  campo.setAttribute('aria-label', 'Conteúdo da nota');
  campo.addEventListener('input', () => { aoDigitar(campo); atualizarSugestoes(campo); });
  campo.addEventListener('keydown', teclaNoBloco);
  campo.addEventListener('click', () => atualizarSugestoes(campo));
  campo.addEventListener('keyup', evento => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(evento.key)) atualizarSugestoes(campo); });
  campo.addEventListener('paste', aoColarOuSoltar);
  campo.addEventListener('drop', aoColarOuSoltar);
  // Adiado: um prompt do menu tira o foco por um instante e o devolve. Só fecha
  // se, passado o evento, o foco realmente foi para outro lugar.
  campo.addEventListener('focusout', () => setTimeout(() => {
    if (blocoAberto?.campo === campo && document.activeElement !== campo) fecharBloco();
  }, 0));
  return campo;
}

function ativarCampo(campo, posicao, cursor) {
  blocoAberto = { campo, ...posicao };
  ajustarAltura(campo);
  campo.focus({ preventScroll: true });
  campo.scrollIntoView({ block: 'nearest' });
  const alvo = Math.max(0, Math.min(cursor, campo.value.length));
  campo.setSelectionRange(alvo, alvo);
  return campo;
}

function aoDigitar(campo) {
  const bloco = blocoAberto;
  if (bloco?.campo !== campo) return;
  // Parágrafo novo no fim da nota: a linha em branco que o separa só entra
  // quando algo é escrito, para um clique à toa não sujar a nota.
  if (bloco.separador) { editing.body += bloco.separador; bloco.separador = ''; }
  editing.body = editing.body.slice(0, bloco.inicio) + campo.value + editing.body.slice(bloco.inicio + bloco.tamanho);
  deslocarBlocos(bloco.inicio, campo.value.length - bloco.tamanho);
  bloco.tamanho = campo.value.length;
  ajustarAltura(campo);
  editorDirty = true; estadoDoc();
}

function fecharBloco() {
  fecharSugestoes();
  const bloco = blocoAberto;
  if (!bloco) return;
  blocoAberto = null;
  if (!bloco.campo.isConnected) return;
  // Item de lista: redesenha a lista inteira, porque a linha editada pode ter
  // deixado de ser item — ou virado outro tipo de bloco.
  const lista = bloco.item?.parentElement.closest('[data-pos]');
  const alvo = lista || bloco.campo;
  const inicio = lista ? Number(lista.dataset.pos) : bloco.inicio;
  const fonte = lista ? editing.body.slice(inicio, Number(lista.dataset.fim)) : bloco.campo.value;
  const molde = document.createElement('template');
  molde.innerHTML = renderizarMarkdown(fonte, inicio);
  alvo.replaceWith(molde.content);
}

function abrirBloco(elemento, cursor = Infinity) {
  fecharBloco();
  if (!elemento?.isConnected) return abrirNoFim();
  const inicio = Number(elemento.dataset.pos), fim = Number(elemento.dataset.fim);
  const campo = montarCampo(editing.body.slice(inicio, fim));
  // O campo herda o tamanho do título e a fonte do código, para o texto não pular.
  if (/^H[1-6]$/.test(elemento.tagName)) {
    const estilo = getComputedStyle(elemento);
    Object.assign(campo.style, { fontSize: estilo.fontSize, fontWeight: estilo.fontWeight, lineHeight: estilo.lineHeight });
  }
  if (elemento.classList.contains('code-area') || elemento.classList.contains('plugin-bloco')) campo.classList.add('bloco-codigo');
  const item = elemento.tagName === 'LI' ? elemento : null;
  if (item) item.replaceChildren(campo); else elemento.replaceWith(campo);
  return ativarCampo(campo, { inicio, tamanho: fim - inicio, separador: '', item }, cursor);
}

// Clique abaixo do texto: continua o último parágrafo, ou começa um novo no fim.
function abrirNoFim() {
  fecharBloco();
  const corpo = $('#doc-corpo');
  const ultimo = [...corpo.querySelectorAll(':scope > [data-pos]')].pop();
  // Parágrafo que só tem imagem não é continuado: escrever depois dela começa um novo,
  // em vez de reabrir o ![[...]] da imagem.
  const soImagem = ultimo?.tagName === 'P' && !ultimo.textContent.trim() && ultimo.querySelector('.md-imagem');
  if (ultimo?.tagName === 'P' && !soImagem) return abrirBloco(ultimo, Infinity);
  const texto = editing.body;
  const separador = !texto.trim() || texto.endsWith('\n\n') ? '' : texto.endsWith('\n') ? '\n' : '\n\n';
  const campo = montarCampo('');
  corpo.appendChild(campo);
  return ativarCampo(campo, { inicio: texto.length + separador.length, tamanho: 0, separador }, 0);
}

function abrirNoPonto(evento) {
  const bloco = evento.target.closest('[data-pos]');
  if (!bloco || !$('#doc-corpo').contains(bloco)) return abrirNoFim();
  return abrirBloco(bloco, cursorNoBloco(bloco, evento));
}

// Salvar redesenha a nota; isto devolve o cursor ao bloco em que se escrevia.
function retomarBloco({ inicio, cursor }) {
  const bloco = $('#doc-corpo')?.querySelector(`[data-pos="${inicio}"]`);
  if (bloco) abrirBloco(bloco, cursor);
}

// Onde, no Markdown do bloco, fica o ponto clicado. O texto desenhado não tem os
// colchetes, asteriscos e cercas da fonte: a fonte é percorrida consumindo só os
// caracteres que batem com o texto visível até o ponto do clique.
function cursorNoBloco(bloco, evento) {
  const fonte = editing.body.slice(Number(bloco.dataset.pos), Number(bloco.dataset.fim));
  const faixa = document.createRange();
  const ponto = document.caretPositionFromPoint?.(evento.clientX, evento.clientY);
  if (ponto) faixa.setEnd(ponto.offsetNode, ponto.offset);
  else {
    const antigo = document.caretRangeFromPoint?.(evento.clientX, evento.clientY);
    if (!antigo) return fonte.length;
    faixa.setEnd(antigo.startContainer, antigo.startOffset);
  }
  // Bloco de plug-in: o desenho não corresponde à fonte; o cursor vai para o texto do bloco.
  if (bloco.classList.contains('plugin-bloco')) return (fonte.indexOf('\n') + 1) || fonte.length;
  let origem = bloco, k = 0;
  const codigo = bloco.querySelector('pre code');
  if (codigo) {
    // Legenda e botão Copiar não existem na fonte: conta a partir do código,
    // logo depois da cerca de abertura.
    k = fonte.indexOf('\n') + 1;
    if (!codigo.contains(faixa.endContainer)) return k || fonte.length;
    origem = codigo;
  }
  if (!origem.contains(faixa.endContainer)) return fonte.length;
  faixa.setStart(origem, 0);
  const visivel = faixa.toString();
  let j = 0;
  while (k < fonte.length && j < visivel.length) { if (fonte[k] === visivel[j]) j++; k++; }
  return k;
}

function teclaNoBloco(evento) {
  const campo = evento.currentTarget;
  if (sugestao?.campo === campo && teclaNaSugestao(evento)) return;
  if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); fecharBloco(); return; }
  if (evento.key !== 'ArrowUp' && evento.key !== 'ArrowDown') return;
  if (evento.shiftKey || evento.altKey || evento.ctrlKey || evento.metaKey) return;
  if (campo.selectionStart !== campo.selectionEnd) return;
  const subir = evento.key === 'ArrowUp';
  // Só troca de bloco com o cursor já na ponta: dentro do texto a seta continua
  // andando pelas linhas, inclusive as quebradas pela largura da página.
  if (campo.selectionStart !== (subir ? 0 : campo.value.length)) return;
  const referencia = blocoAberto?.item || campo;
  let vizinho = subir ? referencia.previousElementSibling : referencia.nextElementSibling;
  while (vizinho && !vizinho.dataset.pos) vizinho = subir ? vizinho.previousElementSibling : vizinho.nextElementSibling;
  if (!vizinho && blocoAberto?.item) {
    const lista = blocoAberto.item.parentElement.closest('[data-pos]');
    vizinho = subir ? lista?.previousElementSibling : lista?.nextElementSibling;
  }
  // Caindo numa lista, a edição começa pelo item da ponta, não pela lista toda.
  if (/^(UL|OL)$/.test(vizinho?.tagName)) vizinho = subir ? vizinho.lastElementChild : vizinho.firstElementChild;
  if (!vizinho) return;
  evento.preventDefault();
  abrirBloco(vizinho, subir ? Infinity : 0);
}

// ---- Sugestões de [[link]] ----
// A lista não toma o foco: o teclado continua no campo e teclaNoBloco a consulta primeiro.
let sugestao = null; // { campo, lista, titulos, indice, inicio }
function fecharSugestoes() { sugestao?.lista.remove(); sugestao = null; }
// A lista é fixa na tela: se a página rolar, fecha em vez de ficar longe do cursor.
document.addEventListener('scroll', () => { if (sugestao) fecharSugestoes(); }, true);
function atualizarSugestoes(campo) {
  const cursor = campo.selectionStart, antes = campo.value.slice(0, cursor);
  const consulta = cursor === campo.selectionEnd ? Kiro.linkQuery(antes.slice(antes.lastIndexOf('\n') + 1)) : null;
  const titulos = consulta === null ? [] : Kiro.linkSuggestions(state.notes.filter(n => n.id !== editing?.id), consulta);
  if (!titulos.length) return fecharSugestoes();
  let lista = sugestao?.lista;
  if (!lista) {
    lista = document.createElement('div');
    lista.className = 'ctx-menu sugestoes-link';
    lista.setAttribute('role', 'listbox');
    lista.addEventListener('mousedown', e => e.preventDefault());
    lista.addEventListener('click', e => { const item = e.target.closest('[data-i]'); if (item) inserirSugestao(+item.dataset.i); });
    document.body.appendChild(lista);
  }
  sugestao = { campo, lista, titulos, indice: 0, inicio: cursor - consulta.length };
  desenharSugestoes();
  const { left, top, altura } = posicaoDoCursor(campo);
  const cabeAbaixo = top + altura + lista.offsetHeight < window.innerHeight - 8;
  lista.style.left = Math.max(8, Math.min(left, window.innerWidth - lista.offsetWidth - 8)) + 'px';
  lista.style.top = (cabeAbaixo ? top + altura + 4 : top - lista.offsetHeight - 4) + 'px';
}
function desenharSugestoes() {
  const { lista, titulos, indice } = sugestao;
  lista.innerHTML = titulos.map((t, i) => `<button type="button" class="ctx-item${i === indice ? ' marcada' : ''}" data-i="${i}" role="option" aria-selected="${i === indice}"><span class="ctx-rotulo">${escapeHtml(t)}</span></button>`).join('');
  lista.querySelector('.marcada')?.scrollIntoView({ block: 'nearest' });
}
function inserirSugestao(i) {
  const { campo, titulos, inicio } = sugestao;
  fecharSugestoes();
  campo.setSelectionRange(inicio, campo.selectionStart);
  inserirTexto(campo, titulos[i] + ']]'); // dispara input: aoDigitar marca a nota como alterada
}
function teclaNaSugestao(evento) {
  if (evento.ctrlKey || evento.altKey || evento.metaKey) return false;
  const { key } = evento, total = sugestao.titulos.length;
  if (key === 'ArrowDown' || key === 'ArrowUp') { sugestao.indice = (sugestao.indice + (key === 'ArrowDown' ? 1 : total - 1)) % total; desenharSugestoes(); }
  else if (key === 'Enter' || key === 'Tab') inserirSugestao(sugestao.indice);
  else if (key === 'Escape') fecharSugestoes();
  else return false;
  evento.preventDefault(); evento.stopPropagation();
  return true;
}
// Div espelho com a mesma caixa e fonte do campo: o fim do texto antes do cursor é onde o cursor está.
function posicaoDoCursor(campo) {
  const estilo = getComputedStyle(campo), espelho = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'padding', 'border', 'font', 'letterSpacing', 'lineHeight', 'tabSize', 'textIndent']) espelho.style[p] = estilo[p];
  Object.assign(espelho.style, { position: 'fixed', top: '0', left: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  espelho.textContent = campo.value.slice(0, campo.selectionStart);
  const marca = espelho.appendChild(document.createElement('span'));
  marca.textContent = '​';
  document.body.appendChild(espelho);
  const caixa = campo.getBoundingClientRect();
  const posicao = { left: caixa.left + marca.offsetLeft, top: caixa.top + marca.offsetTop, altura: marca.offsetHeight };
  espelho.remove();
  return posicao;
}

// ---- Colar, arrastar e redimensionar imagens ----
const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const LIMITE_DE_IMAGEM = 20 * 1024 * 1024;

function imagensDoEvento(dados) {
  if (!dados) return [];
  const arquivos = [...(dados.files || [])].filter(arquivo => TIPOS_DE_IMAGEM.includes(arquivo.type));
  if (arquivos.length) return arquivos;
  return [...(dados.items || [])].filter(item => item.kind === 'file' && TIPOS_DE_IMAGEM.includes(item.type)).map(item => item.getAsFile()).filter(Boolean);
}
async function guardarImagem(arquivo) {
  if (window.cadernoDesktop) return window.cadernoDesktop.saveAttachment({ nome: arquivo.name || '', dados: new Uint8Array(await arquivo.arrayBuffer()) });
  const resposta = await fetch('/api/anexo', { method: 'POST', headers: { 'Content-Type': arquivo.type, 'X-Kiro-Nome': encodeURIComponent(arquivo.name || '') }, body: arquivo });
  const resultado = await resposta.json();
  if (!resposta.ok) throw new Error(resultado.error || 'Não foi possível guardar a imagem.');
  return resultado;
}
// A imagem vai para o cofre primeiro; só depois o ![[...]] entra no texto, onde está o cursor.
async function colarImagens(campo, arquivos) {
  status(arquivos.length > 1 ? `Guardando ${arquivos.length} imagens…` : 'Guardando imagem…');
  const trechos = [];
  for (const arquivo of arquivos) {
    if (arquivo.size > LIMITE_DE_IMAGEM) { status(`${arquivo.name || 'A imagem'} passa de 20 MB.`, true); continue; }
    try { trechos.push(`![[${(await guardarImagem(arquivo)).path}]]`); }
    catch (erro) { status('Não foi possível guardar a imagem: ' + erro.message, true); }
  }
  if (!trechos.length || !editing) return;
  // Se o bloco fechou enquanto a imagem era gravada, ela entra no fim da nota.
  const destino = campo.isConnected && blocoAberto?.campo === campo ? campo : abrirNoFim();
  // Cada imagem vira um parágrafo próprio, separado do texto em volta por linha em branco.
  const texto = destino.value, anterior = texto.slice(0, destino.selectionStart), seguinte = texto.slice(destino.selectionEnd);
  const antes = !anterior || anterior.endsWith('\n\n') ? '' : anterior.endsWith('\n') ? '\n' : '\n\n';
  const depois = !seguinte || seguinte.startsWith('\n\n') ? '' : seguinte.startsWith('\n') ? '\n' : '\n\n';
  inserirTexto(destino, antes + trechos.join('\n\n') + depois);
  // Fecha o bloco para a imagem aparecer na hora, em vez do ![[...]] cru.
  fecharBloco();
  status(trechos.length > 1 ? `${trechos.length} imagens coladas` : 'Imagem colada');
}
function aoColarOuSoltar(evento) {
  const arquivos = imagensDoEvento(evento.clipboardData || evento.dataTransfer);
  if (!arquivos.length) return;
  evento.preventDefault();
  colarImagens(evento.currentTarget, arquivos);
}
// Ctrl+V com a nota aberta mas nenhum bloco em edição: a imagem entra no fim da nota.
document.addEventListener('paste', evento => {
  if (!editing || blocoAberto || evento.defaultPrevented || !$('#doc-corpo')) return;
  if (evento.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const arquivos = imagensDoEvento(evento.clipboardData);
  if (!arquivos.length) return;
  evento.preventDefault();
  colarImagens(abrirNoFim(), arquivos);
});
// Arquivo solto fora da nota não deve abrir a imagem no lugar do aplicativo.
window.addEventListener('dragover', evento => { if (evento.dataTransfer?.types.includes('Files')) evento.preventDefault(); });
window.addEventListener('drop', evento => { if (evento.dataTransfer?.types.includes('Files')) evento.preventDefault(); });

// Alça no canto da imagem: arrastar muda a largura na hora e, ao soltar, grava
// |largura no ![[...]] da fonte — o mesmo formato do Obsidian.
function redimensionarImagem(alca, inicio) {
  const moldura = alca.closest('.md-imagem'), img = moldura.querySelector('img'), bloco = moldura.closest('[data-pos]');
  if (!bloco || !img.naturalWidth) return;
  fecharBloco();
  const indice = [...bloco.querySelectorAll('.md-imagem')].indexOf(moldura);
  const larguraInicial = Math.round(img.getBoundingClientRect().width);
  const limite = $('#doc-corpo').clientWidth;
  let largura = larguraInicial;
  moldura.classList.add('redimensionando');
  const mover = evento => {
    largura = Math.round(Math.min(limite, Math.max(48, larguraInicial + evento.clientX - inicio.clientX)));
    img.style.width = largura + 'px';
  };
  const soltar = () => {
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', soltar);
    moldura.classList.remove('redimensionando');
    if (largura !== larguraInicial) gravarLarguraDaImagem(bloco, indice, largura);
  };
  document.addEventListener('pointermove', mover);
  document.addEventListener('pointerup', soltar);
  document.addEventListener('pointercancel', soltar);
}
function gravarLarguraDaImagem(bloco, indice, largura) {
  if (!bloco.isConnected) return;
  const inicio = Number(bloco.dataset.pos), fim = Number(bloco.dataset.fim);
  const fonte = editing.body.slice(inicio, fim);
  const achado = imagensNaFonte(fonte)[indice];
  if (!achado) return;
  const trecho = fonte.slice(0, achado.inicio) + `![[${achado.imagem.caminho}|${largura}]]` + fonte.slice(achado.fim);
  editing.body = editing.body.slice(0, inicio) + trecho + editing.body.slice(fim);
  deslocarBlocos(inicio, trecho.length - fonte.length);
  const molde = document.createElement('template');
  molde.innerHTML = renderizarMarkdown(trecho, inicio);
  bloco.replaceWith(molde.content);
  editorDirty = true; estadoDoc();
}

// Clicar na imagem abre ela inteira sobre a nota; Esc ou um clique fecham. O
// Markdown da imagem continua a um clique do botão direito, como nos outros blocos.
let telaDeImagem = null;
const aoTeclarNaImagem = evento => {
  if (evento.key !== 'Escape') return;
  // Em captura e parando aqui: o Esc fecha a imagem sem mexer no resto da tela.
  evento.preventDefault();
  evento.stopPropagation();
  fecharImagemInteira();
};
function abrirImagemInteira(fonte, nome) {
  fecharImagemInteira();
  telaDeImagem = document.createElement('div');
  telaDeImagem.className = 'tela-imagem';
  telaDeImagem.tabIndex = -1;
  telaDeImagem.innerHTML = `<img src="${escapeHtml(fonte)}" alt="${escapeHtml(nome || '')}" /><span class="tela-dica">Esc para fechar</span>`;
  telaDeImagem.addEventListener('click', fecharImagemInteira);
  document.body.appendChild(telaDeImagem);
  document.body.classList.add('com-imagem-inteira');
  telaDeImagem.focus({ preventScroll: true });
  document.addEventListener('keydown', aoTeclarNaImagem, true);
}
function fecharImagemInteira() {
  if (!telaDeImagem) return;
  telaDeImagem.remove();
  telaDeImagem = null;
  document.body.classList.remove('com-imagem-inteira');
  document.removeEventListener('keydown', aoTeclarNaImagem, true);
}

// Marcar e desmarcar uma tarefa é trocar [ ] por [x] na linha, como no Obsidian.
function marcarTarefa(caixa) {
  const inicio = Number(caixa.closest('[data-pos]')?.dataset.pos);
  if (!Number.isInteger(inicio)) return;
  fecharBloco();
  const item = $('#doc-corpo').querySelector(`[data-pos="${inicio}"]`);
  if (!item) return;
  const linha = editing.body.slice(inicio, Number(item.dataset.fim));
  const trocada = linha.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/, (_, antes, marca, depois) => antes + (marca === ' ' ? 'x' : ' ') + depois);
  if (trocada === linha) return;
  editing.body = editing.body.slice(0, inicio) + trocada + editing.body.slice(inicio + linha.length);
  const alvo = item.parentElement.closest('[data-pos]') || item;
  const molde = document.createElement('template');
  molde.innerHTML = renderizarMarkdown(editing.body.slice(Number(alvo.dataset.pos), Number(alvo.dataset.fim)), Number(alvo.dataset.pos));
  alvo.replaceWith(molde.content);
  editorDirty = true; estadoDoc();
}

function bindCorpo(corpo) {
  corpo.addEventListener('mousedown', evento => {
    if (evento.button === 1) return;
    const alca = evento.target.closest('.md-alca');
    if (alca && evento.button === 0) { evento.preventDefault(); return void redimensionarImagem(alca, evento); }
    // A caixa de tarefa se vira sozinha; o item não entra em edição por causa dela.
    if (evento.target.closest('.md-tarefa input')) return;
    if (blocoAberto?.campo === evento.target) return; // dentro do campo aberto: comportamento normal
    // Links e o botão Copiar agem no click. Segurar o foco evita que o bloco aberto
    // feche e mude a altura da página entre apertar e soltar o botão do mouse.
    if (evento.button === 0 && evento.target.closest('a, button, .md-imagem img, .md-tag')) return void evento.preventDefault();
    evento.preventDefault();
    abrirNoPonto(evento);
  });
  corpo.addEventListener('click', evento => {
    // Link desenhado por plug-in nunca navega a janela: http(s) abre fora (no
    // aplicativo, o setWindowOpenHandler manda ao navegador do sistema); o resto não faz nada.
    const linkDoPlugin = evento.target.closest('.plugin-bloco a');
    if (linkDoPlugin) {
      evento.preventDefault();
      const destino = linkDoPlugin.getAttribute('href') || '';
      if (/^https?:\/\//i.test(destino)) window.open(destino, '_blank', 'noopener,noreferrer');
      return;
    }
    const copiar = evento.target.closest('.code-copy');
    if (copiar) return void copiarBloco(copiar);
    const imagem = evento.target.closest('.md-imagem img');
    if (imagem) { evento.preventDefault(); return void abrirImagemInteira(imagem.src, imagem.alt); }
    const etiqueta = evento.target.closest('.md-tag');
    if (etiqueta) return void buscarEtiqueta(etiqueta.textContent);
    const link = evento.target.closest('.wikilink');
    if (link) { evento.preventDefault(); seguirWikilink(link); }
  });
  // O botão direito já abriu o bloco no mousedown; o menu age sobre ele.
  corpo.addEventListener('contextmenu', evento => abrirMenuContexto(evento, blocoAberto?.campo ?? abrirNoPonto(evento)));
  // change cobre mouse e teclado (espaço na caixa focada).
  corpo.addEventListener('change', evento => { if (evento.target.matches('.md-tarefa input[type="checkbox"]')) marcarTarefa(evento.target); });
  corpo.addEventListener('dragover', evento => { if (evento.dataTransfer?.types.includes('Files')) evento.preventDefault(); });
  // Solto sobre o texto desenhado: abre o bloco no ponto e insere lá.
  corpo.addEventListener('drop', evento => {
    if (evento.defaultPrevented) return;
    const arquivos = imagensDoEvento(evento.dataTransfer);
    if (!arquivos.length) return;
    evento.preventDefault();
    colarImagens(blocoAberto?.campo ?? abrirNoPonto(evento), arquivos);
  });
  // Imagem que não existe mais no cofre: mostra o nome no lugar de um ícone quebrado.
  corpo.addEventListener('error', evento => { if (evento.target.tagName === 'IMG') evento.target.closest('.md-imagem')?.classList.add('quebrada'); }, true);
}

// ---- Menu de contexto do corpo da nota ----
// O corpo é Markdown puro: cada item insere a marcação correspondente.
// Usa execCommand('insertText') para não destruir a pilha de desfazer do textarea.
function inserirTexto(area, texto) {
  area.focus();
  let ok = false;
  try { ok = document.execCommand('insertText', false, texto); } catch { ok = false; }
  if (!ok) area.setRangeText(texto, area.selectionStart, area.selectionEnd, 'end');
  area.dispatchEvent(new Event('input', { bubbles: true }));
}
function envolver(area, abre, fecha = abre) {
  const i = area.selectionStart, sel = area.value.slice(i, area.selectionEnd);
  inserirTexto(area, abre + sel + fecha);
  if (sel) area.setSelectionRange(i + abre.length, i + abre.length + sel.length);
  else { const p = i + abre.length; area.setSelectionRange(p, p); }
}
function limitesDasLinhas(area) {
  const v = area.value;
  const inicio = v.lastIndexOf('\n', area.selectionStart - 1) + 1;
  const seguinte = v.indexOf('\n', area.selectionEnd);
  return [inicio, seguinte < 0 ? v.length : seguinte];
}
function porLinha(area, transformar) {
  const [i, f] = limitesDasLinhas(area);
  const bloco = area.value.slice(i, f).split('\n').map(transformar).join('\n');
  area.setSelectionRange(i, f);
  inserirTexto(area, bloco);
  area.setSelectionRange(i, i + bloco.length);
}
const semPrefixo = linha => linha.replace(/^\s*(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?)/, '');
const prefixar = (area, prefixo) => porLinha(area, l => prefixo + semPrefixo(l));
function inserirBloco(area, texto) {
  const v = area.value, i = area.selectionStart;
  const antes = i === 0 || v.slice(0, i).endsWith('\n\n') ? '' : v.slice(0, i).endsWith('\n') ? '\n' : '\n\n';
  inserirTexto(area, antes + texto);
}
function linkExterno(area) {
  const sel = area.value.slice(area.selectionStart, area.selectionEnd);
  const url = prompt('Endereço do link:', 'https://');
  if (url === null) return;
  const limpo = Kiro.safeUrl(url.trim());
  if (!limpo) { alert('Informe um endereço http:// ou https:// válido.'); return; }
  const i = area.selectionStart;
  inserirTexto(area, '[' + sel + '](' + limpo + ')');
  if (!sel) area.setSelectionRange(i + 1, i + 1);
}
async function colar(area) {
  try {
    const texto = await navigator.clipboard.readText();
    if (texto) inserirTexto(area, texto);
  } catch {
    status('O navegador não liberou a área de transferência. Use Ctrl+V.', true);
  }
}
async function copiarSelecao(area, recortar) {
  const sel = area.value.slice(area.selectionStart, area.selectionEnd);
  if (!sel) return;
  if (!await copiarTexto(sel)) return void status('Não foi possível copiar.', true);
  if (recortar) inserirTexto(area, '');
}
const TABELA = '| Coluna | Coluna |\n| --- | --- |\n|  |  |\n';
const temSelecao = area => area.selectionStart !== area.selectionEnd;
// No bloco em edição o texto é cru: o link aparece entre colchetes e não é
// clicável. Isto acha o [[...]] que contém o cursor para que o menu possa
// oferecer o mesmo destino que o modo de leitura abre com um clique.
function wikilinkNoCursor(area) {
  if (!area || area.hidden) return null;
  const cursor = area.selectionStart;
  for (const achado of area.value.matchAll(/\[\[([^\]\[\n]+)\]\]/g)) {
    const inicio = achado.index, fim = inicio + achado[0].length;
    if (cursor < inicio || cursor > fim) continue;
    const alvo = achado[1].split('|')[0].split('#')[0].trim();
    return alvo ? { alvo, nota: Kiro.findLinkedNote(state.notes, alvo) } : null;
  }
  return null;
}
function menuDaNota() {
  const destino = wikilinkNoCursor(blocoAberto?.campo);
  return [
    ...(destino ? [
      { rotulo: `Ir para "${destino.alvo}"`, icone: icone('ir-para'), acao: () => abrirNota(destino.nota || notaVazia({ title: destino.alvo })) },
      { separador: true },
    ] : []),
    { rotulo: 'Adicionar link', icone: icone('link'), acao: a => envolver(a, '[[', ']]') },
    { rotulo: 'Adicionar link externo', icone: icone('link-externo'), acao: linkExterno },
    { separador: true },
    { rotulo: 'Formatar', icone: icone('renomear'), filhos: [
      { rotulo: 'Negrito', icone: 'B', acao: a => envolver(a, '**') },
      { rotulo: 'Itálico', icone: 'I', acao: a => envolver(a, '*') },
      { rotulo: 'Riscado', icone: 'S', acao: a => envolver(a, '~~') },
      { rotulo: 'Realce', icone: icone('realce'), acao: a => envolver(a, '==') },
      { separador: true },
      { rotulo: 'Código', icone: icone('codigo'), acao: a => envolver(a, '`') },
      { rotulo: 'Área de código', icone: icone('codigo-bloco'), acao: areaDeCodigo },
      { rotulo: 'Equação', icone: 'Σ', acao: a => envolver(a, '$') },
      { rotulo: 'Comentário', icone: icone('comentario'), acao: a => envolver(a, '%%') },
      { separador: true },
      { rotulo: 'Limpar formatação', icone: icone('limpar'), acao: a => {
        const i = a.selectionStart, sel = a.value.slice(i, a.selectionEnd);
        if (!sel) return;
        const limpo = sel.replace(/\*\*|~~|==|%%|[*`$]/g, '');
        inserirTexto(a, limpo);
        a.setSelectionRange(i, i + limpo.length);
      } },
    ] },
    { rotulo: 'Parágrafo', icone: icone('paragrafo'), filhos: [
      { rotulo: 'Texto normal', icone: icone('texto'), acao: a => porLinha(a, semPrefixo) },
      { separador: true },
      { rotulo: 'Título 1', icone: icone('titulo'), acao: a => prefixar(a, '# ') },
      { rotulo: 'Título 2', icone: icone('titulo'), acao: a => prefixar(a, '## ') },
      { rotulo: 'Título 3', icone: icone('titulo'), acao: a => prefixar(a, '### ') },
      { separador: true },
      { rotulo: 'Lista com marcadores', icone: icone('lista-marcadores'), acao: a => prefixar(a, '- ') },
      { rotulo: 'Lista numerada', icone: icone('lista-numerada'), acao: a => { let n = 0; porLinha(a, l => (++n) + '. ' + semPrefixo(l)); } },
      { rotulo: 'Lista de tarefas', icone: icone('lista-tarefas'), acao: a => prefixar(a, '- [ ] ') },
      { rotulo: 'Citação', icone: icone('destaque'), acao: a => prefixar(a, '> ') },
    ] },
    { rotulo: 'Inserir', icone: icone('mais'), filhos: [
      { rotulo: 'Nota de rodapé', icone: icone('rodape'), acao: a => {
        const n = (a.value.match(/\[\^(\d+)\]/g) || []).length + 1;
        inserirTexto(a, '[^' + n + ']');
        const fim = a.selectionStart;
        const rodape = (a.value.endsWith('\n') ? '' : '\n') + '\n[^' + n + ']: ';
        a.setSelectionRange(a.value.length, a.value.length);
        inserirTexto(a, rodape);
        a.setSelectionRange(fim, fim);
      } },
      { rotulo: 'Tabela', icone: icone('tabela'), acao: a => inserirBloco(a, TABELA) },
      { rotulo: 'Destaque', icone: icone('destaque'), acao: a => inserirBloco(a, '> [!note]\n> ') },
      { rotulo: 'Régua horizontal', icone: icone('regua'), acao: a => inserirBloco(a, '---\n') },
      { separador: true },
      { rotulo: 'Bloco de código', icone: icone('codigo-bloco'), acao: a => { inserirBloco(a, '```\n\n```\n'); const p = a.selectionStart - 5; a.setSelectionRange(p, p); } },
      { rotulo: 'Equação em bloco', icone: 'Σ', acao: a => { inserirBloco(a, '$$\n\n$$\n'); const p = a.selectionStart - 4; a.setSelectionRange(p, p); } },
    ] },
    { separador: true },
    { rotulo: 'Cortar', icone: icone('cortar'), ativo: temSelecao, acao: a => copiarSelecao(a, true) },
    { rotulo: 'Copiar', icone: icone('copiar'), ativo: temSelecao, acao: a => copiarSelecao(a, false) },
    { rotulo: 'Colar', icone: icone('colar'), acao: colar },
    { separador: true },
    { rotulo: 'Selecionar tudo', icone: icone('selecionar'), acao: a => a.select() },
    { separador: true },
    { rotulo: 'Salvar', icone: icone('salvar'), acao: () => salvarNota() },
    { rotulo: 'Detalhes', icone: icone('detalhes'), acao: () => acaoEditor('detalhes') },
    { rotulo: 'Fechar nota', icone: icone('fechar'), acao: () => acaoEditor('fechar') },
    { rotulo: 'Mover para lixeira', icone: icone('lixeira'), ativo: () => Boolean(editing?.id), acao: () => acaoEditor('lixeira') },
  ];
}
let menuAberto = null;
function fecharMenuContexto() {
  if (!menuAberto) return;
  menuAberto.remove();
  menuAberto = null;
  document.removeEventListener('pointerdown', aoClicarFora, true);
  document.removeEventListener('keydown', aoTeclarNoMenu, true);
}
const aoClicarFora = e => { if (!menuAberto || !menuAberto.contains(e.target)) fecharMenuContexto(); };
const aoTeclarNoMenu = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharMenuContexto(); } };
function montarNivel(itens, area) {
  const nivel = document.createElement('div');
  nivel.className = 'ctx-menu';
  // O menu não toma o foco: a ação precisa encontrar aberto o bloco em edição.
  nivel.addEventListener('mousedown', e => e.preventDefault());
  for (const item of itens) {
    if (item.separador) { nivel.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    const habilitado = item.ativo ? item.ativo(area) : true;
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ctx-item' + (item.filhos ? ' tem-filhos' : '');
    linha.disabled = !habilitado;
    const desenho = item.icone && item.icone.startsWith('<svg') ? item.icone : escapeHtml(item.icone || '');
    linha.innerHTML = '<span class="ctx-icone">' + desenho + '</span><span class="ctx-rotulo">' + escapeHtml(item.rotulo) + '</span>' + (item.filhos ? '<span class="ctx-seta">›</span>' : '');
    if (item.filhos) {
      const sub = montarNivel(item.filhos, area);
      sub.classList.add('ctx-sub');
      linha.appendChild(sub);
      // Abrir para a esquerda quando não couber à direita.
      linha.addEventListener('mouseenter', () => {
        sub.classList.remove('para-esquerda');
        if (linha.getBoundingClientRect().right + sub.offsetWidth > window.innerWidth - 8) sub.classList.add('para-esquerda');
      });
    } else if (habilitado) {
      linha.addEventListener('click', async () => {
        fecharMenuContexto();
        if (document.body.contains(area)) await item.acao(area);
      });
    }
    nivel.appendChild(linha);
  }
  return nivel;
}
function abrirMenuContexto(evento, area, itens = menuDaNota()) {
  evento.preventDefault();
  fecharMenuContexto();
  const menu = montarNivel(itens, area);
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const largura = menu.offsetWidth, altura = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(evento.clientX, window.innerWidth - largura - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(evento.clientY, window.innerHeight - altura - 8)) + 'px';
  menu.style.visibility = '';
  menuAberto = menu;
  document.addEventListener('pointerdown', aoClicarFora, true);
  document.addEventListener('keydown', aoTeclarNoMenu, true);
}
async function acaoEditor(tipo){
  if(tipo==='salvar')return void await salvarNota();
  if(tipo==='fechar'){ if(editorDirty && !await salvarNota()) return; editing=null; render(); return; }
  if(tipo==='detalhes'){const d=$('#doc-details');d.hidden=!d.hidden;return;}
  if(tipo==='lixeira'){
    if(busy||failed||!loaded||!confirm(`Mover "${editing.title}" para a lixeira?`))return;
    state.notes=state.notes.filter(n=>n.id!==editing.id);
    editing=null;editorDirty=false;currentView='studies';await save();render();
  }
}
async function salvarNota(){
  if(busy||failed||!loaded)return false;
  if(!editing.title.trim()){status('Dê um título à nota antes de salvar.',true);$('#doc-title')?.focus();return false;}
  // Salvar redesenha a nota; quem estava digitando volta para o mesmo ponto.
  const retomar=blocoAberto&&document.activeElement===blocoAberto.campo?{inicio:blocoAberto.inicio,cursor:blocoAberto.campo.selectionStart}:null;
  const salva={...editing,id:editing.id||uid(),title:editing.title.trim(),createdAt:editing.createdAt||Date.now(),updatedAt:Date.now()};
  state.notes=editing.id?state.notes.map(n=>n.id===editing.id?salva:n):[salva,...state.notes];
  editing=salva;
  if(!await save())return false;
  const atual=getNote(salva.id);
  if(atual)editing={...atual,tags:[...(atual.tags||[])],links:[...(atual.links||[])]};
  editorDirty=false;render();if(retomar&&editing)retomarBloco(retomar);return true;
}
async function extraAction(type,id){
  if(busy||failed||!loaded)return;
  if(type==='inbox-arquivar')tirarDaCaixa(id);
  if(type==='inbox-mover'){
    const r=document.querySelector(`[data-extra="inbox-mover"][data-id="${CSS.escape(id)}"]`).getBoundingClientRect();
    const pastas=state.folders.slice().sort((a,b)=>(a.path||a.title).localeCompare(b.path||b.title,'pt-BR'));
    abrirMenuContexto({preventDefault(){},clientX:r.left,clientY:r.bottom},document.body,pastas.length?pastas.map(f=>({rotulo:f.path||f.title,icone:icone('pastas'),acao:()=>tirarDaCaixa(id,f.id)})):[{rotulo:'Nenhuma pasta ainda',icone:icone('pastas'),ativo:()=>false,acao:()=>{}}]);
  }
  if(type==='daily')abrirNota(state.notes.find(n=>n.title===today())||notaVazia({title:today(),body:templates.daily.body,tags:['diario']}));
  if(type==='add-habit') habitoModal();
  if(type==='habit-stats') habitosModal();
  if(type==='continuar'){const nota=getNote(id);if(nota){await abrirNota(nota);if(editing?.id===id)abrirNoFim();}}
}
// A restauração é do próprio Vault: ele devolve a nota ou a pasta inteira, com
// subpastas, anexos e os identificadores originais. Reconstruir isso aqui, como
// se fazia antes, quebrava com pastas e travava a janela.
const restaurarDoCofre = pedido => window.cadernoDesktop ? window.cadernoDesktop.restore(pedido) : api('restore', pedido);
async function showTrash(){
  if(!loaded||failed||busy)return;
  try{
    const itens=window.cadernoDesktop?await window.cadernoDesktop.trash():await api('trash');
    const quando=ms=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
    const detalhe=i=>i.kind==='folder'
      ? `pasta · ${i.noteCount} nota${i.noteCount===1?'':'s'}${i.folderCount>1?` · ${i.folderCount-1} subpasta${i.folderCount===2?'':'s'}`:''}`
      : 'nota';
    modal('Lixeira', itens.length ? itens.map(i=>`<div class="routine-item"><span class="brand-mark">${icone(i.kind==='folder'?'pastas':'nota')}</span><span class="routine-title">${escapeHtml(i.title)}<div class="task-info">${detalhe(i)} · removido em ${quando(i.deletedAt)}</div></span><button class="secondary" data-restore="${escapeHtml(i.entryId)}">Restaurar</button></div>`).join('') : '<p>A lixeira está vazia.</p>');
    document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{
      if(busy||failed)return;
      setBusy(true);status('Restaurando…');
      try{
        state=await restaurarDoCofre({entryId:b.dataset.restore,revision:state.revision});
        expanded=null;closeModal(true);render();status('Restaurado do cofre');
      }catch(erro){
        // Falha ao restaurar não põe em risco o que está na janela: não trava a interface.
        status('Não foi possível restaurar: '+erro.message,true);
      }finally{setBusy(false);}
    });
  }catch(error){status(error.message,true);}
}
// ---- Plug-ins ----
// O código de terceiro roda num worker; aqui só atendemos pedidos, sempre
// conferindo de novo a permissão concedida: o worker é território do plug-in.
const LIMITE_ATIVACAO = 3000, LIMITE_CHAMADA = 5000, LIMITE_MENSAGEM = 2 * 1024 * 1024;
const pluginsAtivos = new Map();          // id → { manifesto, permissoes, worker, comandos, paineis }
const problemasDosPlugins = new Map();    // id → motivo pelo qual parou de funcionar nesta sessão
let planoDosPlugins = { carregar: [], pendentes: [], problemas: [] };
let VERSAO = '0.0.0';                     // versão do Kiro, comparada com o minKiro do manifesto
const pluginApi = {
  versao: () => window.cadernoDesktop ? window.cadernoDesktop.version() : api('version').then(r => r.version),
  lista: () => window.cadernoDesktop ? window.cadernoDesktop.plugins() : api('plugins'),
  escolhas: () => window.cadernoDesktop ? window.cadernoDesktop.pluginChoices() : api('plugin-choices'),
  gravarEscolhas: e => window.cadernoDesktop ? window.cadernoDesktop.savePluginChoices(e) : api('plugin-choices', e),
  dados: id => window.cadernoDesktop ? window.cadernoDesktop.pluginData(id) : api(`plugin-data/${encodeURIComponent(id)}`),
  gravarDados: (id, d) => window.cadernoDesktop ? window.cadernoDesktop.savePluginData(id, d) : api(`plugin-data/${encodeURIComponent(id)}`, d),
  fetch: (id, pedido) => window.cadernoDesktop ? window.cadernoDesktop.pluginFetch(id, pedido) : api('plugin-fetch', { pluginId: id, pedido }),
  // Chaves: só "configurada ou não" volta; o valor vai e nunca retorna.
  chaves: id => window.cadernoDesktop ? window.cadernoDesktop.pluginSecrets(id) : api(`plugin-secrets/${encodeURIComponent(id)}`),
  gravarChave: (id, nome, valor) => window.cadernoDesktop ? window.cadernoDesktop.savePluginSecret(id, nome, valor) : api(`plugin-secrets/${encodeURIComponent(id)}`, { name: nome, value: valor }),
  removerChave: async (id, nome) => {
    if (window.cadernoDesktop) return window.cadernoDesktop.removePluginSecret(id, nome);
    const r = await fetch(`/api/plugin-secrets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome }) });
    const dados = await r.json();
    if (!r.ok) throw new Error(dados.error || 'Não foi possível remover a chave.');
    return dados;
  },
};
// No aplicativo instalado a página é file://: o código do plug-in vem pelo esquema próprio.
const urlDoPlugin = id => window.cadernoDesktop ? `kiro-plugin://${id}/index.js` : `/plugins/${id}/index.js`;

async function carregarPlugins() {
  for (const id of [...pluginsAtivos.keys()]) desativarPlugin(id);
  problemasDosPlugins.clear();
  try {
    const [achados, escolhas] = await Promise.all([pluginApi.lista(), pluginApi.escolhas()]);
    planoDosPlugins = KiroPlugins.planoDeCarga(achados, escolhas, { versaoDoKiro: VERSAO });
  } catch (erro) {
    planoDosPlugins = { carregar: [], pendentes: [], problemas: [] };
    return status('Não foi possível ler os plug-ins: ' + erro.message, true);
  }
  for (const { id, erro } of planoDosPlugins.problemas) problemasDosPlugins.set(id, erro);
  for (const alvo of planoDosPlugins.carregar) ativarPlugin(alvo);
}

function ativarPlugin({ id, manifesto, permissoes }) {
  desativarPlugin(id);
  problemasDosPlugins.delete(id);
  // `permissoes` é o que o usuário concedeu, não o que o manifesto pede: é isso que vale na checagem.
  const estado = { manifesto, permissoes: [...(permissoes || [])], comandos: [], paineis: [], eventos: [], emEvento: 0, nivelDoEvento: 0, pendentes: new Map(), proxima: 1 };
  // No aplicativo o worker vem do esquema, com a CSP que corta a rede no cabeçalho
  // (file:// não tem cabeçalho e herdaria a CSP da página); na web o servidor manda a mesma CSP.
  try { estado.worker = window.cadernoDesktop ? new Worker('kiro-plugin://kiro.app/plugin-worker.js', { type: 'module' }) : new Worker('plugin-worker.js', { type: 'module' }); }
  catch (erro) { problemasDosPlugins.set(id, erro.message); return; }
  pluginsAtivos.set(id, estado);
  estado.worker.onmessage = ({ data }) => atenderPlugin(id, data || {});
  estado.worker.onerror = evento => { evento.preventDefault?.(); falharPlugin(id, evento.message || 'Erro no código do plug-in.'); };
  estado.worker.postMessage({ tipo: 'ativar', id, url: urlDoPlugin(id), permissoes: estado.permissoes });
  estado.prazo = setTimeout(() => falharPlugin(id, 'O plug-in não respondeu na ativação.'), LIMITE_ATIVACAO);
}

function desativarPlugin(id) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  clearTimeout(estado.prazo);
  for (const { rejeitar } of estado.pendentes.values()) rejeitar(new Error('O plug-in foi desativado.'));
  estado.pendentes.clear();
  estado.worker.terminate();
  pluginsAtivos.delete(id);
  for (const chave of [...conteudoDosPaineis.keys()]) if (chave.startsWith(`${id}\n`)) conteudoDosPaineis.delete(chave);
  for (const chave of [...conteudoDosBlocos.keys()]) if (chave.startsWith(`${id}\n`)) conteudoDosBlocos.delete(chave);
  agendarBlocosDosPlugins();   // os blocos dele passam a mostrar o aviso
}

// Um plug-in problemático cai sozinho: os outros e o Kiro seguem de pé.
function falharPlugin(id, mensagem) {
  const estado = pluginsAtivos.get(id);
  const nome = estado?.manifesto?.name || id;
  desativarPlugin(id);
  problemasDosPlugins.set(id, mensagem);
  status(`Plug-in ${nome}: ${mensagem}`, true);
  if (currentView === 'today' && loaded) render();
}

async function atenderPlugin(id, data) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  if (data.tipo === 'pronto') {
    clearTimeout(estado.prazo);
    estado.comandos = (data.registros?.command || []).map(r => ({ id: String(r.id), label: String(r.label || r.id) }));
    estado.paineis = (data.registros?.panel || []).map(r => ({ id: String(r.id), label: String(r.label || r.id) }));
    estado.eventos = (data.registros?.event || []).map(String);
    estado.desenhaBlocos = (data.registros?.block || []).includes('render');
    agendarBlocosDosPlugins();
    if (loaded) entregarDia(id);
    // O plug-in fica pronto depois da tela: redesenhar traz os cards dele para o Hoje.
    if (currentView === 'today' && loaded) render();
    return;
  }
  if (data.tipo === 'erro') return falharPlugin(id, data.mensagem || 'Erro no plug-in.');
  // Resposta a uma ação que nós pedimos (clique num painel, comando).
  if (data.tipo === 'resposta') {
    const pendente = estado.pendentes.get(data.chamada);
    if (!pendente) return;
    estado.pendentes.delete(data.chamada);
    clearTimeout(pendente.prazo);
    return data.erro ? pendente.rejeitar(new Error(data.erro)) : pendente.resolver(data.valor);
  }
  if (data.tipo !== 'chamada') return;
  try {
    if (!KiroPlugins.podeChamar(estado.permissoes, data.metodo)) throw new Error(`Sem permissão para ${data.metodo}.`);
    const valor = await executarMetodo(id, data.metodo, Array.isArray(data.args) ? data.args : []);
    if (JSON.stringify(valor ?? null).length > LIMITE_MENSAGEM) throw new Error('A resposta passou de 2 MB.');
    estado.worker.postMessage({ tipo: 'resposta', chamada: data.chamada, valor: valor ?? null });
  } catch (erro) {
    if (pluginsAtivos.get(id) === estado) estado.worker.postMessage({ tipo: 'resposta', chamada: data.chamada, erro: erro.message });
  }
}

// Pede ao plug-in que rode um comando, desenhe um painel ou trate um evento.
// Evento que estoura o prazo só é recusado: o plug-in continua ativo.
function chamarPlugin(id, registro, dados) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return Promise.reject(new Error('Esse plug-in não está ativo.'));
  const chamada = estado.proxima++;
  return new Promise((resolver, rejeitar) => {
    const estourou = registro.tipo === 'event' || registro.tipo === 'block'
      ? () => { estado.pendentes.delete(chamada); rejeitar(new Error(`O ${registro.tipo === 'block' ? 'bloco' : 'evento'} demorou demais para responder.`)); }
      : () => falharPlugin(id, 'O plug-in demorou demais para responder.');
    const prazo = setTimeout(estourou, LIMITE_CHAMADA);
    estado.pendentes.set(chamada, { resolver, rejeitar, prazo });
    estado.worker.postMessage({ tipo: 'acao', chamada, registro, dados });
  });
}

// ---- Eventos dos plug-ins ----
// Toda gravação (da interface ou de plug-in) e toda recarga que troca o estado
// passam por eventosDoCofre, que compara com as notas da última leitura/gravação.
const PROFUNDIDADE_EVENTOS = 3, NOTAS_POR_EVENTO = 20, CHAVE_DO_DIA = 'kiro:lastDay';
let notasDoCofre = null;                  // [{ id, updatedAt }] do cofre; null até a primeira carga

function eventosDoCofre(origem) {
  const antes = notasDoCofre;
  notasDoCofre = state.notes.map(n => ({ id: n.id, updatedAt: n.updatedAt }));
  // Primeira carga ao abrir o app: só vira referência, senão toda nota chegaria como "create".
  if (!antes) return;
  const { criadas, alteradas } = KiroPlugins.eventosDaGravacao(antes, notasDoCofre);
  if (!criadas.length && !alteradas.length) return;
  // Anti-laço: gravação feita por um plug-in dentro de um handler de evento é um nível
  // abaixo do evento que ele trata, não volta para ele e a cascata para no limite.
  const quem = origem ? pluginsAtivos.get(origem) : null;
  const nivel = quem?.emEvento ? quem.nivelDoEvento + 1 : 1;
  if (nivel > PROFUNDIDADE_EVENTOS) return;
  for (const [id, estado] of pluginsAtivos) {
    if (id === origem && estado.emEvento) continue;
    for (const [evento, ids] of [['create', criadas], ['save', alteradas]]) {
      if (!estado.eventos.includes(evento) || !KiroPlugins.deveEntregar(evento, estado.permissoes)) continue;
      for (const nota of ids.slice(0, NOTAS_POR_EVENTO).map(getNote).filter(Boolean)) entregarEvento(id, evento, { note: notaParaPlugin(nota) }, nivel);
    }
  }
}

function entregarEvento(id, evento, dados, nivel) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  // ponytail: um nível por plug-in (o maior em curso); eventos simultâneos de níveis diferentes contam pelo maior.
  estado.nivelDoEvento = estado.emEvento ? Math.max(estado.nivelDoEvento, nivel) : nivel;
  estado.emEvento++;
  chamarPlugin(id, { tipo: 'event', id: evento }, dados)
    .catch(erro => avisoDePlugin(id, `evento ${evento}: ${erro.message}`, true))
    .finally(() => { estado.emEvento--; });
}

// O último dia entregue fica no espaço do plug-in no cofre: sobrevive a fechar e
// reabrir o app e vale para o cofre em que o plug-in age, mesmo em outra máquina.
async function entregarDia(id) {
  const estado = pluginsAtivos.get(id), hoje = today();
  if (!estado?.eventos.includes('day') || estado.ultimoDia === hoje) return;
  estado.ultimoDia = hoje;
  try {
    const dados = await pluginApi.dados(id);
    if (dados[CHAVE_DO_DIA] === hoje) return;
    // Marca antes de entregar: se o handler falhar, o dia não se repete a cada 5 s.
    await pluginApi.gravarDados(id, { ...dados, [CHAVE_DO_DIA]: hoje });
  } catch (erro) { return avisoDePlugin(id, `evento day: ${erro.message}`, true); }
  if (pluginsAtivos.get(id) === estado) entregarEvento(id, 'day', { date: hoje }, 1);
}

// Aviso temporário dos plug-ins: a barra de status só aparece em erro e a recarga
// do cofre a sobrescreve. Os avisos empilham e cada um some sozinho.
const pilhaDeAvisos = Object.assign(document.createElement('div'), { id: 'avisos-plugins' });
pilhaDeAvisos.setAttribute('role', 'status');
pilhaDeAvisos.setAttribute('aria-live', 'polite');
document.body.append(pilhaDeAvisos);
function avisoDePlugin(id, texto, erro = false) {
  const aviso = document.createElement('div');
  aviso.className = `aviso-plugin${erro ? ' erro' : ''}`;
  aviso.textContent = `${pluginsAtivos.get(id)?.manifesto?.name || id}: ${String(texto).slice(0, 300)}`;
  pilhaDeAvisos.append(aviso);
  while (pilhaDeAvisos.children.length > 4) pilhaDeAvisos.firstElementChild.remove();
  setTimeout(() => aviso.remove(), erro ? 8000 : 5000);
}

// ---- Painéis e comandos na tela ----
// O plug-in devolve dados; quem desenha é o Kiro, com o tema e a skin atuais.
// O conteúdo já desenhado fica guardado para o redesenho não piscar.
const conteudoDosPaineis = new Map();     // "<id>\n<painel>" → HTML já montado
const chaveDoPainel = (id, painel) => `${id}\n${painel}`;
const seletorDoPainel = (id, painel) => `.plugin-painel[data-plugin="${CSS.escape(id)}"][data-painel="${CSS.escape(painel)}"]`;

// Um card por painel registrado; o cabeçalho traz o rótulo do painel e o nome do plug-in.
function cardsDosPlugins() {
  const cartoes = [];
  for (const [id, estado] of pluginsAtivos) {
    const nome = escapeHtml(estado.manifesto?.name || id);
    // Comandos não ficam aqui: rodam em Configurações → Plug-ins.
    for (const painel of estado.paineis) cartoes.push(`<section class="card plugin-painel" data-plugin="${escapeHtml(id)}" data-painel="${escapeHtml(painel.id)}"><div class="card-head"><h2>${escapeHtml(painel.label)}</h2><span class="plugin-fonte">${nome}</span></div><div class="plugin-conteudo">${conteudoDosPaineis.get(chaveDoPainel(id, painel.id)) || '<div class="empty">Carregando…</div>'}</div></section>`);
  }
  return cartoes.join('');
}

// Pede a cada painel visível o desenho atual. Erro do plug-in fica no card dele.
function desenharPaineisDosPlugins() {
  for (const card of document.querySelectorAll('.plugin-painel[data-painel]:not([data-painel=""])')) {
    const { plugin, painel } = card.dataset;
    chamarPlugin(plugin, { tipo: 'panel', id: painel }, { action: '', values: {} })
      .then(dados => guardarPainel(plugin, painel, dados))
      .catch(erro => guardarPainel(plugin, painel, { type: 'text', text: erro.message }));
  }
}

function guardarPainel(id, painel, dados) {
  const html = KiroPlugins.painelParaHtml(dados, { pluginId: id });
  conteudoDosPaineis.set(chaveDoPainel(id, painel), html);
  const alvo = document.querySelector(`${seletorDoPainel(id, painel)} .plugin-conteudo`);
  if (alvo) alvo.innerHTML = html;
}

/**
 * Clique ou Enter num item do painel. `open:<noteId>` é reservado do Kiro e abre a
 * nota; o resto vai para o plug-in, que devolve o painel já atualizado.
 */
function acaoDoPainel(id, painel, acao, values) {
  if (!pluginsAtivos.has(id)) return;
  if (acao.startsWith('open:')) {
    const nota = getNote(acao.slice(5));
    return nota ? abrirNota(nota) : status('A nota indicada pelo plug-in não existe mais.', true);
  }
  chamarPlugin(id, { tipo: 'panel', id: painel }, { action: acao, values: values || {} })
    .then(dados => { if (dados) guardarPainel(id, painel, dados); })
    .catch(erro => status(`Plug-in ${pluginsAtivos.get(id)?.manifesto?.name || id}: ${erro.message}`, true));
}

function rodarComandoDoPlugin(id, comando) {
  chamarPlugin(id, { tipo: 'command', id: comando }, {})
    .then(() => desenharPaineisDosPlugins())   // o comando pode ter mudado o que o painel mostra
    .catch(erro => status(`Plug-in ${pluginsAtivos.get(id)?.manifesto?.name || id}: ${erro.message}`, true));
}

// ---- Blocos ```kiro:<id> nas notas ----
// renderizarMarkdown emite o marcador com o que já houver no cache; depois do desenho,
// desenharBlocosDosPlugins pede ao plug-in o que falta. Todo HTML do plug-in passa
// pelo higienizador (ou por painelParaHtml) antes de chegar ao DOM.
const conteudoDosBlocos = new Map();      // "<id>\n<fonte>" → HTML já limpo
const blocosEmCurso = new Set();          // mesmas chaves, enquanto o plug-in desenha
const MAX_BLOCOS_GUARDADOS = 200;
const avisoDeBloco = texto => `<div class="empty plugin-bloco-aviso">${escapeHtml(texto)}</div>`;

function conteudoDoBloco(id, fonte) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return avisoDeBloco(`Plug-in ${id} não está ativo.`);
  const guardado = conteudoDosBlocos.get(`${id}\n${fonte}`);
  if (guardado !== undefined) return guardado;
  // Sem `pronto` ainda não se sabe se ele desenha blocos.
  if (estado.desenhaBlocos === false) return avisoDeBloco(`Plug-in ${estado.manifesto?.name || id} não desenha blocos.`);
  return avisoDeBloco('Carregando…');
}

let blocosAgendados = false;
function agendarBlocosDosPlugins() {
  if (blocosAgendados) return;
  blocosAgendados = true;
  // Depois que quem chamou renderizarMarkdown puser o HTML na página.
  setTimeout(() => { blocosAgendados = false; desenharBlocosDosPlugins(); }, 0);
}

function desenharBlocosDosPlugins() {
  for (const bloco of document.querySelectorAll('.plugin-bloco[data-plugin]')) {
    const id = bloco.dataset.plugin, fonte = bloco.dataset.fonte ?? '';
    const alvo = bloco.querySelector(':scope > .plugin-bloco-conteudo');
    const estado = pluginsAtivos.get(id), chave = `${id}\n${fonte}`;
    // Desenho pronto não é reescrito: a fonte do elemento não muda, então o cache também não.
    const desenho = estado && conteudoDosBlocos.has(chave) ? 'pronto' : 'aviso';
    if (alvo && !(desenho === 'pronto' && alvo.dataset.desenho === 'pronto')) {
      alvo.innerHTML = conteudoDoBloco(id, fonte);
      alvo.dataset.desenho = desenho;
    }
    if (!estado?.desenhaBlocos || conteudoDosBlocos.has(chave) || blocosEmCurso.has(chave)) continue;
    blocosEmCurso.add(chave);
    chamarPlugin(id, { tipo: 'block', id: 'render' }, { source: fonte }).then(valor => {
      blocosEmCurso.delete(chave);
      if (pluginsAtivos.get(id) !== estado) return;   // desativado no meio: nada fica guardado
      if (conteudoDosBlocos.size >= MAX_BLOCOS_GUARDADOS) conteudoDosBlocos.delete(conteudoDosBlocos.keys().next().value);
      conteudoDosBlocos.set(chave, htmlDoBloco(valor));
      agendarBlocosDosPlugins();
    }, erro => {
      blocosEmCurso.delete(chave);
      // Erro não vai para o cache: o próximo desenho da nota tenta de novo.
      for (const outro of document.querySelectorAll('.plugin-bloco[data-plugin]')) {
        if (outro.dataset.plugin !== id || outro.dataset.fonte !== fonte) continue;
        const caixa = outro.querySelector(':scope > .plugin-bloco-conteudo');
        if (caixa) caixa.innerHTML = avisoDeBloco(`Erro no bloco: ${erro.message}`);
      }
    });
  }
}

// O retorno do plug-in nunca vai cru para o DOM.
function htmlDoBloco(valor) {
  if (valor && typeof valor.html === 'string') return KiroPlugins.higienizarHtml(valor.html);
  if (valor && typeof valor.type === 'string') return KiroPlugins.painelParaHtml(valor);
  return avisoDeBloco('O plug-in não devolveu nada para desenhar.');
}

const itemDePainel = alvo => alvo?.closest('[data-acao][data-plugin]');
function dispararItemDePainel(alvo) {
  const card = alvo.closest('.plugin-painel');
  acaoDoPainel(alvo.dataset.plugin, card?.dataset.painel || '', alvo.dataset.acao || '', {});
}
document.addEventListener('click', evento => {
  const alvo = itemDePainel(evento.target);
  if (!alvo || alvo.tagName === 'FORM') return;   // o formulário responde ao envio, não ao clique
  evento.preventDefault();
  dispararItemDePainel(alvo);
});
// Teclado: os itens com ação têm role="button" e tabindex, então Enter e Espaço valem clique.
document.addEventListener('keydown', evento => {
  if (evento.key !== 'Enter' && evento.key !== ' ') return;
  const alvo = itemDePainel(evento.target);
  if (!alvo || alvo.tagName === 'FORM') return;
  evento.preventDefault();
  dispararItemDePainel(alvo);
});
document.addEventListener('submit', evento => {
  const form = evento.target.closest?.('form.plugin-form[data-plugin]');
  if (!form) return;
  evento.preventDefault();
  acaoDoPainel(form.dataset.plugin, form.closest('.plugin-painel')?.dataset.painel || '', form.dataset.acao || '', Object.fromEntries(new FormData(form)));
});

// ---- A API do plug-in traduzida para o que o app já faz com o estado ----
const caminhoDaPasta = folderId => { const p = state.folders.find(f => f.id === folderId); return p ? (p.path || p.title) : ''; };
// O plug-in conhece a pasta pelo caminho; aceitamos também o identificador.
const pastaPorNome = valor => {
  const alvo = String(valor || '').trim();
  if (!alvo) return '';
  const p = state.folders.find(f => f.id === alvo || Kiro.pathKey(f.path || f.title) === Kiro.pathKey(alvo) || Kiro.pathKey(f.title) === Kiro.pathKey(alvo));
  if (!p) throw new Error(`Pasta não encontrada: ${alvo}.`);
  return p.id;
};
const notaParaPlugin = n => ({ id: n.id, title: n.title || '', body: n.body || '', tags: [...(n.tags || [])], folder: caminhoDaPasta(n.folderId), createdAt: n.createdAt || null, updatedAt: n.updatedAt || null });
const tarefaParaPlugin = t => ({ id: t.id, title: t.title, due: t.due, priority: t.priority, done: !!t.done, noteId: t.noteId || '' });
const etiquetas = v => Array.isArray(v) ? v.map(t => String(t).trim()).filter(Boolean).slice(0, 30) : [];
const notaDoPlugin = id => { const n = getNote(String(id || '')); if (!n) throw new Error('Nota não encontrada.'); return n; };
// Gravar pelo mesmo caminho da interface: se o cofre recusar, o plug-in recebe o motivo.
async function gravar(origem) {
  if (busy || failed || !loaded) throw new Error('O cofre está ocupado ou não pôde ser lido.');
  if (!await save(origem)) throw new Error('Não foi possível gravar no cofre.');
}

// kiro.fetch: a página só repassa. Quem valida, injeta a chave e faz a chamada é o
// processo principal (Electron) ou o servidor, relendo as permissões do cofre.
const chamadasDeRede = new Map();   // id → últimas 10 chamadas da sessão: { quando, metodo, host, status, bytes, ms }
async function fetchDoPlugin(id, url, init) {
  const opcoes = init && typeof init === 'object' ? init : {};
  const pedido = { url, method: opcoes.method, headers: opcoes.headers, body: opcoes.body, secret: opcoes.secret };
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { /* o validador explica */ }
  const inicio = performance.now();
  const anotar = (status, bytes) => {
    const lista = [{ quando: Date.now(), metodo: String(opcoes.method || 'GET').toUpperCase().slice(0, 10), host, status, bytes, ms: Math.round(performance.now() - inicio) }, ...(chamadasDeRede.get(id) || [])];
    chamadasDeRede.set(id, lista.slice(0, 10));
  };
  try {
    const r = await pluginApi.fetch(id, pedido);
    anotar(r.status, r.bytes);
    return { status: r.status, headers: r.headers, text: r.text };
  } catch (erro) {
    anotar('erro', 0);
    // O IPC do Electron embrulha a mensagem ("Error invoking remote method ..."): o plug-in recebe só o motivo.
    throw new Error(String(erro.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

async function executarMetodo(id, metodo, args) {
  const [a, b] = args;
  switch (metodo) {
    case 'notes.list': {
      const { limit, folder, since } = a || {};
      const pasta = folder === undefined || folder === '' ? null : pastaPorNome(folder);
      return state.notes
        .filter(n => (pasta === null || (n.folderId || '') === pasta) && (!since || (n.updatedAt || 0) >= Number(since)))
        .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))
        .slice(0, Math.min(Number(limit) > 0 ? Number(limit) : 100, 500))
        .map(notaParaPlugin);
    }
    case 'notes.get': return notaParaPlugin(notaDoPlugin(a));
    case 'notes.current': return editing ? notaParaPlugin(editing) : null;
    case 'notes.search': {
      const q = Kiro.normalize(String(a || '').trim());
      if (!q) return [];
      return state.notes.filter(n => Kiro.normalize(n.title || '').includes(q) || Kiro.normalize(n.body || '').includes(q)).slice(0, 50).map(notaParaPlugin);
    }
    case 'notes.create': {
      const { title, folder, body, tags } = a || {};
      if (!String(title || '').trim()) throw new Error('A nota precisa de um título.');
      const nota = { id: uid(), title: String(title).trim().slice(0, 200), body: String(body || ''), links: [], tags: etiquetas(tags), folderId: pastaPorNome(folder), createdAt: Date.now(), updatedAt: Date.now() };
      state.notes = [nota, ...state.notes];
      await gravar(id);
      return notaParaPlugin(getNote(nota.id) || nota);
    }
    case 'notes.update': {
      const nota = notaDoPlugin(a), campos = b || {};
      const nova = { ...nota, updatedAt: Date.now() };
      if (campos.title !== undefined) nova.title = String(campos.title).trim().slice(0, 200);
      if (campos.body !== undefined) nova.body = String(campos.body);
      if (campos.tags !== undefined) nova.tags = etiquetas(campos.tags);
      if (campos.folder !== undefined) nova.folderId = pastaPorNome(campos.folder);
      if (!nova.title) throw new Error('A nota precisa de um título.');
      state.notes = state.notes.map(n => n.id === nota.id ? nova : n);
      // A nota aberta no editor acompanha a mudança, como no arrastar da árvore.
      if (editing?.id === nota.id) { editing = { ...nova, tags: [...nova.tags], links: [...(nova.links || [])] }; editorDirty = false; }
      await gravar(id);
      return notaParaPlugin(getNote(nota.id) || nova);
    }
    case 'notes.trash': {
      const nota = notaDoPlugin(a);
      state.notes = state.notes.filter(n => n.id !== nota.id);
      if (editing?.id === nota.id) { editing = null; editorDirty = false; currentView = 'today'; }
      await gravar(id);
      return true;
    }
    case 'notes.move': {
      const nota = notaDoPlugin(a), folderId = pastaPorNome(b);
      state.notes = state.notes.map(n => n.id === nota.id ? { ...n, folderId, updatedAt: Date.now() } : n);
      if (editing?.id === nota.id) editing = { ...editing, folderId };
      await gravar(id);
      return notaParaPlugin(getNote(nota.id));
    }
    case 'tasks.list': return state.tasks.map(tarefaParaPlugin);
    case 'tasks.create': {
      const { title, due, priority, noteId } = a || {};
      if (!String(title || '').trim()) throw new Error('A tarefa precisa de um título.');
      const tarefa = { id: uid(), title: String(title).trim().slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : today(), priority: ['Baixa', 'Média', 'Alta'].includes(priority) ? priority : 'Média', noteId: noteId && getNote(noteId) ? noteId : '', done: false };
      state.tasks = [tarefa, ...state.tasks];
      await gravar(id);
      return tarefaParaPlugin(tarefa);
    }
    case 'tasks.update': {
      const tarefa = state.tasks.find(t => t.id === String(a || ''));
      if (!tarefa) throw new Error('Tarefa não encontrada.');
      const campos = b || {}, nova = { ...tarefa };
      if (campos.title !== undefined) nova.title = String(campos.title).trim().slice(0, 200);
      if (campos.due !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(campos.due)) nova.due = campos.due;
      if (campos.priority !== undefined && ['Baixa', 'Média', 'Alta'].includes(campos.priority)) nova.priority = campos.priority;
      if (campos.done !== undefined) nova.done = !!campos.done;
      if (!nova.title) throw new Error('A tarefa precisa de um título.');
      state.tasks = state.tasks.map(t => t.id === tarefa.id ? nova : t);
      await gravar(id);
      return tarefaParaPlugin(nova);
    }
    case 'habits.list': return state.habits.map(h => ({ id: h.id, title: h.title, frequency: h.frequency, days: [...(state.habitLog[h.id] || [])] }));
    case 'habits.mark': {
      const habito = state.habits.find(h => h.id === String(a || ''));
      if (!habito) throw new Error('Hábito não encontrado.');
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : today();
      if (dia > today()) throw new Error('Não dá para marcar um dia que ainda não chegou.');
      // marcarHabito alterna; marcar de novo o que já está feito não deve desmarcar.
      if (!(state.habitLog[habito.id] || []).includes(dia)) { if (busy || failed || !loaded) throw new Error('O cofre está ocupado.'); marcarHabito(habito.id, dia); }
      return true;
    }
    case 'folders.create': {
      const { title, parent } = a || {};
      const nome = String(title || '').trim();
      if (!Kiro.validFolderName(nome)) throw new Error('Nome de pasta inválido.');
      const parentId = pastaPorNome(parent);
      if (state.folders.some(f => (f.parentId || '') === parentId && Kiro.pathKey(f.title) === Kiro.pathKey(nome))) throw new Error('Já existe uma pasta com esse nome neste local.');
      const pasta = { id: uid(), title: nome, parentId, description: '', color: Kiro.folderColor('') };
      state.folders = [pasta, ...state.folders];
      await gravar(id);
      const gravada = state.folders.find(f => f.id === pasta.id) || pasta;
      return { id: gravada.id, title: gravada.title, folder: gravada.path || gravada.title };
    }
    // O espaço do próprio plug-in: 1 MB, conferido no cofre.
    // A chave do último dia entregue é do Kiro: fica fora do que o plug-in vê e grava.
    case 'storage.get': { const { [CHAVE_DO_DIA]: _dia, ...dados } = await pluginApi.dados(id); return a === undefined ? dados : (dados[String(a)] ?? null); }
    case 'storage.set': {
      if (String(a) === CHAVE_DO_DIA) throw new Error('Essa chave é reservada pelo Kiro.');
      const dados = await pluginApi.dados(id);
      if (b === undefined || b === null) delete dados[String(a)]; else dados[String(a)] = b;
      await pluginApi.gravarDados(id, dados);
      return true;
    }
    case 'notify': { avisoDePlugin(id, String(a ?? ''), !!(b && b.error)); return true; }
    case 'fetch': return fetchDoPlugin(id, a, b);
    default: throw new Error(`Método desconhecido: ${metodo}.`);
  }
}

// ---- Aparência ----
// Preferência de tela, guardada por instalação (localStorage), não no cofre:
// é ajuste de máquina, não conteúdo que deva viajar junto com as notas.
const { APARENCIA_PADRAO, TEMAS, SKINS, contraste, corValida } = Kiro;
const ACENTOS = [['#C77DFF','Roxo'],['#4EA8DE','Azul'],['#4CC9F0','Ciano'],['#57CC99','Verde'],['#FFD166','Amarelo'],['#FF9F43','Laranja'],['#FF7EB6','Rosa'],['#FF6B6B','Vermelho']];
function lerAparencia() {
  try { return Kiro.aparenciaValida(JSON.parse(lerPreferencia('aparencia') || '{}')); } catch { return Kiro.aparenciaValida({}); }
}
function aplicarAparencia(valores) {
  const a = Kiro.aparenciaValida(valores || lerAparencia());
  const html = document.documentElement, raiz = html.style;
  html.classList.remove(...[...html.classList].filter(c => /^(tema|skin)-/.test(c)));
  html.classList.add(...Kiro.classesDaAparencia(a));
  // Tema pronto traz as próprias variáveis (temas.css); só o Personalizado usa as cores manuais inline.
  if (a.tema !== 'personalizado') {
    ['--sidebar-bg', '--content-bg', '--acento', '--acento-forte', '--acento-escuro', '--acento-texto'].forEach(p => raiz.removeProperty(p));
    return a;
  }
  raiz.setProperty('--sidebar-bg', a.sidebar);
  raiz.setProperty('--content-bg', a.content);
  const acento = a.acento;
  if (acento.toLowerCase() === APARENCIA_PADRAO.acento.toLowerCase()) ['--acento', '--acento-forte', '--acento-escuro', '--acento-texto'].forEach(p => raiz.removeProperty(p));
  else {
    raiz.setProperty('--acento', acento);
    raiz.setProperty('--acento-forte', `color-mix(in srgb, ${acento} 78%, black)`);
    raiz.setProperty('--acento-escuro', `color-mix(in srgb, ${acento} 64%, black)`);
    raiz.setProperty('--acento-texto', contraste(acento, '#000000') >= contraste(acento, '#FFFFFF') ? '#111114' : '#FFFFFF');
  }
  return a;
}
function gravarAparencia(a) {
  try { localStorage.setItem('kiro.aparencia', JSON.stringify(a)); } catch { /* janela privada: só aplica na sessão */ }
  aplicarAparencia(a);
}
const CAIXAS = [['read','Ler notas'],['create','Criar notas'],['update','Editar notas'],['delete','Excluir notas (vai para a lixeira)']];
const agentApi = {
  load: () => window.cadernoDesktop ? window.cadernoDesktop.agentConfig() : api('agent-config'),
  save: parcial => window.cadernoDesktop ? window.cadernoDesktop.saveAgentConfig(parcial) : api('agent-config', parcial),
};
// ---- Aba Plug-ins ----
// Tudo aqui age na hora: ligar pede consentimento num modal do Kiro (nunca a
// caixa nativa do navegador) e só grava depois do "sim"; desligar encerra o worker e tira os cards.
let escolhasDosPlugins = {};

// Relê a pasta e as escolhas e alinha o que está rodando com o que foi permitido.
async function lerPlugins() {
  const [achados, escolhas] = await Promise.all([pluginApi.lista(), pluginApi.escolhas()]);
  escolhasDosPlugins = escolhas || {};
  planoDosPlugins = KiroPlugins.planoDeCarga(achados, escolhasDosPlugins, { versaoDoKiro: VERSAO });
  const liberados = new Set(planoDosPlugins.carregar.map(p => p.id));
  // Manifesto mudou no disco e passou a pedir mais: para já, e pergunta de novo.
  let parou = false;
  for (const id of [...pluginsAtivos.keys()]) if (!liberados.has(id)) { desativarPlugin(id); parou = true; }
  for (const alvo of planoDosPlugins.carregar) if (!pluginsAtivos.has(alvo.id) && !problemasDosPlugins.has(alvo.id)) ativarPlugin(alvo);
  if (parou && currentView === 'today' && loaded) render();
}

// O que o plug-in vai poder fazer, em português; o que ainda não foi concedido ganha o selo "nova".
function itensDePermissao(m, novas = [], hostsNovos = []) {
  if (!m.permissions.length) return '<p class="small-muted plugin-permissoes-vazio">Não pede acesso aos seus dados.</p>';
  return `<ul class="plugin-permissoes">${m.permissions.map(p => {
    const nova = novas.includes(p) || (p === 'network' && hostsNovos.length > 0);
    const hosts = p === 'network' && m.network.length ? `: ${m.network.map(h => escapeHtml(h)).join(', ')}` : '';
    return `<li${nova ? ' class="nova"' : ''}>${escapeHtml(KiroPlugins.rotuloDaPermissao(p))}${hosts}${nova ? ' <span class="plugin-selo">nova</span>' : ''}</li>`;
  }).join('')}</ul>`;
}
const novidadesDoPlugin = (id, m) => ({
  novas: KiroPlugins.comparar(escolhasDosPlugins[id]?.permissions, m.permissions).novas,
  hostsNovos: KiroPlugins.comparar(escolhasDosPlugins[id]?.network, m.network).novas,
});

// Uma linha por plug-in. Todo texto do manifesto entra escapado.
function linhaDoPlugin({ id, manifesto }, situacao, erro = '') {
  const m = manifesto, nome = escapeHtml(m ? m.name : id);
  const { novas, hostsNovos } = situacao === 'aguardando' ? novidadesDoPlugin(id, m) : {};
  const ligado = situacao === 'ativo' || situacao === 'parou';
  // Único lugar onde os comandos rodam; a nota aberta segue aberta por baixo do modal.
  const comandos = situacao === 'ativo' ? (pluginsAtivos.get(id)?.comandos || [])
    .map(c => `<button type="button" class="secondary cfg-pequeno" data-comando-plugin="${escapeHtml(id)}" data-comando="${escapeHtml(c.id)}">${icone('plugin')} ${escapeHtml(c.label)}</button>`)
    .join('') : '';
  // Manifesto inválido não tem o que ligar; o que parou nesta sessão ainda pode ser desligado.
  const chave = m ? `<label class="cfg-chave"><input type="checkbox" data-plugin-id="${escapeHtml(id)}" ${ligado ? 'checked' : ''} aria-label="${ligado ? 'Desativar' : 'Ativar'} ${nome}" /><span class="interruptor" aria-hidden="true"></span></label>` : '';
  return `<div class="cfg-linha cfg-plugin"><span class="cfg-texto">
    <span class="cfg-titulo">${nome}</span>
    <span class="small-muted">${m ? `Versão ${escapeHtml(m.version)} · por ${escapeHtml(m.author)}` : `Pasta ${escapeHtml(id)}`}</span>
    ${m?.description ? `<span class="small-muted">${escapeHtml(m.description)}</span>` : ''}
    ${m ? itensDePermissao(m, novas, hostsNovos) : ''}
    ${comandos ? `<div class="cfg-botoes plugin-comandos-cfg">${comandos}</div>` : ''}
    ${situacao === 'aguardando' ? '<p class="cfg-aviso">Uma atualização pediu mais acesso. Ligue de novo para revisar o que é novo.</p>' : ''}
    ${erro ? `<p class="cfg-aviso">${escapeHtml(erro)}</p>` : ''}
  </span>${chave}</div>`;
}

async function conteudoDaAbaPlugins() {
  try { await lerPlugins(); }
  catch (erro) { return `<p class="cfg-aviso">Não foi possível ler os plug-ins: ${escapeHtml(erro.message)}</p>`; }
  const { carregar, pendentes, problemas } = planoDosPlugins;
  const grupos = [
    ['Ativos', carregar.filter(p => pluginsAtivos.has(p.id)).map(p => linhaDoPlugin(p, 'ativo'))],
    ['Aguardando permissão', pendentes.filter(p => p.motivo === 'permissoes-novas').map(p => linhaDoPlugin(p, 'aguardando'))],
    ['Desligados', pendentes.filter(p => p.motivo === 'desligado').map(p => linhaDoPlugin(p, 'desligado'))],
    ['Com problema', [
      ...carregar.filter(p => !pluginsAtivos.has(p.id)).map(p => linhaDoPlugin(p, 'parou', problemasDosPlugins.get(p.id) || 'O plug-in parou nesta sessão.')),
      ...problemas.map(p => linhaDoPlugin({ id: p.id }, 'problema', p.erro)),
    ]],
  ];
  const lista = grupos.filter(([, linhas]) => linhas.length).map(([titulo, linhas]) => `<h4 class="cfg-subtitulo">${titulo}</h4>${linhas.join('')}`).join('');
  const separador = (state.vaultPath || '').includes('\\') ? '\\' : '/';
  const caminho = state.vaultPath ? `${state.vaultPath.replace(/[\\/]+$/, '')}${separador}.kiro${separador}plugins${separador}` : '.kiro/plugins/';
  const botao = (id, rotulo, nomeIcone) => `<button type="button" class="secondary cfg-pequeno" id="${id}">${icone(nomeIcone)} ${rotulo}</button>`;
  return `<section class="cfg-grupo">
    <header class="cfg-grupo-topo"><span class="cfg-texto"><span class="cfg-titulo">Plug-ins</span><span class="small-muted">Cada plug-in roda isolado e só alcança o que você permitir ao ligá-lo.</span></span></header>
    ${lista || '<p class="small-muted cfg-rodape">Nenhum plug-in encontrado neste cofre.</p>'}
    <div class="cfg-linha cfg-linha-coluna"><span class="cfg-texto"><span class="cfg-titulo">Pasta de plug-ins</span><span class="small-muted">Cada plug-in é uma pasta com manifest.json e index.js.</span></span>
      <code class="cfg-caminho">${escapeHtml(caminho)}</code>
      <div class="cfg-botoes">${window.cadernoDesktop ? botao('cfg-plugins-abrir', 'Abrir pasta de plug-ins', 'pasta-aberta') : ''}${botao('cfg-plugins-copiar', 'Copiar caminho', 'copiar')}</div>
    </div>
  </section>`;
}

async function redesenharAbaPlugins(foco = '') {
  const painel = $('#painel-plugins');
  if (!painel) return;
  const html = await conteudoDaAbaPlugins();
  if (!painel.isConnected) return;
  painel.innerHTML = html;
  if (foco) painel.querySelector(`[data-plugin-id="${CSS.escape(foco)}"]`)?.focus();
}

function pedirConsentimento(id) {
  const alvo = planoDosPlugins.pendentes.find(p => p.id === id);
  if (!alvo) return redesenharAbaPlugins(id);
  const m = alvo.manifesto, nome = escapeHtml(m.name), aguardando = alvo.motivo === 'permissoes-novas';
  const { novas, hostsNovos } = aguardando ? novidadesDoPlugin(id, m) : { novas: [], hostsNovos: [] };
  modal(aguardando ? 'Plug-in pede mais acesso' : 'Ativar plug-in', `<p class="confirmar-texto">${aguardando
    ? `<strong>${nome}</strong> foi atualizado e agora pede mais do que você tinha permitido. O que está marcado como <span class="plugin-selo">nova</span> ainda não foi concedido.`
    : `Ativar <strong>${nome}</strong>, de ${escapeHtml(m.author)}?`} Ele vai poder:</p>
    ${itensDePermissao(m, novas, hostsNovos)}
    <p class="small-muted plugin-consentimento-nota">Dá para desligar quando quiser, em Configurações → Plug-ins.</p>
    <div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button type="button" class="primary" id="confirmar-plugin">${aguardando ? 'Permitir e ativar' : 'Ativar plug-in'}</button></div>`);
  const voltar = () => showSettings('plugins');
  $('#cancel').onclick = voltar;
  $('#confirmar-plugin').onclick = async () => {
    const botao = $('#confirmar-plugin');
    botao.disabled = true;
    try {
      // Relê antes de gravar: o arquivo guarda as escolhas de todos os plug-ins.
      const escolhas = await pluginApi.escolhas();
      escolhas[id] = { enabled: true, permissions: [...m.permissions], network: [...m.network], secrets: (m.secrets || []).map(s => s.name) };
      await pluginApi.gravarEscolhas(escolhas);
    } catch (erro) {
      botao.disabled = false;
      return status('Não foi possível ativar o plug-in: ' + erro.message, true);
    }
    ativarPlugin({ id, manifesto: m, permissoes: m.permissions });
    voltar();
  };
  $('#confirmar-plugin').focus();
}

async function desligarPlugin(id) {
  desativarPlugin(id);
  problemasDosPlugins.delete(id);
  if (currentView === 'today' && loaded) render();
  try {
    const escolhas = await pluginApi.escolhas();
    if (escolhas[id]) { escolhas[id] = { ...escolhas[id], enabled: false }; await pluginApi.gravarEscolhas(escolhas); }
  } catch (erro) { status('Não foi possível guardar a escolha: ' + erro.message, true); }
  redesenharAbaPlugins(id);
}

// Eventos por delegação: o conteúdo do painel é redesenhado a cada mudança.
function ligarAbaPlugins(painel) {
  painel.addEventListener('change', evento => {
    const caixa = evento.target.closest('[data-plugin-id]');
    if (!caixa) return;
    const id = caixa.dataset.pluginId;
    // Ligar só vale depois do "sim" no modal: até lá o interruptor volta para desligado.
    if (caixa.checked) { caixa.checked = false; pedirConsentimento(id); }
    else desligarPlugin(id);
  });
  painel.addEventListener('click', async evento => {
    const comando = evento.target.closest('[data-comando-plugin]');
    if (comando) return rodarComandoDoPlugin(comando.dataset.comandoPlugin, comando.dataset.comando);
    if (evento.target.closest('#cfg-plugins-abrir')) return window.cadernoDesktop.openPluginsFolder();
    const copiar = evento.target.closest('#cfg-plugins-copiar');
    if (!copiar) return;
    if (await copiarTexto(painel.querySelector('.cfg-caminho').textContent)) {
      copiar.lastChild.textContent = ' Copiado';
      setTimeout(() => { if (copiar.isConnected) copiar.lastChild.textContent = ' Copiar caminho'; }, 1500);
    }
  });
}
// ---- Fim da aba Plug-ins ----

// Aparência aplica na hora; as permissões de agente só no botão Salvar.
const ABAS_CFG = [['personalizacao', 'Personalização', 'realce'], ['sistema', 'Sistema', 'pasta-aberta'], ['integracoes', 'Integrações', 'link'], ['plugins', 'Plug-ins', 'plugin'], ['atalhos', 'Atalhos', 'codigo']];
let abaDasConfiguracoes = 'personalizacao';
const ATALHOS = [
  ['Ctrl + Espaço', 'Captura rápida', 'De qualquer tela, direto para a caixa de entrada.'],
  ['Ctrl + O', 'Ir para nota', 'Busca uma nota pelo título.'],
  ['Ctrl + N', 'Nova nota', ''],
  ['Ctrl + S', 'Salvar a nota aberta', ''],
  ['[[', 'Ligar a outra nota', 'Mostra sugestões de títulos enquanto você digita.'],
  ['Botão direito', 'Menus rápidos', 'Na árvore de pastas, nas notas, nos hábitos e dentro do texto.'],
  ['Esc', 'Fechar janela ou menu', ''],
];
async function showSettings(aba = abaDasConfiguracoes) {
  if (busy || !loaded) return;
  let conf = null, erroConf = '';
  const [, abaPlugins] = await Promise.all([
    agentApi.load().then(c => { conf = c; }, error => { erroConf = error.message; }),
    conteudoDaAbaPlugins(),
  ]);
  const cores = lerAparencia();
  const texto = (titulo, detalhe = '', id = '') => `<span class="cfg-texto"><span class="cfg-titulo"${id ? ` id="${id}"` : ''}>${titulo}</span>${detalhe ? `<span class="small-muted">${detalhe}</span>` : ''}</span>`;
  const chave = (id, titulo, marcado, detalhe = '', extra = '') => `<label class="cfg-linha cfg-chave ${extra}">${texto(titulo, detalhe)}<input type="checkbox" data-perm="${id}" ${marcado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>`;
  const cor = (id, titulo, valor) => `<div class="cfg-linha">${texto(titulo)}<label class="cor-ponto" title="Escolher cor"><input type="color" data-cor="${id}" value="${valor}" aria-label="${titulo}" /></label></div>`;
  const estiloPersonalizado = a => `--sidebar-bg:${a.sidebar};--content-bg:${a.content};--acento:${a.acento}`;
  const opcaoTema = ([id, nome]) => `<label class="tema-opcao tema-${id}"${id === 'personalizado' ? ` style="${estiloPersonalizado(cores)}"` : ''}><input type="radio" name="tema" value="${id}" class="sr-only" ${cores.tema === id ? 'checked' : ''} /><span class="tema-amostra" aria-hidden="true"><i class="tema-lateral"></i><span class="tema-tela"><b></b><b></b><em></em></span>${icone(`tema-${id}`, 'tema-icone')}</span><span class="tema-nome">${nome}</span></label>`;
  const botao = (id, rotulo, nomeIcone) => `<button type="button" class="secondary cfg-pequeno" id="${id}">${icone(nomeIcone)} ${rotulo}</button>`;
  const DETALHES = { read: 'Buscar e ler o conteúdo das notas.', create: 'Criar notas e pastas novas.', update: 'Alterar texto, título, etiquetas e pasta.', delete: 'A nota vai para a lixeira e pode ser restaurada.' };
  if (!ABAS_CFG.some(([id]) => id === aba)) aba = 'personalizacao';
  const painel = (id, conteudo) => `<div class="cfg-painel" data-painel="${id}" role="tabpanel" id="painel-${id}" aria-labelledby="aba-${id}" ${id === aba ? '' : 'hidden'}>${conteudo}</div>`;
  modal('Configurações', `<div class="cfg">
    <nav class="cfg-abas" role="tablist" aria-orientation="vertical" aria-label="Seções das configurações">${ABAS_CFG.map(([id, rotulo, nomeIcone]) => `<button type="button" role="tab" class="cfg-aba" id="aba-${id}" data-aba="${id}" aria-controls="painel-${id}" aria-selected="${id === aba}" tabindex="${id === aba ? 0 : -1}">${icone(nomeIcone)}<span>${rotulo}</span></button>`).join('')}</nav>
    <div class="cfg-conteudo">
    ${painel('personalizacao', `<section class="cfg-grupo cfg-aparencia">
      <header class="cfg-grupo-topo">${texto('Aparência', 'Muda na hora e vale só para esta instalação.')}<button type="button" class="secondary cfg-pequeno" id="cor-padrao">${icone('recarregar')} Restaurar padrão</button></header>
      <div class="cfg-linha cfg-linha-coluna">${texto('Tema', '', 'tema-rotulo')}
        ${[['classicos', 'Clássicos'], ['anime', 'Anime']].map(([grupo, titulo]) => `<div class="temas-grupo"><h4 class="cfg-subtitulo">${titulo}</h4><div class="temas" role="radiogroup" aria-labelledby="tema-rotulo">${TEMAS.filter(t => t[2] === grupo).map(opcaoTema).join('')}</div></div>`).join('')}
        <div class="temas-grupo"><div class="temas">${opcaoTema(['personalizado', 'Personalizado'])}</div></div>
      </div>
      <div class="cfg-personalizado" id="cfg-personalizado" ${cores.tema === 'personalizado' ? '' : 'hidden'}>
      ${cor('sidebar', 'Fundo da barra lateral', cores.sidebar)}
      ${cor('content', 'Fundo da área de texto', cores.content)}
      <div class="cfg-linha cfg-linha-coluna">${texto('Cor de destaque', 'Botões, ícones, links e o grafo.', 'acento-rotulo')}
        <div class="amostras" role="radiogroup" aria-labelledby="acento-rotulo">${ACENTOS.map(([hex, nome]) => `<label class="amostra" style="--cor-pasta:${hex}" title="${nome}"><input type="radio" name="acento" value="${hex}" ${hex.toLowerCase() === cores.acento.toLowerCase() ? 'checked' : ''} /><span class="sr-only">${nome}</span></label>`).join('')}<label class="cor-ponto cor-livre" title="Outra cor"><input type="color" data-cor="acento" value="${cores.acento}" aria-label="Outra cor de destaque" /></label></div>
        <p class="cfg-aviso" id="acento-aviso" hidden>Essa cor tem pouco contraste com o fundo: textos e ícones podem ficar difíceis de ler.</p>
      </div>
      </div>
      <div class="cfg-linha cfg-linha-coluna">${texto('Skin', '', 'skin-rotulo')}
        <div class="skins" role="radiogroup" aria-labelledby="skin-rotulo">${SKINS.map(([id, nome, desc]) => `<label class="skin-opcao"><input type="radio" name="skin" value="${id}" class="sr-only" ${cores.skin === id ? 'checked' : ''} /><span class="skin-nome">${nome}</span><span class="skin-desc">${desc}</span></label>`).join('')}</div>
      </div>
    </section>`)}
    ${painel('sistema', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto('Cofre', 'A pasta onde suas notas ficam, como arquivos Markdown.')}</header>
      <div class="cfg-linha cfg-linha-coluna">${texto('Local')}<code class="cfg-caminho">${escapeHtml(state.vaultPath || 'vault/')}</code>
        <div class="cfg-botoes">${window.cadernoDesktop ? botao('cfg-abrir-pasta', 'Abrir pasta', 'pasta-aberta') + botao('cfg-trocar-cofre', 'Escolher outro cofre', 'pastas') : ''}${botao('cfg-copiar-caminho', 'Copiar caminho', 'copiar')}</div>
      </div>
      <div class="cfg-linha">${texto('Recarregar cofre', 'Lê os arquivos de novo, se você editou algo fora do Kiro.')}${botao('cfg-recarregar', 'Recarregar', 'recarregar')}</div>
    </section>
    <section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto('Dados', 'Backup em um arquivo JSON com notas, pastas, tarefas e hábitos.')}</header>
      <div class="cfg-linha">${texto('Exportar backup', 'As imagens coladas nas notas não entram no arquivo.')}${botao('cfg-exportar', 'Exportar', 'exportar')}</div>
      <div class="cfg-linha">${texto('Importar backup', 'Substitui os dados atuais; antes, pede confirmação.')}<label class="secondary cfg-pequeno cfg-arquivo">${icone('importar')} Importar<input type="file" id="cfg-importar" accept="application/json" /></label></div>
      <div class="cfg-linha">${texto('Lixeira', 'Notas e pastas excluídas, prontas para restaurar.')}${botao('cfg-lixeira', 'Abrir lixeira', 'lixeira')}</div>
    </section>`)}
    ${painel('integracoes', conf ? `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto('IA e integrações', 'Agentes externos usam a Agent API, sempre dentro deste cofre. O Kiro não envia nada para a nuvem por conta própria.')}</header>
      ${chave('enabled', 'Permitir agentes neste cofre', conf.enabled, 'Liga o acesso para programas como o Claude Desktop.')}
      ${chave('mcp', 'Servidor MCP', conf.mcp.enabled, 'Conexão local pelo stdio, sem abrir porta de rede.', 'cfg-depende')}
      <h4 class="cfg-subtitulo cfg-depende">O que o agente pode fazer</h4>
      ${CAIXAS.map(([id, rotulo]) => chave(id, rotulo.replace(/ \(.*\)$/, ''), conf.permissions[id], DETALHES[id], 'cfg-depende')).join('')}
      ${chave('confirm', 'Confirmar ações destrutivas', conf.requireConfirmationForDestructive, 'Pede confirmação antes de excluir.', 'cfg-depende')}
      <p class="small-muted cfg-rodape">Guardado em <code>.kiro/agent.json</code>, dentro do cofre.</p>
    </section>
    <div class="form-actions cfg-acoes"><button type="button" class="primary" id="ai-save" disabled>Salvar permissões</button></div>` : `<p class="cfg-aviso">Não foi possível ler a configuração de agentes: ${escapeHtml(erroConf)}</p>`)}
    ${painel('plugins', abaPlugins)}
    ${painel('atalhos', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto('Atalhos', 'Para fazer as coisas sem tirar a mão do teclado.')}</header>
      ${ATALHOS.map(([tecla, titulo, detalhe]) => `<div class="cfg-linha">${texto(titulo, detalhe)}<kbd class="atalho">${tecla}</kbd></div>`).join('')}
    </section>`)}
    </div>
  </div>`);

  // Abas: clique ou setas esquerda/direita; a última aberta volta na próxima vez.
  const abas = [...document.querySelectorAll('.cfg-aba')];
  const mostrar = id => {
    abaDasConfiguracoes = id;
    abas.forEach(b => { const ativa = b.dataset.aba === id; b.setAttribute('aria-selected', ativa); b.tabIndex = ativa ? 0 : -1; });
    document.querySelectorAll('.cfg-painel').forEach(p => { p.hidden = p.dataset.painel !== id; });
  };
  abas.forEach((b, i) => {
    b.onclick = () => mostrar(b.dataset.aba);
    b.onkeydown = e => {
      const proxima = e.key === 'ArrowDown' || e.key === 'ArrowRight', anterior = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      if (!proxima && !anterior) return;
      e.preventDefault();
      const alvo = abas[(i + (proxima ? 1 : abas.length - 1)) % abas.length];
      mostrar(alvo.dataset.aba); alvo.focus();
    };
  });

  // Personalização
  const corAtual = () => ({
    ...lerAparencia(),
    tema: 'personalizado',
    sidebar: document.querySelector('[data-cor="sidebar"]').value,
    content: document.querySelector('[data-cor="content"]').value,
    acento: document.querySelector('[data-cor="acento"]').value,
  });
  // O card Personalizado mostra as cores manuais atuais.
  const gravarCores = () => { const a = corAtual(); gravarAparencia(a); document.querySelector('.tema-opcao.tema-personalizado').style.cssText = estiloPersonalizado(a); };
  // Aparência, Sistema e Plug-ins agem na hora: não contam como alteração pendente ao fechar a janela.
  for (const tipo of ['input', 'change']) document.querySelectorAll('.cfg-aparencia, [data-painel="sistema"], [data-painel="plugins"]').forEach(el => el.addEventListener(tipo, e => e.stopPropagation()));
  const avisar = () => { const a = lerAparencia(); $('#acento-aviso').hidden = contraste(a.acento, a.content) >= 3; };
  document.querySelectorAll('input[name="acento"]').forEach(r => r.onchange = () => { document.querySelector('[data-cor="acento"]').value = r.value; gravarCores(); avisar(); });
  avisar();
  document.querySelectorAll('[data-cor]').forEach(campo => {
    campo.oninput = () => { if (campo.dataset.cor === 'acento') document.querySelectorAll('input[name="acento"]').forEach(r => r.checked = r.value.toLowerCase() === campo.value.toLowerCase()); gravarCores(); avisar(); };
  });
  // Tema e skin aplicam na hora; o Personalizado abre os controles de cor.
  document.querySelectorAll('input[name="tema"]').forEach(r => r.onchange = () => { gravarAparencia({ ...lerAparencia(), tema: r.value }); $('#cfg-personalizado').hidden = r.value !== 'personalizado'; avisar(); });
  document.querySelectorAll('input[name="skin"]').forEach(r => r.onchange = () => gravarAparencia({ ...lerAparencia(), skin: r.value }));
  $('#cor-padrao').onclick = () => {
    gravarAparencia({ ...APARENCIA_PADRAO });
    document.querySelector('[data-cor="sidebar"]').value = APARENCIA_PADRAO.sidebar;
    document.querySelector('[data-cor="content"]').value = APARENCIA_PADRAO.content;
    document.querySelector('[data-cor="acento"]').value = APARENCIA_PADRAO.acento;
    document.querySelectorAll('input[name="acento"]').forEach(r => r.checked = r.value === APARENCIA_PADRAO.acento);
    document.querySelectorAll('input[name="tema"], input[name="skin"]').forEach(r => r.checked = r.value === APARENCIA_PADRAO.tema || r.value === APARENCIA_PADRAO.skin);
    document.querySelector('.tema-opcao.tema-personalizado').style.cssText = estiloPersonalizado(APARENCIA_PADRAO);
    $('#cfg-personalizado').hidden = true;
    avisar();
  };

  // Sistema
  $('#cfg-abrir-pasta')?.addEventListener('click', () => window.cadernoDesktop.openVault());
  $('#cfg-trocar-cofre')?.addEventListener('click', escolherOutroCofre);
  $('#cfg-copiar-caminho').onclick = async () => { const b = $('#cfg-copiar-caminho'); if (await copiarTexto(state.vaultPath || '')) { b.lastChild.textContent = ' Copiado'; setTimeout(() => { if (b.isConnected) b.lastChild.textContent = ' Copiar caminho'; }, 1500); } };
  $('#cfg-recarregar').onclick = () => reload(true);
  $('#cfg-exportar').onclick = exportarDados;
  $('#cfg-importar').onchange = e => { const arquivo = e.target.files[0]; e.target.value = ''; importarDados(arquivo); };
  $('#cfg-lixeira').onclick = () => { closeModal(true); showTrash(); };

  ligarAbaPlugins($('#painel-plugins'));

  // Integrações: Salvar só depois de mexer nas permissões.
  if (!conf) return;
  document.querySelectorAll('[data-perm]').forEach(c => c.addEventListener('change', () => { $('#ai-save').disabled = false; }));
  $('#ai-save').onclick = async () => {
    const marcado = id => document.querySelector(`[data-perm="${id}"]`).checked;
    try {
      await agentApi.save({
        enabled: marcado('enabled'),
        mcp: { enabled: marcado('mcp') },
        permissions: Object.fromEntries(CAIXAS.map(([id]) => [id, marcado(id)])),
        requireConfirmationForDestructive: marcado('confirm'),
      });
      modalDirty = false; $('#ai-save').disabled = true; $('#ai-save').textContent = 'Permissões salvas';
    } catch (error) { status('Não foi possível salvar: ' + error.message, true); }
  };
}
// Árvore: botão direito abre o menu da nota ou da pasta; arrastar uma nota para uma pasta a move.
document.addEventListener('contextmenu',e=>{
  if(!loaded||busy||failed)return;
  const linha=e.target.closest('.tree-row');
  if(linha)return abrirMenuContexto(e,document.body,menuDaArvore(linha));
  const habito=e.target.closest('[data-habito]');
  if(habito)return abrirMenuContexto(e,document.body,menuDoHabito(habito.dataset.habito));
  if(e.target.closest('.card.habitos, .habitos-lista'))abrirMenuContexto(e,document.body,menuDosHabitos());
});
// Soltar sobre uma nota vale como soltar na pasta dela; fora das pastas, é a raiz.
const alvoDaSoltura=e=>{const no=e.target.closest?.('.tree-node');return no?no.querySelector(':scope > .tree-folder'):e.target.closest?.('.tree');};
const limparSoltura=(exceto)=>document.querySelectorAll('.soltar-aqui').forEach(x=>x!==exceto&&x.classList.remove('soltar-aqui'));
document.addEventListener('dragstart',e=>{const nota=e.target.closest?.('.tree-note');if(!nota)return;e.dataTransfer.setData('text/kiro-nota',nota.dataset.id);e.dataTransfer.effectAllowed='move';});
document.addEventListener('dragover',e=>{
  if(!e.dataTransfer.types.includes('text/kiro-nota'))return;
  const alvo=alvoDaSoltura(e);limparSoltura(alvo);if(!alvo)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';alvo.classList.add('soltar-aqui');
});
document.addEventListener('dragend',()=>limparSoltura());
document.addEventListener('drop',e=>{
  const id=e.dataTransfer.getData('text/kiro-nota');const alvo=id&&alvoDaSoltura(e);
  limparSoltura();
  if(!alvo)return;
  e.preventDefault();moverNota(id,alvo.classList.contains('tree-folder')?alvo.dataset.id:'');
});
document.addEventListener('click',e=>{
  const extra=e.target.closest('[data-extra]');if(extra){e.preventDefault();extraAction(extra.dataset.extra,extra.dataset.id);return;}
  const el=e.target.closest('[data-action]');if(el){e.preventDefault();action(el.dataset.action,el.dataset.id);return;}
  const go=e.target.closest('[data-go]');if(go){irPara(go.dataset.go);}
});
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(loaded)irPara(b.dataset.view);});
$('#new-note').onclick=()=>{if(loaded&&!busy&&!failed)abrirNota(notaVazia());};
$('#daily-note').onclick=()=>extraAction('daily');
$('#go-note').onclick=irParaNota;
$('#settings').onclick=()=>showSettings();
// ---- Ações de sistema: ficam na aba Sistema das Configurações ----
async function escolherOutroCofre(){
  if(busy||!window.cadernoDesktop)return;closeModal(true);
  if(failed){status('Exporte suas alterações e recarregue antes de trocar de cofre.',true);return;}
  setBusy(true);
  try{const saved=await window.cadernoDesktop.chooseVault();if(saved){Kiro.validateState(saved);state=saved;loaded=true;failed=false;expanded=null;editing=null;render();}}
  catch(error){status(error.message,true);}finally{setBusy(false);}
}
function exportarDados(){
  const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=url;a.download=`kiro-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Confirmação dentro do app, como na exclusão de hábito: o confirm() nativo pode não aparecer no Electron.
async function importarDados(arquivo){
  if(!arquivo||busy||failed||!loaded)return;
  let data;
  try{data=Kiro.validateState(JSON.parse(await arquivo.text()));}
  catch(error){status('Importação cancelada: '+error.message,true);return;}
  const partes=[`${data.notes.length} nota${data.notes.length===1?'':'s'}`,`${(data.folders||[]).length} pasta${(data.folders||[]).length===1?'':'s'}`,`${(data.habits||data.routine||[]).length} hábito${(data.habits||data.routine||[]).length===1?'':'s'}`];
  modal('Importar backup',`<p class="confirmar-texto">Importar <strong>${partes.join(', ')}</strong> de <strong>${escapeHtml(arquivo.name)}</strong> e substituir os dados atuais? As notas que saírem vão para a lixeira e uma cópia do cofre atual é preservada.</p><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button type="button" class="primary" id="confirmar-importacao">Importar e substituir</button></div>`);
  $('#cancel').onclick=()=>closeModal(true);
  $('#confirmar-importacao').onclick=async()=>{
    data.notes=data.notes.map(n=>{const copy={...n};delete copy.file;return copy;});
    state={...data,revision:state.revision,vaultPath:state.vaultPath};
    if(await save())closeModal(true);
  };
}
// Ctrl+O: achar uma nota pelo título sem tirar a mão do teclado.
function irParaNota(){
  if(!loaded||failed||busy||$('#modal-root').firstChild)return;
  modal('Ir para nota','<div class="form"><input class="search ir-busca" id="ir-busca" placeholder="Digite o título da nota…" autocomplete="off" aria-label="Buscar nota" /><div class="ir-lista" id="ir-lista" role="listbox"></div></div>');
  const campo=$('#ir-busca'), lista=$('#ir-lista'); let achadas=[], marcada=0;
  const desenhar=()=>{
    const q=Kiro.normalize(campo.value.trim());
    const pontos=n=>{const t=Kiro.normalize(n.title||'');return !q?1:t.startsWith(q)?3:t.includes(q)?2:Kiro.normalize(n.body).includes(q)?1:0;};
    achadas=state.notes.map(n=>[pontos(n),n]).filter(([p])=>p).sort((a,b)=>b[0]-a[0]||b[1].updatedAt-a[1].updatedAt).slice(0,12).map(([,n])=>n);
    marcada=Math.min(marcada,Math.max(achadas.length-1,0));
    lista.innerHTML=achadas.map((n,i)=>{const p=state.folders.find(f=>f.id===n.folderId);return `<button type="button" class="ir-item${i===marcada?' marcada':''}" data-i="${i}" role="option" aria-selected="${i===marcada}"><span>${escapeHtml(n.title||'Sem título')}</span><small>${p?escapeHtml(p.path||p.title):''}</small></button>`;}).join('')||'<div class="empty">Nenhuma nota encontrada.</div>';
  };
  const abrir=n=>{if(n&&closeModal(true))abrirNota(n);};
  // Digitar a busca não é alteração de formulário: não pedir confirmação ao fechar.
  campo.addEventListener('input',e=>{e.stopPropagation();marcada=0;desenhar();});
  campo.addEventListener('keydown',e=>{
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&achadas.length){e.preventDefault();marcada=(marcada+(e.key==='ArrowDown'?1:achadas.length-1))%achadas.length;desenhar();lista.querySelector('.marcada')?.scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'){e.preventDefault();abrir(achadas[marcada]);}
  });
  lista.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)abrir(achadas[+b.dataset.i]);});
  desenhar();campo.focus();
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeModal();
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();irParaNota();}
  if(e.ctrlKey&&e.code==='Space'){e.preventDefault();capturaRapida();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();if(loaded&&!failed&&!busy&&!$('#modal-root').firstChild)abrirNota(notaVazia());}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&editing){e.preventDefault();salvarNota();}
});
window.addEventListener('beforeunload',e=>{if(busy||failed||modalDirty||editorDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('focus',()=>reload());
setInterval(()=>{if(document.hidden)return;if(lastDay!==today()){lastDay=today();if(loaded&&!busy)render();}reload();if(loaded)for(const id of pluginsAtivos.keys())entregarDia(id);},5000);
desenharIconesFixos();
aplicarAparencia();
reload();
// Plug-ins entram em paralelo com o cofre: só precisam da versão do Kiro, que é
// o que o manifesto compara em minKiro.
(async () => {
  try { VERSAO = await pluginApi.versao() || VERSAO; } catch { /* sem versão, o minKiro não é conferido */ }
  await carregarPlugins();
})();
