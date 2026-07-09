'use strict';

/**
 * Generador de reportes PDF con pdfkit.
 *
 * Dos tipos de reporte:
 *  - 'general':   resumen por categoria + totales.
 *  - 'detallado': tabla completa de materiales + historial de movimientos.
 *
 * Membrete corporativo FVIECOM en cada pagina.
 */

const COLORES = {
  navy: '#0a1a3a',
  azul: '#0d6efd',
  cian: '#00d4ff',
  gris: '#5b6b8c',
  grisClaro: '#eef2f9',
  texto: '#1a2238',
  blanco: '#ffffff'
};

/**
 * Genera el PDF y lo guarda en outputPath.
 * @param {Object} opts { tipo, materiales, movimientos, meta, outputPath }
 * @returns {Promise<string>} ruta del archivo generado
 */
function exportInventoryPdf(opts) {
  const PDFDocument = require('pdfkit');
  const fs = require('fs');

  const tipo = opts.tipo === 'detallado' ? 'detallado' : 'general';
  const materiales = Array.isArray(opts.materiales) ? opts.materiales : [];
  const movimientos = Array.isArray(opts.movimientos) ? opts.movimientos : [];
  const meta = opts.meta || {};

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const stream = fs.createWriteStream(opts.outputPath);
      stream.on('error', reject);
      stream.on('finish', () => resolve(opts.outputPath));
      doc.pipe(stream);

      dibujarEncabezado(doc, tipo, meta);

      if (tipo === 'general') {
        seccionResumen(doc, materiales);
      } else {
        seccionDetallada(doc, materiales);
        if (movimientos.length > 0) {
          seccionMovimientos(doc, movimientos);
        }
      }

      dibujarPiePaginas(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Encabezado / membrete                                               */
/* ------------------------------------------------------------------ */

function dibujarEncabezado(doc, tipo, meta) {
  const w = doc.page.width;
  // Barra superior
  doc.rect(0, 0, w, 90).fill(COLORES.navy);

  // Logo simple (rayo dentro de hexagono) dibujado con vectores
  const cx = 62, cy = 45;
  doc.save();
  doc.lineWidth(2).strokeColor(COLORES.cian);
  // rayo
  doc.moveTo(cx + 4, cy - 20)
    .lineTo(cx - 8, cy + 2)
    .lineTo(cx + 2, cy + 2)
    .lineTo(cx - 4, cy + 20)
    .lineTo(cx + 12, cy - 6)
    .lineTo(cx + 2, cy - 6)
    .lineTo(cx + 8, cy - 20)
    .fill(COLORES.cian);
  doc.restore();

  doc.fillColor(COLORES.blanco).font('Helvetica-Bold').fontSize(18)
    .text('FVIECOM S.A.S', 100, 24);
  doc.fillColor(COLORES.cian).font('Helvetica').fontSize(9)
    .text('FV Ingenieria Electrica y Telecomunicaciones', 100, 46);
  doc.fillColor('#c7d3ea').fontSize(8)
    .text('Proyecto: Aeropuerto Internacional Jose Maria Cordova - Rionegro', 100, 60);

  // Titulo del reporte
  const titulo = tipo === 'general' ? 'REPORTE GENERAL DE INVENTARIO' : 'REPORTE DETALLADO DE INVENTARIO';
  doc.moveDown();
  doc.fillColor(COLORES.texto).font('Helvetica-Bold').fontSize(15)
    .text(titulo, 40, 108);

  const fecha = meta.fecha || new Date().toLocaleString('es-CO');
  const usuario = meta.usuario ? '  |  Generado por: ' + meta.usuario : '';
  doc.fillColor(COLORES.gris).font('Helvetica').fontSize(9)
    .text('Fecha: ' + fecha + usuario, 40, 128);

  // Linea separadora
  doc.moveTo(40, 146).lineTo(w - 40, 146).lineWidth(1).strokeColor(COLORES.azul).stroke();
  doc.y = 158;
}

/* ------------------------------------------------------------------ */
/* Reporte GENERAL: resumen por categoria                              */
/* ------------------------------------------------------------------ */

function seccionResumen(doc, materiales) {
  const totalItems = materiales.length;
  const totalUnidades = materiales.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  const bajoStock = materiales.filter((m) => esBajoStock(m)).length;

  // Tarjetas de resumen
  tarjeta(doc, 40, doc.y, 'Tipos de material', String(totalItems));
  tarjeta(doc, 205, doc.y, 'Cantidad total', formatNum(totalUnidades));
  tarjeta(doc, 370, doc.y, 'Con stock bajo', String(bajoStock));
  doc.y += 70;

  // Agrupar por categoria
  const grupos = agruparPor(materiales, 'categoria');
  const cats = Object.keys(grupos).sort();

  doc.fillColor(COLORES.texto).font('Helvetica-Bold').fontSize(12)
    .text('Resumen por categoria', 40, doc.y);
  doc.moveDown(0.5);

  const cols = [
    { t: 'Categoria', w: 230 },
    { t: 'Tipos', w: 90, align: 'right' },
    { t: 'Cantidad total', w: 130, align: 'right' },
    { t: 'Stock bajo', w: 65, align: 'right' }
  ];
  filaEncabezado(doc, cols);

  for (const cat of cats) {
    const lista = grupos[cat];
    const cantidad = lista.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
    const bajos = lista.filter((m) => esBajoStock(m)).length;
    verificarSalto(doc, cols);
    filaDatos(doc, cols, [cat, String(lista.length), formatNum(cantidad), String(bajos)]);
  }
}

/* ------------------------------------------------------------------ */
/* Reporte DETALLADO: tabla completa                                   */
/* ------------------------------------------------------------------ */

function seccionDetallada(doc, materiales) {
  doc.fillColor(COLORES.texto).font('Helvetica-Bold').fontSize(12)
    .text('Inventario completo (' + materiales.length + ' materiales)', 40, doc.y);
  doc.moveDown(0.5);

  const cols = [
    { t: 'Codigo', w: 70 },
    { t: 'Material', w: 200 },
    { t: 'Categoria', w: 120 },
    { t: 'Cantidad', w: 60, align: 'right' },
    { t: 'Unidad', w: 65 }
  ];

  // Ordenar por categoria y nombre
  const ordenado = materiales.slice().sort((a, b) => {
    const c = String(a.categoria || '').localeCompare(String(b.categoria || ''));
    return c !== 0 ? c : String(a.nombre || '').localeCompare(String(b.nombre || ''));
  });

  filaEncabezado(doc, cols);
  for (const m of ordenado) {
    verificarSalto(doc, cols);
    const bajo = esBajoStock(m);
    filaDatos(doc, cols, [
      m.codigo || '-',
      m.nombre || '',
      m.categoria || 'Sin clasificar',
      formatNum(m.cantidad),
      m.unidad || 'unidad'
    ], bajo ? '#c0392b' : null);
  }
}

function seccionMovimientos(doc, movimientos) {
  doc.addPage();
  doc.fillColor(COLORES.texto).font('Helvetica-Bold').fontSize(12)
    .text('Historial de movimientos', 40, 50);
  doc.moveDown(0.5);

  const cols = [
    { t: 'Fecha', w: 105 },
    { t: 'Tipo', w: 55 },
    { t: 'Material', w: 170 },
    { t: 'Cant.', w: 50, align: 'right' },
    { t: 'Frente / Nota', w: 135 }
  ];

  const ordenado = movimientos.slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  filaEncabezado(doc, cols);
  for (const mv of ordenado) {
    verificarSalto(doc, cols);
    const tipo = mv.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA';
    const color = mv.tipo === 'entrada' ? '#1e7e34' : '#c0392b';
    filaDatos(doc, cols, [
      formatFecha(mv.fecha),
      tipo,
      mv.materialNombre || '',
      formatNum(mv.cantidad),
      mv.nota || mv.frente || '-'
    ], color, 1);
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades de dibujo de tablas                                      */
/* ------------------------------------------------------------------ */

function filaEncabezado(doc, cols) {
  const x0 = 40;
  const y = doc.y;
  const anchoTotal = cols.reduce((s, c) => s + c.w, 0);
  doc.rect(x0, y, anchoTotal, 20).fill(COLORES.azul);
  let x = x0;
  doc.fillColor(COLORES.blanco).font('Helvetica-Bold').fontSize(9);
  for (const c of cols) {
    doc.text(c.t, x + 5, y + 6, { width: c.w - 10, align: c.align || 'left' });
    x += c.w;
  }
  doc.y = y + 20;
}

let filaAlterna = false;
function filaDatos(doc, cols, valores, colorTexto, colIndexColor) {
  const x0 = 40;
  const y = doc.y;
  const anchoTotal = cols.reduce((s, c) => s + c.w, 0);

  // Calcular alto segun la celda mas larga
  doc.font('Helvetica').fontSize(9);
  let alto = 16;
  cols.forEach((c, i) => {
    const h = doc.heightOfString(String(valores[i] == null ? '' : valores[i]), { width: c.w - 10 });
    if (h + 8 > alto) alto = h + 8;
  });

  if (filaAlterna) {
    doc.rect(x0, y, anchoTotal, alto).fill(COLORES.grisClaro);
  }
  filaAlterna = !filaAlterna;

  let x = x0;
  cols.forEach((c, i) => {
    let color = COLORES.texto;
    if (colorTexto && (colIndexColor == null || colIndexColor === i)) color = colorTexto;
    doc.fillColor(color).font('Helvetica').fontSize(9)
      .text(String(valores[i] == null ? '' : valores[i]), x + 5, y + 4, { width: c.w - 10, align: c.align || 'left' });
    x += c.w;
  });
  doc.y = y + alto;
}

function verificarSalto(doc, cols) {
  if (doc.y > doc.page.height - 70) {
    doc.addPage();
    doc.y = 50;
    filaAlterna = false;
    filaEncabezado(doc, cols);
  }
}

function tarjeta(doc, x, y, titulo, valor) {
  doc.roundedRect(x, y, 150, 56, 6).fill(COLORES.grisClaro);
  doc.fillColor(COLORES.gris).font('Helvetica').fontSize(9).text(titulo, x + 12, y + 10, { width: 126 });
  doc.fillColor(COLORES.navy).font('Helvetica-Bold').fontSize(20).text(valor, x + 12, y + 26, { width: 126 });
}

function dibujarPiePaginas(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const w = doc.page.width;
    const h = doc.page.height;
    doc.fillColor(COLORES.gris).font('Helvetica').fontSize(8)
      .text('FVIECOM S.A.S - Inventario de obra  |  Documento generado automaticamente',
        40, h - 30, { width: w - 120, align: 'left' });
    doc.text('Pagina ' + (i - range.start + 1) + ' de ' + range.count, w - 120, h - 30, { width: 80, align: 'right' });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function agruparPor(lista, campo) {
  const g = {};
  for (const item of lista) {
    const k = item[campo] || 'Sin clasificar';
    if (!g[k]) g[k] = [];
    g[k].push(item);
  }
  return g;
}

function esBajoStock(m) {
  const min = Number(m.minimo);
  if (!min || min <= 0) return false;
  return (Number(m.cantidad) || 0) <= min;
}

function formatNum(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

function formatFecha(f) {
  if (!f) return '-';
  try {
    return new Date(f).toLocaleString('es-CO');
  } catch (e) {
    return String(f);
  }
}

module.exports = { exportInventoryPdf };
