// Elementos desenhados no editor (etapa 2 da visualização ao vivo): tarefa, imagem, fórmulas,
// cabeçalho do bloco de código, bloco de plug-in, callout e comentário. Esta primeira metade é pura — acha os
// elementos no texto, com a mesma regra da leitura (renderizarMarkdown) — e roda no Node.
(function (root) {
  const CM = () => root.CM;
  const IMAGEM = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
  const ehImagem = caminho => (root.Kiro?.isImagePath ? root.Kiro.isImagePath(caminho) : IMAGEM.test(String(caminho).trim()));
  const PDF = /\.pdf$/i;
  const ehPdf = caminho => (root.Kiro?.isPdfPath ? root.Kiro.isPdfPath(caminho) : PDF.test(String(caminho || '').split('#')[0].trim()));
  function lerPdf(dentro) {
    if (root.Kiro?.lerPdf) return root.Kiro.lerPdf(dentro);
    const partes = String(dentro || '').split('|').map(s => s.trim());
    const primeiro = partes[0] || '';
    const hash = primeiro.indexOf('#');
    const arquivo = (hash >= 0 ? primeiro.slice(0, hash) : primeiro).trim();
    if (!ehPdf(arquivo) || /[:\\]|\.\./.test(arquivo)) return null;
    const frag = hash >= 0 ? primeiro.slice(hash + 1) : '';
    const mPag = /^page=(\d+)$/i.exec(frag.trim());
    const pagina = mPag ? Math.max(1, Number(mPag[1])) : null;
    let altura = null;
    for (const p of partes.slice(1)) if (/^\d{2,4}$/.test(p)) { const n = Number(p); if (n >= 120 && n <= 2000) altura = n; }
    return { arquivo, pagina, altura };
  }
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
  const CITACAO_DE_TAREFA = /(?<!!)\[\[tarefa:([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/gi;

  function acharElementos(state, de, ate, { arvore, soBlocos, blocos: dados } = {}) {
    const doc = state.doc, els = [], codigo = [];
    const tree = arvore || CM().language.syntaxTree(state);
    tree.iterate({
      from: de, to: ate,
      enter: no => {
        if (!soBlocos && no.name === 'TaskMarker') {
          const marca = state.sliceDoc(no.from, no.to);
          els.push({ tipo: 'tarefa', de: no.from, ate: no.to, feito: /x/i.test(marca[1] || '') });
        }
        if (no.name === 'InlineCode') codigo.push([no.from, no.to]);
        if (no.name === 'FencedCode') {
          codigo.push([no.from, no.to]);
          const primeira = doc.lineAt(no.from), ultima = doc.lineAt(no.to);
          const ci = no.node.getChild('CodeInfo'), info = ci ? state.sliceDoc(ci.from, ci.to).trim() : '';
          const plugin = /^kiro:([a-z0-9][a-z0-9-]{1,39})$/.exec(info);
          const fechada = no.node.getChildren('CodeMark').length > 1;
          // Mesma regra da leitura: cerca no início da linha, fechada, id válido.
          if (plugin) {
            if (fechada && primeira.from === no.from && /^```[^`]*$/.test(primeira.text)) {
              const fonte = ultima.number - primeira.number > 1 ? doc.sliceString(doc.line(primeira.number + 1).from, doc.line(ultima.number - 1).to) : '';
              els.push({ tipo: 'blocoPlugin', de: primeira.from, ate: ultima.to, id: plugin[1], fonte });
            }
          } else if (!/^kiro:/.test(info)) {
            // Tira de cada linha só os `>` das citações em volta e o recuo da cerca (item de lista).
            let citacoes = 0;
            for (let p = no.node.parent; p; p = p.parent) if (p.name === 'Blockquote') citacoes++;
            const semCitacao = t => { for (let i = 0; i < citacoes; i++) t = t.replace(/^\s*> ?/, ''); return t; };
            const recuo = new RegExp(`^ {0,${Math.max(0, semCitacao(primeira.text).search(/[`~]/))}}`);
            const corpo = [];
            for (let n = primeira.number + 1; n <= (fechada ? ultima.number - 1 : ultima.number); n++) corpo.push(semCitacao(doc.line(n).text).replace(recuo, ''));
            if (!fechada && corpo.length && corpo[corpo.length - 1] === '') corpo.pop();
            els.push({ tipo: 'cabecalhoCodigo', de: primeira.from, ate: primeira.to, linguagem: info, codigo: corpo.join('\n'), blocoDe: no.from, blocoAte: no.to });
          }
          return false;
        }
        if (!soBlocos && no.name === 'Blockquote') {
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
    // `blocos` (opção): os blocos $$ já achados na nota inteira; evita refazer a procura sem conhecer o código acima de [de, ate].
    const blocos = [];
    if (dados) for (const e of dados) { blocos.push([e.de, e.ate]); if (e.de < ate && e.ate > de) els.push(e); }
    for (let n = 1; !dados && n <= doc.lines; n++) {
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
    if (soBlocos) return els.sort((x, y) => x.de - y.de);   // só blocos (código, plug-in e $$): não se sobrepõem entre si
    const foraDeTudo = (a, b) => !emCodigo(a, b) && !blocos.some(([x, y]) => a < y && b > x);
    for (let n = doc.lineAt(de).number; n <= doc.lineAt(ate).number; n++) {
      const l = doc.line(n);
      for (const m of l.text.matchAll(IMAGEM_NA_LINHA)) {
        const a = l.from + m.index, b = a + m[0].length;
        const img = lerImagem(m[1]);
        if (img && foraDeTudo(a, b)) { els.push({ tipo: 'imagem', de: a, ate: b, ...img }); continue; }
        const pdf = lerPdf(m[1]);
        if (pdf && foraDeTudo(a, b)) els.push({ tipo: 'pdf', de: a, ate: b, ...pdf });
        else if(root.Kiro?.isAudioPath(m[1]) && !/[:\\]|\.\.|^\//.test(m[1]) && foraDeTudo(a,b)) els.push({tipo:'audio',de:a,ate:b});
      }
      // Fórmulas: mascara as imagens e o código da linha para não achar $ dentro deles.
      for (const m of l.text.matchAll(FORMULA)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b) && !els.some(e => (e.tipo === 'imagem' || e.tipo === 'pdf') && a < e.ate && b > e.de)) els.push({ tipo: 'formula', de: a, ate: b, tex: m[1] });
      }
      for (const m of l.text.matchAll(COMENTARIO)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b)) els.push({ tipo: 'comentario', de: a, ate: b });
      }
      for (const m of l.text.matchAll(CITACAO_DE_TAREFA)) {
        const a = l.from + m.index, b = a + m[0].length;
        if (foraDeTudo(a, b)) els.push({ tipo: 'citacaoTarefa', de: a, ate: b, id: m[1].trim(), titulo: (m[2] || '').trim() });
      }
    }
    els.sort((x, y) => x.de - y.de);

    // Remove overlapping elements: priority comentario > formulaBloco > imagem > formula
    // Tasks, callouts, and code headers never overlap these
    const prioridade = { comentario: 0, formulaBloco: 1, imagem: 2, pdf: 2, audio:2, formula: 3, citacaoTarefa: 3, tarefa: 4, callout: 4, cabecalhoCodigo: 4, blocoPlugin: 4 };
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

  // Ctrl+Enter: as tarefas das linhas pedidas (as do cursor ou da seleção).
  function trocasDasTarefas(state, numeros, arvore) {
    const changes = [];
    for (const n of numeros) {
      const l = state.doc.line(n);
      for (const el of acharElementos(state, l.from, l.to, { arvore, blocos: [] })) if (el.tipo === 'tarefa') changes.push(trocaDaTarefa(state, el));
    }
    return changes;
  }

  // ---- Metade do CodeMirror: desenha os elementos no editor. Em linha: ViewPlugin (só o que se vê);
  // blocos ($$ e cabeçalho de código): StateField, porque só ele pode vir com widgets de bloco. ----
  const BLOCOS = new Set(['formulaBloco', 'cabecalhoCodigo', 'blocoPlugin']);

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
          view.focus();
        });
        return i;
      }
    }
    // Tarefa citada na nota: caixinha que conclui a tarefa de verdade, título que abre a tarefa e a data.
    // Os dados vêm do app (opcoes.tarefa); tarefa apagada mostra o título guardado na citação, riscado.
    class CitacaoDeTarefa extends V.WidgetType {
      constructor(id, titulo, info) { super(); this.id = id; this.titulo = titulo; this.info = info; }
      eq(o) { return o.id === this.id && o.titulo === this.titulo && JSON.stringify(o.info) === JSON.stringify(this.info); }
      toDOM() {
        const s = document.createElement('span'), info = this.info;
        s.className = 'tarefa-citada' + (info?.feita ? ' feita' : '') + (info ? '' : ' ausente');
        if (info) {
          const c = document.createElement('input');
          c.type = 'checkbox'; c.className = 'ed-caixa'; c.checked = info.feita; c.setAttribute('aria-label', info.feita ? t('Marcar como não concluído') : t('Marcar como concluído'));
          c.addEventListener('click', e => e.preventDefault());
          c.addEventListener('mousedown', e => { e.preventDefault(); opcoes.alternarTarefa?.(this.id); });
          s.append(c);
        }
        const nome = document.createElement('span');
        nome.className = 'tarefa-citada-titulo'; nome.textContent = info?.titulo || this.titulo || t('Tarefa apagada');
        if (info) { nome.title = t('Abrir tarefa'); nome.addEventListener('mousedown', e => { e.preventDefault(); opcoes.abrirTarefa?.(this.id); }); }
        s.append(nome);
        if (info?.data) { const d = document.createElement('small'); d.className = 'tarefa-citada-data' + (info.atrasada ? ' atrasada' : ''); d.textContent = info.data; s.append(d); }
        return s;
      }
      ignoreEvent() { return true; }
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
    class PdfEmbutido extends V.WidgetType {
      constructor(texto) { super(); this.texto = texto; this.pdf = lerPdf(texto); }
      eq(o) { return o.texto === this.texto; }
      toDOM() {
        const s = document.createElement('span');
        const html = opcoes.desenharPdf?.(this.texto);
        if (!html) { s.textContent = `![[${this.texto}]]`; return s; }
        s.innerHTML = html;
        return s;
      }
      ignoreEvent() { return true; }
    }
    class AudioEmbutido extends V.WidgetType {
      constructor(texto){super();this.texto=texto;}
      eq(o){return o.texto===this.texto;}
      toDOM(){const s=document.createElement('span');s.innerHTML=opcoes.desenharAudio?.(this.texto)||'';return s;}
      ignoreEvent(){return true;}
    }
    class Formula extends V.WidgetType {
      constructor(tex, bloco) { super(); this.tex = tex; this.bloco = bloco; }
      eq(o) { return o.tex === this.tex && o.bloco === this.bloco; }
      get estimatedHeight() { return this.bloco ? 48 : -1; }
      toDOM() {
        const e = document.createElement(this.bloco ? 'div' : 'span');
        if (this.bloco) e.className = 'math-bloco';
        if (opcoes.desenharFormula) e.innerHTML = htmlDaFormula(this.tex, this.bloco); else e.textContent = this.tex;
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
      get estimatedHeight() { return 34; }
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

    class BlocoDePlugin extends V.WidgetType {
      constructor(id, fonte) { super(); this.id = id; this.fonte = fonte; }
      eq(o) { return o.id === this.id && o.fonte === this.fonte; }   // digitar em outro lugar não recria o desenho (nem a moldura)
      get estimatedHeight() { return 120; }
      toDOM(view) {
        const e = document.createElement('div');
        e.className = 'ed-plugin';
        e.innerHTML = opcoes.desenharBlocoPlugin ? opcoes.desenharBlocoPlugin(this.id, this.fonte) : '';
        e.addEventListener('mousedown', ev => {
          if (ev.button !== 0 || ev.target.closest('a, button, input, select, textarea, iframe')) return;
          ev.preventDefault();   // clicar no desenho mostra a fonte: cursor no início do bloco
          view.dispatch({ selection: { anchor: view.posAtDOM(e) } });
          view.focus();
        });
        // Link desenhado por plug-in nunca navega a janela: http(s) abre fora; o resto não faz nada.
        e.addEventListener('click', ev => {
          const a = ev.target.closest('a');
          if (!a) return;
          ev.preventDefault();
          const destino = a.getAttribute('href') || '';
          if (/^https?:\/\//i.test(destino)) opcoes.abrirSite?.(destino);
        });
        // O plug-in desenha depois (e a moldura muda de altura): o editor mede de novo.
        e._observador = new ResizeObserver(() => view.requestMeasure());
        e._observador.observe(e);
        return e;
      }
      destroy(dom) { dom._observador?.disconnect(); }
      ignoreEvent() { return true; }   // os cliques são tratados acima ou são do plug-in
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
      const formulas = state.field(campoDosBlocos).els.filter(e => e.tipo === 'formulaBloco');
      for (const { from, to } of view.visibleRanges) {
        for (const el of acharElementos(state, from, to, { arvore: arvoreAte(state, to), blocos: formulas })) {
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
          else if (el.tipo === 'pdf') cobre(el.de, el.ate, V.Decoration.replace({ widget: new PdfEmbutido(doc.sliceString(el.de + 3, el.ate - 2)) }));
          else if (el.tipo === 'audio') cobre(el.de, el.ate, V.Decoration.replace({ widget: new AudioEmbutido(doc.sliceString(el.de + 3, el.ate - 2)) }));
          else if (el.tipo === 'formula') cobre(el.de, el.ate, V.Decoration.replace({ widget: new Formula(el.tex, false) }));
          else if (el.tipo === 'callout') cobre(el.de, el.ate, V.Decoration.replace({ widget: new RotuloDoCallout(el.nome) }));
          else if (el.tipo === 'citacaoTarefa') cobre(el.de, el.ate, V.Decoration.replace({ widget: new CitacaoDeTarefa(el.id, el.titulo, opcoes.tarefa?.(el.id) ?? null) }));
        }
      }
      const r = { chave, decos: V.Decoration.set(decos, true), faixas };
      memoria.set(state, r);
      return r;
    }
    const pluginEmLinha = V.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = emLinha(view).decos; }
      // Efeito sem mudança de texto (editor.redesenhar) também refaz: a tarefa citada pode ter mudado fora do editor.
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.some(tr => tr.effects.length) || L.syntaxTree(u.startState) !== L.syntaxTree(u.state)) this.decorations = emLinha(u.view).decos; }
    }, { decorations: v => v.decorations });

    // Blocos: o documento inteiro (são poucos); só refaz a procura quando o texto ou a árvore mudam.
    const desenharBlocos = (state, els) => {
      const linhas = linhasDaSelecao(state), doc = state.doc, decos = [], faixas = [];
      for (const el of els) {
        const ini = doc.lineAt(el.blocoDe ?? el.de).number, fim = doc.lineAt(el.blocoAte ?? el.ate).number;   // código: o bloco todo
        let tocada = false;
        for (let n = ini; n <= fim; n++) if (linhas.has(n)) tocada = true;
        if (tocada) continue;
        const widget = el.tipo === 'formulaBloco' ? new Formula(el.tex, true)
          : el.tipo === 'blocoPlugin' ? new BlocoDePlugin(el.id, el.fonte)
          : new CabecalhoDoCodigo(el.linguagem, el.codigo);
        decos.push(V.Decoration.replace({ widget, block: true }).range(el.de, el.ate));
        faixas.push([el.de, el.ate]);
      }
      return { els, faixas, decos: V.Decoration.set(decos, true) };
    };
    const procurarBlocos = state => acharElementos(state, 0, state.doc.length, { arvore: arvoreAte(state, state.doc.length), soBlocos: true });
    const campoDosBlocos = S.StateField.define({
      create: state => desenharBlocos(state, procurarBlocos(state)),
      update(v, tr) {
        if (tr.docChanged || L.syntaxTree(tr.startState) !== L.syntaxTree(tr.state)) return desenharBlocos(tr.state, procurarBlocos(tr.state));
        return tr.selection ? desenharBlocos(tr.state, v.els) : v;
      },
      provide: f => V.EditorView.decorations.from(f, v => v.decos),
    });

    // Cliques em links fora da linha do cursor; com Ctrl/Cmd, em qualquer linha.
    const cliques = V.EditorView.domEventHandlers({
      mousedown(e, view) {
        const comMod = e.ctrlKey || e.metaKey;   // Ctrl+clique abre o link mesmo na linha do cursor
        if (e.button !== 0 || e.shiftKey || e.altKey) return false;
        const alvo = e.target.closest?.('.ed-wikilink, .ed-wikilink-ausente, .ed-link, .ed-etiqueta');
        if (!alvo) return false;
        const pos = view.posAtDOM(alvo), linha = view.state.doc.lineAt(pos);
        if (!comMod && linhasDaSelecao(view.state).has(linha.number)) return false;
        if (alvo.matches('.ed-etiqueta')) { const rel = pos - linha.from, m = root.KiroEditor.marcacoesDoKiro(linha.text).find(x => x.tipo === 'etiqueta' && x.de <= rel && rel < x.ate); if (m) opcoes.buscarEtiqueta?.(linha.text.slice(m.de, m.ate)); e.preventDefault(); return true; }
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
        e.preventDefault(); opcoes.abrirNota?.(m.alvo.trim());
        return true;
      },
    });

    // Ctrl+Enter (Cmd+Enter): marca/desmarca as tarefas das linhas do cursor ou da seleção, como no Obsidian.
    const teclas = S.Prec.high(V.keymap.of([{
      key: 'Mod-Enter',
      run: view => {
        const changes = trocasDasTarefas(view.state, [...linhasDaSelecao(view.state)]);
        if (!changes.length) return false;
        view.dispatch({ changes, userEvent: 'input' });
        return true;
      },
    }]));

    const ext = [campoDosBlocos, pluginEmLinha, cliques, teclas];
    // faixas cobertas por widgets, para a etapa 1 não esconder nada dentro delas
    ext.ocupadas = view => [...emLinha(view).faixas, ...view.state.field(campoDosBlocos).faixas];
    return ext;
  }

  const api = { extensao, acharElementos, trocaDaTarefa, trocaDaLargura, trocasDasTarefas, ehImagem, lerImagem, ehPdf, lerPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroWidgets = api;
})(globalThis);
