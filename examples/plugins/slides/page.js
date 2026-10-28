'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const model = globalThis.KiroSlides;
  const raiz = document.documentElement;
  const eventos = new AbortController();
  let kiro, notas = [], slides = [], atual = 0, nota = null;

  function setStatus(message, erro) { const el = $('status'); el.textContent = message; el.dataset.error = String(!!erro); }

  function listar() {
    const achadas = model.filter(notas, $('busca').value);
    $('resumo').textContent = notas.length ? `${achadas.length} de ${notas.length} notas` : 'Nenhuma nota no cofre.';
    const ul = $('notas'); ul.replaceChildren();
    for (const n of achadas) {
      const li = document.createElement('li');
      const botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'nota'; botao.textContent = n.title || 'Sem título';
      botao.addEventListener('click', () => abrir(n));
      li.append(botao); ul.append(li);
    }
  }

  function inline(parent, texto) {
    for (const parte of model.inline(texto)) {
      if (parte.type === 'text') { parent.append(document.createTextNode(parte.text)); continue; }
      const el = document.createElement(parte.type); el.textContent = parte.text; parent.append(el);
    }
  }

  function desenharCorpo(source) {
    const corpo = $('corpo'); corpo.replaceChildren();
    for (const b of model.blocks(source)) {
      if (b.type === 'ul' || b.type === 'ol') {
        const lista = document.createElement(b.type);
        for (const item of b.items) { const li = document.createElement('li'); inline(li, item); lista.append(li); }
        corpo.append(lista);
      } else if (b.type === 'code') {
        const pre = document.createElement('pre'); pre.textContent = b.text; corpo.append(pre);
      } else {
        const el = document.createElement(b.type === 'h' ? 'h3' : 'p'); inline(el, b.text); corpo.append(el);
      }
    }
  }

  function desenhar() {
    const s = slides[atual];
    $('nota').textContent = nota.title || 'Sem título';
    $('titulo').textContent = s.title;
    $('titulo').hidden = !s.title;
    desenharCorpo(s.body);
    $('contador').textContent = `${atual + 1} / ${slides.length}`;
    $('anterior').disabled = atual === 0;
    $('proximo').disabled = atual === slides.length - 1;
  }

  function abrir(n) {
    nota = n; slides = model.split(n.body); atual = 0;
    $('escolha').hidden = true; $('apresentacao').hidden = false;
    desenhar(); $('titulo').focus();
  }

  function sair() {
    $('apresentacao').hidden = true; $('escolha').hidden = false; $('busca').focus();
  }

  function mover(passo) {
    const proximo = Math.min(Math.max(atual + passo, 0), slides.length - 1);
    if (proximo === atual) return;
    atual = proximo; desenhar();
  }

  function atualizarTelaCheia() { $('tela-cheia').textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia'; }

  document.addEventListener('keydown', e => {
    if ($('apresentacao').hidden) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); }
    else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); mover(1); }
    else if (e.key === 'Escape') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      sair();
    }
  }, { signal: eventos.signal });

  $('busca').addEventListener('input', listar, { signal: eventos.signal });
  $('voltar').addEventListener('click', sair, { signal: eventos.signal });
  $('anterior').addEventListener('click', () => mover(-1), { signal: eventos.signal });
  $('proximo').addEventListener('click', () => mover(1), { signal: eventos.signal });
  if (!raiz.requestFullscreen) $('tela-cheia').hidden = true;
  $('tela-cheia').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await raiz.requestFullscreen(); }
    catch (e) { setStatus(`Não foi possível abrir a tela cheia. ${e.message || ''}`, true); }
    atualizarTelaCheia();
  }, { signal: eventos.signal });
  document.addEventListener('fullscreenchange', atualizarTelaCheia, { signal: eventos.signal });
  window.addEventListener('pagehide', () => eventos.abort(), { once: true });

  globalThis.kiro.ready.then(async k => {
    kiro = k;
    try { notas = await kiro.notes.list({ limit: 500 }); listar(); }
    catch (e) { $('resumo').textContent = 'Não foi possível ler as notas.'; setStatus(`Leitura recusada: ${e.message}`, true); }
  }).catch(e => setStatus(`Falha ao iniciar: ${e.message}`, true));
})();
