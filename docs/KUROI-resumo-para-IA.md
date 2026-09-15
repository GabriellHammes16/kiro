# KUROI: resumo do projeto para outra IA

> Cole este arquivo inteiro numa conversa com outra IA para ela entender o projeto antes de ajudar.
> Estado em **15/09/2026**, versão **0.11.2** instalada, com mudanças da 0.12.0 ainda não commitadas (veja "Situação atual").

---

## 1. O que é

**KUROI** é um aplicativo de **"segundo cérebro"**, parecido com o Obsidian: um lugar para **capturar ideias, organizar notas, ligar uma nota a outra, acompanhar tarefas e hábitos**.

- **Local e offline.** Os dados ficam numa pasta do computador, o "cofre". Não há conta, servidor na nuvem nem assinatura.
- **Notas em Markdown.** Cada nota é um arquivo `.md` de verdade, legível em qualquer editor.
- **Duas formas de rodar:** app desktop para Windows (Electron) e versão web local, no navegador do próprio computador.
- **IA opcional.** Agentes externos, como o Claude Desktop, podem ler e escrever notas por uma API local com permissões. Nenhuma IA é obrigatória.
- **Idioma:** interface, código, comentários e mensagens em **português do Brasil**.
- **Dono do projeto:** Gabriel (usuário final e quem decide o que entra).

---

## 2. Tecnologias usadas

| Parte | Tecnologia |
|---|---|
| Interface | **HTML + CSS + JavaScript puro**: sem framework, sem TypeScript, sem etapa de build |
| Desktop | **Electron 44** (`contextIsolation`, `sandbox`, protocolo próprio `kuroi-anexo://` para imagens) |
| Instalador | **electron-builder** (NSIS para Windows): `dist/KUROI-Setup-<versão>.exe` |
| Servidor da versão web | **Node.js** (`http` nativo), só em `127.0.0.1` |
| Dados | Arquivos **Markdown com frontmatter YAML** (`js-yaml`) + um `caderno.json` com os dados auxiliares |
| Integração com IA | **Agent API** própria + **servidor MCP** (`@modelcontextprotocol/sdk`, transporte stdio) |
| Equações | **KaTeX 0.18.7**, embutido em `vendor/` (sem CDN) |
| Fontes | **IBM Plex Sans** (interface), **Literata** (leitura), **IBM Plex Mono** (código), todas locais em `fonts/` (OFL) |
| Testes | `node --test` (executor nativo do Node), **63 testes**, sempre em pastas temporárias |
| Segurança web | CSP `script-src 'self'`, sem scripts externos, checagem de Host/Origin no servidor |

Dependências de produção: apenas `@modelcontextprotocol/sdk` e `js-yaml`.

---

## 3. Estrutura de arquivos

```
app.js          interface inteira (telas, editor, grafo, hábitos, menus), cerca de 2.200 linhas
styles.css      estilos (tema escuro, escala de medidas em variáveis CSS)
temas.css       variáveis de cada tema e regras das skins
index.html      casca da página (barra lateral + <main id="app">)
domain.js       regras puras compartilhadas entre navegador e Node: validação, links, menções,
                hábitos (frequência, sequência, estatísticas), caixa de entrada, revisão
vault.cjs       leitura e gravação do cofre: Markdown, caderno.json, histórico, lixeira,
                trava (.kuroi.lock), gravação atômica, anexos (imagens)
server.mjs      servidor da versão web (npm start = porta 4173; npm run dev = porta 4180 com recarga)
electron/       main.cjs (janela, IPC, protocolo de imagens) e preload.cjs (ponte segura)
agent/          Agent API: api.cjs (operações), tools.cjs (21 ferramentas), config.cjs
                (permissões), security.cjs, audit.cjs, events.cjs
mcp/server.mjs  servidor MCP, adaptador fino sobre a Agent API
dev/            recarga ao vivo e o cofre de exemplo (dev-vault/) para desenvolver
tests/          vault, agentes, MCP, servidor, anexos, hábitos, caixa de entrada, notas, backup
docs/           agent-api.md, mcp.md e este resumo
scripts/        build-review-graph.mjs: grafo de dependências do código para revisão
```

### Como os dados ficam no disco (o "cofre")

```
cofre/
  Estudos/Python/listas-em-python-<id>.md    ← cada nota é um .md; pastas são pastas reais
  caderno.json                                ← tarefas, hábitos, histórico dos hábitos, pastas (cor, descrição)
  Anexos/                                     ← imagens coladas nas notas (PNG/JPG/GIF/WebP)
  .history/  .trash/  .kuroi/agent.json       ← versões anteriores, lixeira, permissões dos agentes
```

Frontmatter de uma nota:
```yaml
---
caderno-id: n-listas
title: Listas em Python
tags: [python]
folderId: f-python
createdAt: 1788307200000
updatedAt: 1789189555996
---
```

**Regras de segurança dos dados:**
- nenhuma operação apaga de verdade: tudo vai para `.trash` e pode ser restaurado;
- toda gravação confere a "revisão" do cofre, para não sobrescrever mudanças feitas em outro lugar;
- a interface relê o cofre a cada 5 segundos, para notar edições feitas por fora.

---

## 4. O que o KUROI faz hoje

### Tela Hoje (a inicial)
- **Frase do dia** no lugar de "Bom dia": 20 frases bem-humoradas que mudam à meia-noite e nunca repetem a do dia anterior ("Ara ara… não seja vagabundo, vamos trabalhar porque você é pobre."). A saudação muda com a hora.
- **Captura rápida:** faixa logo abaixo da frase; **Ctrl + Espaço** de qualquer tela. A ideia vira nota com `#inbox`.
- **Duas colunas por intenção:**
  - **Agora:** Hábitos e Para fazer agora;
  - **Organizar:** Continuar de onde parei, Caixa de entrada e Para revisar.
- **Caixa de entrada:** capturas pendentes, com ações "Mover para pasta" e "Arquivar".
- **Para revisar:** notas **soltas** (sem pasta, sem ligações, sem menções) e **esquecidas** (sem alteração há mais de 30 dias).
- **Continuar de onde parei:** a última nota editada; o clique abre com o cursor no final.
- **Layout adaptável:** as colunas quebram pela largura real, e os cards crescem com os itens.

### Hábitos
- **Frequência:** todo dia, dias da semana ou X vezes por semana.
- **Histórico salvo por dia** no cofre, com **sequência** e bolinhas da semana (segunda a domingo, clicáveis para marcar dias esquecidos).
- **Estatísticas:** sequência, % nos últimos 30 dias, total e uma grade das últimas 5 semanas.
- **Botão direito:** marcar hoje, editar, novo, estatísticas e excluir. A exclusão usa uma confirmação do próprio app.
- A rotina antiga ("feito hoje: sim/não") é convertida automaticamente em hábitos.

### Notas e editor
- **Edição no lugar**, como no Obsidian: a nota aparece formatada e cada bloco vira texto editável ao clicar. Itens de lista são editáveis um a um.
- **Markdown:** títulos, listas, tarefas `- [ ]` clicáveis, citações, destaques (`> [!tip]`), tabelas, notas de rodapé, código com botão Copiar e **equações KaTeX** (`$...$` e `$$...$$`).
- **Ligações `[[Nome da nota]]`**, com **sugestões ao digitar `[[`**. Um link para nota inexistente cria a nota ao clicar.
- **"Mencionada em (N)"** no fim de cada nota: quem aponta para ela.
- **#etiquetas clicáveis:** abrem a lista de notas filtrada.
- **Imagens:** colar (Ctrl+V) ou arrastar, redimensionar pela alça, clicar para tela cheia.
- **Data de criação e de alteração**, mostradas nos cards.
- **Menu do botão direito no texto:** formatar, inserir, parágrafo, salvar, mover para lixeira.
- **Ctrl+O:** ir para nota pelo título. **Ctrl+N:** nova nota. **Ctrl+S:** salvar.

### Pastas (árvore do cofre)
- Pastas aninhadas reais no disco, com **cor por pasta** (8 cores): fundo tingido, ícone colorido e cor nos cards e no grafo.
- **Arrastar nota para uma pasta.**
- **Botão direito na nota:** abrir e mover para.
- **Botão direito na pasta:** nova nota, nova subpasta, renomear ou mover, cor e excluir.

### Tarefas
- Tarefas com data, prioridade e nota vinculada (o link abre a nota).
- **"Nas notas":** reúne os `- [ ]` escritos dentro das notas; marcar ali grava na própria nota.

### Grafo
- Grafo de forças escrito à mão, sem biblioteca. O tamanho do ponto depende de quantas notas apontam para ele.
- **Cor dos pontos:**
  - nota em pasta: **cor da pasta** (subpasta sem cor herda a da pasta de cima);
  - nota sem pasta: **branco**, cor ajustável no painel.
- **Painel de opções:** filtros (etiquetas, anexos, órfãs), grupos coloridos por busca, forças (centrípeta, repulsão, links, distância), setas, rótulos, grafo local por profundidade.
- Arrastar pontos, zoom e pan.

### Configurações (4 abas)
- **Personalização:** **temas** (7 Clássicos + 11 Anime, todos com contraste de 4,5:1) e **Personalizado** (cores de fundo e destaque manuais, com aviso de contraste); **skins** mudam cantos, espaços, bordas e fonte (Padrão, Minimal, Compacto, Terminal, Suave, Sharp, Neon, Paper).
  - Guardado em `localStorage['kuroi.aparencia']` como `{ tema, skin, sidebar, content, acento }`; `domain.js` valida (`aparenciaValida`, migra o formato antigo) e `app.js` põe as classes `tema-<id>`/`skin-<id>` no `<html>`.
  - As variáveis de cada tema e as regras das skins ficam em `temas.css` (carregado depois de `styles.css`); aplicar é na hora, sem recarregar.
- **Sistema:** caminho do cofre, abrir pasta, trocar de cofre, recarregar, exportar/importar backup JSON, lixeira.
- **Integrações:** permissões dos agentes de IA (ler, criar, editar, excluir, confirmar ações destrutivas, ligar/desligar MCP).
- **Atalhos:** lista dos atalhos de teclado.

### Integração com IA (Agent API + MCP)
- **21 ferramentas:** `create_note`, `read_note`, `update_note`, `delete_note`, `restore_note`, `list_trash`, `list_notes`, `search_notes`, `create_folder`, `list_folders`, `move_note`, `get_backlinks`, `get_outgoing_links`, `create_note_link`, `get_recent_notes`, `get_daily_note`, `get_habits`, `add_tag`, `remove_tag`, `search_by_tag`, `get_vault_info`.
- **Filtro por data:** `list_notes` e `search_notes` aceitam `since`/`until` (AAAA-MM-DD), para perguntas como "o que anotei ontem sobre Python?".
- **Hábitos para a IA:** `get_habits` devolve o progresso já calculado (sequência, % em 30 dias, últimos 7 dias).
- **Segurança:**
  - nunca há operações genéricas como "ler qualquer arquivo" ou "rodar comando";
  - tudo fica restrito ao cofre, com permissões e auditoria;
  - o servidor MCP é só stdio e não abre porta de rede.
- **Uso atual:** o **Claude Desktop** está configurado para usar o MCP do KUROI instalado.

---

## 5. Como desenvolver e testar

```bash
npm run dev          # versão web de desenvolvimento em http://localhost:4180 (cofre de exemplo dev-vault/)
npm run dev:reset    # recria o cofre de exemplo
npm test             # 63 testes (node --test), sempre em pastas temporárias
npm run desktop:dev  # app Electron com o cofre de exemplo
npm run build:win    # gera dist/KUROI-Setup-<versão>.exe
npm run mcp          # servidor MCP (stdio)
```

Fluxo usado no projeto:
1. mudar primeiro na versão web;
2. conferir no navegador;
3. rodar os testes;
4. commitar;
5. subir a versão no `package.json`;
6. gerar o instalador.

---

## 6. Regras e preferências do dono (respeite ao sugerir mudanças)

1. **Nunca tocar nos cofres reais** em testes: `C:\Projetos\Meu segundo cerebro\vault` e `C:\Users\bielg\Documents\KUROI\vault`. Testes usam pastas temporárias, e o desenvolvimento usa `dev-vault/`.
2. **Não transformar em SaaS** e não tornar serviços externos obrigatórios.
3. **Nada do cofre é enviado automaticamente** para fora. Nenhuma chave de API embutida no código.
4. **Sem operações genéricas** na API de agentes (`read_any_file`, `run_shell` etc.).
5. **Sem framework e sem build:** manter JavaScript puro, com poucos arquivos.
6. **Visual escuro**, cor de destaque roxa por padrão (`#C77DFF`), fontes próprias, cores só via variáveis CSS (`--acento` etc.).
7. **Português do Brasil** na interface, no código e nos commits.
8. **Não usar `confirm()`/`alert()` nativos** em ações importantes: no Electron eles podem não aparecer. Usar a janela de confirmação do próprio app.
9. **Menus e ações buscam o item pelo id na hora do clique:** o cofre é relido a cada 5 segundos, e guardar o objeto antigo perde alterações. Esse bug já aconteceu com a cor das pastas.
10. Uso **só no desktop** por enquanto; celular não é prioridade.
11. Estilo de trabalho preferido: soluções simples e diretas, **sem abstrações desnecessárias**, com um teste para cada lógica não trivial.

---

## 7. Histórico: o que foi feito até agora

| Versão | Principais entregas |
|---|---|
| até 0.9.0 | Base: notas Markdown, pastas, tarefas, rotina, busca, lixeira, histórico, Agent API e MCP, instalador |
| 0.10.0–0.10.1 | Edição no lugar (clicar e editar), imagens coladas/arrastadas e redimensionáveis, versão web de desenvolvimento com recarga ao vivo |
| 0.11.0 | Fontes próprias, equações KaTeX, grafo interativo com painel no estilo do Obsidian, caixa de entrada, menções, sugestões `[[`, etiquetas clicáveis, data de criação, cores de pasta, cor de destaque configurável, arrastar nota para pasta, menus do botão direito na árvore, Ctrl+O, tarefas das notas, filtro por data na API, integração com o Claude Desktop |
| 0.11.1 | Correção: cor da pasta pelo botão direito não gravava (objeto antigo depois da releitura de 5 s); mudar cores não pede mais para "descartar" |
| 0.11.2 | Escala única de medidas (espaço, cantos, letra, botões), coluna de leitura de 620 px, contraste acima de 4,5:1, Configurações redesenhadas, barra de status só para erros |
| **0.12.0** (pendente) | Hábitos com histórico, frequência, sequência e estatísticas; `get_habits` para a IA; tela Hoje em duas colunas; frase do dia; captura rápida com Ctrl+Espaço; menu do botão direito nos hábitos; Configurações em 4 abas; confirmações próprias; teste de backup (apagar o cofre e restaurar) |

Também foram feitos: bateria de testes com vários agentes (servidor, persistência, interface, MCP e Electron), revisão de código com remoção de CSS e JS mortos, e um grafo de revisão do código (`npm run review-graph`).

---

## 8. Situação atual e pontos em aberto

- **Não commitado:** tudo da linha 0.12.0 acima. O instalador mais recente é o 0.11.2.
- **Limite conhecido:** o **backup JSON não inclui as imagens** coladas nas notas. Para um backup completo, copie a pasta do cofre.
- **Falhas apontadas pela bateria de testes e ainda não corrigidas:**
  - edições simultâneas de agentes na mesma nota podem perder gravações (só 3 tentativas);
  - uma trava `.kuroi.lock` órfã, depois de uma queda, precisa ser apagada à mão;
  - a exclusão de **pasta** ainda usa o `confirm()` nativo.
- **Ideias sugeridas e não feitas:**
  - backup com imagens;
  - editar as frases do dia pelas Configurações;
  - painel de conversa com IA dentro do app (o dono preferiu usar o Claude Desktop pelo MCP);
  - nomes de arquivo sem o identificador longo.
