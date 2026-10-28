kiro.ready.then(api => {
  const model = globalThis.KiroFlashcards;
  const $ = id => document.getElementById(id);
  let cards = [], rows = {}, pending = [], total = 0, completed = 0, busy = false, revealed = false;
  function lock(value) {
    busy = value;
    for (const id of ['refresh', 'reveal', 'wrong', 'right']) $(id).disabled = value;
    $('study').setAttribute('aria-busy', String(value));
  }
  function fail(error, message) {
    $('error').textContent = `${message} ${error.message || 'Tente novamente.'}`;
    $('error').hidden = false;
  }
  function draw() {
    const card = pending[0];
    $('summary').textContent = `${cards.length} ${cards.length === 1 ? 'cartão encontrado' : 'cartões encontrados'} · ${pending.length} para revisar agora`;
    $('study').hidden = !card;
    $('empty').hidden = !!card;
    if (!card) {
      $('empty-title').textContent = cards.length ? (completed ? 'Revisão concluída' : 'Tudo em dia') : 'Sua memória começa com uma pergunta';
      const next = cards.map(c => rows[c.id]?.dueAt).filter(t => Number.isFinite(t) && t > Date.now()).sort((a,b) => a-b)[0];
      $('empty-detail').textContent = cards.length ? (next ? `Próxima revisão em ${new Date(next).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Clique em Atualizar quando chegar a hora.` : 'Atualize para buscar novos cartões nas notas.') : 'Em uma nota, escreva Pergunta :: Resposta. Depois volte aqui e clique em Atualizar.';
      return;
    }
    $('position').textContent = `CARTÃO ${completed + 1} DE ${total}`;
    $('remaining').textContent = `${completed} ${completed === 1 ? 'revisado' : 'revisados'}`;
    $('progress').max = total;
    $('progress').value = completed;
    $('source').textContent = card.title;
    $('question').textContent = card.question;
    $('answer').textContent = revealed ? card.answer : '';
    $('answer-area').hidden = !revealed;
    $('rating').hidden = !revealed;
    $('reveal').hidden = revealed;
    const days = [1,3,7,14,30][Math.min(rows[card.id]?.step || 0, 4)];
    $('next-interval').textContent = `Rever em ${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  async function load() {
    if (busy) return;
    lock(true); $('error').hidden = true;
    try {
      const [notes, saved] = await Promise.all([api.notes.list({ limit: 500 }), api.storage.get(model.KEY)]);
      cards = model.parse(notes); rows = model.progress(saved);
      pending = model.queue(cards, rows); total = pending.length; completed = 0; revealed = false;
      draw();
    } catch (error) { fail(error, 'Não foi possível atualizar as revisões.'); }
    finally { lock(false); }
  }
  async function rate(remembered) {
    if (busy || !revealed || !pending.length) return;
    lock(true); $('error').hidden = true;
    try {
      rows = await model.review(api.storage, pending[0].id, remembered);
      pending.shift(); completed++; revealed = false;
      draw();
      if (pending.length) $('question').focus();
      else $('summary').textContent = `${completed} ${completed === 1 ? 'revisão salva' : 'revisões salvas'}. Tudo em dia por agora.`;
    } catch (error) { fail(error, 'A revisão não foi salva. O cartão continua aqui; tente novamente.'); }
    finally { lock(false); }
  }
  $('refresh').addEventListener('click', load);
  $('reveal').addEventListener('click', () => { revealed = true; draw(); $('wrong').focus(); });
  $('wrong').addEventListener('click', () => rate(false));
  $('right').addEventListener('click', () => rate(true));
  load();
}).catch(error => {
  const notice = document.getElementById('error');
  notice.textContent = `Não foi possível iniciar Flashcards. ${error.message || 'Reabra a página.'}`;
  notice.hidden = false;
  document.getElementById('summary').textContent = 'Reabra a página para tentar novamente.';
});
