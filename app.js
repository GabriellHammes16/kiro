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
  const views = { today: renderToday, notes: renderNotes, tasks: renderTasks, studies: renderCofre, graph: renderGraph };
  document.querySelector(".app-shell").classList.toggle("cofre-aberto", currentView === "studies");
  document.querySelector(".app-shell").classList.toggle("lateral-recolhida", lateralRecolhida);
  const app = document.querySelector("#app");
  cancelAnimationFrame(grafoRaf); grafoRaf = null;
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
// Barra lateral do cofre recolhível: recolhida, sobra só a casinha. A escolha fica
// no navegador (localStorage), como a aparência: é preferência de tela, não dado do cofre.
let lateralRecolhida = (() => { try { return localStorage.getItem('kuroi.lateralRecolhida') === '1'; } catch { return false; } })();
function botaoLateral() {
  const acao = lateralRecolhida ? 'Mostrar barra lateral' : 'Esconder barra lateral';
  return `<button class="icon-button cofre-alternar" data-cofre="alternar" title="${acao}" aria-label="${acao}" aria-expanded="${!lateralRecolhida}">${lateralRecolhida ? '›' : '‹'}</button>`;
}
function alternarLateral() {
  lateralRecolhida = !lateralRecolhida;
  try { localStorage.setItem('kuroi.lateralRecolhida', lateralRecolhida ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
  document.querySelector('.app-shell').classList.toggle('lateral-recolhida', lateralRecolhida);
  // Atualiza o botão em vez de trocá-lo, para não tirar o foco de quem usa o teclado.
  const botao = document.querySelector('[data-cofre="alternar"]');
  if (!botao) return;
  const modelo = document.createElement('template');
  modelo.innerHTML = botaoLateral();
  const novo = modelo.content.firstElementChild;
  for (const nome of ['title', 'aria-label', 'aria-expanded']) botao.setAttribute(nome, novo.getAttribute(nome));
  botao.textContent = novo.textContent;
}
// Modo cofre: árvore à esquerda, nota à direita, sem a navegação principal.
// A casinha devolve o usuário à tela inicial, onde a navegação completa vive.
function renderCofre() {
  if (expanded === null) expanded = new Set(state.folders.map(f => f.id));
  const arvore = treeMarkup('', 0) || '<div class="empty">Crie uma pasta para começar.</div>';
  const direita = editing ? renderEditor() : `<div class="cofre-vazio">
    <p>Escolha uma nota na árvore ao lado.</p>
    <button class="secondary" id="add-note-cofre">＋ Nova nota</button>
  </div>`;
  return `<div class="cofre">
  <aside class="cofre-lateral">
    <header class="cofre-topo">
      <button class="icon-button" data-cofre="casa" title="Voltar ao início" aria-label="Voltar ao início">⌂</button>
      <span class="cofre-nome">Cofre</span>
      <span class="cofre-acoes">
        <button class="icon-button" id="add-folder" title="Nova pasta">▣</button>
        <button class="icon-button" id="expand-all" title="Expandir tudo">⌄</button>
        <button class="icon-button" id="collapse-all" title="Recolher tudo">⌃</button>
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
    const q=Kuroi.normalize(e.target.value);
    document.querySelector('#notes-grid').innerHTML=notesMarkup(state.notes.filter(n=>q.startsWith('#') ? Kuroi.tags(n).some(t=>Kuroi.normalize(t).includes(q.slice(1))) : Kuroi.normalize(n.title+' '+n.body+' '+Kuroi.tags(n).join(' ')).includes(q)));
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
// ---- Editor de documento: a nota ocupa a página inteira, como um processador de texto. ----
async function abrirNota(nota){
  if(editing&&editorDirty&&!await salvarNota())return;
  editing={...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]};
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
<div class="doc-corpo" id="doc-corpo" data-vazio="Clique para escrever. [[Nome da nota]] conecta ideias e #tag marca a nota.">${renderizarMarkdown(nota.body)}</div>`;
}
function estadoDoc(){ $('#doc-state')?.classList.toggle('sujo', editorDirty); }
function desenharLinksDoc(){
  const caixa=$('#doc-links'); if(!caixa) return;
  caixa.innerHTML=editing.links.map((l,i)=>`<div class="link-row"><a href="${escapeHtml(Kuroi.safeUrl(l)||'#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a><button class="icon-button" type="button" data-remove-link="${i}">×</button></div>`).join('');
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
    if(!Kuroi.safeUrl(valor)){alert('Informe um endereço http:// ou https:// válido.');return;}
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
// As ligações são derivadas do texto, como no resto do Kuroi: não há índice a
// manter. Simulação de forças escrita à mão porque a CSP é script-src 'self':
// nada de biblioteca por CDN, e o app não tem etapa de build.
const REPULSAO = 5200, MOLA = 0.018, COMPRIMENTO = 95, GRAVIDADE = 0.006, AMORTECIMENTO = 0.86, MAXV = 12;

function grafoDados() {
  const nos = new Map();
  const arestas = [];
  for (const nota of state.notes) {
    nos.set(nota.id, { id: nota.id, rotulo: nota.title || 'Sem título', existe: true, grau: 0 });
  }
  for (const nota of state.notes) {
    const vistos = new Set();
    for (const link of Kuroi.wikiLinks(nota.body)) {
      const alvo = Kuroi.findLinkedNote(state.notes, link.target);
      const chave = alvo ? alvo.id : `fantasma:${Kuroi.pathKey(link.target)}`;
      if (chave === nota.id || vistos.has(chave)) continue;
      vistos.add(chave);
      // Link para nota inexistente vira nó fantasma: mostra o que você pretendia criar.
      if (!nos.has(chave)) nos.set(chave, { id: chave, rotulo: link.target, existe: false, grau: 0 });
      arestas.push({ de: nota.id, para: chave });
      nos.get(nota.id).grau++;
      nos.get(chave).grau++;
    }
  }
  return { nos: [...nos.values()], arestas };
}

function renderGraph() {
  const { nos, arestas } = grafoDados();
  const soltas = nos.filter(n => n.existe && !n.grau).length;
  const fantasmas = nos.filter(n => !n.existe).length;
  const resumo = `${nos.filter(n => n.existe).length} nota${nos.filter(n => n.existe).length === 1 ? '' : 's'} · ${arestas.length} ligaç${arestas.length === 1 ? 'ão' : 'ões'}`
    + (soltas ? ` · ${soltas} sem conexão` : '')
    + (fantasmas ? ` · ${fantasmas} ainda não criada${fantasmas === 1 ? '' : 's'}` : '');
  const corpo = arestas.length || nos.length
    ? `<div class="graph-wrap" id="graph-wrap"><svg id="graph-svg" role="img" aria-label="Grafo de conexões entre as notas"></svg></div>`
    : '<div class="empty">Escreva [[Nome da nota]] em alguma nota para as ligações aparecerem aqui.</div>';
  return `${head('Conhecimento', 'Grafo', 'Como suas notas se ligam. Clique num ponto para abrir a nota.',
    '<button class="secondary" id="graph-redo">Reorganizar</button>')}
<section class="card graph-panel"><div class="graph-head"><span class="small-muted">${resumo}</span></div>${corpo}</section>`;
}

function bindGraph() {
  const area = $('#graph-wrap');
  if (!area) return;
  const svg = $('#graph-svg');
  const { nos, arestas } = grafoDados();
  if (!nos.length) return;

  const largura = area.clientWidth || 800, altura = area.clientHeight || 520;
  const raio = no => (no.existe ? 6 : 4.5) + Math.min(no.grau, 9) * 1.1;
  const porId = new Map(nos.map(n => [n.id, n]));
  const ligacoes = arestas.map(a => ({ a: porId.get(a.de), b: porId.get(a.para) })).filter(l => l.a && l.b);
  const vizinhos = new Map(nos.map(n => [n.id, new Set()]));
  for (const l of ligacoes) { vizinhos.get(l.a.id).add(l.b.id); vizinhos.get(l.b.id).add(l.a.id); }

  // Posição inicial em círculo: evita que tudo comece sobreposto no centro.
  nos.forEach((no, i) => {
    const angulo = (i / nos.length) * Math.PI * 2;
    const r = Math.min(largura, altura) * 0.32;
    no.x = largura / 2 + Math.cos(angulo) * r;
    no.y = altura / 2 + Math.sin(angulo) * r;
    no.vx = 0; no.vy = 0;
  });

  const ns = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  svg.innerHTML = '';
  const camera = document.createElementNS(ns, 'g');
  svg.appendChild(camera);
  const grupoArestas = document.createElementNS(ns, 'g');
  const grupoNos = document.createElementNS(ns, 'g');
  camera.appendChild(grupoArestas);
  camera.appendChild(grupoNos);

  for (const l of ligacoes) {
    l.el = document.createElementNS(ns, 'line');
    l.el.setAttribute('class', 'graph-edge');
    grupoArestas.appendChild(l.el);
  }
  for (const no of nos) {
    no.el = document.createElementNS(ns, 'g');
    no.el.setAttribute('class', `graph-node${no.existe ? '' : ' fantasma'}`);
    const circulo = document.createElementNS(ns, 'circle');
    circulo.setAttribute('r', raio(no));
    const texto = document.createElementNS(ns, 'text');
    texto.setAttribute('y', raio(no) + 13);
    texto.textContent = no.rotulo.length > 26 ? `${no.rotulo.slice(0, 25)}…` : no.rotulo;
    no.el.append(circulo, texto);
    if (no.existe) no.el.addEventListener('click', () => { if (!arrastou) abrirNota(getNote(no.id)); });
    no.el.addEventListener('pointerenter', () => destacar(no.id));
    no.el.addEventListener('pointerleave', () => destacar(null));
    grupoNos.appendChild(no.el);
  }

  function destacar(id) {
    for (const no of nos) {
      no.el.classList.toggle('apagado', Boolean(id) && no.id !== id && !vizinhos.get(id).has(no.id));
    }
    for (const l of ligacoes) {
      l.el.classList.toggle('aceso', Boolean(id) && (l.a.id === id || l.b.id === id));
      l.el.classList.toggle('apagado', Boolean(id) && l.a.id !== id && l.b.id !== id);
    }
  }

  function passo() {
    for (let i = 0; i < nos.length; i++) {
      for (let j = i + 1; j < nos.length; j++) {
        const a = nos[i], b = nos[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2), f = REPULSAO / d2;
        a.vx -= f * dx / d; a.vy -= f * dy / d;
        b.vx += f * dx / d; b.vy += f * dy / d;
      }
    }
    for (const l of ligacoes) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - COMPRIMENTO) * MOLA;
      l.a.vx += f * dx / d; l.a.vy += f * dy / d;
      l.b.vx -= f * dx / d; l.b.vy -= f * dy / d;
    }
    let energia = 0;
    for (const no of nos) {
      no.vx = (no.vx + (largura / 2 - no.x) * GRAVIDADE) * AMORTECIMENTO;
      no.vy = (no.vy + (altura / 2 - no.y) * GRAVIDADE) * AMORTECIMENTO;
      const v = Math.hypot(no.vx, no.vy);
      if (v > MAXV) { no.vx = no.vx / v * MAXV; no.vy = no.vy / v * MAXV; }
      if (no !== arrastando) { no.x += no.vx; no.y += no.vy; }
      energia += v;
    }
    return energia / nos.length;
  }

  function desenhar() {
    for (const l of ligacoes) {
      l.el.setAttribute('x1', l.a.x); l.el.setAttribute('y1', l.a.y);
      l.el.setAttribute('x2', l.b.x); l.el.setAttribute('y2', l.b.y);
    }
    for (const no of nos) no.el.setAttribute('transform', `translate(${no.x} ${no.y})`);
  }

  const semMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let quadros = 0;
  function animar() {
    const energia = passo();
    desenhar();
    if (++quadros < 600 && energia > 0.12) grafoRaf = requestAnimationFrame(animar);
    else grafoRaf = null;
  }
  function comecar() {
    cancelAnimationFrame(grafoRaf);
    quadros = 0;
    if (semMovimento) { for (let i = 0; i < 400; i++) passo(); desenhar(); }
    else animar();
  }

  // Câmera: arrastar o fundo move, roda do mouse aproxima.
  let escala = 1, deslocX = 0, deslocY = 0;
  const aplicarCamera = () => camera.setAttribute('transform', `translate(${deslocX} ${deslocY}) scale(${escala})`);
  let arrastando = null, arrastou = false, ultimo = null;
  svg.addEventListener('pointerdown', evento => {
    arrastou = false;
    ultimo = { x: evento.clientX, y: evento.clientY };
    const alvo = evento.target.closest('.graph-node');
    arrastando = alvo ? nos.find(n => n.el === alvo) : null;
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
      if (!grafoRaf && !semMovimento) animar(); else desenhar();
    } else {
      deslocX += dx * proporcao; deslocY += dy * proporcao;
      aplicarCamera();
    }
  });
  const soltar = evento => { arrastando = null; ultimo = null; try { svg.releasePointerCapture(evento.pointerId); } catch { /* já solto */ } };
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

  $('#graph-redo')?.addEventListener('click', () => {
    escala = 1; deslocX = 0; deslocY = 0; aplicarCamera();
    nos.forEach((no, i) => {
      const angulo = (i / nos.length) * Math.PI * 2 + Math.random() * 0.4;
      const r = Math.min(largura, altura) * 0.32;
      no.x = largura / 2 + Math.cos(angulo) * r;
      no.y = altura / 2 + Math.sin(angulo) * r;
      no.vx = 0; no.vy = 0;
    });
    comecar();
  });

  aplicarCamera();
  comecar();
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
  if (!Kuroi.isImagePath(caminho)) return null;
  return { caminho, largura: medida ? Number(medida[1]) : null };
}
// No desktop a imagem vem pelo esquema kuroi-anexo://, no navegador pela rota /anexo/.
function urlDoAnexo(caminho) {
  const partes = caminho.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return window.cadernoDesktop ? `kuroi-anexo://cofre/${partes}` : `/anexo/${partes}`;
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

function mdInline(texto) {
  const guardado = [];
  const reservar = html => `\u0000${guardado.push(html) - 1}\u0000`;
  return texto
    // Código em linha primeiro: o que estiver dentro dele não sofre mais nenhuma troca.
    .replace(/`([^`\n]+)`/g, (_, c) => reservar(`<code>${c}</code>`))
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
      const nota = Kuroi.findLinkedNote(state.notes, desescapar(alvo));
      return reservar(`<a class="wikilink${nota ? '' : ' ausente'}" data-alvo="${alvo}"${nota ? ` data-id="${nota.id}"` : ''} title="${nota ? 'Abrir nota' : 'Nota ainda não criada'}">${rotulo}</a>`);
    })
    .replace(/\[([^\][\n]*)\]\(([^)\s]+)\)/g, (inteiro, rotulo, url) => {
      const limpa = Kuroi.safeUrl(desescapar(url));
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
      saida.push(`<figure class="code-area" ${abrir(inicio, ate)}><figcaption><span class="code-lang">${linguagem}</span><button type="button" class="secondary code-copy">Copiar</button></figcaption><pre><code>${codigo}</code></pre></figure>`);
      avancar(ate - i);
      i = j + 1;
      continue;
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
      let j = i;
      while (j < linhas.length) {
        const atual = linhas[j].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!atual || /\d/.test(atual[2]) !== numerada) break;
        const tarefa = atual[3].match(/^\[([ xX])\]\s*(.*)$/);
        itens.push(tarefa
          ? `<li class="md-tarefa"><input type="checkbox" disabled ${/[xX]/.test(tarefa[1]) ? 'checked' : ''} />${mdInline(escapeHtml(tarefa[2]))}</li>`
          : `<li>${mdInline(escapeHtml(atual[3]))}</li>`);
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
// O corpo continua sendo Markdown puro; estas funções só leem as cercas ```
// e desenham o bloco no lugar em que foi escrito, com botão de copiar.
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
function blocosDeCodigo(texto) {
  const achados = [];
  const cercas = /^```([^\n`]*)\n([\s\S]*?)^```/gm;
  let achado;
  while ((achado = cercas.exec(texto))) {
    achados.push({ linguagem: achado[1].trim(), codigo: achado[2].replace(/\n$/, '') });
  }
  return achados;
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
    if (Number(bloco.dataset.pos) <= depoisDe) continue;
    bloco.dataset.pos = Number(bloco.dataset.pos) + delta;
    bloco.dataset.fim = Number(bloco.dataset.fim) + delta;
  }
}

function montarCampo(valor) {
  const campo = document.createElement('textarea');
  campo.className = 'bloco-editor';
  campo.value = valor;
  campo.rows = 1;
  campo.setAttribute('aria-label', 'Conteúdo da nota');
  campo.addEventListener('input', () => aoDigitar(campo));
  campo.addEventListener('keydown', teclaNoBloco);
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
  const bloco = blocoAberto;
  if (!bloco) return;
  blocoAberto = null;
  if (!bloco.campo.isConnected) return;
  const molde = document.createElement('template');
  molde.innerHTML = renderizarMarkdown(bloco.campo.value, bloco.inicio);
  bloco.campo.replaceWith(molde.content);
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
  if (elemento.classList.contains('code-area')) campo.classList.add('bloco-codigo');
  elemento.replaceWith(campo);
  return ativarCampo(campo, { inicio, tamanho: fim - inicio, separador: '' }, cursor);
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
  if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); fecharBloco(); return; }
  if (evento.key !== 'ArrowUp' && evento.key !== 'ArrowDown') return;
  if (evento.shiftKey || evento.altKey || evento.ctrlKey || evento.metaKey) return;
  if (campo.selectionStart !== campo.selectionEnd) return;
  const subir = evento.key === 'ArrowUp';
  // Só troca de bloco com o cursor já na ponta: dentro do texto a seta continua
  // andando pelas linhas, inclusive as quebradas pela largura da página.
  if (campo.selectionStart !== (subir ? 0 : campo.value.length)) return;
  let vizinho = subir ? campo.previousElementSibling : campo.nextElementSibling;
  while (vizinho && !vizinho.dataset.pos) vizinho = subir ? vizinho.previousElementSibling : vizinho.nextElementSibling;
  if (!vizinho) return;
  evento.preventDefault();
  abrirBloco(vizinho, subir ? Infinity : 0);
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
  const resposta = await fetch('/api/anexo', { method: 'POST', headers: { 'Content-Type': arquivo.type, 'X-Kuroi-Nome': encodeURIComponent(arquivo.name || '') }, body: arquivo });
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

function bindCorpo(corpo) {
  corpo.addEventListener('mousedown', evento => {
    if (evento.button === 1) return;
    const alca = evento.target.closest('.md-alca');
    if (alca && evento.button === 0) { evento.preventDefault(); return void redimensionarImagem(alca, evento); }
    if (blocoAberto?.campo === evento.target) return; // dentro do campo aberto: comportamento normal
    // Links e o botão Copiar agem no click. Segurar o foco evita que o bloco aberto
    // feche e mude a altura da página entre apertar e soltar o botão do mouse.
    if (evento.button === 0 && evento.target.closest('a, button')) return void evento.preventDefault();
    evento.preventDefault();
    abrirNoPonto(evento);
  });
  corpo.addEventListener('click', evento => {
    const copiar = evento.target.closest('.code-copy');
    if (copiar) return void copiarBloco(copiar);
    const link = evento.target.closest('.wikilink');
    if (link) { evento.preventDefault(); seguirWikilink(link); }
  });
  // O botão direito já abriu o bloco no mousedown; o menu age sobre ele.
  corpo.addEventListener('contextmenu', evento => abrirMenuContexto(evento, blocoAberto?.campo ?? abrirNoPonto(evento)));
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
    return alvo ? { alvo, nota: Kuroi.findLinkedNote(state.notes, alvo) } : null;
  }
  return null;
}
function menuDaNota() {
  const destino = wikilinkNoCursor(blocoAberto?.campo);
  return [
    ...(destino ? [
      { rotulo: `Ir para "${destino.alvo}"`, icone: '↦', acao: () => abrirNota(destino.nota || notaVazia({ title: destino.alvo })) },
      { separador: true },
    ] : []),
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
      { rotulo: 'Área de código', icone: '▤', acao: areaDeCodigo },
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
    { separador: true },
    { rotulo: 'Salvar', icone: '⤓', acao: () => salvarNota() },
    { rotulo: 'Detalhes', icone: '☰', acao: () => acaoEditor('detalhes') },
    { rotulo: 'Fechar nota', icone: '✕', acao: () => acaoEditor('fechar') },
    { rotulo: 'Mover para lixeira', icone: '🗑', ativo: () => Boolean(editing?.id), acao: () => acaoEditor('lixeira') },
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
  const salva={...editing,id:editing.id||uid(),title:editing.title.trim(),updatedAt:Date.now()};
  state.notes=editing.id?state.notes.map(n=>n.id===editing.id?salva:n):[salva,...state.notes];
  editing=salva;
  if(!await save())return false;
  const atual=getNote(salva.id);
  if(atual)editing={...atual,tags:[...(atual.tags||[])],links:[...(atual.links||[])]};
  editorDirty=false;render();if(retomar&&editing)retomarBloco(retomar);return true;
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
    modal('Lixeira', itens.length ? itens.map(i=>`<div class="routine-item"><span class="brand-mark">${i.kind==='folder'?'▣':'◈'}</span><span class="routine-title">${escapeHtml(i.title)}<div class="task-info">${detalhe(i)} · removido em ${quando(i.deletedAt)}</div></span><button class="secondary" data-restore="${escapeHtml(i.entryId)}">Restaurar</button></div>`).join('') : '<p>A lixeira está vazia.</p>');
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
// ---- Aparência ----
// Preferência de tela, guardada por instalação (localStorage), não no cofre:
// é ajuste de máquina, não conteúdo que deva viajar junto com as notas.
const APARENCIA_PADRAO = { sidebar: '#1A1A20', content: '#141418' };
const APARENCIA_ANTIGA = { sidebar: '#0E0E0E', content: '#0A0A0A' };
function lerAparencia() {
  try {
    const salvo = JSON.parse(localStorage.getItem('kuroi.aparencia') || '{}');
    // Quem nunca trocou a cor recebe o padrão novo; escolha própria é respeitada.
    for (const chave of ['sidebar', 'content']) {
      if (typeof salvo[chave] === 'string' && salvo[chave].toLowerCase() === APARENCIA_ANTIGA[chave].toLowerCase()) delete salvo[chave];
    }
    return { ...APARENCIA_PADRAO, ...salvo };
  } catch { return { ...APARENCIA_PADRAO }; }
}
function aplicarAparencia(valores) {
  const a = valores || lerAparencia();
  document.documentElement.style.setProperty('--sidebar-bg', a.sidebar);
  document.documentElement.style.setProperty('--content-bg', a.content);
  return a;
}
function gravarAparencia(a) {
  try { localStorage.setItem('kuroi.aparencia', JSON.stringify(a)); } catch { /* janela privada: só aplica na sessão */ }
  aplicarAparencia(a);
}
const CAIXAS = [['read','Ler notas'],['create','Criar notas'],['update','Editar notas'],['delete','Excluir notas (vai para a lixeira)']];
const agentApi = {
  load: () => window.cadernoDesktop ? window.cadernoDesktop.agentConfig() : api('agent-config'),
  save: parcial => window.cadernoDesktop ? window.cadernoDesktop.saveAgentConfig(parcial) : api('agent-config', parcial),
};
// Aparência aplica na hora; as permissões de agente só no botão Salvar.
async function showSettings() {
  if (busy || !loaded) return;
  let conf;
  try { conf = await agentApi.load(); }
  catch (error) { status('Não foi possível ler a configuração de agentes: ' + error.message, true); return; }
  const cores = lerAparencia();
  const caixa = (id, rotulo, marcado) => `<label class="cfg-row"><input type="checkbox" data-perm="${id}" ${marcado ? 'checked' : ''} /><span>${rotulo}</span></label>`;
  const cor = (id, rotulo, valor) => `<label class="cfg-cor"><span>${rotulo}</span><input type="color" data-cor="${id}" value="${valor}" /></label>`;
  modal('Configurações', `<div class="form">
    <h3>Aparência</h3>
    ${cor('sidebar', 'Fundo da barra lateral', cores.sidebar)}
    ${cor('content', 'Fundo da área de texto', cores.content)}
    <div><button type="button" class="secondary" id="cor-padrao">Restaurar padrão</button></div>
    <p class="small-muted">A cor muda na hora e vale para esta instalação do Kuroi.</p>
    <h3>IA e integrações</h3>
    <p class="small-muted">Agentes externos falam com o Kuroi pela Agent API, sempre dentro deste cofre. O Kuroi não envia nada para a nuvem por conta própria.</p>
    ${caixa('enabled', 'Permitir que agentes usem este cofre', conf.enabled)}
    ${caixa('mcp', 'Servidor MCP habilitado', conf.mcp.enabled)}
    <h4>Permissões do agente</h4>
    ${CAIXAS.map(([id, rotulo]) => caixa(id, rotulo, conf.permissions[id])).join('')}
    ${caixa('confirm', 'Pedir confirmação para ações destrutivas', conf.requireConfirmationForDestructive)}
    <p class="small-muted">Guardado em .kuroi/agent.json, dentro do cofre.</p>
    <div class="form-actions"><button type="button" class="secondary" id="cancel">Fechar</button><button type="button" class="primary" id="ai-save">Salvar permissões</button></div>
  </div>`);

  const corAtual = () => ({
    sidebar: document.querySelector('[data-cor="sidebar"]').value,
    content: document.querySelector('[data-cor="content"]').value,
  });
  document.querySelectorAll('[data-cor]').forEach(campo => {
    campo.oninput = () => gravarAparencia(corAtual());
  });
  $('#cor-padrao').onclick = () => {
    gravarAparencia({ ...APARENCIA_PADRAO });
    document.querySelector('[data-cor="sidebar"]').value = APARENCIA_PADRAO.sidebar;
    document.querySelector('[data-cor="content"]').value = APARENCIA_PADRAO.content;
  };
  $('#cancel').onclick = () => closeModal(true);
  $('#ai-save').onclick = async () => {
    const marcado = id => document.querySelector(`[data-perm="${id}"]`).checked;
    try {
      await agentApi.save({
        enabled: marcado('enabled'),
        mcp: { enabled: marcado('mcp') },
        permissions: Object.fromEntries(CAIXAS.map(([id]) => [id, marcado(id)])),
        requireConfirmationForDestructive: marcado('confirm'),
      });
      closeModal(true); status('Configurações salvas');
    } catch (error) { status('Não foi possível salvar: ' + error.message, true); }
  };
}
document.addEventListener('click',e=>{
  const extra=e.target.closest('[data-extra]');if(extra){e.preventDefault();extraAction(extra.dataset.extra,extra.dataset.id);return;}
  const el=e.target.closest('[data-action]');if(el){e.preventDefault();action(el.dataset.action,el.dataset.id);return;}
  const go=e.target.closest('[data-go]');if(go){irPara(go.dataset.go);}
});
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(loaded)irPara(b.dataset.view);});
$('#new-note').onclick=()=>{if(loaded&&!busy&&!failed)abrirNota(notaVazia());};
$('#daily-note').onclick=()=>extraAction('daily');
$('#reload-vault').onclick=()=>reload(true);
$('#trash').onclick=showTrash;
$('#settings').onclick=showSettings;
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
  if(e.key==='Escape') closeModal();
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();if(loaded&&!failed&&!busy&&!$('#modal-root').firstChild)abrirNota(notaVazia());}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&editing){e.preventDefault();salvarNota();}
});
window.addEventListener('beforeunload',e=>{if(busy||failed||modalDirty||editorDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('focus',()=>reload());
setInterval(()=>{if(lastDay!==today()){lastDay=today();if(loaded&&!busy)render();}reload();},5000);
aplicarAparencia();
reload();
