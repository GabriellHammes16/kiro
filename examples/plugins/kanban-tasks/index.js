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
  },
};