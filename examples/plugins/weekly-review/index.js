import './modelo.js';

export default {
  async activate(kiro) {
    const load = async () => {
      const [notes, tasks] = await Promise.all([kiro.notes.list({ limit: 500 }), kiro.tasks.list()]);
      return globalThis.KiroWeeklyReview.collect(notes, tasks);
    };
    kiro.command('gerar', 'Gerar revisão semanal', async () => {
      try {
        const data = await load();
        await globalThis.KiroWeeklyReview.createReview(kiro, globalThis.KiroWeeklyReview.markdown(data));
        kiro.notify(`Revisão semanal salva (${data.start} a ${data.end}).`);
      } catch (error) { kiro.notify(`Não foi possível gerar a revisão. ${error.message || ''}`, { error: true }); }
    });
    kiro.panel('resumo', 'Revisão semanal', async () => {
      try {
        const data = await load();
        return { type: 'stack', children: [
          { type: 'text', text: `${data.start} — ${data.end}` },
          { type: 'text', text: `${data.notes.length} notas recentes · ${data.tasks.length} tarefas abertas · ${data.overdue.length} atrasadas` },
          { type: 'text', text: 'Leitura limitada às 500 notas recentes.' },
        ] };
      } catch (error) { return { type: 'text', text: `Não foi possível carregar a revisão: ${error.message || 'tente novamente.'}` }; }
    });
  },
};
