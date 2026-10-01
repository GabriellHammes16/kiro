# Editor com visualização ao vivo — etapa 1 (base)

Data: 2026-10-01 · Estado: aprovado no brainstorming.

## Objetivo

O corpo da nota passa a ser editado como no modo padrão do Obsidian: a nota inteira fica
sempre editável, o Markdown aparece formatado e os símbolos (`**`, `#`, `[[ ]]`) só aparecem na
linha do cursor. O motivo imediato é o corretor ortográfico: o editor atual abre um `textarea`
por trecho, com o texto posto por código, e o Chromium só verifica um `textarea` depois que
alguém digita nele — por isso o clique direito em "ovario" não sugere "ovário". Um editor
`contenteditable` é verificado sozinho assim que recebe o foco (medido em 2026-10-01: "ovario"
com sugestões em 2 s; `textarea` sem verificação nem após 6 s, nem com quatro truques testados).

O trabalho tem três etapas, cada uma com spec, plano e revisão próprios, todas no branch
`editor-ao-vivo` (criado sobre `idiomas-etapa-1`). **Nenhum instalador sai antes do fim da
etapa 3**: o editor novo só chega ao app quando fizer tudo o que o atual faz.

1. **Etapa 1 (esta spec):** CodeMirror 6 embutido; editor da nota inteira; visualização ao vivo
   do texto; corretor com sugestões; salvar, desfazer, atalhos, menu do botão direito,
   sugestões de `[[`; a releitura de 5 s deixa de atrapalhar a edição.
2. **Etapa 2:** widgets — caixa de tarefa, imagem com redimensionar, fórmula KaTeX, bloco de
   código com Copiar, callout, tabela, nota de rodapé; clique que abre `[[link]]` e
   `#etiqueta`.
3. **Etapa 3:** blocos de plug-in, campos de texto do Fluxo (mesmo problema do corretor),
   remoção do editor antigo, instalador.

## Decisões

| Assunto | Decisão |
|---|---|
| Motor | CodeMirror 6 (licença MIT; nenhum código do Obsidian é usado — a visualização ao vivo é escrita no Kiro) |
| Empacotamento | `vendor/codemirror/codemirror.js`, um arquivo só, gerado por `scripts/build-codemirror.mjs` com `esbuild` (devDependency) e commitado, com `LICENSE.txt` e `VERSAO.txt` — como o KaTeX. O app continua sem etapa de build |
| Carregamento | Sob demanda, na primeira nota aberta (não pesa na abertura do app) |
| Módulo novo | `editor-nota.js` → `KiroEditor`; não conhece o cofre |
| Símbolos | Escondidos fora da linha do cursor (ou das linhas da seleção) |
| Texto no cofre | Idêntico byte a byte ao que o editor recebeu, se nada foi editado (inclui `\r\n`) |
| Entrega | Só no fim da etapa 3, num instalador único |

## Estrutura

### `vendor/codemirror/codemirror.js`

Bundle IIFE que define o global `CM` (e, no Node, `module.exports`) com o que o Kiro usa de
`@codemirror/state`, `@codemirror/view`, `@codemirror/commands` (incluindo `history`),
`@codemirror/language`, `@codemirror/lang-markdown` (com as extensões do GitHub: tachado,
tabelas, tarefas) e `@lezer/markdown`. `scripts/build-codemirror.mjs` gera o arquivo e grava a
versão de cada pacote em `VERSAO.txt`; as licenças MIT vão em `LICENSE.txt`.

### `editor-nota.js` (`KiroEditor`)

```js
const editor = KiroEditor.montar(elemento, {
  texto,              // corpo da nota, como está no cofre
  aoMudar(texto),     // a cada edição (o app grava em editing.body e marca a nota como alterada)
  aoSalvar(),         // Ctrl+S
  titulos(),          // títulos das notas, para as sugestões de [[
  existe(alvo),       // se [[alvo]] aponta para nota existente (desenho tracejado quando não)
});
editor.texto(); editor.definirTexto(novo); editor.area(); editor.focar(); editor.destruir();
KiroEditor.carregar(): Promise   // garante o vendor carregado; falha → rejeita
```

Partes puras, testáveis no Node, exportadas à parte:
- `ocultar(texto, linhasDoCursor)` → intervalos de símbolos a esconder e intervalos a estilizar,
  a partir da árvore de sintaxe e das marcações do Kiro.
- `marcacoesDoKiro(linha)` → `[[alvo|apelido]]`, `#etiqueta`, `==realce==` com posições.
- `separadorDeLinha(texto)` → `'\r\n'` se o texto usa `\r\n`, senão `'\n'`.

### Mudanças no `app.js`

- `renderEditor` desenha `<div class="doc-corpo" id="doc-corpo">` vazio; `bindEditor` chama
  `KiroEditor.montar` com `aoMudar = texto => { editing.body = texto; sujar(); }`.
- Para o corpo da nota, o editor de blocos (`abrirBloco`, `montarCampo`, `fecharBloco`,
  `teclaNoBloco`, …) deixa de ser usado; o código fica até a etapa 3. `renderizarMarkdown`
  continua servindo à leitura em outras telas (painel da direita, nota no Fluxo).
- **Adaptador dos menus:** `editor.area()` devolve `{ value, selectionStart, selectionEnd,
  setSelectionRange(a, b), focus(), inserir(texto) }`; `inserir` vira uma transação do
  CodeMirror (entra no desfazer dele). `inserirTexto(area, texto)` usa `area.inserir` quando
  existe. `menuDaNota`, `envolver`, `prefixar`, `inserirBloco` e os atalhos de formatar
  continuam iguais.
- **Redesenhar sem recriar:** se, depois de um `render()`, a nota aberta é a mesma, a instância
  do editor é recolocada no `#doc-corpo` novo em vez de recriada (cursor, rolagem e desfazer
  preservados). Se o texto do cofre mudou por fora, `definirTexto` aplica a mudança mantendo o
  cursor o quanto der.
- **Releitura de 5 s:** com uma nota aberta no editor, ela não redesenha o editor nem tira o
  foco dele (hoje `setBusy` deixa a interface inerte, o foco sai e o trecho aberto fecha).
- Corretor (Task 4 de idiomas): `CAMPO_DE_TEXTO` já cobre `contenteditable`; o menu do botão
  direito do corpo passa a ser aberto a partir do editor novo, com as sugestões no topo.

## Visualização ao vivo (etapa 1)

| Elemento | Desenho | Escondido fora da linha do cursor |
|---|---|---|
| Títulos `#`…`######` | tamanhos e pesos atuais | `# ` |
| `**negrito**`, `*itálico*`, `~~tachado~~`, `==realce==` | estilo correspondente | os símbolos |
| `` `código` `` | mono com fundo | as crases |
| `[texto](url)` | só o texto, cor de link | `[`, `](url)` |
| `[[Nota]]`, `[[Nota\|apelido]]` | nome ou apelido, cor de wikilink; tracejado se a nota não existe | `[[`, `]]`, `Nota\|` |
| `#etiqueta` | cor de etiqueta | — |
| Listas `-` `*` `+` `1.` | `•` ou número, com recuo | o símbolo vira `•` |
| Citação `>` | barra lateral | `> ` |
| `---` | linha horizontal | `---` |
| Bloco de código ```` ``` ```` | fundo e mono nas linhas | as cercas |

Os estilos reaproveitam as classes CSS da leitura (`.md-*`), para o texto não mudar de cara.
Elementos da etapa 2 (tarefa, imagem, fórmula, callout, tabela, nota de rodapé) aparecem como
Markdown com cores, nunca quebrados.

**Corretor:** `spellcheck="false"` nas decorações de código (em linha e blocos), endereços de
link, alvo de `[[Nota]]` (o apelido é verificado) e etiquetas.

**Teclado:** Enter continua a lista (item vazio sai dela); Tab/Shift+Tab recuam itens; Ctrl+Z
/ Ctrl+Y; os atalhos de formatar atuais; Ctrl+S salva; Esc tira o foco; Enter ou seta para
baixo no título descem para o texto; sugestões de `[[` com setas, Enter e Esc, como hoje.

## Desempenho

- CodeMirror carregado só na primeira nota aberta; uma instância por nota aberta, reaproveitada.
- Decorações só na parte visível.
- Medição no `dev-vault`, antes e depois: tempo para abrir a nota mais longa; atraso por tecla
  em 200 teclas; `render()` de Hoje e Notas. Critério: abrir a nota sem piora perceptível
  (≤ 1,5× o tempo atual), digitar abaixo de 16 ms por tecla, Hoje e Notas sem piora.

## Falhas

| Situação | Comportamento |
|---|---|
| `vendor/codemirror` não carrega | A nota abre num `textarea` simples com o Markdown cru; status "Não foi possível carregar o editor"; dá para escrever e salvar |
| Nota com `\r\n` | O editor devolve `\r\n`; abrir e salvar sem editar não muda um byte |
| Texto mudou no cofre com a nota suja | Como hoje: a releitura não sobrescreve |
| Trocar de nota com alterações | Como hoje: salvar antes de trocar |

## Testes

- `npm test` (Node, sem navegador):
  - ida e volta: `EditorState` criado com o texto e lido de volta é idêntico — `\r\n`,
    tabulação, espaço no fim de linha, acentos, emoji;
  - `ocultar`: `**a**` esconde os `**` fora da linha do cursor e não esconde nela; títulos,
    links, wikilinks com apelido, listas, citações, cercas de código;
  - `marcacoesDoKiro`: `[[Nota|apelido]]`, `#etiqueta`, `==realce==`, e o que não é marcação
    (`#` no meio de palavra, `[[` sem fechar);
  - adaptador `area()`: `envolver` e `prefixar` dão o mesmo texto que num `textarea`;
  - o teste de cobertura de idiomas continua passando (frases novas em `idiomas/en.js`).
- App desktop automatizado (feito por quem coordena, com o driver de automação do ambiente; o script não entra no repositório porque o driver não é dependência do projeto): clique direito em "ovario"
  no corpo da nota traz "ovário"; escolher troca e Ctrl+Z desfaz; Ctrl+S salva sem perder o
  cursor; 10 s com a nota aberta sem editar não fecham a edição nem tiram o foco.
- Sumário do painel da direita: clicar num título rola o editor até ele (hoje usa `data-pos` da
  leitura). Colar ou soltar imagem insere o `![[…]]` no cursor (o desenho da imagem é etapa 2).

## Fora do escopo desta etapa

- Widgets e cliques da etapa 2; blocos de plug-in, Fluxo e remoção do editor antigo da etapa 3.
- Modo código-fonte e alternância de modos.
- Corretor próprio em JavaScript (a versão web continua com Shift + botão direito).
