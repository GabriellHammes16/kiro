(function (root, factory) {
  const api = factory();
  root.KiroWeeklyReview = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function windowDates(now = new Date()) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end); start.setDate(start.getDate() - 6);
    return { start: isoLocal(start), end: isoLocal(end) };
  }
  function collect(notes, tasks, now = new Date()) {
    const { start, end } = windowDates(now);
    const recentNotes = (notes || []).filter(n => {
      const d = n.updatedAt == null ? '' : isoLocal(new Date(n.updatedAt));
      return d >= start && d <= end;
    });
    const open = (tasks || []).filter(t => !t.done);
    const today = isoLocal(now);
    return { start, end, notes: recentNotes, tasks: open, overdue: open.filter(t => t.due && t.due < today), today: open.filter(t => t.due === today), future: open.filter(t => t.due > today) };
  }
  const plain = v => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  const linkTitle = v => {
    const source = String(v ?? '');
    const title = plain(source);
    return /[\[\]|\\\r\n]/.test(source) ? title.replace(/[\[\]\\]/g, '\\$&') : `[[${title}]]`;
  };
  const saving = new WeakMap();
  function markdown(data, reflections = {}) {
    const lines = [`# Revisão semanal — ${data.start} a ${data.end}`, '', `## ${data.notes.length} notas recentes`];
    if (data.notes.length) lines.push(...data.notes.map(n => `- ${linkTitle(n.title)}`)); else lines.push('- Nenhuma nota atualizada nesta semana.');
    lines.push('', '## Próximos passos');
    if (!data.tasks.length) lines.push('- Nenhuma tarefa em aberto.');
    else for (const [label, items] of [['Atrasadas', data.overdue], ['Hoje', data.today], ['Futuras', data.future], ['Sem prazo', data.tasks.filter(t => !t.due)]]) {
      if (items.length) lines.push('', `### ${label}`, ...items.map(t => `- [ ] ${plain(t.title)}${t.due ? ` — ${t.due}` : ''}`));
    }
    for (const [heading, key] of [['O que avançou', 'advanced'], ['O que ficou pendente', 'pending'], ['Prioridade da próxima semana', 'priority']])
      lines.push('', `## ${heading}`, String(reflections[key] ?? '').trim() || '—');
    return lines.join('\n');
  }
  let lastTitleTime = 0;
  function titleAt(date = new Date()) {
    const time = Math.max(date.getTime(), lastTitleTime + 1); lastTitleTime = time;
    date = new Date(time);
    return `Revisão semanal ${isoLocal(date)} ${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}-${String(date.getMilliseconds()).padStart(3, '0')}`;
  }
  async function createReview(kiro, body, date = new Date()) {
    if (saving.has(kiro)) return saving.get(kiro);
    const request = Promise.resolve().then(() => kiro.notes.create({ title: titleAt(date), body, tags: ['revisao-semanal'] }));
    saving.set(kiro, request);
    try { return await request; } finally { saving.delete(kiro); }
  }
  return { windowDates, collect, markdown, titleAt, createReview };
});
