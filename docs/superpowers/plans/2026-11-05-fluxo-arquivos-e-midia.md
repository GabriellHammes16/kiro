# Fluxo: arquivos, mídia e links (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cartões de arquivo com 3 estados (recolhido, aberto no cartão, tela inteira) para PDF, imagem, texto, tabela, áudio e vídeo, mais prévia de link e vídeo do YouTube tocando no cartão.

**Architecture:** o tipo do arquivo e o estado do cartão são contas puras em `fluxo.js`. A tela (`fluxo-tela.js`) desenha um topo comum (seta, nome, Abrir) e o corpo de cada tipo. As telas inteiras ficam em `app.js`. O cofre (`vault.cjs`) passa a aceitar os tipos novos pelo conteúdo do arquivo. A prévia de link é buscada pelo processo principal (e pelo servidor local) com o executor de rede que os plug-ins já usam.

**Tech Stack:** JavaScript sem build, `node:test`, PDF.js embarcado, Electron 44.

**Spec:** a descrição aprovada na conversa, reproduzida abaixo. As decisões do coordenador foram tomadas por quem escreveu o plano e serão contadas ao usuário.

## O que foi aprovado

- **3 estados em todo cartão de arquivo:** recolhido mostra só o título e uma setinha; clicar na setinha abre o conteúdo no cartão; **Abrir** leva para a tela inteira, e `Esc` fecha. O botão "Ampliar" do PDF vira **Abrir**.
- **Grupo 1, mostrados no cartão:** PDF, imagens (`.png`, `.jpg`, `.webp`, `.gif`), texto (`.txt`, `.md` arrastado como arquivo) e tabela (`.csv`).
- **Grupo 2, mídia tocando no cartão:** áudio (`.mp3`, `.wav`, `.m4a`) e vídeo (`.mp4`).
- **Grupo 3, internet:** link de vídeo do YouTube tocando no cartão; link de site com prévia (título, descrição e imagem).
- **Fora desta rodada:** Office, ZIP e outros arquivos que o Kiro não mostra; tarefa e pedaço de nota como cartão.

## Decisões do coordenador

- O Kiro lembra o estado de cada cartão no próprio `.canvas`: `kiroRecolhido: true` e `kiroAlturaAberta` (altura para voltar ao abrir).
- PDF novo entra recolhido. Os outros tipos entram abertos.
- Áudio não tem tela inteira: o botão **Abrir** não aparece no cartão de áudio.
- Link de site: **Abrir** abre no navegador, como hoje.
- `.webm` de vídeo fica de fora: o `.webm` do cofre continua sendo áudio (gravações das notas).
- A prévia de link só é buscada uma vez, quando o link entra no Fluxo. A busca nunca acontece só por abrir o Fluxo. Sem internet, o cartão fica com o endereço, como hoje.
- `.md` arrastado do computador vira cartão de texto do arquivo, não nota do cofre.

## Global Constraints

- Sem dependência nova. Sem etapa de build.
- O `.canvas` continua sendo JSON Canvas válido: campos novos só com prefixo `kiro`, e campos desconhecidos passam intactos.
- CSS só com variáveis do tema, nunca cor fixa (`docs/temas.md`, "Regras para componentes").
- Toda frase nova passa por `t()` (tela) ou `frase()` (Node) e ganha tradução em `idiomas/en.js`; confira com `node --test tests/idiomas-cobertura.test.cjs`.
- Mudança de tela entra no histórico por `mudar()`: um gesto do usuário é um passo de desfazer.
- O autosave roda `montar` de novo cerca de 2 s depois de cada mudança: estado que precisa sobreviver vai na sessão `s` de `fluxo-tela.js`.
- Nada de rede fora do executor de `rede-plugins.cjs`: ele já recusa endereço privado, limita tempo, tamanho e redirecionamentos.
- Preserve o fim de linha de cada arquivo. Commits só no branch `feat/protecao-do-texto-e-navegacao`, por caminho, sem push, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Arquivo com extensão de texto mas conteúdo binário (ou UTF-8 inválido): o cofre recusa, e nada quebra no cartão.
2. Recolher e abrir de novo um cartão que foi redimensionado à mão: volta exatamente para a altura de antes, e desfazer volta ao estado anterior em um passo.
3. Vídeo ou YouTube tocando, e um salvamento ou movimento de outro cartão: o elemento não é recriado a cada `desenhar()` (o vídeo não para nem recomeça só por mexer em outro cartão).
4. Site que demora, devolve erro, devolve algo que não é HTML ou redireciona para endereço privado: o cartão fica só com o endereço, sem aviso de erro técnico e sem travar o Fluxo.
5. CSV grande (milhares de linhas) e texto grande: o cartão mostra um trecho limitado e avisa quantas linhas ficaram de fora, sem travar a tela.

---

### Task 1: O cofre aceita os tipos novos

**Files:**
- Modify: `vault.cjs` (`IMAGE_TYPES`, `audioSignature`, `saveAttachment`, `readAttachment`), `electron/main.cjs` (`vault:open-attachment`), `server.mjs` (`/api/anexo`)
- Test: `tests/anexos.test.cjs`

**Interfaces:**
- Produces: anexos `.txt`, `.csv`, `.m4a` e `.mp4` gravados e servidos com os tipos `text/plain; charset=utf-8`, `text/csv; charset=utf-8`, `audio/mp4` e `video/mp4`.

Decisões:
- `saveAttachment({ name, data })`: texto não tem assinatura. Vale como texto quando a extensão de `name` é `txt`, `csv` ou `md`, o conteúdo decodifica com `new TextDecoder('utf-8', { fatal: true })` e não tem byte `0x00`. Limite de texto: 5 MB. Um `.md` é gravado como `.txt`, para não virar nota na árvore.
- MP4 e M4A: caixa `ftyp` nos bytes 4 a 8. A marca nos bytes 8 a 12 decide: `M4A ` → `m4a`; qualquer outra → `mp4`.
- A ordem de detecção é: imagem e PDF, áudio, MP4 e M4A, texto. Assinatura binária sempre vence a extensão.
- `readAttachment`: confere de novo pelo conteúdo os tipos de áudio, vídeo e texto, com a mesma regra da gravação.
- A mensagem de recusa passa a listar os tipos novos.
- `vault:open-attachment` aceita também `txt`, `csv`, `mp3`, `wav`, `webm`, `m4a` e `mp4`.
- `/api/anexo` aceita os tipos `text/plain`, `text/csv`, `text/markdown`, `audio/mp4`, `audio/x-m4a` e `video/mp4`.

- [ ] **Step 1: Escreva os testes que falham em `tests/anexos.test.cjs`**, seguindo o padrão do arquivo:
  - grava `notas.txt` com `'olá\nmundo'` e devolve caminho terminado em `.txt`; lê de volta com o tipo `text/plain; charset=utf-8`;
  - grava `tabela.csv` com `'a,b\n1,2'` e lê com `text/csv; charset=utf-8`;
  - grava `ideia.md` e o caminho termina em `.txt`;
  - recusa `falso.txt` com bytes `[0x00, 0x01, 0xff]` e recusa `ruim.txt` com UTF-8 inválido `[0xc3, 0x28]`;
  - recusa `x.txt` de 5 MB mais 1 byte;
  - um buffer que começa com `ftypM4A ` no byte 4 grava como `.m4a` e lê como `audio/mp4`; com `ftypisom`, grava como `.mp4` e lê como `video/mp4`;
  - um PNG com nome `foto.txt` continua gravado como `.png`.
- [ ] **Step 2: Rode e veja falhar:** `node --test tests/anexos.test.cjs`, com falha no `.txt`.
- [ ] **Step 3: Implemente conforme as decisões.**
- [ ] **Step 4: Rode e veja passar:** `node --test tests/anexos.test.cjs tests/audio-nota.test.cjs tests/server.test.cjs`, e depois `npm test`.
- [ ] **Step 5: Commit**

```bash
git add vault.cjs electron/main.cjs server.mjs tests/anexos.test.cjs
git commit -m "feat(anexos): texto, tabela, m4a e mp4 no cofre"
```

### Task 2: Tipos e estado do cartão no modelo

**Files:**
- Modify: `fluxo.js`
- Test: `tests/fluxo.test.cjs`

**Interfaces:**
- Produces (exportadas em `api`):
  - `tipoDoArquivo(f: string) -> 'pdf' | 'imagem' | 'texto' | 'tabela' | 'audio' | 'video' | 'nota'`, pela extensão, sem diferenciar maiúsculas. `txt` → texto, `csv` → tabela, `mp3`/`wav`/`webm`/`m4a` → audio, `mp4` → video, `md` ou qualquer outra → nota.
  - `idDoYoutube(url: string) -> string | null`: aceita `youtube.com/watch?v=ID`, `m.youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID` e `youtube-nocookie.com/embed/ID`. O ID tem 11 caracteres `[A-Za-z0-9_-]`. Qualquer outra coisa devolve `null`.
  - `ALTURA_RECOLHIDA = 40`.
  - `alternarRecolhido(c, id) -> canvas`. Recolher grava `kiroRecolhido: true`, `kiroAlturaAberta: <altura atual>` e `height: ALTURA_RECOLHIDA`. Abrir tira os dois campos e volta `height` para `kiroAlturaAberta`, ou para `tamanhoPadrao(cartao).height` se faltar.
  - `lerCsv(texto: string, { linhas = 200, colunas = 30 } = {}) -> { linhas: string[][], restantes: number }`: separador vírgula ou ponto e vírgula (o que aparecer mais na primeira linha), aspas duplas com `""` escapado, quebra de linha dentro de aspas, `\r\n` ou `\n`. `restantes` conta as linhas que ficaram de fora.
  - `tamanhoPadrao`: imagem 320×240, PDF 480×640, texto 320×240, tabela 480×280, áudio 320×100, vídeo 480×300, nota 400×280. Link do YouTube 480×300, link comum 320×100.

- [ ] **Step 1: Escreva os testes que falham**

```js
test('tipoDoArquivo reconhece cada grupo pela extensão', () => {
  assert.deepEqual(['a.PDF', 'b.jpg', 'c.txt', 'd.csv', 'e.m4a', 'f.mp4', 'g.md', 'h.docx'].map(F.tipoDoArquivo),
    ['pdf', 'imagem', 'texto', 'tabela', 'audio', 'video', 'nota', 'nota']);
});

test('idDoYoutube aceita os formatos comuns e recusa o resto', () => {
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'])
    assert.equal(F.idDoYoutube(url), 'dQw4w9WgXcQ', url);
  for (const url of ['https://vimeo.com/123', 'https://youtube.com/watch?v=curto', 'https://evil.com/?v=dQw4w9WgXcQ', 'javascript:alert(1)'])
    assert.equal(F.idDoYoutube(url), null, url);
});

test('recolher guarda a altura e abrir devolve a mesma', () => {
  const c = canvas([cartao('a', { type: 'file', file: 'x.pdf', height: 333 })]);
  const fechado = F.alternarRecolhido(c, 'a');
  assert.deepEqual([fechado.nodes[0].height, fechado.nodes[0].kiroRecolhido, fechado.nodes[0].kiroAlturaAberta], [F.ALTURA_RECOLHIDA, true, 333]);
  const aberto = F.alternarRecolhido(fechado, 'a');
  assert.equal(aberto.nodes[0].height, 333);
  assert.ok(!('kiroRecolhido' in aberto.nodes[0]) && !('kiroAlturaAberta' in aberto.nodes[0]));
});

test('lerCsv entende aspas, ponto e vírgula e limita as linhas', () => {
  assert.deepEqual(F.lerCsv('a;b\n"x;y";"di""z"').linhas, [['a', 'b'], ['x;y', 'di"z']]);
  const grande = F.lerCsv(Array.from({ length: 250 }, (_, i) => `${i},${i}`).join('\n'));
  assert.equal(grande.linhas.length, 200);
  assert.equal(grande.restantes, 50);
});
```

- [ ] **Step 2: Rode e veja falhar:** `node --test tests/fluxo.test.cjs`, com `F.tipoDoArquivo is not a function`.
- [ ] **Step 3: Implemente em `fluxo.js`.** `ehPdf` e `ehImagem` passam a usar `tipoDoArquivo`. `tamanhoPadrao` de link usa `idDoYoutube(c.url)`.
- [ ] **Step 4: Rode e veja passar:** `node --test tests/fluxo.test.cjs`, e depois `npm test`.
- [ ] **Step 5: Commit**

```bash
git add fluxo.js tests/fluxo.test.cjs
git commit -m "feat(fluxo): tipos de arquivo, recolher cartao, csv e youtube no modelo"
```

### Task 3: Cartões de arquivo com 3 estados

**Files:**
- Modify: `fluxo-tela.js`, `app.js` (`montarFluxos`, telas inteiras perto de `abrirTelaInteira`), `styles.css`, `idiomas/en.js`
- Test: `tests/fluxo-tela-fonte.test.cjs`

**Interfaces:**
- Consumes: `F.tipoDoArquivo`, `F.alternarRecolhido`, `F.ALTURA_RECOLHIDA`, `F.lerCsv`, `F.tamanhoPadrao`.
- Produces:
  - `opcoes.abrirArquivo(arquivo, tipo, { pagina, origem })`, que abre a tela inteira certa;
  - `opcoes.arquivosDoEvento(dataTransfer)`, os arquivos aceitos pelo Fluxo;
  - `opcoes.lerTexto(arquivo) -> Promise<string>`.

Decisões:
- Todo cartão `file` que não é nota ganha o topo `.fluxo-arquivo-topo`: botão `.fluxo-seta-recolher` (ícone que gira, `aria-expanded`), o nome do arquivo e o botão `.fluxo-abrir`. O topo usa o `.fluxo-pdf-topo` atual como base, e o nome antigo da classe pode sair.
- O cartão de áudio não tem o botão Abrir.
- Clicar na seta chama `mudar(F.alternarRecolhido(canvas, id))`. Com `kiroRecolhido`, o corpo não é desenhado.
- Corpos:
  - **PDF:** o atual, agora como `.fluxo-arquivo-corpo`.
  - **Imagem:** o `<img>` atual.
  - **Texto:** `<pre class="fluxo-texto">`, preenchido por `opcoes.lerTexto`, com no máximo 200 000 caracteres e uma linha final `… mais N caracteres` quando cortado.
  - **Tabela:** `<table class="fluxo-tabela">`, com a primeira linha como cabeçalho, mais `… mais N linhas` quando `restantes > 0`.
  - **Áudio:** `<audio controls preload="metadata">`.
  - **Vídeo:** `<video controls preload="metadata">`.
- **Abrir:**
  - PDF: o `abrirPdfInteiro` atual.
  - Imagem: `abrirImagemInteira`.
  - Texto e tabela: tela inteira com o mesmo conteúdo, com rolagem.
  - Vídeo: tela inteira com `<video controls autoplay>`.
  - Todas usam `abrirTelaInteira` e devolvem o foco à origem ao fechar, como o PDF já faz.
- Duplo clique no corpo abre a tela inteira, menos no áudio.
- Reaproveitamento: generalize o que `desenhar()` faz hoje com `.fluxo-pdf` para todo corpo com `data-reusar="<id>|<arquivo>"`. O mesmo elemento volta para o cartão novo, e a rolagem é mantida. Com isso, vídeo e áudio tocando não param quando outro cartão muda.
- Rolagem, ponteiro e arraste:
  - O `wheel` sem Ctrl sobre `.fluxo-texto`, `.fluxo-tabela` ou `.md-pdf-paginas` rola o conteúdo.
  - O `pointerdown` sobre os controles de `<audio>` e `<video>` e sobre essas áreas de rolagem só seleciona o cartão, como já acontece com as páginas do PDF.
  - Imagens de dentro dos corpos não iniciam arraste nativo.
- Entrada: colar, arrastar e o botão da barra aceitam os tipos novos por `opcoes.arquivosDoEvento`. É uma lista própria do Fluxo em `app.js`. `imagensDoEvento`, das notas, não muda. O botão da barra passa a se chamar `Adicionar arquivo`, e o seletor aceita os tipos do Fluxo.
- Tamanho inicial: `F.tamanhoPadrao`. O PDF novo entra com `kiroRecolhido: true`, `kiroAlturaAberta: 640` e `height: F.ALTURA_RECOLHIDA`.
- Menu do cartão de arquivo: **Recolher** ou **Mostrar conteúdo**, **Abrir** (menos áudio), **Abrir no programa do sistema** (só no Electron).

- [ ] **Step 1: Escreva os testes que falham em `tests/fluxo-tela-fonte.test.cjs`**
  - `fonte` contém `F.alternarRecolhido(` e `data-reusar`;
  - `fonte` contém `opcoes.arquivosDoEvento`;
  - em `app.js`, `function imagensDoEvento` continua filtrando por `TIPOS_DE_IMAGEM`, para que as notas não ganhem tipos novos.
- [ ] **Step 2: Rode e veja falhar:** `node --test tests/fluxo-tela-fonte.test.cjs`.
- [ ] **Step 3: Implemente conforme as decisões.**
- [ ] **Step 4: Rode e veja passar:** `node --test tests/fluxo-tela-fonte.test.cjs tests/fluxo.test.cjs tests/idiomas-cobertura.test.cjs tests/temas.test.cjs`, e depois `npm test`.
- [ ] **Step 5: Commit**

```bash
git add fluxo-tela.js app.js styles.css idiomas/en.js tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): cartoes de arquivo com tres estados, texto, tabela, audio e video"
```

### Task 4: Prévia de link

**Files:**
- Create: `previa-link.js` (leitura do HTML, pura, roda no Node e no navegador como `fluxo.js`), `ligacao-previa.cjs` (busca, usada pelo Electron e pelo servidor)
- Modify: `rede-plugins.cjs` (`executarPedido`), `electron/main.cjs`, `electron/preload.cjs`, `server.mjs`, `index.html` (script), `fluxo-tela.js`, `app.js` (`montarFluxos`), `styles.css`, `idiomas/en.js`
- Test: `tests/previa-link.test.cjs` (criar), `tests/rede.test.cjs`

**Interfaces:**
- Produces:
  - `KiroPrevia.lerPrevia(html: string, base: string) -> { titulo, descricao, imagem }`. Cada campo é string ou `null`; `imagem` é uma URL `https:` absoluta.
  - `buscarPrevia({ vault, url, requisitar, lookup }) -> Promise<{ titulo, descricao, imagem } | null>`, em que `imagem` é o caminho do anexo no cofre.
  - IPC `fluxo:previa`; `cadernoDesktop.previaDeLink(url)`; rota `POST /api/previa` com JSON `{ url }`.
  - `opcoes.previaDeLink(url)` para a tela.

Decisões:
- `executarPedido` ganha duas opções:
  - `qualquerHost: true`, que aceita qualquer host público em cada salto e continua recusando endereço privado;
  - `binario: true`, que devolve `buffer` no lugar de `text`.
  O comportamento atual dos plug-ins não muda.
- A busca da página usa `GET`, `qualquerHost`, tempo de 8 s, resposta até 1 MB e `user-agent` `Kiro`. Só segue se o `content-type` for `text/html`.
- A imagem é baixada com `binario`, até 5 MB, e gravada por `vault.saveAttachment`. Se não for uma imagem que o cofre aceita, fica `null`.
- Qualquer falha devolve `null`. Nunca há aviso técnico na tela.
- `lerPrevia` usa, nesta ordem:
  - para o título: `og:title`, `twitter:title` e `<title>`;
  - para a descrição: `og:description`, `twitter:description` e `meta name=description`;
  - para a imagem: `og:image` e `twitter:image`.
  Decodifica `&amp;`, `&quot;`, `&#39;`, `&lt;`, `&gt;` e entidades numéricas. Corta o título em 200 caracteres e a descrição em 300. Só lê os primeiros 512 KB do HTML.
- O cartão de link guarda `kiroPrevia: { titulo, descricao, imagem }`. A busca acontece só ao criar o cartão, ao colar uma URL ou pelo menu **Adicionar link**, e só quando o link não é do YouTube. O cartão nasce com o endereço e é atualizado quando a prévia chega, fora do desfazer. Se ele tiver sido apagado nesse meio tempo, nada acontece.
- O cartão de link ganha o mesmo topo de 3 estados: seta, título (ou endereço) e **Abrir**, que abre no navegador. O corpo mostra imagem, título, descrição e endereço. Sem prévia, mostra o que já mostra hoje.
- No servidor, a rota usa a mesma `buscarPrevia`.

- [ ] **Step 1: Escreva os testes que falham**
  - `tests/previa-link.test.cjs`:
    - lê `og:title`, `og:description` e `og:image` relativa (`/a.png` com base `https://site.com/p`, dando `https://site.com/a.png`);
    - cai em `<title>` quando falta `og:title`;
    - decodifica `&amp;`;
    - recusa imagem `http:` e `data:`, devolvendo `imagem: null`.
  - `buscarPrevia` com `requisitar` falso, imitando os testes de `tests/rede.test.cjs`:
    - devolve `null` para `content-type: application/json`;
    - devolve `null` quando o servidor dá 500;
    - grava a imagem pelo `vault` falso e devolve o caminho.
  - `tests/rede.test.cjs`:
    - com `qualquerHost`, um redirecionamento para outro host público é seguido;
    - com `qualquerHost`, um redirecionamento para `127.0.0.1` é recusado;
    - com `binario`, volta `buffer`.
- [ ] **Step 2: Rode e veja falhar:** `node --test tests/previa-link.test.cjs tests/rede.test.cjs`.
- [ ] **Step 3: Implemente conforme as decisões.**
- [ ] **Step 4: Rode e veja passar:** `node --test tests/previa-link.test.cjs tests/rede.test.cjs tests/plugins-rede.test.cjs tests/plugins-ligacao-rede.test.cjs tests/server.test.cjs tests/idiomas-cobertura.test.cjs`, e depois `npm test`.
- [ ] **Step 5: Commit**

```bash
git add previa-link.js ligacao-previa.cjs rede-plugins.cjs electron/main.cjs electron/preload.cjs server.mjs index.html fluxo-tela.js app.js styles.css idiomas/en.js tests/previa-link.test.cjs tests/rede.test.cjs
git commit -m "feat(fluxo): previa de link com titulo, descricao e imagem"
```

### Task 5: YouTube tocando no cartão

**Files:**
- Modify: `index.html` (CSP `frame-src` e `img-src`), `electron/main.cjs` (só se o passo 1 pedir), `fluxo-tela.js`, `app.js`, `styles.css`, `idiomas/en.js`
- Test: `tests/fluxo-tela-fonte.test.cjs`

**Interfaces:**
- Consumes: `F.idDoYoutube`, o topo de 3 estados da Task 3, o `data-reusar` da Task 3 e `opcoes.previaDeLink` da Task 4.

Decisões:
- O cartão de link cujo `idDoYoutube(url)` não é nulo vira cartão de vídeo.
- Aberto, o cartão mostra a miniatura `https://i.ytimg.com/vi/<ID>/hqdefault.jpg` com um botão de tocar. Clicar troca a miniatura por um `<iframe>` de `https://www.youtube-nocookie.com/embed/<ID>?autoplay=1`, com `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"` e `referrerpolicy="strict-origin-when-cross-origin"`. Nada é carregado do YouTube antes de abrir o cartão.
- Título: ao criar o cartão, chame `opcoes.previaDeLink(url)` e guarde só o `titulo` em `kiroPrevia`. Sem título, o topo mostra `Vídeo do YouTube`.
- **Abrir:** tela inteira com o mesmo `<iframe>` em tamanho grande, por `abrirTelaInteira`.
- O `<iframe>` usa `data-reusar`, para não ser recriado a cada `desenhar()`.
- CSP de `index.html`: `frame-src` ganha `https://www.youtube-nocookie.com`, e `img-src` ganha `https://i.ytimg.com`. Nada mais.

- [ ] **Step 1: Teste antes de construir (spike, dentro do Kiro)**
  1. Abra o cofre de desenvolvimento: `node_modules/electron/dist/electron.exe . --dev-vault --user-data-dir=<pasta temporária> --remote-debugging-port=<porta>`.
  2. Pelo DevTools Protocol, ponha num cartão o `<iframe>` acima com o ID `dQw4w9WgXcQ` e a CSP nova.
  3. Confira pelo `Network` do protocolo que a página do embed responde 200. Confira também que o texto do frame não traz "Erro 153" nem "Video player configuration error". A conferência é por `Target.getTargets`, com o frame do YouTube.
  4. Se o erro 153 aparecer, acrescente em `electron/main.cjs` um `session.defaultSession.webRequest.onBeforeSendHeaders` só para `https://www.youtube-nocookie.com/*`, com `Referer: https://kiro.app/`, e confira de novo.
  5. Se mesmo assim não tocar, o botão de tocar passa a abrir o vídeo no navegador. Registre isso no relatório.
- [ ] **Step 2: Escreva os testes que falham**
  - `fonte` contém `F.idDoYoutube(`, `youtube-nocookie.com/embed/` e `data-reusar`, no trecho do cartão de vídeo;
  - a CSP em `index.html` contém `frame-src 'self' kiro-plugin: https://www.youtube-nocookie.com`.
- [ ] **Step 3: Rode e veja falhar:** `node --test tests/fluxo-tela-fonte.test.cjs`.
- [ ] **Step 4: Implemente conforme as decisões e o resultado do passo 1.**
- [ ] **Step 5: Rode e veja passar:** `node --test tests/fluxo-tela-fonte.test.cjs tests/idiomas-cobertura.test.cjs`, e depois `npm test`.
- [ ] **Step 6: Commit**

```bash
git add index.html fluxo-tela.js app.js styles.css idiomas/en.js tests/fluxo-tela-fonte.test.cjs
git commit -m "feat(fluxo): video do youtube tocando no cartao"
```

Se `electron/main.cjs` mudou, acrescente-o ao `git add`.

### Task 6: Verificação no app real

Fica com quem coordena, depois da revisão de todas as tarefas, no cofre de desenvolvimento.

- [ ] **Step 1:** conferir ao vivo:
  1. PDF novo entra recolhido. A seta abre e volta à altura certa, e desfazer recolhe de novo.
  2. Os corpos de texto, tabela (inclusive um CSV de 1 000 linhas, que mostra 200 e avisa o resto), áudio e vídeo.
  3. **Abrir** de cada tipo e `Esc`.
  4. Vídeo tocando enquanto outro cartão é movido: o elemento continua o mesmo.
  5. Link de site com prévia, e link de site que não existe: fica o endereço, sem erro.
  6. YouTube: a miniatura, o tocar e o **Abrir**.
  7. Arquivo com extensão `.txt` e conteúdo binário: o cofre recusa e avisa.
- [ ] **Step 2:** `npm test` sem falhas, e fotos em Liquid Glass Escuro e no tema Kiro.
