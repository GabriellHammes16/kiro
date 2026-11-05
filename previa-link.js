// Prévia de um link (título, descrição e imagem) lida do HTML da página. Pura: roda no Node
// (ligacao-previa.cjs, testes) e no navegador (root.KiroPrevia), como fluxo.js.
(function (root) {
  const LIMITE_DO_HTML = 512 * 1024;
  const LIMITE_DO_TITULO = 200;
  const LIMITE_DA_DESCRICAO = 300;
  const NOMEADAS = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

  // Uma passada só: "&amp;lt;" vira "&lt;", não "<".
  function decodificar(texto) {
    return texto.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (todo, dec, hex, nome) => {
      if (nome) return NOMEADAS[nome.toLowerCase()] ?? todo;
      const codigo = dec ? Number(dec) : parseInt(hex, 16);
      return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo;
    });
  }
  const limpar = (texto, limite) => {
    const r = decodificar(String(texto ?? '')).replace(/\s+/g, ' ').trim();
    return r ? r.slice(0, limite) : null;
  };

  // <meta ...>: atributos com aspas duplas, simples ou sem aspas, em qualquer ordem.
  function metas(html) {
    const mapa = new Map();
    for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = {};
      for (const [, nome, a, b, c] of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs[nome.toLowerCase()] = a ?? b ?? c;
      const chave = (attrs.property || attrs.name || '').toLowerCase();
      if (chave && attrs.content !== undefined && !mapa.has(chave)) mapa.set(chave, attrs.content);
    }
    return mapa;
  }

  // Só imagem https: absoluta; relativa se resolve pela base. http:, data: e o resto viram null.
  function enderecoDaImagem(valor, base) {
    const v = limpar(valor, 2048);
    if (!v) return null;
    try { const u = new URL(v, base); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
  }

  // { titulo, descricao, imagem }: cada campo é string ou null.
  function lerPrevia(html, base) {
    const texto = String(html ?? '').slice(0, LIMITE_DO_HTML);
    const m = metas(texto);
    const primeiro = (...chaves) => chaves.map(k => limpar(m.get(k), Infinity)).find(Boolean) ?? null;
    const doTitulo = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(texto) || [])[1];
    const titulo = primeiro('og:title', 'twitter:title') ?? limpar(doTitulo, Infinity);
    const descricao = primeiro('og:description', 'twitter:description', 'description');
    const imagem = ['og:image', 'twitter:image'].map(k => enderecoDaImagem(m.get(k), base)).find(Boolean) ?? null;
    return { titulo: titulo && titulo.slice(0, LIMITE_DO_TITULO), descricao: descricao && descricao.slice(0, LIMITE_DA_DESCRICAO), imagem };
  }

  const api = { lerPrevia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroPrevia = api;
})(globalThis);
