// Ferramentas do modo de desenvolvimento. Só são importadas com --dev: o
// servidor normal e o aplicativo instalado nunca carregam este arquivo.
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// O que muda no navegador sem reiniciar o servidor. Arquivos de back-end
// (server.mjs, vault.cjs, agent/) ficam com o node --watch, que reinicia o processo.
const OBSERVADOS = new Map([
  ['styles.css', 'css'],
  ['app.js', 'reload'],
  ['index.html', 'reload'],
  ['domain.js', 'reload'],
  ['kuroi-logo-transparent.png', 'reload'],
]);

export function createDevTools(root) {
  const clientes = new Set();
  const boot = Date.now().toString(36);
  const pendentes = new Map();
  const emitir = (evento, dado) => { for (const cliente of clientes) cliente.write(`event: ${evento}\ndata: ${dado}\n\n`); };

  // Observa a pasta, não cada arquivo: editores que salvam por troca de arquivo
  // matariam um observador preso ao arquivo antigo.
  const observador = watch(root, (_tipo, nome) => {
    const evento = nome && OBSERVADOS.get(nome);
    if (!evento) return;
    // O Windows dispara o mesmo salvamento duas ou três vezes seguidas.
    clearTimeout(pendentes.get(nome));
    pendentes.set(nome, setTimeout(() => { pendentes.delete(nome); emitir(evento, nome); }, 60));
  });

  // Comentário periódico para a conexão não ser encerrada por inatividade.
  const pulso = setInterval(() => { for (const cliente of clientes) cliente.write(': pulso\n\n'); }, 25000);
  pulso.unref();

  return {
    injetar: html => html.replace('</body>', '    <script src="/dev/reload.js"></script>\n  </body>'),
    script: () => readFile(join(root, 'dev', 'reload.js')),
    eventos(request, response) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write(`event: boot\ndata: ${boot}\n\n`);
      clientes.add(response);
      request.on('close', () => clientes.delete(response));
    },
  };
}
