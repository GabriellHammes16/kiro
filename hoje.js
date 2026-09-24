// Layout da tela Hoje: só o modelo, sem DOM. Imutável: toda função devolve um layout novo
// (ou o mesmo objeto, quando nada muda). Roda no navegador (KiroHoje) e no Node (testes).
//
// { colunas: 1–3, cartoes: [{ id, coluna, largura: 'normal'|'inteira', opcoes: {…} }, …], ocultos: [id…] }
// A ordem em `cartoes` é a ordem de leitura; `faixas` transforma isso no que a tela desenha.
// O catálogo ({ id, coluna?, largura?, opcoes? }) vem de fora: cartões do Kiro e dos plug-ins.
(function (root) {
  const MIN_COLUNAS = 1, MAX_COLUNAS = 3, PADRAO_COLUNAS = 2, MAX_CARTOES = 200;
  const LARGURAS = ['normal', 'inteira'];
  const vazio = () => ({ colunas: PADRAO_COLUNAS, cartoes: [], ocultos: [] });
  const copia = l => ({ colunas: l.colunas, cartoes: l.cartoes.map(c => ({ ...c, opcoes: { ...c.opcoes } })), ocultos: [...l.ocultos] });
  const primitivo = v => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const colunaValida = (c, colunas) => Number.isInteger(c) && c >= 0 && c < colunas;

  // Fim de uma coluna: logo depois do último cartão normal dela (ou no fim de tudo).
  function posicaoNoFim(cartoes, coluna) {
    for (let i = cartoes.length - 1; i >= 0; i--) if (cartoes[i].largura === 'normal' && cartoes[i].coluna === coluna) return i + 1;
    return cartoes.length;
  }

  // Quem está no catálogo e não está no layout entra: na coluna pedida ou na mais curta
  // (contando só os visíveis). Quem saiu do catálogo fica guardado, sem aparecer.
  function reconciliar(l, catalogo) {
    const noLayout = new Set(l.cartoes.map(c => c.id));
    const novos = catalogo.filter(e => !noLayout.has(e.id));
    if (!novos.length) return l;
    const r = copia(l);
    const noCatalogo = new Set(catalogo.map(e => e.id));
    for (const e of novos) {
      const largura = e.largura === 'inteira' ? 'inteira' : 'normal';
      let coluna = colunaValida(e.coluna, r.colunas) ? e.coluna : null;
      if (coluna === null) {
        const conta = Array.from({ length: r.colunas }, (_, i) => r.cartoes.filter(c => c.largura === 'normal' && c.coluna === i && noCatalogo.has(c.id) && !r.ocultos.includes(c.id)).length);
        coluna = conta.indexOf(Math.min(...conta));
      }
      r.cartoes.splice(largura === 'inteira' ? r.cartoes.length : posicaoNoFim(r.cartoes, coluna), 0, { id: e.id, coluna, largura, opcoes: {} });
    }
    return r;
  }
  const padrao = catalogo => reconciliar(vazio(), catalogo);

  // Leva o cartão para antes de `antes` (ou para o fim da coluna). Serve ao arraste e às setas.
  function mover(l, id, { coluna, antes = null } = {}) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1 || id === antes) return l;
    const r = copia(l);
    const [cartao] = r.cartoes.splice(i, 1);
    if (Number.isInteger(coluna)) cartao.coluna = Math.max(0, Math.min(r.colunas - 1, coluna));
    const j = antes === null ? -1 : r.cartoes.findIndex(c => c.id === antes);
    r.cartoes.splice(j !== -1 ? j : cartao.largura === 'inteira' ? r.cartoes.length : posicaoNoFim(r.cartoes, cartao.coluna), 0, cartao);
    return r;
  }

  // Vizinho na leitura: um cartão normal troca com o anterior/próximo visível da mesma coluna
  // ou com um cartão inteiro (atravessa a faixa); um cartão inteiro troca com qualquer visível.
  function trocar(l, id, visiveis, passo) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1) return l;
    const eu = l.cartoes[i];
    const conta = c => visiveis.has(c.id) && (eu.largura === 'inteira' || c.largura === 'inteira' || c.coluna === eu.coluna);
    let j = i + passo;
    while (j >= 0 && j < l.cartoes.length && !conta(l.cartoes[j])) j += passo;
    if (j < 0 || j >= l.cartoes.length) return l;
    const r = copia(l);
    [r.cartoes[i], r.cartoes[j]] = [r.cartoes[j], r.cartoes[i]];
    return r;
  }
  const subir = (l, id, visiveis) => trocar(l, id, visiveis, -1);
  const descer = (l, id, visiveis) => trocar(l, id, visiveis, 1);

  const esconder = (l, id) => !l.cartoes.some(c => c.id === id) || l.ocultos.includes(id) ? l : { ...copia(l), ocultos: [...l.ocultos, id] };
  const mostrar = (l, id) => l.ocultos.includes(id) ? { ...copia(l), ocultos: l.ocultos.filter(x => x !== id) } : l;

  function definirLargura(l, id, largura) {
    const i = l.cartoes.findIndex(c => c.id === id);
    if (i === -1 || !LARGURAS.includes(largura) || l.cartoes[i].largura === largura) return l;
    const r = copia(l);
    r.cartoes[i].largura = largura;
    return r;
  }

  // Menos colunas: os cartões normais que ficaram sem coluna vão para o fim da última, na ordem.
  function definirColunas(l, n) {
    if (!Number.isInteger(n) || n < MIN_COLUNAS || n > MAX_COLUNAS || n === l.colunas) return l;
    const r = copia(l);
    r.colunas = n;
    const sobram = r.cartoes.filter(c => c.largura === 'normal' && c.coluna >= n);
    r.cartoes = r.cartoes.filter(c => !sobram.includes(c));
    for (const c of r.cartoes) if (c.coluna >= n) c.coluna = n - 1;   // inteiros guardam uma coluna válida
    for (const c of sobram) { c.coluna = n - 1; r.cartoes.splice(posicaoNoFim(r.cartoes, n - 1), 0, c); }
    return r;
  }

  function valorValido(o, v) {
    if (o.type === 'boolean') return typeof v === 'boolean';
    if (o.type === 'number') return typeof v === 'number' && Number.isFinite(v) && (o.min === undefined || v >= o.min) && (o.max === undefined || v <= o.max);
    if (o.type === 'select') return Array.isArray(o.choices) && o.choices.includes(v);
    if (o.type === 'text') return typeof v === 'string' && v.length <= 80;
    return false;
  }

  // Só grava o que a declaração aceita; voltar ao padrão apaga a chave (o arquivo guarda só o que mudou).
  function definirOpcao(l, id, chave, valor, declaracao = []) {
    const o = declaracao.find(x => x.key === chave);
    const i = l.cartoes.findIndex(c => c.id === id);
    if (!o || i === -1 || !valorValido(o, valor)) return l;
    const r = copia(l);
    if (valor === o.default) delete r.cartoes[i].opcoes[chave];
    else r.cartoes[i].opcoes[chave] = valor;
    return r;
  }

  function opcoesEfetivas(l, id, declaracao = []) {
    const guardadas = l.cartoes.find(c => c.id === id)?.opcoes || {};
    return Object.fromEntries(declaracao.map(o => [o.key, Object.hasOwn(guardadas, o.key) && valorValido(o, guardadas[o.key]) ? guardadas[o.key] : o.default]));
  }

  // O que vem do disco não é confiável. Os valores das opções só são conferidos contra a
  // declaração em opcoesEfetivas: o layout é lido antes de os plug-ins registrarem os painéis.
  function limpar(bruto) {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto) || !Array.isArray(bruto.cartoes)) return null;
    const colunas = Number.isInteger(bruto.colunas) && bruto.colunas >= MIN_COLUNAS && bruto.colunas <= MAX_COLUNAS ? bruto.colunas : PADRAO_COLUNAS;
    const vistos = new Set(), cartoes = [];
    for (const c of bruto.cartoes) {
      if (cartoes.length >= MAX_CARTOES) break;
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || c.id.length > 200 || vistos.has(c.id)) continue;
      vistos.add(c.id);
      const opcoes = c.opcoes && typeof c.opcoes === 'object' && !Array.isArray(c.opcoes) ? Object.fromEntries(Object.entries(c.opcoes).filter(([, v]) => primitivo(v))) : {};
      cartoes.push({ id: c.id, coluna: colunaValida(c.coluna, colunas) ? c.coluna : 0, largura: LARGURAS.includes(c.largura) ? c.largura : 'normal', opcoes });
    }
    const ocultos = [...new Set(Array.isArray(bruto.ocultos) ? bruto.ocultos : [])].filter(id => vistos.has(id));
    return { colunas, cartoes, ocultos };
  }

  // O que a tela desenha: normais seguidos formam uma faixa de colunas; cada inteiro, uma faixa própria.
  function faixas(l, visiveis) {
    const r = [];
    for (const c of l.cartoes) {
      if (!visiveis.has(c.id)) continue;
      if (c.largura === 'inteira') { r.push({ tipo: 'inteira', id: c.id }); continue; }
      let f = r.at(-1);
      if (!f || f.tipo !== 'colunas') r.push(f = { tipo: 'colunas', colunas: Array.from({ length: l.colunas }, () => []) });
      f.colunas[Math.min(c.coluna, l.colunas - 1)].push(c.id);
    }
    return r;
  }

  const api = { MIN_COLUNAS, MAX_COLUNAS, padrao, reconciliar, mover, subir, descer, esconder, mostrar, definirLargura, definirColunas, valorValido, definirOpcao, opcoesEfetivas, limpar, faixas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroHoje = api;
})(globalThis);
