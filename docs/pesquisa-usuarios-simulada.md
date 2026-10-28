# Bateria de testes com 20 usuários simulados

> **Atenção:** os 20 usuários abaixo são **personas hipotéticas**, não pessoas reais. Cada uma foi montada
> para uma área diferente e "usou" o Kiro pelo que ele faz hoje (versão 0.22.x, com o tema Liquid Glass),
> conferido no código e no README. Serve para levantar hipóteses e ordenar ideias; antes de investir pesado
> numa sugestão, vale confirmar com gente de verdade.

## Como foi feito

1. Cada persona tem uma área, um objetivo e uma tarefa concreta para cumprir no Kiro.
2. A tarefa passa só pelo que existe hoje: notas em Markdown, `[[links]]`, tags, tela Hoje, captura rápida
   (`Ctrl+Espaço`), nota diária, modelos, tarefas (lista, por data, colunas), hábitos, grafo, fluxo (canvas),
   PDFs e imagens na nota, equações, abas e notas lado a lado, favoritos, lixeira e `.history`, temas e skins,
   papel de parede, plug-ins (Foco/Pomodoro, Flashcards com revisão espaçada, Revisão semanal, Kanban,
   Mapa de calor de hábitos, Contagem de palavras, Resumo da Wikipédia), corretor pt/en, interface em inglês
   e IA pelo MCP.
3. No fim, cada uma diz o que funcionou, onde travou e o que sugere (melhoria, plug-in ou design).
4. As sugestões repetidas foram juntadas e ordenadas por prioridade (critérios no fim).

---

## Prioridades (resumo)

"Pedidos" conta quantas das 20 personas pediram aquilo, e os números de cada uma estão entre parênteses. Como cada
persona faz umas três sugestões, nenhuma ideia chega perto de 20; o peso maior fica com impacto e esforço.

| # | Sugestão | Tipo | Pedidos (personas) | Impacto | Esforço | Prioridade |
|---|---|---|---|---|---|---|
| 1 | **Lembretes e notificações** de tarefas, prazos e hábitos | Melhoria | 3 (3, 8, 14) | Alto | Médio | **P0** |
| 2 | **Modelos prontos por área** (ata de reunião, plano de aula, sessão, peça jurídica, roteiro) | Design | 5 (3, 4, 8, 9, 17) | Médio | Baixo | **P0** |
| 3 | **Exportar nota para PDF / imprimir** | Melhoria | 2 (3, 4) | Alto | Baixo | **P0** |
| 4 | **Tarefas recorrentes** (toda segunda, todo dia 5…) | Melhoria | 2 (8, 12) | Alto | Baixo | **P0** |
| 5 | **Acessibilidade**: tamanho de fonte, leitor de tela, anúncios de mudança, contraste no Glass | Design | 3 (5, 18, 19) | Alto | Médio | **P0** |
| 6 | **Visão de calendário** (mês/semana) para tarefas, revisões e publicações | Melhoria | 4 (4, 8, 12, 17) | Alto | Médio | **P1** |
| 7 | **Sincronizar entre computadores** (guia para Syncthing/OneDrive, aviso de conflito, plug-in de Git) | Melhoria | 3 (2, 13, 20) | Alto | Médio | **P1** |
| 8 | **Primeiros passos**: tour curto, glossário ("cofre", "fluxo", "skin") e modo simples | Design | 2 (14, 18) | Alto | Baixo | **P1** |
| 9 | **Histórico da nota** na interface (ver e restaurar versões do `.history`) | Melhoria | 2 (2, 10) | Alto | Médio | **P1** |
| 10 | **Cofre com senha** e bloqueio por inatividade | Melhoria | 2 (3, 9) | Alto | Alto | **P1** |
| 11 | **Capturar de qualquer lugar do sistema** (atalho global com o Kiro minimizado) | Melhoria | 1 (7) | Alto | Baixo | **P1** |
| 12 | **Celular** (pelo menos capturar texto e foto e ler notas) | Melhoria | 3 (11, 13, 17) | Alto | Muito alto | **P2** |
| 13 | **Propriedades e consultas** (campos na nota + tabela que filtra notas, estilo Dataview) | Melhoria | 2 (11, 15) | Alto | Alto | **P2** |
| 14 | **Grifar PDFs**, com os grifos virando nota com a página | Plug-in | 2 (1, 6) | Médio | Alto | **P2** |
| 15 | **Áudio na nota** (anexar, tocar, gravar; transcrever com IA opcional) | Plug-in | 2 (7, 16) | Médio | Médio | **P2** |
| 16 | **Busca dentro dos PDFs** | Melhoria | 1 (6) | Médio | Médio | **P2** |
| 17 | **Modo foco para escrever** (tela limpa, meta de palavras) | Design | 1 (10) | Médio | Baixo | **P2** |
| 18 | **Importar do Notion** (e Evernote/Keep) | Plug-in | 1 (11) | Médio | Médio | **P2** |
| 19 | **Citações acadêmicas** (BibTeX/Zotero) | Plug-in | 1 (6) | Médio | Médio | **P3** |
| 20 | **Glass claro** | Design | 1 (5) | Baixo | Médio | **P3** |
| 21 | **Nota vira slides** | Plug-in | 1 (4) | Baixo | Médio | **P3** |
| 22 | **Exportar DOCX/ePub** | Plug-in | 1 (10) | Baixo | Médio | **P3** |

**Outras sugestões pontuais (uma persona cada):** flashcard com imagem e oclusão (1), modo Vim (2), guias de
alinhamento no fluxo (5), salvar página da web (7), esconder uma pasta da tela Hoje (9), relatório de horas do
Pomodoro por matéria (12), desenhar sobre a foto (13), comemorar sequência de hábito (14), colar CSV vira tabela (15),
lista em texto das ligações do grafo (19), mostrar o código do plug-in antes de ativar (20).

**Por onde começar:** os itens 2, 3 e 4 são de esforço baixo e cabem numa versão só. O item 1 (lembretes) é o que
mais muda o uso diário e combina com o 4 (recorrência), porque os dois mexem nas tarefas. Acessibilidade (5) entra
junto, porque é base e não opcional.

---

## As 20 personas

### 1. Ana, estudante de Medicina (4º ano)
- **Tarefa:** montar resumos de farmacologia com PDFs dos slides e revisar com flashcards.
- **Funcionou:** PDF aberto dentro da nota, `Pergunta :: Resposta` virando cartão, revisão espaçada, equações.
- **Travou:** não consegue grifar o PDF; os flashcards não aceitam imagem (cartão de anatomia).
- **Sugere:** grifar PDF e mandar o trecho para a nota; flashcard com imagem e oclusão de imagem; estatística
  de acertos por matéria.

### 2. Bruno, desenvolvedor back-end
- **Tarefa:** documentar uma API, guardar trechos de código e ligar notas de incidentes.
- **Funcionou:** blocos de código com Copiar, `[[links]]`, grafo, abas, MCP para o agente escrever notas.
- **Travou:** quer versionar o cofre com Git sem sair do app; sente falta de atalhos de teclado no estilo Vim.
- **Sugere:** plug-in de Git (commit, histórico, diff); histórico da nota visível; modo Vim opcional no editor.

### 3. Carla, advogada trabalhista
- **Tarefa:** organizar processos por cliente, com petições em PDF e prazos.
- **Funcionou:** pastas por cliente, PDFs na nota, tarefas com prazo e prioridade.
- **Travou:** prazo sem aviso; precisa entregar a nota ao cliente em PDF; dados sigilosos sem senha.
- **Sugere:** lembrete de prazo (P0); exportar PDF; cofre com senha; modelos de peça.

### 4. Diego, professor de História (ensino médio)
- **Tarefa:** plano de aula semanal e banco de questões.
- **Funcionou:** nota diária, modelos pessoais, flashcards para os alunos estudarem.
- **Travou:** quer imprimir a aula e projetar em sala; o plano semanal pede uma visão de calendário.
- **Sugere:** imprimir/PDF; nota vira slides; calendário da semana; modelos prontos de plano de aula.

### 5. Elisa, designer de UX
- **Tarefa:** moodboard e mapa de jornada de usuário.
- **Funcionou:** fluxo (canvas) com imagens e setas coloridas; o tema Liquid Glass ("bonito de verdade").
- **Travou:** no Glass, com o desktop muito claro, alguns textos cinza perdem contraste; quer alinhar cartões no fluxo.
- **Sugere:** guias de alinhamento e distribuir no fluxo; versão clara do Glass; contraste mínimo garantido no Glass.

### 6. Felipe, doutorando em Biologia
- **Tarefa:** revisão bibliográfica com 60 artigos.
- **Funcionou:** backlinks ("Mencionada em"), grafo, PDFs, tags.
- **Travou:** busca não acha texto dentro dos PDFs; não tem como citar artigos.
- **Sugere:** busca no texto dos PDFs; citações BibTeX/Zotero; grifos do PDF viram nota com a página.

### 7. Gabriela, jornalista
- **Tarefa:** apurar uma pauta com entrevistas e links.
- **Funcionou:** captura rápida com `Ctrl+Espaço`, caixa de entrada, Resumo da Wikipédia.
- **Travou:** a captura só funciona com o Kiro na frente; não grava a entrevista.
- **Sugere:** atalho global do sistema para capturar com o Kiro minimizado; gravar áudio na nota com transcrição;
  salvar página da web (web clipper).

### 8. Henrique, gerente de projetos
- **Tarefa:** acompanhar três projetos com tarefas e reuniões.
- **Funcionou:** tarefas em colunas, plug-in Kanban, prioridade, tarefas ligadas a notas.
- **Travou:** reunião semanal precisa ser recriada toda semana; sem visão de calendário; sem aviso.
- **Sugere:** tarefas recorrentes; calendário; lembretes; modelo de ata de reunião.

### 9. Isabela, psicóloga clínica
- **Tarefa:** anotar sessões de pacientes.
- **Funcionou:** tudo local, sem nuvem (ponto decisivo para ela); modelos.
- **Travou:** quer senha no cofre, por sigilo profissional; a tela Hoje mostra notas de pacientes em "Continuar".
- **Sugere:** cofre com senha e bloqueio por inatividade; opção de esconder cartões da Hoje para uma pasta;
  modelo de registro de sessão.

### 10. João, escritor (romance)
- **Tarefa:** escrever capítulos e manter fichas de personagens.
- **Funcionou:** fonte Literata, `[[personagens]]`, plug-in Contagem de palavras, fluxo para o enredo.
- **Travou:** a interface distrai durante a escrita; quer voltar a uma versão antiga de um capítulo.
- **Sugere:** modo foco com tela limpa e meta de palavras; histórico da nota com restauração; exportar DOCX/ePub.

### 11. Karina, dona de uma loja de roupas
- **Tarefa:** controlar fornecedores, pedidos e ideias de coleção.
- **Funcionou:** pastas, tarefas, papel de parede ("parece meu").
- **Travou:** quer uma "tabela" de fornecedores com campos (telefone, prazo, valor) e filtrar; usa o celular o dia todo.
- **Sugere:** propriedades na nota e tabela que filtra; versão de celular; importar do Notion, que ela usa hoje.

### 12. Lucas, estudante para concurso público
- **Tarefa:** cronograma de estudo com revisões.
- **Funcionou:** Pomodoro ligado a uma tarefa, flashcards com revisão espaçada, hábitos com sequência.
- **Travou:** quer saber quantas horas estudou por matéria; revisão que se repete toda semana.
- **Sugere:** relatório de horas do Pomodoro por tag/pasta; tarefas recorrentes; calendário de revisões.

### 13. Marina, engenheira civil
- **Tarefa:** diário de obra com fotos e plantas em PDF.
- **Funcionou:** colar foto direto na nota, PDF grande (até 250 MB) com abertura na página certa.
- **Travou:** na obra ela só tem o celular; quer marcar em cima da foto.
- **Sugere:** celular para capturar foto e texto; anotar/desenhar sobre a imagem; sincronizar com o computador do escritório.

### 14. Nicolas, pessoa com TDAH
- **Tarefa:** organizar o dia sem se perder.
- **Funcionou:** tela Hoje com "Agora", hábitos, captura rápida, frase do dia ("me fez rir").
- **Travou:** esquece de abrir o app; muitas opções nas Configurações.
- **Sugere:** notificações de hábito e tarefa; "modo simples" com menos opções; comemorar sequência de hábito.

### 15. Olívia, analista de dados
- **Tarefa:** documentar análises e guardar consultas SQL.
- **Funcionou:** código, tabelas Markdown, equações.
- **Travou:** quer listar automaticamente "todas as notas com a tag #analise e status aberto"; colar CSV vira texto.
- **Sugere:** consultas estilo Dataview; colar CSV vira tabela; ordenar e filtrar tabelas.

### 16. Pedro, músico e produtor
- **Tarefa:** letras, ideias de arranjo e partituras.
- **Funcionou:** partitura em PDF na nota, fluxo para a estrutura da música.
- **Travou:** não dá para anexar o áudio da ideia gravada.
- **Sugere:** anexar e tocar áudio (MP3/WAV) na nota; gravar direto pelo app.

### 17. Rafaela, criadora de conteúdo (YouTube)
- **Tarefa:** roteiros e calendário de publicação.
- **Funcionou:** Kanban de vídeos (ideia, roteiro, gravação, publicado), modelos.
- **Travou:** não enxerga o mês de publicações; quer capturar ideias do celular.
- **Sugere:** calendário mensal; captura pelo celular; modelo de roteiro; contagem de tempo de leitura.

### 18. Sérgio, aposentado (68 anos), pouca experiência com computador
- **Tarefa:** anotar receitas e remédios.
- **Funcionou:** "Nova nota" fácil de achar; tudo em português.
- **Travou:** letra pequena; não entendeu "cofre", "fluxo" e "skin"; ficou com medo de apagar algo.
- **Sugere:** aumentar o tamanho da fonte nas Configurações; tour de primeiros passos; glossário curto e linguagem
  mais simples; dizer em destaque que nada se perde (lixeira).

### 19. Tatiane, usuária cega (leitor de tela NVDA)
- **Tarefa:** criar e encontrar notas só com teclado.
- **Funcionou:** `Ctrl+N`, `Ctrl+O`, `Ctrl+K`, rótulos escondidos que o leitor lê na barra recolhida.
- **Travou:** o grafo e o fluxo não têm alternativa em texto; alguns cartões da Hoje não anunciam o que mudou.
- **Sugere:** revisão de acessibilidade completa (WCAG AA); lista em texto das ligações do grafo; anúncios de mudança
  (aria-live) ao marcar hábito e tarefa.

### 20. Vítor, administrador de sistemas (usa Linux)
- **Tarefa:** base de conhecimento de servidores, em dois computadores.
- **Funcionou:** `.AppImage`/`.deb`, Markdown puro, MCP sem porta de rede, `.history` e lixeira.
- **Travou:** sincroniza a pasta com Syncthing e tem medo de conflito; os plug-ins pedem permissões, mas ele quer
  ver o código antes.
- **Sugere:** detectar e mostrar arquivos de conflito do Syncthing/OneDrive; guia de sincronização; mostrar o código
  e as permissões do plug-in antes de ativar.

---

## Critérios de prioridade

- **Pedidos:** quantas das 20 personas pediram a mesma coisa, mesmo com outras palavras.
- **Impacto:** quanto muda o uso diário de quem pediu (Alto: sem isso a pessoa desiste ou usa outro app).
- **Esforço:** estimativa pelo código atual.
  - **Baixo:** cabe numa versão. Exemplos: `webContents.printToPDF` do Electron para exportar PDF;
    `globalShortcut` para capturar de qualquer lugar; um campo de repetição na tarefa.
  - **Médio:** exige uma tela nova ou um plug-in. Exemplos: calendário; histórico da nota sobre o `.history`.
  - **Alto:** mexe no formato dos dados ou na segurança. Exemplos: criptografia; propriedades e consultas.
- **P0:** fazer já (muito pedido e barato, ou essencial: acessibilidade). **P1:** próximo ciclo.
  **P2:** quando houver espaço. **P3:** ideia boa, mas de nicho.

## O que as personas elogiaram (manter)

- **Dados locais em Markdown,** sem conta e sem nuvem. Foi o motivo número 1 para Isabela, Carla e Vítor.
- **A tela Hoje,** com captura rápida e hábitos.
- **PDF dentro da nota** e **fluxo** compatível com o Obsidian.
- **Liquid Glass e papel de parede.** Elisa, Karina e Rafaela citaram a aparência como diferencial.
- **Lixeira e histórico,** que tiram o medo de perder coisas, mas precisam aparecer mais: Sérgio não sabia que existiam.
