// Recarga ao vivo do modo de desenvolvimento. O servidor só serve e injeta
// este arquivo com --dev; o aplicativo desktop e o `npm start` nunca o veem.
(() => {
  let boot = null;
  const fonte = new EventSource('/dev/events');

  // Não joga fora texto digitado: salva a nota aberta antes de recarregar e,
  // se não der para salvar agora, tenta de novo em instantes.
  async function recarregar(motivo) {
    const sujo = typeof editorDirty !== 'undefined' && editorDirty;
    if (sujo && !(await salvarNota().catch(() => false))) {
      status(`${motivo} mudou. A página recarrega quando a nota puder ser salva.`, true);
      return void setTimeout(() => recarregar(motivo), 1500);
    }
    location.reload();
  }

  // O servidor manda um id a cada inicialização. Id diferente numa reconexão
  // significa que o node --watch reiniciou por mudança em vault.cjs, server.mjs
  // ou agent/, e a página precisa buscar o código novo.
  fonte.addEventListener('boot', evento => {
    if (boot && boot !== evento.data) recarregar('O servidor');
    boot = evento.data;
  });

  fonte.addEventListener('reload', evento => recarregar(evento.data));

  // Estilo troca sem recarregar: a nota aberta, a pasta expandida e a posição
  // de rolagem continuam onde estavam.
  fonte.addEventListener('css', () => {
    const atual = document.querySelector('link[rel="stylesheet"][href^="styles.css"]');
    if (!atual) return void location.reload();
    const nova = atual.cloneNode();
    nova.href = `styles.css?v=${Date.now()}`;
    // A folha antiga só sai depois que a nova carregou, para a tela não piscar sem estilo.
    nova.onload = () => atual.remove();
    atual.after(nova);
  });
})();
