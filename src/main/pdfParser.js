'use strict';

/**
 * Lector de PDF de listas de materiales.
 *
 * Se divide en dos partes:
 *  - parsePdfText(texto): logica PURA que analiza texto y detecta materiales.
 *    (No depende de librerias externas, por eso se puede probar facilmente.)
 *  - parsePdfFile(ruta): usa "pdf-parse" para extraer el texto del PDF y luego
 *    llama a parsePdfText.
 *
 * La deteccion es heuristica: intenta reconocer cantidad, unidad, codigo y
 * descripcion en cada linea. Se puede afinar segun el formato real de los
 * documentos de FVICOM (ver README, seccion "Afinar la lectura de PDF").
 */

// Unidades reconocidas -> forma normalizada mostrada en la app.
const UNIDADES = {
  un: 'unidad', und: 'unidad', unid: 'unidad', unidad: 'unidad', unidades: 'unidad',
  u: 'unidad', pza: 'unidad', pzas: 'unidad', pieza: 'unidad', piezas: 'unidad',
  ea: 'unidad', c: 'unidad',
  m: 'metro', mt: 'metro', mts: 'metro', metro: 'metro', metros: 'metro', ml: 'metro',
  km: 'kilometro', kms: 'kilometro',
  cm: 'centimetro',
  kg: 'kilogramo', kgs: 'kilogramo', kilo: 'kilogramo', kilos: 'kilogramo',
  g: 'gramo', gr: 'gramo', grs: 'gramo',
  lt: 'litro', lts: 'litro', l: 'litro', litro: 'litro', litros: 'litro',
  gal: 'galon', galon: 'galon', galones: 'galon',
  bulto: 'bulto', bultos: 'bulto',
  rollo: 'rollo', rollos: 'rollo',
  caja: 'caja', cajas: 'caja',
  paquete: 'paquete', paquetes: 'paquete', paq: 'paquete',
  bolsa: 'bolsa', bolsas: 'bolsa',
  tramo: 'tramo', tramos: 'tramo',
  juego: 'juego', juegos: 'juego', jgo: 'juego',
  par: 'par', pares: 'par'
};

// Palabras que suelen ser encabezados o pies de pagina (se ignoran).
const IGNORAR = [
  'item', 'items', 'cantidad', 'cant', 'descripcion', 'descripción', 'unidad',
  'codigo', 'código', 'total', 'subtotal', 'pagina', 'página', 'page',
  'lista de materiales', 'material', 'materiales', 'no.', 'n°', 'nro',
  'precio', 'valor', 'observaciones'
];

/**
 * Normaliza una unidad de medida a su forma estandar.
 * Devuelve null si no se reconoce.
 */
function normalizarUnidad(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/\.$/, '').trim();
  return UNIDADES[key] || null;
}

/**
 * Quita acentos y pasa a minusculas (para comparar).
 */
function sinAcentos(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Intenta convertir un texto numerico "1.250,50" o "1,250.50" o "500" a numero.
 */
function aNumero(txt) {
  if (txt == null) return null;
  let s = String(txt).trim();
  if (!s) return null;
  // Si tiene coma y punto, asumir que el ultimo separador es el decimal.
  const tienePunto = s.indexOf('.') >= 0;
  const tieneComa = s.indexOf(',') >= 0;
  if (tienePunto && tieneComa) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // formato 1.250,50 -> 1250.50
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // formato 1,250.50 -> 1250.50
      s = s.replace(/,/g, '');
    }
  } else if (tieneComa) {
    // 1250,50 -> 1250.50  (coma decimal)
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Analiza una sola linea y devuelve un material detectado o null.
 * Reconoce varios patrones comunes:
 *   "10  UND  Interruptor 20A"        (cant unidad descripcion)
 *   "Cable THHN #12   500 m"          (descripcion cant unidad)
 *   "CBL-12  Cable THHN #12  500  m"  (codigo descripcion cant unidad)
 */
function parseLinea(lineaOriginal) {
  const linea = lineaOriginal.replace(/\s+/g, ' ').trim();
  if (!linea) return null;

  const limpio = sinAcentos(linea);
  // Ignorar encabezados exactos o muy cortos
  if (IGNORAR.includes(limpio)) return null;
  if (linea.length < 3) return null;

  // Regex de "numero + unidad" (la unidad es una palabra conocida)
  const unidadesAlt = Object.keys(UNIDADES).join('|');
  const numUnidad = new RegExp(
    '(\\d[\\d.,]*)\\s*(' + unidadesAlt + ')\\b',
    'i'
  );

  let cantidad = null;
  let unidad = null;
  let descripcion = linea;

  const m = linea.match(numUnidad);
  if (m) {
    cantidad = aNumero(m[1]);
    unidad = normalizarUnidad(m[2]);
    // Quitar el fragmento "cantidad unidad" de la descripcion
    descripcion = (linea.slice(0, m.index) + ' ' + linea.slice(m.index + m[0].length))
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    // Patron: la linea empieza con un numero (cantidad) sin unidad clara
    const soloNum = linea.match(/^(\d[\d.,]*)\s+(.*)$/);
    if (soloNum) {
      cantidad = aNumero(soloNum[1]);
      descripcion = soloNum[2].trim();
    }
  }

  // Si no hay ni cantidad ni algo parecido a descripcion util, descartar
  if (cantidad == null && !unidad) {
    // Podria ser solo texto (una categoria/titulo). No lo tomamos como material.
    return null;
  }

  // Intentar separar un codigo al inicio: algo tipo "CBL-12" o "AB1234"
  let codigo = '';
  const codMatch = descripcion.match(/^([A-Z0-9][A-Z0-9\-\.\/]{2,})\s+(.+)$/);
  if (codMatch && /\d/.test(codMatch[1]) && codMatch[2].length > 2) {
    codigo = codMatch[1];
    descripcion = codMatch[2].trim();
  }

  // Limpiar simbolos sobrantes al inicio/fin
  descripcion = descripcion.replace(/^[\-•\.\)\(\s]+/, '').replace(/[\-\s]+$/, '').trim();

  if (!descripcion || descripcion.length < 2) return null;
  if (IGNORAR.includes(sinAcentos(descripcion))) return null;

  return {
    codigo: codigo,
    nombre: descripcion,
    cantidad: cantidad != null ? cantidad : 0,
    unidad: unidad || 'unidad',
    categoria: categoriaSugerida(descripcion)
  };
}

/**
 * Sugiere una categoria segun palabras clave en la descripcion.
 * El almacenista puede cambiarla luego en la app.
 */
function categoriaSugerida(nombre) {
  const t = sinAcentos(nombre);
  const reglas = [
    { cat: 'Cables y Conductores', k: ['cable', 'conductor', 'thhn', 'thw', 'awg', 'alambre', 'flexible', 'encauchetado'] },
    { cat: 'Canalizacion y Tuberia', k: ['tubo', 'tuberia', 'conduit', 'emt', 'imc', 'pvc', 'canaleta', 'bandeja', 'ducto', 'coraza'] },
    { cat: 'Iluminacion', k: ['luminaria', 'lampara', 'bombillo', 'led', 'reflector', 'panel', 'tubo led', 'foco', 'balasto', 'driver'] },
    { cat: 'Tableros y Proteccion', k: ['tablero', 'breaker', 'interruptor', 'totalizador', 'diferencial', 'contactor', 'rele', 'fusible', 'barraje'] },
    { cat: 'Tomas e Interruptores', k: ['toma', 'tomacorriente', 'clavija', 'enchufe', 'apagador', 'suiche', 'placa'] },
    { cat: 'Cajas y Accesorios', k: ['caja', 'chazo', 'tornillo', 'grapa', 'abrazadera', 'conector', 'terminal', 'amarre', 'cinta', 'boquilla', 'union', 'curva', 'codo'] },
    { cat: 'Puesta a Tierra', k: ['tierra', 'varilla', 'copperweld', 'soldadura', 'cadweld', 'pararrayo'] },
    { cat: 'Comunicaciones', k: ['utp', 'fibra', 'rj45', 'patch', 'coaxial', 'datos', 'red', 'telecom'] },
    { cat: 'Herramientas', k: ['taladro', 'pinza', 'destornillador', 'llave', 'martillo', 'segueta', 'hombresolo', 'multimetro'] },
    { cat: 'EPP y Seguridad', k: ['casco', 'guante', 'gafa', 'arnes', 'bota', 'chaleco', 'proteccion', 'senal', 'eslinga'] }
  ];
  for (const r of reglas) {
    if (r.k.some((w) => t.includes(w))) return r.cat;
  }
  return 'Sin clasificar';
}

/**
 * Analiza un texto completo (varias lineas) y devuelve la lista de materiales.
 */
function parsePdfText(texto) {
  if (!texto) return [];
  const lineas = String(texto).split(/\r?
/);
  const items = [];
  for (const l of lineas) {
    const item = parseLinea(l);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Lee un archivo PDF del disco y devuelve { rawText, items }.
 * Usa pdf-parse (dependencia). Solo se llama desde el proceso principal.
 */
async function parsePdfFile(filePath) {
  const fs = require('fs');
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return {
    rawText: data.text || '',
    items: parsePdfText(data.text || '')
  };
}

module.exports = {
  parsePdfText,
  parsePdfFile,
  parseLinea,
  normalizarUnidad,
  categoriaSugerida,
  aNumero,
  UNIDADES
};
