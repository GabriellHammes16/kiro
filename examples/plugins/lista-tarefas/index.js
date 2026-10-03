// Lista de Tarefas: to-do list por status (não começado · em andamento · pausado · concluído).
// A tela própria (manifest.page) e o cartão do Hoje usam a mesma lista.html; o status de cada
// tarefa vive no kiro.storage do plug-in, e "Concluído" acompanha o done da tarefa no Kiro.
// Ver docs/plugins.md, seção "Frames (custom UI)".

export default {
  async activate(kiro) {
    kiro.panel('lista', 'Lista de tarefas', ({ options } = {}) => ({
      frame: 'lista.html',
      height: 220,
      data: { cartao: true, concluidas: options?.concluidas ?? false },
    }), {
      options: [{ key: 'concluidas', type: 'boolean', label: 'Mostrar "Concluído"', default: false }],
    });
  },
};
