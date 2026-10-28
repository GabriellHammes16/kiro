import './modelo.js';

export default {
  activate(kiro) {
    kiro.panel('summary', 'Tempo de foco', async () => {
      try {
        const settings = await kiro.settings.get();
        const state = globalThis.KiroFocus.read(await kiro.storage.get('timer'), settings);
        const summary = globalThis.KiroFocus.today(state.history);
        return { type: 'stack', children: [
          { type: 'text', text: `${summary.minutes} min de foco · ${summary.count} ${summary.count === 1 ? 'sessão hoje' : 'sessões hoje'}` },
          { type: 'text', text: 'Abra Foco / Pomodoro na barra lateral para cuidar do seu próximo ciclo.' },
        ] };
      } catch (error) {
        return { type: 'text', text: `Não foi possível ler o foco: ${error.message}` };
      }
    });
  },
};
