// Corretor ortográfico: os itens que entram no topo do menu do botão direito quando a palavra
// sob o clique está errada, e a validação do que a página manda ao processo principal.
// Só o modelo, sem DOM. Roda no navegador (KiroCorretor) e no Node (testes e main.cjs).
(function (root) {
  const MAX_SUGESTOES = 2;   // como no Obsidian: só as mais parecidas
  // Troca: texto curto numa linha só (sugestão pode ter espaço: "a gente").
  const palavraValida = v => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[\r\n]/.test(v);
  // Dicionário do usuário: uma palavra só.
  const palavraParaDicionario = v => palavraValida(v) && !/\s/.test(v);

  // Sugestões, separador, "Adicionar ao dicionário" (como no Obsidian). `icone(nome)` é opcional.
  function itensDoCorretor(dados, { trocar, adicionar, t, icone = () => undefined }) {
    const palavra = typeof dados?.palavra === 'string' ? dados.palavra : '';
    if (!palavra) return [];
    const sugestoes = (Array.isArray(dados.sugestoes) ? dados.sugestoes : []).filter(s => typeof s === 'string' && s).slice(0, MAX_SUGESTOES);
    return [
      ...(sugestoes.length ? sugestoes.map(s => ({ rotulo: s, icone: icone('trocar'), acao: () => trocar(s) })) : [{ rotulo: t('Sem sugestões'), ativo: () => false }]),
      { separador: true },
      { rotulo: t('Adicionar ao dicionário'), icone: icone('dicionario'), acao: () => adicionar(palavra) },
    ];
  }

  const api = { itensDoCorretor, palavraValida, palavraParaDicionario };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroCorretor = api;
})(globalThis);
