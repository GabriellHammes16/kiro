(function (root, factory) {
  const api = factory();
  root.KiroSlides = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const HEADING = /^(#{1,2})\s+(.*\S)\s*$/;
  const CLOSE = fence => new RegExp('^' + fence[0] + '{' + fence.length + ',}$');

  // Título `#` ou `##` abre slide; `---` sozinha também. Cercas de código são preservadas.
  function split(source) {
    const slides = [];
    let current = null, fence = null;
    const open = title => { current = { title, lines: [] }; slides.push(current); };
    for (const line of String(source ?? '').split(/\r?\n/)) {
      const t = line.trim();
      if (fence) { if (CLOSE(fence).test(t)) fence = null; current.lines.push(line); continue; }
      const abre = t.match(/^(`{3,}|~{3,})/);
      if (abre) { fence = abre[1]; if (!current) open(''); current.lines.push(line); continue; }
      const heading = line.match(HEADING);
      if (heading) { open(heading[2]); continue; }
      if (t === '---') { open(''); continue; }
      if (!current) open('');
      current.lines.push(line);
    }
    const result = slides
      .filter(s => s.title || s.lines.join('').trim())
      .map(s => ({ title: s.title, body: s.lines.join('\n').trim() }));
    return result.length ? result : [{ title: '', body: '' }];
  }

  // Blocos para desenhar: parágrafo, lista, título menor e código. Sem HTML: quem desenha usa textContent.
  function blocks(source) {
    const out = [];
    let current = null, code = null;
    for (const raw of String(source ?? '').split(/\r?\n/)) {
      const t = raw.trim();
      if (code) {
        if (CLOSE(code.fence).test(t)) { out.push({ type: 'code', text: code.lines.join('\n') }); code = null; }
        else code.lines.push(raw);
        continue;
      }
      const abre = t.match(/^(`{3,}|~{3,})/);
      if (abre) { current = null; code = { fence: abre[1], lines: [] }; continue; }
      if (!t) { current = null; continue; }
      const sub = t.match(/^#{3,6}\s+(.*)$/);
      if (sub) { out.push({ type: 'h', text: sub[1] }); current = null; continue; }
      const item = t.match(/^([-*]|\d+\.)\s+(.*)$/);
      if (item) {
        const type = /\d/.test(item[1]) ? 'ol' : 'ul';
        if (!current || current.type !== type) { current = { type, items: [] }; out.push(current); }
        current.items.push(item[2]);
        continue;
      }
      if (!current || current.type !== 'p') { current = { type: 'p', text: [] }; out.push(current); }
      current.text.push(t);
    }
    if (code) out.push({ type: 'code', text: code.lines.join('\n') });
    return out.map(b => (b.type === 'p' ? { type: 'p', text: b.text.join(' ') } : b));
  }

  // Negrito, itálico e código em linha. Devolve partes simples, sem HTML.
  function inline(source) {
    const parts = [];
    const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
    let last = 0, m;
    while ((m = re.exec(source))) {
      if (m.index > last) parts.push({ type: 'text', text: source.slice(last, m.index) });
      if (m[1] !== undefined) parts.push({ type: 'code', text: m[1] });
      else if (m[2] !== undefined) parts.push({ type: 'strong', text: m[2] });
      else parts.push({ type: 'em', text: m[3] });
      last = re.lastIndex;
    }
    if (last < source.length) parts.push({ type: 'text', text: source.slice(last) });
    return parts;
  }

  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function filter(notes, query) {
    const q = norm(query);
    return (notes || []).filter(n => norm(n.title).includes(q));
  }

  return { split, blocks, inline, filter };
});
