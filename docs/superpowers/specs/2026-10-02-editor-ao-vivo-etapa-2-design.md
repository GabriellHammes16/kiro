# Editor com visualização ao vivo — etapa 2 (elementos desenhados)

Data: 2026-10-02 · Estado: aprovado no brainstorming.

## Objetivo

Na visualização ao vivo, os elementos que a leitura do Kiro já desenha passam a ser desenhados também
no editor (CodeMirror), fora da linha do cursor — como no Obsidian. Com isto e a etapa 3 (blocos de
plug-in, campos do Fluxo, remoção do editor antigo), o editor novo faz tudo o que o atual faz.

Ajuste de escopo em relação à spec da etapa 1: **tabelas e notas de rodapé saem** — a leitura do Kiro
não as desenha hoje, então não são necessárias para a paridade.

## Elementos

| Elemento | Fonte | Fora da linha do cursor | Interação |
|---|---|---|---|
| Tarefa | `- [ ] x` / `- [x] x` (também `*`, `+`, `1.`) | caixa de marcar no lugar de `[ ]`/`[x]`; item feito com o estilo da leitura (`.md-tarefa`) | clicar na caixa troca `[ ]`↔`[x]` numa transação normal (Ctrl+Z desfaz); o cursor não vai para a linha |
| Imagem | `![[caminho.png]]`, `![[caminho.png\|300]]` (`\|300x200`) | a imagem no lugar do código (mesmo HTML da leitura: `htmlDaImagem`) | clicar abre a imagem inteira (como hoje); arrastar a alça grava `\|largura` numa transação normal |
| Fórmula em linha | `$x^2$` (mesma regra da leitura: texto colado aos cifrões) | desenhada pelo KaTeX (`matematica(tex, false)`) | clicar entra na linha (mostra o código) |
| Fórmula em bloco | linhas entre `$$` e `$$` | bloco desenhado pelo KaTeX (`matematica(tex, true)`) quando o cursor não está em nenhuma linha do bloco | clicar entra no bloco |
| Bloco de código | ```` ```js ```` … ```` ``` ```` | cabeçalho com a linguagem (ou `t('texto')`) e o botão Copiar, no lugar da cerca de abertura | Copiar copia só o código (mesmo aviso da leitura) |
| Callout | `> [!tipo] título` | linhas com a classe da leitura (`md-destaque`), etiqueta com o tipo no lugar de `[!tipo]` | — |
| Comentário | `%%texto%%` | estilo `.md-comentario`, `%%` escondidos | — |
| Links | `[[Nota]]`, `[[Nota\|apelido]]`, `[texto](url)`, `#etiqueta` | já desenhados na etapa 1 | clique simples (botão esquerdo, sem modificador) no texto desenhado: abre a nota (`seguirWikilink`), o site (como `[texto](url)` faz na leitura) ou busca a etiqueta (`buscarEtiqueta`); na linha do cursor o clique só posiciona o cursor |

Em todos: na linha do cursor (ou nas linhas da seleção) aparece o Markdown para editar, como os outros
símbolos da etapa 1. Blocos (fórmula `$$`, cabeçalho do código) aparecem como Markdown quando o cursor
está em qualquer linha do bloco.

## Estrutura

- **`editor-widgets.js` (novo, UMD como `hoje.js`):**
  - parte pura, testável no Node: `acharElementos(state, de, ate)` → lista de
    `{ tipo: 'tarefa'|'imagem'|'formula'|'formulaBloco'|'cabecalhoCodigo'|'callout'|'comentario', de, ate, … }`
    a partir da árvore de sintaxe do Markdown e da mesma lógica de reconhecimento da leitura
    (cifrões colados, `lerImagem` equivalente para caminho/largura, `[!tipo]`);
  - parte do CodeMirror: as classes de widget e a extensão que as desenha. Widgets de bloco (fórmula
    `$$`, cabeçalho do código) vêm de um `StateField` (o CodeMirror exige isso para decorações de bloco);
    os em linha, de um `ViewPlugin`.
  - não conhece o app: recebe por opções `desenharFormula(tex, bloco) → html`,
    `desenharImagem(texto) → html | null`, `abrirImagem(caminho, nome)`, `abrirNota(alvo)`,
    `abrirSite(url)`, `buscarEtiqueta(texto)`, `copiar(texto) → Promise<boolean>`, `t`.
- **`editor-nota.js`:** `montar` passa a aceitar `widgets: { … }` e inclui a extensão quando presente.
  As decorações da etapa 1 e do corretor continuam; as novas não se sobrepõem a elas (um trecho
  substituído por widget não recebe marcas).
- **`app.js`:** `opcoesDoEditor()` passa `widgets` com as funções que já existem (`matematica`,
  `htmlDaImagem`+`lerImagem`, `abrirImagemInteira`, `seguirWikilink`, `buscarEtiqueta`,
  `copiarTexto`). O que hoje grava direto em `editing.body` (`marcarTarefa`, `gravarLarguraDaImagem`)
  não é usado pelo editor novo: a tarefa e a largura viram transações do editor.
- **`styles.css`:** reaproveita as classes da leitura (`.md-imagem`, `.md-tarefa`, `.md-destaque`,
  `.md-comentario`, `.code-area figcaption`, `.katex`) dentro de `.doc-corpo .cm-editor`, com ajustes
  mínimos para caber nas linhas do editor.

## Desempenho

- Só a parte visível; widgets reaproveitados quando nada mudou (`eq` dos widgets compara a fonte).
- KaTeX desenha só fórmulas visíveis; o resultado de cada fonte fica guardado.
- Critérios: abrir a nota longa (67,6 KB) quente sem piora perceptível (hoje ~7 ms; aceitar até
  1,5×); digitar < 16 ms por tecla; Hoje/Notas sem piora.

## Falhas

| Situação | Comportamento |
|---|---|
| KaTeX ausente ou fórmula inválida | igual à leitura: o código aparece (ou o erro da leitura) |
| Imagem que não carrega | igual à leitura (o `alt` com o nome) |
| Copiar bloqueado | aviso da leitura ("O navegador não liberou a área de transferência.") |

## Testes

- `npm test` (Node, `EditorState` real): `acharElementos` reconhece tarefas (`[ ]`, `[x]`, `[X]`,
  com `-`/`*`/`+`/`1.`), imagens com e sem largura, fórmulas em linha (e não `R$ 5 e R$ 10`), blocos
  `$$`, cercas de código com e sem linguagem (e não ```` ```kiro:… ````, que é da etapa 3), callouts
  e comentários; nada é reconhecido dentro de código; posições corretas com `\r\n`.
- Transações: marcar tarefa troca só o caractere certo; gravar largura troca só o trecho da imagem
  (funções puras que devolvem a mudança, testadas no Node).
- App desktop automatizado (quem coordena): nota de teste com cada elemento; fora do cursor, cada um
  desenhado; clicar na caixa marca e Ctrl+Z desfaz; arrastar a alça grava `|largura`; clicar no
  `[[link]]` abre a nota; clicar na `#etiqueta` busca; Copiar copia o código; na linha do cursor,
  o Markdown aparece.

## Fora do escopo

- Tabelas e notas de rodapé (a leitura não as desenha).
- Blocos de plug-in, campos do Fluxo, remoção do editor antigo, instalador — etapa 3.
