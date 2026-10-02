// Editor do corpo da nota: CodeMirror 6 (vendor/codemirror) com visualização ao vivo. Este
// arquivo tem duas metades: as partes puras (análise do texto → o que esconder e estilizar),
// testáveis no Node, e a montagem na página. Não conhece o cofre: recebe o texto e
// entrega o novo por aoMudar.
(function (root) {
  const CM = () => root.CM;
  const t = (f, v) => (root.KiroIdiomas ? root.KiroIdiomas.t(f, v) : f);

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

  // Palavras de uma linha para o corretor: letras e números (Unicode), com hífen ou apóstrofo só
  // entre letras (guarda-chuva, don't, d'água). Trechos em `ignorar` (código, endereço, alvo de
  // [[link]], etiqueta) ficam de fora.
  const PALAVRA = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  function palavrasDaLinha(texto, ignorar = []) {
    const fora = (a, b) => !ignorar.some(([x, y]) => a < y && b > x);
    return [...texto.matchAll(PALAVRA)].map(m => ({ de: m.index, ate: m.index + m[0].length, palavra: m[0] })).filter(({ de, ate }) => fora(de, ate));
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

  function analisar(state, de, ate, linhasDoCursor, { existe, arvore } = {}) {
    const r = { esconder: [], estilos: [], linhas: [], trocar: [] };
    const naLinhaDoCursor = pos => linhasDoCursor.has(state.doc.lineAt(pos).number);
    // por linha: Decoration.replace vinda de plugin não pode cobrir quebra de linha
    const esconder = (a, b) => {
      for (let p = a; p < b;) {
        const l = state.doc.lineAt(p), fim = Math.min(b, l.to);
        if (fim > p && !linhasDoCursor.has(l.number)) r.esconder.push([p, fim]);
        p = l.to + 1;
      }
    };
    const excluir = [];   // código e endereços: marcações do Kiro não valem dentro deles
    const linhasDe = (a, b, classe) => { for (let p = a; p <= b;) { const l = state.doc.lineAt(p); r.linhas.push([l.from, classe]); p = l.to + 1; } };
    (arvore ?? CM().language.syntaxTree(state)).iterate({
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
        // URL solta (https://…, www.…, a@b.c): o GFM a deixa como nó de primeiro nível
        if (nome === 'URL') { r.estilos.push([no.from, no.to, 'ed-sem-corretor']); excluir.push([no.from, no.to]); return false; }
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

  // Texto do CodeMirror a partir de uma string com qualquer final de linha: o doc guarda as linhas
  // e o lineSeparator decide o que sai; assim um \n inserido numa nota \r\n vira \r\n.
  const textoDe = s => CM().state.Text.of(s.split(/\r\n|\r|\n/));

  // Recarga vinda de fora (o cofre): não entra no desfazer e não volta por aoMudar.
  let externo = null;
  const marcaExterna = () => (externo ??= CM().state.Annotation.define());
  const veioDeFora = tr => tr.annotation(marcaExterna()) === true;
  function transacaoDeTexto(state, novo) {
    const texto = textoDe(novo);
    return {
      changes: { from: 0, to: state.doc.length, insert: texto },
      selection: { anchor: Math.min(state.selection.main.head, texto.length) },
      annotations: [CM().state.Transaction.addToHistory.of(false), marcaExterna().of(true)],
    };
  }

  // Troca externa do texto: o histórico antigo não se aplica ao texto novo (desfazer reinseriria
  // trechos apagados no texto velho). Em duas transações, a segunda recria o histórico vazio.
  function especsDeTroca(state, novo, historico, ativarHistorico) {
    return [
      { ...transacaoDeTexto(state, novo), effects: historico.reconfigure([]) },
      { effects: historico.reconfigure(ativarHistorico()) },
    ];
  }

  // Adaptador: o que os menus e atalhos do app esperam de um textarea, sobre o estado do editor.
  // value é o doc com \n (como um textarea normaliza), porque as posições do CodeMirror contam
  // cada quebra como 1 caractere mesmo com lineSeparator '\r\n'; assim value e os índices batem
  // e envolver/prefixar continuam iguais. O texto que vai para o cofre sai de sliceDoc().
  function criarArea({ estado, aplicar, focar, posicao }) {
    return {
      get value() { return estado().doc.toString(); },
      get selectionStart() { return estado().selection.main.from; },
      get selectionEnd() { return estado().selection.main.to; },
      setSelectionRange(a, b = a) { aplicar({ selection: { anchor: a, head: b } }); },
      focus() { focar(); },
      inserir(texto) {
        const { from, to } = estado().selection.main;
        const novo = textoDe(texto);
        aplicar({ changes: { from, to, insert: novo }, selection: { anchor: from + novo.length }, userEvent: 'input' });
      },
      posicao: () => (posicao ? posicao() : null),
    };
  }

  let carregando = null;
  function carregar() {
    if (root.CM) return Promise.resolve();
    carregando ??= new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'vendor/codemirror/codemirror.js';
      const erro = () => { carregando = null; s.remove(); falha(new Error('Não foi possível carregar o editor')); };
      s.onload = () => (root.CM ? ok() : erro());
      s.onerror = erro;
      document.head.appendChild(s);
    });
    return carregando;
  }

  function montar(elemento, { texto, aoMudar, existe, aoTeclar, aoMoverCursor, aoColar, aoMenu, ortografia }) {
    const { state: S, view: V, commands: C, language: L, markdown: M } = CM();
    const decorar = view => {
      const linhas = linhasDaSelecao(view.state), marcas = [];
      for (const { from, to } of view.visibleRanges) {
        const arvore = L.ensureSyntaxTree(view.state, to, 50) ?? L.syntaxTree(view.state);
        const r = analisar(view.state, from, to, linhas, { existe, arvore });
        for (const [a, classe] of r.linhas) marcas.push(V.Decoration.line({ class: classe }).range(a));
        for (const [a, b, classe] of r.estilos) if (b > a && classe !== 'ed-sem-corretor') marcas.push(V.Decoration.mark({ class: classe }).range(a, b));   // ed-sem-corretor só vale como lista de exclusão
        for (const [a, b] of r.esconder) marcas.push(V.Decoration.replace({}).range(a, b));
        for (const [a, b, s] of r.trocar) marcas.push(V.Decoration.replace({ widget: new Marcador(s) }).range(a, b));
      }
      return V.Decoration.set(marcas, true);
    };
    class Marcador extends V.WidgetType {
      constructor(s) { super(); this.s = s; }
      eq(o) { return o.s === this.s; }
      toDOM() { const e = document.createElement('span'); e.className = 'ed-marcador'; e.textContent = this.s; return e; }
    }
    const aoVivo = V.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = decorar(view); }
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || L.syntaxTree(u.startState) !== L.syntaxTree(u.state)) this.decorations = decorar(u.view); }
    }, { decorations: v => v.decorations });
    // Corretor próprio: sublinha as palavras que ortografia.errada reprova, só nas linhas visíveis.
    // Sem `ortografia` fica inativo. Em docChanged refaz só as linhas tocadas; o resto é mapeado.
    let ortografiaAtiva = Boolean(ortografia?.ativa) && typeof ortografia?.errada === 'function';
    const redesenhar = S.StateEffect.define();
    const erroDeOrtografia = V.Decoration.mark({ class: 'ed-erro' });
    // trechos de uma linha onde o corretor não olha (código, endereço, alvo de [[link]], etiqueta)
    const ignoradosDaLinha = (view, l, arvore) => analisar(view.state, l.from, l.to, new Set(), { arvore }).estilos
      .filter(e => e[2] === 'ed-sem-corretor').map(e => [e[0] - l.from, e[1] - l.from]);
    const errosDasLinhas = (view, de, ate, marcas) => {
      const doc = view.state.doc;
      const arvore = L.ensureSyntaxTree(view.state, ate, 50) ?? L.syntaxTree(view.state);
      for (let p = doc.lineAt(de).from; p <= ate;) {
        const l = doc.lineAt(p);
        const ignorar = ignoradosDaLinha(view, l, arvore);
        for (const w of palavrasDaLinha(l.text, ignorar)) if (ortografia.errada(w.palavra)) marcas.push(erroDeOrtografia.range(l.from + w.de, l.from + w.ate));
        p = l.to + 1;
      }
    };
    const todosOsErros = view => {
      const marcas = [];
      if (ortografiaAtiva) for (const { from, to } of view.visibleRanges) errosDasLinhas(view, from, to, marcas);
      return V.Decoration.set(marcas, true);
    };
    const ortografiaPlugin = V.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = todosOsErros(view); }
      update(u) {
        if (u.viewportChanged || u.transactions.some(tr => tr.effects.some(e => e.is(redesenhar)))) { this.decorations = todosOsErros(u.view); return; }
        if (!u.docChanged || !ortografiaAtiva) return;
        let decos = this.decorations.map(u.changes);
        const novas = [], tocadas = new Map();   // início da linha → fim, uma vez por linha
        u.changes.iterChangedRanges((_a, _b, de, ate) => {
          const doc = u.state.doc;
          for (let l = doc.lineAt(de); ; l = doc.line(l.number + 1)) { tocadas.set(l.from, l.to); if (l.to >= ate) break; }
        });
        for (const [ini, fim] of tocadas) {
          decos = decos.update({ filterFrom: ini, filterTo: fim, filter: () => false });
          errosDasLinhas(u.view, ini, fim, novas);
        }
        this.decorations = decos.update({ add: novas, sort: true });
      }
    }, { decorations: v => v.decorations });
    const historico = new S.Compartment();
    const view = new V.EditorView({
      parent: elemento,
      state: S.EditorState.create({
        doc: texto,
        extensions: [
          S.EditorState.lineSeparator.of(separadorDeLinha(texto)),
          historico.of(C.history()),
          S.Prec.highest(V.EditorView.domEventHandlers({
            keydown: e => Boolean(aoTeclar?.(e)),
            paste: e => Boolean(aoColar?.(e)),
            drop: e => Boolean(aoColar?.(e)),
            contextmenu: e => { aoMenu?.(e); return false; },
          })),
          V.keymap.of([
            { key: 'Escape', run: v => { v.contentDOM.blur(); return true; } },
            ...M.markdownKeymap, C.indentWithTab, ...C.historyKeymap, ...C.defaultKeymap,
          ]),
          M.markdown({ base: M.markdownLanguage }),
          V.EditorView.lineWrapping,
          V.placeholder(t('Clique para escrever. [[Nome da nota]] conecta ideias e #tag marca a nota.')),
          V.EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': t('Conteúdo da nota') }),
          aoVivo,
          ortografiaPlugin,
          V.EditorView.updateListener.of(u => {
            if (u.docChanged && !u.transactions.some(veioDeFora)) aoMudar?.(u.state.sliceDoc());
            if (u.docChanged || u.selectionSet) aoMoverCursor?.();
          }),
        ],
      }),
    });
    const aplicar = spec => view.dispatch(spec);
    const posicao = () => { const c = view.coordsAtPos(view.state.selection.main.head); return c ? { left: c.left, top: c.top, altura: c.bottom - c.top } : null; };
    const limitar = pos => Math.min(Math.max(pos, 0), view.state.doc.length);
    const area = criarArea({ estado: () => view.state, aplicar, focar: () => view.focus(), posicao });
    return {
      dom: view.dom,
      texto: () => view.state.sliceDoc(),
      definirTexto(novo) {
        if (novo === view.state.sliceDoc()) return;
        for (const spec of especsDeTroca(view.state, novo, historico, C.history)) view.dispatch(spec);
      },
      area: () => area,
      focar(onde) {
        const pos = onde === 'inicio' ? 0 : onde === 'fim' ? view.state.doc.length : typeof onde === 'number' ? limitar(onde) : null;
        if (pos !== null) view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      },
      temFoco: () => view.hasFocus,
      rolarPara(pos) { view.dispatch({ effects: V.EditorView.scrollIntoView(limitar(pos), { y: 'start' }) }); },
      definirOrtografia(ativa) { ortografiaAtiva = Boolean(ativa) && typeof ortografia?.errada === 'function'; view.dispatch({ effects: redesenhar.of(null) }); },
      redesenharOrtografia() { view.dispatch({ effects: redesenhar.of(null) }); },
      palavraEm(x, y) {
        const pos = view.posAtCoords({ x, y });
        if (pos == null) return null;
        const l = view.state.doc.lineAt(pos), rel = pos - l.from;
        const w = palavrasDaLinha(l.text, ignoradosDaLinha(view, l)).find(p => p.de <= rel && rel <= p.ate);
        if (!w) return null;
        // posAtCoords devolve a posição mais próxima: só vale se o clique cai sobre a palavra
        const a = view.coordsAtPos(l.from + w.de, 1), b = view.coordsAtPos(l.from + w.ate, -1);
        if (!a || !b || y < Math.min(a.top, b.top) || y > Math.max(a.bottom, b.bottom) || x < a.left || x > b.right) return null;
        return { de: l.from + w.de, ate: l.from + w.ate, palavra: w.palavra };
      },
      // só troca se o texto ainda é a palavra clicada (pode ter mudado até a escolha da sugestão)
      trocarTrecho(de, ate, texto, esperada) { if (esperada !== undefined && (ate > view.state.doc.length || view.state.sliceDoc(de, ate) !== esperada)) return false; view.dispatch({ changes: { from: de, to: ate, insert: texto }, selection: { anchor: de + texto.length }, userEvent: 'input' }); return true; },
      destruir: () => view.destroy(),
    };
  }

  const api = { separadorDeLinha, palavrasDaLinha, marcacoesDoKiro, linhasDaSelecao, analisar, criarArea, transacaoDeTexto, especsDeTroca, veioDeFora, carregar, montar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroEditor = api;
})(globalThis);
