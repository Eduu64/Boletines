// Datos de ejemplo realistas (modo demo) para verificar el pipeline completo
// sin depender de que boe.es esté operativo. Incluye personal laboral
// (Ayuntamiento de Madrid ITOP fijo y ADIF obra civil temporal) para poder
// probar esa búsqueda end-to-end sin red. Igual que la v1.2.0.

const DIA_A = [
  ["BOE-A-2026-14001", "Resolución de 26 de octubre de 2026, de la Secretaría de Estado de Educación, por la que se convoca proceso selectivo para ingreso, por el sistema general de acceso libre, en el Cuerpo de Maestros, especialidad de Primaria", null],
  ["BOE-A-2026-14002", "Resolución de 27 de octubre de 2026, de la Subsecretaría, por la que se convoca proceso selectivo para ingreso, por el sistema general de acceso libre y promoción interna, en el Cuerpo de Gestión Administrativa de la Administración Civil del Estado", null],
  ["BOE-A-2026-14003", "Resolución de 28 de octubre de 2026, de la Secretaría General, por la que se publica la relación de aspirantes aprobados en las pruebas selectivas para ingreso en el Cuerpo de Auxiliares Administrativos del Estado", null],
  ["BOE-A-2026-14004", "Resolución de 27 de octubre de 2026, de la Dirección General de la Policía, por la que se convoca proceso selectivo para ingreso en la Escala Básica de Policía Nacional, turno libre", null],
  ["BOE-A-2026-14005", "Corrección de errores de la Resolución de 12 de septiembre de 2026, de la Subsecretaría, por la que se convoca proceso selectivo para ingreso en el Cuerpo Superior de Sistemas y Tecnologías de la Información de la Administración del Estado", null],
  ["BOE-A-2026-14101", "Resolución de 26 de octubre de 2026, de la Sociedad Estatal Correos y Telégrafos, S.A., por la que se convoca proceso selectivo para ingreso como personal laboral fijo, categoría de Repartidor de correo", null],
  ["BOE-A-2026-14102", "Resolución de 27 de octubre de 2026, del Servicio Público de Empleo Estatal, por la que se publica la lista de admitidos y excluidos de las pruebas selectivas de la categoría de Auxiliar Administrativo", null],
  ["BOE-A-2026-14103", "Resolución de 28 de octubre de 2026, de la Universidad de Valencia, por la que se convoca concurso de méritos para la contratación de personal docente e investigador", null],
  ["BOE-A-2026-14104", "Resolución de 28 de octubre de 2026, de la Secretaría de Estado de Función Pública, por la que se convoca proceso selectivo para ingreso, por el sistema de acceso libre, en el Cuerpo de Gestión de Sistemas e Informática de la Administración del Estado", null],
  ["BOE-A-2026-14201", "Resolución de 27 de octubre de 2026, del Ayuntamiento de Toledo, por la que se convoca proceso selectivo para ingreso, por el sistema de acceso libre, en la escala de Administración Especial, subescala Técnica", null],
  ["BOE-A-2026-14202", "Resolución de 28 de octubre de 2026, de la Diputación Provincial de Sevilla, por la que se publica la relación de aspirantes aprobados del proceso selectivo de la escala de Administración General", null],
  ["BOE-A-2026-14203", "Resolución 452/38202/2026, de 15 de abril, de la Subsecretaría, por la que se convocan procesos de selección para ingreso en los centros docentes militares de formación, mediante las formas de ingreso directo y promoción, para la incorporación como militar de carrera o la adscripción como militar de complemento a las escalas de oficiales y escalas técnicas de los Cuerpos de Ingenieros.", "MINISTERIO DE DEFENSA"],
  ["BOE-A-2026-14204", "Resolución de 28 de octubre de 2026, de la Subsecretaría, por la que se nombra tribunal de las pruebas selectivas para ingreso en el Cuerpo de Ingenieros Técnicos de Arsenales de la Armada", "MINISTERIO DE DEFENSA"],
];

const DIA_B = [
  ["BOE-A-2026-15001", "Resolución de 29 de octubre de 2026, de la Subsecretaría, por la que se convoca proceso selectivo para ingreso, por el sistema general de acceso libre, en el Cuerpo de Ayudantes de Archivos y Bibliotecas", null],
  ["BOE-A-2026-15002", "Resolución de 29 de octubre de 2026, de la Secretaría de Estado de Educación, por la que se convoca proceso selectivo para ingreso en el Cuerpo de Profesores de Enseñanza Secundaria, especialidad de Matemáticas", null],
  ["BOE-A-2026-15003", "Resolución de 29 de octubre de 2026, del Servicio Público de Empleo Estatal, por la que se publican las notas de corte de las pruebas selectivas de la categoría de Gestión de Sistemas", null],
  ["BOE-A-2026-15004", "Resolución de 29 de octubre de 2026, conjunta de la Subsecretaría y del Ayuntamiento de Madrid, por la que se convoca proceso selectivo para ingreso, por el sistema de acceso libre, en la escala de Administración Especial, plaza de Técnico/a Superior TIC (Tecnologías de la Información y la Comunicación)", "AYUNTAMIENTO DE MADRID"],
  ["BOE-A-2026-15005", "Corrección de errores de la Resolución 452/38202/2026, de 15 de abril, de la Subsecretaría, por la que se convocan procesos de selección para ingreso en los centros docentes militares de formación", "MINISTERIO DE DEFENSA"],
  ["BOE-A-2026-15006", "Resolución de 29 de octubre de 2026, del Ayuntamiento de Madrid, por la que se convoca proceso selectivo para el acceso a la condición de personal laboral fijo, en la categoría de Ingeniero Técnico de Obras Públicas e Instalaciones, turno libre", "AYUNTAMIENTO DE MADRID"],
  ["BOE-A-2026-15007", "Resolución de 29 de octubre de 2026, de la entidad pública empresarial ADIF, por la que se convoca proceso selectivo para la contratación de personal laboral temporal, puesto de Ingeniero/a de Obra Civil en la Dirección de Construcción e Ingeniería de Infraestructuras", "MINISTERIO DE TRANSPORTES Y MOVILIDAD SOSTENIBLE"],
];

function itemsDe(fecha) {
  const dia = fecha >= "20261030" ? DIA_B : DIA_A;
  return dia.map(([identificador, titulo, dep], i) => ({
    identificador,
    titulo,
    departamento:
      dep ??
      (i % 3 === 0
        ? "MINISTERIO DE EDUCACIÓN, FORMACIÓN PROFESIONAL Y DEPORTES"
        : i % 3 === 1
          ? "MINISTERIO PARA LA TRANSFORMACIÓN DIGITAL Y DE LA FUNCIÓN PÚBLICA"
          : "MINISTERIO DEL INTERIOR"),
    url_pdf: `/boe/dias/${fecha.slice(0, 4)}/${fecha.slice(4, 6)}/${fecha.slice(6, 8)}/pdfs/${identificador}.pdf`,
    url_html: `/buscar/doc.php?id=${identificador}`,
  }));
}

/** Items demo ya aplanados y con su departamento. */
export function itemsDemo(fecha) {
  return itemsDe(fecha);
}

/** Ámbito demo de un documento concreto (simula el XML individual). */
const AMBITO_DEMO = {
  "BOE-A-2026-14001": "Estatal",
  "BOE-A-2026-14002": "Estatal",
  "BOE-A-2026-14003": "Estatal",
  "BOE-A-2026-14004": "Estatal",
  "BOE-A-2026-14005": "Estatal",
  "BOE-A-2026-14101": "Estatal",
  "BOE-A-2026-14102": "Estatal",
  "BOE-A-2026-14103": "Comunidad Autónoma de Valencia",
  "BOE-A-2026-14104": "Estatal",
  "BOE-A-2026-14201": "Municipios de Castilla-La Mancha",
  "BOE-A-2026-14202": "Provincia de Sevilla",
  "BOE-A-2026-14203": "Estatal",
  "BOE-A-2026-14204": "Estatal",
  "BOE-A-2026-15001": "Estatal",
  "BOE-A-2026-15002": "Estatal",
  "BOE-A-2026-15003": "Estatal",
  "BOE-A-2026-15004": "Estatal",
  "BOE-A-2026-15005": "Estatal",
  "BOE-A-2026-15006": "Municipio de Madrid",
  "BOE-A-2026-15007": "Estatal",
};

export function ambitoDemo(identificador) {
  return AMBITO_DEMO[identificador] ?? null;
}
