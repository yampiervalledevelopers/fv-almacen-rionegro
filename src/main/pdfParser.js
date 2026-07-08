'use strict';

/**
 * Lector de PDF de listas de materiales.
 *
 * - parsePdfText(texto): logica PURA que analiza texto y detecta materiales.
 * - parsePdfFile(ruta): usa "pdf-parse" para extraer el texto del PDF.
 *
 * Nota: para dividir en lineas se usa una expresion regular con codigos
 * unicode (\u000d = retorno de carro, \u000a = salto de linea) en vez de
 * los escapes \r 
, para que el archivo no se dane al copiarlo/pegarlo.
 */

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

const IGNORAR = [
  'item', 'items', 'cantidad', 'cant', 'descripcion', 'descripción', 'unidad',
  'codigo', 'código', 'total', 'subtotal', 'pagina', 'página', 'page',
  'lista de materiales', 'material', 'materiales', 'no.', 'n°', 'nro',
  'precio', 'valor', 'observaciones'
];

function normalizarUnidad(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/\.$/, '').trim();
  return UNIDADES[key] || null;
}

function sinAcentos(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function aNumero(txt) {
  if (txt == null) return null;
  let s = String(txt).trim();
  if (!s) return null;
  const tienePunto = s.indexOf('.') >= 0;
  const tieneComa = s.indexOf(',') >= 0;
  if (tienePunto && tieneComa) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (tieneComa) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseLinea(lineaOriginal) {
  const linea = lineaOriginal.replace(/\s+/g, ' ').trim();
  if (!linea) return null;

  const limpio = sinAcentos(linea);
  if (IGNORAR.includes(limpio)) return null;
  if (linea.length < 3) return null;

  const unidadesAlt = Object.keys(UNIDADES).join('|');
  const numUnidad = new RegExp('(\\d[\\d.,]*)\\s*(' + unidadesAlt + ')\\b', 'i');

  let cantidad = null;
  let unidad = null;
  let descripcion = linea;

  const m = linea.match(numUnidad);
  if (m) {
    cantidad = aNumero(m[1]);
    unidad = normalizarUnidad(m[2]);
    descripcion = (linea.slice(0, m.index) + ' ' + linea.slice(m.index + m[0].length))
      .replace(/\s+/g, ' ').trim();
  } else {
    const soloNum = linea.match(/^(\d[\d.,]*)\s+(.*)$/);
    if (soloNum) {
      cantidad = aNumero(soloNum[1]);
      descripcion = soloNum[2].trim();
    }
  }

  if (cantidad == null && !unidad) return null;

  let codigo = '';
  const codMatch = descripcion.match(/^([A-Z0-9][A-Z0-9\-\.\/]{2,})\s+(.+)$/);
  if (codMatch && /\d/.test(codMatch[1]) && codMatch[2].length > 2) {
    codigo = codMatch[1];
    descripcion = codMatch[2].trim();
  }

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

function categoriaSugerida(nombre) {
  const t = sinAcentos(nombre);
  const reglas = [
    { cat: 'Cables y Conductores', k: ['cable', 'conductor', 'thhn', 'thw', 'awg', 'alambre', 'flexible', 'encauchetado'] },
    { cat: 'Canalizacion y Tuberia', k: ['tubo', 'tuberia', 'conduit', 'emt', 'imc', 'pvc', 'canaleta', 'bandeja', 'ducto', 'coraza'] },
    { cat: 'Iluminacion', k: ['luminaria', 'lampara', 'bombillo', 'led', 'reflector', 'panel', 'foco', 'balasto', 'driver'] },
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

function parsePdfText(texto) {
  if (!texto) return [];
  // Dividir en lineas usando codigos unicode (CR = \u000d, LF = \u000a)
  const lineas = String(texto).split(/[\u000d\u000a]+/);
  const items = [];
  for (const l of lineas) {
    const item = parseLinea(l);
    if (item) items.push(item);
  }
  return items;
}

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
