# Kiro — segundo cérebro local

Notas em Markdown, conexões entre ideias, estudos, tarefas e rotina. Funciona offline e mantém os dados em uma pasta escolhida por você.

## Abrir

- Desktop: `npm run desktop`.
- Navegador: `npm start`, depois abra http://localhost:4173.
- Testes: `npm test`.
- Instalador Windows: `npm run build:win`.

## Desenvolver pela versão web

O navegador e o desktop rodam o mesmo `index.html`, `app.js` e `styles.css`. Por isso a interface pode ser ajustada no navegador e só compilada quando estiver pronta.

1. `npm run dev` e abra http://localhost:4180.
2. Edite. `styles.css` troca na hora, sem recarregar a página; `app.js`, `index.html` e `domain.js` recarregam a página, salvando antes a nota que estiver aberta. Mudanças em `server.mjs`, `vault.cjs` ou `agent/` reiniciam o servidor, e a página recarrega sozinha.
3. `npm test`.
4. `npm run desktop:dev` para conferir na janela do Electron, com o mesmo cofre de exemplo.
5. `npm run build:win` gera o instalador.

O modo de desenvolvimento usa `dev-vault/`, um cofre de exemplo com pastas aninhadas, links que existem e que não existem, blocos de código, destaques e tarefas. Ele nunca abre o cofre pessoal. `npm run dev:reset` apaga e recria esse cofre. Para testar com outra pasta, defina `KIRO_VAULT`; nesse caso nada de exemplo é criado nela.

A recarga ao vivo só existe com `--dev`: o `npm start` não a oferece, e `dev/` e `dev-vault/` ficam fora do instalador.

O que só existe no desktop: **Escolher outro cofre** e abrir a pasta do cofre no Explorador de Arquivos.

No desktop, o cofre padrão fica em `Documentos/Kiro/vault`. **Escolher outro cofre** abre uma pasta existente ou vazia e lembra a escolha. Essa ação troca o cofre aberto; não transfere os arquivos do anterior. Para transferir, copie a pasta inteira com o aplicativo fechado.

No navegador, o padrão é `vault/` neste projeto. Para abrir outra pasta no PowerShell:

```powershell
$env:KIRO_VAULT = 'C:\MeuCofre'
npm start
```

O servidor aceita conexões somente deste computador. O botão **Abrir pasta do cofre** mostra o caminho no navegador; no desktop, abre o Explorador de Arquivos.

## Escrever e conectar

- **Captura rápida**, na página Hoje, cria uma nota com a tag `inbox`.
- **Nota diária** abre ou prepara uma nota com a data local, sem duplicar uma nota com o mesmo título.
- **Modelo** oferece resumo de estudo, reunião e nota diária.
- Use `[[Nome da nota]]` para ligar ideias. A seção **Links nesta nota** abre a nota ou permite criar o destino.
- `[[Nome da nota|Texto do link]]` permite um rótulo diferente.
- **Notas que apontam para cá** mostra os backlinks.
- Informe tags no campo de tags ou escreva `#estudos` no corpo.
- A busca encontra títulos, conteúdo e tags. Use `#tag` para filtrar por tags.
- Tarefas podem ser associadas a uma nota. A rotina considera o dia no fuso local.
- Atalhos: **Ctrl+N** para criar uma nota, **Ctrl+S** para salvar o formulário de nota e **Esc** para fechar.
- O editor trabalha com texto Markdown; ainda não há prévia formatada, grafo ou sistema de plugins. Modelos são predefinidos.

Links internos são resolvidos pelo título ou caminho do arquivo, sem diferenciar maiúsculas e acentos. Títulos duplicados resolvem para a primeira correspondência; prefira títulos distintos ou caminhos. Ao renomear um título, atualize os links que usam esse título.

## O cofre é a fonte dos dados

Todos os arquivos `.md` da pasta e de suas subpastas são carregados. Pastas ocultas e links simbólicos são ignorados. Notas criadas pelo aplicativo ficam em `Notas/`, com metadados YAML, um identificador persistente e o corpo Markdown.

`caderno.json` guarda somente tarefas, rotina e pastas de estudo. Não guarda cópias do corpo das notas. Metadados YAML personalizados são preservados ao editar uma nota; sua formatação pode ser normalizada.

Arquivos criados, editados ou removidos em outro editor aparecem ao voltar para o aplicativo ou na verificação a cada cinco segundos. Essa atualização fica suspensa enquanto um formulário está aberto, há um salvamento em andamento ou uma falha pendente. Arquivos externos sem identificador recebem um ID baseado no caminho até serem editados pelo Kiro.

Se o cofre mudar enquanto você edita, o salvamento é recusado, preservando a versão externa. Sua versão permanece na janela: **Exporte os dados** antes de **Recarregar cofre**. Texto ainda não submetido no formulário deve ser copiado separadamente.

Pastas de estudo são a organização do Kiro. Arquivos externos são encontrados em qualquer subpasta, mas sua hierarquia não cria automaticamente pastas de estudo na interface.

## Migração, lixeira e recuperação

O cofre antigo é reconhecido automaticamente. O Markdown existente prevalece sobre o corpo antigo no JSON; notas que só existem no JSON são migradas no próximo salvamento. Os IDs existentes são preservados, mantendo as associações das tarefas.

Antes de cada salvamento que altera arquivos, uma cópia do cofre anterior é criada em `.history/<data-id>/`. No primeiro salvamento, essa cópia inclui o JSON legado. Os testes usam cofres temporários, sem editar o cofre pessoal.

**Mover para lixeira** remove a nota da pasta ativa e a guarda em `.trash/`. **Lixeira → Restaurar** recupera seu conteúdo e ID. Movimentar uma nota ou renomear sua pasta remove o arquivo antigo da área ativa, mantendo a cópia de recuperação.

Cada arquivo é gravado por substituição atômica. Um registro `.transaction.json` identifica salvamentos interrompidos entre arquivos: nesse caso o aplicativo bloqueia a abertura para não aceitar dados parciais. Com o aplicativo fechado, preserve uma cópia da pasta e restaure o snapshot indicado em `backup` nesse registro em uma pasta vazia; abra essa pasta como outro cofre. Uma interrupção abrupta também pode deixar `.kiro.lock`; só remova esse arquivo depois de confirmar que nenhum processo está usando o cofre.

O histórico guarda os 30 salvamentos mais recentes; os mais antigos são apagados ao final de cada gravação. A lixeira não é apagada automaticamente. Nenhum dos dois substitui uma cópia em outro disco. O backup JSON exportado inclui as notas ativas e os dados auxiliares, mas não o histórico e a lixeira; copie a pasta inteira para preservar tudo.

Importações são validadas antes de alterar o estado. Elas substituem os dados ativos; notas removidas vão para a lixeira e o cofre anterior fica no histórico. A API do navegador aceita até 20 MB por salvamento.

## Imagens

Cole um print com **Ctrl+V** ou arraste uma imagem para dentro da nota. A imagem é gravada no cofre, na pasta `Anexos/`, e a nota recebe `![[Anexos/nome.png]]`, o mesmo formato do Obsidian. Passe o mouse sobre a imagem e arraste a bolinha do canto para mudar o tamanho; a largura fica no texto, como `![[Anexos/nome.png|320]]`.

Aceita PNG, JPEG, GIF e WebP de até 20 MB. SVG não é aceito, porque pode carregar código.

`Anexos/` tem um arquivo `.kiro-anexos` que a identifica. Com ele, a pasta não aparece na árvore, colar uma imagem não entra em conflito com a nota aberta e as imagens não são copiadas para `.history` a cada salvamento. Em troca, o histórico e a lixeira não guardam imagens: apagar o `![[...]]` da nota não apaga o arquivo, e uma imagem apagada da pasta não volta. Se o cofre já tiver uma pasta `Anexos` sua, as imagens vão para `Anexos do Kiro`.

## Equações

`$x^2$` desenha a fórmula na linha; `$$` numa linha sozinha abre um bloco de equação, fechado por outro `$$`. É a mesma notação do Obsidian, e os dois estão no menu do botão direito, em **Formatar** e **Inserir**.

Quem desenha é o [KaTeX](https://katex.org), embarcado em `vendor/katex/` (cerca de 600 KB, licença MIT, em `vendor/katex/LICENSE.txt`). Nada é buscado na internet. Uma fórmula com erro aparece em laranja, com o texto original visível — nunca some da nota.

Texto colado aos cifrões é o que vira fórmula, então `R$ 5 e R$ 10` continua sendo dinheiro.

## Fluxo

Canvas de ideias para mapas mentais: cartões de texto em Markdown (com código e fórmulas),
setas com rótulo e cor, pan, zoom e desfazer. Cada fluxo é um arquivo `.canvas` no formato
aberto [JSON Canvas](https://jsoncanvas.org), compatível com o Obsidian. Crie um pelo botão
direito numa pasta ("Novo fluxo aqui") ou pelo botão de fluxo no topo da árvore.

Atalhos dentro do fluxo: dois cliques no fundo criam um cartão; arraste de uma alça para ligar
(soltar no vazio cria um cartão já ligado); Ctrl+roda dá zoom; espaço+arrastar move a vista;
Shift+1 enquadra tudo; Delete apaga; Ctrl+Z/Ctrl+Y desfazem e refazem.

## Fontes

O aplicativo embarca as próprias fontes, em `fonts/`, e nunca busca fonte na internet: a aparência é a mesma em qualquer máquina, com ou sem rede.

- **IBM Plex Sans** na interface — feita para telas e tamanhos pequenos.
- **Literata** no texto das notas — desenhada para leitura longa em tela.
- **IBM Plex Mono** nos blocos de código.

São arquivos `woff2` só com os caracteres latinos, cerca de 450 KB no total. As três estão sob a SIL Open Font License, que permite redistribuí-las junto do aplicativo; as licenças ficam em `fonts/LICENSE-ibm-plex.txt` e `fonts/LICENSE-literata.txt`.

## Agentes de IA (opcional)

O Kiro expõe uma camada controlada para agentes de IA lerem e escreverem no cofre,
desligável e sem enviar nada para a nuvem por conta própria. O aplicativo funciona
normalmente sem nenhuma IA conectada.

- Servidor MCP por stdio: `npm run mcp`. Não abre porta de rede.
- Permissões na barra lateral, em **Configurações › IA e integrações**. Excluir vem desligado.
- Registro de alterações em `.kiro/audit.log`, dentro do cofre.

Detalhes em [docs/agent-api.md](docs/agent-api.md) e [docs/mcp.md](docs/mcp.md).

## Estrutura do código

- `vault.cjs`: leitura Markdown, migração, revisão de arquivos, salvamento, snapshots e lixeira.
- `domain.js`: validação compartilhada, datas locais, tags e links.
- `server.mjs`: API local e lista explícita de arquivos públicos.
- `electron/`: janela desktop, ponte IPC e seleção do cofre.
- `app.js`: navegação, edição e sincronização da interface.
- `agent/`: Kiro Agent API, validação, permissões, auditoria e eventos.
- `mcp/`: servidor MCP, adaptador fino sobre a Agent API.
- `tests/`: testes de persistência, API, agentes e MCP em pastas temporárias.
