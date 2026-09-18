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

Aprovado em 2026-09-16. As molduras isoladas saíram da etapa 3 e viram a etapa 4.

`kiro.fetch(url, { method, headers, body, secret })` é atendido pelo Kiro, nunca
pelo worker nem pela página: o pedido sobe ao processo principal do Electron (ou
ao servidor local, na web), que valida de novo e faz a chamada.

Regras, conferidas no Node, no momento da conexão:

- Só `https`, porta 443, host exatamente igual a um dos **concedidos** (não basta
  estar declarado). Sem usuário/senha na URL.
- **Proteção contra a rede local (SSRF):** o endereço resolvido na hora de conectar
  é recusado se for loopback, rede privada, link-local, CGNAT, multicast, reservado
  ou não especificado, em IPv4 e IPv6 (inclusive IPv4 mapeado em IPv6). A checagem
  roda no `lookup` da própria conexão, para não haver troca de endereço entre a
  checagem e a conexão. Host escrito como IP literal é recusado.
- Redirecionamento só para host também concedido, revalidado a cada salto, até 3.
- Métodos `GET, POST, PUT, PATCH, DELETE`. Corpo só texto, até 1 MB. Resposta até
  5 MB e 10 s, devolvida como `{ status, headers, text }`; só os cabeçalhos
  `content-type`, `content-length`, `etag`, `last-modified`, `cache-control`,
  `retry-after` voltam ao plug-in.
- Sem cookies: nada é enviado nem guardado. O plug-in não pode definir `cookie`,
  `host`, `origin`, `referer`, `authorization`, `proxy-*`, `connection`,
  `content-length`, `transfer-encoding`.
- Na versão web, a rota do servidor só atende pedidos da própria página (mesma
  origem), para um site aberto no navegador não usar o Kiro como ponte.

### Chaves (segredos)

Declaradas no manifesto:

```json
"secrets": [
  { "name": "apiKey", "label": "DeepL API key", "host": "api.deepl.com",
    "header": "Authorization", "format": "DeepL-Auth-Key {value}" }
]
```

- `name`: `[a-zA-Z][a-zA-Z0-9_]{0,39}`; `host` precisa estar em `network`;
  `header` não pode ser um dos cabeçalhos proibidos acima (exceto `authorization`,
  que é justamente o uso esperado); `format` contém `{value}` uma vez.
- O usuário digita o valor em Configurações → Plug-ins, num campo de senha. O valor
  nunca volta para a página nem para o plug-in: a interface só sabe "configurada"
  ou "não configurada".
- `kiro.fetch(url, { secret: 'apiKey' })` faz o Kiro montar o cabeçalho, e só quando
  o host do pedido é exatamente o `host` do segredo. Host diferente é erro.
- Guarda fora do cofre, por computador. No Electron, cifrado com `safeStorage` no
  arquivo `plugin-secrets.json` da pasta de dados do app. Na web, em
  `<pasta de configuração do usuário>/Kiro/plugin-secrets.json` com permissão só
  do dono, sem cifra (limitação conhecida: sem dependência nova, o Node não alcança
  o cofre de senhas do sistema). Chave de índice: cofre + plug-in + nome.
- Um segredo novo numa atualização conta como pedido de mais acesso: pede
  confirmação de novo.

### Transparência

Cada requisição vai para `.kiro/audit.log` (plug-in, host, método, status, bytes,
duração — nunca corpo, cabeçalho ou segredo), e a linha do plug-in em
Configurações mostra as últimas chamadas da sessão.

## Molduras isoladas (etapa 4)

Aprovado em 2026-09-17. O plug-in ganha telas próprias com HTML, CSS e
JavaScript do autor (desenho livre, canvas, clique, arrastar), em dois lugares:

- **Bloco e painel:** o `render` do bloco ou a função do painel pode devolver
  `{ frame: 'chart.html', data, height }` no lugar de HTML/itens. O Kiro põe uma
  moldura ali. `height` inicial de 40 a 2000 px (padrão 240).
- **Página cheia:** o manifesto declara
  `"page": { "title": "Heatmap", "file": "page.html" }`. Plug-in ativo com `page`
  ganha um item no grupo "Plug-ins" da barra lateral (o grupo só existe se houver
  pelo menos um); a página ocupa a área de conteúdo, como Hoje e Tarefas.

`frame` e `page.file`: nome de arquivo `.html` da pasta do plug-in
(`[a-z0-9][a-z0-9._-]{0,60}\.html`, sem barra). `page.title`: texto puro, até 40
caracteres. Moldura não é permissão nova: a tela só alcança o que o plug-in já
pode. O consentimento mostra a linha "Tem uma tela própria" quando o manifesto
declara `page`; ganhar `page` numa atualização não pede confirmação de novo.

### Isolamento

- A moldura é `<iframe sandbox="allow-scripts">`, **sem** `allow-same-origin`:
  origem opaca, sem acesso à página do Kiro, a cookies, `localStorage` ou
  IndexedDB; sem formulário enviado, janela nova, `alert` ou navegação da janela
  de cima.
- O arquivo `.html` do plug-in é servido pelo Kiro com
  `Content-Security-Policy: sandbox allow-scripts; default-src 'none';
  script-src 'self' kiro-plugin:; style-src 'self' 'unsafe-inline' kiro-plugin:;
  img-src 'self' data: kiro-plugin:; font-src 'self' data:; connect-src 'none';
  form-action 'none'; base-uri 'none'; frame-ancestors 'self'` (na web,
  `frame-ancestors` troca o `'none'` geral do servidor; no Electron a página é
  `file://` e o `frame-ancestors` é omitido). A diretiva `sandbox` garante o
  isolamento mesmo se alguém abrir a URL direto. O `index.html` passa a permitir
  `frame-src 'self' kiro-plugin:`. Na CSP da moldura, `'self'` é trocado pela
  origem explícita (`http://<host>` na web, `kiro-plugin:` no Electron): numa
  origem opaca `'self'` é ambíguo. A moldura não tem rede nenhuma:
  `fetch`/`XHR`/`WebSocket`/beacon, imagem, fonte, navegação, pop-up e formulário
  são todos bloqueados por CSP e sandbox. WebRTC não tem essa garantia forte:
  `kiro-frame.js` apaga os construtores de WebRTC (`RTCPeerConnection` e afins)
  como reforço, mas o motor do navegador não tem diretiva de CSP para WebRTC, então
  isso é best-effort, não uma barreira garantida. A resposta leva
  `X-DNS-Prefetch-Control: off`.
- Onde é servido: web `/plugins/<id>/<arquivo>`; Electron
  `kiro-plugin://<id>/<arquivo>`. `readPluginFile` passa a servir `.js`, `.html`
  e `.css` (tipo de conteúdo pela extensão), sempre de dentro da pasta.
- Ao servir `.html`, o Kiro injeta sempre no início do documento (logo após um
  `<!doctype>` inicial, se houver) `<script src="/kiro-frame.js">` (web) ou
  `<script src="kiro-plugin://kiro.app/kiro-frame.js">` (Electron). Nunca
  procura `<head>`: um `<head>` "falso" dentro de comentário ou texto do
  plug-in não muda onde o script entra. É esse script que cria o `kiro` da
  tela.
- O hospedeiro identifica o plug-in pela moldura: guarda
  `iframe.contentWindow → { id, registro }` e descarta mensagem cujo
  `event.source` não está no mapa. Id escrito na mensagem é ignorado.
- Links: a tela chama `kiro.openLink(url)`; o Kiro só abre `http`/`https`, fora
  do app (Electron `shell.openExternal`, web `window.open` com `noopener`).
- Desativar ou remover o plug-in remove as molduras e o item da barra lateral.

### API da tela (`kiro-frame.js`)

O mesmo `kiro` do worker, montado pela lista de métodos permitidos que o
hospedeiro manda no aperto de mão (disponível depois de `await kiro.ready`): `notes`, `tasks`, `habits`, `storage`, `fetch`, `notify`. Não há
`command`, `panel`, `block` nem eventos (são do worker). Mais:

- `kiro.data`: o `data` que o bloco/painel devolveu (na página, `null`);
  `kiro.onData(fn)` recebe o novo `data` quando o bloco/painel é redesenhado.
- `kiro.resize(altura)`: 40 a 2000 px; na página não faz nada.
- `kiro.openLink(url)`.
- Tema: o hospedeiro manda as 15 variáveis de cor do tema (`--bg`, `--ink`,
  `--acento`, …) e as de fonte no aperto de mão e a cada troca de aparência;
  `kiro-frame.js` aplica em `:root`, então `var(--acento)` funciona na tela.

Protocolo (postMessage, alvo `'*'` porque a origem é opaca; nada é enviado que o
plug-in já não possa ler): tela → Kiro `{tipo:'pronto'}`,
`{tipo:'chamada',chamada,metodo,args}`, `{tipo:'altura',valor}`,
`{tipo:'link',url}`; Kiro → tela `{tipo:'ativar',metodos,data,tema}`,
`{tipo:'resposta',chamada,valor|erro}`, `{tipo:'dados',data}`,
`{tipo:'tema',tema}`. As chamadas passam pelo mesmo `podeChamar` e pelo mesmo
atendimento do worker (`atenderPlugin`/`executarMetodo`), com os mesmos limites.

### Exemplo

`examples/plugins/habit-heatmap/`: `habits:read`; bloco `kiro:habit-heatmap`
devolve `{ frame: 'heatmap.html', data }` com um mapa de calor das últimas
semanas (hover mostra o dia) e `page` abre o mesmo desenho em tela cheia.

### Testes

- Manifesto: `page` válido passa; arquivo sem `.html`, com barra ou `..`,
  `title` vazio ou longo recusa.
- `readPluginFile` serve `.html`/`.css`/`.js` com o tipo certo e recusa o resto.
- Injeção do `kiro-frame.js` no HTML (com e sem `<head>`).
- Resposta do bloco/painel com `frame` é validada (arquivo, altura).
- Navegador, com um plug-in de ataque na moldura: `fetch`, `parent.document`,
  `top.location = …`, `localStorage`, `window.open` e `form.submit` falham;
  mensagem forjada com id de outro plug-in é ignorada; chamada sem permissão é
  recusada.

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
3. **Rede:** `kiro.fetch` com lista fechada, proteção contra a rede local, chaves
   guardadas fora do cofre e auditoria.
4. **Molduras isoladas:** telas do plug-in em bloco, painel e página cheia na
   barra lateral, com o exemplo `habit-heatmap`.

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
