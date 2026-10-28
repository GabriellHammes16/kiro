(function (root, factory) {
  const api = factory();
  root.KiroFlashcards = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  const KEY = 'progresso';
  function parse(notes) {
    const cards = [], seen = new Set();
    for (const note of notes) {
      let fence = null;
      for (const line of String(note.body || '').split(/\r?\n/)) {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
          if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
          continue;
        }
        if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue; }
        const pair = line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').match(/^(.*?)\s+::\s+(.*)$/);
        if (!pair) continue;
        const question = pair[1].trim(), answer = pair[2].trim();
        if (!question || !answer) continue;
        const id = JSON.stringify([note.id, question, answer]);
        if (seen.has(id)) continue;
        seen.add(id);
        cards.push({ id, question, answer, title: note.title || 'Nota sem título' });
      }
    }
    return cards;
  }
  function progress(value) {
    const result = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [id, row] of Object.entries(value)) {
      if (row && Number.isFinite(row.dueAt) && Number.isInteger(row.step) && row.step >= 0 && row.step <= 5 && Number.isInteger(row.revisions) && row.revisions >= 0 && Number.isFinite(row.lastReviewedAt)) {
        result[id] = { dueAt: row.dueAt, step: row.step, revisions: row.revisions, lastReviewedAt: row.lastReviewedAt };
      }
    }
    return result;
  }
  function schedule(previous, remembered, now = Date.now()) {
    const step = previous?.step || 0;
    const due = new Date(now);
    if (remembered) due.setDate(due.getDate() + [1, 3, 7, 14, 30][Math.min(step, 4)]);
    else due.setTime(now + 10 * 60 * 1000);
    return { revisions: (previous?.revisions || 0) + 1, step: remembered ? Math.min(step + 1, 5) : 0, dueAt: due.getTime(), lastReviewedAt: now };
  }
  function queue(cards, rows, now = Date.now()) {
    return cards.filter(card => !rows[card.id] || rows[card.id].dueAt <= now)
      .sort((a, b) => (rows[a.id]?.dueAt || 0) - (rows[b.id]?.dueAt || 0));
  }
  async function review(storage, id, remembered, now = Date.now()) {
    const rows = progress(await storage.get(KEY));
    rows[id] = schedule(rows[id], remembered, now);
    await storage.set(KEY, rows);
    return rows;
  }
  return { KEY, parse, progress, schedule, queue, review };
});
