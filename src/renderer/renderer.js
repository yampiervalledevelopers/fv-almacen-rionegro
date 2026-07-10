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
  eliminarMovimiento, eliminarOrden
} from './db.js';

/* ------------------------------------------------------------------ */
/* Estado global                                                       */
/* ------------------------------------------------------------------ */
const estado = {
  usuario: null,
  materiales: [],
  movimientos: [],
  ordenes: [],
  itemsImportados: [],
  itemsOrden: [],
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
  .tipo-badge { font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:6px; }
  .tipo-badge.salida { background:rgba(255,84,112,0.15); color:#ff9db0; }
  .tipo-badge.entrada { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .tipo-badge.devolucion { background:rgba(255,176,32,0.15); color:#ffd08a; }
  .estado-badge { font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:6px; }
  .estado-badge.pendiente { background:rgba(255,176,32,0.18); color:#ffd08a; }
  .estado-badge.recibido { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .estado-badge.completado { background:rgba(120,160,220,0.15); color:#9fc2ef; }
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
  if (menu && itemMov) {
    // Insertar en orden: Movimientos -> Ordenes -> Responsables -> Consumo
    itemMov.insertAdjacentElement('afterend', btnConsumo);
    itemMov.insertAdjacentElement('afterend', btnResp);
    itemMov.insertAdjacentElement('afterend', btnOrdenes);
  } else if (menu) {
    menu.appendChild(btnOrdenes); menu.appendChild(btnResp); menu.appendChild(btnConsumo);
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
  if (cont) { cont.appendChild(vistaOrdenes); cont.appendChild(vistaResp); cont.appendChild(vistaConsumo); }

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
    estado.materiales = []; estado.movimientos = []; estado.ordenes = [];
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
}

window.addEventListener('online', () => { $('#estado-conexion').classList.remove('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Conectado'; });
window.addEventListener('offline', () => { $('#estado-conexion').classList.add('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Sin conexion (guardando local)'; });

/* ==================================================================
   Navegacion
   ================================================================== */
const TITULOS = {
  dashboard: 'Panel general', inventario: 'Inventario', movimientos: 'Movimientos',
  ordenes: 'Ordenes', responsables: 'Responsables', consumo: 'Consumo por contrato / frente',
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
  const cats = Array.from(new Set(estado.materiales.map((m) => m.categoria || 'Sin clasificar'))).sort();
  sel.innerHTML = '<option value="">Todas las categorias</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = actual;
}
function materialesFiltrados() {
  const q = ($('#buscar-material').value || '').toLowerCase().trim();
  const cat = $('#filtro-categoria').value;
  return estado.materiales.filter((m) => {
    if (cat && (m.categoria || 'Sin clasificar') !== cat) return false;
    if (!q) return true;
    return [m.nombre, m.codigo, m.categoria, m.ubicacion].some((v) => String(v || '').toLowerCase().includes(q));
  });
}
function renderInventario() {
  if (!$('#cuerpo-inventario')) return;
  const lista = materialesFiltrados();
  $('#inv-vacio').hidden = estado.materiales.length !== 0;
  $('#cuerpo-inventario').innerHTML = lista.map((m) => `
    <tr>
      <td class="codigo-cel">${esc(m.codigo || '-')}</td>
      <td>${esc(m.nombre)}${esBajoStock(m) ? '<span class="badge-bajo">STOCK BAJO</span>' : ''}</td>
      <td><span class="chip">${esc(m.categoria || 'Sin clasificar')}</span></td>
      <td class="der ${esBajoStock(m) ? 'cant-bajo' : ''}">${fmtNum(m.cantidad)}</td>
      <td>${esc(m.unidad)}</td>
      <td class="der">${m.minimo ? fmtNum(m.minimo) : '-'}</td>
      <td>${esc(m.ubicacion || '-')}</td>
      <td class="cen"><div class="acciones-cel">
        <button class="btn-icon" title="Registrar movimiento" data-mov="${m.id}">⇄</button>
        <button class="btn-icon" title="Editar" data-editar="${m.id}">✎</button>
        <button class="btn-icon peligro" title="Eliminar" data-eliminar="${m.id}">🗑</button>
      </div></td>
    </tr>`).join('');
  $('#cuerpo-inventario').querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => modalMaterial(b.dataset.editar)));
  $('#cuerpo-inventario').querySelectorAll('[data-eliminar]').forEach((b) => b.addEventListener('click', () => confirmarEliminar(b.dataset.eliminar)));
  $('#cuerpo-inventario').querySelectorAll('[data-mov]').forEach((b) => b.addEventListener('click', () => modalMovimiento(b.dataset.mov)));
}

function modalMaterial(id) {
  const m = id ? estado.materiales.find((x) => x.id === id) : null;
  abrirModal(m ? 'Editar material' : 'Nuevo material', `
    <div class="form-grid">
      <div class="campo"><label>Codigo</label><input id="f-codigo" value="${esc(m ? m.codigo : '')}" placeholder="Opcional" /></div>
      <div class="campo"><label>Unidad de medida</label><select id="f-unidad">${opcionesSelect(UNIDADES, m ? m.unidad : 'unidad')}</select></div>
      <div class="campo full"><label>Nombre del material *</label><input id="f-nombre" value="${esc(m ? m.nombre : '')}" placeholder="Ej: Cable THHN #12 AWG" /></div>
      <div class="campo full"><label>Categoria</label><select id="f-categoria">${opcionesSelect(CATEGORIAS, m ? m.categoria : 'Sin clasificar')}</select></div>
      <div class="campo"><label>Cantidad inicial (opcional)</label><input id="f-cantidad" type="number" step="any" min="0" placeholder="0" value="${m ? m.cantidad : ''}" /></div>
      <div class="campo"><label>Stock minimo (alerta)</label><input id="f-minimo" type="number" step="any" min="0" value="${m ? (m.minimo || 0) : 0}" /></div>
      <div class="campo full"><label>Ubicacion en almacen</label><input id="f-ubicacion" value="${esc(m ? m.ubicacion : '')}" placeholder="Ej: Estante A-3" /></div>
      <div class="campo full"><label>Nota</label><textarea id="f-nota" placeholder="Opcional">${esc(m ? m.nota : '')}</textarea></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="m-cancelar">Cancelar</button>
      <button class="btn-primary" id="m-guardar">${m ? 'Guardar cambios' : 'Agregar material'}</button>
    </div>`);
  $('#m-cancelar').addEventListener('click', cerrarModal);
  $('#m-guardar').addEventListener('click', async () => {
    const datos = {
      codigo: $('#f-codigo').value.trim(), nombre: $('#f-nombre').value.trim(),
      categoria: $('#f-categoria').value, cantidad: $('#f-cantidad').value,
      unidad: $('#f-unidad').value, minimo: $('#f-minimo').value,
      ubicacion: $('#f-ubicacion').value.trim(), nota: $('#f-nota').value.trim()
    };
    if (!datos.nombre) { toast('El nombre del material es obligatorio', 'error'); return; }
    try {
      if (m) { await actualizarMaterial(m.id, datos); toast('Material actualizado', 'ok'); }
      else { await agregarMaterial(datos); toast('Material agregado', 'ok'); }
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
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
function renderOrdenes() {
  if (!$('#cuerpo-ordenes')) return;
  $('#ord-vacio').hidden = estado.ordenes.length !== 0;
  $('#cuerpo-ordenes').innerHTML = estado.ordenes.map((o) => {
    const est = estadoOrden(o);
    const pendiente = (o.tipo === 'entrada' && est === 'pendiente');
    return `
    <tr>
      <td class="codigo-cel">${esc(o.numero)}</td>
      <td>${fmtFecha(o.fecha)}</td>
      <td><span class="tipo-badge ${o.tipo}">${(TIPOS[o.tipo] || {}).label || o.tipo}</span></td>
      <td><span class="estado-badge ${est}">${etiquetaEstado(est)}</span></td>
      <td>${esc(o.responsable || '-')}</td>
      <td>${o.frente ? (esc(o.frente) + ((o.contrato || contratoDeFrente(o.frente)) ? ` <span style="color:var(--texto-mute)">(${esc(o.contrato || contratoDeFrente(o.frente))})</span>` : '')) : esc(o.proveedor || '-')}</td>
      <td class="der">${(o.items || []).length}</td>
      <td class="cen"><div class="acciones-cel">
        ${pendiente ? `<button class="btn-icon" title="Recibir / verificar llegada" data-recibir="${o.id}">📥✓</button>` : ''}
        <button class="btn-icon" title="Imprimir" data-print-orden="${o.id}">🖨</button>
        <button class="btn-icon peligro" title="Eliminar orden" data-del-orden="${o.id}">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
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
}

function modalRecibir(orden) {
  const items = orden.items || [];
  abrirModal('Recibir pedido — ' + orden.numero, `
    <p style="color:var(--texto-dim);margin-bottom:14px;line-height:1.5">Verifica lo que llego al almacen. Ajusta las cantidades si llego diferente; al confirmar se sumaran al stock.</p>
    <div id="recibir-items">
      ${items.map((it, i) => `
        <div class="orden-item-row" data-i="${i}" style="grid-template-columns:1fr 130px">
          <div style="align-self:center">${esc(it.materialNombre)} <span style="color:var(--texto-mute)">(pedido: ${fmtNum(it.cantidad)} ${esc(it.unidad)})</span></div>
          <input type="number" step="any" min="0" value="${it.cantidad}" data-recib="${i}" />
        </div>`).join('')}
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="rec-cancelar">Cancelar</button>
      <button class="btn-primary" id="rec-ok">Confirmar recepcion</button>
    </div>`, '600px');
  $('#rec-cancelar').addEventListener('click', cerrarModal);
  $('#rec-ok').addEventListener('click', async () => {
    const recibidos = items.map((it, i) => {
      const inp = $('#recibir-items [data-recib="' + i + '"]');
      return {
        materialId: it.materialId, materialNombre: it.materialNombre, unidad: it.unidad,
        cantidad: parseFloat(inp ? inp.value : 0) || 0
      };
    });
    if (!recibidos.some((r) => r.cantidad > 0)) { toast('Ingresa al menos una cantidad recibida', 'error'); return; }
    const btn = $('#rec-ok'); btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await recibirOrden(orden, recibidos, nombreUsuario());
      toast('Pedido recibido y sumado al stock', 'ok');
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
function opcionesMaterialAgrupadas(sel, filtro) {
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
  let html = '<option value="">— Elige material —</option>';
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

function modalOrden(tipo) {
  if (estado.materiales.length === 0) { toast('Primero agrega materiales al inventario', 'error'); return; }
  const t = TIPOS[tipo] || TIPOS.salida;
  const esProveedor = t.campo === 'proveedor';

  // Recuperar borrador: lo que se estaba llenando si el modal se cerro sin generar.
  const borrador = leerBorradorOrden(tipo);
  if (borrador && Array.isArray(borrador.items) && borrador.items.length) {
    estado.itemsOrden = borrador.items.map((it, i) => ({ _id: Date.now() + i, materialId: it.materialId || '', cantidad: it.cantidad || '', _filtro: '' }));
  } else {
    estado.itemsOrden = [{ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' }];
  }

  abrirModal('Nueva orden — ' + t.label, `
    ${borrador ? `<div class="orden-aviso">📝 Recuperamos una orden sin terminar. <button type="button" id="o-nuevo" class="link-btn">Empezar de nuevo</button></div>` : ''}
    <div class="form-grid">
      ${esProveedor ? `<div class="campo"><label>Proveedor</label><input id="o-proveedor" placeholder="Nombre del proveedor" /></div>` : ''}
      <div class="campo"><label>Frente de obra (opcional)</label>${frenteSelectHtml('o-frente', borrador ? (borrador.frente || '') : '')}</div>
      <div class="campo"><label>Responsable</label><input id="o-responsable" placeholder="Nombre del responsable" /></div>
      <div class="campo full"><label>Nota (opcional)</label><input id="o-nota" placeholder="Observaciones de la orden" /></div>
    </div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin:14px 0 6px;font-weight:600">Materiales</label>
    <div class="orden-items" id="orden-items"></div>
    <button class="btn-ghost orden-add" id="o-add">＋ Agregar material</button>
    <div class="orden-total" id="o-total"></div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="o-cancelar">Cancelar</button>
      <button class="btn-primary" id="o-guardar">Generar e imprimir</button>
    </div>`, '640px');

  // Restaurar los textos guardados en el borrador.
  if (borrador) {
    if ($('#o-proveedor')) $('#o-proveedor').value = borrador.proveedor || '';
    if ($('#o-responsable')) $('#o-responsable').value = borrador.responsable || '';
    if ($('#o-nota')) $('#o-nota').value = borrador.nota || '';
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

$$('[data-nueva-orden]').forEach((b) => b.addEventListener('click', () => modalOrden(b.dataset.nuevaOrden)));
$('#sel-responsable').addEventListener('change', renderResponsable);
$('#btn-imprimir-historial').addEventListener('click', imprimirHistorialResponsable);
$('#cons-contrato').addEventListener('change', () => { llenarFrentesConsumo(); renderConsumo(); });
$('#cons-frente').addEventListener('change', renderConsumo);
$('#btn-imprimir-consumo').addEventListener('click', imprimirConsumo);
llenarConsumo();
