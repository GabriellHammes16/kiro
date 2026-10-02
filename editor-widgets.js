// Elementos desenhados no editor (etapa 2 da visualização ao vivo): tarefa, imagem, fórmulas,
// cabeçalho do bloco de código, callout e comentário. Esta primeira metade é pura — acha os
// elementos no texto, com a mesma regra da leitura (renderizarMarkdown) — e roda no Node.
(function (root) {
  const CM = () => root.CM;
  const IMAGEM = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
  const ehImagem = caminho => (root.Kiro?.isImagePath ? root.Kiro.isImagePath(caminho) : IMAGEM.test(String(caminho).trim()));
  // Igual a lerImagem do app: a última parte depois de | pode ser a largura (300 ou 300x200).
  function lerImagem(dentro) {
    const partes = dentro.split('|');
    const medida = partes.length > 1 && /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(partes[partes.length - 1]);
    const caminho = (medida ? partes.slice(0, -1) : partes).join('|').trim();
    return ehImagem(caminho) ? { caminho, largura: medida ? Number(medida[1]) : null } : null;
  }
  const FORMULA = /\$([^\s$](?:[^$\n]*[^\s$])?)\$/g;
  const IMAGEM_NA_LINHA = /!\[\[([^\][\n]+)\]\]/g;
  const COMENTARIO = /%%([^\n%]+)%%/g;

  function acharElementos(state, de, ate, { arvore } = {}) {
    const doc = state.doc, els = [], codigo = [];
    const tree = arvore || CM().language.syntaxTree(state);
    tree.iterate({
      from: de, to: ate,
      enter: no => {
        if (no.name === 'TaskMarker') {
          const marca = state.sliceDoc(no.from, no.to);
          els.push({ tipo: 'tarefa', de: no.from, ate: no.to, feito: /x/i.test(marca[1] || '') });
        }
        if (no.name === 'InlineCode') codigo.push([no.from, no.to]);
        if (no.name === 'FencedCode') {
          codigo.push([no.from, no.to]);
          const primeira = doc.lineAt(no.from), ultima = doc.lineAt(no.to);
          const info = primeira.text.replace(/^\s*(```|~~~)/, '').trim();
          if (!/^kiro:/.test(info)) {
            const fechada = ultima.number > primeira.number && /^\s*(```|~~~)\s*$/.test(ultima.text);
            const corpoAte = fechada ? doc.line(ultima.number - 1).to : no.to;
            const corpoDe = Math.min(primeira.to + 1, doc.length);
            els.push({ tipo: 'cabecalhoCodigo', de: primeira.from, ate: primeira.to, linguagem: info, codigo: corpoDe <= corpoAte ? doc.sliceString(corpoDe, corpoAte) : '', blocoDe: no.from, blocoAte: no.to });
          }
          return false;
        }
        if (no.name === 'Blockquote') {
          const primeira = doc.lineAt(no.from);
          const m = /^>\s?\[!(\w+)\]/.exec(primeira.text);
          if (m) {
            const inicio = primeira.from + primeira.text.indexOf('[!');
            const linhas = [];
            for (let p = no.from; p <= no.to;) { const l = doc.lineAt(p); linhas.push(l.from); p = l.to + 1; }
            els.push({ tipo: 'callout', de: inicio, ate: inicio + m[1].length + 3, nome: m[1], linhas });
          }
        }
      },
    });
    const emCodigo = (a, b) => codigo.some(([x, y]) => a < y && b > x);
    // Blocos $$ (a árvore do Markdown não os conhece): mesma regra de renderizarMarkdown.
    const blocos = [];
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(ate).number; n++) {
      const l = doc.line(n);
      const m = /^\$\$(.*)$/.exec(l.text);
      if (!m || emCodigo(l.from, l.to)) continue;
      const numaLinha = m[1].trim();
      let fim = n, tex;
      if (numaLinha.endsWith('$$') && numaLinha.length > 2) tex = numaLinha.slice(0, -2);
      else {
        const corpo = [];
        let k = n + 1;
        while (k <= doc.lines && !/^\$\$\s*$/.test(doc.line(k).text)) corpo.push(doc.line(k++).text);
        fim = Math.min(k, doc.lines);
        tex = corpo.join('\n');
      }
      blocos.push([l.from, doc.line(fim).to]);
      els.push({ tipo: 'formulaBloco', de: l.from, ate: doc.line(fim).to, tex: tex.trim() });
      n = fim;
    }
    const foraDeTudo = (a, b) => !emCodigo(a, b) && !blocos.some(([x, y]) => a < y && b > x);
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(ate).number; n++) {
      const l = doc.line(n);
      for (const m of l.text.matchAll(IMAGEM_NA_LINHA)) {
        const a = l.from + m.index, b = a + m[0].length;
        const img = lerImagem(m[1]);
        if (img && foraDeTudo(a, b)) els.push({ tipo: 'imagem', de: a, ate: b, ...img });
      }
      // Fórmulas: mascara as imagens e o código da linha para não achar $ dentro deles.
      for (const m of l.text.matchAll(FORMULA)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b) && !els.some(e => e.tipo === 'imagem' && a < e.ate && b > e.de)) els.push({ tipo: 'formula', de: a, ate: b, tex: m[1] });
      }
      for (const m of l.text.matchAll(COMENTARIO)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b)) els.push({ tipo: 'comentario', de: a, ate: b });
      }
    }
    return els.sort((x, y) => x.de - y.de);
  }

  const trocaDaTarefa = (state, el) => ({ from: el.de + 1, to: el.de + 2, insert: el.feito ? ' ' : 'x' });
  const trocaDaLargura = (el, largura) => ({ from: el.de, to: el.ate, insert: `![[${el.caminho}|${largura}]]` });

  const api = { acharElementos, trocaDaTarefa, trocaDaLargura, ehImagem, lerImagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroWidgets = api;
})(globalThis);
