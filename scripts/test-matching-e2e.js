/* Prueba E2E del matching: títulos reales simulados contra las 4 alertas semilla (incluida PERSONAL LABORAL) */

// Replicamos la lógica de matching.ts (misma normalización) para probar offline
const norm = (t) => (t ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9ñ\s]/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

const alertas = [
  { nombre: 'Defensa · Centros docentes militares (Cuerpos de Ingenieros)', kws: ['centros docentes militares', 'Cuerpos de Ingenieros', '452/38202/2026', '45238202', 'ingreso directo y promoción'] },
  { nombre: 'Armada · Ingenieros Técnicos de Arsenales', kws: ['Arsenales de la Armada', 'Ingenieros Técnicos de Arsenales', 'Cuerpo de Ingenieros Técnicos de Arsenales', 'Cuerpo Ingenieros Técnicos de Arsenales de la Armada'] },
  { nombre: 'Ayuntamiento de Madrid · Técnico/a Superior TIC', kws: ['Tecnologías de la Información y la Comunicación', 'Superior TIC', 'Técnico/a Superior TIC', 'Ayuntamiento de Madrid'] },
  { nombre: 'Empleo público · Personal laboral e Ingeniería de obra', kws: ['personal laboral', 'ingeniero de obras', 'ingeniero de obra', 'ingeniero técnico de obras públicas', 'ingeniero técnico de obras públicas e instalaciones', 'ingeniería de obra', 'obra civil', 'ingeniero de caminos'] },
];

// Los 3 títulos reales tal como aparecerían en el BOE/BOCM
const titulos = [
  {
    etiqueta: 'BOE · Defensa (452/38202/2026)',
    texto: 'Resolución 452/38202/2026, de 15 de abril, de la Subsecretaría, por la que se convocan procesos de selección para ingreso en los centros docentes militares de formación, mediante las formas de ingreso directo y promoción, para la incorporación como militar de carrera o la adscripción como militar de complemento a las escalas de oficiales y escalas técnicas de los Cuerpos de Ingenieros',
  },
  {
    etiqueta: 'BOE · Armada (Arsenales)',
    texto: 'Resolución de la Subsecretaría por la que se convoca el proceso de selección para el ingreso en el Cuerpo Ingenieros Técnicos de Arsenales de la Armada',
  },
  {
    etiqueta: 'BOCM · Ayuntamiento de Madrid (TIC)',
    texto: 'Resolución de la Dirección General de Recursos Humanos por la que se convoca el proceso de selección para el acceso a la condición de personal laboral fijo en la categoría de Técnico/a Superior TIC, Tecnologías de la Información y la Comunicación del Ayuntamiento de Madrid',
  },
  {
    etiqueta: 'BOE · Ayuntamiento de Madrid (personal laboral, Ingeniero Técnico OP e Instalaciones)',
    texto: 'Resolución de 29 de octubre de 2026, del Ayuntamiento de Madrid, por la que se convoca proceso selectivo para el acceso a la condición de personal laboral fijo, en la categoría de Ingeniero Técnico de Obras Públicas e Instalaciones, turno libre',
  },
  {
    etiqueta: 'BOE · ADIF (personal laboral temporal, Ingeniero de Obra Civil)',
    texto: 'Resolución de 29 de octubre de 2026, de la entidad pública empresarial ADIF, por la que se convoca proceso selectivo para la contratación de personal laboral temporal, puesto de Ingeniero/a de Obra Civil en la Dirección de Construcción e Ingeniería de Infraestructuras',
  },
  {
    etiqueta: 'BOCM · Ayuntamiento (Ofertas de empleo, personal laboral)',
    texto: '– Móstoles. Ofertas de empleo. Bases para la selección de personal laboral fijo, categoría Ingeniero Técnico de Obras Públicas e Instalaciones, del Ayuntamiento de Móstoles',
  },
  {
    etiqueta: 'BOCYL · Bolsa de empleo temporal (personal laboral)',
    texto: 'ORDEN PRE/1108/2026, de 23 de octubre, por la que se convoca la constitución de la bolsa de empleo temporal del personal laboral del Cuerpo de Ayudantes Facultativos (Inspectores de Campo) de la Administración de la Comunidad de Castilla y León',
  },
];

let fallos = 0;
for (const t of titulos) {
  const texto = norm(t.texto);
  const coincidencias = [];
  for (const a of alertas) {
    for (const k of a.kws) {
      if (texto.includes(norm(k))) { coincidencias.push(`${a.nombre} ← «${k}»`); break; }
    }
  }
  if (coincidencias.length === 0) fallos++;
  console.log(`\n▶ ${t.etiqueta}`);
  console.log('  Normalizado:', texto.slice(0, 90) + '…');
  coincidencias.forEach(c => console.log('  ✓ MATCH:', c));
  if (coincidencias.length === 0) console.log('  ✗ SIN MATCH');
}
console.log(fallos === 0 ? '\n== RESULTADO: los 7 títulos coinciden con sus alertas ✓' : `\n== RESULTADO: ${fallos} título(s) sin match ✗`);
process.exit(fallos === 0 ? 0 : 1);
