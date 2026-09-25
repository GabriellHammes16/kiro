// Editor do Fluxo: desenha um canvas JSON Canvas e traduz ponteiro e teclado em operações do
// KiroFluxo. Não conhece o cofre: recebe o canvas e entrega o novo por `aoMudar`. O que é de
// tela (vista, seleção, desfazer) vive numa sessão por fluxo, que sobrevive aos redesenhos do
// app (cada salvamento redesenha a tela inteira).
(function (root) {
  const F = root.KiroFluxo;
  const sessoes = new Map();       // id do fluxo → { vista, selecao, seta, historico, grade }
  const montados = new Set();
  let contador = 0;                // ids únicos de <marker> quando dois fluxos estão abertos
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Cor predefinida vira atributo (o CSS dá o tom de cada tema); hex vira variável CSS.
  // `ler` já recusou qualquer outra coisa, mas a checagem fica aqui também: é onde vira style.
  const corData = cor => (F.CORES.includes(cor) ? ` data-fluxo-cor="${cor}"` : '');
  const corCss = cor => (/^#[0-9a-f]{6}$/i.test(cor || '') ? `--fluxo-cor:${cor};` : '');
  function sessao(id) {
    if (!sessoes.has(id)) sessoes.set(id, { vista: null, selecao: new Set(), seta: null, historico: F.historicoVazio(), grade: true });
    return sessoes.get(id);
  }
  function lerVistas(chave) { try { return JSON.parse(localStorage.getItem(chave)) || {}; } catch { return {}; } }
  function gravarVista(chave, id, vista) {
    try { const todas = lerVistas(chave); todas[id] = vista; localStorage.setItem(chave, JSON.stringify(todas)); } catch { /* janela privada: vale só nesta sessão */ }
  }

  function montar(host, opcoes) {
    const { id } = opcoes, s = sessao(id), n = ++contador;
    let canvas = opcoes.canvas, gesto = null, editor = null, espaco = false, timerVista = null;
    host.innerHTML = `<div class="fluxo" tabindex="0" role="application" aria-label="Fluxo ${esc(opcoes.titulo)}">
  <div class="fluxo-mundo">
    <svg class="fluxo-setas" aria-hidden="true"><defs><marker id="fluxo-ponta-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs><g class="fluxo-caminhos"></g><path class="fluxo-seta-previa" d=""/></svg>
    <div class="fluxo-cartoes"></div>
    <div class="fluxo-marca" hidden></div>
  </div>
  <div class="fluxo-barra"><button type="button" class="icon-button" data-fluxo-acao="cartao" title="Adicionar cartão (ou dois cliques no fundo)" aria-label="Adicionar cartão">${opcoes.icone('mais')}</button><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="Enquadrar tudo (Shift+1)">100%</button></div>
</div>`;
    const raiz = host.firstElementChild;
    const mundo = raiz.querySelector('.fluxo-mundo'), caminhos = raiz.querySelector('.fluxo-caminhos'), cartoes = raiz.querySelector('.fluxo-cartoes');
    const previa = raiz.querySelector('.fluxo-seta-previa'), marca = raiz.querySelector('.fluxo-marca'), rotuloZoom = raiz.querySelector('.fluxo-zoom');
    const ponta = `url(#fluxo-ponta-${n})`;
    const no = idNo => canvas.nodes.find(x => x.id === idNo);
    const elDoCartao = idNo => cartoes.querySelector(`[data-no="${CSS.escape(idNo)}"]`);
    const tamanho = () => { const r = raiz.getBoundingClientRect(); return [r.width, r.height]; };
    const pontoDaTela = e => { const r = raiz.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pontoDoCanvas = e => { const p = pontoDaTela(e); return F.paraCanvas(s.vista, p.x, p.y); };

    // ---- Desenho ----
    function conteudo(c) {
      if (c.type === 'text') return opcoes.markdown(c.text);
      if (c.type === 'file') return `<p class="fluxo-arquivo">${esc(c.file)}</p>`;
      if (c.type === 'link') return `<p class="fluxo-link">${esc(c.url)}</p>`;
      return '';
    }
    function cartaoHtml(c) {
      const alcas = F.LADOS.map(l => `<span class="fluxo-alca" data-lado="${l}"></span>`).join('') + '<span class="fluxo-canto" title="Arraste para redimensionar"></span>';
      const rotulo = c.type === 'group' ? `<span class="fluxo-grupo-rotulo">${esc(c.label)}</span>` : '';
      return `<div class="fluxo-cartao${s.selecao.has(c.id) ? ' selecionado' : ''}" data-no="${esc(c.id)}" data-tipo="${esc(c.type)}"${corData(c.color)} style="${corCss(c.color)}left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px">${rotulo}<div class="fluxo-conteudo">${conteudo(c)}</div>${alcas}</div>`;
    }
    function setaHtml(e, nodes) {
      const g = F.geometriaDaSeta(nodes, e);
      if (!g) return '';
      const fim = (e.toEnd ?? 'arrow') === 'arrow' ? ` marker-end="${ponta}"` : '';
      const inicio = e.fromEnd === 'arrow' ? ` marker-start="${ponta}"` : '';
      const rotulo = e.label ? `<text class="fluxo-seta-rotulo" x="${g.meio.x}" y="${g.meio.y}" text-anchor="middle" dominant-baseline="middle">${esc(e.label)}</text>` : '';
      return `<g class="fluxo-seta${s.seta === e.id ? ' selecionada' : ''}" data-seta="${esc(e.id)}"${corData(e.color)} style="${corCss(e.color)}"><path class="fluxo-seta-alvo" d="${g.d}"/><path class="fluxo-seta-linha" d="${g.d}"${fim}${inicio}/>${rotulo}</g>`;
    }
    const desenharSetas = (c = canvas) => { caminhos.innerHTML = c.edges.map(e => setaHtml(e, c.nodes)).join(''); };
    function desenhar() {
      // Seleção que aponta para algo que sumiu (desfazer, outra coluna) é descartada.
      for (const sel of s.selecao) if (!no(sel)) s.selecao.delete(sel);
      if (s.seta && !canvas.edges.some(e => e.id === s.seta)) s.seta = null;
      // Grupos primeiro: ficam atrás dos cartões.
      const ordem = c => (c.type === 'group' ? 0 : 1);
      cartoes.innerHTML = [...canvas.nodes].sort((a, b) => ordem(a) - ordem(b)).map(cartaoHtml).join('');
      desenharSetas();
    }

    // ---- Vista ----
    function aplicarVista() {
      const { x, y, zoom } = s.vista;
      mundo.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
      raiz.style.backgroundSize = `${F.GRADE * zoom}px ${F.GRADE * zoom}px`;
      raiz.style.backgroundPosition = `${x}px ${y}px`;
      raiz.style.setProperty('--zoom', zoom);
      rotuloZoom.textContent = `${Math.round(zoom * 100)}%`;
    }
    function guardarVista() { clearTimeout(timerVista); timerVista = setTimeout(() => { timerVista = null; gravarVista(opcoes.chaveDaVista, id, s.vista); }, 300); }
    function enquadrarTudo() { s.vista = F.enquadrar(canvas.nodes, ...tamanho()); aplicarVista(); guardarVista(); }
    if (!s.vista) {
      const salva = lerVistas(opcoes.chaveDaVista)[id];
      s.vista = F.vistaValida(salva) ? salva : F.enquadrar(canvas.nodes, ...tamanho());
    }

    // ---- Mudanças ----
    function mudar(novo) {
      if (novo === canvas) return;
      s.historico = F.empilhar(s.historico, canvas);
      canvas = novo;
      desenhar();
      opcoes.aoMudar(canvas);
    }
    const encaixar = v => (s.grade ? F.encaixar(v) : Math.round(v));
    const encaixarPraCima = v => (s.grade ? Math.ceil(v / F.GRADE) * F.GRADE : Math.ceil(v));
    function marcarSelecao() {
      for (const el of cartoes.children) el.classList.toggle('selecionado', s.selecao.has(el.dataset.no));
      for (const el of caminhos.children) el.classList.toggle('selecionada', s.seta === el.dataset.seta);
    }
    function selecionar(ids) { s.selecao = new Set(ids); s.seta = null; marcarSelecao(); }
    function criarCartao(p) {
      const r = F.adicionarCartao(canvas, { type: 'text', text: '', x: encaixar(p.x - 130), y: encaixar(p.y - 30), width: 260, height: 60 });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      editar(r.id);
      return r.id;
    }
    // Editar texto: um <textarea> no lugar do conteúdo. Ao terminar, o cartão cresce se o
    // texto renderizado não couber (nunca encolhe sozinho).
    function editar(idNo) {
      const c = no(idNo), el = elDoCartao(idNo);
      if (!c || c.type !== 'text' || !el) return;
      terminarEdicao();
      const area = document.createElement('textarea');
      area.className = 'fluxo-editor';
      area.value = c.text;
      area.setAttribute('aria-label', 'Texto do cartão');
      el.querySelector('.fluxo-conteudo').replaceChildren(area);
      el.classList.add('editando');
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null;
        const atual = no(idNo);
        if (!gravar || !atual || area.value === atual.text) return void desenhar();
        let novo = F.editarCartao(canvas, idNo, { text: area.value });
        const medida = document.createElement('div');
        medida.className = 'fluxo-conteudo fluxo-medida';
        medida.style.width = `${atual.width}px`;
        medida.innerHTML = opcoes.markdown(area.value);
        cartoes.appendChild(medida);
        const altura = Math.ceil(medida.scrollHeight) + 4;   // + a borda do cartão
        medida.remove();
        if (altura > atual.height) novo = F.redimensionar(novo, idNo, atual.width, encaixarPraCima(altura));
        mudar(novo);
      };
      editor = { concluir };
      area.addEventListener('keydown', e => {
        e.stopPropagation();   // Delete, Ctrl+Z etc. são do texto, não do fluxo
        if (e.key === 'Escape') { e.preventDefault(); concluir(true); raiz.focus({ preventScroll: true }); }
      });
      area.addEventListener('blur', () => concluir(true));
      area.focus();
    }
    function terminarEdicao() { editor?.concluir(true); }
    function criarCartaoNoCentro() { const [w, h] = tamanho(); criarCartao(F.paraCanvas(s.vista, w / 2, h / 2)); }

    // ---- Gestos (ponteiro) ----
    // Cada gesto: { mover(g, e), soltar(g, e) }. As próximas partes do editor acrescentam os seus.
    const GESTOS = {
      pan: {
        mover(g, e) { const p = pontoDaTela(e); s.vista = { ...g.vista0, x: g.vista0.x + p.x - g.tela0.x, y: g.vista0.y + p.y - g.tela0.y }; aplicarVista(); },
        soltar() { guardarVista(); },
      },
    };
    // Um toque sem arrastar (menos de 3 px na tela) não move nada nem vira passo de desfazer.
    const andou = (g, e) => g.andou || (g.andou = Math.hypot(pontoDaTela(e).x - g.tela0.x, pontoDaTela(e).y - g.tela0.y) >= 3);
    GESTOS.mover = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e), base = no(g.ids[0]);
        // Encaixa o cartão agarrado; os outros da seleção andam o mesmo tanto.
        g.dx = encaixar(base.x + p.x - g.p0.x) - base.x;
        g.dy = encaixar(base.y + p.y - g.p0.y) - base.y;
        g.previa = F.moverCartoes(canvas, g.ids, g.dx, g.dy);
        for (const idNo of g.ids) {
          const c = g.previa.nodes.find(x => x.id === idNo), el = elDoCartao(idNo);
          if (el) { el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; }
        }
        desenharSetas(g.previa);
      },
      soltar(g) { if (g.previa && (g.dx || g.dy)) mudar(g.previa); },
    };
    GESTOS.redimensionar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e), c = no(g.id);
        g.previa = F.redimensionar(canvas, g.id, encaixar(c.width + p.x - g.p0.x), encaixar(c.height + p.y - g.p0.y));
        const novo = g.previa.nodes.find(x => x.id === g.id), el = elDoCartao(g.id);
        if (el) { el.style.width = `${novo.width}px`; el.style.height = `${novo.height}px`; }
        desenharSetas(g.previa);
      },
      soltar(g) {
        const antes = no(g.id), depois = g.previa?.nodes.find(x => x.id === g.id);
        if (depois && (depois.width !== antes.width || depois.height !== antes.height)) mudar(g.previa);
      },
    };
    GESTOS.marcar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e);
        g.ret = { x: g.p0.x, y: g.p0.y, width: p.x - g.p0.x, height: p.y - g.p0.y };
        Object.assign(marca.style, { left: `${Math.min(g.p0.x, p.x)}px`, top: `${Math.min(g.p0.y, p.y)}px`, width: `${Math.abs(g.ret.width)}px`, height: `${Math.abs(g.ret.height)}px` });
        marca.hidden = false;
      },
      soltar(g) { marca.hidden = true; if (g.ret) selecionar([...new Set([...g.base, ...F.dentro(canvas.nodes, g.ret)])]); },
    };
    function iniciar(e, g) { gesto = { ...g, tela0: pontoDaTela(e), vista0: { ...s.vista } }; raiz.setPointerCapture(e.pointerId); e.preventDefault(); }
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      if (e.button !== 0) return null;
      const p = pontoDoCanvas(e), cartao = e.target.closest('.fluxo-cartao');
      if (cartao && e.target.closest('.fluxo-canto')) { selecionar([cartao.dataset.no]); return { tipo: 'redimensionar', id: cartao.dataset.no, p0: p }; }
      if (cartao) {
        const idNo = cartao.dataset.no;
        if (e.shiftKey) { const outra = new Set(s.selecao); if (outra.has(idNo)) outra.delete(idNo); else outra.add(idNo); selecionar([...outra]); return null; }
        if (!s.selecao.has(idNo)) selecionar([idNo]);
        return { tipo: 'mover', ids: [idNo, ...[...s.selecao].filter(x => x !== idNo)], p0: p };
      }
      const base = e.shiftKey ? [...s.selecao] : [];
      if (!e.shiftKey) selecionar([]);
      return { tipo: 'marcar', p0: p, base };
    }
    raiz.addEventListener('pointerdown', e => {
      if (e.target.closest('.fluxo-barra, .fluxo-editor')) return;
      raiz.focus({ preventScroll: true });
      const g = escolherGesto(e);
      if (g) iniciar(e, g);
    });
    raiz.addEventListener('pointermove', e => { if (gesto) GESTOS[gesto.tipo].mover(gesto, e); });
    raiz.addEventListener('pointerup', e => { if (!gesto) return; const g = gesto; gesto = null; GESTOS[g.tipo].soltar(g, e); });
    raiz.addEventListener('pointercancel', () => { gesto = null; previa.classList.remove('ativa'); marca.hidden = true; desenhar(); aplicarVista(); });
    // Roda: rola (Shift = na horizontal); Ctrl+roda: zoom no cursor. Conteúdo longo de um
    // cartão rola dentro dele.
    raiz.addEventListener('wheel', e => {
      if (e.target.closest('.fluxo-editor')) return;
      const caixa = !e.ctrlKey && e.target.closest('.fluxo-conteudo');
      if (caixa && caixa.scrollHeight > caixa.clientHeight) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const p = pontoDaTela(e); s.vista = F.zoomEm(s.vista, Math.exp(-e.deltaY * 0.002), p.x, p.y); }
      else { const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY; s.vista = { ...s.vista, x: s.vista.x - dx, y: s.vista.y - dy }; }
      aplicarVista(); guardarVista();
    }, { passive: false });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if (e.key === ' ') { e.preventDefault(); espaco = true; raiz.classList.add('pan'); }
      else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); enquadrarTudo(); }
    });
    raiz.addEventListener('keyup', e => { if (e.key === ' ') { espaco = false; raiz.classList.remove('pan'); } });
    raiz.addEventListener('dblclick', e => {
      if (e.target.closest('.fluxo-barra, .fluxo-editor, .fluxo-seta')) return;
      const cartao = e.target.closest('.fluxo-cartao');
      if (cartao) editar(cartao.dataset.no);
      else criarCartao(pontoDoCanvas(e));
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selecao.size) { e.preventDefault(); e.stopPropagation(); mudar(F.removerCartoes(canvas, [...s.selecao])); }
      else if (e.key === 'Enter' && s.selecao.size === 1) { e.preventDefault(); editar([...s.selecao][0]); }
      else if (e.key === 'Escape') selecionar([]);
    });
    raiz.addEventListener('click', e => { if (e.target.closest('.fluxo-conteudo a')) e.preventDefault(); });
    raiz.querySelector('.fluxo-barra').addEventListener('click', e => {
      const acao = e.target.closest('[data-fluxo-acao]')?.dataset.fluxoAcao;
      if (acao === 'enquadrar') enquadrarTudo();
      if (acao === 'cartao') criarCartaoNoCentro();
    });

    function desmontar() {
      if (!montados.has(inst)) return;
      terminarEdicao();
      montados.delete(inst);
      if (timerVista) { clearTimeout(timerVista); gravarVista(opcoes.chaveDaVista, id, s.vista); }
    }
    const inst = { desmontar, ocupado: () => !!gesto || !!editor };
    montados.add(inst);
    desenhar(); aplicarVista();
    return inst;
  }
  function desmontarTodos() { for (const m of [...montados]) m.desmontar(); }
  const ocupado = () => [...montados].some(m => m.ocupado());
  root.KiroFluxoTela = { montar, desmontarTodos, ocupado };
})(globalThis);
