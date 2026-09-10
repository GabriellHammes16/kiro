const today = () => Kuroi.localDate();
const uid = () => crypto.randomUUID();
let state = { notes: [], tasks: [], routine: [], folders: [] };
let currentView = "today";

async function loadFromVault() { return window.cadernoDesktop ? window.cadernoDesktop.loadState() : api('state'); }
async function save() {
  if (busy || failed || !loaded) return false;
  const snapshot = structuredClone(state);
  setBusy(true); status('Salvando…');
  try {
    Kuroi.validateState(snapshot);
    state = window.cadernoDesktop ? await window.cadernoDesktop.saveState(snapshot) : await api('state', snapshot);
    status('Salvo no cofre'); render(); return true;
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
  const views = { today: renderToday, notes: renderNotes, tasks: renderTasks, studies: renderFolders, editor: renderEditor };
  const app = document.querySelector("#app");
  app.innerHTML = views[currentView]();
  // Animar só na troca de tela: um redesenho comum não deve piscar.
  if (renderedView !== currentView) { app.classList.remove("view-enter"); void app.offsetWidth; app.classList.add("view-enter"); renderedView = currentView; }
  bindView(); updateCount();
}
function head(eyebrow, title, description, action="") { return `<header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${description}</p></div>${action}</header>`; }
function check(done, action, id) { return `<button class="check ${done ? "done" : ""}" aria-label="Marcar como ${done ? "não concluído" : "concluído"}" data-action="${action}" data-id="${id}"></button>`; }
function taskRow(task) { return `<div class="task-item">${check(task.done,"toggle-task",task.id)}<div class="task-title">${escapeHtml(task.title)}<div class="task-info">${dateLabel(task.due)}${task.noteId && getNote(task.noteId) ? ` · ${escapeHtml(getNote(task.noteId).title)}` : ""}</div></div>${task.priority === "Alta" ? '<span class="priority">Alta</span>' : ""}<div class="task-actions"><button class="icon-button" data-action="edit-task" data-id="${task.id}" title="Editar">✎</button><button class="icon-button" data-action="delete-task" data-id="${task.id}" title="Excluir">×</button></div></div>`; }
function renderToday() { const routineDone = state.routine.filter(r=>r.date===today() && r.done).length; const urgent = state.tasks.filter(t => !t.done && t.due <= today()); const recent = [...state.notes].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,3); return `${head("Seu espaço pessoal", "Bom dia", `${formatDate(today())}. Um passo de cada vez.`)}<div class="today-grid"><div class="stack"><section class="card"><div class="card-head"><h2>Rotina de hoje</h2><span class="small-muted">${routineDone}/${state.routine.length}</span></div>${state.routine.map(r=>`<div class="routine-item">${check(r.date===today() && r.done,"toggle-routine",r.id)}<span class="routine-title">${escapeHtml(r.title)}</span></div>`).join("")}<div class="progress"><div style="width:${state.routine.length ? routineDone/state.routine.length*100 : 0}%"></div></div></section><section class="card"><div class="card-head"><h2>Notas recentes</h2><a data-go="notes">Ver todas</a></div>${recent.map(n=>`<div class="routine-item"><span class="brand-mark">◈</span><span class="routine-title">${escapeHtml(n.title)}</span><button class="icon-button" data-action="edit-note" data-id="${n.id}">›</button></div>`).join("") || '<div class="empty">Nenhuma nota ainda.</div>'}</section></div><div class="stack"><section class="card"><div class="card-head"><h2>Para fazer agora</h2><a data-go="tasks">Ver tarefas</a></div>${urgent.map(taskRow).join("") || '<div class="empty">Nada urgente. Ótimo momento para avançar nos estudos.</div>'}</section><section class="card"><div class="card-head"><h2>Estudos</h2><a data-go="studies">Abrir área</a></div>${state.folders.slice(0,3).map(f=>{const total=state.notes.filter(n=>n.folderId===f.id).length;return `<div class="routine-item"><span class="brand-mark">◈</span><span class="routine-title">${escapeHtml(f.path||f.title)}</span><span class="small-muted">${total} nota${total===1?"":"s"}</span></div>`;}).join("") || '<div class="empty">Nenhuma pasta ainda.</div>'}</section></div></div>`; }
function renderNotes() { return `${head("Biblioteca", "Notas", "Escreva, revise e mantenha suas referências perto.", '<button class="primary" id="add-note">＋ Nova nota</button>')}<div class="toolbar"><input class="search" id="note-search" placeholder="Buscar texto ou #tag…" /></div><section class="notes-grid" id="notes-grid">${notesMarkup(state.notes)}</section>`; }
function notesMarkup(notes) { return notes.length ? [...notes].sort((a,b)=>b.updatedAt-a.updatedAt).map(n=>{const folder=state.folders.find(f=>f.id===n.folderId);return `<article class="note-card" data-action="edit-note" data-id="${n.id}"><h2>${escapeHtml(n.title || "Sem título")}</h2><p>${escapeHtml(n.body.slice(0,160) || "Nota vazia")}</p><div class="note-meta">${folder ? `▣ ${escapeHtml(folder.path||folder.title)} · ` : ""}${Kuroi.tags(n).map(t=>`#${escapeHtml(t)}`).join(" ")} · ${n.links.length} link${n.links.length === 1 ? "" : "s"} · atualizado ${new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}).format(n.updatedAt)}</div></article>`;}).join("") : '<div class="empty">Crie sua primeira nota para começar.</div>'; }
function renderTasks() { const open = state.tasks.filter(t=>!t.done).sort((a,b)=>a.due.localeCompare(b.due)); const done = state.tasks.filter(t=>t.done); return `${head("Organização", "Tarefas", "Concentre-se no que realmente importa hoje.", '<button class="primary" id="add-task">＋ Nova tarefa</button>')}<div class="task-layout"><section class="card"><div class="task-group"><h2>Em aberto</h2>${open.map(taskRow).join("") || '<div class="empty">Tudo concluído por aqui.</div>'}</div><div class="task-group"><h2>Concluídas</h2>${done.map(taskRow).join("") || '<div class="empty">As tarefas concluídas aparecerão aqui.</div>'}</div></section><aside class="card"><h2>Seu foco</h2><p class="subhead">Você tem <strong>${open.length}</strong> tarefa${open.length===1?"":"s"} em aberto.</p><div class="progress"><div style="width:${state.tasks.length ? done.length/state.tasks.length*100 : 0}%"></div></div><p class="small-muted">${done.length} de ${state.tasks.length} concluídas</p></aside></div>`; }
const byTitle = (a,b) => a.title.localeCompare(b.title,'pt-BR',{numeric:true});
const childFolders = id => state.folders.filter(f=>(f.parentId||"")===id).sort(byTitle);
const folderNotes = id => state.notes.filter(n=>(n.folderId||"")===id).sort(byTitle);
// Árvore no estilo de um explorador de arquivos: pastas aninhadas, notas como folhas.
function treeMarkup(parentId, depth) {
  if (depth > 20) return ""; // guarda contra ciclo, mesmo que validateState já recuse
  const folders = childFolders(parentId).map(folder => {
    const open = expanded.has(folder.id);
    const temFilhos = childFolders(folder.id).length || folderNotes(folder.id).length;
    const tools = `<span class="tree-tools"><button class="icon-button" data-action="new-note-folder" data-id="${folder.id}" title="Nova nota nesta pasta">＋</button><button class="icon-button" data-action="new-subfolder" data-id="${folder.id}" title="Nova subpasta">▣</button><button class="icon-button" data-action="edit-folder" data-id="${folder.id}" title="Renomear ou mover">✎</button><button class="icon-button" data-action="delete-folder" data-id="${folder.id}" title="Excluir">×</button></span>`;
    // Filhos ficam sempre no DOM: abrir e fechar vira transição de CSS, sem redesenhar.
    return `<div class="tree-node${open?" open":""}" data-id="${folder.id}"><div class="tree-row tree-folder" data-action="toggle-folder" data-id="${folder.id}" style="--depth:${depth}"${folder.description?` title="${escapeHtml(folder.description)}"`:""}><span class="twisty">${temFilhos?"›":""}</span><span class="tree-name">${escapeHtml(folder.title)}</span>${tools}</div><div class="tree-children"><div class="tree-children-inner">${treeMarkup(folder.id,depth+1)}</div></div></div>`;
  }).join("");
  const notes = folderNotes(parentId).map(note => {
    const tags = Kuroi.tags(note).slice(0,2).map(t=>`#${escapeHtml(t)}`).join(" ");
    return `<div class="tree-row tree-note" data-action="edit-note" data-id="${note.id}" style="--depth:${depth}"><span class="twisty"></span><span class="tree-name">${escapeHtml(note.title||"Sem título")}</span><span class="tree-meta">${tags}</span></div>`;
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
function renderFolders() {
  if (expanded === null) expanded = new Set(state.folders.map(f=>f.id));
  const corpo = treeMarkup("",0) || '<div class="empty">Crie uma pasta para organizar seus estudos.</div>';
  return `${head("Aprendizado", "Pastas de estudo", "A árvore do seu cofre. Clique numa pasta para abrir ou fechar.", '<button class="primary" id="add-folder">＋ Nova pasta</button>')}<section class="card tree-panel"><div class="tree-head"><span class="small-muted">${state.folders.length} pasta${state.folders.length===1?"":"s"} · ${state.notes.length} nota${state.notes.length===1?"":"s"}</span><span class="tree-head-actions"><button class="secondary" id="expand-all">Expandir tudo</button><button class="secondary" id="collapse-all">Recolher tudo</button></span></div><div class="tree">${corpo}</div></section>`;
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
    const q=Kuroi.normalize(e.target.value);
    document.querySelector('#notes-grid').innerHTML=notesMarkup(state.notes.filter(n=>q.startsWith('#') ? Kuroi.tags(n).some(t=>Kuroi.normalize(t).includes(q.slice(1))) : Kuroi.normalize(n.title+' '+n.body+' '+Kuroi.tags(n).join(' ')).includes(q)));
  });
  if(currentView==="editor"){bindEditor();return;}
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
  if(type==="new-subfolder") folderModal({title:"",description:"",parentId:id}); if(type==="toggle-routine"){const r=state.routine.find(x=>x.id===id);r.done=r.date===today()?!r.done:true;r.date=today();save();render();} if(type==="toggle-task"){const t=state.tasks.find(x=>x.id===id);t.done=!t.done;save();render();} if(type==="edit-note") abrirNota(getNote(id)); if(type==="new-note-folder") abrirNota(notaVazia({folderId:id})); if(type==="edit-task") taskModal(state.tasks.find(x=>x.id===id)); if(type==="edit-folder") folderModal(state.folders.find(x=>x.id===id)); if(type==="delete-task"){state.tasks=state.tasks.filter(x=>x.id!==id);save();render();} if(type==="delete-folder") deleteFolder(id); }
// Excluir uma pasta leva junto suas subpastas; as notas continuam no cofre, na raiz.
function deleteFolder(id) {
  const ids=Kuroi.descendants(state.folders,id);
  const notes=state.notes.filter(n=>ids.has(n.folderId));
  if((ids.size>1||notes.length)&&!confirm(`Esta pasta contém ${ids.size-1} subpasta${ids.size===2?"":"s"} e ${notes.length} nota${notes.length===1?"":"s"}. As subpastas serão excluídas e as notas irão para a raiz do cofre. Continuar?`))return;
  state.notes=state.notes.map(n=>ids.has(n.folderId)?{...n,folderId:""}:n);
  state.folders=state.folders.filter(f=>!ids.has(f.id));
  save();render();
}
function modal(title, body) { modalDirty=false; document.querySelector("#modal-root").innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h2>${title}</h2><button class="icon-button" id="close-modal">×</button></header>${body}</section></div>`; document.querySelector(".modal").addEventListener("input",()=>modalDirty=true); document.querySelector(".modal").addEventListener("change",()=>modalDirty=true); document.querySelector("#close-modal").onclick=()=>closeModal(); document.querySelector(".modal-backdrop").onclick=e=>{if(e.target===e.currentTarget)closeModal();}; }
function closeModal(force=false){ if(!force && (busy || (modalDirty && !confirm('Descartar as alterações deste formulário?'))))return false; document.querySelector('#modal-root').innerHTML='';modalDirty=false;return true; }
function taskModal(task={title:"",due:today(),priority:"Média",noteId:""}) { modal(task.id?"Editar tarefa":"Nova tarefa", `<form class="form" id="task-form"><div class="field"><label>Tarefa</label><input name="title" required value="${escapeHtml(task.title)}" placeholder="O que precisa ser feito?" /></div><div class="two-cols"><div class="field"><label>Data</label><input name="due" type="date" value="${task.due}" required /></div><div class="field"><label>Prioridade</label><select name="priority">${["Baixa","Média","Alta"].map(p=>`<option ${p===task.priority?"selected":""}>${p}</option>`).join("")}</select></div></div><div class="field"><label>Nota associada (opcional)</label><select name="noteId"><option value="">Nenhuma</option>${state.notes.map(n=>`<option value="${n.id}" ${n.id===task.noteId?"selected":""}>${escapeHtml(n.title)}</option>`).join("")}</select></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Salvar tarefa</button></div></form>`);document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#task-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const saved={...task,id:task.id||uid(),title:f.get("title"),due:f.get("due"),priority:f.get("priority"),noteId:f.get("noteId"),done:task.done||false};state.tasks=task.id?state.tasks.map(t=>t.id===task.id?saved:t):[saved,...state.tasks];save();closeModal(true);render();}; }
function folderModal(folder={title:"",description:"",parentId:""}) { modal(folder.id?"Editar pasta":"Nova pasta de estudo", `<form class="form" id="folder-form"><div class="field"><label>Nome da pasta</label><input name="title" required value="${escapeHtml(folder.title)}" placeholder="Ex.: JAVA, Inglês, programação" /><small class="small-muted">Vira uma pasta de verdade no cofre: sem &lt; &gt; : " / \\ | ? * e sem ponto ou espaço no início ou no final.</small></div><div class="field"><label>Dentro de</label><select name="parentId"><option value="">Raiz do cofre</option>${state.folders.filter(f=>!(folder.id?Kuroi.descendants(state.folders,folder.id):new Set()).has(f.id)).sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===(folder.parentId||"")?"selected":""}>${escapeHtml(f.path||f.title)}</option>`).join("")}</select></div><div class="field"><label>Descrição</label><textarea name="description" placeholder="Qual é seu objetivo com esta pasta?">${escapeHtml(folder.description||"")}</textarea></div><div class="form-actions"><button type="button" class="secondary" id="cancel">Cancelar</button><button class="primary">Salvar pasta</button></div></form>`);document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#folder-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=f.get("title").trim();
  // Validar aqui evita que um nome inválido bloqueie a janela no salvamento.
  if(!Kuroi.validFolderName(title)){alert('Nome de pasta inválido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.');return;}
  const parentId=f.get("parentId")||"";
  const saved={...folder,id:folder.id||uid(),title,parentId,description:f.get("description")};
  if(state.folders.some(x=>x.id!==saved.id&&(x.parentId||"")===parentId&&Kuroi.pathKey(x.title)===Kuroi.pathKey(title))){alert("Já existe uma pasta com esse nome neste local.");return;}
  state.folders=folder.id?state.folders.map(x=>x.id===folder.id?saved:x):[saved,...state.folders];
  // Deixar visível o que acabou de ser criado ou movido.
  if(expanded){expanded.add(saved.id);if(parentId)expanded.add(parentId);}
  save();closeModal(true);currentView="studies";render();}; }
let busy=false, failed=false, loaded=false, modalDirty=false, lastDay=today();
// null = ainda não semeado; na primeira exibição a árvore abre inteira.
let expanded=null, renderedView=null, editing=null, editorDirty=false;
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
function status(message,error=false){$('#save-status').textContent=message;$('#save-status').classList.toggle('error',error);}
function setBusy(value){busy=value;document.body.classList.toggle('saving',value);$('.app-shell').inert=value;$('#modal-root').inert=value;}
async function reload(manual=false){
  if(busy||(!manual&&(failed||editorDirty||$('#modal-root').firstChild)))return;
  if(manual&&(failed||modalDirty)&&!confirm('Recarregar descarta alterações ainda não salvas nesta janela. Exporte seus dados ou copie o texto antes de continuar. Recarregar?'))return;
  setBusy(true);
  try{
    const saved=await loadFromVault();Kuroi.validateState(saved);
    const changed=state.revision!==saved.revision||!loaded;
    state=saved;loaded=true;failed=false;$('#vault-path').textContent=state.vaultPath;
    if(manual)closeModal(true);if(changed||manual)render();status('Cofre atualizado');
  }catch(error){status('Não foi possível ler o cofre: '+error.message,true);}
  finally{setBusy(false);}
}
const extraButton=(action,label,id='',cls='secondary')=>`<button type="button" class="${cls}" data-extra="${action}" data-id="${escapeHtml(id)}">${label}</button>`;
function enhanceView(){
  if(currentView!=='today')return;
  $('.page-head').insertAdjacentHTML('beforeend',extraButton('daily','Abrir nota diária','','primary'));
  $('.page-head').insertAdjacentHTML('afterend','<section class="card capture"><form id="capture-form"><label for="capture-text">Captura rápida</label><div class="add-link"><input id="capture-text" required placeholder="Uma ideia, uma pergunta, algo para lembrar…" /><button class="primary">Guardar</button></div></form></section>');
  $('.card-head').insertAdjacentHTML('beforeend',extraButton('add-routine','＋','','icon-button'));
  $('#capture-form').onsubmit=async e=>{
    e.preventDefault();if(busy||failed)return;const body=$('#capture-text').value.trim();if(!body)return;
    state.notes.unshift({id:uid(),title:body.slice(0,80),body,links:[],tags:['inbox'],updatedAt:Date.now(),folderId:''});await save();
  };
}
function connections(note,body){
  const links=Kuroi.wikiLinks(body).map(link=>{const target=Kuroi.findLinkedNote(state.notes,link.target);return extraButton(target?'open-connection':'create-connection',escapeHtml(link.label)+(target?'':' ＋'),target?.id||link.target,'tag');}).join('');
  const backlinks=state.notes.filter(n=>n.id!==note.id&&Kuroi.wikiLinks(n.body).some(link=>note.id ? Kuroi.findLinkedNote(state.notes,link.target)?.id===note.id : Kuroi.normalize(link.target)===Kuroi.normalize(note.title)));
  return `<h3>Links nesta nota</h3><div class="tag-list">${links||'<span class="small-muted">Escreva [[Nome da nota]] para conectar suas ideias.</span>'}</div><h3>Notas que apontam para cá</h3><div class="tag-list">${backlinks.map(n=>extraButton('open-connection',escapeHtml(n.title),n.id,'tag')).join('')||'<span class="small-muted">Ainda não há backlinks.</span>'}</div>`;
}
// ---- Editor de documento: a nota ocupa a página inteira, como um processador de texto. ----
async function abrirNota(nota){
  if(currentView==='editor'&&editorDirty&&!await salvarNota())return;
  editing={...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]};
  editorDirty=false;currentView='editor';render();
}
async function sairDoEditor(destino){
  if(editorDirty&&!await salvarNota())return false;
  editing=null;currentView=destino;render();return true;
}
function renderEditor(){
  const nota=editing, pasta=state.folders.find(f=>f.id===nota.folderId);
  const opcoes=`<option value="">Raiz do cofre</option>`+state.folders.slice().sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===nota.folderId?'selected':''}>${escapeHtml(f.path||f.title)}</option>`).join('');
  const modelos=Object.entries(templates).map(([k,t])=>`<option value="${k}">${escapeHtml(t.title)}</option>`).join('');
  return `<header class="doc-bar"><div class="crumbs"><button class="linklike" data-editor="voltar">▣ Pastas</button><span>/</span><span>${pasta?escapeHtml(pasta.path||pasta.title):'Raiz do cofre'}</span></div><div class="doc-actions"><span class="small-muted" id="doc-state"></span><button class="secondary" data-editor="detalhes">Detalhes</button>${nota.id?'<button class="secondary" data-editor="lixeira">Mover para lixeira</button>':''}<button class="primary" data-editor="salvar">Salvar</button></div></header>
<input class="doc-title" id="doc-title" value="${escapeHtml(nota.title)}" placeholder="Sem título" aria-label="Título da nota" />
<section class="doc-details" id="doc-details" hidden><div class="two-cols"><div class="field"><label for="doc-folder">Pasta</label><select id="doc-folder">${opcoes}</select></div><div class="field"><label for="doc-tags">Tags (separadas por vírgulas)</label><input id="doc-tags" value="${escapeHtml(nota.tags.join(', '))}" placeholder="ideias, estudos" /></div></div><div class="two-cols"><div class="field"><label for="doc-template">Modelo</label><select id="doc-template"><option value="">Escolher modelo…</option>${modelos}</select></div><div class="field"><label for="doc-link">Anexar link</label><div class="add-link"><input id="doc-link" placeholder="Cole um link de aula ou vídeo" /><button type="button" class="secondary" id="doc-link-add">Anexar</button></div></div></div><div class="links-list" id="doc-links"></div></section>
<textarea class="doc-body" id="doc-body" placeholder="Comece a escrever. Cole links à vontade; [[Nome da nota]] conecta ideias e #tag marca a nota." aria-label="Conteúdo da nota">${escapeHtml(nota.body)}</textarea>
<section class="connections" id="connections">${connections(nota,nota.body)}</section>`;
}
function estadoDoc(){ const el=$('#doc-state'); if(el) el.textContent=editorDirty?'Não salvo':(editing?.id?'Salvo':'Nova nota'); }
function desenharLinksDoc(){
  const caixa=$('#doc-links'); if(!caixa) return;
  caixa.innerHTML=editing.links.map((l,i)=>`<div class="link-row"><a href="${escapeHtml(Kuroi.safeUrl(l)||'#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a><button class="icon-button" type="button" data-remove-link="${i}">×</button></div>`).join('');
  caixa.querySelectorAll('[data-remove-link]').forEach(b=>b.onclick=()=>{editing.links.splice(+b.dataset.removeLink,1);editorDirty=true;estadoDoc();desenharLinksDoc();});
}
function bindEditor(){
  const titulo=$('#doc-title'), corpo=$('#doc-body');
  const sujar=()=>{editorDirty=true;estadoDoc();};
  titulo.oninput=()=>{editing.title=titulo.value;sujar();};
  corpo.oninput=()=>{editing.body=corpo.value;sujar();$('#connections').innerHTML=connections(editing,corpo.value);};
  $('#doc-folder').onchange=e=>{editing.folderId=e.target.value;sujar();};
  $('#doc-tags').oninput=e=>{editing.tags=e.target.value.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean);sujar();};
  $('#doc-template').onchange=e=>{
    if(!e.target.value)return;
    if(corpo.value&&!confirm('Substituir o texto desta nota pelo modelo?')){e.target.value='';return;}
    corpo.value=templates[e.target.value].body;editing.body=corpo.value;sujar();$('#connections').innerHTML=connections(editing,corpo.value);
  };
  $('#doc-link-add').onclick=()=>{
    const campo=$('#doc-link'), valor=campo.value.trim();
    if(!Kuroi.safeUrl(valor)){alert('Informe um endereço http:// ou https:// válido.');return;}
    editing.links.push(valor);campo.value='';sujar();desenharLinksDoc();
  };
  corpo.addEventListener('contextmenu', e => abrirMenuContexto(e, corpo));
  document.querySelectorAll('[data-editor]').forEach(b=>b.onclick=()=>acaoEditor(b.dataset.editor));
  desenharLinksDoc();estadoDoc();
  (editing.id?corpo:titulo).focus();
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
  const limpo = Kuroi.safeUrl(url.trim());
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
  try { await navigator.clipboard.writeText(sel); } catch { status('Não foi possível copiar.', true); return; }
  if (recortar) inserirTexto(area, '');
}
const TABELA = '| Coluna | Coluna |\n| --- | --- |\n|  |  |\n';
const temSelecao = area => area.selectionStart !== area.selectionEnd;
function menuDaNota() {
  return [
    { rotulo: 'Adicionar link', icone: '🔗', acao: a => envolver(a, '[[', ']]') },
    { rotulo: 'Adicionar link externo', icone: '↗', acao: linkExterno },
    { separador: true },
    { rotulo: 'Formatar', icone: '✎', filhos: [
      { rotulo: 'Negrito', icone: 'B', acao: a => envolver(a, '**') },
      { rotulo: 'Itálico', icone: 'I', acao: a => envolver(a, '*') },
      { rotulo: 'Riscado', icone: 'S', acao: a => envolver(a, '~~') },
      { rotulo: 'Realce', icone: '▨', acao: a => envolver(a, '==') },
      { separador: true },
      { rotulo: 'Código', icone: '<>', acao: a => envolver(a, '`') },
      { rotulo: 'Equação', icone: 'Σ', acao: a => envolver(a, '$') },
      { rotulo: 'Comentário', icone: '%', acao: a => envolver(a, '%%') },
      { separador: true },
      { rotulo: 'Limpar formatação', icone: '⌫', acao: a => {
        const i = a.selectionStart, sel = a.value.slice(i, a.selectionEnd);
        if (!sel) return;
        const limpo = sel.replace(/\*\*|~~|==|%%|[*`$]/g, '');
        inserirTexto(a, limpo);
        a.setSelectionRange(i, i + limpo.length);
      } },
    ] },
    { rotulo: 'Parágrafo', icone: '¶', filhos: [
      { rotulo: 'Texto normal', acao: a => porLinha(a, semPrefixo) },
      { separador: true },
      { rotulo: 'Título 1', acao: a => prefixar(a, '# ') },
      { rotulo: 'Título 2', acao: a => prefixar(a, '## ') },
      { rotulo: 'Título 3', acao: a => prefixar(a, '### ') },
      { separador: true },
      { rotulo: 'Lista com marcadores', acao: a => prefixar(a, '- ') },
      { rotulo: 'Lista numerada', acao: a => { let n = 0; porLinha(a, l => (++n) + '. ' + semPrefixo(l)); } },
      { rotulo: 'Lista de tarefas', acao: a => prefixar(a, '- [ ] ') },
      { rotulo: 'Citação', acao: a => prefixar(a, '> ') },
    ] },
    { rotulo: 'Inserir', icone: '＋', filhos: [
      { rotulo: 'Nota de rodapé', icone: 'a1', acao: a => {
        const n = (a.value.match(/\[\^(\d+)\]/g) || []).length + 1;
        inserirTexto(a, '[^' + n + ']');
        const fim = a.selectionStart;
        const rodape = (a.value.endsWith('\n') ? '' : '\n') + '\n[^' + n + ']: ';
        a.setSelectionRange(a.value.length, a.value.length);
        inserirTexto(a, rodape);
        a.setSelectionRange(fim, fim);
      } },
      { rotulo: 'Tabela', icone: '▦', acao: a => inserirBloco(a, TABELA) },
      { rotulo: 'Destaque', icone: '❝', acao: a => inserirBloco(a, '> [!note]\n> ') },
      { rotulo: 'Régua horizontal', icone: '—', acao: a => inserirBloco(a, '---\n') },
      { separador: true },
      { rotulo: 'Bloco de código', icone: '<>', acao: a => { inserirBloco(a, '```\n\n```\n'); const p = a.selectionStart - 5; a.setSelectionRange(p, p); } },
      { rotulo: 'Equação em bloco', icone: 'Σ', acao: a => { inserirBloco(a, '$$\n\n$$\n'); const p = a.selectionStart - 4; a.setSelectionRange(p, p); } },
    ] },
    { separador: true },
    { rotulo: 'Cortar', icone: '✂', ativo: temSelecao, acao: a => copiarSelecao(a, true) },
    { rotulo: 'Copiar', icone: '⧉', ativo: temSelecao, acao: a => copiarSelecao(a, false) },
    { rotulo: 'Colar', icone: '⎘', acao: colar },
    { separador: true },
    { rotulo: 'Selecionar tudo', icone: '⬚', acao: a => a.select() },
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
  for (const item of itens) {
    if (item.separador) { nivel.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    const habilitado = item.ativo ? item.ativo(area) : true;
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ctx-item' + (item.filhos ? ' tem-filhos' : '');
    linha.disabled = !habilitado;
    linha.innerHTML = '<span class="ctx-icone">' + escapeHtml(item.icone || '') + '</span><span class="ctx-rotulo">' + escapeHtml(item.rotulo) + '</span>' + (item.filhos ? '<span class="ctx-seta">›</span>' : '');
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
function abrirMenuContexto(evento, area) {
  evento.preventDefault();
  fecharMenuContexto();
  const menu = montarNivel(menuDaNota(), area);
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
  if(tipo==='voltar')return void await sairDoEditor('studies');
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
  const salva={...editing,id:editing.id||uid(),title:editing.title.trim(),updatedAt:Date.now()};
  state.notes=editing.id?state.notes.map(n=>n.id===editing.id?salva:n):[salva,...state.notes];
  editing=salva;
  if(!await save())return false;
  const atual=getNote(salva.id);
  if(atual)editing={...atual,tags:[...(atual.tags||[])],links:[...(atual.links||[])]};
  editorDirty=false;render();return true;
}
async function extraAction(type,id){
  if(busy||failed||!loaded)return;
  if(type==='daily')abrirNota(state.notes.find(n=>n.title===today())||notaVazia({title:today(),body:templates.daily.body,tags:['diario']}));
  if(type==='open-connection'||type==='create-connection'){
    if(!closeModal())return;
    abrirNota(type==='open-connection'?getNote(id):notaVazia({title:id}));
  }
  if(type==='add-routine'){
    modal('Novo hábito','<form id="routine-form" class="form"><div class="field"><label for="routine-title">Qual hábito você quer acompanhar?</label><input id="routine-title" required /></div><button class="primary">Adicionar hábito</button></form>');
    $('#routine-form').onsubmit=async e=>{e.preventDefault();state.routine.push({id:uid(),title:$('#routine-title').value,date:today(),done:false});if(await save())closeModal(true);};
  }
}
async function showTrash(){
  if(!loaded||failed||busy)return;
  try{
    const notes=window.cadernoDesktop?await window.cadernoDesktop.trash():await api('trash');
    modal('Lixeira',notes.length?notes.map(n=>`<div class="routine-item"><span class="routine-title">${escapeHtml(n.title)}</span><button class="secondary" data-restore="${escapeHtml(n.id)}">Restaurar</button></div>`).join(''):'<p>A lixeira está vazia.</p>');
    document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{
      if(busy||failed)return;const note=structuredClone(notes.find(n=>n.id===b.dataset.restore));delete note.file;delete note.deletedAt;
      state.notes.push(note);if(await save())closeModal(true);
    });
  }catch(error){status(error.message,true);}
}
const agentApi = {
  load: () => window.cadernoDesktop ? window.cadernoDesktop.agentConfig() : api('agent-config'),
  save: parcial => window.cadernoDesktop ? window.cadernoDesktop.saveAgentConfig(parcial) : api('agent-config', parcial),
};
const CAIXAS = [['read','Ler notas'],['create','Criar notas'],['update','Editar notas'],['delete','Excluir notas (vai para a lixeira)']];
// Configuração da camada de agentes. Não liga nem desliga IA nenhuma aqui dentro:
// só define o que um agente conectado pode fazer com este cofre.
async function showAgentSettings(){
  if(busy||!loaded)return;
  let conf;
  try{ conf=await agentApi.load(); }catch(error){ status('Não foi possível ler a configuração de agentes: '+error.message,true); return; }
  const caixa=(id,rotulo,marcado)=>`<label class="ai-row"><input type="checkbox" data-perm="${id}" ${marcado?'checked':''} /><span>${rotulo}</span></label>`;
  modal('IA e integrações', `<div class="form">
    <p class="small-muted">Agentes externos falam com o Kuroi pela Agent API, sempre dentro deste cofre. O Kuroi não envia nada para a nuvem por conta própria.</p>
    ${caixa('enabled','Permitir que agentes usem este cofre',conf.enabled)}
    ${caixa('mcp','Servidor MCP habilitado',conf.mcp.enabled)}
    <h3>Permissões do agente</h3>
    ${CAIXAS.map(([id,rotulo])=>caixa(id,rotulo,conf.permissions[id])).join('')}
    ${caixa('confirm','Pedir confirmação para ações destrutivas',conf.requireConfirmationForDestructive)}
    <p class="small-muted" id="ai-path"></p>
    <div class="form-actions"><button type="button" class="secondary" id="cancel">Fechar</button><button type="button" class="primary" id="ai-save">Salvar</button></div>
  </div>`);
  $('#ai-path').textContent='Guardado em .kuroi/agent.json, dentro do cofre.';
  $('#cancel').onclick=()=>closeModal(true);
  $('#ai-save').onclick=async()=>{
    const marcado=id=>document.querySelector(`[data-perm="${id}"]`).checked;
    try{
      await agentApi.save({
        enabled:marcado('enabled'),
        mcp:{enabled:marcado('mcp')},
        permissions:Object.fromEntries(CAIXAS.map(([id])=>[id,marcado(id)])),
        requireConfirmationForDestructive:marcado('confirm'),
      });
      closeModal(true); status('Configuração de agentes salva');
    }catch(error){ status('Não foi possível salvar: '+error.message,true); }
  };
}
document.addEventListener('click',e=>{
  const extra=e.target.closest('[data-extra]');if(extra){e.preventDefault();extraAction(extra.dataset.extra,extra.dataset.id);return;}
  const el=e.target.closest('[data-action]');if(el){e.preventDefault();action(el.dataset.action,el.dataset.id);return;}
  const go=e.target.closest('[data-go]');if(go){if(currentView==='editor')sairDoEditor(go.dataset.go);else{currentView=go.dataset.go;render();}}
});
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(!loaded)return;if(currentView==='editor')sairDoEditor(b.dataset.view);else{currentView=b.dataset.view;render();}});
$('#new-note').onclick=()=>{if(loaded&&!busy&&!failed)abrirNota(notaVazia());};
$('#daily-note').onclick=()=>extraAction('daily');
$('#reload-vault').onclick=()=>reload(true);
$('#trash').onclick=showTrash;
$('#ai-settings').onclick=showAgentSettings;
$('#open-vault').onclick=()=>window.cadernoDesktop?window.cadernoDesktop.openVault():alert(`Seu cofre está em:\n${state.vaultPath||'vault/'}\n\nAbra essa pasta pelo Explorador de Arquivos.`);
$('#choose-vault').hidden=!window.cadernoDesktop;
$('#choose-vault').onclick=async()=>{
  if(busy||!closeModal())return;if(failed){status('Exporte suas alterações e recarregue antes de trocar de cofre.',true);return;}
  setBusy(true);
  try{const saved=await window.cadernoDesktop.chooseVault();if(saved){Kuroi.validateState(saved);state=saved;loaded=true;failed=false;$('#vault-path').textContent=state.vaultPath;render();status('Cofre aberto');}}
  catch(error){status(error.message,true);}finally{setBusy(false);}
};
$('#export-data').onclick=()=>{
  const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=url;a.download=`kuroi-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('#import-data').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||busy||failed||!loaded)return;
  try{
    const data=Kuroi.validateState(JSON.parse(await file.text()));
    if(!confirm(`Importar ${data.notes.length} notas e substituir os dados atuais? As notas removidas irão para a lixeira. Uma cópia do cofre atual será preservada.`))return;
    data.notes=data.notes.map(n=>{const copy={...n};delete copy.file;return copy;});state={...data,revision:state.revision,vaultPath:state.vaultPath};
    if(await save())status('Backup importado e salvo');
  }catch(error){status('Importação cancelada: '+error.message,true);}
};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();if(loaded&&!failed&&!busy&&!$('#modal-root').firstChild)abrirNota(notaVazia());}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&currentView==='editor'){e.preventDefault();salvarNota();}
});
window.addEventListener('beforeunload',e=>{if(busy||failed||modalDirty||editorDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('focus',()=>reload());
setInterval(()=>{if(lastDay!==today()){lastDay=today();if(loaded&&!busy)render();}reload();},5000);
reload();
