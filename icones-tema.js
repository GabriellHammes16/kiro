// Ícones dos temas de anime: cada tema redesenha os ícones da barra lateral e da árvore de Pastas
// (menos Configurações, que é sempre a engrenagem para ninguém ter de adivinhar)
// com um motivo próprio (raio, pétala, chama, folha, hexágono, lua, carta, espada, monitor, cometa,
// estrela). São desenhos originais, inspirados no clima de cada tema; nenhum logo ou personagem.
// Mesmo formato de TRACOS (app.js): o miolo de um <svg viewBox="0 0 24 24"> com traço de 1.75.
// O que não estiver aqui usa o ícone padrão.
(function (root) {
  // Bases comuns: o que diz a função do ícone. O motivo do tema entra por cima.
  const CAL = '<rect x="3.5" y="5.5" width="17" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17"/>';
  const LUPA = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/>';
  const PASTA = '<path d="M3.5 7a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7L11.4 7h7.1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>';
  const DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
  const CHECKS = '<path d="M4 7.2 5.4 8.6 8 6M4 16.2l1.4 1.4L8 15"/><path d="M11 7h9M11 17h4"/>';
  const MAIS = '<path d="M19 14.5v6.5M15.75 17.75h6.5"/>';
  // Motivo desenhado em 24×24, reduzido e posto em (x, y); o traço compensa a escala.
  const em = (motivo, x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="${+(1.75 / s).toFixed(2)}">${motivo}</g>`;

  // Monta o conjunto de um tema a partir do motivo; os ícones com desenho próprio vêm em `proprios`.
  function conjunto(motivo, proprios) {
    return {
      'nova-nota': em(motivo, 0, 0, 0.72) + MAIS,
      'nota-diaria': CAL + em(motivo, 8.2, 11.4, 0.32),
      'ir-para-nota': LUPA + em(motivo, 6.4, 6.4, 0.34),
      notas: DOC + em(motivo, 7.4, 10.6, 0.38),
      tarefas: CHECKS + em(motivo, 14.8, 12.2, 0.3),
      pastas: PASTA + em(motivo, 8.2, 8.9, 0.32),
      nota: motivo,
      ...proprios,
    };
  }

  const MOTIVO = {
    raio: '<path d="M13.5 2.5 5.5 13.5h6l-1 8 8-11h-6z"/>',
    petala: '<path d="M12 5.2 13.3 3.6c2.7 2.6 3.7 6.5 2.5 10.1-.8 2.4-2.2 4-3.8 4.8-1.6-.8-3-2.4-3.8-4.8-1.2-3.6-.2-7.5 2.5-10.1z"/><path d="M12 18.5v2.5"/>',
    chama: '<path d="M12 21a6 6 0 0 1-6-6c0-3.5 2.5-5.5 3.5-8.5 1.5 1.5 2 3 2 4.5 1-1 1.5-2.5 1.5-4.5C16 9 18 11.5 18 15a6 6 0 0 1-6 6z"/>',
    folha: '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z"/><path d="M5 19 13 11"/>',
    hexagono: '<path d="M12 3.5 19.4 7.75v8.5L12 20.5 4.6 16.25v-8.5z"/>',
    lua: '<path d="M15 4a8 8 0 1 0 5 13.5A6.5 6.5 0 0 1 15 4z"/>',
    carta: '<rect x="3.5" y="6" width="17" height="12.5" rx="1.5"/><path d="m4 7 8 6 8-6"/>',
    espada: '<path d="M20.5 3.5 9 15"/><path d="M6.5 12.5l5 5"/><path d="M7.8 16.2 3.5 20.5"/>',
    monitor: '<rect x="3.5" y="4" width="17" height="12.5" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
    cometa: '<circle cx="16" cy="8" r="3.5"/><path d="M13.3 10.7 4 20M12.6 7 5.5 10.5M17 11.4l-3 6.6"/>',
    estrela: '<path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.4-4.1 6-.7z"/>',
  };

  const ICONES = {
    // Cidade de neon: raio, letreiros, linhas de metrô.
    'neon-tokyo': conjunto(MOTIVO.raio, {
      hoje: '<path d="M3.5 20.5h17"/><path d="M5 20.5v-6h3v6M10 20.5v-9h4v9M16 20.5v-5h3v5"/><path d="M12 3.5v2.5M6.8 5.8l1.5 1.5M17.2 5.8l-1.5 1.5"/>',
      grafo: '<path d="M3.5 18h5l7-12h5"/><path d="M3.5 8h6l5 10h6"/><circle cx="12" cy="12.2" r="1.9"/>',
      fluxo: '<rect x="3" y="4" width="6.5" height="5" rx="1"/><rect x="14.5" y="15" width="6.5" height="5" rx="1"/><path d="M9.5 6.5h3l2.5 3v5.5"/>',
    }),
    // Noite de cerejeira: pétala, lua crescente, galho.
    'sakura-night': conjunto(MOTIVO.petala, {
      hoje: '<path d="M14.5 4a7.5 7.5 0 1 0 5.6 11.5A6 6 0 0 1 14.5 4z"/><path d="M19 3.5v3M17.5 5h3"/>',
      grafo: '<path d="M4 19.5c3-1 5-3.5 6.5-7S15 6.5 19.5 5"/><path d="M10.8 12.3 15.5 16"/><circle cx="4.5" cy="19" r="1.7"/><circle cx="19.5" cy="5" r="1.7"/><circle cx="16" cy="16.5" r="1.7"/>',
      fluxo: em(MOTIVO.petala, 1, 1, 0.42) + em(MOTIVO.petala, 12.5, 11.5, 0.42) + '<path d="M6 10.5v3a2 2 0 0 0 2 2h4.5"/>',
    }),
    // Shonen: chama, pergaminho de treino, medidor de poder.
    'shonen-fire': conjunto(MOTIVO.chama, {
      notas: '<rect x="6" y="5" width="12" height="14" rx="1"/><path d="M4 5h16M4 19h16"/><path d="M9 9.5h6M9 13h6M9 16h3"/>',
      hoje: '<path d="M3.5 18h17"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 5.5v3.5M5.6 8.6l2.2 2.2M18.4 8.6l-2.2 2.2M2.5 13.5h3M18.5 13.5h3"/>',
      grafo: '<circle cx="5.5" cy="6.5" r="2"/><circle cx="18.5" cy="6.5" r="2"/><circle cx="12" cy="18.5" r="2"/><path d="M7.5 6.5h3l-1 1.5h4.5M6.7 8.3l2.3 3.5h-1.5l3 4.8M17.3 8.3 15 11.8h1.5l-3 4.8"/>',
      fluxo: '<rect x="3" y="15" width="6.5" height="5" rx="1"/><path d="M6.2 15C6.2 9 11 5 18 5"/><path d="M15.5 2.8 18 5l-2.5 2.5"/>',
    }),
    // Floresta encantada: folha, nuvem, vento, árvore.
    'enchanted-forest': conjunto(MOTIVO.folha, {
      hoje: '<circle cx="9" cy="8.5" r="3.5"/><path d="M9 2.5V4M3 8.5h1.5M4.8 4.3l1 1M13.2 4.3l-1 1"/><path d="M8 19.5h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1A3 3 0 0 0 8 19.5z"/>',
      grafo: '<path d="M12 21v-9"/><path d="M12 12 7.5 8.5M12 12l4.5-3.5M12 15.5l-3.5-1.5"/><circle cx="12" cy="6.5" r="2.4"/><circle cx="6" cy="7.5" r="2"/><circle cx="18" cy="7.5" r="2"/>',
      nota: '<path d="M7 10.5h10a5 5 0 0 1-5 9 5 5 0 0 1-5-9z"/><path d="M6 10.5a6 4 0 0 1 12 0"/><path d="M12 6.5V4.5"/>',
      fluxo: '<rect x="3" y="4" width="6" height="4.5" rx="1"/><path d="M3.5 17.5c4 0 5-5 9-5s5 3 8 3"/><path d="M14 4.5c0 3 2 5 5 5 0-3-2-5-5-5z"/>',
    }),
    // Mecha: hexágono, faixas de alerta, mira, cruz de luz.
    purple-mecha: conjunto(MOTIVO.hexagono, {
      'nota-diaria': '<rect x="3.5" y="5.5" width="17" height="14.5" rx="1"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17"/><path d="m7 20 4-4M11 20l4-4M15 20l4-4"/>',
      'ir-para-nota': '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
      hoje: '<path d="M12 2.5v19M7 8h10"/><path d="M9.5 21.5h5"/><path d="M5.5 5.5 7 7M18.5 5.5 17 7"/>',
      grafo: '<path d="M7 3.5 10.5 5.5v4L7 11.5 3.5 9.5v-4z"/><path d="M17 3.5l3.5 2v4l-3.5 2-3.5-2v-4z"/><path d="M12 12.5l3.5 2v4l-3.5 2-3.5-2v-4z"/>',
      fluxo: em(MOTIVO.hexagono, 0, 0.5, 0.4) + em(MOTIVO.hexagono, 12.5, 12, 0.4) + '<path d="M9.5 5.5h3a2 2 0 0 1 2 2v5"/>',
    }),
    // Garota mágica: lua crescente, estrelas, coração, varinha.
    'moon-guardian': conjunto(MOTIVO.lua, {
      'ir-para-nota': '<path d="m4 20 9.5-9.5"/><path d="M16 3.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z"/>',
      hoje: '<path d="M13 4a8 8 0 1 0 6.5 11.5A6.5 6.5 0 0 1 13 4z"/><path d="M19 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
      notas: DOC + '<path d="M12 18s-3-1.9-3-4.2a1.7 1.7 0 0 1 3-1.1 1.7 1.7 0 0 1 3 1.1c0 2.3-3 4.2-3 4.2z"/>',
      grafo: '<path d="M5 17 10 7l5 6 4-8"/><circle cx="5" cy="17" r="1.6"/><circle cx="10" cy="7" r="1.6"/><circle cx="15" cy="13" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
      nota: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
      fluxo: em(MOTIVO.lua, 1, 1, 0.4) + em(MOTIVO.estrela, 12.5, 12.5, 0.4) + '<path d="M9.5 6.5c4 .5 7 3 7.5 6"/>',
    }),
    // Cartas: envelope, pena, relógio de bolso, máquina de escrever, lacre.
    'lavender-letters': conjunto(MOTIVO.carta, {
      'nova-nota': '<path d="M11 3 6 11l5 10 5-10z"/><path d="M11 11v4"/><circle cx="11" cy="10" r="1"/>' + MAIS,
      'nota-diaria': '<rect x="3.5" y="6.5" width="17" height="13" rx="1.5"/><path d="m4 7.5 8 6 8-6"/><path d="M8 3.5v3M16 3.5v3"/>',
      hoje: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5M12 13l2.5 1.5"/><path d="M10.5 3.5h3M12 3.5V6"/>',
      notas: '<rect x="3.5" y="7.5" width="15" height="11" rx="1.5"/><path d="m4 8.5 7.5 5.5L19 8.5"/><path d="M6.5 4.5h14v10.5"/>',
      tarefas: '<path d="M4 7.2 5.4 8.6 8 6M4 16.2l1.4 1.4L8 15"/><path d="M11 7h9M11 17h4"/><path d="m18.5 13.5 2 2-3.5 3.5h-2v-2z"/>',
      grafo: '<path d="M5 18c3-8 11-4 14-12" stroke-dasharray="2 2.6"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="11.6" cy="11.4" r="1.8"/>',
      nota: '<circle cx="12" cy="12" r="6.5"/><path d="M12 9v6M9 12h6"/><path d="M8 17.5 6.5 20.5M16 17.5l1.5 3"/>',
      fluxo: em(MOTIVO.carta, 0, 0.5, 0.42) + em(MOTIVO.carta, 13, 12.5, 0.42) + '<path d="M5 9v3.5a2.5 2.5 0 0 0 2.5 2.5H13"/>',
    }),
    // Caçador de demônios: espada, chama, glicínia, xadrez.
    'demon-blood': conjunto(MOTIVO.espada, {
      'ir-para-nota': LUPA + '<path d="M7.5 13.5 13.5 7.5"/>',
      hoje: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5c1.2 1.5 1.2 3 0 4.5M12 17c1.2 1.5 1.2 3 0 4.5M2.5 12c1.5-1.2 3-1.2 4.5 0M17 12c1.5-1.2 3-1.2 4.5 0"/>',
      pastas: PASTA + '<path d="M9 10.5h3v3H9zM12 13.5h3v3h-3z" fill="currentColor" stroke="none"/>',
      grafo: '<path d="M3.5 4.5h17"/><path d="M7 4.5v5M12 4.5v9M17 4.5v6"/><circle cx="7" cy="11.5" r="1.9"/><circle cx="12" cy="15.5" r="1.9"/><circle cx="17" cy="12.5" r="1.9"/>',
      nota: '<path d="M12 3.5c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z"/>',
      fluxo: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M6 9c0 5 4 8.5 9 8.5"/><path d="m12.5 15.5 2.5 2-2.5 2"/>',
    }),
    // Rede e fios: monitor de tubo, postes, sinal.
    'wired-dreams': conjunto(MOTIVO.monitor, {
      'ir-para-nota': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9.5 3 2.5-3 2.5"/><path d="M12 15h5"/>',
      hoje: '<path d="M12 3v18"/><path d="M6.5 6h11M8 9.5h8"/><path d="M3 7.5c3 2 5.5 2 9 0M12 7.5c3.5 2 6 2 9 0"/>',
      notas: '<rect x="3.5" y="4" width="17" height="12.5" rx="2"/><path d="M9 20h6M12 16.5V20"/><path d="M7 8h7M7 11.5h10"/>',
      tarefas: '<path d="M5 5H3.5v5H5M8 5h1.5v5H8M5 14H3.5v5H5M8 14h1.5v5H8"/><path d="m5 7.5 1 1 1.5-2M5 16.5l1 1 1.5-2"/><path d="M13 7.5h7.5M13 16.5h5"/>',
      grafo: '<rect x="3" y="3.5" width="4" height="4"/><rect x="17" y="3.5" width="4" height="4"/><rect x="10" y="16.5" width="4" height="4"/><path d="M7 5.5h10M5 7.5v4h7v5M19 7.5v4h-7"/>',
      nota: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 9h2.5v2.5H9zM12.5 12.5H15V15h-2.5z" fill="currentColor"/>',
      fluxo: '<rect x="3" y="4" width="6" height="5"/><rect x="15" y="15" width="6" height="5"/><path d="M9 6.5c6 0 0 11 6 11"/>',
    }),
    // Céu e chuva: cometa, gota, nuvem, estrelas.
    'summer-sky': conjunto(MOTIVO.cometa, {
      'nova-nota': '<path d="M10 3.5c2.8 3.6 4.5 6.4 4.5 8.7a4.5 4.5 0 0 1-9 0c0-2.3 1.7-5.1 4.5-8.7z"/>' + MAIS,
      hoje: '<path d="M6 15.5h11a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.5A3 3 0 0 0 6 15.5z"/><path d="m8 18.5-1 2.5M12 18.5l-1 2.5M16 18.5l-1 2.5"/>',
      grafo: '<circle cx="18" cy="6" r="2.2"/><path d="M16.3 7.4 4 16M15.8 5.2 5.5 5.5M17.2 8.1 11.5 20"/><circle cx="4" cy="16" r="1.4"/><circle cx="11.5" cy="20" r="1.4"/>',
      fluxo: '<rect x="3" y="15" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><path d="M7 15c1-5 4-8 8-8.5"/><path d="M4.5 10.5h.01M8 6h.01M11 3.5h.01"/>',
    }),
    // Estrela, seta e o "ゴゴゴ" de mangá.
    'bizarre-aura': conjunto(MOTIVO.estrela, {
      'ir-para-nota': '<path d="M4 20 17 7"/><path d="M12 5.5h6.5V12"/><path d="m6.5 15.5 2 2M8.5 13.5l2 2"/>',
      hoje: '<path d="M12 3l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z"/>',
      notas: '<rect x="4" y="3.5" width="16" height="17" rx="1"/><path d="M4 10h16M12 3.5V10M9.5 10 7.5 20.5"/>',
      grafo: '<circle cx="5.5" cy="6" r="2"/><circle cx="18.5" cy="6" r="2"/><circle cx="12" cy="18.5" r="2"/><path d="M7.5 6h11M6.5 7.8l1.5 2.5-1 .5 3.5 5.5M17.5 7.8l-1.5 2.5 1 .5-3.5 5.5"/>',
      nota: '<path d="M4.5 6.5h10v11h-10"/><path d="M17 4.5l1.5 2.5M20 3.5l1.5 2.5"/>',
      fluxo: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h2.5l-1.5 3h3l-1.5 3h2.5L15 17"/>',
    }),
  };

  root.KiroIconesTema = ICONES;
})(globalThis);
