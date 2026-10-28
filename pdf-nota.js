// pdf-nota.js — PDF em nota rasterizado aqui, nunca pelo visor nativo do webview.
// Mesmo desenho do "pdfembed" do OpenSIDian (src-tauri/src/pdf.rs + ui/editor.js):
// o webview só vê pixels. Cada ![[arquivo.pdf]] vira uma moldura com cabeçalho e uma
// caixa de rolagem de páginas; cada página é um <img> de um canvas do PDF.js, pedido
// só quando rola perto da vista — N embeds nunca custam N x memória.
// Limites: a página nunca é rasterizada além de LARGURA_MAX px; os caches são
// limitados (documentos abertos e bytes de imagens), como os deles.
(() => {
  const LARGURA_MAX = 2048;                    // px: teto da rasterização (igual ao deles)
  const MARGEM_DE_ROLAGEM = '600px';           // quanto antes de entrar na vista a página é feita
  const CACHE_DE_DOCUMENTOS = 4;               // PDFs abertos por vez (MRU)
  const CACHE_DE_IMAGENS = 32 * 1024 * 1024;   // bytes de imagens em cache (igual ao deles)
  const t = globalThis.KiroIdiomas?.t || (f => f);

  const docs = new Map();        // caminho → promessa do documento (MRU pela ordem)
  const imagens = new Map();     // "caminho#página@largura" → { url, bytes, promessa }
  let bytesEmCache = 0;

  const urlDoAnexo = caminho => {
    const partes = String(caminho).split('/').map(encodeURIComponent).join('/');
    return window.cadernoDesktop ? `kiro-anexo://cofre/${partes}` : `/anexo/${partes}`;
  };

  // Worker CLÁSSICO criado aqui e passado por workerPort: o PDF.js v4 tentaria um worker
  // de módulo e, se falhar, um import() dinâmico — nenhum dos dois atravessa o esquema
  // kiro-plugin em file:// (a CSP da página tem script-src 'self'). Um Worker(...) sem
  // type:module é o mesmo caminho que o worker de plug-ins já usa e que o worker-src permite.
  function prepararBiblioteca() {
    const lib = globalThis.pdfjsLib;
    if (!lib) throw new Error('PDF.js não carregado.');
    const opcoes = lib.GlobalWorkerOptions;
    if (!opcoes.workerPort && !opcoes.workerSrc) {
      const caminho = window.cadernoDesktop
        ? 'kiro-plugin://kiro.app/vendor/pdfjs/pdf.worker.min.js'
        : '/vendor/pdfjs/pdf.worker.min.js';
      opcoes.workerPort = new Worker(caminho);
    }
    return lib;
  }

  function tocar(caminho) {           // MRU: o documento acessado vai para o fim da fila
    const i = [...docs.keys()].indexOf(caminho);
    if (i >= 0) docs.set(caminho, docs.get(caminho));  // reinsert = fim do Map
  }
  function envelhecer() {
    while (docs.size > CACHE_DE_DOCUMENTOS) {
      const [velho, promessa] = docs.entries().next().value;
      docs.delete(velho);
      promessa?.then(doc => doc?.destroy()).catch(() => { /* já morreu */ });
    }
  }
  function documento(caminho) {
    if (!docs.has(caminho)) {
      const promessa = prepararBiblioteca()
        .getDocument({ url: urlDoAnexo(caminho), isEvalSupported: false })
        .promise;
      docs.set(caminho, promessa);
      promessa.catch(() => docs.delete(caminho));   // erro de leitura não fica guardado
      envelhecer();
    } else tocar(caminho);
    return docs.get(caminho);
  }

  function esvaziarImagens() {
    for (const [chave, entrada] of imagens) {
      if (bytesEmCache <= CACHE_DE_IMAGENS) break;
      if (!entrada.url) continue;                   // ainda em render: fica
      URL.revokeObjectURL(entrada.url);
      imagens.delete(chave);
      bytesEmCache -= entrada.bytes;
    }
  }
  async function pagina(doc, caminho, numero, largura) {
    const chave = `${caminho}#${numero}@${largura}`;
    if (!imagens.has(chave)) {
      const entrada = { url: null, bytes: 0, promessa: null };
      entrada.promessa = (async () => {
        const pagina = await doc.getPage(numero);
        const base = pagina.getViewport({ scale: 1 });
        const escala = Math.min(LARGURA_MAX, largura) / base.width;
        const vp = pagina.getViewport({ scale: escala });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const contexto = canvas.getContext('2d', { alpha: false });
        await pagina.render({ canvasContext: contexto, viewport: vp }).promise;
        const blob = await new Promise((ok, erro) =>
          canvas.toBlob(b => (b ? ok(b) : erro(new Error('Canvas vazio.'))), 'image/png'));
        canvas.width = canvas.height = 0;           // solta o canvas; fica só o blob
        entrada.url = URL.createObjectURL(blob);
        entrada.bytes = blob.size;
        bytesEmCache += entrada.bytes;
        esvaziarImagens();
        return entrada.url;
      })();
      imagens.set(chave, entrada);
      entrada.promessa.catch(() => imagens.delete(chave));
    }
    return imagens.get(chave).promessa;
  }

  async function desenharSlot(doc, caminho, caixa, slot) {
    if (!slot || slot.dataset.desenhada) return;
    slot.dataset.desenhada = '1';
    try {
      const largura = Math.round(caixa.clientWidth * Math.min(2, window.devicePixelRatio || 1)) || 640;
      const url = await pagina(doc, caminho, Number(slot.dataset.pagina), largura);
      if (!caixa.isConnected) return;               // a nota fechou no meio do render
      const img = new Image();
      img.alt = '';
      img.src = url;
      slot.style.aspectRatio = '';                  // a altura real vem da imagem
      slot.replaceChildren(img);
    } catch {
      slot.dataset.desenhada = '';                  // uma tentativa nova não custa nada
      slot.classList.add('md-pdf-pagina-erro');
    }
  }

  function carregar(raiz) {
    if (raiz.dataset.pdfCarregado) return;
    raiz.dataset.pdfCarregado = '1';
    raiz.classList.remove('md-pdf-quebrado');
    const caminho = raiz.dataset.pdf;
    const caixa = raiz.querySelector('.md-pdf-paginas');
    if (!caminho || !caixa) return;
    documento(caminho).then(async doc => {
      const total = doc.numPages;
      const rotulo = raiz.querySelector('.md-pdf-total');
      if (rotulo) rotulo.textContent = ` · ${t('{n} páginas', { n: total })}`;
      // A página 1 dá a proporção: as casas vazias já nascem com altura certa,
      // então a rolagem e o salto do #page=N ficam exatos antes de qualquer render.
      const primeira = await doc.getPage(1);
      const v1 = primeira.getViewport({ scale: 1 });
      if (!caixa.isConnected) return;
      caixa.replaceChildren();
      const slots = [];
      for (let n = 1; n <= total; n++) {
        const slot = document.createElement('div');
        slot.className = 'md-pdf-pagina';
        slot.dataset.pagina = String(n);
        slot.style.aspectRatio = `${v1.width} / ${v1.height}`;
        caixa.appendChild(slot);
        slots.push(slot);
      }
      // Salta para a página do #page=N: ela é feita na hora, as demais à medida
      // que se aproximam da vista (IntersectionObserver enxerga o scroller).
      const inicial = Math.min(total, Math.max(1, Number(raiz.dataset.pagina) || 1));
      const alvo = slots[inicial - 1];
      const observador = new IntersectionObserver(entradas => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          observador.unobserve(entrada.target);
          desenharSlot(doc, caminho, caixa, entrada.target);
        }
      }, { root: caixa, rootMargin: MARGEM_DE_ROLAGEM });
      await desenharSlot(doc, caminho, caixa, alvo);
      if (caixa.isConnected && alvo) caixa.scrollTop = alvo.offsetTop;
      for (const slot of slots) if (slot !== alvo) observador.observe(slot);
    }).catch(() => { delete raiz.dataset.pdfCarregado; raiz.classList.add('md-pdf-quebrado'); });
  }

  function montar(raiz) {
    if (raiz.dataset.pdfAtivo) return;
    raiz.dataset.pdfAtivo = '1';
    raiz.addEventListener('toggle', () => { if (raiz.open) carregar(raiz); });
    if (raiz.open) carregar(raiz);
  }

  function ativar(ancora) {
    if (!(ancora instanceof Element)) return;
    if (ancora.matches?.('.md-pdf')) montar(ancora);
    for (const filho of ancora.querySelectorAll?.('.md-pdf') || []) montar(filho);
  }

  // O HTML da moldura vem do app.js (htmlDoPdf); quem chama ativar é este observador:
  // cobre o widget do editor e a leitura, sem o app precisar acoplar com este módulo.
  const observadorDeMutacoes = new MutationObserver(mutacoes => {
    for (const mutacao of mutacoes) for (const no of mutacao.addedNodes) if (no.nodeType === 1) ativar(no);
  });
  function iniciar() {
    if (!document.body || document.body.dataset.pdfNota) return;
    document.body.dataset.pdfNota = '1';
    observadorDeMutacoes.observe(document.body, { childList: true, subtree: true });
    ativar(document.body);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  globalThis.KiroPdf = { ativar, urlDoAnexo };
})();
