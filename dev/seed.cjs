// Cofre de exemplo do modo de desenvolvimento. Escreve só em <projeto>/dev-vault,
// nunca no cofre pessoal, e passa pelo Vault como qualquer salvamento da interface.
const fs = require('node:fs/promises');
const path = require('node:path');
const { Vault } = require('../vault.cjs');

const DEV_VAULT = path.join(__dirname, '..', 'dev-vault');
const EXEMPLOS_PLUGINS = path.join(__dirname, '..', 'examples', 'plugins');

const dia = (delta = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function vazio(diretorio) {
  try { return (await fs.readdir(diretorio)).length === 0; }
  catch (erro) { if (erro.code === 'ENOENT') return true; throw erro; }
}

// Cada nota cobre um pedaço do que a interface desenha: links que existem e que
// não existem, rótulos, blocos de código, destaques, tarefas, tags e pastas aninhadas.
function conteudo(agora) {
  const nota = (id, title, folderId, linhas, tags = []) => ({ id, title, folderId, tags, links: [], updatedAt: agora, body: linhas.join('\n') });
  return {
    folders: [
      { id: 'f-estudos', title: 'Estudos', parentId: '' },
      { id: 'f-python', title: 'Python', parentId: 'f-estudos' },
      { id: 'f-projetos', title: 'Projetos', parentId: '' },
      { id: 'f-vazia', title: 'Pasta vazia', parentId: '' },
    ],
    notes: [
      nota('n-bemvindo', 'Bem-vindo ao modo de desenvolvimento', '', [
        'Este cofre existe só para testar a interface. Edite, apague e bagunce à vontade: `npm run dev:reset` recria tudo.',
        '',
        '> [!tip] Recarga ao vivo',
        '> Mudanças em styles.css aparecem sem recarregar. Mudanças em app.js recarregam a página, salvando antes a nota aberta.',
        '',
        '## Links',
        '',
        '- Nota que existe: [[Plano de estudos]]',
        '- Com rótulo: [[Listas em Python|listas]]',
        '- Nota que ainda não existe: [[Ideia futura]]',
        '- Link externo: [Obsidian](https://obsidian.md)',
        '',
        '## Formatação',
        '',
        '**Negrito**, *itálico*, ~~riscado~~, ==realce==, `código em linha` e %%comentário%%.',
        '',
        '## Tarefas',
        '',
        '- [x] Abrir o modo de desenvolvimento',
        '- [ ] Mudar alguma coisa em styles.css',
        '',
        '## Equações',
        '',
        'Na linha: $a^2 + b^2 = c^2$. Em bloco:',
        '',
        '$$',
        '\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
        '$$',
        '',
        '```js',
        'function saudacao(nome) {',
        '  return `Olá, ${nome}!`;',
        '}',
        '```',
        '',
        '#dev #exemplo',
      ], ['dev']),
      nota('n-plano', 'Plano de estudos', 'f-estudos', [
        '# Plano de estudos',
        '',
        'Começar por [[Listas em Python]] e depois voltar para [[Bem-vindo ao modo de desenvolvimento]].',
        '',
        '1. Fundamentos',
        '2. Estruturas de dados',
        '3. Projeto final: [[Kiro]]',
        '',
        '---',
        '',
        'Um parágrafo mais longo ajuda a ver a largura da coluna de leitura, a altura das linhas e como o texto quebra quando a janela fica estreita. Redimensione a janela para conferir.',
        '',
        'Outro parágrafo, para haver algo a rolar.',
      ]),
      nota('n-listas', 'Listas em Python', 'f-python', [
        'Listas guardam itens em ordem.',
        '',
        '```python',
        'frutas = ["maçã", "banana"]',
        'frutas.append("uva")',
        'print(frutas[-1])  # uva',
        '```',
        '',
        'Veja também [[Plano de estudos]]. #python',
      ], ['python']),
      nota('n-kiro', 'Kiro', 'f-projetos', [
        'Segundo cérebro local. Relacionadas: [[Bem-vindo ao modo de desenvolvimento]] e [[Ideia futura]].',
        '',
        '> Uma citação simples, sem tipo de destaque.',
        '',
        '#projeto',
      ], ['projeto']),
      nota('n-rascunho', 'Rascunho sem pasta', '', [
        'Nota sem links: aparece como um nó isolado no grafo.',
      ]),
    ],
    tasks: [
      { id: 't-listas', title: 'Revisar listas', due: dia(0), priority: 'Alta', done: false, noteId: 'n-listas' },
      { id: 't-lixeira', title: 'Testar a lixeira', due: dia(1), priority: 'Média', done: false },
      { id: 't-cofre', title: 'Criar o cofre de exemplo', due: dia(-1), priority: 'Baixa', done: true },
    ],
    routine: [
      { id: 'r-agua', title: 'Beber água', date: dia(0), done: false },
      { id: 'r-leitura', title: 'Ler 20 minutos', date: dia(0), done: true },
    ],
  };
}

/** Leva os plug-ins de exemplo para o cofre. Não sobrescreve o que já está lá e
 * não derruba o seed se a pasta examples/plugins não existir. */
async function copiarPluginsDeExemplo(diretorio = DEV_VAULT) {
  const destino = path.join(diretorio, '.kiro', 'plugins');
  try {
    await fs.cp(EXEMPLOS_PLUGINS, destino, { recursive: true, force: false, errorOnExist: false });
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }
}

async function semear(diretorio = DEV_VAULT) {
  const vault = new Vault(diretorio);
  const atual = await vault.load();
  const salvo = await vault.save({ ...atual, ...conteudo(Date.now()) });
  await copiarPluginsDeExemplo(diretorio);
  return salvo;
}

/** Semeia só pasta vazia ou inexistente: nunca mistura exemplo com notas de verdade. */
async function semearSeVazio(diretorio = DEV_VAULT) {
  if (!(await vazio(diretorio))) return false;
  await semear(diretorio);
  return true;
}

module.exports = { DEV_VAULT, semear, semearSeVazio };

if (require.main === module) {
  (async () => {
    // --reset apaga apenas a pasta fixa dev-vault do projeto; KIRO_VAULT é ignorado de propósito.
    if (process.argv.includes('--reset')) await fs.rm(DEV_VAULT, { recursive: true, force: true });
    const criou = await semearSeVazio();
    console.log(criou ? `Cofre de desenvolvimento pronto em ${DEV_VAULT}` : `${DEV_VAULT} já tem conteúdo. Use npm run dev:reset para recriar.`);
  })().catch(erro => { console.error(erro.message); process.exitCode = 1; });
}
