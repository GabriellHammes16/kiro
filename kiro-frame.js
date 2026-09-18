// Runtime das telas de plug-in (código do Kiro, roda dentro da moldura isolada).
// A moldura tem origem opaca e CSP sem rede: tudo o que a tela faz passa por
// mensagem à página do Kiro, que confere a permissão de novo a cada chamada.
//
// Protocolo (tela → Kiro): { tipo: 'pronto' } · { tipo: 'chamada', chamada, metodo, args }
//   · { tipo: 'altura', valor } · { tipo: 'link', url }
// (Kiro → tela): { tipo: 'ativar', metodos, data, tema } · { tipo: 'resposta', chamada, valor | erro }
//   · { tipo: 'dados', data } · { tipo: 'tema', tema }
(function () {
  'use strict';
  // WebRTC não é coberto por connect-src: sem isto, a tela conversaria com um servidor STUN de fora.
  for (const nome of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) {
    try { delete window[nome]; } catch { /* não configurável: fica a CSP */ }
  }
  const pai = window.parent;
  const enviar = mensagem => pai.postMessage(mensagem, '*');   // origem opaca: não há alvo nomeável
  const pendentes = new Map();
  const ouvintes = [];
  let proxima = 1, pronto;
  const chamar = (metodo, args) => new Promise((resolve, reject) => {
    const chamada = proxima++;
    pendentes.set(chamada, { resolve, reject });
    enviar({ tipo: 'chamada', chamada, metodo, args });
  });
  const aplicarTema = tema => {
    for (const [nome, valor] of Object.entries(tema || {})) if (/^--[a-z0-9-]+$/.test(nome)) document.documentElement.style.setProperty(nome, String(valor));
  };
  const kiro = {
    data: null,
    ready: new Promise(resolve => { pronto = resolve; }),
    onData: fn => { if (typeof fn === 'function') ouvintes.push(fn); },
    resize: altura => enviar({ tipo: 'altura', valor: Number(altura) }),
    openLink: url => enviar({ tipo: 'link', url: String(url) }),
  };
  window.kiro = kiro;
  window.addEventListener('message', ({ source, data }) => {
    if (source !== pai || !data || typeof data !== 'object') return;
    if (data.tipo === 'ativar') {
      for (const metodo of Array.isArray(data.metodos) ? data.metodos : []) {
        const [grupo, nome] = metodo.includes('.') ? metodo.split('.') : ['', metodo];
        const fn = (...args) => chamar(metodo, args);
        if (!grupo) kiro[nome] = fn; else (kiro[grupo] = kiro[grupo] || {})[nome] = fn;
      }
      kiro.data = data.data ?? null;
      aplicarTema(data.tema);
      pronto(kiro);
    } else if (data.tipo === 'resposta') {
      const p = pendentes.get(data.chamada);
      if (!p) return;
      pendentes.delete(data.chamada);
      data.erro ? p.reject(new Error(data.erro)) : p.resolve(data.valor);
    } else if (data.tipo === 'dados') {
      kiro.data = data.data ?? null;
      for (const fn of ouvintes) try { fn(kiro.data); } catch (erro) { console.error(erro); }
    } else if (data.tipo === 'tema') aplicarTema(data.tema);
  });
  enviar({ tipo: 'pronto' });
})();
