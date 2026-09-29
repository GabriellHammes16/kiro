# Idiomas e corretor ortográfico

Data: 2026-09-28 · Estado: aprovado no brainstorming.

## Objetivo

A interface do Kiro passa a existir em vários idiomas, escolhidos nas Configurações, e o
editor ganha um corretor ortográfico que reconhece sozinho se a pessoa escreve em português,
inglês ou espanhol — a interface pode estar em inglês e as notas em português.

O trabalho tem duas etapas, cada uma com spec, plano e versão próprios:

1. **Etapa 1 (esta spec):** mecanismo de tradução, seletor de idioma, corretor com
   ligar/desligar e sugestões no menu do botão direito, datas e ordenação por idioma, e a
   tradução completa para o **inglês** (a prova do mecanismo).
2. **Etapa 2:** traduções para **espanhol**, **chinês simplificado** (`zh-CN`) e **chinês
   tradicional** (`zh-TW`). Com a base pronta, é escrever os arquivos de tradução e somar os
   códigos ao seletor e à detecção do idioma do sistema.

## Decisões

| Assunto | Decisão |
|---|---|
| Abordagem | A frase em português é a chave: `t('Sem título')`; um arquivo por idioma mapeia `'Sem título' → 'Untitled'` |
| Idiomas (ao fim das duas etapas) | Português (padrão), inglês, espanhol, chinês simplificado, chinês tradicional |
| Onde se escolhe | Configurações → **Sistema**, primeira linha: "Idioma" |
| Onde grava | `localStorage`, chave `kiro.idioma` (preferência de tela, como a aparência; não vai para o cofre) |
| Primeira abertura | Segue `navigator.language` se for um idioma suportado; senão, português |
| Troca de idioma | Na hora, sem reiniciar: `definirIdioma` → grava → `render()` |
| Corretor: idiomas | Português, inglês e espanhol **sempre ativos juntos**; a palavra vale se estiver certa em qualquer um. Sem ajuste por idioma |
| Corretor: onde se liga | Configurações → **Editor**: interruptor "Corretor ortográfico", ligado por padrão; `localStorage`, chave `kiro.corretor` |
| Dicionários | Embutidos no instalador (sem rede); se o Electron não aceitar dicionários locais, cai no download padrão do Google e a decisão é revista com o dono |
| Fica em português | API do agente, MCP, logs do servidor, `docs/` |

Custo aceito: com português e espanhol ativos juntos, um erro de português que é palavra certa
em espanhol ("tambien", "nuevo") não é sublinhado.

## Tradução

### `idiomas.js`

Módulo puro, no formato de `hoje.js` e `abas.js` (funciona no navegador como `KiroIdiomas` e
no Node por `module.exports`, para os testes). Expõe:

- `t(frase, valores?)` — tradução no idioma atual; sem tradução, a própria frase. Marcadores
  `{nome}` são trocados pelos `valores`: `t('editada {quando}', { quando })`.
- `idioma()` / `definirIdioma(codigo)` — lê e troca o idioma atual.
- `carregar(codigo)` — garante o arquivo de tradução do idioma (promessa); em português resolve
  na hora, sem carregar nada.
- `locale()` — `'pt-BR'`, `'en-US'`, … para `Intl`.
- `formatarData(data, opcoes)` e `comparar(a, b)` — `Intl.DateTimeFormat` guardados por
  idioma + opções e um `Intl.Collator` por idioma (`numeric: true`); o cache é refeito só
  quando o idioma muda.
- `IDIOMAS` — lista do seletor, cada um com o nome no próprio idioma
  (`Português`, `English`; na etapa 2 `Español`, `简体中文`, `繁體中文`).

### Arquivos de tradução

`idiomas/en.js` (etapa 2: `es.js`, `zh-CN.js`, `zh-TW.js`) registra um objeto
`{ 'frase em português': 'tradução', … }` em `KiroIdiomas`. Não existe arquivo de português: o
texto do código já é o português.

### O que passa por `t()`

Tudo o que a pessoa vê: `index.html` (textos fixos, aplicados na partida), `app.js`,
`fluxo-tela.js`, os textos visíveis de `plugins.js` e os de `domain.js` que chegam à tela.
Inclui `title`, `placeholder`, `aria-label`, `confirm()`, mensagens de status e de erro.
Também o `<html lang>`, atualizado a cada troca.

Os pontos com `'pt-BR'` fixo (`formatDate`, `dateLabel`, `rotuloDoDia`, `byTitle`, destinos de
pasta, lixeira, registro de rede dos plug-ins) passam a usar `formatarData` / `comparar`.

Dados do cofre não são traduzidos: notas, pastas e títulos existentes ficam como estão. Uma nota
nova sem título ganha "Sem título" no idioma atual.

## Corretor

### Desktop (Electron)

- Depois que a página carrega (não antes, para não atrasar a abertura), `main.cjs` chama
  `session.setSpellCheckerLanguages` com `pt-BR`, `en-US` e `es`, filtrados por
  `availableSpellCheckerLanguages`; o que não existir é ignorado.
- Dicionários embutidos: o primeiro passo do plano verifica se o Electron carrega `.bdic` locais
  (por `setSpellCheckerDictionaryDownloadURL` apontando para arquivos do app). Se não der, fica
  o download padrão e o dono é avisado.
- Ligar/desligar: a página manda `corretor:definir` pelo `preload`; `main` chama
  `session.setSpellCheckerEnabled`. Desligado, os dicionários saem da memória. Nenhum campo é
  redesenhado.
- Sugestões no botão direito: dentro de um campo de texto, a página não bloqueia o menu nativo;
  `main` recebe `context-menu` (palavra errada + `dictionarySuggestions`) e devolve à página, que
  abre o menu do Kiro com, no topo, as sugestões, "Adicionar ao dicionário" e um separador, e
  depois os itens de sempre. Escolher uma sugestão chama `replaceMisspelling` (o Ctrl+Z desfaz);
  "Adicionar" chama `addWordToSpellCheckerDictionary`. Sem palavra errada, o menu é o de hoje.
- A montagem desses itens do topo é uma função pura, testável.

### Web (`npm start`, no navegador)

- O idioma do corretor é o do navegador; a página não escolhe.
- O interruptor põe `spellcheck="false"` nos campos de texto.
- Em campo com palavra errada, o menu do Kiro não abre: vale o menu nativo, com as sugestões
  do navegador.

### Chinês

A interface fica em chinês; o corretor continua verificando português, inglês e espanhol, e os
ideogramas não são sublinhados.

## Desempenho

- Só o idioma ativo é carregado; em português, nenhum arquivo extra. Outros idiomas não são
  lidos nem interpretados enquanto não forem escolhidos.
- `t()` em português devolve a frase direto; nos outros, uma consulta a objeto. Marcadores só
  são trocados quando há `valores`.
- Formatadores de data e o comparador de nomes passam a ser guardados (hoje cada chamada cria
  um formatador novo e `localeCompare` recria as regras a cada par) — listas, árvore e Hoje
  ficam mais rápidas que hoje.
- Dicionários entram depois da janela carregada; a verificação roda em processo separado.
- O pedido de sugestões só acontece no botão direito sobre campo de texto.
- Verificação: medir abertura e `render()` da Hoje e da lista de notas no `dev-vault`, antes e
  depois; a etapa só fecha sem piora.

## Falhas

| Situação | Comportamento |
|---|---|
| Frase sem tradução | Aparece em português (o teste impede que chegue ao instalador) |
| Arquivo do idioma não carrega | Abre em português; status "Não foi possível carregar o idioma" |
| Código desconhecido em `kiro.idioma` | Ignorado; segue o idioma do sistema |
| Dicionário ausente na máquina | Ignorado; os outros continuam |

## Testes

- `tests/idiomas.test.cjs`: extrai todos os `t('…')` do código e falha se faltar frase em
  `en.js`, se sobrar em `en.js` frase que o código não usa, ou se os marcadores `{…}` não
  baterem; `t()` com e sem valores; português não carrega arquivo; código desconhecido cai no
  padrão; cache de formatadores refeito na troca de idioma.
- `main.cjs`: ativa os três idiomas e trata `corretor:definir` e o pedido de sugestões (mesmo
  estilo de inspeção de `plugins.test.cjs`).
- Função pura dos itens de sugestão do menu.
- Os testes atuais que procuram texto em português no código continuam valendo.

## Fora do escopo

- Escolher em quais idiomas o corretor verifica.
- Detectar o idioma por parágrafo (o Chromium não aplica dicionário por trecho).
- Traduzir a API do agente, o MCP, os logs e a documentação.
- Traduzir os plug-ins de exemplo (cada plug-in cuida dos próprios textos).
