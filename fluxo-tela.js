// Editor do Fluxo: desenha um canvas JSON Canvas e traduz ponteiro e teclado em operações do
// KiroFluxo. Não conhece o cofre: recebe o canvas e entrega o novo por `aoMudar`. O que é de
// tela (vista, seleção, desfazer) vive numa sessão por fluxo, que sobrevive aos redesenhos do
// app (cada salvamento redesenha a tela inteira).
(function (root) {
  const F = root.KiroFluxo;
  const t = (frase, valores) => root.KiroIdiomas.t(frase, valores);
  const sessoes = new Map();       // id do fluxo → { vista, selecao, paginasDoPdf (id do cartão → página), seta, historico, grade, mouseNaTela, ultimaColagem, ultimaSeta }
  const montados = new Set();
  // Último trecho copiado no Fluxo, para colar em outro fluxo. Só vale se o texto da área de
  // transferência ainda for o mesmo que gravamos junto. Vale até o Kiro fechar.
  let areaDoFluxo = null;      // { trecho, texto }
  let contador = 0;                // ids únicos de <marker> quando dois fluxos estão abertos
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Texto muito longo é cortado: um <pre> de milhões de caracteres trava o cartão.
  const LIMITE_DO_TEXTO = 200000;
  const textoLimitado = texto => (texto.length > LIMITE_DO_TEXTO ? `${texto.slice(0, LIMITE_DO_TEXTO)}\n${t('… mais {n} caracteres', { n: texto.length - LIMITE_DO_TEXTO })}` : texto);
  // Linhas de um CSV como conteúdo de <table>: a primeira é o cabeçalho.
  // O player do YouTube: o mesmo <iframe> no cartão e na tela inteira. nocookie, e só criado quando a pessoa pede.
  const videoIframeHtml = id => `<iframe class="fluxo-video-player" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  function tabelaHtml(texto) {
    const { linhas, restantes } = F.lerCsv(texto);
    const celulas = (l, tag) => l.map(x => `<${tag}>${esc(x)}</${tag}>`).join('');
    const mais = restantes ? `<tr><td class="fluxo-tabela-mais" colspan="${Math.max(1, linhas[0]?.length || 1)}">${t('… mais {n} linhas', { n: restantes })}</td></tr>` : '';
    return `<thead><tr>${celulas(linhas[0] || [], 'th')}</tr></thead><tbody>${linhas.slice(1).map(l => `<tr>${celulas(l, 'td')}</tr>`).join('')}${mais}</tbody>`;
  }
  // Cor predefinida vira atributo (o CSS dá o tom de cada tema); hex vira variável CSS.
  // `ler` já recusou qualquer outra coisa, mas a checagem fica aqui também: é onde vira style.
  const corData = cor => (F.CORES.includes(cor) ? ` data-fluxo-cor="${cor}"` : '');
  const corCss = cor => (/^#[0-9a-f]{6}$/i.test(cor || '') ? `--fluxo-cor:${cor};` : '');
  function sessao(id) {
    if (!sessoes.has(id)) sessoes.set(id, { corpos: new Map(), rolagens: new WeakMap(), vista: null, selecao: new Set(), paginasDoPdf: new Map(), seta: null, historico: F.historicoVazio(), grade: true, mouseNaTela: null, ultimaColagem: null, ultimaSeta: 0 });
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
    host.innerHTML = `<div class="fluxo" tabindex="0" role="application" aria-label="${esc(t('Fluxo {titulo}', { titulo: opcoes.titulo }))}">
  <div class="fluxo-mundo">
    <svg class="fluxo-setas" aria-hidden="true"><defs><marker id="fluxo-ponta-${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs><g class="fluxo-caminhos"></g><path class="fluxo-seta-previa" d=""/></svg>
    <div class="fluxo-cartoes"></div>
    <div class="fluxo-marca" hidden></div>
    <div class="fluxo-guias"></div>
  </div>
  <div class="fluxo-dica"><p>${t('Dois cliques para criar um cartão')}</p><p>${t('Cole ou arraste um arquivo para cá')}</p></div>
  <div class="fluxo-barra"><button type="button" class="icon-button" data-fluxo-acao="cartao" title="${t('Adicionar cartão (ou dois cliques no fundo)')}" aria-label="${t('Adicionar cartão')}">${opcoes.icone('mais')}</button><button type="button" class="icon-button" data-fluxo-acao="nota" title="${t('Adicionar nota do cofre')}" aria-label="${t('Adicionar nota do cofre')}">${opcoes.icone('nota')}</button><button type="button" class="icon-button" data-fluxo-acao="imagem" title="${t('Adicionar arquivo')}" aria-label="${t('Adicionar arquivo')}">${opcoes.icone('imagem')}</button><button type="button" class="fluxo-zoom" data-fluxo-acao="enquadrar" title="${t('Enquadrar tudo (Shift+1)')}" aria-label="${t('Enquadrar tudo')}">100%</button></div>
</div>`;
    const raiz = host.firstElementChild;
    const mundo = raiz.querySelector('.fluxo-mundo'), caminhos = raiz.querySelector('.fluxo-caminhos'), cartoes = raiz.querySelector('.fluxo-cartoes');
    const previa = raiz.querySelector('.fluxo-seta-previa'), marca = raiz.querySelector('.fluxo-marca'), guias = raiz.querySelector('.fluxo-guias'), rotuloZoom = raiz.querySelector('.fluxo-zoom');
    const dica = raiz.querySelector('.fluxo-dica');
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
        const tipo = F.tipoDoArquivo(c.file);
        if (tipo !== 'nota') return arquivoHtml(c, tipo);
        const nota = opcoes.nota(c.file);
        if (!nota) return `<p class="fluxo-ausente">${t('Nota não encontrada')}<br><small>${esc(c.file)}</small></p>`;
        return `<div class="fluxo-nota-titulo">${esc(nota.titulo)}</div><div class="fluxo-nota-previa">${nota.html}</div>`;
      }
      if (c.type === 'link') return linkHtml(c);
      return '';
    }
    // Topo dos cartões de arquivo e de link: seta que recolhe, nome e (se houver) Abrir.
    function topoHtml(c, nome, { abrir = true, total = '' } = {}) {
      const rotuloSeta = c.kiroRecolhido ? t('Mostrar conteúdo') : t('Recolher');
      return `<div class="fluxo-arquivo-topo"><button type="button" class="icon-button fluxo-seta-recolher" aria-expanded="${!c.kiroRecolhido}" aria-label="${rotuloSeta}" title="${rotuloSeta}">${opcoes.icone('direita')}</button><span class="fluxo-arquivo-nome">${esc(nome)}${total}</span>${abrir ? `<button type="button" class="secondary cfg-pequeno fluxo-abrir">${t('Abrir')}</button>` : ''}</div>`;
    }
    // Cartão de link: o endereço primeiro; a prévia (título, descrição, imagem do cofre) entra quando chega.
    function linkHtml(c) {
      const idVideo = F.idDoYoutube(c.url);
      if (idVideo) return videoHtml(c, idVideo);
      const previa = c.kiroPrevia || {}, endereco = c.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
      const topo = topoHtml(c, previa.titulo || endereco);
      if (c.kiroRecolhido) return topo;
      const imagem = previa.imagem && F.caminhoSeguro(previa.imagem) ? `<img class="fluxo-link-imagem" src="${esc(opcoes.urlDoArquivo(previa.imagem))}" alt="" draggable="false">` : '';
      const titulo = previa.titulo ? `<p class="fluxo-link-titulo">${esc(previa.titulo)}</p>` : '';
      const descricao = previa.descricao ? `<p class="fluxo-link-descricao">${esc(previa.descricao)}</p>` : '';
      return `${topo}<div class="fluxo-link-corpo">${imagem}${titulo}${descricao}<p class="fluxo-link">${esc(c.url)}</p></div>`;
    }
    // Cartão de vídeo do YouTube: aberto, miniatura com botão de tocar (nada do YouTube carrega antes do clique).
    // O corpo é reaproveitado entre desenhos, e o player some junto com ele ao recolher ou apagar.
    function videoHtml(c, id) {
      const topo = topoHtml(c, c.kiroPrevia?.titulo || t('Vídeo do YouTube'));
      if (c.kiroRecolhido) return topo;
      const miniatura = `<img class="fluxo-video-miniatura" src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg" alt="" draggable="false">`;
      const tocar = `<button type="button" class="fluxo-video-tocar" aria-label="${t('Tocar')}" title="${t('Tocar')}">${opcoes.icone('tocar')}</button>`;
      return `${topo}<div class="fluxo-arquivo-corpo fluxo-video-corpo" data-reusar="${esc(c.id)}|${esc(id)}" data-video="${esc(id)}">${miniatura}${tocar}</div>`;
    }
    // Cartão de arquivo: topo (seta que recolhe, nome, Abrir) e corpo. Recolhido, o corpo nem é
    // desenhado. Só caminho relativo ao cofre vira mídia: um .canvas de fora não aponta para ../ nem para o disco.
    function arquivoHtml(c, tipo) {
      if (!F.caminhoSeguro(c.file)) return `<p class="fluxo-arquivo">${esc(c.file)}</p>`;
      const nome = c.file.split('/').pop(), aberto = !c.kiroRecolhido, url = esc(opcoes.urlDoArquivo(c.file));
      const topo = topoHtml(c, nome, { abrir: tipo !== 'audio', total: '<span class="md-pdf-total"></span>' });
      if (!aberto) return topo;
      const corpos = {
        // O pdf-nota.js ativa sozinho este bloco ao entrar na página; a página vem da sessão para o redesenho completo não voltar à primeira.
        pdf: `<details open class="md-pdf fluxo-pdf" data-pdf="${esc(c.file)}" data-pagina="${s.paginasDoPdf.get(c.id) || 1}"><summary hidden></summary><div class="md-pdf-paginas"></div></details>`,
        imagem: `<img class="fluxo-imagem" src="${url}" alt="${esc(nome)}" draggable="false">`,
        texto: `<pre class="fluxo-texto" data-ler="${esc(c.file)}"></pre>`,
        tabela: `<table class="fluxo-tabela" data-ler="${esc(c.file)}"></table>`,
        audio: `<audio controls preload="metadata" src="${url}"></audio>`,
        video: `<video controls preload="metadata" src="${url}"></video>`,
      };
      return `${topo}<div class="fluxo-arquivo-corpo" data-tipo-arquivo="${tipo}" data-reusar="${esc(c.id)}|${esc(c.file)}">${corpos[tipo]}</div>`;
    }
    // Texto e tabela são lidos depois do desenho, só os que ainda não foram: o corpo reaproveitado já está pronto.
    function lerCorpos() {
      for (const el of cartoes.querySelectorAll('[data-ler]:not([data-lido])')) {
        el.dataset.lido = '1';
        Promise.resolve(opcoes.lerTexto(el.dataset.ler)).then(
          texto => { if (el.matches('table')) el.innerHTML = tabelaHtml(texto); else el.textContent = textoLimitado(texto); },
          () => { el.textContent = t('Não foi possível ler o arquivo.'); });
      }
    }
    function cartaoHtml(c) {
      const alcas = F.LADOS.map(l => `<span class="fluxo-alca" data-lado="${l}"></span>`).join('') + `<span class="fluxo-canto" title="${t('Arraste para redimensionar')}"></span>`;
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
      // Corpo já aberto (PDF, texto, vídeo tocando…) volta no lugar do novo, com a rolagem: recarregar piscaria, e o vídeo pararia.
      // Os corpos vivem na sessão (`s.corpos`), não só neste DOM: o autosave remonta a tela inteira (outra instância de `montar`),
      // e movidos no mesmo instante da troca o <audio> e o <video> não chegam a pausar.
      const antigos = new Map(s.corpos);
      for (const el of cartoes.querySelectorAll('[data-reusar]')) antigos.set(el.dataset.reusar, el);
      // Grupos primeiro: ficam atrás dos cartões.
      const ordem = c => (c.type === 'group' ? 0 : 1);
      cartoes.innerHTML = [...canvas.nodes].sort((a, b) => ordem(a) - ordem(b)).map(cartaoHtml).join('');
      s.corpos = new Map();   // só ficam os que ainda existem
      for (const novo of cartoes.querySelectorAll('[data-reusar]')) {
        const chave = novo.dataset.reusar, velho = antigos.get(chave);
        if (velho) {
          novo.replaceWith(velho);
          for (const x of velho.querySelectorAll('.md-pdf-paginas, .fluxo-texto, .fluxo-tabela')) { const [topo, esquerda] = s.rolagens.get(x) || [0, 0]; x.scrollTop = topo; x.scrollLeft = esquerda; }
        }
        s.corpos.set(chave, velho || novo);
      }
      lerCorpos();
      desenharSetas();
      dica.hidden = canvas.nodes.length > 0;
    }
    // Altura que o Markdown de um cartão de texto ocupa na largura dele, mais a borda.
    function alturaDoTexto(texto, largura) {
      const medida = document.createElement('div');
      medida.className = 'fluxo-conteudo fluxo-medida';
      medida.style.width = `${largura}px`;
      medida.innerHTML = opcoes.markdown(texto);
      cartoes.appendChild(medida);
      const altura = Math.ceil(medida.scrollHeight) + 4;
      medida.remove();
      return altura;
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
    // Sem vista guardada: é a primeira vez que este fluxo abre neste Kiro, neste cofre.
    let primeiraVez = false;
    if (!s.vista) {
      const salva = lerVistas(opcoes.chaveDaVista)[id];
      primeiraVez = !F.vistaValida(salva);
      s.vista = primeiraVez ? F.enquadrar(canvas.nodes, ...tamanho()) : salva;
    }

    // ---- Mudanças ----
    function mudar(novo) {
      if (novo === canvas) return;
      s.ultimaSeta = 0;
      s.historico = F.empilhar(s.historico, canvas);
      canvas = novo;
      desenhar();
      opcoes.aoMudar(canvas);
    }
    function voltar(fn) {
      const r = fn(s.historico, canvas);
      if (!r) return;
      s.ultimaSeta = 0;
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
    function adicionarNo(base, p, aoCriar) {
      // Um salvamento em andamento troca `state` por baixo dos nós: gravar agora cairia no
      // `state` antigo e `render()` (fim do save) reconstruiria a tela sem este cartão. Esperar
      // a folga: depois a chamada de novo cai na instância viva ou no ramo morto com
      // canvasAtual + redesenhar (F1).
      if (opcoes.salvando?.()) return void setTimeout(() => adicionarNo(base, p, aoCriar), 150);
      if (!montados.has(inst)) {
        // Instância morta: gravar direto no canvas mais recente do estado (não no `canvas` desta
        // closure, que ficou parado no momento em que a tela redesenhou) e pedir um redesenho.
        // Editar aqui e deixar a instância viva (nascida com esse canvas antigo) sobrescrever
        // depois apagaria este cartão; redesenhar agora a recria já com ele.
        const atual = opcoes.canvasAtual();
        if (!atual) return;   // o fluxo foi excluído enquanto isto estava pendente (M2)
        const r = F.adicionarCartao(atual, { ...base, x: encaixar(p.x - base.width / 2), y: encaixar(p.y - base.height / 2) });
        s.historico = F.empilhar(s.historico, atual);
        s.selecao = new Set([r.id]);
        opcoes.aoMudar(r.canvas);
        opcoes.redesenhar();
        aoCriar?.(r.id);
        return r.id;
      }
      terminarEdicao();   // um upload que termina enquanto se digita comita o texto, não o redesenha por baixo (M1)
      const r = F.adicionarCartao(canvas, { ...base, x: encaixar(p.x - base.width / 2), y: encaixar(p.y - base.height / 2) });
      s.selecao = new Set([r.id]);
      mudar(r.canvas);
      aoCriar?.(r.id);
      return r.id;
    }
    // Link novo: nasce com o endereço e a prévia (título, descrição, imagem) entra quando chega, fora do desfazer.
    // YouTube também: guarda só o título. Qualquer falha da busca deixa o cartão como está.
    function novoLink(url, p) {
      const base = { type: 'link', url, width: 320, height: 100 };
      adicionarNo(base, p, !opcoes.previaDeLink ? undefined : idNo => {
        Promise.resolve(opcoes.previaDeLink(url)).then(previa => receberPrevia(idNo, previa), () => {});
      });
    }
    // Instância viva: troca no canvas desta tela. Morta (o salvamento automático remontou a tela enquanto
    // a busca corria): grava no canvas mais recente do estado e redesenha. Sem desfazer em nenhum dos dois.
    function receberPrevia(idNo, previa) {
      if (!previa || typeof previa !== 'object') return;
      // Espera salvamento, arraste/redimensionamento (o soltar gravaria um canvas calculado sem a prévia) e edição aberta.
      if (opcoes.salvando?.() || (montados.has(inst) && (gesto || editor))) return void setTimeout(() => receberPrevia(idNo, previa), 150);
      const vivo = montados.has(inst), base = vivo ? canvas : opcoes.canvasAtual();
      const n = base?.nodes.find(x => x.id === idNo);
      if (!n || n.type !== 'link') return;   // o cartão foi apagado nesse meio tempo
      const video = F.idDoYoutube(n.url);   // vídeo: só o título, a miniatura vem do YouTube ao tocar
      const campos = { kiroPrevia: video ? { titulo: previa.titulo ?? null } : { titulo: previa.titulo ?? null, descricao: previa.descricao ?? null, imagem: previa.imagem ?? null } };
      // Cartão ainda no tamanho de partida cresce para caber a prévia.
      const altura = n.kiroRecolhido ? 'kiroAlturaAberta' : 'height';
      if (!video && !n.kiroAlturaFixa && n[altura] === F.tamanhoPadrao(n).height) campos[altura] = campos.kiroPrevia.imagem ? 240 : 150;
      if (!vivo) { s.historico = F.editarNoHistorico(s.historico, idNo, campos); opcoes.aoMudar(F.editarCartao(base, idNo, campos)); opcoes.redesenhar(); return; }
      canvas = F.editarCartao(canvas, idNo, campos);
      s.historico = F.editarNoHistorico(s.historico, idNo, campos);   // desfazer não apaga a prévia
      desenhar();
      opcoes.aoMudar(canvas);
    }
    async function adicionarNota(p) { const nota = await opcoes.escolherNota(); if (nota) adicionarNo({ type: 'file', file: nota.arquivo, width: 400, height: 280 }, p); }
    // Tamanho do tipo; o PDF novo entra recolhido (a barra de título), para não cobrir o fluxo.
    function cartaoDeArquivo(caminho) {
      const base = { type: 'file', file: caminho, ...F.tamanhoPadrao({ type: 'file', file: caminho }) };
      return F.tipoDoArquivo(caminho) === 'pdf' ? { ...base, kiroRecolhido: true, kiroAlturaAberta: base.height, height: F.ALTURA_RECOLHIDA } : base;
    }
    async function adicionarArquivo(p) { const caminho = await opcoes.escolherImagem(); if (caminho) adicionarNo(cartaoDeArquivo(caminho), p); }
    function abrirArquivo(idNo) { const c = no(idNo); if (c?.type === 'file' && F.caminhoSeguro(c.file)) opcoes.abrirArquivo(c.file, F.tipoDoArquivo(c.file), { pagina: s.paginasDoPdf.get(idNo) || 1, origem: raiz }); }
    async function adicionarLink(p) { const url = await opcoes.pedirLink(); if (url) novoLink(url, p); }
    function criarGrupo(p) {
      const sel = canvas.nodes.filter(n => s.selecao.has(n.id));
      const caixa = sel.length ? F.caixaDe(sel) : { x: p.x - 200, y: p.y - 150, width: 400, height: 300 };
      const r = F.adicionarCartao(canvas, { type: 'group', label: t('Grupo'), x: encaixar(caixa.x), y: encaixar(caixa.y), width: encaixarPraCima(caixa.width), height: encaixarPraCima(caixa.height) });
      // JSON Canvas: a ordem da lista é a ordem de empilhamento. adicionarCartao põe o grupo no
      // fim (topo); um viewer que respeite isso à risca (ao contrário do nosso desenhar()) o
      // desenharia por cima dos cartões (M4). Ele entra no índice 0 (fundo).
      const nodes = r.canvas.nodes;
      s.selecao = new Set([r.id]);
      mudar({ ...r.canvas, nodes: [nodes.at(-1), ...nodes.slice(0, -1)] });
      editarGrupo(r.id);
    }
    // Texto colado: URL sozinha vira link; o resto, cartão de texto com altura estimada.
    function colarTexto(texto, p) {
      const limpo = String(texto).trim();
      if (!limpo) return;
      if (/^https?:\/\/\S+$/i.test(limpo)) return void novoLink(limpo, p);
      adicionarNo({ type: 'text', text: limpo, width: 320, height: F.alturaEstimada(limpo) }, p);
    }
    // Editar texto: o editor do app (opcoes.montarEditor) ou, sem ele, um <textarea> no lugar do
    // conteúdo. Ao terminar, o cartão cresce se o texto renderizado não couber (nunca encolhe sozinho).
    function editar(idNo) {
      const c = no(idNo), el = elDoCartao(idNo);
      if (!c || c.type !== 'text' || !el) return;
      terminarEdicao();
      const conteudo = el.querySelector('.fluxo-conteudo');
      let campo = document.createElement('div');
      campo.className = 'fluxo-editor';
      conteudo.replaceChildren(campo);
      const ed = opcoes.montarEditor?.(campo, { texto: c.text }) || null;
      if (!ed) {
        campo = document.createElement('textarea');
        campo.className = 'fluxo-editor';
        campo.value = c.text;
        campo.setAttribute('aria-label', t('Texto do cartão'));
        conteudo.replaceChildren(campo);
      }
      const valor = () => (ed ? ed.texto() : campo.value);
      // Cartão sem altura fixada cresce com o texto, durante a edição (a medição só vale aqui) e ao
      // concluir; nunca fica menor que a altura de partida. Altura fixada à mão: o texto rola dentro.
      const altura0 = c.height;
      const rolagem = () => {
        const r = ed ? campo.querySelector('.cm-scroller') : campo;
        if (!r) return 0;
        // Com o cartão recolhido, scrollHeight é a altura do conteúdo (senão +24 realimentaria o crescimento).
        const h = el.style.height, topo = r.scrollTop;
        el.style.height = '0px';
        const v = r.scrollHeight;
        el.style.height = h; r.scrollTop = topo;
        return v;
      };
      const alturaNova = texto => encaixarPraCima(Math.max(altura0, alturaDoTexto(texto, c.width), rolagem() + 24));
      let quadro = 0;
      const crescer = () => {
        quadro = 0;
        const altura = alturaNova(valor());
        el.style.height = `${altura}px`;
        desenharSetas(F.redimensionar(canvas, idNo, c.width, altura));
      };
      el.classList.add('editando');
      let feito = false;
      const concluir = gravar => {
        if (feito) return;
        feito = true; editor = null;
        cancelAnimationFrame(quadro);
        const texto = valor(), atual = no(idNo);
        const altura = gravar && atual && !atual.kiroAlturaFixa ? alturaNova(texto) : atual?.height;
        ed?.destruir();
        if (!gravar || !atual || texto === atual.text) return void desenhar();
        let novo = F.editarCartao(canvas, idNo, { text: texto });
        if (altura !== atual.height) novo = F.redimensionar(novo, idNo, atual.width, altura);
        mudar(novo);
      };
      editor = { concluir, id: idNo };
      if (!c.kiroAlturaFixa) campo.addEventListener('input', () => { if (!quadro) quadro = requestAnimationFrame(crescer); });
      campo.addEventListener('keydown', e => {
        e.stopPropagation();   // Delete, Ctrl+Z etc. são do texto, não do fluxo
        if (e.key === 'Escape') { e.preventDefault(); concluir(true); raiz.focus({ preventScroll: true }); }
      });
      // Em captura: o Ctrl+Enter do CodeMirror marcaria a tarefa antes do ouvinte acima.
      const aoCriarVizinho = e => {
        const qual = atalhoDoEvento(e);
        if (!qual || e.repeat) return;
        e.preventDefault(); e.stopPropagation();
        concluir(true);
        criarVizinho(idNo, qual === 'ligado');
      };
      campo.addEventListener('keydown', aoCriarVizinho, true);
      // Sair do cartão grava (também quando o salvamento automático tira o foco: destino nulo).
      campo.addEventListener('focusout', e => { if (!campo.contains(e.relatedTarget)) concluir(true); });
      if (ed) ed.focar('fim'); else campo.focus();
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
      campo.setAttribute('aria-label', t('Rótulo da seta'));
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
      campo.setAttribute('aria-label', t('Nome do grupo'));
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
    // O app cria a nota e troca o cartão numa gravação própria (que redesenha a tela). O passo de
    // desfazer só entra no histórico se a troca realmente aconteceu: `transformarCartaoEmNota`
    // devolve false em qualquer caída no meio do caminho (busy, gravação falhou, cartão sumiu), e
    // empilhar mesmo assim criaria um desfazer que não desfaz nada e comeria o que dava pra refazer.
    // `s` é a sessão do fluxo (sobrevive ao remonte do editor pelos salvamentos), por isso o
    // `.then` ainda acerta o histórico certo mesmo depois da instância atual ter sido substituída.
    function transformarEmNota(idNo) {
      const c = no(idNo);
      if (!c || c.type !== 'text' || !c.text.trim()) return;
      terminarEdicao();
      const antes = canvas, texto = no(idNo).text;
      Promise.resolve(opcoes.transformarEmNota(idNo, texto)).then(ok => { if (ok) s.historico = F.empilhar(s.historico, antes); });
    }
    // ---- Menus do botão direito ----
    const NOMES_DAS_CORES = { '': t('Sem cor'), 1: t('Vermelho'), 2: t('Laranja'), 3: t('Amarelo'), 4: t('Verde'), 5: t('Ciano'), 6: t('Roxo') };
    const bolinha = cor => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" class="fluxo-bolinha"${corData(cor)} style="${corCss(cor)}"/></svg>`;
    const itensDaCor = aplicar => ['', ...F.CORES].map(cor => ({ rotulo: NOMES_DAS_CORES[cor], icone: bolinha(cor), acao: () => aplicar(cor || undefined) }));
    function menuDoFundo(p) {
      return [
        { rotulo: t('Adicionar cartão'), icone: opcoes.icone('mais'), acao: () => criarCartao(p) },
        { rotulo: t('Adicionar nota do cofre'), icone: opcoes.icone('nota'), acao: () => adicionarNota(p) },
        { rotulo: t('Adicionar arquivo'), icone: opcoes.icone('imagem'), acao: () => adicionarArquivo(p) },
        { rotulo: t('Adicionar link'), icone: opcoes.icone('link'), acao: () => adicionarLink(p) },
        { rotulo: s.selecao.size ? t('Agrupar seleção') : t('Criar grupo'), icone: opcoes.icone('pastas'), acao: () => criarGrupo(p) },
        { separador: true },
        { rotulo: t('Desfazer'), icone: opcoes.icone('desfazer'), ativo: () => s.historico.antes.length > 0, acao: desfazer },
        { rotulo: t('Refazer'), icone: opcoes.icone('refazer'), ativo: () => s.historico.depois.length > 0, acao: refazer },
        { rotulo: t('Colar'), icone: opcoes.icone('colar'), acao: () => navigator.clipboard.readText().then(texto => (areaDoFluxo?.texto === texto ? colarTrecho(areaDoFluxo.trecho, p) : colarTexto(texto, p)), () => opcoes.aviso(t('Não foi possível ler a área de transferência.'), true)) },
        { separador: true },
        { rotulo: t('Encaixar na grade'), icone: s.grade ? opcoes.icone('marcado') : '', acao: () => { s.grade = !s.grade; } },
        { rotulo: t('Enquadrar tudo'), icone: opcoes.icone('expandir'), acao: enquadrarTudo },
      ];
    }
    const arquivoDoMenu = idNo => { const c = no(idNo); return c?.type === 'file' && F.tipoDoArquivo(c.file) !== 'nota' && F.caminhoSeguro(c.file) ? c : null; };
    function menuDoArquivo(idNo) {
      const c = no(idNo);
      return [
        { rotulo: c.kiroRecolhido ? t('Mostrar conteúdo') : t('Recolher'), icone: opcoes.icone('direita'), acao: () => mudar(F.alternarRecolhido(canvas, idNo)) },
        ...(F.tipoDoArquivo(c.file) === 'audio' ? [] : [{ rotulo: t('Abrir'), icone: opcoes.icone('expandir'), acao: () => abrirArquivo(idNo) }]),
        ...(opcoes.abrirPdfNoSistema ? [{ rotulo: t('Abrir no programa do sistema'), icone: opcoes.icone('notas'), acao: () => opcoes.abrirPdfNoSistema(c.file) }] : []),
      ];
    }
    function menuDoCartao(idNo) {
      if (!s.selecao.has(idNo)) selecionar([idNo]);
      const ids = [...s.selecao];
      return [
        { rotulo: t('Cor'), icone: bolinha(no(idNo)?.color), filhos: itensDaCor(cor => mudar(ids.reduce((c, x) => F.editarCartao(c, x, { color: cor }), canvas))) },
        { rotulo: t('Copiar'), icone: opcoes.icone('copiar'), acao: () => { copiarSelecao(); } },
        { rotulo: t('Recortar'), icone: opcoes.icone('cortar'), acao: () => { mudar(F.removerCartoes(canvas, copiarSelecao())); } },
        { rotulo: t('Duplicar'), icone: opcoes.icone('copiar'), acao: duplicarSelecao },
        ...(ids.length === 1 && no(idNo)?.type === 'text' ? [{ rotulo: t('Editar texto'), icone: opcoes.icone('renomear'), acao: () => editar(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'text' && no(idNo).text.trim() ? [{ rotulo: t('Transformar em nota'), icone: opcoes.icone('nota'), acao: () => transformarEmNota(idNo) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'group' ? [{ rotulo: t('Renomear grupo'), icone: opcoes.icone('renomear'), acao: () => editarGrupo(idNo) }] : []),
        ...(ids.length === 1 && arquivoDoMenu(idNo) ? menuDoArquivo(idNo) : []),
        ...(ids.length === 1 && no(idNo)?.type === 'file' && F.tipoDoArquivo(no(idNo).file) === 'nota' ? [{ rotulo: t('Abrir nota'), icone: opcoes.icone('nota'), acao: () => opcoes.abrirNota(no(idNo).file) }] : []),
        ...(ids.length === 1 && no(idNo)?.type === 'link' ? [
          { rotulo: no(idNo).kiroRecolhido ? t('Mostrar conteúdo') : t('Recolher'), icone: opcoes.icone('direita'), acao: () => mudar(F.alternarRecolhido(canvas, idNo)) },
          { rotulo: t('Abrir link'), icone: opcoes.icone('link'), acao: () => opcoes.abrirLink(no(idNo).url) },
        ] : []),
        { separador: true },
        { rotulo: ids.length > 1 ? t('Excluir {n} cartões', { n: ids.length }) : t('Excluir'), icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerCartoes(canvas, ids)) },
      ];
    }
    function menuDaSeta(idSeta) {
      selecionarSeta(idSeta);
      const muda = campos => mudar(F.editarSeta(canvas, idSeta, campos));
      return [
        { rotulo: t('Cor'), icone: bolinha(canvas.edges.find(x => x.id === idSeta)?.color), filhos: itensDaCor(cor => muda({ color: cor })) },
        { rotulo: t('Direção'), icone: opcoes.icone('direita'), filhos: [
          { rotulo: t('Ponta no fim (→)'), icone: '→', acao: () => muda({ fromEnd: undefined, toEnd: undefined }) },
          { rotulo: t('Pontas nos dois lados (↔)'), icone: '↔', acao: () => muda({ fromEnd: 'arrow', toEnd: undefined }) },
          { rotulo: t('Sem pontas (—)'), icone: '—', acao: () => muda({ fromEnd: undefined, toEnd: 'none' }) },
        ] },
        { rotulo: t('Editar rótulo'), icone: opcoes.icone('renomear'), acao: () => editarRotulo(idSeta) },
        { separador: true },
        { rotulo: t('Excluir'), icone: opcoes.icone('lixeira'), acao: () => mudar(F.removerSetas(canvas, [idSeta])) },
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
    // Atalhos editáveis de criar balão: 'proximo' (abaixo da base) ou 'ligado' (à direita, com seta).
    function atalhoDoEvento(e) {
      const c = root.Kiro.combinacaoDoEvento(e);
      if (!c) return null;
      return c === opcoes.atalho?.('fluxoProximo') ? 'proximo' : c === opcoes.atalho?.('fluxoLigado') ? 'ligado' : null;
    }
    // Balão novo ao lado de idBase, já em edição. Sem base, cai no centro da vista.
    function criarVizinho(idBase, ligado) {
      const base = no(idBase);
      if (!base) return criarCartaoNoCentro();
      const largura = !ligado && base.type === 'text' ? base.width : 260;
      const pos = F.lugarLivre(canvas, ligado
        ? { x: base.x + base.width + 80, y: base.y, width: largura, height: 60 }
        : { x: base.x, y: base.y + base.height + F.GRADE, width: largura, height: 60 });
      const passo = F.adicionarCartao(canvas, { type: 'text', text: '', ...pos, width: largura, height: 60 });
      const novo = ligado ? F.ligar(passo.canvas, { fromNode: base.id, fromSide: 'right', toNode: passo.id, toSide: 'left' }).canvas : passo.canvas;
      s.selecao = new Set([passo.id]);
      mudar(novo);   // um passo só de desfazer para cartão + seta
      editar(passo.id);
    }

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
    // Guias de alinhamento: uma linha do acento por coincidência, dentro do .fluxo-mundo.
    const desenharGuias = linhas => {
      guias.innerHTML = linhas.map(l => `<div class="fluxo-guia" data-eixo="${l.eixo}" style="${l.eixo === 'x' ? `left:${l.pos}px;top:${l.de}px;height:${l.ate - l.de}px` : `top:${l.pos}px;left:${l.de}px;width:${l.ate - l.de}px`}"></div>`).join('');
    };
    const limparGuias = () => guias.replaceChildren();
    GESTOS.mover = {
      mover(g, e) {
        if (!andou(g, e)) return;
        const p = pontoDoCanvas(e), base = no(g.ids[0]);
        // Encaixa o cartão agarrado; os outros da seleção andam o mesmo tanto.
        g.dx = encaixar(base.x + p.x - g.p0.x) - base.x;
        g.dy = encaixar(base.y + p.y - g.p0.y) - base.y;
        g.previa = F.moverCartoes(canvas, g.ids, g.dx, g.dy);
        // A guia vence a grade: o que está sendo movido encaixa nos outros cartões (grupos não contam).
        const guia = F.guiasDeAlinhamento(F.caixaDe(g.previa.nodes.filter(x => g.ids.includes(x.id)), 0), canvas.nodes.filter(x => x.type !== 'group' && !g.ids.includes(x.id)), 6 / s.vista.zoom);
        if (guia.dx || guia.dy) { g.dx += guia.dx; g.dy += guia.dy; g.previa = F.moverCartoes(canvas, g.ids, g.dx, g.dy); }
        desenharGuias(guia.linhas);
        for (const idNo of g.ids) {
          const c = g.previa.nodes.find(x => x.id === idNo), el = elDoCartao(idNo);
          if (el) { el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; }
        }
        desenharSetas(g.previa);
      },
      soltar(g) { limparGuias(); if (g.previa && (g.dx || g.dy)) mudar(g.previa); },
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
        if (!depois || (depois.width === antes.width && depois.height === antes.height)) return;
        // Mexer na altura à mão a fixa: dali em diante o texto rola dentro do cartão em vez de esticá-lo.
        mudar(depois.height !== antes.height && antes.type === 'text' ? F.editarCartao(g.previa, g.id, { kiroAlturaFixa: true }) : g.previa);
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
      if (e.target.closest('.fluxo-barra, .fluxo-editor, .fluxo-abrir, .fluxo-seta-recolher, .fluxo-video-tocar')) return;
      raiz.focus({ preventScroll: true });
      // Sobre as áreas que rolam e os controles de áudio e vídeo só seleciona o cartão: sem capturar o ponteiro, a barra de rolagem e os controles funcionam.
      const paginas = e.button === 0 && !espaco && e.target.closest('.md-pdf-paginas, .fluxo-texto, .fluxo-tabela, audio, video');
      if (paginas) { const idNo = paginas.closest('.fluxo-cartao').dataset.no; if (!s.selecao.has(idNo)) selecionar([idNo]); return; }
      const g = escolherGesto(e);
      if (g) iniciar(e, g);
    });
    raiz.addEventListener('pointermove', e => { s.mouseNaTela = pontoDaTela(e); if (gesto) GESTOS[gesto.tipo].mover(gesto, e); });
    raiz.addEventListener('pointerup', e => { if (!gesto) return; const g = gesto; gesto = null; GESTOS[g.tipo].soltar(g, e); });
    raiz.addEventListener('pointercancel', () => { if (!gesto) return; gesto = null; previa.classList.remove('ativa'); marca.hidden = true; limparGuias(); desenhar(); aplicarVista(); });
    // Roda: rola (Shift = na horizontal); Ctrl+roda: zoom no cursor. Conteúdo longo de um
    // cartão rola dentro dele.
    raiz.addEventListener('wheel', e => {
      if (e.target.closest('.fluxo-editor') || (!e.ctrlKey && e.target.closest('.md-pdf-paginas, .fluxo-texto, .fluxo-tabela'))) return;   // páginas, texto e tabela rolam sozinhos
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
      if (c?.type === 'file' && F.tipoDoArquivo(c.file) !== 'nota') {
        // O áudio toca no cartão; no resto, dois cliques no corpo abrem a tela inteira.
        if (F.tipoDoArquivo(c.file) !== 'audio' && alvo.closest('.fluxo-arquivo-corpo')) abrirArquivo(c.id);
        return;
      }
      if (c?.type === 'file') return void opcoes.abrirNota(c.file);
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
    // Antes do Enter abaixo, que abriria a edição do cartão: o atalho de balão também usa Enter.
    raiz.addEventListener('keydown', e => {
      const qual = e.target === raiz && atalhoDoEvento(e);
      if (!qual) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;   // segurar o atalho não cria um cartão por repetição
      criarVizinho(s.selecao.size === 1 ? [...s.selecao][0] : null, qual === 'ligado');
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selecao.size) { e.preventDefault(); e.stopPropagation(); mudar(F.removerCartoes(canvas, [...s.selecao])); }
      else if (e.key === 'Enter' && s.selecao.size === 1) { e.preventDefault(); editar([...s.selecao][0]); }
      else if (e.key === 'Escape') selecionar([]);
      else if (e.key.startsWith('Arrow') && s.selecao.size) { e.preventDefault(); moverComSetas(e); }
    });
    raiz.addEventListener('keydown', e => {
      if (e.target !== raiz || !(e.ctrlKey || e.metaKey)) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); desfazer(); }
      else if (tecla === 'y' || (tecla === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); refazer(); }
      else if (tecla === 'a') { e.preventDefault(); selecionar(canvas.nodes.map(x => x.id)); }
      else if (tecla === 'd' && s.selecao.size) { e.preventDefault(); duplicarSelecao(); }
    });
    raiz.addEventListener('click', e => {
      if (e.target.closest('.fluxo-conteudo a')) e.preventDefault();
      const tocar = e.target.closest('.fluxo-video-tocar');
      if (tocar) { const corpo = tocar.closest('.fluxo-video-corpo'); corpo.innerHTML = videoIframeHtml(corpo.dataset.video); return; }
      const cartao = e.target.closest('.fluxo-arquivo-topo')?.closest('.fluxo-cartao');
      if (!cartao) return;
      if (e.target.closest('.fluxo-abrir')) { const c = no(cartao.dataset.no); if (c?.type === 'link') { const idVideo = F.idDoYoutube(c.url); if (idVideo && opcoes.abrirVideo) opcoes.abrirVideo(idVideo, raiz); else opcoes.abrirLink(c.url); } else abrirArquivo(cartao.dataset.no); }
      else if (e.target.closest('.fluxo-seta-recolher')) mudar(F.alternarRecolhido(canvas, cartao.dataset.no));
    });
    // Página do PDF que está no topo, guardada na sessão: o scroll não borbulha, daí a captura.
    raiz.addEventListener('scroll', e => {
      const caixa = e.target;
      if (caixa.closest?.('[data-reusar]')) s.rolagens.set(caixa, [caixa.scrollTop, caixa.scrollLeft]);   // o elemento solto do DOM perde a rolagem
      if (!caixa.matches?.('.md-pdf-paginas') || !caixa.children.length) return;
      s.paginasDoPdf.set(caixa.closest('.fluxo-cartao').dataset.no, [...caixa.children].filter(p => p.offsetTop - (p.offsetParent === caixa ? 0 : caixa.offsetTop) <= caixa.scrollTop + 4).length || 1);
    }, true);
    raiz.querySelector('.fluxo-barra').addEventListener('click', e => {
      const acao = e.target.closest('[data-fluxo-acao]')?.dataset.fluxoAcao;
      if (acao === 'enquadrar') enquadrarTudo();
      if (acao === 'cartao') criarCartaoNoCentro();
      if (acao === 'nota') adicionarNota(centroDaVista());
      if (acao === 'imagem') adicionarArquivo(centroDaVista());
    });
    // Nota arrastada da árvore vira cartão no ponto onde foi solta. stopPropagation: senão a
    // área das colunas (bindDragDeAbas) trataria o mesmo arraste e abriria a nota numa coluna.
    const eNota = e => e.dataTransfer?.types.includes('text/kiro-nota');
    const eArquivo = e => e.dataTransfer?.types.includes('Files');
    raiz.addEventListener('dragover', e => {
      if (!eNota(e) && !eArquivo(e)) return;
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
      if (!eNota(e) && !eArquivo(e)) return;
      e.preventDefault(); e.stopPropagation();
      raiz.classList.remove('soltando');
      if (!eNota(e)) {   // arquivo do sistema
        const arquivos = opcoes.arquivosDoEvento(e.dataTransfer);
        return void (arquivos.length ? colarArquivos(arquivos, pontoDoCanvas(e)) : opcoes.aviso(t('Esse tipo de arquivo não cabe no Fluxo.'), true));
      }
      const arquivo = opcoes.arquivoDaNota(e.dataTransfer.getData('text/kiro-nota'));
      if (arquivo) adicionarNo({ type: 'file', file: arquivo, width: 400, height: 280 }, pontoDoCanvas(e));
    });
    // Colar com o fluxo em foco (fora da edição de um cartão): imagem → anexo → cartão de imagem;
    // URL sozinha → link; texto → cartão de texto. Tudo no centro da vista.
    async function colarArquivos(arquivos, p) {
      for (const [i, arquivo] of arquivos.entries()) {
        const caminho = await opcoes.guardarImagem(arquivo);
        if (caminho) adicionarNo(cartaoDeArquivo(caminho), { x: p.x + i * F.GRADE * 2, y: p.y + i * F.GRADE * 2 });
      }
    }
    // Copiar e recortar: o trecho vai para `areaDoFluxo` e o texto dos cartões para a área de
    // transferência (colar fora do Kiro dá texto). Recortar é copiar e remover num passo só.
    function copiarSelecao(e) {
      const ids = comConteudo([...s.selecao]), trecho = F.copiarCartoes(canvas, ids), texto = F.textoDoTrecho(trecho);
      areaDoFluxo = { trecho, texto };
      if (e) { e.preventDefault(); e.clipboardData.setData('text/plain', texto); }
      else navigator.clipboard.writeText(texto).catch(() => opcoes.aviso(t('Não foi possível copiar.'), true));   // pelo menu: não há evento de cópia
      return ids;
    }
    raiz.addEventListener('copy', e => { if (editor || e.target !== raiz || !s.selecao.size) return; copiarSelecao(e); });
    raiz.addEventListener('cut', e => { if (editor || e.target !== raiz || !s.selecao.size) return; mudar(F.removerCartoes(canvas, copiarSelecao(e))); });
    function duplicarSelecao() {
      const r = F.duplicarCartoes(canvas, comConteudo([...s.selecao]));
      selecionar(r.ids);
      mudar(r.canvas);
    }
    // Cola o trecho com o centro em p (encaixado na grade). Colar de novo no mesmo ponto desce
    // um degrau na diagonal a cada vez, para o novo conjunto não cair em cima do anterior.
    function colarTrecho(trecho, p) {
      if (!trecho.nodes.length) return;
      const repete = s.ultimaColagem && s.ultimaColagem.x === p.x && s.ultimaColagem.y === p.y;
      s.ultimaColagem = { x: p.x, y: p.y, n: repete ? s.ultimaColagem.n + 1 : 0 };
      const caixa = F.caixaDe(trecho.nodes, 0), passo = s.ultimaColagem.n * F.GRADE * 2;
      const r = F.colarCartoes(canvas, trecho, encaixar(p.x - caixa.width / 2) + passo, encaixar(p.y - caixa.height / 2) + passo);
      selecionar(r.ids);
      mudar(r.canvas);
    }
    // Setas movem a seleção; as seguidas (menos de 500 ms) valem um só passo de desfazer.
    function moverComSetas(e) {
      const passo = F.GRADE * (e.shiftKey ? 5 : 1);
      const dx = { ArrowLeft: -passo, ArrowRight: passo }[e.key] || 0, dy = { ArrowUp: -passo, ArrowDown: passo }[e.key] || 0;
      const novo = F.moverCartoes(canvas, comConteudo([...s.selecao]), dx, dy), agora = Date.now();
      if (agora - s.ultimaSeta < 500) { canvas = novo; desenhar(); opcoes.aoMudar(canvas); }
      else mudar(novo);
      s.ultimaSeta = agora;
    }
    raiz.addEventListener('paste', e => {
      if (editor || e.target !== raiz || !e.clipboardData) return;
      const copiado = e.clipboardData.getData('text/plain');
      if (copiado && areaDoFluxo?.texto === copiado) {
        e.preventDefault();
        return void colarTrecho(areaDoFluxo.trecho, s.mouseNaTela ? F.paraCanvas(s.vista, s.mouseNaTela.x, s.mouseNaTela.y) : centroDaVista());
      }
      const arquivos = opcoes.arquivosDoEvento(e.clipboardData);
      if (arquivos.length) { e.preventDefault(); return void colarArquivos(arquivos, centroDaVista()); }
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
    // Primeira abertura: cartões de texto com a altura ainda igual à estimativa do Kiro (da IA,
    // ou de outro editor que nunca tocou neles) crescem até caber o conteúdo. Um cartão com
    // altura diferente da estimativa — fixada por quem editou, no Kiro ou no Obsidian (onde
    // altura fixa e rolagem são normais) — fica como está: só cresce quem ainda não teve chance
    // de se ajustar. Fora do desfazer, porque não é uma edição de quem usa. A vista é guardada
    // já, para isto não se repetir a cada abertura.
    // ponytail: um cartão que cresce pode encostar no de baixo; refazer o layout se incomodar.
    if (primeiraVez) {
      let ajustado = canvas;
      for (const c of canvas.nodes) {
        if (c.type !== 'text' || c.height !== F.tamanhoPadrao(c).height) continue;
        const altura = alturaDoTexto(c.text, c.width);
        if (altura > c.height) ajustado = F.redimensionar(ajustado, c.id, c.width, encaixarPraCima(altura));
      }
      if (ajustado !== canvas) { canvas = ajustado; desenhar(); enquadrarTudo(); opcoes.aoMudar(canvas); }
      else guardarVista();
    }
    // `.app-shell` ainda pode estar inert aqui (setBusy só volta depois do render): focar de
    // verdade só depois do quadro atual, quando o `finally` do `save()` já tirou o inert.
    if (s.foco) { s.foco = false; requestAnimationFrame(() => { if (document.contains(raiz)) raiz.focus({ preventScroll: true }); }); }
    return inst;
  }
  function desmontarTodos() { for (const m of [...montados]) m.desmontar(); }
  const ocupado = () => [...montados].some(m => m.ocupado());
  root.KiroFluxoTela = { montar, desmontarTodos, ocupado, tabelaHtml, textoLimitado, videoIframeHtml };
})(globalThis);
