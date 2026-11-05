const { t, frase } = KiroIdiomas;
const today = () => Kiro.localDate();
const uid = () => crypto.randomUUID();
let state = { notes: [], tasks: [], habits: [], habitLog: {}, folders: [], fluxos: [] };
let currentView = "today";

async function loadFromVault() { return window.cadernoDesktop ? window.cadernoDesktop.loadState() : api('state'); }
// `origem` é o id do plug-in que pediu a gravação (null quando vem da interface).
// O que esta janela leu do cofre por último: a base da mescla quando o cofre muda por fora.
let estadoBase = null;
const doCofre = lido => { estadoBase = structuredClone(lido); return lido; };
// O cofre mudou por fora (outro editor, sincronização, um assistente gravando notas): relê e mescla
// em três vias. Só devolve true sem conflito; mudança dos dois lados na mesma coisa continua barrando.
async function mesclarComOCofre(local) {
  if (!estadoBase) return false;
  const disco = await loadFromVault(); Kiro.validateState(disco);
  if (disco.revision === local.revision) return false;   // o cofre não mudou: o erro é outro
  const { estado, conflitos } = Kiro.mesclarEstados(estadoBase, local, disco);
  if (conflitos.length) return false;
  state = estado; doCofre(disco);
  // Nota aberta sem edição pendente que mudou lá fora: o editor passa a mostrar a versão do disco.
  if (editing?.id && !editorDirty) { const n = getNote(editing.id); if (n) editing = { ...n, tags: [...(n.tags || [])], links: [...(n.links || [])] }; }
  return true;
}
async function save(origem = null, tentativa = 0, opcoes = {}) {
  if (busy || failed || !loaded) return false;
  const snapshot = structuredClone(state);
  const automatico = opcoes.automatico === true;
  setBusy(true, automatico); if (!automatico) status(t('Salvando…'));
  try {
    Kiro.validateState(snapshot);
    state = doCofre(window.cadernoDesktop ? await window.cadernoDesktop.saveState(snapshot, { copiaParcial: automatico }) : await api(automatico ? 'state?parcial=1' : 'state', snapshot));
    status(t('Salvo no cofre'));
    if (!opcoes.semRender || tentativa > 0) render(); else updateCount();
    eventosDoCofre(origem); return true;
  } catch (error) {
    if (tentativa < 2 && await mesclarComOCofre(snapshot).catch(() => false)) { setBusy(false); return save(origem, tentativa + 1, opcoes); }
    failed = true; if (opcoes.semRender) render(); status(mensagemDoErro(error) + ' ' + t('Suas alterações continuam nesta janela. Exporte-as antes de recarregar.'), true); return false;
  } finally { setBusy(false); }
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDate(date) { return KiroIdiomas.formatarData(new Date(`${date}T12:00:00`), { weekday:"long", day:"numeric", month:"long" }); }
function dateLabel(date) { return date === today() ? t("Hoje") : KiroIdiomas.formatarData(new Date(`${date}T12:00:00`), { day:"2-digit", month:"short" }); }
function updateCount() { const open = state.tasks.filter(t => !t.done).length; document.querySelector("#task-count").textContent = open || ""; atualizarSeletorDeCofre(); }
// Rodapé da barra lateral, como no Obsidian: nome do cofre; a dica mostra o caminho e o tamanho.
function atualizarSeletorDeCofre() {
  const botao = document.querySelector('#cofre-seletor');
  if (!botao || !state.vaultPath) return;
  const nome = 'Kiro';   // o nome da pasta do cofre aparece na dica, junto do caminho
  const notas = state.notes.length, pastas = state.folders.length;
  document.querySelector('#cofre-seletor-nome').textContent = nome;
  botao.dataset.dica = `${state.vaultPath}\n\n${notas === 1 ? t('1 nota') : t('{n} notas', { n: notas })}, ${pastas === 1 ? t('1 pasta') : t('{n} pastas', { n: pastas })}`;
  botao.setAttribute('aria-label', t('Cofre {nome}: {acao}', { nome, acao: window.cadernoDesktop ? t('trocar de cofre') : t('ver nas configurações') }));
}
function getNote(id) { return state.notes.find(n => n.id === id); }
function getFluxo(id) { return (state.fluxos || []).find(f => f.id === id); }
// No Hoje, quando já há moldura de plug-in aberta (ex.: miniatura do Kanban), atualiza só os
// cartões nativos no lugar para não desmontar o <iframe> e causar piscada a cada tarefa marcada.
function atualizarHojeSemPiscar(app, html) {
  if (renderedView !== 'today' || currentView !== 'today' || personalizandoHoje) return false;
  if (app.querySelector('.hoje-faixas.personalizando') || !app.querySelector('.plugin-painel iframe.plugin-moldura')) return false;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const faixasAtuais = app.querySelector(':scope > .hoje-faixas'), faixasNovas = temp.querySelector(':scope > .hoje-faixas');
  if (!faixasAtuais || !faixasNovas || faixasAtuais.children.length !== faixasNovas.children.length) return false;
  const assinatura = raiz => [...raiz.querySelectorAll('.plugin-painel')].map(p => `${p.dataset.plugin}:${p.dataset.painel}`).join('|');
  if (assinatura(faixasAtuais) !== assinatura(faixasNovas)) return false;
  const headAtual = app.querySelector(':scope > .page-head'), headNovo = temp.querySelector(':scope > .page-head');
  if (headAtual && headNovo) {
    const personalizar = headNovo.querySelector('[data-hoje-acao="personalizar"]');
    if (personalizar && app.querySelector('.hoje-acoes [data-hoje-acao="personalizar"]')) personalizar.remove();
    headAtual.replaceWith(headNovo);
  }
  const sincronizarLista = (atual, nova) => {
    const filhosAtuais = [...atual.children], filhosNovos = [...nova.children];
    if (filhosAtuais.length !== filhosNovos.length) return false;
    for (let i = 0; i < filhosNovos.length; i++) {
      const a = filhosAtuais[i], b = filhosNovos[i];
      if (a.classList.contains('plugin-painel') && b.classList.contains('plugin-painel') && a.dataset.plugin === b.dataset.plugin && a.dataset.painel === b.dataset.painel) continue;
      if (a.classList.contains('plugin-painel') || b.classList.contains('plugin-painel')) return false;
      a.replaceWith(b);
    }
    return true;
  };
  for (let i = 0; i < faixasNovas.children.length; i++) {
    const fa = faixasAtuais.children[i], fb = faixasNovas.children[i];
    if (fa.className !== fb.className) return false;
    if (fa.classList.contains('hoje-colunas')) {
      const colsA = [...fa.querySelectorAll(':scope > .stack')], colsB = [...fb.querySelectorAll(':scope > .stack')];
      if (colsA.length !== colsB.length || !colsA.every((c, j) => sincronizarLista(c, colsB[j]))) return false;
    } else if (!sincronizarLista(fa, fb)) return false;
  }
  return true;
}
function render() {
  if(gravacaoAudio?.contexto&&!contextoAudioValido(gravacaoAudio.contexto))gravacaoAudio.parar();
  if (!editing || currentView !== 'studies') { modoFoco = false; document.querySelector('.app-shell').classList.remove('modo-foco'); }
  const focoNoEditor = Boolean(editorDaNota?.editor.temFoco());
  const focoAntes = lembrarFoco(document.querySelector('#app'));
  const rolagemDaNota = editorDaNota?.editor.dom.closest('.cofre-nota-corpo')?.scrollTop;   // o app.innerHTML abaixo refaz o elemento que rola
  KiroFluxoTela.desmontarTodos(); // grava o texto em edição no estado antes de a tela ser refeita
  if (currentView !== 'today') personalizandoHoje = false;
  if (currentView.startsWith('plugin:') && !pluginsAtivos.get(currentView.slice(7))?.manifesto?.page) currentView = 'today';
  // Recalculado depois da queda para 'today': senão a página "não está ativo" ainda desenharia.
  const paginaDoPlugin = currentView.startsWith('plugin:') ? currentView.slice(7) : null;
  document.querySelectorAll(".nav-item").forEach(x => { const atual = x.dataset.view === currentView; x.classList.toggle("active", atual); if (atual) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  const views = { today: renderToday, notes: renderNotes, tasks: renderTasks, studies: renderCofre, graph: renderGraph };
  document.querySelector(".app-shell").classList.toggle("cofre-aberto", currentView === "studies");
  document.querySelector(".app-shell").classList.toggle("lateral-recolhida", lateralRecolhida);
  document.querySelector(".app-shell").classList.toggle("grafo-aberto", currentView === "graph");
  document.querySelector(".app-shell").classList.toggle("pagina-plugin-aberta", !!paginaDoPlugin);
  const app = document.querySelector("#app");
  const mesmaTela = renderedView === currentView;
  const rolagemApp = mesmaTela ? app.scrollTop : 0;
  const rolagemColunas = mesmaTela ? (app.querySelector('.tarefas-lista.por-colunas')?.scrollLeft || 0) : 0;
  const rolagemStatus = mesmaTela ? new Map([...app.querySelectorAll('.status-secao[data-status] .status-itens')].map(el => [el.closest('.status-secao').dataset.status, el.scrollTop])) : null;
  cancelAnimationFrame(grafoRaf); grafoRaf = null; fecharSugestoes();
  // A página cheia do plug-in não é recriada a cada redesenho: a tela guarda estado próprio.
  const viva = paginaDoPlugin && app.querySelector(`:scope > .plugin-pagina[data-plugin="${CSS.escape(paginaDoPlugin)}"]`);
  if (!viva) {
    const html = paginaDoPlugin ? renderPaginaDoPlugin(paginaDoPlugin) : views[currentView]();
    if (!atualizarHojeSemPiscar(app, html)) app.innerHTML = html;
  }
  // Animar só na troca de tela: um redesenho comum não deve piscar.
  if (renderedView !== currentView) { app.classList.remove("view-enter"); void app.offsetWidth; app.classList.add("view-enter"); renderedView = currentView; }
  else app.classList.remove("view-enter"); // com a classe, cada filho recriado refaria a animação de entrada
  bindView(); updateCount(); prepararArvore();
  if (mesmaTela && !focoNoEditor) devolverFoco(focoAntes, app);
  if (mesmaTela) {
    if (rolagemApp) app.scrollTop = rolagemApp;
    const cols = rolagemColunas && app.querySelector('.tarefas-lista.por-colunas');
    if (cols) cols.scrollLeft = rolagemColunas;
    if (rolagemStatus?.size) for (const [st, top] of rolagemStatus) { const el = app.querySelector(`.status-secao[data-status="${CSS.escape(st)}"] .status-itens`); if (el && top) el.scrollTop = top; }
  }
  if (rolagemDaNota && editorDaNota) { const rola = editorDaNota.editor.dom.closest('.cofre-nota-corpo'); if (rola) rola.scrollTop = rolagemDaNota; }   // mesmo editor de volta: mesma rolagem
  // O editor da nota é o mesmo de antes do redesenho (montarEditorDaNota): devolve o foco a ele.
  if (focoNoEditor && editorDaNota && document.querySelector('#doc-corpo')?.contains(editorDaNota.editor.dom)) editorDaNota.editor.focar();
  if (editorDaNota && !document.querySelector('#doc-corpo')) { editorDaNota.editor.destruir(); editorDaNota = null; }
  KiroFluxoTela.esvaziarGuarda();   // os fluxos já foram montados (bindView): o que sobrou na guarda não tem mais tela
}
// O redesenho troca os elementos e o teclado voltaria ao começo da tela. O novo elemento é achado pelo id ou pelos data-*.
function seletorDoFoco(el) {
  if (!el || el === document.body) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const dados = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${a.value.replace(/["\\]/g, '\\$&')}"]`).join('');
  return dados ? el.tagName.toLowerCase() + dados : null;
}
function lembrarFoco(raiz) {
  const el = document.activeElement;
  if (!raiz?.contains(el) || el === raiz) return null;
  const seletor = seletorDoFoco(el);
  return seletor && { seletor, inicio: el.selectionStart ?? null, fim: el.selectionEnd ?? null };
}
function devolverFoco(guardado, raiz) {
  if (!guardado || (document.activeElement && document.activeElement !== document.body)) return;
  const el = raiz.querySelector(guardado.seletor);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (guardado.inicio !== null) try { el.setSelectionRange(guardado.inicio, guardado.fim); } catch { /* este tipo de campo não tem seleção */ }
}
function head(eyebrow, title, description, action="") { return `<header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${description}</p></div>${action}</header>`; }
function check(done, action, id) { return `<button class="check ${done ? "done" : ""}" aria-label="${done ? t('Marcar como não concluído') : t('Marcar como concluído')}" data-action="${action}" data-id="${id}"></button>`; }
// Notas que citam a tarefa com [[tarefa:…]], como links (até três, depois "+n").
function citadaEm(task, fonte = state.notes) {
  const notas = Kiro.notesCitingTask(fonte, task.id);
  if (!notas.length) return '';
  return ` · <span class="task-citada-em">${t('Citada em')} ${notas.slice(0, 3).map(linkDaNota).join(', ')}${notas.length > 3 ? ` +${notas.length - 3}` : ''}</span>`;
}
const rotuloDaRepeticao = r => ({ day: frase('Todo dia'), week: frase('Toda semana'), month: frase('Todo mês') })[r.every] || t('A cada {n} dias', { n: r.n });
function taskRow(task, notas = state.notes) {
  const atrasada = !task.done && task.due < today(), st = Kiro.statusDaTarefa(task);
  const rotuloSt = t((typeof ROTULOS_DE_STATUS !== 'undefined' && ROTULOS_DE_STATUS[st]) || { 'nao-comecado': 'Não começado', andamento: 'Em andamento', pausado: 'Pausado', concluido: 'Concluído' }[st]);
  return `<div class="task-item" data-id="${task.id}" data-status="${st}">${check(task.done,"toggle-task",task.id)}<div class="task-title"><span class="task-nome">${escapeHtml(task.title)}</span>${task.description ? `<div class="task-descricao">${escapeHtml(task.description)}</div>` : ''}<div class="task-info"><span class="task-data${atrasada ? ' atrasada' : ''}">${icone('calendario')}${dateLabel(task.due)}</span>${task.repeat ? ` <span class="task-repete" title="${t(rotuloDaRepeticao(task.repeat))}">${icone('recarregar')}</span>` : ''}${task.noteId && getNote(task.noteId) ? ` · ${linkDaNota(getNote(task.noteId))}` : ""}${citadaEm(task, notas)}</div></div><button type="button" class="task-status" data-status="${st}" data-status-tarefa="${task.id}" title="${t('Mudar estado')}: ${rotuloSt}" aria-label="${t('Estado')}: ${rotuloSt}"><span class="status-marca" aria-hidden="true"></span><span class="task-status-texto">${rotuloSt}</span></button>${task.priority === "Alta" ? `<span class="priority">${t('Alta')}</span>` : '<span class="priority vazia" aria-hidden="true"></span>'}<div class="task-actions"><button class="icon-button" data-action="edit-task" data-id="${task.id}" title="${t('Editar')}">${icone('renomear')}</button><button class="icon-button" data-action="delete-task" data-id="${task.id}" title="${t('Excluir')}">${icone('lixeira')}</button></div></div>`;
}
function renderToday() {
  const catalogo = catalogoDaHoje(), l = layoutDaHoje(catalogo);
  const porId = new Map(catalogo.map(c => [c.id, c]));
  const desenhar = id => {
    const c = porId.get(id);
    const html = c.render(KiroHoje.opcoesEfetivas(l, id, c.opcoes));
    return personalizandoHoje ? cartaoEmEdicao(c, l, html) : html;
  };
  const lista = KiroHoje.faixas(l, idsVisiveisDaHoje(l, catalogo));
  // Editando sem nenhum cartão normal: uma faixa de colunas vazia, para ter onde soltar.
  if (personalizandoHoje && !lista.some(f => f.tipo === 'colunas')) lista.push({ tipo: 'colunas', colunas: Array.from({ length: l.colunas }, () => []) });
  // Frase como primeira faixa: sobe para o cabeçalho, logo abaixo da saudação (no Personalizar ela continua um cartão que se move).
  const fraseNoTopo = !personalizandoHoje && lista[0]?.tipo === 'inteira' && lista[0].id === 'nativo:frase';
  if (fraseNoTopo) lista.shift();
  const faixas = lista.map((f, idx) => f.tipo === 'inteira'
    ? `<div class="hoje-faixa-inteira">${desenhar(f.id)}</div>`
    : `<div class="today-grid hoje-colunas" style="--hoje-colunas:${l.colunas}" data-hoje-fim="${escapeHtml(lista.slice(idx + 1).find(x => x.tipo === 'inteira')?.id || '')}">${f.colunas.map((ids, i) => `<div class="stack" data-hoje-coluna="${i}">${ids.map(desenhar).join('')}</div>`).join('')}</div>`).join('');
  const botao = `<button type="button" class="secondary" data-hoje-acao="personalizar" aria-pressed="${personalizandoHoje}">${personalizandoHoje ? t('Concluir') : `${icone('realce')} ${t('Personalizar')}`}</button>`;
  return `${head(formatDate(today()), saudacao(), fraseNoTopo ? `<span class="frase-do-dia">${escapeHtml(fraseDoDia())}</span>` : '', botao)}${personalizandoHoje ? rodapeDaPersonalizacao(catalogo, l) : ''}<div class="hoje-faixas${personalizandoHoje ? ' personalizando' : ''}">${faixas}</div>`;
}
// Cartões do Kiro e dos plug-ins num catálogo só: o layout decide onde e se aparecem.
const LIMITE_DA_LISTA = { key: 'limite', type: 'number', label: frase('Quantos mostrar (0 = todos)'), default: 0, min: 0, max: 50 };
const cortar = (lista, limite) => limite > 0 ? lista.slice(0, limite) : lista;
function notasVisiveisNaHoje() {
  const ocultas = new Set((hojeLayout?.pastasOcultas || []).flatMap(id => [...Kiro.descendants(state.folders, id)]));
  return state.notes.filter(n => !ocultas.has(n.folderId));
}
function catalogoDaHoje() {
  const limite = { ...LIMITE_DA_LISTA, label: t(LIMITE_DA_LISTA.label) };
  const nativos = [
    { id: 'nativo:frase', titulo: t('Frase do dia'), coluna: 0, largura: 'inteira', opcoes: [],
      render: () => `<section class="card cartao-frase"><p class="frase-do-dia">${escapeHtml(fraseDoDia())}</p></section>` },
    { id: 'nativo:habitos', titulo: t('Hábitos'), coluna: 0, opcoes: [{ key: 'mostrarSemana', type: 'boolean', label: t('Mostrar a semana'), default: true }],
      render: o => cardHabitos(o) },
    { id: 'nativo:agora', titulo: t('Para fazer agora'), coluna: 0, opcoes: [limite], render: o => cardAgora(o) },
    { id: 'nativo:continuar', titulo: t('Continuar de onde parei'), coluna: 1, opcoes: [],
      render: () => cardContinuar(notasVisiveisNaHoje().sort((a, b) => b.updatedAt - a.updatedAt)[0]) },
    { id: 'nativo:caixa', titulo: t('Caixa de entrada'), coluna: 1, opcoes: [limite], render: o => cardCaixaDeEntrada(o) },
    { id: 'nativo:revisar', titulo: t('Para revisar'), coluna: 1, opcoes: [limite], render: o => cardParaRevisar(o) },
  ].map(c => ({ largura: 'normal', origem: 'Kiro', ...c }));
  const dosPlugins = [];
  for (const [id, estado] of pluginsAtivos) for (const painel of estado.paineis || []) dosPlugins.push({
    id: `plugin:${id}:${painel.id}`, titulo: painel.label, origem: estado.manifesto?.name || id,
    largura: painel.largura, opcoes: painel.opcoes, render: () => cartaoDoPainel(id, painel),
  });
  return [...nativos, ...dosPlugins];
}
// Reconciliar na hora de desenhar: um plug-in recém-ativado ganha lugar e isso é gravado.
function layoutDaHoje(catalogo = catalogoDaHoje()) {
  const semArquivo = !hojeLayout;
  const novo = KiroHoje.reconciliar(hojeLayout || KiroHoje.padrao(catalogo), catalogo);
  if (semArquivo || novo !== hojeLayout) { hojeLayout = novo; gravarHojeDepois(); }
  return hojeLayout;
}
const idsVisiveisDaHoje = (l, catalogo) => new Set(catalogo.map(c => c.id).filter(id => !l.ocultos.includes(id)));
function cardAgora({ limite }) {
  const notas = notasVisiveisNaHoje(), idsOcultos = new Set(state.notes.filter(n => !notas.includes(n)).map(n => n.id));
  const urgent = state.tasks.filter(t => !t.done && t.due <= today() && !idsOcultos.has(t.noteId));
  return `<section class="card"><div class="card-head"><h2>${icone('tarefas')}${t('Para fazer agora')}</h2><a data-go="tasks">${t('Ver tarefas')}</a></div>${cortar(urgent, limite).map(tarefa => taskRow(tarefa, notas)).join("") || `<div class="empty">${t('Nada urgente para hoje.')}</div>`}</section>`;
}
// Frase do dia no lugar do "Bom dia". Muda à meia-noite e não repete a de ontem:
// o passo 7 percorre as 20 frases antes de voltar à primeira.
const FRASES = [
  frase('Ara ara… não seja vagabundo, vamos trabalhar porque você é pobre.'),
  frase('Ara ara~ o boleto não se paga sozinho, sabia?'),
  frase('Levanta, guerreiro. O sofá não vai te pagar salário.'),
  frase('Seus sonhos ligaram. Disseram que você está atrasado.'),
  frase('Menos scroll, mais progresso.'),
  frase('Ara ara… procrastinando de novo? Que decepção~'),
  frase('O café já fez a parte dele. Agora é com você.'),
  frase('Nem o Goku ficou forte deitado.'),
  frase('Bora, protagonista. O arco de treinamento começa agora.'),
  frase('Sua conta bancária pediu pra eu te lembrar: vai trabalhar.'),
  frase('Disciplina é fazer mesmo sem vontade. Tipo agora.'),
  frase('Ara ara~ quem não anota esquece. Quem esquece repete.'),
  frase('Hoje não é dia de desistir. Amanhã também não.'),
  frase('Senpai não vai te notar se as tarefas não estiverem feitas.'),
  frase('Pobre de ideias você não é. De dinheiro, ainda. Bora mudar isso.'),
  frase('Um hábito por vez, uma nota por vez, um boleto por vez.'),
  frase('Menos "amanhã eu faço", mais "feito".'),
  frase('O você do futuro está contando com você. Não passe vergonha.'),
  frase('Ara ara… esse cérebro não vai se organizar sozinho.'),
  frase('Trabalhe em silêncio. Deixe o saldo fazer barulho.'),
];
function fraseDoDia(dia = today()) {
  const [a, m, d] = dia.split('-').map(Number);
  return t(FRASES[(Math.floor(Date.UTC(a, m - 1, d) / 864e5) * 7) % FRASES.length]);
}
const saudacao = (hora = new Date().getHours()) => hora < 5 ? t('Boa madrugada') : hora < 12 ? t('Bom dia') : hora < 18 ? t('Boa tarde') : t('Boa noite');
// Última nota editada, com o fim do texto: "Continuar" abre a nota já escrevendo no final.
function cardContinuar(nota) {
  if (!nota) return '';
  const ultimo = textoPlano(nota.body.trim().split(/\n\s*\n/).filter(p => textoPlano(p)).pop() || '');
  const trecho = ultimo === textoPlano(nota.title || '') ? '' : ultimo;
  const pasta = state.folders.find(f => f.id === nota.folderId);
  return `<section class="card continuar"><div class="card-head"><h2>${icone('notas')}${t('Continuar de onde parei')}</h2><span class="continuar-quando">${t('editada {quando}', { quando: (quando => KiroIdiomas.idioma() === 'pt-BR' ? quando.toLowerCase() : quando)(dateLabel(Kiro.localDate(new Date(nota.updatedAt)))) })}</span></div><button type="button" class="continuar-nota" data-extra="continuar" data-id="${nota.id}"><span class="continuar-titulo">${pasta ? `<span class="pasta-chip"${pasta.color ? ` data-cor-pasta="${pasta.color}"` : ''}>${icone('pastas')}</span>` : icone('nota')} ${escapeHtml(nota.title || t('Sem título'))}</span>${trecho ? `<span class="continuar-trecho">${trecho.length > 180 ? '…' : ''}${escapeHtml(trecho.slice(-180))}</span>` : ''}<span class="continuar-acao">${t('Continuar escrevendo')} ${icone('direita')}</span></button></section>`;
}
// ---- Hábitos no Hoje: só os do dia, com a semana clicável e a sequência. ----
// Inicial do dia da semana (0 = domingo) no idioma atual: 7/jan/2024 foi um domingo.
const letraDoDia = d => KiroIdiomas.formatarData(new Date(2024, 0, 7 + d, 12), { weekday: 'narrow' }).toUpperCase();
const DIAS_CURTO = [frase('dom'), frase('seg'), frase('ter'), frase('qua'), frase('qui'), frase('sex'), frase('sáb')];
const rotuloDoDia = dia => KiroIdiomas.formatarData(new Date(`${dia}T12:00`), { weekday:'long', day:'numeric', month:'short' });
function rotuloFrequencia(f) {
  if (f.type === 'weekly') return t('{n}x por semana', { n: f.times });
  if (f.type !== 'days') return t('Todo dia');
  const ordem = [...f.days].sort((a,b) => ((a+6)%7) - ((b+6)%7));
  if (ordem.length === 7) return t('Todo dia');
  return ordem.join() === '1,2,3,4,5' ? t('Dias úteis') : ordem.join() === '6,0' ? t('Fim de semana') : ordem.map(d => t(DIAS_CURTO[d])).join(', ');
}
function cardHabitos({ mostrarSemana = true } = {}) {
  const hoje = today();
  const [a, m, d] = hoje.split('-').map(Number), domingo = Kiro.localDate(new Date(a, m - 1, d + (7 - new Date(a, m - 1, d).getDay()) % 7));
  const doDia = state.habits.map(h => ({ h, s: Kiro.habitStats(h, state.habitLog[h.id] || [], hoje) })).filter(x => x.s.dueToday);
  const feitos = doDia.filter(x => x.s.doneToday).length;
  const linha = ({ h, s }) => {
    const semanal = h.frequency.type === 'weekly';
    const meta = [
      // "Todo dia" é o caso comum: só aparece a frequência que foge dele.
      semanal ? t('{feitos}/{meta} na semana', { feitos: s.weekCount, meta: h.frequency.times }) : rotuloFrequencia(h.frequency) === t('Todo dia') ? '' : rotuloFrequencia(h.frequency),
      s.streak ? `<span class="habito-sequencia">${icone('chama')} ${s.streak} ${semanal ? (s.streak === 1 ? t('semana') : t('semanas')) : (s.streak === 1 ? t('dia') : t('dias'))}</span>` : '',
    ].filter(Boolean).join(' · ');
    // Semana fixa de segunda a domingo: as letras não mudam de lugar; dias que ainda não chegaram ficam apagados.
    const dias = Kiro.habitDays(h, state.habitLog[h.id] || [], domingo, 7).map(d => d.date > hoje
      ? `<span class="habito-dia futuro" title="${rotuloDoDia(d.date)}">${letraDoDia(new Date(`${d.date}T12:00`).getDay())}</span>`
      : `<button type="button" class="habito-dia${d.done ? ' feito' : ''}${d.due ? '' : ' livre'}${d.date === hoje ? ' hoje' : ''}" data-action="toggle-habit-day" data-id="${h.id}|${d.date}" title="${rotuloDoDia(d.date)}${d.done ? ` · ${t('feito')}` : ''}" aria-label="${rotuloDoDia(d.date)}: ${d.done ? t('feito') : t('não feito')}" aria-pressed="${d.done}">${letraDoDia(new Date(`${d.date}T12:00`).getDay())}</button>`).join('');
    return `<div class="routine-item habito" data-habito="${h.id}">${check(s.doneToday, 'toggle-habit', h.id)}<div class="habito-texto"><span class="routine-title">${escapeHtml(h.title)}</span><span class="habito-meta">${meta}</span></div>${mostrarSemana ? `<div class="habito-semana">${dias}</div>` : ''}</div>`;
  };
  const vazio = state.habits.length
    ? `<div class="empty">${t('Nenhum hábito para hoje.')}</div>`
    : `<div class="empty">${t('Crie um hábito para acompanhar sua sequência.')} ${extraButton('add-habit', t('Criar hábito'))}</div>`;
  const cabecalho = mostrarSemana && doDia.length ? `<div class="habito habitos-cabecalho" aria-hidden="true"><span></span><span></span><span class="habito-semana">${[1, 2, 3, 4, 5, 6, 0].map(d => `<span>${letraDoDia(d)}</span>`).join('')}</span></div>` : '';
  return `<section class="card habitos"><div class="card-head"><h2>${icone('chama')}${t('Hábitos')}</h2>${doDia.length ? `<span class="small-muted">${t('Hoje')} · ${feitos}/${doDia.length}</span>` : ''}${extraButton('habit-stats', icone('grafico'), '', 'icon-button', t('Estatísticas dos hábitos'))}${extraButton('add-habit', icone('mais'), '', 'icon-button', t('Novo hábito'))}</div>${cabecalho}${doDia.map(linha).join('') || vazio}</section>`;
}
async function marcarHabito(id, dia = today()) {
  if (busy || failed || !loaded || dia > today() || !state.habits.some(h => h.id === id)) return;
  const dias = new Set(state.habitLog[id] || []);
  const anterior = Kiro.habitStats(state.habits.find(h => h.id === id), [...dias], today()).streak;
  dias.has(dia) ? dias.delete(dia) : dias.add(dia);
  state.habitLog = { ...state.habitLog, [id]: [...dias].sort() };
  // Marcar um dia de antes da criação quer dizer que o hábito já existia: a data de início recua.
  const habito = state.habits.find(h => h.id === id), [a, m, d] = dia.split('-').map(Number), inicioDoDia = new Date(a, m - 1, d).getTime();
  if (dias.has(dia) && habito.createdAt && inicioDoDia < habito.createdAt) state.habits = state.habits.map(h => h.id === id ? { ...h, createdAt: inicioDoDia } : h);
  if (await save()) {
    const sequencia = Kiro.habitStats(habito, [...dias], today()).streak;
    if (dia === today() && dias.has(dia) && sequencia > 1 && sequencia > anterior) celebrarSequencia(habito.title, sequencia);
    else status(dias.has(dia)
      ? t('Hábito {titulo} marcado em {dia}.', { titulo: habito.title, dia: rotuloDoDia(dia) })
      : t('Hábito {titulo} desmarcado em {dia}.', { titulo: habito.title, dia: rotuloDoDia(dia) }));
  }
}
function celebrarSequencia(titulo, n) {
  status(t('Sequência de {n} para {titulo}!', { n, titulo }));
  const el = $('#save-status'); el.classList.add('celebracao');
  setTimeout(() => el.classList.remove('celebracao'), 4000);
}
function habitoModal(habito = { title: '', frequency: { type: 'daily' } }) {
  const f = habito.frequency, dias = f.type === 'days' ? f.days : [1, 3, 5];
  modal(habito.id ? t('Editar hábito') : t('Novo hábito'), `<form class="form" id="habito-form">
    <div class="field"><label for="habito-titulo">${t('Hábito')}</label><input id="habito-titulo" name="title" required maxlength="80" value="${escapeHtml(habito.title)}" placeholder="${t('Ex.: Beber 2 litros de água')}" /></div>
    <div class="field"><span class="rotulo-campo" id="freq-rotulo">${t('Frequência')}</span><div class="segmentos" role="radiogroup" aria-labelledby="freq-rotulo">${[['daily',t('Todo dia')],['days',t('Dias da semana')],['weekly',t('Vezes por semana')]].map(([v, r]) => `<label class="segmento"><input type="radio" name="tipo" value="${v}" ${f.type === v ? 'checked' : ''} /><span>${r}</span></label>`).join('')}</div></div>
    <div class="field" id="freq-dias" ${f.type === 'days' ? '' : 'hidden'}><span class="rotulo-campo">${t('Em quais dias')}</span><div class="dias-semana">${[1,2,3,4,5,6,0].map(d => `<label class="dia-chip" title="${t(DIAS_CURTO[d])}"><input type="checkbox" name="dias" value="${d}" ${dias.includes(d) ? 'checked' : ''} /><span>${letraDoDia(d)}</span></label>`).join('')}</div></div>
    <div class="field" id="freq-vezes" ${f.type === 'weekly' ? '' : 'hidden'}><label for="habito-vezes">${t('Quantas vezes por semana')}</label><input id="habito-vezes" name="vezes" type="number" min="1" max="7" value="${f.type === 'weekly' ? f.times : 3}" /></div>
    <p class="cfg-aviso" id="habito-erro" hidden>${t('Escolha pelo menos um dia.')}</p>
    <div class="form-actions">${habito.id ? `<button type="button" class="secondary perigo" id="habito-excluir">${t('Excluir')}</button>` : ''}<button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button class="primary">${habito.id ? t('Salvar') : t('Criar hábito')}</button></div>
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
  const marcados = dias ? ' ' + (dias === 1 ? t('e o dia marcado') : t('e os {n} dias marcados', { n: dias })) : '';
  modal(t('Excluir hábito'), `<p class="confirmar-texto">${t('Excluir {titulo}{marcados}? Isso não pode ser desfeito.', { titulo: `<strong>${escapeHtml(habito.title)}</strong>`, marcados })}</p><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button type="button" class="primary perigo-cheio" id="confirmar-exclusao">${t('Excluir hábito')}</button></div>`);
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
    { rotulo: feitoHoje ? t('Desmarcar hoje') : t('Marcar como feito hoje'), icone: icone('lista-tarefas'), acao: () => marcarHabito(id) },
    { rotulo: t('Editar hábito'), icone: icone('renomear'), acao: () => atual() && habitoModal(atual()) },
    { rotulo: t('Novo hábito'), icone: icone('mais'), acao: () => habitoModal() },
    { rotulo: t('Estatísticas'), icone: icone('grafico'), acao: () => habitosModal() },
    { separador: true },
    { rotulo: t('Excluir hábito'), icone: icone('lixeira'), acao: () => excluirHabito(id) },
  ];
}
const menuDosHabitos = () => [
  { rotulo: t('Novo hábito'), icone: icone('mais'), acao: () => habitoModal() },
  { rotulo: t('Estatísticas'), icone: icone('grafico'), acao: () => habitosModal() },
];
function habitosModal() {
  const hoje = today();
  const blocos = state.habits.map(h => {
    const dias = state.habitLog[h.id] || [], s = Kiro.habitStats(h, dias, hoje), semanal = h.frequency.type === 'weekly';
    const grade = Kiro.habitDays(h, dias, hoje, 35).map(d => `<span class="grade-dia${d.done ? ' feito' : ''}${d.due ? '' : ' livre'}${d.date === hoje ? ' hoje' : ''}" title="${rotuloDoDia(d.date)}${d.done ? ` · ${t('feito')}` : ''}"></span>`).join('');
    return `<section class="habito-stats" data-habito="${h.id}"><header><div class="cfg-texto"><span class="cfg-titulo">${escapeHtml(h.title)}</span><span class="small-muted">${rotuloFrequencia(h.frequency)}</span></div><button type="button" class="icon-button" data-editar-habito="${h.id}" aria-label="${t('Editar hábito')}" title="${t('Editar')}">${icone('renomear')}</button></header>
      <div class="habito-numeros"><div><b>${s.streak}</b><span>${semanal ? t('semanas seguidas') : t('dias seguidos')}</span></div><div><b>${s.rate30 === null ? '–' : s.rate30 + '%'}</b><span>${t('nos últimos 30 dias')}</span></div><div><b>${s.totalDone}</b><span>${t('vezes no total')}</span></div></div>
      <div class="habito-grade" aria-label="${t('Últimas 5 semanas')}">${grade}</div></section>`;
  }).join('');
  modal(t('Seus hábitos'), `<div class="habitos-lista">${blocos || `<div class="empty">${t('Nenhum hábito ainda.')}</div>`}</div><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Fechar')}</button><button type="button" class="primary" id="habito-novo">${icone('mais')} ${t('Novo hábito')}</button></div>`);
  $('#cancel').onclick = () => closeModal(true);
  $('#habito-novo').onclick = () => { closeModal(true); habitoModal(); };
  document.querySelectorAll('[data-editar-habito]').forEach(b => b.onclick = () => { const h = state.habits.find(x => x.id === b.dataset.editarHabito); closeModal(true); if (h) habitoModal(h); });
}
function renderNotes() { return `${head(t("Biblioteca"), t("Notas"), t("Escreva, revise e mantenha suas referências perto."), `<button class="primary" id="add-note">${icone('mais')} ${t('Nova nota')}</button>`)}<div class="toolbar"><input class="search" id="note-search" placeholder="${t('Buscar texto ou #tag…')}" /></div><section class="notes-grid" id="notes-grid">${notesMarkup(state.notes)}</section>`; }
const linkDaNota = nota => `<a class="task-nota" data-action="edit-note" data-id="${nota.id}">${escapeHtml(nota.title || t("Sem título"))}</a>`;
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
function notesMarkup(notes, buscando = false) { return notes.length ? [...notes].sort((a,b)=>b.updatedAt-a.updatedAt).map(n=>{
  const folder=state.folders.find(f=>f.id===n.folderId);
  const ligacoes=new Set(Kiro.wikiLinks(n.body).map(l=>Kiro.normalize(l.target))).size;
  const meta=[
    folder && `<span class="pasta-chip"${folder.color?` data-cor-pasta="${folder.color}"`:""}>${icone('pastas')} ${escapeHtml(folder.path||folder.title)}</span>`,
    Kiro.tags(n).map(t=>`#${escapeHtml(t)}`).join(" "),
    ligacoes && (ligacoes===1 ? t('1 ligação') : t('{n} ligações', { n: ligacoes })),
    n.links.length && (n.links.length===1 ? t('1 link externo') : t('{n} links externos', { n: n.links.length })),
    ...(()=>{const dia=d=>KiroIdiomas.formatarData(d,{day:"numeric",month:"short"});
      if(!n.createdAt)return [t('atualizado {data}', { data: dia(n.updatedAt) })];
      return [t('criada {data}', { data: dia(n.createdAt) }),new Date(n.createdAt).toDateString()!==new Date(n.updatedAt).toDateString()&&t('atualizada {data}', { data: dia(n.updatedAt) })];})()
  ].filter(Boolean).join(" · ");
  return `<article class="note-card" role="button" tabindex="0" data-action="edit-note" data-id="${n.id}"><h2>${escapeHtml(n.title || t("Sem título"))}</h2><p>${escapeHtml(textoPlano(n.body).slice(0,220) || t("Nota vazia"))}</p><div class="note-meta">${meta}</div></article>`;
}).join("") : `<div class="empty">${buscando ? t('Nenhuma nota encontrada para essa busca.') : t('Crie sua primeira nota para começar.')}</div>`; }
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
async function marcarTarefaDaNota(chave) {
  if (busy || failed || !loaded) return;
  const [id, pos] = [chave.slice(0, chave.lastIndexOf(':')), Number(chave.slice(chave.lastIndexOf(':') + 1))];
  const nota = getNote(id); if (!nota) return;
  const fim = nota.body.indexOf('\n', pos), linha = nota.body.slice(pos, fim < 0 ? undefined : fim);
  const trocada = linha.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/, (_, a, marca, b) => a + (marca === ' ' ? 'x' : ' ') + b);
  if (trocada === linha) return; // a nota mudou desde o desenho: não mexe em outra linha
  state.notes = state.notes.map(n => n.id === id ? { ...n, body: n.body.slice(0, pos) + trocada + n.body.slice(pos + linha.length), updatedAt: Date.now() } : n);
  if (await save()) status(/\[[xX]\]/.test(trocada)
    ? t('Tarefa na nota {titulo} concluída.', { titulo: nota.title })
    : t('Tarefa na nota {titulo} reaberta.', { titulo: nota.title }));
}
// Tarefa recorrente que acabou de ser concluída (estava aberta em `antes`): cria a próxima ocorrência.
function criarProximas(antes) {
  state.tasks = Kiro.criarProximas(state.tasks, antes, uid);
}
// ---- Tarefas: resumo no topo, abas com contagem e grupos por data ----
let filtroDasTarefas = 'todas';   // vale enquanto o app está aberto
const somarDias = (dia, n) => { const [a, m, d] = dia.split('-').map(Number); return Kiro.localDate(new Date(a, m - 1, d + n)); };
const GRUPOS_DE_DATA = [['atrasadas', frase('Atrasadas')], ['hoje', frase('Hoje')], ['amanha', frase('Amanhã')], ['semana', frase('Próximos 7 dias')], ['depois', frase('Depois')]];
function grupoDaData(due, hoje) {
  if (due < hoje) return 'atrasadas';
  if (due === hoje) return 'hoje';
  if (due === somarDias(hoje, 1)) return 'amanha';
  return due <= somarDias(hoje, 7) ? 'semana' : 'depois';
}
const ordemDaPrioridade = x => ({ Alta: 0, 'Média': 1 })[x.priority] ?? 2;
const linhaDaTarefaDaNota = x => `<div class="task-item">${check(x.feita, "toggle-note-task", `${x.nota.id}:${x.pos}`)}<div class="task-title">${escapeHtml(x.texto)}<div class="task-info">${linkDaNota(x.nota)}</div></div></div>`;
let diaSelecionadoNoCalendario = '';
function textoDataCalendario(dia, opcoes = { dateStyle: 'full' }) { return KiroIdiomas.formatarData(new Date(`${dia}T12:00:00`), opcoes); }
function renderCalendario(lista) {
  if (!diaSelecionadoNoCalendario) diaSelecionadoNoCalendario = today();
  const dias = Kiro.calendarioDoMes(diaSelecionadoNoCalendario), porData = new Map();
  for (const tarefa of lista) {
    if (!porData.has(tarefa.due)) porData.set(tarefa.due, []);
    porData.get(tarefa.due).push(tarefa);
  }
  const semanas = Array.from({ length: 6 }, (_, i) => dias.slice(i * 7, i * 7 + 7));
  const diasSemana = [t('Seg'), t('Ter'), t('Qua'), t('Qui'), t('Sex'), t('Sáb'), t('Dom')];
  const dataCompleta = dia => textoDataCalendario(dia);
  const qtd = n => n === 1 ? t('1 tarefa') : t('{n} tarefas', { n });
  const nomeMes = textoDataCalendario(diaSelecionadoNoCalendario, { month: 'long', year: 'numeric' });
  // Duas linhas fixas, sem o ano (já está no título do mês): a altura não muda de um dia para outro.
  const tituloDia = `<small>${textoDataCalendario(diaSelecionadoNoCalendario, { weekday: 'long' })}</small> ${textoDataCalendario(diaSelecionadoNoCalendario, { day: 'numeric', month: 'long' })}`, tarefasDoDia = porData.get(diaSelecionadoNoCalendario) || [];
  const linha = (d, i) => {
    const n = porData.get(d.date)?.length || 0;
    return `<button type="button" role="gridcell" class="calendario-dia${d.inMonth ? '' : ' fora-do-mes'}${d.date === today() ? ' calendario-hoje' : ''}" data-calendario-dia="${d.date}" aria-label="${t('Selecionar dia {data}', { data: dataCompleta(d.date) })}, ${n ? qtd(n) : t('Sem tarefas')}" aria-selected="${d.date === diaSelecionadoNoCalendario}"${d.date === today() ? ' aria-current="date"' : ''} tabindex="${d.date === diaSelecionadoNoCalendario ? '0' : '-1'}"><span class="calendario-numero">${Number(d.date.slice(-2))}</span>${n ? `<span class="calendario-contagem" aria-hidden="true">${n}</span>` : ''}</button>`;
  };
  return `<div class="calendario-layout">
    <section class="card calendario-mes" aria-label="${t('Calendário mensal')}" >
      <div class="calendario-navegacao"><button type="button" class="secondary" data-calendario-mes="-1" aria-label="${t('Mês anterior')}">‹</button><h2 id="calendario-mes-titulo" aria-live="polite">${nomeMes}</h2><button type="button" class="secondary" data-calendario-mes="1" aria-label="${t('Próximo mês')}">›</button><button type="button" class="secondary" data-calendario-hoje>${t('Hoje')}</button></div>
      <div class="calendario-grade" role="grid" aria-labelledby="calendario-mes-titulo"><div class="calendario-semana" role="row">${diasSemana.map(d => `<span role="columnheader">${d}</span>`).join('')}</div>${semanas.map(semana => `<div class="calendario-semana" role="row">${semana.map(linha).join('')}</div>`).join('')}</div>
    </section>
    <section class="card calendario-selecionado" aria-labelledby="calendario-dia-titulo"><header class="calendario-dia-cabecalho"><h2 id="calendario-dia-titulo">${tituloDia}</h2><button type="button" class="primary" data-calendario-criar>${icone('mais')} ${t('Criar tarefa')}</button></header>${tarefasDoDia.map(tarefa => taskRow(tarefa)).join('') || `<p class="empty">${t('Nenhuma tarefa neste dia.')}</p>`}</section>
  </div>`;
}
// Trocar de dia não refaz a tela: só muda o miolo do painel do dia, e a grade só quando o mês muda.
function selecionarDiaNoCalendario(dia) {
  diaSelecionadoNoCalendario = dia;
  const mes = $('.calendario-mes'), painel = $('.calendario-selecionado');
  if (!mes || !painel) return render();
  const novo = document.createElement('div');
  novo.innerHTML = renderTasks();
  painel.innerHTML = novo.querySelector('.calendario-selecionado').innerHTML;
  if (!mes.querySelector(`[data-calendario-dia="${CSS.escape(dia)}"]:not(.fora-do-mes)`)) { mes.innerHTML = novo.querySelector('.calendario-mes').innerHTML; return; }
  for (const celula of mes.querySelectorAll('[data-calendario-dia]')) {
    const escolhida = celula.dataset.calendarioDia === dia;
    celula.setAttribute('aria-selected', String(escolhida));
    celula.tabIndex = escolhida ? 0 : -1;
  }
}
function renderTasks() {
  const hoje = today();
  const abertas = state.tasks.filter(x => !x.done).sort((a, b) => a.due.localeCompare(b.due) || ordemDaPrioridade(a) - ordemDaPrioridade(b));
  const feitas = state.tasks.filter(x => x.done).sort((a, b) => b.due.localeCompare(a.due));
  const todasDasNotas = tarefasDasNotas(), dasNotas = todasDasNotas.filter(x => !x.feita), notasFeitas = todasDasNotas.filter(x => x.feita);
  const emAberto = abertas.length + dasNotas.length, concluidas = feitas.length + notasFeitas.length;
  const atrasadas = abertas.filter(x => x.due < hoje), paraHoje = abertas.filter(x => x.due === hoje), proximas = abertas.filter(x => x.due > hoje);
  const abas = [['todas', t('Todas'), emAberto], ['hoje', t('Hoje'), atrasadas.length + paraHoje.length], ['proximas', t('Próximas'), proximas.length], ['notas', t('Nas notas'), dasNotas.length], ['feitas', t('Concluídas'), concluidas]];
  // Por data, ou por status em lista (seções empilhadas) ou em colunas (lado a lado, como um quadro).
  const visao = ['calendario', 'status', 'colunas'].includes(lerPreferencia('tarefasVisao')) ? lerPreferencia('tarefasVisao') : 'data', porStatusAtivo = ['status', 'colunas'].includes(visao);
  // Por status, "Nas notas" e "Concluídas" não são filtros (concluído é uma seção): vale "Todas".
  if (porStatusAtivo && ['notas', 'feitas'].includes(filtroDasTarefas)) filtroDasTarefas = 'todas';
  const f = visao === 'calendario' && filtroDasTarefas === 'notas' ? 'todas' : filtroDasTarefas;
  const abasVisiveis = porStatusAtivo ? abas.filter(([id]) => !['notas', 'feitas'].includes(id)) : visao === 'calendario' ? abas.filter(([id]) => id !== 'notas') : abas;
  const grupo = (titulo, itens, linha = taskRow, classe = '') => itens.length ? `<div class="task-group ${classe}"><h2>${titulo}<span class="task-group-conta">${itens.length}</span></h2>${itens.map(item => linha(item)).join('')}</div>` : '';
  const porData = lista => GRUPOS_DE_DATA.map(([id, nome]) => grupo(t(nome), lista.filter(x => grupoDaData(x.due, hoje) === id), taskRow, id === 'atrasadas' ? 'grupo-atrasado' : '')).join('');
  // Por status: uma seção por status; a tarefa se arrasta entre elas (ou ← → com o foco nela).
  const porStatus = () => {
    const doFiltro = x => f === 'hoje' ? x.due <= hoje : f === 'proximas' ? x.due > hoje : true;
    const lista = state.tasks.filter(doFiltro);
    const aberto = lerPreferencia('tarefasConcluidoAberto') === '1';
    return Kiro.STATUS_DA_TAREFA.map(st => {
      const itens = lista.filter(x => Kiro.statusDaTarefa(x) === st).sort((a, b) => st === 'concluido' ? b.due.localeCompare(a.due) : a.due.localeCompare(b.due) || ordemDaPrioridade(a) - ordemDaPrioridade(b));
      // Caixinhas das notas não têm data nem estado próprio: aberta é "não começada", marcada é "concluída". Não se arrastam.
      const dasNotasAqui = f !== 'todas' ? [] : st === 'nao-comecado' ? dasNotas : st === 'concluido' ? notasFeitas : [];
      const recolhida = visao === 'status' && st === 'concluido' && !aberto;   // em colunas, nada recolhe
      return `<section class="status-secao${recolhida ? ' recolhida' : ''}" data-status="${st}"><h2>${st === 'concluido' && visao === 'status' ? `<button type="button" class="status-recolher" data-recolher-concluido aria-expanded="${!recolhida}">` : ''}<span class="status-marca" aria-hidden="true"></span>${t(ROTULOS_DE_STATUS[st])}<span class="task-group-conta">${itens.length + dasNotasAqui.length}</span>${st === 'concluido' && visao === 'status' ? '</button>' : ''}</h2>
        <div class="status-itens">${itens.map(x => `<div class="status-item" draggable="true" tabindex="0" data-tarefa="${x.id}" aria-label="${escapeHtml(x.title)}">${taskRow(x)}</div>`).join('')}${dasNotasAqui.map(x => `<div class="status-item">${linhaDaTarefaDaNota(x)}</div>`).join('')}${itens.length + dasNotasAqui.length ? '' : `<p class="status-vazio">${t('Arraste uma tarefa para cá.')}</p>`}</div></section>`;
    }).join('');
  };
  const tarefasDoCalendario = f === 'feitas' ? feitas : f === 'hoje' ? [...atrasadas, ...paraHoje] : f === 'proximas' ? proximas : abertas;
  const notasNoMes = f === 'todas' ? dasNotas : f === 'feitas' ? notasFeitas : [];
  const corpo = visao === 'calendario' ? renderCalendario(tarefasDoCalendario) + (notasNoMes.length ? `<div class="card calendario-notas">${grupo(t('Nas notas'), notasNoMes, linhaDaTarefaDaNota)}</div>` : '')
    : porStatusAtivo ? porStatus()
    : f === 'feitas' ? grupo(t('Concluídas'), feitas) + grupo(t('Nas notas'), notasFeitas, linhaDaTarefaDaNota)
    : f === 'notas' ? grupo(t('Nas notas'), dasNotas, linhaDaTarefaDaNota)
    : f === 'hoje' ? porData([...atrasadas, ...paraHoje])
    : f === 'proximas' ? porData(proximas)
    : porData(abertas) + grupo(t('Nas notas'), dasNotas, linhaDaTarefaDaNota);
  const vazio = { todas: t('Tudo concluído por aqui.'), hoje: t('Nada para hoje.'), proximas: t('Nada agendado para os próximos dias.'), notas: t('Nenhuma caixinha aberta nas notas.'), feitas: t('As tarefas concluídas aparecerão aqui.') }[f];
  const total = emAberto + concluidas, pct = total ? Math.round(concluidas / total * 100) : 0;
  const numero = (valor, rotulo, classe = '') => `<div class="resumo-item ${classe}"><b>${valor}</b><span>${rotulo}</span></div>`;
  return `${head(t("Organização"), t("Tarefas"), t("Concentre-se no que realmente importa hoje."), `<button class="primary" id="add-task">${icone('mais')} ${t('Nova tarefa')}</button>`)}
  <div class="tarefas-resumo">${numero(emAberto, t('Em aberto'))}${numero(atrasadas.length, t('Atrasadas'), atrasadas.length ? 'alerta' : '')}${numero(paraHoje.length, t('Para hoje'))}<div class="resumo-item resumo-progresso"><b>${pct}%</b><span>${t('{feitas} de {total} concluídas', { feitas: concluidas, total })}</span><div class="progress"><div style="width:${pct}%"></div></div></div></div>
  <div class="tarefas-barra"><div class="segmentos-compactos tarefas-abas" role="group" aria-label="${t('Filtrar')}">${abasVisiveis.map(([id, rotulo, n]) => `<button type="button" class="segmento-botao" data-tarefas-aba="${id}" aria-pressed="${f === id}">${rotulo} <span class="segmento-contagem">${n}</span></button>`).join('')}</div>
  <div class="segmentos-compactos tarefas-visao" role="group" aria-label="${t('Organizar por')}">${[['data', 'calendario', t('Por data')], ['calendario', 'calendario', t('Mês')], ['status', 'lista-marcadores', t('Lista')], ['colunas', 'colunas', t('Colunas')]].map(([id, ic, r]) => `<button type="button" class="segmento-botao" data-tarefas-visao="${id}" aria-pressed="${visao === id}">${icone(ic)} ${r}</button>`).join('')}</div></div>
  <section class="${visao === 'calendario' ? 'por-mes' : 'card'} tarefas-lista${porStatusAtivo ? ' por-status' : ''}${visao === 'colunas' ? ' por-colunas' : ''}">${corpo || `<div class="empty">${vazio}</div>`}</section>`;
}
const ROTULOS_DE_STATUS = { 'nao-comecado': frase('Não começado'), andamento: frase('Em andamento'), pausado: frase('Pausado'), concluido: frase('Concluído') };
const gravarPreferencia = (chave, valor) => { try { localStorage.setItem(`kiro.${chave}`, valor); } catch { /* janela privada: vale só nesta sessão */ } };
function iconeStatus(st) {
  if (st === 'andamento') return '<svg class="icone" viewBox="0 0 24 24" style="color:var(--acento)"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 5a7 7 0 0 0 0 14Z" fill="currentColor"/></svg>';
  if (st === 'pausado') return '<svg class="icone" viewBox="0 0 24 24" style="color:var(--warning)"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="10" y1="9" x2="10" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  if (st === 'concluido') return '<svg class="icone" viewBox="0 0 24 24" style="color:var(--ok, var(--acento))"><circle cx="12" cy="12" r="7" fill="currentColor" stroke="currentColor" stroke-width="2"/><path d="m9 12 2 2 4-4" fill="none" stroke="var(--primario-texto, #fff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<svg class="icone" viewBox="0 0 24 24" style="color:var(--muted)"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
}
function itensStatusDaTarefa(id) {
  const atual = () => state.tasks.find(x => x.id === id);
  return Kiro.STATUS_DA_TAREFA.map(st => ({
    rotulo: t(ROTULOS_DE_STATUS[st]),
    icone: iconeStatus(st),
    ativo: () => Boolean(atual() && Kiro.statusDaTarefa(atual()) !== st),
    acao: () => moverStatusDaTarefa(id, st),
  }));
}
function menuDaTarefa(id) {
  const atual = () => state.tasks.find(x => x.id === id);
  return [
    ...itensStatusDaTarefa(id),
    { separador: true },
    { rotulo: t('Editar'), icone: icone('renomear'), acao: () => atual() && taskModal(atual()) },
    { rotulo: t('Copiar citação'), icone: icone('link'), acao: async () => { const x = atual(); if (x && await copiarTexto(Kiro.taskReference(x))) status(t('Citação copiada: cole numa nota.')); } },
    { separador: true },
    { rotulo: t('Excluir'), icone: icone('lixeira'), acao: () => action('delete-task', id) },
  ];
}
// Leva a tarefa a outro status (Concluído marca como feita) e devolve o foco a ela sem piscar.
async function moverStatusDaTarefa(id, destino) {
  const tarefa = state.tasks.find(x => x.id === id);
  if (!tarefa || busy || failed || !loaded || Kiro.statusDaTarefa(tarefa) === destino) return;
  const antes = state.tasks;
  state.tasks = state.tasks.map(x => x.id === id ? Kiro.moverTarefa(x, destino) : x);
  criarProximas(antes);
  if (typeof render === 'function') render();
  (document.querySelector(`[data-tarefa="${CSS.escape(id)}"]`) || document.querySelector(`[data-status-tarefa="${CSS.escape(id)}"]`))?.focus({ preventScroll: true });
  const salvo = await save(null, 0, { semRender: true });
  editorDaNota?.editor.redesenhar?.();
  if (salvo) status(`${tarefa.title} · ${t(ROTULOS_DE_STATUS[destino])}`);
}
// A lista de sugestões do navegador não segue o tema e cobre a nota: vale para qualquer campo, inclusive os futuros.
document.addEventListener('focusin', e => { if (e.target.matches('input:not([autocomplete])')) e.target.autocomplete = 'off'; });
document.addEventListener('click', e => {
  const btnStatus = e.target.closest?.('[data-status-tarefa]');
  if (btnStatus) {
    e.stopPropagation();
    if (menuAberto?._origem === btnStatus) return void fecharMenuContexto();
    const r = btnStatus.getBoundingClientRect();
    abrirMenuContexto({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 4 }, document.body, itensStatusDaTarefa(btnStatus.dataset.statusTarefa), { compacto: true, origem: btnStatus });
    return;
  }
  const v = e.target.closest?.('[data-tarefas-visao]');
  if (v) { gravarPreferencia('tarefasVisao', v.dataset.tarefasVisao); render(); $(`[data-tarefas-visao="${v.dataset.tarefasVisao}"]`)?.focus(); return; }
  const dia = e.target.closest?.('[data-calendario-dia]');
  if (dia) { selecionarDiaNoCalendario(dia.dataset.calendarioDia); $(`[data-calendario-dia="${CSS.escape(diaSelecionadoNoCalendario)}"]`)?.focus(); return; }
  const mes = e.target.closest?.('[data-calendario-mes]');
  if (mes) { selecionarDiaNoCalendario(Kiro.somarMeses(diaSelecionadoNoCalendario || today(), Number(mes.dataset.calendarioMes)) || today()); $(`[data-calendario-mes="${mes.dataset.calendarioMes}"]`)?.focus(); return; }
  if (e.target.closest?.('[data-calendario-hoje]')) { selecionarDiaNoCalendario(today()); $('[data-calendario-hoje]')?.focus(); return; }
  if (e.target.closest?.('[data-calendario-criar]')) {
    const prazo = diaSelecionadoNoCalendario || today();
    if (filtroDasTarefas === 'feitas' || filtroDasTarefas === 'notas' || (filtroDasTarefas === 'hoje' && prazo > today()) || (filtroDasTarefas === 'proximas' && prazo <= today())) filtroDasTarefas = 'todas';
    taskModal({ title: '', due: prazo, priority: 'Média', noteId: '' }); return;
  }
  if (e.target.closest?.('[data-recolher-concluido]')) { gravarPreferencia('tarefasConcluidoAberto', lerPreferencia('tarefasConcluidoAberto') === '1' ? '0' : '1'); render(); return; }
});
document.addEventListener('contextmenu', e => {
  const linha = e.target.closest?.('.task-item[data-id]');
  if (!linha || e.target.closest?.('a, input, textarea, select')) return;
  abrirMenuContexto(e, document.body, menuDaTarefa(linha.dataset.id), { compacto: true });
});
document.addEventListener('keydown', e => {
  const dia = e.target.closest?.('[data-calendario-dia]');
  if (!dia) return;
  const atual = dia.dataset.calendarioDia;
  let proximo = null;
  if (e.key === 'ArrowLeft') proximo = somarDias(atual, -1);
  else if (e.key === 'ArrowRight') proximo = somarDias(atual, 1);
  else if (e.key === 'ArrowUp') proximo = somarDias(atual, -7);
  else if (e.key === 'ArrowDown') proximo = somarDias(atual, 7);
  else if (e.key === 'Home' || e.key === 'End') {
    const diaSemana = new Date(`${atual}T12:00:00`).getDay(), segunda = somarDias(atual, -((diaSemana + 6) % 7));
    proximo = e.key === 'Home' ? segunda : somarDias(segunda, 6);
  } else if (e.key === 'PageUp' || e.key === 'PageDown') proximo = Kiro.somarMeses(atual, e.key === 'PageUp' ? -1 : 1);
  if (!proximo) return;
  e.preventDefault(); selecionarDiaNoCalendario(proximo);
  $(`[data-calendario-dia="${CSS.escape(proximo)}"]`)?.focus();
});
let tarefaArrastada = null;
document.addEventListener('dragstart', e => {
  const item = e.target.closest?.('[data-tarefa]');
  if (!item) return;
  tarefaArrastada = item.dataset.tarefa;
  item.classList.add('arrastando');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/kiro-tarefa', tarefaArrastada);
});
const limparStatusAlvo = exceto => document.querySelectorAll('.status-secao.alvo').forEach(x => { if (x !== exceto) x.classList.remove('alvo'); });
document.addEventListener('dragover', e => {
  const secao = tarefaArrastada && e.target.closest?.('.status-secao');
  if (!secao) { limparStatusAlvo(); return; }
  e.preventDefault();
  const t = state.tasks.find(x => x.id === tarefaArrastada);
  const ativa = t && Kiro.statusDaTarefa(t) !== secao.dataset.status ? secao : null;
  limparStatusAlvo(ativa);
  if (ativa) ativa.classList.add('alvo');
});
document.addEventListener('drop', e => {
  const secao = tarefaArrastada && e.target.closest?.('.status-secao');
  limparStatusAlvo();
  if (!secao) return;
  e.preventDefault();
  const id = tarefaArrastada; tarefaArrastada = null;
  moverStatusDaTarefa(id, secao.dataset.status);
});
document.addEventListener('dragend', () => { tarefaArrastada = null; limparStatusAlvo(); document.querySelectorAll('.status-item.arrastando').forEach(x => x.classList.remove('arrastando')); });
document.addEventListener('keydown', e => {
  const item = e.target.closest?.('[data-tarefa]');
  if (!item || e.target !== item || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const tarefa = state.tasks.find(x => x.id === item.dataset.tarefa), ordem = Kiro.STATUS_DA_TAREFA;
  if (!tarefa) return;
  const i = ordem.indexOf(Kiro.statusDaTarefa(tarefa)) + (e.key === 'ArrowRight' ? 1 : -1);
  if (i >= 0 && i < ordem.length) moverStatusDaTarefa(tarefa.id, ordem[i]);
});
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-tarefas-aba]');
  if (!b) return;
  filtroDasTarefas = b.dataset.tarefasAba;
  render();
  $(`[data-tarefas-aba="${filtroDasTarefas}"]`)?.focus();
});
const byTitle = (a,b) => KiroIdiomas.comparar(a.title, b.title);
const childFolders = id => state.folders.filter(f=>(f.parentId||"")===id).sort(byTitle);
const folderNotes = id => state.notes.filter(n=>(n.folderId||"")===id).sort(byTitle);
const folderFluxos = id => (state.fluxos || []).filter(f => (f.folderId || "") === id).sort(byTitle);
// Árvore no estilo de um explorador de arquivos: pastas aninhadas, notas como folhas.
// ---- Ícones ----
// Desenho vetorial no lugar de emoji e símbolos de texto: mesma grade de 24, mesma
// espessura de traço, e a cor vem do texto em volta (currentColor), então o ícone
// acompanha hover, foco e tema sem regra extra.
const TRACOS = {
  fluxo: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7h2.5a2 2 0 0 1 2 2v5"/>',
  hoje: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  notas: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  tarefas: '<path d="M4 7.2 5.4 8.6 8 6M4 16.2 5.4 17.6 8 15"/><path d="M11 7h9M11 17h9"/>',
  pastas: '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  'pasta-aberta': '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v1.5"/><path d="M3.6 10.5h17.1l-2 7.2a2 2 0 0 1-1.9 1.3H6.2a2 2 0 0 1-1.9-1.4z"/>',
  'pasta-nova': '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  grafo: '<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="8" r="2.3"/><circle cx="11" cy="17.6" r="2.3"/><path d="M8.2 7.6 15.8 8.4M7.2 9.1l2.7 6.4M16.5 10.1l-4 5.5"/>',
  nota: '<path d="M12 3.6 20.4 12 12 20.4 3.6 12z"/>',
  mais: '<path d="M12 5.5v13M5.5 12h13"/>',
  'mais-opcoes': '<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="2.6"/>',
  imprimir: '<path d="M7.5 9V4.5h9V9"/><path d="M7.5 17H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1.5"/><path d="M7.5 14h9v5.5h-9z"/>',
  anexo: '<path d="m19 11.5-7.1 7.1a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.3 4.3l-7.4 7.4a1.5 1.5 0 0 1-2.1-2.1l6.7-6.7"/>',
  microfone: '<rect x="9" y="4" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  historico: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5L4.5 8.8"/><path d="M4.5 4.5v4.3h4.3M12 8v4.3l2.8 1.7"/>',
  abaixo: '<path d="M6.5 9.5 12 15l5.5-5.5"/>',
  marcado: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  calendario: '<rect x="3.5" y="5.5" width="17" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17"/>',
  exportar: '<path d="M12 4v10M8.2 10.8 12 14.5l3.8-3.7"/><path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"/>',
  importar: '<path d="M12 14.5v-10M8.2 7.7 12 4l3.8 3.7"/><path d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"/>',
  recarregar: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9h-4.5"/>',
  casa: '<path d="M4 10.6 12 4l8 6.6"/><path d="M6.2 9.8V19a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.8"/><path d="M10 20v-5h4v5"/>',
  expandir: '<path d="M7 7 12 11.5 17 7M7 13 12 17.5 17 13"/>',
  recolher: '<path d="M7 17 12 12.5 17 17M7 11 12 6.5 17 11"/>',
  esquerda: '<path d="M14 5.5 7.5 12 14 18.5"/>',
  direita: '<path d="M10 5.5 16.5 12 10 18.5"/>',
  tocar: '<path d="M8.5 5.5v13l10-6.5z"/>',
  grafico: '<path d="M4 20h16M7 16.5V11M12 16.5V6M17 16.5v-3.5"/>',
  arquivar: '<path d="M4 5.5h16v4H4zM5.5 9.5V18a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.5M10 13.5h4"/>',
  chama: '<path d="M12 21c-3.6 0-6-2.5-6-5.9 0-3.2 2.3-5 3.5-7.6.4 1.7 1.4 2.8 2.4 3.1.3-2.4 1.6-4.3 3.1-5.6.5 2.7 3 4.6 3 8.5 0 4.3-2.5 7.5-6 7.5z"/>',
  fechar: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  lixeira: '<path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.8 7 7.6 19a1.5 1.5 0 0 0 1.5 1.4h5.8A1.5 1.5 0 0 0 16.4 19L17.2 7"/>',
  renomear: '<path d="M4 20h4l10.3-10.3a2.4 2.4 0 1 0-3.4-3.4L4.6 16.6z"/><path d="M13.6 7.2 16.8 10.4"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 1 0-5.1-5.1l-1.2 1.2"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 1 0 5.1 5.1l1.2-1.2"/>',
  imagem: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L6 19.5"/>',
  trocar: '<path d="M4.5 9h14M15 5.5 18.5 9 15 12.5"/><path d="M19.5 15h-14M9 11.5 5.5 15 9 18.5"/>',
  dicionario: '<path d="M5 5.5A2 2 0 0 1 7 3.5h11.5v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h11.5v-4"/><path d="M11.75 7.5v6M8.75 10.5h6"/>',
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
  // Modo Personalizar do Hoje: alça de arrastar, largura e esconder.
  colunas: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.2 4.5v15M14.8 4.5v15"/>',
  arrastar: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
  'largura-inteira': '<path d="M4 12h16M7.5 8.5 4 12l3.5 3.5M16.5 8.5 20 12l-3.5 3.5"/>',
  'largura-normal': '<path d="M3.5 12H10M14 12h6.5M6.5 8.5 10 12l-3.5 3.5M17.5 8.5 14 12l3.5 3.5"/>',
  esconder: '<path d="M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/><circle cx="12" cy="12" r="2.5"/><path d="M4.5 4.5l15 15"/>',
  // Temas (cards de Aparência): um desenho por tema; os de anime são homenagens em traço, sem logos.
  'tema-claro': '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  'tema-kiro': '<path d="M19 14.8A7.8 7.8 0 1 1 9.2 5a6.2 6.2 0 0 0 9.8 9.8z"/>',
  'tema-grafite': '<path d="M4.5 19.5l1.1-4.4L15.4 5.3a2.1 2.1 0 0 1 3 3L8.6 18.1z"/><path d="M13.4 7.3l3 3"/>',
  'tema-liquid-glass': '<rect x="4" y="3" width="16" height="18" rx="6"/><path d="M7 9V7a1 1 0 0 1 1-1h3M7 17l10-10M13 18h3a1 1 0 0 0 1-1v-2"/>',
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
  // Painel da direita: links de volta/saída, sumário e etiquetas.
  'link-volta': '<path d="M19 6v12"/><path d="M14 12H5"/><path d="M9 7 4 12l5 5"/>',
  'link-saida': '<path d="M5 6v12"/><path d="M10 12h9"/><path d="M15 7 20 12l-5 5"/>',
  sumario: '<path d="M5 6.5h14M5 12h10M5 17.5h6"/>',
  etiqueta: '<path d="M4 4.8v6.2c0 .5.2 1 .6 1.4l7 7c.8.8 2 .8 2.8 0l6-6c.8-.8.8-2 0-2.8l-7-7a2 2 0 0 0-1.4-.6H5.8A1.8 1.8 0 0 0 4 4.8Z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  'painel-direito': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15.5 4.5v15"/>',
  desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  refazer: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  estrela: '<path d="m12 3.8 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z"/>',
  'estrela-cheia': '<path d="m12 3.8 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z" fill="currentColor"/>',
};
// Nomes dos botões da barra lateral: começam iguais aos genéricos, mas cada tema de anime pode
// redesenhá-los sem mexer no "+" ou no "detalhes" do resto do app.
Object.assign(TRACOS, { 'nova-nota': TRACOS.mais, 'nota-diaria': TRACOS.calendario, 'ir-para-nota': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/>', 'alternar-cofre': '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>', configuracoes: '<path d="M18.8 9.6 21.1 10.2 21.1 13.8 18.8 14.4 18.5 15.1 19.8 17.1 17.1 19.8 15.1 18.5 14.4 18.8 13.8 21.1 10.2 21.1 9.6 18.8 8.9 18.5 6.9 19.8 4.2 17.1 5.5 15.1 5.2 14.4 2.9 13.8 2.9 10.2 5.2 9.6 5.5 8.9 4.2 6.9 6.9 4.2 8.9 5.5 9.6 5.2 10.2 2.9 13.8 2.9 14.4 5.2 15.1 5.5 17.1 4.2 19.8 6.9 18.5 8.9z"/><circle cx="12" cy="12" r="3"/>' });
// Tema cujos ícones estão em uso (icones-tema.js); sem conjunto próprio, vale o desenho padrão.
let temaDosIcones = '';
const tracoDoIcone = nome => globalThis.KiroIconesTema?.[temaDosIcones]?.[nome] ?? TRACOS[nome] ?? '';
const icone = (nome, classe = '') => `<svg class="icone${classe ? ' ' + classe : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${tracoDoIcone(nome)}</svg>`;
// Ícones do HTML fixo: o marcador data-icone vira desenho quando o app abre.
// Redesenha quando o tema troca, porque o desenho pode ser outro.
function desenharIconesFixos() {
  for (const alvo of document.querySelectorAll('[data-icone]')) {
    if (alvo.dataset.iconeDoTema === temaDosIcones && alvo.querySelector(':scope > svg')) continue;
    alvo.querySelector(':scope > svg')?.remove();
    alvo.insertAdjacentHTML('afterbegin', icone(alvo.dataset.icone));
    alvo.dataset.iconeDoTema = temaDosIcones;
  }
}

// Seleção múltipla de notas e fluxos na árvore (ids; nota e fluxo nunca dividem um id).
let selecaoArvore = new Set(), ancoraArvore = null, marcandoComDireito = null;
function treeMarkup(parentId, depth) {
  if (depth > 20) return ""; // guarda contra ciclo, mesmo que validateState já recuse
  const folders = childFolders(parentId).map(folder => {
    const open = expanded.has(folder.id);
    const temFilhos = childFolders(folder.id).length || folderNotes(folder.id).length || folderFluxos(folder.id).length;
    const tools = `<span class="tree-tools"><button class="icon-button" data-action="new-note-folder" data-id="${folder.id}" title="${t('Nova nota nesta pasta')}">${icone('mais')}</button><button class="icon-button" data-action="new-subfolder" data-id="${folder.id}" title="${t('Nova subpasta')}">${icone('pasta-nova')}</button><button class="icon-button" data-action="edit-folder" data-id="${folder.id}" title="${t('Renomear ou mover')}">${icone('renomear')}</button><button class="icon-button" data-action="delete-folder" data-id="${folder.id}" title="${t('Excluir')}">${icone('lixeira')}</button></span>`;
    // Filhos ficam sempre no DOM: abrir e fechar vira transição de CSS, sem redesenhar.
    return `<div class="tree-node${open?" open":""}" data-id="${folder.id}"${folder.color?` data-cor-pasta="${folder.color}"`:""}><div class="tree-row tree-folder" data-action="toggle-folder" data-id="${folder.id}" style="--depth:${depth}"${folder.description?` title="${escapeHtml(folder.description)}"`:""}><span class="twisty">${temFilhos?icone('direita'):""}</span><span class="tree-icone">${icone('pastas')}</span><span class="tree-name" title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</span>${tools}</div><div class="tree-children"><div class="tree-children-inner">${treeMarkup(folder.id,depth+1)}</div></div></div>`;
  }).join("");
  const notes = folderNotes(parentId).map(note => {
    const tags = Kiro.tags(note).slice(0,2).map(t=>`#${escapeHtml(t)}`).join(" ");
    return `<div class="tree-row tree-note${editing?.id === note.id ? " ativa" : ""}${selecaoArvore.has(note.id) ? " selecionada" : ""}" draggable="true" data-action="edit-note" data-id="${note.id}" style="--depth:${depth}"><span class="twisty"></span><span class="tree-icone">${icone('nota')}</span><span class="tree-name" title="${escapeHtml(note.title||t("Sem título"))}">${escapeHtml(note.title||t("Sem título"))}</span><span class="tree-meta">${tags}</span></div>`;
  }).join("");
  const ativo = KiroAbas.notaAtiva(abas);
  const fluxos = folderFluxos(parentId).map(f => `<div class="tree-row tree-fluxo${ativo === f.id ? " ativa" : ""}${selecaoArvore.has(f.id) ? " selecionada" : ""}" draggable="true" data-action="abrir-fluxo" data-id="${f.id}" style="--depth:${depth}"><span class="twisty"></span><span class="tree-icone">${icone('fluxo')}</span><span class="tree-name" title="${escapeHtml(f.title)}">${escapeHtml(f.title)}</span><span class="tree-tipo">${t('FLUXO')}</span></div>`).join("");
  return folders + notes + fluxos;
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
function aplicarTamanhoDaInterface(valor = lerPreferencia('tamanhoInterface')) {
  const tamanho = [100, 115, 130, 150].includes(Number(valor)) ? Number(valor) : 100;
  document.documentElement.style.setProperty('--escala-interface', String(tamanho / 100));
  return tamanho;
}
// Corretor ortográfico: preferência desta instalação, ligado por padrão. Desligado, o html
// ganha spellcheck="false" (vale para todos os campos, no app e no navegador) e, no app,
// os dicionários saem da memória.
let corretorLigado = lerPreferencia('corretor') !== '0';
function aplicarCorretor() {
  if (corretorLigado) document.documentElement.removeAttribute('spellcheck');
  else document.documentElement.setAttribute('spellcheck', 'false');
  window.cadernoDesktop?.definirCorretor?.(corretorLigado);
  editorDaNota?.editor.definirOrtografia(corretorLigado);
  editorDoCartao?.definirOrtografia(corretorLigado);
  if (corretorLigado && editorDaNota) iniciarOrtografia();   // sem editor montado, a montagem agenda
}
// Corretor próprio (ortografia.js): carregado em segundo plano depois que a primeira nota aparece,
// só com a opção ligada. O dicionário pessoal vem do cofre aberto.
let ortografiaIniciada = false, ortografiaOuvindo = false, falhaAnunciada = false, falhaDoDicionario = false;
async function lerDicionarioDoCofre() {
  try { const p = await (window.cadernoDesktop ? window.cadernoDesktop.dicionario() : api('dicionario')); return Array.isArray(p) ? p : []; }
  catch { if (!falhaDoDicionario) { falhaDoDicionario = true; status(t('Não foi possível ler o dicionário do cofre'), true); } return []; }
}
// Só a leitura mais recente vale: uma leitura do cofre antigo que termine depois da do novo não a sobrescreve.
let leituraDoDicionario = 0;
async function aplicarDicionarioDoCofre() {
  const minha = ++leituraDoDicionario;
  const palavras = await lerDicionarioDoCofre();
  if (minha === leituraDoDicionario) KiroOrtografia.definirPessoais(palavras);
}
async function iniciarOrtografia() {
  if (ortografiaIniciada || !corretorLigado) return;
  ortografiaIniciada = true;
  try {
    await aplicarDicionarioDoCofre();
    if (!ortografiaOuvindo) { ortografiaOuvindo = true; KiroOrtografia.aoMudar(() => { editorDaNota?.editor.redesenharOrtografia(); editorDoCartao?.redesenharOrtografia(); }); }
    await KiroOrtografia.carregar();
  } catch {
    ortografiaIniciada = false;
    if (!falhaAnunciada) { falhaAnunciada = true; status(t('Não foi possível carregar o corretor'), true); }   // uma vez por sessão; as tentativas seguintes são silenciosas
  }
}
async function adicionarAoDicionario(palavra) {
  KiroOrtografia.adicionar(palavra);   // o sublinhado some na hora
  try { await (window.cadernoDesktop ? window.cadernoDesktop.adicionarAoDicionarioDoCofre(palavra) : api('dicionario', { palavra })); }
  catch (erro) { status(t('Não foi possível salvar no dicionário: {erro}', { erro: mensagemDoErro(erro) }), true); }
}
let lateralRecolhida = lerPreferencia('lateralRecolhida') === '1';
// Papel de parede: imagem atrás do conteúdo de todas as telas, menos Pastas (onde se lê e escreve).
// Fica nesta instalação, como a aparência. Um véu com a cor de fundo do tema, na força escolhida,
// mantém o texto legível sobre qualquer foto. A imagem (até 4K) mora no IndexedDB como Blob e entra
// na tela por uma URL blob:. Nem localStorage (uns 5 MB para o app inteiro) nem data: URL servem: o
// Chromium descarta, sem erro, URL com mais de 2 MB, e uma foto 4K passa disso.
const VEU_PADRAO = 60, LADO_MAXIMO_DO_PAPEL = 3840, LIMITE_DO_PAPEL_ANIMADO = 200 * 1024 * 1024;
let urlDoPapel = null;
const semAnimacao = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Papel animado: GIF vai como imagem (o navegador anima); vídeo (MP4/WebM) toca num <video> fixo atrás de
// tudo, sem som e em laço. Para na tela de Pastas e com a janela escondida.
// Escolher um vídeo já é pedir movimento: ele toca mesmo com "menos movimento" no sistema (o Windows liga isso
// ao desligar os efeitos de animação, e o vídeo ficava parado no primeiro quadro). Quem quiser seguir o
// sistema liga a opção em Configurações → Papel de parede.
const videoSegueOSistema = () => lerPreferencia('papelVideoSegueSistema') === '1';
const pausarPorMovimento = () => videoSegueOSistema() && semAnimacao();
function sincronizarVideoDoPapel() {
  const video = document.querySelector('#papel-video');
  if (!video) return;
  const parar = pausarPorMovimento() || document.hidden || document.querySelector('.app-shell')?.classList.contains('cofre-aberto');
  if (parar) video.pause(); else video.play().catch(() => { /* sem permissão de tocar: fica o primeiro quadro */ });
}
// Opacidade dos cartões: as cores de painel do tema, com transparência, só na área de conteúdo e só com
// papel de parede (o CSS troca --panel por --panel-vidro lá). Abaixo de 100%, o fundo ganha desfoque.
function aplicarVidro() {
  const html = document.documentElement, raiz = getComputedStyle(html);
  const opacidade = Math.min(100, Math.max(30, Number(lerPreferencia('papelOpacidadeCartoes') ?? 100) || 100));
  for (const v of ['panel', 'panel-raised', 'campo']) html.style.setProperty(`--${v}-vidro`, `color-mix(in srgb, ${raiz.getPropertyValue(`--${v}`).trim()} ${opacidade}%, transparent)`);
  html.classList.toggle('cartoes-vidro', opacidade < 100);
  html.classList.toggle('notas-solidas', lerPreferencia('vidroNotasSolidas') === '1');
  html.classList.toggle('grafo-solido', lerPreferencia('vidroGrafoSolido') === '1');
}
function papelGuardado(acao, valor) {
  return new Promise((ok, erro) => {
    const pedido = indexedDB.open('kiro-papel-de-parede', 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('papel');
    pedido.onerror = () => erro(pedido.error);
    pedido.onsuccess = () => {
      const loja = pedido.result.transaction('papel', acao === 'ler' ? 'readonly' : 'readwrite').objectStore('papel');
      const r = acao === 'ler' ? loja.get('imagem') : acao === 'gravar' ? loja.put(valor, 'imagem') : loja.delete('imagem');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    };
  });
}
async function aplicarPapelDeParede() {
  let imagem = null;
  try {
    // Versão anterior guardava no localStorage: muda de lugar uma vez.
    const antiga = lerPreferencia('papelDeParede');
    if (antiga) { await papelGuardado('gravar', antiga); localStorage.removeItem('kiro.papelDeParede'); }
    imagem = await papelGuardado('ler');
  } catch { /* sem IndexedDB (janela privada): segue sem papel de parede */ }
  const veu = Number(lerPreferencia('papelDeParedeVeu') ?? VEU_PADRAO), html = document.documentElement;
  html.classList.toggle('com-papel-de-parede', Boolean(imagem));
  const linha = document.querySelector('#cfg-papel');
  if (linha) linha.toggleAttribute('data-tem-papel', Boolean(imagem));
  if (urlDoPapel) { URL.revokeObjectURL(urlDoPapel); urlDoPapel = null; }
  const emVideo = imagem instanceof Blob && imagem.type.startsWith('video/');
  html.classList.toggle('papel-em-video', emVideo);
  let video = document.querySelector('#papel-video');
  const previa = document.querySelector('#cfg-papel .papel-previa');
  if (previa) previa.replaceChildren();
  aplicarVidro();
  if (!imagem) { video?.remove(); return void html.style.removeProperty('--papel-de-parede'); }
  // Blob (atual) ou data: URL de antes, que era sempre pequena.
  if (imagem instanceof Blob) urlDoPapel = URL.createObjectURL(imagem);
  const url = urlDoPapel || imagem;
  if (!emVideo) { video?.remove(); html.style.setProperty('--papel-de-parede', `url("${url}")`); }
  else {
    html.style.removeProperty('--papel-de-parede');
    if (!video) {
      video = Object.assign(document.createElement('video'), { id: 'papel-video', muted: true, loop: true, playsInline: true });
      video.setAttribute('aria-hidden', 'true');
      document.body.prepend(video);
    }
    video.src = url;
    sincronizarVideoDoPapel();
    if (previa) previa.append(Object.assign(document.createElement('video'), { src: url, muted: true, loop: true, autoplay: !pausarPorMovimento(), playsInline: true }));
  }
  html.style.setProperty('--papel-veu', `${Number.isFinite(veu) ? veu : VEU_PADRAO}%`);
  aplicarTransparenciaDoPapel();
}
// Liquid Glass: o papel de parede pode ficar translúcido e deixar o desktop aparecer (0 a 90%).
function aplicarTransparenciaDoPapel() {
  const transparencia = Math.min(90, Math.max(0, Number(lerPreferencia('papelTransparencia') ?? 0) || 0));
  document.documentElement.style.setProperty('--papel-opacidade', String((100 - transparencia) / 100));
}
// Até 3840 px no lado maior (4K); maior que isso é reduzido, sem distorcer. JPEG de boa qualidade.
async function reduzirImagem(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO_DO_PAPEL / Math.max(bitmap.width, bitmap.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(bitmap.width * escala); tela.height = Math.round(bitmap.height * escala);
  tela.getContext('2d').drawImage(bitmap, 0, 0, tela.width, tela.height);
  bitmap.close?.();
  return new Promise((ok, erro) => tela.toBlob(b => (b ? ok(b) : erro(new Error(t('Imagem vazia.')))), 'image/jpeg', 0.9));
}
// Largura da árvore de Pastas: arrastar a linha entre a árvore e a nota; fica no navegador.
// O mínimo cabe a casinha, as três ações e a seta de recolher.
const LARGURA_ARVORE = { min: 200, max: 480, padrao: 272 };
// Sem valor salvo (null) vale o padrão; arrastar até a borda (0) para no mínimo.
const larguraValida = n => { const v = n === null || n === undefined || n === '' ? NaN : Number(n); return Math.round(Number.isFinite(v) ? Math.min(LARGURA_ARVORE.max, Math.max(LARGURA_ARVORE.min, v)) : LARGURA_ARVORE.padrao); };
let larguraArvore = larguraValida(lerPreferencia('larguraArvore'));
function aplicarLarguraArvore(largura, gravar = false) {
  larguraArvore = larguraValida(largura);
  // Na raiz: a barra de status fica fora do .app-shell e também usa a largura.
  document.documentElement.style.setProperty('--largura-arvore', `${larguraArvore}px`);
  document.querySelector('.cofre-divisor')?.setAttribute('aria-valuenow', larguraArvore);
  if (gravar) try { localStorage.setItem('kiro.larguraArvore', String(larguraArvore)); } catch { /* janela privada: vale só nesta sessão */ }
}
function ligarDivisorDaArvore() {
  const divisor = document.querySelector('.cofre-divisor'), arvore = document.querySelector('.cofre-lateral');
  if (!divisor || !arvore) return;
  divisor.addEventListener('pointerdown', e => {
    if (e.button !== 0 || lateralRecolhida) return;
    e.preventDefault();
    divisor.setPointerCapture(e.pointerId);
    document.body.classList.add('arrastando-divisor');
    const esquerda = arvore.getBoundingClientRect().left;
    const mover = ev => aplicarLarguraArvore(ev.clientX - esquerda);
    const soltar = () => {
      divisor.removeEventListener('pointermove', mover);
      document.body.classList.remove('arrastando-divisor');
      aplicarLarguraArvore(larguraArvore, true);
    };
    divisor.addEventListener('pointermove', mover);
    divisor.addEventListener('pointerup', soltar, { once: true });
    divisor.addEventListener('pointercancel', soltar, { once: true });
  });
  divisor.addEventListener('dblclick', () => aplicarLarguraArvore(LARGURA_ARVORE.padrao, true));
  divisor.addEventListener('keydown', e => {
    const passo = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (e.key === 'Home') { e.preventDefault(); return aplicarLarguraArvore(LARGURA_ARVORE.padrao, true); }
    if (!passo) return;
    e.preventDefault();
    aplicarLarguraArvore(larguraArvore + passo, true);
  });
  // O clique na faixa recolhida reabre a árvore; o divisor não deve disparar isso.
  divisor.addEventListener('click', e => e.stopPropagation());
}
// Painel da direita (links, sumário e etiquetas), só na tela de Pastas: aberto/aba/largura ficam
// no navegador (localStorage), nunca no cofre — mesmo modelo da largura da árvore, espelhado
// (a divisória fica na borda esquerda do painel, que mora à direita das colunas).
const PAINEL_DIREITO_ABAS = ['volta', 'saida', 'sumario', 'etiquetas'];
const PAINEL_DIREITO_LARGURA = { min: 220, max: 520, padrao: 300 };
const larguraPainelValida = n => { const v = n === null || n === undefined || n === '' ? NaN : Number(n); return Math.round(Number.isFinite(v) ? Math.min(PAINEL_DIREITO_LARGURA.max, Math.max(PAINEL_DIREITO_LARGURA.min, v)) : PAINEL_DIREITO_LARGURA.padrao); };
function painelDireitoValido(salvo) {
  const s = salvo && typeof salvo === 'object' && !Array.isArray(salvo) ? salvo : {};
  return { aberto: s.aberto === true, aba: PAINEL_DIREITO_ABAS.includes(s.aba) ? s.aba : 'volta', largura: larguraPainelValida(s.largura) };
}
let painelDireito = painelDireitoValido((() => { try { return JSON.parse(lerPreferencia('painelDireito') || 'null'); } catch { return null; } })());
// Texto do filtro da aba "Links de volta": só em memória (não precisa persistir entre sessões),
// mas sobrevive a um render() (ex.: depois de Vincular), que senão o limparia.
let painelFiltro = '';
function gravarPainelDireito() { try { localStorage.setItem('kiro.painelDireito', JSON.stringify(painelDireito)); } catch { /* janela privada: vale só nesta sessão */ } }
function aplicarLarguraPainelDireito(largura, gravar = false) {
  painelDireito.largura = larguraPainelValida(largura);
  const el = document.querySelector('.painel-direito');
  if (el) el.style.width = `${painelDireito.largura}px`;
  document.querySelector('.painel-direito-divisor')?.setAttribute('aria-valuenow', painelDireito.largura);
  if (gravar) gravarPainelDireito();
}
function ligarDivisorDoPainelDireito() {
  const divisor = document.querySelector('.painel-direito-divisor'), painel = document.querySelector('.painel-direito');
  if (!divisor || !painel) return;
  divisor.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    divisor.setPointerCapture(e.pointerId);
    document.body.classList.add('arrastando-divisor');
    const direita = painel.getBoundingClientRect().right;
    const mover = ev => aplicarLarguraPainelDireito(direita - ev.clientX);
    const soltar = () => {
      divisor.removeEventListener('pointermove', mover);
      document.body.classList.remove('arrastando-divisor');
      aplicarLarguraPainelDireito(painelDireito.largura, true);
    };
    divisor.addEventListener('pointermove', mover);
    divisor.addEventListener('pointerup', soltar, { once: true });
    divisor.addEventListener('pointercancel', soltar, { once: true });
  });
  divisor.addEventListener('dblclick', () => aplicarLarguraPainelDireito(PAINEL_DIREITO_LARGURA.padrao, true));
  divisor.addEventListener('keydown', e => {
    const passo = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    if (e.key === 'Home') { e.preventDefault(); return aplicarLarguraPainelDireito(PAINEL_DIREITO_LARGURA.padrao, true); }
    if (!passo) return;
    e.preventDefault();
    aplicarLarguraPainelDireito(painelDireito.largura + passo, true);
  });
  divisor.addEventListener('click', e => e.stopPropagation());
}
// Só age na tela de Pastas: o atalho (global) não deve mexer no painel quando aberto em outra tela.
function alternarPainelDireito() {
  if (currentView !== 'studies') return;
  painelDireito.aberto = !painelDireito.aberto;
  gravarPainelDireito();
  render();
}
// Atalhos que dá para trocar em Configurações → Atalhos (o padrão e a validação ficam no domain.js).
let atalhos = Kiro.atalhosValidos((() => { try { return JSON.parse(lerPreferencia('atalhos') || 'null'); } catch { return null; } })());
const teclaDe = id => Kiro.rotuloDaCombinacao(atalhos[id], t);
let gravandoAtalho = false;   // enquanto Configurações escuta a combinação nova, os atalhos não disparam
// Barra lateral principal compacta: só os ícones. O nome de cada item continua no
// .rotulo (escondido só visualmente, para leitor de tela) e vira dica ao passar o mouse.
let lateralCompacta = lerPreferencia('lateralCompacta') === '1';
function aplicarLateralCompacta() {
  document.querySelector('.app-shell').classList.toggle('lateral-compacta', lateralCompacta);
  const acao = lateralCompacta ? t('Expandir barra lateral') : t('Recolher barra lateral');
  const botao = document.querySelector('#alternar-lateral');
  botao.setAttribute('aria-label', acao);
  botao.setAttribute('aria-expanded', String(!lateralCompacta));
  botao.title = acao;
  for (const item of document.querySelectorAll('.sidebar :is(.new-note, .quiet-button, .nav-item, .busca-rapida, .nota-diaria)')) {
    const rotulo = item.querySelector('.rotulo')?.textContent.trim();
    if (!rotulo) continue;
    item.dataset.dica ??= item.getAttribute('title') || '';   // a dica original, se houver
    const original = item.dataset.dica ? t(item.dataset.dica) : '';
    if (lateralCompacta) item.title = original ? `${rotulo} (${original})` : rotulo;
    else if (original) item.title = original;
    else item.removeAttribute('title');
  }
}
function alternarLateralCompacta() {
  lateralCompacta = !lateralCompacta;
  try { localStorage.setItem('kiro.lateralCompacta', lateralCompacta ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
  aplicarLateralCompacta();
}
function botaoLateral() {
  const acao = lateralRecolhida ? t('Mostrar barra lateral') : t('Esconder barra lateral');
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
// Título mostrado na aba: da nota salva, ou "Nova nota" para o rascunho ainda sem título.
function tituloDaAba(id) {
  if (id === KiroAbas.RASCUNHO) return t('Nova nota');
  const nota = getNote(id);
  if (nota) return nota.title || t('Sem título');
  return getFluxo(id)?.title || t('Sem título');
}
function barraDeAbas(painel) {
  const p = abas.paineis[painel];
  if (!p) return '';
  // Wrapper <div> (não interativo) com dois botões irmãos: nada de botão dentro de botão
  // (não focável, não anunciado por leitor de tela). role=group em vez de tablist/tab pela
  // metade: não há aria-controls/tabpanel nem navegação por setas, então não é o padrão ARIA
  // tabs completo — só um grupo rotulado.
  const itens = p.abas.map(id => { const titulo = escapeHtml(tituloDaAba(id)); return `<div class="aba${p.ativa === id ? ' ativa' : ''}" data-painel="${painel}" data-aba="${escapeHtml(id)}" draggable="true"><button type="button" class="aba-abrir" aria-current="${p.ativa === id}"><span class="aba-titulo">${titulo}</span></button><button type="button" class="aba-fechar" data-fechar-aba aria-label="${t('Fechar aba {titulo}', { titulo })}">×</button></div>`; }).join('');
  // O botão do painel da direita só aparece na última coluna, depois do menu ⌄ dela.
  const botaoPainel = painel === abas.paineis.length - 1
    ? `<button type="button" class="icon-button painel-direito-alternar" data-painel-direito aria-pressed="${painelDireito.aberto}" title="${t('Painel da direita ({tecla})', { tecla: escapeHtml(teclaDe('painelDireito')) })}" aria-label="${t('Painel da direita')}">${icone('painel-direito')}</button>`
    : '';
  const navHist = `<button type="button" class="icon-button aba-nav" data-hist-voltar="${painel}" title="${t('Voltar')}" aria-label="${t('Voltar')}"${KiroAbas.podeVoltar(abas, painel) ? '' : ' disabled'}>${icone('esquerda')}</button><button type="button" class="icon-button aba-nav" data-hist-avancar="${painel}" title="${t('Avançar')}" aria-label="${t('Avançar')}"${KiroAbas.podeAvancar(abas, painel) ? '' : ' disabled'}>${icone('direita')}</button>`;
  const vincBadge = KiroAbas.colunasVinculadas(abas, painel).length ? `<span class="aba-vinculo-badge" title="${t('Coluna vinculada')}">${icone('link')}</span>` : '';
  return `<div class="abas-barra" data-painel="${painel}" role="group" aria-label="${t('Abas')}">${navHist}${vincBadge}${itens}<button type="button" class="icon-button aba-nova" data-nova-aba="${painel}" aria-label="${t('Nova aba')}">${icone('mais')}</button><button type="button" class="icon-button abas-menu" data-menu-abas="${painel}" aria-label="${t('Opções das abas desta coluna')}" aria-haspopup="menu" title="${t('Opções das abas')}">${icone('abaixo')}</button>${botaoPainel}</div>`;
}
// Vazio de uma metade sem aba nenhuma: mesmo convite de sempre, com o + já sabendo em qual metade abrir.
function cofreVazioMarkup(painel) {
  return `<div class="cofre-vazio">
    <p>${t('Escolha uma nota na árvore ao lado.')}</p>
    <button class="secondary" data-cofre-nova="${painel}">${icone('mais')} ${t('Nova nota')}</button>
  </div>`;
}
// Metade em leitura: a versão salva da nota (getNote), nunca o que está em `editing`.
function renderLeitura(id, painel) {
  const nota = id === KiroAbas.RASCUNHO ? notaVazia() : getNote(id);
  if (!nota) return cofreVazioMarkup(painel);
  return `<article class="doc-leitura" data-painel="${painel}"><h1 class="doc-leitura-titulo">${escapeHtml(nota.title || t('Sem título'))}</h1>${renderizarMarkdown(nota.body)}</article>`;
}
// O que vai dentro do corpo de uma metade: a metade ativa mostra o editor (ou o vazio); a outra, leitura.
function conteudoMetade(painel) {
  const doFluxo = abas.paineis[painel]?.ativa;
  if (doFluxo && getFluxo(doFluxo)) return fluxoHostMarkup(getFluxo(doFluxo), painel);
  if (abas.ativo === painel) return editing ? renderEditor() : cofreVazioMarkup(painel);
  const ativa = abas.paineis[painel]?.ativa;
  return ativa ? renderLeitura(ativa, painel) : cofreVazioMarkup(painel);
}
function metadeMarkup(painel) {
  const comFluxo = getFluxo(abas.paineis[painel]?.ativa) ? ' com-fluxo' : '';
  return `<section class="cofre-metade${abas.ativo === painel ? ' ativa' : ''}" data-painel="${painel}" style="flex-grow:${abas.larguras[painel]}">${barraDeAbas(painel)}<div class="cofre-nota-corpo${comFluxo}">${conteudoMetade(painel)}</div></section>`;
}
// Coluna com um fluxo: o editor é montado depois do innerHTML (bindView → montarFluxos).
function fluxoHostMarkup(fluxo, painel) {
  if (fluxo.erro) return `<div class="fluxo-erro"><h2>${escapeHtml(fluxo.title)}</h2><p>${t('Este fluxo não pôde ser lido e não será alterado pelo Kiro.')}</p><p><code>${escapeHtml(fluxo.erro)}</code></p></div>`;
  return `<div class="fluxo-host" data-fluxo="${escapeHtml(fluxo.id)}" data-painel="${painel}"></div>`;
}
// Cartão de arquivo aponta para a nota pelo caminho no cofre (sem diferenciar maiúsculas).
const notaPorArquivo = arquivo => state.notes.find(n => n.file && Kiro.pathKey(n.file) === Kiro.pathKey(arquivo || ''));
// "Na outra metade": uma coluna que já existe ao lado do fluxo, ou uma nova à direita dele.
function abrirNotaDoFluxo(arquivo, painel) {
  const nota = notaPorArquivo(arquivo);
  if (!nota) return status(t('Nota não encontrada no cofre.'), true);
  const outra = painel + 1 < abas.paineis.length ? painel + 1 : painel - 1;
  if (outra >= 0 && outra !== painel) return abrirNota(nota, { painel: outra, novaAba: true, duplicar: true });
  if (!cabeOutraColuna()) return abrirNota(nota, { painel, novaAba: true, duplicar: true });
  return abrirNota(nota, { colunaNova: true, painel: painel + 1, duplicar: true });
}
function abrirLinkDoFluxo(url) {
  const seguro = Kiro.safeUrl(url);
  if (!seguro) return status(t('Esse link não é http nem https.'), true);
  window.open(seguro, '_blank', 'noopener,noreferrer');
}
function montarFluxos() {
  window.KiroEditor?.carregar().catch(() => {});   // o cartão abre com o editor novo já na primeira edição
  for (const host of document.querySelectorAll('.fluxo-host')) {
    const fluxo = getFluxo(host.dataset.fluxo);
    if (!fluxo?.canvas) continue;
    KiroFluxoTela.montar(host, {
      id: fluxo.id, titulo: fluxo.title, canvas: fluxo.canvas,
      atalho: id => atalhos[id],
      markdown: renderizarMarkdown, icone,
      montarEditor: montarEditorDoCartao,
      menu: (evento, itens) => abrirMenuContexto(evento, document.body, itens),
      chaveDaVista: 'kiro.fluxoVista:' + (state.vaultPath || ''),
      aoMudar: canvas => mudarFluxo(fluxo.id, canvas),
      urlDoArquivo: urlDoAnexo,
      nota: arquivo => { const n = notaPorArquivo(arquivo); return n ? { titulo: n.title || t('Sem título'), html: renderizarMarkdown(n.body.slice(0, 2000)) } : null; },
      abrirNota: arquivo => abrirNotaDoFluxo(arquivo, Number(host.dataset.painel)),
      abrirLink: abrirLinkDoFluxo,
      escolherNota: () => irParaNota({ escolher: true }),
      escolherImagem: escolherImagemDoSistema,
      pedirLink: pedirLinkDoFluxo,
      previaDeLink: url => (window.cadernoDesktop ? window.cadernoDesktop.previaDeLink(url) : api('previa', { url })),
      canvasAtual: () => getFluxo(fluxo.id)?.canvas,
      // Um salvamento em andamento troca `state`: adicionarNo espera acabar para não perder o
      // cartão que um paste/seletor assíncrono estava prestes a gravar (F1).
      salvando: () => busy,
      aviso: (texto, erro) => status(texto, erro),
      arquivosDoEvento: arquivosDoFluxo,
      lerTexto: lerTextoDoAnexo,
      abrirArquivo: abrirArquivoDoFluxo,
      abrirVideo: abrirVideoDoFluxo,
      arquivoDaNota: id => getNote(id)?.file || null,
      guardarImagem: guardarImagemDoFluxo,
      abrirPdfNoSistema: window.cadernoDesktop ? arquivo => window.cadernoDesktop.openAttachment(arquivo).catch(() => { /* sem leitor padrão: fica quieto */ }) : null,
      transformarEmNota: (idNo, texto) => transformarCartaoEmNota(fluxo.id, idNo, texto),
      // Instância morta (o modal ficou aberto tempo bastante para o salvamento automático redesenhar
      // a tela): render() remonta todo fluxo a partir do estado, e a instância viva nasce já com o
      // cartão que acabou de entrar.
      redesenhar: () => { if (currentView === 'studies') render(); },
    });
  }
}
// Colunas lado a lado; entre duas vizinhas, uma divisória que ajusta a largura das duas.
const LARGURA_MIN_COLUNA = 260;
function colunasMarkup() {
  return `<div class="cofre-metades">${abas.paineis.map((_, i) => (i ? `<div class="metades-divisor" data-divisor="${i - 1}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${t('Largura das colunas {a} e {b}', { a: i, b: i + 1 })}" title="${t('Arraste para ajustar · dois cliques deixam as colunas iguais')}"></div>` : '') + metadeMarkup(i)).join('')}</div>`;
}
// Cabe mais uma coluna com a largura mínima na área de notas?
function cabeOutraColuna() {
  const area = document.querySelector('.cofre-metades');
  return !area || area.getBoundingClientRect().width / (abas.paineis.length + 1) >= LARGURA_MIN_COLUNA;
}
// ---- Painel da direita: links de volta, links de saída, sumário e etiquetas de `editing` ----
function painelItemMarkup(nota, trecho, vincular) {
  return `<div class="painel-item" data-painel-titulo="${escapeHtml(nota.title || '')}">
    <button type="button" class="painel-item-titulo" data-abrir-nota="${nota.id}">${escapeHtml(nota.title || t('Sem título'))}</button>
    <span class="small-muted">${escapeHtml(trecho.slice(0, 160))}</span>
    ${vincular ? `<button type="button" class="secondary cfg-pequeno" data-vincular="${nota.id}">${t('Vincular')}</button>` : ''}
  </div>`;
}
function painelVoltaMarkup() {
  // Rascunho sem id (nota nova ainda não salva): ninguém no cofre pode apontar pra ela de
  // verdade, então nada de menções — mesmo critério de renderMencoes ("!nota.id" → vazio).
  if (!editing.id) return `<p class="small-muted painel-direito-vazio">${t('Salve a nota para ver as menções.')}</p>`;
  const resolveParaEditing = l => Kiro.findLinkedNote(state.notes, l.target)?.id === editing.id;
  const vinculadas = Kiro.mentions(state.notes, editing);
  const naoVinculadas = Kiro.mencoesNaoVinculadas(state.notes, editing);
  const vinculadasHtml = vinculadas.map(n => {
    const linha = n.body.split('\n').find(l => Kiro.wikiLinks(l).some(resolveParaEditing)) || '';
    return painelItemMarkup(n, textoPlano(linha), false);
  }).join('') || `<p class="small-muted">${t('Nenhuma.')}</p>`;
  const naoVinculadasHtml = naoVinculadas.map(({ nota, trecho }) => painelItemMarkup(nota, textoPlano(trecho), true)).join('') || `<p class="small-muted">${t('Nenhuma.')}</p>`;
  const fluxos = Kiro.fluxosQueCitam(state, editing);
  const fluxosHtml = fluxos.map(f => `<div class="painel-item" data-painel-titulo="${escapeHtml(f.title)}"><button type="button" class="painel-fluxo" data-abrir-nota="${escapeHtml(f.id)}">${icone('fluxo')} ${escapeHtml(f.title)}</button></div>`).join('') || `<p class="small-muted">${t('Nenhum.')}</p>`;
  return `<input type="search" class="painel-filtro" placeholder="${t('Filtrar')}" aria-label="${t('Filtrar links de volta')}" value="${escapeHtml(painelFiltro)}" />
  <section class="painel-secao"><h3>${t('Menções vinculadas ({n})', { n: vinculadas.length })}</h3>${vinculadasHtml}</section>
  <section class="painel-secao"><h3>${t('Menções não vinculadas ({n})', { n: naoVinculadas.length })}</h3>${naoVinculadasHtml}</section>
  <section class="painel-secao"><h3>${t('Aparece nos fluxos ({n})', { n: fluxos.length })}</h3>${fluxosHtml}</section>`;
}
function painelSaidaMarkup() {
  const vistos = new Set();
  // Dedup pela nota resolvida (id), não pelo texto do alvo: [[Fotossíntese]] e
  // [[Fotossintese]] resolvem pra mesma nota mas têm pathKey diferente (acento).
  const links = Kiro.wikiLinks(editing.body)
    .map(l => ({ ...l, nota: Kiro.findLinkedNote(state.notes, l.target) }))
    .filter(l => { const chave = l.nota ? l.nota.id : Kiro.pathKey(l.target); if (vistos.has(chave)) return false; vistos.add(chave); return true; });
  if (!links.length) return `<p class="small-muted">${t('Esta nota não tem links de saída.')}</p>`;
  return `<ul class="painel-lista">${links.map(l =>
    `<li><button type="button" class="painel-link${l.nota ? '' : ' ausente'}" data-link-saida-id="${l.nota ? escapeHtml(l.nota.id) : ''}" data-link-saida-alvo="${escapeHtml(l.target)}">${escapeHtml(l.label)}${l.nota ? '' : ` <span class="small-muted">${t('não existe ainda')}</span>`}</button></li>`
  ).join('')}</ul>`;
}
function painelSumarioMarkup() {
  const itens = Kiro.sumario(editing.body);
  if (!itens.length) return `<p class="small-muted">${t('Nenhum título nesta nota.')}</p>`;
  // data-sumario-pos é o mesmo offset que renderizarMarkdown grava em data-pos: rolarParaTitulo
  // ancora na fonte, não numa contagem de <h*> que pode discordar do que foi de fato desenhado.
  return `<ul class="painel-sumario">${itens.map(it => `<li style="--nivel:${it.nivel}"><button type="button" class="painel-sumario-item" data-sumario-pos="${it.pos}">${escapeHtml(it.texto)}</button></li>`).join('')}</ul>`;
}
function etiquetaItemMarkup(no) {
  const total = `<span class="painel-etiqueta-total">${no.total}</span>`;
  if (!no.filhos.length) return `<li class="painel-etiqueta-item"><button type="button" class="painel-etiqueta" data-etiqueta="${escapeHtml(no.caminho)}">${escapeHtml(no.nome)}</button>${total}</li>`;
  // O <summary> inteiro é o alvo do clique (abre a busca pela etiqueta); nada de <button> dentro
  // dele, senão vira uma segunda parada de teclado na mesma linha. Expandir/recolher continua
  // sendo o comportamento nativo do <summary> (marcador/clique), sem preventDefault brigando.
  return `<li><details open><summary class="painel-etiqueta" data-etiqueta="${escapeHtml(no.caminho)}">${escapeHtml(no.nome)}${total}</summary><ul class="painel-etiquetas-lista">${no.filhos.map(etiquetaItemMarkup).join('')}</ul></details></li>`;
}
function painelEtiquetasMarkup() {
  const arvore = Kiro.arvoreDeEtiquetas(state.notes);
  if (!arvore.length) return `<p class="small-muted">${t('Nenhuma etiqueta ainda.')}</p>`;
  return `<ul class="painel-etiquetas-lista painel-etiquetas-raiz">${arvore.map(etiquetaItemMarkup).join('')}</ul>`;
}
function painelDireitoConteudo() {
  if (!editing) return `<p class="small-muted painel-direito-vazio">${t('Abra uma nota para ver os links, o sumário e as etiquetas dela.')}</p>`;
  if (painelDireito.aba === 'saida') return painelSaidaMarkup();
  if (painelDireito.aba === 'sumario') return painelSumarioMarkup();
  if (painelDireito.aba === 'etiquetas') return painelEtiquetasMarkup();
  return painelVoltaMarkup();
}
function painelDireitoMarkup() {
  if (!painelDireito.aberto) return '';
  const abasDoPainel = [['volta', 'link-volta', t('Links de volta')], ['saida', 'link-saida', t('Links de saída')], ['sumario', 'sumario', t('Sumário')], ['etiquetas', 'etiqueta', t('Etiquetas')]];
  const botoes = abasDoPainel.map(([id, ic, rotulo]) => `<button type="button" class="icon-button" data-painel-aba="${id}" aria-pressed="${painelDireito.aba === id}" title="${rotulo}" aria-label="${rotulo}">${icone(ic)}</button>`).join('');
  return `<aside class="painel-direito" style="width:${painelDireito.largura}px" aria-label="${t('Painel da direita')}">
    <div class="painel-direito-divisor" role="separator" aria-orientation="vertical" aria-label="${t('Largura do painel da direita')}" tabindex="0" aria-valuemin="${PAINEL_DIREITO_LARGURA.min}" aria-valuemax="${PAINEL_DIREITO_LARGURA.max}" aria-valuenow="${painelDireito.largura}" title="${t('Arraste para ajustar a largura · dois cliques voltam ao padrão')}"></div>
    <div class="painel-direito-topo" role="group" aria-label="${t('Abas do painel')}">${botoes}</div>
    <div class="painel-direito-corpo">${painelDireitoConteudo()}</div>
  </aside>`;
}
// Liga o botão ◨, a troca de aba, a divisória, o filtro e os cliques do conteúdo do painel.
function bindPainelDireito() {
  document.querySelectorAll('[data-painel-direito]').forEach(b => b.addEventListener('click', () => alternarPainelDireito()));
  const painel = document.querySelector('.painel-direito');
  if (!painel) return;
  ligarDivisorDoPainelDireito();
  painel.querySelectorAll('[data-painel-aba]').forEach(b => b.addEventListener('click', () => { painelDireito.aba = b.dataset.painelAba; gravarPainelDireito(); render(); }));
  // O filtro fica em `painelFiltro` (fora do DOM) pra sobreviver a um render() no meio (ex.:
  // clicar Vincular chama save() → render()); reaplica no que acabou de ser desenhado.
  const filtro = painel.querySelector('.painel-filtro');
  const aplicarFiltro = () => {
    const q = Kiro.normalize(painelFiltro);
    painel.querySelectorAll('.painel-item').forEach(it => { it.hidden = Boolean(q) && !Kiro.normalize(it.dataset.painelTitulo || '').includes(q); });
  };
  if (filtro) { aplicarFiltro(); filtro.addEventListener('input', e => { painelFiltro = e.target.value; aplicarFiltro(); }); }
  painel.querySelector('.painel-direito-corpo')?.addEventListener('click', async e => {
    const abrir = e.target.closest('[data-abrir-nota]');
    if (abrir) return void abrirPorId(abrir.dataset.abrirNota);
    const vincular = e.target.closest('[data-vincular]');
    if (vincular) return void await vincularMencaoNaOutraNota(vincular.dataset.vincular);
    const doSumario = e.target.closest('[data-sumario-pos]');
    if (doSumario) return void rolarParaTitulo(Number(doSumario.dataset.sumarioPos));
    const link = e.target.closest('[data-link-saida-id], [data-link-saida-alvo]');
    if (link) { const id = link.dataset.linkSaidaId; return void (id ? abrirPorId(id) : abrirNota(notaVazia({ title: link.dataset.linkSaidaAlvo }))); }
    const etiqueta = e.target.closest('[data-etiqueta]');
    if (etiqueta) buscarEtiqueta('#' + etiqueta.dataset.etiqueta);
  });
}
// Troca a 1ª ocorrência solta do título da nota em edição por [[link]] na outra nota, e salva.
async function vincularMencaoNaOutraNota(id) {
  if (!editing) return;
  if (!Kiro.podeVincular(editing, editorDirty)) return void status(t('Salve a nota antes de vincular.'), true);
  if (busy || failed || !loaded) return void status(t('O cofre está ocupado.'), true);
  const outra = getNote(id);
  if (!outra) return;
  const corpoAntigo = outra.body, atualizadoAntigo = outra.updatedAt;
  const corpoNovo = Kiro.vincularMencao(corpoAntigo, editing.title);
  if (corpoNovo === corpoAntigo) return void status(t('Nada para vincular.'), true);
  state.notes = state.notes.map(n => n.id === id ? { ...n, body: corpoNovo, updatedAt: Date.now() } : n);
  if (await save()) return void status(t('Menção vinculada.'));
  // save() falhou (cofre ocupado/erro/não carregado): desfaz em memória pra não divergir do disco.
  state.notes = state.notes.map(n => n.id === id ? { ...n, body: corpoAntigo, updatedAt: atualizadoAntigo } : n);
}
// Rola a nota em edição até o título cujo início na fonte é `pos` — a mesma âncora
// (data-pos) que renderizarMarkdown grava. Sem elemento (ex.: editor não montado, modo
// simples), não faz nada: nunca rola para o título errado.
function rolarParaTitulo(pos) {
  // pos conta \r\n como 2 caracteres; no editor cada quebra de linha conta 1.
  if (editorDaNota && $('#doc-corpo')?.contains(editorDaNota.editor.dom)) return editorDaNota.editor.rolarPara(editing.body.slice(0, pos).replace(/\r\n/g, '\n').length);
  const bloco = document.querySelector(`#doc-corpo [data-pos="${pos}"]`) || [...document.querySelectorAll('#doc-corpo [data-pos]')].find(el => Number(el.dataset.pos) <= pos && pos <= Number(el.dataset.fim ?? el.dataset.pos));
  if (bloco) { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); bloco.classList.remove('linha-destaque-flash'); void bloco.offsetWidth; bloco.classList.add('linha-destaque-flash'); setTimeout(() => bloco.classList.remove('linha-destaque-flash'), 1200); }
}
function renderCofre() {
  if (expanded === null) expanded = new Set();   // pastas começam fechadas; quem usa abre as que quer
  garantirAbasDoCofre();
  abas = KiroAbas.limpar(abas, [...state.notes.map(n => n.id), ...(state.fluxos || []).map(f => f.id)]);
  // Sem editor aberto (voltando de outra tela ou de uma recarga), ou a nota em edição ficou
  // desatualizada em relação à aba ativa (ex.: uma recarga em segundo plano apagou a nota que
  // estava aberta): reabre a nota da aba ativa. Nunca troca `editing` enquanto houver algo não salvo.
  if (!editing) {
    const ativa = KiroAbas.notaAtiva(abas);
    if (ativa === KiroAbas.RASCUNHO) abas = KiroAbas.fechar(abas, abas.ativo, KiroAbas.RASCUNHO);
    else if (ativa) { const nota = getNote(ativa); if (nota) editing = { ...nota, tags: [...(nota.tags || [])], links: [...(nota.links || [])] }; }
  } else if (!editorDirty && idDaAba(editing) !== KiroAbas.notaAtiva(abas)) {
    const ativa = KiroAbas.notaAtiva(abas);
    const nota = ativa && ativa !== KiroAbas.RASCUNHO ? getNote(ativa) : null;
    editing = nota ? { ...nota, tags: [...(nota.tags || [])], links: [...(nota.links || [])] } : null;
  }
  gravarAbas();
  const arvore = treeMarkup('', 0) || `<div class="empty">${t('Crie uma pasta para começar.')}</div>`;
  const notas = colunasMarkup();
  const painel = painelDireitoMarkup();
  return `<div class="cofre">
  <aside class="cofre-lateral">
    <header class="cofre-topo">
      <button class="icon-button" data-cofre="casa" title="${t('Voltar ao início')}" aria-label="${t('Voltar ao início')}">${icone('casa')}</button>
      <span class="cofre-nome">${t('Cofre')}</span>
      <span class="cofre-acoes">
        <button class="icon-button" id="add-fluxo" title="${t('Novo fluxo')}">${icone('fluxo')}</button>
        <button class="icon-button" id="add-folder" title="${t('Nova pasta')}">${icone('pasta-nova')}</button>
        <button class="icon-button" id="expand-all" title="${t('Expandir tudo')}">${icone('expandir')}</button>
        <button class="icon-button" id="collapse-all" title="${t('Recolher tudo')}">${icone('recolher')}</button>
      </span>
      ${botaoLateral()}
    </header>
    <nav class="cofre-telas" aria-label="${t('Telas')}">${[['today', 'hoje', t('Hoje'), 1], ['notes', 'notas', t('Notas'), 2], ['tasks', 'tarefas', t('Tarefas'), 3], ['graph', 'grafo', t('Grafo'), 5]].map(([tela, ic, nome, n]) => `<button type="button" class="icon-button" data-cofre-tela="${tela}" title="${nome} (Ctrl+${n})" aria-label="${nome}">${icone(ic)}</button>`).join('')}</nav>
    <div class="tree">${renderFavoritosMarkup()}${arvore}</div>
    <div class="cofre-divisor" role="separator" aria-orientation="vertical" aria-label="${t('Largura da árvore de pastas')}" tabindex="0" aria-valuemin="${LARGURA_ARVORE.min}" aria-valuemax="${LARGURA_ARVORE.max}" aria-valuenow="${larguraArvore}" title="${t('Arraste para ajustar a largura · dois cliques voltam ao padrão')}"></div>
    <footer class="cofre-rodape">${rodapeDaArvore()}</footer>
  </aside>
  ${notas}
  ${painel}
</div>`;
}
// Itens do menu de contexto de uma aba: nova coluna à direita, mover para a coluna vizinha, fechar.
function itensDaAba(painel, id) {
  const n = abas.paineis.length;
  const vinculadas = KiroAbas.colunasVinculadas(abas, painel);
  const vizinha = painel + 1 < n ? painel + 1 : painel - 1;
  return [
    { rotulo: t('Abrir em nova coluna à direita'), icone: icone('direita'), acao: () => moverAba(painel, id, painel + 1, { nova: true }) },
    ...(painel > 0 ? [{ rotulo: t('Mover para a coluna da esquerda'), icone: icone('esquerda'), acao: () => moverAba(painel, id, painel - 1) }] : []),
    ...(painel < n - 1 ? [{ rotulo: t('Mover para a coluna da direita'), icone: icone('direita'), acao: () => moverAba(painel, id, painel + 1) }] : []),
    ...(n > 1 ? [vinculadas.length
      ? { rotulo: t('Desvincular coluna'), icone: icone('link'), acao: () => { abas = KiroAbas.desvincularColuna(abas, painel); gravarAbas(); render(); } }
      : { rotulo: t('Vincular com a coluna ao lado'), icone: icone('link'), acao: () => { abas = KiroAbas.vincularColunas(abas, painel, vizinha); gravarAbas(); render(); } }] : []),
    { separador: true },
    { rotulo: t('Fechar'), icone: icone('fechar'), acao: () => fecharAba(painel, id) },
    { rotulo: t('Fechar as outras'), icone: icone('fechar'), acao: () => fecharOutrasAbas(painel, id) },
  ];
}
// Menu ⌄ de uma coluna: nova aba, levar a ativa para uma coluna nova, fechar tudo e a lista
// das abas (a ativa marcada), para trocar de aba mesmo quando os títulos estão cortados.
function itensDoMenuDasAbas(painel) {
  const p = abas.paineis[painel];
  if (!p) return [];
  return [
    { rotulo: t('Nova aba'), icone: icone('mais'), acao: () => abrirNota(notaVazia(), { novaAba: true, painel }) },
    ...(p.ativa ? [{ rotulo: t('Abrir em nova coluna à direita'), icone: icone('direita'), acao: () => moverAba(painel, p.ativa, painel + 1, { nova: true }) }] : []),
    ...(p.abas.length ? [{ rotulo: t('Fechar tudo'), icone: icone('fechar'), acao: () => fecharColuna(painel) }] : []),
    ...(p.abas.length ? [{ separador: true }] : []),
    ...p.abas.map(id => ({ rotulo: tituloDaAba(id), icone: id === p.ativa ? icone('marcado') : '', acao: () => (id === KiroAbas.RASCUNHO ? null : abrirPorId(id, { painel })) })),
  ];
}
// Liga os cliques da barra de abas de uma metade: trocar, fechar (× ou botão do meio), + e arrastar/menu.
function bindAbas(painel) {
  const barra = document.querySelector(`.abas-barra[data-painel="${painel}"]`);
  if (!barra) return;
  barra.addEventListener('click', e => {
    if (e.target.closest('[data-hist-voltar]')) { navegarNoHistoricoDaColuna(painel, -1); return; }
    if (e.target.closest('[data-hist-avancar]')) { navegarNoHistoricoDaColuna(painel, 1); return; }
    if (e.target.closest('[data-nova-aba]')) { abrirNota(notaVazia(), { novaAba: true, painel }); return; }
    const botaoMenu = e.target.closest('[data-menu-abas]');
    if (botaoMenu) {
      if (menuAberto?._origem === botaoMenu) return void fecharMenuContexto();
      const r = botaoMenu.getBoundingClientRect();
      abrirMenuContexto({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 4 }, document.body, itensDoMenuDasAbas(painel), { compacto: true, origem: botaoMenu, direita: r.right });
      return;
    }
    const aba = e.target.closest('.aba');
    if (!aba) return;
    if (e.target.closest('[data-fechar-aba]')) fecharAba(painel, aba.dataset.aba);
    else abrirPorId(aba.dataset.aba, { painel });
  });
  // Botão direito no +: escolher entre nota e fluxo, os dois numa aba nova desta coluna.
  barra.addEventListener('contextmenu', e => {
    if (!e.target.closest('[data-nova-aba]')) return;
    abrirMenuContexto(e, document.body, [
      { rotulo: t('Nova nota'), icone: icone('nota'), acao: () => abrirNota(notaVazia(), { novaAba: true, painel }) },
      { rotulo: t('Novo fluxo'), icone: icone('fluxo'), acao: () => novoFluxo('', { novaAba: true, painel }) },
    ], { compacto: true });
  });
  barra.addEventListener('auxclick', e => {
    if (e.button !== 1) return;
    const aba = e.target.closest('.aba');
    if (aba) { e.preventDefault(); fecharAba(painel, aba.dataset.aba); }
  });
  // Delete ou Ctrl+W com o foco numa aba fecha ela, sem precisar mirar no × com o mouse.
  barra.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && !(e.key === 'w' && (e.ctrlKey || e.metaKey))) return;
    const aba = e.target.closest('.aba');
    if (!aba) return;
    e.preventDefault();
    fecharAba(painel, aba.dataset.aba);
  });
  barra.addEventListener('contextmenu', e => {
    const aba = e.target.closest('.aba');
    if (aba) abrirMenuContexto(e, document.body, itensDaAba(painel, aba.dataset.aba), { compacto: true });
  });
  barra.addEventListener('dragstart', e => {
    const aba = e.target.closest('.aba');
    if (!aba) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-kiro-aba', JSON.stringify({ painel, id: aba.dataset.aba }));
  });
}
// Onde soltar: na barra de abas de uma coluna, entra nela; na folha, as faixas de um quarto
// nas bordas criam uma coluna nova daquele lado e o meio entra na coluna.
function alvoDoArraste(evento) {
  const barra = evento.target.closest('.abas-barra');
  if (barra) return { painel: Number(barra.dataset.painel), nova: false };
  const coluna = evento.target.closest('.cofre-metade');
  if (!coluna) return null;
  const painel = Number(coluna.dataset.painel), r = coluna.getBoundingClientRect(), x = (evento.clientX - r.left) / r.width;
  // Terço, não quarto: com um quarto a faixa que divide é pequena demais para acertar, e soltar
  // logo ao lado dela abre em aba nova sem aviso nenhum de que faltou pouco para dividir.
  if (x > 2 / 3) return { painel: painel + 1, nova: true, lado: 'direita', coluna: painel };
  if (x < 1 / 3) return { painel, nova: true, lado: 'esquerda', coluna: painel };
  return { painel, nova: false };
}
// Arrastar uma aba ou uma nota da árvore sobre as colunas.
const TIPO_ABA = 'text/x-kiro-aba', TIPO_NOTA = 'text/kiro-nota';
const tipoArrastado = e => [TIPO_ABA, TIPO_NOTA].find(t => e.dataTransfer?.types.includes(t)) || null;
function bindDragDeAbas() {
  const area = document.querySelector('.cofre-metades');
  if (!area) return;
  const CLASSES = ['destino-coluna', 'destino-direita', 'destino-esquerda', 'destino-aba'];
  const limpar = () => area.querySelectorAll(CLASSES.map(c => '.' + c).join(',')).forEach(el => el.classList.remove(...CLASSES));
  // Sem espaço para outra coluna, a borda vale como o meio: entra na coluna.
  const alvoPossivel = e => { const a = alvoDoArraste(e); return a?.nova && !cabeOutraColuna() ? { painel: a.coluna, nova: false } : a; };
  area.addEventListener('dragover', e => {
    const tipo = tipoArrastado(e);
    if (!tipo) return;
    const alvo = alvoPossivel(e);
    if (!alvo) return;
    e.preventDefault();
    if (tipo === TIPO_NOTA) e.dataTransfer.dropEffect = 'copy';
    limpar();
    const barra = e.target.closest('.abas-barra');
    if (barra) return void barra.classList.add('destino-aba');
    const coluna = area.querySelector(`.cofre-metade[data-painel="${alvo.nova ? alvo.coluna : alvo.painel}"]`);
    coluna?.classList.add(alvo.nova ? `destino-${alvo.lado}` : 'destino-coluna');
  });
  area.addEventListener('dragleave', e => { if (!area.contains(e.relatedTarget)) limpar(); });
  area.addEventListener('dragend', limpar);
  area.addEventListener('drop', async e => {
    const tipo = tipoArrastado(e);
    if (!tipo) return;
    const alvo = alvoPossivel(e);
    limpar();
    if (!alvo) return;
    e.preventDefault();
    e.stopPropagation();   // a árvore também escuta drop de nota (para mover de pasta)
    if (tipo === TIPO_NOTA) {
      const id = e.dataTransfer.getData(TIPO_NOTA);
      if (id) await abrirNotaArrastada(id, alvo);
      return;
    }
    let dados; try { dados = JSON.parse(e.dataTransfer.getData(TIPO_ABA) || 'null'); } catch { dados = null; }
    if (!dados) return;
    if (!alvo.nova && dados.painel === alvo.painel) return;
    await moverAba(dados.painel, dados.id, alvo.painel, { nova: alvo.nova });
  });
}
// Nota arrastada da árvore: abre no destino pedido — uma coluna existente ou uma coluna nova na
// posição pedida. `duplicar` porque arrastar diz *onde*: a nota abre ali mesmo já estando noutra
// coluna (é o split da mesma nota), ao contrário do clique na árvore, que salta para onde ela está.
async function abrirNotaArrastada(id, alvo) {
  if (!getNote(id)) return;
  if (alvo.nova && !cabeOutraColuna()) return status(t('Não cabe outra coluna nesta largura. Feche uma coluna ou aumente a janela.'), true);
  await abrirPorId(id, alvo.nova
    ? { colunaNova: true, painel: alvo.painel, duplicar: true }
    : { novaAba: true, painel: alvo.painel, duplicar: true });
}
// Clicar na metade em leitura (fora de link, imagem, etiqueta ou bloco de plug-in) ativa a nota nela.
function bindLeitura(painel) {
  const artigo = document.querySelector(`.doc-leitura[data-painel="${painel}"]`);
  if (!artigo) return;
  artigo.addEventListener('click', async evento => {
    const linkDoPlugin = evento.target.closest('.plugin-bloco a');
    if (linkDoPlugin) { evento.preventDefault(); const destino = linkDoPlugin.getAttribute('href') || ''; if (/^https?:\/\//i.test(destino)) window.open(destino, '_blank', 'noopener,noreferrer'); return; }
    const copiar = evento.target.closest('.code-copy');
    if (copiar) return void copiarBloco(copiar);
    const imagem = evento.target.closest('.md-imagem img');
    if (imagem) { evento.preventDefault(); return void abrirImagemInteira(imagem.src, imagem.alt); }
    const etiqueta = evento.target.closest('.md-tag');
    if (etiqueta) return void buscarEtiqueta(etiqueta.textContent);
    const link = evento.target.closest('.wikilink');
    if (link) { evento.preventDefault(); seguirWikilink(link, painel); return; }
    const ativa = abas.paineis[painel]?.ativa;
    if (ativa && await salvarAntesDeTrocar()) abrirPorId(ativa, { painel });
  });
}
// Divisórias entre colunas: cada uma ajusta só as duas vizinhas (arrastar, setas do teclado),
// sempre com pelo menos LARGURA_MIN_COLUNA px em cada; dois cliques deixam todas iguais.
function bindDivisoresDasColunas() {
  const area = document.querySelector('.cofre-metades');
  if (!area) return;
  const colunas = () => [...area.querySelectorAll(':scope > .cofre-metade')];
  const aplicar = (larguras, gravar) => {
    abas = KiroAbas.larguras(abas, larguras);
    colunas().forEach((c, i) => { c.style.flexGrow = abas.larguras[i]; });
    if (gravar) gravarAbas();
  };
  // Nova fração da coluna i (o resto do par vai para i+1), limitada pela largura mínima em px.
  const ajustar = (i, fracaoDaEsquerda, gravar) => {
    const l = [...abas.larguras], par = l[i] + l[i + 1];
    const pxTotal = colunas().reduce((t, c) => t + c.getBoundingClientRect().width, 0);
    const min = Math.min(par / 2, LARGURA_MIN_COLUNA / pxTotal);
    l[i] = Math.max(min, Math.min(par - min, fracaoDaEsquerda));
    l[i + 1] = par - l[i];
    aplicar(l, gravar);
  };
  for (const divisor of area.querySelectorAll('.metades-divisor')) {
    const i = Number(divisor.dataset.divisor);
    divisor.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      divisor.setPointerCapture(e.pointerId);
      document.body.classList.add('arrastando-divisor');
      const cols = colunas(), inicio = cols[i].getBoundingClientRect().left;
      const pxDoPar = cols[i].getBoundingClientRect().width + cols[i + 1].getBoundingClientRect().width;
      const par = abas.larguras[i] + abas.larguras[i + 1];
      const mover = ev => ajustar(i, ((ev.clientX - inicio) / pxDoPar) * par, false);
      const soltar = () => {
        divisor.removeEventListener('pointermove', mover);
        document.body.classList.remove('arrastando-divisor');
        aplicar(abas.larguras, true);
      };
      divisor.addEventListener('pointermove', mover);
      divisor.addEventListener('pointerup', soltar, { once: true });
      divisor.addEventListener('pointercancel', soltar, { once: true });
    });
    divisor.addEventListener('dblclick', () => aplicar(abas.paineis.map(() => 1), true));
    divisor.addEventListener('keydown', e => {
      const passo = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
      if (!passo) return;
      e.preventDefault();
      ajustar(i, abas.larguras[i] + passo, true);
    });
  }
}
function bindView() {
  document.querySelector('#add-note')?.addEventListener('click',()=>abrirNota(notaVazia()));
  document.querySelector('#add-task')?.addEventListener('click',()=>taskModal());
  document.querySelector('#add-folder')?.addEventListener('click',()=>folderModal());
  document.querySelector('#add-fluxo')?.addEventListener('click',()=>novoFluxo(''));
  // Limpar a altura embutida devolve o controle ao CSS (0 ou auto), sem animar em massa.
  const abrirTodas=abrir=>{expanded=abrir?new Set(state.folders.map(f=>f.id)):new Set();document.querySelectorAll('.tree-node').forEach(n=>{n.classList.toggle('open',abrir);const c=n.querySelector(':scope > .tree-children');if(c){clearTimeout(c._t);c.style.height='';}});};
  document.querySelector('#expand-all')?.addEventListener('click',()=>abrirTodas(true));
  document.querySelector('#collapse-all')?.addEventListener('click',()=>abrirTodas(false));
  document.querySelector('#note-search')?.addEventListener('input',e=>{
    const q=Kiro.normalize(e.target.value);
    document.querySelector('#notes-grid').innerHTML=notesMarkup(Kiro.filtrarNotasPorConsulta(state.notes, state.folders, e.target.value),Boolean(e.target.value.trim()));
  });
  if(currentView==="graph"){bindGraph();return;}
  if(currentView==="studies"){
    document.querySelector('[data-cofre="casa"]')?.addEventListener('click',()=>irPara('today'));
    document.querySelector('.cofre-telas')?.addEventListener('click',e=>{const tela=e.target.closest('[data-cofre-tela]')?.dataset.cofreTela;if(tela)irPara(tela);});
    // Delegado: a seta esconde ou mostra; com a barra recolhida, clicar na faixa também reabre.
    document.querySelector('.cofre-lateral')?.addEventListener('click',e=>{
      const remFav=e.target.closest('[data-remover-fav]');
      if(remFav){e.stopPropagation();const [tipo,...r]=remFav.dataset.removerFav.split(':');alternarItemFavorito({tipo,alvo:r.join(':')});return;}
      const linhaFav=e.target.closest('.tree-favorito');
      if(linhaFav){
        const {favTipo,favAlvo}=linhaFav.dataset;
        if(favTipo==='nota'||favTipo==='fluxo')abrirPorId(favAlvo,{novaAba:Boolean(e.ctrlKey||e.metaKey)});
        else if(favTipo==='pasta'){if(expanded)expanded.add(favAlvo);render();document.querySelector(`.tree-node[data-id="${CSS.escape(favAlvo)}"]`)?.scrollIntoView({block:'nearest'});}
        else if(favTipo==='busca')buscarEtiqueta(favAlvo);
        return;
      }
      if(e.target.closest('[data-cofre="alternar"]')||(lateralRecolhida&&!e.target.closest('button')))alternarLateral();
    });
    document.querySelectorAll('[data-cofre-nova]').forEach(b=>b.addEventListener('click',()=>abrirNota(notaVazia(),{painel:Number(b.dataset.cofreNova)})));
    ligarDivisorDaArvore();
    abas.paineis.forEach((_,painel)=>bindAbas(painel));
    bindDragDeAbas();
    bindDivisoresDasColunas();
    abas.paineis.forEach((_,painel)=>{
      if(abas.ativo!==painel)bindLeitura(painel);
      const corpoCol=document.querySelector(`.cofre-metade[data-painel="${painel}"] .cofre-nota-corpo`);
      corpoCol?.addEventListener('scroll',()=>{
        if(corpoCol._sincronizando)return;
        abas=KiroAbas.registrarScroll(abas,painel,corpoCol.scrollTop);
        const ativa=abas.paineis[painel]?.ativa;
        const maxOrigem=corpoCol.scrollHeight-corpoCol.clientHeight;
        const razao=maxOrigem>0?corpoCol.scrollTop/maxOrigem:0;
        for(const outro of KiroAbas.colunasVinculadas(abas,painel)){
          if(abas.paineis[outro]?.ativa!==ativa)continue;
          const outroCorpo=document.querySelector(`.cofre-metade[data-painel="${outro}"] .cofre-nota-corpo`);
          if(!outroCorpo)continue;
          outroCorpo._sincronizando=true;
          outroCorpo.scrollTop=Math.round(razao*Math.max(0,outroCorpo.scrollHeight-outroCorpo.clientHeight));
          requestAnimationFrame(()=>{outroCorpo._sincronizando=false;});
        }
      },{passive:true});
    });
    if(editing)bindEditor();
    bindPainelDireito();
    montarFluxos();
    return;
  }
  enhanceView();
}
function action(type,id,evento) {
  // Abrir/fechar é só visual: continua funcionando durante um salvamento ou após falha.
  if(type==="toggle-folder"){
    if(!expanded)return;
    expanded.has(id)?expanded.delete(id):expanded.add(id);
    toggleFolder(id);
    return;
  }
  if (busy || failed || !loaded) return;
  if(type==="new-subfolder") folderModal({title:"",description:"",parentId:id}); if(type==="toggle-habit") marcarHabito(id); if(type==="toggle-habit-day"){const [habito,dia]=id.split("|");marcarHabito(habito,dia);} if(type==="toggle-task") alternarTarefa(id); if(type==="toggle-note-task") marcarTarefaDaNota(id); if(type==="edit-note") abrirPorId(id,{novaAba:Boolean(evento?.ctrlKey||evento?.metaKey)}); if(type==="abrir-fluxo") abrirPorId(id,{novaAba:Boolean(evento?.ctrlKey||evento?.metaKey)}); if(type==="new-note-folder") abrirNota(notaVazia({folderId:id})); if(type==="edit-task") taskModal(state.tasks.find(x=>x.id===id)); if(type==="edit-folder") folderModal(state.folders.find(x=>x.id===id)); if(type==="delete-task") excluirTarefa(id); if(type==="delete-folder") deleteFolder(id); }
// A tarefa não tem lixeira: em vez de perguntar antes, dá para voltar atrás por alguns segundos.
let timerDoDesfazer=null;
function avisarComDesfazer(mensagem,aoDesfazer){
  clearTimeout(timerDoDesfazer);$('#aviso-desfazer')?.remove();
  const aviso=document.createElement('div');
  aviso.id='aviso-desfazer';aviso.setAttribute('role','status');
  aviso.innerHTML=`<span>${escapeHtml(mensagem)}</span><button type="button" class="secondary">${t('Desfazer')}</button>`;
  aviso.querySelector('button').onclick=()=>{clearTimeout(timerDoDesfazer);aviso.remove();aoDesfazer();};
  document.body.append(aviso);
  timerDoDesfazer=setTimeout(()=>aviso.remove(),8000);
}
function excluirTarefa(id){
  const posicao=state.tasks.findIndex(x=>x.id===id);
  if(posicao<0)return;
  const tarefa=state.tasks[posicao];
  state.tasks=state.tasks.filter(x=>x.id!==id);render();save(null,0,{semRender:true});
  avisarComDesfazer(t('Tarefa "{titulo}" excluída.',{titulo:tarefa.title}),async()=>{
    for(let i=0;i<100&&busy;i++)await new Promise(r=>setTimeout(r,50));
    if(state.tasks.some(x=>x.id===id))return;
    state.tasks=[...state.tasks.slice(0,posicao),tarefa,...state.tasks.slice(posicao)];
    render();save(null,0,{semRender:true});
  });
}
// Excluir uma pasta leva junto suas subpastas; as notas continuam no cofre, na raiz.
function deleteFolder(id) {
  const ids=Kiro.descendants(state.folders,id);
  const notes=state.notes.filter(n=>ids.has(n.folderId));
  const fluxosDaPasta=(state.fluxos||[]).filter(f=>ids.has(f.folderId));
  // Um fluxo com erro não é regravado pelo cofre (nunca teve canvas lido): a exclusão da pasta
  // não o move para a raiz, ele vai para a lixeira junto com o arquivo da pasta.
  const fluxosMovendo=fluxosDaPasta.filter(f=>!f.erro);
  const fluxosComErro=fluxosDaPasta.filter(f=>f.erro);
  const avisoErro=fluxosComErro.length?' '+(fluxosComErro.length===1?t('1 fluxo não pôde ser lido e vai para a lixeira com a pasta.'):t('{n} fluxos não puderam ser lidos e vão para a lixeira com a pasta.',{n:fluxosComErro.length})):"";
  if((ids.size>1||notes.length||fluxosMovendo.length||fluxosComErro.length)&&!confirm(t('Esta pasta contém {subpastas}, {notas} e {fluxos}. As subpastas serão excluídas, e as notas e os fluxos irão para a raiz do cofre.{aviso} Continuar?',{subpastas:ids.size===2?t('1 subpasta'):t('{n} subpastas',{n:ids.size-1}),notas:notes.length===1?t('1 nota'):t('{n} notas',{n:notes.length}),fluxos:fluxosMovendo.length===1?t('1 fluxo'):t('{n} fluxos',{n:fluxosMovendo.length}),aviso:avisoErro})))return;
  // Um fluxo movido para a raiz pode colidir de nome (sem diferenciar maiúsculas) com um fluxo já
  // existente lá, ou com outro fluxo desta mesma leva: recusa tudo antes de mexer no estado.
  const nomesNaRaiz=new Set((state.fluxos||[]).filter(f=>!ids.has(f.folderId)&&(f.folderId||"")==="").map(f=>Kiro.pathKey(f.title)));
  const vistos=new Set();
  for(const f of fluxosMovendo){
    const chave=Kiro.pathKey(f.title);
    if(nomesNaRaiz.has(chave)||vistos.has(chave))return status(t('Um fluxo desta pasta tem o mesmo nome de um fluxo que já existe na raiz do cofre.'),true);
    vistos.add(chave);
  }
  state.notes=state.notes.map(n=>ids.has(n.folderId)?{...n,folderId:""}:n);
  state.fluxos=(state.fluxos||[]).map(f=>ids.has(f.folderId)?{...f,folderId:''}:f);
  state.folders=state.folders.filter(f=>!ids.has(f.id));
  save();render();
}
// Mover nota entre pastas: pelo arrastar na árvore ou pelo menu do botão direito.
function marcarSelecaoArvore() {
  for (const l of document.querySelectorAll('.tree-note, .tree-fluxo')) l.classList.toggle('selecionada', selecaoArvore.has(l.dataset.id));
  const rodape = document.querySelector('.cofre-rodape');
  if (rodape) rodape.innerHTML = rodapeDaArvore();
}
// Com itens selecionados, o pé da árvore vira uma barra de ações: quantos, mover, excluir e sair.
function rodapeDaArvore() {
  const n = selecaoArvore.size;
  if (!n) return `<span class="small-muted">${state.folders.length === 1 ? t('1 pasta') : t('{n} pastas', { n: state.folders.length })} · ${state.notes.length === 1 ? t('1 nota') : t('{n} notas', { n: state.notes.length })}</span>`;
  return `<div class="selecao-barra" role="status" aria-live="polite"><span class="selecao-total">${n === 1 ? t('1 selecionado') : t('{n} selecionados', { n })}</span>`
    + `<button type="button" class="icon-button" data-selecao="mover" title="${t('Mover para…')}" aria-label="${t('Mover para')}">${icone('pastas')}</button>`
    + `<button type="button" class="icon-button" data-selecao="excluir" title="${t('Excluir')}" aria-label="${t('Excluir')}">${icone('lixeira')}</button>`
    + `<button type="button" class="icon-button" data-selecao="limpar" title="${t('Sair da seleção (Esc)')}" aria-label="${t('Sair da seleção')}">${icone('fechar')}</button></div>`;
}
function limparSelecaoArvore() { if (!selecaoArvore.size) return; selecaoArvore.clear(); marcarSelecaoArvore(); }
// Mover e excluir vários de uma vez: uma gravação só (cada gravação vira um snapshot em .history).
async function moverSelecao(folderId) {
  if (busy || failed || !loaded) return;
  const ids = new Set(selecaoArvore);
  if (editing?.id && ids.has(editing.id) && editorDirty && !await salvarNota()) return;
  if (!await gravarFluxoPendente()) return;
  const nomes = new Set((state.fluxos || []).filter(f => !ids.has(f.id) && (f.folderId || '') === folderId).map(f => Kiro.pathKey(f.title)));
  const repetidos = [];
  state.notes = state.notes.map(n => ids.has(n.id) && (n.folderId || '') !== folderId ? { ...n, folderId, updatedAt: Date.now() } : n);
  state.fluxos = (state.fluxos || []).map(f => {
    if (!ids.has(f.id) || f.erro || (f.folderId || '') === folderId) return f;
    const chave = Kiro.pathKey(f.title);
    if (nomes.has(chave)) { repetidos.push(f.title); return f; }
    nomes.add(chave);
    return { ...f, folderId };
  });
  if (editing?.id && ids.has(editing.id)) editing.folderId = folderId;
  if (folderId && expanded) expanded.add(folderId);
  selecaoArvore.clear();
  await save();
  if (repetidos.length) status(t('Não movidos, já existe um fluxo com o mesmo nome no destino: {nomes}.', { nomes: repetidos.join(', ') }), true);
}
const excluirSelecao = () => excluirItens(new Set(selecaoArvore));
// Notas e fluxos para a lixeira, numa gravação só. Uma nota sozinha é chamada pelo título.
async function excluirItens(ids) {
  if (busy) { status(t('Salvando… tente de novo em um instante.'), true); return; }
  if (failed || !loaded) return;
  const notas = state.notes.filter(n => ids.has(n.id)), fluxos = (state.fluxos || []).filter(f => ids.has(f.id));
  if (!notas.length && !fluxos.length) return;
  const contagens = [notas.length && (notas.length === 1 ? t('1 nota') : t('{n} notas', { n: notas.length })), fluxos.length && (fluxos.length === 1 ? t('1 fluxo') : t('{n} fluxos', { n: fluxos.length }))].filter(Boolean);
  const partes = notas.length === 1 && !fluxos.length ? t('a nota "{titulo}"', { titulo: notas[0].title || t('Sem título') })
    : contagens.length > 1 ? t('{a} e {b}', { a: contagens[0], b: contagens[1] }) : contagens[0];
  if (!confirm(t('Excluir {partes}? Vai para a lixeira e pode ser restaurado.', { partes }))) return;
  if (!await gravarFluxoPendente()) return;
  state.notes = state.notes.filter(n => !ids.has(n.id));
  state.fluxos = (state.fluxos || []).filter(f => !ids.has(f.id));
  if (editing?.id && ids.has(editing.id)) { editing = null; editorDirty = false; }
  selecaoArvore.clear();
  await save(); render();
}
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
const destinosDePasta = () => [{ id: '', rotulo: t('Raiz do cofre') }, ...state.folders.slice().sort((a, b) => KiroIdiomas.comparar(a.path || a.title, b.path || b.title)).map(f => ({ id: f.id, rotulo: f.path || f.title }))];
function menuDaSelecao() {
  const n = selecaoArvore.size, itens = n === 1 ? t('1 item') : t('{n} itens', { n });
  return [
    { rotulo: t('Mover {itens} para', { itens }), icone: icone('pastas'), filhos: destinosDePasta().map(d => ({ rotulo: d.rotulo, icone: icone(d.id ? 'pastas' : 'casa'), acao: () => moverSelecao(d.id) })) },
    { separador: true },
    { rotulo: t('Excluir {itens}', { itens }), icone: icone('lixeira'), acao: () => excluirSelecao() },
  ];
}
function menuDaArvore(linha) {
  const id = linha.dataset.id, pastaAtual = () => state.folders.find(f => f.id === id);
  if (linha.classList.contains('tree-fluxo')) {
    const fluxo = getFluxo(id);
    const destinos = destinosDePasta();
    return [
      { rotulo: t('Abrir'), icone: icone('fluxo'), acao: () => getFluxo(id) && abrirFluxo(getFluxo(id)) },
      { rotulo: Kiro.ehFavorito(favoritos, 'fluxo', id) ? t('Remover dos favoritos') : t('Favoritar'), icone: icone(Kiro.ehFavorito(favoritos, 'fluxo', id) ? 'estrela-cheia' : 'estrela'), acao: () => alternarItemFavorito({ tipo: 'fluxo', alvo: id, titulo: getFluxo(id)?.title }) },
      // Fluxo com erro não é regravado pelo cofre: renomear ou mover não teriam efeito.
      ...(fluxo && !fluxo.erro ? [
        { rotulo: t('Renomear'), icone: icone('renomear'), acao: () => getFluxo(id) && fluxoModal(getFluxo(id)) },
        { rotulo: t('Mover para'), icone: icone('pastas'), filhos: destinos.map(d => ({ rotulo: d.rotulo, icone: icone(d.id ? 'pastas' : 'casa'), ativo: () => (getFluxo(id)?.folderId || '') !== d.id, acao: () => moverFluxo(id, d.id) })) },
      ] : []),
      { separador: true },
      { rotulo: t('Excluir'), icone: icone('lixeira'), acao: () => excluirFluxo(id) },
    ];
  }
  if (linha.classList.contains('tree-note')) {
    const destinos = destinosDePasta();
    return [
      { rotulo: t('Abrir'), icone: icone('nota'), acao: () => getNote(id) && abrirNota(getNote(id)) },
      { rotulo: Kiro.ehFavorito(favoritos, 'nota', id) ? t('Remover dos favoritos') : t('Favoritar'), icone: icone(Kiro.ehFavorito(favoritos, 'nota', id) ? 'estrela-cheia' : 'estrela'), acao: () => alternarItemFavorito({ tipo: 'nota', alvo: id, titulo: getNote(id)?.title }) },
      { rotulo: t('Mover para'), icone: icone('pastas'), filhos: destinos.map(d => ({ rotulo: d.rotulo, icone: icone(d.id ? 'pastas' : 'casa'), ativo: () => (getNote(id)?.folderId || '') !== d.id, acao: () => moverNota(id, d.id) })) },
      { separador: true },
      { rotulo: t('Excluir'), icone: icone('lixeira'), acao: () => excluirItens(new Set([id])) },
    ];
  }
  return [
    { rotulo: t('Nova nota aqui'), icone: icone('mais'), acao: () => abrirNota(notaVazia({ folderId: id })) },
    { rotulo: t('Novo fluxo aqui'), icone: icone('fluxo'), acao: () => novoFluxo(id) },
    { rotulo: t('Nova subpasta'), icone: icone('pasta-nova'), acao: () => folderModal({ title: '', description: '', parentId: id }) },
    { rotulo: Kiro.ehFavorito(favoritos, 'pasta', id) ? t('Remover dos favoritos') : t('Favoritar'), icone: icone(Kiro.ehFavorito(favoritos, 'pasta', id) ? 'estrela-cheia' : 'estrela'), acao: () => alternarItemFavorito({ tipo: 'pasta', alvo: id, titulo: pastaAtual()?.title }) },
    { separador: true },
    { rotulo: t('Renomear ou mover'), icone: icone('renomear'), acao: () => pastaAtual() && folderModal(pastaAtual()) },
    { rotulo: t('Cor'), icone: icone('realce'), filhos: ['', ...Kiro.FOLDER_COLORS].map(cor => ({ rotulo: t(NOMES_DE_COR[cor]), icone: bolinha(cor), ativo: () => (pastaAtual()?.color || '') !== cor, acao: () => { const pasta = pastaAtual(); if (pasta) { pasta.color = cor; save(); } } })) },
    { separador: true },
    { rotulo: t('Excluir pasta'), icone: icone('lixeira'), acao: () => deleteFolder(id) },
  ];
}
let focoAntesDoModal=null;
const focaveisDoModal=()=>[...document.querySelectorAll('.modal :is(a[href],button,input,select,textarea,[tabindex]):not(:disabled,[tabindex="-1"],[type="hidden"])')].filter(el=>el.getClientRects().length);
// O Tab não sai da janela aberta. Quem já cuida do próprio Tab (Ações rápidas) marca o evento.
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab'||e.defaultPrevented||!document.querySelector('.modal'))return;
  const lista=focaveisDoModal();if(!lista.length)return;
  const fora=!document.activeElement?.closest?.('.modal'), primeiro=lista[0], ultimo=lista.at(-1);
  if(fora||(!e.shiftKey&&document.activeElement===ultimo)){e.preventDefault();primeiro.focus();}
  else if(e.shiftKey&&document.activeElement===primeiro){e.preventDefault();ultimo.focus();}
});
function modal(title, body) { if(!$('#modal-root').firstChild){const el=document.activeElement;focoAntesDoModal=el&&el!==document.body?{el,seletor:seletorDoFoco(el)}:null;} modalDirty=false; document.querySelector("#modal-root").innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo"><header class="modal-head"><h2 id="modal-titulo">${title}</h2><button class="icon-button" id="close-modal" title="${t('Fechar')}" aria-label="${t('Fechar')}">${icone('fechar')}</button></header>${body}</section></div>`; document.querySelector(".modal").addEventListener("input",()=>modalDirty=true); document.querySelector(".modal").addEventListener("change",()=>modalDirty=true); document.querySelector("#close-modal").onclick=()=>closeModal(); document.querySelector(".modal-backdrop").onclick=e=>{if(e.target===e.currentTarget)closeModal();};
  // Campo obrigatório só com espaços vale como vazio em todos os formulários. Em captura: vem antes do envio de cada um.
  document.querySelector(".modal").addEventListener("submit",e=>{
    for(const c of e.target.querySelectorAll('input[required]:not([type=date],[type=number])'))c.value=c.value.trim();
    if(!e.target.checkValidity()){e.preventDefault();e.stopImmediatePropagation();e.target.reportValidity();}
  },true);
  (document.querySelector('.modal [autofocus]')||document.querySelector('.modal form :is(input:not([type=radio],[type=checkbox],[type=hidden]),textarea,select)')||document.querySelector('#close-modal')).focus();
}
function closeModal(force=false){ if(!force && (busy || (modalDirty && !confirm(t('Descartar as alterações deste formulário?')))))return false; document.querySelector('#modal-root').innerHTML='';modalDirty=false;const aoFechar=aoFecharAcoesRapidas;aoFecharAcoesRapidas=null;aoFechar?.();
  const volta=focoAntesDoModal;focoAntesDoModal=null;
  if(volta&&!document.querySelector('.modal')&&(document.activeElement===document.body||!document.activeElement)){
    if(editorDaNota?.editor.dom.contains(volta.el)&&volta.el.isConnected)editorDaNota.editor.focar();
    else (volta.el.isConnected?volta.el:volta.seletor&&document.querySelector(volta.seletor))?.focus({preventScroll:true});
  }
  return true; }
function taskModal(task={title:"",due:today(),priority:"Média",noteId:""}) {
  const ATALHOS = [[0, frase('Hoje')], [1, frase('Amanhã')], [7, frase('Próxima semana')]];
  const stAtual = Kiro.statusDaTarefa(task);
  modal(task.id?t("Editar tarefa"):t("Nova tarefa"), `<form class="form" id="task-form">
    <div class="field"><label for="tarefa-titulo">${t('Tarefa')}</label><input id="tarefa-titulo" name="title" required autofocus value="${escapeHtml(task.title)}" placeholder="${t('O que precisa ser feito?')}" /></div>
    <div class="field"><label for="tarefa-data">${t('Data')}</label><div class="tarefa-datas"><input id="tarefa-data" name="due" type="date" value="${task.due}" required />${ATALHOS.map(([n, r]) => `<button type="button" class="chip" data-somar-dias="${n}">${t(r)}</button>`).join('')}</div></div>
    <div class="field"><span class="rotulo-campo" id="tarefa-estado">${t('Estado')}</span><div class="segmentos" role="radiogroup" aria-labelledby="tarefa-estado">${Kiro.STATUS_DA_TAREFA.map(st=>`<label class="segmento" data-status="${st}"><input type="radio" name="status" value="${st}" ${st===stAtual?"checked":""} /><span><span class="status-marca" aria-hidden="true"></span> ${t(ROTULOS_DE_STATUS[st])}</span></label>`).join("")}</div></div>
    <div class="field"><span class="rotulo-campo" id="tarefa-prioridade">${t('Prioridade')}</span><div class="segmentos" role="radiogroup" aria-labelledby="tarefa-prioridade">${[frase("Baixa"),frase("Média"),frase("Alta")].map(p=>`<label class="segmento"><input type="radio" name="priority" value="${p}" ${p===task.priority?"checked":""} /><span>${t(p)}</span></label>`).join("")}</div></div>
    <div class="field"><label for="tarefa-repete">${t('Repetir')}</label><div class="tarefa-datas"><select id="tarefa-repete" name="repeat">${[['', frase('Não repete')], ['day', frase('Todo dia')], ['week', frase('Toda semana')], ['month', frase('Todo mês')], ['days', frase('A cada N dias')]].map(([v, r]) => `<option value="${v}" ${v === (task.repeat?.every || '') ? 'selected' : ''}>${t(r)}</option>`).join('')}</select><input id="tarefa-repete-n" name="repeatN" type="number" min="1" max="365" value="${task.repeat?.n || 2}" aria-label="${t('Número de dias')}" ${task.repeat?.every === 'days' ? '' : 'hidden'} /></div></div>
    <div class="field"><label for="tarefa-descricao">${t('Descrição (opcional)')}</label><textarea id="tarefa-descricao" name="description" maxlength="5000" rows="3" placeholder="${t('Detalhes, passos, links…')}">${escapeHtml(task.description || '')}</textarea></div>
    <div class="field"><label for="tarefa-nota">${t('Nota associada (opcional)')}</label><select id="tarefa-nota" name="noteId"><option value="">${t('Nenhuma')}</option>${state.notes.map(n=>`<option value="${n.id}" ${n.id===task.noteId?"selected":""}>${escapeHtml(n.title)}</option>`).join("")}</select></div>
    <div class="form-actions">${task.id ? `<button type="button" class="secondary tarefa-copiar" id="tarefa-copiar" title="${t('Cole numa nota para citar esta tarefa')}">${icone('link')} ${t('Copiar citação')}</button>` : ''}<button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button class="primary">${t('Salvar tarefa')}</button></div></form>`);
  $('#tarefa-copiar')?.addEventListener('click', async () => { if (await copiarTexto(Kiro.taskReference(task))) status(t('Citação copiada: cole numa nota.')); });
  const data = $('#tarefa-data'), atalhos = [...document.querySelectorAll('[data-somar-dias]')];
  const marcarAtalho = () => atalhos.forEach(b => b.setAttribute('aria-pressed', String(somarDias(today(), Number(b.dataset.somarDias)) === data.value)));
  atalhos.forEach(b => b.onclick = () => { data.value = somarDias(today(), Number(b.dataset.somarDias)); marcarAtalho(); });
  data.addEventListener('input', marcarAtalho); marcarAtalho();
  $('#tarefa-repete').onchange = e => { $('#tarefa-repete-n').hidden = e.target.value !== 'days'; };
  $('#tarefa-titulo')?.focus();
  document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#task-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);let saved={...task,id:task.id||uid(),title:f.get("title"),due:f.get("due"),priority:f.get("priority"),noteId:f.get("noteId"),done:task.done||false};const stEscolhido=f.get("status");if(Kiro.STATUS_DA_TAREFA.includes(stEscolhido))saved=Kiro.moverTarefa(saved,stEscolhido);const rep=f.get("repeat"),n=Math.min(365,Math.max(1,Math.round(Number(f.get("repeatN"))||2)));if(rep)saved.repeat=rep==="days"?{every:"days",n}:{every:rep};else delete saved.repeat;const descricao=String(f.get("description")||"").trim();if(descricao)saved.description=descricao;else delete saved.description;const antes=state.tasks;state.tasks=task.id?state.tasks.map(t=>t.id===task.id?saved:t):[saved,...state.tasks];criarProximas(antes);closeModal(true);render();save(null,0,{semRender:true});}; }
const NOMES_DE_COR = { "":frase("Sem cor"), azul:frase("Azul"), verde:frase("Verde"), amarelo:frase("Amarelo"), laranja:frase("Laranja"), vermelho:frase("Vermelho"), rosa:frase("Rosa"), roxo:frase("Roxo"), cinza:frase("Cinza") };
function folderModal(folder={title:"",description:"",parentId:""}) { modal(folder.id?t("Editar pasta"):t("Nova pasta de estudo"), `<form class="form" id="folder-form"><div class="field"><label>${t('Nome da pasta')}</label><input name="title" required value="${escapeHtml(folder.title)}" placeholder="${t('Ex.: JAVA, Inglês, programação')}" /><small class="small-muted">${t('Vira uma pasta de verdade no cofre: sem &lt; &gt; : " / \\ | ? * e sem ponto ou espaço no início ou no final.')}</small></div><div class="field"><label>${t('Dentro de')}</label><select name="parentId"><option value="">${t('Raiz do cofre')}</option>${state.folders.filter(f=>!(folder.id?Kiro.descendants(state.folders,folder.id):new Set()).has(f.id)).sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===(folder.parentId||"")?"selected":""}>${escapeHtml(f.path||f.title)}</option>`).join("")}</select></div><div class="field"><span class="rotulo-campo" id="cor-pasta-rotulo">${t('Cor')}</span><div class="amostras" role="radiogroup" aria-labelledby="cor-pasta-rotulo">${["",...Kiro.FOLDER_COLORS].map(cor=>`<label class="amostra" data-cor-pasta="${cor}" title="${t(NOMES_DE_COR[cor])}"><input type="radio" name="color" value="${cor}" ${cor===(folder.color||"")?"checked":""} /><span class="sr-only">${t(NOMES_DE_COR[cor])}</span></label>`).join("")}</div></div><div class="field"><label>${t('Descrição')}</label><textarea name="description" placeholder="${t('Qual é seu objetivo com esta pasta?')}">${escapeHtml(folder.description||"")}</textarea></div><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button class="primary">${t('Salvar pasta')}</button></div></form>`);document.querySelector("#cancel").onclick=()=>closeModal();document.querySelector("#folder-form").onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=f.get("title").trim();
  // Validar aqui evita que um nome inválido bloqueie a janela no salvamento.
  if(!Kiro.validFolderName(title)){alert(t('Nome de pasta inválido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.'));return;}
  const parentId=f.get("parentId")||"";
  const saved={...folder,id:folder.id||uid(),title,parentId,description:f.get("description"),color:Kiro.folderColor(f.get("color"))};
  if(state.folders.some(x=>x.id!==saved.id&&(x.parentId||"")===parentId&&Kiro.pathKey(x.title)===Kiro.pathKey(title))){alert(t("Já existe uma pasta com esse nome neste local."));return;}
  state.folders=folder.id?state.folders.map(x=>x.id===folder.id?saved:x):[saved,...state.folders];
  // Deixar visível o que acabou de ser criado ou movido.
  if(expanded){expanded.add(saved.id);if(parentId)expanded.add(parentId);}
  save();closeModal(true);currentView="studies";render();}; }
let busy=false, failed=false, loaded=false, modalDirty=false, lastDay=today();
let aguardandoCofre=false;   // primeira abertura no aplicativo: nada é lido até escolher o cofre
// null = ainda não semeado; na primeira exibição a árvore abre inteira.
let expanded=null, renderedView=null, editing=null, editorDirty=false, grafoRaf=null;
// Mudança num fluxo vai direto para `state` e é gravada depois de uma pausa. Enquanto houver
// uma pendente, a releitura automática não roda (ela trocaria `state` e perderia a mudança).
let fluxoPendente=false, timerDoFluxo=null;
function mudarFluxo(id,canvas){
  state.fluxos=(state.fluxos||[]).map(f=>f.id===id?{...f,canvas}:f);
  fluxoPendente=true;status(t('Alterações não salvas'));
  agendarFluxo();
}
// Cada salvamento de fluxo copia o cofre inteiro para .history (limite 30): a espera evita
// que digitar ou arrastar sem parar encha o histórico à toa.
const ESPERA_AUTOSAVE_FLUXO=2000;
function agendarFluxo(){
  clearTimeout(timerDoFluxo);
  timerDoFluxo=setTimeout(async()=>{
    // Não salvar no meio de um arraste ou de uma digitação: o salvamento redesenha a tela.
    if(KiroFluxoTela.ocupado()||busy)return agendarFluxo();
    if(failed)return;
    // Limpa antes de salvar: um mudarFluxo que aconteça durante o `await` (ex.: outro
    // redesenho) marca de novo e agenda seu próprio timer, sem ser apagado por este.
    fluxoPendente=false;
    if(!await save())fluxoPendente=true;
  },ESPERA_AUTOSAVE_FLUXO);
}
// Usado antes de substituir `state` por inteiro (troca de cofre, restauração): grava a
// mudança pendente e já limpa a flag e o timer assim que a gravação em si der certo, sem
// esperar o passo seguinte (que pode falhar ou ser cancelado) para isso.
async function gravarFluxoPendente(){
  if(!fluxoPendente)return true;
  clearTimeout(timerDoFluxo);
  if(!await save())return false;
  fluxoPendente=false;
  return true;
}
const notaVazia = (extra={}) => ({title:"",body:"",links:[],tags:[],folderId:"",...extra});
// Abas da tela de Pastas: modelo puro (abas.js), sempre limpo contra state.notes. Memória por cofre.
let abas = KiroAbas.vazio(), abasDoCofre = undefined; // vaultPath a que `abas` pertence (undefined = ainda nenhum)
// `abas` é por cofre: troca de cofre (inclusive a primeira vez) recarrega do localStorage daquele
// vaultPath. Chamada no início de qualquer caminho que leia ou grave `abas` antes do próximo
// `renderCofre` (ex.: abrir a primeira nota da sessão a partir de Hoje), senão esse caminho
// mutaria/gravaria o modelo vazio de sempre por cima do que está salvo do cofre atual.
function garantirAbasDoCofre() {
  if (abasDoCofre === state.vaultPath) return;
  abasDoCofre = state.vaultPath;
  abas = KiroAbas.vazio();
  try { const salvo = JSON.parse(localStorage.getItem('kiro.abas:' + (state.vaultPath || ''))); if (salvo) abas = salvo; } catch { /* janela privada: vale só nesta sessão */ }
}
function gravarAbas() { garantirAbasDoCofre(); try { localStorage.setItem('kiro.abas:' + (state.vaultPath || ''), JSON.stringify(abas)); } catch { /* janela privada: vale só nesta sessão */ } }
const idDaAba = nota => nota.id || KiroAbas.RASCUNHO;
const $ = selector => document.querySelector(selector);
const templates={
  study:{title:frase('Resumo de estudo'),body:[frase('# Objetivo'),frase('## Ideias principais'),frase('## Exemplos'),frase('## Perguntas'),frase('## Próximos passos'),frase('- [ ] Revisar')]},
  meeting:{title:frase('Reunião'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Participantes'),frase('## Pauta'),frase('## Anotações'),frase('## Decisões'),frase('## Ações e responsáveis'),'- [ ] ']},
  daily:{title:frase('Nota diária'),body:[frase('# Foco do dia'),frase('## Capturas'),frase('## O que aprendi'),frase('## Amanhã')]},
  minutes:{title:frase('Ata de reunião'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Local e horário'),frase('## Participantes'),frase('## Pauta'),frase('## Discussões'),frase('## Decisões'),frase('## Ações e responsáveis'),frase('Responsável: — Prazo: —'),'- [ ] ',frase('## Próxima reunião')]},
  lesson:{title:frase('Plano de aula'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Turma e duração'),frase('## Objetivos de aprendizagem'),frase('## Conteúdo'),frase('## Materiais'),frase('## Etapas da aula'),frase('## Avaliação'),frase('## Anotações após a aula')]},
  session:{title:frase('Registro de sessão'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Identificação e duração'),frase('## Objetivo da sessão'),frase('## Relato e observações'),frase('## Atividades realizadas'),frase('## Encaminhamentos'),frase('## Próxima sessão')]},
  legal:{title:frase('Peça jurídica'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('Estrutura genérica para organização de texto; revise e adapte ao caso.'),frase('## Endereçamento'),frase('## Identificação das partes'),frase('## Fatos'),frase('## Fundamentação'),frase('## Pedidos'),frase('## Documentos anexos'),frase('## Local, data e assinatura')]},
  script:{title:frase('Roteiro'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Objetivo e público'),frase('## Duração prevista'),frase('## Abertura'),frase('## Cenas e falas'),frase('Cena: — Imagem/ação: — Fala/áudio: —'),frase('## Encerramento'),frase('## Recursos necessários')]},
  construction:{title:frase('Diário de obra'),body:[frase('# {{title}}'),frase('Data: {{date}}'),frase('## Obra e responsável'),frase('## Clima e jornada'),frase('## Equipe e equipamentos'),frase('## Serviços executados'),frase('## Materiais recebidos'),frase('## Ocorrências e pendências'),frase('## Registros e anexos'),frase('## Próximos serviços')]}
};
// ---- Modelos pessoais ----
function catalogoDeModelos() {
  return [
    ...Object.entries(templates).map(([nome, modelo]) => ({ chave: `embutido:${nome}`, titulo: t(modelo.title), pasta: t('Embutidos'), body: modelo.body.map(parte => t(parte)).join('\n\n') + '\n', tags: [], links: [] })),
    ...Kiro.modelosPessoais(state.notes).map(nota => ({ chave: `nota:${nota.id}`, titulo: nota.title, pasta: state.folders.find(p => p.id === nota.folderId)?.path || state.folders.find(p => p.id === nota.folderId)?.title || t('Raiz do cofre'), body: nota.body, tags: [...(nota.tags || [])], links: [...(nota.links || [])] })),
  ];
}
function opcoesDeModelos() {
  return catalogoDeModelos().map(m => `<option value="${escapeHtml(m.chave)}">${escapeHtml(m.titulo)} · ${escapeHtml(m.pasta)}</option>`).join('');
}
function relerModelo(chave, cofre) {
  const modelo = state.vaultPath === cofre && loaded && !failed && catalogoDeModelos().find(m => m.chave === chave);
  if (!modelo) status(t('O modelo não está mais disponível neste cofre.'), true);
  return modelo;
}
function modalDeModelo(titulo, corpo) {
  modal(titulo, corpo);
  const dialogo = $('.modal');
  dialogo.setAttribute('aria-label', titulo);
  dialogo.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const campos = [...dialogo.querySelectorAll('button, input, select')].filter(c => !c.disabled);
    const primeiro = campos[0], ultimo = campos[campos.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo?.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus(); }
  });
}
function pedirTituloModelo(confirmar) {
  modalDeModelo(t('Título da nota'), `<form class="form" id="modelo-titulo-form"><div class="field"><label for="modelo-titulo">${t('Título da nota')}</label><input id="modelo-titulo" required maxlength="200" autocomplete="off" /></div><p id="modelo-titulo-aviso" role="alert" hidden></p><div class="form-actions"><button type="button" class="secondary" id="modelo-cancelar">${t('Cancelar')}</button><button class="primary" id="modelo-criar">${t('Continuar')}</button></div></form>`);
  const campo = $('#modelo-titulo'), formulario = $('#modelo-titulo-form'), botao = $('#modelo-criar');
  const avisarFalha = () => {
    const aviso = $('#modelo-titulo-aviso');
    aviso.textContent = failed ? t('Não foi possível salvar o cofre. Feche este formulário, preserve ou exporte suas alterações e recupere o cofre antes de tentar novamente.') : t('Não foi possível continuar. Salve a nota aberta ou verifique o modelo antes de tentar novamente.');
    aviso.hidden = false;
  };
  let enviando = false;
  campo.oninput = () => campo.setCustomValidity('');
  $('#modelo-cancelar').onclick = () => closeModal();
  formulario.onsubmit = async e => {
    e.preventDefault();
    if (failed) { botao.disabled = true; avisarFalha(); return; }
    if (enviando || busy || !loaded) return;
    const titulo = campo.value.trim();
    campo.setCustomValidity(!titulo || titulo.length > 200 ? t('Informe um título de até 200 caracteres.') : '');
    if (!titulo || titulo.length > 200) { campo.reportValidity(); return; }
    enviando = true; botao.disabled = true;
    try {
      if (await confirmar(titulo, formulario)) closeModal(true);
      else if ($('#modelo-titulo-form') === formulario && $('#modal-root').firstChild) {
        avisarFalha(); botao.disabled = failed; campo.focus();
      }
    }
    finally { enviando = false; botao.disabled = failed; }
  };
  campo.focus();
}
function criarNotaPorModelo() {
  if (!loaded || failed || busy || $('#modal-root').firstChild) return;
  const cofre = state.vaultPath, pasta = editing?.folderId || '';
  modalDeModelo(t('Criar nota por modelo'), `<form class="form" id="modelo-selecao-form"><div class="field"><label for="modelo-escolha">${t('Modelo')}</label><select id="modelo-escolha">${opcoesDeModelos()}</select></div><p class="small-muted">${t('Adicione modelo no campo de tags de uma nota para usá-la como modelo pessoal.')}</p><p class="small-muted">${t('Anexos não são copiados; caminhos relativos não são ajustados.')}</p><div class="form-actions"><button type="button" class="secondary" id="modelo-cancelar">${t('Cancelar')}</button><button class="primary" id="modelo-continuar">${t('Continuar')}</button></div></form>`);
  $('#modelo-cancelar').onclick = () => closeModal();
  $('#modelo-selecao-form').onsubmit = e => {
    e.preventDefault();
    const chave = $('#modelo-escolha').value;
    if (!relerModelo(chave, cofre)) return;
    pedirTituloModelo(async (titulo, formulario) => {
      if (!relerModelo(chave, cofre) || !await salvarAntesDeTrocar()) return false;
      if ($('#modelo-titulo-form') !== formulario || !$('#modal-root').firstChild) return false;
      const modelo = relerModelo(chave, cofre);
      if (!modelo) return false;
      await abrirNota(notaVazia({ title: titulo, body: Kiro.expandirModelo(modelo.body, { title: titulo, date: today() }), tags: modelo.tags.filter(tag => Kiro.normalize(tag) !== 'modelo'), links: [...modelo.links], folderId: state.folders.some(p => p.id === pasta) ? pasta : '' }));
      editorDirty = true; estadoDoc();
      return true;
    });
  };
  $('#modelo-escolha').focus();
}
async function criarModeloPessoal() {
  if (!loaded || failed || busy || $('#modal-root').firstChild) return;
  const cofre = state.vaultPath, pasta = editing?.folderId || '';
  if (!await salvarAntesDeTrocar() || state.vaultPath !== cofre) return;
  await abrirNota(notaVazia({ body: '# {{title}}\n\n' + t('Data: {{date}}') + '\n\n' + t('Escreva seu modelo aqui.'), tags: ['modelo'], folderId: state.folders.some(p => p.id === pasta) ? pasta : '' }));
  editorDirty = true; estadoDoc();
}
function aplicarModeloNaNota(chave) {
  const cofre = state.vaultPath, nota = editing, modelo = relerModelo(chave, cofre);
  if (!modelo || !nota || busy) return;
  if (nota.body.trim() && !confirm(t('Substituir o texto desta nota pelo modelo?'))) return;
  const aplicar = titulo => {
    if (editing !== nota) return false;
    const atual = relerModelo(chave, cofre);
    if (!atual) return false;
    const corpo = Kiro.expandirModelo(atual.body, { title: titulo, date: today() }), area = editorDaNota?.editor.area();
    // Uma inserção no editor preserva a transação de desfazer.
    if (area) { area.setSelectionRange(0, area.value.length); area.inserir(corpo); }
    else {
      const campo = $('#doc-corpo .doc-corpo-simples');
      if (!campo) return false;
      campo.focus(); campo.select();
      document.execCommand('insertText', false, corpo);
      editing.body = campo.value;
    }
    if (!nota.title.trim() && titulo) { nota.title = titulo; $('#doc-title').value = titulo; }
    editorDirty = true; estadoDoc();
    return true;
  };
  if (!nota.title.trim() && modelo.body.includes('{{title}}')) pedirTituloModelo(aplicar);
  else aplicar(nota.title.trim());
}
// ---- Fim dos modelos pessoais ----
async function api(endpoint,data){
  const response=await fetch(`/api/${endpoint}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||t('Não foi possível acessar o cofre.'));return result;
}
// Abertura: some assim que o cofre carrega, mas fica tempo suficiente para a marca ser vista.
const abertura=document.getElementById('abertura');
function fecharAbertura(){
  if(!abertura||!abertura.isConnected||abertura.classList.contains('saindo'))return;
  setTimeout(()=>{abertura.classList.add('saindo');setTimeout(()=>abertura.remove(),450);},Math.max(0,1200-performance.now()));
}
// Cofre lento ou com erro: a abertura sai de qualquer jeito, nunca prende a tela.
setTimeout(fecharAbertura,4000);
// Textos do index.html (barra lateral e status): o original em português fica guardado para a
// próxima troca de idioma. O que o app redesenha depois (contagem, rótulo da lateral) é dele.
const originaisDoIndex = new WeakMap();
function traduzirFixos() {
  for (const raiz of document.querySelectorAll('.sidebar, #save-status')) {
    const passo = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let no = passo.nextNode(); no; no = passo.nextNode()) {
      if (no.parentElement.closest('#nav-plugins')) continue; // texto de plug-in não se traduz
      const original = originaisDoIndex.get(no) ?? no.nodeValue;
      const limpo = original.trim();
      if (!limpo) continue;
      originaisDoIndex.set(no, original);
      no.nodeValue = original.replace(limpo, t(limpo));
    }
    for (const el of raiz.querySelectorAll('[title], [aria-label]')) for (const [atributo, chave] of [['title', 'ptTitle'], ['aria-label', 'ptAria']]) {
      if (!el.hasAttribute(atributo) || el.closest('#nav-plugins')) continue;
      el.dataset[chave] ??= el.getAttribute(atributo);
      el.setAttribute(atributo, t(el.dataset[chave]));
    }
  }
  document.documentElement.lang = KiroIdiomas.locale();
}
// Idioma salvo, ou o do sistema. Falhou o arquivo: segue em português e avisa.
async function prepararIdioma() {
  let salvo = null;
  try { salvo = localStorage.getItem('kiro.idioma'); } catch { /* janela privada: segue o sistema */ }
  const codigo = KiroIdiomas.escolherIdioma(salvo, navigator.language);
  try { await KiroIdiomas.carregar(codigo); KiroIdiomas.definirIdioma(codigo); }
  catch { status(t('Não foi possível carregar o idioma'), true); }
  aplicarIdiomaNaPagina();
}
function aplicarIdiomaNaPagina() {
  traduzirFixos();
  aplicarLateralCompacta();   // o rótulo do botão da lateral é dele
  window.cadernoDesktop?.definirIdioma?.(KiroIdiomas.idioma());
}
async function trocarIdioma(codigo) {
  try { await KiroIdiomas.carregar(codigo); }
  catch { status(t('Não foi possível carregar o idioma'), true); return; }
  KiroIdiomas.definirIdioma(codigo);
  try { localStorage.setItem('kiro.idioma', KiroIdiomas.idioma()); } catch { /* janela privada: vale só nesta sessão */ }
  aplicarIdiomaNaPagina();
  if (loaded) { updateCount(); render(); }
}
// Mensagem de erro de outro módulo (cofre, domínio, plug-ins, processo principal): as frases
// fixas marcadas com frase() lá têm tradução; as montadas com dados seguem em português.
const mensagemDoErro = erro => t(KiroIdiomas.semPrefixoDoIpc(erro?.message ?? erro));
function status(message,error=false){$('#save-status').classList.remove('celebracao');$('#save-status').textContent=message;$('#save-status').classList.toggle('error',error);}
function avisoAtalhoGlobal(mostrar) {
  let el = $('#aviso-atalho-global');
  if (!mostrar) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'aviso-atalho-global'; el.setAttribute('role', 'alert'); document.body.append(el); }
  el.textContent = t('Atalho global indisponível: outro aplicativo pode estar usando a combinação.');
}
let focoAntesDoBusy=null, timerDoBusy=null;   // inert tira o foco de qualquer coisa focada; em gravações rápidas (<150 ms) evita piscar
// `semBloqueio`: gravação automática. Quem está digitando continua digitando, e o foco fica onde a pessoa o deixar.
function setBusy(value,semBloqueio=false){
  if(value&&!busy&&!semBloqueio)focoAntesDoBusy=document.activeElement;
  busy=value;clearTimeout(timerDoBusy);
  if(value&&semBloqueio)return;
  if(value){
    timerDoBusy=setTimeout(()=>{if(!busy)return;document.body.classList.add('saving');$('.app-shell').inert=true;$('#modal-root').inert=true;},150);
  }else{
    document.body.classList.remove('saving');$('.app-shell').inert=false;$('#modal-root').inert=false;
    const f=focoAntesDoBusy;focoAntesDoBusy=null;
    // Se o elemento saiu do documento nesse meio-tempo (ex.: um redesenho o substituiu, ou o
    // modal que o continha fechou), não há pra onde voltar: quem substituiu cuida do próprio foco.
    // No editor da nota o foco volta pelo próprio editor: um focus() direto no conteúdo deixaria
    // o navegador pôr o cursor no começo, e o editor adotaria essa posição.
    if(f&&editorDaNota?.editor.dom.contains(f)&&document.contains(f)){if(!editorDaNota.editor.temFoco())editorDaNota.editor.focar();}
    else if(f&&f!==document.body&&document.contains(f)&&document.activeElement!==f)f.focus({preventScroll:true});
  }
}
async function reload(manual=false){
  if(aguardandoCofre||busy||(!manual&&(failed||editorDirty||fluxoPendente||KiroFluxoTela.ocupado()||$('#modal-root').firstChild)))return;
  if(manual&&(failed||modalDirty||editorDirty||fluxoPendente)&&!confirm(t('Recarregar descarta alterações ainda não salvas nesta janela. Exporte seus dados ou copie o texto antes de continuar. Recarregar?')))return;
  verificarConflitos();
  setBusy(true);
  try{
    const saved=await loadFromVault();Kiro.validateState(saved);
    if(!loaded||manual)await carregarHoje();
    const changed=state.revision!==saved.revision||!loaded;
    state=doCofre(saved);loaded=true;failed=false;eventosDoCofre(null);
    if(manual){fluxoPendente=false;clearTimeout(timerDoFluxo);}
    // Recarregar de propósito descarta a edição: a nota aberta volta ao que está no cofre.
    // Releitura automática com a nota aberta sem alterações: ela passa a mostrar o que está no cofre
    // (senão o próximo salvar gravaria por cima a versão antiga).
    if(!manual&&changed&&editing?.id&&!editorDirty){const n=getNote(editing.id);if(n)editing={...n,tags:[...(n.tags||[])],links:[...(n.links||[])]};}
    if(manual&&editing){const n=editing.id&&getNote(editing.id);editing=n?{...n,tags:[...(n.tags||[])],links:[...(n.links||[])]}:null;editorDirty=false;if(!editing)currentView='today';}
    if(manual)closeModal(true);if(changed||manual)render();status(t('Cofre atualizado'));
  }catch(error){status(t('Não foi possível ler o cofre: {erro}',{erro:mensagemDoErro(error)}),true);}
  finally{setBusy(false);fecharAbertura();}
}
async function verificarConflitos() {
  try {
    const arquivos = window.cadernoDesktop ? await window.cadernoDesktop.conflictCopies() : await api('conflicts');
    let aviso = $('#conflitos-sincronizacao');
    if (!arquivos.length) { aviso?.remove(); return; }
    if (!aviso) { aviso = document.createElement('details'); aviso.id = 'conflitos-sincronizacao'; document.body.append(aviso); }
    aviso.replaceChildren();
    const titulo = document.createElement('summary'); titulo.textContent = t('Possíveis cópias de conflito de sincronização'); aviso.append(titulo);
    const ajuda = document.createElement('p'); ajuda.textContent = t('Compare os arquivos antes de alterar qualquer cópia. Pause a sincronização e faça um backup; o Kiro não resolve conflitos automaticamente.'); aviso.append(ajuda);
    const lista = document.createElement('ul'); for (const arquivo of arquivos) { const item = document.createElement('li'); item.textContent = arquivo; lista.append(item); } aviso.append(lista);
  } catch (erro) { status(t('Não foi possível verificar conflitos: {erro}', { erro: mensagemDoErro(erro) }), true); }
}
const itemQueAbre=n=>`<div class="routine-item"><span class="brand-mark">${icone('nota')}</span><a class="routine-title" data-action="edit-note" data-id="${n.id}">${escapeHtml(n.title||t('Sem título'))}</a></div>`;
function cardCaixaDeEntrada({limite=0}={}){
  const notas=notasVisiveisNaHoje().filter(Kiro.inInbox).sort((a,b)=>(b.createdAt??b.updatedAt)-(a.createdAt??a.updatedAt));
  return `<section class="card caixa-entrada"><div class="card-head"><h2>${icone('arquivar')}${t('Caixa de entrada')}</h2><span class="small-muted">${notas.length}</span></div>${cortar(notas,limite).map(n=>`<div class="routine-item"><span class="brand-mark">${icone('nota')}</span><a class="routine-title" data-action="edit-note" data-id="${n.id}">${escapeHtml(n.title||t('Sem título'))}</a><span class="caixa-acoes">${extraButton('inbox-mover',icone('pastas'),n.id,'icon-button',t('Mover para pasta'))}${extraButton('inbox-arquivar',icone('arquivar'),n.id,'icon-button',t('Arquivar (tirar da caixa)'))}</span></div>`).join('')||`<div class="empty">${t('Nada pendente. Tudo organizado.')}</div>`}</section>`;
}
let filtroDaRevisao='todas';
function cardParaRevisar({limite=0}={}){
  const {loose,forgotten}=Kiro.toReview(notasVisiveisNaHoje());
  if(!loose.length&&!forgotten.length)return '';
  const grupos=[['soltas',t('Soltas'),loose],['esquecidas',t('Esquecidas'),forgotten]].filter(([,,notas])=>notas.length);
  if(!grupos.some(([id])=>id===filtroDaRevisao))filtroDaRevisao='todas';
  const aba=(id,rotulo,n)=>`<button type="button" class="segmento-botao" data-revisar-aba="${id}" aria-pressed="${filtroDaRevisao===id}">${rotulo}${n===undefined?'':` <span class="segmento-contagem">${n}</span>`}</button>`;
  const abas=grupos.length>1?`<div class="segmentos-compactos" role="group" aria-label="${t('Filtrar')}">${aba('todas',t('Todas'))}${grupos.map(([id,rotulo,notas])=>aba(id,rotulo,notas.length)).join('')}</div>`:'';
  const lista=([id,titulo,notas])=>`<div class="revisar-grupo" data-grupo="${id}"><h3 class="revisar-titulo">${titulo}</h3>${cortar(notas,limite).map(itemQueAbre).join('')}</div>`;
  return `<section class="card para-revisar" data-filtro="${filtroDaRevisao}"><div class="card-head"><h2>${icone('sumario')}${t('Para revisar')}</h2></div>${abas}${grupos.map(lista).join('')}</section>`;
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
  if(!$('#app > .hoje-acoes')){
    // Captura numa faixa própria logo abaixo da frase, na largura dos cards: não depende de quantas linhas a frase ocupa.
    $('.page-head').insertAdjacentHTML('afterend',`<div class="hoje-acoes"><form id="capture-form" class="capture"><label for="capture-text" class="sr-only">${t('Captura rápida')}</label>${icone('mais')}<input id="capture-text" required autocomplete="off" placeholder="${t('Capturar uma ideia, pergunta ou lembrete…')}" /><kbd class="atalho" title="${t('De qualquer tela')}">${teclaDe('captura')}</kbd><button class="primary captura-enviar" aria-label="${t('Guardar')}" title="${t('Guardar')} (Enter)">${icone('direita')}</button></form></div>`);
    // A nota diária já tem botão na barra lateral: na faixa da captura fica o Personalizar, que sai do cabeçalho.
    const personalizar=$('.page-head [data-hoje-acao="personalizar"]');
    if(personalizar)$('.hoje-acoes').append(personalizar);
    $('#capture-form').onsubmit=async e=>{e.preventDefault();if(await capturar($('#capture-text').value))$('#capture-text')?.focus();};
  }
  document.querySelectorAll('[data-revisar-aba]').forEach(b=>b.onclick=()=>{filtroDaRevisao=b.dataset.revisarAba;const card=b.closest('.para-revisar');card.dataset.filtro=filtroDaRevisao;card.querySelectorAll('[data-revisar-aba]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
  desenharPaineisDosPlugins();
}
// Título de uma nota nascida de um texto (captura, cartão do fluxo): a primeira linha sem sintaxe.
const tituloDoTexto = texto => (textoPlano(texto.split('\n')[0]).replace(/(^|\s)#(?=[\p{L}\p{N}_/-])/gu, '$1') || texto).slice(0, 80);
// Uma captura vira nota na caixa de entrada; o título é a primeira linha sem sintaxe.
async function capturar(texto){
  const body=String(texto||'').trim();if(!body||busy||failed||!loaded)return false;
  state.notes.unshift({id:uid(),title:tituloDoTexto(body),body,links:[],tags:['inbox'],createdAt:Date.now(),updatedAt:Date.now(),folderId:''});
  return save();
}
// Ctrl+Espaço de qualquer tela: no Hoje vai para a faixa de captura; fora dele abre uma janela pequena.
function capturaRapida(){
  if(!loaded||failed||busy)return;
  if(currentView==='today'&&$('#capture-text')&&!$('#modal-root').firstChild){$('#capture-text').focus();return;}
  if($('#modal-root').firstChild)return;
  modal(t('Captura rápida'),`<form class="form" id="captura-janela"><input class="search captura-janela" id="captura-janela-texto" required autocomplete="off" placeholder="${t('Capturar uma ideia, pergunta ou lembrete…')}" aria-label="${t('Captura rápida')}" /><p class="small-muted">${t('Vai para a caixa de entrada do Hoje. Enter guarda, Esc fecha.')}</p></form>`);
  const campo=$('#captura-janela-texto');
  campo.addEventListener('input',e=>e.stopPropagation()); // digitar não pede "descartar" ao fechar com Esc
  $('#captura-janela').onsubmit=async e=>{e.preventDefault();if(await capturar(campo.value))closeModal(true);};
  campo.focus();
}
// ---- Editor de documento: a nota ocupa a página inteira, como um processador de texto. ----
async function abrirNota(nota,{novaAba=false,painel,duplicar=false,colunaNova=false,ancora=''}={}){
  garantirAbasDoCofre(); // 1ª nota da sessão pode vir de fora de Pastas (Hoje etc.), antes do 1º renderCofre.
  if(editing&&editorDirty&&!await salvarNota())return;
  // O salvamento acima pode ter trocado o objeto da nota em state.notes (ela ganhou id, ou o
  // conteúdo mudou); relê pelo id para nunca reabrir a versão antiga por cima da recém-salva.
  if(nota.id)nota=getNote(nota.id)||nota;
  const novoId=idDaAba(nota);
  // Rascunho vazio (sem título, sem digitar nada) abandonado ao trocar de nota: some, não fica para
  // sempre. Quando é a troca "no lugar" (sem Ctrl/aba nova) e a nota alvo ainda não está aberta em
  // outro lugar, a nova nota assume o lugar do rascunho na aba (trocarId), em vez de fechar+abrir —
  // fechar+abrir reaproveitaria a aba vizinha que virou ativa e faria essa vizinha sumir da barra.
  if(editing&&!editing.id){
    const onde=abas.paineis.findIndex(p=>p.abas.includes(KiroAbas.RASCUNHO));
    if(onde!==-1){
      if(!novaAba&&!colunaNova&&!abas.paineis.some(p=>p.abas.includes(novoId)))abas=KiroAbas.trocarId(abas,KiroAbas.RASCUNHO,novoId);
      else abas=KiroAbas.fechar(abas,onde,KiroAbas.RASCUNHO);
    }
  }
  abas=KiroAbas.abrir(KiroAbas.comHistorico(abas),novoId,{novaAba,painel,duplicar,colunaNova});
  gravarAbas();
  editing={...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]};
  if(editing.id)ultimaNota=editing.id; // centro do grafo local
  editorDirty=false;currentView='studies';render();
  if(ancora&&editing){const achada=Kiro.resolverAncoraNaNota(editing.body,ancora);if(achada)montagemDoEditor.then(()=>rolarParaTitulo(achada.pos));}
}
async function navegarNoHistoricoDaColuna(painel, delta) {
  if (!await salvarAntesDeTrocar()) return;
  const idsValidos = [...state.notes.map(n => n.id), ...(state.fluxos || []).map(f => f.id)];
  abas = delta < 0 ? KiroAbas.voltar(abas, painel, idsValidos) : KiroAbas.avancar(abas, painel, idsValidos);
  gravarAbas();
  atualizarEditingConformeAtiva();
  render();
  const scrollSalvo = KiroAbas.scrollAtivo(abas, painel);
  if (scrollSalvo > 0) {
    montagemDoEditor.then(() => {
      const rola = document.querySelector(`.cofre-metade[data-painel="${painel}"] .cofre-nota-corpo`);
      if (rola) rola.scrollTop = scrollSalvo;
    });
  }
}
// Acha a nota pelo id (usado pela árvore e pela barra de abas) e abre.
function abrirPorId(id,opcoes){ const nota=getNote(id); if(nota)return abrirNota(nota,opcoes); const fluxo=getFluxo(id); return fluxo?abrirFluxo(fluxo,opcoes):Promise.resolve(); }
// Abre um fluxo numa aba. A nota em edição é salva antes; um rascunho vazio some, como em abrirNota.
async function abrirFluxo(fluxo,{novaAba=false,painel,duplicar=false,colunaNova=false}={}){
  garantirAbasDoCofre();
  if(editing&&editorDirty&&!await salvarNota())return;
  if(editing&&!editing.id){const onde=abas.paineis.findIndex(p=>p.abas.includes(KiroAbas.RASCUNHO));if(onde!==-1)abas=KiroAbas.fechar(abas,onde,KiroAbas.RASCUNHO);}
  abas=KiroAbas.abrir(KiroAbas.comHistorico(abas),fluxo.id,{novaAba,painel,duplicar,colunaNova});
  gravarAbas();
  editing=null;editorDirty=false;currentView='studies';render();
}
// Fluxo novo: "Sem título", "Sem título 1", … sem repetir nome (sem diferenciar maiúsculas) na pasta.
async function novoFluxo(folderId='',abrirComo={}){
  if(busy||failed||!loaded)return;
  if(!await salvarAntesDeTrocar())return;
  const usados=new Set((state.fluxos||[]).filter(f=>(f.folderId||'')===folderId).map(f=>Kiro.pathKey(f.title)));
  let title=t('Sem título'),i=1;
  while(usados.has(Kiro.pathKey(title)))title=`${t('Sem título')} ${i++}`;
  const fluxo={id:uid(),title,folderId,canvas:{nodes:[],edges:[]}};
  state.fluxos=[...(state.fluxos||[]),fluxo];
  if(folderId&&expanded)expanded.add(folderId);
  if(await save())await abrirFluxo(getFluxo(fluxo.id)||fluxo,abrirComo);
}
function fluxoModal(fluxo){
  modal(t('Renomear fluxo'),`<form class="form" id="fluxo-form"><div class="field"><label for="fluxo-nome">${t('Nome')}</label><input id="fluxo-nome" name="title" required value="${escapeHtml(fluxo.title)}" /><small class="small-muted">${t('Vira o nome do arquivo .canvas: sem &lt; &gt; : " / \\ | ? * e sem ponto ou espaço no início ou no final.')}</small></div><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button class="primary">${t('Salvar')}</button></div></form>`);
  $('#cancel').onclick=()=>closeModal();
  $('#fluxo-form').onsubmit=e=>{
    e.preventDefault();
    const title=new FormData(e.currentTarget).get('title').trim();
    if(!Kiro.validFolderName(title)){alert(t('Nome inválido. Evite < > : " / \\ | ? * , nomes reservados do Windows e ponto ou espaço no início ou no final.'));return;}
    const atual=getFluxo(fluxo.id);if(!atual)return void closeModal(true);
    if((state.fluxos||[]).some(f=>f.id!==atual.id&&(f.folderId||'')===(atual.folderId||'')&&Kiro.pathKey(f.title)===Kiro.pathKey(title))){alert(t('Já existe um fluxo com esse nome nesta pasta.'));return;}
    state.fluxos=state.fluxos.map(f=>f.id===atual.id?{...f,title}:f);
    save();closeModal(true);
  };
}
// Cartão de texto → nota na pasta do fluxo, e o cartão vira o cartão dessa nota, no mesmo lugar e
// tamanho. Duas gravações: a nota precisa existir para ter caminho no cofre.
async function transformarCartaoEmNota(fluxoId,idNo,texto){
  if(busy){status(t('Salvando… tente de novo em um instante.'),true);return false;}
  if(failed||!loaded||!getFluxo(fluxoId)?.canvas)return false;
  if(!await gravarFluxoPendente())return false;
  const corpo=String(texto).trim(),id=uid(),agora=Date.now();
  state.notes.unshift({id,title:tituloDoTexto(corpo),body:corpo,links:[],tags:[],createdAt:agora,updatedAt:agora,folderId:getFluxo(fluxoId).folderId||''});
  if(!await save())return false;
  const nota=getNote(id),fluxo=getFluxo(fluxoId);
  if(!nota?.file||!fluxo?.canvas||!fluxo.canvas.nodes.some(n=>n.id===idNo)){status(t('A nota foi criada, mas o cartão não existe mais no fluxo.'),true);return false;}
  state.fluxos=state.fluxos.map(f=>f.id===fluxoId?{...f,canvas:KiroFluxo.editarCartao(f.canvas,idNo,{type:'file',text:undefined,file:nota.file})}:f);
  if(!await save())return false;
  status(t('Cartão transformado em nota'));
  return true;
}
// Excluir: o arquivo vai para a lixeira (Configurações → Sistema → Lixeira) e pode voltar.
async function excluirFluxo(id){
  if(busy){status(t('Salvando… tente de novo em um instante.'),true);return;}
  if(failed||!loaded)return;
  const fluxo=getFluxo(id);
  if(!fluxo||!confirm(t('Excluir o fluxo "{titulo}"? Ele vai para a lixeira e pode ser restaurado.',{titulo:fluxo.title})))return;
  if(!await gravarFluxoPendente())return;
  state.fluxos=(state.fluxos||[]).filter(f=>f.id!==id);
  await save();
}
async function moverFluxo(id,folderId){
  if(busy||failed||!loaded)return;
  const fluxo=getFluxo(id);
  if(!fluxo||fluxo.erro||(fluxo.folderId||'')===folderId)return;
  if((state.fluxos||[]).some(f=>f.id!==id&&(f.folderId||'')===folderId&&Kiro.pathKey(f.title)===Kiro.pathKey(fluxo.title)))return status(t('Já existe um fluxo com esse nome na pasta de destino.'),true);
  if(folderId&&expanded)expanded.add(folderId);
  state.fluxos=state.fluxos.map(f=>f.id===id?{...f,folderId}:f);
  await save();
}
// Salva a nota em edição (se houver e estiver suja) antes de qualquer ação que possa trocar qual
// nota fica em `editing` — fechar aba, "fechar as outras", mover/arrastar para o outro lado ou
// ativar a metade em leitura. Sem isto, fechar ou mover algo do lado inativo poderia trocar a
// metade ativa (KiroAbas também faz isso) e `atualizarEditingConformeAtiva` sobrescreveria uma
// edição não salva do lado que era o ativo com a versão salva no cofre.
async function salvarAntesDeTrocar(){ return !(editing&&editorDirty)||await salvarNota(); }
// Move uma aba de `painel` para `destino` (arrastar ou "Abrir à direita/esquerda" do menu de
// contexto). Salva antes; se a aba movida era o próprio rascunho em edição, o salvamento pode ter
// trocado o id (virou nota real) — resolve o id atual em `editing` antes de mexer no modelo, senão
// o rascunho "sumiria" (o id antigo não existe mais em lugar nenhum). Só o rascunho *em edição* é
// resolvido assim: um rascunho inativo (existe na aba mas não é quem está sendo editado agora) não
// tem relação com `editing`, então mover ele não deve tocar no id de uma nota diferente e suja.
async function moverAba(painel,id,destino,{nova=false}={}){
  if(nova&&!cabeOutraColuna())return status(t('Não cabe outra coluna nesta largura. Feche uma coluna ou aumente a janela.'),true);
  const draftEmEdicao=id===KiroAbas.RASCUNHO&&editing&&!editing.id;
  if(!await salvarAntesDeTrocar())return;
  if(draftEmEdicao&&editing?.id)id=editing.id;
  abas=KiroAbas.mover(abas,painel,id,destino,{nova});
  gravarAbas();
  if(id===KiroAbas.RASCUNHO){render();return;} // ainda é o rascunho (sem salvar nada); `editing` já é ele.
  // Com colunas criadas ou removidas, o índice muda: a aba está onde o modelo diz.
  return abrirPorId(id,{painel:abas.paineis.findIndex(p=>p.abas.includes(id))});
}
// Fecha uma aba: salva a nota em edição se houver alterações; a nova aba ativa vira o editor.
async function fecharAba(painel,id){
  if(!await salvarAntesDeTrocar())return;
  abas=KiroAbas.fechar(abas,painel,id);
  gravarAbas();
  atualizarEditingConformeAtiva();
  render();
}
// Fecha todas as abas de uma coluna (a coluna some, se não for a única); salva antes.
async function fecharColuna(painel){
  if(!await salvarAntesDeTrocar())return;
  // O índice da coluna só muda quando ela esvazia, no último fechamento.
  for(const id of [...(abas.paineis[painel]?.abas||[])]) abas=KiroAbas.fechar(abas,painel,id);
  gravarAbas();
  atualizarEditingConformeAtiva();
  render();
}
// Fecha as outras abas da metade (mantém só `id`); salva a nota em edição antes, se houver.
async function fecharOutrasAbas(painel,id){
  if(!await salvarAntesDeTrocar())return;
  abas=KiroAbas.fecharOutras(abas,painel,id);
  gravarAbas();
  atualizarEditingConformeAtiva();
  render();
}
// Depois de fechar aba(s), `editing` só é reconstruído se a nota ativa mudou de fato — senão
// edições não salvas do lado que continua ativo seriam sobrescritas pela versão salva no cofre.
// Chamadores já passaram por `salvarAntesDeTrocar`, então `editorDirty` aqui deveria ser sempre
// falso; o guard abaixo é só uma rede de segurança contra descartar edição por engano.
function atualizarEditingConformeAtiva(){
  if(editing&&editorDirty)return;
  const ativa=KiroAbas.notaAtiva(abas);
  if(editing&&idDaAba(editing)===ativa)return;
  const nota=ativa===KiroAbas.RASCUNHO?notaVazia():ativa?getNote(ativa):null;
  editing=nota?{...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]}:null;
  editorDirty=false;
}
async function irPara(destino){ if(editing) return void await sairDoEditor(destino); currentView=destino; render(); }
async function sairDoEditor(destino){
  if(editorDirty&&!await salvarNota())return false;
  editing=null;currentView=destino;render();return true;
}
let modoFoco = false, metaFoco = 0;
function alternarModoFoco() {
  modoFoco = !modoFoco;
  document.querySelector('.app-shell').classList.toggle('modo-foco', modoFoco);
  const detalhes = $('#foco-detalhes'), botao = $('#doc-foco');
  if (detalhes) detalhes.hidden = !modoFoco;
  if (botao) botao.textContent = modoFoco ? t('Sair do modo foco') : t('Modo foco');
}
function atualizarFoco() {
  const saida = $('#foco-contagem');
  if (saida) saida.textContent = t('{n} palavras · meta: {meta}', { n: (editing?.body.trim().match(/\S+/g) || []).length, meta: metaFoco || '–' });
}
function renderEditor(){
  const nota=editing, pasta=state.folders.find(f=>f.id===nota.folderId);
  const opcoes=`<option value="">${t('Raiz do cofre')}</option>`+state.folders.slice().sort(byTitle).map(f=>`<option value="${f.id}" ${f.id===nota.folderId?'selected':''}>${escapeHtml(f.path||f.title)}</option>`).join('');
  const modelos=opcoesDeModelos();
  const ehFav = Boolean(nota.id && Kiro.ehFavorito(favoritos, 'nota', nota.id));
  // O "Parar gravação" só aparece gravando; as demais ações ficam no menu "Mais opções" e no botão direito.
  const botaoFav = `<button type="button" class="quiet-button" id="doc-gravar"${gravacaoAudio ? '' : ' hidden'}>${t('Parar gravação')}</button>`+(nota.id ? `<button type="button" class="icon-button doc-favorito${ehFav ? ' ativo' : ''}" id="doc-favorito" title="${ehFav ? t('Remover dos favoritos') : t('Favoritar')}" aria-label="${ehFav ? t('Remover dos favoritos') : t('Favoritar')}">${icone(ehFav ? 'estrela-cheia' : 'estrela')}</button>` : '');
  const barraBusca = `<div class="barra-busca-nota" id="barra-busca-nota"${buscaNaNota.aberta ? '' : ' hidden'}><div class="busca-nota-linha"><input type="search" id="busca-nota-termo" value="${escapeHtml(buscaNaNota.termo)}" placeholder="${t('Localizar na nota…')}" aria-label="${t('Localizar na nota')}" autocomplete="off" /><button type="button" class="chip busca-nota-aa" id="busca-nota-aa" aria-pressed="${buscaNaNota.maiusculas}" title="${t('Diferenciar maiúsculas e minúsculas')}">Aa</button><span class="small-muted busca-nota-contagem" id="busca-nota-contagem">0/0</span><button type="button" class="icon-button" id="busca-nota-ant" title="${t('Anterior')}" aria-label="${t('Anterior')}">↑</button><button type="button" class="icon-button" id="busca-nota-prox" title="${t('Próxima')}" aria-label="${t('Próxima')}">↓</button><button type="button" class="icon-button" id="busca-nota-fechar" title="${t('Fechar')}" aria-label="${t('Fechar')}">${icone('fechar')}</button></div><div class="busca-nota-linha" id="busca-nota-linha-sub"${buscaNaNota.substituir ? '' : ' hidden'}><input type="text" id="busca-nota-sub" value="${escapeHtml(buscaNaNota.substituto)}" placeholder="${t('Substituir por…')}" aria-label="${t('Substituir por')}" autocomplete="off" /><button type="button" class="secondary cfg-pequeno" id="busca-nota-trocar">${t('Substituir')}</button><button type="button" class="secondary cfg-pequeno" id="busca-nota-todas">${t('Substituir tudo')}</button></div></div>`;
  return `<div class="foco-controles"><button type="button" class="secondary cfg-pequeno" id="doc-foco">${modoFoco ? t('Sair do modo foco') : t('Modo foco')}</button><span id="foco-detalhes" ${modoFoco ? '' : 'hidden'}><label>${t('Meta de palavras')} <input type="number" min="0" id="foco-meta" value="${metaFoco || ''}" /></label> <span id="foco-contagem" role="status"></span></span></div><header class="doc-bar"><div class="crumbs"><span>${pasta?escapeHtml(pasta.path||pasta.title):t('Raiz do cofre')}</span><span>/</span><span class="crumb-atual">${escapeHtml(nota.title||t('Sem título'))}</span></div><div class="doc-bar-acoes">${botaoFav}<button type="button" class="icon-button" id="doc-mais" aria-haspopup="menu" title="${t('Mais opções da nota')}" aria-label="${t('Mais opções da nota')}">${icone('mais-opcoes')}</button><span class="doc-ponto" id="doc-state" title="${t('Alterações não salvas')}"></span></div></header>${barraBusca}
<input class="doc-title" id="doc-title" value="${escapeHtml(nota.title)}" placeholder="${t('Sem título')}" aria-label="${t('Título da nota')}" />
<section class="doc-details" id="doc-details" hidden><div class="two-cols"><div class="field"><label for="doc-folder">${t('Pasta')}</label><select id="doc-folder">${opcoes}</select></div><div class="field"><label for="doc-tags">${t('Tags (separadas por vírgulas)')}</label><input id="doc-tags" value="${escapeHtml(nota.tags.join(', '))}" placeholder="${t('ideias, estudos')}" /></div></div><div class="two-cols"><div class="field"><label for="doc-template">${t('Modelo')}</label><select id="doc-template"><option value="">${t('Escolher modelo…')}</option>${modelos}</select></div><div class="field"><label for="doc-link">${t('Anexar link')}</label><div class="add-link"><input id="doc-link" placeholder="${t('Cole um link de aula ou vídeo')}" /><button type="button" class="secondary" id="doc-link-add">${t('Anexar')}</button></div></div></div><div class="links-list" id="doc-links"></div></section>
<div class="doc-corpo" id="doc-corpo"></div>${renderMencoes(nota)}`;
}
// Quem cita esta nota, com a linha do [[link]] como trecho. Nota ainda não salva não tem quem a cite.
// "Mencionada em" no pé da nota: opcional, desligado por padrão (Configurações → Personalização).
let mostrarMencoes = lerPreferencia('mostrarMencoes') === '1';
function renderMencoes(nota){
  if(!mostrarMencoes||!nota.id)return '';
  const citam=Kiro.mentions(state.notes,nota); if(!citam.length)return '';
  const resolve=l=>Kiro.findLinkedNote(state.notes,l.target)?.id===nota.id;
  const itens=citam.map(n=>{
    const linha=n.body.split('\n').find(l=>Kiro.wikiLinks(l).some(resolve))||'';
    return `<div class="mencao">${linkDaNota(n)}<span class="small-muted">${escapeHtml(textoPlano(linha).slice(0,160))}</span></div>`;
  }).join('');
  return `<section class="doc-mencoes"><h2 class="small-muted">${t('Mencionada em ({n})',{n:citam.length})}</h2>${itens}</section>`;
}
let buscaNaNota = { aberta: false, substituir: false, termo: '', substituto: '', maiusculas: false, indice: 0, faixas: [] };
function atualizarBuscaNaNota(rolar = true) {
  if (!editing || !buscaNaNota.aberta) {
    buscaNaNota.faixas = [];
    editorDaNota?.editor.destacarBusca?.([], -1, false);
    return;
  }
  const faixas = Kiro.buscarNoTexto(editing.body, buscaNaNota.termo, { diferenciarMaiusculas: buscaNaNota.maiusculas });
  buscaNaNota.faixas = faixas;
  if (!faixas.length) buscaNaNota.indice = -1;
  else if (buscaNaNota.indice < 0 || buscaNaNota.indice >= faixas.length) buscaNaNota.indice = 0;
  const cont = $('#busca-nota-contagem');
  if (cont) cont.textContent = faixas.length ? `${buscaNaNota.indice + 1}/${faixas.length}` : '0/0';
  editorDaNota?.editor.destacarBusca?.(faixas, buscaNaNota.indice, rolar);
}
function abrirBuscaNaNota(comSubstituir = false) {
  if (currentView !== 'studies' || !editing) return;
  buscaNaNota.aberta = true;
  buscaNaNota.substituir = Boolean(comSubstituir);
  const barra = $('#barra-busca-nota');
  if (!barra) return;
  barra.hidden = false;
  const sub = $('#busca-nota-linha-sub');
  if (sub) sub.hidden = !buscaNaNota.substituir;
  atualizarBuscaNaNota(true);
  const campo = $('#busca-nota-termo');
  if (campo) { campo.focus(); campo.select(); }
}
function fecharBuscaNaNota() {
  buscaNaNota.aberta = false;
  const barra = $('#barra-busca-nota');
  if (barra) barra.hidden = true;
  editorDaNota?.editor.destacarBusca?.([], -1, false);
  editorDaNota?.editor.focar?.();
}
function bindBuscaNaNota() {
  const barra = $('#barra-busca-nota');
  if (!barra) return;
  const termo = $('#busca-nota-termo'), sub = $('#busca-nota-sub'), aa = $('#busca-nota-aa');
  termo?.addEventListener('input', () => { buscaNaNota.termo = termo.value; buscaNaNota.indice = 0; atualizarBuscaNaNota(true); });
  termo?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); fecharBuscaNaNota(); }
    else if (e.key === 'Enter' && buscaNaNota.faixas.length) {
      e.preventDefault();
      const total = buscaNaNota.faixas.length;
      buscaNaNota.indice = (buscaNaNota.indice + (e.shiftKey ? total - 1 : 1)) % total;
      atualizarBuscaNaNota(true);
    }
  });
  sub?.addEventListener('input', () => { buscaNaNota.substituto = sub.value; });
  sub?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); fecharBuscaNaNota(); }
    else if (e.key === 'Enter') { e.preventDefault(); $('#busca-nota-trocar')?.click(); }
  });
  aa?.addEventListener('click', () => {
    buscaNaNota.maiusculas = !buscaNaNota.maiusculas;
    aa.setAttribute('aria-pressed', String(buscaNaNota.maiusculas));
    buscaNaNota.indice = 0;
    atualizarBuscaNaNota(true);
  });
  $('#busca-nota-ant')?.addEventListener('click', () => {
    const total = buscaNaNota.faixas.length;
    if (!total) return;
    buscaNaNota.indice = (buscaNaNota.indice + total - 1) % total;
    atualizarBuscaNaNota(true);
  });
  $('#busca-nota-prox')?.addEventListener('click', () => {
    const total = buscaNaNota.faixas.length;
    if (!total) return;
    buscaNaNota.indice = (buscaNaNota.indice + 1) % total;
    atualizarBuscaNaNota(true);
  });
  $('#busca-nota-fechar')?.addEventListener('click', fecharBuscaNaNota);
  $('#busca-nota-trocar')?.addEventListener('click', () => {
    const f = buscaNaNota.faixas[buscaNaNota.indice];
    if (!f || !editing) return;
    if (editorDaNota?.editor) {
      editorDaNota.editor.trocarTrecho(f.de, f.ate, buscaNaNota.substituto);
    } else {
      const r = Kiro.substituirNoTexto(editing.body, f, buscaNaNota.substituto);
      editing.body = r.texto; editorDirty = true; estadoDoc();
    }
    atualizarBuscaNaNota(true);
  });
  $('#busca-nota-todas')?.addEventListener('click', () => {
    if (!buscaNaNota.faixas.length || !editing) return;
    if (editorDaNota?.editor?.substituirTodas) {
      editorDaNota.editor.substituirTodas(buscaNaNota.faixas, buscaNaNota.substituto);
    } else {
      const r = Kiro.substituirTodosNoTexto(editing.body, buscaNaNota.termo, buscaNaNota.substituto, { diferenciarMaiusculas: buscaNaNota.maiusculas });
      editing.body = r.texto; editorDirty = true; estadoDoc();
    }
    atualizarBuscaNaNota(false);
  });
  if (buscaNaNota.aberta) atualizarBuscaNaNota(false);
}
function estadoDoc(){ $('#doc-state')?.classList.toggle('sujo', editorDirty); if(editorDirty){versaoDoEditor++;agendarAutosaveNota();} }
function desenharLinksDoc(){
  const caixa=$('#doc-links'); if(!caixa) return;
  caixa.innerHTML=editing.links.map((l,i)=>`<div class="link-row"><a href="${escapeHtml(Kiro.safeUrl(l)||'#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a><button class="icon-button" type="button" data-remove-link="${i}" title="${t('Remover link')}" aria-label="${t('Remover link')}">${icone('fechar')}</button></div>`).join('');
  caixa.querySelectorAll('[data-remove-link]').forEach(b=>b.onclick=()=>{editing.links.splice(+b.dataset.removeLink,1);editorDirty=true;estadoDoc();desenharLinksDoc();});
}
function bindEditor(){
  const titulo=$('#doc-title'), corpo=$('#doc-corpo');
  document.querySelector('.app-shell').classList.toggle('modo-foco', modoFoco);
  $('#doc-foco').onclick = alternarModoFoco;
  $('#foco-meta').oninput = e => { metaFoco = Math.max(0, Number(e.target.value) || 0); atualizarFoco(); };
  atualizarFoco();
  const sujar=()=>{editorDirty=true;estadoDoc();};
  titulo.oninput=()=>{editing.title=titulo.value;sujar();};
  // Enter ou seta para baixo no título descem para o texto, como num processador de texto.
  titulo.onkeydown=e=>{
    if(e.key!=='Enter'&&e.key!=='ArrowDown')return;
    e.preventDefault();
    editorDaNota?.editor.focar('inicio');
  };
  $('#doc-folder').onchange=e=>{editing.folderId=e.target.value;sujar();};
  $('#doc-tags').oninput=e=>{editing.tags=e.target.value.split(',').map(t=>t.trim().replace(/^#/,'')).filter(Boolean);sujar();};
  $('#doc-template').onchange=e=>{
    if(!e.target.value)return;
    aplicarModeloNaNota(e.target.value);e.target.value='';
  };
  $('#doc-link-add').onclick=()=>{
    const campo=$('#doc-link'), valor=campo.value.trim();
    if(!Kiro.safeUrl(valor)){alert(t('Informe um endereço http:// ou https:// válido.'));return;}
    editing.links.push(valor);campo.value='';sujar();desenharLinksDoc();
  };
  const montado=montagemDoEditor=montarEditorDaNota(corpo);
  document.querySelectorAll('[data-editor]').forEach(b=>b.onclick=()=>acaoEditor(b.dataset.editor));
  $('#doc-favorito')?.addEventListener('click', () => { if (editing?.id) alternarItemFavorito({ tipo: 'nota', alvo: editing.id, titulo: editing.title }); });
  $('#doc-gravar')?.addEventListener('click', () => gravarAudio());
  $('#doc-mais')?.addEventListener('click', e => {
    const botao = e.currentTarget;
    if (menuAberto?._origem === botao) return void fecharMenuContexto();
    const r = botao.getBoundingClientRect();
    abrirMenuContexto({ preventDefault() {}, clientX: r.left, clientY: r.bottom + 4 }, document.body, acoesDaNota(), { compacto: true, origem: botao, direita: r.right });
  });
  bindBuscaNaNota();
  desenharLinksDoc();estadoDoc();
  // Nota nova começa pelo título; nota existente sem texto já abre o campo para escrever.
  // (o editor pode ainda estar carregando: o foco espera a montagem)
  if(!editing.id)titulo.focus({preventScroll:true});
  else if(!editing.body.trim())montado.then(editor=>{if(editor&&editorDaNota?.editor===editor)editor.focar('fim');});
}
// O corpo da nota é um editor CodeMirror (editor-nota.js). A instância vive enquanto a mesma nota
// está aberta: um redesenho (salvar, releitura) recoloca o mesmo editor no lugar novo, com cursor,
// rolagem e desfazer intactos.
let editorDaNota = null; // { chave, editor }
let montagemDoEditor = Promise.resolve(null);   // a montagem em curso (ou a última): quem precisa do editor espera por ela
const chaveDaNota = nota => nota.id || 'rascunho';
function opcoesDoEditor({ atual = () => editorDaNota?.editor, menu = menuDaNota } = {}) {
  return {
    ortografia: { ativa: corretorLigado, errada: p => KiroOrtografia.errada(p) },
    aoMudar: texto => { if (!editing) return; editing.body = texto; editorDirty = true; estadoDoc(); atualizarFoco(); if (buscaNaNota.aberta) atualizarBuscaNaNota(false); },
    existe: alvo => { const { target } = Kiro.parseWikiLink(alvo); return !target || Boolean(Kiro.findLinkedNote(state.notes, target)); },
    aoTeclar: evento => Boolean(sugestao && teclaNaSugestao(evento)),
    aoMoverCursor: () => atualizarSugestoes(editorDaNota?.editor.area()),
    aoColar: evento => {
      const arquivos = imagensDoEvento(evento.clipboardData || evento.dataTransfer);
      if (!arquivos.length) {
        const tabela=evento.clipboardData&&Kiro.csvParaTabela(evento.clipboardData.getData('text/plain'));
        if(!tabela)return false;
        const area=editorDaNota.editor.area(), antes=area.value.slice(0,area.selectionStart), depois=area.value.slice(area.selectionEnd);
        evento.preventDefault();inserirTexto(area,(antes&&!antes.endsWith('\n')?'\n':'')+tabela+(depois&&!depois.startsWith('\n')?'\n':''));return true;
      }
      evento.preventDefault();
      colarImagens(editorDaNota.editor.area(), arquivos);
      return true;
    },
    aoMenu: evento => {
      if (evento.shiftKey && !window.cadernoDesktop) return;
      const editor = atual(), area = editor.area();
      const alvo = corretorLigado && KiroOrtografia.pronto() ? editor.palavraEm(evento.clientX, evento.clientY) : null;
      if (alvo && KiroOrtografia.errada(alvo.palavra)) {
        evento.preventDefault();
        const doCorretor = KiroCorretor.itensDoCorretor({ palavra: alvo.palavra, sugestoes: KiroOrtografia.sugestoes(alvo.palavra) }, {
          trocar: s => editor.trocarTrecho(alvo.de, alvo.ate, s, alvo.palavra),
          adicionar: p => adicionarAoDicionario(p),
          t, icone,
        });
        return abrirMenuContexto(evento, area, [...doCorretor, ...(menu().length ? [{ separador: true }, ...menu()] : [])]);
      }
      const itens = menu();
      if (!itens.length) return;   // sem itens (cartão do Fluxo): o menu do navegador
      abrirMenuContexto(evento, area, itens);
    },
    widgets: {
      desenharFormula: (tex, bloco) => matematica(tex, bloco),
      desenharImagem: texto => { const img = lerImagem(texto); return img ? htmlDaImagem(img) : null; },
      desenharPdf: texto => { const pdf = Kiro.lerPdf ? Kiro.lerPdf(texto) : null; return pdf ? htmlDoPdf(pdf) : null; },
      desenharAudio: texto => htmlDoAudio(texto),
      abrirImagem: (caminho, nome) => abrirImagemInteira(urlDoAnexo(caminho), nome),
      abrirNota: alvo => { const { target, ref } = Kiro.parseWikiLink(alvo); if (!target && ref && editing) { const a = Kiro.resolverAncoraNaNota(editing.body, ref); if (a) rolarParaTitulo(a.pos); return; } return abrirNota(Kiro.findLinkedNote(state.notes, target) || notaVazia({ title: target }), { ancora: ref }); },
      abrirSite: url => { const limpa = Kiro.safeUrl(url); if (limpa) window.open(limpa, '_blank', 'noopener,noreferrer'); },
      buscarEtiqueta: texto => buscarEtiqueta(texto),
      copiar: async texto => { const ok = await copiarTexto(texto); if (!ok) status(t('O navegador não liberou a área de transferência.'), true); return ok; },
      desenharBlocoPlugin: (id, fonte) => htmlDoBlocoPlugin(id, fonte),
      tarefa: id => infoDaTarefaCitada(id),
      alternarTarefa: id => alternarTarefa(id),
      abrirTarefa: id => { const x = state.tasks.find(y => y.id === id); if (x) taskModal(x); },
    },
  };
}
// Caixinha da tarefa: conclui ou reabre a tarefa imediatamente na tela e grava sem piscar.
async function alternarTarefa(id) {
  const tarefa = state.tasks.find(x => x.id === id);
  if (!tarefa || busy || failed || !loaded) return;
  const antes = state.tasks;
  state.tasks = state.tasks.map(x => x.id === id ? { ...x, done: !x.done } : x);
  criarProximas(antes);
  if (typeof render === 'function') render();
  const salvo = await save(null, 0, { semRender: true });
  updateCount();
  editorDaNota?.editor.redesenhar?.();
  if (salvo) status(tarefa.done
    ? t('Tarefa {titulo} reaberta.', { titulo: tarefa.title })
    : t('Tarefa {titulo} concluída.', { titulo: tarefa.title }));
}
const infoDaTarefaCitada = id => { const x = state.tasks.find(y => y.id === id); return x ? { titulo: x.title, feita: x.done, data: dateLabel(x.due), atrasada: !x.done && x.due < today() } : null; };
async function montarEditorDaNota(corpo) {
  const chave = chaveDaNota(editing);
  if (editorDaNota?.chave === chave) {
    corpo.replaceChildren(editorDaNota.editor.dom);
    editorDaNota.editor.definirTexto(editing.body);
    return editorDaNota.editor;
  }
  editorDaNota?.editor.destruir(); editorDaNota = null;
  try { await KiroEditor.carregar(); }
  catch {
    status(t('Não foi possível carregar o editor'), true);
    const campo = Object.assign(document.createElement('textarea'), { className: 'doc-corpo-simples', value: editing.body });
    campo.addEventListener('input', () => { editing.body = campo.value; editorDirty = true; estadoDoc(); atualizarFoco(); });
    corpo.replaceChildren(campo);
    return null;
  }
  if (!corpo.isConnected || chaveDaNota(editing || {}) !== chave) return null;   // trocou de nota enquanto carregava
  const editor = KiroEditor.montar(corpo, { texto: editing.body, ...opcoesDoEditor() });
  editorDaNota = { chave, editor };
  setTimeout(iniciarOrtografia, 0);   // fora do caminho da abertura
  return editor;
}
// Cartão de texto do Fluxo: o mesmo editor do corpo da nota (corretor, fórmulas, links), sem o
// salvar da nota nem as sugestões de [[. Sem o CodeMirror carregado, o Fluxo usa o textarea.
let editorDoCartao = null;
function montarEditorDoCartao(elemento, { texto }) {
  if (!window.CM || !window.KiroEditor) return null;
  const base = opcoesDoEditor({ atual: () => editorDoCartao, menu: () => [] });
  const editor = KiroEditor.montar(elemento, { texto, rotulo: t('Texto do cartão'), placeholder: '', ortografia: base.ortografia, existe: base.existe, widgets: base.widgets, aoMenu: base.aoMenu });
  editorDoCartao = editor;
  const destruir = editor.destruir;
  editor.destruir = () => { if (editorDoCartao === editor) editorDoCartao = null; destruir(); };
  setTimeout(iniciarOrtografia, 0);
  return editor;
}
// ---- Grafo de conexões ----
// As ligações são derivadas do texto, como no resto do Kiro: não há índice a
// manter. Simulação de forças escrita à mão porque a CSP é script-src 'self':
// nada de biblioteca por CDN, e o app não tem etapa de build.
// As opções da tela ficam no navegador, como a aparência: são preferência de
// visualização, não dado do cofre.
const GRAFO_PADRAO = {
  busca: '', etiquetas: false, anexos: false, tarefas: true, somenteExistentes: false, orfaos: true,
  setas: false, rotulos: 0.6, tamanho: 1, grossura: 1,
  centripeta: 0.5, repulsao: 1, forcaLinks: 1, distancia: 95,
  local: false, profundidade: 1,
  corSolta: '#FFFFFF', grupos: [], painel: false, secoes: { filtros: true, grupos: true, tela: true, forcas: true },
};
const CORES_DE_GRUPO = ['#4EA8DE', '#57CC99', '#FFB703', '#FF6B6B', '#F72585', '#C77DFF'];
const FILTROS = ['etiquetas', 'anexos', 'tarefas', 'somenteExistentes', 'orfaos', 'local', 'profundidade'];
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
  for (const nota of state.notes) nos.set(nota.id, { id: nota.id, rotulo: nota.title || t('Sem título'), tipo: 'nota', pasta: corDaPasta(nota.folderId), grau: 0, entradas: 0, procura: `${nota.title || ''} ${Kiro.tags(nota).join(' ')}` });
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
  if (op.tarefas) for (const tarefa of state.tasks) {
    const chave = `tarefa:${tarefa.id}`, ligadas = new Set(Kiro.notesCitingTask(state.notes, tarefa.id).map(n => n.id));
    if (tarefa.noteId && nos.has(tarefa.noteId)) ligadas.add(tarefa.noteId);
    nos.set(chave, { id: chave, rotulo: tarefa.title, tipo: 'tarefa', feita: tarefa.done, tarefaId: tarefa.id, grau: 0, entradas: 0, procura: tarefa.title });
    for (const nota of ligadas) ligar(nota, chave);
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
    ? (centro ? t('ao redor de “{titulo}”', { titulo: centro.title }) : t('abra uma nota para centrar o grafo')) + ' · '
    : '';
  return `${volta}${notas === 1 ? t('1 nota') : t('{n} notas', { n: notas })} · ${ligacoes.length === 1 ? t('1 ligação') : t('{n} ligações', { n: ligacoes.length })}`;
}

function listaDasLigacoes({ nos, arestas }, aceita = () => true) {
  const porId = new Map(nos.map(no => [no.id, no]));
  const rotulo = no => {
    const texto = escapeHtml(no.rotulo);
    if (no.tipo === 'nota') return `<button type="button" class="quiet-button" data-action="edit-note" data-id="${escapeHtml(no.id)}">${texto}</button>`;
    if (no.tipo === 'tarefa') return `<button type="button" class="quiet-button" data-action="edit-task" data-id="${escapeHtml(no.tarefaId)}">${texto}</button>`;
    return `<span>${texto}${no.tipo === 'fantasma' ? ` (${t('Nota inexistente')})` : ''}</span>`;
  };
  const linhas = arestas.filter(a => porId.has(a.de) && porId.has(a.para) && (aceita(porId.get(a.de)) || aceita(porId.get(a.para))))
    .map(a => `<li>${rotulo(porId.get(a.de))} <span>${t('liga a')}</span> ${rotulo(porId.get(a.para))}</li>`);
  return linhas.length ? `<ul>${linhas.join('')}</ul>` : `<p class="small-muted">${t('Nenhuma ligação com os filtros atuais.')}</p>`;
}

function renderGraph() {
  const { nos, arestas } = grafoDados();
  const resumo = escapeHtml(textoDoResumo(nos, arestas));
  const vazio = state.notes.length
    ? ''
    : `<div class="grafo-vazio">${t('Escreva [[Nome da nota]] em alguma nota para as ligações aparecerem aqui.')}</div>`;
  return `<div class="grafo-tela${grafoOpcoes.painel ? '' : ' sem-painel'}" id="grafo-tela">
  <svg id="graph-svg" role="img" aria-label="${t('Grafo de conexões entre as notas')}"></svg>
  ${vazio}
  <span class="grafo-resumo small-muted">${resumo}</span>
  <details class="grafo-lista"><summary>${t('Ligações em texto')}</summary><div id="grafo-ligacoes">${listaDasLigacoes({ nos, arestas })}</div></details>
  <button class="icon-button grafo-abrir" id="grafo-abrir" title="${t('Mostrar opções')}" aria-label="${t('Mostrar opções')}">${icone('detalhes')}</button>
  <aside class="grafo-painel" id="grafo-painel" aria-label="${t('Opções do grafo')}">
    ${grafoSecao('filtros', t('Filtros'), `
      <input class="grafo-busca" type="search" data-opcao="busca" value="${escapeHtml(grafoOpcoes.busca)}" placeholder="${t('Procurar notas…')}" aria-label="${t('Procurar notas')}" />
      ${grafoChave('etiquetas', t('Etiquetas'))}
      ${grafoChave('anexos', t('Anexos'))}
      ${grafoChave('tarefas', t('Tarefas'))}
      ${grafoChave('somenteExistentes', t('Apenas notas existentes'))}
      ${grafoChave('orfaos', t('Órfãs'))}
      ${grafoChave('local', t('Somente ao redor da nota aberta'))}
      ${grafoFaixa('profundidade', t('Passos a partir dela'), 1, 3, 1)}`,
      `<span class="grafo-topo-acoes">
        <button class="icon-button" id="grafo-restaurar" title="${t('Voltar ao padrão')}" aria-label="${t('Voltar ao padrão')}">${icone('recarregar')}</button>
        <button class="icon-button" id="grafo-fechar" title="${t('Esconder opções')}" aria-label="${t('Esconder opções')}">${icone('fechar')}</button>
      </span>`)}
    ${grafoSecao('grupos', t('Grupos'), `
      <div id="grafo-grupos"></div>
      <button class="secondary" id="grafo-novo-grupo">${t('Criar novo grupo')}</button>`)}
    ${grafoSecao('tela', t('Tela'), `
      ${grafoChave('setas', t('Setas'))}
      ${grafoFaixa('rotulos', t('Limite dos rótulos'), 0, 2, 0.05)}
      ${grafoFaixa('tamanho', t('Tamanho dos pontos'), 0.4, 2.5, 0.05)}
      ${grafoFaixa('grossura', t('Grossura dos links'), 0.3, 3, 0.05)}
      <label class="grafo-linha"><span>${t('Notas sem cor de pasta')}</span><input type="color" class="grafo-cor-solta" data-opcao="corSolta" value="${corValida(grafoOpcoes.corSolta) ? grafoOpcoes.corSolta : GRAFO_PADRAO.corSolta}" aria-label="${t('Cor das notas sem cor de pasta')}" /></label>
      <button class="secondary" id="grafo-animar">${t('Animar')}</button>`)}
    ${grafoSecao('forcas', t('Forças'), `
      ${grafoFaixa('centripeta', t('Força centrípeta'), 0, 2, 0.02)}
      ${grafoFaixa('repulsao', t('Força de repulsão'), 0.1, 4, 0.05)}
      ${grafoFaixa('forcaLinks', t('Força dos links'), 0, 3, 0.05)}
      ${grafoFaixa('distancia', t('Distância dos links'), 40, 400, 5)}`)}
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
  const caminhosDasPastas = () => Kiro.folderPaths(state.folders || []);
  const bateConsultaNo = (no, consulta) => {
    const q = String(consulta || '').trim();
    if (!q) return false;
    if (no.tipo === 'nota') {
      const nota = getNote(no.id);
      if (nota) {
        const caminhos = caminhosDasPastas();
        return Kiro.avaliarConsulta(Kiro.compilarConsulta(q), nota, { caminhoDaPasta: n => (n && n.folderId && caminhos.get(n.folderId)) || '' });
      }
    }
    return procuravel(no).includes(Kiro.normalize(q));
  };
  const corDoNo = no => grafoOpcoes.grupos.find(g => g.consulta.trim() && bateConsultaNo(no, g.consulta))?.cor || '';

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
    $('#grafo-ligacoes').innerHTML = listaDasLigacoes({ nos, arestas: ligacoes.map(l => ({ de: l.a.id, para: l.b.id })) }, no => !busca || bateConsultaNo(no, grafoOpcoes.busca));
    // Cor padrão = a do tema (--graph-node); só uma cor escolhida no painel vai inline.
    const corSolta = corValida(grafoOpcoes.corSolta) && grafoOpcoes.corSolta.toUpperCase() !== GRAFO_PADRAO.corSolta ? grafoOpcoes.corSolta : '';
    if (corSolta) tela.style.setProperty('--grafo-solta', corSolta); else tela.style.removeProperty('--grafo-solta');
    for (const no of nos) {
      const r = raio(no);
      no.circulo.setAttribute('r', r);
      no.alvo.setAttribute('r', r + 9);
      no.texto.setAttribute('y', r + 13);
      no.circulo.style.fill = corDoNo(no);
      no.el.classList.toggle('filtrado', Boolean(busca) && !bateConsultaNo(no, grafoOpcoes.busca));
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
    svg.innerHTML = '<defs><marker id="grafo-seta" viewBox="0 0 8 8" refX="9" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8z" style="fill:var(--graph-edge)" /></marker></defs>';
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
      no.el.setAttribute('class', `graph-node tipo-${no.tipo}${no.feita ? ' feita' : ''}`);
      if (no.pasta) no.el.setAttribute('data-cor-pasta', no.pasta);
      no.alvo = document.createElementNS(ns, 'circle');
      no.alvo.setAttribute('class', 'graph-hit');
      no.circulo = document.createElementNS(ns, 'circle');
      no.texto = document.createElementNS(ns, 'text');
      no.texto.textContent = no.rotulo.length > 26 ? `${no.rotulo.slice(0, 25)}…` : no.rotulo;
      no.el.append(no.alvo, no.circulo, no.texto);
      if (no.tipo === 'nota') no.el.addEventListener('click', () => { if (!arrastou) abrirNota(getNote(no.id)); });
      if (no.tipo === 'tarefa') no.el.addEventListener('click', () => { const x = state.tasks.find(y => y.id === no.tarefaId); if (!arrastou && x) taskModal(x); });
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
  });
  svg.addEventListener('pointermove', evento => {
    if (!ultimo) return;
    const dx = evento.clientX - ultimo.x, dy = evento.clientY - ultimo.y;
    // Capturar só ao arrastar: capturado desde o aperto, o clique iria para o svg, e não para o nó.
    if (!arrastou && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { arrastou = true; svg.setPointerCapture(evento.pointerId); }
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
      `<div class="grafo-grupo"><button class="grafo-cor" data-cor="${i}" style="background:${grupo.cor}" title="${t('Trocar a cor')}" aria-label="${t('Trocar a cor')}"></button>` +
      `<input data-grupo="${i}" value="${escapeHtml(grupo.consulta)}" placeholder="${t('palavra do título')}" aria-label="${t('Palavra do grupo')}" />` +
      `<button class="icon-button" data-remover="${i}" title="${t('Remover grupo')}" aria-label="${t('Remover grupo')}">${icone('fechar')}</button></div>`).join('');
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
  return `<span class="md-imagem" data-nome="${nome}"><img src="${escapeHtml(urlDoAnexo(caminho))}" alt="${nome}" draggable="false"${largura ? ` style="width:${largura}px"` : ''} /><span class="md-alca" title="${t('Arraste para redimensionar')}" aria-hidden="true"></span></span>`;
}
function htmlDoAudio(caminho){
  caminho=String(caminho).trim();
  if(!Kiro.isAudioPath(caminho)||/[:\\]|\.\.|^\//.test(caminho))return '';
  return `<audio controls preload="metadata" src="${escapeHtml(urlDoAnexo(caminho))}" aria-label="${escapeHtml(caminho.split('/').pop())}"></audio>`;
}
// PDF em nota: o webview nunca recebe os bytes do PDF — cada página é um <img>
// rasterizado pelo PDF.js (pdf-nota.js), pedido à medida que se rola. O iframe do
// visor nativo saiu de cena: no Electron ele nem renderiza, e entregar um PDF
// hostil ao viewer nativo é justamente o que o desenho do OpenSIDian evita.
function htmlDoPdf(pdf) {
  if (!pdf) return '';
  const nome = escapeHtml(pdf.arquivo.split('/').pop());
  const caminho = escapeHtml(pdf.arquivo);
  const url = `${urlDoAnexo(pdf.arquivo)}${pdf.pagina ? `#page=${pdf.pagina}` : ''}`;
  const alt = pdf.altura || 480;
  return `<details class="md-pdf"${pdf.aberto ? ' open' : ''} data-pdf="${caminho}"${pdf.pagina ? ` data-pagina="${pdf.pagina}"` : ''}><summary class="md-pdf-topo"><span class="md-pdf-titulo">${icone('direita')} ${icone('notas')} ${nome}${pdf.pagina ? ` · p. ${pdf.pagina}` : ''}<span class="md-pdf-total"></span></span><span class="md-pdf-acoes"><span class="md-pdf-mostrar">${t('Mostrar PDF')}</span><span class="md-pdf-recolher">${t('Recolher PDF')}</span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="secondary cfg-pequeno md-pdf-abrir">${t('Abrir')}</a></span></summary><div class="md-pdf-paginas" style="height:${alt}px"></div></details>`;
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
    // O KaTeX quebra linha dentro do caminho SVG da raiz e das chaves; parágrafos e citações
    // trocam \n por <br />, o que partia o desenho. No SVG, quebra de linha vale espaço.
    return katex.renderToString(fonte, { displayMode: bloco, throwOnError: false, output: 'html', strict: false, trust: false }).replace(/\n/g, ' ');
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
      if (imagem) return reservar(htmlDaImagem(imagem));
      const pdf = Kiro.lerPdf ? Kiro.lerPdf(desescapar(dentro)) : null;
      if(pdf)return reservar(htmlDoPdf(pdf));
      const audio=htmlDoAudio(desescapar(dentro));return audio?reservar(audio):inteiro;
    })
    .replace(/\[\[tarefa:([^\][\n|]+)(?:\|([^\][\n]*))?\]\]/gi, (_, id, rotulo = '') => {
      const info = infoDaTarefaCitada(desescapar(id.trim()));
      if (!info) return reservar(`<span class="tarefa-citada ausente"><span class="tarefa-citada-titulo">${rotulo.trim() || t('Tarefa apagada')}</span></span>`);
      const tid = escapeHtml(desescapar(id.trim()));
      return reservar(`<span class="tarefa-citada${info.feita ? ' feita' : ''}"><button type="button" class="check ${info.feita ? 'done' : ''}" data-action="toggle-task" data-id="${tid}" aria-label="${info.feita ? t('Marcar como não concluído') : t('Marcar como concluído')}"></button><a class="tarefa-citada-titulo" data-action="edit-task" data-id="${tid}" title="${t('Abrir tarefa')}">${escapeHtml(info.titulo)}</a><small class="tarefa-citada-data${info.atrasada ? ' atrasada' : ''}">${escapeHtml(info.data)}</small></span>`);
    })
    .replace(/\[\[([^\][\n]+)\]\]/g, (_, dentro) => {
      const [alvoBruto, rotuloBruto] = dentro.split('|');
      const alvo = alvoBruto.split('#')[0].trim();
      const rotulo = (rotuloBruto || alvoBruto).trim();
      { const { target: alvoDes, ref: ancora } = Kiro.parseWikiLink(desescapar(alvoBruto)); const nota = alvoDes ? Kiro.findLinkedNote(state.notes, alvoDes) : editing; return reservar(`<a class="wikilink${nota ? '' : ' ausente'}" data-alvo="${alvo}"${ancora ? ` data-ancora="${escapeHtml(ancora)}"` : ''}${nota?.id ? ` data-id="${nota.id}"` : ''} title="${nota ? t('Abrir nota') : t('Nota ainda não criada')}">${rotulo}</a>`); }
      { const { target: alvoDes, ref: ancora } = Kiro.parseWikiLink(desescapar(alvoBruto)); const nota = alvoDes ? Kiro.findLinkedNote(state.notes, alvoDes) : editing; return reservar(`<a class="wikilink${nota ? '' : ' ausente'}" data-alvo="${alvo}"${ancora ? ` data-ancora="${escapeHtml(ancora)}"` : ''}${nota?.id ? ` data-id="${nota.id}"` : ''} title="${nota ? t('Abrir nota') : t('Nota ainda não criada')}">${rotulo}</a>`); }
    })
    .replace(/\[([^\][\n]*)\]\(([^)\s]+)\)/g, (inteiro, rotulo, url) => {
      const limpa = Kiro.safeUrl(desescapar(url));
      return limpa ? reservar(`<a href="${escapeHtml(limpa)}" target="_blank" rel="noopener noreferrer">${rotulo || url}</a>`) : inteiro;
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
function renderizarMarkdown(fonte, base = 0, impressao = false) {
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
      const linguagem = escapeHtml(cerca[1].trim() || t('texto'));
      const ate = Math.min(j + 1, linhas.length);
      // ```kiro:<id>: o plug-in desenha depois; a fonte fica na nota, intacta.
      const doPlugin = cerca[1].trim().match(/^kiro:([a-z0-9][a-z0-9-]{1,39})$/);
      if (doPlugin && !impressao) {
        const fonteDoBloco = corpo.join('\n').replace(/\r$/gm, ''); // a mesma fonte que o editor manda (sem \r)
        saida.push(htmlDoBlocoPlugin(doPlugin[1], fonteDoBloco, abrir(inicio, ate)));
        avancar(ate - i);
        i = j + 1;
        continue;
      }
      saida.push(`<figure class="code-area" ${abrir(inicio, ate)}><figcaption><span class="code-lang">${linguagem}</span><button type="button" class="secondary code-copy">${t('Copiar')}</button></figcaption><pre><code>${codigo}</code></pre></figure>`);
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
    const cabecalho=Kiro.celulasTabela(linha), separador=Kiro.celulasTabela(linhas[i+1]||'');
    if(cabecalho?.length>=2&&separador?.length===cabecalho.length&&separador.every(c=>/^:?-{3,}:?$/.test(c))){
      const linhasTabela=[];let j=i+2;
      while(j<linhas.length){const c=Kiro.celulasTabela(linhas[j]);if(!c||c.length!==cabecalho.length)break;linhasTabela.push(c);j++;}
      const celula=c=>escapeHtml(c).replace(/\\([\\|])/g,'$1').replace(/&lt;br&gt;/g,'<br>');
      saida.push(`<table ${abrir(inicio,j)}><thead><tr>${cabecalho.map(c=>`<th scope="col">${celula(c)}</th>`).join('')}</tr></thead><tbody>${linhasTabela.map(l=>`<tr>${l.map(c=>`<td>${celula(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      avancar(j-i);i=j;continue;
    }
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
          ? `<li class="md-tarefa" ${marca}><input type="checkbox" ${/[xX]/.test(tarefa[1]) ? 'checked' : ''} aria-label="${t('Concluída')}" />${mdInline(escapeHtml(tarefa[2]))}</li>`
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
    while (j < linhas.length && linhas[j].trim() && !/^(#{1,6}\s|>|```|[-*+]\s|\d+\.\s|-{3,}\s*$)/.test(linhas[j])) {
      const colunas=Kiro.celulasTabela(linhas[j]), divisao=Kiro.celulasTabela(linhas[j+1]||'');
      if(colunas?.length>=2&&divisao?.length===colunas.length&&divisao.every(c=>/^:?-{3,}:?$/.test(c)))break;
      paragrafo.push(linhas[j++]);
    }
    saida.push(`<p ${abrir(inicio, j)}>${mdInline(escapeHtml(paragrafo.join('\n'))).replace(/\n/g, '<br />')}</p>`);
    avancar(j - i); i = j;
  }
  return saida.join('');
}

// ---- Impressão da nota: usa o rascunho atual sem gravar ou trocar a nota aberta ----
let impressaoEmCurso = false;
async function imprimirNota(pdf = false) {
  if (!editing || impressaoEmCurso) return;
  impressaoEmCurso = true;
  const tituloAnterior = document.title;
  const titulo = editing.title || t('Sem título');
  const folha = document.createElement('article');
  folha.id = 'nota-impressao';
  folha.className = 'doc-corpo';
  try {
    // Blocos de plug-ins saem como código: imprimir nunca executa o plug-in.
    folha.innerHTML = `<h1>${escapeHtml(titulo)}</h1>${renderizarMarkdown(editing.body, 0, true)}`;
    document.body.appendChild(folha);
    document.title = titulo;
    await document.fonts?.ready;
    await Promise.allSettled([...folha.querySelectorAll('img')].map(imagem => imagem.decode()));
    if (pdf && window.cadernoDesktop?.exportNotePdf) await window.cadernoDesktop.exportNotePdf(titulo);
    else if (window.cadernoDesktop?.printNote) await window.cadernoDesktop.printNote();
    else window.print();
  } catch {
    status(t('Não foi possível imprimir ou exportar esta nota.'), true);
  } finally {
    folha.remove();
    document.title = tituloAnterior;
    impressaoEmCurso = false;
  }
}
// ---- Fim da impressão da nota ----

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
  if (!await copiarTexto(codigo)) return void status(t('O navegador não liberou a área de transferência.'), true);
  botao.textContent = t('Copiado');
  botao.classList.add('copiado');
  setTimeout(() => { botao.textContent = t('Copiar'); botao.classList.remove('copiado'); }, 1400);
}
// ---- Notas e links ----

// Sai da nota pelo fluxo normal (salva se preciso) e filtra a tela Notas pela etiqueta.
async function buscarEtiqueta(texto) {
  await irPara('notes');
  const busca = !editing && $('#note-search');
  if (!busca) return;
  busca.value = texto;
  busca.dispatchEvent(new Event('input'));
}
function seguirWikilink(link, painel) {
  const alvo = link.dataset.id ? getNote(link.dataset.id) : notaVazia({ title: link.dataset.alvo });
  const ancora = link.dataset.ancora || ''; if (!link.dataset.alvo && ancora && editing) { const a = Kiro.resolverAncoraNaNota(editing.body, ancora); if (a) rolarParaTitulo(a.pos); return; } return abrirNota(alvo, { painel, ancora });
}
// Cursor no fim do texto da nota. Sem editor montado (ainda carregando, ou no modo simples
// quando o editor não carregou) devolve null: quem chama desiste, em vez de abrir um segundo
// editor sobre o mesmo texto.
function abrirNoFim() {
  if (!editorDaNota || !$('#doc-corpo')?.contains(editorDaNota.editor.dom)) return null;
  editorDaNota.editor.focar('fim');
  return editorDaNota.editor.area();
}

// ---- Sugestões de [[link]] ----
// A lista não toma o foco: o teclado continua no campo e a tecla é tratada pelo editor, que consulta a lista primeiro.
let sugestao = null; // { campo, lista, titulos, indice, inicio }
function fecharSugestoes() { sugestao?.lista.remove(); sugestao = null; }
// A lista é fixa na tela: se a página rolar, fecha em vez de ficar longe do cursor.
document.addEventListener('scroll', () => { if (sugestao) fecharSugestoes(); }, true);
function atualizarSugestoes(campo) {
  if (!campo) return fecharSugestoes();
  const cursor = campo.selectionStart, antes = campo.value.slice(0, cursor);
  const consulta = cursor === campo.selectionEnd ? Kiro.linkQuery(antes.slice(antes.lastIndexOf('\n') + 1)) : null;
  const notas = consulta === null ? [] : Kiro.linkSuggestions(state.notes.filter(n => n.id !== editing?.id), consulta, 8, editing).map(titulo => ({ rotulo: titulo, inserir: titulo + ']]' }));
  const procura = consulta ? Kiro.normalize(consulta.replace(/^tarefa:/i, '')) : '';
  const tarefas = !procura ? [] : state.tasks.filter(x => !x.done && Kiro.normalize(x.title).includes(procura)).slice(0, 5).map(x => ({ rotulo: x.title, tarefa: true, inserir: Kiro.taskReference(x).slice(2) }));
  const titulos = [...notas, ...tarefas];
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
  lista.innerHTML = titulos.map((s, i) => `<button type="button" class="ctx-item${i === indice ? ' marcada' : ''}" data-i="${i}" role="option" aria-selected="${i === indice}">${s.tarefa ? `<span class="ctx-icone">${icone('tarefas')}</span>` : ''}<span class="ctx-rotulo">${escapeHtml(s.rotulo)}</span>${s.tarefa ? `<small class="ctx-tipo">${t('Tarefa')}</small>` : ''}</button>`).join('');
  lista.querySelector('.marcada')?.scrollIntoView({ block: 'nearest' });
}
function inserirSugestao(i) {
  const { campo, titulos, inicio } = sugestao;
  fecharSugestoes();
  campo.setSelectionRange(inicio, campo.selectionStart);
  inserirTexto(campo, titulos[i].inserir); // dispara input: o editor marca a nota como alterada
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
  if (campo.posicao) { const p = campo.posicao(); if (p) return p; }
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
const TIPOS_DE_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
const LIMITE_DE_IMAGEM = 250 * 1024 * 1024;
const LIMITE_DE_AUDIO = 50 * 1024 * 1024;
let gravacaoAudio=null;
function contextoAudio(){return {nota:editing,cofre:state.vaultPath,editor:editorDaNota?.editor};}
function contextoAudioValido(c){return editing===c.nota&&state.vaultPath===c.cofre&&editorDaNota?.editor===c.editor;}
async function inserirAudio(arquivo,contexto){
  if(!contextoAudioValido(contexto)||arquivo.size>LIMITE_DE_AUDIO){status(t('Não foi possível adicionar o áudio.'),true);return;}
  try{
    const dados=await arquivo.arrayBuffer();if(!contextoAudioValido(contexto))return;
    let resultado;
    if(window.cadernoDesktop)resultado=await window.cadernoDesktop.saveAttachment({nome:arquivo.name||'audio.webm',dados:new Uint8Array(dados)});
    else {const tipo=/\.wav$/i.test(arquivo.name)?'audio/wav':/\.mp3$/i.test(arquivo.name)?'audio/mpeg':'audio/webm';const resposta=await fetch('/api/anexo',{method:'POST',headers:{'Content-Type':tipo,'X-Kiro-Nome':encodeURIComponent(arquivo.name||'audio.webm')},body:dados});resultado=await resposta.json();if(!resposta.ok)throw new Error(resultado.error);}
    if(!contextoAudioValido(contexto))return;
    inserirTexto(contexto.editor.area(),`\n\n![[${resultado.path}]]\n\n`);status(t('Áudio adicionado.'));
  }catch(erro){status(t('Não foi possível adicionar o áudio: {erro}',{erro:mensagemDoErro(erro)}),true);}
}
function escolherAudio(){
  if(!editing||!editorDaNota?.editor)return;
  const contexto=contextoAudio(), campo=document.createElement('input');campo.type='file';campo.accept='.wav,.mp3,.webm,audio/wav,audio/mpeg,audio/webm';
  campo.onchange=()=>{const arquivo=campo.files?.[0];if(arquivo&&contextoAudioValido(contexto))inserirAudio(arquivo,contexto);};campo.click();
}
async function gravarAudio(){
  if(gravacaoAudio){gravacaoAudio.parar();return;}
  if(!editing||!editorDaNota?.editor)return;
  const contexto=contextoAudio(), sessao={contexto,parar:()=>{sessao.cancelada=true;}};gravacaoAudio=sessao;
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(sessao.cancelada||!contextoAudioValido(contexto)){stream.getTracks().forEach(t=>t.stop());gravacaoAudio=null;return;}
    if(!MediaRecorder.isTypeSupported('audio/webm'))throw new Error(t('Gravação de áudio não suportada.'));
    const recorder=new MediaRecorder(stream,{mimeType:'audio/webm'}), partes=[];let tamanho=0, falhou=false;
    const limpar=()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());if(gravacaoAudio===sessao)gravacaoAudio=null;const botao=$('#doc-gravar');if(botao)botao.hidden=true;};
    sessao.parar=()=>{if(recorder.state!=='inactive')recorder.stop();};
    recorder.ondataavailable=e=>{tamanho+=e.data.size;if(tamanho>LIMITE_DE_AUDIO){falhou=true;sessao.parar();}else if(e.data.size)partes.push(e.data);};
    recorder.onerror=()=>{falhou=true;sessao.parar();limpar();status(t('Não foi possível gravar áudio.'),true);};
    recorder.onstop=()=>{limpar();if(!falhou&&partes.length&&contextoAudioValido(contexto))inserirAudio(new File(partes,'gravacao.webm',{type:'audio/webm'}),contexto);else if(falhou)status(t('Não foi possível gravar áudio.'),true);};
    const timer=setTimeout(()=>sessao.parar(),10*60*1000);recorder.start(1000);const parar=$('#doc-gravar');if(parar)parar.hidden=false;
  }catch(erro){stream?.getTracks().forEach(t=>t.stop());if(gravacaoAudio===sessao)gravacaoAudio=null;status(t('Não foi possível gravar áudio: {erro}',{erro:mensagemDoErro(erro)}),true);}
}

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
  if (!resposta.ok) throw new Error(resultado.error || t('Não foi possível guardar a imagem.'));
  return resultado;
}
// Os arquivos que o Fluxo aceita (colar, arrastar, botão da barra): lista própria, as notas seguem
// só com TIPOS_DE_IMAGEM. O cofre confere o conteúdo de verdade ao gravar; aqui basta o nome.
const EXTENSOES_DO_FLUXO = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'mp3', 'wav', 'm4a', 'mp4'];
const aceitoNoFluxo = arquivo => TIPOS_DE_IMAGEM.includes(arquivo.type) || EXTENSOES_DO_FLUXO.includes((/\.([^.]+)$/.exec(arquivo.name || '') || [])[1]?.toLowerCase());
function arquivosDoFluxo(dados) {
  if (!dados) return [];
  const arquivos = [...(dados.files || [])].filter(aceitoNoFluxo);
  if (arquivos.length) return arquivos;
  return [...(dados.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(arquivo => arquivo && aceitoNoFluxo(arquivo));
}
async function lerTextoDoAnexo(arquivo) {
  const resposta = await fetch(urlDoAnexo(arquivo));
  if (!resposta.ok) throw new Error(String(resposta.status));
  return resposta.text();
}
// Seletor de arquivos do sistema → anexo do cofre (mesmo caminho da imagem colada). Devolve o caminho.
function escolherImagemDoSistema() {
  return new Promise(resolve => {
    const campo = document.createElement('input');
    campo.type = 'file'; campo.accept = EXTENSOES_DO_FLUXO.map(x => `.${x}`).join(',');
    campo.addEventListener('cancel', () => resolve(null));
    campo.addEventListener('change', async () => {
      const arquivo = campo.files?.[0];
      if (!arquivo) return resolve(null);
      resolve(await guardarImagemDoFluxo(arquivo));
    });
    campo.click();
  });
}
// Mesmo limite e mesmo aviso da imagem colada numa nota; devolve o caminho ou null.
async function guardarImagemDoFluxo(arquivo) {
  if (arquivo.size > LIMITE_DE_IMAGEM) { status(t('{nome} passa de 250 MB.', { nome: arquivo.name || t('A imagem') }), true); return null; }
  try { return (await guardarImagem(arquivo)).path; }
  catch (erro) { status(t('Não foi possível guardar a imagem: {erro}', { erro: mensagemDoErro(erro) }), true); return null; }
}
function pedirLinkDoFluxo() {
  if ($('#modal-root').firstChild) return Promise.resolve(null);
  return new Promise(resolve => {
    let respondeu = false;
    const responder = v => { if (!respondeu) { respondeu = true; resolve(v); } };
    modal(t('Adicionar link'), `<form class="form" id="fluxo-link-form"><div class="field"><label for="fluxo-link-url">${t('Endereço')}</label><input id="fluxo-link-url" required placeholder="https://…" autocomplete="off" /></div><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button class="primary">${t('Adicionar')}</button></div></form>`);
    const campo = $('#fluxo-link-url');
    campo.addEventListener('input', e => e.stopPropagation());
    new MutationObserver((_, obs) => { if (!$('#modal-root').firstChild) { obs.disconnect(); responder(null); } }).observe($('#modal-root'), { childList: true });
    $('#cancel').onclick = () => closeModal(true);
    $('#fluxo-link-form').onsubmit = e => {
      e.preventDefault();
      const url = Kiro.safeUrl(campo.value.trim());
      if (!url) return status(t('Use um endereço que comece com http:// ou https://.'), true);
      responder(url); closeModal(true);
    };
    campo.focus();
  });
}
// A imagem vai para o cofre primeiro; só depois o ![[...]] entra no texto, onde está o cursor.
async function colarImagens(campo, arquivos) {
  status(arquivos.length > 1 ? t('Guardando {n} imagens…', { n: arquivos.length }) : t('Guardando imagem…'));
  const trechos = [];
  for (const arquivo of arquivos) {
    if (arquivo.size > LIMITE_DE_IMAGEM) { status(t('{nome} passa de 250 MB.', { nome: arquivo.name || t('A imagem') }), true); continue; }
    try { trechos.push(`![[${(await guardarImagem(arquivo)).path}]]`); }
    catch (erro) { status(t('Não foi possível guardar a imagem: {erro}', { erro: mensagemDoErro(erro) }), true); }
  }
  if (!trechos.length || !editing) return;
  // Se o editor saiu de cena enquanto a imagem era gravada, ela entra no fim da nota.
  const destino = editorDaNota?.editor.area() === campo ? campo : abrirNoFim();
  if (!destino) return;
  // Cada imagem vira um parágrafo próprio, separado do texto em volta por linha em branco.
  const texto = destino.value, anterior = texto.slice(0, destino.selectionStart), seguinte = texto.slice(destino.selectionEnd);
  const antes = !anterior || anterior.endsWith('\n\n') ? '' : anterior.endsWith('\n') ? '\n' : '\n\n';
  const depois = !seguinte || seguinte.startsWith('\n\n') ? '' : seguinte.startsWith('\n') ? '\n' : '\n\n';
  inserirTexto(destino, antes + trechos.join('\n\n') + depois);
  status(trechos.length > 1 ? t('{n} imagens coladas', { n: trechos.length }) : t('Imagem colada'));
}
// Ctrl+V com a nota aberta mas o editor sem foco: a imagem entra no fim da nota.
document.addEventListener('paste', evento => {
  if (!editing || editorDaNota?.editor.temFoco() || evento.defaultPrevented || !$('#doc-corpo')) return;
  if (evento.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const arquivos = imagensDoEvento(evento.clipboardData);
  if (!arquivos.length) return;
  const destino = abrirNoFim();
  if (!destino) return;
  evento.preventDefault();
  colarImagens(destino, arquivos);
});
// Arquivo solto fora da nota não deve abrir a imagem no lugar do aplicativo.
window.addEventListener('dragover', evento => { if (evento.dataTransfer?.types.includes('Files')) evento.preventDefault(); });
window.addEventListener('drop', evento => { if (evento.dataTransfer?.types.includes('Files')) evento.preventDefault(); });
// Abrir o PDF no leitor do sistema: no desktop o esquema kiro-anexo:// não abre em
// aba (o window.open dele é negado), então o botão sai pelo shell, com o caminho
// resolvido dentro do cofre. No navegador o link segue normal, para /anexo/.
document.addEventListener('click', evento => {
  const botao = evento.target.closest?.('.md-pdf-abrir');
  if (!botao || !window.cadernoDesktop) return;
  evento.preventDefault();
  const caminho = botao.closest('.md-pdf')?.dataset.pdf;
  if (caminho) window.cadernoDesktop.openAttachment(caminho).catch(() => { /* sem leitor padrão: fica quieto */ });
});

// Clicar na imagem abre ela inteira sobre a nota; Esc ou um clique fecham. O
// Markdown da imagem continua a um clique do botão direito, como nos outros blocos.
let telaDeImagem = null;
let origemDoFoco = null;
const aoTeclarNaImagem = evento => {
  if (evento.key !== 'Escape') return;
  // Em captura e parando aqui: o Esc fecha a imagem sem mexer no resto da tela.
  evento.preventDefault();
  evento.stopPropagation();
  fecharImagemInteira();
};
function abrirImagemInteira(fonte, nome) {
  abrirTelaInteira(`<img src="${escapeHtml(fonte)}" alt="${escapeHtml(nome || '')}" />`);
}
// O PDF da leitura ampliada: o pdf-nota.js ativa o bloco ao entrar no body. Só o fundo fecha;
// clicar no PDF não, nem no topo (que não recolhe).
// `origem`: o elemento que recebe o foco de volta ao fechar (o Fluxo de onde o PDF foi ampliado).
function abrirPdfInteiro(arquivo, pagina, origem) {
  // Cabe na janela: 60 de padding da tela e cerca de 52 do topo do PDF e das bordas.
  abrirTelaInteira(htmlDoPdf({ arquivo, pagina, altura: window.innerHeight - 112, aberto: true }), evento => {
    if (evento.target.closest('.md-pdf-topo') && !evento.target.closest('a')) evento.preventDefault();
    // detail > 1: o 2º clique de um duplo clique em Ampliar cairia no fundo que acabou de aparecer.
    if (evento.target === telaDeImagem && evento.detail <= 1) fecharImagemInteira();
  });
  origemDoFoco = origem || null;
}
// Abrir de um cartão de arquivo do Fluxo: cada tipo tem a sua tela inteira. `origem` recebe o foco ao fechar.
async function abrirArquivoDoFluxo(arquivo, tipo, { pagina, origem } = {}) {
  const fonte = urlDoAnexo(arquivo);
  // Só o fundo fecha: clicar no vídeo, no texto ou na tabela não (selecionar e rolar).
  const peloFundo = evento => { if (evento.target === telaDeImagem && evento.detail <= 1) fecharImagemInteira(); };
  if (tipo === 'pdf') return abrirPdfInteiro(arquivo, pagina || 1, origem);
  if (tipo === 'imagem') abrirImagemInteira(fonte, arquivo.split('/').pop());
  else if (tipo === 'video') abrirTelaInteira(`<video src="${escapeHtml(fonte)}" controls autoplay></video>`, peloFundo);
  else if (tipo === 'texto' || tipo === 'tabela') {
    let texto;
    try { texto = await lerTextoDoAnexo(arquivo); } catch { return status(t('Não foi possível ler o arquivo.'), true); }
    abrirTelaInteira(tipo === 'tabela' ? `<table class="fluxo-tabela">${KiroFluxoTela.tabelaHtml(texto)}</table>` : `<pre class="fluxo-texto">${escapeHtml(KiroFluxoTela.textoLimitado(texto))}</pre>`, peloFundo);
  } else return;
  origemDoFoco = origem || null;
}
// Abrir de um cartão de vídeo do YouTube: o mesmo player, grande. Só o fundo fecha.
function abrirVideoDoFluxo(id, origem) {
  abrirTelaInteira(KiroFluxoTela.videoIframeHtml(id), evento => { if (evento.target === telaDeImagem && evento.detail <= 1) fecharImagemInteira(); });
  origemDoFoco = origem || null;
}
function abrirTelaInteira(conteudo, aoClicar = fecharImagemInteira) {
  fecharImagemInteira();
  telaDeImagem = document.createElement('div');
  telaDeImagem.className = 'tela-imagem';
  telaDeImagem.tabIndex = -1;
  telaDeImagem.innerHTML = `${conteudo}<span class="tela-dica">${t('Esc para fechar')}</span>`;
  telaDeImagem.addEventListener('click', aoClicar);
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
  if (origemDoFoco?.isConnected) origemDoFoco.focus({ preventScroll: true });
  origemDoFoco = null;
}

// ---- Menu de contexto do corpo da nota ----
// O corpo é Markdown puro: cada item insere a marcação correspondente.
// Usa execCommand('insertText') para não destruir a pilha de desfazer do textarea.
function inserirTexto(area, texto) {
  if (area.inserir) { area.focus(); area.inserir(texto); return; }
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
  const url = prompt(t('Endereço do link:'), 'https://');
  if (url === null) return;
  const limpo = Kiro.safeUrl(url.trim());
  if (!limpo) { alert(t('Informe um endereço http:// ou https:// válido.')); return; }
  const i = area.selectionStart;
  inserirTexto(area, '[' + sel + '](' + limpo + ')');
  if (!sel) area.setSelectionRange(i + 1, i + 1);
}
async function colar(area) {
  try {
    const texto = await navigator.clipboard.readText();
    if (texto) inserirTexto(area, texto);
  } catch {
    status(t('O navegador não liberou a área de transferência. Use Ctrl+V.'), true);
  }
}
async function copiarSelecao(area, recortar) {
  const sel = area.value.slice(area.selectionStart, area.selectionEnd);
  if (!sel) return;
  if (!await copiarTexto(sel)) return void status(t('Não foi possível copiar.'), true);
  if (recortar) inserirTexto(area, '');
}
const TABELA = '| Coluna | Coluna |\n| --- | --- |\n|  |  |\n';
const temSelecao = area => area.selectionStart !== area.selectionEnd;
// No editor o texto é cru: o link aparece entre colchetes e não é
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
  const destino = wikilinkNoCursor(editorDaNota?.editor.area());
  return [
    ...(destino ? [
      { rotulo: t('Ir para "{alvo}"', { alvo: destino.alvo }), icone: icone('ir-para'), acao: () => abrirNota(destino.nota || notaVazia({ title: destino.alvo })) },
      { separador: true },
    ] : []),
    { rotulo: t('Adicionar link'), icone: icone('link'), acao: a => envolver(a, '[[', ']]') },
    { rotulo: t('Adicionar link externo'), icone: icone('link-externo'), acao: linkExterno },
    { separador: true },
    { rotulo: t('Formatar'), icone: icone('renomear'), filhos: [
      { rotulo: t('Negrito'), icone: 'B', acao: a => envolver(a, '**') },
      { rotulo: t('Itálico'), icone: 'I', acao: a => envolver(a, '*') },
      { rotulo: t('Riscado'), icone: 'S', acao: a => envolver(a, '~~') },
      { rotulo: t('Realce'), icone: icone('realce'), acao: a => envolver(a, '==') },
      { separador: true },
      { rotulo: t('Código'), icone: icone('codigo'), acao: a => envolver(a, '`') },
      { rotulo: t('Área de código'), icone: icone('codigo-bloco'), acao: areaDeCodigo },
      { rotulo: t('Equação'), icone: 'Σ', acao: a => envolver(a, '$') },
      { rotulo: t('Comentário'), icone: icone('comentario'), acao: a => envolver(a, '%%') },
      { separador: true },
      { rotulo: t('Limpar formatação'), icone: icone('limpar'), acao: a => {
        const i = a.selectionStart, sel = a.value.slice(i, a.selectionEnd);
        if (!sel) return;
        const limpo = sel.replace(/\*\*|~~|==|%%|[*`$]/g, '');
        inserirTexto(a, limpo);
        a.setSelectionRange(i, i + limpo.length);
      } },
    ] },
    { rotulo: t('Parágrafo'), icone: icone('paragrafo'), filhos: [
      { rotulo: t('Texto normal'), icone: icone('texto'), acao: a => porLinha(a, semPrefixo) },
      { separador: true },
      { rotulo: t('Título 1'), icone: icone('titulo'), acao: a => prefixar(a, '# ') },
      { rotulo: t('Título 2'), icone: icone('titulo'), acao: a => prefixar(a, '## ') },
      { rotulo: t('Título 3'), icone: icone('titulo'), acao: a => prefixar(a, '### ') },
      { separador: true },
      { rotulo: t('Lista com marcadores'), icone: icone('lista-marcadores'), acao: a => prefixar(a, '- ') },
      { rotulo: t('Lista numerada'), icone: icone('lista-numerada'), acao: a => { let n = 0; porLinha(a, l => (++n) + '. ' + semPrefixo(l)); } },
      { rotulo: t('Lista de tarefas'), icone: icone('lista-tarefas'), acao: a => prefixar(a, '- [ ] ') },
      { rotulo: t('Citação'), icone: icone('destaque'), acao: a => prefixar(a, '> ') },
    ] },
    { rotulo: t('Inserir'), icone: icone('mais'), filhos: [
      { rotulo: t('Nota de rodapé'), icone: icone('rodape'), acao: a => {
        const n = (a.value.match(/\[\^(\d+)\]/g) || []).length + 1;
        inserirTexto(a, '[^' + n + ']');
        const fim = a.selectionStart;
        const rodape = (a.value.endsWith('\n') ? '' : '\n') + '\n[^' + n + ']: ';
        a.setSelectionRange(a.value.length, a.value.length);
        inserirTexto(a, rodape);
        a.setSelectionRange(fim, fim);
      } },
      { rotulo: t('Tabela'), icone: icone('tabela'), acao: a => inserirBloco(a, TABELA) },
      { rotulo: t('Destaque'), icone: icone('destaque'), acao: a => inserirBloco(a, '> [!note]\n> ') },
      { rotulo: t('Régua horizontal'), icone: icone('regua'), acao: a => inserirBloco(a, '---\n') },
      { separador: true },
      { rotulo: t('Bloco de código'), icone: icone('codigo-bloco'), acao: a => { inserirBloco(a, '```\n\n```\n'); const p = a.selectionStart - 5; a.setSelectionRange(p, p); } },
      { rotulo: t('Equação em bloco'), icone: 'Σ', acao: a => { inserirBloco(a, '$$\n\n$$\n'); const p = a.selectionStart - 4; a.setSelectionRange(p, p); } },
    ] },
    { separador: true },
    { rotulo: t('Cortar'), icone: icone('cortar'), ativo: temSelecao, acao: a => copiarSelecao(a, true) },
    { rotulo: t('Copiar'), icone: icone('copiar'), ativo: temSelecao, acao: a => copiarSelecao(a, false) },
    { rotulo: t('Colar'), icone: icone('colar'), acao: colar },
    { separador: true },
    { rotulo: t('Selecionar tudo'), icone: icone('selecionar'), acao: a => a.setSelectionRange(0, a.value.length) },
    { separador: true },
    { rotulo: t('Salvar'), icone: icone('salvar'), acao: () => salvarNota() },
    { rotulo: t('Detalhes'), icone: icone('detalhes'), acao: () => acaoEditor('detalhes') },
    { rotulo: t('Esta nota'), icone: icone('mais-opcoes'), filhos: acoesDaNota() },
    { rotulo: t('Fechar nota'), icone: icone('fechar'), acao: () => acaoEditor('fechar') },
    { rotulo: t('Mover para lixeira'), icone: icone('lixeira'), ativo: () => Boolean(editing?.id), acao: () => acaoEditor('lixeira') },
  ];
}
// As mesmas ações no botão "Mais opções" da nota e no botão direito sobre o texto.
function acoesDaNota() {
  return [
    { rotulo: t('Imprimir nota'), icone: icone('imprimir'), acao: () => imprimirNota() },
    { rotulo: t('Exportar nota para PDF'), icone: icone('exportar'), acao: () => imprimirNota(true) },
    { separador: true },
    { rotulo: t('Anexar áudio'), icone: icone('anexo'), acao: () => escolherAudio() },
    { rotulo: gravacaoAudio ? t('Parar gravação') : t('Gravar áudio'), icone: icone('microfone'), acao: () => gravarAudio() },
    ...(editing?.id ? [{ separador: true }, { rotulo: t('Histórico'), icone: icone('historico'), acao: () => mostrarHistoricoNota() }] : []),
  ];
}
let menuAberto = null;
function fecharMenuContexto() {
  if (!menuAberto) return;
  menuAberto.remove();
  menuAberto = null;
  document.removeEventListener('pointerdown', aoClicarFora, true);
  document.removeEventListener('keydown', aoTeclarNoMenu, true);
  document.removeEventListener('scroll', aoRolarFora, true);
  window.removeEventListener('blur', fecharMenuContexto);
  window.removeEventListener('resize', fecharMenuContexto);
}
// Clique fora fecha. No botão que abriu o menu, quem decide é o próprio botão (abre/fecha),
// senão o menu fecharia no pressionar e reabriria no clique.
const aoClicarFora = e => {
  if (menuAberto?._origem?.contains(e.target)) return;
  if (!menuAberto || !menuAberto.contains(e.target)) fecharMenuContexto();
};
// A barra de abas rola sozinha para mostrar o botão que recebeu foco ao abrir o menu: isso não conta.
const aoRolarFora = e => { if (!menuAberto?.contains(e.target) && !e.target.classList?.contains('abas-barra')) fecharMenuContexto(); };
const itensDoNivel = nivel => [...nivel.querySelectorAll(':scope > .ctx-item:not(:disabled)')];
function marcarNoMenu(nivel, item) {
  for (const x of nivel.querySelectorAll(':scope > .ctx-item.ctx-ativo')) x.classList.remove('ctx-ativo');
  if (item) { item.classList.add('ctx-ativo'); item.scrollIntoView({ block: 'nearest' }); }
}
const aoTeclarNoMenu = e => {
  if (e.key === 'Tab') return void fecharMenuContexto();
  const conhecidas = ['Escape', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '];
  if (!conhecidas.includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') return void fecharMenuContexto();
  const nivel = menuAberto._nivel || menuAberto, itens = itensDoNivel(nivel), atual = nivel.querySelector(':scope > .ctx-item.ctx-ativo'), i = itens.indexOf(atual);
  const abrirFilhos = () => {
    const sub = atual?.querySelector(':scope > .ctx-sub');
    if (!sub) return false;
    atual.classList.add('ctx-aberto'); atual.dispatchEvent(new Event('mouseenter'));
    menuAberto._nivel = sub; marcarNoMenu(sub, itensDoNivel(sub)[0]);
    return true;
  };
  if (e.key === 'ArrowDown') marcarNoMenu(nivel, itens[(i + 1) % itens.length]);
  else if (e.key === 'ArrowUp') marcarNoMenu(nivel, itens[(i - 1 + itens.length) % itens.length] || itens.at(-1));
  else if (e.key === 'Home') marcarNoMenu(nivel, itens[0]);
  else if (e.key === 'End') marcarNoMenu(nivel, itens.at(-1));
  else if (e.key === 'ArrowRight') abrirFilhos();
  else if (e.key === 'ArrowLeft' && nivel !== menuAberto) {
    const mae = nivel.parentElement; mae.classList.remove('ctx-aberto'); marcarNoMenu(nivel, null);
    menuAberto._nivel = mae.closest('.ctx-sub') || menuAberto;
  } else if (e.key === 'Enter' || e.key === ' ') { if (atual && !abrirFilhos()) atual.click(); }
};
function montarNivel(itens, area) {
  const nivel = document.createElement('div');
  nivel.className = 'ctx-menu';
  nivel.setAttribute('role', 'menu');
  // O menu não toma o foco: a ação precisa encontrar o editor com o foco.
  nivel.addEventListener('mousedown', e => e.preventDefault());
  for (const item of itens) {
    if (item.separador) { nivel.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
    const habilitado = item.ativo ? item.ativo(area) : true;
    const linha = document.createElement('button');
    linha.type = 'button';
    linha.className = 'ctx-item' + (item.filhos ? ' tem-filhos' : '');
    linha.setAttribute('role', 'menuitem');
    if (item.filhos) linha.setAttribute('aria-haspopup', 'menu');
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
        // Sobe o que passaria do fim da janela, para o último item não ficar cortado.
        sub.style.top = '';
        const excesso = sub.getBoundingClientRect().bottom - (window.innerHeight - 8);
        if (excesso > 0) sub.style.top = `${-7 - excesso}px`;
      });
    } else if (habilitado) {
      linha.addEventListener('click', async () => {
        fecharMenuContexto();
        // a área do editor da nota não é um nó: vale enquanto for a do editor aberto
        if (area.inserir ? [editorDaNota?.editor, editorDoCartao].some(e => e?.area() === area) : document.body.contains(area)) await item.acao(area);
      });
    }
    nivel.appendChild(linha);
  }
  return nivel;
}
// `opcoes.compacto` deixa o menu mais justo; `opcoes.origem` é o botão que o abriu (clicar
// nele de novo fecha); `opcoes.direita` alinha a borda direita do menu a essa coordenada.
function abrirMenuContexto(evento, area, itens = menuDaNota(), opcoes = {}) {
  evento.preventDefault();
  fecharMenuContexto();
  const menu = montarNivel(itens, area);
  if (opcoes.compacto) menu.classList.add('ctx-compacto');
  menu._origem = opcoes.origem || null;
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const largura = menu.offsetWidth, altura = menu.offsetHeight;
  const x = opcoes.direita !== undefined ? opcoes.direita - largura : evento.clientX;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - largura - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(evento.clientY, window.innerHeight - altura - 8)) + 'px';
  menu.style.visibility = '';
  menuAberto = menu;
  document.addEventListener('pointerdown', aoClicarFora, true);
  document.addEventListener('keydown', aoTeclarNoMenu, true);
  document.addEventListener('scroll', aoRolarFora, true);
  window.addEventListener('blur', fecharMenuContexto);
  window.addEventListener('resize', fecharMenuContexto);
}
// Corretor no app: num campo de texto o menu nativo não é bloqueado, para o processo principal
// descobrir a palavra sob o clique; ele devolve palavra e sugestões e o menu do Kiro abre com
// elas no topo. Sem resposta em 400 ms, abre o menu de sempre.
let menuDoCorretor = null, limiteDoCorretor = 0;
const CAMPO_DE_TEXTO = 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""]';
const podeCorrigir = evento => Boolean(window.cadernoDesktop?.aoMenuDoCorretor && corretorLigado && evento.target.closest?.(CAMPO_DE_TEXTO));
function esperarCorretor(evento, area, itens) {
  menuDoCorretor = { x: evento.clientX, y: evento.clientY, area, itens };
  clearTimeout(limiteDoCorretor);
  limiteDoCorretor = setTimeout(() => abrirMenuDoCorretor({ palavra: '' }), 400);
}
function abrirMenuDoCorretor(dados) {
  const pendente = menuDoCorretor;
  menuDoCorretor = null;
  clearTimeout(limiteDoCorretor);
  if (!pendente) return;
  const doCorretor = KiroCorretor.itensDoCorretor(dados, { trocar: s => window.cadernoDesktop.trocarPalavra(s), adicionar: p => window.cadernoDesktop.adicionarAoDicionario(p), t, icone });
  const itens = doCorretor.length && pendente.itens.length ? [...doCorretor, { separador: true }, ...pendente.itens] : [...doCorretor, ...pendente.itens];
  if (itens.length) abrirMenuContexto({ clientX: pendente.x, clientY: pendente.y, preventDefault() {} }, pendente.area, itens);
}
window.cadernoDesktop?.aoMenuDoCorretor?.(abrirMenuDoCorretor);
async function acaoEditor(tipo){
  if(tipo==='salvar')return void await salvarNota();
  if(tipo==='fechar'){ if(editing) await fecharAba(abas.ativo,idDaAba(editing)); return; }
  if(tipo==='detalhes'){const d=$('#doc-details');d.hidden=!d.hidden;return;}
  if(tipo==='lixeira'){
    if(busy||failed||!loaded||!confirm(t('Mover "{titulo}" para a lixeira?', { titulo: editing.title })))return;
    state.notes=state.notes.filter(n=>n.id!==editing.id);
    editing=null;editorDirty=false;currentView='studies';await save();render();
  }
}
// Salvamento automático: depois de uma pausa, ou ao sair da janela. Copia para o histórico só o que mudou,
// numa fila própria, então escrever muito não expulsa as cópias completas.
const ESPERA_AUTOSAVE_NOTA=3000;
let timerDoAutosave=null, autosaveEmCurso=null, versaoDoEditor=0;
function agendarAutosaveNota(){clearTimeout(timerDoAutosave);timerDoAutosave=setTimeout(autosalvarNota,ESPERA_AUTOSAVE_NOTA);}
function autosalvarNota(){
  clearTimeout(timerDoAutosave);
  if(!editing||!editorDirty||failed||!loaded||!editing.title.trim())return; // sem título: recebe um ao sair da nota
  // No campo do título a pessoa ainda está decidindo o nome: renomear a cada pausa trocaria o arquivo e os links à toa.
  if(busy||(document.hasFocus()&&document.activeElement?.id==='doc-title'))return agendarAutosaveNota();
  autosaveEmCurso=salvarNota({auto:true}).finally(()=>{autosaveEmCurso=null;});
  return autosaveEmCurso;
}
async function salvarNota({auto=false}={}){
  if(!auto&&autosaveEmCurso){await autosaveEmCurso;if(!editorDirty)return true;}
  if(busy||failed||!loaded||!editing)return false;
  clearTimeout(timerDoAutosave);
  // Nunca prende a pessoa na nota: sem título, volta o anterior, o rascunho vazio some e o escrito ganha a primeira linha como título.
  if(!editing.title.trim()){
    const salvaAntes=editing.id&&getNote(editing.id);
    if(salvaAntes)editing.title=salvaAntes.title;
    else if(!editing.body.trim()&&!editing.tags.length&&!editing.links.length){editorDirty=false;estadoDoc();return true;}
    else editing.title=tituloDoTexto(editing.body.trim()).trim()||t('Sem título');
  }
  const eraNova=!editing.id, versao=versaoDoEditor;
  const salva={...editing,tags:[...editing.tags],links:[...editing.links],id:editing.id||uid(),title:editing.title.trim(),createdAt:editing.createdAt||Date.now(),updatedAt:Date.now()};
  const antes=editing.id?getNote(editing.id):null;
  state.notes=editing.id?state.notes.map(n=>n.id===editing.id?salva:n):[salva,...state.notes];
  const renomeou=Boolean(antes&&antes.title!==salva.title);
  if(renomeou)state=Kiro.aplicarRenomeacaoDeLinks(state,salva.id,antes.title,salva.title).state;
  // O automático mantém o objeto: o que for digitado durante a gravação entra nele, e nada é redesenhado sem necessidade.
  if(auto)Object.assign(editing,{id:salva.id,createdAt:salva.createdAt,title:salva.title});else editing=getNote(salva.id)||salva;
  if(eraNova){abas=KiroAbas.trocarId(abas,KiroAbas.RASCUNHO,salva.id);gravarAbas();}
  // O rascunho virou nota com id: o mesmo editor continua (cursor e desfazer intactos).
  if(eraNova&&editorDaNota?.chave==='rascunho')editorDaNota.chave=chaveDaNota(salva);
  if(!await save(null,0,auto?{automatico:true,semRender:true}:{}))return false;
  const atual=getNote(salva.id);
  if(auto){
    const redesenhar=eraNova||renomeou;
    if(versao===versaoDoEditor){if(atual)Object.assign(editing,atual,{tags:[...(atual.tags||[])],links:[...(atual.links||[])]});editorDirty=false;estadoDoc();}
    else if(atual)Object.assign(editing,{file:atual.file,updatedAt:atual.updatedAt}); // digitou enquanto gravava: continua pendente
    if(redesenhar)render();
    return true;
  }
  if(atual)editing={...atual,tags:[...(atual.tags||[])],links:[...(atual.links||[])]};
  editorDirty=false;render();return true;
}
async function extraAction(type,id){
  if(busy||failed||!loaded)return;
  if(type==='inbox-arquivar')tirarDaCaixa(id);
  if(type==='inbox-mover'){
    const r=document.querySelector(`[data-extra="inbox-mover"][data-id="${CSS.escape(id)}"]`).getBoundingClientRect();
    const pastas=state.folders.slice().sort((a,b)=>KiroIdiomas.comparar(a.path || a.title, b.path || b.title));
    abrirMenuContexto({preventDefault(){},clientX:r.left,clientY:r.bottom},document.body,pastas.length?pastas.map(f=>({rotulo:f.path||f.title,icone:icone('pastas'),acao:()=>tirarDaCaixa(id,f.id)})):[{rotulo:t('Nenhuma pasta ainda'),icone:icone('pastas'),ativo:()=>false,acao:()=>{}}]);
  }
  if(type==='daily')abrirNota(state.notes.find(n=>n.title===today())||notaVazia({title:today(),body:catalogoDeModelos().find(m=>m.chave==='embutido:daily').body,tags:['diario']}));
  if(type==='add-habit') habitoModal();
  if(type==='habit-stats') habitosModal();
  if(type==='continuar'){const nota=getNote(id);if(nota){await abrirNota(nota);await montagemDoEditor;if(editing?.id===id&&!abrirNoFim()){const c=$('#doc-corpo .doc-corpo-simples');if(c){c.focus();c.setSelectionRange(c.value.length,c.value.length);}}}}
}
// A restauração é do próprio Vault: ele devolve a nota ou a pasta inteira, com
// subpastas, anexos e os identificadores originais. Reconstruir isso aqui, como
// se fazia antes, quebrava com pastas e travava a janela.
const restaurarDoCofre = pedido => window.cadernoDesktop ? window.cadernoDesktop.restore(pedido) : api('restore', pedido);
async function mostrarHistoricoNota(){
  if(!loaded||failed||busy||!editing?.id)return;
  const noteId=editing.id, cofre=state.vaultPath;
  if(!await salvarAntesDeTrocar()||editing?.id!==noteId||state.vaultPath!==cofre)return;
  setBusy(true);
  try{
    const itens=window.cadernoDesktop?await window.cadernoDesktop.history({noteId}):await api('history',{noteId});
    if(editing?.id!==noteId||state.vaultPath!==cofre||editorDirty)return;
    modal(t('Histórico da nota'), itens.length ? `<div class="form"><label for="historico-versao">${t('Versão')}</label><select id="historico-versao">${itens.map(i=>`<option value="${escapeHtml(i.snapshotId)}">${escapeHtml(KiroIdiomas.formatarData(new Date(i.when),{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</option>`).join('')}</select><pre id="historico-previa" style="white-space:pre-wrap;max-height:45vh;overflow:auto"></pre><div class="form-actions"><button type="button" class="secondary" id="historico-fechar">${t('Fechar')}</button><button type="button" class="primary" id="historico-restaurar">${t('Restaurar conteúdo')}</button></div></div>` : `<p>${t('Nenhuma versão disponível.')}</p>`);
    if(!itens.length)return;
    const seletor=$('#historico-versao'), previa=$('#historico-previa'), restaurar=$('#historico-restaurar');
    const carregar=async()=>{
      const snapshotId=seletor.value;restaurar.disabled=true;previa.textContent=t('Carregando…');
      try{const versao=window.cadernoDesktop?await window.cadernoDesktop.readHistory({noteId,snapshotId}):await api('history-read',{noteId,snapshotId});
        if(seletor.isConnected&&seletor.value===snapshotId&&editing?.id===noteId&&state.vaultPath===cofre){previa.textContent=versao.body;restaurar.disabled=false;}
      }catch(erro){if(seletor.isConnected)previa.textContent=mensagemDoErro(erro);}
    };
    seletor.onchange=e=>{e.stopPropagation();carregar();};$('#historico-fechar').onclick=()=>closeModal();
    restaurar.onclick=async()=>{
      if(busy||failed||editing?.id!==noteId||state.vaultPath!==cofre||editorDirty)return;
      if(!confirm(t('Restaurar o conteúdo desta versão? O conteúdo atual será preservado no histórico.')))return;
      if(!await gravarFluxoPendente()||editing?.id!==noteId||state.vaultPath!==cofre||editorDirty)return;
      const snapshotId=seletor.value, revision=state.revision;setBusy(true);
      try{
        const pedido={noteId,snapshotId,revision};
        const resultado=window.cadernoDesktop?await window.cadernoDesktop.restoreHistory(pedido):await api('history-restore',pedido);
        if(editing?.id!==noteId||state.vaultPath!==cofre||editorDirty)return;
        state=doCofre(resultado);const nota=getNote(noteId);editing={...nota,tags:[...(nota.tags||[])],links:[...(nota.links||[])]};
        closeModal(true);render();eventosDoCofre(null);status(t('Conteúdo restaurado.'));
      }catch(erro){status(t('Não foi possível restaurar: {erro}',{erro:mensagemDoErro(erro)}),true);}finally{setBusy(false);}
    };
    await carregar();
  }catch(erro){status(mensagemDoErro(erro),true);}finally{setBusy(false);}
}
async function showTrash(){
  if(!loaded||failed||busy)return;
  try{
    const itens=window.cadernoDesktop?await window.cadernoDesktop.trash():await api('trash');
    const quando=ms=>KiroIdiomas.formatarData(new Date(ms),{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    const detalhe=i=>i.kind==='folder'
      ? `${t('pasta')} · ${i.noteCount===1?t('1 nota'):t('{n} notas',{n:i.noteCount})}${i.folderCount>1?` · ${i.folderCount===2?t('1 subpasta'):t('{n} subpastas',{n:i.folderCount-1})}`:''}`
      : i.kind==='fluxo'?t('fluxo'):t('nota');
    const nomeDoIcone=i=>i.kind==='folder'?'pastas':i.kind==='fluxo'?'fluxo':'nota';
    const qtd=itens.length===1?t('1 item'):t('{n} itens',{n:itens.length});
    modal(t('Lixeira'), itens.length ? `<div class="lixeira-topo"><span class="small-muted">${qtd}</span><button type="button" class="secondary perigo lixeira-esvaziar" id="esvaziar-lixeira">${icone('lixeira')} ${t('Esvaziar lixeira')}</button></div><div class="lixeira-lista">${itens.map(i=>`<div class="routine-item lixeira-item"><span class="brand-mark">${icone(nomeDoIcone(i))}</span><span class="routine-title">${escapeHtml(i.title)}<div class="task-info">${detalhe(i)} · ${t('removido em {quando}',{quando:quando(i.deletedAt)})}</div></span><span class="lixeira-acoes"><button class="secondary" data-restore="${escapeHtml(i.entryId)}">${t('Restaurar')}</button><button type="button" class="icon-button perigo" data-apagar="${escapeHtml(i.entryId)}" title="${t('Apagar permanentemente')}" aria-label="${t('Apagar {titulo} permanentemente',{titulo:escapeHtml(i.title)})}">${icone('lixeira')}</button></span></div>`).join('')}</div>` : `<div class="empty lixeira-vazia">${t('A lixeira está vazia.')}</div>`);
    // Pergunta antes, porque não há volta; cancelar devolve à lista.
    const confirmarApagar=(texto,rotulo,acao)=>{
      modal(t('Apagar permanentemente'),`<p class="confirmar-texto">${texto}</p><p class="small-muted">${t('Backups feitos antes continuam existindo.')}</p><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button type="button" class="primary perigo-cheio" id="confirmar-apagar">${rotulo}</button></div>`);
      $('#cancel').onclick=()=>{closeModal(true);showTrash();};
      $('#cancel').focus();
      $('#confirmar-apagar').onclick=async()=>{
        if(busy||failed)return;
        setBusy(true);status(t('Apagando…'));
        try{await acao();status(t('Apagado permanentemente'));}
        catch(erro){status(t('Não foi possível apagar: {erro}',{erro:mensagemDoErro(erro)}),true);}
        finally{setBusy(false);closeModal(true);showTrash();}
      };
    };
    $('#esvaziar-lixeira')?.addEventListener('click',()=>confirmarApagar(t('Apagar {qtd} da lixeira para sempre? Isso também os remove do histórico de versões e não pode ser desfeito.',{qtd:`<strong>${qtd}</strong>`}),t('Esvaziar lixeira'),()=>window.cadernoDesktop?window.cadernoDesktop.emptyTrash():api('trash-empty',{})));
    document.querySelectorAll('[data-apagar]').forEach(b=>b.onclick=()=>{
      const i=itens.find(x=>x.entryId===b.dataset.apagar);
      const conteudo=i.kind==='folder'?` (${detalhe(i)})`:'';
      confirmarApagar(t('Apagar {titulo} para sempre? Isso também o remove do histórico de versões e não pode ser desfeito.',{titulo:`<strong>${escapeHtml(i.title)}</strong>${conteudo}`}),t('Apagar permanentemente'),()=>{const pedido={entryId:i.entryId};return window.cadernoDesktop?window.cadernoDesktop.purgeTrash(pedido):api('trash-purge',pedido);});
    });
    document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=async()=>{
      if(busy||failed)return;
      // Uma mudança de fluxo ainda não salva não pode ser descartada pela restauração.
      if(!await gravarFluxoPendente())return;
      setBusy(true);status(t('Restaurando…'));
      try{
        state=doCofre(await restaurarDoCofre({entryId:b.dataset.restore,revision:state.revision}));
        fluxoPendente=false;clearTimeout(timerDoFluxo);
        expanded=null;closeModal(true);render();status(t('Restaurado do cofre'));
      }catch(erro){
        // Falha ao restaurar não põe em risco o que está na janela: não trava a interface.
        status(t('Não foi possível restaurar: {erro}',{erro:mensagemDoErro(erro)}),true);
      }finally{setBusy(false);}
    });
  }catch(error){status(mensagemDoErro(error),true);}
}
// ---- Plug-ins ----
// O código de terceiro roda num worker; aqui só atendemos pedidos, sempre
// conferindo de novo a permissão concedida: o worker é território do plug-in.
const LIMITE_ATIVACAO = 3000, LIMITE_CHAMADA = 5000, LIMITE_MENSAGEM = 2 * 1024 * 1024;
const pluginsAtivos = new Map();          // id → { manifesto, permissoes, worker, comandos, paineis }
const problemasDosPlugins = new Map();    // id → motivo pelo qual parou de funcionar nesta sessão
let planoDosPlugins = { carregar: [], pendentes: [], problemas: [] };
let VERSAO = '0.0.0';                     // versão do Kiro, comparada com o minKiro do manifesto
// ---- Layout da Hoje (.kiro/hoje.json). As regras ficam em hoje.js; aqui só ler, gravar e desenhar. ----
const hojeApi = {
  ler: () => window.cadernoDesktop ? window.cadernoDesktop.homeLayout() : api('home-layout'),
  gravar: l => window.cadernoDesktop ? window.cadernoDesktop.saveHomeLayout(l) : api('home-layout', l),
};
let hojeLayout = null;          // null até a primeira leitura
let hojeGravavel = false;       // leitura deu erro: usa o padrão sem sobrescrever o arquivo da pessoa
                                 // (arquivo ausente ou inválido não é erro: entra vazio e É sobrescrito pelo padrão)
let hojeTimer = null;
let personalizandoHoje = false;
async function carregarHoje() {
  clearTimeout(hojeTimer); hojeGravavel = false;
  try { hojeLayout = KiroHoje.limpar(await hojeApi.ler()); hojeGravavel = true; }
  catch (erro) { hojeLayout = null; hojeGravavel = false; status(t('Não foi possível ler o layout da Hoje: {erro}', { erro: mensagemDoErro(erro) }), true); }
  await carregarFavoritos();
}
// ---- Favoritos (.kiro/favoritos.json) ----
const favoritosApi = {
  ler: () => window.cadernoDesktop ? window.cadernoDesktop.bookmarks() : api('favoritos'),
  gravar: f => window.cadernoDesktop ? window.cadernoDesktop.saveBookmarks(f) : api('favoritos', f),
};
let favoritos = { itens: [] };
async function carregarFavoritos() {
  try { favoritos = Kiro.validarFavoritos(await favoritosApi.ler()); }
  catch { favoritos = { itens: [] }; }
}
async function salvarFavoritos(novos) {
  favoritos = Kiro.validarFavoritos(novos);
  try { await favoritosApi.gravar(favoritos); }
  catch (erro) { status(mensagemDoErro(erro), true); }
  if (loaded) render();
}
function alternarItemFavorito(item) {
  return salvarFavoritos(Kiro.alternarFavorito(favoritos, item));
}
function renderFavoritosMarkup() {
  if (!favoritos?.itens?.length) return '';
  const desenharItem = (it, prof = 0) => {
    if (it.tipo === 'grupo') {
      const filhos = (it.itens || []).map(sub => desenharItem(sub, prof + 1)).join('');
      return `<div class="tree-node${it.aberto !== false ? ' open' : ''}" data-fav-grupo="${escapeHtml(it.id)}"><div class="tree-row tree-folder" data-action="toggle-fav-group" data-id="${escapeHtml(it.id)}" style="--depth:${prof}"><span class="twisty">${filhos ? icone('direita') : ''}</span><span class="tree-icone">${icone('pastas')}</span><span class="tree-name">${escapeHtml(it.titulo)}</span></div><div class="tree-children"><div class="tree-children-inner">${filhos}</div></div></div>`;
    }
    const nota = it.tipo === 'nota' ? getNote(it.alvo) : null;
    const pasta = it.tipo === 'pasta' ? state.folders.find(f => f.id === it.alvo) : null;
    const fluxo = it.tipo === 'fluxo' ? getFluxo(it.alvo) : null;
    if (it.tipo !== 'busca' && !nota && !pasta && !fluxo) return '';
    const rotulo = nota ? (nota.title || t('Sem título')) : pasta ? pasta.title : fluxo ? fluxo.title : (it.titulo || it.alvo);
    return `<div class="tree-row tree-favorito" data-fav-tipo="${escapeHtml(it.tipo)}" data-fav-alvo="${escapeHtml(it.alvo)}" style="--depth:${prof}"><span class="twisty"></span><span class="tree-icone">${icone('estrela-cheia')}</span><span class="tree-name" title="${escapeHtml(rotulo)}">${escapeHtml(rotulo)}</span><button type="button" class="icon-button fav-remover" data-remover-fav="${escapeHtml(it.tipo)}:${escapeHtml(it.alvo)}" title="${t('Remover dos favoritos')}" aria-label="${t('Remover dos favoritos')}">${icone('fechar')}</button></div>`;
  };
  const html = favoritos.itens.map(it => desenharItem(it, 0)).join('');
  if (!html) return '';
  return `<div class="cofre-favoritos"><div class="cofre-favoritos-titulo"><span>${icone('estrela-cheia')} ${t('Favoritos')}</span></div>${html}</div>`;
}
function gravarHojeDepois() {
  if (!hojeGravavel) return;
  clearTimeout(hojeTimer);
  const alvo = hojeLayout;
  hojeTimer = setTimeout(() => hojeApi.gravar(alvo).catch(erro => status(t('Não foi possível gravar o layout da Hoje: {erro}', { erro: mensagemDoErro(erro) }), true)), 400);
}
// Toda mudança de layout passa por aqui, venha da Hoje ou das Configurações.
function mudarHoje(fn) {
  const antes = layoutDaHoje();
  const depois = fn(antes);
  if (depois === antes) return;
  hojeLayout = depois;
  gravarHojeDepois();
  if (loaded && currentView === 'today') render();
  const aba = $('#cfg-hoje');
  if (aba) aba.innerHTML = conteudoDaAbaHoje();
}
const botaoDaHoje = (acao, conteudo, rotulo, extra = '') => `<button type="button" class="icon-button" data-hoje-acao="${acao}" aria-label="${rotulo}" title="${rotulo}"${extra}>${conteudo}</button>`;
// Formulário das opções: o Kiro desenha a partir da declaração; nenhum HTML vem do plug-in.
function camposDeOpcoes(id, declaracoes, valores) {
  return declaracoes.map(o => {
    const alvo = `data-hoje-id="${escapeHtml(id)}" data-hoje-opcao="${escapeHtml(o.key)}"`, v = valores[o.key];
    const campo = o.type === 'boolean' ? `<input type="checkbox" ${alvo} ${v ? 'checked' : ''} />`
      : o.type === 'number' ? `<input type="number" ${alvo} value="${v}" step="any"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''} />`
      : o.type === 'select' ? `<select ${alvo}>${o.choices.map(c => `<option value="${escapeHtml(c)}" ${c === v ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>`
      : `<input type="text" ${alvo} value="${escapeHtml(v)}" maxlength="80" />`;
    return `<label class="hoje-opcao"><span>${escapeHtml(o.label)}</span>${campo}</label>`;
  }).join('');
}
// Popover nativo: abre por cima sem modal e fecha com Esc ou clique fora.
function popoverDeOpcoes(c, l, prefixo, indice, comTexto = false) {
  if (!c.opcoes.length) return '';
  const alvo = `hoje-op-${prefixo}-${indice}`;
  const botao = comTexto
    ? `<button type="button" class="secondary cfg-pequeno" popovertarget="${alvo}" aria-label="${t('Opções de {titulo}', { titulo: escapeHtml(c.titulo) })}">${icone('detalhes')} ${t('Opções')}</button>`
    : `<button type="button" class="icon-button" popovertarget="${alvo}" aria-label="${t('Opções de {titulo}', { titulo: escapeHtml(c.titulo) })}" title="${t('Opções')}">${icone('detalhes')}</button>`;
  return `${botao}<div popover id="${alvo}" class="hoje-opcoes" data-hoje-id="${escapeHtml(c.id)}"><h3>${escapeHtml(c.titulo)}</h3>${camposDeOpcoes(c.id, c.opcoes, KiroHoje.opcoesEfetivas(l, c.id, c.opcoes))}</div>`;
}
// No modo Personalizar o corpo do cartão fica inerte: dá para arrumar sem marcar hábito sem querer.
function cartaoEmEdicao(c, l, html) {
  const cartao = l.cartoes.find(x => x.id === c.id);
  const indice = catalogoDaHoje().findIndex(x => x.id === c.id);
  const corpo = html || `<section class="card"><div class="card-head"><h2>${escapeHtml(c.titulo)}</h2></div><div class="empty">${t('Nada agora.')}</div></section>`;
  // Ordem e coluna se mudam arrastando o cartão (pelo teclado: Configurações → Hoje); aqui só largura, opções e esconder.
  return `<div class="hoje-cartao" data-hoje-id="${escapeHtml(c.id)}" draggable="true" title="${t('Arraste para mover')}">
    <div class="hoje-ferramentas" role="toolbar" aria-label="${escapeHtml(c.titulo)}">
      ${botaoDaHoje('largura', icone(cartao.largura === 'inteira' ? 'largura-normal' : 'largura-inteira'), cartao.largura === 'inteira' ? t('Largura normal') : t('Largura inteira'))}
      ${popoverDeOpcoes(c, l, 'tela', indice)}
      ${botaoDaHoje('esconder', icone('esconder'), t('Esconder {titulo}', { titulo: escapeHtml(c.titulo) }))}
    </div>
    <div class="hoje-cartao-corpo" inert>${corpo}</div>
  </div>`;
}
function rodapeDaPersonalizacao(catalogo, l) {
  const escondidos = catalogo.filter(c => l.ocultos.includes(c.id));
  return `<div class="hoje-rodape">
    <p class="hoje-instrucao">${icone('arrastar')}<span>${t('Arraste os cartões para trocar a ordem ou a coluna. Passe o mouse sobre um cartão para mudar a largura, as opções ou escondê-lo.')}</span></p>
    <div class="hoje-escondidos"><span class="small-muted">${t('Cartões escondidos:')}</span>${escondidos.map(c => `<button type="button" class="chip" data-hoje-acao="mostrar" data-hoje-id="${escapeHtml(c.id)}">${icone('mais')} ${escapeHtml(c.titulo)}</button>`).join('') || `<span class="small-muted">${t('nenhum')}</span>`}</div>
    <div class="hoje-colunas-escolha" role="group" aria-label="${t('Colunas')}"><span class="small-muted">${t('Colunas:')}</span>${[1, 2, 3].map(n => `<button type="button" class="chip" data-hoje-acao="colunas" data-valor="${n}" aria-pressed="${n === l.colunas}" aria-label="${n > 1 ? t('{n} colunas', { n }) : t('{n} coluna', { n })}">${n}</button>`).join('')}</div>
    <button type="button" class="secondary cfg-pequeno" data-hoje-acao="restaurar">${icone('recarregar')} ${t('Restaurar padrão')}</button>
  </div>`;
}
// Um tratador para a Hoje e para as Configurações. Depois de redesenhar, o foco volta ao mesmo
// botão do mesmo cartão: dá para mover várias vezes só com o teclado.
let hojePopoverAberto = null;
function acaoDaHoje(acao, id, valor, botao) {
  if (acao === 'personalizar') { personalizandoHoje = !personalizandoHoje; render(); $('[data-hoje-acao="personalizar"]')?.focus(); return; }
  if (acao === 'restaurar') {
    // Dois cliques no mesmo botão: o primeiro só pede confirmação (funciona até dentro das Configurações).
    if (botao && !botao.dataset.confirmando) { botao.dataset.confirmando = '1'; botao.textContent = t('Confirmar restauração'); return; }
    return mudarHoje(() => KiroHoje.padrao(catalogoDaHoje()));
  }
  const l = layoutDaHoje(), catalogo = catalogoDaHoje(), cartao = l.cartoes.find(c => c.id === id);
  const fns = {
    subir: () => KiroHoje.subir(l, id, idsVisiveisDaHoje(l, catalogo)),
    descer: () => KiroHoje.descer(l, id, idsVisiveisDaHoje(l, catalogo)),
    largura: () => KiroHoje.definirLargura(l, id, cartao.largura === 'inteira' ? 'normal' : 'inteira'),
    esconder: () => KiroHoje.esconder(l, id),
    mostrar: () => KiroHoje.mostrar(l, id),
    colunas: () => KiroHoje.definirColunas(l, Number(valor)),
    // Configurações: coluna e largura são uma escolha só ("Posição").
    posicao: () => {
      if (valor === 'inteira') return KiroHoje.definirLargura(l, id, 'inteira');
      const normal = KiroHoje.definirLargura(l, id, 'normal'), coluna = Number(valor);
      return cartao.coluna === coluna ? normal : KiroHoje.mover(normal, id, { coluna });
    },
  };
  if (!fns[acao] || (acao !== 'colunas' && !cartao)) return;
  mudarHoje(fns[acao]);
  const seletor = acao === 'colunas' ? `[data-hoje-acao="colunas"][data-valor="${valor}"]`
    : `[data-hoje-id="${CSS.escape(id)}"] [data-hoje-acao="${acao}"]${acao === 'posicao' ? `[data-valor="${valor}"]` : ''}`;
  const raiz = botao?.closest('#cfg-hoje') || document;
  raiz.querySelector(seletor)?.focus();
}
function mudarOpcaoDaHoje(id, chave, valor, campo) {
  const c = catalogoDaHoje().find(x => x.id === id);
  if (!c) return;
  hojePopoverAberto = document.querySelector(`[popover][data-hoje-id="${CSS.escape(id)}"]:popover-open`)?.id || null;
  const antes = hojeLayout;
  mudarHoje(l => KiroHoje.definirOpcao(l, id, chave, valor, c.opcoes));
  // Redesenhar troca o popover por um novo: reabre o mesmo, se estava aberto.
  if (hojePopoverAberto) document.getElementById(hojePopoverAberto)?.showPopover?.();
  // Valor recusado (layout não mudou): o campo volta a mostrar o valor em vigor.
  if (campo && hojeLayout === antes) campo.value = KiroHoje.opcoesEfetivas(hojeLayout, id, c.opcoes)[chave];
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-hoje-acao]');
  if (!b || b.disabled) return;
  e.preventDefault();
  acaoDaHoje(b.dataset.hojeAcao, b.dataset.hojeId ?? b.closest('[data-hoje-id]')?.dataset.hojeId, b.dataset.valor, b);
});
document.addEventListener('change', e => {
  const linha = e.target.closest?.('.hoje-cfg-linha');
  if (linha && e.target.matches('[data-hoje-visivel]')) {
    e.stopPropagation();
    const id = linha.dataset.hojeId, visivel = e.target.checked;
    mudarHoje(l => visivel ? KiroHoje.mostrar(l, id) : KiroHoje.esconder(l, id));
    document.querySelector(`#cfg-hoje [data-hoje-id="${CSS.escape(id)}"] [data-hoje-visivel]`)?.focus();
    return;
  }
  const campo = e.target.closest?.('[data-hoje-opcao]');
  if (!campo) return;
  e.stopPropagation();   // não marca a janela de Configurações como alterada: grava na hora
  if (campo.type === 'number' && campo.value === '') return;
  mudarOpcaoDaHoje(campo.dataset.hojeId, campo.dataset.hojeOpcao, campo.type === 'checkbox' ? campo.checked : campo.type === 'number' ? Number(campo.value) : campo.value, campo);
}, { capture: true });
// modal() marca a janela como alterada também no "input" (não só no "change"): barra aqui para os
// controles da Hoje, que já gravam pelo ouvinte de "change" acima.
document.addEventListener('input', e => {
  if (e.target.matches?.('[data-hoje-opcao], [data-hoje-visivel]')) e.stopPropagation();
}, { capture: true });
document.addEventListener('change', e => {
  const campo = e.target.closest?.('[data-pasta-oculta]');
  if (!campo) return;
  e.stopPropagation(); modalDirty = false;
  mudarHoje(l => ({ ...l, pastasOcultas: campo.checked ? [...new Set([...(l.pastasOcultas || []), campo.dataset.pastaOculta])] : (l.pastasOcultas || []).filter(id => id !== campo.dataset.pastaOculta) }));
}, { capture: true });
document.addEventListener('input', e => { if (e.target.matches?.('[data-pasta-oculta]')) e.stopPropagation(); }, { capture: true });
// Mesma lista da Hoje, em linhas: cada controle chama KiroHoje por mudarHoje, que redesenha as duas telas.
function conteudoDaAbaHoje() {
  const catalogo = catalogoDaHoje(), l = layoutDaHoje(catalogo), porId = new Map(catalogo.map(c => [c.id, c]));
  const lista = l.cartoes.filter(c => porId.has(c.id));
  const linhas = lista.map((cartao, i) => {
    const c = porId.get(cartao.id), visivel = !l.ocultos.includes(c.id), id = escapeHtml(c.id), titulo = escapeHtml(c.titulo);
    // Coluna e largura numa escolha só: onde o cartão fica na Hoje.
    const atual = cartao.largura === 'inteira' ? 'inteira' : String(Math.min(cartao.coluna, l.colunas - 1));
    const segmento = (valor, rotulo, dica) => `<button type="button" class="hoje-seg" data-hoje-acao="posicao" data-valor="${valor}" aria-pressed="${atual === valor}" title="${dica}">${rotulo}</button>`;
    const posicao = [...Array.from({ length: l.colunas }, (_, n) => segmento(String(n), t('Coluna {n}', { n: n + 1 }), t('Na coluna {n}', { n: n + 1 }))), segmento('inteira', t('Largura toda'), t('Ocupa a largura inteira, acima e abaixo das colunas'))].join('');
    return `<div class="cfg-linha hoje-cfg-linha${visivel ? '' : ' escondido'}" data-hoje-id="${id}">
      <label class="cfg-chave hoje-cfg-mostrar" title="${visivel ? t('Esconder da Hoje') : t('Mostrar na Hoje')}"><input type="checkbox" data-hoje-visivel ${visivel ? 'checked' : ''} aria-label="${t('Mostrar {titulo} na Hoje', { titulo })}" /><span class="interruptor" aria-hidden="true"></span></label>
      <span class="cfg-texto hoje-cfg-nome"><span class="cfg-titulo">${titulo}</span><span class="small-muted">${visivel ? escapeHtml(c.origem) : t('Escondido — não aparece na Hoje')}</span></span>
      <span class="hoje-segmentos" role="group" aria-label="${t('Posição de {titulo}', { titulo })}">${posicao}</span>
      <span class="hoje-cfg-ordem" role="group" aria-label="${t('Ordem de {titulo}', { titulo })}">${botaoDaHoje('subir', '↑', t('Mover {titulo} para cima', { titulo }), i === 0 ? ' disabled' : '')}${botaoDaHoje('descer', '↓', t('Mover {titulo} para baixo', { titulo }), i === lista.length - 1 ? ' disabled' : '')}</span>
      <span class="hoje-cfg-opcoes">${popoverDeOpcoes(c, l, 'cfg', catalogo.indexOf(c), true)}</span>
    </div>`;
  }).join('');
  return `<section class="cfg-grupo">
    <header class="cfg-grupo-topo"><span class="cfg-texto"><span class="cfg-titulo">${t('Tela Hoje')}</span><span class="small-muted">${t('Escolha quais cartões aparecem, onde ficam e em que ordem. Também dá para arrumar direto na Hoje, em Personalizar.')}</span></span><button type="button" class="secondary cfg-pequeno" data-hoje-acao="restaurar">${icone('recarregar')} ${t('Restaurar padrão')}</button></header>
    <div class="cfg-linha"><span class="cfg-texto"><span class="cfg-titulo">${t('Colunas na Hoje')}</span><span class="small-muted">${t('Quantas colunas os cartões dividem.')}</span></span><span class="hoje-segmentos" role="group" aria-label="${t('Colunas')}">${[1, 2, 3].map(n => `<button type="button" class="hoje-seg" data-hoje-acao="colunas" data-valor="${n}" aria-pressed="${n === l.colunas}" aria-label="${n > 1 ? t('{n} colunas', { n }) : t('{n} coluna', { n })}">${n}</button>`).join('')}</span></div>
    ${linhas}
    <header class="cfg-grupo-topo"><span class="cfg-texto"><span class="cfg-titulo">${t('Pastas ocultas na Hoje')}</span><span class="small-muted">${t('Inclui subpastas nos cartões nativos. Não criptografa dados; plug-ins podem mostrar suas próprias visões.')}</span></span></header>
    ${state.folders.slice().sort(byTitle).map(f => `<label class="cfg-linha cfg-chave"><span class="cfg-texto"><span class="cfg-titulo">${escapeHtml(f.path || f.title)}</span></span><input type="checkbox" data-pasta-oculta="${escapeHtml(f.id)}" ${(l.pastasOcultas || []).includes(f.id) ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>`).join('')}
    <p class="small-muted cfg-rodape">${t('Guardado em {arquivo}, dentro do cofre.', { arquivo: '<code>.kiro/hoje.json</code>' })}</p>
  </section>`;
}

const pluginApi = {
  versao: () => window.cadernoDesktop ? window.cadernoDesktop.version() : api('version').then(r => r.version),
  lista: () => window.cadernoDesktop ? window.cadernoDesktop.plugins() : api('plugins'),
  inspecionar: id => window.cadernoDesktop ? window.cadernoDesktop.inspectPlugin(id) : api('plugin-inspect', { id }),
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
    if (!r.ok) throw new Error(dados.error || t('Não foi possível remover a chave.'));
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
    return status(t('Não foi possível ler os plug-ins: {erro}', { erro: mensagemDoErro(erro) }), true);
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
  estado.worker.onerror = evento => { evento.preventDefault?.(); falharPlugin(id, evento.message || t('Erro no código do plug-in.')); };
  estado.worker.postMessage({ tipo: 'ativar', id, url: urlDoPlugin(id), permissoes: estado.permissoes });
  estado.prazo = setTimeout(() => falharPlugin(id, t('O plug-in não respondeu na ativação.')), LIMITE_ATIVACAO);
}

function desativarPlugin(id) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  clearTimeout(estado.prazo);
  for (const { rejeitar } of estado.pendentes.values()) rejeitar(new Error(t('O plug-in foi desativado.')));
  estado.pendentes.clear();
  estado.worker.terminate();
  pluginsAtivos.delete(id);
  for (const chave of [...conteudoDosPaineis.keys()]) if (chave.startsWith(`${id}\n`)) conteudoDosPaineis.delete(chave);
  for (const chave of [...conteudoDosBlocos.keys()]) if (chave.startsWith(`${id}\n`)) conteudoDosBlocos.delete(chave);
  for (const chave of [...dadosDasMolduras.keys()]) if (chave.startsWith(`${id}\n`)) dadosDasMolduras.delete(chave);
  for (const f of document.querySelectorAll(`iframe.plugin-moldura[data-plugin="${CSS.escape(id)}"]`)) f.remove();
  agendarBlocosDosPlugins();   // os blocos dele passam a mostrar o aviso
  desenharNavDosPlugins();
  if (currentView === `plugin:${id}`) { currentView = 'today'; if (loaded) render(); }
}

// Um plug-in problemático cai sozinho: os outros e o Kiro seguem de pé.
function falharPlugin(id, mensagem) {
  const estado = pluginsAtivos.get(id);
  const nome = estado?.manifesto?.name || id;
  desativarPlugin(id);
  problemasDosPlugins.set(id, mensagem);
  status(t('Plug-in {nome}: {erro}', { nome, erro: mensagem }), true);
  if (currentView === 'today' && loaded) render();
}

async function atenderPlugin(id, data) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return;
  if (data.tipo === 'pronto') {
    clearTimeout(estado.prazo);
    estado.comandos = (data.registros?.command || []).map(r => ({ id: String(r.id), label: String(r.label || r.id) }));
    estado.paineis = (data.registros?.panel || []).map(r => {
      const v = KiroPlugins.validarOpcoesDoPainel(r.options, r.width);
      return { id: String(r.id), label: String(r.label || r.id), opcoes: v.ok ? v.opcoes : [], largura: v.ok ? v.largura : 'normal', erro: v.ok ? '' : t('Opções do painel inválidas: {erro}', { erro: t(v.erro) }) };
    });
    estado.eventos = (data.registros?.event || []).map(String);
    estado.desenhaBlocos = (data.registros?.block || []).includes('render');
    agendarBlocosDosPlugins();
    desenharNavDosPlugins();
    if (loaded) entregarDia(id);
    // O plug-in fica pronto depois da tela: redesenhar traz os cards dele para o Hoje.
    if (currentView === 'today' && loaded) render();
    return;
  }
  if (data.tipo === 'erro') return falharPlugin(id, data.mensagem || t('Erro no plug-in.'));
  // Resposta a uma ação que nós pedimos (clique num painel, comando).
  if (data.tipo === 'resposta') {
    const pendente = estado.pendentes.get(data.chamada);
    if (!pendente) return;
    estado.pendentes.delete(data.chamada);
    clearTimeout(pendente.prazo);
    return data.erro ? pendente.rejeitar(new Error(data.erro)) : pendente.resolver(data.valor);
  }
  if (data.tipo === 'chamada') return responderChamada(id, estado, data, m => estado.worker.postMessage(m));
}

// Worker e moldura passam pela mesma porta: permissão conferida de novo, mesmos limites.
async function responderChamada(id, estado, data, enviar) {
  try {
    if (!KiroPlugins.podeChamar(estado.permissoes, data.metodo)) throw new Error(t('Sem permissão para {metodo}.', { metodo: data.metodo }));
    const valor = await executarMetodo(id, data.metodo, Array.isArray(data.args) ? data.args : []);
    if (JSON.stringify(valor ?? null).length > LIMITE_MENSAGEM) throw new Error(t('A resposta passou de 2 MB.'));
    if (pluginsAtivos.get(id) === estado) enviar({ tipo: 'resposta', chamada: data.chamada, valor: valor ?? null });
  } catch (erro) {
    if (pluginsAtivos.get(id) === estado) enviar({ tipo: 'resposta', chamada: data.chamada, erro: erro.message });
  }
}

// ---- Molduras (etapa 4) ----
// A tela do plug-in roda num iframe sandbox sem allow-same-origin (origem opaca) e com a
// CSP da resposta cortando a rede. O plug-in é achado pela moldura que mandou a mensagem,
// nunca por um id escrito nela.
const urlDaTela = (id, arquivo) => window.cadernoDesktop ? `kiro-plugin://${id}/${arquivo}` : `/plugins/${id}/${arquivo}`;
const dadosDasMolduras = new Map();       // chave da moldura → data passado pelo bloco/painel
const molduraHtml = (id, arquivo, altura, chave) =>
  `<iframe class="plugin-moldura" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="${escapeHtml(pluginsAtivos.get(id)?.manifesto?.name || id)}" data-plugin="${escapeHtml(id)}" data-arquivo="${escapeHtml(arquivo)}" data-chave="${escapeHtml(chave)}" style="height:${Number(altura) || KiroPlugins.ALTURA_DA_MOLDURA.padrao}px" src="${escapeHtml(urlDaTela(id, arquivo))}"></iframe>`;
function temaAtual() {
  const css = getComputedStyle(document.documentElement);
  const tema = Object.fromEntries(KiroPlugins.VARIAVEIS_DO_TEMA.map(v => [v, css.getPropertyValue(v).trim()]));
  // Os botões dos plug-ins usam o destaque como fundo; a variante forte já garante o contraste do texto.
  if (Kiro.contraste(tema['--primario-texto'], tema['--acento']) < 4.5) tema['--acento'] = tema['--acento-forte'];
  return tema;
}
const molduraDe = janela => [...document.querySelectorAll('iframe.plugin-moldura')].find(f => f.contentWindow === janela);

// Ícone do plug-in (manifest.icon, validado em plugins.js): nome de um ícone do Kiro, que segue o pacote do tema,
// ou o desenho de um <path> no traço do Kiro. Sem ícone (ou nome desconhecido), a peça de quebra-cabeça.
const nomeDoIconeDoPlugin = m => { const v = m?.icon || ''; return TRACOS[v] ? v : v && KiroPlugins.CAMINHO_DE_ICONE.test(v) ? '' : 'plugin'; };
function iconeDoPlugin(m, classe = '') {
  const nome = nomeDoIconeDoPlugin(m);
  return nome ? icone(nome, classe) : `<svg class="icone${classe ? ' ' + classe : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${escapeHtml(m.icon.trim())}"/></svg>`;
}
// Na barra lateral, ícone com nome vai por data-icone, para ser redesenhado quando o tema troca.
const iconeNaLateral = m => { const nome = nomeDoIconeDoPlugin(m); return nome ? `<span class="rotulo-icone" data-icone="${nome}"></span>` : `<span class="rotulo-icone">${iconeDoPlugin(m)}</span>`; };

// Plug-ins com `page` no manifesto ganham um item no grupo "Plug-ins" da barra lateral.
function desenharNavDosPlugins() {
  const nav = document.querySelector('#nav-plugins');
  if (!nav) return;
  const comPagina = [...pluginsAtivos].filter(([, e]) => e.manifesto?.page);
  nav.hidden = !comPagina.length;
  nav.innerHTML = comPagina.length ? `<p class="nav-grupo">${t('Plug-ins')}</p>${comPagina.map(([id, e]) =>
    `<button class="nav-item${currentView === `plugin:${id}` ? ' active' : ''}" data-view="plugin:${escapeHtml(id)}">${iconeNaLateral(e.manifesto)}<span class="rotulo">${escapeHtml(e.manifesto.page.title)}</span></button>`).join('')}` : '';
  for (const b of nav.querySelectorAll('.nav-item')) b.onclick = () => { if (loaded) irPara(b.dataset.view); };
  desenharIconesFixos();
  aplicarLateralCompacta();   // os itens novos também ganham a dica no modo compacto
}
function renderPaginaDoPlugin(id) {
  const estado = pluginsAtivos.get(id), page = estado?.manifesto?.page;
  if (!page) return `<div class="empty">${t('Este plug-in não está ativo.')}</div>`;
  // Prefixo "pagina:" evita colidir com a chave de um painel ou bloco de mesmo nome.
  const chave = `${id}\npagina:`;
  dadosDasMolduras.set(chave, null);
  return `<section class="plugin-pagina" data-plugin="${escapeHtml(id)}">${molduraHtml(id, page.file, 0, chave)}</section>`;
}

window.addEventListener('message', ({ source, data }) => {
  const moldura = source && molduraDe(source);
  if (!moldura || !data || typeof data !== 'object') return;   // só mensagem de uma moldura nossa
  const id = moldura.dataset.plugin, estado = pluginsAtivos.get(id);
  if (!estado) return;
  const enviar = m => moldura.contentWindow?.postMessage(m, '*');
  if (data.tipo === 'pronto') enviar({ tipo: 'ativar', metodos: KiroPlugins.metodosPermitidos(estado.permissoes), data: dadosDasMolduras.get(moldura.dataset.chave) ?? null, tema: temaAtual() });
  else if (data.tipo === 'chamada') responderChamada(id, estado, data, enviar);
  else if (data.tipo === 'altura' && !moldura.closest('.plugin-pagina')) {
    const { min, max } = KiroPlugins.ALTURA_DA_MOLDURA;
    if (Number.isFinite(data.valor)) moldura.style.height = `${Math.min(max, Math.max(min, Math.round(data.valor)))}px`;
  } else if (data.tipo === 'link') {
    // Sem clique recente não abre nada: um clique dentro do iframe também ativa a página pai.
    if (!navigator.userActivation?.isActive) return;
    let url; try { url = new URL(String(data.url)); } catch { return; }
    // No app, window.open cai no setWindowOpenHandler, que abre http(s) no navegador do sistema.
    if (url.protocol === 'http:' || url.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer');
  }
});
// Troca de aparência: as telas abertas recebem as variáveis novas.
function avisarTemaAsMolduras() {
  const tema = temaAtual();
  for (const f of document.querySelectorAll('iframe.plugin-moldura')) f.contentWindow?.postMessage({ tipo: 'tema', tema }, '*');
}

// Pede ao plug-in que rode um comando, desenhe um painel ou trate um evento.
// Evento que estoura o prazo só é recusado: o plug-in continua ativo.
function chamarPlugin(id, registro, dados) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return Promise.reject(new Error(t('Esse plug-in não está ativo.')));
  const chamada = estado.proxima++;
  return new Promise((resolver, rejeitar) => {
    const estourou = registro.tipo === 'event' || registro.tipo === 'block'
      ? () => { estado.pendentes.delete(chamada); rejeitar(new Error(registro.tipo === 'block' ? t('O bloco demorou demais para responder.') : t('O evento demorou demais para responder.'))); }
      : () => falharPlugin(id, t('O plug-in demorou demais para responder.'));
    const prazo = setTimeout(estourou, LIMITE_CHAMADA);
    estado.pendentes.set(chamada, { resolver, rejeitar, prazo });
    estado.worker.postMessage({ tipo: 'acao', chamada, registro, dados });
  });
}

// ---- Eventos dos plug-ins ----
// Toda gravação (da interface ou de plug-in) e toda recarga que troca o estado
// passam por eventosDoCofre, que compara com as notas da última leitura/gravação.
const PROFUNDIDADE_EVENTOS = 3, NOTAS_POR_EVENTO = 20, CHAVE_DO_DIA = 'kiro:lastDay';
// Configurações que a pessoa escolheu para o plug-in (Configurações → Plug-ins). Ficam nos dados do
// próprio plug-in, numa chave que ele não lê nem grava pelo storage: quem muda é só a pessoa.
const CHAVE_DAS_CONFIGURACOES = 'kiro:settings';
const manifestoDoPlugin = id => [...planoDosPlugins.carregar, ...planoDosPlugins.pendentes].find(p => p.id === id)?.manifesto || null;
// Valores efetivos: o que foi guardado e ainda vale pela declaração; o resto, o padrão.
function valoresDasConfiguracoes(declaracoes, guardadas) {
  const g = guardadas && typeof guardadas === 'object' && !Array.isArray(guardadas) ? guardadas : {};
  return Object.fromEntries(declaracoes.map(o => [o.key, Object.hasOwn(g, o.key) && KiroHoje.valorValido(o, g[o.key]) ? g[o.key] : o.default]));
}
async function configuracoesDoPlugin(id) {
  const m = manifestoDoPlugin(id);
  if (!m?.settings.length) return {};
  return valoresDasConfiguracoes(m.settings, (await pluginApi.dados(id))[CHAVE_DAS_CONFIGURACOES]);
}
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
    .catch(erro => avisoDePlugin(id, t('evento {evento}: {erro}', { evento, erro: erro.message }), true))
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
  } catch (erro) { return avisoDePlugin(id, t('evento {evento}: {erro}', { evento: 'day', erro: erro.message }), true); }
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
// Chave da moldura (dadosDasMolduras/data-chave) é diferente da chave do cache do painel:
// painel "page" e a página cheia do plug-in não podem colidir na mesma moldura.
const chaveDaMolduraDoPainel = (id, painel) => `${id}\npainel:${painel}`;
const seletorDoPainel = (id, painel) => `.plugin-painel[data-plugin="${CSS.escape(id)}"][data-painel="${CSS.escape(painel)}"]`;

// Um card por painel registrado; o cabeçalho traz o rótulo do painel e o nome do plug-in.
function cartaoDoPainel(id, painel) {
  const nome = escapeHtml(pluginsAtivos.get(id)?.manifesto?.name || id);
  return `<section class="card plugin-painel" data-plugin="${escapeHtml(id)}" data-painel="${escapeHtml(painel.id)}"><div class="card-head"><h2>${iconeDoPlugin(pluginsAtivos.get(id)?.manifesto)}${escapeHtml(painel.label)}</h2><span class="plugin-fonte">${nome}</span></div><div class="plugin-conteudo">${conteudoDosPaineis.get(chaveDoPainel(id, painel.id)) || `<div class="empty">${t('Carregando…')}</div>`}</div></section>`;
}
const painelDoPlugin = (id, painelId) => pluginsAtivos.get(id)?.paineis?.find(p => p.id === painelId);
const opcoesDoPainel = (id, painel) => KiroHoje.opcoesEfetivas(hojeLayout || { cartoes: [] }, `plugin:${id}:${painel.id}`, painel.opcoes);

// Pede a cada painel visível o desenho atual. Erro do plug-in fica no card dele.
function desenharPaineisDosPlugins() {
  for (const card of document.querySelectorAll('.plugin-painel[data-painel]:not([data-painel=""])')) {
    const { plugin, painel } = card.dataset;
    const registro = painelDoPlugin(plugin, painel);
    if (!registro) continue;
    if (registro.erro) { guardarPainel(plugin, painel, { type: 'text', text: registro.erro }); continue; }
    chamarPlugin(plugin, { tipo: 'panel', id: painel }, { action: '', values: {}, options: opcoesDoPainel(plugin, registro) })
      .then(dados => guardarPainel(plugin, painel, dados))
      .catch(erro => guardarPainel(plugin, painel, { type: 'text', text: erro.message }));
  }
}

function guardarPainel(id, painel, dados) {
  const chave = chaveDoPainel(id, painel);
  const alvo = document.querySelector(`${seletorDoPainel(id, painel)} .plugin-conteudo`);
  if (dados && typeof dados.frame === 'string') {
    const m = KiroPlugins.validarMoldura(dados);
    if (!m.ok) return guardarPainel(id, painel, { type: 'text', text: t(m.erro) });
    const chaveMoldura = chaveDaMolduraDoPainel(id, painel);
    dadosDasMolduras.set(chaveMoldura, m.data);
    const viva = alvo?.querySelector(':scope > iframe.plugin-moldura');
    // Mesmo arquivo: a tela continua viva e só recebe os dados novos.
    if (viva && viva.dataset.arquivo === m.frame) { viva.contentWindow?.postMessage({ tipo: 'dados', data: m.data }, '*'); return; }
    conteudoDosPaineis.set(chave, molduraHtml(id, m.frame, m.height, chaveMoldura));
  } else conteudoDosPaineis.set(chave, KiroPlugins.painelParaHtml(dados, { pluginId: id }));
  if (alvo) alvo.innerHTML = conteudoDosPaineis.get(chave);
}

/**
 * Clique ou Enter num item do painel. `open:<noteId>` é reservado do Kiro e abre a
 * nota; o resto vai para o plug-in, que devolve o painel já atualizado.
 */
function acaoDoPainel(id, painel, acao, values) {
  if (!pluginsAtivos.has(id)) return;
  if (acao.startsWith('open:')) {
    const nota = getNote(acao.slice(5));
    return nota ? abrirNota(nota) : status(t('A nota indicada pelo plug-in não existe mais.'), true);
  }
  const registro = painelDoPlugin(id, painel);
  if (!registro || registro.erro) return;
  chamarPlugin(id, { tipo: 'panel', id: painel }, { action: acao, values: values || {}, options: opcoesDoPainel(id, registro) })
    .then(dados => { if (dados) guardarPainel(id, painel, dados); })
    .catch(erro => status(t('Plug-in {nome}: {erro}', { nome: pluginsAtivos.get(id)?.manifesto?.name || id, erro: mensagemDoErro(erro) }), true));
}

function rodarComandoDoPlugin(id, comando) {
  chamarPlugin(id, { tipo: 'command', id: comando }, {})
    .then(() => desenharPaineisDosPlugins())   // o comando pode ter mudado o que o painel mostra
    .catch(erro => status(t('Plug-in {nome}: {erro}', { nome: pluginsAtivos.get(id)?.manifesto?.name || id, erro: mensagemDoErro(erro) }), true));
}

// ---- Blocos ```kiro:<id> nas notas ----
// renderizarMarkdown emite o marcador com o que já houver no cache; depois do desenho,
// desenharBlocosDosPlugins pede ao plug-in o que falta. Todo HTML do plug-in passa
// pelo higienizador (ou por painelParaHtml) antes de chegar ao DOM.
const conteudoDosBlocos = new Map();      // "<id>\n<fonte>" → HTML já limpo
const blocosEmCurso = new Set();          // mesmas chaves, enquanto o plug-in desenha
// Chave da moldura (dadosDasMolduras/data-chave), com prefixo para não colidir com
// a chave de um painel ou com a página cheia do plug-in que tenham a mesma fonte.
const chaveDaMolduraDoBloco = (id, fonte) => `${id}\nbloco:${fonte}`;
const MAX_BLOCOS_GUARDADOS = 200;
const avisoDeBloco = texto => `<div class="empty plugin-bloco-aviso">${escapeHtml(texto)}</div>`;

function conteudoDoBloco(id, fonte) {
  const estado = pluginsAtivos.get(id);
  if (!estado) return avisoDeBloco(t('Plug-in {id} não está ativo.', { id }));
  const guardado = conteudoDosBlocos.get(`${id}\n${fonte}`);
  if (guardado !== undefined) return guardado;
  // Sem `pronto` ainda não se sabe se ele desenha blocos.
  if (estado.desenhaBlocos === false) return avisoDeBloco(t('Plug-in {nome} não desenha blocos.', { nome: estado.manifesto?.name || id }));
  return avisoDeBloco(t('Carregando…'));
}

// A mesma marcação na leitura e no editor; desenharBlocosDosPlugins a completa depois.
function htmlDoBlocoPlugin(id, fonte, atributos = '') {
  agendarBlocosDosPlugins();
  const pronto = pluginsAtivos.has(id) && conteudoDosBlocos.has(`${id}\n${fonte}`);
  return `<figure class="plugin-bloco" data-plugin="${id}" data-fonte="${escapeHtml(fonte)}" ${atributos}><div class="plugin-bloco-conteudo" data-desenho="${pronto ? 'pronto' : 'aviso'}">${conteudoDoBloco(id, fonte)}</div></figure>`;
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
      if (conteudoDosBlocos.size >= MAX_BLOCOS_GUARDADOS) {
        const descartada = conteudoDosBlocos.keys().next().value;
        conteudoDosBlocos.delete(descartada);
        const corte = descartada.indexOf('\n');
        dadosDasMolduras.delete(chaveDaMolduraDoBloco(descartada.slice(0, corte), descartada.slice(corte + 1)));
      }
      conteudoDosBlocos.set(chave, htmlDoBloco(valor, id, chaveDaMolduraDoBloco(id, fonte)));
      agendarBlocosDosPlugins();
    }, erro => {
      blocosEmCurso.delete(chave);
      // Erro não vai para o cache: o próximo desenho da nota tenta de novo.
      for (const outro of document.querySelectorAll('.plugin-bloco[data-plugin]')) {
        if (outro.dataset.plugin !== id || outro.dataset.fonte !== fonte) continue;
        const caixa = outro.querySelector(':scope > .plugin-bloco-conteudo');
        if (caixa) caixa.innerHTML = avisoDeBloco(t('Erro no bloco: {erro}', { erro: mensagemDoErro(erro) }));
      }
    });
  }
}

// O retorno do plug-in nunca vai cru para o DOM.
function htmlDoBloco(valor, id, chave) {
  if (valor && typeof valor.frame === 'string') {
    const m = KiroPlugins.validarMoldura(valor);
    if (!m.ok) return avisoDeBloco(t(m.erro));
    dadosDasMolduras.set(chave, m.data);
    // ponytail: redesenhar a nota recria a moldura (a tela recarrega); guardar o iframe vivo se algum plug-in precisar de estado.
    return molduraHtml(id, m.frame, m.height, chave);
  }
  if (valor && typeof valor.html === 'string') return KiroPlugins.higienizarHtml(valor.html);
  if (valor && typeof valor.type === 'string') return KiroPlugins.painelParaHtml(valor);
  return avisoDeBloco(t('O plug-in não devolveu nada para desenhar.'));
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
  if (!p) throw new Error(t('Pasta não encontrada: {alvo}.', { alvo }));
  return p.id;
};
const notaParaPlugin = n => ({ id: n.id, title: n.title || '', body: n.body || '', tags: [...(n.tags || [])], folder: caminhoDaPasta(n.folderId), createdAt: n.createdAt || null, updatedAt: n.updatedAt || null });
const tarefaParaPlugin = t => ({ id: t.id, title: t.title, description: t.description || '', due: t.due, priority: t.priority, done: !!t.done, status: Kiro.statusDaTarefa(t), noteId: t.noteId || '' });
const descricaoDoPlugin = v => String(v ?? '').trim().slice(0, 5000);
const etiquetas = v => Array.isArray(v) ? v.map(t => String(t).trim()).filter(Boolean).slice(0, 30) : [];
const notaDoPlugin = id => { const n = getNote(String(id || '')); if (!n) throw new Error(t('Nota não encontrada.')); return n; };
// Gravar pelo mesmo caminho da interface: se o cofre recusar, o plug-in recebe o motivo.
async function gravar(origem) {
  if (busy || failed || !loaded) throw new Error(t('O cofre está ocupado ou não pôde ser lido.'));
  if (!await save(origem)) throw new Error(t('Não foi possível gravar no cofre.'));
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
      if (!String(title || '').trim()) throw new Error(t('A nota precisa de um título.'));
      const nota = { id: uid(), title: String(title).trim().slice(0, 200), body: String(body || ''), links: [], tags: etiquetas(tags), folderId: pastaPorNome(folder), createdAt: Date.now(), updatedAt: Date.now() };
      state.notes = [nota, ...state.notes];
      await gravar(id);
      return notaParaPlugin(getNote(nota.id) || nota);
    }
    case 'notes.update': {
      const nota = notaDoPlugin(a), campos = b || {};
      // A nota está aberta com alterações não salvas: escrever por cima descartaria esse texto em
      // silêncio (a mesma nota "voltaria" ao que estava salvo). Recusa; quem chamou tenta de novo
      // depois que a pessoa salvar.
      if (editing?.id === nota.id && editorDirty) throw new Error(t('A nota está aberta com alterações não salvas; tente de novo depois de salvar.'));
      const nova = { ...nota, updatedAt: Date.now() };
      if (campos.title !== undefined) nova.title = String(campos.title).trim().slice(0, 200);
      if (campos.body !== undefined) nova.body = String(campos.body);
      if (campos.tags !== undefined) nova.tags = etiquetas(campos.tags);
      if (campos.folder !== undefined) nova.folderId = pastaPorNome(campos.folder);
      if (!nova.title) throw new Error(t('A nota precisa de um título.'));
      state.notes = state.notes.map(n => n.id === nota.id ? nova : n);
      // A nota aberta no editor acompanha a mudança, como no arrastar da árvore.
      if (editing?.id === nota.id) { editing = { ...nova, tags: [...nova.tags], links: [...(nova.links || [])] }; editorDirty = false; }
      await gravar(id);
      return notaParaPlugin(getNote(nota.id) || nova);
    }
    case 'notes.trash': {
      const nota = notaDoPlugin(a);
      if (editing?.id === nota.id && editorDirty) throw new Error(t('A nota está aberta com alterações não salvas; tente de novo depois de salvar.'));
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
      const { title, due, priority, noteId, description } = a || {};
      if (!String(title || '').trim()) throw new Error(t('A tarefa precisa de um título.'));
      const tarefa = { id: uid(), title: String(title).trim().slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : today(), priority: ['Baixa', 'Média', 'Alta'].includes(priority) ? priority : 'Média', noteId: noteId && getNote(noteId) ? noteId : '', done: false };
      if (descricaoDoPlugin(description)) tarefa.description = descricaoDoPlugin(description);
      state.tasks = [tarefa, ...state.tasks];
      await gravar(id);
      return tarefaParaPlugin(tarefa);
    }
    case 'tasks.update': {
      const tarefa = state.tasks.find(t => t.id === String(a || ''));
      if (!tarefa) throw new Error(t('Tarefa não encontrada.'));
      const campos = b || {}, nova = { ...tarefa };
      if (campos.title !== undefined) nova.title = String(campos.title).trim().slice(0, 200);
      if (campos.due !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(campos.due)) nova.due = campos.due;
      if (campos.priority !== undefined && ['Baixa', 'Média', 'Alta'].includes(campos.priority)) nova.priority = campos.priority;
      if (campos.done !== undefined) nova.done = !!campos.done;
      if (campos.status !== undefined && Kiro.STATUS_DA_TAREFA.includes(campos.status)) Object.assign(nova, Kiro.moverTarefa(nova, campos.status));
      if (campos.description !== undefined) { const d = descricaoDoPlugin(campos.description); if (d) nova.description = d; else delete nova.description; }
      if (!nova.title) throw new Error(t('A tarefa precisa de um título.'));
      const antes = state.tasks;
      state.tasks = state.tasks.map(t => t.id === tarefa.id ? nova : t);
      criarProximas(antes);
      await gravar(id);
      return tarefaParaPlugin(nova);
    }
    case 'habits.list': return state.habits.map(h => ({ id: h.id, title: h.title, frequency: h.frequency, days: [...(state.habitLog[h.id] || [])] }));
    case 'habits.mark': {
      const habito = state.habits.find(h => h.id === String(a || ''));
      if (!habito) throw new Error(t('Hábito não encontrado.'));
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(b || '') ? b : today();
      if (dia > today()) throw new Error(t('Não dá para marcar um dia que ainda não chegou.'));
      // marcarHabito alterna; marcar de novo o que já está feito não deve desmarcar.
      if (!(state.habitLog[habito.id] || []).includes(dia)) { if (busy || failed || !loaded) throw new Error(t('O cofre está ocupado.')); marcarHabito(habito.id, dia); }
      return true;
    }
    case 'folders.create': {
      const { title, parent } = a || {};
      const nome = String(title || '').trim();
      if (!Kiro.validFolderName(nome)) throw new Error(t('Nome de pasta inválido.'));
      const parentId = pastaPorNome(parent);
      if (state.folders.some(f => (f.parentId || '') === parentId && Kiro.pathKey(f.title) === Kiro.pathKey(nome))) throw new Error(t('Já existe uma pasta com esse nome neste local.'));
      const pasta = { id: uid(), title: nome, parentId, description: '', color: Kiro.folderColor('') };
      state.folders = [pasta, ...state.folders];
      await gravar(id);
      const gravada = state.folders.find(f => f.id === pasta.id) || pasta;
      return { id: gravada.id, title: gravada.title, folder: gravada.path || gravada.title };
    }
    // O espaço do próprio plug-in: 1 MB, conferido no cofre.
    // A chave do último dia entregue é do Kiro: fica fora do que o plug-in vê e grava.
    case 'storage.get': { const { [CHAVE_DO_DIA]: _dia, [CHAVE_DAS_CONFIGURACOES]: _cfg, ...dados } = await pluginApi.dados(id); return a === undefined ? dados : (dados[String(a)] ?? null); }
    case 'settings.get': { const valores = await configuracoesDoPlugin(id); return a === undefined ? valores : (valores[String(a)] ?? null); }
    case 'storage.set': {
      if (String(a) === CHAVE_DO_DIA || String(a) === CHAVE_DAS_CONFIGURACOES) throw new Error(t('Essa chave é reservada pelo Kiro.'));
      const dados = await pluginApi.dados(id);
      if (b === undefined || b === null) delete dados[String(a)]; else dados[String(a)] = b;
      await pluginApi.gravarDados(id, dados);
      return true;
    }
    case 'notify': { avisoDePlugin(id, String(a ?? ''), !!(b && b.error)); return true; }
    case 'fetch': return fetchDoPlugin(id, a, b);
    default: throw new Error(t('Método desconhecido: {metodo}.', { metodo }));
  }
}

// ---- Aparência ----
// Preferência de tela, guardada por instalação (localStorage), não no cofre:
// é ajuste de máquina, não conteúdo que deva viajar junto com as notas.
const { APARENCIA_PADRAO, TEMAS, SKINS, contraste, corValida } = Kiro;
const ACENTOS = [['#C77DFF',frase('Roxo')],['#4EA8DE',frase('Azul')],['#4CC9F0',frase('Ciano')],['#57CC99',frase('Verde')],['#FFD166',frase('Amarelo')],['#FF9F43',frase('Laranja')],['#FF7EB6',frase('Rosa')],['#FF6B6B',frase('Vermelho')]];
function lerAparencia() {
  try { return Kiro.aparenciaValida(JSON.parse(lerPreferencia('aparencia') || '{}')); } catch { return Kiro.aparenciaValida({}); }
}
// Variações do destaque a partir de uma cor só: tons para botão e o texto que fica legível por cima.
const PROPRIEDADES_DO_ACENTO = ['--acento', '--acento-forte', '--acento-escuro', '--acento-texto', '--primario-texto'];
function pintarAcento(raiz, acento) {
  const texto = contraste(acento, '#000000') >= contraste(acento, '#FFFFFF') ? '#000000' : '#FFFFFF';
  const mistura = texto === '#FFFFFF' ? 'black' : 'white';
  raiz.setProperty('--acento', acento);
  raiz.setProperty('--acento-forte', `color-mix(in srgb, ${acento} 78%, ${mistura})`);
  raiz.setProperty('--acento-escuro', `color-mix(in srgb, ${acento} 64%, ${mistura})`);
  raiz.setProperty('--acento-texto', texto);
  raiz.setProperty('--primario-texto', texto);
}
// Último modo de janela pedido ao desktop; começa indefinido para a abertura sempre pedir
// (a janela pode ter nascido transparente de uma sessão em que o tema era o Liquid Glass).
let vidroPedido;
const TRANSPARENCIA_REDUZIDA = matchMedia('(prefers-reduced-transparency: reduce)');
TRANSPARENCIA_REDUZIDA.addEventListener('change', () => aplicarAparencia());
function opacidadeMinimaDoPapel(fundo, textos) {
  const canal = (cor, i) => parseInt(cor.slice(i, i + 2), 16);
  const realce = Kiro.luminancia(textos[0]) > .5 ? .07 : 0; // Reserva o branco máximo da textura Paper sobre temas escuros.
  let minimo = 100;
  for (let p = 99; p >= 0; p--) {
    const fundos = ['#000000', '#FFFFFF'].map(tras => '#' + [1, 3, 5].map(i =>
      Math.round((canal(fundo, i) * p / 100 + canal(tras, i) * (1 - p / 100)) * (1 - realce) + 255 * realce).toString(16).padStart(2, '0')).join(''));
    if (fundos.some(cor => textos.some(texto => Kiro.contraste(texto, cor) < 4.5))) break;
    minimo = p;
  }
  return minimo;
}
function aplicarAparencia(valores) {
  const a = Kiro.aparenciaValida(valores || lerAparencia());
  temaDosIcones = a.tema;
  desenharIconesFixos();
  const html = document.documentElement, raiz = html.style;
  html.classList.remove(...[...html.classList].filter(c => /^(tema|skin)-/.test(c)));
  html.classList.add(...Kiro.classesDaAparencia(a));
  raiz.setProperty('--vidro-opacidade', `${100 - a.transparencia}%`);
  const vidro = a.tema === 'liquid-glass';
  if (!vidro) html.classList.remove('vidro-nativo');
  const escuro = lerPreferencia('vidroEstilo') === 'escuro';
  html.classList.toggle('vidro-escuro', vidro && escuro);
  // O tom é escolha da pessoa e não acompanha o fundo: numa superfície grande, como a janela, a troca distrai.
  html.classList.toggle('vidro-claro', vidro && !escuro);
  window.cadernoDesktop?.definirTomDoVidro?.(!vidro ? 'system' : escuro ? 'dark' : 'light');
  // Com "efeitos de transparência" desligados no sistema, o acrylic vira cor chapada: fica o desktop nítido.
  const comDesfoque = !escuro && !TRANSPARENCIA_REDUZIDA.matches;
  const pedido = `${vidro}|${comDesfoque}`;
  if (pedido !== vidroPedido && window.cadernoDesktop?.definirVidro) {
    vidroPedido = pedido;
    window.cadernoDesktop.definirVidro(vidro, comDesfoque).then(({ ativo, desfoque, cantos }) => {
      html.classList.toggle('vidro-nativo', ativo && html.classList.contains('tema-liquid-glass'));
      html.classList.toggle('vidro-desfocado', desfoque);
      html.classList.toggle('vidro-cantos-sistema', cantos === true);
      coresDaJanela();
    }).catch(() => html.classList.remove('vidro-nativo', 'vidro-desfocado', 'vidro-cantos-sistema'));
  }
  // Tema pronto traz as próprias variáveis (temas.css); o Personalizado põe fundos e acento inline,
  // e o destaque escolhido vale por cima de qualquer tema.
  ['--sidebar-bg', '--content-bg', ...PROPRIEDADES_DO_ACENTO].forEach(p => raiz.removeProperty(p));
  if (a.tema === 'personalizado') {
    raiz.setProperty('--sidebar-bg', a.sidebar);
    raiz.setProperty('--content-bg', a.content);
    if (a.acento.toLowerCase() !== APARENCIA_PADRAO.acento.toLowerCase()) pintarAcento(raiz, a.acento);
  }
  if (a.destaque) pintarAcento(raiz, a.destaque);
  const css = getComputedStyle(html);
  raiz.setProperty('--papel-contraste-minimo', `${vidro ? 0 : opacidadeMinimaDoPapel(css.getPropertyValue('--content-bg').trim(), ['--ink', '--muted'].map(v => css.getPropertyValue(v).trim()))}%`);
  return a;
}
// Botões da janela (app desktop) com as cores do tema: fundo da faixa e cor do texto.
function coresDaJanela() {
  if (!window.cadernoDesktop?.janelaPropria) return;
  const estilo = getComputedStyle(document.documentElement);
  window.cadernoDesktop.coresDaJanela({ fundo: estilo.getPropertyValue('--sidebar-bg').trim(), simbolo: estilo.getPropertyValue('--ink').trim(), vidro: document.documentElement.classList.contains('vidro-nativo') });
}
function gravarAparencia(a) {
  try { localStorage.setItem('kiro.aparencia', JSON.stringify(a)); } catch { /* janela privada: só aplica na sessão */ }
  const temaAntes = temaDosIcones;
  aplicarAparencia(a);
  aplicarVidro();
  coresDaJanela();
  avisarTemaAsMolduras();
  if (temaDosIcones !== temaAntes && loaded && !busy) render();   // árvore e menus com os ícones do tema novo
}
const CAIXAS = [['read',frase('Ler notas')],['create',frase('Criar notas')],['update',frase('Editar notas')],['delete',frase('Excluir notas')]];
const agentApi = {
  load: () => window.cadernoDesktop ? window.cadernoDesktop.agentConfig() : api('agent-config'),
  save: parcial => window.cadernoDesktop ? window.cadernoDesktop.saveAgentConfig(parcial) : api('agent-config', parcial),
};
// Configurações dos plug-ins: fica fora da aba (abaixo), onde a guarda dos testes confere que o
// valor de uma chave secreta só é lido para o envio.
async function gravarConfiguracao(campo) {
  const id = campo.dataset.configPlugin, chave = campo.dataset.config;
  const o = manifestoDoPlugin(id)?.settings.find(x => x.key === chave);
  const msg = campo.closest('.plugin-configuracoes')?.querySelector('.plugin-config-msg');
  if (!o) return;
  const valor = o.type === 'boolean' ? campo.checked : o.type === 'number' ? Number(campo.value) : campo.value;
  try {
    const dados = await pluginApi.dados(id);
    const guardadas = { ...(dados[CHAVE_DAS_CONFIGURACOES] || {}) };
    if (!KiroHoje.valorValido(o, valor)) {
      const atual = valoresDasConfiguracoes([o], guardadas)[chave];
      if (o.type === 'boolean') campo.checked = atual; else campo.value = atual;
      if (msg) msg.textContent = o.type !== 'number' ? t('Valor inválido.')
        : o.min !== undefined && o.max !== undefined ? t('{rotulo}: use um número de {min} a {max}.', { rotulo: o.label, min: o.min, max: o.max })
        : o.min !== undefined ? t('{rotulo}: use um número de {min}.', { rotulo: o.label, min: o.min })
        : o.max !== undefined ? t('{rotulo}: use um número até {max}.', { rotulo: o.label, max: o.max })
        : t('{rotulo}: use um número.', { rotulo: o.label });
      return;
    }
    // O arquivo guarda só o que mudou do padrão.
    if (valor === o.default) delete guardadas[chave]; else guardadas[chave] = valor;
    await pluginApi.gravarDados(id, { ...dados, [CHAVE_DAS_CONFIGURACOES]: guardadas });
    if (msg) msg.textContent = t('Salvo');
    // Painéis e cartões do plug-in na Hoje leem as configurações de novo.
    if (currentView === 'today' && loaded && !busy) render();
  } catch (erro) { if (msg) msg.textContent = t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(erro) }); }
}
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
  if (!m.permissions.length) return `<p class="small-muted plugin-permissoes-vazio">${t('Não pede acesso aos seus dados.')}</p>`;
  return `<ul class="plugin-permissoes">${m.permissions.map(p => {
    const nova = novas.includes(p) || (p === 'network' && hostsNovos.length > 0);
    const hosts = p === 'network' && m.network.length ? `, ${t('só nestes sites:')} ${m.network.map(h => escapeHtml(h)).join(', ')}` : '';
    return `<li${nova ? ' class="nova"' : ''}>${escapeHtml(t(KiroPlugins.rotuloDaPermissao(p)))}${hosts}${nova ? ` ${seloNova()}` : ''}</li>`;
  }).join('')}</ul>`;
}
const novidadesDoPlugin = (id, m) => ({
  novas: KiroPlugins.comparar(escolhasDosPlugins[id]?.permissions, m.permissions).novas,
  hostsNovos: KiroPlugins.comparar(escolhasDosPlugins[id]?.network, m.network).novas,
  segredosNovos: KiroPlugins.comparar(escolhasDosPlugins[id]?.secrets, m.secrets.map(s => s.name)).novas,
});
const seloNova = () => `<span class="plugin-selo">${t('nova')}</span>`;

// Consentimento: as chaves que o plug-in vai usar e para onde cada uma vai.
function itensDeChaves(m, segredosNovos = []) {
  if (!m.secrets.length) return '';
  return `<p class="confirmar-texto">${t('Ele pode usar chaves que você configurar depois em Configurações → Plug-ins. Cada chave só é enviada ao site indicado, e o plug-in nunca vê o valor:')}</p>
    <ul class="plugin-permissoes">${m.secrets.map(s => `<li${segredosNovos.includes(s.name) ? ' class="nova"' : ''}>${t('{chave}, enviada só para {site}', { chave: escapeHtml(s.label), site: escapeHtml(s.host) })}${segredosNovos.includes(s.name) ? ` ${seloNova()}` : ''}</li>`).join('')}</ul>`;
}

// Uma chave: o valor vai do campo direto para o envio e o campo é limpo; da chave só se sabe se está configurada.
function itemDaChave(id, s, configurada, nova) {
  const campo = `chave-${escapeHtml(id)}-${escapeHtml(s.name)}`;
  return `<form class="plugin-chave" data-chave-plugin="${escapeHtml(id)}" data-chave="${escapeHtml(s.name)}">
    <label for="${campo}" class="plugin-chave-rotulo">${escapeHtml(s.label)}${nova ? ` ${seloNova()}` : ''}</label>
    <span class="small-muted">${t('Enviada só para {site}', { site: escapeHtml(s.host) })} · <span class="plugin-chave-estado">${configurada ? t('Configurada') : t('Não configurada')}</span></span>
    <span class="plugin-chave-campos">
      <input id="${campo}" class="plugin-chave-campo" type="password" autocomplete="off" spellcheck="false" required aria-describedby="${campo}-msg" placeholder="${t('Colar a chave')}" />
      <button type="submit" class="secondary cfg-pequeno">${t('Salvar')}</button>
      <button type="button" class="secondary cfg-pequeno" data-remover-chave ${configurada ? '' : 'hidden'}>${t('Remover')}</button>
    </span>
    <span class="plugin-chave-msg small-muted" id="${campo}-msg" role="status" aria-live="polite"></span>
  </form>`;
}

const tamanhoLegivel = b => !(b > 0) ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
function ultimasChamadas(id) {
  const lista = chamadasDeRede.get(id) || [];
  const linhas = lista.map(c => `<tr><td>${KiroIdiomas.formatarData(new Date(c.quando), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>${escapeHtml(c.metodo)}</td><td>${escapeHtml(c.host || '?')}</td><td>${escapeHtml(c.status ?? '')}</td><td>${tamanhoLegivel(c.bytes)}</td></tr>`).join('');
  return `<div class="plugin-chamadas"><span class="plugin-chave-rotulo">${t('Últimas chamadas')}</span>${lista.length
    ? `<div class="plugin-tabela-rolagem"><table class="plugin-tabela"><thead><tr><th scope="col">${t('Hora')}</th><th scope="col">${t('Método')}</th><th scope="col">${t('Site')}</th><th scope="col">${t('Status')}</th><th scope="col">${t('Tamanho')}</th></tr></thead><tbody>${linhas}</tbody></table></div>`
    : `<span class="small-muted">${t('Nenhuma chamada nesta sessão.')}</span>`}</div>`;
}

// Uma linha por plug-in. Todo texto do manifesto entra escapado.
// Campos das configurações do plug-in: os mesmos tipos das opções de painel da Hoje.
function camposDasConfiguracoes(id, nome, declaracoes, valores) {
  const alvo = `plugin-cfg-${escapeHtml(id)}`;
  const botao = `<button type="button" class="icon-button plugin-config-botao" popovertarget="${alvo}" title="${t('Configurações de {nome}', { nome })}" aria-label="${t('Configurações de {nome}', { nome })}">${icone('configuracoes')}</button>`;
  return botao + `<div popover id="${alvo}" class="plugin-configuracoes" role="dialog" aria-label="${t('Configurações de {nome}', { nome })}">`
    + `<header class="plugin-config-topo"><h3>${nome}</h3><button type="button" class="icon-button" popovertarget="${alvo}" popovertargetaction="hide" aria-label="${t('Fechar')}">${icone('fechar')}</button></header>${declaracoes.map(o => {
    const alvo = `data-config-plugin="${escapeHtml(id)}" data-config="${escapeHtml(o.key)}"`, v = valores[o.key];
    const campo = o.type === 'boolean' ? `<input type="checkbox" ${alvo} ${v ? 'checked' : ''} />`
      : o.type === 'number' ? `<input type="number" ${alvo} value="${v}" step="any"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''} />`
      : o.type === 'select' ? `<select ${alvo}>${o.choices.map(c => `<option value="${escapeHtml(c)}" ${c === v ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>`
      : `<input type="text" ${alvo} value="${escapeHtml(v)}" maxlength="80" />`;
    return `<label class="plugin-config"><span>${escapeHtml(o.label)}</span>${campo}</label>`;
  }).join('')}<span class="plugin-config-msg small-muted" role="status" aria-live="polite"></span></div>`;
}
function linhaDoPlugin({ id, manifesto }, situacao, erro = '', chaves = {}, configuracoes = {}) {
  const m = manifesto, nome = escapeHtml(m ? m.name : id);
  const { novas, hostsNovos, segredosNovos = [] } = situacao === 'aguardando' ? novidadesDoPlugin(id, m) : {};
  const ligado = situacao === 'ativo' || situacao === 'parou';
  // Único lugar onde os comandos rodam; a nota aberta segue aberta por baixo do modal.
  const comandos = situacao === 'ativo' ? (pluginsAtivos.get(id)?.comandos || [])
    .map(c => `<button type="button" class="secondary cfg-pequeno" data-comando-plugin="${escapeHtml(id)}" data-comando="${escapeHtml(c.id)}">${iconeDoPlugin(m)} ${escapeHtml(c.label)}</button>`)
    .join('') : '';
  // Manifesto inválido não tem o que ligar; o que parou nesta sessão ainda pode ser desligado.
  const chave = m ? `<label class="cfg-chave"><input type="checkbox" data-plugin-id="${escapeHtml(id)}" ${ligado ? 'checked' : ''} aria-label="${ligado ? t('Desativar {nome}', { nome }) : t('Ativar {nome}', { nome })}" /><span class="interruptor" aria-hidden="true"></span></label>` : '';
  return `<div class="cfg-linha cfg-plugin"><span class="cfg-texto">
    <span class="cfg-titulo cfg-titulo-plugin">${m ? iconeDoPlugin(m) : ''}${nome}</span>
    <span class="small-muted">${m ? t('Versão {versao} · por {autor}', { versao: escapeHtml(m.version), autor: escapeHtml(m.author) }) : t('Pasta {id}', { id: escapeHtml(id) })}</span>
    ${m?.description ? `<span class="small-muted">${escapeHtml(m.description)}</span>` : ''}
    ${m ? itensDePermissao(m, novas, hostsNovos) : ''}
    ${m?.secrets.length ? `<div class="plugin-chaves">${m.secrets.map(s => itemDaChave(id, s, !!chaves[s.name], segredosNovos.includes(s.name))).join('')}</div>` : ''}
    ${situacao === 'ativo' && m.permissions.includes('network') ? ultimasChamadas(id) : ''}
    ${comandos ? `<div class="cfg-botoes plugin-comandos-cfg">${comandos}</div>` : ''}
    ${situacao === 'aguardando' ? `<p class="cfg-aviso">${segredosNovos.length ? t('Uma atualização pediu mais acesso (chave nova: {chaves}). Ligue de novo para revisar o que é novo.', { chaves: segredosNovos.map(n => escapeHtml(m.secrets.find(s => s.name === n)?.label || n)).join(', ') }) : t('Uma atualização pediu mais acesso. Ligue de novo para revisar o que é novo.')}</p>` : ''}
    ${erro ? `<p class="cfg-aviso">${escapeHtml(t(erro))}</p>` : ''}
  </span><span class="plugin-acoes">${m?.settings?.length ? camposDasConfiguracoes(id, nome, m.settings, valoresDasConfiguracoes(m.settings, configuracoes)) : ''}${chave}</span></div>`;
}

async function conteudoDaAbaPlugins() {
  try { await lerPlugins(); }
  catch (erro) { return `<p class="cfg-aviso">${t('Não foi possível ler os plug-ins: {erro}', { erro: escapeHtml(mensagemDoErro(erro)) })}</p>`; }
  const { carregar, pendentes, problemas } = planoDosPlugins;
  // Estado das chaves ({ nome: true }); se não der para ler, aparecem como não configuradas.
  const comChaves = [...carregar, ...pendentes].filter(p => p.manifesto?.secrets.length);
  const chaves = Object.fromEntries(await Promise.all(comChaves.map(p => pluginApi.chaves(p.id).then(c => [p.id, c || {}], () => [p.id, {}]))));
  // Configurações já escolhidas ({ chave: valor }); sem leitura, aparecem os padrões.
  const comConfig = [...carregar, ...pendentes].filter(p => p.manifesto?.settings.length);
  const cfg = Object.fromEntries(await Promise.all(comConfig.map(p => pluginApi.dados(p.id).then(d => [p.id, d?.[CHAVE_DAS_CONFIGURACOES] || {}], () => [p.id, {}]))));
  const grupos = [
    [t('Ativos'), carregar.filter(p => pluginsAtivos.has(p.id)).map(p => linhaDoPlugin(p, 'ativo', '', chaves[p.id], cfg[p.id]))],
    [t('Aguardando permissão'), pendentes.filter(p => p.motivo === 'permissoes-novas').map(p => linhaDoPlugin(p, 'aguardando', '', chaves[p.id], cfg[p.id]))],
    [t('Desligados'), pendentes.filter(p => p.motivo === 'desligado').map(p => linhaDoPlugin(p, 'desligado', '', chaves[p.id], cfg[p.id]))],
    [t('Com problema'), [
      ...carregar.filter(p => !pluginsAtivos.has(p.id)).map(p => linhaDoPlugin(p, 'parou', problemasDosPlugins.get(p.id) || t('O plug-in parou nesta sessão.'), chaves[p.id], cfg[p.id])),
      ...problemas.map(p => linhaDoPlugin({ id: p.id }, 'problema', p.erro)),
    ]],
  ];
  const lista = grupos.filter(([, linhas]) => linhas.length).map(([titulo, linhas]) => `<h4 class="cfg-subtitulo">${titulo}</h4>${linhas.join('')}`).join('');
  const separador = (state.vaultPath || '').includes('\\') ? '\\' : '/';
  const caminho = state.vaultPath ? `${state.vaultPath.replace(/[\\/]+$/, '')}${separador}.kiro${separador}plugins${separador}` : '.kiro/plugins/';
  const botao = (id, rotulo, nomeIcone) => `<button type="button" class="secondary cfg-pequeno" id="${id}">${icone(nomeIcone)} ${rotulo}</button>`;
  return `<section class="cfg-grupo">
    <header class="cfg-grupo-topo"><span class="cfg-texto"><span class="cfg-titulo">${t('Plug-ins')}</span><span class="small-muted">${t('Cada plug-in roda isolado e só alcança o que você permitir ao ligá-lo.')}</span></span></header>
    ${lista || `<p class="small-muted cfg-rodape">${t('Nenhum plug-in encontrado neste cofre.')}</p>`}
    <div class="cfg-linha cfg-linha-coluna"><span class="cfg-texto"><span class="cfg-titulo">${t('Pasta de plug-ins')}</span><span class="small-muted">${t('Cada plug-in é uma pasta com manifest.json e index.js.')}</span></span>
      <code class="cfg-caminho">${escapeHtml(caminho)}</code>
      <div class="cfg-botoes">${window.cadernoDesktop ? botao('cfg-plugins-abrir', t('Abrir pasta de plug-ins'), 'pasta-aberta') : ''}${botao('cfg-plugins-copiar', t('Copiar caminho'), 'copiar')}</div>
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
  const { novas, hostsNovos, segredosNovos } = aguardando ? novidadesDoPlugin(id, m) : { novas: [], hostsNovos: [], segredosNovos: [] };
  modal(aguardando ? t('Plug-in pede mais acesso') : t('Ativar plug-in'), `<p class="confirmar-texto">${aguardando
    ? t('{nome} foi atualizado e agora pede mais do que você tinha permitido. O que está marcado como {selo} ainda não foi concedido.', { nome: `<strong>${nome}</strong>`, selo: seloNova() })
    : t('Ativar {nome}, de {autor}?', { nome: `<strong>${nome}</strong>`, autor: escapeHtml(m.author) })} ${t('Ele vai poder:')}</p>
    ${itensDePermissao(m, novas, hostsNovos)}
    ${itensDeChaves(m, segredosNovos)}
    ${m.page ? `<p class="small-muted plugin-tela-propria">${t('Tem uma tela própria (“{titulo}”), que aparece na barra lateral.', { titulo: escapeHtml(m.page.title) })}</p>` : ''}
    ${m.permissions.some(p => p.endsWith(':read')) ? `<p class="small-muted plugin-aviso-tela">${t('As telas de plug-in rodam isoladas e sem rede, mas o navegador não deixa bloquear por completo o envio por WebRTC. Um plug-in que lê seus dados só deve ser ativado se você confia em quem o escreveu.')}</p>` : ''}
    <details><summary>${t('Inspecionar arquivos do plug-in')}</summary><div id="plugin-arquivos">${t('Carregando…')}</div></details>
    <p class="small-muted plugin-consentimento-nota">${t('Dá para desligar quando quiser, em Configurações → Plug-ins.')}</p>
    <div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button type="button" class="primary" id="confirmar-plugin">${aguardando ? t('Permitir e ativar') : t('Ativar plug-in')}</button></div>`);
  const voltar = () => showSettings('plugins');
  const area = $('#plugin-arquivos');
  pluginApi.inspecionar(id).then(arquivos => {
    if (!area.isConnected) return;
    area.replaceChildren();
    for (const arquivo of arquivos) { const detalhe = document.createElement('details'), titulo = document.createElement('summary'), codigo = document.createElement('pre'); titulo.textContent = arquivo.name; codigo.textContent = arquivo.text; detalhe.append(titulo, codigo); area.append(detalhe); }
  }).catch(erro => { if (area.isConnected) area.textContent = t('Não foi possível inspecionar: {erro}', { erro: mensagemDoErro(erro) }); });
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
      return status(t('Não foi possível ativar o plug-in: {erro}', { erro: mensagemDoErro(erro) }), true);
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
  } catch (erro) { status(t('Não foi possível guardar a escolha: {erro}', { erro: mensagemDoErro(erro) }), true); }
  redesenharAbaPlugins(id);
}

// Eventos por delegação: o conteúdo do painel é redesenhado a cada mudança.
function ligarAbaPlugins(painel) {
  painel.addEventListener('change', evento => {
    const campoDeConfig = evento.target.closest('[data-config-plugin]');
    if (campoDeConfig) return void gravarConfiguracao(campoDeConfig);
    const caixa = evento.target.closest('[data-plugin-id]');
    if (!caixa) return;
    const id = caixa.dataset.pluginId;
    // Ligar só vale depois do "sim" no modal: até lá o interruptor volta para desligado.
    if (caixa.checked) { caixa.checked = false; pedirConsentimento(id); }
    else desligarPlugin(id);
  });
  // Chaves: o valor sai do campo direto para o envio e o campo é limpo antes da resposta,
  // dê certo ou não. O que volta é só o estado.
  const acaoDaChave = async (form, enviar, sucesso) => {
    const msg = form.querySelector('.plugin-chave-msg'), botoes = form.querySelectorAll('button');
    botoes.forEach(b => { b.disabled = true; });
    try {
      const estado = await enviar();
      const configurada = !!estado?.[form.dataset.chave];
      form.querySelector('.plugin-chave-estado').textContent = configurada ? t('Configurada') : t('Não configurada');
      form.querySelector('[data-remover-chave]').hidden = !configurada;
      msg.classList.remove('erro');
      msg.textContent = sucesso;
    } catch (erro) {
      msg.classList.add('erro');
      // O IPC do Electron embrulha a mensagem ("Error invoking remote method ..."): fica só o motivo.
      msg.textContent = mensagemDoErro(erro);
    } finally {
      botoes.forEach(b => { b.disabled = false; });
      // Botão desabilitado ou escondido perde o foco: devolve ao campo, sem jogar o teclado para o topo.
      if (!form.contains(document.activeElement)) form.querySelector('input').focus();
    }
  };
  painel.addEventListener('submit', evento => {
    const form = evento.target.closest('[data-chave]');
    if (!form) return;
    evento.preventDefault();
    const campo = form.querySelector('input');
    const envio = pluginApi.gravarChave(form.dataset.chavePlugin, form.dataset.chave, campo.value);
    campo.value = '';
    acaoDaChave(form, () => envio, t('Chave salva.'));
  });
  painel.addEventListener('click', async evento => {
    const remover = evento.target.closest('[data-remover-chave]');
    if (remover) {
      const form = remover.closest('[data-chave]');
      return acaoDaChave(form, () => pluginApi.removerChave(form.dataset.chavePlugin, form.dataset.chave), t('Chave removida.'));
    }
    const comando = evento.target.closest('[data-comando-plugin]');
    if (comando) return rodarComandoDoPlugin(comando.dataset.comandoPlugin, comando.dataset.comando);
    if (evento.target.closest('#cfg-plugins-abrir')) return window.cadernoDesktop.openPluginsFolder();
    const copiar = evento.target.closest('#cfg-plugins-copiar');
    if (!copiar) return;
    if (await copiarTexto(painel.querySelector('.cfg-caminho').textContent)) {
      copiar.lastChild.textContent = ` ${t('Copiado')}`;
      setTimeout(() => { if (copiar.isConnected) copiar.lastChild.textContent = ` ${t('Copiar caminho')}`; }, 1500);
    }
  });
}
// ---- Fim da aba Plug-ins ----

// ---- Aba Backup ----
const backupApi = {
  status: () => window.cadernoDesktop ? window.cadernoDesktop.backupStatus() : api('backup-status'),
  salvar: parcial => window.cadernoDesktop ? window.cadernoDesktop.saveBackupConfig(parcial) : api('backup-config', parcial),
  executar: opcoes => window.cadernoDesktop ? window.cadernoDesktop.runBackupNow(opcoes) : api('backup-run', opcoes || {}),
  escolherPasta: () => window.cadernoDesktop ? window.cadernoDesktop.chooseBackupFolder() : Promise.resolve(null),
  abrirPasta: () => window.cadernoDesktop ? window.cadernoDesktop.openBackupFolder() : Promise.resolve(''),
  conectarDrive: cred => window.cadernoDesktop ? window.cadernoDesktop.connectGoogleDrive(cred) : api('backup-drive-connect', cred),
  desconectarDrive: () => window.cadernoDesktop ? window.cadernoDesktop.disconnectGoogleDrive() : api('backup-drive-disconnect', {}),
};
const DIAS_BACKUP = [[0, frase('Domingo')], [1, frase('Segunda-feira')], [2, frase('Terça-feira')], [3, frase('Quarta-feira')], [4, frase('Quinta-feira')], [5, frase('Sexta-feira')], [6, frase('Sábado')]];

function formatarInstanteBackup(ms) {
  if (!(ms > 0)) return t('Ainda não executado.');
  return KiroIdiomas.formatarData(new Date(ms), { dateStyle: 'short', timeStyle: 'short' });
}

async function conteudoDaAbaBackup() {
  let info;
  try { info = await backupApi.status(); }
  catch (erro) { return `<p class="cfg-aviso">${t('Não foi possível ler o backup: {erro}', { erro: escapeHtml(mensagemDoErro(erro)) })}</p>`; }
  const { config, estado, drives = [], nuvemConectada = false, temClientSecret = false } = info;
  const texto = (titulo, detalhe = '') => `<span class="cfg-texto"><span class="cfg-titulo">${titulo}</span>${detalhe ? `<span class="small-muted">${detalhe}</span>` : ''}</span>`;
  const botao = (id, rotulo, nomeIcone, extra = '') => `<button type="button" class="secondary cfg-pequeno" id="${id}"${extra}>${icone(nomeIcone)} ${rotulo}</button>`;
  const ultimaCopiaMs = Math.max(0, ...Object.values(estado?.ultimasCopias || {}).map(n => Number(n) || 0));
  const botoesDrive = drives.map(d => `<button type="button" class="secondary cfg-pequeno" data-backup-drive="${escapeHtml(d)}">${icone('pasta-aberta')} ${t('Usar Google Drive ({caminho})', { caminho: escapeHtml(d) })}</button>`).join('');
  const blocoPasta = window.cadernoDesktop
    ? `<code class="cfg-caminho">${escapeHtml(config.destino || t('Nenhuma pasta escolhida.'))}</code>
       <div class="cfg-botoes">${botao('cfg-backup-escolher', t('Escolher pasta'), 'pastas')}${botoesDrive}${config.destino ? botao('cfg-backup-abrir', t('Abrir pasta de backup'), 'pasta-aberta') : ''}</div>`
    : `<div class="cfg-botoes"><input type="text" class="cfg-campo cfg-campo-largo" id="cfg-backup-destino" value="${escapeHtml(config.destino)}" placeholder="${t('Caminho completo da pasta (ex.: G:\\Meu Drive)')}" aria-label="${t('Pasta de destino do backup')}" /><button type="button" class="secondary cfg-pequeno" id="cfg-backup-salvar-destino">${t('Salvar pasta')}</button>${botoesDrive}</div>`;
  const estadoConta = nuvemConectada
    ? (config.nuvem?.email ? t('Conectado como {email}', { email: escapeHtml(config.nuvem.email) }) : t('Conta Google conectada.'))
    : t('Nenhuma conta Google conectada.');
  const blocoNuvem = `<span class="small-muted">${estadoConta}</span>
    <div class="cfg-botoes">
      ${botao('cfg-backup-conectar-drive', nuvemConectada ? t('Reconectar Google Drive') : t('Conectar ao Google Drive'), 'link')}
      ${nuvemConectada && window.cadernoDesktop ? botao('cfg-backup-abrir', t('Abrir pasta de backup'), 'pasta-aberta') : ''}
      ${nuvemConectada ? botao('cfg-backup-desconectar-drive', t('Desconectar'), 'fechar') : ''}
    </div>
    <details class="cfg-ajuda small-muted"><summary>${t('Usar Client ID próprio do Google Cloud (opcional)')}</summary>
      <div class="cfg-botoes cfg-backup-credenciais">
        <input type="text" class="cfg-campo cfg-campo-largo" id="cfg-backup-client-id" value="${escapeHtml(config.nuvem?.clientId || '')}" placeholder="${t('Client ID do Google Cloud')}" aria-label="${t('Client ID do Google Cloud')}" autocomplete="off" spellcheck="false" />
        <input type="password" class="cfg-campo cfg-campo-largo" id="cfg-backup-client-secret" value="" placeholder="${temClientSecret ? t('Client Secret salvo (em branco mantém)') : t('Client Secret do Google Cloud')}" aria-label="${t('Client Secret do Google Cloud')}" autocomplete="off" spellcheck="false" />
      </div>
    </details>`;
  const emNuvem = config.modo === 'nuvem';
  const c = config.copias;
  return `<section class="cfg-grupo">
    <header class="cfg-grupo-topo">${texto(t('Backup e espelho'), t('Grava numa pasta sincronizada no computador ou envia direto para o seu Google Drive na nuvem. Só funciona enquanto o Kiro está aberto.'))}</header>
    <label class="cfg-linha cfg-chave">${texto(t('Ativar backup e espelho automáticos'), t('Quando ligado, mantém o espelho em dia e cria as cópias nas frequências escolhidas.'))}<input type="checkbox" data-backup-campo="ligado" ${config.ligado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
    <div class="cfg-linha">${texto(t('Onde guardar o backup'))}<div class="segmentos cfg-idioma" role="radiogroup" aria-label="${t('Onde guardar o backup')}"><label class="segmento"><input type="radio" name="cfg-backup-modo" value="pasta" ${!emNuvem ? 'checked' : ''} /><span>${t('Pasta no PC')}</span></label><label class="segmento"><input type="radio" name="cfg-backup-modo" value="nuvem" ${emNuvem ? 'checked' : ''} /><span>${t('Google Drive (nuvem)')}</span></label></div></div>
    <div class="cfg-linha cfg-linha-coluna" ${emNuvem ? 'hidden' : ''}>${texto(t('Pasta de destino'), escapeHtml(t('O Kiro cria uma subpasta Kiro/<nome-do-cofre> dentro do destino escolhido.')))}${blocoPasta}</div>
    <div class="cfg-linha cfg-linha-coluna" ${emNuvem ? '' : 'hidden'}>${texto(t('Conta do Google Drive (sem app no PC)'), escapeHtml(t('Envia direto para a pasta Kiro/<nome-do-cofre> na sua nuvem do Google Drive.')))}${blocoNuvem}</div>
    <label class="cfg-linha cfg-chave">${texto(t('Espelho contínuo das notas'), t('Mantém uma cópia aberta das notas (.md) e anexos em espelho/, pronta para ler no Drive ou usar no NotebookLM.'))}<input type="checkbox" data-backup-campo="espelho" ${config.espelho ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
  </section>
  <section class="cfg-grupo">
    <header class="cfg-grupo-topo">${texto(t('Cópias datadas (.zip)'), t('Arquivos .zip do cofre inteiro para voltar no tempo. As cópias mais antigas são apagadas automaticamente além do limite.'))}</header>
    <div class="cfg-linha cfg-linha-coluna">
      <label class="cfg-chave cfg-backup-topo">${texto(t('Cópia por horas'), t('Cria um .zip a cada intervalo de horas enquanto o Kiro estiver aberto.'))}<input type="checkbox" data-backup-copia="horas" data-backup-prop="ligado" ${c.horas.ligado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <div class="cfg-botoes">
        <label class="cfg-backup-campo"><span>${t('A cada (horas)')}</span><input type="number" class="cfg-campo cfg-campo-curto" min="1" max="24" value="${c.horas.intervalo}" data-backup-copia="horas" data-backup-prop="intervalo" /></label>
        <label class="cfg-backup-campo"><span>${t('Cópias a manter')}</span><input type="number" class="cfg-campo cfg-campo-curto" min="1" max="48" value="${c.horas.manter}" data-backup-copia="horas" data-backup-prop="manter" /></label>
      </div>
    </div>
    <div class="cfg-linha cfg-linha-coluna">
      <label class="cfg-chave cfg-backup-topo">${texto(t('Cópia diária'), t('Uma cópia por dia.'))}<input type="checkbox" data-backup-copia="diaria" data-backup-prop="ligado" ${c.diaria.ligado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <div class="cfg-botoes"><label class="cfg-backup-campo"><span>${t('Cópias a manter')}</span><input type="number" class="cfg-campo cfg-campo-curto" min="1" max="60" value="${c.diaria.manter}" data-backup-copia="diaria" data-backup-prop="manter" /></label></div>
    </div>
    <div class="cfg-linha cfg-linha-coluna">
      <label class="cfg-chave cfg-backup-topo">${texto(t('Cópia semanal'), t('Uma cópia por semana, a partir do dia escolhido.'))}<input type="checkbox" data-backup-copia="semanal" data-backup-prop="ligado" ${c.semanal.ligado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <div class="cfg-botoes">
        <label class="cfg-backup-campo"><span>${t('Dia da semana')}</span><select class="cfg-campo" data-backup-copia="semanal" data-backup-prop="dia">${DIAS_BACKUP.map(([v, rotulo]) => `<option value="${v}"${c.semanal.dia === v ? ' selected' : ''}>${t(rotulo)}</option>`).join('')}</select></label>
        <label class="cfg-backup-campo"><span>${t('Cópias a manter')}</span><input type="number" class="cfg-campo cfg-campo-curto" min="1" max="52" value="${c.semanal.manter}" data-backup-copia="semanal" data-backup-prop="manter" /></label>
      </div>
    </div>
    <div class="cfg-linha cfg-linha-coluna">
      <label class="cfg-chave cfg-backup-topo">${texto(t('Cópia mensal'), t('Uma cópia por mês.'))}<input type="checkbox" data-backup-copia="mensal" data-backup-prop="ligado" ${c.mensal.ligado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <div class="cfg-botoes"><label class="cfg-backup-campo"><span>${t('Cópias a manter')}</span><input type="number" class="cfg-campo cfg-campo-curto" min="1" max="36" value="${c.mensal.manter}" data-backup-copia="mensal" data-backup-prop="manter" /></label></div>
    </div>
  </section>
  <section class="cfg-grupo">
    <header class="cfg-grupo-topo">${texto(t('Status do backup'), t('Últimas execuções deste cofre neste computador.'))}</header>
    <div class="cfg-linha">${texto(t('Último espelho'))}<span class="small-muted">${escapeHtml(formatarInstanteBackup(estado?.ultimoEspelho))}</span></div>
    <div class="cfg-linha">${texto(t('Última cópia (.zip)'))}<span class="small-muted">${escapeHtml(formatarInstanteBackup(ultimaCopiaMs))}</span></div>
    ${estado?.ultimoErro ? `<p class="cfg-aviso">${t('Último erro: {erro}', { erro: escapeHtml(t(estado.ultimoErro)) })}</p>` : ''}
    <div class="cfg-linha"><div class="cfg-botoes">${botao('cfg-backup-agora', t('Fazer backup agora'), 'arquivar')}</div><span id="backup-msg" class="small-muted" role="status" aria-live="polite"></span></div>
  </section>`;
}

async function redesenharAbaBackup() {
  const painel = $('#painel-backup');
  if (!painel) return;
  const html = await conteudoDaAbaBackup();
  if (painel.isConnected) painel.innerHTML = html;
}

function lerFormularioBackup(painel) {
  const campo = k => painel.querySelector(`[data-backup-campo="${k}"]`);
  const copia = (tipo, prop) => painel.querySelector(`[data-backup-copia="${tipo}"][data-backup-prop="${prop}"]`);
  const modo = painel.querySelector('input[name="cfg-backup-modo"]:checked')?.value === 'nuvem' ? 'nuvem' : 'pasta';
  const clientId = painel.querySelector('#cfg-backup-client-id')?.value.trim() || '';
  const parcial = {
    ligado: !!campo('ligado')?.checked,
    modo,
    nuvem: { clientId },
    espelho: !!campo('espelho')?.checked,
    copias: {
      horas: { ligado: !!copia('horas', 'ligado')?.checked, intervalo: Number(copia('horas', 'intervalo')?.value || 6), manter: Number(copia('horas', 'manter')?.value || 8) },
      diaria: { ligado: !!copia('diaria', 'ligado')?.checked, manter: Number(copia('diaria', 'manter')?.value || 7) },
      semanal: { ligado: !!copia('semanal', 'ligado')?.checked, dia: Number(copia('semanal', 'dia')?.value || 0), manter: Number(copia('semanal', 'manter')?.value || 4) },
      mensal: { ligado: !!copia('mensal', 'ligado')?.checked, manter: Number(copia('mensal', 'manter')?.value || 12) },
    },
  };
  const destinoWeb = painel.querySelector('#cfg-backup-destino');
  if (destinoWeb) parcial.destino = destinoWeb.value.trim();
  return parcial;
}

function ligarAbaBackup(painel) {
  if (!painel) return;
  painel.addEventListener('change', async evento => {
    if (['cfg-backup-destino', 'cfg-backup-client-id', 'cfg-backup-client-secret'].includes(evento.target.id)) return;
    const msg = painel.querySelector('#backup-msg');
    try {
      await backupApi.salvar(lerFormularioBackup(painel));
      if (evento.target.name === 'cfg-backup-modo') await redesenharAbaBackup();
      else if (msg) msg.textContent = t('Salvo');
    } catch (erro) {
      status(t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(erro) }), true);
      redesenharAbaBackup();
    }
  });
  painel.addEventListener('click', async evento => {
    const driveBtn = evento.target.closest('[data-backup-drive]');
    if (driveBtn) {
      try { await backupApi.salvar({ modo: 'pasta', destino: driveBtn.dataset.backupDrive }); await redesenharAbaBackup(); }
      catch (erro) { status(t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(erro) }), true); }
      return;
    }
    if (evento.target.closest('#cfg-backup-escolher')) {
      try { const res = await backupApi.escolherPasta(); if (res) await redesenharAbaBackup(); }
      catch (erro) { status(t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(erro) }), true); }
      return;
    }
    if (evento.target.closest('#cfg-backup-salvar-destino')) {
      try { await backupApi.salvar(lerFormularioBackup(painel)); await redesenharAbaBackup(); }
      catch (erro) { status(t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(erro) }), true); }
      return;
    }
    if (evento.target.closest('#cfg-backup-abrir')) {
      try { await backupApi.abrirPasta(); }
      catch (erro) { status(mensagemDoErro(erro), true); }
      return;
    }
    const botaoConectar = evento.target.closest('#cfg-backup-conectar-drive');
    if (botaoConectar) {
      const clientId = painel.querySelector('#cfg-backup-client-id')?.value.trim() || '';
      const campoSecret = painel.querySelector('#cfg-backup-client-secret');
      const clientSecret = campoSecret?.value.trim() || '';
      if (campoSecret) campoSecret.value = '';
      const msg = painel.querySelector('#backup-msg');
      botaoConectar.disabled = true;
      if (msg) msg.textContent = t('Conclua a autorização no navegador…');
      try {
        const res = await backupApi.conectarDrive({ clientId, clientSecret });
        if (res?.urlAutorizacao && !window.cadernoDesktop) window.open(res.urlAutorizacao, '_blank', 'noopener,noreferrer');
        await redesenharAbaBackup();
      } catch (erro) {
        await redesenharAbaBackup();
        status(mensagemDoErro(erro), true);
      }
      return;
    }
    if (evento.target.closest('#cfg-backup-desconectar-drive')) {
      try { await backupApi.desconectarDrive(); await redesenharAbaBackup(); }
      catch (erro) { status(mensagemDoErro(erro), true); }
      return;
    }
    const botaoAgora = evento.target.closest('#cfg-backup-agora');
    if (botaoAgora) {
      const msg = painel.querySelector('#backup-msg');
      botaoAgora.disabled = true;
      if (msg) msg.textContent = t('Fazendo backup…');
      try {
        await backupApi.executar({ espelho: true, copia: true });
        await redesenharAbaBackup();
        const novoMsg = painel.querySelector('#backup-msg');
        if (novoMsg) novoMsg.textContent = t('Backup concluído.');
      } catch (erro) {
        await redesenharAbaBackup();
        status(mensagemDoErro(erro), true);
      }
    }
  });
}
// ---- Fim da aba Backup ----

// Aparência aplica na hora; as permissões de agente só no botão Salvar.
const ABAS_CFG = [['personalizacao', frase('Aparência'), 'realce'], ['papel', frase('Papel de parede'), 'imagem'], ['editor', frase('Editor'), 'notas'], ['hoje', frase('Hoje'), 'hoje'], ['sistema', frase('Sistema'), 'pasta-aberta'], ['backup', frase('Backup'), 'arquivar'], ['integracoes', frase('Integrações'), 'link'], ['plugins', frase('Plug-ins'), 'plugin'], ['atalhos', frase('Atalhos'), 'codigo']];
let abaDasConfiguracoes = 'personalizacao';
// Fixos: fazem parte do editor e dos menus, não dá para trocar.
const ATALHOS_FIXOS = [
  ['Ctrl + 1 … 5', frase('Ir para outra tela'), frase('Hoje, Notas, Tarefas, Pastas e Grafo.')],
  ['Ctrl + B', frase('Negrito'), ''],
  ['Ctrl + I', frase('Itálico'), ''],
  ['Ctrl + F', frase('Localizar na nota'), ''],
  ['Ctrl + H', frase('Substituir na nota'), ''],
  ['Ctrl + + / -', frase('Aumentar ou diminuir a interface'), frase('Ctrl + 0 volta ao tamanho normal.')],
  ['[[', frase('Ligar a outra nota'), frase('Mostra sugestões de títulos enquanto você digita.')],
  [frase('Botão direito'), frase('Menus rápidos'), frase('Na árvore de pastas, nas notas, nos hábitos e dentro do texto.')],
  ['Esc', frase('Fechar janela ou menu'), frase('Também sai do modo foco.')],
];
const atalhosNoPadrao = () => Kiro.ATALHOS_EDITAVEIS.every(([id, , , padrao]) => atalhos[id] === padrao);
function linhasDeAtalhos(texto) {
  return Kiro.ATALHOS_EDITAVEIS.map(([id, titulo, detalhe]) => `<div class="cfg-linha atalho-linha" data-atalho="${id}">${texto(t(titulo), t(detalhe))}<span class="atalho-controles"><kbd class="atalho">${teclaDe(id)}</kbd><button type="button" class="secondary cfg-pequeno" data-alterar-atalho="${id}" aria-label="${t('Alterar atalho de {titulo}', { titulo: t(titulo) })}">${t('Alterar')}</button></span><span class="atalho-erro" role="status" aria-live="polite"></span></div>`).join('')
    + `<div class="form-actions atalho-restaurar"${atalhosNoPadrao() ? ' hidden' : ''}><button type="button" class="secondary cfg-pequeno" id="atalhos-padrao">${t('Restaurar padrões')}</button></div>`;
}
function gravarAtalhos(novos) {
  atalhos = Kiro.atalhosValidos(novos);
  try { localStorage.setItem('kiro.atalhos', JSON.stringify(atalhos)); } catch { /* janela privada: vale só nesta sessão */ }
  aplicarLateralCompacta();   // dicas da barra lateral com a tecla nova
}
// Clicar em "Alterar" escuta a próxima combinação. Esc cancela; combinação ruim mostra o motivo.
function ligarAbaAtalhos(texto) {
  const caixa = $('#atalhos-editaveis');
  if (!caixa) return;
  const redesenhar = foco => {
    caixa.innerHTML = linhasDeAtalhos(texto);
    ligarAbaAtalhos(texto);
    if (foco) caixa.querySelector(foco)?.focus();
  };
  caixa.querySelector('#atalhos-padrao')?.addEventListener('click', () => {
    gravarAtalhos({});
    redesenhar('[data-alterar-atalho]');
  });
  for (const botao of caixa.querySelectorAll('[data-alterar-atalho]')) botao.onclick = () => {
    const id = botao.dataset.alterarAtalho, linha = botao.closest('.atalho-linha');
    const kbd = linha.querySelector('kbd'), erro = linha.querySelector('.atalho-erro');
    const voltar = () => redesenhar(`[data-alterar-atalho="${id}"]`);
    const encerrar = () => { gravandoAtalho = false; window.removeEventListener('keydown', ouvir, true); botao.removeEventListener('blur', aoSair); };
    // Tirar o foco do botão (clicar fora, Tab) desiste da gravação.
    const aoSair = () => { encerrar(); redesenhar(); };
    const ouvir = e => {
      // Janela fechada no meio da gravação (sem blur): larga o teclado de volta.
      if (!linha.isConnected) return encerrar();
      if (e.key === 'Tab') return;   // Tab segue navegando e o blur cancela
      // Fase de captura na janela: nada mais (nem o Esc que fecha a janela) vê esta tecla.
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { encerrar(); return voltar(); }
      const combinacao = Kiro.combinacaoDoEvento(e);
      if (!combinacao) return;   // só o modificador por enquanto
      const problema = Kiro.problemaDoAtalho(combinacao, atalhos, id);
      if (problema) { erro.textContent = t(problema); return; }
      encerrar();
      gravarAtalhos({ ...atalhos, [id]: combinacao });
      voltar();
    };
    gravandoAtalho = true;
    linha.classList.add('gravando');
    kbd.textContent = t('Pressione as teclas…');
    botao.textContent = t('Cancelar');
    erro.textContent = '';
    window.addEventListener('keydown', ouvir, true);
    botao.addEventListener('blur', aoSair);
    botao.onclick = () => { encerrar(); voltar(); };
  };
}
async function showSettings(aba = abaDasConfiguracoes) {
  if (busy || !loaded) return;
  let conf = null, erroConf = '';
  const [, abaPlugins, abaBackup] = await Promise.all([
    agentApi.load().then(c => { conf = c; }, error => { erroConf = mensagemDoErro(error); }),
    conteudoDaAbaPlugins(),
    conteudoDaAbaBackup(),
  ]);
  const cores = lerAparencia(), tamanhoInterface = aplicarTamanhoDaInterface();
  const texto = (titulo, detalhe = '', id = '') => `<span class="cfg-texto"><span class="cfg-titulo"${id ? ` id="${id}"` : ''}>${titulo}</span>${detalhe ? `<span class="small-muted">${detalhe}</span>` : ''}</span>`;
  const chave = (id, titulo, marcado, detalhe = '', extra = '') => `<label class="cfg-linha cfg-chave ${extra}">${texto(titulo, detalhe)}<input type="checkbox" data-perm="${id}" ${marcado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>`;
  const cor = (id, titulo, valor) => `<div class="cfg-linha">${texto(titulo)}<label class="cor-ponto" title="${t('Escolher cor')}"><input type="color" data-cor="${id}" value="${valor}" aria-label="${titulo}" /></label></div>`;
  const estiloPersonalizado = a => `--sidebar-bg:${a.sidebar};--content-bg:${a.content};--acento:${a.acento}`;
  const opcaoTema = ([id, nome]) => `<label class="tema-opcao tema-${id}"${id === 'personalizado' ? ` style="${estiloPersonalizado(cores)}"` : ''}><input type="radio" name="tema" value="${id}" class="sr-only" ${cores.tema === id ? 'checked' : ''} /><span class="tema-amostra" aria-hidden="true"><i class="tema-lateral"></i><span class="tema-tela"><b></b><b></b><em></em></span>${icone(`tema-${id}`, 'tema-icone')}</span><span class="tema-nome">${t(nome)}</span></label>`;
  const botao = (id, rotulo, nomeIcone) => `<button type="button" class="secondary cfg-pequeno" id="${id}">${icone(nomeIcone)} ${rotulo}</button>`;
  const DETALHES = { read: t('Buscar e ler notas e tarefas.'), create: t('Criar notas, pastas e tarefas novas.'), update: t('Alterar notas (texto, título, etiquetas e pasta) e tarefas (campos e status).'), delete: t('A nota vai para a lixeira e pode ser restaurada. A tarefa é excluída de vez.') };
  if (!ABAS_CFG.some(([id]) => id === aba)) aba = 'personalizacao';
  const painel = (id, conteudo) => `<div class="cfg-painel" data-painel="${id}" role="tabpanel" id="painel-${id}" aria-labelledby="aba-${id}" ${id === aba ? '' : 'hidden'}>${conteudo}</div>`;
  modal(t('Configurações'), `<div class="cfg">
    <div class="cfg-lateral"><input type="search" class="cfg-busca" id="cfg-busca" placeholder="${t('Buscar configuração')}" aria-label="${t('Buscar nas configurações')}" autocomplete="off" />
    <nav class="cfg-abas" role="tablist" aria-orientation="vertical" aria-label="${t('Seções das configurações')}">${ABAS_CFG.map(([id, rotulo, nomeIcone]) => `<button type="button" role="tab" class="cfg-aba" id="aba-${id}" data-aba="${id}" aria-controls="painel-${id}" aria-selected="${id === aba}" tabindex="${id === aba ? 0 : -1}">${icone(nomeIcone)}<span>${t(rotulo)}</span></button>`).join('')}</nav></div>
    <div class="cfg-conteudo">
    <p class="cfg-sem-resultado small-muted" hidden>${t('Nenhuma configuração com esse nome.')}</p>
    ${painel('personalizacao', `<section class="cfg-grupo cfg-aparencia">
      <header class="cfg-grupo-topo">${texto(t('Aparência'), t('Muda na hora e vale só para esta instalação.'))}<div class="cfg-botoes"><button type="button" class="secondary cfg-pequeno" id="cfg-primeiros-passos">${t('Primeiros passos')}</button><button type="button" class="secondary cfg-pequeno" id="cor-padrao">${icone('recarregar')} ${t('Restaurar padrão')}</button></div></header>
      <label class="cfg-linha">${texto(t('Tamanho do texto da interface'), t('Ajusta menus e controles; o texto das notas mantém seu tamanho.'))}<select id="cfg-tamanho-interface">${[100, 115, 130, 150].map(n => `<option value="${n}"${tamanhoInterface === n ? ' selected' : ''}>${n}%</option>`).join('')}</select></label>
      <div class="cfg-linha cfg-linha-coluna">${texto(t('Skin'), t('Define bordas, espaçamento e fontes. As cores vêm do tema.'), 'skin-rotulo')}
        <div class="skins" role="radiogroup" aria-labelledby="skin-rotulo">${SKINS.map(([id, nome, desc]) => `<label class="skin-opcao"><input type="radio" name="skin" value="${id}" class="sr-only" ${cores.skin === id ? 'checked' : ''} /><span class="skin-nome">${t(nome)}</span><span class="skin-desc">${t(desc)}</span></label>`).join('')}</div>
      </div>
      <div class="cfg-linha cfg-linha-coluna" id="cfg-vidro" ${cores.tema === 'liquid-glass' ? '' : 'hidden'}>
        <span class="rotulo-campo" id="cfg-vidro-estilo">${t('Estilo do vidro')}</span>
        <div class="segmentos" role="radiogroup" aria-labelledby="cfg-vidro-estilo">${[['claro', t('Claro')], ['escuro', t('Escuro')]].map(([v, r]) => `<label class="segmento"><input type="radio" name="vidro-estilo" value="${v}" ${(lerPreferencia('vidroEstilo') === 'escuro' ? 'escuro' : 'claro') === v ? 'checked' : ''} /><span>${r}</span></label>`).join('')}</div>
        <label class="cfg-vidro-controle" for="cfg-transparencia"><span>${t('Transparência do fundo')}</span><output id="cfg-transparencia-valor" for="cfg-transparencia">${cores.transparencia}%</output></label>
        <input type="range" id="cfg-transparencia" min="0" max="80" step="1" value="${cores.transparencia}" aria-describedby="cfg-vidro-detalhe" />
        <p class="small-muted" id="cfg-vidro-detalhe">${t('Mais transparência revela a área de trabalho, sem apagar o texto. No navegador, o tema usa um fundo interno.')}</p>
        <label class="cfg-chave cfg-vidro-controle"><span>${t('Fundo sólido nas notas')}</span><input type="checkbox" id="cfg-notas-solidas" ${lerPreferencia('vidroNotasSolidas') === '1' ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
        <label class="cfg-chave cfg-vidro-controle"><span>${t('Fundo sólido no grafo')}</span><input type="checkbox" id="cfg-grafo-solido" ${lerPreferencia('vidroGrafoSolido') === '1' ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      </div>
      <div class="cfg-linha cfg-linha-coluna">${texto(t('Tema'), t('Escolhe as cores da interface.'), 'tema-rotulo')}
        ${[['classicos', t('Clássicos')], ['anime', t('Anime')]].map(([grupo, titulo]) => `<div class="temas-grupo"><h4 class="cfg-subtitulo">${titulo}</h4><div class="temas" role="radiogroup" aria-labelledby="tema-rotulo">${TEMAS.filter(tema => tema[2] === grupo).map(opcaoTema).join('')}</div></div>`).join('')}
        <div class="temas-grupo"><div class="temas">${opcaoTema(['personalizado', frase('Personalizado')])}</div></div>
      </div>
      <div class="cfg-personalizado" id="cfg-personalizado" ${cores.tema === 'personalizado' ? '' : 'hidden'}>
      ${cor('sidebar', t('Fundo da barra lateral'), cores.sidebar)}
      ${cor('content', t('Fundo da área de texto'), cores.content)}
      </div>
      <div class="cfg-linha cfg-linha-coluna">${texto(t('Cor de destaque'), t('Seleção, foco, links e ação principal, em qualquer tema.'), 'acento-rotulo')}
        <div class="amostras" role="radiogroup" aria-labelledby="acento-rotulo"><label class="amostra" data-cor-pasta="" title="${t('Do tema')}"><input type="radio" name="destaque" value="" ${cores.destaque ? '' : 'checked'} /><span class="sr-only">${t('Do tema')}</span></label>${ACENTOS.map(([hex, nome]) => `<label class="amostra" style="--cor-pasta:${hex}" title="${t(nome)}"><input type="radio" name="destaque" value="${hex}" ${hex.toLowerCase() === cores.destaque.toLowerCase() ? 'checked' : ''} /><span class="sr-only">${t(nome)}</span></label>`).join('')}<label class="cor-ponto cor-livre" title="${t('Outra cor')}"><input type="color" id="destaque-livre" value="${cores.destaque || cores.acento}" aria-label="${t('Outra cor de destaque')}" /></label></div>
        <p class="cfg-aviso" id="acento-aviso" hidden>${t('Essa cor tem pouco contraste com o fundo: textos e ícones podem ficar difíceis de ler.')}</p>
      </div>

    </section>`)}
    ${painel('papel', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Papel de parede'), t('Imagem até 4K (3840 × 2160), GIF ou vídeo MP4/WebM animado de até 200 MB. Preenche a janela e aparece atrás de todas as telas, menos a de Pastas. Vale só para esta instalação.'))}</header>
      <div class="cfg-linha cfg-linha-coluna" id="cfg-papel"${document.documentElement.classList.contains('com-papel-de-parede') ? ' data-tem-papel' : ''}>${texto(t('Imagem ou vídeo'))}
        <div class="papel-controles"><span class="papel-previa" aria-hidden="true"></span><label class="secondary cfg-pequeno papel-escolher">${icone('imagem')} ${t('Escolher arquivo')}<input type="file" accept="image/*,video/mp4,video/webm" id="papel-arquivo" class="sr-only" /></label><button type="button" class="secondary cfg-pequeno papel-so-com" id="papel-remover">${icone('lixeira')} ${t('Remover')}</button></div>
        <label class="papel-veu papel-so-com"><span class="small-muted">${t('Suavizar a imagem')}</span><input type="range" id="papel-veu" min="0" max="90" step="5" value="${lerPreferencia('papelDeParedeVeu') ?? VEU_PADRAO}" /></label>
        <p class="small-muted papel-so-com">${t('O contraste mínimo do tema é preservado para manter o texto legível.')}</p>
        <label class="cfg-chave papel-so-video papel-segue-sistema"><span class="small-muted">${t('Pausar o vídeo quando o sistema pede menos movimento')}</span><input type="checkbox" id="papel-segue-sistema" ${videoSegueOSistema() ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
        <label class="papel-veu papel-so-com papel-so-vidro"><span class="small-muted">${t('Transparência do papel de parede')}</span><input type="range" id="papel-transparencia" min="0" max="90" step="5" value="${lerPreferencia('papelTransparencia') ?? 0}" /></label>
        <label class="papel-veu papel-so-com"><span class="small-muted">${t('Opacidade dos cartões')}</span><input type="range" id="papel-opacidade" min="30" max="100" step="5" value="${lerPreferencia('papelOpacidadeCartoes') ?? 100}" /></label>
        <p class="cfg-aviso" id="papel-erro" role="status" hidden></p>
      </div>
    </section>`)}
    ${painel('editor', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Notas'), t('O que aparece junto do texto da nota aberta.'))}</header>
      <label class="cfg-linha cfg-chave">${texto(t('Mostrar “Mencionada em”'), t('Lista, no fim da nota, as notas que apontam para ela com [[links]].'))}<input type="checkbox" id="cfg-mencoes" ${mostrarMencoes ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <label class="cfg-linha cfg-chave">${texto(t('Corretor ortográfico'), t('Sublinha palavras erradas em português e em inglês, ao mesmo tempo. Botão direito sobre a palavra mostra as sugestões.'))}<input type="checkbox" id="cfg-corretor" ${corretorLigado ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
    </section>`)}
    ${painel('hoje', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Lembretes'), t('Avisa das tarefas de hoje e atrasadas e dos hábitos ainda não feitos, uma vez por dia.') + ' ' + t('Os avisos só chegam enquanto o Kiro está aberto.'))}</header>
      <label class="cfg-linha cfg-chave">${texto(t('Lembretes'))}<input type="checkbox" id="cfg-lembretes" ${lembretesLigados() ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>
      <div class="cfg-linha"><label for="cfg-hora-tarefas">${texto(t('Horário do aviso das tarefas'))}</label><input type="time" id="cfg-hora-tarefas" value="${horaDoLembrete('tarefas')}" /></div>
      <div class="cfg-linha"><label for="cfg-hora-habitos">${texto(t('Horário do aviso dos hábitos'))}</label><input type="time" id="cfg-hora-habitos" value="${horaDoLembrete('habitos')}" /></div>
    </section><div id="cfg-hoje">${conteudoDaAbaHoje()}</div>`)}
    ${painel('sistema', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Idioma'), t('Idioma dos menus, botões e avisos. Suas notas não mudam.'))}</header>
      <div class="cfg-linha">${texto(t('Idioma da interface'), '', 'cfg-idioma-rotulo')}<div class="segmentos cfg-idioma" id="cfg-idioma" role="radiogroup" aria-labelledby="cfg-idioma-rotulo">${KiroIdiomas.IDIOMAS.map(i => `<label class="segmento"><input type="radio" name="cfg-idioma" value="${i.codigo}" ${i.codigo === KiroIdiomas.idioma() ? 'checked' : ''} /><span>${escapeHtml(i.nome)}</span></label>`).join('')}</div></div>
      ${window.cadernoDesktop ? `<label class="cfg-linha cfg-chave">${texto(t('Captura global'), t('Abrir o Kiro e capturar com Ctrl+Shift+Espaço (⌘+Shift+Espaço no Mac).'))}<input type="checkbox" id="cfg-captura-global" ${lerPreferencia('capturaGlobal') === '1' ? 'checked' : ''} /><span class="interruptor" aria-hidden="true"></span></label>` : ''}
    </section>
    <section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Cofre'), t('A pasta onde suas notas ficam, como arquivos Markdown.'))}</header>
      <div class="cfg-linha cfg-linha-coluna">${texto(t('Local'))}<code class="cfg-caminho">${escapeHtml(state.vaultPath || 'vault/')}</code>
        <div class="cfg-botoes">${window.cadernoDesktop ? botao('cfg-abrir-pasta', t('Abrir pasta'), 'pasta-aberta') + botao('cfg-trocar-cofre', t('Escolher outro cofre'), 'pastas') : ''}${botao('cfg-copiar-caminho', t('Copiar caminho'), 'copiar')}</div>
      </div>
      <div class="cfg-linha">${texto(t('Recarregar cofre'), t('Lê os arquivos de novo, se você editou algo fora do Kiro.'))}${botao('cfg-recarregar', t('Recarregar'), 'recarregar')}</div>
    </section>
    <section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Dados'), t('Backup em um arquivo JSON com notas, pastas, tarefas e hábitos.'))}</header>
      <div class="cfg-linha">${texto(t('Exportar backup'), t('As imagens coladas nas notas não entram no arquivo.'))}${botao('cfg-exportar', t('Exportar'), 'exportar')}</div>
      <div class="cfg-linha">${texto(t('Importar backup'), t('Substitui os dados atuais; antes, pede confirmação.'))}<label class="secondary cfg-pequeno cfg-arquivo">${icone('importar')} ${t('Importar')}<input type="file" id="cfg-importar" accept="application/json" /></label></div>
      <div class="cfg-linha">${texto(t('Lixeira'), t('Notas e pastas excluídas, prontas para restaurar.'))}${botao('cfg-lixeira', t('Abrir lixeira'), 'lixeira')}</div>
    </section>`)}
    ${painel('integracoes', conf ? `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('IA e integrações'), t('Agentes externos usam a Agent API, sempre dentro deste cofre. O Kiro não envia nada para a nuvem por conta própria.'))}</header>
      ${chave('enabled', t('Permitir agentes neste cofre'), conf.enabled, t('Liga o acesso para programas como o Claude Desktop.'))}
      ${chave('mcp', t('Servidor MCP'), conf.mcp.enabled, t('Conexão local pelo stdio, sem abrir porta de rede.'), 'cfg-depende')}
      <h4 class="cfg-subtitulo cfg-depende">${t('O que o agente pode fazer')}</h4>
      ${CAIXAS.map(([id, rotulo]) => chave(id, t(rotulo), conf.permissions[id], DETALHES[id], 'cfg-depende')).join('')}
      ${chave('confirm', t('Confirmar ações destrutivas'), conf.requireConfirmationForDestructive, t('Pede confirmação antes de excluir.'), 'cfg-depende')}
      <p class="small-muted cfg-rodape">${t('Guardado em {arquivo}, dentro do cofre.', { arquivo: '<code>.kiro/agent.json</code>' })} <span id="ai-estado" role="status" aria-live="polite"></span></p>
    </section>` : `<p class="cfg-aviso">${t('Não foi possível ler a configuração de agentes: {erro}', { erro: escapeHtml(erroConf) })}</p>`)}
    ${painel('backup', abaBackup)}
    ${painel('plugins', abaPlugins)}
    ${painel('atalhos', `<section class="cfg-grupo">
      <header class="cfg-grupo-topo">${texto(t('Atalhos'), t('Para fazer as coisas sem tirar a mão do teclado.'))}</header>
      <div id="atalhos-editaveis">${linhasDeAtalhos(texto)}</div>
      ${ATALHOS_FIXOS.map(([tecla, titulo, detalhe]) => `<div class="cfg-linha">${texto(t(titulo), t(detalhe))}<kbd class="atalho">${t(tecla)}</kbd></div>`).join('')}
    </section>`)}
    </div>
  </div>`);

  // Abas: clique ou setas esquerda/direita; a última aberta volta na próxima vez.
  ligarAbaAtalhos(texto);
  // Grava na hora: não há o que "descartar" ao fechar a janela.
  // Papel de parede. stopPropagation: senão o change/input chega ao modal e o marca como alterado.
  const erroDoPapel = $('#papel-erro');
  $('#papel-arquivo')?.addEventListener('change', async e => {
    e.stopPropagation(); modalDirty = false;
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    // Arrastar o arquivo para o seletor pula o filtro accept: vídeo que o Chromium não toca (MOV, MKV, AVI) vira aviso, não tela parada.
    if (arquivo.type.startsWith('video/') && !['video/mp4', 'video/webm'].includes(arquivo.type)) { erroDoPapel.textContent = t('Esse formato de vídeo não toca no Kiro. Use MP4 ou WebM.'); erroDoPapel.hidden = false; return; }
    const animado = arquivo.type.startsWith('video/') || arquivo.type === 'image/gif';
    if (animado && arquivo.size > LIMITE_DO_PAPEL_ANIMADO) { erroDoPapel.textContent = t('Arquivo grande demais: GIF ou vídeo de até 200 MB.'); erroDoPapel.hidden = false; return; }
    let imagem;
    // GIF e vídeo vão como vieram (reduzir tiraria a animação); foto é reduzida até 4K.
    try { imagem = animado ? arquivo : await reduzirImagem(arquivo); }
    catch { erroDoPapel.textContent = t('Não foi possível abrir essa imagem.'); erroDoPapel.hidden = false; return; }
    try { await papelGuardado('gravar', imagem); }
    catch { erroDoPapel.textContent = t('Não foi possível guardar a imagem neste navegador (janela privada ou sem espaço).'); erroDoPapel.hidden = false; return; }
    erroDoPapel.hidden = true;
    await aplicarPapelDeParede();
  });
  $('#cfg-lembretes')?.addEventListener('change', async e => {
    e.stopPropagation(); modalDirty = false;
    if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* sem permissão: o aviso só não aparece */ } }
    if (e.target.checked && (typeof Notification === 'undefined' || Notification.permission !== 'granted')) { e.target.checked = false; status(t('Permita as notificações para receber lembretes.'), true); return; }
    gravarPreferencia('lembretes', e.target.checked ? '1' : '0');
    verificarLembretes();
  });
  for (const k of ['tarefas', 'habitos']) $(`#cfg-hora-${k}`)?.addEventListener('change', e => { e.stopPropagation(); modalDirty = false; if (/^\d{2}:\d{2}$/.test(e.target.value)) { gravarPreferencia(`lembreteHora.${k}`, e.target.value); verificarLembretes(); } });
  document.querySelectorAll('input[name="vidro-estilo"]').forEach(r => r.addEventListener('change', e => {
    e.stopPropagation(); modalDirty = false;
    gravarPreferencia('vidroEstilo', r.value);
    aplicarAparencia();
    coresDaJanela();
  }));
  $('#cfg-notas-solidas')?.addEventListener('change', e => {
    e.stopPropagation(); modalDirty = false;
    gravarPreferencia('vidroNotasSolidas', e.target.checked ? '1' : '0');
    aplicarVidro();
  });
  $('#cfg-grafo-solido')?.addEventListener('change', e => {
    e.stopPropagation(); modalDirty = false;
    gravarPreferencia('vidroGrafoSolido', e.target.checked ? '1' : '0');
    aplicarVidro();
  });
  $('#papel-segue-sistema')?.addEventListener('change', e => {
    e.stopPropagation(); modalDirty = false;
    try { localStorage.setItem('kiro.papelVideoSegueSistema', e.target.checked ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
    sincronizarVideoDoPapel();
  });
  $('#papel-remover')?.addEventListener('click', async () => {
    try { await papelGuardado('apagar'); } catch { /* sem IndexedDB: nada guardado */ }
    await aplicarPapelDeParede();
  });
  $('#papel-veu')?.addEventListener('input', e => {
    e.stopPropagation(); modalDirty = false;
    try { localStorage.setItem('kiro.papelDeParedeVeu', e.target.value); } catch { /* janela privada: vale só nesta sessão */ }
    document.documentElement.style.setProperty('--papel-veu', `${e.target.value}%`);
  });
  $('#papel-opacidade')?.addEventListener('input', e => {
    e.stopPropagation(); modalDirty = false;
    try { localStorage.setItem('kiro.papelOpacidadeCartoes', e.target.value); } catch { /* janela privada: vale só nesta sessão */ }
    aplicarVidro();
  });
  $('#papel-transparencia')?.addEventListener('input', e => {
    e.stopPropagation(); modalDirty = false;
    gravarPreferencia('papelTransparencia', e.target.value);
    aplicarTransparenciaDoPapel();
  });
  $('#papel-transparencia')?.addEventListener('change', e => e.stopPropagation());
  $('#papel-veu')?.addEventListener('change', e => e.stopPropagation());
  $('#papel-opacidade')?.addEventListener('change', e => e.stopPropagation());
  $('#cfg-idioma')?.addEventListener('change', async e => {
    e.stopPropagation();   // senão o "change" marca a janela como alterada
    modalDirty = false;
    await trocarIdioma(e.target.value);
    closeModal(true);
    showSettings('sistema');   // a janela reabre já no idioma novo
  });
  $('#cfg-corretor')?.addEventListener('change', e => {
    e.stopPropagation();
    modalDirty = false;
    corretorLigado = e.target.checked;
    try { localStorage.setItem('kiro.corretor', corretorLigado ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
    aplicarCorretor();
  });
  $('#cfg-mencoes')?.addEventListener('change', e => {
    mostrarMencoes = e.target.checked;
    try { localStorage.setItem('kiro.mostrarMencoes', mostrarMencoes ? '1' : '0'); } catch { /* janela privada: vale só nesta sessão */ }
    e.stopPropagation();   // senão o "change" chega à janela e a marca como alterada
    modalDirty = false;
    document.querySelector('.doc-mencoes')?.remove();
    if (editing) $('#doc-corpo')?.insertAdjacentHTML('afterend', renderMencoes(editing));
  });
  const abas = [...document.querySelectorAll('.cfg-aba')];
  const mostrar = id => {
    const trocou = $('#painel-plugins')?.hidden;
    abaDasConfiguracoes = id;
    abas.forEach(b => { const ativa = b.dataset.aba === id; b.setAttribute('aria-selected', ativa); b.tabIndex = ativa ? 0 : -1; });
    document.querySelectorAll('.cfg-painel').forEach(p => { p.hidden = p.dataset.painel !== id; });
    if (id === 'plugins' && trocou) redesenharAbaPlugins();   // estado das chaves e últimas chamadas em dia
    if (id === 'backup') redesenharAbaBackup();
  };
  // Busca: mostra todas as abas de uma vez e só as linhas cujo texto combina (ou o grupo inteiro,
  // se o título do grupo combina). Sem texto, volta para a aba de antes.
  const caixa = document.querySelector('.cfg');
  $('#cfg-busca').addEventListener('input', e => {
    e.stopPropagation(); modalDirty = false;
    const termo = Kiro.normalize(e.target.value.trim());
    caixa.classList.toggle('buscando', Boolean(termo));
    document.querySelectorAll('.cfg-fora-da-busca').forEach(el => el.classList.remove('cfg-fora-da-busca'));
    let achou = false;
    if (termo) for (const painelDaAba of document.querySelectorAll('.cfg-painel')) {
      painelDaAba.hidden = false;   // todas as abas de uma vez; as sem resultado somem pela classe
      let noPainel = false;
      for (const grupo of painelDaAba.querySelectorAll('.cfg-grupo')) {
        const topo = grupo.querySelector(':scope > .cfg-grupo-topo');
        const todoOGrupo = topo && Kiro.normalize(topo.textContent).includes(termo);
        let noGrupo = todoOGrupo;
        for (const linha of grupo.querySelectorAll(':scope > :not(.cfg-grupo-topo)')) {
          const combina = todoOGrupo || Kiro.normalize(linha.textContent).includes(termo);
          linha.classList.toggle('cfg-fora-da-busca', !combina);
          noGrupo ||= combina;
        }
        grupo.classList.toggle('cfg-fora-da-busca', !noGrupo);
        noPainel ||= noGrupo;
      }
      painelDaAba.classList.toggle('cfg-fora-da-busca', !noPainel);
      achou ||= noPainel;
    }
    document.querySelector('.cfg-sem-resultado').hidden = !termo || achou;
    if (!termo) mostrar(abaDasConfiguracoes);
  });
  $('#cfg-busca').addEventListener('change', e => e.stopPropagation());
  abas.forEach((b, i) => {
    b.onclick = () => { if ($('#cfg-busca').value) { $('#cfg-busca').value = ''; $('#cfg-busca').dispatchEvent(new Event('input')); } mostrar(b.dataset.aba); };
    b.onkeydown = e => {
      const proxima = e.key === 'ArrowDown' || e.key === 'ArrowRight', anterior = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      if (!proxima && !anterior) return;
      e.preventDefault();
      const alvo = abas[(i + (proxima ? 1 : abas.length - 1)) % abas.length];
      mostrar(alvo.dataset.aba); alvo.focus();
    };
  });

  // Personalização
  $('#cfg-tamanho-interface').onchange = e => {
    const tamanho = aplicarTamanhoDaInterface(e.target.value);
    try { localStorage.setItem('kiro.tamanhoInterface', String(tamanho)); } catch { /* vale nesta sessão */ }
  };
  const corAtual = () => ({
    ...lerAparencia(),
    tema: 'personalizado',
    sidebar: document.querySelector('[data-cor="sidebar"]').value,
    content: document.querySelector('[data-cor="content"]').value,
  });
  // O card Personalizado mostra as cores manuais atuais.
  const gravarCores = () => { const a = corAtual(); gravarAparencia(a); document.querySelector('.tema-opcao.tema-personalizado').style.cssText = estiloPersonalizado(a); };
  // Aparência, Sistema e Plug-ins agem na hora: não contam como alteração pendente ao fechar a janela.
  for (const tipo of ['input', 'change']) document.querySelectorAll('.cfg-aparencia, [data-painel="sistema"], [data-painel="backup"], [data-painel="plugins"]').forEach(el => el.addEventListener(tipo, e => e.stopPropagation()));
  // Compara o destaque e o fundo que estão de fato na tela (tema, Personalizado ou destaque escolhido).
  const avisar = () => {
    const css = getComputedStyle(document.documentElement), [acento, fundo] = ['--acento', '--content-bg'].map(v => css.getPropertyValue(v).trim());
    $('#acento-aviso').hidden = !corValida(acento) || !corValida(fundo) || contraste(acento, fundo) >= 3;
  };
  const gravarDestaque = destaque => { gravarAparencia({ ...lerAparencia(), destaque }); avisar(); };
  document.querySelectorAll('input[name="destaque"]').forEach(r => r.onchange = () => { if (r.value) $('#destaque-livre').value = r.value; gravarDestaque(r.value); });
  $('#destaque-livre').oninput = e => { document.querySelectorAll('input[name="destaque"]').forEach(r => r.checked = r.value.toLowerCase() === e.target.value.toLowerCase()); gravarDestaque(e.target.value); };
  avisar();
  document.querySelectorAll('[data-cor]').forEach(campo => { campo.oninput = () => { gravarCores(); avisar(); }; });
  // Tema e skin aplicam na hora; o Personalizado abre os controles de cor.
  document.querySelectorAll('input[name="tema"]').forEach(r => r.onchange = () => { gravarAparencia({ ...lerAparencia(), tema: r.value }); $('#cfg-personalizado').hidden = r.value !== 'personalizado'; $('#cfg-vidro').hidden = r.value !== 'liquid-glass'; avisar(); });
  $('#cfg-transparencia').oninput = e => {
    const a = Kiro.aparenciaValida({ ...lerAparencia(), transparencia: Number(e.target.value) });
    $('#cfg-transparencia-valor').value = `${a.transparencia}%`;
    gravarAparencia(a);
  };
  document.querySelectorAll('input[name="skin"]').forEach(r => r.onchange = () => gravarAparencia({ ...lerAparencia(), skin: r.value }));
  $('#cfg-primeiros-passos').onclick = () => { if (closeModal()) primeirosPassos(); };
  $('#cfg-captura-global')?.addEventListener('change', async e => {
    const ligado = e.target.checked;
    const ok = await window.cadernoDesktop.capturaGlobal(ligado).catch(() => false);
    if (!ok) { e.target.checked = false; gravarPreferencia('capturaGlobal', '0'); avisoAtalhoGlobal(true); return; }
    avisoAtalhoGlobal(false);
    gravarPreferencia('capturaGlobal', ligado ? '1' : '0');
  });
  $('#cor-padrao').onclick = () => {
    gravarAparencia({ ...APARENCIA_PADRAO });
    document.querySelector('[data-cor="sidebar"]').value = APARENCIA_PADRAO.sidebar;
    document.querySelector('[data-cor="content"]').value = APARENCIA_PADRAO.content;
    document.querySelectorAll('input[name="destaque"]').forEach(r => r.checked = r.value === APARENCIA_PADRAO.destaque);
    document.querySelectorAll('input[name="tema"], input[name="skin"]').forEach(r => r.checked = r.value === APARENCIA_PADRAO.tema || r.value === APARENCIA_PADRAO.skin);
    document.querySelector('.tema-opcao.tema-personalizado').style.cssText = estiloPersonalizado(APARENCIA_PADRAO);
    $('#cfg-personalizado').hidden = true;
    $('#cfg-vidro').hidden = true;
    $('#cfg-transparencia').value = APARENCIA_PADRAO.transparencia;
    $('#cfg-transparencia-valor').value = `${APARENCIA_PADRAO.transparencia}%`;
    avisar();
  };

  // Sistema
  $('#cfg-abrir-pasta')?.addEventListener('click', () => window.cadernoDesktop.openVault());
  $('#cfg-trocar-cofre')?.addEventListener('click', escolherOutroCofre);
  $('#cfg-copiar-caminho').onclick = async () => { const b = $('#cfg-copiar-caminho'); if (await copiarTexto(state.vaultPath || '')) { b.lastChild.textContent = ` ${t('Copiado')}`; setTimeout(() => { if (b.isConnected) b.lastChild.textContent = ` ${t('Copiar caminho')}`; }, 1500); } };
  $('#cfg-recarregar').onclick = () => reload(true);
  $('#cfg-exportar').onclick = exportarDados;
  $('#cfg-importar').onchange = e => { const arquivo = e.target.files[0]; e.target.value = ''; importarDados(arquivo); };
  $('#cfg-lixeira').onclick = () => { closeModal(true); showTrash(); };

  ligarAbaPlugins($('#painel-plugins'));
  ligarAbaBackup($('#painel-backup'));

  // Integrações: cada interruptor salva na hora, como nas outras abas.
  if (!conf) return;
  const estadoDasPermissoes = $('#ai-estado');
  document.querySelectorAll('[data-perm]').forEach(c => c.addEventListener('change', async e => {
    e.stopPropagation(); modalDirty = false;
    const marcado = id => document.querySelector(`[data-perm="${id}"]`).checked;
    try {
      await agentApi.save({
        enabled: marcado('enabled'),
        mcp: { enabled: marcado('mcp') },
        permissions: Object.fromEntries(CAIXAS.map(([id]) => [id, marcado(id)])),
        requireConfirmationForDestructive: marcado('confirm'),
      });
      estadoDasPermissoes.textContent = `· ${t('Salvo')}`;
    } catch (error) {
      c.checked = !c.checked;   // volta a chave: o que está na tela é o que está gravado
      estadoDasPermissoes.textContent = '';
      status(t('Não foi possível salvar: {erro}', { erro: mensagemDoErro(error) }), true);
    }
  }));
}
// Árvore: botão direito abre o menu da nota ou da pasta; arrastar uma nota para uma pasta a move.
document.addEventListener('contextmenu',e=>{
  if(!loaded||busy||failed)return;
  // Menu pedido com o botão direito ainda apertado (há navegadores e sistemas que o abrem no apertar):
  // segura e abre no soltar, para dar tempo de marcar passando por cima dos itens.
  if(marcandoComDireito&&(e.buttons&2)){e.preventDefault();marcandoComDireito.adiado=true;return;}
  const linha=e.target.closest('.tree-row');
  // Seleção feita segurando o botão direito, ou botão direito sobre um item de uma seleção: menu do lote.
  const doLote=marcandoComDireito?.moveu||(linha&&selecaoArvore.size>1&&selecaoArvore.has(linha.dataset.id));
  marcandoComDireito=null;
  if(doLote)return abrirMenuContexto(e,document.body,menuDaSelecao());
  if(selecaoArvore.size&&!(linha&&selecaoArvore.has(linha.dataset.id))){selecaoArvore.clear();marcarSelecaoArvore();}
  if(linha)return abrirMenuContexto(e,document.body,menuDaArvore(linha));
  // Espaço vazio da árvore: criar na raiz do cofre.
  if(e.target.closest('.cofre-lateral .tree'))return abrirMenuContexto(e,document.body,[
    {rotulo:t('Nova nota'),icone:icone('nota'),acao:()=>abrirNota(notaVazia())},
    {rotulo:t('Nova pasta'),icone:icone('pasta-nova'),acao:()=>folderModal({title:'',description:'',parentId:''})},
    {rotulo:t('Novo fluxo'),icone:icone('fluxo'),acao:()=>novoFluxo('')},
  ]);
  const habito=e.target.closest('[data-habito]');
  if(habito)return abrirMenuContexto(e,document.body,menuDoHabito(habito.dataset.habito));
  if(e.target.closest('.card.habitos, .habitos-lista'))abrirMenuContexto(e,document.body,menuDosHabitos());
});
// Seleção na árvore. Ctrl+clique alterna um item, Shift+clique marca do último clicado até este (só o
// que está visível, sem entrar em pasta fechada). Clique comum desfaz a seleção e abre o item.
// Árvore: um só ponto de parada do Tab; dentro dela, as setas andam, abrem e fecham, e Enter ou Espaço abrem.
function prepararArvore(){
  for(const arvore of document.querySelectorAll('.cofre-lateral .tree')){
    arvore.setAttribute('role','tree');
    arvore.querySelectorAll('.tree-children').forEach(g=>g.setAttribute('role','group'));
    arvore.querySelectorAll('.tree-node').forEach(n=>n.setAttribute('role','none'));
    const linhas=[...arvore.querySelectorAll('.tree-row')];
    for(const l of linhas){
      l.setAttribute('role','treeitem');l.tabIndex=-1;
      if(l.classList.contains('tree-folder'))l.setAttribute('aria-expanded',String(l.closest('.tree-node')?.classList.contains('open')));
      if(l.classList.contains('ativa'))l.setAttribute('aria-selected','true');else l.removeAttribute('aria-selected');
    }
    const visivel=l=>!l.closest('.tree-node:not(.open) > .tree-children');
    (linhas.find(l=>l.classList.contains('ativa')&&visivel(l))||linhas.find(visivel))?.setAttribute('tabindex','0');
  }
}
function moverNaArvore(atual,destino){if(!destino)return;atual.tabIndex=-1;destino.tabIndex=0;destino.focus();}
document.addEventListener('click',e=>{if(e.target.closest?.('.cofre-lateral .tree-row'))setTimeout(()=>{const f=document.activeElement;prepararArvore();if(f?.classList?.contains('tree-row'))f.tabIndex=0;});});
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.ctrlKey||e.altKey||e.metaKey)return;
  const confirma=e.key==='Enter'||e.key===' ';
  if(confirma&&e.target.classList?.contains('note-card')){e.preventDefault();e.target.click();return;}
  const linha=e.target.classList?.contains('tree-row')&&e.target.closest('.cofre-lateral .tree')?e.target:null;
  if(!linha)return;
  const arvore=linha.closest('.tree'), visiveis=[...arvore.querySelectorAll('.tree-row')].filter(l=>!l.closest('.tree-node:not(.open) > .tree-children'));
  const i=visiveis.indexOf(linha), pasta=linha.classList.contains('tree-folder'), aberta=pasta&&linha.closest('.tree-node')?.classList.contains('open');
  const mae=()=>linha.closest('.tree-children')?.parentElement?.querySelector(':scope > .tree-folder');
  const passos={ArrowDown:()=>moverNaArvore(linha,visiveis[i+1]),ArrowUp:()=>moverNaArvore(linha,visiveis[i-1]),Home:()=>moverNaArvore(linha,visiveis[0]),End:()=>moverNaArvore(linha,visiveis.at(-1)),
    ArrowRight:()=>{if(pasta&&!aberta)linha.click();else if(pasta)moverNaArvore(linha,visiveis[i+1]);},
    ArrowLeft:()=>{if(pasta&&aberta)linha.click();else moverNaArvore(linha,mae());},
    Enter:()=>linha.click(),' ':()=>linha.click()};
  if(passos[e.key]){e.preventDefault();passos[e.key]();}
});
const linhasVisiveisDaArvore=()=>[...document.querySelectorAll('.cofre-lateral .tree .tree-note, .cofre-lateral .tree .tree-fluxo')].filter(l=>!l.closest('.tree-node:not(.open) > .tree-children'));
document.addEventListener('click',e=>{
  const linha=e.target.closest?.('.cofre-lateral .tree-note, .cofre-lateral .tree-fluxo');
  if(!linha)return;
  const id=linha.dataset.id;
  if(!(e.ctrlKey||e.metaKey||e.shiftKey)){ancoraArvore=id;return;}
  e.preventDefault();e.stopImmediatePropagation();
  const ordem=linhasVisiveisDaArvore().map(l=>l.dataset.id),a=ordem.indexOf(ancoraArvore),b=ordem.indexOf(id);
  if(e.shiftKey&&a!==-1&&b!==-1){if(!(e.ctrlKey||e.metaKey))selecaoArvore.clear();for(const x of ordem.slice(Math.min(a,b),Math.max(a,b)+1))selecaoArvore.add(x);}
  else{if(selecaoArvore.has(id))selecaoArvore.delete(id);else selecaoArvore.add(id);ancoraArvore=id;}
  marcarSelecaoArvore();
},true);
// Segurar o botão direito sobre um item e passar por cima de outros marca todos; o menu do lote abre
// ao soltar. Um clique direito rápido abre o menu normal.
// O gesto pode começar em qualquer ponto da árvore (uma pasta, o espaço vazio): marca as notas e os
// fluxos por onde o ponteiro passar.
document.addEventListener('pointerdown',e=>{
  marcandoComDireito=null;
  if(e.button!==2||!e.target.closest?.('.cofre-lateral .tree'))return;
  const linha=e.target.closest('.tree-note, .tree-fluxo');
  marcandoComDireito={inicio:linha?.dataset.id||null,moveu:false};
});
// A seleção é a faixa contínua entre o primeiro item e o que está sob o ponteiro: voltar desmarca.
document.addEventListener('pointerover',e=>{
  if(!marcandoComDireito||!(e.buttons&2))return;
  const linha=e.target.closest?.('.cofre-lateral .tree-note, .cofre-lateral .tree-fluxo');
  if(!linha||(!marcandoComDireito.moveu&&linha.dataset.id===marcandoComDireito.inicio))return;
  if(!marcandoComDireito.moveu){marcandoComDireito.moveu=true;marcandoComDireito.ancora=marcandoComDireito.inicio||linha.dataset.id;}
  const ordem=linhasVisiveisDaArvore().map(l=>l.dataset.id),a=ordem.indexOf(marcandoComDireito.ancora),b=ordem.indexOf(linha.dataset.id);
  if(a===-1||b===-1)return;
  selecaoArvore=new Set(ordem.slice(Math.min(a,b),Math.max(a,b)+1));
  marcarSelecaoArvore();
});
// Contador que acompanha o cursor enquanto o botão direito está segurado.
const contadorDoGesto=Object.assign(document.createElement('div'),{className:'selecao-contador',hidden:true});
contadorDoGesto.setAttribute('aria-hidden','true');
document.body.appendChild(contadorDoGesto);
document.addEventListener('pointermove',e=>{
  const ativo=marcandoComDireito?.moveu&&(e.buttons&2);
  contadorDoGesto.hidden=!ativo;
  if(!ativo)return;
  contadorDoGesto.textContent=selecaoArvore.size===1?t('1 item'):t('{n} itens',{n:selecaoArvore.size});
  contadorDoGesto.style.transform=`translate(${e.clientX+14}px, ${e.clientY+14}px)`;
});
document.addEventListener('pointerup',()=>{contadorDoGesto.hidden=true;},true);
// Sair da seleção: clique esquerdo em qualquer lugar (menos na barra e nos menus dela) ou Esc.
// Arrastar a seleção para uma pasta não gera clique, então continua funcionando.
document.addEventListener('click',e=>{
  if(!selecaoArvore.size||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey)return;
  if(e.target.closest?.('.selecao-barra, .ctx-menu, .modal-backdrop'))return;
  limparSelecaoArvore();
},true);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&selecaoArvore.size&&!menuAberto&&!document.querySelector('.modal-backdrop'))limparSelecaoArvore();
});
document.addEventListener('click',e=>{
  const botao=e.target.closest?.('[data-selecao]');
  if(!botao)return;
  const acao=botao.dataset.selecao;
  if(acao==='limpar')return limparSelecaoArvore();
  if(acao==='excluir')return excluirSelecao();
  const r=botao.getBoundingClientRect();
  abrirMenuContexto({preventDefault(){},clientX:r.left,clientY:r.top-8},document.body,menuDaSelecao()[0].filhos,{compacto:true,origem:botao});
});
document.addEventListener('pointerup',e=>{
  if(e.button!==2||!marcandoComDireito?.adiado)return;
  const alvo=document.elementFromPoint(e.clientX,e.clientY)||document.body;
  alvo.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY,button:2,buttons:0}));
});
// Soltar sobre uma nota vale como soltar na pasta dela; fora das pastas, é a raiz.
const alvoDaSoltura=e=>{const no=e.target.closest?.('.tree-node');return no?no.querySelector(':scope > .tree-folder'):e.target.closest?.('.tree');};
const limparSoltura=(exceto)=>document.querySelectorAll('.soltar-aqui').forEach(x=>x!==exceto&&x.classList.remove('soltar-aqui'));
// `copyMove`, não `move`: a nota da árvore tem dois destinos com efeitos diferentes — uma pasta
// (mover, `move`) e a área das notas (abrir numa coluna, `copy`). Com `effectAllowed='move'` o
// navegador força a `none` o `dropEffect='copy'` da área, e o arraste vira cursor de bloqueio:
// o `dragover` roda e destaca o alvo, mas o `drop` nunca chega.
// Fluxo da árvore também se arrasta para uma pasta (tipo próprio: a área das notas e o fluxo aberto só aceitam nota).
document.addEventListener('dragstart',e=>{const nota=e.target.closest?.('.tree-note');if(!nota)return;e.dataTransfer.setData('text/kiro-nota',nota.dataset.id);e.dataTransfer.effectAllowed='copyMove';});
// Arrastar um item que faz parte de uma seleção leva a seleção inteira; fora dela, a seleção some.
document.addEventListener('dragstart',e=>{const linha=e.target.closest?.('.tree-note, .tree-fluxo');if(!linha)return;if(selecaoArvore.has(linha.dataset.id)&&selecaoArvore.size>1)e.dataTransfer.setData('text/kiro-selecao','1');else if(selecaoArvore.size){selecaoArvore.clear();marcarSelecaoArvore();}});
document.addEventListener('dragstart',e=>{const fluxo=e.target.closest?.('.tree-fluxo');if(!fluxo)return;e.dataTransfer.setData('text/kiro-fluxo',fluxo.dataset.id);e.dataTransfer.effectAllowed='move';});
document.addEventListener('dragover',e=>{
  if(!e.dataTransfer.types.includes('text/kiro-nota')&&!e.dataTransfer.types.includes('text/kiro-fluxo'))return;
  const alvo=alvoDaSoltura(e);limparSoltura(alvo);if(!alvo)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';alvo.classList.add('soltar-aqui');
});
document.addEventListener('dragend',()=>limparSoltura());
document.addEventListener('drop',e=>{
  const id=e.dataTransfer.getData('text/kiro-nota'),idFluxo=e.dataTransfer.getData('text/kiro-fluxo');const alvo=(id||idFluxo)&&alvoDaSoltura(e);
  limparSoltura();
  if(!alvo)return;
  const destino=alvo.classList.contains('tree-folder')?alvo.dataset.id:'';
  e.preventDefault();
  if(e.dataTransfer.getData('text/kiro-selecao'))moverSelecao(destino);else if(id)moverNota(id,destino);else moverFluxo(idFluxo,destino);
});
// Arrastar cartões no modo Personalizar: solta antes do cartão sob o ponteiro (metade de cima)
// ou depois dele; numa coluna vazia, no fim dela.
function alvoDoCartao(e) {
  const coluna = e.target.closest?.('.hoje-faixas.personalizando [data-hoje-coluna]');
  const inteiro = e.target.closest?.('.hoje-faixas.personalizando .hoje-faixa-inteira .hoje-cartao');
  if (!coluna && !inteiro) return null;
  const depoisDe = (el) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
  if (inteiro) {
    const ordem = layoutDaHoje().cartoes.map(c => c.id), i = ordem.indexOf(inteiro.dataset.hojeId);
    return { el: inteiro, antes: depoisDe(inteiro) ? ordem[i + 1] ?? null : inteiro.dataset.hojeId };
  }
  const acima = [...coluna.querySelectorAll(':scope > .hoje-cartao')].find(c => !depoisDe(c));
  if (acima) return { el: coluna, coluna: Number(coluna.dataset.hojeColuna), antes: acima.dataset.hojeId };
  const band = coluna.closest('.hoje-colunas');
  return { el: coluna, coluna: Number(coluna.dataset.hojeColuna), antes: band.dataset.hojeFim || null, noFim: !band.dataset.hojeFim };
}
const limparAlvosDaHoje = () => document.querySelectorAll('.hoje-alvo').forEach(x => x.classList.remove('hoje-alvo'));
document.addEventListener('dragstart', e => {
  const c = e.target.closest?.('.hoje-cartao');
  if (!c) return;
  e.dataTransfer.setData('text/kiro-cartao', c.dataset.hojeId);
  e.dataTransfer.effectAllowed = 'move';
  c.classList.add('arrastando');
});
document.addEventListener('dragover', e => {
  if (!e.dataTransfer.types.includes('text/kiro-cartao')) return;
  const alvo = alvoDoCartao(e);
  limparAlvosDaHoje();
  if (!alvo) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  alvo.el.classList.add('hoje-alvo');
});
document.addEventListener('drop', e => {
  if (!e.dataTransfer.types.includes('text/kiro-cartao')) return;
  const alvo = alvoDoCartao(e), id = e.dataTransfer.getData('text/kiro-cartao');
  limparAlvosDaHoje();
  if (!alvo || !id) return;
  e.preventDefault();
  mudarHoje(l => KiroHoje.mover(l, id, alvo.coluna === undefined ? { antes: alvo.antes } : { coluna: alvo.coluna, antes: alvo.antes, noFim: alvo.noFim }));
});
document.addEventListener('dragend', () => { limparAlvosDaHoje(); document.querySelectorAll('.hoje-cartao.arrastando').forEach(c => c.classList.remove('arrastando')); });
document.addEventListener('click',e=>{
  const extra=e.target.closest('[data-extra]');if(extra){e.preventDefault();extraAction(extra.dataset.extra,extra.dataset.id);return;}
  const el=e.target.closest('[data-action]');if(el){e.preventDefault();action(el.dataset.action,el.dataset.id,e);return;}
  const go=e.target.closest('[data-go]');if(go){irPara(go.dataset.go);}
});
// Botão do meio num link de nota (árvore, cartão, menção…) abre em aba nova, como Ctrl+clique.
document.addEventListener('auxclick',e=>{
  if(e.button!==1||busy||failed||!loaded)return;
  const el=e.target.closest('[data-action="edit-note"]');
  if(el){e.preventDefault();abrirPorId(el.dataset.id,{novaAba:true});}
});
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(loaded)irPara(b.dataset.view);});
$('#new-note').onclick=()=>{if(loaded&&!busy&&!failed)abrirNota(notaVazia());};
$('#daily-note').onclick=()=>extraAction('daily');
$('#go-note').onclick=irParaNota;
$('#quick-actions').onclick=abrirAcoesRapidas;
$('#settings').onclick=()=>showSettings();
$('#cofre-seletor').onclick=()=>{if(!loaded||busy)return;if(window.cadernoDesktop)escolherOutroCofre();else showSettings('sistema');};
$('#lixeira-lateral').onclick=()=>{if(loaded&&!busy&&!failed)showTrash();};
// ---- Ações de sistema: ficam na aba Sistema das Configurações ----
async function escolherOutroCofre(){
  if(busy||!window.cadernoDesktop)return;closeModal(true);
  if(failed){status(t('Exporte suas alterações e recarregue antes de trocar de cofre.'),true);return;}
  // Uma mudança de fluxo ainda não salva não pode ser descartada pela troca de cofre.
  if(!await gravarFluxoPendente())return;
  setBusy(true);
  try{const saved=await window.cadernoDesktop.chooseVault();if(saved){Kiro.validateState(saved);state=doCofre(saved);fluxoPendente=false;clearTimeout(timerDoFluxo);loaded=true;failed=false;expanded=null;editing=null;
    // Plug-ins são do cofre: desliga os do anterior já (antes de ler o layout, para não entrarem no
    // hoje.json do novo) e carrega os que este cofre permite.
    carregarPlugins();await carregarHoje();personalizandoHoje=false;render();
    // Dicionário pessoal é do cofre: recarrega o do novo (também com o motor ainda carregando).
    if(ortografiaIniciada)await aplicarDicionarioDoCofre();}}
  catch(error){status(mensagemDoErro(error),true);}finally{setBusy(false);}
}
function exportarDados(){
  const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=url;a.download=`kiro-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Confirmação dentro do app, como na exclusão de hábito: o confirm() nativo pode não aparecer no Electron.
async function importarDados(arquivo){
  if(!arquivo||busy||failed||!loaded)return;
  let data;
  try{data=Kiro.validateState(JSON.parse(await arquivo.text()));}
  catch(error){status(t('Importação cancelada: {erro}',{erro:mensagemDoErro(error)}),true);return;}
  const contar=(n,um,varios)=>n===1?t(um):t(varios,{n});
  const partes=[contar(data.notes.length,frase('1 nota'),frase('{n} notas')),contar((data.folders||[]).length,frase('1 pasta'),frase('{n} pastas')),contar((data.habits||data.routine||[]).length,frase('1 hábito'),frase('{n} hábitos'))];
  modal(t('Importar backup'),`<p class="confirmar-texto">${t('Importar {resumo} de {arquivo} e substituir os dados atuais? As notas e os fluxos que saírem vão para a lixeira e uma cópia do cofre atual é preservada.',{resumo:`<strong>${partes.join(', ')}</strong>`,arquivo:`<strong>${escapeHtml(arquivo.name)}</strong>`})}</p><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Cancelar')}</button><button type="button" class="primary" id="confirmar-importacao">${t('Importar e substituir')}</button></div>`);
  $('#cancel').onclick=()=>closeModal(true);
  $('#confirmar-importacao').onclick=async()=>{
    data.notes=data.notes.map(n=>{const copy={...n};delete copy.file;return copy;});
    state={...data,revision:state.revision,vaultPath:state.vaultPath};
    if(await save())closeModal(true);
  };
}
// Ctrl+O: achar uma nota pelo título sem tirar a mão do teclado.
// Com { escolher: true } não abre a nota: devolve { arquivo, titulo } (ou null se fechar), para
// o Fluxo criar um cartão dela. Sem opções, continua abrindo a nota como sempre.
function irParaNota({ escolher = false } = {}){
  if(!loaded||failed||busy||$('#modal-root').firstChild)return Promise.resolve(null);
  return new Promise(resolve=>{
  modal(escolher?t('Adicionar nota ao fluxo'):t('Ir para nota'),`<div class="form"><input class="search ir-busca" id="ir-busca" placeholder="${t('Digite o título da nota…')}" autocomplete="off" aria-label="${t('Buscar nota')}" /><div class="ir-lista" id="ir-lista" role="listbox"></div></div>`);
  const campo=$('#ir-busca'), lista=$('#ir-lista'); let achadas=[], marcada=0;
  const desenhar=()=>{
    const q=Kiro.normalize(campo.value.trim());
    const pontos=n=>{const t=Kiro.normalize(n.title||'');return !q?1:t.startsWith(q)?3:t.includes(q)?2:Kiro.normalize(n.body).includes(q)?1:0;};
    achadas=state.notes.map(n=>[pontos(n),n]).filter(([p])=>p).sort((a,b)=>b[0]-a[0]||b[1].updatedAt-a[1].updatedAt).slice(0,12).map(([,n])=>n);
    marcada=Math.min(marcada,Math.max(achadas.length-1,0));
    lista.innerHTML=achadas.map((n,i)=>{const p=state.folders.find(f=>f.id===n.folderId);return `<button type="button" class="ir-item${i===marcada?' marcada':''}" data-i="${i}" role="option" aria-selected="${i===marcada}"><span>${escapeHtml(n.title||t('Sem título'))}</span><small>${p?escapeHtml(p.path||p.title):''}</small></button>`;}).join('')||`<div class="empty">${t('Nenhuma nota encontrada.')}</div>`;
  };
  let respondeu=false;
  const responder=valor=>{if(!respondeu){respondeu=true;resolve(valor);}};
  const abrir=n=>{if(!n||!closeModal(true))return;if(escolher)responder(n.file?{arquivo:n.file,titulo:n.title||'Sem título'}:null);else{responder(null);abrirNota(n);}};
  // Fechar sem escolher (Esc, ×, fora) também responde: o modal some do #modal-root.
  new MutationObserver((_,obs)=>{if(!$('#modal-root').firstChild){obs.disconnect();responder(null);}}).observe($('#modal-root'),{childList:true});
  // Digitar a busca não é alteração de formulário: não pedir confirmação ao fechar.
  campo.addEventListener('input',e=>{e.stopPropagation();marcada=0;desenhar();});
  campo.addEventListener('keydown',e=>{
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&achadas.length){e.preventDefault();marcada=(marcada+(e.key==='ArrowDown'?1:achadas.length-1))%achadas.length;desenhar();lista.querySelector('.marcada')?.scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'){e.preventDefault();abrir(achadas[marcada]);}
  });
  lista.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)abrir(achadas[+b.dataset.i]);});
  desenhar();campo.focus();
  });
}
// ---- Ações rápidas ----
let aoFecharAcoesRapidas = null;
function primeirosPassos() {
  modal(t('Primeiros passos'), `<ol><li>${t('Crie uma nota, escreva e salve no cofre.')}</li><li>${t('Organize suas notas em pastas e conecte ideias com links.')}</li><li>${t('Crie tarefas e acompanhe o que precisa fazer na Hoje.')}</li></ol><h3>${t('Glossário')}</h3><p>${t('Cofre: a pasta onde suas notas ficam guardadas.')}</p><p>${t('Hoje: cartões para retomar notas, tarefas e hábitos.')}</p><p>${t('Pastas: organize notas; links conectam ideias.')}</p><p>${t('Fluxo: um quadro para organizar ideias visualmente.')}</p><p>${t('Skin: a aparência visual do aplicativo.')}</p><p>${t('Ações rápidas: encontre comandos e crie conteúdo pelo teclado.')}</p><div class="form-actions"><button type="button" class="secondary" id="cancel">${t('Fechar')}</button></div>`);
  $('#cancel').onclick = () => closeModal(true);
}
function catalogoDeAcoes() {
  const nativas = [
    { id: 'novaNota', titulo: t('Nova nota'), categoria: t('Notas'), executar: () => abrirNota(notaVazia()) },
    { id: 'novaTarefa', titulo: t('Nova tarefa'), categoria: t('Tarefas'), executar: () => taskModal() },
    { id: 'novoFluxo', titulo: t('Novo fluxo'), categoria: t('Fluxos'), executar: () => novoFluxo() },
    { id: 'captura', titulo: t('Captura rápida'), categoria: t('Notas'), executar: () => capturaRapida() },
    { id: 'diaria', titulo: t('Nota diária'), categoria: t('Notas'), executar: () => extraAction('daily') },
    { id: 'irPara', titulo: t('Ir para nota'), categoria: t('Notas'), executar: () => irParaNota() },
    { id: 'primeirosPassos', titulo: t('Primeiros passos'), categoria: t('Ajuda'), executar: primeirosPassos },
    { id: 'configuracoes', titulo: t('Configurações'), categoria: t('Configurações'), executar: () => showSettings() },
    { id: 'criarModelo', titulo: t('Criar modelo pessoal'), categoria: t('Notas'), executar: () => criarModeloPessoal() },
    { id: 'notaPorModelo', titulo: t('Criar nota por modelo'), categoria: t('Notas'), executar: () => criarNotaPorModelo() },
  ];
  for (const [id, estado] of pluginsAtivos) for (const comando of estado.comandos || []) nativas.push({
    id: `plugin:${id}:${comando.id}`, titulo: comando.label, categoria: estado.manifesto?.name || id,
    executar: () => {
      if (pluginsAtivos.get(id) === estado && estado.comandos?.some(c => c.id === comando.id)) rodarComandoDoPlugin(id, comando.id);
    },
  });
  return nativas;
}
function abrirAcoesRapidas() {
  if (!loaded || failed || busy || gravandoAtalho || aguardandoCofre || $('#modal-root').firstChild) return;
  const focoAnterior = document.activeElement;
  modal(t('Ações rápidas'), `<div class="form"><label for="acoes-busca">${t('O que você quer fazer?')}</label><input class="search ir-busca" id="acoes-busca" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="acoes-lista" autocomplete="off" /><div class="ir-lista" id="acoes-lista" role="listbox" aria-label="${t('Ações rápidas')}"></div></div>`);
  const dialogo = $('.modal'), campo = $('#acoes-busca'), lista = $('#acoes-lista');
  dialogo.setAttribute('aria-label', t('Ações rápidas'));
  let achadas = [], marcada = 0, executou = false, fechada = false;
  aoFecharAcoesRapidas = () => { fechada = true; if (!executou && focoAnterior?.isConnected) focoAnterior.focus(); };
  const desenhar = () => {
    achadas = Kiro.filtrarAcoes(catalogoDeAcoes(), campo.value);
    marcada = Math.min(marcada, Math.max(achadas.length - 1, 0));
    lista.innerHTML = achadas.map((acao, i) => `<button type="button" tabindex="-1" class="ir-item${i === marcada ? ' marcada' : ''}" id="acao-rapida-${i}" data-i="${i}" role="option" aria-selected="${i === marcada}"><span>${escapeHtml(acao.titulo)}</span><small>${escapeHtml(acao.categoria)}</small></button>`).join('') || `<div class="empty">${t('Nenhuma ação encontrada.')}</div>`;
    if (achadas.length) campo.setAttribute('aria-activedescendant', `acao-rapida-${marcada}`);
    else campo.removeAttribute('aria-activedescendant');
  };
  const executar = acao => {
    if (!acao || executou || fechada || busy || failed || !loaded) return;
    executou = true;
    if (!closeModal(true)) { executou = false; return; }
    acao.executar();
  };
  campo.addEventListener('input', e => { e.stopPropagation(); marcada = 0; desenhar(); });
  campo.addEventListener('change', e => e.stopPropagation());
  campo.addEventListener('keydown', e => {
    if (e.isComposing) { e.stopPropagation(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && achadas.length) {
      e.preventDefault(); marcada = (marcada + (e.key === 'ArrowDown' ? 1 : achadas.length - 1)) % achadas.length;
      desenhar(); lista.querySelector('.marcada')?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') { e.preventDefault(); executar(achadas[marcada]); }
  });
  dialogo.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    (document.activeElement === campo ? $('#close-modal') : campo).focus();
  });
  lista.addEventListener('click', e => { const botao = e.target.closest('[data-i]'); if (botao) executar(achadas[+botao.dataset.i]); });
  desenhar(); campo.focus();
}
// ---- Fim das ações rápidas ----
const ACOES_DOS_ATALHOS={
  acoesRapidas:()=>abrirAcoesRapidas(),
  captura:()=>capturaRapida(),
  irPara:()=>irParaNota(),
  novaNota:()=>{if(loaded&&!failed&&!busy&&!$('#modal-root').firstChild)abrirNota(notaVazia());},
  salvar:()=>salvarNota(),
  lateral:()=>alternarLateralCompacta(),
  painelDireito:()=>alternarPainelDireito(),
  fecharAba:()=>{if(currentView==='studies'&&editing&&!$('#modal-root').firstChild)fecharAba(abas.ativo,idDaAba(editing));},
  novaAba:()=>{if(loaded&&!failed&&!busy&&!$('#modal-root').firstChild)abrirNota(notaVazia(),{novaAba:true});},
  imprimir:()=>{if(currentView==='studies'&&editing?.id&&!$('#modal-root').firstChild)imprimirNota();},
  configuracoes:()=>{if(!$('#modal-root').firstChild)$('#settings')?.click();},
};
let sugestaoNoEsc=false;
document.addEventListener('keydown',e=>{if(e.key==='Escape')sugestaoNoEsc=Boolean(sugestao);},true);
const TELAS_DOS_ATALHOS={'Ctrl+1':'today','Ctrl+2':'notes','Ctrl+3':'tasks','Ctrl+4':'studies','Ctrl+5':'graph'};
const TAMANHOS_DA_INTERFACE=[100,115,130,150];
function mudarTamanhoDaInterface(passo){
  const atual=TAMANHOS_DA_INTERFACE.indexOf(aplicarTamanhoDaInterface());
  const novo=passo===0?100:TAMANHOS_DA_INTERFACE[Math.max(0,Math.min(TAMANHOS_DA_INTERFACE.length-1,atual+passo))];
  gravarPreferencia('tamanhoInterface',String(novo));aplicarTamanhoDaInterface(novo);
  status(t('Tamanho da interface: {n}%',{n:novo}));
}
// O editor também usa Ctrl+K e Ctrl+Shift+K; interceptar a combinação configurada antes dele.
document.addEventListener('keydown',e=>{
  if(e.isComposing||gravandoAtalho||aguardandoCofre||Kiro.combinacaoDoEvento(e)!==atalhos.acoesRapidas)return;
  e.preventDefault();e.stopPropagation();ACOES_DOS_ATALHOS.acoesRapidas();
},true);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') { if (document.querySelector(':popover-open')) return; /* Esc fecha primeiro o popover (ex.: Opções da Hoje); um segundo Esc fecha o modal */ const haviaModal=Boolean($('#modal-root').firstChild); closeModal(); if(!haviaModal&&modoFoco&&!sugestaoNoEsc&&!e.target.closest?.('.barra-busca-nota'))alternarModoFoco(); }
  if(gravandoAtalho||aguardandoCofre)return;
  const combinacao=Kiro.combinacaoDoEvento(e);
  if ((combinacao === 'Ctrl+F' || combinacao === 'Ctrl+H') && currentView === 'studies' && editing && !$('#modal-root').firstChild) {
    e.preventDefault();
    abrirBuscaNaNota(combinacao === 'Ctrl+H');
    return;
  }
  const acao=Object.keys(atalhos).find(id=>!id.startsWith('fluxo')&&atalhos[id]===combinacao); // os do Fluxo quem trata é a tela dele
  if(!acao&&TELAS_DOS_ATALHOS[combinacao]&&!$('#modal-root').firstChild){e.preventDefault();irPara(TELAS_DOS_ATALHOS[combinacao]);return;}
  if(!acao&&e.ctrlKey&&!e.altKey&&['=','+','-','0'].includes(e.key)){e.preventDefault();mudarTamanhoDaInterface(e.key==='0'?0:e.key==='-'?-1:1);return;}
  if(!acao&&(combinacao==='Ctrl+B'||combinacao==='Ctrl+I')&&editorDaNota?.editor.temFoco()){e.preventDefault();envolver(editorDaNota.editor.area(),combinacao==='Ctrl+B'?'**':'*');return;}
  if(acao==='fecharAba'&&e.target.closest?.('.abas-barra'))return; // a própria barra de abas já fechou a aba em foco
  if(acao==='acoesRapidas')return;
  if(acao==='salvar'&&!editing)return;
  if(acao){e.preventDefault();ACOES_DOS_ATALHOS[acao]();}
});
window.addEventListener('beforeunload',e=>{if(busy||failed||modalDirty||editorDirty||fluxoPendente||KiroFluxoTela.ocupado()){e.preventDefault();e.returnValue='';}});
window.addEventListener('blur',autosalvarNota);
window.cadernoDesktop?.aoPedirFechar?.(async()=>{
  let ok=false;
  try{
    for(let i=0;i<100&&busy;i++)await new Promise(r=>setTimeout(r,50));
    if(autosaveEmCurso)await autosaveEmCurso;
    ok=!failed&&!modalDirty&&!KiroFluxoTela.ocupado()&&await salvarAntesDeTrocar()&&await gravarFluxoPendente();
  }catch{/* não gravou: quem decide é a pessoa */}
  window.cadernoDesktop.responderFechar(ok);
});
window.addEventListener('focus',()=>reload());
// Liquid Glass: o brilho das superfícies segue o mouse. As luzes ficam numa camada própria, fora do conteúdo: dentro das
// superfícies, elas mudariam o :last-child e cada movimento recalcularia o que há dentro. No máximo 60 vezes por segundo, só perto do mouse.
const SUPERFICIES_COM_LUZ='.sidebar,.cofre-lateral,.painel-direito,.card,.note-card,.capture', ALCANCE_DA_LUZ=240;
const SEM_ANIMACAO=matchMedia('(prefers-reduced-motion: reduce)');
const luzes=new Map();
let camadaDasLuzes=null, luzEm=null, luzAgendada=false, ultimaLuz=0;
function apagarLuz(superficie){luzes.get(superficie)?.remove();luzes.delete(superficie);}
const apagarLuzes=()=>{if(luzes.size)[...luzes.keys()].forEach(apagarLuz);};
function moverLuz(agora){
  luzAgendada=false;ultimaLuz=agora;
  if(!camadaDasLuzes?.isConnected){camadaDasLuzes=document.createElement('div');camadaDasLuzes.id='luzes-vidro';camadaDasLuzes.setAttribute('aria-hidden','true');document.body.append(camadaDasLuzes);}
  for(const superficie of luzes.keys())if(!superficie.isConnected)apagarLuz(superficie);
  const {x,y}=luzEm;
  for(const el of document.querySelectorAll(SUPERFICIES_COM_LUZ)){
    const r=el.getBoundingClientRect();
    if(x<=r.left-ALCANCE_DA_LUZ||x>=r.right+ALCANCE_DA_LUZ||y<=r.top-ALCANCE_DA_LUZ||y>=r.bottom+ALCANCE_DA_LUZ||!r.width){apagarLuz(el);continue;}
    let luz=luzes.get(el);
    if(!luz){
      luz=document.createElement('span');luz.className='luz-vidro';luz.style.borderRadius=getComputedStyle(el).borderRadius;
      luz.style.cssText+=`;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      camadaDasLuzes.append(luz);luzes.set(el,luz);
    }
    luz.style.setProperty('--luz-x',`${x-r.left}px`);luz.style.setProperty('--luz-y',`${y-r.top}px`);
  }
}
document.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'||SEM_ANIMACAO.matches||!document.documentElement.classList.contains('tema-liquid-glass'))return;
  luzEm={x:e.clientX,y:e.clientY};
  if(!luzAgendada&&e.timeStamp-ultimaLuz>=16){luzAgendada=true;requestAnimationFrame(moverLuz);}
},{passive:true});
document.documentElement.addEventListener('pointerleave',apagarLuzes);
// A camada não acompanha a rolagem: a luz some e volta no próximo movimento do mouse, já no lugar certo.
document.addEventListener('scroll',apagarLuzes,{capture:true,passive:true});
// ---- Lembretes: aviso-resumo das tarefas do dia e dos hábitos de hoje, uma vez por dia cada ----
const lembretesLigados = () => lerPreferencia('lembretes') === '1';
const horaDoLembrete = k => lerPreferencia(`lembreteHora.${k}`) || (k === 'tarefas' ? '09:00' : '20:00');
function verificarLembretes() {
  if (!lembretesLigados() || !loaded || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const ultimo = { tarefas: lerPreferencia('lembreteUltimo.tarefas'), habitos: lerPreferencia('lembreteUltimo.habitos') };
  const avisos = Kiro.avisosDeHoje({ tarefas: state.tasks, habitos: state.habits, habitLog: state.habitLog, horas: { tarefas: horaDoLembrete('tarefas'), habitos: horaDoLembrete('habitos') }, ultimo });
  const texto = { tarefas: n => t('{n} tarefa(s) para hoje ou atrasada(s)', { n }), habitos: n => t('{n} hábito(s) de hoje ainda não feito(s)', { n }) };
  for (const k of ['tarefas', 'habitos']) {
    if (!avisos[k]) continue;
    try {
      const aviso = new Notification('Kiro', { body: texto[k](avisos[k]) });
      gravarPreferencia(`lembreteUltimo.${k}`, today());
      aviso.onclick = () => { window.focus(); aviso.close(); irPara('today'); };
    } catch { /* ambiente sem notificações */ }
  }
}
setInterval(verificarLembretes, 60000); setTimeout(verificarLembretes, 3000);
setInterval(()=>{if(document.hidden)return;if(lastDay!==today()){lastDay=today();if(loaded&&!busy)render();}reload();if(loaded)for(const id of pluginsAtivos.keys())entregarDia(id);},5000);
desenharIconesFixos();
if (window.cadernoDesktop?.janelaPropria) document.documentElement.classList.add('janela-propria');
aplicarAparencia();
aplicarTamanhoDaInterface();
aplicarCorretor();
coresDaJanela();
aplicarPapelDeParede();
new MutationObserver(sincronizarVideoDoPapel).observe(document.querySelector('.app-shell'), { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', sincronizarVideoDoPapel);
aplicarLateralCompacta();
aplicarLarguraArvore(larguraArvore);
document.querySelector('#alternar-lateral').onclick = alternarLateralCompacta;
// Campos de texto sem menu próprio (títulos, buscas, cartões): no app, só as sugestões do corretor.
document.addEventListener('contextmenu', e => { if (!e.defaultPrevented && (!e.shiftKey || window.cadernoDesktop) && !menuDoCorretor && podeCorrigir(e)) esperarCorretor(e, e.target, []); });
iniciar();

// ---- Início ----
// No aplicativo, a primeira abertura (sem cofre escolhido) mostra as boas-vindas antes
// de ler qualquer coisa; nos outros casos o cofre abre direto, como sempre.
async function iniciar() {
  await prepararIdioma();
  window.cadernoDesktop?.aoCapturaGlobal(() => capturaRapida());
  if (window.cadernoDesktop && lerPreferencia('capturaGlobal') === '1' && !await window.cadernoDesktop.capturaGlobal(true).catch(() => false)) avisoAtalhoGlobal(true);
  const inicio = window.cadernoDesktop ? await window.cadernoDesktop.firstRun().catch(() => null) : null;
  if (inicio?.primeiraVez) { aguardandoCofre = true; return mostrarBoasVindas(inicio.padrao); }
  comecar();
}
function comecar() {
  reload();
  // Plug-ins entram em paralelo com o cofre: só precisam da versão do Kiro, que é
  // o que o manifesto compara em minKiro.
  (async () => {
    try { VERSAO = await pluginApi.versao() || VERSAO; } catch { /* sem versão, o minKiro não é conferido */ }
    await carregarPlugins();
  })();
}
function mostrarBoasVindas(padrao) {
  fecharAbertura();
  const opcao = (modo, nomeIcone, titulo, dica = '') => `<button type="button" class="bv-opcao" data-modo="${modo}"${dica ? ` title="${dica}"` : ''}><span class="bv-icone">${icone(nomeIcone)}</span><span class="bv-titulo">${titulo}</span>${icone('direita', 'bv-seta')}</button>`;
  const tela = document.createElement('div');
  tela.id = 'boas-vindas';
  tela.setAttribute('role', 'dialog');
  tela.setAttribute('aria-modal', 'true');
  tela.setAttribute('aria-labelledby', 'bv-titulo');
  tela.innerHTML = `<div class="bv-caixa">
    <img class="bv-logo" src="kiro-logo.png" alt="" />
    <h1 id="bv-titulo">${t('Boas-vindas ao Kiro')}</h1>
    <p class="bv-sub">${t('Suas notas ficam numa pasta do seu computador, em arquivos Markdown que qualquer editor abre. Escolha onde.')}</p>
    <div class="bv-opcoes">
      ${opcao('criar', 'mais', t('Criar um cofre novo'))}
      ${opcao('abrir', 'pasta-aberta', t('Abrir uma pasta existente'))}
      ${opcao('padrao', 'pastas', t('Usar a pasta padrão'), escapeHtml(padrao))}
    </div>
    <p class="bv-erro" role="alert"></p>
    <p class="bv-rodape">${t('Dá para trocar depois em Configurações → Sistema.')}</p>
  </div>`;
  document.body.append(tela);
  $('.app-shell').inert = true;
  const botoes = [...tela.querySelectorAll('.bv-opcao')], erro = tela.querySelector('.bv-erro');
  for (const botao of botoes) botao.onclick = async () => {
    botoes.forEach(b => { b.disabled = true; });
    erro.textContent = '';
    try {
      const pronto = await window.cadernoDesktop.setupVault(botao.dataset.modo);
      if (!pronto) { botoes.forEach(b => { b.disabled = false; }); return botao.focus(); }   // janela de pasta cancelada
      tela.remove();
      $('.app-shell').inert = false;
      aguardandoCofre = false;
      comecar();
    } catch (e) {
      erro.textContent = t('Não foi possível usar essa pasta: {erro}', { erro: mensagemDoErro(e) });
      botoes.forEach(b => { b.disabled = false; });
      botao.focus();
    }
  };
  botoes[0].focus();
}
