# Plugins de produtividade — escopo e direção visual

Usuário escolheu Foco/Pomodoro, Flashcards e Revisão semanal e pediu interfaces bonitas. Implementação autorizada em chat; defaults abaixo são decisões do executor para a primeira versão.

## Plataforma e limites

Plugins independentes em examples/plugins/{focus-pomodoro,flashcards,weekly-review}; manifest + index.js (ES module) + page.html + page.js e style.css, arquivos planos servidos pela API existente. Usar kiro.ready nas páginas, nenhum script inline, nenhuma rede/dependência nova. API de notas retorna até500 recentes: exibir esse limite em Flashcards/Revisão, sem prometer cobrir o cofre inteiro. Persistência via kiro.storage (1MB); erros visíveis e sem fingir que gravou. Nenhum acesso DOM do app/hospedeiro ou outro plugin. Não alterar permissões do runtime nem autoativar plugins no cofre pessoal.

Usar novos plugins copiados pelo fluxo existente para dev-vault. Não alterar app.js/domain.js nem mover trabalho anterior. Distribuição desta entrega: código dos plugins e cofre de desenvolvimento; exemplos não fazem parte do instalador atual. Sem build de instalador.

## Direção visual comum

Minimalismo editorial calmo, apropriado ao Kiro: tons e superfícies dos tokens --bg,--panel,--panel-raised,--campo,--ink,--muted,--line,--acento,--accent-text,--accent-soft,--primario-texto,--focus-ring,--success,--warning,--danger; tamanhos fluidos, bordas finas, raios contidos (12–20px), espaço generoso, textos auxiliares curtos. Fontes da casa via var(--fonte-interface)/var(--fonte-leitura)/var(--fonte-codigo) com fallback local; sem baixar fontes. Ícones SVG pequenos próprios, sem emoji como ícone principal. Sem cartões iguais em todo lugar, gradientes chamativos, confete ou animações constantes.

Cabeçalho pequeno com sobrerrótulo e título; uma ação principal por contexto. Estados loading/erro/vazio desenhados. Usar textContent ou escapar conteúdo de notas/tarefas; labels, foco visível, botões nativos, teclado, reduced-motion. Reflow em600px e menor; painéis/timer sem overflow. Texto em PT-BR, como exemplos existentes; conteúdo arbitrário do usuário não traduzido. Acompanhar tema claro/escuro do runtime sem hardcode de texto ilegível.

## Foco / Pomodoro

- id focus-pomodoro, page page.html, permissões somente tasks:read. Settings foco25min (1–120) e pausa5min (1–30).
- Página: coluna principal com grande mostrador tabular e anel de progresso SVG discreto, seletor de tarefa (pendentes; Foco livre como alternativa), estado Foco/Pausa, Iniciar/Pausar/Retomar e Encerrar. Lateral com resumo do dia e últimas sessões; empilhar em telas estreitas. Sem solicitar notificações do sistema.
- Cronômetro por deadline em Date.now, não decremento de ticks; estado persistido para navegar/recarregar sem resetar. Pausar retém restante; terminar foco registra UMA sessão com tarefa/título/duração, entra em pausa pronta e aguarda ação do usuário; fim de pausa volta a foco pronto. Encerrar um foco antes do fim não registra sessão concluída.
- Persistir estado+histórico numa única chave por transição e limitar histórico às200 últimas sessões; só refletir sucesso após storage.set. Finalização idempotente após reload; erros visíveis. Settings mudam próximos ciclos, não encurtam sessão ativa. Pode concluir ao reabrir após deadline, avisos só com página aberta.
- Worker registra painel Hoje declarativo pequeno com resumo de sessões, sem segundo cronômetro/escritor. UI da página é única controladora do timer; várias janelas ao mesmo tempo não sincronizam em tempo real (limite documentado). Se robustez exigir, detectar storage mais recente antes de gravar para não sobrescrever uma sessão posterior.
- Testes pequenos de transições: pausar/retomar, deadline atrasado, conclusão única, cancelamento, falha de persistência, histórico limitado.

## Flashcards

- id flashcards, permissões somente notes:read. Cartões derivados de linhas `Pergunta :: Resposta` nas notas; ignorar linhas dentro de cercas ``` e ~~~. Separar somente primeiro delimitador com espaços; aparar, remover prefixo opcional de lista simples. Ignorar pares vazios. Sem IA, sem alterar notas.
- Página: cabeçalho com contagem/Atualizar, cartão de leitura central com pergunta grande, origem da nota e progresso; resposta só após Revelar; então Errei / Lembrei. Área discreta de como criar com exemplo e limite de até500 notas recentes. Estado zero explícito e útil, não dados falsos.
- Identidade de cartão sem colisão: JSON.stringify([note.id,pergunta,resposta]); progresso contém apenas revisões/dueAt/step/lastReviewedAt, não cópia de todas notas. Resposta editada gera cartão novo; duplicatas exatas da mesma nota deduplicadas. Tratar falha/storage cheio com aviso, sem mostrar revisão como gravada.
- Errei agenda10min; Lembrei agenda1,3,7,14,30 dias em etapas, limitadas30. Datas baseadas no calendário local para dias; contador devida por dueAt<=agora. Não repetir imediatamente cartão cujo prazo mudou. Sem alegar algoritmo Anki/FSRS. Um card por vez; depois fila concluída mostrar confirmação e próxima revisão. Refresh deve preservar agenda de cartões que continuam iguais.
- Worker painel Hoje resumindo devidos, lendo mesmos dados e parser, sem escrever. Helpers em modelo.js UMD compartilhado por página e worker (import './modelo.js', globalThis.KiroFlashcards), para Node require nos testes, seguindo housepattern.
- Testes: parsing com fences/duplicatas/prefixo, identidade estável e resposta alterada, erros e acertos/datas, agenda persistida e fila.

## Revisão semanal

- id weekly-review, permissões notes:read,notes:write,tasks:read. Janela últimos7 dias corridos contando hoje, dias locais, não ISO UTC.
- Página: cabeçalho com intervalo, números discretos de notas recentes/tarefas abertas/atrasadas; duas colunas editoriais Notas da semana e Próximos passos com tarefas. Prévia Markdown legível e botão principal Salvar revisão como nota. Campos de reflexão O que avançou/O que ficou pendente/Prioridade da próxima semana, locais ao formulário até salvar.
- Read state via notes.list({limit:500}) + tasks.list; filtrar notas updatedAt dentro da janela. Tarefas done=false, distinguir atrasadas, hoje e futuras. Não inventar contagem de concluídas na semana (modelo de tarefa não tem completedAt). Exibir limite500notas e não ler/escrever outros plugins.
- Gerar Markdown com datas, links [[títulos]] e listas de tarefas sem marcar/concluir nada. Neutralizar quebras/tokens em títulos de links quando necessário para evitar Markdown inválido; preservar texto usuário como texto. Criar nova nota pela API com tag revisao-semanal; nunca atualizar/substituir nota existente. Título único por timestamp da geração (data e horário com milissegundos válidos para nome de arquivo, sem dois-pontos); impedir duplo clique. Mostrar confirmação com nome da nota após sucesso; falha retém reflexões e permite tentar de novo. Não prometer abrir a nota automaticamente porque frame API não oferece notes.open.
- Worker registra comando Gerar revisão semanal (sem reflexões) e painel Hoje resumido; lógica de montagem compartilhada modelo.js UMD importado pelo worker/página. Sem automação onDay nem permissão tasks:write.
- Testes: janela local inclusive limites, agrupamento de tarefas, Markdown/links títulos especiais, sem overwrite, falha/retry sem perda reflexões e duplo clique.

## Plano e donos

1. Subagente Sol médio: focus-pomodoro + tests/plugin-focus.test.cjs. Dono exclusivo dessa pasta/teste.
2. Subagente Sol médio: flashcards + tests/plugin-flashcards.test.cjs. Dono exclusivo dessa pasta/teste.
3. Subagente Luna médio: weekly-review + tests/plugin-weekly-review.test.cjs. Dono exclusivo dessa pasta/teste.
4. Controlador: integração de exemplos no cofre dev sem sobrescrever existentes, documentação comum, suite final, QA browser/Electron, screenshots e revisão integrada. Atualizar grafo após mudanças relevantes. Não criar commits/branches ou alterar arquivos fora do escopo. Preservar mudanças anteriores.

Cada agente usa API documentada em docs/plugins.md, exemplos kanban-tasks e habit-heatmap como referência. Sem subdelegação. Relatórios em outputs/plugins-produtividade/{id}-report.md. Unidade pronta só com teste assertivo e erro de API tratado. Ajustes de layout podem ser refinados após ver screenshots reais; sem integração remota ou dados pessoais.
