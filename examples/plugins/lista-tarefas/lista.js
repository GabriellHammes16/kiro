// Lista de Tarefas (roda dentro da moldura isolada do Kiro): seções por status, arrastar entre elas.
// Na página (kiro.data === null) mostra tudo; no cartão do Hoje, compacta e sem "Concluído" por padrão.
(function () {
  'use strict';
  const E = window.ListaEstados;
  const $ = sel => document.querySelector(sel);
  const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dataCurta = due => due ? `${due.slice(8, 10)}/${due.slice(5, 7)}` : '';

  let kiro, tarefas = [], guardados = {}, recolhidas = ['concluido'], arrastando = null, cartao = false, comConcluidas = true;

  async function carregar() {
    [tarefas, guardados, recolhidas] = await Promise.all([
      kiro.tasks.list(),
      kiro.storage.get('status').then(v => v || {}),
      kiro.storage.get('recolhidas').then(v => Array.isArray(v) ? v : ['concluido']),
    ]);
    desenhar();
  }

  async function mover(id, destino) {
    const t = tarefas.find(x => x.id === id);
    const m = t && E.mudanca(t, destino);
    if (!m || E.statusDe(t, guardados) === destino) return;
    guardados[id] = m.status;
    await kiro.storage.set('status', guardados);
    if (m.done !== undefined) await kiro.tasks.update(id, { done: m.done });
    await carregar();
    document.querySelector(`.item[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  function item(t) {
    const atrasada = !t.done && t.due && t.due < hoje();
    return `<li class="item" draggable="true" tabindex="0" data-id="${escapar(t.id)}" aria-label="${escapar(t.title)}">
      <span class="alca" aria-hidden="true">⋮⋮</span><span class="marca" aria-hidden="true"></span>
      <span class="titulo" title="${escapar(t.title)}">${escapar(t.title)}</span>
      ${t.priority === 'Alta' ? '<span class="alta">Alta</span>' : ''}
      ${t.due ? `<span class="data${atrasada ? ' atrasada' : ''}">${dataCurta(t.due)}</span>` : ''}
    </li>`;
  }

  function desenhar() {
    const grupos = E.agrupar(tarefas, guardados);
    const status = comConcluidas ? E.STATUS : E.STATUS.filter(s => s !== 'concluido');
    $('#lista').innerHTML = status.map(s => {
      const lista = grupos[s], recolhida = recolhidas.includes(s);
      return `<section class="secao${recolhida ? ' recolhida' : ''}" data-status="${s}">
        <button type="button" class="cabeca" aria-expanded="${!recolhida}"><span class="seta" aria-hidden="true">▾</span>${E.ROTULOS[s]}<span class="conta">${lista.length}</span></button>
        <ul>${lista.map(item).join('') || '<li class="vazio">Solte uma tarefa aqui.</li>'}</ul>
      </section>`;
    }).join('');
    // Cartão do Hoje: a moldura acompanha a altura da lista.
    if (cartao) kiro.resize(Math.ceil($('#lista').getBoundingClientRect().height) + 4);
  }

  // ---- Arrastar entre seções ----
  document.addEventListener('dragstart', e => {
    const li = e.target.closest?.('.item');
    if (!li) return;
    arrastando = li.dataset.id;
    li.dataset.arrastando = 'true';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', arrastando);
  });
  document.addEventListener('dragend', () => { arrastando = null; document.querySelectorAll('[data-arrastando], [data-sobre]').forEach(x => { x.removeAttribute('data-arrastando'); x.removeAttribute('data-sobre'); }); });
  document.addEventListener('dragover', e => {
    const secao = arrastando && e.target.closest?.('.secao');
    document.querySelectorAll('.secao[data-sobre]').forEach(x => x !== secao && x.removeAttribute('data-sobre'));
    if (!secao) return;
    e.preventDefault();
    secao.dataset.sobre = 'true';
  });
  document.addEventListener('drop', e => {
    const secao = arrastando && e.target.closest?.('.secao');
    if (!secao) return;
    e.preventDefault();
    const id = arrastando;
    arrastando = null;
    mover(id, secao.dataset.status).catch(erro => kiro.notify(`Não foi possível mover: ${erro.message}`, { error: true }));
  });

  // ---- Teclado: ← → muda o status da tarefa em foco; Enter/Espaço no título da seção recolhe ----
  document.addEventListener('keydown', e => {
    const li = e.target.closest?.('.item');
    if (!li || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const t = tarefas.find(x => x.id === li.dataset.id);
    if (t) mover(t.id, E.vizinho(E.statusDe(t, guardados), e.key === 'ArrowRight' ? 1 : -1)).catch(erro => kiro.notify(`Não foi possível mover: ${erro.message}`, { error: true }));
  });
  document.addEventListener('click', async e => {
    const cabeca = e.target.closest?.('.cabeca');
    if (!cabeca) return;
    const s = cabeca.closest('.secao').dataset.status;
    recolhidas = recolhidas.includes(s) ? recolhidas.filter(x => x !== s) : [...recolhidas, s];
    await kiro.storage.set('recolhidas', recolhidas);
    desenhar();
  });

  window.kiro.ready.then(k => {
    kiro = k;
    const aplicar = dados => { cartao = Boolean(dados?.cartao); comConcluidas = !cartao || Boolean(dados?.concluidas); document.body.classList.toggle('cartao', cartao); };
    aplicar(k.data);
    // O Hoje redesenha o cartão quando uma tarefa muda; na página, relê ao voltar para a janela.
    k.onData(dados => { aplicar(dados); carregar(); });
    window.addEventListener('focus', () => carregar());
    return carregar();
  });
})();
