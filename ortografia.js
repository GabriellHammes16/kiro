// Corretor ortográfico do Kiro: Hunspell real (WebAssembly, vendor/hunspell) com os dicionários de
// vendor/dicionarios/<código>.js. A palavra está certa se algum idioma da lista aceitar, ou se
// estiver no dicionário pessoal do cofre. O motor é injetável: no navegador é o vendor; nos
// testes, o pacote hunspell-asm do node_modules.
(function (root) {
  const IDIOMAS = ['pt-BR', 'en-US'];
  const MAX_SUGESTOES = 5;
  const dados = new Map();      // código → { aff, dic }
  let instancias = [];          // [{ codigo, h }]
  let pessoais = new Set();
  let cache = new Map();        // palavra → errada?
  let carregando = null;
  let fabrica = null, montados = [];   // fábrica do motor e arquivos já montados, por idioma
  const ouvintes = new Set();
  const avisar = () => { for (const fn of ouvintes) { try { fn(); } catch { /* um ouvinte com erro não para os outros */ } } };

  function registrar(codigo, { aff, dic }) { dados.set(codigo, { aff, dic }); }

  function scriptUmaVez(src) {
    return new Promise((ok, falha) => {
      if (document.querySelector(`script[data-ortografia="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.src = src; s.dataset.ortografia = src;
      s.onload = () => ok();
      s.onerror = () => { s.remove(); falha(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  function carregar({ motor, idiomas = IDIOMAS } = {}) {
    carregando ??= (async () => {
      const m = motor || root.HunspellAsm || (await scriptUmaVez('vendor/hunspell/hunspell.js'), root.HunspellAsm);
      fabrica = await m.loadModule();
      const cod = new TextEncoder();
      const novos = [];
      for (const codigo of idiomas) {
        try {
          if (!dados.has(codigo) && typeof document !== 'undefined') await scriptUmaVez(`vendor/dicionarios/${codigo}.js`);
          const d = dados.get(codigo);
          if (!d) continue;
          novos.push({ codigo, aff: fabrica.mountBuffer(cod.encode(d.aff), `${codigo}.aff`), dic: fabrica.mountBuffer(cod.encode(d.dic), `${codigo}.dic`) });
        } catch { /* esse idioma fica de fora; os outros continuam */ }
      }
      if (!novos.length) throw new Error('Não foi possível carregar o corretor');
      montados = novos;
      criarInstancias();
    })().catch(erro => { carregando = null; throw erro; });
    return carregando;
  }
  // Uma instância Hunspell por idioma, com as palavras pessoais. O Hunspell não remove palavra
  // adicionada; por isso, quando o dicionário pessoal perde palavras, as instâncias são recriadas
  // a partir dos arquivos já montados (rápido: não lê os dicionários de novo do disco).
  function criarInstancias() {
    for (const { h } of instancias) { try { h.dispose(); } catch { /* já liberada */ } }
    instancias = montados.map(({ codigo, aff, dic }) => {
      const h = fabrica.create(aff, dic);
      for (const p of pessoais) h.addWord(p);
      return { codigo, h };
    });
    cache = new Map(); avisar();
  }
  const pronto = () => instancias.length > 0;

  const IGNORAR = p => p.length < 2 || /\d/.test(p) || /[@/:]|\.\w/.test(p);
  const aceita1 = p => instancias.some(({ h }) => h.spell(p));
  // Palavra com hífen vale se o dicionário aceita inteira ou se cada parte é aceita (bem-vindo).
  const aceita = p => aceita1(p) || (p.includes('-') && p.split('-').every(x => x && aceita1(x)));
  function errada(palavra) {
    if (!pronto() || IGNORAR(palavra) || pessoais.has(palavra)) return false;
    if (cache.has(palavra)) return cache.get(palavra);
    const titulo = palavra[0] + palavra.slice(1).toLowerCase();
    const r = !(aceita(palavra) || aceita(palavra.toLowerCase()) || (palavra === palavra.toUpperCase() && aceita(titulo)));
    cache.set(palavra, r);
    return r;
  }

  function distancia(a, b) {
    const linha = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let anterior = linha[0]; linha[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const guardado = linha[j];
        linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
        anterior = guardado;
      }
    }
    return linha[b.length];
  }

  function sugestoes(palavra) {
    if (!pronto()) return [];
    const maiuscula = palavra[0] !== palavra[0].toLowerCase();
    const todas = new Set();
    for (const { h } of instancias) for (const s of h.suggest(palavra)) todas.add(maiuscula ? s[0].toUpperCase() + s.slice(1) : s);
    todas.delete(palavra);
    return [...todas].sort((x, y) => distancia(palavra, x) - distancia(palavra, y)).slice(0, MAX_SUGESTOES);
  }

  function adicionar(palavra) {
    pessoais.add(palavra);
    for (const { h } of instancias) h.addWord(palavra);
    cache = new Map(); avisar();
  }
  function definirPessoais(palavras) {
    const antes = pessoais;
    pessoais = new Set(palavras);
    const saiuAlguma = [...antes].some(p => !pessoais.has(p));
    if (saiuAlguma && montados.length) return criarInstancias();
    for (const p of pessoais) if (!antes.has(p)) for (const { h } of instancias) h.addWord(p);
    cache = new Map(); avisar();
  }
  const aoMudar = fn => { ouvintes.add(fn); return () => ouvintes.delete(fn); };

  const api = { IDIOMAS, registrar, carregar, pronto, errada, sugestoes, adicionar, definirPessoais, aoMudar, distancia };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KiroOrtografia = api;
})(globalThis);
