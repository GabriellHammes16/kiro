// Regras dos status, sem tela: carregado pela lista.html (window.ListaEstados) e pelos testes (require).
(function (root) {
  const STATUS = ['nao-comecado', 'andamento', 'pausado', 'concluido'];
  const ROTULOS = { 'nao-comecado': 'Não começado', andamento: 'Em andamento', pausado: 'Pausado', concluido: 'Concluído' };

  // Tarefa feita no Kiro é sempre "concluido"; reaberta no Kiro (done=false) sai de "concluido".
  function statusDe(tarefa, guardados) {
    if (tarefa.done) return 'concluido';
    const s = guardados && guardados[tarefa.id];
    return STATUS.includes(s) && s !== 'concluido' ? s : 'nao-comecado';
  }

  // O que muda ao levar a tarefa a `destino`: o status guardado e, se for o caso, o done no Kiro.
  function mudanca(tarefa, destino) {
    if (!STATUS.includes(destino)) return null;
    const feita = destino === 'concluido';
    return { status: destino, done: feita === Boolean(tarefa.done) ? undefined : feita };
  }

  // Status vizinho, para mover pelo teclado (← →); para nas pontas.
  const vizinho = (status, passo) => STATUS[Math.min(STATUS.length - 1, Math.max(0, STATUS.indexOf(status) + passo))];

  // Dentro da seção: data mais próxima primeiro, Alta antes, depois o título.
  const PESO = { Alta: 0, 'Média': 1, Baixa: 2 };
  const ordenar = lista => [...lista].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (PESO[a.priority] ?? 1) - (PESO[b.priority] ?? 1) || a.title.localeCompare(b.title, 'pt-BR'));

  const agrupar = (tarefas, guardados) => Object.fromEntries(STATUS.map(s => [s, ordenar(tarefas.filter(t => statusDe(t, guardados) === s))]));

  const api = { STATUS, ROTULOS, statusDe, mudanca, vizinho, ordenar, agrupar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ListaEstados = api;
})(globalThis);
