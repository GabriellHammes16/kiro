const grade = document.getElementById('grade');
const dica = document.getElementById('dica');
// Data local, não UTC: toISOString() vira o dia à noite conforme o fuso do usuário.
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function desenhar(semanas) {
  const habitos = await kiro.habits.list();
  const feitos = new Map();
  for (const h of habitos) for (const dia of h.days) feitos.set(dia, (feitos.get(dia) || 0) + 1);
  const total = habitos.length || 1;
  const hoje = new Date();
  const inicio = new Date(hoje);
  // Começa num domingo: cada linha da grade é um dia da semana, e a última coluna termina hoje.
  inicio.setDate(hoje.getDate() - (semanas - 1) * 7 - hoje.getDay());
  grade.textContent = '';
  for (let d = new Date(inicio); d <= hoje; d.setDate(d.getDate() + 1)) {
    const dia = iso(d), n = feitos.get(dia) || 0;
    const celula = document.createElement('div');
    celula.className = 'dia';
    celula.dataset.n = String(n ? Math.min(3, Math.ceil((n / total) * 3)) : 0);
    celula.addEventListener('mouseenter', () => { dica.textContent = `${dia}: ${n} of ${habitos.length} habits`; });
    grade.append(celula);
  }
}

kiro.ready.then(k => {
  desenhar(k.data?.weeks || 26).catch(erro => { dica.textContent = erro.message; });
  k.onData(data => desenhar(data?.weeks || 26).catch(erro => { dica.textContent = erro.message; }));
});
