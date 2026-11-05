# Como criar um tema ou uma skin do Kiro

Este é o padrão que todo tema e toda skin seguem. Ele é conferido por `tests/temas.test.cjs`: se um tema sair da regra, o teste diz o que falta.

**A regra:** o tema escolhe cores, a skin escolhe forma, e os componentes e plug-ins só usam as variáveis. Um tema nunca tem regra para um componente específico, então uma tela ou um plug-in novo já nasce funcionando em todos os temas.

| | Decide | Não pode |
|---|---|---|
| **Tema** | Cores | Mudar forma, espaço ou fonte |
| **Skin** | Cantos, espaço, sombra, altura e fonte | Declarar cores |
| **Componente** (`styles.css`) | Onde cada variável é usada | Usar uma cor fixa de tema |
| **Plug-in** | O próprio conteúdo, com as variáveis | Depender de um tema específico |

## Criar um tema

São três passos, e só o primeiro exige escolher cores.

**1. Declare as cores em `temas.css`.** Quatro variáveis bastam:

```css
.tema-aurora {
  --bg:#101820;           /* fundo */
  --ink:#F2F4F7;          /* texto */
  --acento:#7DD3C0;       /* cor de destaque */
  --acento-texto:#06201A; /* texto sobre o destaque */
}
```

Se o fundo for claro, inclua o id também no grupo `:is(.tema-grafite, ...)` de `temas.css`. Esse grupo define `color-scheme:light` e deixa a sombra e o véu das janelas mais leves.

**2. Registre o tema em `TEMAS`, em `domain.js`:**

```js
['aurora', 'Aurora', 'classicos'], // id, nome, grupo: 'classicos' ou 'anime'
```

Use `frase('Aurora')` se o nome precisar de tradução, e adicione a tradução em `idiomas/en.js`.

**3. Desenhe o ícone em `TRACOS`, em `app.js`:**

```js
'tema-aurora': '<path d="..."/>',
```

Depois, rode:

```
node --test tests/temas.test.cjs
```

## Variáveis de cor

**Obrigatórias:** `--bg`, `--ink`, `--acento`, `--acento-texto`.

**Opcionais:** saem das obrigatórias pelo bloco de derivação no começo de `temas.css`. Declare uma só para ajustar o resultado.

| Variável | Para que serve | Sem declarar, vira |
|---|---|---|
| `--content-bg` | Fundo da área principal | `--bg` |
| `--panel` | Cartões e painéis | `--bg` com 6% de `--ink` |
| `--panel-raised` | Menus, janelas e listas abertas | `--bg` com 10% de `--ink` |
| `--sidebar-bg` | Barra lateral | `--bg` com 3% de `--ink` |
| `--campo` | Campos de texto | `--bg` com 3% de `--ink` |
| `--muted` | Texto secundário | `--ink` a 70%, sobre `--bg` |
| `--line` | Bordas | `--ink` a 18%, sobre `--bg` |
| `--acento-2` | Segunda cor de destaque | `--muted` |
| `--acento-forte` | Botão principal | `--acento` |
| `--acento-escuro` | Botão principal em foco ou clicado | `--acento` a 88%, sobre `--bg` |
| `--primario-texto` | Texto do botão principal | `--acento-texto` |

Estas também podem ser ajustadas, e já têm valor em `:root` (`styles.css`):

| Variável | Para que serve |
|---|---|
| `--overlay` | Véu atrás das janelas |
| `--overlay-desfoque` | Desfoque atrás das janelas (por padrão, nenhum) |
| `--shadow-sm`, `--shadow-md` | Sombra do que flutua |
| `--raio-caixa` | Cantos das caixas de seleção |

Um tema também pode ajustar `--accent-text`, `--danger`, `--warning`, `--success` e `--info`. Os valores padrão já misturam com `--ink`, então costumam funcionar em qualquer fundo.

**Contraste:** o teste exige pelo menos 4.5:1 entre texto e fundo em todo tema, incluindo as cores derivadas. Quando falhar, ele diz qual par ajustar.

## Criar uma skin

**1. Declare o que muda em `temas.css`:**

```css
.skin-arejada { --esp-5:28px; --raio-card:28px; }
```

**2. Registre em `SKINS`, em `domain.js`:**

```js
['arejada', 'Arejada', 'Mais espaço e cantos bem redondos.'],
```

| Pode mudar | Variáveis |
|---|---|
| Cantos | `--raio-controle`, `--raio-card`, `--raio-pilula`, `--raio-caixa` |
| Espaço | `--esp-1` a `--esp-7` |
| Altura de controles | `--alt-p`, `--alt-m`, `--alt-g` |
| Sombra | `--shadow` |
| Fonte | `--fonte-interface`, `--fonte-leitura` |

Uma skin pode ler as cores do tema, por exemplo em `color-mix(in srgb, var(--acento) 22%, var(--line))`, mas não pode declará-las.

## Regras para componentes

- Use as variáveis para cor, borda, canto e sombra.
- Painel fixo: `--panel`. O que flutua sobre o conteúdo: `--panel-raised`. Campo: `--campo`.
- Não escreva regra para um tema específico, como `.tema-aurora .card`. Se um tema precisa de algo que não existe, crie uma variável com um valor padrão.
- Listas e caixas de seleção já seguem o tema sem classe própria.

## Plug-ins

O guia completo é o [`docs/plugins.md`](plugins.md). Para o plug-in seguir qualquer tema e skin:

- **Painéis declarativos** já são desenhados com o tema.
- **Molduras** (página própria) recebem as variáveis acima, e o Kiro as atualiza quando o tema muda. Escreva `color: var(--ink)`, e não uma cor fixa. A lista completa está em `VARIAVEIS_DO_TEMA`, em `plugins.js`.
- Dentro da moldura, uma cor de reserva só serve para quando a variável não existir: `var(--panel, #1b222a)`.
- O CSS do Kiro não entra na moldura, então `<select>` e caixas de seleção de lá precisam de estilo próprio.

Use `examples/plugins/` como ponto de partida.

## A exceção: Liquid Glass

O Liquid Glass é o único tema com regras próprias (`html.tema-liquid-glass`), porque é um material, com desfoque, reflexo e janela transparente, e não só uma paleta. O teste não aceita essa exceção em outro tema.

No estilo Original no Windows, o vidro segue o brilho do que está atrás dele: sobre fundo claro, a classe `.vidro-claro` troca as variáveis para vidro claro com texto escuro. O brilho vem de uma miniatura da tela lida em `electron/main.cjs`, e os limites foram medidos com o controle de transparência no padrão.

Se surgir um segundo tema com material próprio, o certo é transformar essas regras em variáveis, em vez de copiá-las.
