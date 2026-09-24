# Fluxo: canvas de ideias no Kiro

Data: 2026-09-23 · Estado: aprovado no brainstorming, aguardando revisão da spec.

## Objetivo

Um canvas infinito para mapas mentais e para ligar ideias, no modelo do canvas do
Obsidian, que conversa com o resto do cofre (notas, imagens, links, blocos de código,
fórmulas) e que uma IA externa, via MCP, consegue criar a partir de uma nota, ler e
editar. O Kiro nunca chama IA por conta própria.

## Decisões

| Assunto | Decisão |
|---|---|
| Formato | JSON Canvas 1.0 (`.canvas`), especificação aberta sob licença MIT. Compatível com o Obsidian nos dois sentidos. Não copiamos código, ícones nem a marca do Obsidian; na documentação, "compatível com JSON Canvas" |
| Onde | Dentro de Pastas: o `.canvas` aparece na árvore com a etiqueta "FLUXO", abre em aba e divide a tela com notas. Sem tela própria na navegação |
| Cartão de nota | Prévia viva em leitura só; dois cliques abrem a nota na metade ao lado |
| Backlinks | Só no painel da direita da nota ("Aparece nos fluxos"). O Grafo não muda |
| Guardar | Os fluxos entram no estado do cofre (`state.fluxos`) e são gravados na mesma transação do `vault.write` |
| Desenhar | Cartões em DOM dentro de um contêiner com `transform: translate() scale()`; setas numa camada `<svg>` por baixo. Sem biblioteca |
| Código | `fluxo.js` puro (formato do `abas.js`: `module.exports` no Node, `globalThis.KiroFluxo` no navegador) e `fluxo-tela.js` para a interação. O `app.js` só roteia |
| IA | Ferramentas `list_fluxos`, `read_fluxo`, `create_fluxo` e `update_fluxo` na Agent API. A IA manda estrutura; o Kiro posiciona |

## Formato do arquivo

- Segue o JSON Canvas 1.0: `nodes` (`text`, `file`, `link`, `group`) com `id`, `x`, `y`,
  `width`, `height` e `color` opcional; `edges` com `id`, `fromNode`, `toNode` e,
  opcionais, `fromSide`, `toSide`, `fromEnd`, `toEnd`, `color` e `label`.
- Cores: `"1"` a `"6"` (as seis predefinidas da especificação) ou `#rrggbb`.
- Campos desconhecidos, no topo, nos cartões e nas setas, são preservados na leitura e
  na gravação.
- Gravação com `JSON.stringify(canvas, null, '\t')`, como o Obsidian, e só quando o
  conteúdo mudou.
- Cartão de nota ou imagem: `"file"` com o caminho relativo ao cofre
  (`"Investimento/O básico.md"`).
- Ids novos: 16 caracteres hexadecimais aleatórios.

## Estado e cofre

- `vault.read()` carrega todo arquivo `*.canvas` visível em
  `state.fluxos = [{ id, file, title, folderId, canvas, erro? }]`. `title` é o nome do
  arquivo sem extensão; `folderId` segue a mesma regra das notas.
- **Id do fluxo:** gravado no `caderno.json` (`fluxos: [{ id, path }]`), como as pastas
  sem marcador. Não vai para dentro do `.canvas`, porque o Obsidian descartaria o
  campo. Um arquivo movido por fora do Kiro ganha id novo (`fluxo-<hash do caminho>`) e
  a aba que o mostrava fecha pelo `limpar` do `abas.js`.
- **JSON inválido:** o cofre abre normalmente, o fluxo entra com `erro` (mensagem),
  aparece em leitura só com o aviso e o arquivo nunca é regravado.
- `vault.write()` passa a gravar `state.fluxos` junto com as notas, na mesma transação,
  com a mesma trava, a mesma checagem de revisão e o mesmo histórico:
  - fluxo novo ou alterado: grava o `.canvas`;
  - fluxo que saiu do estado: vai para a lixeira como as notas e pode ser restaurado;
  - nota renomeada ou movida: o `file` de todo cartão que apontava para o caminho
    antigo é reescrito (o mesmo mapa `changes` que o `rewritePaths` usa);
  - pasta renomeada ou movida: já funciona hoje (arquivos que não são nota são
    remapeados).
- Nota apagada: o cartão continua no fluxo e mostra "Nota não encontrada". Nenhum
  cartão é apagado automaticamente.
- `validateState` (em `domain.js`) aceita `fluxos` ausente como `[]`.

## `fluxo.js` (puro, testável)

Funções imutáveis sobre o objeto JSON Canvas:

- `ler(texto)`: `{ canvas }` ou `{ erro }`. Valida tipos e campos obrigatórios e
  descarta setas que apontam para cartões inexistentes, avisando.
- `serializar(canvas)`
- `adicionarCartao(c, cartao)`, `moverCartoes(c, ids, dx, dy)`,
  `redimensionar(c, id, w, h)`, `editarCartao(c, id, campos)`,
  `removerCartoes(c, ids)` (leva as setas ligadas junto), `ligar(c, seta)`,
  `removerSetas(c, ids)`.
- `encaixar(valor, grade = 20)`.
- `renomearArquivos(c, mapa)`: reescreve `file` pelo mapa caminho antigo → novo.
- `notasCitadas(c)`: caminhos de cartões `file` `.md` e alvos de `[[links]]` dentro de
  cartões de texto. Base do backlink.
- `historico`: `empilhar(h, canvas)`, `desfazer(h)`, `refazer(h)`, com limite de 100
  passos.
- `layout(nodes, edges, { raiz })`: o layout automático (abaixo).
- `inserirPerto(c, novos, edges)`: posiciona cartões novos sem mexer nos existentes.

`domain.js` ganha `fluxosQueCitam(state, nota)`, que usa `notasCitadas` e a resolução
de links que as notas já usam.

## Editor (`fluxo-tela.js`)

**Navegar**
- Fundo com grade de pontos. Pan: arrastar o fundo com o botão do meio ou com
  espaço+arrastar; roda sem modificador rola na vertical, Shift+roda na horizontal.
- Zoom: Ctrl+roda, de 10% a 400%, centrado no cursor. Shift+1 enquadra tudo.
  Porcentagem de zoom no canto.
- A posição e o zoom de cada fluxo ficam no `localStorage`, por cofre, nunca no
  arquivo.

**Criar**
- Dois cliques no fundo criam um cartão de texto já em edição.
- Barra inferior: Cartão · Nota do cofre · Imagem. "Nota do cofre" reusa o modal
  "Ir para nota" (Ctrl+O, `irParaNota`), que ganha a opção de devolver a nota escolhida
  em vez de abri-la. "Imagem" abre o seletor de arquivos do sistema e grava a imagem
  como anexo, pelo mesmo caminho da imagem colada.
- Botão direito no fundo: Adicionar cartão · Adicionar nota do cofre · Adicionar
  imagem · Adicionar link · Criar grupo · Desfazer · Colar · Encaixar na grade (marcado
  por padrão). Usa o `abrirMenuContexto` que já existe.
- Arrastar uma nota da árvore para o fluxo cria o cartão dela no ponto onde ela foi
  solta.
- Colar: texto vira cartão de texto; URL sozinha vira cartão de link; imagem vai para
  os anexos pelo caminho que o editor de notas já usa (`/api/anexo` ou
  `saveAttachment`) e vira um cartão de imagem.

**Ligar**
- Ao passar o mouse num cartão aparecem quatro alças (cima, baixo, esquerda, direita).
  Arrastar de uma alça até outro cartão cria a seta. Soltar no vazio cria um cartão de
  texto novo, já ligado e em edição.
- Dois cliques na seta editam o rótulo. Botão direito na seta: cor, direção
  (→, ↔, —) e excluir.

**Editar**
- Clique seleciona; Shift+clique adiciona à seleção; arrastar no fundo com o botão
  esquerdo desenha um retângulo de seleção.
- Arrastar move a seleção; a alça no canto inferior direito redimensiona; Delete apaga.
  Um grupo arrastado leva junto os cartões que estão dentro dele.
- Dois cliques num cartão de texto abrem um `<textarea>` com o Markdown; fora da edição
  ele aparece com o `renderizarMarkdown` (código, KaTeX, `[[links]]` clicáveis).
  Esc ou clicar fora encerram a edição.
- Dois cliques num cartão de nota abrem a nota na outra metade (`abrirNota` com
  `colunaNova`). Num cartão de link, abrem o navegador.
- Botão direito no cartão: cor, duplicar, excluir e, só em cartão de texto,
  "Transformar em nota" (cria a nota com o texto na pasta do fluxo e troca o cartão por
  um cartão de nota no mesmo lugar e tamanho).
- Ctrl+Z / Ctrl+Y (ou Ctrl+Shift+Z) usam o `historico` de `fluxo.js`; a pilha vive
  enquanto o fluxo está aberto.
- Cada mudança agenda o salvamento do estado com a mesma espera do editor de notas.

**Cartões**
- Texto: Markdown renderizado; o conteúdo que passa da altura rola dentro do cartão.
- Nota: título e prévia renderizada da versão salva, atualizada quando o estado muda.
  Nota ausente mostra "Nota não encontrada".
- Imagem: a imagem pelo mesmo caminho que as notas usam para anexos.
- Link: título (a URL sem protocolo) e a URL; não embute a página.
- Grupo: moldura com rótulo, desenhada atrás dos outros cartões.

**Árvore e abas**
- `.canvas` aparece na árvore com a etiqueta "FLUXO". Botão direito numa pasta ganha
  "Novo fluxo" ("Sem título.canvas", depois "Sem título 1", …). Renomear, mover,
  arrastar e excluir funcionam como com notas.
- Uma aba cujo id é de fluxo abre o editor de fluxo; a outra metade continua podendo
  mostrar uma nota. Só há um item em edição por vez, e ativar a outra metade salva o
  que estava sendo editado, como já acontece com notas.
- O painel da direita de uma nota ganha "Aparece nos fluxos", com links que abrem o
  fluxo.

Cortado da primeira versão: página web embutida (iframe, que brigaria com a CSP),
encaixar para objetos, modo somente leitura, layout radial e busca dentro do fluxo.

## Ferramentas para a IA

Em `agent/tools.cjs`, com operações em `agent/api.cjs`. Publicadas pelo MCP como
`kiro_*`, com a validação de schema, as permissões e a auditoria que já existem.

- `list_fluxos` (`read`): `[{ id, path, title, cards, links }]`.
- `read_fluxo` (`read`), por `id` ou `path`: cartões `{ id, type, text | note | url | label, color }`
  e ligações `{ id, from, to, label }`. Com `positions: true`, inclui `x`, `y`,
  `width` e `height`.
- `create_fluxo` (`create`): `{ title, folder?, nodes, edges?, root?, sourceNote? }`.
  - Cartão: `{ id, type: "text" | "note" | "link" | "group", text | note | url | label, color?, x?, y?, width?, height? }`.
    O `id` é um apelido escolhido pela IA; o Kiro troca pelos ids reais e as ligações
    podem usar os apelidos.
  - `note` aceita caminho ou título de nota; nota não encontrada recusa a chamada
    inteira, com a lista das que faltam.
  - Sem `x`/`y` em algum cartão, o `layout` posiciona todos os que não têm posição.
  - `sourceNote` adiciona um cartão da nota de origem ligado à raiz; sem `folder`, o
    fluxo é gravado na pasta dessa nota.
  - Recusa um segundo fluxo com o mesmo título na mesma pasta.
  - A descrição da ferramenta ensina a receita: para transformar uma nota em mapa
    mental, leia com `read_note`, use um cartão por ideia, faça os títulos virarem
    ramos e os blocos de código virarem cartões próprios, e passe `sourceNote`.
- `update_fluxo` (`update`): `{ id | path, add_nodes?, add_edges?, update_nodes?, remove_nodes?, remove_edges? }`.
  Cartões novos sem posição passam por `inserirPerto`: ficam à direita do cartão de
  onde sai a primeira seta que os liga, abaixo dos irmãos, sem mover os cartões que já
  existiam.
- Limites: 300 cartões por chamada e 5.000 caracteres por cartão.
- Toda chamada é tudo-ou-nada: qualquer erro vira `AgentError` com a mensagem do que
  corrigir, e nada é gravado.
- A gravação passa pelo mesmo `Vault.save`; o Kiro aberto recebe o estado novo pelo
  caminho que já usa quando a IA edita notas.
- `docs/agent-api.md` e `docs/mcp.md` documentam as quatro ferramentas, com o exemplo
  "transforma a nota X num fluxo".

## Layout automático

- É uma árvore da esquerda para a direita. A raiz é `root` ou, sem ele, o primeiro
  cartão sem setas chegando (o primeiro da lista, se todos tiverem).
- Cada nível é uma coluna, com 80 px entre colunas e 20 px entre irmãos. A altura de um
  ramo é a soma das alturas dos filhos, e o pai fica centrado no ramo, então nada se
  sobrepõe.
- Só a primeira seta que chega a um cartão conta para a árvore. As outras (ciclos,
  ligações cruzadas) são desenhadas, mas ignoradas no cálculo.
- Cartões fora da árvore ficam numa fileira abaixo dela.
- Largura padrão 280. A altura é estimada pelo número de linhas do texto (cerca de 40
  caracteres por linha, 24 px por linha, mínimo 60) e ajustada ao conteúdo real na
  primeira vez que o fluxo abre no Kiro.
- Todas as posições são encaixadas na grade de 20 px.

## Etapas

Cada etapa é utilizável sozinha e tem o próprio plano.

1. **Arquivo e editor básico:** `fluxo.js` (ler, serializar, operações, histórico),
   `state.fluxos` no cofre com id no `caderno.json` e JSON inválido protegido, árvore e
   abas, "Novo fluxo", pan e zoom, cartões de texto, setas, seleção, desfazer e grade.
2. **Integração com o cofre:** cartões de nota, imagem, link e grupo; arrastar da
   árvore; colar; "Transformar em nota"; renomeação de nota refletida nos cartões;
   lixeira; "Aparece nos fluxos".
3. **IA:** `layout`, `inserirPerto`, as quatro ferramentas e a documentação.

## Erros

- Falha ao salvar: o mesmo aviso das notas; as mudanças continuam na tela.
- Cofre alterado por outro editor (por exemplo a IA): o mesmo aviso de revisão das
  notas.
- `.canvas` inválido: leitura só, com a mensagem de erro, sem regravar.
- Nota ausente num cartão: aviso no próprio cartão.
- Pedido inválido da IA: `AgentError` e nada gravado.

## Testes

`node --test`, sempre em pastas temporárias.

- `tests/fluxo.test.cjs`: `ler` (válido, JSON quebrado, seta para cartão inexistente),
  preservação de campos desconhecidos, operações e remoção em cascata de setas,
  histórico com limite, `renomearArquivos`, `notasCitadas`, `layout` (sem sobreposição,
  raiz explícita e implícita, ciclo não trava, cartões soltos embaixo) e
  `inserirPerto` (existentes não se mexem).
- `tests/vault.test.cjs`: carregar e gravar `.canvas`; id estável no `caderno.json`;
  renomear e mover nota reescreve o cartão; mover pasta leva o fluxo; excluir manda
  para a lixeira e restaurar volta; JSON inválido fica intocado; conteúdo igual não
  regrava.
- `tests/agent.test.cjs`: criar com layout e com posições dadas, `sourceNote`, ler,
  atualizar por operações, permissões negadas, limites, nota inexistente e
  tudo-ou-nada.
- A interação na tela é verificada rodando o app, como nas outras telas.
