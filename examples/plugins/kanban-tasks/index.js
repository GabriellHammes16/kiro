// Exemplo de plug-in para Kiro — copia esta pasta a <cofre>/.kiro/plugins/ para
// usarlo. Ver docs/plugins.md, sección "Frames (custom UI)".
//
// Quadro Kanban de tarefas: em preparação · a fazer · em progresso · finalizado.
// As tarefas do Kiro não têm campo de estado (só `done`), por isso a columna de
// cada tarefa vive no kiro.storage do plug-in; "Finalizado" sincroniza
// done=true para que o check da app e o grafo vejam a mesma coisa.

export default {
  async activate(kiro) {
    // ```kiro:kanban-tasks
    kiro.block(() => ({ frame: 'board.html', height: 480 }));

    // Miniatura no Hoje: as colunas pendentes, com → para avançar. Dá para pô-la
    // no lugar de "Para fazer agora" em Hoje → Personalizar (ou Configurações → Hoje).
    kiro.panel('pendentes', 'Quadro de tarefas', ({ options } = {}) => ({
      frame: 'mini.html',
      height: 160,
      data: { limite: options?.limite ?? 3, preparacao: options?.preparacao ?? true },
    }), {
      options: [
        { key: 'limite', type: 'number', label: 'Tarefas por coluna', default: 3, min: 1, max: 10 },
        { key: 'preparacao', type: 'boolean', label: 'Mostrar "Em preparação"', default: true },
      ],
    });
  },
};