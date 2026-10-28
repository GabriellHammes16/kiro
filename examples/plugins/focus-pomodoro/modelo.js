(function (root) {
  'use strict';
  const KEY = 'timer';
  const duration = (settings, phase) => (phase === 'focus' ? settings.foco : settings.pausa) * 60000;
  function initial(settings) {
    return { revision: '', phase: 'focus', status: 'ready', durationMs: duration(settings, 'focus'), remainingMs: duration(settings, 'focus'), deadline: null, cycleId: '', task: null, history: [] };
  }
  function read(value, settings) {
    if (value == null) return initial(settings);
    if (!['focus', 'break'].includes(value.phase) || !['ready', 'running', 'paused'].includes(value.status)
      || !Number.isFinite(value.durationMs) || value.durationMs <= 0 || !Number.isFinite(value.remainingMs)
      || value.remainingMs < 0 || !Array.isArray(value.history) || typeof value.revision !== 'string'
      || (value.status === 'running' && (!Number.isFinite(value.deadline) || !value.cycleId))) {
      throw new Error('O cronômetro salvo não pôde ser lido. Os dados foram preservados.');
    }
    return value;
  }
  const remaining = (state, now) => state.status === 'running' ? Math.max(0, state.deadline - now) : state.remainingMs;
  function transition(state, action, settings, now, id, task = null) {
    const next = { ...state, revision: id };
    if (action === 'complete') {
      if (state.status !== 'running' || remaining(state, now) > 0) return state;
      if (state.phase === 'focus' && !state.history.some(item => item.id === state.cycleId)) {
        next.history = [...state.history, { id: state.cycleId, task: state.task, durationMs: state.durationMs, completedAt: state.deadline }].slice(-200);
      }
      next.phase = state.phase === 'focus' ? 'break' : 'focus';
      next.status = 'ready';
      next.durationMs = next.remainingMs = duration(settings, next.phase);
      next.deadline = null;
      next.task = null;
      next.cycleId = '';
    } else if (action === 'toggle') {
      if (state.status === 'running') {
        if (remaining(state, now) === 0) return transition(state, 'complete', settings, now, id);
        next.status = 'paused';
        next.remainingMs = remaining(state, now);
        next.deadline = null;
      } else {
        if (state.status === 'ready') {
          next.durationMs = next.remainingMs = duration(settings, state.phase);
          next.cycleId = id;
          next.task = state.phase === 'focus' ? task : null;
        }
        next.status = 'running';
        next.deadline = now + next.remainingMs;
      }
    } else if (action === 'cancel') {
      return { ...initial(settings), revision: id, history: state.history };
    } else throw new Error('Ação desconhecida.');
    return next;
  }
  async function commit(storage, state, next, settings) {
    if (next === state) return state;
    const latest = read(await storage.get(KEY), settings);
    if (latest.revision !== state.revision) {
      const error = new Error('O cronômetro mudou em outra janela. Estado atualizado; tente novamente.');
      error.latest = latest;
      throw error;
    }
    // shortcut: storage não oferece compare-and-swap; use uma janela até haver escrita atômica condicional.
    await storage.set(KEY, next);
    return next;
  }
  function today(history, now = Date.now()) {
    const day = new Date(now).toDateString();
    const sessions = history.filter(item => new Date(item.completedAt).toDateString() === day);
    return { count: sessions.length, minutes: Math.round(sessions.reduce((sum, item) => sum + item.durationMs, 0) / 60000) };
  }
  const PERIODOS = { hoje: 1, semana: 7, mes: 30 };
  // início do período: meia-noite local do primeiro dia incluído (hoje = 1 dia, 7 dias, 30 dias).
  function inicioPeriodo(periodo, now = Date.now()) {
    const dias = PERIODOS[periodo];
    if (!dias) throw new Error('Período desconhecido.');
    const dia = new Date(now);
    dia.setHours(0, 0, 0, 0);
    dia.setDate(dia.getDate() - (dias - 1));
    return dia.getTime();
  }
  function formatarMinutos(minutos) {
    const horas = Math.floor(minutos / 60), resto = minutos % 60;
    if (horas === 0) return `${resto} min`;
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  }
  // lookup(taskId) → { folder, tags } ou null. Sessão sem tarefa vai para "Sem tarefa";
  // Sem vínculo conhecido: "Sem classificação". Nota na raiz: "Sem pasta".
  function relatorio(history, lookup, periodo, now = Date.now()) {
    const inicio = inicioPeriodo(periodo, now);
    const pastas = new Map(), tags = new Map();
    let total = 0;
    const soma = (mapa, nome, ms) => mapa.set(nome, (mapa.get(nome) || 0) + ms);
    for (const item of history) {
      if (!item || !Number.isFinite(item.completedAt) || !Number.isFinite(item.durationMs) || item.durationMs <= 0) continue;
      if (item.completedAt < inicio || item.completedAt > now) continue;
      total += item.durationMs;
      if (!item.task) { soma(pastas, 'Sem tarefa', item.durationMs); continue; }
      const info = lookup(item.task.id);
      soma(pastas, info ? info.folder || 'Sem pasta' : 'Sem classificação', item.durationMs);
      for (const tag of new Set(info?.tags || [])) soma(tags, tag, item.durationMs);
    }
    const ordenar = mapa => [...mapa]
      .map(([nome, ms]) => ({ nome, minutos: Math.round(ms / 60000) }))
      .sort((a, b) => b.minutos - a.minutos || a.nome.localeCompare(b.nome, 'pt-BR'));
    return { total: Math.round(total / 60000), porPasta: ordenar(pastas), porTag: ordenar(tags) };
  }
  const api = { KEY, initial, read, remaining, transition, commit, today, inicioPeriodo, formatarMinutos, relatorio };
  root.KiroFocus = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
