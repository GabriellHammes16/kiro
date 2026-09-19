// Abas e tela dividida da tela de Pastas: só o modelo, sem DOM. Imutável: toda
// função devolve um estado novo. Roda no navegador (KiroAbas) e no Node (testes).
(function (root) {
  const RASCUNHO = 'kiro:rascunho';   // nota nova ainda sem id
  const vazio = () => ({ paineis: [{ abas: [], ativa: null }], ativo: 0, proporcao: 0.5 });
  const limitar = p => (Number.isFinite(p) ? Math.min(0.8, Math.max(0.2, p)) : 0.5);
  const copia = e => ({ ...e, paineis: e.paineis.map(p => ({ abas: [...p.abas], ativa: p.ativa })) });
  const ondeEsta = (e, id) => e.paineis.findIndex(p => p.abas.includes(id));

  // Metade vazia, com duas metades, some; a ativa de cada metade sempre existe nela.
  function arrumar(e) {
    const r = copia(e);
    for (const p of r.paineis) if (!p.abas.includes(p.ativa)) p.ativa = p.abas.at(-1) ?? null;
    if (r.paineis.length === 2) {
      const vazia = r.paineis.findIndex(p => !p.abas.length);
      if (vazia !== -1) { r.paineis.splice(vazia, 1); r.ativo = 0; }
    }
    if (r.ativo >= r.paineis.length) r.ativo = 0;
    return r;
  }

  function ativar(e, painel, id) {
    const r = copia(e);
    if (!r.paineis[painel]?.abas.includes(id)) return e;
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

  function mover(e, de, id, para) {
    if (de === para || !e.paineis[de]?.abas.includes(id) || (para !== 0 && para !== 1)) return e;
    // A única aba da única metade não tem para onde ir.
    if (e.paineis.length === 1 && e.paineis[0].abas.length === 1) return e;
    const r = copia(e);
    const origem = r.paineis[de];
    origem.abas.splice(origem.abas.indexOf(id), 1);
    if (!r.paineis[para]) r.paineis[para] = { abas: [], ativa: null };
    r.paineis[para].abas.push(id);
    r.paineis[para].ativa = id;
    r.ativo = para;
    return arrumar(r);
  }

  function trocarId(e, antigo, novo) {
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
    if (!e || typeof e !== 'object' || !Array.isArray(e.paineis) || !e.paineis.length || e.paineis.length > 2) return vazio();
    const vistos = new Set();
    const paineis = e.paineis.map(p => {
      const abas = (Array.isArray(p?.abas) ? p.abas : []).filter(id => typeof id === 'string' && (existe.has(id) || id === RASCUNHO) && !vistos.has(id) && vistos.add(id));
      return { abas, ativa: abas.includes(p?.ativa) ? p.ativa : abas.at(-1) ?? null };
    });
    const ativo = Number.isInteger(e.ativo) && e.ativo >= 0 && e.ativo < paineis.length ? e.ativo : 0;
    return arrumar({ paineis, ativo, proporcao: limitar(e.proporcao) });
  }

  const proporcao = (e, p) => ({ ...copia(e), proporcao: limitar(Number(p)) });
  const notaAtiva = e => e.paineis[e.ativo]?.ativa ?? null;

  const api = { RASCUNHO, vazio, abrir, ativar, fechar, fecharOutras, mover, trocarId, limpar, proporcao, notaAtiva };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroAbas = api;
})(globalThis);
