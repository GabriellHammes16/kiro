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
  <div class="fluxo-barra"><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="Enquadrar tudo (Shift+1)">100%</button></div>
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

    // ---- Gestos (ponteiro) ----
    // Cada gesto: { mover(g, e), soltar(g, e) }. As próximas partes do editor acrescentam os seus.
    const GESTOS = {
      pan: {
        mover(g, e) { const p = pontoDaTela(e); s.vista = { ...g.vista0, x: g.vista0.x + p.x - g.tela0.x, y: g.vista0.y + p.y - g.tela0.y }; aplicarVista(); },
        soltar() { guardarVista(); },
      },
    };
    function iniciar(e, g) { gesto = { ...g, tela0: pontoDaTela(e), vista0: { ...s.vista } }; raiz.setPointerCapture(e.pointerId); e.preventDefault(); }
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      return null;
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
    raiz.addEventListener('click', e => { if (e.target.closest('.fluxo-conteudo a')) e.preventDefault(); });
    raiz.querySelector('.fluxo-barra').addEventListener('click', e => {
      const acao = e.target.closest('[data-fluxo-acao]')?.dataset.fluxoAcao;
      if (acao === 'enquadrar') enquadrarTudo();
    });

    function desmontar() {
      if (!montados.has(inst)) return;
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
