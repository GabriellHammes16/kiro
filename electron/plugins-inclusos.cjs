const fs = require('node:fs/promises');
const { join, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: esperar } = require('node:timers/promises');

const IDS = ['focus-pomodoro', 'flashcards', 'weekly-review', 'slides'];

// Pasta existente pertence ao usuário; só instalamos plug-ins ausentes, sem ativá-los.
function instalarPluginsInclusos(vault, origem) {
  return vault.exclusive(async () => {
    for (const id of IDS) {
      const destino = await vault.pluginPath(id);
      try { await fs.lstat(destino); continue; }
      catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
      const fonte = join(origem, id);
      const arquivos = await fs.readdir(fonte, { withFileTypes: true });
      if (!arquivos.some(a => a.name === 'manifest.json') || !arquivos.some(a => a.name === 'index.js')) throw new Error(`Plug-in incluso incompleto: ${id}`);
      for (const arquivo of arquivos) {
        if (!arquivo.isFile() || !/^(?:manifest\.json|[a-z0-9][a-z0-9._-]{0,60}\.(?:js|html|css))$/i.test(arquivo.name)) throw new Error(`Arquivo de plug-in incluso inválido: ${id}`);
      }
      const temporario = await vault.safePath(`.kiro/plugins/.incluso-${randomUUID()}`);
      await fs.mkdir(dirname(temporario), { recursive: true });
      await fs.mkdir(temporario);
      try {
        for (const arquivo of arquivos) await fs.copyFile(join(fonte, arquivo.name), join(temporario, arquivo.name));
        // O Windows pode segurar os arquivos recém-copiados durante a verificação do antivírus.
        for (let tentativa = 0; ; tentativa++) {
          try { await fs.rename(temporario, destino); break; }
          catch (erro) {
            if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(erro.code) || tentativa >= 3) throw erro;
            await esperar(100 * (tentativa + 1));
          }
        }
      } finally { await fs.rm(temporario, { recursive: true, force: true }); }
    }
  });
}

module.exports = { instalarPluginsInclusos, IDS };
