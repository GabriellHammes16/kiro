# Editor com visualização ao vivo — etapa 3 (plug-ins, Fluxo, limpeza e entrega)

Data: 2026-10-02 · Estado: aprovado no brainstorming.

## Objetivo

Fechar a paridade do editor novo com o atual e entregá-lo: blocos de plug-in desenhados no editor,
o editor novo nos cartões de texto do Fluxo, remoção do editor antigo de blocos, as pendências da
etapa 2 e o instalador.

## Decisões

| Assunto | Decisão |
|---|---|
| Blocos ```` ```kiro:<id> ```` | Cursor fora do bloco: desenho do plug-in no lugar do bloco inteiro (o mesmo da leitura). Cursor em qualquer linha do bloco: a fonte em Markdown |
| Cartão de texto do Fluxo | O editor novo completo (visualização ao vivo, corretor, fórmulas, links) no lugar do `textarea` |
| Rótulo de seta do Fluxo | Continua `<input>` (uma linha, sem Markdown) |
| Editor antigo de blocos | Removido; o `textarea` simples fica só como reserva se o CodeMirror não carregar |
| Pendências da etapa 2 | Tarefa pelo teclado (Ctrl+Enter); altura estimada dos widgets de bloco; Ctrl+clique abre o link na linha do cursor |
| Entrega | Instalador 0.19.0 depois da verificação no app desktop; merge em `idiomas-etapa-1` e `main` só depois que o usuário aprovar o instalador |

## Blocos de plug-in

- `editor-widgets.js`: `acharElementos` passa a reconhecer `blocoPlugin` `{ de, ate, id, fonte }`
  para cercas `kiro:<id>` (a mesma regra da leitura: `^kiro:([a-z0-9][a-z0-9-]{1,39})$`); vem do
  `StateField` de blocos, como a fórmula `$$`. Fora de código; com `\r\n` as posições continuam
  certas. Cerca sem fechamento: não é desenhada (fica como Markdown).
- O widget recebe o HTML por uma opção nova `desenharBlocoPlugin(id, fonte) → html`; `eq` compara
  `id` e `fonte`, então digitar em outro lugar não recria o desenho (nem o iframe da moldura).
- `app.js`: `desenharBlocoPlugin` devolve a mesma marcação da leitura
  (`<figure class="plugin-bloco" data-plugin data-fonte><div class="plugin-bloco-conteudo">…`) e
  chama `agendarBlocosDosPlugins()`; o resto (cache, `chamarPlugin`, higienizador, molduras,
  avisos "não está ativo"/"Carregando…"/erro) já existe e vale igual. A marcação sai de uma função
  única usada pela leitura e pelo editor.
- Clique no desenho põe o cursor no início do bloco (mostra a fonte); cliques dentro de uma
  moldura (iframe) são do plug-in.

## Cartões de texto do Fluxo

- `fluxo-tela.js` recebe uma opção nova `montarEditor(elemento, { texto, aoTerminar })` → `{ texto(), focar(), destruir() } | null`;
  sem ela (ou se devolver `null`), usa o `textarea` atual.
- `app.js` implementa `montarEditor` com `KiroEditor.montar`, com as mesmas opções de ortografia,
  widgets e menu do botão direito do corpo da nota; Ctrl+S não age sobre a nota aberta (o cartão
  grava como sempre, ao terminar). Se o CodeMirror ainda não carregou, carrega antes; se falhar,
  devolve `null`.
- Comportamento igual ao de hoje: Esc ou sair (perder o foco) grava; o cartão cresce se o texto
  não couber, nunca encolhe; teclas não vazam para o Fluxo (Delete, Ctrl+Z ficam no texto);
  Ctrl+Z desfaz dentro do cartão.
- O editor é destruído ao terminar; um cartão por vez.

## Remoção do editor antigo

- Saem de `app.js` as funções do editor de blocos (`abrirBloco`, `montarCampo`, `fecharBloco`,
  `teclaNoBloco` e o que só elas usam) e o CSS que só elas usam.
- Ficam: `renderizarMarkdown` (leitura, painel da direita, notas no Fluxo) e o `textarea`
  `doc-corpo-simples` de reserva.
- Frases de idioma que deixarem de ser usadas saem de `idiomas/en.js` (o teste de cobertura
  continua passando).

## Pendências da etapa 2

- Tarefa pelo teclado: Ctrl+Enter (Cmd+Enter no Mac) marca/desmarca as tarefas das linhas do cursor ou
  da seleção, como no Obsidian (a caixa dentro do editor não pode receber o foco do teclado sem
  atrapalhar a digitação); mesma transação do clique, Ctrl+Z desfaz.
- `estimatedHeight` nos widgets de bloco (fórmula `$$`, cabeçalho do código, bloco de plug-in).
- Ctrl+clique (Cmd no Mac) num link desenhado abre o link mesmo na linha do cursor; clique sem
  modificador continua como na etapa 2.

## Desempenho

- Abrir a nota longa (67,6 KB) quente sem piora sobre a etapa 2 (17 ms); digitar < 16 ms por tecla.
- Abrir um cartão do Fluxo para editar < 50 ms com o CodeMirror já carregado.

## Falhas

| Situação | Comportamento |
|---|---|
| Plug-in inativo, sem blocos, carregando ou com erro | Os mesmos avisos da leitura no lugar do bloco |
| CodeMirror não carrega no cartão do Fluxo | O `textarea` de hoje |
| Cerca `kiro:` sem fechamento | Markdown, sem desenho |

## Testes

- `npm test`: `acharElementos` reconhece `blocoPlugin` (id, fonte, posições com `\r\n`), ignora id
  inválido, cerca sem fechamento e `kiro:` dentro de outro código; `soBlocos` inclui o bloco;
  cobertura de idiomas.
- App desktop automatizado (quem coordena), com `--dev-vault`:
  - nota com bloco de um plug-in de exemplo: desenhado fora do cursor; fonte com o cursor dentro;
    digitar fora não recria o desenho;
  - cartão de texto do Fluxo: editar mostra o editor novo, sublinha palavra errada sem digitar,
    Esc grava, o cartão cresce, Ctrl+Z desfaz no texto;
  - Ctrl+Enter marca a tarefa da linha do cursor; Ctrl+clique no `[[link]]` da linha do cursor abre a nota;
  - nada do editor antigo no DOM; `npm test` sem falhas.
- Instalador 0.19.0 gerado e instalado num perfil limpo: abre, edita, salva.

## Fora do escopo

- Tabelas e notas de rodapé desenhadas (a leitura não as desenha).
- Editor novo em outros campos (título, buscas, rótulos de seta).
- Traduções para chinês (etapa futura dos idiomas).
