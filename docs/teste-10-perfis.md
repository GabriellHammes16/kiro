# Dez perfis: percursos e feedbacks simulados

## Resultado verificado

**10 de 10 percursos automatizados passaram** no Electron, com perfil e cofre fictícios.
Foi testado o código da retomada do plano, após o bloco A e os plugins C. O
`package.json` ainda indicava 0.23.1; isso não significa que o instalador 0.23.1
antigo contenha essas alterações.

Evidência: [resultado da execução](../outputs/sidebar-design/perfis-result.json).
As capturas da execução aprovada ficam no diretório indicado no campo `run` desse JSON.

## Tarefa e retorno de cada perfil

Os retornos abaixo são **feedbacks fictícios**, formulados a partir das tarefas e
da interface. Não foram coletados de pessoas ou de dez agentes independentes.
São hipóteses para validar em pesquisa, não depoimentos nem medidas de satisfação.

| Perfil | O que a automação verificou | Feedback simulado |
|---|---|---|
| 1. Iniciante | Criar nota, exigir título e salvar texto | “Consegui registrar uma ideia. Gostaria de encontrar a ação de salvar sem conhecer o teclado.” |
| 2. Pessoa com TDAH | Escolher tarefa, iniciar foco, sair, voltar e pausar; relatório disponível | “Uma tarefa por vez ajuda. Gostaria de enxergar que o cronômetro está ativo enquanto estou em outra tela.” |
| 3. Estudante | Revelar resposta, avançar flashcard; abrir slides, avançar e sair com Esc | “Revisar e apresentar a mesma base é útil. Um exemplo pronto de pergunta e resposta facilitaria começar.” |
| 4. Pesquisador | Buscar uma palavra no corpo e abrir a nota correta | “A busca encontra o conteúdo. Um pequeno trecho nos resultados ajudaria a escolher entre notas parecidas.” |
| 5. Escritor | Usar modelo pessoal, expandir título e salvar sem copiar a tag modelo | “Reutilizar uma estrutura funciona. Gostaria de descobrir os modelos nos primeiros passos.” |
| 6. Freelancer | Criar tarefa para amanhã, vinculada a uma nota, e persistir | “A ligação entre tarefa e contexto é útil. Quero enxergar o mês para planejar as entregas.” |
| 7. Gestor | Consultar indicadores semanais e salvar a reflexão como nova nota | “O fechamento da semana reúne o necessário. Gostaria de saber claramente quando minhas respostas já estão guardadas.” |
| 8. Usuário de diário | Criar, salvar e reabrir a mesma diária sem duplicar | “O registro diário é direto. Uma explicação breve do ícone de calendário facilitaria a primeira utilização.” |
| 9. Usuário avançado | Ctrl+K no editor, busca, Enter e Esc sem alterar o texto | “O menu de ações mantém o ritmo. Quero continuar usando o teclado sem precisar de mais botões na barra lateral.” |
| 10. Pessoa com baixa visão | Zoom 200%, nomes dos controles, foco visível e ações sem corte horizontal | “A interface continua utilizável ampliada. Quero encontrar facilmente os ajustes de tamanho e contraste.” |

## Como interpretar

- Os testes usam seletores conhecidos e, em alguns passos, funções internas do app.
  Portanto não medem se uma pessoa descobriria os comandos sozinha.
- Os perfis compartilham uma execução com dados fictícios. Não representam dez
  instalações independentes nem toda a diversidade de cada público.
- O percurso de baixa visão não substitui testes com leitor de tela e pessoas
  que usam tecnologia assistiva. Os testes de contraste do bloco A são separados.
- A rodada inicial parou no freelancer por uma expressão incorreta na automação;
  o teste foi corrigido e o percurso passou. Não foi classificado como bug do app.
- As sugestões que coincidem com o plano continuam nas fases correspondentes,
  como calendário e primeiros passos. As demais ficam como hipóteses, sem ampliar
  automaticamente o escopo da implementação.

Não foram medidos tempo de tarefa, taxa de descoberta, satisfação ou benefício clínico.
