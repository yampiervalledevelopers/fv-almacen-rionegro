'use strict';

/**
 * Pruebas de la logica PURA (sin dependencias externas ni Firebase).
 * Ejecutar con:  npm test   (o)   node test/logic.test.js
 *
 * Verifica el analizador de texto de PDF (pdfParser) que es la parte
 * mas delicada de la importacion.
 */

const assert = require('assert');
const {
  parsePdfText, parseLinea, normalizarUnidad, categoriaSugerida, aNumero
} = require('../src/main/pdfParser');

let pasadas = 0;
let fallidas = 0;

function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log('  \u2713 ' + nombre);
  } catch (err) {
    fallidas++;
    console.log('  \u2717 ' + nombre + '  ->  ' + err.message);
  }
}

console.log('
== Normalizacion de unidades ==');
prueba('und -> unidad', () => assert.strictEqual(normalizarUnidad('und'), 'unidad'));
prueba('m -> metro', () => assert.strictEqual(normalizarUnidad('m'), 'metro'));
prueba('mts -> metro', () => assert.strictEqual(normalizarUnidad('mts'), 'metro'));
prueba('lt -> litro', () => assert.strictEqual(normalizarUnidad('lt'), 'litro'));
prueba('bultos -> bulto', () => assert.strictEqual(normalizarUnidad('bultos'), 'bulto'));
prueba('desconocida -> null', () => assert.strictEqual(normalizarUnidad('xyz'), null));

console.log('
== Conversion de numeros ==');
prueba('500 -> 500', () => assert.strictEqual(aNumero('500'), 500));
prueba('1.250,50 -> 1250.5', () => assert.strictEqual(aNumero('1.250,50'), 1250.5));
prueba('1,250.50 -> 1250.5', () => assert.strictEqual(aNumero('1,250.50'), 1250.5));
prueba('12,5 -> 12.5', () => assert.strictEqual(aNumero('12,5'), 12.5));

console.log('
== Categoria sugerida ==');
prueba('cable -> Cables', () => assert.strictEqual(categoriaSugerida('Cable THHN #12 AWG'), 'Cables y Conductores'));
prueba('tuberia -> Canalizacion', () => assert.strictEqual(categoriaSugerida('Tubo EMT 1/2'), 'Canalizacion y Tuberia'));
prueba('breaker -> Tableros', () => assert.strictEqual(categoriaSugerida('Breaker 2x20A'), 'Tableros y Proteccion'));
prueba('luminaria -> Iluminacion', () => assert.strictEqual(categoriaSugerida('Panel LED 60x60'), 'Iluminacion'));
prueba('guantes -> EPP', () => assert.strictEqual(categoriaSugerida('Guantes de seguridad'), 'EPP y Seguridad'));

console.log('
== Analisis de lineas ==');
prueba('cant unidad descripcion', () => {
  const r = parseLinea('10 UND Interruptor sencillo 15A');
  assert.strictEqual(r.cantidad, 10);
  assert.strictEqual(r.unidad, 'unidad');
  assert.ok(r.nombre.includes('Interruptor'));
});
prueba('descripcion cant unidad', () => {
  const r = parseLinea('Cable THHN #12 AWG   500 m');
  assert.strictEqual(r.cantidad, 500);
  assert.strictEqual(r.unidad, 'metro');
  assert.strictEqual(r.nombre, 'Cable THHN #12 AWG');
});
prueba('codigo descripcion cant unidad', () => {
  const r = parseLinea('CBL-12 Cable THHN #12 250 mts');
  assert.strictEqual(r.codigo, 'CBL-12');
  assert.strictEqual(r.cantidad, 250);
  assert.strictEqual(r.unidad, 'metro');
});
prueba('encabezado se ignora', () => {
  assert.strictEqual(parseLinea('DESCRIPCION'), null);
  assert.strictEqual(parseLinea('Cantidad'), null);
});
prueba('linea vacia se ignora', () => assert.strictEqual(parseLinea('   '), null));

console.log('
== Analisis de texto completo ==');
prueba('detecta varios materiales', () => {
  const texto = [
    'LISTA DE MATERIALES',
    'Item  Cantidad  Descripcion',
    '10 UND Interruptor sencillo 15A',
    'Cable THHN #12 AWG   500 m',
    'CBL-8 Cable THHN #8 AWG 120 mts',
    '5 bultos Cemento gris',
    'Tuberia EMT 1/2   80 tramos',
    'Pintura blanca   12 galones'
  ].join('
');
  const items = parsePdfText(texto);
  assert.ok(items.length >= 5, 'esperados >=5, obtenidos ' + items.length);
  const cemento = items.find((i) => /cemento/i.test(i.nombre));
  assert.strictEqual(cemento.cantidad, 5);
  assert.strictEqual(cemento.unidad, 'bulto');
});

console.log('
----------------------------------------');
console.log('Resultado: ' + pasadas + ' pasadas, ' + fallidas + ' fallidas');
console.log('----------------------------------------
');

if (fallidas > 0) process.exit(1);
