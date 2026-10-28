'use strict';
kiro.ready.then(async api => {
  const M = globalThis.KiroFocus;
  const $ = id => document.getElementById(id);
  let state, settings, tasks = [], busy = false, failed = false, lookup = () => null, lookupFailed = false;
  const id = () => globalThis.crypto.randomUUID();
  const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };

  function render() {
    if (!state) return;
    const focus = state.phase === 'focus', running = state.status === 'running', ready = state.status === 'ready';
    const left = M.remaining(state, Date.now());
    const seconds = Math.ceil(left / 1000);
    $('time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('time').setAttribute('aria-label', `${Math.floor(seconds / 60)} minutos e ${seconds % 60} segundos restantes`);
    $('progress').style.strokeDashoffset = String(100 * (1 - Math.min(1, left / state.durationMs)));
    $('phase').textContent = focus ? 'Foco' : 'Pausa';
    $('status').textContent = running ? 'Em andamento' : ready ? 'Pronto para começar' : 'Em espera';
    $('dial-label').textContent = ready ? 'SEU PRÓXIMO CICLO' : running ? 'UM PASSO DE CADA VEZ' : 'RESPIRE. RETOME QUANDO QUISER.';
    $('cycle-caption').textContent = focus ? 'Uma coisa de cada vez.' : 'Dê um descanso à sua atenção.';
    $('toggle').textContent = running ? 'Pausar' : ready ? `Iniciar ${focus ? 'foco' : 'pausa'}` : 'Retomar';
    $('toggle').disabled = busy || failed;
    $('cancel').disabled = busy || failed || (focus && ready);
    $('task').disabled = busy || failed || !focus || !ready;
    if (!ready && state.task) {
      if (![...$('task').options].some(option => option.value === state.task.id)) {
        const option = document.createElement('option'); option.value = state.task.id; option.textContent = state.task.title; $('task').append(option);
      }
      $('task').value = state.task.id;
    }
    const summary = M.today(state.history);
    $('minutes').textContent = summary.minutes;
    $('count').textContent = summary.count ? `${summary.count} ${summary.count === 1 ? 'sessão concluída' : 'sessões concluídas'}` : 'Nenhuma sessão concluída';
    $('history-count').textContent = state.history.length;
    $('empty').hidden = state.history.length > 0;
    const fragment = document.createDocumentFragment();
    for (const session of state.history.slice(-8).reverse()) {
      const li = document.createElement('li'), dot = document.createElement('span'), copy = document.createElement('div'), title = document.createElement('p'), detail = document.createElement('p');
      dot.className = 'session-dot'; dot.setAttribute('aria-hidden', 'true'); copy.className = 'session-copy'; title.className = 'session-title'; detail.className = 'session-detail';
      title.textContent = session.task?.title || 'Foco livre';
      detail.textContent = `${Math.round(session.durationMs / 60000)} min · ${new Date(session.completedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      copy.append(title, detail); li.append(dot, copy); fragment.append(li);
    }
    $('sessions').replaceChildren(fragment);
    renderReport();
  }

  // Pasta e tags vêm da nota ligada à tarefa; a sessão guarda só id e título da tarefa.
  async function loadLookup() {
    const map = new Map(), notes = new Map();
    lookupFailed = false;
    const ids = new Set(state.history.map(session => session.task?.id).filter(Boolean));
    try {
      const byId = new Map((await api.tasks.list()).map(task => [task.id, task]));
      for (const taskId of ids) {
        const noteId = byId.get(taskId)?.noteId;
        if (!noteId) continue;
        if (!notes.has(noteId)) notes.set(noteId, await api.notes.get(noteId).catch(() => { lookupFailed = true; return null; }));
        const note = notes.get(noteId);
        if (note) map.set(taskId, { folder: note.folder, tags: note.tags });
      }
    } catch (error) { lookupFailed = true; }
    lookup = taskId => map.get(taskId) || null;
  }

  function renderBars(list, container, empty) {
    const max = Math.max(1, ...list.map(item => item.minutos));
    const rows = list.map(({ nome, minutos }) => {
      const li = document.createElement('li'), label = document.createElement('span'), track = document.createElement('span'), fill = document.createElement('span'), value = document.createElement('span');
      li.className = 'bar-row'; label.className = 'bar-label'; track.className = 'bar-track'; fill.className = 'bar-fill'; value.className = 'bar-value';
      label.textContent = nome;
      fill.style.width = `${(minutos / max) * 100}%`;
      value.textContent = M.formatarMinutos(minutos);
      track.append(fill); li.append(label, track, value);
      return li;
    });
    container.replaceChildren(...rows);
    empty.hidden = list.length > 0;
  }

  function renderReport() {
    const report = M.relatorio(state.history, lookup, $('report-period').value, Date.now());
    $('report-total').textContent = M.formatarMinutos(report.total);
    $('report-warning').hidden = !lookupFailed;
    renderBars(report.porPasta, $('report-folders'), $('report-folders-empty'));
    renderBars(report.porTag, $('report-tags'), $('report-tags-empty'));
  }

  async function act(action) {
    if (busy || failed) return;
    busy = true; render();
    try {
      settings = await api.settings.get();
      const selected = tasks.find(task => task.id === $('task').value);
      const next = M.transition(state, action, settings, Date.now(), id(), selected ? { id: selected.id, title: selected.title } : null);
      const completedFocus = next !== state && state.phase === 'focus' && next.phase === 'break';
      state = await M.commit(api.storage, state, next, settings);
      if (completedFocus) await loadLookup();
      message(completedFocus ? 'Foco concluído e salvo. Sua pausa está pronta quando você quiser.' : '');
    } catch (error) {
      if (error.latest) state = error.latest;
      message(error.latest ? error.message : `Não foi possível salvar. Seu estado anterior foi mantido. ${error.message}`, true);
      // A retry stays explicit; a full storage file must not trigger writes every tick.
      failed = !error.latest;
      if (failed) {
        $('retry').hidden = false;
      }
    } finally { busy = false; render(); }
  }
  $('toggle').addEventListener('click', () => act('toggle'));
  $('cancel').addEventListener('click', () => act('cancel'));
  $('report-period').addEventListener('change', () => { if (state) renderReport(); });
  const retry = document.createElement('button'); retry.id = 'retry'; retry.textContent = 'Tentar novamente'; retry.hidden = true;
  $('message').after(retry);
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try {
      settings = await api.settings.get();
      state = M.read(await api.storage.get(M.KEY), settings);
      failed = false; retry.hidden = true; message('Estado salvo recuperado.'); render();
      if (state.status === 'running' && M.remaining(state, Date.now()) === 0) await act('complete');
    } catch (error) { message(error.message, true); }
    finally { retry.disabled = false; }
  });
  try {
    settings = await api.settings.get();
    state = M.read(await api.storage.get(M.KEY), settings);
    try {
      tasks = (await api.tasks.list()).filter(task => !task.done);
      for (const task of tasks) { const option = document.createElement('option'); option.value = task.id; option.textContent = task.title; $('task').append(option); }
      message('');
    } catch (error) { message(`Tarefas indisponíveis. Você pode usar Foco livre. ${error.message}`, true); }
    await loadLookup();
    render();
    if (state.status === 'running' && M.remaining(state, Date.now()) === 0) await act('complete');
  } catch (error) { failed = true; message(`Não foi possível carregar o cronômetro. ${error.message}`, true); retry.hidden = false; }
  setInterval(() => {
    if (!state || failed) return;
    if (state.status === 'running' && M.remaining(state, Date.now()) === 0) act('complete');
    else if (!busy) render();
  }, 1000);
}).catch(error => {
  document.getElementById('message').textContent = `Não foi possível conectar ao Kiro. ${error.message}`;
});
