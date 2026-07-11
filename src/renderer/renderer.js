// ============================================================
//  Inventario FVIECOM - Logica de la interfaz (renderer)
//  Incluye: movimientos con responsable, 3 tipos de orden
//  (salida / entrada / devolucion), impresion con firmas y
//  seccion de historial por responsable.
// ============================================================

import {
  alCambiarSesion, iniciarSesion, registrarUsuario,
  recuperarClave, cerrarSesion, mensajeError
} from './auth.js';

import {
  escucharMateriales, agregarMaterial, actualizarMaterial, eliminarMaterial,
  importarMateriales, registrarMovimiento, escucharMovimientos, obtenerMovimientos,
  registrarOrden, recibirOrden, escucharOrdenes,
  eliminarMovimiento, eliminarOrden,
  escucharKits, agregarKit, actualizarKit, eliminarKit,
  escucharCategorias, agregarCategoria, eliminarCategoria
} from './db.js';

/* ------------------------------------------------------------------ */
/* Estado global                                                       */
/* ------------------------------------------------------------------ */
const estado = {
  usuario: null,
  materiales: [],
  movimientos: [],
  ordenes: [],
  kits: [],
  categorias: [],
  itemsImportados: [],
  itemsOrden: [],
  itemsKit: [],
  itemsAdicion: [],
  desuscribir: []
};

const CATEGORIAS = [
  'Cables y Conductores', 'Canalizacion y Tuberia', 'Iluminacion',
  'Tableros y Proteccion', 'Tomas e Interruptores', 'Cajas y Accesorios',
  'Puesta a Tierra', 'Comunicaciones', 'Herramientas', 'EPP y Seguridad',
  'Sin clasificar'
];

const UNIDADES = ['unidad', 'metro', 'kilometro', 'centimetro', 'kilogramo',
  'gramo', 'litro', 'galon', 'bulto', 'rollo', 'caja', 'paquete', 'bolsa',
  'tramo', 'juego', 'par'];

// Correo por defecto para el boton "Compartir por Gmail".
const CORREO_COMPARTIR = 'proyectos.4@fviecomsas.com';

// Configuracion de los 3 tipos de movimiento / orden.
const TIPOS = {
  salida: { label: 'Salida', titulo: 'ORDEN DE SALIDA DE MATERIALES', campo: 'frente', campoLabel: 'Frente de obra' },
  entrada: { label: 'Entrada / Pedido', titulo: 'ORDEN DE ENTRADA / PEDIDO DE MATERIALES', campo: 'proveedor', campoLabel: 'Proveedor' },
  devolucion: { label: 'Devolucion', titulo: 'ORDEN DE DEVOLUCION DE MATERIALES', campo: 'frente', campoLabel: 'Frente de obra (origen)' }
};

// Contratos y sus frentes de obra. Al elegir el frente se deduce el contrato.
const CONTRATOS = {
  'Contrato 1': ['3', '3A', '3B', '3C'],
  'Contrato 2': ['4', '5', '5B', '11']
};
function contratoDeFrente(frente) {
  const f = String(frente || '').toUpperCase().trim();
  for (const c in CONTRATOS) { if (CONTRATOS[c].includes(f)) return c; }
  return '';
}
function frenteSelectHtml(id, sel) {
  let h = `<select id="${id}"><option value="">— Sin frente —</option>`;
  for (const c in CONTRATOS) {
    h += `<optgroup label="${c}">`;
    for (const f of CONTRATOS[c]) h += `<option value="${f}" ${f === sel ? 'selected' : ''}>Frente ${f}</option>`;
    h += `</optgroup>`;
  }
  return h + `</select>`;
}

/* ------------------------------------------------------------------ */
/* Utilidades DOM                                                      */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 }); }
function fmtFecha(f) {
  if (!f) return '-';
  try { return new Date(f).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (e) { return String(f); }
}

let toastTimer = null;
function toast(msg, tipo) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (tipo ? ' ' + tipo : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}
function esBajoStock(m) {
  const min = Number(m.minimo);
  return min > 0 && (Number(m.cantidad) || 0) <= min;
}
function agrupar(lista, campo) {
  const g = {};
  for (const item of lista) { const k = item[campo] || 'Sin clasificar'; (g[k] = g[k] || []).push(item); }
  return g;
}
function opcionesSelect(lista, sel) {
  return lista.map((v) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

/* ------------------------------------------------------------------ */
/* Modal generico                                                      */
/* ------------------------------------------------------------------ */
function abrirModal(titulo, htmlBody, ancho) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-body').innerHTML = htmlBody;
  const m = $('#modal .modal');
  if (m) m.style.maxWidth = ancho ? ancho : '';
  $('#modal').hidden = false;
}
function cerrarModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

$('#modal-cerrar').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

/* ==================================================================
   INYECCION de estilos, menu, vistas y area de impresion
   (para no tener que editar index.html ni styles.css)
   ================================================================== */
function inyectarExtras() {
  // ---- Estilos nuevos (impresion + componentes) ----
  const css = `
  #print-area { display: none; }
  @media print {
    body { background: #fff !important; }
    .app, .login-wrap, .modal-wrap, .toast { display: none !important; }
    #print-area { display: block !important; }
  }
  .doc { color:#111; font-family: Arial, Helvetica, sans-serif; padding:12px 20px; max-width:820px; margin:0 auto; }
  .doc-head { display:flex; align-items:center; gap:16px; border-bottom:3px solid #0d6efd; padding-bottom:12px; }
  .doc-logo { width:88px; height:88px; object-fit:contain; }
  .doc-emp h1 { font-size:22px; margin:0; color:#0a1a3a; }
  .doc-emp p { margin:2px 0; font-size:11px; color:#444; }
  .doc-titulo { text-align:center; font-size:17px; margin:18px 0 12px; color:#0a1a3a; letter-spacing:.5px; }
  .doc-meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; font-size:12.5px; margin-bottom:14px; }
  .doc-meta b { color:#0a1a3a; }
  .doc-tabla { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:4px; }
  .doc-tabla th { background:#0d6efd; color:#fff; padding:8px; text-align:left; }
  .doc-tabla td { border:1px solid #ccc; padding:7px 8px; }
  .doc-nota { margin-top:12px; font-size:12px; color:#333; }
  .doc-firmas { display:flex; gap:60px; justify-content:space-around; margin-top:70px; }
  .doc-firma { text-align:center; flex:1; max-width:280px; }
  .doc-firma .linea { border-top:1.6px solid #333; margin-bottom:6px; }
  .doc-firma .rol { font-size:11px; color:#666; }
  .doc-firma .nombre { font-size:13px; font-weight:bold; color:#111; }
  .orden-items { margin:6px 0 4px; }
  .orden-item-row { display:grid; grid-template-columns: 1fr 120px 42px; gap:8px; margin-bottom:8px; align-items:center; }
  .orden-item-row .btn-icon { height:38px; }
  .orden-add { margin-top:4px; }
  .orden-total { font-size:12.5px; color:var(--texto-dim); margin-top:6px; }
  .orden-item-row { align-items:end; }
  .mat-picker { display:flex; flex-direction:column; gap:5px; min-width:0; }
  .mat-picker .mat-filtro { font-size:12px; padding:7px 9px; }
  .orden-aviso { background:rgba(46,204,113,0.12); border:1px solid rgba(46,204,113,0.35); color:#c9f0d8; border-radius:8px; padding:9px 12px; font-size:12.5px; margin-bottom:12px; }
  .link-btn { background:none; border:none; color:#4da3ff; cursor:pointer; text-decoration:underline; font-size:12.5px; padding:0; }
  .kit-cargar { display:flex; gap:8px; margin:0 0 10px; }
  .kit-cargar select { flex:1; min-width:0; }
  .tipo-badge { font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:6px; }
  .tipo-badge.salida { background:rgba(255,84,112,0.15); color:#ff9db0; }
  .tipo-badge.entrada { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .tipo-badge.devolucion { background:rgba(255,176,32,0.15); color:#ffd08a; }
  .estado-badge { font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:6px; }
  .estado-badge.pendiente { background:rgba(255,176,32,0.18); color:#ffd08a; }
  .estado-badge.recibido { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .estado-badge.completado { background:rgba(120,160,220,0.15); color:#9fc2ef; }
  .estado-badge.falta { background:rgba(255,84,112,0.18); color:#ff9db0; }
  .estado-badge.adicion { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .estado-badge.mixto { background:rgba(255,176,32,0.18); color:#ffd08a; }
  .rec-sub { display:block; font-size:12px; color:var(--texto-dim); font-weight:700; margin:0 0 8px; }
  .rec-row { display:grid; grid-template-columns:1fr 130px; gap:10px; align-items:center; margin-bottom:8px; }
  .rec-row .rec-mat { align-self:center; }
  .adic-row { margin-bottom:10px; }
  .adic-linea { display:grid; grid-template-columns:1fr 120px 42px; gap:8px; align-items:end; }
  .adic-nuevo { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; }
  .rec-adic-tit { font-size:12px; color:var(--texto-dim); margin:10px 0 6px; font-weight:600; }
  tr.grupo-row { cursor:pointer; }
  tr.grupo-row:hover { background:rgba(255,255,255,0.03); }
  tr.grupo-row .caret { display:inline-block; transition:transform .15s ease; color:var(--texto-mute); font-size:11px; margin-right:4px; }
  tr.grupo-row.abierto .caret { transform:rotate(90deg); }
  tr.grupo-detalle > td { padding:0 0 0 26px; background:rgba(0,0,0,0.18); }
  .tabla-detalle { width:100%; border-collapse:collapse; font-size:12.5px; }
  .tabla-detalle th, .tabla-detalle td { padding:6px 12px; border-bottom:1px solid rgba(255,255,255,0.06); text-align:left; }
  .tabla-detalle th.der, .tabla-detalle td.der { text-align:right; }
  .tabla-detalle th { color:var(--texto-dim); font-weight:600; }
  .mov-hint { font-size:12px; color:var(--texto-dim); padding:8px 4px 12px; }
  tr.inv-tipo > td { background:rgba(77,163,255,0.10); color:#dce9ff; font-weight:700; font-size:13px; padding:9px 12px; letter-spacing:.3px; }
  tr.inv-clase > td { background:rgba(255,255,255,0.03); color:var(--texto-dim); font-weight:600; font-size:12px; padding:6px 12px 6px 26px; }
  tr.inv-tipo, tr.inv-clase { cursor:pointer; }
  tr.inv-tipo:hover > td, tr.inv-clase:hover > td { filter:brightness(1.15); }
  tr.inv-tipo .caret, tr.inv-clase .caret { display:inline-block; transition:transform .15s ease; color:var(--texto-mute); font-size:11px; margin-right:2px; }
  tr.inv-tipo.abierto .caret, tr.inv-clase.abierto .caret { transform:rotate(90deg); }
  tr.inv-vacio-grupo > td { color:var(--texto-mute); font-size:12px; font-style:italic; padding:8px 12px 8px 26px; }
  .cat-lista { display:flex; flex-direction:column; gap:6px; max-height:300px; overflow:auto; }
  .cat-item { display:flex; align-items:center; justify-content:space-between; gap:10px; background:rgba(255,255,255,0.03); border-radius:8px; padding:8px 12px; font-size:13px; }
  .cat-base { font-size:10.5px; color:var(--texto-mute); border:1px solid rgba(255,255,255,0.12); border-radius:5px; padding:2px 7px; }
  .conteo { color:var(--texto-mute); font-weight:400; font-size:11.5px; }
  .ctx-menu { position:fixed; z-index:1000; background:#0f1830; border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:6px; box-shadow:0 12px 30px rgba(0,0,0,0.5); min-width:210px; }
  .ctx-menu .ctx-titulo { font-size:11.5px; color:var(--texto-mute); padding:6px 10px 8px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ctx-menu button { display:block; width:100%; text-align:left; background:none; border:none; color:var(--texto); padding:9px 10px; border-radius:7px; cursor:pointer; font-size:13px; }
  .ctx-menu button:hover { background:rgba(255,255,255,0.06); }
  .ctx-menu button.peligro { color:#ff9db0; }
  `;
  const style = document.createElement('style');
  style.id = 'fviecom-extra';
  style.textContent = css;
  document.head.appendChild(style);

  // ---- Items del menu (Ordenes y Responsables) despues de Movimientos ----
  const menu = $('.menu');
  const itemMov = $('.menu-item[data-vista="movimientos"]');
  const btnOrdenes = document.createElement('button');
  btnOrdenes.className = 'menu-item';
  btnOrdenes.dataset.vista = 'ordenes';
  btnOrdenes.innerHTML = '<span class="ic">🧾</span> Ordenes';
  const btnResp = document.createElement('button');
  btnResp.className = 'menu-item';
  btnResp.dataset.vista = 'responsables';
  btnResp.innerHTML = '<span class="ic">👷</span> Responsables';
  const btnConsumo = document.createElement('button');
  btnConsumo.className = 'menu-item';
  btnConsumo.dataset.vista = 'consumo';
  btnConsumo.innerHTML = '<span class="ic">▪</span> Consumo x contrato';
  const btnKits = document.createElement('button');
  btnKits.className = 'menu-item';
  btnKits.dataset.vista = 'kits';
  btnKits.innerHTML = '<span class="ic">📦</span> Kits';
  if (menu && itemMov) {
    // Insertar en orden: Movimientos -> Ordenes -> Kits -> Responsables -> Consumo
    itemMov.insertAdjacentElement('afterend', btnConsumo);
    itemMov.insertAdjacentElement('afterend', btnResp);
    itemMov.insertAdjacentElement('afterend', btnKits);
    itemMov.insertAdjacentElement('afterend', btnOrdenes);
  } else if (menu) {
    menu.appendChild(btnOrdenes); menu.appendChild(btnKits); menu.appendChild(btnResp); menu.appendChild(btnConsumo);
  }

  // ---- Vistas nuevas ----
  const cont = $('.contenido');
  const vistaOrdenes = document.createElement('section');
  vistaOrdenes.className = 'vista';
  vistaOrdenes.id = 'vista-ordenes';
  vistaOrdenes.hidden = true;
  vistaOrdenes.innerHTML = `
    <div class="barra-acciones" style="flex-wrap:wrap">
      <button class="btn-primary" data-nueva-orden="salida">📤 Nueva salida</button>
      <button class="btn-primary" data-nueva-orden="entrada">📥 Nueva entrada / pedido</button>
      <button class="btn-primary" data-nueva-orden="devolucion">🔄 Nueva devolucion</button>
    </div>
    <div class="mov-hint">💡 Haz <b>doble clic</b> en una orden (o clic en la ▸) para desplegar los materiales que la componen.</div>
    <div class="panel sin-pad">
      <table class="tabla" id="tabla-ordenes">
        <thead><tr>
          <th>N° Orden</th><th>Fecha</th><th>Tipo</th><th>Estado</th><th>Responsable</th>
          <th>Frente / Proveedor</th><th class="der">Items</th><th class="cen">Acciones</th>
        </tr></thead>
        <tbody id="cuerpo-ordenes"></tbody>
      </table>
      <div id="ord-vacio" class="vacio" hidden>Aun no hay ordenes registradas. Crea una con los botones de arriba.</div>
    </div>`;
  const vistaResp = document.createElement('section');
  vistaResp.className = 'vista';
  vistaResp.id = 'vista-responsables';
  vistaResp.hidden = true;
  vistaResp.innerHTML = `
    <div class="barra-acciones">
      <select id="sel-responsable" class="select" style="min-width:260px"></select>
      <button class="btn-primary" id="btn-imprimir-historial">🖨 Imprimir historial</button>
    </div>
    <div class="panel sin-pad">
      <table class="tabla">
        <thead><tr>
          <th>Fecha</th><th>Tipo</th><th>Material</th><th class="der">Cantidad</th>
          <th>Orden</th><th>Frente / Proveedor</th>
        </tr></thead>
        <tbody id="cuerpo-responsable"></tbody>
      </table>
      <div id="resp-vacio" class="vacio">Elige un responsable para ver su historial completo.</div>
    </div>`;
  const vistaConsumo = document.createElement('section');
  vistaConsumo.className = 'vista';
  vistaConsumo.id = 'vista-consumo';
  vistaConsumo.hidden = true;
  vistaConsumo.innerHTML = `
    <div class="barra-acciones" style="flex-wrap:wrap">
      <select id="cons-contrato" class="select"></select>
      <select id="cons-frente" class="select"></select>
      <button class="btn-primary" id="btn-imprimir-consumo">🖨 Imprimir consumo</button>
    </div>
    <div class="cards" id="cons-cards"></div>
    <div class="panel sin-pad">
      <table class="tabla">
        <thead><tr>
          <th>Material</th><th>Categoria</th><th class="der">Salidas</th>
          <th class="der">Devoluciones</th><th class="der">Consumo neto</th><th>Unidad</th>
        </tr></thead>
        <tbody id="cuerpo-consumo"></tbody>
      </table>
      <div id="cons-vacio" class="vacio">Elige un contrato o frente para ver el consumo de materiales.</div>
    </div>`;
  const vistaKits = document.createElement('section');
  vistaKits.className = 'vista';
  vistaKits.id = 'vista-kits';
  vistaKits.hidden = true;
  vistaKits.innerHTML = `
    <div class="barra-acciones">
      <button class="btn-primary" id="btn-nuevo-kit">+ Nuevo kit</button>
    </div>
    <div class="mov-hint">💡 Un kit es un grupo de materiales que sueles despachar juntos (ej. "Kit herramientas"). Al crear una orden puedes cargarlo con un clic.</div>
    <div class="panel sin-pad">
      <table class="tabla">
        <thead><tr><th>Kit</th><th class="der">Materiales / Herramientas</th><th class="cen">Acciones</th></tr></thead>
        <tbody id="cuerpo-kits"></tbody>
      </table>
      <div id="kits-vacio" class="vacio" hidden>Aun no hay kits. Crea uno para despachar grupos de materiales de una.</div>
    </div>`;
  if (cont) { cont.appendChild(vistaOrdenes); cont.appendChild(vistaResp); cont.appendChild(vistaConsumo); cont.appendChild(vistaKits); }

  // ---- Area de impresion ----
  const area = document.createElement('div');
  area.id = 'print-area';
  document.body.appendChild(area);

  // ---- Reconstruir encabezado de la tabla de movimientos ----
  const theadMov = $('#tabla-mov thead tr');
  if (theadMov) {
    theadMov.innerHTML = `
      <th>Fecha</th><th>N° Orden / Material</th><th>Tipo</th><th class="cen">Items</th>
      <th>Frente / Proveedor</th><th>Responsable</th><th>Usuario</th><th class="cen">Acciones</th>`;
  }

  // ---- Ayuda: los movimientos se agrupan por orden ----
  const tablaMov = $('#tabla-mov');
  if (tablaMov && tablaMov.parentElement) {
    const hintMov = document.createElement('div');
    hintMov.className = 'mov-hint';
    hintMov.innerHTML = '💡 Los movimientos se agrupan por orden y fecha. Haz <b>doble clic</b> en una fila (o clic en la ▸) para desplegar todo lo que se pidio en esa orden.';
    tablaMov.parentElement.insertBefore(hintMov, tablaMov);
  }

  // ---- Encabezado de inventario: la 3a columna pasa a ser "Clase" ----
  // (el "Tipo"/categoria ahora es el encabezado de cada grupo).
  const theadInv = $('#tabla-inventario thead tr');
  if (theadInv) {
    theadInv.innerHTML = `
      <th>Codigo</th><th>Material</th><th>Clase</th>
      <th class="der">Cantidad</th><th>Unidad</th><th class="der">Minimo</th>
      <th>Ubicacion</th><th class="cen">Acciones</th>`;
  }
  const tablaInv = $('#tabla-inventario');
  if (tablaInv && tablaInv.parentElement) {
    const hintInv = document.createElement('div');
    hintInv.className = 'mov-hint';
    hintInv.innerHTML = '💡 El inventario se agrupa por <b>Tipo</b> y <b>Clase</b>. Haz <b>doble clic</b> en un material para mas opciones (duplicar, editar, etc.).';
    tablaInv.parentElement.insertBefore(hintInv, tablaInv);
  }

  // ---- Boton "Nueva categoria" junto a "Nuevo material" ----
  const btnNuevoMat = $('#btn-nuevo-material');
  if (btnNuevoMat) {
    const btnCat = document.createElement('button');
    btnCat.className = 'btn-ghost';
    btnCat.id = 'btn-nueva-categoria';
    btnCat.innerHTML = '🏷 Nueva categoria';
    btnNuevoMat.insertAdjacentElement('afterend', btnCat);
  }

  // ---- Boton "Nueva orden" en la barra de movimientos ----
  const barraMov = $('#btn-nuevo-mov');
  if (barraMov) {
    const b = document.createElement('button');
    b.className = 'btn-ghost';
    b.id = 'btn-ir-ordenes';
    b.textContent = '📦 Crear orden (varios)';
    barraMov.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => $('.menu-item[data-vista="ordenes"]').click());
  }

  // ---- Filtro por frente en Movimientos ----
  const filtroTipo = $('#filtro-tipo-mov');
  if (filtroTipo) {
    const selF = document.createElement('select');
    selF.className = 'select';
    selF.id = 'filtro-frente-mov';
    selF.innerHTML = '<option value="">Todos los frentes</option>' + frentesOptions();
    filtroTipo.insertAdjacentElement('afterend', selF);
    selF.addEventListener('change', renderMovimientos);
  }

  // ---- Graficas de consumo en el Panel general ----
  const vistaDash = $('#vista-dashboard');
  if (vistaDash) {
    const div = document.createElement('div');
    div.className = 'grid-2';
    div.innerHTML = `
      <div class="panel"><div class="panel-head"><h3>Consumo por contrato</h3></div><div id="dash-consumo-contrato" class="lista-barras"></div></div>
      <div class="panel"><div class="panel-head"><h3>Consumo por frente</h3></div><div id="dash-consumo-frente" class="lista-barras"></div></div>`;
    vistaDash.appendChild(div);
  }
}

// Opciones de frentes agrupadas por contrato (para <select>).
function frentesOptions(sel) {
  let h = '';
  for (const c in CONTRATOS) {
    h += `<optgroup label="${c}">`;
    for (const f of CONTRATOS[c]) h += `<option value="${f}" ${f === sel ? 'selected' : ''}>Frente ${f}</option>`;
    h += `</optgroup>`;
  }
  return h;
}

/* ==================================================================
   LOGIN
   ================================================================== */
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-login');
  const errBox = $('#login-error');
  errBox.hidden = true;
  btn.disabled = true; btn.textContent = 'Ingresando...';
  try {
    await iniciarSesion($('#login-correo').value, $('#login-clave').value);
  } catch (err) {
    errBox.textContent = mensajeError(err); errBox.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
});

$('#link-registro').addEventListener('click', (e) => {
  e.preventDefault();
  abrirModal('Crear nuevo usuario', `
    <div class="campo full" style="margin-bottom:14px"><label>Nombre completo</label>
      <input id="reg-nombre" type="text" placeholder="Ej: Almacenista Obra JMC" /></div>
    <div class="campo full" style="margin-bottom:14px"><label>Correo electronico</label>
      <input id="reg-correo" type="email" placeholder="usuario@fviecom.com" /></div>
    <div class="campo full"><label>Contrasena (minimo 6 caracteres)</label>
      <input id="reg-clave" type="password" placeholder="********" /></div>
    <div id="reg-error" class="login-error" hidden style="margin-top:14px"></div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="reg-cancelar">Cancelar</button>
      <button class="btn-primary" id="reg-guardar">Crear usuario</button>
    </div>`);
  $('#reg-cancelar').addEventListener('click', cerrarModal);
  $('#reg-guardar').addEventListener('click', async () => {
    const err = $('#reg-error'); err.hidden = true;
    const correo = $('#reg-correo').value.trim();
    const clave = $('#reg-clave').value;
    if (!correo || clave.length < 6) { err.textContent = 'Ingresa un correo valido y una contrasena de al menos 6 caracteres.'; err.hidden = false; return; }
    try { await registrarUsuario(correo, clave, $('#reg-nombre').value.trim()); cerrarModal(); toast('Usuario creado correctamente', 'ok'); }
    catch (e2) { err.textContent = mensajeError(e2); err.hidden = false; }
  });
});

$('#link-recuperar').addEventListener('click', async (e) => {
  e.preventDefault();
  const correo = $('#login-correo').value.trim();
  if (!correo) { toast('Escribe tu correo en el campo de arriba primero', 'error'); return; }
  try { await recuperarClave(correo); toast('Te enviamos un correo para restablecer la contrasena', 'ok'); }
  catch (err) { toast(mensajeError(err), 'error'); }
});

$('#btn-salir').addEventListener('click', async () => { await cerrarSesion(); });

/* ==================================================================
   Sesion
   ================================================================== */
function nombreUsuario() {
  return estado.usuario ? (estado.usuario.displayName || estado.usuario.email) : '';
}

alCambiarSesion((usuario) => {
  estado.usuario = usuario;
  if (usuario) {
    $('#pantalla-login').hidden = true;
    $('#app').hidden = false;
    const nombre = nombreUsuario();
    $('#usuario-nombre').textContent = nombre;
    $('#usuario-avatar').textContent = (nombre || '?').charAt(0).toUpperCase();
    iniciarSuscripciones();
    cargarInfoApp();
  } else {
    $('#pantalla-login').hidden = false;
    $('#app').hidden = true;
    estado.desuscribir.forEach((fn) => { try { fn(); } catch (e) {} });
    estado.desuscribir = [];
    estado.materiales = []; estado.movimientos = []; estado.ordenes = []; estado.kits = []; estado.categorias = [];
  }
});

function iniciarSuscripciones() {
  estado.desuscribir.forEach((fn) => { try { fn(); } catch (e) {} });
  estado.desuscribir = [];

  estado.desuscribir.push(escucharMateriales((items) => {
    estado.materiales = items;
    renderInventario(); renderDashboard(); llenarFiltroCategorias();
  }, (err) => { console.error(err); toast('Error de conexion: ' + err.message, 'error'); }));

  estado.desuscribir.push(escucharMovimientos((items) => {
    estado.movimientos = items;
    renderMovimientos(); renderDashboard(); llenarResponsables(); llenarConsumo();
  }, (err) => console.error(err)));

  estado.desuscribir.push(escucharOrdenes((items) => {
    estado.ordenes = items;
    renderOrdenes();
  }, (err) => console.error(err)));

  estado.desuscribir.push(escucharKits((items) => {
    estado.kits = items;
    renderKits();
  }, (err) => console.error(err)));

  estado.desuscribir.push(escucharCategorias((items) => {
    estado.categorias = items;
    renderInventario(); llenarFiltroCategorias(); renderListaCategorias();
  }, (err) => console.error(err)));
}

window.addEventListener('online', () => { $('#estado-conexion').classList.remove('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Conectado'; });
window.addEventListener('offline', () => { $('#estado-conexion').classList.add('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Sin conexion (guardando local)'; });

/* ==================================================================
   Navegacion
   ================================================================== */
const TITULOS = {
  dashboard: 'Panel general', inventario: 'Inventario', movimientos: 'Movimientos',
  ordenes: 'Ordenes', responsables: 'Responsables', consumo: 'Consumo por contrato / frente',
  kits: 'Kits (plantillas de materiales)',
  importar: 'Importar PDF', reportes: 'Reportes PDF', acerca: 'Acerca de'
};
function activarNavegacion() {
  $$('.menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vista = btn.dataset.vista;
      $$('.menu-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.vista').forEach((v) => v.hidden = true);
      const v = $('#vista-' + vista);
      if (v) v.hidden = false;
      $('#titulo-vista').textContent = TITULOS[vista] || '';
    });
  });
}

/* ==================================================================
   DASHBOARD
   ================================================================== */
function renderDashboard() {
  const mats = estado.materiales;
  const totalCant = mats.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  const bajos = mats.filter(esBajoStock);
  const categorias = new Set(mats.map((m) => m.categoria || 'Sin clasificar')).size;

  if (!$('#dash-cards')) return;
  $('#dash-cards').innerHTML = `
    ${cardHtml('Tipos de material', mats.length, '▦')}
    ${cardHtml('Cantidad total', fmtNum(totalCant), '∑')}
    ${cardHtml('Categorias', categorias, '▚')}
    ${cardHtml('Stock bajo', bajos.length, '⚠', bajos.length > 0)}`;

  $('#dash-bajos').innerHTML = bajos.length === 0
    ? '<div class="vacio" style="padding:20px">Sin alertas. Todo el stock esta por encima del minimo. ✓</div>'
    : bajos.slice(0, 8).map((m) => `<div class="alerta-item"><span>${esc(m.nombre)}</span><span class="cant">${fmtNum(m.cantidad)} ${esc(m.unidad)} (min ${fmtNum(m.minimo)})</span></div>`).join('');

  const grupos = agrupar(mats, 'categoria');
  const cats = Object.keys(grupos).sort((a, b) => grupos[b].length - grupos[a].length);
  const max = Math.max(1, ...cats.map((c) => grupos[c].length));
  $('#dash-categorias').innerHTML = cats.length === 0
    ? '<div class="vacio" style="padding:20px">Aun no hay materiales.</div>'
    : cats.map((c) => `<div class="barra-row"><div class="barra-top"><span>${esc(c)}</span><span>${grupos[c].length}</span></div><div class="barra-bg"><div class="barra-fill" style="width:${(grupos[c].length / max) * 100}%"></div></div></div>`).join('');

  const ult = estado.movimientos.slice(0, 6);
  $('#dash-movimientos').innerHTML = ult.length === 0
    ? '<div class="vacio" style="padding:20px">Sin movimientos recientes.</div>'
    : ult.map((mv) => `<div class="mov-item"><span class="tipo-badge ${mv.tipo}">${(TIPOS[mv.tipo] || {}).label || mv.tipo}</span><span class="mov-desc">${esc(mv.materialNombre)} — <b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</span><span class="mov-fecha">${fmtFecha(mv.fecha)}</span></div>`).join('');

  // Consumo por contrato / frente (cantidad neta = salidas - devoluciones)
  const porContrato = {};
  const porFrente = {};
  for (const mv of estado.movimientos) {
    if (mv.tipo !== 'salida' && mv.tipo !== 'devolucion') continue;
    if (!mv.frente) continue;
    const q = (Number(mv.cantidad) || 0) * (mv.tipo === 'salida' ? 1 : -1);
    const contrato = mv.contrato || contratoDeFrente(mv.frente) || 'Sin contrato';
    porContrato[contrato] = (porContrato[contrato] || 0) + q;
    const kf = 'Frente ' + mv.frente;
    porFrente[kf] = (porFrente[kf] || 0) + q;
  }
  const barrasConsumo = (obj) => {
    const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    const mx = Math.max(1, ...keys.map((k) => Math.abs(obj[k])));
    return keys.length === 0
      ? '<div class="vacio" style="padding:20px">Sin consumo registrado aun.</div>'
      : keys.map((k) => `<div class="barra-row"><div class="barra-top"><span>${esc(k)}</span><span>${fmtNum(obj[k])}</span></div><div class="barra-bg"><div class="barra-fill" style="width:${(Math.abs(obj[k]) / mx) * 100}%"></div></div></div>`).join('');
  };
  if ($('#dash-consumo-contrato')) $('#dash-consumo-contrato').innerHTML = barrasConsumo(porContrato);
  if ($('#dash-consumo-frente')) $('#dash-consumo-frente').innerHTML = barrasConsumo(porFrente);
}
function cardHtml(label, valor, ic, warn) {
  return `<div class="card ${warn ? 'warn' : ''}"><div class="card-label">${label}</div><div class="card-valor">${valor}</div><div class="card-ic">${ic}</div></div>`;
}

/* ==================================================================
   INVENTARIO
   ================================================================== */
function llenarFiltroCategorias() {
  const sel = $('#filtro-categoria');
  if (!sel) return;
  const actual = sel.value;
  const set = new Set(estado.materiales.map((m) => m.categoria || 'Sin clasificar'));
  estado.categorias.forEach((c) => { if ((c.nombre || '').trim()) set.add(c.nombre.trim()); });
  const cats = Array.from(set).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">Todas las categorias</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = actual;
}
function materialesFiltrados() {
  const q = ($('#buscar-material').value || '').toLowerCase().trim();
  const cat = $('#filtro-categoria').value;
  return estado.materiales.filter((m) => {
    if (cat && (m.categoria || 'Sin clasificar') !== cat) return false;
    if (!q) return true;
    return [m.nombre, m.codigo, m.categoria, m.clase, m.ubicacion].some((v) => String(v || '').toLowerCase().includes(q));
  });
}
// Clases (subgrupos) ya usadas en el inventario, para autocompletar.
function clasesExistentes() {
  return Array.from(new Set(estado.materiales.map((m) => (m.clase || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
// Categorias (tipos) disponibles: las de la lista base + las ya usadas en el
// inventario. Permite elegir una existente o escribir una nueva.
function categoriasExistentes() {
  const s = new Set(CATEGORIAS);
  estado.materiales.forEach((m) => { if ((m.categoria || '').trim()) s.add(m.categoria.trim()); });
  estado.categorias.forEach((c) => { if ((c.nombre || '').trim()) s.add(c.nombre.trim()); });
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

// Pinta la lista de categorias dentro del modal de categorias (si esta abierto).
function renderListaCategorias() {
  const cont = $('#cat-lista');
  if (!cont) return;
  const all = categoriasExistentes();
  cont.innerHTML = all.map((nombre) => {
    const cat = estado.categorias.find((c) => (c.nombre || '').trim() === nombre);
    return `<div class="cat-item"><span>${esc(nombre)}</span>${cat
      ? `<button class="btn-icon peligro" title="Eliminar categoria" data-del-cat="${cat.id}">🗑</button>`
      : '<span class="cat-base">base</span>'}</div>`;
  }).join('');
  cont.querySelectorAll('[data-del-cat]').forEach((b) => b.addEventListener('click', async () => {
    try { await eliminarCategoria(b.dataset.delCat); toast('Categoria eliminada', 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }));
}

// Modal para crear (y quitar) categorias personalizadas.
function modalCategorias() {
  abrirModal('Categorias (tipos)', `
    <p style="color:var(--texto-dim);line-height:1.6;margin-bottom:12px">Crea categorias nuevas para clasificar tus materiales (por ejemplo "Cables y Conductores"). Quedan disponibles al crear o editar un material.</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input id="cat-nombre" placeholder="Nombre de la nueva categoria" style="flex:1" autocomplete="off" />
      <button class="btn-primary" id="cat-add">Agregar</button>
    </div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin-bottom:6px;font-weight:600">Categorias disponibles</label>
    <div id="cat-lista" class="cat-lista"></div>
    <div class="modal-acciones"><button class="btn-ghost" id="cat-cerrar">Cerrar</button></div>`);
  renderListaCategorias();
  const agregar = async () => {
    const nombre = $('#cat-nombre').value.trim();
    if (!nombre) { toast('Escribe el nombre de la categoria', 'error'); return; }
    if (categoriasExistentes().some((c) => c.toLowerCase() === nombre.toLowerCase())) { toast('Esa categoria ya existe', 'error'); return; }
    const btn = $('#cat-add'); btn.disabled = true;
    try { await agregarCategoria(nombre); $('#cat-nombre').value = ''; toast('Categoria creada', 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
    finally { btn.disabled = false; const inp = $('#cat-nombre'); if (inp) inp.focus(); }
  };
  $('#cat-add').addEventListener('click', agregar);
  $('#cat-nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
  $('#cat-cerrar').addEventListener('click', cerrarModal);
}
function filaMaterialHtml(m, clase, oculto) {
  return `
    <tr data-fila="${m.id}"${oculto ? ' hidden' : ''} title="Doble clic para mas opciones">
      <td class="codigo-cel">${esc(m.codigo || '-')}</td>
      <td>${esc(m.nombre)}${esBajoStock(m) ? '<span class="badge-bajo">STOCK BAJO</span>' : ''}</td>
      <td><span class="chip">${esc(clase)}</span></td>
      <td class="der ${esBajoStock(m) ? 'cant-bajo' : ''}">${fmtNum(m.cantidad)}</td>
      <td>${esc(m.unidad)}</td>
      <td class="der">${m.minimo ? fmtNum(m.minimo) : '-'}</td>
      <td>${esc(m.ubicacion || '-')}</td>
      <td class="cen"><div class="acciones-cel">
        <button class="btn-icon" title="Registrar movimiento" data-mov="${m.id}">⇄</button>
        <button class="btn-icon" title="Duplicar" data-duplicar="${m.id}">⧉</button>
        <button class="btn-icon" title="Editar" data-editar="${m.id}">✎</button>
        <button class="btn-icon peligro" title="Eliminar" data-eliminar="${m.id}">🗑</button>
      </div></td>
    </tr>`;
}
// Estado de grupos plegados en el inventario (por Tipo y por Clase).
const invColapsado = { tipos: new Set(), clases: new Set() };

function renderInventario() {
  if (!$('#cuerpo-inventario')) return;
  const lista = materialesFiltrados();
  $('#inv-vacio').hidden = estado.materiales.length !== 0;

  // Agrupar por Tipo (categoria) y, dentro, por Clase.
  const porTipo = {};
  for (const m of lista) {
    const tipo = m.categoria || 'Sin clasificar';
    const clase = (m.clase || '').trim() || 'Sin clase';
    porTipo[tipo] = porTipo[tipo] || {};
    (porTipo[tipo][clase] = porTipo[tipo][clase] || []).push(m);
  }
  // Incluir categorias creadas por el usuario aunque no tengan materiales aun.
  estado.categorias.forEach((c) => { const n = (c.nombre || '').trim(); if (n && !porTipo[n]) porTipo[n] = {}; });
  const tipos = Object.keys(porTipo).sort((a, b) => a.localeCompare(b));

  let html = '';
  for (const tipo of tipos) {
    const clases = Object.keys(porTipo[tipo]).sort((a, b) => a.localeCompare(b));
    const totalTipo = clases.reduce((s, c) => s + porTipo[tipo][c].length, 0);
    const tipoCerrado = invColapsado.tipos.has(tipo);
    html += `<tr class="inv-tipo ${tipoCerrado ? '' : 'abierto'}" data-toggle-tipo="${esc(tipo)}"><td colspan="8"><span class="caret">▸</span> ▦ ${esc(tipo)} <span class="conteo">(${totalTipo})</span></td></tr>`;
    if (clases.length === 0) {
      html += `<tr class="inv-vacio-grupo"${tipoCerrado ? ' hidden' : ''}><td colspan="8">Sin materiales todavia en esta categoria.</td></tr>`;
    }
    for (const clase of clases) {
      const mats = porTipo[tipo][clase].slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      const cKey = tipo + '||' + clase;
      const claseCerrada = invColapsado.clases.has(cKey);
      html += `<tr class="inv-clase ${claseCerrada ? '' : 'abierto'}" data-toggle-clase="${esc(cKey)}"${tipoCerrado ? ' hidden' : ''}><td colspan="8"><span class="caret">▸</span> ${esc(clase)} <span class="conteo">(${mats.length})</span></td></tr>`;
      const filasOcultas = tipoCerrado || claseCerrada;
      html += mats.map((m) => filaMaterialHtml(m, clase, filasOcultas)).join('');
    }
  }

  const cuerpo = $('#cuerpo-inventario');
  cuerpo.innerHTML = html;
  // Plegar / desplegar grupos
  cuerpo.querySelectorAll('[data-toggle-tipo]').forEach((el) => el.addEventListener('click', () => {
    const t = el.dataset.toggleTipo;
    if (invColapsado.tipos.has(t)) invColapsado.tipos.delete(t); else invColapsado.tipos.add(t);
    renderInventario();
  }));
  cuerpo.querySelectorAll('[data-toggle-clase]').forEach((el) => el.addEventListener('click', () => {
    const c = el.dataset.toggleClase;
    if (invColapsado.clases.has(c)) invColapsado.clases.delete(c); else invColapsado.clases.add(c);
    renderInventario();
  }));
  cuerpo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => modalMaterial(b.dataset.editar)));
  cuerpo.querySelectorAll('[data-eliminar]').forEach((b) => b.addEventListener('click', () => confirmarEliminar(b.dataset.eliminar)));
  cuerpo.querySelectorAll('[data-mov]').forEach((b) => b.addEventListener('click', () => modalMovimiento(b.dataset.mov)));
  cuerpo.querySelectorAll('[data-duplicar]').forEach((b) => b.addEventListener('click', () => duplicarMaterial(b.dataset.duplicar)));
  cuerpo.querySelectorAll('tr[data-fila]').forEach((row) => {
    row.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; menuMaterial(row.dataset.fila, e.clientX, e.clientY); });
  });
}

// Menu contextual al hacer doble clic en un material.
let menuCtxEl = null;
function cerrarMenuCtx() {
  if (menuCtxEl) { menuCtxEl.remove(); menuCtxEl = null; document.removeEventListener('click', cerrarMenuCtx); }
}
function menuMaterial(id, x, y) {
  const m = estado.materiales.find((mm) => mm.id === id);
  if (!m) return;
  cerrarMenuCtx();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-titulo">${esc(m.nombre)}</div>
    <button data-accion="mov">⇄ Registrar movimiento</button>
    <button data-accion="duplicar">⧉ Duplicar</button>
    <button data-accion="editar">✎ Editar</button>
    <button data-accion="eliminar" class="peligro">🗑 Eliminar</button>`;
  document.body.appendChild(menu);
  menuCtxEl = menu;
  const px = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
  const py = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = b.dataset.accion;
    cerrarMenuCtx();
    if (a === 'mov') modalMovimiento(id);
    else if (a === 'duplicar') duplicarMaterial(id);
    else if (a === 'editar') modalMaterial(id);
    else if (a === 'eliminar') confirmarEliminar(id);
  }));
  setTimeout(() => document.addEventListener('click', cerrarMenuCtx), 0);
}

// Abre el formulario como material NUEVO, precargado a partir de uno existente.
function duplicarMaterial(id) {
  const m = estado.materiales.find((x) => x.id === id);
  if (!m) return;
  modalMaterial(null, {
    codigo: '', nombre: (m.nombre || '') + ' (copia)', categoria: m.categoria,
    clase: m.clase || '', unidad: m.unidad, minimo: m.minimo, ubicacion: m.ubicacion, nota: m.nota, cantidad: ''
  });
}

function modalMaterial(id, prefill) {
  const m = id ? estado.materiales.find((x) => x.id === id) : null;
  const b = m || prefill || {};
  const editando = !!m;
  const listaClases = clasesExistentes();
  abrirModal(editando ? 'Editar material' : (prefill ? 'Duplicar material' : 'Nuevo material'), `
    <div class="form-grid">
      <div class="campo"><label>Codigo</label><input id="f-codigo" value="${esc(b.codigo || '')}" placeholder="Opcional" /></div>
      <div class="campo"><label>Unidad de medida</label><select id="f-unidad">${opcionesSelect(UNIDADES, b.unidad || 'unidad')}</select></div>
      <div class="campo full"><label>Nombre del material *</label><input id="f-nombre" value="${esc(b.nombre || '')}" placeholder="Ej: Cable THHN #12 AWG" /></div>
      <div class="campo"><label>Tipo (categoria)</label>
        <input id="f-categoria" list="lista-categorias" value="${esc(b.categoria || '')}" placeholder="Elige o escribe una nueva" autocomplete="off" />
        <datalist id="lista-categorias">${categoriasExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="campo"><label>Clase (subgrupo)</label>
        <input id="f-clase" list="lista-clases" value="${esc(b.clase || '')}" placeholder="Ej: Herramientas manuales" autocomplete="off" />
        <datalist id="lista-clases">${listaClases.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="campo"><label>Cantidad inicial (opcional)</label><input id="f-cantidad" type="number" step="any" min="0" placeholder="0" value="${b.cantidad != null ? b.cantidad : ''}" /></div>
      <div class="campo"><label>Stock minimo (alerta)</label><input id="f-minimo" type="number" step="any" min="0" value="${b.minimo != null ? b.minimo : 0}" /></div>
      <div class="campo full"><label>Ubicacion en almacen</label><input id="f-ubicacion" value="${esc(b.ubicacion || '')}" placeholder="Ej: Estante A-3" /></div>
      <div class="campo full"><label>Nota</label><textarea id="f-nota" placeholder="Opcional">${esc(b.nota || '')}</textarea></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="m-cancelar">Cancelar</button>
      ${editando ? '' : '<button class="btn-ghost" id="m-guardar-otro">Guardar y agregar otro</button>'}
      <button class="btn-primary" id="m-guardar">${editando ? 'Guardar cambios' : 'Agregar material'}</button>
    </div>`);

  const leerDatos = () => ({
    codigo: $('#f-codigo').value.trim(), nombre: $('#f-nombre').value.trim(),
    categoria: $('#f-categoria').value.trim() || 'Sin clasificar', clase: $('#f-clase').value.trim(),
    cantidad: $('#f-cantidad').value, unidad: $('#f-unidad').value, minimo: $('#f-minimo').value,
    ubicacion: $('#f-ubicacion').value.trim(), nota: $('#f-nota').value.trim()
  });
  const guardar = async (cerrar) => {
    const datos = leerDatos();
    if (!datos.nombre) { toast('El nombre del material es obligatorio', 'error'); return; }
    try {
      if (m) { await actualizarMaterial(m.id, datos); toast('Material actualizado', 'ok'); }
      else { await agregarMaterial(datos); toast('Material agregado', 'ok'); }
      if (cerrar) { cerrarModal(); return; }
      // "Guardar y agregar otro": conserva tipo/clase/unidad/ubicacion; limpia lo demas.
      $('#f-codigo').value = '';
      $('#f-nombre').value = '';
      $('#f-cantidad').value = '';
      const dl = $('#lista-clases');
      if (dl) dl.innerHTML = clasesExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('');
      const dlc = $('#lista-categorias');
      if (dlc) dlc.innerHTML = categoriasExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('');
      $('#f-nombre').focus();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  };

  $('#m-cancelar').addEventListener('click', cerrarModal);
  $('#m-guardar').addEventListener('click', () => guardar(true));
  if ($('#m-guardar-otro')) $('#m-guardar-otro').addEventListener('click', () => guardar(false));
}

function confirmarEliminar(id) {
  const m = estado.materiales.find((x) => x.id === id);
  if (!m) return;
  abrirModal('Eliminar material', `
    <p style="color:var(--texto-dim);line-height:1.6">Vas a eliminar <b style="color:#fff">${esc(m.nombre)}</b> del inventario. Esta accion no se puede deshacer.</p>
    <div class="modal-acciones">
      <button class="btn-ghost" id="del-cancelar">Cancelar</button>
      <button class="btn-primary" id="del-ok" style="background:linear-gradient(135deg,#ff5470,#c0392b);color:#fff">Si, eliminar</button>
    </div>`);
  $('#del-cancelar').addEventListener('click', cerrarModal);
  $('#del-ok').addEventListener('click', async () => {
    try { await eliminarMaterial(id); toast('Material eliminado', 'ok'); cerrarModal(); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   MOVIMIENTOS individuales
   ================================================================== */
function renderMovimientos() {
  if (!$('#cuerpo-mov')) return;
  const q = normTxt($('#buscar-mov').value || '');
  const tipo = $('#filtro-tipo-mov').value;
  const fFrente = (($('#filtro-frente-mov') || {}).value) || '';

  // 1) Agrupar por numero de orden. Los movimientos sin orden (sueltos)
  //    quedan como grupos individuales de un solo item.
  const grupos = [];
  const porOrden = {};
  for (const mv of estado.movimientos) {
    if (mv.ordenNumero) {
      let g = porOrden[mv.ordenNumero];
      if (!g) {
        g = porOrden[mv.ordenNumero] = {
          key: 'ord-' + mv.ordenNumero, esOrden: true,
          ordenNumero: mv.ordenNumero, ordenId: mv.ordenId || '',
          tipo: mv.tipo, fecha: mv.fecha, frente: mv.frente, contrato: mv.contrato,
          proveedor: mv.proveedor, responsable: mv.responsable, usuario: mv.usuario,
          movimientos: []
        };
        grupos.push(g);
      }
      g.movimientos.push(mv);
      if (mv.fecha && String(mv.fecha) > String(g.fecha || '')) g.fecha = mv.fecha;
    } else {
      grupos.push({
        key: 'mov-' + mv.id, esOrden: false,
        ordenNumero: '', ordenId: '',
        tipo: mv.tipo, fecha: mv.fecha, frente: mv.frente, contrato: mv.contrato,
        proveedor: mv.proveedor, responsable: mv.responsable, usuario: mv.usuario,
        movimientos: [mv]
      });
    }
  }

  // 2) Filtrar a nivel de grupo (asi la orden se conserva completa aunque el
  //    texto coincida con un solo material).
  const filtrados = grupos.filter((g) => {
    if (tipo && g.tipo !== tipo) return false;
    if (fFrente && (g.frente || '') !== fFrente) return false;
    if (!q) return true;
    const base = normTxt([g.ordenNumero, g.frente, g.contrato, g.proveedor, g.responsable, g.usuario].join(' '));
    if (base.includes(q)) return true;
    return g.movimientos.some((mv) => normTxt((mv.materialNombre || '') + ' ' + (mv.nota || '')).includes(q));
  });

  // 3) Ordenar por fecha, mas reciente primero.
  filtrados.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  $('#mov-vacio').hidden = estado.movimientos.length !== 0;

  const cuerpo = $('#cuerpo-mov');
  const mapa = {};
  filtrados.forEach((g) => { mapa[g.key] = g; });

  if (filtrados.length === 0) {
    cuerpo.innerHTML = estado.movimientos.length === 0 ? '' :
      '<tr><td colspan="8" class="cen" style="padding:22px;color:var(--texto-mute)">No hay movimientos que coincidan con el filtro.</td></tr>';
    return;
  }

  cuerpo.innerHTML = filtrados.map((g) => {
    const lugar = g.frente
      ? (esc(g.frente) + (g.contrato ? ` <span style="color:var(--texto-mute)">(${esc(g.contrato)})</span>` : ''))
      : esc(g.proveedor || '-');
    const idCol = g.esOrden
      ? `<span class="caret">▸</span> <b>${esc(g.ordenNumero)}</b>`
      : `<span class="caret">▸</span> <span style="color:var(--texto-mute)">Individual:</span> ${esc((g.movimientos[0] || {}).materialNombre || '-')}`;
    const acciones = g.esOrden
      ? `<button class="btn-icon" title="Imprimir orden" data-print-grupo="${g.key}">🖨</button>
         <button class="btn-icon peligro" title="Eliminar orden" data-del-grupo="${g.key}">🗑</button>`
      : `<button class="btn-icon" title="Imprimir comprobante" data-print-mov="${g.movimientos[0].id}">🖨</button>
         <button class="btn-icon peligro" title="Eliminar movimiento" data-del-mov="${g.movimientos[0].id}">🗑</button>`;
    const detalle = g.movimientos.map((mv) => `
      <tr><td>${esc(mv.materialNombre)}</td><td class="der"><b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</td><td>${esc(mv.nota || '-')}</td></tr>`).join('');
    return `
      <tr class="grupo-row" data-key="${g.key}" title="Doble clic para ver el detalle">
        <td>${fmtFecha(g.fecha)}</td>
        <td class="codigo-cel">${idCol}</td>
        <td><span class="tipo-badge ${g.tipo}">${(TIPOS[g.tipo] || {}).label || g.tipo}</span></td>
        <td class="cen">${g.movimientos.length}</td>
        <td>${lugar}</td>
        <td>${esc(g.responsable || '-')}</td>
        <td>${esc(g.usuario || '-')}</td>
        <td class="cen"><div class="acciones-cel">${acciones}</div></td>
      </tr>
      <tr class="grupo-detalle" data-key="${g.key}" hidden>
        <td colspan="8">
          <table class="tabla-detalle">
            <thead><tr><th>Material</th><th class="der">Cantidad</th><th>Nota</th></tr></thead>
            <tbody>${detalle}</tbody>
          </table>
        </td>
      </tr>`;
  }).join('');

  // Expandir / colapsar el detalle con doble clic en la fila (o clic en la ▸).
  const toggle = (row) => {
    const det = row.nextElementSibling;
    if (det && det.classList.contains('grupo-detalle')) {
      det.hidden = !det.hidden;
      row.classList.toggle('abierto', !det.hidden);
    }
  };
  cuerpo.querySelectorAll('tr.grupo-row').forEach((row) => {
    row.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; toggle(row); });
    const caret = row.querySelector('.caret');
    if (caret) caret.addEventListener('click', (e) => { e.stopPropagation(); toggle(row); });
  });
  cuerpo.querySelectorAll('[data-print-grupo]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); imprimirGrupo(mapa[b.dataset.printGrupo]); }));
  cuerpo.querySelectorAll('[data-del-grupo]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); const g = mapa[b.dataset.delGrupo]; const o = ordenDeGrupo(g); if (o) confirmarEliminarOrden(o); else toast('No se encontro la orden asociada.', 'error'); }));
  cuerpo.querySelectorAll('[data-print-mov]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); imprimirMovimiento(b.dataset.printMov); }));
  cuerpo.querySelectorAll('[data-del-mov]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); confirmarEliminarMovimiento(b.dataset.delMov); }));
}

// Devuelve la orden (de estado.ordenes) asociada a un grupo, si aun existe.
function ordenDeGrupo(g) {
  if (!g) return null;
  return estado.ordenes.find((o) => (g.ordenId && o.id === g.ordenId) || (g.ordenNumero && o.numero === g.ordenNumero)) || null;
}
// Imprime el documento de un grupo: la orden completa si existe, o una
// reconstruccion a partir de sus movimientos si la orden ya fue borrada.
function imprimirGrupo(g) {
  if (!g) return;
  if (!g.esOrden) { imprimirMovimiento(g.movimientos[0].id); return; }
  const orden = ordenDeGrupo(g);
  if (orden) { imprimir(docOrden(orden, orden.usuario || nombreUsuario()), (orden.tipo === 'entrada' ? 'Pedido_' : 'Orden_') + orden.numero); return; }
  const pseudo = {
    numero: g.ordenNumero, tipo: g.tipo, frente: g.frente, contrato: g.contrato,
    proveedor: g.proveedor, responsable: g.responsable,
    nota: (g.movimientos[0] || {}).nota, fecha: g.fecha,
    items: g.movimientos.map((m) => ({ materialNombre: m.materialNombre, cantidad: m.cantidad, unidad: m.unidad }))
  };
  imprimir(docOrden(pseudo, g.usuario || nombreUsuario()), 'Orden_' + (g.ordenNumero || 'mov'));
}

// Filtro del tipo de movimiento (agregar devolucion a la lista existente)
function prepararFiltroTipoMov() {
  const sel = $('#filtro-tipo-mov');
  if (sel) sel.innerHTML = `<option value="">Todos</option><option value="entrada">Entradas</option><option value="salida">Salidas</option><option value="devolucion">Devoluciones</option>`;
}

function segTipoHtml(sel) {
  return `<div class="seg" id="seg-tipo">
    <button type="button" data-t="salida" class="${sel === 'salida' ? 'on' : ''}">📤 Salida</button>
    <button type="button" data-t="entrada" class="${sel === 'entrada' ? 'on' : ''}">📥 Entrada</button>
    <button type="button" data-t="devolucion" class="${sel === 'devolucion' ? 'on' : ''}">🔄 Devolucion</button>
  </div>`;
}

function modalMovimiento(materialId) {
  if (estado.materiales.length === 0) { toast('Primero agrega materiales al inventario', 'error'); return; }
  let tipoSel = 'salida';
  const opciones = estado.materiales.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    .map((m) => `<option value="${m.id}" ${m.id === materialId ? 'selected' : ''}>${esc(m.nombre)} (${fmtNum(m.cantidad)} ${esc(m.unidad)})</option>`).join('');

  abrirModal('Registrar movimiento', `
    <div class="campo full" style="margin-bottom:14px"><label>Tipo de movimiento</label>${segTipoHtml('salida')}</div>
    <div class="campo full" style="margin-bottom:14px"><label>Material</label><select id="mv-material">${opciones}</select></div>
    <div class="form-grid">
      <div class="campo"><label>Cantidad *</label><input id="mv-cantidad" type="number" step="any" min="0" placeholder="0" /></div>
      <div class="campo" id="mv-campo-lugar"></div>
      <div class="campo full"><label>Responsable</label><input id="mv-responsable" placeholder="Nombre de quien recibe / entrega" /></div>
      <div class="campo full"><label>Nota</label><input id="mv-nota" placeholder="Opcional" /></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="mv-cancelar">Cancelar</button>
      <button class="btn-primary" id="mv-guardar">Registrar</button>
    </div>`);

  const renderLugar = () => {
    const cont = $('#mv-campo-lugar');
    if (tipoSel === 'entrada') {
      cont.innerHTML = `<label>Proveedor</label><input id="mv-proveedor" placeholder="Nombre del proveedor" style="margin-bottom:10px" />`
        + `<label>Frente de obra (opcional)</label>${frenteSelectHtml('mv-frente', '')}`;
    } else {
      cont.innerHTML = `<label>Frente de obra (opcional)</label>${frenteSelectHtml('mv-frente', '')}`;
    }
  };
  renderLugar();
  $('#seg-tipo').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    tipoSel = b.dataset.t;
    $('#seg-tipo').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); renderLugar();
  }));

  $('#mv-cancelar').addEventListener('click', cerrarModal);
  $('#mv-guardar').addEventListener('click', async () => {
    const mat = estado.materiales.find((x) => x.id === $('#mv-material').value);
    const cantidad = parseFloat($('#mv-cantidad').value);
    if (!mat || !cantidad || cantidad <= 0) { toast('Ingresa una cantidad valida', 'error'); return; }
    if (tipoSel === 'salida' && cantidad > (Number(mat.cantidad) || 0)) { toast('No hay suficiente stock. Disponible: ' + fmtNum(mat.cantidad) + ' ' + mat.unidad, 'error'); return; }
    const frenteVal = (($('#mv-frente') || {}).value || '').trim();
    const proveedorVal = (($('#mv-proveedor') || {}).value || '').trim();
    if ((tipoSel === 'salida' || tipoSel === 'devolucion') && !frenteVal) {
      if (!confirm('Estas registrando este movimiento SIN frente de obra. Deseas continuar?')) return;
    }
    try {
      await registrarMovimiento({
        tipo: tipoSel, materialId: mat.id, materialNombre: mat.nombre, cantidad, unidad: mat.unidad,
        frente: frenteVal,
        contrato: contratoDeFrente(frenteVal),
        proveedor: proveedorVal,
        responsable: $('#mv-responsable').value.trim(), nota: $('#mv-nota').value.trim(), usuario: nombreUsuario()
      });
      toast('Movimiento registrado', 'ok'); cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   ORDENES (varios materiales)
   ================================================================== */
function estadoOrden(o) {
  return o.estado || (o.tipo === 'entrada' ? 'recibido' : 'completado');
}
function etiquetaEstado(est) {
  return est === 'pendiente' ? 'Pendiente' : est === 'recibido' ? 'Recibido' : 'Completado';
}
// Etiqueta y clase del estado, considerando el resumen de recepcion.
function estadoOrdenInfo(o) {
  const est = estadoOrden(o);
  const r = o.recepcion && o.recepcion.resumen;
  if (r === 'falta') return { cls: 'falta', label: 'Recibido / falta' };
  if (r === 'adicion') return { cls: 'adicion', label: 'Recibido / adicion' };
  if (r === 'mixto') return { cls: 'mixto', label: 'Recibido / falta + adicion' };
  return { cls: est, label: etiquetaEstado(est) };
}
// Contenido del detalle desplegable de una orden.
function detalleOrdenHtml(o) {
  if (o.recepcion) {
    const rec = o.recepcion;
    const filas = (rec.lineas || []).map((l) => {
      const dif = (Number(l.recibido) || 0) - (Number(l.pedido) || 0);
      const badge = dif < 0 ? `<span style="color:#ff9db0">Falta ${fmtNum(-dif)}</span>`
        : dif > 0 ? `<span style="color:#7ee6a8">+${fmtNum(dif)}</span>`
        : '<span style="color:var(--texto-mute)">OK</span>';
      return `<tr><td>${esc(l.materialNombre)}</td><td class="der">${fmtNum(l.pedido)} ${esc(l.unidad || '')}</td><td class="der"><b>${fmtNum(l.recibido)}</b></td><td>${badge}</td></tr>`;
    }).join('');
    const adic = (rec.adiciones || []).map((a) =>
      `<tr><td>${esc(a.materialNombre)}${a.nuevo ? ' <span class="cat-base">nuevo</span>' : ''}</td><td class="der"><b>${fmtNum(a.cantidad)}</b> ${esc(a.unidad || '')}</td></tr>`).join('');
    return `
      <table class="tabla-detalle">
        <thead><tr><th>Material</th><th class="der">Pedido</th><th class="der">Recibido</th><th>Estado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="4" style="color:var(--texto-mute)">Sin materiales.</td></tr>'}</tbody>
      </table>
      ${adic ? `<div class="rec-adic-tit">Adiciones (llegaron de mas o materiales nuevos)</div>
      <table class="tabla-detalle"><thead><tr><th>Material</th><th class="der">Cantidad</th></tr></thead><tbody>${adic}</tbody></table>` : ''}
      ${o.nota ? `<div style="padding:6px 12px 4px;font-size:12px;color:var(--texto-dim)"><b>Nota:</b> ${esc(o.nota)}</div>` : ''}`;
  }
  const detalle = (o.items || []).map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td class="der"><b>${fmtNum(it.cantidad)}</b> ${esc(it.unidad || '')}</td></tr>`).join('');
  return `
    <table class="tabla-detalle">
      <thead><tr><th>#</th><th>Material</th><th class="der">Cantidad</th></tr></thead>
      <tbody>${detalle || '<tr><td colspan="3" style="color:var(--texto-mute)">Sin materiales.</td></tr>'}</tbody>
    </table>
    ${o.nota ? `<div style="padding:6px 12px 4px;font-size:12px;color:var(--texto-dim)"><b>Nota:</b> ${esc(o.nota)}</div>` : ''}`;
}
function renderOrdenes() {
  if (!$('#cuerpo-ordenes')) return;
  $('#ord-vacio').hidden = estado.ordenes.length !== 0;
  $('#cuerpo-ordenes').innerHTML = estado.ordenes.map((o) => {
    const est = estadoOrden(o);
    const pendiente = (o.tipo === 'entrada' && est === 'pendiente');
    const contrato = o.contrato || contratoDeFrente(o.frente);
    const info = estadoOrdenInfo(o);
    return `
    <tr class="grupo-row" data-key="${o.id}" title="Doble clic para ver el detalle">
      <td class="codigo-cel"><span class="caret">▸</span> ${esc(o.numero)}</td>
      <td>${fmtFecha(o.fecha)}</td>
      <td><span class="tipo-badge ${o.tipo}">${(TIPOS[o.tipo] || {}).label || o.tipo}</span></td>
      <td><span class="estado-badge ${info.cls}">${info.label}</span></td>
      <td>${esc(o.responsable || '-')}</td>
      <td>${o.frente ? (esc(o.frente) + (contrato ? ` <span style="color:var(--texto-mute)">(${esc(contrato)})</span>` : '')) : esc(o.proveedor || '-')}</td>
      <td class="der">${(o.items || []).length}</td>
      <td class="cen"><div class="acciones-cel">
        ${pendiente ? `<button class="btn-icon" title="Recibir / verificar llegada" data-recibir="${o.id}">📥✓</button>` : ''}
        <button class="btn-icon" title="Repetir esta orden" data-repetir="${o.id}">🔁</button>
        <button class="btn-icon" title="Imprimir" data-print-orden="${o.id}">🖨</button>
        <button class="btn-icon peligro" title="Eliminar orden" data-del-orden="${o.id}">🗑</button>
      </div></td>
    </tr>
    <tr class="grupo-detalle" data-key="${o.id}" hidden>
      <td colspan="8">${detalleOrdenHtml(o)}</td>
    </tr>`;
  }).join('');
  // Expandir / colapsar el detalle con doble clic en la fila (o clic en la ▸).
  const toggleOrd = (row) => {
    const det = row.nextElementSibling;
    if (det && det.classList.contains('grupo-detalle')) {
      det.hidden = !det.hidden;
      row.classList.toggle('abierto', !det.hidden);
    }
  };
  $('#cuerpo-ordenes').querySelectorAll('tr.grupo-row').forEach((row) => {
    row.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; toggleOrd(row); });
    const caret = row.querySelector('.caret');
    if (caret) caret.addEventListener('click', (e) => { e.stopPropagation(); toggleOrd(row); });
  });
  $('#cuerpo-ordenes').querySelectorAll('[data-print-orden]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = estado.ordenes.find((x) => x.id === b.dataset.printOrden);
      if (o) imprimir(docOrden(o, o.usuario || nombreUsuario()), (o.tipo === 'entrada' ? 'Pedido_' : 'Orden_') + o.numero);
    }));
  $('#cuerpo-ordenes').querySelectorAll('[data-recibir]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = estado.ordenes.find((x) => x.id === b.dataset.recibir);
      if (o) modalRecibir(o);
    }));
  $('#cuerpo-ordenes').querySelectorAll('[data-del-orden]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = estado.ordenes.find((x) => x.id === b.dataset.delOrden);
      if (o) confirmarEliminarOrden(o);
    }));
  $('#cuerpo-ordenes').querySelectorAll('[data-repetir]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = estado.ordenes.find((x) => x.id === b.dataset.repetir);
      if (o) repetirOrden(o);
    }));
}

// Abre "Nueva orden" precargada con los materiales de una orden existente,
// para volver a despacharla ajustando solo lo necesario.
function repetirOrden(orden) {
  if (!orden) return;
  const items = (orden.items || [])
    .filter((it) => estado.materiales.some((m) => m.id === it.materialId))
    .map((it) => ({ materialId: it.materialId, cantidad: it.cantidad }));
  const faltan = (orden.items || []).length - items.length;
  const precarga = {
    frente: orden.frente || '',
    proveedor: orden.proveedor || '',
    responsable: orden.responsable || '',
    nota: orden.nota || '',
    items: items.length ? items : [{ materialId: '', cantidad: '' }]
  };
  modalOrden(orden.tipo, precarga);
  if (faltan > 0) toast(faltan + ' material(es) de la orden original ya no existen y no se cargaron', 'error');
}

function modalRecibir(orden) {
  const items = orden.items || [];
  estado.itemsAdicion = [];
  abrirModal('Recibir pedido — ' + orden.numero, `
    <p style="color:var(--texto-dim);margin-bottom:12px;line-height:1.5">Ajusta la cantidad <b>recibida</b> de cada material (puede llegar menos o mas de lo pedido). Si llego algo que no estaba en el pedido, agregalo en <b>Adiciones</b>; alli tambien puedes crear un material nuevo.</p>

    <label class="rec-sub">Materiales pedidos</label>
    <div id="recibir-items">
      ${items.map((it, i) => `
        <div class="rec-row" data-i="${i}">
          <div class="rec-mat">${esc(it.materialNombre)} <span style="color:var(--texto-mute)">(pedido: ${fmtNum(it.cantidad)} ${esc(it.unidad)})</span></div>
          <input type="number" step="any" min="0" value="${it.cantidad}" data-recib="${i}" title="Cantidad recibida" />
        </div>`).join('')}
    </div>

    <label class="rec-sub" style="margin-top:16px">Adiciones (llego de mas o material nuevo)</label>
    <div class="orden-items" id="adic-items"></div>
    <button class="btn-ghost orden-add" id="adic-add">＋ Agregar adicion</button>

    <div class="modal-acciones">
      <button class="btn-ghost" id="rec-cancelar">Cancelar</button>
      <button class="btn-primary" id="rec-ok">Confirmar recepcion</button>
    </div>
    <datalist id="lista-categorias-rec">${categoriasExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
    <datalist id="lista-clases-rec">${clasesExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`, '660px');

  const opcionesAdic = (sel, filtro) =>
    '<option value="">— Elige del inventario —</option><option value="__nuevo__"' + (sel === '__nuevo__' ? ' selected' : '') + '>➕ Material nuevo...</option>' +
    opcionesMaterialAgrupadas(sel, filtro, true);

  const renderAdic = () => {
    const cont = $('#adic-items');
    cont.innerHTML = estado.itemsAdicion.map((it) => {
      const nuevo = it.materialId === '__nuevo__';
      return `
      <div class="adic-row" data-row="${it._id}">
        <div class="adic-linea">
          <div class="mat-picker">
            <input type="text" class="mat-filtro" placeholder="🔎 Filtrar inventario" data-campo="filtro" value="${esc(it._filtro || '')}"${nuevo ? ' style="display:none"' : ''} />
            <select data-campo="materialId">${opcionesAdic(it.materialId, it._filtro)}</select>
          </div>
          <input type="number" step="any" min="0" placeholder="Cantidad" data-campo="cantidad" value="${it.cantidad}" />
          <button class="btn-icon peligro" data-quitar="${it._id}" title="Quitar">✕</button>
        </div>
        <div class="adic-nuevo"${nuevo ? '' : ' hidden'}>
          <input type="text" data-campo="nuevoNombre" placeholder="Nombre del material nuevo *" value="${esc(it.nuevoNombre || '')}" />
          <select data-campo="nuevoUnidad">${opcionesSelect(UNIDADES, it.nuevoUnidad || 'unidad')}</select>
          <input type="text" list="lista-categorias-rec" data-campo="nuevoCategoria" placeholder="Tipo (categoria)" value="${esc(it.nuevoCategoria || '')}" />
          <input type="text" list="lista-clases-rec" data-campo="nuevoClase" placeholder="Clase (opcional)" value="${esc(it.nuevoClase || '')}" />
        </div>
      </div>`;
    }).join('');
    cont.querySelectorAll('.adic-row').forEach((row) => {
      const id = Number(row.dataset.row);
      const item = estado.itemsAdicion.find((x) => x._id === id);
      const selEl = row.querySelector('select[data-campo="materialId"]');
      const filtroEl = row.querySelector('.mat-filtro');
      if (filtroEl) filtroEl.addEventListener('input', () => { item._filtro = filtroEl.value; selEl.innerHTML = opcionesAdic(item.materialId, item._filtro); });
      selEl.addEventListener('change', () => { item.materialId = selEl.value; renderAdic(); });
      row.querySelector('input[data-campo="cantidad"]').addEventListener('input', (e) => { item.cantidad = e.target.value; });
      const nn = row.querySelector('[data-campo="nuevoNombre"]'); if (nn) nn.addEventListener('input', (e) => { item.nuevoNombre = e.target.value; });
      const nu = row.querySelector('[data-campo="nuevoUnidad"]'); if (nu) nu.addEventListener('change', (e) => { item.nuevoUnidad = e.target.value; });
      const nc = row.querySelector('[data-campo="nuevoCategoria"]'); if (nc) nc.addEventListener('input', (e) => { item.nuevoCategoria = e.target.value; });
      const ncl = row.querySelector('[data-campo="nuevoClase"]'); if (ncl) ncl.addEventListener('input', (e) => { item.nuevoClase = e.target.value; });
      row.querySelector('[data-quitar]').addEventListener('click', () => { estado.itemsAdicion = estado.itemsAdicion.filter((x) => x._id !== id); renderAdic(); });
    });
  };
  renderAdic();

  $('#adic-add').addEventListener('click', () => {
    estado.itemsAdicion.push({ _id: Date.now() + Math.random(), materialId: '', cantidad: '', _filtro: '', nuevoNombre: '', nuevoUnidad: 'unidad', nuevoCategoria: '', nuevoClase: '' });
    renderAdic();
  });
  $('#rec-cancelar').addEventListener('click', cerrarModal);
  $('#rec-ok').addEventListener('click', async () => {
    const lineas = items.map((it, i) => {
      const inp = $('#recibir-items [data-recib="' + i + '"]');
      return { materialId: it.materialId, materialNombre: it.materialNombre, unidad: it.unidad, pedido: Number(it.cantidad) || 0, recibido: parseFloat(inp ? inp.value : 0) || 0 };
    });
    const adiciones = [];
    for (const it of estado.itemsAdicion) {
      const cantidad = parseFloat(it.cantidad) || 0;
      if (cantidad <= 0) continue;
      if (it.materialId === '__nuevo__') {
        const nombre = (it.nuevoNombre || '').trim();
        if (!nombre) { toast('Ponle nombre al material nuevo de las adiciones', 'error'); return; }
        adiciones.push({ nuevo: true, materialNombre: nombre, unidad: it.nuevoUnidad || 'unidad', cantidad, categoria: (it.nuevoCategoria || '').trim() || 'Sin clasificar', clase: (it.nuevoClase || '').trim() });
      } else if (it.materialId) {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        adiciones.push({ nuevo: false, materialId: it.materialId, materialNombre: m ? m.nombre : '', unidad: m ? m.unidad : 'unidad', cantidad });
      }
    }
    const total = lineas.reduce((s, l) => s + l.recibido, 0) + adiciones.reduce((s, a) => s + a.cantidad, 0);
    if (total <= 0) { toast('Ingresa al menos una cantidad recibida', 'error'); return; }
    const btn = $('#rec-ok'); btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await recibirOrden(orden, { lineas, adiciones }, nombreUsuario());
      toast('Recepcion registrada y stock actualizado', 'ok');
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar recepcion'; }
  });
}

/* ---- Borrador de orden (autoguardado en el equipo) + opciones agrupadas ---- */
function normTxt(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function claveBorradorOrden(tipo) { return 'fviecom_borrador_orden_' + tipo; }
function guardarBorradorOrden(tipo) {
  try {
    const d = {
      frente: (($('#o-frente') || {}).value) || '',
      proveedor: (($('#o-proveedor') || {}).value) || '',
      responsable: (($('#o-responsable') || {}).value) || '',
      nota: (($('#o-nota') || {}).value) || '',
      items: (estado.itemsOrden || []).map((it) => ({ materialId: it.materialId || '', cantidad: it.cantidad || '' })),
      ts: Date.now()
    };
    const hayAlgo = d.frente || d.proveedor || d.responsable || d.nota ||
      d.items.some((it) => it.materialId || (it.cantidad !== '' && it.cantidad != null));
    if (hayAlgo) localStorage.setItem(claveBorradorOrden(tipo), JSON.stringify(d));
    else localStorage.removeItem(claveBorradorOrden(tipo));
  } catch (e) { /* localStorage no disponible: se ignora */ }
}
function leerBorradorOrden(tipo) {
  try { return JSON.parse(localStorage.getItem(claveBorradorOrden(tipo)) || 'null'); }
  catch (e) { return null; }
}
function limpiarBorradorOrden(tipo) {
  try { localStorage.removeItem(claveBorradorOrden(tipo)); } catch (e) { /* ignore */ }
}
// Opciones del <select> de material, agrupadas por categoria (optgroup) y
// filtradas por el texto escrito. El material ya seleccionado se conserva
// visible aunque no coincida con el filtro.
function opcionesMaterialAgrupadas(sel, filtro, sinPlaceholder) {
  const q = normTxt(filtro);
  const grupos = {};
  for (const m of estado.materiales) {
    if (q) {
      const texto = normTxt((m.nombre || '') + ' ' + (m.codigo || '') + ' ' + (m.categoria || ''));
      if (!texto.includes(q) && m.id !== sel) continue;
    }
    const c = m.categoria || 'Sin clasificar';
    (grupos[c] = grupos[c] || []).push(m);
  }
  const cats = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
  let html = sinPlaceholder ? '' : '<option value="">— Elige material —</option>';
  for (const c of cats) {
    html += `<optgroup label="${esc(c)}">`;
    grupos[c].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    for (const m of grupos[c]) {
      html += `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.nombre)} (${fmtNum(m.cantidad)} ${esc(m.unidad)})</option>`;
    }
    html += `</optgroup>`;
  }
  if (cats.length === 0) html += '<option value="" disabled>(sin coincidencias)</option>';
  return html;
}

function modalOrden(tipo, precarga) {
  if (estado.materiales.length === 0) { toast('Primero agrega materiales al inventario', 'error'); return; }
  const t = TIPOS[tipo] || TIPOS.salida;
  const esProveedor = t.campo === 'proveedor';

  // Fuente de datos: 'precarga' (al repetir una orden) tiene prioridad; si no,
  // se recupera el borrador de lo que se estaba llenando.
  const borrador = precarga ? null : leerBorradorOrden(tipo);
  const base = precarga || borrador;
  if (base && Array.isArray(base.items) && base.items.length) {
    estado.itemsOrden = base.items.map((it, i) => ({ _id: Date.now() + i, materialId: it.materialId || '', cantidad: it.cantidad || '', _filtro: '' }));
  } else {
    estado.itemsOrden = [{ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' }];
  }

  abrirModal('Nueva orden — ' + t.label, `
    ${borrador ? `<div class="orden-aviso">📝 Recuperamos una orden sin terminar. <button type="button" id="o-nuevo" class="link-btn">Empezar de nuevo</button></div>` : ''}
    ${precarga ? `<div class="orden-aviso">🔁 Orden copiada. Ajusta lo que necesites y genera una nueva.</div>` : ''}
    <div class="form-grid">
      ${esProveedor ? `<div class="campo"><label>Proveedor</label><input id="o-proveedor" placeholder="Nombre del proveedor" /></div>` : ''}
      <div class="campo"><label>Frente de obra (opcional)</label>${frenteSelectHtml('o-frente', base ? (base.frente || '') : '')}</div>
      <div class="campo"><label>Responsable</label><input id="o-responsable" placeholder="Nombre del responsable" /></div>
      <div class="campo full"><label>Nota (opcional)</label><input id="o-nota" placeholder="Observaciones de la orden" /></div>
    </div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin:14px 0 6px;font-weight:600">Materiales / Herramientas</label>
    ${estado.kits.length ? `<div class="kit-cargar">
      <select id="o-kit"><option value="">— Elegir un kit —</option>${estado.kits.map((k) => `<option value="${k.id}">${esc(k.nombre)} (${(k.items || []).length})</option>`).join('')}</select>
      <button type="button" class="btn-ghost" id="o-cargar-kit">📦 Cargar kit</button>
    </div>` : ''}
    <div class="orden-items" id="orden-items"></div>
    <button class="btn-ghost orden-add" id="o-add">＋ Agregar material</button>
    <div class="orden-total" id="o-total"></div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="o-cancelar">Cancelar</button>
      <button class="btn-primary" id="o-guardar">Generar e imprimir</button>
    </div>`, '640px');

  // Restaurar los textos (del borrador o de la orden copiada).
  if (base) {
    if ($('#o-proveedor')) $('#o-proveedor').value = base.proveedor || '';
    if ($('#o-responsable')) $('#o-responsable').value = base.responsable || '';
    if ($('#o-nota')) $('#o-nota').value = base.nota || '';
  }

  const persistir = () => guardarBorradorOrden(tipo);

  const render = () => {
    const cont = $('#orden-items');
    cont.innerHTML = estado.itemsOrden.map((it) => `
      <div class="orden-item-row" data-row="${it._id}">
        <div class="mat-picker">
          <input type="text" class="mat-filtro" placeholder="🔎 Escribe para filtrar (nombre, codigo o categoria)" data-campo="filtro" value="${esc(it._filtro || '')}" />
          <select data-campo="materialId">${opcionesMaterialAgrupadas(it.materialId, it._filtro)}</select>
        </div>
        <input type="number" step="any" min="0" placeholder="Cantidad" data-campo="cantidad" value="${it.cantidad}" />
        <button class="btn-icon peligro" data-quitar="${it._id}" title="Quitar">✕</button>
      </div>`).join('');
    cont.querySelectorAll('.orden-item-row').forEach((row) => {
      const id = Number(row.dataset.row);
      const item = estado.itemsOrden.find((x) => x._id === id);
      const selEl = row.querySelector('select[data-campo="materialId"]');
      const filtroEl = row.querySelector('.mat-filtro');
      const cantEl = row.querySelector('input[data-campo="cantidad"]');
      // Filtrar en vivo: solo se reconstruyen las opciones del select, sin
      // volver a dibujar toda la fila, para no perder el foco del teclado.
      filtroEl.addEventListener('input', () => {
        item._filtro = filtroEl.value;
        selEl.innerHTML = opcionesMaterialAgrupadas(item.materialId, item._filtro);
      });
      selEl.addEventListener('change', () => { item.materialId = selEl.value; actualizarTotal(); persistir(); });
      cantEl.addEventListener('input', () => { item.cantidad = cantEl.value; actualizarTotal(); persistir(); });
      row.querySelector('[data-quitar]').addEventListener('click', () => {
        estado.itemsOrden = estado.itemsOrden.filter((x) => x._id !== id);
        if (estado.itemsOrden.length === 0) estado.itemsOrden.push({ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' });
        render(); persistir();
      });
    });
    actualizarTotal();
  };
  const actualizarTotal = () => {
    const n = estado.itemsOrden.filter((it) => it.materialId && Number(it.cantidad) > 0).length;
    $('#o-total').textContent = n > 0 ? `${n} material(es) en la orden.` : 'Agrega al menos un material con cantidad.';
  };
  render();

  // Guardar el borrador cuando cambian los campos de cabecera.
  ['o-frente', 'o-responsable', 'o-proveedor', 'o-nota'].forEach((cid) => {
    const el = $('#' + cid);
    if (el) { el.addEventListener('change', persistir); el.addEventListener('input', persistir); }
  });

  // "Empezar de nuevo": descarta el borrador y reabre limpio.
  if ($('#o-nuevo')) $('#o-nuevo').addEventListener('click', () => { limpiarBorradorOrden(tipo); cerrarModal(); modalOrden(tipo); });

  // Cargar un kit: agrega sus materiales a la orden (sin borrar lo ya puesto).
  if ($('#o-cargar-kit')) $('#o-cargar-kit').addEventListener('click', () => {
    const kit = estado.kits.find((k) => k.id === $('#o-kit').value);
    if (!kit) { toast('Elige un kit de la lista', 'error'); return; }
    const nuevos = (kit.items || [])
      .filter((it) => estado.materiales.some((m) => m.id === it.materialId))
      .map((it) => ({ _id: Date.now() + Math.random(), materialId: it.materialId, cantidad: it.cantidad, _filtro: '' }));
    if (nuevos.length === 0) { toast('Los materiales de este kit ya no existen en el inventario', 'error'); return; }
    estado.itemsOrden = estado.itemsOrden.filter((it) => it.materialId || (it.cantidad !== '' && it.cantidad != null));
    estado.itemsOrden = estado.itemsOrden.concat(nuevos);
    if (estado.itemsOrden.length === 0) estado.itemsOrden.push({ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' });
    render(); persistir();
    toast('Kit "' + kit.nombre + '" cargado', 'ok');
  });

  $('#o-add').addEventListener('click', () => { estado.itemsOrden.push({ _id: Date.now() + Math.random(), materialId: '', cantidad: '', _filtro: '' }); render(); persistir(); });
  $('#o-cancelar').addEventListener('click', cerrarModal);
  $('#o-guardar').addEventListener('click', async () => {
    const items = estado.itemsOrden
      .filter((it) => it.materialId && Number(it.cantidad) > 0)
      .map((it) => { const m = estado.materiales.find((x) => x.id === it.materialId); return { materialId: it.materialId, materialNombre: m ? m.nombre : '', cantidad: Number(it.cantidad), unidad: m ? m.unidad : 'unidad' }; });
    if (items.length === 0) { toast('Agrega al menos un material con cantidad', 'error'); return; }
    // Validar stock en salidas
    if (tipo === 'salida') {
      for (const it of items) {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        if (m && it.cantidad > (Number(m.cantidad) || 0)) { toast(`Stock insuficiente de "${m.nombre}" (disp: ${fmtNum(m.cantidad)})`, 'error'); return; }
      }
    }
    const frenteVal = (($('#o-frente') || {}).value || '').trim();
    const proveedorVal = (($('#o-proveedor') || {}).value || '').trim();
    if ((tipo === 'salida' || tipo === 'devolucion') && !frenteVal) {
      if (!confirm('Estas generando esta orden SIN frente de obra. Deseas continuar?')) return;
    }
    const btn = $('#o-guardar'); btn.disabled = true; btn.textContent = 'Generando...';
    try {
      const orden = await registrarOrden({
        tipo,
        frente: frenteVal,
        contrato: contratoDeFrente(frenteVal),
        proveedor: proveedorVal,
        responsable: $('#o-responsable').value.trim(),
        nota: $('#o-nota').value.trim(),
        usuario: nombreUsuario(), items
      });
      limpiarBorradorOrden(tipo);
      cerrarModal();
      toast(tipo === 'entrada' ? ('Pedido generado (pendiente de recibir): ' + orden.numero) : ('Orden generada: ' + orden.numero), 'ok');
      imprimir(docOrden(orden, orden.usuario || nombreUsuario()), (tipo === 'entrada' ? 'Pedido_' : 'Orden_') + orden.numero);
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Generar e imprimir'; }
  });
}

/* ==================================================================
   ELIMINAR (limpieza de datos de prueba)
   ================================================================== */
function confirmarEliminarMovimiento(id) {
  const mv = estado.movimientos.find((x) => x.id === id);
  if (!mv) return;
  const mat = estado.materiales.find((x) => x.id === mv.materialId);
  const existeMat = !!mat;
  const esSalida = mv.tipo === 'salida';
  const accionStock = esSalida
    ? `se <b>devolveran ${fmtNum(mv.cantidad)} ${esc(mv.unidad || '')}</b> al stock`
    : `se <b>descontaran ${fmtNum(mv.cantidad)} ${esc(mv.unidad || '')}</b> del stock`;
  const bloqueStock = existeMat
    ? `<label style="display:flex;align-items:center;gap:8px;margin-top:14px;color:var(--texto-dim);font-size:13px;line-height:1.5">
         <input type="checkbox" id="del-ajustar" checked style="width:auto;flex:none" />
         <span>Ajustar el stock de "<b style="color:#fff">${esc(mat.nombre)}</b>" (${accionStock})</span>
       </label>`
    : `<p style="color:var(--texto-mute);font-size:12.5px;margin-top:12px">El material de este movimiento ya no existe en el inventario, asi que el stock no cambiara.</p>`;
  abrirModal('Eliminar movimiento', `
    <p style="color:var(--texto-dim);line-height:1.6">Vas a eliminar este movimiento:</p>
    <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px;margin:10px 0;font-size:13px;line-height:1.7">
      <div><b>Tipo:</b> ${(TIPOS[mv.tipo] || {}).label || mv.tipo}</div>
      <div><b>Material:</b> ${esc(mv.materialNombre)}</div>
      <div><b>Cantidad:</b> ${fmtNum(mv.cantidad)} ${esc(mv.unidad || '')}</div>
      <div><b>Fecha:</b> ${fmtFecha(mv.fecha)}</div>
      ${mv.responsable ? `<div><b>Responsable:</b> ${esc(mv.responsable)}</div>` : ''}
    </div>
    ${bloqueStock}
    <p style="color:#ff9db0;font-size:12px;margin-top:12px">Esta accion no se puede deshacer.</p>
    <div class="modal-acciones">
      <button class="btn-ghost" id="delmv-cancelar">Cancelar</button>
      <button class="btn-primary" id="delmv-ok" style="background:linear-gradient(135deg,#ff5470,#c0392b);color:#fff">Si, eliminar</button>
    </div>`);
  $('#delmv-cancelar').addEventListener('click', cerrarModal);
  $('#delmv-ok').addEventListener('click', async () => {
    const ajustar = existeMat && !!(($('#del-ajustar') || {}).checked);
    const btn = $('#delmv-ok'); btn.disabled = true; btn.textContent = 'Eliminando...';
    try {
      await eliminarMovimiento(mv, ajustar);
      toast('Movimiento eliminado', 'ok');
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Si, eliminar'; }
  });
}

function confirmarEliminarOrden(orden) {
  const ligados = estado.movimientos.filter((m) => m.ordenId === orden.id);
  const idsExistentes = estado.materiales.map((m) => m.id);
  const nItems = (orden.items || []).length;
  const hayMovs = ligados.length > 0;
  abrirModal('Eliminar orden — ' + esc(orden.numero || ''), `
    <p style="color:var(--texto-dim);line-height:1.6">Vas a eliminar la orden <b style="color:#fff">${esc(orden.numero || '')}</b>
      (${(TIPOS[orden.tipo] || {}).label || orden.tipo}) con ${nItems} material(es).</p>
    ${hayMovs
      ? `<p style="color:var(--texto-dim);font-size:13px;margin-top:10px;line-height:1.5">Se eliminaran tambien sus <b>${ligados.length}</b> movimiento(s) asociado(s).</p>`
      : `<p style="color:var(--texto-dim);font-size:13px;margin-top:10px;line-height:1.5">Esta orden no tiene movimientos que afecten el stock (pedido pendiente), asi que el inventario no cambia.</p>`}
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--texto-dim);font-size:13px;line-height:1.5">
      <input type="checkbox" id="delord-ajustar" ${hayMovs ? 'checked' : 'disabled'} style="width:auto;flex:none" />
      <span>Ajustar el stock automaticamente (revertir el efecto de la orden)</span>
    </label>
    <p style="color:#ff9db0;font-size:12px;margin-top:12px">Esta accion no se puede deshacer.</p>
    <div class="modal-acciones">
      <button class="btn-ghost" id="delord-cancelar">Cancelar</button>
      <button class="btn-primary" id="delord-ok" style="background:linear-gradient(135deg,#ff5470,#c0392b);color:#fff">Si, eliminar</button>
    </div>`);
  $('#delord-cancelar').addEventListener('click', cerrarModal);
  $('#delord-ok').addEventListener('click', async () => {
    const ajustar = hayMovs && !!(($('#delord-ajustar') || {}).checked);
    const btn = $('#delord-ok'); btn.disabled = true; btn.textContent = 'Eliminando...';
    try {
      await eliminarOrden(orden, ligados, ajustar ? idsExistentes : []);
      toast('Orden eliminada', 'ok');
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Si, eliminar'; }
  });
}

/* ==================================================================
   KITS (plantillas de materiales, editables por el usuario)
   ================================================================== */
function renderKits() {
  if (!$('#cuerpo-kits')) return;
  $('#kits-vacio').hidden = estado.kits.length !== 0;
  $('#cuerpo-kits').innerHTML = estado.kits.map((k) => {
    const detalle = (k.items || []).map((it) => `<tr><td>${esc(it.materialNombre)}</td><td class="der"><b>${fmtNum(it.cantidad)}</b> ${esc(it.unidad || '')}</td></tr>`).join('');
    return `
    <tr class="grupo-row" data-key="${k.id}" title="Doble clic para ver el contenido">
      <td><span class="caret">▸</span> <b>${esc(k.nombre)}</b></td>
      <td class="der">${(k.items || []).length}</td>
      <td class="cen"><div class="acciones-cel">
        <button class="btn-icon" title="Usar en una salida" data-usar-kit="${k.id}">📤</button>
        <button class="btn-icon" title="Duplicar" data-duplicar-kit="${k.id}">⧉</button>
        <button class="btn-icon" title="Editar" data-editar-kit="${k.id}">✎</button>
        <button class="btn-icon peligro" title="Eliminar" data-del-kit="${k.id}">🗑</button>
      </div></td>
    </tr>
    <tr class="grupo-detalle" data-key="${k.id}" hidden>
      <td colspan="3">
        <table class="tabla-detalle">
          <thead><tr><th>Material / Herramienta</th><th class="der">Cantidad</th></tr></thead>
          <tbody>${detalle || '<tr><td colspan="2" style="color:var(--texto-mute)">Sin materiales.</td></tr>'}</tbody>
        </table>
      </td>
    </tr>`;
  }).join('');
  const cuerpo = $('#cuerpo-kits');
  const toggleKit = (row) => {
    const det = row.nextElementSibling;
    if (det && det.classList.contains('grupo-detalle')) { det.hidden = !det.hidden; row.classList.toggle('abierto', !det.hidden); }
  };
  cuerpo.querySelectorAll('tr.grupo-row').forEach((row) => {
    row.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; toggleKit(row); });
    const caret = row.querySelector('.caret');
    if (caret) caret.addEventListener('click', (e) => { e.stopPropagation(); toggleKit(row); });
  });
  cuerpo.querySelectorAll('[data-editar-kit]').forEach((b) => b.addEventListener('click', () => modalKit(b.dataset.editarKit)));
  cuerpo.querySelectorAll('[data-del-kit]').forEach((b) => b.addEventListener('click', () => confirmarEliminarKit(b.dataset.delKit)));
  cuerpo.querySelectorAll('[data-usar-kit]').forEach((b) => b.addEventListener('click', () => usarKitEnSalida(b.dataset.usarKit)));
  cuerpo.querySelectorAll('[data-duplicar-kit]').forEach((b) => b.addEventListener('click', () => duplicarKit(b.dataset.duplicarKit)));
}

// Abre el modal de kit como NUEVO, precargado con el contenido de otro kit.
function duplicarKit(id) {
  const k = estado.kits.find((x) => x.id === id);
  if (!k) return;
  modalKit(null, {
    nombre: (k.nombre || '') + ' (copia)',
    items: (k.items || []).map((it) => ({ materialId: it.materialId, cantidad: it.cantidad }))
  });
}

// Abre una nueva orden de salida precargada con los materiales del kit.
function usarKitEnSalida(kitId) {
  const kit = estado.kits.find((k) => k.id === kitId);
  if (!kit) return;
  const items = (kit.items || [])
    .filter((it) => estado.materiales.some((m) => m.id === it.materialId))
    .map((it) => ({ materialId: it.materialId, cantidad: it.cantidad }));
  if (items.length === 0) { toast('Los materiales de este kit ya no existen en el inventario', 'error'); return; }
  modalOrden('salida', { frente: '', proveedor: '', responsable: '', nota: '', items });
}

function modalKit(id, prefill) {
  if (estado.materiales.length === 0) { toast('Primero agrega materiales al inventario', 'error'); return; }
  const kit = id ? estado.kits.find((k) => k.id === id) : null;
  const base = kit || prefill || null;
  estado.itemsKit = (base && base.items && base.items.length)
    ? base.items.map((it, i) => ({ _id: Date.now() + i, materialId: it.materialId || '', cantidad: it.cantidad || '', _filtro: '' }))
    : [{ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' }];

  abrirModal(kit ? 'Editar kit' : (prefill ? 'Duplicar kit' : 'Nuevo kit'), `
    <div class="campo full" style="margin-bottom:12px"><label>Nombre del kit *</label>
      <input id="k-nombre" value="${esc(base ? base.nombre : '')}" placeholder="Ej: Kit herramientas basico" /></div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin:6px 0 6px;font-weight:600">Materiales / Herramientas del kit</label>
    <div class="orden-items" id="kit-items"></div>
    <button class="btn-ghost orden-add" id="k-add">＋ Agregar material</button>
    <div class="modal-acciones">
      <button class="btn-ghost" id="k-cancelar">Cancelar</button>
      <button class="btn-primary" id="k-guardar">${kit ? 'Guardar cambios' : 'Crear kit'}</button>
    </div>`, '640px');

  const render = () => {
    const contK = $('#kit-items');
    contK.innerHTML = estado.itemsKit.map((it) => `
      <div class="orden-item-row" data-row="${it._id}">
        <div class="mat-picker">
          <input type="text" class="mat-filtro" placeholder="🔎 Escribe para filtrar (nombre, codigo o categoria)" data-campo="filtro" value="${esc(it._filtro || '')}" />
          <select data-campo="materialId">${opcionesMaterialAgrupadas(it.materialId, it._filtro)}</select>
        </div>
        <input type="number" step="any" min="0" placeholder="Cantidad" data-campo="cantidad" value="${it.cantidad}" />
        <button class="btn-icon peligro" data-quitar="${it._id}" title="Quitar">✕</button>
      </div>`).join('');
    contK.querySelectorAll('.orden-item-row').forEach((row) => {
      const rid = Number(row.dataset.row);
      const item = estado.itemsKit.find((x) => x._id === rid);
      const selEl = row.querySelector('select[data-campo="materialId"]');
      const filtroEl = row.querySelector('.mat-filtro');
      const cantEl = row.querySelector('input[data-campo="cantidad"]');
      filtroEl.addEventListener('input', () => { item._filtro = filtroEl.value; selEl.innerHTML = opcionesMaterialAgrupadas(item.materialId, item._filtro); });
      selEl.addEventListener('change', () => { item.materialId = selEl.value; });
      cantEl.addEventListener('input', () => { item.cantidad = cantEl.value; });
      row.querySelector('[data-quitar]').addEventListener('click', () => {
        estado.itemsKit = estado.itemsKit.filter((x) => x._id !== rid);
        if (estado.itemsKit.length === 0) estado.itemsKit.push({ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' });
        render();
      });
    });
  };
  render();

  $('#k-add').addEventListener('click', () => { estado.itemsKit.push({ _id: Date.now() + Math.random(), materialId: '', cantidad: '', _filtro: '' }); render(); });
  $('#k-cancelar').addEventListener('click', cerrarModal);
  $('#k-guardar').addEventListener('click', async () => {
    const nombre = $('#k-nombre').value.trim();
    if (!nombre) { toast('Ponle un nombre al kit', 'error'); return; }
    const items = estado.itemsKit
      .filter((it) => it.materialId && Number(it.cantidad) > 0)
      .map((it) => { const m = estado.materiales.find((x) => x.id === it.materialId); return { materialId: it.materialId, materialNombre: m ? m.nombre : '', cantidad: Number(it.cantidad), unidad: m ? m.unidad : 'unidad' }; });
    if (items.length === 0) { toast('Agrega al menos un material con cantidad', 'error'); return; }
    const btn = $('#k-guardar'); btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      if (kit) { await actualizarKit(kit.id, { nombre, items }); toast('Kit actualizado', 'ok'); }
      else { await agregarKit({ nombre, items }); toast('Kit creado', 'ok'); }
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = kit ? 'Guardar cambios' : 'Crear kit'; }
  });
}

function confirmarEliminarKit(id) {
  const k = estado.kits.find((x) => x.id === id);
  if (!k) return;
  abrirModal('Eliminar kit', `
    <p style="color:var(--texto-dim);line-height:1.6">Vas a eliminar el kit <b style="color:#fff">${esc(k.nombre)}</b>. Esto NO afecta el inventario ni las ordenes ya generadas.</p>
    <div class="modal-acciones">
      <button class="btn-ghost" id="dk-cancelar">Cancelar</button>
      <button class="btn-primary" id="dk-ok" style="background:linear-gradient(135deg,#ff5470,#c0392b);color:#fff">Si, eliminar</button>
    </div>`);
  $('#dk-cancelar').addEventListener('click', cerrarModal);
  $('#dk-ok').addEventListener('click', async () => {
    try { await eliminarKit(id); toast('Kit eliminado', 'ok'); cerrarModal(); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   RESPONSABLES (historial por persona)
   ================================================================== */
function llenarResponsables() {
  const sel = $('#sel-responsable');
  if (!sel) return;
  const actual = sel.value;
  const nombres = Array.from(new Set(estado.movimientos.map((m) => (m.responsable || '').trim()).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">— Elige un responsable —</option>' + nombres.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (nombres.includes(actual)) sel.value = actual;
  renderResponsable();
}
function movimientosDeResponsable(nombre) {
  return estado.movimientos.filter((m) => (m.responsable || '').trim() === nombre);
}
function renderResponsable() {
  const cuerpo = $('#cuerpo-responsable');
  if (!cuerpo) return;
  const nombre = $('#sel-responsable').value;
  if (!nombre) { cuerpo.innerHTML = ''; $('#resp-vacio').hidden = false; $('#resp-vacio').textContent = 'Elige un responsable para ver su historial completo.'; return; }
  const lista = movimientosDeResponsable(nombre);
  $('#resp-vacio').hidden = lista.length !== 0;
  if (lista.length === 0) $('#resp-vacio').textContent = 'Este responsable no tiene movimientos.';
  cuerpo.innerHTML = lista.map((mv) => `
    <tr>
      <td>${fmtFecha(mv.fecha)}</td>
      <td><span class="tipo-badge ${mv.tipo}">${(TIPOS[mv.tipo] || {}).label || mv.tipo}</span></td>
      <td>${esc(mv.materialNombre)}</td>
      <td class="der"><b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</td>
      <td class="codigo-cel">${esc(mv.ordenNumero || '-')}</td>
      <td>${esc(mv.frente || mv.proveedor || '-')}</td>
    </tr>`).join('');
}

/* ==================================================================
   CONSUMO POR CONTRATO / FRENTE
   ================================================================== */
function llenarConsumo() {
  const selC = $('#cons-contrato');
  const selF = $('#cons-frente');
  if (!selC || !selF) return;
  const cActual = selC.value;
  selC.innerHTML = '<option value="">Todos los contratos</option>' + Object.keys(CONTRATOS).map((c) => `<option value="${c}">${c}</option>`).join('');
  if (Object.keys(CONTRATOS).includes(cActual)) selC.value = cActual;
  llenarFrentesConsumo();
  renderConsumo();
}
function llenarFrentesConsumo() {
  const selC = $('#cons-contrato');
  const selF = $('#cons-frente');
  if (!selC || !selF) return;
  const c = selC.value;
  const fActual = selF.value;
  let frentes = [];
  if (c) frentes = CONTRATOS[c] || [];
  else Object.keys(CONTRATOS).forEach((k) => { frentes = frentes.concat(CONTRATOS[k]); });
  selF.innerHTML = '<option value="">Todos los frentes</option>' + frentes.map((f) => `<option value="${f}">Frente ${f}</option>`).join('');
  if (frentes.includes(fActual)) selF.value = fActual;
}
function datosConsumo() {
  const c = ($('#cons-contrato') || {}).value || '';
  const f = ($('#cons-frente') || {}).value || '';
  const movs = estado.movimientos.filter((mv) => {
    if (mv.tipo !== 'salida' && mv.tipo !== 'devolucion') return false;
    if (!mv.frente) return false;
    if (f) return mv.frente === f;
    if (c) return (mv.contrato || contratoDeFrente(mv.frente)) === c;
    return true;
  });
  const mapa = {};
  for (const mv of movs) {
    const k = mv.materialId || mv.materialNombre;
    if (!mapa[k]) {
      const mat = estado.materiales.find((x) => x.id === mv.materialId);
      mapa[k] = { nombre: mv.materialNombre, unidad: mv.unidad || (mat ? mat.unidad : ''), categoria: mat ? mat.categoria : 'Sin clasificar', salidas: 0, devoluciones: 0 };
    }
    if (mv.tipo === 'salida') mapa[k].salidas += Number(mv.cantidad) || 0;
    else mapa[k].devoluciones += Number(mv.cantidad) || 0;
  }
  const filas = Object.keys(mapa).map((k) => mapa[k]).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const alcance = f ? ('Frente ' + f + (contratoDeFrente(f) ? ' (' + contratoDeFrente(f) + ')' : '')) : (c || 'Todos los contratos');
  return { filas, alcance };
}
function renderConsumo() {
  const cuerpo = $('#cuerpo-consumo');
  if (!cuerpo) return;
  const { filas } = datosConsumo();
  $('#cons-vacio').hidden = filas.length !== 0;
  if (filas.length === 0) $('#cons-vacio').textContent = 'No hay consumo registrado para esa seleccion.';
  const totalNeto = filas.reduce((s, r) => s + (r.salidas - r.devoluciones), 0);
  $('#cons-cards').innerHTML = filas.length === 0 ? '' :
    `${cardHtml('Materiales', filas.length, '▦')}${cardHtml('Consumo neto total', fmtNum(totalNeto), '∑')}`;
  cuerpo.innerHTML = filas.map((r) => {
    const neto = r.salidas - r.devoluciones;
    return `<tr>
      <td>${esc(r.nombre)}</td>
      <td><span class="chip">${esc(r.categoria || 'Sin clasificar')}</span></td>
      <td class="der">${fmtNum(r.salidas)}</td>
      <td class="der">${fmtNum(r.devoluciones)}</td>
      <td class="der"><b>${fmtNum(neto)}</b></td>
      <td>${esc(r.unidad || '')}</td>
    </tr>`;
  }).join('');
}
function imprimirConsumo() {
  const { filas, alcance } = datosConsumo();
  if (filas.length === 0) { toast('No hay consumo para imprimir en esa seleccion', 'error'); return; }
  const filasHtml = filas.map((r) => `<tr><td>${esc(r.nombre)}</td><td style="text-align:right">${fmtNum(r.salidas)}</td><td style="text-align:right">${fmtNum(r.devoluciones)}</td><td style="text-align:right">${fmtNum(r.salidas - r.devoluciones)}</td><td>${esc(r.unidad || '')}</td></tr>`).join('');
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">CONSUMO DE MATERIALES</h2>
    <div class="doc-meta">
      <div><b>Alcance:</b> ${esc(alcance)}</div>
      <div><b>Fecha de emision:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Materiales:</b> ${filas.length}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>Material</th><th style="text-align:right">Salidas</th><th style="text-align:right">Devoluciones</th><th style="text-align:right">Consumo neto</th><th>Unidad</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>
    ${firmasDoc(nombreUsuario(), '')}
  </div>`;
  imprimir(html, 'Consumo_' + (alcance.replace(/\s+/g, '_')));
}

/* ==================================================================
   IMPRESION
   ================================================================== */
let docNombreActual = 'Documento_FVIECOM';

// Muestra el documento y ofrece: Imprimir, Guardar como PDF, Compartir por Gmail.
function imprimir(html, nombre) {
  const area = $('#print-area');
  if (!area) return;
  area.innerHTML = html;
  docNombreActual = String(nombre || 'Documento_FVIECOM').replace(/[^\w\-]+/g, '_');
  abrirModal('Documento generado', `
    <p style="color:var(--texto-dim);margin-bottom:16px;line-height:1.5">El documento esta listo. Elige que deseas hacer:</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn-primary" id="doc-imprimir">🖨️ Imprimir</button>
      <button class="btn-primary" id="doc-guardar">💾 Guardar como PDF</button>
      <button class="btn-primary" id="doc-compartir">📧 Compartir por Gmail</button>
    </div>
    <p style="color:var(--texto-mute);font-size:11.5px;margin-top:14px;line-height:1.6">
      💡 <b>Guardar como PDF</b>: se abre la ventana de impresion; en <b>Destino</b> elige <b>"Guardar como PDF"</b>.<br>
      💡 <b>Compartir</b>: se abre Gmail con el destinatario ya puesto (${esc(CORREO_COMPARTIR)}); adjunta el PDF y lo envias tu.
    </p>
    <div class="modal-acciones"><button class="btn-ghost" id="doc-cerrar">Cerrar</button></div>
  `);
  $('#doc-imprimir').addEventListener('click', () => window.print());
  $('#doc-guardar').addEventListener('click', () => { toast('En "Destino" elige "Guardar como PDF"', 'ok'); setTimeout(() => window.print(), 500); });
  $('#doc-compartir').addEventListener('click', compartirPorGmail);
  $('#doc-cerrar').addEventListener('click', cerrarModal);
}

// Abre Gmail (compose) con el destinatario, asunto y cuerpo ya escritos. No envia.
function compartirPorGmail() {
  const salto = String.fromCharCode(10) + String.fromCharCode(10);
  const asunto = 'FVIECOM - ' + docNombreActual.replace(/_/g, ' ');
  const cuerpo = 'Buenas,' + salto +
    'Adjunto el documento "' + docNombreActual + '" del proyecto Aeropuerto Internacional Jose Maria Cordova (Rionegro).' + salto +
    '(Recuerda adjuntar el PDF antes de enviar.)' + salto + 'Gracias.';
  const url = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(CORREO_COMPARTIR) +
    '&su=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo);
  window.open(url, '_blank');
  toast('Abriendo Gmail... adjunta el PDF y envialo tu', 'ok');
}

function cabeceraDoc() {
  return `<div class="doc-head">
    <img src="assets/logo-fviecom.png" class="doc-logo" alt="FVIECOM" />
    <div class="doc-emp">
      <h1>FVIECOM S.A.S</h1>
      <p>FV Ingenieria Electrica y Telecomunicaciones</p>
      <p>Proyecto: Aeropuerto Internacional Jose Maria Cordova - Rionegro</p>
    </div>
  </div>`;
}
function firmasDoc(almacenista, responsable) {
  return `<div class="doc-firmas">
    <div class="doc-firma"><div class="linea"></div><div class="rol">Almacenista</div><div class="nombre">${esc(almacenista || '-')}</div></div>
    <div class="doc-firma"><div class="linea"></div><div class="rol">Responsable</div><div class="nombre">${esc(responsable || '-')}</div></div>
  </div>`;
}
function docOrden(o, almacenista) {
  const t = TIPOS[o.tipo] || TIPOS.salida;
  const esProv = t.campo === 'proveedor';
  const contrato = o.contrato || contratoDeFrente(o.frente);

  // Acta de recepcion: cuando el pedido ya fue recibido (pedido vs recibido).
  if (o.recepcion) {
    const rec = o.recepcion;
    const filas = (rec.lineas || []).map((l, i) => {
      const dif = (Number(l.recibido) || 0) - (Number(l.pedido) || 0);
      const est = dif < 0 ? ('Falta ' + fmtNum(-dif)) : dif > 0 ? ('Llego +' + fmtNum(dif)) : 'Completo';
      return `<tr><td>${i + 1}</td><td>${esc(l.materialNombre)}</td><td style="text-align:right">${fmtNum(l.pedido)}</td><td style="text-align:right">${fmtNum(l.recibido)}</td><td>${esc(l.unidad || '')}</td><td>${est}</td></tr>`;
    }).join('');
    const adic = (rec.adiciones || []).map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.materialNombre)}${a.nuevo ? ' (nuevo)' : ''}</td><td style="text-align:right">${fmtNum(a.cantidad)}</td><td>${esc(a.unidad || '')}</td></tr>`).join('');
    const resumenTxt = { exacto: 'Recibido completo', falta: 'Recibido con faltantes', adicion: 'Recibido con adiciones', mixto: 'Recibido con faltantes y adiciones' }[rec.resumen || 'exacto'];
    return `<div class="doc">
      ${cabeceraDoc()}
      <h2 class="doc-titulo">ACTA DE RECEPCION DE PEDIDO</h2>
      <div class="doc-meta">
        <div><b>N° Pedido:</b> ${esc(o.numero || '-')}</div>
        <div><b>Fecha del pedido:</b> ${fmtFecha(o.fecha)}</div>
        <div><b>Proveedor:</b> ${esc(o.proveedor || '-')}</div>
        <div><b>Resultado:</b> ${esc(resumenTxt)}</div>
        <div><b>Responsable:</b> ${esc(o.responsable || '-')}</div>
      </div>
      <table class="doc-tabla">
        <thead><tr><th>#</th><th>Material</th><th style="text-align:right">Pedido</th><th style="text-align:right">Recibido</th><th>Unidad</th><th>Estado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="6">Sin materiales.</td></tr>'}</tbody>
      </table>
      ${adic ? `<h3 style="font-size:13px;margin:16px 0 6px;color:#0a1a3a">Adiciones (llegaron de mas o materiales nuevos)</h3>
      <table class="doc-tabla"><thead><tr><th>#</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead><tbody>${adic}</tbody></table>` : ''}
      ${o.nota ? `<p class="doc-nota"><b>Nota:</b> ${esc(o.nota)}</p>` : ''}
      ${firmasDoc(almacenista, o.responsable)}
    </div>`;
  }
  const metaLugar = esProv
    ? (`<div><b>Proveedor:</b> ${esc(o.proveedor || '-')}</div>` + (o.frente ? `<div><b>Contrato:</b> ${esc(contrato || '-')}</div><div><b>Frente:</b> ${esc(o.frente)}</div>` : ''))
    : `<div><b>Contrato:</b> ${esc(contrato || '-')}</div><div><b>Frente de obra:</b> ${esc(o.frente || '-')}</div>`;
  const filas = (o.items || []).map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td style="text-align:right">${fmtNum(it.cantidad)}</td><td>${esc(it.unidad)}</td></tr>`).join('');
  return `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">${t.titulo}</h2>
    <div class="doc-meta">
      <div><b>N° Orden:</b> ${esc(o.numero || '-')}</div>
      <div><b>Fecha:</b> ${fmtFecha(o.fecha)}</div>
      ${metaLugar}
      <div><b>Responsable:</b> ${esc(o.responsable || '-')}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>#</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${o.nota ? `<p class="doc-nota"><b>Nota:</b> ${esc(o.nota)}</p>` : ''}
    ${firmasDoc(almacenista, o.responsable)}
  </div>`;
}
function imprimirMovimiento(id) {
  const mv = estado.movimientos.find((x) => x.id === id);
  if (!mv) return;
  const orden = {
    numero: mv.ordenNumero || ('MOV-' + (mv.id || '').slice(-6)),
    tipo: mv.tipo, frente: mv.frente, proveedor: mv.proveedor, responsable: mv.responsable,
    nota: mv.nota, fecha: mv.fecha,
    items: [{ materialNombre: mv.materialNombre, cantidad: mv.cantidad, unidad: mv.unidad }]
  };
  imprimir(docOrden(orden, mv.usuario || nombreUsuario()), (orden.numero || 'Movimiento'));
}
function imprimirHistorialResponsable() {
  const nombre = $('#sel-responsable').value;
  if (!nombre) { toast('Elige un responsable primero', 'error'); return; }
  const lista = movimientosDeResponsable(nombre);
  if (lista.length === 0) { toast('Este responsable no tiene movimientos', 'error'); return; }
  const filas = lista.map((m) => `<tr><td>${fmtFecha(m.fecha)}</td><td>${(TIPOS[m.tipo] || {}).label || m.tipo}</td><td>${esc(m.materialNombre)}</td><td style="text-align:right">${fmtNum(m.cantidad)} ${esc(m.unidad || '')}</td><td>${esc(m.ordenNumero || '-')}</td><td>${esc(m.frente || m.proveedor || '-')}</td></tr>`).join('');
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">HISTORIAL DEL RESPONSABLE</h2>
    <div class="doc-meta">
      <div><b>Responsable:</b> ${esc(nombre)}</div>
      <div><b>Fecha de emision:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Total de movimientos:</b> ${lista.length}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Orden</th><th>Frente/Prov.</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${firmasDoc(nombreUsuario(), nombre)}
  </div>`;
  imprimir(html, 'Historial_' + nombre);
}

/* ==================================================================
   IMPORTAR PDF
   ================================================================== */
function initImportar() {
  const btn = $('#btn-elegir-pdf');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!window.nativo) { toast('La importacion de PDF funciona en la app de escritorio', 'error'); return; }
    const res = await window.nativo.importarPdf();
    if (!res || res.canceled) return;
    if (res.error) { toast(res.error, 'error'); return; }
    $('#pdf-nombre').textContent = res.fileName || '';
    estado.itemsImportados = (res.items || []).map((it, i) => ({ ...it, _id: i }));
    if (estado.itemsImportados.length === 0) { toast('No se detectaron materiales. Revisa el formato del PDF.', 'error'); $('#panel-preview').hidden = true; return; }
    renderPreview(); $('#panel-preview').hidden = false;
  });
  $('#btn-cancelar-import').addEventListener('click', () => { estado.itemsImportados = []; $('#panel-preview').hidden = true; $('#pdf-nombre').textContent = ''; });
  $('#btn-confirmar-import').addEventListener('click', async () => {
    if (estado.itemsImportados.length === 0) return;
    const b = $('#btn-confirmar-import'); b.disabled = true; b.textContent = 'Agregando...';
    try {
      const limpio = estado.itemsImportados.map((it) => ({ codigo: it.codigo, nombre: it.nombre, categoria: it.categoria, cantidad: it.cantidad, unidad: it.unidad })).filter((it) => it.nombre && it.nombre.trim());
      const r = await importarMateriales(limpio, estado.materiales);
      toast(`Importados: ${r.creados} nuevos, ${r.actualizados} actualizados`, 'ok');
      estado.itemsImportados = []; $('#panel-preview').hidden = true; $('#pdf-nombre').textContent = '';
      $('.menu-item[data-vista="inventario"]').click();
    } catch (e) { toast('Error al importar: ' + e.message, 'error'); }
    finally { b.disabled = false; b.textContent = 'Agregar al inventario'; }
  });
}
function renderPreview() {
  $('#preview-count').textContent = estado.itemsImportados.length;
  const cuerpo = $('#cuerpo-preview');
  cuerpo.innerHTML = estado.itemsImportados.map((it) => `
    <tr data-row="${it._id}">
      <td><input value="${esc(it.codigo || '')}" data-campo="codigo" /></td>
      <td><input value="${esc(it.nombre || '')}" data-campo="nombre" /></td>
      <td><select data-campo="categoria">${opcionesSelect(CATEGORIAS, it.categoria || 'Sin clasificar')}</select></td>
      <td class="der"><input type="number" step="any" min="0" value="${it.cantidad || 0}" data-campo="cantidad" style="text-align:right" /></td>
      <td><select data-campo="unidad">${opcionesSelect(UNIDADES, it.unidad || 'unidad')}</select></td>
      <td class="cen"><button class="btn-icon peligro" data-quitar="${it._id}">✕</button></td>
    </tr>`).join('');
  cuerpo.querySelectorAll('input, select').forEach((inp) => inp.addEventListener('change', (e) => {
    const row = parseInt(e.target.closest('tr').dataset.row, 10);
    const item = estado.itemsImportados.find((x) => x._id === row);
    if (item) item[e.target.dataset.campo] = e.target.value;
  }));
  cuerpo.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
    estado.itemsImportados = estado.itemsImportados.filter((x) => x._id !== parseInt(b.dataset.quitar, 10));
    renderPreview(); if (estado.itemsImportados.length === 0) $('#panel-preview').hidden = true;
  }));
}

/* ==================================================================
   REPORTES PDF (Electron)
   ================================================================== */
function initReportes() {
  const g = $('#btn-rep-general'); const d = $('#btn-rep-detallado');
  if (g) g.addEventListener('click', () => generarReporte('general'));
  if (d) d.addEventListener('click', () => generarReporte('detallado'));
}
async function generarReporte(tipo) {
  if (!window.nativo) { toast('Los reportes PDF se generan en la app de escritorio. En la web usa la impresion de ordenes.', 'error'); return; }
  if (estado.materiales.length === 0) { toast('No hay materiales para exportar', 'error'); return; }
  const box = $('#rep-estado'); box.hidden = false; box.textContent = 'Generando reporte...';
  try {
    let movimientos = estado.movimientos;
    if (tipo === 'detallado') { try { movimientos = await obtenerMovimientos(); } catch (e) {} }
    const res = await window.nativo.exportarPdf({
      tipo,
      materiales: estado.materiales.map((m) => ({ codigo: m.codigo, nombre: m.nombre, categoria: m.categoria, cantidad: m.cantidad, unidad: m.unidad, minimo: m.minimo, ubicacion: m.ubicacion })),
      movimientos: movimientos.map((mv) => ({ tipo: mv.tipo, materialNombre: mv.materialNombre, cantidad: mv.cantidad, unidad: mv.unidad, frente: mv.frente, nota: mv.nota, fecha: mv.fecha })),
      meta: { fecha: new Date().toLocaleString('es-CO'), usuario: nombreUsuario() }
    });
    if (res.canceled) { box.hidden = true; return; }
    if (res.error) { box.textContent = res.error; toast(res.error, 'error'); return; }
    box.innerHTML = `✓ Reporte generado: <b>${esc(res.filePath)}</b>`; toast('Reporte PDF generado', 'ok');
    window.nativo.abrirArchivo(res.filePath);
  } catch (e) { box.textContent = 'Error: ' + e.message; toast('Error al generar el PDF', 'error'); }
}

/* ==================================================================
   ACERCA
   ================================================================== */
async function cargarInfoApp() {
  if (!window.nativo || !$('#acerca-info')) return;
  try { const info = await window.nativo.infoApp(); $('#acerca-info').textContent = `Version ${info.version} · Electron ${info.electron} · Node ${info.node} · ${info.plataforma}`; }
  catch (e) {}
}

/* ==================================================================
   ARRANQUE
   ================================================================== */
inyectarExtras();
activarNavegacion();
prepararFiltroTipoMov();
initImportar();
initReportes();

$('#buscar-material').addEventListener('input', renderInventario);
$('#filtro-categoria').addEventListener('change', renderInventario);
$('#btn-nuevo-material').addEventListener('click', () => modalMaterial(null));
$('#buscar-mov').addEventListener('input', renderMovimientos);
$('#filtro-tipo-mov').addEventListener('change', renderMovimientos);
$('#btn-nuevo-mov').addEventListener('click', () => modalMovimiento(null));
if ($('#btn-nuevo-kit')) $('#btn-nuevo-kit').addEventListener('click', () => modalKit(null));
if ($('#btn-nueva-categoria')) $('#btn-nueva-categoria').addEventListener('click', modalCategorias);

$$('[data-nueva-orden]').forEach((b) => b.addEventListener('click', () => modalOrden(b.dataset.nuevaOrden)));
$('#sel-responsable').addEventListener('change', renderResponsable);
$('#btn-imprimir-historial').addEventListener('click', imprimirHistorialResponsable);
$('#cons-contrato').addEventListener('change', () => { llenarFrentesConsumo(); renderConsumo(); });
$('#cons-frente').addEventListener('change', renderConsumo);
$('#btn-imprimir-consumo').addEventListener('click', imprimirConsumo);
llenarConsumo();
