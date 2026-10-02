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
          // Strip leading > for blockquotes first, then the fence marker
          let info = primeira.text.replace(/^>\s?/, '').trim();
          info = info.replace(/^\s*(```|~~~)/, '').trim();
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
    // Scan from line 1 (not from de) to catch blocks that intersect [de, ate]
    const blocos = [];
    for (let n = 1; n <= doc.lines; n++) {
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
      const blocoInicio = l.from, blocoFim = doc.line(fim).to;
      blocos.push([blocoInicio, blocoFim]);
      // Only add to els if the block intersects [de, ate]
      if (blocoInicio < ate && blocoFim > de) {
        els.push({ tipo: 'formulaBloco', de: blocoInicio, ate: blocoFim, tex: tex.trim() });
      }
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
    els.sort((x, y) => x.de - y.de);

    // Remove overlapping elements: priority comentario > formulaBloco > imagem > formula
    // Tasks, callouts, and code headers never overlap these
    const prioridade = { comentario: 0, formulaBloco: 1, imagem: 2, formula: 3, tarefa: 4, callout: 4, cabecalhoCodigo: 4 };
    const sobrepostos = new Set();
    for (let i = 0; i < els.length; i++) {
      if (sobrepostos.has(i)) continue;
      for (let j = i + 1; j < els.length; j++) {
        if (sobrepostos.has(j)) continue;
        const ei = els[i], ej = els[j];
        const sobrepoe = ei.de < ej.ate && ei.ate > ej.de;
        if (sobrepoe) {
          const priorI = prioridade[ei.tipo];
          const priorJ = prioridade[ej.tipo];
          if (priorI !== undefined && priorJ !== undefined) {
            if (priorI < priorJ) sobrepostos.add(j);
            else if (priorJ < priorI) sobrepostos.add(i);
          }
        }
      }
    }
    return els.filter((_, i) => !sobrepostos.has(i));
  }

  const trocaDaTarefa = (state, el) => ({ from: el.de + 1, to: el.de + 2, insert: el.feito ? ' ' : 'x' });
  const trocaDaLargura = (el, largura) => ({ from: el.de, to: el.ate, insert: `![[${el.caminho}|${largura}]]` });

  // ---- Metade do CodeMirror: desenha os elementos no editor. Em linha: ViewPlugin (só o que se vê);
  // blocos ($$ e cabeçalho de código): StateField, porque só ele pode vir com widgets de bloco. ----
  const BLOCOS = new Set(['formulaBloco', 'cabecalhoCodigo']);

  function extensao(opcoes = {}) {
    const { state: S, view: V, language: L } = CM();
    const t = opcoes.t || (f => f);
    const linhasDaSelecao = state => root.KiroEditor.linhasDaSelecao(state);
    const arvoreAte = (state, ate) => L.ensureSyntaxTree(state, ate, 50) ?? L.syntaxTree(state);
    const nomeDoArquivo = caminho => caminho.split('/').pop();
    const elementoEm = (view, tipo, pos) => {
      const l = view.state.doc.lineAt(pos);
      return acharElementos(view.state, l.from, l.to).find(e => e.tipo === tipo && e.de === pos);
    };

    const cacheDeFormulas = new Map();
    const htmlDaFormula = (tex, bloco) => {
      const chave = (bloco ? 'b' : 'l') + tex;
      if (!cacheDeFormulas.has(chave)) {
        if (cacheDeFormulas.size > 500) cacheDeFormulas.clear();
        cacheDeFormulas.set(chave, opcoes.desenharFormula ? opcoes.desenharFormula(tex, bloco) : tex);
      }
      return cacheDeFormulas.get(chave);
    };

    class CaixaDeTarefa extends V.WidgetType {
      constructor(feito) { super(); this.feito = feito; }
      eq(o) { return o.feito === this.feito; }
      toDOM(view) {
        const i = document.createElement('input');
        i.type = 'checkbox'; i.className = 'ed-caixa'; i.checked = this.feito; i.setAttribute('aria-label', t('Concluída'));
        i.addEventListener('click', e => e.preventDefault());
        i.addEventListener('mousedown', e => {
          e.preventDefault();   // não move o cursor
          const el = elementoEm(view, 'tarefa', view.posAtDOM(i));
          if (el) view.dispatch({ changes: trocaDaTarefa(view.state, el), userEvent: 'input' });
        });
        return i;
      }
    }
    class Imagem extends V.WidgetType {
      constructor(texto) { super(); this.texto = texto; this.img = lerImagem(texto); }
      eq(o) { return o.img.caminho === this.img.caminho && o.img.largura === this.img.largura && o.texto === this.texto; }
      toDOM(view) {
        const s = document.createElement('span');
        const html = opcoes.desenharImagem?.(this.texto);
        if (!html) { s.textContent = `![[${this.texto}]]`; return s; }
        s.innerHTML = html;
        const { caminho } = this.img;
        s.addEventListener('click', e => { if (e.target.closest('img')) opcoes.abrirImagem?.(caminho, nomeDoArquivo(caminho)); });
        s.addEventListener('pointerdown', e => {
          const alca = e.target.closest('.md-alca'), moldura = s.querySelector('.md-imagem'), img = s.querySelector('img');
          if (!alca || !moldura || !img || e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          const inicial = Math.round(img.getBoundingClientRect().width), limite = view.contentDOM.clientWidth;
          let largura = inicial;
          moldura.classList.add('redimensionando');
          const mover = ev => { largura = Math.round(Math.min(limite, Math.max(48, inicial + ev.clientX - e.clientX))); img.style.width = largura + 'px'; };
          const soltar = () => {
            document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', soltar);
            moldura.classList.remove('redimensionando');
            const el = s.isConnected ? elementoEm(view, 'imagem', view.posAtDOM(s)) : null;
            if (el && largura !== inicial) view.dispatch({ changes: trocaDaLargura(el, largura), userEvent: 'input' });
          };
          document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', soltar);
        });
        return s;
      }
    }
    class Formula extends V.WidgetType {
      constructor(tex, bloco) { super(); this.tex = tex; this.bloco = bloco; }
      eq(o) { return o.tex === this.tex && o.bloco === this.bloco; }
      toDOM() {
        const e = document.createElement(this.bloco ? 'div' : 'span');
        if (this.bloco) e.className = 'math-bloco';
        e.innerHTML = htmlDaFormula(this.tex, this.bloco);
        return e;
      }
      ignoreEvent() { return false; }   // clicar põe o cursor ali e mostra o texto
    }
    class RotuloDoCallout extends V.WidgetType {
      constructor(nome) { super(); this.nome = nome; }
      eq(o) { return o.nome === this.nome; }
      toDOM() { const e = document.createElement('span'); e.className = 'md-destaque-tipo'; e.textContent = this.nome; return e; }
      ignoreEvent() { return false; }
    }
    class CabecalhoDoCodigo extends V.WidgetType {
      constructor(linguagem, codigo) { super(); this.linguagem = linguagem; this.codigo = codigo; }
      eq(o) { return o.linguagem === this.linguagem && o.codigo === this.codigo; }
      toDOM() {
        const e = document.createElement('div');
        e.className = 'code-area-cabecalho';
        const l = document.createElement('span'); l.className = 'code-lang'; l.textContent = this.linguagem || t('texto');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary code-copy'; b.textContent = t('Copiar');
        b.addEventListener('click', async () => {
          if (await opcoes.copiar?.(this.codigo)) { b.textContent = t('Copiado'); setTimeout(() => { b.textContent = t('Copiar'); }, 1400); }
        });
        e.append(l, b);
        return e;
      }
      ignoreEvent(ev) { return Boolean(ev.target?.closest?.('button')); }
    }

    // Em linha. Devolve também as faixas cobertas por widgets: a etapa 1 não pode esconder nada ali dentro
    // (replace sobreposto lança erro). Guardado por estado + trecho visível: o plugin do editor consulta o mesmo.
    const memoria = new WeakMap();
    function emLinha(view) {
      const state = view.state, chave = view.visibleRanges.map(r => `${r.from}:${r.to}`).join();
      const guardado = memoria.get(state);
      if (guardado?.chave === chave) return guardado;
      const linhas = linhasDaSelecao(state), doc = state.doc, decos = [], faixas = [], vistos = new Set();
      const cobre = (a, b, deco) => { decos.push(deco.range(a, b)); faixas.push([a, b]); };
      for (const { from, to } of view.visibleRanges) {
        for (const el of acharElementos(state, from, to, { arvore: arvoreAte(state, to) })) {
          if (BLOCOS.has(el.tipo) || vistos.has(el.de)) continue;
          vistos.add(el.de);
          if (el.tipo === 'callout') for (const l of el.linhas) decos.push(V.Decoration.line({ class: 'ed-citacao md-destaque' }).range(l));
          const ativa = linhas.has(doc.lineAt(el.de).number);
          if (el.tipo === 'comentario') {
            if (ativa) decos.push(V.Decoration.mark({ class: 'md-comentario' }).range(el.de, el.ate));
            else {
              decos.push(V.Decoration.mark({ class: 'md-comentario' }).range(el.de + 2, el.ate - 2));
              cobre(el.de, el.de + 2, V.Decoration.replace({})); cobre(el.ate - 2, el.ate, V.Decoration.replace({}));
              faixas.push([el.de, el.ate]);
            }
            continue;
          }
          if (ativa) continue;
          if (el.tipo === 'tarefa') cobre(el.de, el.ate, V.Decoration.replace({ widget: new CaixaDeTarefa(el.feito) }));
          else if (el.tipo === 'imagem') cobre(el.de, el.ate, V.Decoration.replace({ widget: new Imagem(doc.sliceString(el.de + 3, el.ate - 2)) }));
          else if (el.tipo === 'formula') cobre(el.de, el.ate, V.Decoration.replace({ widget: new Formula(el.tex, false) }));
          else if (el.tipo === 'callout') cobre(el.de, el.ate, V.Decoration.replace({ widget: new RotuloDoCallout(el.nome) }));
        }
      }
      const r = { chave, decos: V.Decoration.set(decos, true), faixas };
      memoria.set(state, r);
      return r;
    }
    const pluginEmLinha = V.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = emLinha(view).decos; }
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || L.syntaxTree(u.startState) !== L.syntaxTree(u.state)) this.decorations = emLinha(u.view).decos; }
    }, { decorations: v => v.decorations });

    // Blocos: o documento inteiro (são poucos); só refaz a procura quando o texto ou a árvore mudam.
    const desenharBlocos = (state, els) => {
      const linhas = linhasDaSelecao(state), doc = state.doc, decos = [], faixas = [];
      for (const el of els) {
        const ini = doc.lineAt(el.de).number, fim = doc.lineAt(el.ate).number;
        let tocada = false;
        for (let n = ini; n <= fim; n++) if (linhas.has(n)) tocada = true;
        if (tocada) continue;
        const widget = el.tipo === 'formulaBloco' ? new Formula(el.tex, true) : new CabecalhoDoCodigo(el.linguagem, el.codigo);
        decos.push(V.Decoration.replace({ widget, block: true }).range(el.de, el.ate));
        faixas.push([el.de, el.ate]);
      }
      return { els, faixas, decos: V.Decoration.set(decos, true) };
    };
    const procurarBlocos = state => acharElementos(state, 0, state.doc.length, { arvore: arvoreAte(state, state.doc.length) }).filter(e => BLOCOS.has(e.tipo));
    const campoDosBlocos = S.StateField.define({
      create: state => desenharBlocos(state, procurarBlocos(state)),
      update(v, tr) {
        if (tr.docChanged || L.syntaxTree(tr.startState) !== L.syntaxTree(tr.state)) return desenharBlocos(tr.state, procurarBlocos(tr.state));
        return tr.selection ? desenharBlocos(tr.state, v.els) : v;
      },
      provide: f => V.EditorView.decorations.from(f, v => v.decos),
    });

    // Cliques em links só fora da linha do cursor (nela o CodeMirror posiciona o cursor).
    const cliques = V.EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
        const alvo = e.target.closest?.('.ed-wikilink, .ed-wikilink-ausente, .ed-link, .ed-etiqueta');
        if (!alvo) return false;
        const pos = view.posAtDOM(alvo), linha = view.state.doc.lineAt(pos);
        if (linhasDaSelecao(view.state).has(linha.number)) return false;
        if (alvo.matches('.ed-etiqueta')) { opcoes.buscarEtiqueta?.(alvo.textContent.replace(/^#/, '')); e.preventDefault(); return true; }
        if (alvo.matches('.ed-link')) {
          for (let n = L.syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
            if (n.name !== 'Link') continue;
            const url = n.getChild('URL');
            if (!url) return false;
            e.preventDefault(); opcoes.abrirSite?.(view.state.sliceDoc(url.from, url.to)); return true;
          }
          return false;
        }
        const rel = pos - linha.from;
        const m = root.KiroEditor.marcacoesDoKiro(linha.text).find(x => x.tipo === 'wikilink' && x.de <= rel && rel < x.ate);
        if (!m) return false;
        e.preventDefault(); opcoes.abrirNota?.(m.alvo.split('#')[0].trim());
        return true;
      },
    });

    const ext = [campoDosBlocos, pluginEmLinha, cliques];
    // faixas cobertas por widgets, para a etapa 1 não esconder nada dentro delas
    ext.ocupadas = view => [...emLinha(view).faixas, ...view.state.field(campoDosBlocos).faixas];
    return ext;
  }

  const api = { extensao, acharElementos, trocaDaTarefa, trocaDaLargura, ehImagem, lerImagem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroWidgets = api;
})(globalThis);
