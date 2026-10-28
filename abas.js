// Abas e colunas da tela de Pastas: só o modelo, sem DOM. Imutável: toda função
// devolve um estado novo. Roda no navegador (KiroAbas) e no Node (testes).
//
// { paineis: [{ abas: [id…], ativa: id|null }, …], ativo: índice, larguras: [fração…] }
// Cada painel é uma coluna; `larguras` soma 1. Um id aparece no máximo uma vez *por coluna*:
// a mesma nota pode ocupar duas colunas (uma em edição, a outra em leitura).
(function (root) {
  const RASCUNHO = 'kiro:rascunho';   // nota nova ainda sem id
  const MAX_COLUNAS = 12;             // teto contra estado estranho; a tela limita pela largura
  const MAX_HISTORICO = 50;
  const iguais = n => Array.from({ length: n }, () => 1 / n);
  const vazio = () => ({ paineis: [{ abas: [], ativa: null }], ativo: 0, larguras: [1] });
  const criarHistPainel = id => id ? { entradas: [{ id, scroll: 0 }], indice: 0 } : { entradas: [], indice: -1 };
  const clonarHistPainel = h => h && Array.isArray(h.entradas)
    ? { entradas: h.entradas.map(x => ({ id: x.id, scroll: Number(x.scroll) || 0 })), indice: Number.isInteger(h.indice) ? h.indice : h.entradas.length - 1 }
    : { entradas: [], indice: -1 };
  const copia = e => {
    const r = { paineis: e.paineis.map(p => ({ abas: [...p.abas], ativa: p.ativa })), ativo: e.ativo, larguras: [...(e.larguras || iguais(e.paineis.length))] };
    if (Array.isArray(e.historico)) r.historico = e.historico.map(clonarHistPainel);
    if (Array.isArray(e.vinculos) && e.vinculos.length) r.vinculos = e.vinculos.map(par => [...par]);
    return r;
  };
  const empilharNoHistorico = (r, painel, id) => {
    if (!Array.isArray(r.historico) || !id) return;
    while (r.historico.length < r.paineis.length) r.historico.push({ entradas: [], indice: -1 });
    const h = clonarHistPainel(r.historico[painel]);
    const atual = h.entradas[h.indice];
    if (atual && atual.id === id) { r.historico[painel] = h; return; }
    const cortadas = h.entradas.slice(0, h.indice + 1);
    cortadas.push({ id, scroll: 0 });
    if (cortadas.length > MAX_HISTORICO) cortadas.shift();
    r.historico[painel] = { entradas: cortadas, indice: cortadas.length - 1 };
  };
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
      if (Array.isArray(r.historico)) r.historico = ficam.map(i => r.historico[i] || criarHistPainel(r.paineis[ficam.indexOf(i)]?.ativa));
      if (Array.isArray(r.vinculos)) {
        const mapa = new Map(ficam.map((antigo, novo) => [antigo, novo]));
        const novos = r.vinculos.filter(([a, b]) => mapa.has(a) && mapa.has(b)).map(([a, b]) => [mapa.get(a), mapa.get(b)]);
        if (novos.length) r.vinculos = novos; else delete r.vinculos;
      }
      r.ativo = ficam.includes(antes) ? ficam.indexOf(antes) : Math.max(0, ficam.filter(i => i < antes).length - 1);
      r.larguras = iguais(r.paineis.length);
    } else if (!ficam.length && r.paineis.length > 1) {
      r.paineis = [{ abas: [], ativa: null }];
      if (Array.isArray(r.historico)) r.historico = [{ entradas: [], indice: -1 }];
      delete r.vinculos;
      r.ativo = 0;
      r.larguras = [1];
    }
    if (r.ativo >= r.paineis.length || r.ativo < 0) r.ativo = 0;
    r.larguras = normalizar(r.larguras, r.paineis.length);
    return r;
  }

  function ativar(e, painel, id, { semHistorico = false, semVinculo = false } = {}) {
    if (!e.paineis[painel]?.abas.includes(id)) return e;
    const r = copia(e);
    r.paineis[painel].ativa = id;
    r.ativo = painel;
    if (!semHistorico) empilharNoHistorico(r, painel, id);
    if (!semVinculo && Array.isArray(r.vinculos)) {
      for (const par of r.vinculos) {
        const parceiro = par[0] === painel ? par[1] : par[1] === painel ? par[0] : -1;
        if (parceiro !== -1 && r.paineis[parceiro]) {
          const pp = r.paineis[parceiro];
          if (!pp.abas.includes(id)) {
            const pos = pp.abas.indexOf(pp.ativa);
            if (pos === -1) pp.abas.push(id); else pp.abas[pos] = id;
          }
          pp.ativa = id;
          empilharNoHistorico(r, parceiro, id);
        }
      }
    }
    return r;
  }

  // `duplicar` olha só a coluna alvo: a nota abre lá mesmo já estando noutra coluna (arrastar
  // da árvore). Sem ele, uma nota já aberta em qualquer coluna só é ativada (clique na árvore).
  // `colunaNova` cria a coluna na posição `painel` e abre a nota nela.
  function abrir(e, id, { novaAba = false, painel, duplicar = false, colunaNova = false, semVinculo = false } = {}) {
    if (colunaNova) {
      if (!Number.isInteger(painel) || painel < 0 || painel > e.paineis.length || e.paineis.length >= MAX_COLUNAS) return e;
      const r = copia(e);
      r.paineis.splice(painel, 0, { abas: [id], ativa: id });
      if (Array.isArray(r.historico)) r.historico.splice(painel, 0, criarHistPainel(id));
      if (Array.isArray(r.vinculos)) r.vinculos = r.vinculos.map(([a, b]) => [a >= painel ? a + 1 : a, b >= painel ? b + 1 : b]);
      r.larguras = iguais(r.paineis.length);
      r.ativo = painel;
      return r;
    }
    const alvo = painel === undefined || !e.paineis[painel] ? e.ativo : painel;
    const temVinculoAlvo = Array.isArray(e.vinculos) && e.vinculos.some(([a, b]) => a === alvo || b === alvo);
    const ja = (duplicar || temVinculoAlvo) ? (e.paineis[alvo].abas.includes(id) ? alvo : -1) : ondeEsta(e, id);
    if (ja !== -1) return ativar(e, ja, id, { semVinculo });
    const r = copia(e);
    const i = alvo;
    const p = r.paineis[i];
    const pos = p.abas.indexOf(p.ativa);
    if (novaAba || pos === -1) p.abas.splice(pos + 1, 0, id);
    else p.abas[pos] = id;
    p.ativa = id;
    r.ativo = i;
    empilharNoHistorico(r, i, id);
    if (!semVinculo && Array.isArray(r.vinculos)) {
      for (const par of r.vinculos) {
        const parceiro = par[0] === i ? par[1] : par[1] === i ? par[0] : -1;
        if (parceiro !== -1 && r.paineis[parceiro]) {
          const pp = r.paineis[parceiro];
          if (!pp.abas.includes(id)) {
            const ppos = pp.abas.indexOf(pp.ativa);
            if (ppos === -1) pp.abas.push(id); else pp.abas[ppos] = id;
          }
          pp.ativa = id;
          empilharNoHistorico(r, parceiro, id);
        }
      }
    }
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
      if (!r.abas && r.historico) { /* noop */ }
      r.paineis.splice(para, 0, { abas: [], ativa: null });
      if (Array.isArray(r.historico)) r.historico.splice(para, 0, { entradas: [], indice: -1 });
      if (Array.isArray(r.vinculos)) r.vinculos = r.vinculos.map(([a, b]) => [a >= para ? a + 1 : a, b >= para ? b + 1 : b]);
      r.larguras = iguais(r.paineis.length);
    }
    if (!r.paineis[destino].abas.includes(id)) r.paineis[destino].abas.push(id);
    r.paineis[destino].ativa = id;
    r.ativo = destino;
    empilharNoHistorico(r, destino, id);
    return arrumar(r);
  }

  // O rascunho virou nota real. Se a coluna já tinha essa nota, as duas abas viram uma só;
  // a mesma nota noutra coluna é legítima e continua lá.
  function trocarId(e, antigo, novo) {
    if (antigo === novo) return e;
    const r = copia(e);
    for (const p of r.paineis) {
      const vistos = new Set();
      p.abas = p.abas.map(x => (x === antigo ? novo : x)).filter(x => !vistos.has(x) && vistos.add(x));
      if (p.ativa === antigo) p.ativa = novo;
      if (!p.abas.includes(p.ativa)) p.ativa = p.abas.at(-1) ?? null;
    }
    if (Array.isArray(r.historico)) {
      for (const h of r.historico) for (const ent of h.entradas) if (ent.id === antigo) ent.id = novo;
    }
    return arrumar(r);
  }

  // O que vem do localStorage é tratado como não confiável.
  function limpar(e, idsExistentes) {
    const existe = new Set(idsExistentes || []);
    if (!e || typeof e !== 'object' || !Array.isArray(e.paineis) || !e.paineis.length || e.paineis.length > MAX_COLUNAS) return vazio();
    const paineis = e.paineis.map(p => {
      const vistos = new Set();
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

  // ---- Etapa 5: Histórico de navegação por coluna (Voltar / Avançar + Scroll) ----
  function comHistorico(e) {
    if (Array.isArray(e.historico) && e.historico.length === e.paineis.length) return e;
    const r = copia(e);
    r.historico = r.paineis.map((p, idx) => e.historico?.[idx] ? clonarHistPainel(e.historico[idx]) : criarHistPainel(p.ativa));
    return r;
  }
  function podeVoltar(e, painel = e.ativo) {
    const h = e.historico?.[painel];
    return Boolean(h && h.indice > 0);
  }
  function podeAvancar(e, painel = e.ativo) {
    const h = e.historico?.[painel];
    return Boolean(h && h.indice >= 0 && h.indice < h.entradas.length - 1);
  }
  function navegarHistorico(e, painel = e.ativo, delta = -1, idsExistentes = null) {
    const base = comHistorico(e);
    const h = base.historico[painel];
    if (!h) return e;
    const existe = idsExistentes ? new Set(idsExistentes) : null;
    let idx = h.indice + delta;
    while (idx >= 0 && idx < h.entradas.length) {
      const alvo = h.entradas[idx];
      if (!existe || existe.has(alvo.id) || alvo.id === RASCUNHO) {
        const r = copia(base);
        r.historico[painel].indice = idx;
        const p = r.paineis[painel];
        if (!p.abas.includes(alvo.id)) {
          const pos = p.abas.indexOf(p.ativa);
          if (pos === -1) p.abas.push(alvo.id); else p.abas[pos] = alvo.id;
        }
        p.ativa = alvo.id;
        r.ativo = painel;
        return r;
      }
      idx += delta < 0 ? -1 : 1;
    }
    return e;
  }
  const voltar = (e, painel = e.ativo, idsExistentes = null) => navegarHistorico(e, painel, -1, idsExistentes);
  const avancar = (e, painel = e.ativo, idsExistentes = null) => navegarHistorico(e, painel, 1, idsExistentes);
  function registrarScroll(e, painel = e.ativo, scroll = 0) {
    const base = comHistorico(e);
    const h = base.historico[painel];
    if (!h || h.indice < 0 || !h.entradas[h.indice]) return base;
    const r = copia(base);
    r.historico[painel].entradas[r.historico[painel].indice].scroll = Math.max(0, Number(scroll) || 0);
    return r;
  }
  function scrollAtivo(e, painel = e.ativo) {
    const h = e.historico?.[painel];
    if (!h || h.indice < 0 || !h.entradas[h.indice]) return 0;
    return Number(h.entradas[h.indice].scroll) || 0;
  }

  // ---- Etapa 7: Colunas vinculadas (Linked Panes) ----
  function colunasVinculadas(e, painel = e.ativo) {
    if (!Array.isArray(e.vinculos)) return [];
    const res = [];
    for (const [a, b] of e.vinculos) {
      if (a === painel && e.paineis[b]) res.push(b);
      else if (b === painel && e.paineis[a]) res.push(a);
    }
    return res;
  }
  function vincularColunas(e, p1, p2) {
    if (!Number.isInteger(p1) || !Number.isInteger(p2) || p1 === p2 || !e.paineis[p1] || !e.paineis[p2]) return e;
    const [a, b] = p1 < p2 ? [p1, p2] : [p2, p1];
    const r = copia(e);
    const lista = Array.isArray(r.vinculos) ? r.vinculos.filter(([x, y]) => !(x === a && y === b)) : [];
    lista.push([a, b]);
    r.vinculos = lista;
    const idOrigem = r.paineis[p1].ativa;
    if (idOrigem) {
      const pp = r.paineis[p2];
      if (!pp.abas.includes(idOrigem)) {
        const pos = pp.abas.indexOf(pp.ativa);
        if (pos === -1) pp.abas.push(idOrigem); else pp.abas[pos] = idOrigem;
      }
      pp.ativa = idOrigem;
    }
    return r;
  }
  function desvincularColuna(e, painel) {
    if (!Array.isArray(e.vinculos)) return e;
    const r = copia(e);
    const rest = r.vinculos.filter(([a, b]) => a !== painel && b !== painel);
    if (rest.length) r.vinculos = rest;
    else delete r.vinculos;
    return r;
  }

  const api = { RASCUNHO, MAX_COLUNAS, vazio, abrir, ativar, fechar, fecharOutras, mover, trocarId, limpar, larguras, notaAtiva, comHistorico, podeVoltar, podeAvancar, voltar, avancar, registrarScroll, scrollAtivo, colunasVinculadas, vincularColunas, desvincularColuna };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroAbas = api;
})(globalThis);
