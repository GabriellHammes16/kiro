// Idioma da interface: só o modelo, sem DOM. A frase em português é a chave: cada idioma
// registra { 'frase em português': 'tradução' } (idiomas/<código>.js) e t() devolve a
// tradução ou, sem ela, a própria frase. Roda no navegador (KiroIdiomas) e no Node (testes
// e processo principal do Electron).
(function (root) {
  const PADRAO = 'pt-BR';
  const IDIOMAS = [
    { codigo: 'pt-BR', nome: 'Português', locale: 'pt-BR' },
    { codigo: 'en', nome: 'English', locale: 'en-US' },
  ];
  const tabelas = new Map();        // código → Map(frase → tradução)
  let atual = PADRAO, tabela = null;
  let formatadores = new Map(), comparador = null;

  const suportado = codigo => IDIOMAS.some(i => i.codigo === codigo);
  const base = codigo => codigo.toLowerCase().split('-')[0];
  // Idioma do sistema → código suportado: exato ('en') ou pela língua ('en-GB' → 'en').
  function detectar(preferido) {
    const p = String(preferido || '').toLowerCase();
    const exato = IDIOMAS.find(i => i.codigo.toLowerCase() === p);
    if (exato) return exato.codigo;
    return IDIOMAS.find(i => base(i.codigo) === base(p))?.codigo || PADRAO;
  }
  const escolherIdioma = (salvo, doSistema) => (suportado(salvo) ? salvo : detectar(doSistema));

  function registrar(codigo, frases) {
    tabelas.set(codigo, new Map(Object.entries(frases)));
    if (codigo === atual) tabela = tabelas.get(codigo);
  }
  function definirIdioma(codigo) {
    const novo = suportado(codigo) ? codigo : PADRAO;
    if (novo !== atual) { formatadores = new Map(); comparador = null; }
    atual = novo;
    tabela = novo === PADRAO ? null : tabelas.get(novo) || null;
    return atual;
  }
  const idioma = () => atual;
  const locale = () => IDIOMAS.find(i => i.codigo === atual).locale;

  // Uma passada só: o valor de um marcador nunca é lido como outro marcador.
  function t(frase, valores) {
    const texto = (tabela && tabela.get(frase)) || frase;
    return valores ? texto.replace(/\{(\w+)\}/g, (marca, nome) => (Object.hasOwn(valores, nome) ? String(valores[nome]) : marca)) : texto;
  }
  // Marca a frase para o teste de cobertura sem traduzir agora (listas avaliadas antes do idioma carregar).
  const frase = f => f;

  function carregarScript(codigo) {
    return new Promise((ok, falha) => {
      const script = document.createElement('script');
      script.src = `idiomas/${codigo}.js`;
      script.onload = () => ok();
      script.onerror = () => falha(new Error('Não foi possível carregar o idioma'));
      document.head.appendChild(script);
    });
  }
  // Em português não há arquivo; os outros idiomas são lidos uma vez, só quando escolhidos.
  async function carregar(codigo, importar = carregarScript) {
    if (codigo === PADRAO || !suportado(codigo) || tabelas.has(codigo)) return;
    await importar(codigo);
  }

  // Criar um Intl.DateTimeFormat ou um Collator custa caro: um por idioma (e por opções), refeitos na troca.
  function formatarData(data, opcoes) {
    const chave = JSON.stringify(opcoes);
    let formatador = formatadores.get(chave);
    if (!formatador) formatadores.set(chave, (formatador = new Intl.DateTimeFormat(locale(), opcoes)));
    return formatador.format(data);
  }
  function comparar(a, b) {
    if (!comparador) comparador = new Intl.Collator(locale(), { numeric: true });
    return comparador.compare(a, b);
  }

  const api = { PADRAO, IDIOMAS, t, frase, idioma, locale, definirIdioma, registrar, carregar, detectar, escolherIdioma, formatarData, comparar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroIdiomas = api;
})(globalThis);
