# Corretor ortográfico próprio do Kiro

Data: 2026-10-02 · Estado: aprovado no brainstorming.

## Objetivo

O corretor do corpo da nota passa a funcionar como no Obsidian: ao abrir uma nota, **todas** as
palavras erradas ficam sublinhadas, sem precisar digitar; o botão direito numa palavra errada
mostra as sugestões no topo do menu do Kiro e "Adicionar ao dicionário".

## Por que um corretor próprio

Medido em 2026-10-01/02 no Electron 44 do Kiro, com o corretor do Windows (pt-BR + en-US):

- O Chromium só verifica o trecho que está sendo editado. Texto parado (nota recém-aberta) nunca é
  verificado — reproduzido num `contenteditable` puro, num CodeMirror cru e no editor do Kiro;
  esperar, clicar, janela ativa, idiomas antes/depois da página: sem efeito.
- Trocar para o motor Hunspell do Chromium (`--disable-features=WinUseBrowserSpellChecker`) não
  muda isso; `webFrame.isWordMisspelled`/`getWordSuggestions` devolvem "certa"/"sem sugestões"
  para tudo nos dois motores.
- `nspell` não carrega o dicionário pt-BR ("Too many properties to enumerate").
- `hunspell-asm` (Hunspell real em WebAssembly, MIT) com `dictionary-pt` e `dictionary-en`:
  carregar pt-BR 145 ms, en-US 12 ms, ~38 MB; ~5 ms por 1.000 palavras; sugestões 5–140 ms;
  ovario → ovário, bicicletta → bicicleta, nao → não.

## Decisões

| Assunto | Decisão |
|---|---|
| Motor | `hunspell-asm` (MIT), empacotado em `vendor/hunspell/hunspell.js` (WebAssembly embutido) |
| Dicionários | `dictionary-pt` (pt-BR, VERO/LibreOffice; MPL-2.0) e `dictionary-en` (en-US; MIT/BSD), cada um em `vendor/dicionarios/<código>.js`, com as licenças ao lado |
| Idiomas | Lista `['pt-BR', 'en-US']`; a palavra está certa se estiver certa em qualquer um |
| Novos idiomas | Um arquivo de dicionário + o código na lista; motor e editor não mudam |
| Dicionário pessoal | No cofre: `.kiro/dicionario.txt`, uma palavra por linha (vai no backup e na sincronização) |
| Onde verifica | Corpo da nota (CodeMirror), app desktop e versão web; os outros campos continuam com o corretor do Chromium |
| Chromium no corpo | `spellcheck="false"` sempre no `.cm-content` (um sublinhado só) |
| Liga/desliga | A opção "Corretor ortográfico" das Configurações; desligada, nada é carregado |
| Branch | `editor-ao-vivo`, como etapa "corretor próprio", antes da etapa 2 (widgets) |

`patrimonio` é aceita pelo dicionário VERO (forma de "patrimoniar"); diferenças assim são do
dicionário, não do Kiro.

## Estrutura

### Empacotamento (`scripts/build-ortografia.mjs`, `npm run vendor:ortografia`)

- `vendor/hunspell/hunspell.js`: bundle IIFE do `hunspell-asm` (global `HunspellAsm`; no Node,
  `module.exports`), gerado com `esbuild` (devDependency), com `LICENSE.txt` e `VERSAO.txt`.
- `vendor/dicionarios/<código>.js` para cada idioma configurado no script: um script clássico que
  chama `KiroOrtografia.registrar('<código>', { aff: '…', dic: '…' })` (no Node, exporta
  `{ codigo, aff, dic }`). Scripts, e não `fetch`, porque o app desktop abre a página como
  arquivo local e lá `fetch` de arquivo local é bloqueado; `<script>` funciona nos dois.
- `vendor/dicionarios/LICENSE-<código>.txt` com o texto da licença de cada dicionário.
- Os arquivos gerados são commitados (o app continua sem etapa de build).

### `ortografia.js` (`KiroOrtografia`, UMD como `hoje.js`)

```js
KiroOrtografia.IDIOMAS                      // ['pt-BR', 'en-US']
KiroOrtografia.registrar(codigo, { aff, dic })
KiroOrtografia.carregar(): Promise<void>    // motor + dicionários da lista + dicionário pessoal; uma vez
KiroOrtografia.pronto(): boolean
KiroOrtografia.errada(palavra): boolean     // false enquanto não carregou
KiroOrtografia.sugestoes(palavra): string[] // até 5; junta os idiomas, mais parecidas primeiro
KiroOrtografia.adicionar(palavra): void     // vale na hora; quem chama grava no cofre
KiroOrtografia.definirPessoais(palavras[])  // dicionário do cofre ao abrir/trocar de cofre
```

- Carregamento: no navegador insere `vendor/hunspell/hunspell.js` e `vendor/dicionarios/<código>.js`
  sob demanda (como `KiroEditor.carregar`), cria uma instância Hunspell por idioma.
- `errada(p)`: falsa para palavras do dicionário pessoal; verdadeira só se nenhum idioma aceitar.
  Ignora números, palavras com dígito, uma letra só, e endereços/e-mails.
- Ordenação das sugestões: distância de edição até a palavra (menor primeiro), sem repetidas,
  respeitando maiúscula inicial da palavra original.
- Cache `Map(palavra → errada)` limpo quando o dicionário pessoal muda.

### Dicionário pessoal no cofre

- `vault.cjs`: `readDictionary()` → `string[]` e `addToDictionary(palavra)` (sem repetidas,
  gravação atômica como o resto do cofre) em `.kiro/dicionario.txt`.
- App desktop: canais `dicionario:get` e `dicionario:add` (main + preload), com a palavra validada
  (`palavraParaDicionario` de `corretor.js`).
- Versão web: rotas no `server.mjs` equivalentes às do layout da Hoje.
- Trocar de cofre recarrega o dicionário pessoal.

### Editor (`editor-nota.js`)

- Função pura `palavrasDaLinha(texto, ignorar)` → `[{ de, ate, palavra }]`: letras Unicode, hífen
  interno (`guarda-chuva`) e apóstrofo interno (`don't`) fazem parte da palavra; pula os intervalos
  em `ignorar` (os `ed-sem-corretor` de `analisar`: código, endereços, alvos de `[[…]]`, etiquetas).
- Plug-in do CodeMirror: para a parte visível, marca `ed-erro` (sublinhado ondulado vermelho) nas
  palavras com `KiroOrtografia.errada`; refaz só as linhas alteradas e quando o dicionário pessoal
  muda ou quando o carregamento termina.
- Opção `ortografia: { ativa: boolean }` em `montar` e método `definirOrtografia(ativa)`; o
  `.cm-content` fica sempre com `spellcheck="false"` (substitui o `definirCorretor` atual).
- Novo método `palavraEm(x, y)` → `{ de, ate, palavra } | null` (posição do mouse → palavra).

### Menu do botão direito no corpo (`app.js`)

- `aoMenu` do editor: se a ortografia está ativa e pronta e a palavra sob o mouse está errada,
  abre o menu do Kiro com `KiroCorretor.itensDoCorretor({ palavra, sugestoes }, { trocar, adicionar, t })`
  no topo, separador e `menuDaNota()`; senão, o menu de sempre.
- `trocar(s)`: substitui `de..ate` numa transação normal (Ctrl+Z desfaz).
- `adicionar(p)`: `KiroOrtografia.adicionar(p)` + gravação no cofre; o sublinhado some na hora.
- O caminho atual pelo processo principal (`esperarCorretor`) deixa de valer para o corpo da nota
  e continua para os outros campos.

### Configurações

"Corretor ortográfico" (Editor) passa a controlar este corretor no corpo da nota (e continua
controlando o do Chromium nos outros campos). Desligado: sem sublinhado, nada carregado.

## Desempenho

- Carregamento em segundo plano depois que a primeira nota aparece; a abertura da nota não muda.
- Critérios: abrir a nota longa (67,6 KB) quente sem piora (hoje ~7 ms); digitar < 16 ms por
  tecla; sublinhado visível em até 1 s depois de abrir a primeira nota; sugestões só no clique.

## Falhas

| Situação | Comportamento |
|---|---|
| Motor ou dicionários não carregam | Nota normal, sem sublinhado; status "Não foi possível carregar o corretor" |
| Um idioma falha | Os outros continuam |
| `.kiro/dicionario.txt` ausente | Começa vazio; criado na primeira palavra adicionada |
| `.kiro/dicionario.txt` ilegível | Ignorado com aviso; o arquivo não é apagado |
| Corretor desligado | Nada carregado, nenhum sublinhado |

## Testes

- `npm test` (motor e dicionários reais, no Node):
  - `errada`: `ovario`, `bicicletta`, `nao`, `palavrra`, `wrongg` erradas; `ovário`, `house`,
    `estão`, `Kiro` (depois de adicionar) certas; números e `C3PO` ignorados;
  - `sugestoes('ovario')[0] === 'ovário'`, `sugestoes('bicicletta')[0] === 'bicicleta'`,
    `sugestoes('nao')[0] === 'não'`;
  - idioma fora da lista não é carregado; idioma registrado e incluído na lista passa a valer;
  - `palavrasDaLinha`: hífen e apóstrofo internos, acentos, pula intervalos ignorados;
  - cofre: `readDictionary`/`addToDictionary` sem repetidas, arquivo ausente = vazio;
  - cobertura de idiomas: frases novas em `idiomas/en.js`.
- App desktop automatizado (feito por quem coordena): nota `teste-do-corretor` aberta sem digitar
  sublinha Xp, nubank, ovario, bicicletta, palavrra; botão direito em "ovario" → "ovário" no topo;
  escolher troca e Ctrl+Z desfaz; "Adicionar" em "nubank" tira o sublinhado e grava em
  `.kiro/dicionario.txt`; corretor desligado tira os sublinhados.

## Também nesta etapa

- A fonte do editor volta a ser a da leitura (hoje sai monoespaçada: o tema padrão do CodeMirror
  impõe `monospace` no `.cm-scroller`).

## Fora do escopo

- Tela para escolher idiomas nas Configurações (quando houver um terceiro idioma).
- Remover palavras do dicionário pessoal pela interface (o arquivo é texto simples).
- Corretor próprio nos outros campos (título, buscas).
