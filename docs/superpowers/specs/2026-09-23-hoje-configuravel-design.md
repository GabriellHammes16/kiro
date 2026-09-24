# Hoje configurável

Data: 2026-09-23 · Estado: aprovado no brainstorming.

## Objetivo

A tela Hoje deixa de ser fixa: cada pessoa escolhe quais cartões aparecem, em que ordem,
em que coluna, com que largura e com que opções. Cartões do Kiro e cartões de plug-in
(`kiro.panel`) entram no mesmo catálogo e são tratados do mesmo jeito.

É o primeiro sub-projeto da "flexibilidade do app". Ficam para especificações próprias,
depois: barra lateral configurável, cartão de nota fixada e novos pontos de extensão
para plug-ins (painel da direita, menu de contexto, aba nas Configurações).

## Decisões

| Assunto | Decisão |
|---|---|
| Abordagem | Módulo puro `hoje.js` (mesmo formato do `abas.js`) + catálogo de cartões montado em tempo de execução |
| Onde se edita | Nos dois lugares: modo **Personalizar** na própria Hoje e aba **Hoje** nas Configurações |
| Onde grava | No cofre, em `.kiro/hoje.json` (cada cofre tem a própria Hoje; entra no backup) |
| Colunas | 1, 2 ou 3; padrão 2 |
| Largura do cartão | `normal` (uma coluna) ou `inteira` (atravessa todas as colunas) |
| Opções por cartão | Declaradas (nativos e plug-ins); o Kiro desenha o formulário |
| Tipos de opção | `boolean`, `number` (mín./máx.), `select` (lista), `text` (até 80 caracteres) |
| Salvar | Cada mudança grava na hora (com o atraso curto habitual); não há "cancelar", há "Restaurar padrão" |
| Janela estreita (≤ 780 px) | Uma coluna, na ordem de leitura; nada é gravado por causa disso |

## Catálogo

Montado a cada desenho da Hoje; **não é gravado**. Cada entrada:

```js
{ id: 'nativo:habitos', titulo: 'Hábitos', origem: 'Kiro',
  largura: 'normal',                          // sugestão para a primeira vez
  opcoes: [{ key, type, label, default, … }],  // mesma forma das opções de plug-in
  render(opcoes) → html }                     // nativos; plug-ins desenham pelo caminho atual
```

### Cartões nativos

| id | Título | Coluna padrão | Opções |
|---|---|---|---|
| `nativo:frase` | Frase do dia | largura inteira, no topo | — |
| `nativo:habitos` | Hábitos | 0 | `mostrarSemana` (boolean, padrão `true`) |
| `nativo:agora` | Para fazer agora | 0 | `limite` (number 0–50, padrão 0) |
| `nativo:continuar` | Continuar de onde parei | 1 | — |
| `nativo:caixa` | Caixa de entrada | 1 | `limite` (number 0–50, padrão 0) |
| `nativo:revisar` | Para revisar | 1 | `limite` (number 0–50, padrão 0) |

A frase do dia sai do cabeçalho e vira cartão para poder ser escondida. O cabeçalho
continua com a saudação e a data. `limite` 0 quer dizer "todos" — é o padrão porque
nenhuma dessas listas é cortada hoje (o rótulo da opção diz "0 = todos").

Um cartão cujo `render` devolve vazio (hoje, Para revisar sem nada a revisar) não ocupa
lugar na Hoje; no modo Personalizar ele aparece com o título e um "Nada agora", para
poder ser movido e escondido.

### Cartões de plug-in

`plugin:<idDoPlugin>:<idDoPainel>`, vindos do `kiro.panel` de cada plug-in ativo. Título
é o `label`; origem é o nome do plug-in.

## Layout (o que é gravado)

```js
{ colunas: 2,
  cartoes: [{ id, coluna: 0, largura: 'normal' | 'inteira', opcoes: { … } }, …],
  ocultos: ['nativo:revisar', …] }
```

- A ordem dentro de cada coluna é a ordem em `cartoes`. Um cartão `inteira` ignora
  `coluna` para desenhar, mas mantém o valor (volta para ela se virar `normal`).
- `ocultos` guarda os ids escondidos; um cartão oculto continua em `cartoes`, com
  posição e opções, para voltar ao mesmo lugar.
- `opcoes` guarda só o que foi mudado; o que falta vale o padrão da declaração.

### Faixas

Para desenhar, `faixas(layout, visiveis)` transforma o layout numa sequência de faixas:
cartões `normal` consecutivos (pela ordem em `cartoes`) formam uma faixa de colunas;
cada cartão `inteira` forma uma faixa própria e quebra as colunas naquele ponto.

### Primeira vez e arquivo inválido

Sem `.kiro/hoje.json` (ou com conteúdo que `limpar` rejeita por inteiro), vale o
**layout padrão**, que reproduz a Hoje atual: frase no topo, Hábitos e Para fazer agora
à esquerda; Continuar, Caixa de entrada, Para revisar e os cartões de plug-in à direita.

## Módulo `hoje.js`

Funções puras; cada uma recebe um layout e devolve um novo. Roda no navegador
(`KiroHoje`) e no Node (testes), carregado em `index.html` ao lado de `abas.js`.

- `padrao(catalogo)`: o layout padrão.
- `mover(l, id, { coluna, antes })`: leva o cartão para a coluna, antes do id `antes`
  (ou para o fim da coluna se `antes` for nulo). Serve para arrastar e para as setas.
- `subir(l, id)` / `descer(l, id)`: trocam de lugar com o vizinho visível na mesma coluna
  (ou na mesma sequência, para cartões `inteira`).
- `esconder(l, id)` / `mostrar(l, id)`.
- `definirLargura(l, id, largura)`.
- `definirColunas(l, n)`: `n` entre 1 e 3; cartões com `coluna >= n` vão para a última
  coluna, no fim dela, mantendo a ordem relativa.
- `definirOpcao(l, id, chave, valor, declaracao)`: grava só se o valor for válido para a
  declaração; valor igual ao padrão apaga a chave.
- `opcoesEfetivas(l, id, declaracao)`: padrões + valores gravados válidos.
- `reconciliar(l, catalogo)`: cartão do catálogo ausente do layout entra no fim da coluna
  com menos cartões visíveis (empate: a de menor índice), com a largura sugerida. Ids do
  layout que não estão no catálogo **ficam** no layout (plug-in desativado volta ao
  mesmo lugar), mas não são desenhados.
- `limpar(bruto)`: o que vem do disco não é confiável. Recusa o que não for objeto;
  `colunas` fora de 1–3 vira 2; descarta cartões sem `id` string, repetidos, ou com
  `coluna`/`largura` inválidas (corrige para 0/`normal`); `ocultos` só com ids presentes
  em `cartoes`; `opcoes` precisa ser objeto de valores primitivos. No máximo 200 cartões.
- `faixas(l, idsVisiveis)`: ver acima.
- `restaurarPadrao(catalogo)` = `padrao(catalogo)`.

Validar valores de opção contra a declaração (tipo, faixa, lista) fica em
`definirOpcao` e `opcoesEfetivas`, não em `limpar`: o layout é lido antes de os
plug-ins terminarem de registrar os painéis.

## Opções de plug-in

`kiro.panel` ganha um 4º argumento opcional, **compatível** com os plug-ins atuais:

```js
kiro.panel('longest', 'Longest notes', render, {
  options: [
    { key: 'limit', type: 'number', label: 'How many', default: 5, min: 1, max: 20 },
    { key: 'folder', type: 'select', label: 'Folder', default: 'all', choices: ['all', 'work'] },
    { key: 'showDates', type: 'boolean', label: 'Show dates', default: true },
    { key: 'title', type: 'text', label: 'Heading', default: '' },
  ],
  width: 'full',   // sugestão inicial: 'normal' (padrão) ou 'full'
});
```

- O worker repassa a declaração no registro `pronto`:
  `panel: [{ id, label, options, width }]`.
- `render` passa a receber `{ action, values, options }`; `options` sempre completo
  (padrões + valores gravados válidos). Mudar uma opção redesenha o cartão com
  `action: ''`.
- **`KiroPlugins.validarOpcoesDoPainel(lista)`** (pura, em `plugins.js`), chamada pelo
  hospedeiro quando o registro chega:
  - lista com no máximo 12 itens; `key` casa `/^[a-z][a-zA-Z0-9]{0,31}$/`, sem repetir;
  - `type` ∈ `boolean | number | select | text`;
  - `label` com 1–40 caracteres, sem caracteres de controle;
  - `default` do tipo certo; `number` com `min ≤ default ≤ max` (finitos);
    `select` com 1–20 `choices` de texto (até 40 caracteres cada) e `default` entre elas;
    `text` com `default` de até 80 caracteres;
  - `width` ∈ `normal | full`, se vier.
  - Resultado `{ ok: true, opcoes, largura }` ou `{ ok: false, erro }`.
- Declaração inválida: o cartão aparece com o erro de validação no conteúdo (como os
  erros de painel hoje) e **sem** opções; o resto do plug-in segue funcionando.
- Todo texto de rótulo, escolha e valor é inserido com `escapeHtml`; o plug-in nunca
  fornece HTML para o formulário.

## Interface

### Modo Personalizar (na Hoje)

- Botão **Personalizar** no cabeçalho da Hoje; vira **Concluir** enquanto o modo está ligado.
- No modo, o conteúdo dos cartões não reage a cliques (sem marcar hábito sem querer) e
  cada cartão mostra:
  - alça de arraste (HTML5 drag & drop, como a barra de abas);
  - botões ↑ ↓ (ordem) e ← → (coluna), com `aria-label` — o caminho pelo teclado e pelo toque;
  - **Largura** (alterna normal/inteira);
  - **Opções**, só se o cartão tiver opções: popover com o formulário gerado;
  - **Esconder** (X).
- Soltar entre dois cartões insere ali; soltar numa coluna vazia põe no fim dela.
  Destaque do alvo durante o arraste, como nas abas.
- Rodapé do modo: **Cartões escondidos** (um chip por cartão, clique traz de volta),
  seletor **Colunas: 1 · 2 · 3** e **Restaurar padrão** (com confirmação).
- Cartão de plug-in desativado não aparece nem nos escondidos; cartão de plug-in com
  erro ou carregando se move e se esconde normalmente.

### Aba "Hoje" nas Configurações

- Seletor de colunas e **Restaurar padrão**.
- Lista de todos os cartões do catálogo, na ordem do layout: caixa de marcar
  (visível), título, origem, ↑ ↓, seletor de coluna, seletor de largura e **Opções**
  (expande o mesmo formulário na linha).

As duas telas chamam as mesmas funções de `KiroHoje` sobre o mesmo layout e depois
gravam e redesenham; nenhuma lógica de layout fica na tela.

## Gravação

- `vault.cjs`: `lerHoje()` → objeto ou `null` (arquivo ausente); `gravarHoje(layout)`
  por `atomicWrite` em `.kiro/hoje.json`, mesmo caminho de `.kiro/plugins.json`.
- Exposto no Electron (`main.cjs` + preload) e no `server.mjs`, como as escolhas dos
  plug-ins.
- No app: lido ao abrir o cofre (e ao trocar de cofre), passado por `limpar` e
  `reconciliar`; gravado com o atraso curto habitual após cada mudança. Erro de
  gravação aparece no status, como os outros erros de gravação; o layout em memória
  continua valendo.

## Testes

`node --test`, sem dependências novas.

- **`tests/hoje-layout.test.cjs`** (novo; `tests/hoje.test.cjs` já cobre o domínio da
  Hoje): padrão igual à Hoje atual; `mover` na coluna e entre colunas; `subir`/`descer`
  pulando ocultos; `esconder`/`mostrar`; `definirLargura`; `definirColunas` 3→2 e 2→1;
  `reconciliar` (novo vai para a coluna mais curta; ausente fica guardado);
  `limpar` com lixo, repetidos, colunas fora da faixa, mais de 200 cartões;
  `definirOpcao`/`opcoesEfetivas` (valor inválido é ignorado, valor igual ao padrão
  apaga a chave, chave desconhecida some); `faixas` com cartão inteiro no meio.
- **`tests/plugins.test.cjs`**: `validarOpcoesDoPainel` — declaração válida de cada
  tipo e cada recusa listada acima; plug-in sem 4º argumento continua válido.
- **`tests/vault.test.cjs`**: `gravarHoje` → `lerHoje` devolve o mesmo layout; sem
  arquivo, `null`.
- **Exemplo `word-count`**: ganha a opção `limit` no painel; o teste do exemplo confere
  a declaração com `validarOpcoesDoPainel`.
- Interface (arraste, popover, Configurações): conferida à mão com `npm run dev`
  antes de dar como pronta.

## Documentação

`docs/plugins.md`: seção **Panel options** (declaração, tipos, limites, o que o
`render` recebe) e nota de que a pessoa decide posição, largura e visibilidade do
cartão; `width` é só a sugestão inicial.
