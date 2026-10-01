// Editor do corpo da nota: CodeMirror 6 (vendor/codemirror) com visualização ao vivo. Este
// arquivo tem duas metades: as partes puras (análise do texto → o que esconder e estilizar),
// testáveis no Node, e a montagem na página (Task 3). Não conhece o cofre: recebe o texto e
// entrega o novo por aoMudar.
(function (root) {
  const CM = () => root.CM;

  const separadorDeLinha = texto => (texto.includes('\r\n') ? '\r\n' : '\n');

  // [[alvo]] / [[alvo|apelido]] (não ![[ — imagem é etapa 2), #etiqueta como em domain.js
  // (início de linha ou depois de espaço), ==realce==.
  const WIKILINK = /(?<!!)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g;
  const ETIQUETA = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;
  const REALCE = /==([^=\n](?:[^\n]*?[^=\n])?)==/g;
  function marcacoesDoKiro(linha) {
    const achadas = [];
    for (const m of linha.matchAll(WIKILINK)) achadas.push({ tipo: 'wikilink', de: m.index, ate: m.index + m[0].length, alvo: m[1].trim(), apelido: m[2]?.trim() });
    for (const m of linha.matchAll(ETIQUETA)) { const de = m.index + m[1].length; achadas.push({ tipo: 'etiqueta', de, ate: de + m[2].length }); }
    for (const m of linha.matchAll(REALCE)) achadas.push({ tipo: 'realce', de: m.index, ate: m.index + m[0].length });
    return achadas.sort((a, b) => a.de - b.de);
  }

  function linhasDaSelecao(state) {
    const linhas = new Set();
    for (const faixa of state.selection.ranges) {
      const ini = state.doc.lineAt(faixa.from).number, fim = state.doc.lineAt(faixa.to).number;
      for (let n = ini; n <= fim; n++) linhas.add(n);
    }
    return linhas;
  }

  const ESTILO_DO_NO = { StrongEmphasis: 'ed-negrito', Emphasis: 'ed-italico', Strikethrough: 'ed-tachado', InlineCode: 'ed-codigo' };
  const MARCAS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);

  function analisar(state, de, ate, linhasDoCursor, { existe } = {}) {
    const r = { esconder: [], estilos: [], linhas: [], trocar: [] };
    const naLinhaDoCursor = pos => linhasDoCursor.has(state.doc.lineAt(pos).number);
    const esconder = (a, b) => { if (b > a && !naLinhaDoCursor(a)) r.esconder.push([a, b]); };
    const excluir = [];   // código e endereços: marcações do Kiro não valem dentro deles
    const linhasDe = (a, b, classe) => { for (let p = a; p <= b;) { const l = state.doc.lineAt(p); r.linhas.push([l.from, classe]); p = l.to + 1; } };
    CM().language.syntaxTree(state).iterate({
      from: de, to: ate,
      enter: no => {
        const nome = no.name;
        const titulo = /^ATXHeading([1-6])$/.exec(nome);
        if (titulo) { r.linhas.push([state.doc.lineAt(no.from).from, `ed-h${titulo[1]}`]); return; }
        if (nome === 'HeaderMark') { const fim = state.sliceDoc(no.to, no.to + 1) === ' ' ? no.to + 1 : no.to; esconder(no.from, fim); return; }
        if (ESTILO_DO_NO[nome]) r.estilos.push([no.from, no.to, ESTILO_DO_NO[nome]]);
        if (nome === 'InlineCode') { r.estilos.push([no.from, no.to, 'ed-sem-corretor']); excluir.push([no.from, no.to]); }
        if (MARCAS.has(nome)) { esconder(no.from, no.to); return; }
        if (nome === 'Link') {
          const marcas = [], url = [];
          for (let f = no.node.firstChild; f; f = f.nextSibling) { if (f.name === 'LinkMark') marcas.push(f); if (f.name === 'URL') url.push(f); }
          // sem URL é referência/atalho (ex.: [[wikilink]]), tratado pelas marcações do Kiro
          if (marcas.length >= 2 && url.length) {
            r.estilos.push([marcas[0].to, marcas[1].from, 'ed-link']);
            esconder(marcas[0].from, marcas[0].to);
            esconder(marcas[1].from, no.to);
          }
          for (const u of url) { r.estilos.push([u.from, u.to, 'ed-sem-corretor']); excluir.push([u.from, u.to]); }
          return false;
        }
        if (nome === 'Autolink') { excluir.push([no.from, no.to]); return false; }
        if (nome === 'Blockquote') linhasDe(no.from, no.to, 'ed-citacao');
        if (nome === 'QuoteMark') { const fim = state.sliceDoc(no.to, no.to + 1) === ' ' ? no.to + 1 : no.to; esconder(no.from, fim); return; }
        if (nome === 'HorizontalRule') { r.linhas.push([state.doc.lineAt(no.from).from, 'ed-regua']); esconder(no.from, no.to); return; }
        if (nome === 'ListMark') {
          const sinal = state.sliceDoc(no.from, no.to);
          if (/^[-*+]$/.test(sinal) && !naLinhaDoCursor(no.from)) r.trocar.push([no.from, no.to, '•']);
          return;
        }
        if (nome === 'FencedCode') {
          linhasDe(no.from, no.to, 'ed-codigo-bloco');
          excluir.push([no.from, no.to]);
          const primeira = state.doc.lineAt(no.from), ultima = state.doc.lineAt(no.to);
          if (ultima.number > primeira.number + 1) r.estilos.push([state.doc.line(primeira.number + 1).from, state.doc.line(ultima.number - 1).to, 'ed-sem-corretor']);
          esconder(primeira.from, primeira.to);
          if (/^\s*(```|~~~)/.test(ultima.text) && ultima.number > primeira.number) esconder(ultima.from, ultima.to);
          return false;
        }
      },
    });
    // Marcações do Kiro, linha a linha, fora de código.
    const dentroDeCodigo = (a, b) => excluir.some(([x, y]) => a < y && b > x);
    for (let p = de; p <= ate;) {
      const linha = state.doc.lineAt(p);
      for (const m of marcacoesDoKiro(linha.text)) {
        const a = linha.from + m.de, b = linha.from + m.ate;
        if (dentroDeCodigo(a, b)) continue;
        if (m.tipo === 'etiqueta') { r.estilos.push([a, b, 'ed-etiqueta'], [a, b, 'ed-sem-corretor']); continue; }
        if (m.tipo === 'realce') { r.estilos.push([a + 2, b - 2, 'ed-realce']); esconder(a, a + 2); esconder(b - 2, b); continue; }
        const classe = existe && !existe(m.alvo) ? 'ed-wikilink-ausente' : 'ed-wikilink';
        const inicioDoTexto = m.apelido ? a + 2 + linha.text.slice(m.de + 2).indexOf('|') + 1 : a + 2;
        r.estilos.push([inicioDoTexto, b - 2, classe]);
        if (!m.apelido) r.estilos.push([a + 2, b - 2, 'ed-sem-corretor']);
        esconder(a, inicioDoTexto);
        esconder(b - 2, b);
      }
      p = linha.to + 1;
    }
    r.esconder.sort((x, y) => x[0] - y[0]);
    // defesa: Decoration.replace lança em intervalos sobrepostos
    r.esconder = r.esconder.filter((x, i, v) => { if (i && x[0] < (v.fim ?? 0)) return false; v.fim = x[1]; return true; });
    return r;
  }

  const api = { separadorDeLinha, marcacoesDoKiro, linhasDaSelecao, analisar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroEditor = api;
})(globalThis);
