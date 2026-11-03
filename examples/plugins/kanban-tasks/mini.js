// Miniatura do Quadro de Tarefas no Hoje: só as colunas pendentes, com → para
// levar a tarefa à coluna seguinte. Lê e grava os mesmos dados do quadro
// (kiro.storage 'columns', 'vuelta' e 'config'; ver board.js), então os dois
// sempre concordam. Ver docs/plugins.md, seção "Frames (custom UI)".

(function () {
  'use strict';

  const PADRAO = { 'em-preparacao': 'Em preparação', 'a-fazer': 'A fazer', 'em-progresso': 'Em progresso', 'finalizado': 'Finalizado' };
  const SEGUINTE = { 'em-preparacao': 'a-fazer', 'a-fazer': 'em-progresso', 'em-progresso': 'finalizado' };

  const $ = sel => document.querySelector(sel);
  const escapar = v => String(v === undefined || v === null ? '' : v)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dataCurta = due => due ? `${due.slice(8, 10)}/${due.slice(5, 7)}` : '';

  let kiro, opcoes = {}, tarefas = [], columns = {}, vuelta = {}, config = {};

  // Mesma regra do quadro: done=true é "finalizado"; senão a coluna guardada (padrão "a fazer").
  const columnaDe = t => t.done ? 'finalizado' : (PADRAO[columns[t.id]] ? columns[t.id] : 'a-fazer');
  const rotulo = id => (config[id] && config[id].trim()) || PADRAO[id];
  const ordenar = lista => [...lista].sort((a, b) =>
    a.due !== b.due ? (!a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1) : a.title.localeCompare(b.title, 'pt-BR'));

  async function carregar() {
    [tarefas, columns, vuelta, config] = await Promise.all([
      kiro.tasks.list(),
      kiro.storage.get('columns').then(v => v || {}),
      kiro.storage.get('vuelta').then(v => v || {}),
      kiro.storage.get('config').then(v => v || {}),
    ]);
    desenhar();
  }

  // → leva à coluna seguinte; chegar a "Finalizado" marca a tarefa como feita, como no quadro.
  async function avancar(id) {
    const t = tarefas.find(x => x.id === id);
    if (!t) return;
    const origem = columnaDe(t), destino = SEGUINTE[origem];
    if (!destino) return;
    columns[id] = destino;
    if (destino === 'finalizado') { vuelta[id] = origem; t.done = true; }
    desenhar();
    await kiro.storage.set('columns', columns);
    await kiro.storage.set('vuelta', vuelta);
    if (destino === 'finalizado') await kiro.tasks.update(id, { done: true });
  }

  function desenhar() {
    const cols = opcoes.preparacao === false ? ['a-fazer', 'em-progresso'] : ['em-preparacao', 'a-fazer', 'em-progresso'];
    const limite = Number.isFinite(opcoes.limite) ? opcoes.limite : 3;
    const pendentes = tarefas.filter(t => cols.includes(columnaDe(t)));
    const alvo = $('#mini');
    if (!pendentes.length) {
      alvo.style.setProperty('--colunas', 1);
      alvo.innerHTML = '<p class="tudo-feito">Nenhuma tarefa pendente.</p>';
    } else {
      alvo.style.setProperty('--colunas', cols.length);
      alvo.innerHTML = cols.map(col => {
        const lista = ordenar(pendentes.filter(t => columnaDe(t) === col));
        const itens = lista.slice(0, limite).map(t => {
          const vencida = t.due && t.due < hoje();
          const proxima = rotulo(SEGUINTE[col]);
          return `<li class="${vencida ? 'vencida' : ''}">
            <span class="texto"><span class="titulo" title="${escapar(t.title)}">${escapar(t.title)}</span>${t.due ? `<span class="prazo">${vencida ? 'venceu ' : ''}${dataCurta(t.due)}</span>` : ''}</span>
            <button type="button" class="avancar" data-id="${escapar(t.id)}" title="Mover para ${escapar(proxima)}" aria-label="Mover ${escapar(t.title)} para ${escapar(proxima)}">→</button>
          </li>`;
        }).join('');
        const resto = lista.length - limite;
        return `<section class="col" data-col="${col}">
          <header><i class="ponto" aria-hidden="true"></i><h2 title="${escapar(rotulo(col))}">${escapar(rotulo(col))}</h2><span class="conta">${lista.length}</span></header>
          ${lista.length ? `<ul>${itens}</ul>` : '<div class="vazio">Nada aqui</div>'}
          ${resto > 0 ? `<div class="mais">+${resto} no quadro</div>` : ''}
        </section>`;
      }).join('');
    }
    // Altura do conteúdo, não da página: a da página nunca fica menor que a própria moldura.
    kiro.resize(Math.ceil(alvo.getBoundingClientRect().height) + 2);
  }

  $('#mini').addEventListener('click', e => {
    const b = e.target.closest('.avancar');
    if (b) avancar(b.dataset.id).catch(erro => kiro.notify(`Não foi possível mover a tarefa: ${erro.message}`, { error: true }));
  });

  window.kiro.ready.then(k => {
    kiro = k;
    opcoes = k.data || {};
    // O Hoje redesenha o painel quando algo muda (tarefa marcada, opção trocada): relê tudo.
    k.onData(dados => { opcoes = dados || {}; carregar(); });
    return carregar();
  });
})();
