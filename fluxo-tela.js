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
    // A sessão é por cofre: um `.canvas` sem id do Kiro ganha `fluxo-${hash(caminho)}`, igual em
    // qualquer cofre, então sem a chave do cofre o Ctrl+Z (e a vista) de um vazariam para o outro.
    const { id } = opcoes, s = sessao(opcoes.chaveDaVista + '\n' + id), n = ++contador;
    let canvas = opcoes.canvas, gesto = null, editor = null, espaco = false, timerVista = null;
    host.innerHTML = `<div class="fluxo" tabindex="0" role="application" aria-label="Fluxo ${esc(opcoes.titulo)}">
  <div class="fluxo-mundo">
    <svg class="fluxo-setas" aria-hidden="true"><defs><marker id="fluxo-ponta-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs><g class="fluxo-caminhos"></g><path class="fluxo-seta-previa" d=""/></svg>
    <div class="fluxo-cartoes"></div>
    <div class="fluxo-marca" hidden></div>
  </div>
  <div class="fluxo-barra"><button type="button" class="icon-button" data-fluxo-acao="cartao" title="Adicionar cartão (ou dois cliques no fundo)" aria-label="Adicionar cartão">${opcoes.icone('mais')}</button><button type="button" class="icon-button" data-fluxo-acao="nota" title="Adicionar nota do cofre" aria-label="Adicionar nota do cofre">${opcoes.icone('nota')}</button><button type="button" class="icon-button" data-fluxo-acao="imagem" title="Adicionar imagem" aria-label="Adicionar imagem">${opcoes.icone('imagem')}</button><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="Enquadrar tudo (Shift+1)" aria-label="Enquadrar tudo">100%</button></div>
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
      if (c.type === 'file') {
        if (F.ehImagem(c.file)) {
          // Só caminho relativo ao cofre vira <img>: um .canvas de fora não aponta para ../ nem para o disco.
          if (!F.caminhoSeguro(c.file)) return `<p class="fluxo-arquivo">${esc(c.file)}</p>`;
          return `<img class="fluxo-imagem" src="${esc(opcoes.urlDoArquivo(c.file))}" alt="${esc(c.file.split('/').pop())}" draggable="false">`;
        }
        const nota = opcoes.nota(c.file);
        if (!nota) return `<p class="fluxo-ausente">Nota não encontrada<br><small>${esc(c.file)}</small></p>`;
        return `<div class="fluxo-nota-titulo">${esc(nota.titulo)}</div><div class="fluxo-nota-previa">${nota.html}</div>`;
      }
      if (c.type === 'link') {
        const titulo = c.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
        return `<p class="fluxo-link-titulo">${esc(titulo)}</p><p class="fluxo-link">${esc(c.url)}</p>`;
      }
      return '';
    }
    function cartaoHtml(c) {
      const alcas = F.LADOS.map(l => `<span class="fluxo-alca" data-lado="${l}"></span>`).join('') + '<span class="fluxo-canto" title="Arraste para redimensionar"></span>';
      const rotulo = c.type === 'group' ? `<span class="fluxo-grupo-rotulo">${esc(c.label)}</span>` : '';
      // Backup importado só passa por validateState (nodes/edges são listas), não por KiroFluxo.ler:
      // x/y/width/height viram número aqui antes de entrar no atributo style.
      return `<div class="fluxo-cartao${s.selecao.has(c.id) ? ' selecionado' : ''}" data-no="${esc(c.id)}" data-tipo="${esc(c.type)}"${corData(c.color)} style="${corCss(c.color)}left:${Number(c.x)}px;top:${Number(c.y)}px;width:${Number(c.width)}px;height:${Number(c.height)}px">${rotulo}<div class="fluxo-conteudo">${conteudo(c)}</div>${alcas}</div>`;
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
    function voltar(fn) {
      const r = fn(s.historico, canvas);
      if (!r) return;
      terminarEdicao();
      s.historico = r.historico; canvas = r.canvas;
      desenhar(); opcoes.aoMudar(canvas);
    }
    const desfazer = () => voltar(F.desfazer), refazer = () => voltar(F.refazer);
    const encaixar = v => (s.grade ? F.encaixar(v) : Math.round(v));
    const encaixarPraCima = v => (s.grade ? Math.ceil(v / F.GRADE) * F.GRADE : Math.ceil(v));
    function marcarSelecao() {
      for (const el of cartoes.children) el.classList.toggle('selecionado', s.selecao.has(el.dataset.no));
      for (const el of caminhos.children) el.classList.toggle('selecionada', s.seta === el.dataset.seta);
    }
    function selecionar(ids) { s.selecao = new Set(ids); s.seta = null; marcarSelecao(); }
    // Arrastar um grupo leva junto os cartões que estão inteiramente dentro dele.
    function comConteudo(ids) {
      const todos = new Set(ids);
      for (const idNo of ids) { const c = no(idNo); if (c?.type === 'group') for (const dentro of F.contidos(canvas.nodes, c)) todos.add(dentro); }
      return [...todos];
    }
    function criarCartao(p) {
      const r = F.adicionarCartao(canvas, { type: 'text', text: '', x: encaixar(p.x - 130), y: encaixar(p.y - 30), width: 260, height: 60 });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      editar(r.id);
      return r.id;
    }
    const centroDaVista = () => { const [w, h] = tamanho(); return F.paraCanvas(s.vista, w / 2, h / 2); };
    // Novo cartão centrado em p. Depois de um await (modal, gravação de imagem) o app pode ter
    // redesenhado a tela e este editor já não ser o montado: aí vale o canvas que está no estado.
    function adicionarNo(base, p) {
      if (!montados.has(inst)) {
        // Instância morta: gravar direto no canvas mais recente do estado (não no `canvas` desta
        // closure, que ficou parado no momento em que a tela redesenhou) e pedir um redesenho.
        // Editar aqui e deixar a instância viva (nascida com esse canvas antigo) sobrescrever
        // depois apagaria este cartão; redesenhar agora a recria já com ele.
        const atual = opcoes.canvasAtual() || canvas;
        const r = F.adicionarCartao(atual, { ...base, x: encaixar(p.x - base.width / 2), y: encaixar(p.y - base.height / 2) });
        s.historico = F.empilhar(s.historico, atual);
        s.selecao = new Set([r.id]);
        opcoes.aoMudar(r.canvas);
        opcoes.redesenhar();
        return r.id;
      }
      const r = F.adicionarCartao(canvas, { ...base, x: encaixar(p.x - base.width / 2), y: encaixar(p.y - base.height / 2) });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      return r.id;
    }
    async function adicionarNota(p) { const nota = await opcoes.escolherNota(); if (nota) adicionarNo({ type: 'file', file: nota.arquivo, width: 400, height: 280 }, p); }
    async function adicionarImagem(p) { const caminho = await opcoes.escolherImagem(); if (caminho) adicionarNo({ type: 'file', file: caminho, width: 320, height: 240 }, p); }
    async function adicionarLink(p) { const url = await opcoes.pedirLink(); if (url) adicionarNo({ type: 'link', url, width: 320, height: 100 }, p); }
    function criarGrupo(p) {
      const sel = canvas.nodes.filter(n => s.selecao.has(n.id));
      const caixa = sel.length ? F.caixaDe(sel) : { x: p.x - 200, y: p.y - 150, width: 400, height: 300 };
      const r = F.adicionarCartao(canvas, { type: 'group', label: 'Grupo', x: encaixar(caixa.x), y: encaixar(caixa.y), width: encaixarPraCima(caixa.width), height: encaixarPraCima(caixa.height) });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      editarGrupo(r.id);
    }
    // Texto colado: URL sozinha vira link; o resto, cartão de texto com altura estimada.
    function colarTexto(texto, p) {
      const limpo = String(texto).trim();
      if (!limpo) return;
      if (/^https?:\/\/\S+$/i.test(limpo)) return void adicionarNo({ type: 'link', url: limpo, width: 320, height: 100 }, p);
      adicionarNo({ type: 'text', text: limpo, width: 320, height: F.alturaEstimada(limpo) }, p);
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
    // Rótulo: um <input> sobre o meio da curva. Enter ou sair gravam; Esc desiste. Vazio tira o rótulo.
    function editarRotulo(idSeta) {
      const seta = canvas.edges.find(x => x.id === idSeta), g = seta && F.geometriaDaSeta(canvas.nodes, seta);
      if (!g) return;
      terminarEdicao();
      const campo = document.createElement('input');
      campo.className = 'fluxo-editor fluxo-rotulo-editor';
      campo.value = seta.label || '';
      campo.setAttribute('aria-label', 'Rótulo da seta');
      Object.assign(campo.style, { left: `${g.meio.x}px`, top: `${g.meio.y}px` });
      mundo.appendChild(campo);
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null; campo.remove();
        const label = campo.value.trim() || undefined;
        if (gravar && label !== seta.label) mudar(F.editarSeta(canvas, idSeta, { label }));
      };
      editor = { concluir };
      campo.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); concluir(e.key === 'Enter'); raiz.focus({ preventScroll: true }); }
      });
      campo.addEventListener('blur', () => concluir(true));
      campo.focus(); campo.select();
    }
    // Rótulo do grupo: um <input> sobre a borda de cima. Enter ou sair gravam; Esc desiste.
    function editarGrupo(idNo) {
      const c = no(idNo);
      if (!c || c.type !== 'group') return;
      terminarEdicao();
      const campo = document.createElement('input');
      campo.className = 'fluxo-editor fluxo-grupo-editor';
      campo.value = c.label || '';
      campo.setAttribute('aria-label', 'Nome do grupo');
      Object.assign(campo.style, { left: `${Number(c.x)}px`, top: `${Number(c.y)}px` });
      mundo.appendChild(campo);
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null; campo.remove();
        const label = campo.value.trim() || undefined;
        if (gravar && label !== c.label) mudar(F.editarCartao(canvas, idNo, { label }));
      };
      editor = { concluir };
      campo.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); concluir(e.key === 'Enter'); raiz.focus({ preventScroll: true }); }
      });
      campo.addEventListener('blur', () => concluir(true));
      campo.focus(); campo.select();
    }
    // O app cria a nota e troca o cartão numa gravação própria (que redesenha a tela); o passo
    // de desfazer guardado aqui volta ao cartão de texto (a nota criada continua no cofre).
    function transformarEmNota(idNo) {
      const c = no(idNo);
      if (!c || c.type !== 'text' || !c.text.trim()) return;
      terminarEdicao();
      s.historico = F.empilhar(s.historico, canvas);
      opcoes.transformarEmNota(idNo, no(idNo).text);
    }
    // ---- Menus do botão direito ----
    const NOMES_DAS_CORES = { '': 'Sem cor', 1: 'Vermelho', 2: 'Laranja', 3: 'Amarelo', 4: 'Verde', 5: 'Ciano', 6: 'Roxo' };
    const bolinha = cor => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" class="fluxo-bolinha"${corData(cor)} style="${corCss(cor)}"/></svg>`;
    const itensDaCor = aplicar => ['', ...F.CORES].map(cor => ({ rotulo: NOMES_DAS_CORES[cor], icone: bolinha(cor), acao: () => aplicar(cor || undefined) }));
    function menuDoFundo(p) {
      return [
        { rotulo: 'Adicionar cartão', icone: opcoes.icone('mais'), acao: () => criarCartao(p) },
        { rotulo: 'Adicionar nota do cofre', icone: opcoes.icone('nota'), acao: () => adicionarNota(p) },
        { rotulo: 'Adicionar imagem', icone: opcoes.icone('imagem'), acao: () => adicionarImagem(p) },
        { rotulo: 'Adicionar link', icone: opcoes.icone('link'), acao: () => adicionarLink(p) },
        { rotulo: s.selecao.size ? 'Agrupar seleção' : 'Criar grupo', icone: opcoes.icone('pastas'), acao: () => criarGrupo(p) },
        { separador: true },
        { rotulo: 'Desfazer', icone: opcoes.icone('desfazer'), ativo: () => s.historico.antes.length > 0, acao: desfazer },
        { rotulo: 'Refazer', icone: opcoes.icone('refazer'), ativo: () => s.historico.depois.length > 0, acao: refazer },
        { rotulo: 'Colar', icone: opcoes.icone('colar'), acao: () => navigator.clipboard.readText().then(t => colarTexto(t, p), () => opcoes.aviso('Não foi possível ler a área de transferência.', true)) },
        { separador: true },
        { rotulo: 'Encaixar na grade', icone: s.grade ? opcoes.icone('marcado') : '', acao: () => { s.grade = !s.grade; } },
        { rotulo: 'Enquadrar tudo', icone: opcoes.icone('expandir'), acao: enquadrarTudo },
      ];
    }
    function menuDoCartao(idNo) {
      if (!s.selecao.has(idNo)) selecionar([idNo]);
      const ids = [...s.selecao];
      return [
        { rotulo: 'Cor', icone: bolinha(no(idNo)?.color), filhos: itensDaCor(cor => mudar(ids.reduce((c, x) => F.editarCartao(c, x, { color: cor }), canvas))) },
        { rotulo: 'Duplicar', icone: opcoes.icone('copiar'), acao: () => { const r = F.duplicarCartoes(canvas, ids); s.selecao = new Set(r.ids); mudar(r.canvas); } },
        ...(ids.length === 1 && no(idNo)?.type === 'text' ? [{ rotulo: 'Editar texto', icone: opcoes.icone('renomear'), acao: () => editar(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'text' && no(idNo).text.trim() ? [{ rotulo: 'Transformar em nota', icone: opcoes.icone('nota'), acao: () => transformarEmNota(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'group' ? [{ rotulo: 'Renomear grupo', icone: opcoes.icone('renomear'), acao: () => editarGrupo(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'file' && !F.ehImagem(no(idNo).file) ? [{ rotulo: 'Abrir nota', icone: opcoes.icone('nota'), acao: () => opcoes.abrirNota(no(idNo).file) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'link' ? [{ rotulo: 'Abrir link', icone: opcoes.icone('link'), acao: () => opcoes.abrirLink(no(idNo).url) }] : []),
        { separador: true },
        { rotulo: ids.length > 1 ? `Excluir ${ids.length} cartões` : 'Excluir', icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerCartoes(canvas, ids)) },
      ];
    }
    function menuDaSeta(idSeta) {
      selecionarSeta(idSeta);
      const muda = campos => mudar(F.editarSeta(canvas, idSeta, campos));
      return [
        { rotulo: 'Cor', icone: bolinha(canvas.edges.find(x => x.id === idSeta)?.color), filhos: itensDaCor(cor => muda({ color: cor })) },
        { rotulo: 'Direção', icone: opcoes.icone('direita'), filhos: [
          { rotulo: 'Ponta no fim (→)', icone: '→', acao: () => muda({ fromEnd: undefined, toEnd: undefined }) },
          { rotulo: 'Pontas nos dois lados (↔)', icone: '↔', acao: () => muda({ fromEnd: 'arrow', toEnd: undefined }) },
          { rotulo: 'Sem pontas (—)', icone: '—', acao: () => muda({ fromEnd: undefined, toEnd: 'none' }) },
        ] },
        { rotulo: 'Editar rótulo', icone: opcoes.icone('renomear'), acao: () => editarRotulo(idSeta) },
        { separador: true },
        { rotulo: 'Excluir', icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerSetas(canvas, [idSeta])) },
      ];
    }
    raiz.addEventListener('contextmenu', e => {
      if (e.target.closest('.fluxo-editor, .fluxo-barra')) return;
      e.stopPropagation();
      terminarEdicao();
      const cartao = e.target.closest('.fluxo-cartao'), seta = e.target.closest('.fluxo-seta');
      opcoes.menu(e, cartao ? menuDoCartao(cartao.dataset.no) : seta ? menuDaSeta(seta.dataset.seta) : menuDoFundo(pontoDoCanvas(e)));
    });
    function criarCartaoNoCentro() { criarCartao(centroDaVista()); }

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
    function selecionarSeta(idSeta) { s.selecao = new Set(); s.seta = idSeta; marcarSelecao(); }
    GESTOS.ligar = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const inicio = F.pontoDoLado(no(g.de), g.lado);
        previa.setAttribute('d', F.caminhoDaSeta(inicio, g.lado, pontoDoCanvas(e), F.OPOSTO[g.lado]).d);
        previa.classList.add('ativa');
      },
      soltar(g, e) {
        previa.classList.remove('ativa');
        if (!g.andou) return;
        const origem = no(g.de), saida = F.pontoDoLado(origem, g.lado);
        const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fluxo-cartao');
        if (alvo && raiz.contains(alvo)) {
          const destino = no(alvo.dataset.no);
          if (!destino || destino.id === origem.id) return;
          return void mudar(F.ligar(canvas, { fromNode: origem.id, fromSide: g.lado, toNode: destino.id, toSide: F.ladoMaisProximo(destino, saida) }).canvas);
        }
        // Soltar no vazio: cartão novo já ligado e em edição (o gesto mais rápido do mapa mental).
        const p = pontoDoCanvas(e), lado = F.OPOSTO[g.lado], largura = 260, altura = 60;
        const x = lado === 'left' ? p.x : lado === 'right' ? p.x - largura : p.x - largura / 2;
        const y = lado === 'top' ? p.y : lado === 'bottom' ? p.y - altura : p.y - altura / 2;
        const passo = F.adicionarCartao(canvas, { type: 'text', text: '', x: encaixar(x), y: encaixar(y), width: largura, height: altura });
        const ligado = F.ligar(passo.canvas, { fromNode: origem.id, fromSide: g.lado, toNode: passo.id, toSide: lado });
        s.selecao = new Set([passo.id]);
        mudar(ligado.canvas);   // um passo só de desfazer para cartão + seta
        editar(passo.id);
      },
    };
    function iniciar(e, g) { gesto = { ...g, tela0: pontoDaTela(e), vista0: { ...s.vista } }; raiz.setPointerCapture(e.pointerId); e.preventDefault(); }
    function escolherGesto(e) {
      if (e.button === 1 || (e.button === 0 && espaco)) return { tipo: 'pan' };
      if (e.button !== 0) return null;
      const p = pontoDoCanvas(e), cartao = e.target.closest('.fluxo-cartao'), alca = e.target.closest('.fluxo-alca'), seta = e.target.closest('.fluxo-seta');
      if (cartao && alca) return { tipo: 'ligar', de: cartao.dataset.no, lado: alca.dataset.lado };
      if (seta) { selecionarSeta(seta.dataset.seta); return null; }
      if (cartao && e.target.closest('.fluxo-canto')) { selecionar([cartao.dataset.no]); return { tipo: 'redimensionar', id: cartao.dataset.no, p0: p }; }
      if (cartao) {
        const idNo = cartao.dataset.no;
        if (e.shiftKey) { const outra = new Set(s.selecao); if (outra.has(idNo)) outra.delete(idNo); else outra.add(idNo); selecionar([...outra]); return null; }
        if (!s.selecao.has(idNo)) selecionar([idNo]);
        return { tipo: 'mover', ids: comConteudo([idNo, ...[...s.selecao].filter(x => x !== idNo)]), p0: p };
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
    // Espaço solto depois que o foco já saiu do fluxo não dispara o keyup acima: sem isto, o
    // pan ficaria travado ligado na próxima vez que o cartão recebesse um gesto do mouse.
    raiz.addEventListener('blur', () => { espaco = false; raiz.classList.remove('pan'); });
    // O 'pointerdown' do primeiro clique chama setPointerCapture; com o ponteiro capturado,
    // o 'dblclick' chega com e.target = raiz, não o elemento sob o cursor. Por isso relemos
    // o elemento de verdade pela posição.
    raiz.addEventListener('dblclick', e => {
      const alvo = document.elementFromPoint(e.clientX, e.clientY) || e.target;
      if (!raiz.contains(alvo) || alvo.closest('.fluxo-barra, .fluxo-editor, .fluxo-seta')) return;
      const cartao = alvo.closest('.fluxo-cartao');
      if (!cartao) return void criarCartao(pontoDoCanvas(e));
      const c = no(cartao.dataset.no);
      if (c?.type === 'file' && !F.ehImagem(c.file)) return void opcoes.abrirNota(c.file);
      if (c?.type === 'link') return void opcoes.abrirLink(c.url);
      if (c?.type === 'group') return void editarGrupo(c.id);
      editar(cartao.dataset.no);
    });
    raiz.addEventListener('dblclick', e => {
      const alvo = document.elementFromPoint(e.clientX, e.clientY) || e.target;
      const seta = raiz.contains(alvo) && alvo.closest('.fluxo-seta');
      if (seta) editarRotulo(seta.dataset.seta);
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz || !s.seta || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      e.preventDefault(); e.stopPropagation();
      mudar(F.removerSetas(canvas, [s.seta]));
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selecao.size) { e.preventDefault(); e.stopPropagation(); mudar(F.removerCartoes(canvas, [...s.selecao])); }
      else if (e.key === 'Enter' && s.selecao.size === 1) { e.preventDefault(); editar([...s.selecao][0]); }
      else if (e.key === 'Escape') selecionar([]);
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz || !(e.ctrlKey || e.metaKey)) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); desfazer(); }
      else if (tecla === 'y' || (tecla === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); refazer(); }
    });
    raiz.addEventListener('click', e => { if (e.target.closest('.fluxo-conteudo a')) e.preventDefault(); });
    raiz.querySelector('.fluxo-barra').addEventListener('click', e => {
      const acao = e.target.closest('[data-fluxo-acao]')?.dataset.fluxoAcao;
      if (acao === 'enquadrar') enquadrarTudo();
      if (acao === 'cartao') criarCartaoNoCentro();
      if (acao === 'nota') adicionarNota(centroDaVista());
      if (acao === 'imagem') adicionarImagem(centroDaVista());
    });
    // Nota arrastada da árvore vira cartão no ponto onde foi solta. stopPropagation: senão a
    // área das colunas (bindDragDeAbas) trataria o mesmo arraste e abriria a nota numa coluna.
    const eNota = e => e.dataTransfer?.types.includes('text/kiro-nota');
    raiz.addEventListener('dragover', e => {
      if (!eNota(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      raiz.classList.add('soltando');
    });
    raiz.addEventListener('dragleave', e => { if (!raiz.contains(e.relatedTarget)) raiz.classList.remove('soltando'); });
    // 'dragend' dispara na origem do arraste (a nota na árvore), não em `raiz`: sem isto, soltar
    // fora de qualquer alvo (Esc, arraste cancelado) deixaria o destaque aceso.
    const tirarSoltando = () => raiz.classList.remove('soltando');
    document.addEventListener('dragend', tirarSoltando);
    raiz.addEventListener('drop', e => {
      if (!eNota(e)) return;
      e.preventDefault(); e.stopPropagation();
      raiz.classList.remove('soltando');
      const arquivo = opcoes.arquivoDaNota(e.dataTransfer.getData('text/kiro-nota'));
      if (arquivo) adicionarNo({ type: 'file', file: arquivo, width: 400, height: 280 }, pontoDoCanvas(e));
    });
    // Colar com o fluxo em foco (fora da edição de um cartão): imagem → anexo → cartão de imagem;
    // URL sozinha → link; texto → cartão de texto. Tudo no centro da vista.
    async function colarImagens(arquivos, p) {
      for (const [i, arquivo] of arquivos.entries()) {
        const caminho = await opcoes.guardarImagem(arquivo);
        if (caminho) adicionarNo({ type: 'file', file: caminho, width: 320, height: 240 }, { x: p.x + i * F.GRADE * 2, y: p.y + i * F.GRADE * 2 });
      }
    }
    raiz.addEventListener('paste', e => {
      if (editor || e.target !== raiz || !e.clipboardData) return;
      const imagens = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
      if (imagens.length) { e.preventDefault(); return void colarImagens(imagens, centroDaVista()); }
      const texto = e.clipboardData.getData('text/plain');
      if (texto.trim()) { e.preventDefault(); colarTexto(texto, centroDaVista()); }
    });

    // Foco: acompanhado ao vivo, não amostrado no desmontar. O salvamento automático torna
    // `.app-shell` inert ANTES de redesenhar (ver `setBusy` em app.js), o que já tira o foco do
    // fluxo por conta própria — nesse momento `focusout` chega sem `relatedTarget` (como num
    // blur de janela ou na remoção do nó do DOM), e o sinal não conta como "foco saiu de verdade".
    // Um pointerdown fora do fluxo é o sinal de que o usuário saiu por vontade própria.
    raiz.addEventListener('focusin', () => { s.foco = true; });
    raiz.addEventListener('focusout', e => { if (e.relatedTarget && !raiz.contains(e.relatedTarget)) s.foco = false; });
    const foraDoFluxo = e => { if (!raiz.contains(e.target)) s.foco = false; };
    document.addEventListener('pointerdown', foraDoFluxo);

    function desmontar() {
      if (!montados.has(inst)) return;
      terminarEdicao();
      montados.delete(inst);
      document.removeEventListener('pointerdown', foraDoFluxo);
      document.removeEventListener('dragend', tirarSoltando);
      if (timerVista) { clearTimeout(timerVista); gravarVista(opcoes.chaveDaVista, id, s.vista); }
    }
    const inst = { desmontar, ocupado: () => !!gesto || !!editor };
    montados.add(inst);
    desenhar(); aplicarVista();
    // `.app-shell` ainda pode estar inert aqui (setBusy só volta depois do render): focar de
    // verdade só depois do quadro atual, quando o `finally` do `save()` já tirou o inert.
    if (s.foco) { s.foco = false; requestAnimationFrame(() => { if (document.contains(raiz)) raiz.focus({ preventScroll: true }); }); }
    return inst;
  }
  function desmontarTodos() { for (const m of [...montados]) m.desmontar(); }
  const ocupado = () => [...montados].some(m => m.ocupado());
  root.KiroFluxoTela = { montar, desmontarTodos, ocupado };
})(globalThis);
