// Abas e colunas da tela de Pastas: só o modelo, sem DOM. Imutável: toda função
// devolve um estado novo. Roda no navegador (KiroAbas) e no Node (testes).
//
// { paineis: [{ abas: [id…], ativa: id|null }, …], ativo: índice, larguras: [fração…] }
// Cada painel é uma coluna; `larguras` soma 1. Um id aparece no máximo uma vez.
(function (root) {
  const RASCUNHO = 'kiro:rascunho';   // nota nova ainda sem id
  const MAX_COLUNAS = 12;             // teto contra estado estranho; a tela limita pela largura
  const iguais = n => Array.from({ length: n }, () => 1 / n);
  const vazio = () => ({ paineis: [{ abas: [], ativa: null }], ativo: 0, larguras: [1] });
  const copia = e => ({ paineis: e.paineis.map(p => ({ abas: [...p.abas], ativa: p.ativa })), ativo: e.ativo, larguras: [...(e.larguras || iguais(e.paineis.length))] });
  const ondeEsta = (e, id) => e.paineis.findIndex(p => p.abas.includes(id));

  // Frações positivas somando 1, uma por coluna; qualquer coisa fora disso vira colunas iguais.
  function normalizar(lista, n) {
    if (!Array.isArray(lista) || lista.length !== n || !lista.every(x => Number.isFinite(x) && x > 0)) return iguais(n);
    const total = lista.reduce((a, b) => a + b, 0);
    return lista.map(x => x / total);
  }

  // Coluna vazia some (fica sempre pelo menos uma); a ativa de cada coluna existe nela;
  // o índice da coluna ativa acompanha as remoções. Mudou o número de colunas: larguras iguais.
  function arrumar(e) {
    const r = copia(e);
    for (const p of r.paineis) if (!p.abas.includes(p.ativa)) p.ativa = p.abas.at(-1) ?? null;
    const ficam = r.paineis.map((p, i) => i).filter(i => r.paineis[i].abas.length);
    if (ficam.length && ficam.length < r.paineis.length) {
      const antes = r.ativo;
      r.paineis = ficam.map(i => r.paineis[i]);
      r.ativo = ficam.includes(antes) ? ficam.indexOf(antes) : Math.max(0, ficam.filter(i => i < antes).length - 1);
      r.larguras = iguais(r.paineis.length);
    } else if (!ficam.length && r.paineis.length > 1) {
      r.paineis = [{ abas: [], ativa: null }];
      r.ativo = 0;
      r.larguras = [1];
    }
    if (r.ativo >= r.paineis.length || r.ativo < 0) r.ativo = 0;
    r.larguras = normalizar(r.larguras, r.paineis.length);
    return r;
  }

  function ativar(e, painel, id) {
    if (!e.paineis[painel]?.abas.includes(id)) return e;
    const r = copia(e);
    r.paineis[painel].ativa = id;
    r.ativo = painel;
    return r;
  }

  function abrir(e, id, { novaAba = false, painel } = {}) {
    const ja = ondeEsta(e, id);
    if (ja !== -1) return ativar(e, ja, id);
    const r = copia(e);
    const i = painel === undefined || !r.paineis[painel] ? r.ativo : painel;
    const p = r.paineis[i];
    const pos = p.abas.indexOf(p.ativa);
    if (novaAba || pos === -1) p.abas.splice(pos + 1, 0, id);
    else p.abas[pos] = id;
    p.ativa = id;
    r.ativo = i;
    return r;
  }

  function fechar(e, painel, id) {
    const p = e.paineis[painel];
    if (!p || !p.abas.includes(id)) return e;
    const r = copia(e), alvo = r.paineis[painel], pos = alvo.abas.indexOf(id);
    alvo.abas.splice(pos, 1);
    if (alvo.ativa === id) alvo.ativa = alvo.abas[pos] ?? alvo.abas[pos - 1] ?? null;
    return arrumar(r);
  }

  function fecharOutras(e, painel, id) {
    if (!e.paineis[painel]?.abas.includes(id)) return e;
    const r = copia(e);
    r.paineis[painel] = { abas: [id], ativa: id };
    r.ativo = painel;
    return r;
  }

  // Leva a aba `id` da coluna `de` para a coluna `para`. Com `nova`, cria uma coluna na
  // posição `para` (0 = primeira, paineis.length = depois da última) e põe a aba nela.
  function mover(e, de, id, para, { nova = false } = {}) {
    if (!e.paineis[de]?.abas.includes(id) || !Number.isInteger(para)) return e;
    if (nova ? para < 0 || para > e.paineis.length || e.paineis.length >= MAX_COLUNAS : para === de || !e.paineis[para]) return e;
    // Tirar a única aba de uma coluna para uma coluna nova vizinha a ela não muda nada.
    if (nova && e.paineis[de].abas.length === 1 && (para === de || para === de + 1)) return e;
    const r = copia(e);
    const origem = r.paineis[de];
    origem.abas.splice(origem.abas.indexOf(id), 1);
    let destino = para;
    if (nova) {
      r.paineis.splice(para, 0, { abas: [], ativa: null });
      r.larguras = iguais(r.paineis.length);
    }
    r.paineis[destino].abas.push(id);
    r.paineis[destino].ativa = id;
    r.ativo = destino;
    return arrumar(r);
  }

  function trocarId(e, antigo, novo) {
    if (antigo === novo) return e;
    if (ondeEsta(e, novo) !== -1) {
      const onde = ondeEsta(e, antigo);
      if (onde === -1) return e;
      const fechado = fechar(e, onde, antigo);
      return ativar(fechado, ondeEsta(fechado, novo), novo);
    }
    const r = copia(e);
    for (const p of r.paineis) {
      p.abas = p.abas.map(x => (x === antigo ? novo : x));
      if (p.ativa === antigo) p.ativa = novo;
    }
    return r;
  }

  // O que vem do localStorage é tratado como não confiável.
  function limpar(e, idsExistentes) {
    const existe = new Set(idsExistentes || []);
    if (!e || typeof e !== 'object' || !Array.isArray(e.paineis) || !e.paineis.length || e.paineis.length > MAX_COLUNAS) return vazio();
    const vistos = new Set();
    const paineis = e.paineis.map(p => {
      const abas = (Array.isArray(p?.abas) ? p.abas : []).filter(id => typeof id === 'string' && (existe.has(id) || id === RASCUNHO) && !vistos.has(id) && vistos.add(id));
      return { abas, ativa: abas.includes(p?.ativa) ? p.ativa : abas.at(-1) ?? null };
    });
    const ativo = Number.isInteger(e.ativo) && e.ativo >= 0 && e.ativo < paineis.length ? e.ativo : 0;
    // Formato antigo (até duas metades): `proporcao` era a largura da primeira.
    const antigas = Number.isFinite(e.proporcao) && paineis.length === 2 ? [e.proporcao, 1 - e.proporcao] : e.larguras;
    return arrumar({ paineis, ativo, larguras: normalizar(antigas, paineis.length) });
  }

  const larguras = (e, lista) => ({ ...copia(e), larguras: normalizar(lista, e.paineis.length) });
  const notaAtiva = e => e.paineis[e.ativo]?.ativa ?? null;

  const api = { RASCUNHO, MAX_COLUNAS, vazio, abrir, ativar, fechar, fecharOutras, mover, trocarId, limpar, larguras, notaAtiva };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroAbas = api;
})(globalThis);
