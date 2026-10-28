# Backup e espelho automáticos

O Kiro inclui um recurso nativo de **Backup e espelho** em **Configurações → Backup** que pode ser ligado ou desligado a qualquer momento. Ele grava seus dados em uma pasta escolhida no computador — normalmente a pasta do **Google Drive para Desktop** (`G:\Meu Drive`), OneDrive ou Dropbox, que cuidam do envio para a nuvem em segundo plano.

## Como funciona

Dentro da pasta de destino escolhida, o Kiro cria uma subpasta para o cofre atual:

```
<destino>/Kiro/<nome-do-cofre>/
  .kiro-backup              ← marca de segurança: o Kiro só altera pastas com este arquivo
  espelho/                  ← cópia viva das notas (.md) e Anexos/
  copias/
    horas/    kiro-YYYY-MM-DD_HHMM.zip
    diaria/   kiro-YYYY-MM-DD.zip
    semanal/  kiro-YYYY-MM-DD.zip
    mensal/   kiro-YYYY-MM.zip
    manual/   kiro-YYYY-MM-DD_HHMMSS.zip
```

### 1. Espelho contínuo (`espelho/`)
- Atualiza logo após cada salvamento (com uma espera de 30 segundos para agrupar edições seguidas).
- Copia apenas os arquivos `.md` e a pasta de anexos que mudaram, e remove do espelho as notas excluídas do cofre.
- Mantém os arquivos abertos e legíveis no Google Drive, prontos para leitura no celular ou para servir de fonte no **Google NotebookLM**.
- **Proteção contra cofre vazio:** se o cofre aparecer sem nenhum arquivo (por exemplo, disco desconectado), o espelho não apaga a cópia existente.

### 2. Cópias datadas (`copias/`)
- Um espelho sozinho não protege contra exclusões acidentais. Por isso o Kiro também gera arquivos `.zip` completos do cofre (notas, anexos, `caderno.json` com tarefas e hábitos, e dados de plug-ins).
- Você escolhe quais frequências ligar e quantas cópias manter em cada uma:
  - **Por horas:** a cada 1–24 horas (mantém 1–48 cópias)
  - **Diária:** uma por dia (mantém 1–60 cópias, padrão 7)
  - **Semanal:** uma por semana a partir do dia escolhido (mantém 1–52 cópias, padrão 4)
  - **Mensal:** uma por mês (mantém 1–36 cópias, padrão 12)
- As cópias além do limite são removidas automaticamente após cada novo `.zip` terminar de ser gravado.

## Onde fica a configuração

A configuração e os horários das últimas cópias ficam salvos **fora do cofre**, em `backup.json` na pasta de dados do Kiro neste computador (indexado pelo caminho do cofre), pois cada computador tem seu próprio caminho para o Google Drive.

## Como restaurar uma cópia `.zip`

1. Feche o Kiro (ou troque para outro cofre).
2. Faça uma cópia da pasta atual do cofre, caso queira preservar alguma nota recente.
3. Extraia o arquivo `.zip` desejado de `copias/<frequencia>/` em uma pasta vazia.
4. No Kiro, abra **Configurações → Sistema → Escolher outro cofre** e selecione a pasta extraída.
