'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let kiro, data, saving = false, saved = false;
  const reflections = () => ({ advanced: $('advanced').value, pending: $('pending').value, priority: $('priority').value });
  function updatePreview() { if (data) $('markdown').textContent = KiroWeeklyReview.markdown(data, reflections()); }
  function setStatus(message, kind = '') { const el = $('status'); el.textContent = message; el.dataset.error = String(kind === 'error'); el.dataset.success = String(kind === 'success'); }
  function text(tag, value, cls) { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; }
  function render() {
    $('intervalo').textContent = `${data.start} — ${data.end}`;
    $('nNotas').textContent = data.notes.length; $('nTarefas').textContent = data.tasks.length; $('nAtrasadas').textContent = data.overdue.length;
    const notes = $('notas'); notes.replaceChildren();
    if (!data.notes.length) notes.append(text('li', 'Nenhuma nota foi atualizada neste período.', 'vazio'));
    for (const note of data.notes) { const li = document.createElement('li'); li.append(text('span', `[[${note.title || 'Sem título'}]]`, 'nota-titulo')); li.append(text('span', new Date(note.updatedAt).toLocaleDateString('pt-BR'), 'nota-data')); notes.append(li); }
    const root = $('tarefas'); root.replaceChildren();
    const groups = [['Atrasadas', data.overdue], ['Hoje', data.today], ['Futuras', data.future], ['Sem prazo', data.tasks.filter(t => !t.due)]];
    let any = false;
    for (const [name, items] of groups) if (items.length) { any = true; const section = document.createElement('section'); section.className = 'grupo'; section.append(text('h3', name)); const ul = document.createElement('ul'); for (const task of items) { const li = document.createElement('li'); li.append(text('span', task.title || 'Tarefa sem título')); if (task.due) li.append(text('span', task.due, 'task-due')); ul.append(li); } section.append(ul); root.append(section); }
    if (!any) root.append(text('p', 'Nenhuma tarefa em aberto.', 'vazio'));
    updatePreview();
  }
  async function load() { $('atualizar').disabled = true; setStatus('Atualizando notas e tarefas…'); try { const [notes, tasks] = await Promise.all([kiro.notes.list({ limit: 500 }), kiro.tasks.list()]); data = KiroWeeklyReview.collect(notes, tasks); render(); setStatus('Dados atualizados.'); } catch (e) { setStatus(`Não foi possível carregar os dados: ${e.message}`, 'error'); } finally { $('atualizar').disabled = false; } }
  async function save() {
    if (saving || saved || !data) return;
    saving = true; $('salvar').disabled = true; $('atualizar').disabled = true;
    for (const id of ['advanced', 'pending', 'priority']) $(id).disabled = true;
    setStatus('Salvando nova nota…');
    try { const result = await KiroWeeklyReview.createReview(kiro, KiroWeeklyReview.markdown(data, reflections())); saved = true; const title = result?.title || result?.note?.title || 'Revisão semanal'; setStatus(`Revisão salva como “${title}”.`, 'success'); }
    catch (e) { setStatus(`Não foi possível salvar. Suas reflexões continuam aqui; tente novamente. ${e.message}`, 'error'); }
    finally {
      saving = false; $('salvar').disabled = saved; $('atualizar').disabled = false;
      for (const id of ['advanced', 'pending', 'priority']) $(id).disabled = false;
    }
  }
  for (const id of ['advanced', 'pending', 'priority']) $(id).addEventListener('input', () => {
    if (saving) return;
    if (saved) { saved = false; $('salvar').disabled = false; setStatus('Alterações ainda não salvas. Salvar cria uma nova nota.'); }
    updatePreview();
  });
  $('atualizar').addEventListener('click', load); $('salvar').addEventListener('click', save);
  globalThis.kiro.ready.then(k => { kiro = k; load(); }).catch(e => setStatus(`Falha ao iniciar: ${e.message}`, 'error'));
})();
