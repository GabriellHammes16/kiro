# Plug-in Google Agenda: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ver, criar, editar e apagar eventos do Google Agenda dentro do Kiro, por um plug-in com tela própria.

**Architecture:** o Kiro passa a oferecer uma chave do tipo "conta conectada" no campo `secrets` do manifesto. O host faz o login do Google, guarda o token de renovação e preenche o `Authorization` em cada `kiro.fetch`, então o plug-in nunca vê token nenhum. O plug-in é uma moldura de página (`page`) que chama a Calendar API v3 só por `kiro.fetch(url, { secret: 'google' })`.

**Tech Stack:** Node sem dependências novas (`google-drive.cjs`, `rede-plugins.cjs`, `segredos-plugins.cjs`), plug-in em HTML/JS puro, testes com `node:test`.

**Spec:** não há documento separado; as decisões estão na seção abaixo. O pedido foi "um plug-in que conecta com o Google Agenda, para mexer nas minhas agendas pelo Kiro e atualizá-las".

## Decisões

| Assunto | Decisão | Por quê |
|---|---|---|
| Login | Reaproveitar o fluxo PKCE com retorno em `127.0.0.1` de `google-drive.cjs` | Já funciona no backup, no Electron e no servidor |
| Onde fica o token | No host, em `segredos-plugins.cjs`, cifrado no desktop | `kiro.fetch` já recusa `authorization` vindo do plug-in, e o modelo de segurança depende disso |
| Permissões do Google | `calendar.events` e `calendar.calendarlist.readonly` | O mínimo para listar agendas e mexer em eventos. Criar ou apagar **agendas inteiras** fica de fora, porque exigiria o escopo `calendar` completo |
| Sincronização | Sempre ao vivo, buscando o período visível | Sem cópia local não há conflito de sincronização. Modo sem internet fica de fora |
| Eventos repetidos | Editar ou apagar **só a ocorrência escolhida** | A API já trata uma instância como evento próprio. Editar a série inteira fica para depois |
| Fora desta versão | Convidados, lembretes, anexos, Meet, ligar evento a nota ou tarefa | Podem entrar depois, sem mudar a base |

## Para decidir antes de começar

**Verificação do Google.** Os escopos de agenda são sensíveis, ao contrário do `drive.file` que o backup usa. Pela documentação do Google:

- **Projeto em "Testing":** só até 100 usuários listados, e a autorização **expira em 7 dias**.
- **Projeto publicado sem verificação:** qualquer conta entra, mas vê a tela de "app não verificado", com limite de **100 usuários no total**.
- **Projeto verificado:** sem aviso e sem limite. Exige passar pela verificação do Google, que costuma pedir site e política de privacidade. O Kiro ainda não tem site.

**Recomendação:** começar publicado sem verificação, com você como único usuário, e deixar a verificação para quando o plug-in for para outras pessoas. Enquanto isso, ele **não entra** nos plug-ins inclusos (ver Tarefa 7).

Fontes: [Manage App Audience](https://support.google.com/cloud/answer/15549945), [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

## Global Constraints

- Sem dependência nova no `package.json`.
- O valor do token nunca aparece em retorno, erro, log, auditoria ou na página.
- Texto novo em `app.js` passa por `t()` e ganha tradução em `idiomas/en.js` (`tests/idiomas-cobertura.test.cjs` cobra).
- O plug-in segue `docs/temas.md`: cores só por variável, e `<select>` e caixas de seleção com estilo próprio, porque o CSS do Kiro não entra na moldura.
- `electron/main.cjs`, `docs/plugins.md` e `tests/plugins.test.cjs` tinham mudanças de outra frente, sem commit, em 2026-11-04. Confira `git status` e use a skill `sessoes-paralelas` antes de mexer neles.
- Commit só com o pedido do usuário; `git add` arquivo por arquivo.

## Review Focus

1. **Agenda com `#` no id** (`pt.brazilian#holiday@group.v.calendar.google.com`): sem `encodeURIComponent`, `kiro.fetch` corta tudo depois do `#`. Teste na Tarefa 5.
2. **Evento de dia inteiro:** o `end.date` do Google é exclusivo. Um evento do dia 10 tem fim no dia 11 e precisa aparecer só no dia 10. Teste na Tarefa 5.
3. **Evento alterado em outro lugar enquanto a tela estava aberta:** o `If-Match` devolve 412, e o usuário é avisado sem sobrescrever. Teste na Tarefa 5.
4. **Agenda só de leitura** (feriados, agenda compartilhada): sem botões de editar, em vez de erro 403 depois de preencher. Teste na Tarefa 5.
5. **Internet caída × acesso revogado:** queda de rede não pode apagar o token nem pedir novo login; só `invalid_grant` desconecta. Teste na Tarefa 3.

---

### Tarefa 0: Preparar o projeto no Google Cloud (manual, feita pelo usuário)

**Files:** nenhum.

- [ ] **Passo 1:** em [console.cloud.google.com](https://console.cloud.google.com), no projeto do cliente OAuth do Kiro, ativar a **Google Calendar API**.
- [ ] **Passo 2:** em *Data Access*, adicionar `.../auth/calendar.events` e `.../auth/calendar.calendarlist.readonly`.
- [ ] **Passo 3:** em *Audience*, confirmar que o status é **In production**. Em *Testing*, a conexão cairia a cada 7 dias.
- [ ] **Passo 4:** conferir que o backup no Drive continua conectando. O aviso de app não verificado só deve aparecer para pedidos com os escopos novos.

### Tarefa 1: Tornar o login do Google reutilizável

**Files:**
- Modify: `google-drive.cjs:77-98` (renovação), `:104-220` (fluxo)
- Test: `tests/oauth-plugins.test.cjs` (novo)

**Interfaces:**
- Produces: `renovarSessao({ clientId, clientSecret, refreshToken }, requisitar) -> Promise<{ accessToken: string, expiraEm: number }>`, em que `expiraEm` é um timestamp em ms. Falha com `erro.codigo === 'revogado'` quando o Google responde `invalid_grant`.
- Produces: `iniciarFluxoOAuth({ ..., escopos = [ESCOPO_DRIVE] })`.

- [ ] **Passo 1: escrever os testes que falham**

```js
test('fluxo pede os escopos informados', async () => {
  const f = await iniciarFluxoOAuth({ escopos: ['a', 'b'], requisitar: falso });
  assert.equal(new URL(f.urlAutorizacao).searchParams.get('scope'), 'a b');
  f.aguardarConclusao().catch(() => {}); f.cancelar();
});
test('sem escopos, o fluxo continua pedindo o do Drive', ...);
test('fluxo sem o escopo do Drive não consulta drive/v3/about', ...);
test('renovarSessao calcula expiraEm a partir de expires_in', ...);
test('renovarSessao marca invalid_grant como revogado', ...);
test('renovarSessao não marca erro 500 como revogado', ...);
```

- [ ] **Passo 2:** rodar `node --test tests/oauth-plugins.test.cjs`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. `obterAccessToken` passa a chamar `renovarSessao` e devolver `.accessToken`, mantendo as mensagens do Drive. Nas mensagens do fluxo, trocar "Google Drive" por "Google" e atualizar `idiomas/en.js`.
- [ ] **Passo 4:** rodar `node --test tests/oauth-plugins.test.cjs tests/backup-auto.test.cjs tests/idiomas-cobertura.test.cjs`. Esperado: PASS.
- [ ] **Passo 5:** commit, se pedido.

### Tarefa 2: Aceitar a conta conectada no manifesto

**Files:**
- Modify: `plugins.js:154-163` (validação de `secrets`) e a lista `api` em `plugins.js:408`
- Test: `tests/plugins-oauth.test.cjs` (novo, para não conflitar com `tests/plugins.test.cjs`)

**Interfaces:**
- Produces: `PROVEDORES_OAUTH = { 'google-calendar': { host: 'www.googleapis.com', escopos: [calendar.events, calendar.calendarlist.readonly] } }`, sem nenhum segredo.
- Produces: item de `secrets` validado com `oauth: 'google-calendar'`.

- [ ] **Passo 1: escrever os testes que falham**

```js
const chave = { name: 'google', label: 'Conta Google', host: 'www.googleapis.com',
  header: 'Authorization', format: 'Bearer {value}', oauth: 'google-calendar' };
test('aceita a conta conectada e preserva o campo oauth', ...);
test('recusa provedor desconhecido', ...);
// Sem estas duas regras, um plug-in mandaria o token para o próprio servidor.
test('recusa host diferente do host do provedor', ...);
test('recusa header ou format diferentes de Authorization e Bearer {value}', ...);
test('chave comum continua sem o campo oauth', ...);
```

- [ ] **Passo 2:** rodar `node --test tests/plugins-oauth.test.cjs`. Esperado: FAIL.
- [ ] **Passo 3:** implementar em `validarManifesto`.
- [ ] **Passo 4:** rodar `node --test tests/plugins-oauth.test.cjs tests/plugins.test.cjs`. Esperado: PASS.
- [ ] **Passo 5:** commit, se pedido.

### Tarefa 3: Conectar a conta no host e usar o token no `kiro.fetch`

**Files:**
- Create: `oauth-plugins.cjs`
- Modify: `ligacao-rede-plugins.cjs:27-84`, `electron/main.cjs:289-300`, `electron/preload.cjs:47-49`, `server.mjs:217-226`
- Test: `tests/oauth-plugins.test.cjs`

**Interfaces:**
- Consumes: `renovarSessao`, `iniciarFluxoOAuth`, `PROVEDORES_OAUTH`, guarda de `criarGuardaDeSegredos`.
- Produces: `criarOAuthDePlugins({ guarda, requisitar, abrirUrl, agora }) -> { conectar({ cofre, pluginId, nome, provedor, aguardar }) -> Promise<{ urlAutorizacao } | { conectada: true }>, tokenDeAcesso(cofre, pluginId, nome) -> Promise<string|null>, desconectar(cofre, pluginId, nome) -> Promise<void> }`.
- Produces: IPC `plugins:oauth:connect` e rota `POST /api/plugin-oauth/:id`, com corpo `{ name }`. No preload: `connectPluginAccount(id, nome)`.

- [ ] **Passo 1: escrever os testes que falham**

```js
test('tokenDeAcesso reutiliza o token até 60 s antes de expirar', ...);
test('pedidos simultâneos fazem uma única renovação', ...);
test('invalid_grant apaga o token e rejeita com "Conecte a conta Google de novo em Configurações → Plug-ins."', ...);
test('falha de rede mantém o token guardado e rejeita sem pedir novo login', ...);
test('desconectar limpa o cache, apaga o token e tenta revogar, sem falhar se a revogação falhar', ...);
test('atenderFetch com chave oauth envia Authorization: Bearer <token de acesso>', ...);
test('o token não aparece no retorno nem na auditoria de atenderFetch', ...);
test('gravarChave recusa digitar valor numa chave oauth', ...);
test('conectar recusa nome que o manifesto não declara como oauth', ...);
```

- [ ] **Passo 2:** rodar `node --test tests/oauth-plugins.test.cjs`. Esperado: FAIL nos testes novos.
- [ ] **Passo 3:** implementar `oauth-plugins.cjs`. O token de renovação fica na guarda, com o nome da chave; o de acesso fica só em memória, em um `Map`. Como no backup, um novo `conectar` cancela o fluxo anterior. A revogação usa `POST https://oauth2.googleapis.com/revoke`.
- [ ] **Passo 4:** em `atenderFetch`, quando `segredo.oauth` existir, `cabecalhoDoSegredo` usa `oauth.tokenDeAcesso` em vez de `guarda.valor`. `removerChave` chama `oauth.desconectar` nas chaves oauth.
- [ ] **Passo 5:** ligar o IPC e a rota. A rota entra no mesmo bloco de `server.mjs:217`, para valer a mesma regra de mesma origem. Na web, seguir o padrão de `/api/backup-drive-connect` (`aguardar: false`).
- [ ] **Passo 6:** rodar `node --test tests/oauth-plugins.test.cjs tests/plugins-ligacao-rede.test.cjs tests/plugins-rede.test.cjs`. Esperado: PASS.
- [ ] **Passo 7:** commit, se pedido.

### Tarefa 4: Botão "Conectar conta" nas Configurações

**Files:**
- Modify: `app.js:4259-4263` (acesso às chaves), `app.js:5054-5064` (`itemDaChave` e consentimento), `idiomas/en.js`
- Test: `tests/plugins-oauth.test.cjs`

**Interfaces:**
- Consumes: `connectPluginAccount(id, nome)` e `POST /api/plugin-oauth/:id`, da Tarefa 3.

- [ ] **Passo 1: escrever os testes que falham**, sobre o HTML de `itemDaChave`: chave oauth sem conta mostra "Conectar conta" e nenhum campo de senha; com conta, mostra "Conectada" e "Desconectar"; chave comum continua igual.
- [ ] **Passo 2:** rodar `node --test tests/plugins-oauth.test.cjs`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Na tela de consentimento, a chave oauth diz "Sua conta Google: ver suas agendas e ver e editar eventos". Depois de conectar, atualizar o estado da linha.
- [ ] **Passo 4:** rodar `node --test tests/plugins-oauth.test.cjs tests/idiomas-cobertura.test.cjs`. Esperado: PASS.
- [ ] **Passo 5:** commit, se pedido.

### Tarefa 5: Regras do plug-in e chamadas à Calendar API

**Files:**
- Create: `examples/plugins/google-calendar/manifest.json`, `modelo.js`
- Test: `tests/plugin-google-calendar.test.cjs`

`modelo.js` não acessa a tela e segue o formato de `examples/plugins/focus-pomodoro/modelo.js`, para rodar na moldura e no teste.

**Interfaces:**
- Produces: `criarCliente(fetch) -> { agendas(), eventos(idAgenda, inicio, fim), criar(idAgenda, dados), editar(idAgenda, evento, dados), apagar(idAgenda, evento) }`, em que `fetch` tem a assinatura de `kiro.fetch`.
- Produces: `paraTela(eventoDoGoogle, fusoHorario) -> { id, titulo, inicio, fim, diaInteiro, repetido, etag, link }`.
- Produces: `paraGoogle(dadosDoFormulario, fusoHorario) -> corpo da API`.
- Produces: `agruparPorDia(eventos, fusoHorario)`, `podeEditar(agenda) -> boolean`, `mensagemDeErro(status) -> string`.

Manifesto: `permissions: ["network"]`, `network: ["www.googleapis.com"]`, `minKiro: "0.28.0"` (a primeira versão com a conta conectada; ajuste se a numeração mudar), `page: { "title": "Agenda", "file": "page.html" }` e a chave da Tarefa 2.

- [ ] **Passo 1: escrever os testes que falham**

```js
test('manifesto válido e permissões mínimas', ...);
test('id com # vai codificado na URL', async () => {
  const pedidos = []; const c = M.criarCliente(async (url, o) => { pedidos.push({ url, o }); return { status: 200, text: '{"items":[]}' }; });
  await c.eventos('pt.brazilian#holiday@group.v.calendar.google.com', inicio, fim);
  assert.match(pedidos[0].url, /pt\.brazilian%23holiday%40group/);
  assert.equal(pedidos[0].o.secret, 'google');
});
test('eventos usa singleEvents=true, orderBy=startTime e segue nextPageToken', ...);
test('dia inteiro: o fim exclusivo do Google vira o mesmo dia na tela', ...);
test('dia inteiro: paraGoogle grava o fim como o dia seguinte', ...);
test('evento de vários dias aparece em cada dia de agruparPorDia', ...);
test('com horário: paraGoogle envia dateTime com fuso', ...);
test('horário perto da mudança de horário de verão mantém a hora escolhida', ...);
test('editar envia PATCH com if-match igual ao etag', ...);
test('412 rejeita com "Este evento mudou em outro lugar. Atualize e tente de novo."', ...);
test('410 ou 404 ao apagar conta como já apagado', ...);
test('podeEditar é falso para accessRole reader e freeBusyReader', ...);
test('mensagemDeErro cobre 401, 403, 429 e 500', ...);
test('título vazio vira "(Sem título)" na tela', ...);
```

- [ ] **Passo 2:** rodar `node --test tests/plugin-google-calendar.test.cjs`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. A base é `https://www.googleapis.com/calendar/v3`, com `maxResults=250` e `fields` para limitar a resposta (limite de 5 MB). Rotas: `GET /users/me/calendarList`, `GET|POST /calendars/{id}/events`, `PATCH|DELETE /calendars/{id}/events/{idDoEvento}`.
- [ ] **Passo 4:** rodar `node --test tests/plugin-google-calendar.test.cjs`. Esperado: PASS.
- [ ] **Passo 5:** commit, se pedido.

### Tarefa 6: Tela do plug-in

**Files:**
- Create: `examples/plugins/google-calendar/index.js`, `page.html`, `page.js`, `style.css`
- Test: `tests/plugin-google-calendar.test.cjs` (manifesto e arquivos), verificação manual

**Interfaces:**
- Consumes: `criarCliente`, `paraTela`, `paraGoogle`, `agruparPorDia`, `podeEditar`, `mensagemDeErro`, da Tarefa 5.

Tela:
- **Sem conta:** explica como conectar em Configurações → Plug-ins.
- **Lista de agendas:** caixas para mostrar ou esconder cada uma, com a escolha guardada em `kiro.storage`.
- **Período:** semana ou mês, em lista por dia, com anterior, hoje e próximo. Grade de calendário fica para depois.
- **Evento:** formulário para criar, editar e apagar, com título, agenda, dia inteiro, início, fim, local e descrição. Em agenda só de leitura, só leitura. Em evento repetido, o aviso "Altera só esta ocorrência". Link "Abrir no Google" por `kiro.openLink`.

- [ ] **Passo 1: escrever o teste que falha:** todo arquivo citado existe, `page.file` aponta para `page.html`, `page.html` não tem `onclick=` nem `<script>` embutido e `style.css` não tem cor fixa fora das reservas de `var(--x, #...)`.
- [ ] **Passo 2:** rodar `node --test tests/plugin-google-calendar.test.cjs`. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Primeiro desenho dentro de `kiro.ready.then(...)`, conforme `docs/plugins.md` ("What the frame can do").
- [ ] **Passo 4:** rodar `node --test tests/plugin-google-calendar.test.cjs`. Esperado: PASS.
- [ ] **Passo 5: verificação com conta real, com o usuário.** Rodar `npm run dev`, copiar o plug-in para `dev-vault/.kiro/plugins/google-calendar`, ligar, conectar a conta e, numa **agenda de teste**:
  - Criar, editar e apagar um evento com horário e um de dia inteiro, conferindo cada um em calendar.google.com.
  - Editar uma ocorrência de evento repetido e ver que as outras não mudam.
  - Mudar um evento no site do Google com a tela aberta, salvar no Kiro e ver o aviso de conflito.
  - Abrir uma agenda de feriados e ver que não há botão de editar nem erro no id.
  - **Se a lista de agendas der 403,** o escopo `calendarlist.readonly` não bastou: há relato disso de 2024. Trocar por `calendar.readonly` em `PROVEDORES_OAUTH` e na Tarefa 0.
  - Conferir a tela em um tema escuro, um claro e no Liquid Glass.
- [ ] **Passo 6:** commit, se pedido.

### Tarefa 7: Documentar e distribuir

**Files:**
- Modify: `docs/plugins.md` (seção "Secrets"), `docs/KIRO-resumo-para-IA.md`
- Só se a verificação do Google estiver concluída: `electron/plugins-inclusos.cjs:6`, `tests/plugins-inclusos.test.cjs`

- [ ] **Passo 1:** documentar em "Secrets" a chave `oauth`, as regras de host, header e format, e que só provedores de `PROVEDORES_OAUTH` são aceitos.
- [ ] **Passo 2:** não adicionar a `IDS` enquanto o projeto não for verificado, pois quem ativasse veria o aviso de app não verificado e contaria no limite de 100 usuários.
- [ ] **Passo 3:** rodar `npm test`. Esperado: nenhuma falha.
- [ ] **Passo 4:** atualizar o grafo com `/graphify . --update`.
- [ ] **Passo 5:** commit e versão, se pedido. O `minKiro` exige publicar na versão que ele declara ou em uma superior.
