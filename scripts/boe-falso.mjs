// Servidor falso que imita boe.es para verificar el CUÁDRUPLE RESPALDO sin red.
// Modos (cámbialos con GET /modo?x=A):
//   A: solo funciona la API JSON de datos abiertos
//   B: solo funciona el XML del sumario (anidado)
//   C: solo funciona el HTML del sumario clásico
//   D: caída total (los 4 endpoints fallan)
//   E: solo funciona la página HTML del día /boe/dias/… (nuevo respaldo v2.0.0)
//   F: solo funciona el XML del sumario en variante PLANA (item hermano del epígrafe)
import http from "node:http";

let modo = "A";

const FECHA = "20261029";

const ITEMS = [
  { id: "BOE-A-2026-91001", titulo: "Resolución de 26 de octubre de 2026, de la Secretaría de Estado de Educación, por la que se convoca proceso selectivo para ingreso, por el sistema general de acceso libre, en el Cuerpo de Maestros, especialidad de Primaria" },
  { id: "BOE-A-2026-91002", titulo: "Resolución de 27 de octubre de 2026, de la Subsecretaría, por la que se convoca proceso selectivo para ingreso, por el sistema general de acceso libre y promoción interna, en el Cuerpo de Gestión Administrativa de la Administración Civil del Estado" },
  { id: "BOE-A-2026-91003", titulo: "Resolución de 28 de octubre de 2026, de la Subsecretaría, por la que se nombra tribunal de las pruebas selectivas para ingreso en el Cuerpo de Ingenieros Técnicos de Arsenales de la Armada" },
];

const jsonSumario = {
  data: {
    sumario: {
      meta: { fecha_publicacion: FECHA },
      diario: [
        {
          seccion: [
            {
              codigo: "2",
              nombre: "II. AUTORIDADES Y PERSONAL",
              departamento: ITEMS.map((it) => ({
                nombre: "MINISTERIO DE DEFENSA",
                epigrafe: [{ codigo: "B", nombre: "B. OPOSICIONES Y CONCURSOS", item: [{ identificador: it.id, titulo: it.titulo, url_pdf: `/boe/dias/${FECHA}/pdfs/${it.id}.pdf`, url_html: `/buscar/doc.php?id=${it.id}` }] }],
              })),
            },
          ],
        },
      ],
    },
  },
};

const xmlSumario = `<?xml version="1.0" encoding="ISO-8859-1"?>
<sumario>
  <meta>
    <fecha_publicacion>${FECHA}</fecha_publicacion>
  </meta>
  <diario numero="200" fecha="${FECHA}">
    <seccion nombre="II. AUTORIDADES Y PERSONAL">
      <departamento nombre="MINISTERIO DE DEFENSA">
        <epigrafe codigo="B" nombre="B. OPOSICIONES Y CONCURSOS">
${ITEMS.map(
  (it) => `          <item>
            <identificador>${it.id}</identificador>
            <titulo>${it.titulo}</titulo>
            <url_pdf>/boe/dias/${FECHA}/pdfs/${it.id}.pdf</url_pdf>
            <url_html>/buscar/doc.php?id=${it.id}</url_html>
          </item>`
).join("\n")}
        </epigrafe>
      </departamento>
    </seccion>
  </diario>
</sumario>`;

// Variante plana: los item van como hermanos del epígrafe (sin anidar).
const xmlPlano = `<?xml version="1.0" encoding="ISO-8859-1"?>
<sumario>
  <diario numero="200" fecha="${FECHA}">
    <departamento>MINISTERIO DE DEFENSA</departamento>
    <epigrafe codigo="B" nombre="B. OPOSICIONES Y CONCURSOS" />
${ITEMS.map(
  (it) => `    <item>
      <identificador>${it.id}</identificador>
      <titulo>${it.titulo}</titulo>
      <url_pdf>/boe/dias/${FECHA}/pdfs/${it.id}.pdf</url_pdf>
      <url_html>/buscar/doc.php?id=${it.id}</url_html>
    </item>`
).join("\n")}
  </diario>
</sumario>`;

const xmlDocumento = (id) => `<?xml version="1.0" encoding="ISO-8859-1"?>
<documento id="${id}">
  <analisis>
    <ambito>Estatal</ambito>
  </analisis>
</documento>`;

const htmlSumario = `<html><body><h1>Sumario del BOE</h1>
<h2>II. AUTORIDADES Y PERSONAL</h2>
<h3>B. OPOSICIONES Y CONCURSOS</h3>
<ul>
${ITEMS.map((it) => `  <li><a href="/diario_boe/txt.php?id=${it.id}">${it.titulo}</a> [PDF]</li>`).join("\n")}
</ul>
<h2>III. OTRAS DISPOSICIONES</h2>
</body></html>`;

// Página clásica del día (formato /boe/dias/2026/10/29/), con enlaces txt y PDF.
const htmlDias = `<html><head><title>BOE de ${FECHA}</title></head><body>
<h1>BOE núm. 262, de ${FECHA}</h1>
<h2><a name="seccionII">II. AUTORIDADES Y PERSONAL</a></h2>
<h3>B. OPOSICIONES Y CONCURSOS</h3>
<ul>
${ITEMS.map(
  (it) => `  <li><a href="/diario_boe/txt.php?id=${it.id}">${it.titulo}</a>
    <a href="/boe/dias/2026/10/29/pdfs/${it.id}.pdf">PDF</a></li>`
).join("\n")}
</ul>
<h2>III. OTRAS DISPOSICIONES</h2>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/modo")) {
    const m = new URL(url, "http://x").searchParams.get("x");
    if (m && ["A", "B", "C", "D", "E", "F"].includes(m)) modo = m;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`modo=${modo}`);
    return;
  }
  console.log(`[boe-falso] ${req.method} ${url} (modo ${modo})`);

  const caido = () => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("BOE falso: endpoint caído");
  };

  if (url.startsWith("/datosabiertos/api/boe/sumario/")) {
    if (modo !== "A") return caido();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(jsonSumario));
  }
  if (url.startsWith("/diario_boe/xml.php")) {
    const id = new URL(url, "http://x").searchParams.get("id") || "";
    if (!id.startsWith("BOE-S-")) {
      // documento individual (enriquecimiento)
      if (modo === "D") return caido();
      res.writeHead(200, { "Content-Type": "application/xml" });
      return res.end(xmlDocumento(id));
    }
    if (modo !== "B" && modo !== "F") return caido();
    res.writeHead(200, { "Content-Type": "application/xml" });
    return res.end(modo === "F" ? xmlPlano : xmlSumario);
  }
  if (url.startsWith("/diario_boe/sumario.php")) {
    if (modo !== "C") return caido();
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(htmlSumario);
  }
  if (/^\/boe\/dias\/\d{4}\/\d{2}\/\d{2}\/$/.test(url)) {
    if (modo !== "E") return caido();
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(htmlDias);
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("no encontrado");
});

const PUERTO = process.env.PUERTO_BOE_FALSO || 4100;
server.listen(PUERTO, "127.0.0.1", () => console.log(`boe falso en 127.0.0.1:${PUERTO}`));
