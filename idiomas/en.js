// Inglês. Chave: a frase em português exatamente como está no código (t('…') / frase('…'))
// ou no index.html. O teste tests/idiomas-cobertura.test.cjs confere que nada falta nem sobra.
(function (root) {
  const frases = {
    // index.html
    'Ir para nota (Ctrl+O)': 'Go to note (Ctrl+O)',
    'Ir para nota': 'Go to note',
    'Recolher barra lateral': 'Collapse sidebar',
    'Recolher barra lateral (Ctrl+\\)': 'Collapse sidebar (Ctrl+\\)',
    'Nova nota': 'New note',
    'Nota diária': 'Daily note',
    'Diária': 'Daily',
    'Navegação principal': 'Main navigation',
    'Hoje': 'Today',
    'Notas': 'Notes',
    'Tarefas': 'Tasks',
    'Pastas': 'Folders',
    'Grafo': 'Graph',
    'Plug-ins': 'Plugins',
    'Trocar de cofre': 'Switch vault',
    'Lixeira': 'Trash',
    'Configurações': 'Settings',
    'Carregando…': 'Loading…',
    // corretor.js
    'Sem sugestões': 'No suggestions',
    'Adicionar "{palavra}" ao dicionário': 'Add "{palavra}" to dictionary',
    // app.js — idioma
    'Não foi possível carregar o idioma': 'Could not load the language',
    'Idioma': 'Language',
    'Idioma dos menus, botões e avisos. Suas notas não mudam.': "Language of menus, buttons and messages. Your notes don't change.",
    'Idioma da interface': 'Interface language',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = frases;
  else root.KiroIdiomas.registrar('en', frases);
})(globalThis);
