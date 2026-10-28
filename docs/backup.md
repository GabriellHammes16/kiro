# Backup e espelho automáticos

O Kiro inclui um recurso nativo de **Backup e espelho** em **Configurações → Backup** que pode ser ligado ou desligado a qualquer momento. Ele oferece **duas formas de destino**, para quem tem e para quem não tem o Google Drive instalado no computador:

1. **Pasta no PC:** grava em qualquer pasta local ou sincronizada (como a unidade `G:\Meu Drive` do **Google Drive para Desktop**, OneDrive, Dropbox ou um HD externo).
2. **Google Drive (nuvem):** envia direto para a sua conta do Google Drive pela internet (usando OAuth 2.0 + API oficial do Google Drive), **sem precisar instalar nenhum programa do Google no PC**.

## Estrutura criada (na pasta ou na nuvem)

Em ambos os modos, o Kiro organiza os arquivos dentro de `Kiro/<nome-do-cofre>/`:

```
Kiro/<nome-do-cofre>/
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
- Envia apenas os arquivos `.md` e a pasta de anexos que mudaram, e remove do espelho as notas excluídas do cofre.
- Mantém os arquivos abertos e legíveis no Google Drive, prontos para leitura no celular ou para servir de fonte no **Google NotebookLM**.
- **Proteção contra cofre vazio:** se o cofre aparecer sem nenhum arquivo, o espelho não apaga a cópia existente.

### 2. Cópias datadas (`copias/`)
- Gera arquivos `.zip` completos do cofre (notas, anexos, `caderno.json` com tarefas e hábitos, e dados de plug-ins).
- Você escolhe quais frequências ligar e quantas cópias manter em cada uma:
  - **Por horas:** a cada 1–24 horas (mantém 1–48 cópias)
  - **Diária:** uma por dia (mantém 1–60 cópias, padrão 7)
  - **Semanal:** uma por semana a partir do dia escolhido (mantém 1–52 cópias, padrão 4)
  - **Mensal:** uma por mês (mantém 1–36 cópias, padrão 12)
- As cópias além do limite são removidas automaticamente após cada novo `.zip` terminar de ser gravado.

## Como conectar no modo Google Drive (nuvem, sem app no PC)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/), crie ou selecione um projeto e ative a **Google Drive API**.
2. Em **Tela de permissão OAuth** (*OAuth consent screen*), adicione seu próprio e-mail em **Usuários de teste** (*Test users*).
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha o tipo **App para computador** (*Desktop app*).
4. No Kiro, abra **Configurações → Backup**, selecione **Google Drive (nuvem)**, cole o **Client ID** e o **Client Secret** e clique em **Conectar ao Google Drive**.
5. Autorize no navegador que vai se abrir. O Kiro usa o escopo restrito `drive.file`, ou seja, só enxerga a pasta que ele mesmo criar no seu Drive, e guarda a chave de sessão cifrada pelo sistema operacional (`safeStorage`).

## Como restaurar uma cópia `.zip`

1. Baixe o arquivo `.zip` desejado de `copias/<frequencia>/` e extraia em uma pasta vazia.
2. No Kiro, abra **Configurações → Sistema → Escolher outro cofre** e selecione a pasta extraída.
