import './modelo.js';
const model = globalThis.KiroFlashcards;

export default {
  activate(kiro) {
    kiro.panel('revisoes', 'Flashcards', async () => {
      try {
        const [notes, saved] = await Promise.all([kiro.notes.list({ limit: 500 }), kiro.storage.get(model.KEY)]);
        const cards = model.parse(notes), count = model.queue(cards, model.progress(saved)).length;
        return { type: 'stack', children: [
          { type: 'text', text: count ? `${count} ${count === 1 ? 'cartão para revisar' : 'cartões para revisar'}. Abra Flashcards na barra lateral.` : cards.length ? 'Tudo em dia. Sua próxima revisão espera em Flashcards.' : 'Crie seu primeiro cartão em uma nota: Pergunta :: Resposta' },
          { type: 'text', text: 'Leitura de até 500 notas recentes.' },
        ] };
      } catch (error) {
        return { type: 'text', text: `Não foi possível carregar os flashcards. ${error.message || 'Tente atualizar o painel.'}` };
      }
    });
  },
};
