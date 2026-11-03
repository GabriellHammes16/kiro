// Quadro Kanban de tarefas (roda dentro de uma moldura isolada do Kiro).
// Le o cofre com kiro.tasks.list(), guarda a columna de cada tarefa no
// kiro.storage do plug-in e sincroniza "Finalizado" com done=true.
// Ver docs/plugins.md, sección "Frames (custom UI)".

(function () {
  'use strict';

  const COLUMNAS = ['em-preparacao', 'a-fazer', 'em-progresso', 'finalizado'];
  const PADRAO = {
    'em-preparacao': 'Em preparação',
    'a-fazer': 'A fazer',
    'em-progresso': 'Em progresso',
    'finalizado': 'Finalizado',
  };

  const $ = sel => document.querySelector(sel);
  const escapar = v => String(v === undefined || v === null ? '' : v)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const vencida = due => due && due < hoje();

  let kiro, tarefas = [], columns = {}, vuelta = {}, config = {}, ajustes = { ordem: 'Data', finalizadas: 20 };
  let editando = null, arrastrando = null;

  // Columna de uma tarefa: done=true é "finalizado"; senão a que guardamos (padrão "a fazer").
  const columnaDe = t => t.done ? 'finalizado' : (COLUMNAS.includes(columns[t.id]) ? columns[t.id] : 'a-fazer');
  const rotulo = id => (config[id] && config[id].trim()) || PADRAO[id];

  // Ordem escolhida em Configurações → Plug-ins; o desempate é sempre pelo título.
  const PESO = { Alta: 0, 'Média': 1, Baixa: 2 };
  const porTitulo = (a, b) => a.title.localeCompare(b.title, 'pt-BR');
  const porData = (a, b) => (a.due !== b.due ? (!a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1) : 0);   // sem data vai ao fim
  function ordenar(lista) {
    const criterio = ajustes.ordem === 'Prioridade' ? (a, b) => (PESO[a.priority] ?? 1) - (PESO[b.priority] ?? 1) || porData(a, b)
      : ajustes.ordem === 'Título' ? () => 0 : porData;
    return [...lista].sort((a, b) => criterio(a, b) || porTitulo(a, b));
  }

  async function cargar() {
    tarefas = await kiro.tasks.list();
    columns = (await kiro.storage.get('columns')) || {};
    vuelta = (await kiro.storage.get('vuelta')) || {};
    config = (await kiro.storage.get('config')) || {};
    ajustes = await kiro.settings.get();
    render();
  }

  function avisar(texto, erro) {
    const s = $('#status');
    s.textContent = texto;
    s.style.color = erro ? 'var(--acento-forte)' : 'var(--muted)';
  }

  // ---- Guardar a columna nova + sincronizar done (otimista, sem piscar) ----
  async function mover(id, columna) {
    const t = tarefas.find(x => x.id === id);
    if (!t) return;
    const origen = columnaDe(t);
    if (origen === columna) return;
    const aFinalizado = columna === 'finalizado' && !t.done;
    const eraFinalizado = origen === 'finalizado' && t.done;
    if (aFinalizado) vuelta[id] = origen;
    else if (eraFinalizado) delete vuelta[id];
    columns[id] = columna;
    if (aFinalizado) t.done = true;
    else if (columna !== 'finalizado' && eraFinalizado) t.done = false;
    render();
    await kiro.storage.set('columns', columns);
    await kiro.storage.set('vuelta', vuelta);
    if (aFinalizado) await kiro.tasks.update(id, { done: true });
    else if (columna !== 'finalizado' && eraFinalizado) await kiro.tasks.update(id, { done: false });
  }

  function render() {
    const porCol = Object.fromEntries(COLUMNAS.map(c => [c, []]));
    for (const t of tarefas) porCol[columnaDe(t)].push(t);

    $('#tauler').innerHTML = COLUMNAS.map(col => {
      const items = ordenar(porCol[col]);
      // Finalizado mostra só as primeiras N; o contador continua com o total.
      const visiveis = col === 'finalizado' ? items.slice(0, ajustes.finalizadas) : items;
      const resto = items.length - visiveis.length;
      const vazio = items.length ? '' : '<p class="vazio">Nada por aqui.</p>';
      const mais = resto ? `<p class="vazio">e mais ${resto}</p>` : '';
      return `<section class="col" data-col="${col}"><header>
          <i class="ponto" aria-hidden="true"></i><h2>${escapar(rotulo(col))}</h2>
          <b class="livro" aria-label="Tarefas">${items.length}</b>
        </header><div class="lista">${vazio}${visiveis.map(tarjeta).join('')}${mais}</div></section>`;
    }).join('');

    // Re-ligar os handlers depois de reconstruir o DOM.
    for (const c of $('#tauler').querySelectorAll('.card')) {
      c.addEventListener('dragstart', aoArrastrar);
      c.addEventListener('dragend', () => c.setAttribute('dragging', 'false'));
    }
    for (const c of $('#tauler').querySelectorAll('.col')) {
      c.addEventListener('dragover', e => { if (arrastrando) { e.preventDefault(); c.setAttribute('data-sobre', 'true'); } });
      c.addEventListener('dragleave', e => { if (!c.contains(e.relatedTarget)) c.setAttribute('data-sobre', 'false'); });
      c.addEventListener('drop', e => {
        e.preventDefault();
        c.setAttribute('data-sobre', 'false');
        const id = arrastrando; arrastrando = null;
        if (id) mover(id, c.dataset.col);
      });
    }
    for (const i of $('#tauler').querySelectorAll('.check input')) i.addEventListener('change', alternar);
    for (const b of $('#tauler').querySelectorAll('.titulo')) b.addEventListener('click', () => abrirEdicion(b.closest('.card').dataset.id));
    for (const b of $('#tauler').querySelectorAll('[data-mover]')) b.addEventListener('click', () => mover(b.closest('.card').dataset.id, b.dataset.mover));
  }

  function tarjeta(t) {
    const col = columnaDe(t), idx = COLUMNAS.indexOf(col);
    const ant = idx > 0 ? COLUMNAS[idx - 1] : null, prox = idx < COLUMNAS.length - 1 ? COLUMNAS[idx + 1] : null;
    const fecha = t.due
      ? `<span class="data"${vencida(t.due) && !t.done ? ' vencida="true"' : ''}>${escapar(t.due)}</span>`
      : '';
    const prio = `<span class="chip" prio="${escapar(t.priority)}">${escapar(t.priority)}</span>`;
    const setas = `<span class="acoes-col">${ant ? `<button type="button" class="mover-col" data-mover="${ant}" title="Mover para ${escapar(rotulo(ant))}" aria-label="Mover para ${escapar(rotulo(ant))}">‹</button>` : ''}${prox ? `<button type="button" class="mover-col" data-mover="${prox}" title="Mover para ${escapar(rotulo(prox))}" aria-label="Mover para ${escapar(rotulo(prox))}">›</button>` : ''}</span>`;
    return `<article class="card" draggable="true" data-id="${escapar(t.id)}">
      <label class="check"><input type="checkbox"${t.done ? ' checked' : ''} aria-label="${t.done ? 'Marcar como pendiente' : 'Marcar como finalizada'}"></label>
      <div class="corpo"><p class="titulo"${t.done ? ' grizo="true"' : ''} title="Editar tarefa">${escapar(t.title)}</p>
        <div class="meta">${prio}${fecha}${setas}</div></div>
    </article>`;
  }

  function aoArrastrar(e) {
    arrastrando = e.currentTarget.dataset.id;
    e.currentTarget.setAttribute('dragging', 'true');
    if (e.dataTransfer) e.dataTransfer.setData('text/plain', arrastrando);
  }

  async function alternar(e) {
    const t = tarefas.find(x => x.id === e.currentTarget.closest('.card').dataset.id);
    if (!t) return;
    if (e.currentTarget.checked) await mover(t.id, 'finalizado');
    else await mover(t.id, vuelta[t.id] || 'a-fazer');
  }

  function abrirEdicion(id) {
    const t = tarefas.find(x => x.id === String(id));
    if (!t) return;
    editando = t;
    $('#editar-titulo').value = t.title;
    $('#editar-data').value = t.due || '';
    $('#editar-prioridade').value = t.priority;
    $('#modal-editar').setAttribute('visible', 'true');
    $('#editar-titulo').focus();
  }
  function cerrarEdicion() {
    editando = null;
    $('#modal-editar').setAttribute('visible', 'false');
  }

  async function guardarEdicion() {
    if (!editando) return;
    const titulo = $('#editar-titulo').value.trim();
    if (!titulo) return avisar('O título não fica vazio.', true);
    try {
      await kiro.tasks.update(editando.id, {
        title: titulo,
        due: $('#editar-data').value || undefined,
        priority: $('#editar-prioridade').value,
      });
      const id = editando.id;
      cerrarEdicion();
      await cargar();
      avisar('Tarefa atualizada.');
    } catch (erro) {
      avisar(String((erro && erro.message) || erro), true);
    }
  }

  async function novaTarefa() {
    const titulo = $('#nova-titulo').value.trim();
    if (!titulo) return avisar('Escreve o título da tarefa.', true);
    try {
      const t = await kiro.tasks.create({
        title: titulo,
        due: $('#nova-data').value || undefined,
        priority: $('#nova-prioridade').value,
      });
      columns[t.id] = $('#nova-columna').value;
      await kiro.storage.set('columns', columns);
      $('#nova-titulo').value = '';
      $('#nova-data').value = '';
      $('#nova-prioridade').value = 'Média';
      await cargar();
      avisar('Tarefa adicionada.');
    } catch (erro) {
      avisar(String((erro && erro.message) || erro), true);
    }
  }

  // ---- Ajustes: renombrar as colunas (fica no storage do plug-in) ----
  function abrirAjustes() {
    for (const id of COLUMNAS) $(`#cfg-${id}`).value = rotulo(id);
    $('#modal-cfg').setAttribute('visible', 'true');
  }
  function cerrarAjustes() {
    $('#modal-cfg').setAttribute('visible', 'false');
  }
  async function guardarAjustes() {
    const novo = {};
    for (const id of COLUMNAS) novo[id] = $(`#cfg-${id}`).value.trim() || PADRAO[id];
    config = novo;
    cerrarAjustes();
    await kiro.storage.set('config', config);
    await cargar();
    avisar('Colunas atualizadas.');
  }

  (async function iniciar() {
    kiro = await window.kiro.ready;
    $('#nova-boton').addEventListener('click', novaTarefa);
    $('#nova-titulo').addEventListener('keydown', e => { if (e.key === 'Enter') novaTarefa(); });
    $('#recargar').addEventListener('click', () => cargar());
    $('#opciones').addEventListener('click', abrirAjustes);
    $('#editar-guardar').addEventListener('click', guardarEdicion);
    $('#editar-cancelar').addEventListener('click', cerrarEdicion);
    $('#modal-editar').addEventListener('click', e => { if (e.target.id === 'modal-editar') cerrarEdicion(); });
    $('#cfg-guardar').addEventListener('click', guardarAjustes);
    $('#cfg-cancelar').addEventListener('click', cerrarAjustes);
    $('#modal-cfg').addEventListener('click', e => { if (e.target.id === 'modal-cfg') cerrarAjustes(); });
    await cargar();
  })();
})();