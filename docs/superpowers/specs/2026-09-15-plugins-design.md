# Sistema de plug-ins do Kiro

Data: 2026-09-15 · Estado: aprovado no brainstorming, pronto para virar plano.

## Objetivo

Permitir que qualquer pessoa escreva um plug-in para o Kiro sem poder machucar o
cofre de quem instala. O Kiro vai ser open-source, então plug-in de terceiro é
fronteira de confiança: o código roda isolado, pede permissões declaradas e só
funciona depois que a pessoa ativa.

Um plug-in pode oferecer quatro coisas: comandos, painéis, blocos de Markdown e
automações que reagem a eventos do cofre.

## Decisões

| Assunto | Decisão |
|---|---|
| Origem | Qualquer pessoa escreve; instalação é copiar a pasta |
| Local | `.kiro/plugins/<id>/` dentro do cofre |
| Isolamento | Código roda em Web Worker, sem DOM, sem disco, sem rede |
| Acesso ao cofre | Só pela Agent API que já existe, com permissões declaradas |
| Rede | Lista fechada de endereços no manifesto; quem chama é o Kiro |
| Markdown | Plug-in devolve HTML; o Kiro higieniza com lista de permitidos |
| API pública | Em inglês; código interno do Kiro segue em português |
| Instalação | Copiar pasta + ativar em Configurações. Sem download, sem loja |

## Formato do plug-in

```
.kiro/plugins/word-count/
  manifest.json
  index.js
```

`manifest.json`:

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "author": "fulano",
  "description": "Counts words in the open note.",
  "minKiro": "0.15.0",
  "permissions": ["notes:read"],
  "network": []
}
```

Regras do manifesto:

- `id`: minúsculas, números e hífen, 2–40 caracteres, igual ao nome da pasta.
- `version` e `minKiro`: `maior.menor.correcao`. O plug-in é recusado se
  `minKiro` for maior que a versão do Kiro.
- `permissions`: apenas os nomes fixos abaixo. Nome desconhecido recusa o plug-in.
- `network`: lista de hosts `https` exatos (sem curinga). Vazia quando não usa rede.
- `name`, `author`, `description`: texto de até 200 caracteres, exibido como texto puro.

`index.js` exporta um objeto com `activate(kiro)` e, opcionalmente, `deactivate()`.

## Permissões

| Nome | Dá acesso a |
|---|---|
| `notes:read` | Listar, ler, buscar notas; receber a nota nos eventos |
| `notes:write` | Criar, alterar, mover e mandar nota para a lixeira |
| `tasks:read` / `tasks:write` | Tarefas |
| `habits:read` / `habits:write` | Hábitos e o histórico deles |
| `folders:write` | Criar e renomear pastas |
| `network` | Usar `kiro.fetch` nos hosts declarados |

Duas barreiras, não uma: o objeto entregue ao worker só recebe os métodos das
permissões concedidas, e o hospedeiro confere de novo a cada chamada, porque o
worker é território do plug-in.

## API pública (etapa por etapa)

```js
export default {
  async activate(kiro) {
    kiro.command(id, label, handler)        // etapa 1
    kiro.panel(id, label, render)           // etapa 1
    kiro.notify(text, { error })            // etapa 1
    kiro.notes.list({ limit, folder, since })   // notes:read
    kiro.notes.get(id) / kiro.notes.current()   // notes:read
    kiro.notes.search(query)                    // notes:read
    kiro.notes.create({ title, folder, body, tags })  // notes:write
    kiro.notes.update(id, { title, body, tags, folder })  // notes:write
    kiro.tasks.* / kiro.habits.* / kiro.folders.create()
    kiro.storage.get(key) / kiro.storage.set(key, value)  // dados do próprio plug-in
    kiro.onSave(handler) / kiro.onCreate(handler) / kiro.onDay(handler)  // etapa 2
    kiro.block(handler)                     // etapa 2
    kiro.fetch(url, { method, headers, body })  // etapa 3, permissão network
  },
  async deactivate() {},
};
```

`kiro.storage` guarda dados do plug-in em `.kiro/plugins/<id>/data.json`, com teto
de 1 MB. É o único lugar onde o plug-in escreve fora das notas.

### Painéis declarativos (etapa 1)

`render()` devolve dados; quem desenha é o Kiro, com o tema e a skin atuais:

```js
{ type: 'list',  items: [{ title, detail, action }] }
{ type: 'table', columns: ['A', 'B'], rows: [['1', '2']] }
{ type: 'cards', items: [{ title, body, action }] }
{ type: 'text',  text: 'linha simples' }
{ type: 'form',  fields: [{ name, label, type: 'text'|'number'|'select', options }], submit: 'acao' }
{ type: 'stack', children: [ … ] }
```

Todo texto é inserido como texto, nunca como HTML. `action` é uma string livre do
plug-in; ao clicar, o Kiro devolve `{ action, values }` para o handler dele.
Ações reservadas do Kiro: `open:<noteId>` abre a nota.

### Blocos de Markdown (etapa 2)

Bloco cercado com a linguagem `kiro:<id-do-plugin>`:

    ```kiro:word-count
    parâmetros livres do plug-in
    ```

O handler recebe o texto do bloco e devolve `{ html }` ou dados de painel. O HTML
passa pelo higienizador antes de aparecer. A nota continua Markdown puro.

## Isolamento: como a tranca funciona

1. O hospedeiro (no `app.js`) cria um `Worker` a partir de `plugin-worker.js`,
   que é código do Kiro, servido pela origem do próprio app.
2. Esse worker importa o `index.js` do plug-in por uma rota que o Kiro controla:
   `kiro-plugin://<id>/index.js` no aplicativo instalado, `/plugins/<id>/index.js`
   na versão web. A rota só serve arquivos `.js` de dentro de `.kiro/plugins/`,
   com caminho validado como o resto do cofre.
3. A resposta do worker leva `Content-Security-Policy: default-src 'none';
   script-src 'self' kiro-plugin:; connect-src 'none'` e
   `X-Content-Type-Options: nosniff`. É isso que impede o plug-in de abrir conexão
   por conta própria — não depende de ele se comportar.
4. `index.html` passa a declarar `worker-src 'self' kiro-plugin:`.
5. Um worker por plug-in. Erro, exceção não tratada ou silêncio além do tempo
   limite encerram aquele worker; os outros plug-ins e o Kiro seguem de pé.

Limites: ativação em até 3 s, cada chamada em até 5 s, mensagem de até 2 MB.
Estourar um limite desativa o plug-in na sessão e mostra o motivo em Configurações.

## Permissão e consentimento

Escolhas ficam em `.kiro/plugins.json`:

```json
{
  "word-count": {
    "enabled": true,
    "permissions": ["notes:read"],
    "network": [],
    "manifestHash": "sha256-…"
  }
}
```

- Plug-in encontrado e nunca ativado aparece desligado; o arquivo não é carregado.
- Ativar mostra as permissões em português claro ("ler suas notas", "criar e
  alterar notas", "acessar api.exemplo.com") e exige confirmação.
- Se o manifesto mudar e pedir mais do que estava concedido, o plug-in é desligado
  e pergunta de novo. Pedir menos não pergunta nada.
- Desativar encerra o worker na hora e apaga os registros de comando e painel.

## Rede (etapa 3)

`kiro.fetch` é atendido pelo Kiro, não pelo worker. O host confere: esquema
`https`, host exatamente igual a um dos declarados e concedidos, sem seguir
redirecionamento para fora da lista, resposta de até 5 MB e 10 s. Cabeçalhos
proibidos: `cookie`, `authorization` que o plug-in não tenha recebido do usuário.
Nada do cofre vai junto automaticamente: só o que o plug-in mandar no corpo,
e ele só conhece o que já tinha permissão de ler.

## Higienização do HTML (etapa 2)

Lista de permitidos, nunca lista de proibidos:

- Tags: `p, br, hr, span, div, strong, em, b, i, u, s, code, pre, blockquote,
  ul, ol, li, h1..h6, table, thead, tbody, tr, th, td, a, img,
  svg, g, path, rect, circle, line, polyline, polygon, text`.
- Atributos: `class, title, alt, colspan, rowspan, href, src, width, height,
  viewBox, d, fill, stroke, stroke-width, x, y, x1, y1, x2, y2, cx, cy, r, points,
  text-anchor, font-size, transform`.
- `href` só `http`, `https` e `#`; `src` só `data:image/png|jpeg|gif|webp|svg+xml`.
- Todo `on*`, `style`, `script`, `iframe`, `object`, `embed`, `form` sai fora.

## Onde o código entra

| Arquivo | Papel |
|---|---|
| `plugins.js` (novo) | Parte pura e testável: validar manifesto, comparar permissões, decidir consentimento, montar o painel a partir dos dados, higienizar HTML. Roda no navegador e no Node, como o `domain.js` |
| `plugin-worker.js` (novo) | O worker do Kiro: importa o plug-in, monta o objeto `kiro` conforme as permissões e conversa por mensagem |
| `app.js` | Hospedeiro: descobre, ativa, encerra, atende as chamadas, desenha painéis e comandos, aba Plug-ins nas Configurações |
| `vault.cjs` | Ler e gravar `.kiro/plugins/**` e `plugins.json`, com caminho validado |
| `server.mjs`, `electron/main.cjs` | A rota que entrega o arquivo do plug-in com os cabeçalhos de segurança |
| `docs/plugins.md` (novo) | Documentação para quem escreve plug-in, em inglês |
| `tests/plugins.test.cjs` (novo) | Testes |

## Etapas

1. **Base:** descoberta, manifesto, worker e ponte, permissões e consentimento,
   aba Plug-ins, comandos, avisos, painéis declarativos, API de notas, tarefas e
   hábitos, `kiro.storage`, plug-in de exemplo `word-count`, documentação.
2. **Reagir e renderizar:** `onSave`, `onCreate`, `onDay`, blocos de Markdown e o
   higienizador.
3. **Cuidado redobrado:** rede com lista fechada; molduras isoladas para painéis
   com desenho livre.

## Testes (`node --test`, cofre temporário)

- Manifesto inválido é recusado com motivo: id fora do padrão, versão estranha,
  permissão desconhecida, `minKiro` acima da versão, host de rede com curinga.
- Permissão não declarada não aparece na API entregue ao plug-in e é barrada de
  novo no hospedeiro.
- Manifesto que passa a pedir mais desliga o plug-in e exige nova confirmação;
  pedir menos não interrompe.
- Higienizador remove `script`, `iframe`, `on*`, `javascript:` e mantém o que está
  na lista.
- Painel declarativo vira a marcação esperada, com texto escapado.
- Plug-in que trava ou estoura o tempo é encerrado sem derrubar os outros.
- A rota de arquivos serve só `.js` de `.kiro/plugins/` e recusa `..`, caminho
  absoluto e qualquer outro tipo de arquivo.

## O que fica de fora

Loja, download de dentro do app, atualização automática, plug-in em outra
linguagem, agendamento com o app fechado, acesso a arquivo fora do cofre e
qualquer operação genérica de disco ou de processo.
