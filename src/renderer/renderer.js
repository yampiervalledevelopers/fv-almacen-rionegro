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
  escucharCategorias, agregarCategoria, eliminarCategoria,
  actualizarHerramientaDespacho,
  actualizarEstadoOrden,
  escucharContratos, guardarContratosEnNube
} from './db.js?v=61';

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
  contratos: {},
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

// Contratos y sus frentes de obra base (predeterminados).
const CONTRATOS_DEFAULT = {
  'Contrato 1': ['3', '3A', '3B', '3C'],
  'Contrato 2': ['4', '5', '5B', '11'],
  'Contrato 3': ['A']
};

const CLAVE_CONTRATOS = 'fviecom_contratos_personalizados';

// Obtiene todos los contratos y frentes combinando base, local y sincronizado
function obtenerContratos() {
  let guardados = {};
  try {
    guardados = JSON.parse(localStorage.getItem(CLAVE_CONTRATOS) || '{}');
  } catch (e) { guardados = {}; }

  if (estado && estado.contratos && typeof estado.contratos === 'object') {
    for (const c in estado.contratos) {
      if (!guardados[c]) guardados[c] = [];
      const lista = Array.isArray(estado.contratos[c]) ? estado.contratos[c] : [];
      for (const f of lista) {
        if (!guardados[c].includes(f)) guardados[c].push(f);
      }
    }
  }

  const resultado = {};
  // 1. Cargar base predeterminado
  for (const c in CONTRATOS_DEFAULT) {
    resultado[c] = [...CONTRATOS_DEFAULT[c]];
  }
  // 2. Fusionar guardados
  for (const c in guardados) {
    if (!resultado[c]) {
      resultado[c] = Array.isArray(guardados[c]) ? [...guardados[c]] : [];
    } else if (Array.isArray(guardados[c])) {
      for (const f of guardados[c]) {
        if (!resultado[c].includes(f)) resultado[c].push(f);
      }
    }
  }
  return resultado;
}

// Agrega un nuevo frente a un contrato
function agregarFrenteAContrato(nombreContrato, nombreFrente) {
  const c = String(nombreContrato || '').trim();
  const f = String(nombreFrente || '').toUpperCase().trim();
  if (!c) throw new Error('Ingresa o selecciona un contrato.');
  if (!f) throw new Error('Ingresa el nombre o número del frente.');

  const contratos = obtenerContratos();
  if (!contratos[c]) contratos[c] = [];
  if (!contratos[c].includes(f)) {
    contratos[c].push(f);
  }

  try {
    localStorage.setItem(CLAVE_CONTRATOS, JSON.stringify(contratos));
  } catch (e) { /* ignore */ }

  if (estado) estado.contratos = contratos;

  try { guardarContratosEnNube(contratos); } catch (_e) { /* ignore */ }

  refrescarFiltrosContratos();
  return { contrato: c, frente: f };
}

// Elimina un frente de un contrato
function eliminarFrenteDeContrato(nombreContrato, nombreFrente) {
  const c = String(nombreContrato || '').trim();
  const f = String(nombreFrente || '').toUpperCase().trim();
  const contratos = obtenerContratos();
  if (!contratos[c]) return;
  contratos[c] = (contratos[c] || []).filter((item) => String(item).toUpperCase().trim() !== f);
  if (contratos[c].length === 0 && !CONTRATOS_DEFAULT[c]) {
    delete contratos[c];
  }
  try {
    localStorage.setItem(CLAVE_CONTRATOS, JSON.stringify(contratos));
  } catch (e) { /* ignore */ }
  if (estado) estado.contratos = contratos;
  try { guardarContratosEnNube(contratos); } catch (_e) { /* ignore */ }
  refrescarFiltrosContratos();
}

// Deduce el contrato a partir del frente de obra (insensible a mayúsculas)
function contratoDeFrente(frente) {
  const f = String(frente || '').toUpperCase().trim();
  if (!f) return '';
  const contratos = obtenerContratos();
  for (const c in contratos) {
    const fs = (contratos[c] || []).map((x) => String(x).toUpperCase().trim());
    if (fs.includes(f)) return c;
  }
  return '';
}

// El contrato REAL se deriva siempre del frente (fuente de verdad). Solo si no
// hay frente se usa el contrato que quedo guardado. Evita inconsistencias.
function contratoReal(obj) {
  return (obj && obj.frente) ? contratoDeFrente(obj.frente) : ((obj && obj.contrato) || '');
}

// Genera el selector de frentes agrupados por contrato con opción de agregar rápido
function frenteSelectHtml(id, sel, conBotonAgregar = true) {
  const contratos = obtenerContratos();
  let optHtml = `<option value="">— Sin frente —</option>`;
  for (const c in contratos) {
    optHtml += `<optgroup label="${esc(c)}">`;
    for (const f of contratos[c]) {
      optHtml += `<option value="${esc(f)}" ${String(f).toUpperCase() === String(sel || '').toUpperCase() ? 'selected' : ''}>Frente ${esc(f)}</option>`;
    }
    optHtml += `</optgroup>`;
  }

  if (!conBotonAgregar) {
    return `<select id="${id}">${optHtml}</select>`;
  }

  return `
    <div class="frente-picker-wrap" id="${id}-wrap" style="display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;gap:6px;align-items:center">
        <select id="${id}" style="flex:1">${optHtml}</select>
        <button type="button" class="btn-ghost btn-toggle-frente" data-frente-id="${id}" title="Agregar nuevo frente o contrato" style="padding:6px 10px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid rgba(0,200,255,0.3);color:#00c8ff;border-radius:8px;background:rgba(0,200,255,0.06);cursor:pointer">+ Frente</button>
      </div>
      <div id="${id}-creador" class="creador-frente-inline" style="display:none;margin-top:6px;padding:10px 12px;background:rgba(4,18,43,0.85);border:1px solid rgba(0,200,255,0.25);border-radius:10px;backdrop-filter:blur(8px)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:#00c8ff">➕ Agregar Nuevo Frente / Contrato</span>
          <button type="button" class="btn-cerrar-frente-box" data-frente-id="${id}" style="border:none;background:none;color:#7a8ba5;cursor:pointer;font-size:14px;padding:2px" title="Cerrar">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div>
            <label style="display:block;font-size:11px;color:var(--texto-dim);margin-bottom:3px">Contrato</label>
            <select id="${id}-contrato-sel" class="select" style="font-size:12px;padding:6px 8px;width:100%"></select>
          </div>
          <div id="${id}-nuevo-contrato-box" style="display:none">
            <label style="display:block;font-size:11px;color:var(--texto-dim);margin-bottom:3px">Nombre nuevo contrato</label>
            <input type="text" id="${id}-nuevo-contrato-inp" placeholder="Ej: Contrato 4" style="font-size:12px;padding:6px 8px;width:100%" />
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--texto-dim);margin-bottom:3px">Nombre del frente</label>
            <input type="text" id="${id}-nuevo-frente-inp" placeholder="Ej: B, 6, Pista..." style="font-size:12px;padding:6px 8px;width:100%" />
          </div>
        </div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button type="button" class="btn-ghost btn-mini btn-cancelar-frente" data-frente-id="${id}" style="font-size:11.5px;padding:5px 10px">Cancelar</button>
          <button type="button" class="btn-primary btn-mini btn-guardar-frente" data-frente-id="${id}" style="font-size:11.5px;padding:5px 12px">Guardar frente</button>
        </div>
      </div>
    </div>`;
}

function poblarSelectorContratosInline(fid) {
  const sel = document.getElementById(`${fid}-contrato-sel`);
  if (!sel) return;
  const contratos = obtenerContratos();
  let h = '';
  for (const c in contratos) {
    h += `<option value="${esc(c)}">${esc(c)}</option>`;
  }
  h += `<option value="__NUEVO__">+ Crear nuevo contrato...</option>`;
  sel.innerHTML = h;

  const boxNuevo = document.getElementById(`${fid}-nuevo-contrato-box`);
  const inpNuevo = document.getElementById(`${fid}-nuevo-contrato-inp`);
  if (boxNuevo) boxNuevo.style.display = 'none';

  sel.onchange = () => {
    if (sel.value === '__NUEVO__') {
      if (boxNuevo) {
        boxNuevo.style.display = 'block';
        if (inpNuevo) inpNuevo.focus();
      }
    } else {
      if (boxNuevo) boxNuevo.style.display = 'none';
    }
  };
  const inpFrente = document.getElementById(`${fid}-nuevo-frente-inp`);
  if (inpFrente) inpFrente.focus();
}

function ejecutarGuardarFrenteInline(fid) {
  const selContrato = document.getElementById(`${fid}-contrato-sel`);
  const inpNuevoContrato = document.getElementById(`${fid}-nuevo-contrato-inp`);
  const inpNuevoFrente = document.getElementById(`${fid}-nuevo-frente-inp`);
  if (!selContrato || !inpNuevoFrente) return;

  let contrato = selContrato.value;
  if (contrato === '__NUEVO__') {
    contrato = (inpNuevoContrato ? inpNuevoContrato.value : '').trim();
    if (!contrato) {
      toast('Escribe el nombre del nuevo contrato', 'error');
      if (inpNuevoContrato) inpNuevoContrato.focus();
      return;
    }
  }

  const frente = inpNuevoFrente.value.trim();
  if (!frente) {
    toast('Escribe el nombre del nuevo frente', 'error');
    inpNuevoFrente.focus();
    return;
  }

  try {
    agregarFrenteAContrato(contrato, frente);
    toast(`Frente "${frente}" agregado a ${contrato}`, 'ok');

    const box = document.getElementById(`${fid}-creador`);
    if (box) box.style.display = 'none';
    inpNuevoFrente.value = '';
    if (inpNuevoContrato) inpNuevoContrato.value = '';

    const targetSelect = document.getElementById(fid);
    if (targetSelect) {
      targetSelect.value = frente.toUpperCase();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function refrescarFiltrosContratos() {
  const selMov = document.getElementById('filtro-frente-mov');
  if (selMov) {
    const valPrevio = selMov.value;
    selMov.innerHTML = '<option value="">Todos los frentes</option>' + frentesOptions(valPrevio);
    selMov.value = valPrevio;
  }
  const consC = document.getElementById('cons-contrato');
  if (consC) {
    llenarConsumo();
  }
  ['o-frente', 'mv-frente'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const val = el.value;
      const contratos = obtenerContratos();
      let optHtml = `<option value="">— Sin frente —</option>`;
      for (const c in contratos) {
        optHtml += `<optgroup label="${esc(c)}">`;
        for (const f of contratos[c]) {
          optHtml += `<option value="${esc(f)}" ${String(f).toUpperCase() === String(val).toUpperCase() ? 'selected' : ''}>Frente ${esc(f)}</option>`;
        }
        optHtml += `</optgroup>`;
      }
      el.innerHTML = optHtml;
      if (val) el.value = val;
    }
  });
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
  try {
    const d = new Date(f);
    if (isNaN(d.getTime())) return String(f);
    // Si la hora es exactamente medianoche UTC (00:00:00.000Z), la fecha fue
    // guardada sin hora real (bug historico). Mostrar solo la fecha sin hora.
    const esMedianocheUTC = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    if (esMedianocheUTC) return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short' });
    return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });
  }
  catch (e) { return String(f); }
}

// Genera la hora actual en zona horaria de Colombia como string para datetime-local
function fechaLocalColombia() {
  const ahora = new Date();
  // Obtener la hora en Colombia (UTC-5)
  const col = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  const y = col.getFullYear();
  const m = String(col.getMonth() + 1).padStart(2, '0');
  const d = String(col.getDate()).padStart(2, '0');
  const h = String(col.getHours()).padStart(2, '0');
  const min = String(col.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}
// HTML del campo de fecha con boton "Hora actual"
function htmlCampoFecha(id) {
  return `<div class="campo full"><label>Fecha y hora</label>
    <div class="fecha-picker">
      <input type="datetime-local" id="${id}" value="${fechaLocalColombia()}" data-tocado="0" />
      <button type="button" class="btn-ghost btn-ahora" id="${id}-ahora">🕐 Hora actual</button>
    </div>
  </div>`;
}
function vincularCampoFecha(id) {
  const inp = $(`#${id}`);
  const btn = $(`#${id}-ahora`);
  if (inp) inp.addEventListener('change', () => { inp.dataset.tocado = '1'; });
  if (btn) btn.addEventListener('click', () => { if (inp) { inp.value = fechaLocalColombia(); inp.dataset.tocado = '0'; } });
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
/* ---------------- Multitarea: varias ventanas abiertas a la vez ----------------
   Solo una ventana se muestra a la vez; las demas quedan "estacionadas" en la
   barra inferior con todo su contenido (los nodos se sacan del documento, asi
   no chocan los ids y se conservan valores escritos y eventos). */
const TAB_ID = Math.random().toString(36).slice(2, 8);
const CLAVE_VIVAS = 'fviecom_ventanas_vivas';
const ventanas = { lista: [], activa: null, seq: 0, proxima: null };

// Llamar al inicio de un formulario de trabajo (orden, movimiento, material...)
// ANTES de tocar estado.itemsOrden / itemsKit / itemsAdicion.
function iniciarVentanaTrabajo(icono) {
  liberarPantalla();
  ventanas.proxima = { icono: icono || '🗂' };
}
// Deja la pantalla libre: estaciona la ventana de trabajo activa o cierra la pasajera.
function liberarPantalla() {
  const v = ventanas.activa;
  if (!v) return;
  if (v.multitarea) estacionarVentana(v);
  else cerrarModal({ sinRestaurar: true });
}
function quitarVentana(v) {
  ventanas.lista = ventanas.lista.filter((x) => x !== v);
  if (ventanas.activa === v) ventanas.activa = null;
  if (v.draftKey) {
    try {
      const vivas = JSON.parse(localStorage.getItem(CLAVE_VIVAS) || '{}');
      delete vivas[v.draftKey];
      localStorage.setItem(CLAVE_VIVAS, JSON.stringify(vivas));
    } catch (_e) { /* ignore */ }
  }
}
function ocultarCascaronModal() {
  const wrap = $('#modal');
  wrap.hidden = true;
  const m = $('#modal .modal');
  if (m) { m.classList.remove('modal-minimizado'); m.style.left = ''; m.style.top = ''; m.style.position = ''; }
  wrap.classList.remove('modal-draggable');
}
function estacionarVentana(v) {
  if (!v || ventanas.activa !== v) return;
  const body = $('#modal-body');
  const m = $('#modal .modal');
  const nodo = document.createElement('div');
  while (body.firstChild) nodo.appendChild(body.firstChild);
  v.nodo = nodo;
  v.snapshot = { itemsOrden: estado.itemsOrden, itemsKit: estado.itemsKit, itemsAdicion: estado.itemsAdicion };
  v.pos = m ? { left: m.style.left, top: m.style.top, position: m.style.position, drag: $('#modal').classList.contains('modal-draggable') } : null;
  ventanas.activa = null;
  ocultarCascaronModal();
  renderBarraVentanas();
}
function restaurarVentana(v) {
  if (!v || ventanas.activa === v || !ventanas.lista.includes(v)) return;
  liberarPantalla();
  $('#modal-titulo').textContent = v.titulo;
  const body = $('#modal-body');
  body.innerHTML = '';
  if (v.nodo) { while (v.nodo.firstChild) body.appendChild(v.nodo.firstChild); v.nodo = null; }
  if (v.snapshot) {
    estado.itemsOrden = v.snapshot.itemsOrden;
    estado.itemsKit = v.snapshot.itemsKit;
    estado.itemsAdicion = v.snapshot.itemsAdicion;
    v.snapshot = null;
  }
  const wrap = $('#modal');
  const m = $('#modal .modal');
  if (m) {
    m.style.maxWidth = v.ancho || '';
    m.classList.remove('modal-minimizado');
    if (v.pos && v.pos.drag) {
      wrap.classList.add('modal-draggable');
      m.style.position = v.pos.position; m.style.left = v.pos.left; m.style.top = v.pos.top;
    } else {
      wrap.classList.remove('modal-draggable');
      m.style.position = ''; m.style.left = ''; m.style.top = '';
    }
  }
  wrap.hidden = false;
  ventanas.activa = v;
  setTimeout(() => habilitarDragModal(), 50);
  renderBarraVentanas();
}
// Cierra una ventana concreta (aunque ya no sea la visible).
function cerrarVentana(v) {
  if (!v) return;
  if (ventanas.activa === v) { cerrarModal({ sinRestaurar: true }); return; }
  if (ventanas.lista.includes(v)) { quitarVentana(v); renderBarraVentanas(); }
}
function cerrarTodasVentanas() {
  ventanas.lista.slice().forEach(quitarVentana);
  ventanas.activa = null;
  ventanas.proxima = null;
  ocultarCascaronModal();
  $('#modal-body').innerHTML = '';
  renderBarraVentanas();
}
// Marca como "vivas" las ventanas con borrador, para que otra pestana no las recupere.
function marcarVentanasVivas() {
  try {
    const vivas = JSON.parse(localStorage.getItem(CLAVE_VIVAS) || '{}');
    const ahora = Date.now();
    for (const k in vivas) if (ahora - vivas[k] > 60000) delete vivas[k];
    ventanas.lista.forEach((v) => { if (v.draftKey) vivas[v.draftKey] = ahora; });
    localStorage.setItem(CLAVE_VIVAS, JSON.stringify(vivas));
  } catch (_e) { /* ignore */ }
}
setInterval(marcarVentanasVivas, 4000);
window.addEventListener('beforeunload', () => {
  try {
    const vivas = JSON.parse(localStorage.getItem(CLAVE_VIVAS) || '{}');
    ventanas.lista.forEach((v) => { if (v.draftKey) delete vivas[v.draftKey]; });
    localStorage.setItem(CLAVE_VIVAS, JSON.stringify(vivas));
  } catch (_e) { /* ignore */ }
});

function renderBarraVentanas() {
  let barra = document.getElementById('barra-ventanas');
  if (!barra) {
    const st = document.createElement('style');
    st.textContent = `
      #barra-ventanas { position:fixed; left:50%; transform:translateX(-50%); bottom:12px; z-index:70; display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:center; max-width:calc(100vw - 220px); padding:6px 8px; background:rgba(4,18,43,0.94); border:1px solid rgba(0,200,255,0.28); border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,0.55); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
      #barra-ventanas[hidden] { display:none; }
      #barra-ventanas .vt-lbl { font-size:11px; color:var(--texto-dim); padding:0 4px; white-space:nowrap; font-weight:600; }
      #barra-ventanas .vt-chip { display:flex; align-items:center; gap:6px; max-width:240px; padding:6px 6px 6px 10px; border-radius:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#e8edf5; font-size:12px; cursor:pointer; transition:all .15s ease; }
      #barra-ventanas .vt-chip:hover { border-color:rgba(0,200,255,0.5); background:rgba(0,200,255,0.08); }
      #barra-ventanas .vt-chip.activa { border-color:#00c8ff; background:rgba(0,200,255,0.18); box-shadow:0 0 12px rgba(0,200,255,0.2); }
      #barra-ventanas .vt-tit { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #barra-ventanas .vt-x { background:none; border:none; color:#7a8ba5; cursor:pointer; font-size:12px; padding:2px 4px; border-radius:6px; }
      #barra-ventanas .vt-x:hover { color:#ff5470; background:rgba(255,84,112,0.12); }
      #barra-ventanas .vt-new-wrap { position:relative; }
      #barra-ventanas .vt-new-btn { background:rgba(0,200,255,0.12); border:1px dashed rgba(0,200,255,0.45); color:#00c8ff; font-size:11.5px; font-weight:700; padding:6px 10px; border-radius:10px; cursor:pointer; white-space:nowrap; transition:all .15s ease; }
      #barra-ventanas .vt-new-btn:hover { background:rgba(0,200,255,0.22); border-style:solid; }
      .vt-quick-menu { position:fixed; bottom:62px; left:50%; transform:translateX(-50%); z-index:85; background:#0b1730; border:1px solid rgba(0,200,255,0.35); border-radius:12px; padding:6px; box-shadow:0 12px 35px rgba(0,0,0,0.65); min-width:230px; display:flex; flex-direction:column; gap:2px; }
      .vt-quick-menu .vt-qm-tit { font-size:11px; color:var(--texto-dim); padding:5px 10px 6px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:2px; font-weight:700; }
      .vt-quick-menu button { background:none; border:none; color:#e8edf5; text-align:left; padding:8px 10px; border-radius:8px; font-size:12.5px; cursor:pointer; display:flex; align-items:center; gap:8px; }
      .vt-quick-menu button:hover { background:rgba(0,200,255,0.12); color:#00c8ff; }
      .topbar-multitask-btn { margin-left:auto; margin-right:12px; background:rgba(0,200,255,0.1); border:1px solid rgba(0,200,255,0.32); color:#00c8ff; border-radius:9px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all .15s ease; }
      .topbar-multitask-btn:hover { background:rgba(0,200,255,0.2); border-color:#00c8ff; }
      @media (max-width:900px) { #barra-ventanas { left:8px; right:80px; transform:none; max-width:none; flex-wrap:nowrap; overflow-x:auto; justify-content:flex-start; } }
      @media print { #barra-ventanas, .vt-quick-menu, .topbar-multitask-btn { display:none !important; } }`;
    document.head.appendChild(st);
    barra = document.createElement('div');
    barra.id = 'barra-ventanas';
    document.body.appendChild(barra);
    barra.addEventListener('click', (e) => {
      const x = e.target.closest('[data-cerrar-vid]');
      if (x) {
        e.stopPropagation();
        const v = ventanas.lista.find((w) => w.id === x.dataset.cerrarVid);
        if (!v) return;
        if (!confirm('¿Cerrar "' + v.titulo + '"? Lo que no hayas guardado se perdera.')) return;
        if (v.draftKey) { try { localStorage.removeItem(v.draftKey); } catch (_e) { /* ignore */ } }
        cerrarVentana(v);
        return;
      }
      const btnNew = e.target.closest('[data-vt-nueva]');
      if (btnNew) {
        e.stopPropagation();
        abrirMenuNuevaVentana(btnNew);
        return;
      }
      const chip = e.target.closest('[data-vid]');
      if (!chip) return;
      const v = ventanas.lista.find((w) => w.id === chip.dataset.vid);
      if (!v) return;
      if (ventanas.activa === v) estacionarVentana(v); else restaurarVentana(v);
    });
  }
  const trabajo = ventanas.lista.filter((v) => v.multitarea);
  barra.hidden = trabajo.length === 0;
  barra.innerHTML = `<span class="vt-lbl">🗂 Multitarea (${trabajo.length})</span>` + trabajo.map((v) => `
    <div class="vt-chip ${ventanas.activa === v ? 'activa' : ''}" data-vid="${v.id}" title="${ventanas.activa === v ? 'Minimizar' : 'Abrir'}: ${esc(v.titulo)}">
      <span>${v.icono || '🗂'}</span><span class="vt-tit">${esc(v.titulo)}</span>
      <button type="button" class="vt-x" data-cerrar-vid="${v.id}" title="Cerrar ventana">✕</button>
    </div>`).join('') + `<button type="button" class="vt-new-btn" data-vt-nueva="1" title="Abrir otra orden, material o movimiento sin cerrar lo actual">＋ Nueva tarea</button>`;
}

let menuRapidoEl = null;
function cerrarMenuNuevaVentana() {
  if (menuRapidoEl) { menuRapidoEl.remove(); menuRapidoEl = null; document.removeEventListener('click', cerrarMenuNuevaVentana); }
}
function abrirMenuNuevaVentana(anchorEl) {
  if (menuRapidoEl) { cerrarMenuNuevaVentana(); return; }
  const m = document.createElement('div');
  m.className = 'vt-quick-menu';
  m.innerHTML = `
    <div class="vt-qm-tit">⚡ Abrir nueva ventana paralela</div>
    <button type="button" data-qm="orden-salida">📤 Nueva orden de salida</button>
    <button type="button" data-qm="orden-entrada">📥 Nueva orden de entrada / pedido</button>
    <button type="button" data-qm="orden-devolucion">🔄 Nueva orden de devolución</button>
    <button type="button" data-qm="movimiento">⇄ Registrar movimiento individual</button>
    <button type="button" data-qm="material">📦 Nuevo material de inventario</button>
    <button type="button" data-qm="herramienta">🔧 Nueva herramienta</button>
    <button type="button" data-qm="kit">🧰 Nuevo kit (plantilla)</button>`;
  document.body.appendChild(m);
  menuRapidoEl = m;
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const topSpace = r.top;
    if (topSpace > 290) {
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      m.style.top = 'auto';
    } else {
      m.style.top = (r.bottom + 8) + 'px';
      m.style.bottom = 'auto';
    }
    const leftPos = Math.max(12, Math.min(r.left, window.innerWidth - m.offsetWidth - 12));
    m.style.left = leftPos + 'px';
    m.style.transform = 'none';
  }
  m.querySelectorAll('[data-qm]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const act = b.dataset.qm;
    cerrarMenuNuevaVentana();
    if (act === 'orden-salida') modalOrden('salida');
    else if (act === 'orden-entrada') modalOrden('entrada');
    else if (act === 'orden-devolucion') modalOrden('devolucion');
    else if (act === 'movimiento') modalMovimiento(null);
    else if (act === 'material') modalMaterial(null);
    else if (act === 'herramienta') modalMaterial(null, { esHerramienta: true });
    else if (act === 'kit') modalKit(null);
  }));
  setTimeout(() => document.addEventListener('click', cerrarMenuNuevaVentana), 0);
}

function abrirModal(titulo, htmlBody, ancho) {
  // Si hay una ventana visible: la de trabajo se estaciona, la pasajera se reemplaza.
  let desplazada = null;
  const prev = ventanas.activa;
  if (prev) {
    if (prev.multitarea) { estacionarVentana(prev); desplazada = prev.id; }
    else { desplazada = prev.desplazada; quitarVentana(prev); }
  }
  const prox = ventanas.proxima;
  ventanas.proxima = null;
  const v = {
    id: TAB_ID + '-' + (++ventanas.seq), titulo, ancho: ancho || '',
    multitarea: !!prox, icono: prox ? prox.icono : '',
    desplazada: prox ? null : desplazada, nodo: null, snapshot: null, draftKey: null
  };
  ventanas.lista.push(v);
  ventanas.activa = v;

  $('#modal-titulo').textContent = titulo;
  $('#modal-body').innerHTML = htmlBody;
  const wrap = $('#modal');
  const m = $('#modal .modal');
  if (m) {
    m.style.maxWidth = ancho ? ancho : '';
    m.classList.remove('modal-minimizado');
    // Centrar el modal
    m.style.left = '';
    m.style.top = '';
    m.style.position = '';
    wrap.classList.remove('modal-draggable');
  }
  wrap.hidden = false;
  // Habilitar arrastre despues de abrir
  setTimeout(() => habilitarDragModal(), 50);
  renderBarraVentanas();
}
function cerrarModal(opts) {
  const v = ventanas.activa;
  ocultarCascaronModal();
  $('#modal-body').innerHTML = '';
  try { if (asistente && asistente.estadoAgente === 'en_modal') { asistente.estadoAgente = 'libre'; asistente.modalTipo = null; } } catch (_e) { /* asistente aun no inicializado */ }
  if (v) {
    quitarVentana(v);
    // Al cerrar una ventana pasajera (confirmacion, documento...), vuelve la que tapó.
    const sinRestaurar = opts && opts.sinRestaurar === true;
    if (!sinRestaurar && !v.multitarea && v.desplazada) {
      const d = ventanas.lista.find((x) => x.id === v.desplazada);
      if (d) restaurarVentana(d);
    }
  }
  renderBarraVentanas();
}
function minimizarModal() {
  const v = ventanas.activa;
  if (v && v.multitarea) {
    estacionarVentana(v);
    toast('Ventana minimizada en la barra inferior. Puedes seguir trabajando.', 'ok');
    return;
  }
  const m = $('#modal .modal');
  if (m) m.classList.toggle('modal-minimizado');
}
function habilitarDragModal() {
  const wrap = $('#modal');
  const m = wrap.querySelector('.modal');
  const head = wrap.querySelector('.modal-head');
  if (!m || !head) return;
  let isDragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
  // Remove previous listeners by cloning head content approach - use flag instead
  if (head._dragSetup) return;
  head._dragSetup = true;
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    // Switch to draggable mode
    if (!wrap.classList.contains('modal-draggable')) {
      const rect = m.getBoundingClientRect();
      wrap.classList.add('modal-draggable');
      m.style.position = 'absolute';
      m.style.left = rect.left + 'px';
      m.style.top = rect.top + 'px';
    }
    startX = e.clientX;
    startY = e.clientY;
    origX = parseInt(m.style.left) || 0;
    origY = parseInt(m.style.top) || 0;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    m.style.left = (origX + dx) + 'px';
    m.style.top = (origY + dy) + 'px';
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
  // Touch support for mobile
  head.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    const touch = e.touches[0];
    if (!wrap.classList.contains('modal-draggable')) {
      const rect = m.getBoundingClientRect();
      wrap.classList.add('modal-draggable');
      m.style.position = 'absolute';
      m.style.left = rect.left + 'px';
      m.style.top = rect.top + 'px';
    }
    startX = touch.clientX;
    startY = touch.clientY;
    origX = parseInt(m.style.left) || 0;
    origY = parseInt(m.style.top) || 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    m.style.left = (origX + dx) + 'px';
    m.style.top = (origY + dy) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', () => { isDragging = false; });
}

$('#modal-cerrar').addEventListener('click', cerrarModal);
$('#modal-minimizar').addEventListener('click', minimizarModal);
$('#modal').addEventListener('click', (e) => {
  if (e.target.id !== 'modal') return;
  const v = ventanas.activa;
  if (v && v.multitarea) estacionarVentana(v); else cerrarModal();
});

/* ==================================================================
   INYECCION de estilos, menu, vistas y area de impresion
   (para no tener que editar index.html ni styles.css)
   ================================================================== */
function inyectarExtras() {
  // ---- Estilos nuevos (impresion + componentes) ----
  const css = `
  #print-area { display: none; }
  @page { margin: 14mm 12mm; }
  @media print {
    body { background: #fff !important; }
    .app, .login-wrap, .modal-wrap, .toast { display: none !important; }
    #print-area { display: block !important; }
    .doc { max-width: none !important; padding: 0 !important; }
    .doc-tabla { page-break-inside: auto; }
    .doc-tabla tr, .doc-tabla td, .doc-tabla th { page-break-inside: avoid; break-inside: avoid; }
    .doc-tabla thead { display: table-header-group; }
    .doc-firmas, .grafico-barras, .gb-row { page-break-inside: avoid; break-inside: avoid; }
    .doc-sub { page-break-after: avoid; }
  }
  .doc-sub { font-size:14px; color:#0a1a3a; margin:18px 0 4px; border-bottom:1px solid #cbd5e1; padding-bottom:4px; }
  .doc-rango { font-size:11.5px; color:#555; margin-bottom:8px; }
  .grafico-barras { margin:8px 0 4px; font-size:12px; }
  .gb-eje { font-size:11px; opacity:.7; margin-bottom:6px; }
  .gb-row { display:grid; grid-template-columns:170px 1fr 72px; gap:8px; align-items:center; margin-bottom:5px; }
  .gb-lab { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gb-track { background:rgba(120,120,120,0.25); border-radius:4px; height:14px; }
  .gb-fill { background:#0d6efd; height:14px; border-radius:4px; }
  .gb-val { text-align:right; font-weight:bold; }
  .chk { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--texto-dim); }
  .chk input { width:auto; }
  .doc { color:#111; font-family: Arial, Helvetica, sans-serif; padding:12px 20px; max-width:820px; margin:0 auto; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .gb-svg { display:block; width:100%; height:auto; max-width:720px; margin-top:2px; }
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
  /* --- Modal draggable & minimizable --- */
  .modal-wrap.modal-draggable { align-items:flex-start; justify-content:flex-start; pointer-events:none; }
  .modal-wrap.modal-draggable .modal { pointer-events:all; position:absolute; cursor:default; margin:0; }
  .modal-head { cursor:move; user-select:none; }
  .modal-head .modal-controles { display:flex; gap:6px; align-items:center; }
  .modal-head .modal-minimizar { background:none; border:none; color:var(--texto-dim); font-size:16px; cursor:pointer; padding:2px 6px; }
  .modal-head .modal-minimizar:hover { color:var(--cian); }
  .modal.modal-minimizado { overflow:hidden; }
  .modal.modal-minimizado .modal-body { display:none; }
  .modal.modal-minimizado { max-height:56px !important; min-height:auto; resize:none; }
  /* --- Responsive --- */
  @media (max-width: 900px) {
    .app { grid-template-columns: 1fr !important; }
    .sidebar { position:fixed; left:-280px; top:0; bottom:0; width:264px; z-index:60; transition:left .25s ease; box-shadow:4px 0 20px rgba(0,0,0,0.5); }
    .sidebar.sidebar-open { left:0; }
    .sidebar-overlay { display:none; position:fixed; inset:0; z-index:55; background:rgba(0,0,0,0.4); }
    .sidebar-overlay.activo { display:block; }
    .topbar { padding-left:12px; }
    .btn-menu-hamburger { display:flex !important; align-items:center; justify-content:center; background:none; border:1px solid var(--linea); color:var(--texto); border-radius:8px; width:38px; height:38px; font-size:20px; margin-right:10px; cursor:pointer; }
    .contenido { padding:0 12px 30px; }
    .barra-acciones { flex-wrap:wrap; }
    .cards { grid-template-columns:1fr 1fr !important; }
    .grid-2, .cards-reportes { grid-template-columns:1fr !important; }
    .form-grid { grid-template-columns:1fr !important; }
    .doc-meta { grid-template-columns:1fr !important; }
    .doc-firmas { flex-direction:column; gap:30px; align-items:center; }
    .orden-item-row { grid-template-columns:1fr 90px 38px !important; }
    .tabla { font-size:12px; }
    .tabla thead th, .tabla tbody td { padding:8px 6px; }
    .modal { width:96vw !important; max-width:96vw !important; }
  }
  @media (max-width: 600px) {
    .cards { grid-template-columns:1fr !important; }
    .topbar h2 { font-size:16px; }
    .topbar-proyecto { display:none; }
    .barra-acciones { gap:6px; }
    .barra-acciones .btn-primary, .barra-acciones .btn-ghost { font-size:12px; padding:8px 10px; }
    .select, .input-buscar { min-width:0 !important; width:100%; font-size:12px; padding:9px 10px; }
    .tabla thead th, .tabla tbody td { padding:6px 4px; font-size:11px; }
    .acciones-cel { flex-wrap:wrap; }
  }
  /* --- Filtro tipo material en responsables --- */
  #filtro-tipo-resp { min-width:160px; }
  /* --- Campo fecha en modales --- */
  .fecha-picker { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .fecha-picker input[type="datetime-local"] { flex:1; min-width:180px; }
  .fecha-picker .btn-ahora { font-size:11.5px; padding:7px 12px; white-space:nowrap; }
  /* --- Asistente de voz (legacy removed - new widget in initAsistente) --- */
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
  .estado-badge.disponible { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .estado-badge.en_uso { background:rgba(77,163,255,0.18); color:#9fc2ef; }
  .estado-badge.mantenimiento { background:rgba(255,176,32,0.18); color:#ffd08a; }
  .estado-badge.baja { background:rgba(255,84,112,0.18); color:#ff9db0; }
  .estado-badge.devolucion_completada { background:rgba(46,204,113,0.15); color:#7ee6a8; }
  .estado-badge.devolucion_parcial { background:rgba(255,176,32,0.18); color:#ffd08a; }
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
  /* --- Franja separadora de dia en Ordenes (azul claro sutil + grabado FV INGENIERIA + desplegable) --- */
  tr.ord-dia-sep {
    cursor: pointer;
  }
  tr.ord-dia-sep > td {
    padding: 5px 14px !important;
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.16) 0%, rgba(14, 165, 233, 0.08) 50%, rgba(56, 189, 248, 0.14) 100%) !important;
    border-top: 1px solid rgba(125, 211, 252, 0.32) !important;
    border-bottom: 1px solid rgba(56, 189, 248, 0.22) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 -1px 0 rgba(0, 0, 0, 0.35);
    user-select: none;
    transition: background 0.18s ease, border-color 0.18s ease;
  }
  tr.ord-dia-sep:hover > td {
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.24) 0%, rgba(14, 165, 233, 0.13) 50%, rgba(56, 189, 248, 0.20) 100%) !important;
    border-top-color: rgba(125, 211, 252, 0.5) !important;
  }
  .ord-dia-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 18px;
  }
  .ord-dia-izq {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    font-weight: 700;
    color: #bae6fd;
    letter-spacing: 0.4px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  }
  .ord-dia-caret {
    display: inline-block;
    font-size: 11px;
    color: #38bdf8;
    transition: transform 0.18s ease;
    line-height: 1;
  }
  tr.ord-dia-sep.cerrado .ord-dia-caret {
    transform: rotate(-90deg);
    color: #7dd3fc;
  }
  tr.ord-dia-sep.cerrado .ord-dia-dot {
    opacity: 0.45;
    box-shadow: none;
  }
  .ord-dia-izq .ord-dia-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 8px #38bdf8;
    transition: opacity 0.18s ease, box-shadow 0.18s ease;
  }
  .ord-dia-izq .ord-dia-cnt {
    font-size: 10.5px;
    font-weight: 600;
    color: #7dd3fc;
    background: rgba(14, 165, 233, 0.16);
    border: 1px solid rgba(125, 211, 252, 0.25);
    padding: 1px 7px;
    border-radius: 999px;
  }
  .ord-dia-linea {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(125, 211, 252, 0.28), rgba(125, 211, 252, 0.08) 60%, rgba(125, 211, 252, 0.25));
  }
  .ord-dia-grabado {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 3.2px;
    text-transform: uppercase;
    color: rgba(186, 230, 253, 0.38);
    text-shadow: -1px -1px 0 rgba(2, 8, 23, 0.85), 1px 1px 0 rgba(255, 255, 255, 0.14);
    white-space: nowrap;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .chk-req-dev {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border-radius: 7px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.03);
    color: var(--texto-dim);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex: none;
    user-select: none;
    transition: all 0.16s ease;
  }
  .chk-req-dev:hover {
    border-color: rgba(245, 158, 11, 0.55);
    color: #fde68a;
  }
  .chk-req-dev.activo {
    border-color: rgba(245, 158, 11, 0.85);
    background: rgba(245, 158, 11, 0.18);
    color: #fcd34d;
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.15);
  }
  .chk-req-dev input[type="checkbox"] {
    width: 14px !important;
    height: 14px !important;
    margin: 0 !important;
    padding: 0 !important;
    accent-color: #f59e0b;
    cursor: pointer;
    flex: none;
  }
  .doc-tabla tr[data-req-dev="1"] td:nth-child(2)::after {
    content: "  ⚠️ [REQ. DEVOLUCIÓN]";
    color: #c0392b;
    font-weight: 700;
    font-size: 11px;
  }
  .btn-ia-scan {
    background: linear-gradient(135deg, rgba(0, 200, 255, 0.14), rgba(99, 102, 241, 0.18)) !important;
    border: 1px solid rgba(0, 200, 255, 0.45) !important;
    color: #7dd3fc !important;
    font-weight: 700 !important;
    transition: all 0.2s ease !important;
  }
  .btn-ia-scan:hover {
    background: linear-gradient(135deg, rgba(0, 200, 255, 0.26), rgba(99, 102, 241, 0.3)) !important;
    border-color: #00c8ff !important;
    color: #fff !important;
    box-shadow: 0 4px 16px rgba(0, 200, 255, 0.25);
  }
  .ia-dropzone {
    border: 2px dashed rgba(0, 200, 255, 0.38);
    border-radius: 12px;
    background: rgba(0, 200, 255, 0.04);
    padding: 14px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .ia-dropzone:hover, .ia-dropzone.dragover {
    border-color: #00c8ff;
    background: rgba(0, 200, 255, 0.1);
  }
  .ia-conf-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  .ia-conf-alta { background: rgba(16, 185, 129, 0.18); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.35); }
  .ia-conf-media { background: rgba(245, 158, 11, 0.18); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.35); }
  .ia-conf-baja { background: rgba(244, 63, 94, 0.18); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.35); }
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
  const btnHerr = document.createElement('button');
  btnHerr.className = 'menu-item';
  btnHerr.dataset.vista = 'herramientas';
  btnHerr.innerHTML = '<span class="ic">🔧</span> Herramientas';
  if (menu && itemMov) {
    // Insertar en orden: Movimientos -> Ordenes -> Kits -> Herramientas -> Responsables -> Consumo
    itemMov.insertAdjacentElement('afterend', btnConsumo);
    itemMov.insertAdjacentElement('afterend', btnResp);
    itemMov.insertAdjacentElement('afterend', btnHerr);
    itemMov.insertAdjacentElement('afterend', btnKits);
    itemMov.insertAdjacentElement('afterend', btnOrdenes);
  } else if (menu) {
    menu.appendChild(btnOrdenes); menu.appendChild(btnKits); menu.appendChild(btnHerr); menu.appendChild(btnResp); menu.appendChild(btnConsumo);
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
      <button class="btn-ghost btn-ia-scan" id="btn-escanear-ia-ord" title="Leer una lista escrita a mano o foto para armar la orden automáticamente">📷 Escanear lista (Foto / Letra a mano)</button>
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
    <div class="barra-acciones" style="flex-wrap:wrap">
      <select id="sel-responsable" class="select" style="min-width:260px"></select>
      <input type="search" id="buscar-resp" class="input-buscar" placeholder="Buscar material o herramienta..." disabled />
      <select id="filtro-tipo-resp" class="select">
        <option value="">Todos los tipos</option>
        <option value="materiales">Solo materiales</option>
        <option value="herramientas">Solo herramientas</option>
      </select>
      <select id="vista-resp" class="select">
        <option value="pedido">Ver por pedido</option>
        <option value="totales">Ver por totales</option>
      </select>
      <button class="btn-primary" id="btn-imprimir-historial">🖨 Imprimir historial</button>
    </div>
    <div class="mov-hint">💡 El historial separa <b>herramientas</b> de <b>materiales</b> y se organiza por fecha. Las herramientas en posesion se muestran primero con su estado actual.</div>
    <div class="panel sin-pad">
      <table class="tabla">
        <thead><tr>
          <th>Estado / Tipo</th><th>Material / Herramienta</th><th>Detalle</th><th>Orden / Frente</th><th>Info</th>
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
      <select id="cons-periodo" class="select">
        <option value="todo">Todo el historico</option>
        <option value="hoy">Hoy</option>
        <option value="semana">Ultimos 7 dias</option>
        <option value="mes">Este mes</option>
        <option value="trimestre">Este trimestre</option>
        <option value="anio">Este año</option>
        <option value="personalizado">Personalizado</option>
      </select>
      <input type="date" id="cons-desde" class="select" title="Desde" />
      <input type="date" id="cons-hasta" class="select" title="Hasta" />
      <select id="cons-tipo-item" class="select">
        <option value="todo">Materiales + Herramientas</option>
        <option value="materiales">Solo materiales</option>
        <option value="herramientas">Solo herramientas</option>
      </select>
      <label class="chk"><input type="checkbox" id="cons-grafico" /> Grafico</label>
      <button class="btn-primary" id="btn-imprimir-consumo">🖨 Imprimir consumo</button>
      <button type="button" class="btn-ghost" id="btn-gestionar-contratos" title="Gestionar contratos y frentes">⚙ Contratos y frentes</button>
    </div>
    <div class="cards" id="cons-cards"></div>
    <div id="cons-grafico-cont"></div>
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
  const vistaHerr = document.createElement('section');
  vistaHerr.className = 'vista';
  vistaHerr.id = 'vista-herramientas';
  vistaHerr.hidden = true;
  vistaHerr.innerHTML = `
    <div class="barra-acciones" style="flex-wrap:wrap">
      <input type="text" id="buscar-herr" class="select" placeholder="Buscar por serial o nombre..." style="min-width:220px" />
      <select id="filtro-estado-herr" class="select">
        <option value="">Todos los estados</option>
        <option value="disponible">Disponible</option>
        <option value="en_uso">En uso</option>
        <option value="mantenimiento">Mantenimiento</option>
        <option value="baja">Baja</option>
      </select>
      <button class="btn-primary" id="btn-nueva-herr">+ Nueva herramienta</button>
    </div>
    <div class="mov-hint">🔧 Haz <b>doble clic</b> en una herramienta para ver su trazabilidad completa (historial de asignaciones).</div>
    <div class="panel sin-pad">
      <table class="tabla" id="tabla-herramientas">
        <thead><tr>
          <th>Serial</th><th>Herramienta</th><th>Marca/Modelo</th><th>Estado</th>
          <th>Responsable actual</th><th>Frente actual</th><th class="cen">Acciones</th>
        </tr></thead>
        <tbody id="cuerpo-herramientas"></tbody>
      </table>
      <div id="herr-vacio" class="vacio" hidden>No hay herramientas registradas. Marca un material como herramienta al crearlo o editarlo.</div>
    </div>`;
  if (cont) { cont.appendChild(vistaOrdenes); cont.appendChild(vistaResp); cont.appendChild(vistaConsumo); cont.appendChild(vistaKits); cont.appendChild(vistaHerr); }

  // ---- Area de impresion ----
  const area = document.createElement('div');
  area.id = 'print-area';
  document.body.appendChild(area);

  // ---- Responsive: hamburger menu + sidebar overlay ----
  const topbar = $('.topbar');
  if (topbar) {
    const btnHamburger = document.createElement('button');
    btnHamburger.className = 'btn-menu-hamburger';
    btnHamburger.innerHTML = '☰';
    btnHamburger.title = 'Menu';
    topbar.insertBefore(btnHamburger, topbar.firstChild);
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    const sidebar = $('.sidebar');
    btnHamburger.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar-open');
      overlay.classList.toggle('activo');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('sidebar-open');
      overlay.classList.remove('activo');
    });
    // Close sidebar on nav click (mobile)
    document.querySelectorAll('.menu-item').forEach((mi) => {
      mi.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.remove('sidebar-open');
          overlay.classList.remove('activo');
        }
      });
    });
    const btnQuickTask = document.createElement('button');
    btnQuickTask.type = 'button';
    btnQuickTask.className = 'topbar-multitask-btn';
    btnQuickTask.innerHTML = '🗂 ＋ Nueva tarea';
    btnQuickTask.title = 'Abrir orden, material o movimiento en paralelo';
    const proy = topbar.querySelector('.topbar-proyecto');
    if (proy) topbar.insertBefore(btnQuickTask, proy);
    else topbar.appendChild(btnQuickTask);
    btnQuickTask.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirMenuNuevaVentana(btnQuickTask);
    });
  }

  // ---- Viewport meta for responsive (web version) ----
  if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
    document.head.appendChild(meta);
  }

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

  // ---- Filtros de herramientas ----
  const buscarHerr = $('#buscar-herr');
  const filtroEstadoHerr = $('#filtro-estado-herr');
  if (buscarHerr) buscarHerr.addEventListener('input', renderHerramientas);
  if (filtroEstadoHerr) filtroEstadoHerr.addEventListener('change', renderHerramientas);

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
  const contratos = obtenerContratos();
  let h = '';
  for (const c in contratos) {
    h += `<optgroup label="${esc(c)}">`;
    for (const f of contratos[c]) h += `<option value="${esc(f)}" ${String(f).toUpperCase() === String(sel || '').toUpperCase() ? 'selected' : ''}>Frente ${esc(f)}</option>`;
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
    cerrarTodasVentanas();
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
    renderInventario(); renderDashboard(); llenarFiltroCategorias(); renderHerramientas();
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

  estado.desuscribir.push(escucharContratos((datos) => {
    if (datos && typeof datos === 'object') {
      estado.contratos = datos;
      try { localStorage.setItem(CLAVE_CONTRATOS, JSON.stringify(datos)); } catch (_e) { /* ignore */ }
      refrescarFiltrosContratos();
    } else if (datos === null) {
      // Si el documento aun no existe en la nube, subir la configuracion actual
      try { guardarContratosEnNube(obtenerContratos()); } catch (_e) { /* ignore */ }
    }
  }, (err) => console.warn('Firestore contratos:', err.message)));
}

window.addEventListener('online', () => { $('#estado-conexion').classList.remove('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Conectado'; });
window.addEventListener('offline', () => { $('#estado-conexion').classList.add('offline'); $('#estado-conexion').innerHTML = '<span class="dot"></span> Sin conexion (guardando local)'; });

/* ==================================================================
   Navegacion
   ================================================================== */
const TITULOS = {
  dashboard: 'Panel general', inventario: 'Inventario', movimientos: 'Movimientos',
  ordenes: 'Ordenes', responsables: 'Responsables', consumo: 'Consumo por contrato / frente',
  kits: 'Kits (plantillas de materiales)', herramientas: 'Herramientas',
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
    const contrato = contratoDeFrente(mv.frente) || 'Sin contrato';
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
// Clases que pertenecen a una categoria (tipo). Si no hay categoria, todas.
function clasesDeCategoria(cat) {
  const c = (cat || '').trim().toLowerCase();
  const s = new Set();
  estado.materiales.forEach((m) => {
    if (!c || (m.categoria || '').trim().toLowerCase() === c) {
      const cl = (m.clase || '').trim();
      if (cl) s.add(cl);
    }
  });
  return Array.from(s).sort((a, b) => a.localeCompare(b));
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
// Estado de grupos en el inventario. Se guarda qué está ABIERTO (por defecto todo cerrado).
const invAbierto = { tipos: new Set(), clases: new Set() };
// Estado de dias abiertos en Movimientos (por defecto todo cerrado).
const movDiasAbiertos = new Set();
// Estado de grupos abiertos en Herramientas (por defecto todo cerrado).
const herrGruposAbiertos = { tipos: new Set(), clases: new Set() };

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
    const tipoCerrado = !invAbierto.tipos.has(tipo);
    html += `<tr class="inv-tipo ${tipoCerrado ? '' : 'abierto'}" data-toggle-tipo="${esc(tipo)}"><td colspan="8"><span class="caret">▸</span> ▦ ${esc(tipo)} <span class="conteo">(${totalTipo})</span></td></tr>`;
    if (clases.length === 0) {
      html += `<tr class="inv-vacio-grupo"${tipoCerrado ? ' hidden' : ''}><td colspan="8">Sin materiales todavia en esta categoria.</td></tr>`;
    }
    for (const clase of clases) {
      const mats = porTipo[tipo][clase].slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      const cKey = tipo + '||' + clase;
      const claseCerrada = !invAbierto.clases.has(cKey);
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
    if (invAbierto.tipos.has(t)) invAbierto.tipos.delete(t); else invAbierto.tipos.add(t);
    renderInventario();
  }));
  cuerpo.querySelectorAll('[data-toggle-clase]').forEach((el) => el.addEventListener('click', () => {
    const c = el.dataset.toggleClase;
    if (invAbierto.clases.has(c)) invAbierto.clases.delete(c); else invAbierto.clases.add(c);
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
  const listaClases = clasesDeCategoria(b.categoria);
  const esHerr = !!b.esHerramienta;
  iniciarVentanaTrabajo(esHerr ? '🔧' : '📦');
  const tituloBase = editando ? (esHerr ? 'Editar herramienta' : 'Editar material') : (prefill ? (esHerr ? 'Nueva herramienta (duplicar)' : 'Duplicar material') : (esHerr ? 'Nueva herramienta' : 'Nuevo material / herramienta'));
  abrirModal(tituloBase, `
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
      <div class="campo full"><label class="chk"><input type="checkbox" id="f-es-herramienta" ${esHerr ? 'checked' : ''} /> Es herramienta (activa ficha de trazabilidad)</label></div>
      <div id="campos-herr" style="${esHerr ? '' : 'display:none'}">
        <div class="form-grid">
          <div class="campo"><label>Serial *</label><input id="f-serial" value="${esc(b.serial || '')}" placeholder="Numero de serie" /></div>
          <div class="campo"><label>Marca</label><input id="f-marca" value="${esc(b.marca || '')}" placeholder="Marca" /></div>
          <div class="campo"><label>Modelo</label><input id="f-modelo" value="${esc(b.modelo || '')}" placeholder="Modelo" /></div>
          <div class="campo"><label>Estado</label>
            <select id="f-estado-herr">
              <option value="disponible" ${(b.estadoHerr || 'disponible') === 'disponible' ? 'selected' : ''}>Disponible</option>
              <option value="en_uso" ${b.estadoHerr === 'en_uso' ? 'selected' : ''}>En uso</option>
              <option value="mantenimiento" ${b.estadoHerr === 'mantenimiento' ? 'selected' : ''}>Mantenimiento</option>
              <option value="baja" ${b.estadoHerr === 'baja' ? 'selected' : ''}>Baja</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="m-minimizar" title="Guardar en la barra inferior y seguir haciendo otra cosa">▬ Minimizar</button>
      <button class="btn-ghost" id="m-cancelar">Cancelar</button>
      ${editando ? '' : `<button class="btn-ghost" id="m-guardar-otro">Guardar y agregar ${esHerr ? 'otra' : 'otro'}</button>`}
      <button class="btn-primary" id="m-guardar">${editando ? 'Guardar cambios' : (esHerr ? 'Agregar herramienta' : 'Agregar material')}</button>
    </div>`);
  const vActual = ventanas.activa;
  const actualizarTitMat = () => {
    if (!vActual) return;
    const nom = (($('#f-nombre') || {}).value || '').trim();
    const esH = ($('#f-es-herramienta') || {}).checked;
    vActual.icono = esH ? '🔧' : '📦';
    vActual.titulo = nom ? `${esH ? 'Herramienta' : 'Material'}: ${nom}` : tituloBase;
    if (ventanas.activa === vActual) $('#modal-titulo').textContent = vActual.titulo;
    renderBarraVentanas();
  };
  if ($('#f-nombre')) $('#f-nombre').addEventListener('input', actualizarTitMat);
  if (b.nombre) actualizarTitMat();

  // Toggle campos herramienta
  const chkHerr = $('#f-es-herramienta');
  const camposHerr = $('#campos-herr');
  if (chkHerr) chkHerr.addEventListener('change', () => { camposHerr.style.display = chkHerr.checked ? '' : 'none'; actualizarTitMat(); });

  const leerDatos = () => {
    const esH = $('#f-es-herramienta').checked;
    const datos = {
      codigo: $('#f-codigo').value.trim(), nombre: $('#f-nombre').value.trim(),
      categoria: $('#f-categoria').value.trim() || 'Sin clasificar', clase: $('#f-clase').value.trim(),
      cantidad: $('#f-cantidad').value, unidad: $('#f-unidad').value, minimo: $('#f-minimo').value,
      ubicacion: $('#f-ubicacion').value.trim(), nota: $('#f-nota').value.trim(),
      esHerramienta: esH
    };
    if (esH) {
      datos.serial = $('#f-serial').value.trim();
      datos.marca = $('#f-marca').value.trim();
      datos.modelo = $('#f-modelo').value.trim();
      datos.estadoHerr = $('#f-estado-herr').value;
    }
    return datos;
  };
  // La lista de clases (subgrupos) depende del Tipo elegido.
  const refrescarClases = () => {
    const dl = $('#lista-clases');
    if (dl) dl.innerHTML = clasesDeCategoria($('#f-categoria').value).map((c) => `<option value="${esc(c)}"></option>`).join('');
  };
  if ($('#f-categoria')) { $('#f-categoria').addEventListener('input', refrescarClases); $('#f-categoria').addEventListener('change', refrescarClases); }

  const guardar = async (cerrar) => {
    const datos = leerDatos();
    if (!datos.nombre) { toast('El nombre del material es obligatorio', 'error'); return; }
    if (datos.esHerramienta && !datos.serial) { toast('El serial es obligatorio para herramientas', 'error'); return; }
    try {
      if (m) { await actualizarMaterial(m.id, datos); toast('Material actualizado', 'ok'); }
      else { await agregarMaterial(datos); toast('Material agregado', 'ok'); }
      if (cerrar) { cerrarVentana(vActual); return; }
      // "Guardar y agregar otro": conserva tipo/clase/unidad/ubicacion; limpia lo demas.
      $('#f-codigo').value = '';
      $('#f-nombre').value = '';
      $('#f-cantidad').value = '';
      $('#f-serial').value = '';
      $('#f-marca').value = '';
      $('#f-modelo').value = '';
      actualizarTitMat();
      refrescarClases();
      const dlc = $('#lista-categorias');
      if (dlc) dlc.innerHTML = categoriasExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('');
      $('#f-nombre').focus();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  };

  if ($('#m-minimizar')) $('#m-minimizar').addEventListener('click', minimizarModal);
  $('#m-cancelar').addEventListener('click', () => cerrarVentana(vActual));
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
          tipo: mv.tipo, fecha: mv.fecha, frente: mv.frente, contrato: contratoDeFrente(mv.frente),
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
        tipo: mv.tipo, fecha: mv.fecha, frente: mv.frente, contrato: contratoDeFrente(mv.frente),
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

  // Agrupar los grupos por dia (YYYY-MM-DD) para mostrar encabezados de fecha.
  const porDia = {};
  for (const g of filtrados) {
    const dia = (g.fecha || '').slice(0, 10) || 'Sin fecha';
    if (!porDia[dia]) porDia[dia] = [];
    porDia[dia].push(g);
  }
  const dias = Object.keys(porDia).sort((a, b) => b.localeCompare(a));

  let html = '';
  for (const dia of dias) {
    const grupos = porDia[dia];
    const diaAbierto = movDiasAbiertos.has(dia);
    const fechaLabel = dia === 'Sin fecha' ? 'Sin fecha' : fmtFechaCorta(dia);
    html += `<tr class="inv-tipo ${diaAbierto ? 'abierto' : ''}" data-toggle-dia="${esc(dia)}"><td colspan="8"><span class="caret">▸</span> 📅 ${esc(fechaLabel)} <span class="conteo">(${grupos.length} orden(es))</span></td></tr>`;
    for (const g of grupos) {
      mapa[g.key] = g;
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
      html += `
        <tr class="grupo-row" data-key="${g.key}" title="Doble clic para ver el detalle"${diaAbierto ? '' : ' hidden'}>
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
    }
  }
  cuerpo.innerHTML = html;

  // Toggle dias
  cuerpo.querySelectorAll('[data-toggle-dia]').forEach((el) => el.addEventListener('click', () => {
    const d = el.dataset.toggleDia;
    if (movDiasAbiertos.has(d)) movDiasAbiertos.delete(d); else movDiasAbiertos.add(d);
    renderMovimientos();
  }));

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

  iniciarVentanaTrabajo('⇄');
  abrirModal('Registrar movimiento', `
    <div class="campo full" style="margin-bottom:14px"><label>Tipo de movimiento</label>${segTipoHtml('salida')}</div>
    <div class="campo full" style="margin-bottom:14px"><label>Material</label><select id="mv-material">${opciones}</select></div>
    <div class="form-grid">
      <div class="campo"><label>Cantidad *</label><input id="mv-cantidad" type="number" step="any" min="0" placeholder="0" /></div>
      <div class="campo" id="mv-campo-lugar"></div>
      <div class="campo full"><label>Responsable</label>
        <input id="mv-responsable" list="lista-resp-mov" placeholder="Nombre de quien recibe / entrega" autocomplete="off" />
        <datalist id="lista-resp-mov">${responsablesExistentes().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      </div>
      ${htmlCampoFecha('mv-fecha')}
      <div class="campo full"><label>Nota</label><input id="mv-nota" placeholder="Opcional" /></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="mv-minimizar" title="Minimizar en la barra inferior">▬ Minimizar</button>
      <button class="btn-ghost" id="mv-cancelar">Cancelar</button>
      <button class="btn-primary" id="mv-guardar">Registrar</button>
    </div>`);
  const vActual = ventanas.activa;
  const actualizarTitMov = () => {
    if (!vActual) return;
    const matObj = estado.materiales.find((x) => x.id === ($('#mv-material') || {}).value);
    const fVal = (($('#mv-frente') || {}).value || '').trim();
    const suf = fVal ? ` · Fr. ${fVal}` : (matObj ? ` · ${matObj.nombre}` : '');
    vActual.titulo = `Mov. ${(TIPOS[tipoSel] || {}).label || tipoSel}${suf}`;
    if (ventanas.activa === vActual) $('#modal-titulo').textContent = vActual.titulo;
    renderBarraVentanas();
  };

  vincularCampoFecha('mv-fecha');
  const renderLugar = () => {
    const cont = $('#mv-campo-lugar');
    if (tipoSel === 'entrada') {
      cont.innerHTML = `<label>Proveedor</label><input id="mv-proveedor" placeholder="Nombre del proveedor" style="margin-bottom:10px" />`
        + `<label>Frente de obra (opcional)</label>${frenteSelectHtml('mv-frente', '')}`;
    } else {
      cont.innerHTML = `<label>Frente de obra (opcional)</label>${frenteSelectHtml('mv-frente', '')}`;
    }
    if ($('#mv-frente')) $('#mv-frente').addEventListener('change', actualizarTitMov);
    actualizarTitMov();
  };
  renderLugar();
  if ($('#mv-material')) $('#mv-material').addEventListener('change', actualizarTitMov);
  $('#seg-tipo').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    tipoSel = b.dataset.t;
    $('#seg-tipo').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); renderLugar();
  }));

  if ($('#mv-minimizar')) $('#mv-minimizar').addEventListener('click', minimizarModal);
  $('#mv-cancelar').addEventListener('click', () => cerrarVentana(vActual));
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
        responsable: $('#mv-responsable').value.trim(), nota: $('#mv-nota').value.trim(), usuario: nombreUsuario(),
        fecha: ($('#mv-fecha') && $('#mv-fecha').dataset.tocado === '1') ? new Date($('#mv-fecha').value).toISOString() : null
      });
      toast('Movimiento registrado', 'ok'); cerrarVentana(vActual);
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   ORDENES (varios materiales)
   ================================================================== */
function esItemReqDevolucion(it) {
  if (!it) return false;
  if (it.reqDevolucion !== undefined) return !!it.reqDevolucion;
  const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
  return !!(m && m.esHerramienta);
}

function esItemPendienteDevolucion(it, orden) {
  if (!esItemReqDevolucion(it)) return false;
  if (orden && estadoOrden(orden) === 'devolucion_completada') return false;
  if (it.devuelto) return false;
  const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
  if (it.reqDevolucion === undefined && m && m.esHerramienta && m.estadoHerr && m.estadoHerr !== 'en_uso') {
    return false;
  }
  return true;
}

function ordenRequiereDevolucion(o) {
  if (!o || o.tipo !== 'salida') return false;
  return Array.isArray(o.items) && o.items.some((it) => esItemReqDevolucion(it));
}

function ordenTieneDevolucionPendiente(o) {
  if (!ordenRequiereDevolucion(o)) return false;
  if (estadoOrden(o) === 'devolucion_completada') return false;
  return (o.items || []).some((it) => esItemPendienteDevolucion(it, o));
}

function recalcularEstadoDevolucionOrden(o) {
  if (!o || o.tipo !== 'salida') return estadoOrden(o);
  const reqItems = (o.items || []).filter((it) => esItemReqDevolucion(it));
  if (reqItems.length === 0) return 'completado';
  const devueltos = reqItems.filter((it) => {
    if (it.devuelto) return true;
    const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
    return (it.reqDevolucion === undefined && m && m.esHerramienta && m.estadoHerr && m.estadoHerr !== 'en_uso');
  }).length;
  if (devueltos >= reqItems.length) return 'devolucion_completada';
  if (devueltos > 0) return 'devolucion_parcial';
  return 'completado';
}

function estadoOrden(o) {
  return o.estado || (o.tipo === 'entrada' ? 'recibido' : 'completado');
}
function etiquetaEstado(est) {
  if (est === 'pendiente') return 'Pendiente';
  if (est === 'recibido') return 'Recibido';
  if (est === 'devolucion_completada') return 'Devolucion completada';
  if (est === 'devolucion_parcial') return 'Devolucion parcial';
  return 'Completado';
}
// Etiqueta y clase del estado, considerando el resumen de recepcion.
function estadoOrdenInfo(o) {
  const est = estadoOrden(o);
  if (est === 'devolucion_completada') return { cls: 'devolucion_completada', label: 'Devolucion completada' };
  if (est === 'devolucion_parcial') return { cls: 'devolucion_parcial', label: 'Devolucion parcial' };
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
  const esSalida = o.tipo === 'salida';
  const estOrd = estadoOrden(o);
  const detalle = (o.items || []).map((it, i) => {
    const reqDev = esItemReqDevolucion(it);
    const yaDevuelto = reqDev && (!esItemPendienteDevolucion(it, o) || estOrd === 'devolucion_completada');
    const colDev = esSalida ? `<td class="der" style="width:170px">
      <label class="chk-req-dev ${reqDev ? 'activo' : ''}" title="Marcar si este material o herramienta requiere devolución al almacén" style="padding:3px 7px;font-size:10.5px">
        <input type="checkbox" data-toggle-reqdev-ord="${o.id}" data-item-idx="${i}" ${reqDev ? 'checked' : ''} />
        <span>Req. devolución</span>
      </label>
      ${yaDevuelto ? '<span class="estado-badge disponible" style="margin-left:4px;font-size:10px">✓ Devuelto</span>' : ''}
    </td>` : '';
    return `<tr><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td class="der"><b>${fmtNum(it.cantidad)}</b> ${esc(it.unidad || '')}</td>${colDev}</tr>`;
  }).join('');
  return `
    <table class="tabla-detalle">
      <thead><tr><th>#</th><th>Material</th><th class="der">Cantidad</th>${esSalida ? '<th class="der">Devolución</th>' : ''}</tr></thead>
      <tbody>${detalle || `<tr><td colspan="${esSalida ? 4 : 3}" style="color:var(--texto-mute)">Sin materiales.</td></tr>`}</tbody>
    </table>
    ${o.nota ? `<div style="padding:6px 12px 4px;font-size:12px;color:var(--texto-dim)"><b>Nota:</b> ${esc(o.nota)}</div>` : ''}`;
}
function diaLocalOrden(f) {
  if (!f) return 'Sin fecha';
  try {
    const d = new Date(f);
    if (isNaN(d.getTime())) return String(f).slice(0, 10) || 'Sin fecha';
    const esMedianocheUTC = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    const tz = esMedianocheUTC ? 'UTC' : 'America/Bogota';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const y = (parts.find((p) => p.type === 'year') || {}).value;
    const m = (parts.find((p) => p.type === 'month') || {}).value;
    const day = (parts.find((p) => p.type === 'day') || {}).value;
    return (y && m && day) ? `${y}-${m}-${day}` : (String(f).slice(0, 10) || 'Sin fecha');
  } catch (e) {
    return String(f).slice(0, 10) || 'Sin fecha';
  }
}

function etiquetaDiaElegante(ymd) {
  if (!ymd || ymd === 'Sin fecha') return 'Sin fecha';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return fmtFechaCorta(ymd);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const txt = dt.toLocaleDateString('es-CO', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  } catch (e) {
    return fmtFechaCorta(ymd);
  }
}

// Conjunto de dias plegados manualmente por el usuario (vacio por defecto = todas las franjas abiertas).
const diasColapsadosOrdenes = new Set();

function renderOrdenes() {
  if (!$('#cuerpo-ordenes')) return;
  $('#ord-vacio').hidden = estado.ordenes.length !== 0;

  // Contar cuantas ordenes hay por dia para mostrar el conteo en la franja
  const conteoPorDia = {};
  for (const o of estado.ordenes) {
    const dKey = diaLocalOrden(o.fecha);
    conteoPorDia[dKey] = (conteoPorDia[dKey] || 0) + 1;
  }

  let diaAnterior = null;
  let html = '';
  for (const o of estado.ordenes) {
    const diaActual = diaLocalOrden(o.fecha);
    const diaCerrado = diasColapsadosOrdenes.has(diaActual);
    if (diaActual !== diaAnterior) {
      diaAnterior = diaActual;
      const cantDia = conteoPorDia[diaActual] || 1;
      html += `
      <tr class="ord-dia-sep${diaCerrado ? ' cerrado' : ''}" data-dia="${esc(diaActual)}" title="Clic para plegar o desplegar las órdenes de este día">
        <td colspan="8">
          <div class="ord-dia-bar">
            <div class="ord-dia-izq">
              <span class="ord-dia-caret">▾</span>
              <span class="ord-dia-dot"></span>
              <span>📅 ${esc(etiquetaDiaElegante(diaActual))}</span>
              <span class="ord-dia-cnt">${cantDia} ${cantDia === 1 ? 'orden' : 'órdenes'}</span>
            </div>
            <div class="ord-dia-linea"></div>
            <span class="ord-dia-grabado">FV INGENIERIA</span>
          </div>
        </td>
      </tr>`;
    }
    const est = estadoOrden(o);
    const pendiente = (o.tipo === 'entrada' && est === 'pendiente');
    const contrato = contratoReal(o);
    const info = estadoOrdenInfo(o);
    const pendDevol = ordenTieneDevolucionPendiente(o);
    const badgeDevol = pendDevol ? '<span class="estado-badge mantenimiento" style="margin-left:4px">🔧 Req. devolución</span>' : '';
    html += `
    <tr class="grupo-row" data-key="${o.id}" data-dia-ord="${esc(diaActual)}" title="Doble clic para ver el detalle"${diaCerrado ? ' hidden' : ''}>
      <td class="codigo-cel"><span class="caret">▸</span> ${esc(o.numero)}</td>
      <td>${fmtFecha(o.fecha)}</td>
      <td><span class="tipo-badge ${o.tipo}">${(TIPOS[o.tipo] || {}).label || o.tipo}</span></td>
      <td><span class="estado-badge ${info.cls}">${info.label}</span>${badgeDevol}</td>
      <td>${ordenResponsablesTexto(o)}</td>
      <td>${o.frente ? (esc(o.frente) + (contrato ? ` <span style="color:var(--texto-mute)">(${esc(contrato)})</span>` : '')) : esc(o.proveedor || '-')}</td>
      <td class="der">${(o.items || []).length}</td>
      <td class="cen"><div class="acciones-cel">
        ${pendiente ? `<button class="btn-icon" title="Recibir / verificar llegada" data-recibir="${o.id}">📥✓</button>` : ''}
        ${pendDevol ? `<button class="btn-icon" title="Devolver materiales / herramientas al almacén" data-devolver-herr="${o.id}" style="color:#f59e0b;border-color:rgba(245,158,11,0.4)">🔁</button>` : ''}
        <button class="btn-icon" title="Repetir esta orden" data-repetir="${o.id}">🔁</button>
        <button class="btn-icon" title="Enviar factura en foto por WhatsApp" data-wa-orden="${o.id}" style="color:#25d366;border-color:rgba(37,211,102,0.35)">📱</button>
        <button class="btn-icon" title="Imprimir / PDF / Opciones" data-print-orden="${o.id}">🖨</button>
        <button class="btn-icon peligro" title="Eliminar orden" data-del-orden="${o.id}">🗑</button>
      </div></td>
    </tr>
    <tr class="grupo-detalle" data-key="${o.id}" data-dia-ord="${esc(diaActual)}" hidden>
      <td colspan="8">${detalleOrdenHtml(o)}</td>
    </tr>`;
  }
  $('#cuerpo-ordenes').innerHTML = html;
  // Plegar / desplegar las ordenes de un dia al hacer clic en su franja azul claro.
  $('#cuerpo-ordenes').querySelectorAll('tr.ord-dia-sep').forEach((sep) => {
    sep.addEventListener('click', () => {
      const diaKey = sep.dataset.dia;
      if (!diaKey) return;
      const ahoraCerrado = !diasColapsadosOrdenes.has(diaKey);
      if (ahoraCerrado) diasColapsadosOrdenes.add(diaKey);
      else diasColapsadosOrdenes.delete(diaKey);
      sep.classList.toggle('cerrado', ahoraCerrado);
      $('#cuerpo-ordenes').querySelectorAll('tr.grupo-row').forEach((r) => {
        if (r.dataset.diaOrd === diaKey) r.hidden = ahoraCerrado;
      });
      $('#cuerpo-ordenes').querySelectorAll('tr.grupo-detalle').forEach((det) => {
        if (det.dataset.diaOrd === diaKey) {
          const filaPadre = det.previousElementSibling;
          det.hidden = ahoraCerrado ? true : !(filaPadre && filaPadre.classList.contains('abierto'));
        }
      });
    });
  });
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
  $('#cuerpo-ordenes').querySelectorAll('[data-toggle-reqdev-ord]').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      e.stopPropagation();
      const ordId = chk.dataset.toggleReqdevOrd;
      const idx = Number(chk.dataset.itemIdx);
      const o = estado.ordenes.find((x) => x.id === ordId);
      if (!o || !o.items || !o.items[idx]) return;
      o.items[idx].reqDevolucion = chk.checked;
      if (chk.checked) o.items[idx].devuelto = false;
      const nuevoEst = recalcularEstadoDevolucionOrden(o);
      o.estado = nuevoEst;
      try {
        await actualizarEstadoOrden(o.id, nuevoEst, o.items);
        renderOrdenes();
        renderResponsable();
        toast(chk.checked ? 'Marcado como: Requiere devolución' : 'Desmarcado de devolución', 'ok');
      } catch (err) {
        toast('Error al actualizar: ' + err.message, 'error');
      }
    });
  });
  $('#cuerpo-ordenes').querySelectorAll('[data-wa-orden]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = estado.ordenes.find((x) => x.id === b.dataset.waOrden);
      if (o) {
        const area = $('#print-area');
        if (area) area.innerHTML = docOrden(o, o.usuario || nombreUsuario());
        docNombreActual = ((o.tipo === 'entrada' ? 'Pedido_' : 'Orden_') + o.numero).replace(/[^\w\-]+/g, '_');
        compartirPorWhatsApp(o);
      }
    }));
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
  $('#cuerpo-ordenes').querySelectorAll('[data-devolver-herr]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); modalDevolverHerramientas(b.dataset.devolverHerr); }));
}

// Abre un modal para devolver materiales o herramientas de una orden de salida.
function modalDevolverHerramientas(ordenId) {
  const orden = estado.ordenes.find((o) => o.id === ordenId);
  if (!orden) { toast('No se encontro la orden', 'error'); return; }
  const pendEntries = (orden.items || [])
    .map((it, origIdx) => ({ it, origIdx }))
    .filter(({ it }) => esItemPendienteDevolucion(it, orden));
  if (pendEntries.length === 0) { toast('Esta orden no tiene materiales ni herramientas pendientes por devolver', 'error'); return; }

  const checkboxes = pendEntries.map(({ it }, i) => {
    const m = estado.materiales.find((x) => x.id === it.materialId);
    const icono = (m && m.esHerramienta) ? '🔧' : '📦';
    return `<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--texto-dim);font-size:13px">
      <input type="checkbox" checked data-devherr-idx="${i}" style="width:auto;flex:none" />
      <span>${icono} ${esc(it.materialNombre)}${m && m.serial ? ' <b>[' + esc(m.serial) + ']</b>' : ''} — <b>${fmtNum(it.cantidad)}</b> ${esc(it.unidad)}</span>
    </label>`;
  }).join('');

  iniciarVentanaTrabajo('🔧');
  abrirModal('Devolver al almacén — ' + (orden.numero || ''), `
    <p style="color:var(--texto-dim);margin-bottom:12px;line-height:1.5">Selecciona los materiales y/o herramientas que se devuelven al almacén. Se reintegrarán al stock / estado <b>disponible</b> y se registrará el movimiento de devolución.</p>
    <div id="devherr-lista" style="margin-bottom:14px">${checkboxes}</div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="devherr-minimizar">▬ Minimizar</button>
      <button class="btn-ghost" id="devherr-cancelar">Cancelar</button>
      <button class="btn-primary" id="devherr-ok">Confirmar devolucion</button>
    </div>`);
  const vActual = ventanas.activa;

  if ($('#devherr-minimizar')) $('#devherr-minimizar').addEventListener('click', minimizarModal);
  $('#devherr-cancelar').addEventListener('click', () => cerrarVentana(vActual));
  $('#devherr-ok').addEventListener('click', async () => {
    const btn = $('#devherr-ok'); btn.disabled = true; btn.textContent = 'Procesando...';
    try {
      const checks = Array.from($('#devherr-lista').querySelectorAll('input[type="checkbox"]'));
      let count = 0;
      const devueltas = [];
      for (let i = 0; i < pendEntries.length; i++) {
        if (!checks[i] || !checks[i].checked) continue;
        const { it, origIdx } = pendEntries[i];
        const mat = estado.materiales.find((x) => x.id === it.materialId) ||
          estado.materiales.find((x) => normTxt(x.nombre) === normTxt(it.materialNombre));
        if (mat && mat.esHerramienta) {
          await actualizarHerramientaDespacho(mat.id, orden.responsable || '', orden.frente || '', 'devolucion');
        }
        if (mat && mat.id) {
          await registrarMovimiento({
            tipo: 'devolucion',
            materialId: mat.id,
            materialNombre: it.materialNombre || mat.nombre,
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || mat.unidad || 'unidad',
            frente: orden.frente || '',
            contrato: contratoDeFrente(orden.frente || ''),
            proveedor: '',
            responsable: orden.responsable || '',
            nota: 'Devolución de ' + (mat.esHerramienta ? 'herramienta' : 'material') + ' (orden ' + (orden.numero || '') + ')',
            usuario: nombreUsuario()
          });
        }
        if (orden.items && orden.items[origIdx]) {
          orden.items[origIdx].devuelto = true;
          orden.items[origIdx].fechaDevolucion = new Date().toISOString();
        }
        devueltas.push(it);
        count++;
      }
      if (count === 0) { toast('No seleccionaste ningún ítem para devolver', 'error'); btn.disabled = false; btn.textContent = 'Confirmar devolucion'; return; }
      // Actualizar el estado y los items de la orden segun si se devolvieron todos o quedan pendientes.
      const nuevoEstado = recalcularEstadoDevolucionOrden(orden);
      orden.estado = nuevoEstado;
      await actualizarEstadoOrden(orden.id, nuevoEstado, orden.items);
      cerrarVentana(vActual);
      toast(nuevoEstado === 'devolucion_completada' ? 'Todos los ítems devueltos — orden completada' : 'Devolución parcial — quedan ítems pendientes', 'ok');
      imprimirOrdenDevolucion(orden, devueltas);
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar devolucion'; }
  });
}

// Genera e imprime el documento de devolucion de materiales / herramientas.
function imprimirOrdenDevolucion(orden, itemsDevueltos) {
  const contrato = contratoReal(orden);
  const filas = itemsDevueltos.map((it, i) => {
    const m = estado.materiales.find((x) => x.id === it.materialId);
    return `<tr><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td>${esc(m && m.serial ? m.serial : '-')}</td><td style="text-align:right">${fmtNum(it.cantidad)}</td><td>${esc(it.unidad || '')}</td></tr>`;
  }).join('');
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">ORDEN DE DEVOLUCION AL ALMACEN</h2>
    <div class="doc-meta">
      <div><b>Orden original:</b> ${esc(orden.numero || '-')}</div>
      <div><b>Fecha de devolucion:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Contrato:</b> ${esc(contrato || '-')}</div>
      <div><b>Frente de obra:</b> ${esc(orden.frente || '-')}</div>
      <div><b>Responsable:</b> ${esc(orden.responsable || '-')}</div>
      <div><b>Items devueltos:</b> ${itemsDevueltos.length}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>#</th><th>Material / Herramienta</th><th>Serial</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="border:2px solid #2ecc71;border-radius:10px;padding:14px 18px;margin:18px 0;text-align:center;color:#27ae60;font-size:14px;font-weight:bold;line-height:1.5">
      ✅ MATERIALES / HERRAMIENTAS RECIBIDOS EN ALMACEN<br>
      <span style="font-size:12px;font-weight:normal;color:#333">Stock y estado actualizados a DISPONIBLE en el sistema</span>
    </div>
    ${firmasDoc(nombreUsuario(), orden.responsable)}
  </div>`;
  const waTexto = '✅ *Devolución de la orden (' + (orden.numero || '-') + ')*\n\n'
    + itemsDevueltos.map((it) => '• ' + it.materialNombre).join('\n')
    + '\n\n✅ Devuelto exitosamente';
  window._devolucionWhatsAppTexto = waTexto;
  imprimir(html, 'Devolucion_' + (orden.numero || 'almacen'));
}

// Abre "Nueva orden" precargada con los materiales de una orden existente,
// para volver a despacharla ajustando solo lo necesario.
function repetirOrden(orden) {
  if (!orden) return;
  const items = (orden.items || [])
    .filter((it) => estado.materiales.some((m) => m.id === it.materialId))
    .map((it) => ({ materialId: it.materialId, cantidad: it.cantidad, reqDevolucion: esItemReqDevolucion(it) }));
  const faltan = (orden.items || []).length - items.length;
  const precarga = {
    frente: orden.frente || '',
    proveedor: orden.proveedor || '',
    responsable: orden.responsable || '',
    nota: orden.nota || '',
    items: items.length ? items : [{ materialId: '', cantidad: '', reqDevolucion: false }]
  };
  modalOrden(orden.tipo, precarga);
  if (faltan > 0) toast(faltan + ' material(es) de la orden original ya no existen y no se cargaron', 'error');
}

function modalRecibir(orden) {
  iniciarVentanaTrabajo('📥');
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
      <button class="btn-ghost" id="rec-minimizar">▬ Minimizar</button>
      <button class="btn-ghost" id="rec-cancelar">Cancelar</button>
      <button class="btn-primary" id="rec-ok">Confirmar recepcion</button>
    </div>
    <datalist id="lista-categorias-rec">${categoriasExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
    <datalist id="lista-clases-rec">${clasesExistentes().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`, '660px');
  const vActual = ventanas.activa;

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
  if ($('#rec-minimizar')) $('#rec-minimizar').addEventListener('click', minimizarModal);
  $('#rec-cancelar').addEventListener('click', () => cerrarVentana(vActual));
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
      cerrarVentana(vActual);
    } catch (e) { toast('Error: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Confirmar recepcion'; }
  });
}

/* ---- Borrador de orden (autoguardado en el equipo) + opciones agrupadas ---- */
function normTxt(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function claveBorradorOrden(tipo) { return 'fviecom_borrador_orden_' + tipo; }
function guardarBorradorEnClave(clave, itemsRef) {
  if (!clave) return;
  try {
    const respRows = Array.from(document.querySelectorAll('#o-responsables-list .resp-row'));
    const responsables = respRows.map((row) => ({
      nombre: (row.querySelector('.resp-nombre') || {}).value || '',
      whatsapp: (row.querySelector('.resp-whatsapp') || {}).value || ''
    })).filter((r) => r.nombre || r.whatsapp);
    const d = {
      frente: (($('#o-frente') || {}).value) || '',
      proveedor: (($('#o-proveedor') || {}).value) || '',
      responsable: responsables.length > 0 ? responsables[0].nombre : '',
      responsables: responsables,
      nota: (($('#o-nota') || {}).value) || '',
      items: (itemsRef || estado.itemsOrden || []).map((it) => ({ materialId: it.materialId || '', cantidad: it.cantidad || '', reqDevolucion: !!it.reqDevolucion })),
      ts: Date.now()
    };
    const hayAlgo = d.frente || d.proveedor || d.responsable || d.nota ||
      d.items.some((it) => it.materialId || (it.cantidad !== '' && it.cantidad != null));
    if (hayAlgo) localStorage.setItem(clave, JSON.stringify(d));
    else localStorage.removeItem(clave);
  } catch (e) { /* localStorage no disponible: se ignora */ }
}
function guardarBorradorOrden(tipo) { guardarBorradorEnClave(claveBorradorOrden(tipo)); }
function leerBorradorOrden(tipo) {
  try { return JSON.parse(localStorage.getItem(claveBorradorOrden(tipo)) || 'null'); }
  catch (e) { return null; }
}
function limpiarBorradorOrden(tipo) {
  try { localStorage.removeItem(claveBorradorOrden(tipo)); } catch (e) { /* ignore */ }
}
function limpiarBorradorClave(clave) {
  if (!clave) return;
  try { localStorage.removeItem(clave); } catch (e) { /* ignore */ }
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
  const iconoOrden = tipo === 'entrada' ? '📥' : tipo === 'devolucion' ? '🔄' : '📤';

  // IMPORTANTE: estacionar cualquier ventana activa ANTES de modificar estado.itemsOrden
  iniciarVentanaTrabajo(iconoOrden);

  // Determinar clave de borrador: si la clave principal ya está en uso por otra ventana abierta,
  // asignamos una clave propia para esta nueva ventana paralela y abrimos limpia.
  const claveBase = claveBorradorOrden(tipo);
  let claveEnUso = ventanas.lista.some((w) => w.draftKey === claveBase);
  if (!claveEnUso) {
    try {
      const vivas = JSON.parse(localStorage.getItem(CLAVE_VIVAS) || '{}');
      if (vivas[claveBase] && (Date.now() - vivas[claveBase] < 60000)) claveEnUso = true;
    } catch (_e) { /* ignore */ }
  }
  const clavePropia = (!precarga && !claveEnUso)
    ? claveBase
    : `${claveBase}_${TAB_ID}_${ventanas.seq + 1}`;

  // Fuente de datos: 'precarga' tiene prioridad; si no y es la primera ventana de este tipo, recupera borrador.
  const borrador = (precarga || claveEnUso) ? null : leerBorradorOrden(tipo);
  const base = precarga || borrador;
  if (base && Array.isArray(base.items) && base.items.length) {
    estado.itemsOrden = base.items.map((it, i) => {
      const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
      const reqDev = it.reqDevolucion !== undefined ? !!it.reqDevolucion : !!(m && m.esHerramienta);
      return { _id: Date.now() + i, materialId: it.materialId || '', cantidad: it.cantidad || '', reqDevolucion: reqDev, _filtro: '' };
    });
  } else {
    estado.itemsOrden = [{ _id: Date.now(), materialId: '', cantidad: '', reqDevolucion: false, _filtro: '' }];
  }
  const misItemsOrden = estado.itemsOrden;

  const numAbiertasMismoTipo = ventanas.lista.filter((w) => w.multitarea && w.ordenTipo === tipo).length + 1;
  const sufijoNum = numAbiertasMismoTipo > 1 ? ` #${numAbiertasMismoTipo}` : '';
  const tituloBase = `Orden ${t.label}${sufijoNum}`;

  abrirModal(tituloBase, `
    ${borrador ? `<div class="orden-aviso">📝 Recuperamos una orden sin terminar. <button type="button" id="o-nuevo" class="link-btn">Empezar de nuevo</button></div>` : ''}
    ${precarga ? `<div class="orden-aviso">${esc(precarga.aviso || '🔁 Orden copiada. Ajusta lo que necesites y genera una nueva.')}</div>` : ''}
    <div class="form-grid">
      ${esProveedor ? `<div class="campo"><label>Proveedor</label><input id="o-proveedor" placeholder="Nombre del proveedor" /></div>` : ''}
      <div class="campo"><label>Frente de obra (opcional)</label>${frenteSelectHtml('o-frente', base ? (base.frente || '') : '')}</div>
      <div class="campo full"><label style="font-weight:600">Responsable(s)</label>
        <div id="o-responsables-list"></div>
        <button type="button" class="btn-ghost" id="o-add-resp" style="margin-top:6px;font-size:12px">＋ Agregar responsable</button>
        <datalist id="lista-resp-ord">${responsablesExistentes().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      </div>
      <div class="campo full"><label>Nota (opcional)</label><input id="o-nota" placeholder="Observaciones de la orden" /></div>
      ${htmlCampoFecha('o-fecha')}
    </div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin:14px 0 6px;font-weight:600">Materiales / Herramientas</label>
    ${estado.kits.length ? `<div class="kit-cargar">
      <select id="o-kit"><option value="">— Elegir un kit —</option>${estado.kits.map((k) => `<option value="${k.id}">${esc(k.nombre)} (${(k.items || []).length})</option>`).join('')}</select>
      <button type="button" class="btn-ghost" id="o-cargar-kit">📦 Cargar kit</button>
    </div>` : ''}
    <div class="orden-items" id="orden-items"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-ghost orden-add" id="o-add" style="flex:1;min-width:160px">＋ Agregar material</button>
      <button type="button" class="btn-ghost orden-add btn-ia-scan" id="o-scan-ia" style="flex:1;min-width:200px" title="Toma o sube una foto de la lista (incluso escrita a mano) y la IA llena los renglones">📷 Escanear lista (foto / letra a mano)</button>
    </div>
    <div style="font-size:11px;color:var(--texto-dim);margin-top:4px;text-align:right">💡 También puedes <b>pegar (Ctrl+V)</b> o <b>arrastrar</b> una foto de la lista sobre esta ventana.</div>
    <div class="orden-total" id="o-total"></div>
    <div class="modal-acciones" style="flex-wrap:wrap">
      <button type="button" class="btn-ghost" id="o-otra-paralela" title="Estacionar esta orden en la barra inferior y abrir otra orden nueva simultáneamente" style="margin-right:auto;color:#00c8ff;border-color:rgba(0,200,255,0.3)">🗂 ＋ Otra orden paralela</button>
      <button class="btn-ghost" id="o-minimizar" title="Minimizar en la barra inferior">▬ Minimizar</button>
      <button class="btn-ghost" id="o-cancelar">Cancelar</button>
      <button class="btn-primary" id="o-guardar">Generar e imprimir</button>
    </div>`, '640px');

  const vActual = ventanas.activa;
  if (vActual) {
    vActual.draftKey = clavePropia;
    vActual.ordenTipo = tipo;
  }
  marcarVentanasVivas();

  // --- Multi-responsables: estado local para filas de responsable ---
  let responsablesOrden = [];
  if (base && Array.isArray(base.responsables) && base.responsables.length) {
    responsablesOrden = base.responsables.map((r, i) => ({ _id: Date.now() + i, nombre: r.nombre || '', whatsapp: r.whatsapp || '' }));
  } else if (base && base.responsable) {
    responsablesOrden = [{ _id: Date.now(), nombre: base.responsable, whatsapp: base.whatsappResponsable || '' }];
  } else {
    responsablesOrden = [{ _id: Date.now(), nombre: '', whatsapp: '' }];
  }

  const actualizarTituloOrden = () => {
    if (!vActual) return;
    const fVal = (($('#o-frente') || {}).value || '').trim();
    const pVal = (($('#o-proveedor') || {}).value || '').trim();
    const rNom = (responsablesOrden[0] && responsablesOrden[0].nombre || '').trim();
    const partes = [tituloBase];
    if (fVal) partes.push('Fr. ' + fVal);
    else if (pVal) partes.push(pVal);
    if (rNom) partes.push(rNom);
    vActual.titulo = partes.join(' · ');
    if (ventanas.activa === vActual) $('#modal-titulo').textContent = vActual.titulo;
    renderBarraVentanas();
  };

  const persistir = () => {
    guardarBorradorEnClave(clavePropia, estado.itemsOrden);
    actualizarTituloOrden();
  };

  const renderResponsables = () => {
    const cont = $('#o-responsables-list');
    const listaWa = Object.entries(leerDirectorioResp()).map(([n, w]) => w ? `<option value="${esc(w)}" label="${esc(n)}"></option>` : '').join('');
    cont.innerHTML = responsablesOrden.map((r) => `
      <div class="resp-row" data-resp="${r._id}" style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input type="text" class="resp-nombre" list="lista-resp-ord" placeholder="Nombre del responsable" value="${esc(r.nombre)}" style="flex:2" />
        <input type="text" class="resp-whatsapp" list="lista-wa-ord" placeholder="WhatsApp (ej: 573001234567)" value="${esc(r.whatsapp)}" style="flex:1.2" />
        <button type="button" class="btn-icon peligro resp-quitar" title="Quitar" style="flex:none">✕</button>
      </div>`).join('');
    // Datalist de numeros de WhatsApp conocidos
    if (!$('#lista-wa-ord')) {
      const dl = document.createElement('datalist'); dl.id = 'lista-wa-ord'; dl.innerHTML = listaWa; document.body.appendChild(dl);
    } else { $('#lista-wa-ord').innerHTML = listaWa; }
    cont.querySelectorAll('.resp-row').forEach((row) => {
      const id = Number(row.dataset.resp);
      const item = responsablesOrden.find((x) => x._id === id);
      const nomEl = row.querySelector('.resp-nombre');
      const waEl = row.querySelector('.resp-whatsapp');
      const autocompletarWa = () => {
        const waGuardado = buscarWhatsappResp(nomEl.value);
        if (waGuardado && !waEl.value) { waEl.value = waGuardado; item.whatsapp = waGuardado; }
      };
      nomEl.addEventListener('input', () => { item.nombre = nomEl.value; autocompletarWa(); persistir(); });
      nomEl.addEventListener('change', () => { item.nombre = nomEl.value; autocompletarWa(); persistir(); });
      nomEl.addEventListener('blur', () => { item.nombre = nomEl.value; autocompletarWa(); persistir(); });
      waEl.addEventListener('input', () => { item.whatsapp = waEl.value; persistir(); });
      row.querySelector('.resp-quitar').addEventListener('click', () => {
        responsablesOrden = responsablesOrden.filter((x) => x._id !== id);
        if (responsablesOrden.length === 0) responsablesOrden.push({ _id: Date.now(), nombre: '', whatsapp: '' });
        renderResponsables(); persistir();
      });
    });
  };
  renderResponsables();
  vincularCampoFecha('o-fecha');
  $('#o-add-resp').addEventListener('click', () => { responsablesOrden.push({ _id: Date.now() + Math.random(), nombre: '', whatsapp: '' }); renderResponsables(); persistir(); });

  // Restaurar los textos (del borrador o de la orden copiada).
  if (base) {
    if ($('#o-proveedor')) $('#o-proveedor').value = base.proveedor || '';
    if ($('#o-nota')) $('#o-nota').value = base.nota || '';
  }
  actualizarTituloOrden();

  const render = () => {
    const cont = $('#orden-items');
    const mostrarChkDev = (tipo === 'salida');
    cont.innerHTML = estado.itemsOrden.map((it) => `
      <div class="orden-item-row" data-row="${it._id}">
        <div class="mat-picker">
          <input type="text" class="mat-filtro" placeholder="🔎 Escribe para filtrar (nombre, codigo o categoria)" data-campo="filtro" value="${esc(it._filtro || '')}" />
          <select data-campo="materialId">${opcionesMaterialAgrupadas(it.materialId, it._filtro)}</select>
        </div>
        <input type="number" step="any" min="0" placeholder="Cantidad" data-campo="cantidad" value="${it.cantidad}" />
        ${mostrarChkDev ? `
        <label class="chk-req-dev ${it.reqDevolucion ? 'activo' : ''}" title="Marcar si este material o herramienta requiere devolución al almacén">
          <input type="checkbox" data-campo="reqDevolucion" ${it.reqDevolucion ? 'checked' : ''} />
          <span>Req. dev.</span>
        </label>` : ''}
        <button class="btn-icon peligro" data-quitar="${it._id}" title="Quitar">✕</button>
      </div>`).join('');
    cont.querySelectorAll('.orden-item-row').forEach((row) => {
      const id = Number(row.dataset.row);
      const item = estado.itemsOrden.find((x) => x._id === id);
      const selEl = row.querySelector('select[data-campo="materialId"]');
      const filtroEl = row.querySelector('.mat-filtro');
      const cantEl = row.querySelector('input[data-campo="cantidad"]');
      const chkDevEl = row.querySelector('input[data-campo="reqDevolucion"]');
      const lblDevEl = row.querySelector('.chk-req-dev');
      // Filtrar en vivo: solo se reconstruyen las opciones del select, sin
      // volver a dibujar toda la fila, para no perder el foco del teclado.
      filtroEl.addEventListener('input', () => {
        item._filtro = filtroEl.value;
        selEl.innerHTML = opcionesMaterialAgrupadas(item.materialId, item._filtro);
      });
      selEl.addEventListener('change', () => {
        item.materialId = selEl.value;
        const matSel = estado.materiales.find((x) => x.id === item.materialId);
        if (matSel && matSel.esHerramienta) {
          item.reqDevolucion = true;
          if (chkDevEl) chkDevEl.checked = true;
          if (lblDevEl) lblDevEl.classList.add('activo');
        }
        actualizarTotal();
        persistir();
      });
      cantEl.addEventListener('input', () => { item.cantidad = cantEl.value; actualizarTotal(); persistir(); });
      if (chkDevEl) {
        chkDevEl.addEventListener('change', () => {
          item.reqDevolucion = chkDevEl.checked;
          if (lblDevEl) lblDevEl.classList.toggle('activo', chkDevEl.checked);
          actualizarTotal();
          persistir();
        });
      }
      row.querySelector('[data-quitar]').addEventListener('click', () => {
        estado.itemsOrden = estado.itemsOrden.filter((x) => x._id !== id);
        if (estado.itemsOrden.length === 0) estado.itemsOrden.push({ _id: Date.now(), materialId: '', cantidad: '', reqDevolucion: false, _filtro: '' });
        render(); persistir();
      });
    });
    actualizarTotal();
  };
  const actualizarTotal = () => {
    const validos = estado.itemsOrden.filter((it) => it.materialId && Number(it.cantidad) > 0);
    const n = validos.length;
    const nDev = validos.filter((it) => it.reqDevolucion).length;
    const txtDev = (tipo === 'salida' && nDev > 0) ? ` · 🔧 ${nDev} requiere(n) devolución` : '';
    $('#o-total').textContent = n > 0 ? `${n} material(es) en la orden${txtDev}.` : 'Agrega al menos un material con cantidad.';
  };
  render();

  // Guardar el borrador cuando cambian los campos de cabecera.
  ['o-frente', 'o-proveedor', 'o-nota'].forEach((cid) => {
    const el = $('#' + cid);
    if (el) { el.addEventListener('change', persistir); el.addEventListener('input', persistir); }
  });

  // "Empezar de nuevo": descarta el borrador y reabre limpio.
  if ($('#o-nuevo')) $('#o-nuevo').addEventListener('click', () => { limpiarBorradorClave(clavePropia); cerrarVentana(vActual); modalOrden(tipo); });

  // Cargar un kit: agrega sus materiales a la orden (sin borrar lo ya puesto).
  if ($('#o-cargar-kit')) $('#o-cargar-kit').addEventListener('click', () => {
    const kit = estado.kits.find((k) => k.id === $('#o-kit').value);
    if (!kit) { toast('Elige un kit de la lista', 'error'); return; }
    const nuevos = (kit.items || [])
      .filter((it) => estado.materiales.some((m) => m.id === it.materialId))
      .map((it) => {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        return { _id: Date.now() + Math.random(), materialId: it.materialId, cantidad: it.cantidad, reqDevolucion: !!(it.reqDevolucion || (m && m.esHerramienta)), _filtro: '' };
      });
    if (nuevos.length === 0) { toast('Los materiales de este kit ya no existen en el inventario', 'error'); return; }
    estado.itemsOrden = estado.itemsOrden.filter((it) => it.materialId || (it.cantidad !== '' && it.cantidad != null));
    estado.itemsOrden = estado.itemsOrden.concat(nuevos);
    if (estado.itemsOrden.length === 0) estado.itemsOrden.push({ _id: Date.now(), materialId: '', cantidad: '', reqDevolucion: false, _filtro: '' });
    render(); persistir();
    toast('Kit "' + kit.nombre + '" cargado', 'ok');
  });

  const aplicarDatosIAEnOrden = (datosIA) => {
    if (vActual && ventanas.activa !== vActual) {
      restaurarVentana(vActual);
    }
    const nuevos = (datosIA.items || [])
      .filter((it) => it.materialId)
      .map((it) => {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        return {
          _id: Date.now() + Math.random(),
          materialId: it.materialId,
          cantidad: it.cantidad || 1,
          reqDevolucion: it.reqDevolucion !== undefined ? !!it.reqDevolucion : !!(m && m.esHerramienta),
          _filtro: ''
        };
      });
    if (nuevos.length > 0) {
      estado.itemsOrden = (estado.itemsOrden || []).filter((it) => it.materialId || (it.cantidad !== '' && it.cantidad != null));
      estado.itemsOrden = estado.itemsOrden.concat(nuevos);
    }
    if (!estado.itemsOrden || estado.itemsOrden.length === 0) {
      estado.itemsOrden = [{ _id: Date.now(), materialId: '', cantidad: '', reqDevolucion: false, _filtro: '' }];
    }
    if (datosIA.frente && $('#o-frente') && !$('#o-frente').value) {
      $('#o-frente').value = datosIA.frente;
    }
    if (datosIA.proveedor && $('#o-proveedor') && !$('#o-proveedor').value) {
      $('#o-proveedor').value = datosIA.proveedor;
    }
    if (datosIA.nota && $('#o-nota') && !$('#o-nota').value) {
      $('#o-nota').value = datosIA.nota;
    }
    if (Array.isArray(datosIA.responsables) && datosIA.responsables.length > 0) {
      const vacio = responsablesOrden.length === 1 && !responsablesOrden[0].nombre.trim();
      const nuevosResp = datosIA.responsables.filter(Boolean).map((nom, idx) => ({
        _id: Date.now() + idx + Math.random(),
        nombre: typeof nom === 'string' ? nom : (nom.nombre || ''),
        whatsapp: typeof nom === 'string' ? buscarWhatsappResp(nom) : (nom.whatsapp || buscarWhatsappResp(nom.nombre || ''))
      })).filter((r) => r.nombre);
      if (nuevosResp.length > 0) {
        if (vacio) responsablesOrden = nuevosResp;
        else {
          for (const nr of nuevosResp) {
            if (!responsablesOrden.some((r) => normTxt(r.nombre) === normTxt(nr.nombre))) {
              responsablesOrden.push(nr);
            }
          }
        }
        renderResponsables();
      }
    }
    render();
    persistir();
    toast(`✨ ${nuevos.length} renglón(es) agregados desde IA a la orden`, 'ok');
  };

  if (vActual) {
    vActual.aplicarDatosIA = aplicarDatosIAEnOrden;
  }

  $('#o-add').addEventListener('click', () => { estado.itemsOrden.push({ _id: Date.now() + Math.random(), materialId: '', cantidad: '', reqDevolucion: false, _filtro: '' }); render(); persistir(); });
  if ($('#o-scan-ia')) {
    $('#o-scan-ia').addEventListener('click', () => {
      modalEscanearListaIA({
        enOrdenActiva: true,
        tipoOrden: tipo,
        alConfirmarEnOrden: aplicarDatosIAEnOrden
      });
    });
  }
  const cuerpoModalOrd = $('#modal-body');
  if (cuerpoModalOrd) {
    cuerpoModalOrd.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    cuerpoModalOrd.addEventListener('drop', (ev) => {
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f && f.type && f.type.startsWith('image/')) {
        ev.preventDefault();
        modalEscanearListaIA({
          enOrdenActiva: true,
          tipoOrden: tipo,
          archivoInicial: f,
          alConfirmarEnOrden: aplicarDatosIAEnOrden
        });
      }
    });
  }
  if ($('#o-otra-paralela')) $('#o-otra-paralela').addEventListener('click', () => {
    modalOrden(tipo);
    toast('Nueva orden abierta en paralelo. La anterior quedo en la barra inferior.', 'ok');
  });
  if ($('#o-minimizar')) $('#o-minimizar').addEventListener('click', minimizarModal);
  $('#o-cancelar').addEventListener('click', () => { limpiarBorradorClave(clavePropia); cerrarVentana(vActual); });
  $('#o-guardar').addEventListener('click', async () => {
    const listaItemsActual = (vActual && vActual.snapshot && vActual.snapshot.itemsOrden) ? vActual.snapshot.itemsOrden : (estado.itemsOrden || misItemsOrden);
    const items = listaItemsActual
      .filter((it) => it.materialId && Number(it.cantidad) > 0)
      .map((it) => {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        return {
          materialId: it.materialId,
          materialNombre: m ? m.nombre : '',
          cantidad: Number(it.cantidad),
          unidad: m ? m.unidad : 'unidad',
          reqDevolucion: !!(it.reqDevolucion || (m && m.esHerramienta)),
          devuelto: false
        };
      });
    if (items.length === 0) { toast('Agrega al menos un material con cantidad', 'error'); return; }
    // Validar stock en salidas
    if (tipo === 'salida') {
      for (const it of items) {
        const m = estado.materiales.find((x) => x.id === it.materialId);
        if (m && it.cantidad > (Number(m.cantidad) || 0)) { toast(`Stock insuficiente de "${m.nombre}" (disp: ${fmtNum(m.cantidad)})`, 'error'); return; }
      }
    }
    const raizDom = (vActual && vActual.nodo) ? vActual.nodo : document;
    const qDom = (sel) => raizDom.querySelector(sel);
    const frenteVal = ((qDom('#o-frente') || {}).value || '').trim();
    const proveedorVal = ((qDom('#o-proveedor') || {}).value || '').trim();
    const notaVal = ((qDom('#o-nota') || {}).value || '').trim();
    const fechaEl = qDom('#o-fecha');
    const fechaVal = (fechaEl && fechaEl.dataset.tocado === '1') ? new Date(fechaEl.value).toISOString() : null;
    if ((tipo === 'salida' || tipo === 'devolucion') && !frenteVal) {
      if (!confirm('Estas generando esta orden SIN frente de obra. Deseas continuar?')) return;
    }
    // Obtener responsables del formulario
    const respFinales = responsablesOrden.filter((r) => r.nombre.trim());
    const responsablePrincipal = respFinales.length > 0 ? respFinales[0].nombre.trim() : '';
    const responsablesArr = respFinales.map((r) => ({ nombre: r.nombre.trim(), whatsapp: r.whatsapp.trim() }));
    const btn = qDom('#o-guardar'); if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
    try {
      const orden = await registrarOrden({
        tipo,
        frente: frenteVal,
        contrato: contratoDeFrente(frenteVal),
        proveedor: proveedorVal,
        responsable: responsablePrincipal,
        responsables: responsablesArr,
        nota: notaVal,
        usuario: nombreUsuario(), items,
        fecha: fechaVal
      });
      // Actualizar estado de herramientas despachadas
      if (tipo === 'salida') {
        for (const it of items) {
          const mat = estado.materiales.find((x) => x.id === it.materialId);
          if (mat && mat.esHerramienta) {
            await actualizarHerramientaDespacho(it.materialId, responsablePrincipal, frenteVal, 'salida');
          }
        }
      }
      limpiarBorradorClave(clavePropia);
      guardarDirectorioResp(responsablesOrden);
      cerrarVentana(vActual);
      toast(tipo === 'entrada' ? ('Pedido generado (pendiente de recibir): ' + orden.numero) : ('Orden generada: ' + orden.numero), 'ok');
      imprimir(docOrden(orden, orden.usuario || nombreUsuario()), (tipo === 'entrada' ? 'Pedido_' : 'Orden_') + orden.numero);
    } catch (e) { toast('Error: ' + e.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Generar e imprimir'; } }
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
   HERRAMIENTAS (vista separada con trazabilidad)
   ================================================================== */
function renderHerramientas() {
  const tbody = $('#cuerpo-herramientas');
  if (!tbody) return;
  const buscar = ($('#buscar-herr') && $('#buscar-herr').value || '').toLowerCase().trim();
  const filtroEstado = ($('#filtro-estado-herr') && $('#filtro-estado-herr').value) || '';
  let herramientas = estado.materiales.filter((m) => m.esHerramienta);
  if (buscar) {
    herramientas = herramientas.filter((h) =>
      (h.serial || '').toLowerCase().includes(buscar) ||
      (h.nombre || '').toLowerCase().includes(buscar) ||
      (h.marca || '').toLowerCase().includes(buscar) ||
      (h.modelo || '').toLowerCase().includes(buscar)
    );
  }
  if (filtroEstado) herramientas = herramientas.filter((h) => h.estadoHerr === filtroEstado);

  const vacio = $('#herr-vacio');
  if (vacio) vacio.hidden = herramientas.length > 0;
  if (herramientas.length === 0) { tbody.innerHTML = ''; return; }

  const estadoLabel = (e) => {
    const labels = { disponible: 'Disponible', en_uso: 'En uso', mantenimiento: 'Mantenimiento', baja: 'Baja' };
    return labels[e] || e || 'Disponible';
  };

  // Agrupar por categoria (tipo de herramienta), luego por clase
  const porTipo = {};
  for (const h of herramientas) {
    const tipo = h.categoria || 'Sin clasificar';
    const clase = (h.clase || '').trim() || 'Sin clase';
    porTipo[tipo] = porTipo[tipo] || {};
    (porTipo[tipo][clase] = porTipo[tipo][clase] || []).push(h);
  }
  const tipos = Object.keys(porTipo).sort((a, b) => a.localeCompare(b));

  let html = '';
  for (const tipo of tipos) {
    const clases = Object.keys(porTipo[tipo]).sort((a, b) => a.localeCompare(b));
    const totalTipo = clases.reduce((s, c) => s + porTipo[tipo][c].length, 0);
    const tipoCerrado = !herrGruposAbiertos.tipos.has(tipo);
    html += `<tr class="inv-tipo ${tipoCerrado ? '' : 'abierto'}" data-toggle-herr-cat="${esc(tipo)}"><td colspan="7"><span class="caret">\u25B8</span> \uD83D\uDD27 ${esc(tipo)} <span class="conteo">(${totalTipo})</span></td></tr>`;
    for (const clase of clases) {
      const items = porTipo[tipo][clase].slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
      const cKey = tipo + '||' + clase;
      const claseCerrada = !herrGruposAbiertos.clases.has(cKey);
      html += `<tr class="inv-clase ${claseCerrada ? '' : 'abierto'}" data-toggle-herr-clase="${esc(cKey)}"${tipoCerrado ? ' hidden' : ''}><td colspan="7"><span class="caret">\u25B8</span> ${esc(clase)} <span class="conteo">(${items.length})</span></td></tr>`;
      const filasOcultas = tipoCerrado || claseCerrada;
      for (const h of items) {
        html += `<tr data-herr-id="${h.id}" style="cursor:pointer"${filasOcultas ? ' hidden' : ''}>
      <td><b>${esc(h.serial || '-')}</b></td>
      <td>${esc(h.nombre)}</td>
      <td>${esc(h.marca || '')}${h.modelo ? ' / ' + esc(h.modelo) : ''}</td>
      <td><span class="estado-badge ${esc(h.estadoHerr || 'disponible')}">${estadoLabel(h.estadoHerr)}</span></td>
      <td>${esc(h.responsableActual || '-')}</td>
      <td>${h.frenteActual ? 'Frente ' + esc(h.frenteActual) : '-'}</td>
      <td class="cen">
        <button class="btn-ghost btn-sm" data-herr-editar="${h.id}" title="Editar">\u270E</button>
        <button class="btn-ghost btn-sm" data-herr-traza="${h.id}" title="Ver trazabilidad">\uD83D\uDCCD</button>
      </td>
    </tr>`;
      }
    }
  }

  tbody.innerHTML = html;

  // Toggle eventos para categorias
  tbody.querySelectorAll('[data-toggle-herr-cat]').forEach((el) => el.addEventListener('click', () => {
    const t = el.dataset.toggleHerrCat;
    if (herrGruposAbiertos.tipos.has(t)) herrGruposAbiertos.tipos.delete(t); else herrGruposAbiertos.tipos.add(t);
    renderHerramientas();
  }));
  tbody.querySelectorAll('[data-toggle-herr-clase]').forEach((el) => el.addEventListener('click', () => {
    const c = el.dataset.toggleHerrClase;
    if (herrGruposAbiertos.clases.has(c)) herrGruposAbiertos.clases.delete(c); else herrGruposAbiertos.clases.add(c);
    renderHerramientas();
  }));
  // Eventos de acciones
  tbody.querySelectorAll('[data-herr-traza]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); modalTrazabilidad(btn.dataset.herrTraza); });
  });
  tbody.querySelectorAll('[data-herr-editar]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); modalMaterial(btn.dataset.herrEditar); });
  });
  tbody.querySelectorAll('[data-herr-id]').forEach((tr) => {
    tr.addEventListener('dblclick', () => modalTrazabilidad(tr.dataset.herrId));
  });
}

function modalTrazabilidad(id) {
  const h = estado.materiales.find((x) => x.id === id);
  if (!h) return;
  const historial = h.historial || [];
  const filas = historial.length > 0
    ? historial.map((ev, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(ev.fecha || '-')}</td>
        <td>${esc(ev.accion || '-')}</td>
        <td>${esc(ev.responsable || '-')}</td>
        <td>${ev.frente ? 'Frente ' + esc(ev.frente) : '-'}</td>
        <td>${esc(ev.nota || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--texto-mute)">Sin historial registrado</td></tr>';

  abrirModal('Trazabilidad: ' + (h.nombre || ''), `
    <div style="margin-bottom:12px">
      <p style="color:var(--texto-dim);margin:0 0 4px"><b>Serial:</b> ${esc(h.serial || '-')} &nbsp; <b>Marca:</b> ${esc(h.marca || '-')} &nbsp; <b>Modelo:</b> ${esc(h.modelo || '-')}</p>
      <p style="color:var(--texto-dim);margin:0"><b>Estado:</b> <span class="estado-badge ${esc(h.estadoHerr || 'disponible')}">${esc(h.estadoHerr || 'disponible')}</span>
        &nbsp; <b>Responsable:</b> ${esc(h.responsableActual || '-')} &nbsp; <b>Frente:</b> ${h.frenteActual ? 'Frente ' + esc(h.frenteActual) : '-'}</p>
    </div>
    <div class="panel sin-pad" style="max-height:320px;overflow:auto">
      <table class="tabla tabla-detalle">
        <thead><tr><th>#</th><th>Fecha</th><th>Accion</th><th>Responsable</th><th>Frente</th><th>Nota</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div class="modal-acciones" style="margin-top:14px">
      <button class="btn-ghost" id="traza-cerrar">Cerrar</button>
    </div>`);
  $('#traza-cerrar').addEventListener('click', cerrarModal);
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
  iniciarVentanaTrabajo('🧰');
  const kit = id ? estado.kits.find((k) => k.id === id) : null;
  const base = kit || prefill || null;
  estado.itemsKit = (base && base.items && base.items.length)
    ? base.items.map((it, i) => ({ _id: Date.now() + i, materialId: it.materialId || '', cantidad: it.cantidad || '', _filtro: '' }))
    : [{ _id: Date.now(), materialId: '', cantidad: '', _filtro: '' }];

  const tituloBase = kit ? 'Editar kit' : (prefill ? 'Duplicar kit' : 'Nuevo kit');
  abrirModal(tituloBase, `
    <div class="campo full" style="margin-bottom:12px"><label>Nombre del kit *</label>
      <input id="k-nombre" value="${esc(base ? base.nombre : '')}" placeholder="Ej: Kit herramientas basico" /></div>
    <label style="display:block;font-size:12px;color:var(--texto-dim);margin:6px 0 6px;font-weight:600">Materiales / Herramientas del kit</label>
    <div class="orden-items" id="kit-items"></div>
    <button class="btn-ghost orden-add" id="k-add">＋ Agregar material</button>
    <div class="modal-acciones">
      <button class="btn-ghost" id="k-minimizar">▬ Minimizar</button>
      <button class="btn-ghost" id="k-cancelar">Cancelar</button>
      <button class="btn-primary" id="k-guardar">${kit ? 'Guardar cambios' : 'Crear kit'}</button>
    </div>`, '640px');
  const vActual = ventanas.activa;
  const actualizarTitKit = () => {
    if (!vActual) return;
    const nom = (($('#k-nombre') || {}).value || '').trim();
    vActual.titulo = nom ? `Kit: ${nom}` : tituloBase;
    if (ventanas.activa === vActual) $('#modal-titulo').textContent = vActual.titulo;
    renderBarraVentanas();
  };
  if ($('#k-nombre')) $('#k-nombre').addEventListener('input', actualizarTitKit);
  if (base && base.nombre) actualizarTitKit();

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
  if ($('#k-minimizar')) $('#k-minimizar').addEventListener('click', minimizarModal);
  $('#k-cancelar').addEventListener('click', () => cerrarVentana(vActual));
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
      cerrarVentana(vActual);
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
// Nombres de responsables ya usados (para autocompletar y evitar duplicados).
// Directorio de responsables con memoria (localStorage): nombre → whatsapp.
// Se actualiza cada vez que se guarda una orden con responsables.
const CLAVE_DIR_RESP = 'fviecom_directorio_responsables';
function leerDirectorioResp() {
  try { return JSON.parse(localStorage.getItem(CLAVE_DIR_RESP) || '{}'); } catch (e) { return {}; }
}
function guardarDirectorioResp(responsables) {
  const dir = leerDirectorioResp();
  (responsables || []).forEach((r) => {
    const nom = (r.nombre || '').trim();
    const wa = (r.whatsapp || '').trim();
    if (nom) { if (wa) dir[nom] = wa; else if (!dir[nom]) dir[nom] = ''; }
  });
  try { localStorage.setItem(CLAVE_DIR_RESP, JSON.stringify(dir)); } catch (e) { /* ignore */ }
}
function buscarWhatsappResp(nombre) {
  const dir = leerDirectorioResp();
  const nom = (nombre || '').trim();
  return dir[nom] || '';
}
function responsablesExistentes() {
  const fromMov = estado.movimientos.map((m) => (m.responsable || '').trim()).filter(Boolean);
  const fromDir = Object.keys(leerDirectorioResp());
  return Array.from(new Set([...fromMov, ...fromDir])).sort((a, b) => a.localeCompare(b));
}
function renderResponsable() {
  const cuerpo = $('#cuerpo-responsable');
  if (!cuerpo) return;
  const nombre = $('#sel-responsable').value;
  const buscarEl = $('#buscar-resp');
  if (buscarEl) buscarEl.disabled = !nombre;
  if (!nombre) { cuerpo.innerHTML = ''; $('#resp-vacio').hidden = false; $('#resp-vacio').textContent = 'Elige un responsable para ver su historial completo.'; if (buscarEl) buscarEl.value = ''; return; }
  const lista = movimientosDeResponsable(nombre);
  const qResp = normTxt(buscarEl ? buscarEl.value : '');
  $('#resp-vacio').hidden = lista.length !== 0;
  if (lista.length === 0) { $('#resp-vacio').textContent = 'Este responsable no tiene movimientos.'; cuerpo.innerHTML = ''; return; }

  // Filtro de tipo de material (herramientas / materiales / todos)
  const filtroTipo = (($('#filtro-tipo-resp') || {}).value) || '';
  const vistaResp = (($('#vista-resp') || {}).value) || 'pedido';

  // --- VISTA POR TOTALES ---
  if (vistaResp === 'totales') {
    const matDe = (mv) => estado.materiales.find((x) => x.id === mv.materialId);
    const pasaTexto = (mv) => !qResp || normTxt((mv.materialNombre || '') + ' ' + (mv.nota || '')).includes(qResp);
    const movsFiltr = lista.filter((mv) => {
      const m = matDe(mv);
      if (filtroTipo === 'herramientas' && (!m || !m.esHerramienta)) return false;
      if (filtroTipo === 'materiales' && m && m.esHerramienta) return false;
      return pasaTexto(mv);
    });
    // Agrupar por material: sumar salidas, restar devoluciones
    const totales = {};
    for (const mv of movsFiltr) {
      const k = mv.materialId || mv.materialNombre;
      if (!totales[k]) {
        const m = matDe(mv);
        totales[k] = { nombre: mv.materialNombre, unidad: mv.unidad || (m ? m.unidad : ''), esHerr: m ? m.esHerramienta : false, serial: m ? m.serial : '', salidas: 0, devoluciones: 0, entradas: 0 };
      }
      if (mv.tipo === 'salida') totales[k].salidas += Number(mv.cantidad) || 0;
      else if (mv.tipo === 'devolucion') totales[k].devoluciones += Number(mv.cantidad) || 0;
      else totales[k].entradas += Number(mv.cantidad) || 0;
    }
    const filas = Object.values(totales).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const herrTotales = filas.filter((r) => r.esHerr);
    const matTotales = filas.filter((r) => !r.esHerr);
    let html = '';
    if (herrTotales.length > 0) {
      html += `<tr class="inv-tipo abierto"><td colspan="6"><b>🔧 HERRAMIENTAS (${herrTotales.length})</b></td></tr>`;
      html += herrTotales.map((r) => {
        const neto = r.salidas - r.devoluciones;
        return `<tr><td>${esc(r.nombre)}${r.serial ? ' <span style="color:var(--texto-mute)">[' + esc(r.serial) + ']</span>' : ''}</td><td class="der">${fmtNum(r.salidas)}</td><td class="der">${fmtNum(r.devoluciones)}</td><td class="der"><b>${fmtNum(neto)}</b></td><td>${esc(r.unidad)}</td><td>${neto > 0 ? '<span class="estado-badge en_uso">Pendiente</span>' : '<span class="estado-badge disponible">Devuelto</span>'}</td></tr>`;
      }).join('');
    }
    if (matTotales.length > 0) {
      html += `<tr class="inv-tipo abierto"><td colspan="6"><b>📦 MATERIALES (${matTotales.length})</b></td></tr>`;
      html += matTotales.map((r) => {
        const neto = r.salidas - r.devoluciones;
        return `<tr><td>${esc(r.nombre)}</td><td class="der">${fmtNum(r.salidas)}</td><td class="der">${fmtNum(r.devoluciones)}</td><td class="der"><b>${fmtNum(neto)}</b></td><td>${esc(r.unidad)}</td><td></td></tr>`;
      }).join('');
    }
    if (!html) html = '<tr><td colspan="6" class="cen" style="padding:20px;color:var(--texto-mute)">Sin resultados para este filtro.</td></tr>';
    // Cambiar encabezado de tabla para vista totales
    const thead = cuerpo.closest('table') && cuerpo.closest('table').querySelector('thead tr');
    if (thead) thead.innerHTML = '<th>Material / Herramienta</th><th class="der">Salidas</th><th class="der">Devoluciones</th><th class="der">Neto</th><th>Unidad</th><th>Estado</th>';
    cuerpo.innerHTML = html;
    return;
  }

  // --- VISTA POR PEDIDO (la existente) ---
  // Restaurar encabezado de tabla si cambio de vista
  const thead = cuerpo.closest('table') && cuerpo.closest('table').querySelector('thead tr');
  if (thead) thead.innerHTML = '<th>Estado / Tipo</th><th>Material / Herramienta</th><th>Detalle</th><th>Orden / Frente</th><th>Info</th><th></th>';

  // Helper para estado de herramienta
  const estadoHerramientaLabel = (e) => {
    const labels = { disponible: '✅ Disponible', en_uso: '🔧 En uso', mantenimiento: '⚠️ Mantenimiento', baja: '❌ Baja' };
    return labels[e] || e || '✅ Disponible';
  };

  // Separar movimientos en materiales y herramientas (filtrados por texto del buscador)
  const matDe = (mv) => estado.materiales.find((x) => x.id === mv.materialId);
  const pasaTexto = (mv) => !qResp || normTxt((mv.materialNombre || '') + ' ' + (mv.nota || '') + ' ' + (mv.ordenNumero || '')).includes(qResp);
  const movsMat = filtroTipo === 'herramientas' ? [] : lista.filter((mv) => { const m = matDe(mv); return (!m || !m.esHerramienta) && pasaTexto(mv); });
  const movsHerr = filtroTipo === 'materiales' ? [] : lista.filter((mv) => { const m = matDe(mv); return m && m.esHerramienta && pasaTexto(mv); });

  // Agrupar por fecha (YYYY-MM-DD)
  const agruparPorFecha = (movs) => {
    const porFecha = {};
    for (const mv of movs) {
      const dia = (mv.fecha || '').slice(0, 10) || 'Sin fecha';
      if (!porFecha[dia]) porFecha[dia] = [];
      porFecha[dia].push(mv);
    }
    return Object.keys(porFecha).sort((a, b) => b.localeCompare(a)).map((dia) => ({ dia, movs: porFecha[dia] }));
  };

  // Herramientas actualmente en posesion (en_uso asignadas a este responsable)
  const herrEnPosesion = filtroTipo === 'materiales' ? [] : estado.materiales.filter((m) => m.esHerramienta && (m.responsableActual || '').trim() === nombre && m.estadoHerr === 'en_uso');

  // Materiales (no herramientas) marcados con reqDevolucion pendientes de devolver en ordenes de este responsable
  const matPendDevolucion = [];
  if (filtroTipo !== 'herramientas') {
    for (const o of estado.ordenes) {
      if (o.tipo !== 'salida' || estadoOrden(o) === 'devolucion_completada') continue;
      const esDeResp = (o.responsable || '').trim() === nombre ||
        (Array.isArray(o.responsables) && o.responsables.some((r) => ((typeof r === 'object' ? r.nombre : r) || '').trim() === nombre));
      if (!esDeResp) continue;
      (o.items || []).forEach((it, idx) => {
        if (!esItemPendienteDevolucion(it, o)) return;
        const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
        if (m && m.esHerramienta && herrEnPosesion.some((h) => h.id === m.id)) return;
        matPendDevolucion.push({ orden: o, item: it, itemIdx: idx, mat: m });
      });
    }
  }

  // Construir HTML
  let html = '';

  // --- Seccion: Herramientas y Materiales con devolucion pendiente en posesion actualmente ---
  const totalPendPosesion = herrEnPosesion.length + matPendDevolucion.length;
  if (totalPendPosesion > 0) {
    html += `<tr><td colspan="6" style="padding:14px 12px 8px;background:rgba(255,84,112,0.08);border-left:4px solid #ff5470">
      <b style="font-size:14px;color:#ff9db0">🔧 PENDIENTES DE DEVOLUCIÓN EN POSESIÓN ACTUAL (${totalPendPosesion})</b>
      <span style="font-size:11px;color:var(--texto-mute);margin-left:8px">Requieren devolución al almacén</span>
    </td></tr>`;
    html += herrEnPosesion.map((h) => `<tr style="background:rgba(255,84,112,0.04)">
      <td style="padding-left:18px"><span class="estado-badge ${esc(h.estadoHerr || 'disponible')}">${estadoHerramientaLabel(h.estadoHerr)}</span></td>
      <td><b>${esc(h.nombre)}</b></td>
      <td>${esc(h.serial || '-')}${h.marca ? ' · ' + esc(h.marca) : ''}${h.modelo ? ' / ' + esc(h.modelo) : ''}</td>
      <td>${h.frenteActual ? 'Frente ' + esc(h.frenteActual) : '-'}</td>
      <td style="font-size:11px;color:var(--texto-mute)">${esc(h.ubicacion || '')}</td>
      <td><button class="btn-ghost btn-devolver-directa" data-devolver-id="${h.id}" data-devolver-nombre="${esc(nombre)}" data-devolver-frente="${esc(h.frenteActual || '')}" style="font-size:11px;padding:3px 8px;white-space:nowrap">↩ Devolver</button></td>
    </tr>`).join('');
    html += matPendDevolucion.map(({ orden, item, itemIdx }) => `<tr style="background:rgba(245,158,11,0.06)">
      <td style="padding-left:18px"><span class="estado-badge mantenimiento">📦 Req. devolución</span></td>
      <td><b>${esc(item.materialNombre)}</b></td>
      <td><b>${fmtNum(item.cantidad)}</b> ${esc(item.unidad || '')}</td>
      <td>${esc(orden.numero || '-')}${orden.frente ? ' · Frente ' + esc(orden.frente) : ''}</td>
      <td style="font-size:11px;color:var(--texto-mute)">${fmtFechaCorta(orden.fecha)}</td>
      <td><button class="btn-ghost btn-devolver-item-orden" data-ord-id="${orden.id}" data-item-idx="${itemIdx}" style="font-size:11px;padding:3px 8px;white-space:nowrap">↩ Devolver</button></td>
    </tr>`).join('');
    html += `<tr><td colspan="6" style="padding:4px"></td></tr>`;
  }

  // --- Seccion: Historial de Herramientas (por fecha) ---
  if (movsHerr.length > 0) {
    html += `<tr><td colspan="5" style="padding:14px 12px 8px;background:rgba(77,163,255,0.08);border-left:4px solid #4da3ff">
      <b style="font-size:14px;color:#9fc2ef">🔧 HISTORIAL DE HERRAMIENTAS (${movsHerr.length} movimientos)</b>
    </td></tr>`;
    const gruposFecha = agruparPorFecha(movsHerr);
    for (const gf of gruposFecha) {
      html += `<tr><td colspan="5" style="padding:8px 12px 4px;font-size:12px;font-weight:700;color:var(--texto-dim);background:rgba(77,163,255,0.04)">📅 ${fmtFechaCorta(gf.dia)}</td></tr>`;
      for (const mv of gf.movs) {
        const m = matDe(mv);
        const estadoBadge = m ? `<span class="estado-badge ${esc(m.estadoHerr || 'disponible')}">${estadoHerramientaLabel(m.estadoHerr)}</span>` : '';
        html += `<tr>
          <td style="padding-left:18px"><span class="tipo-badge ${mv.tipo}">${(TIPOS[mv.tipo] || {}).label || mv.tipo}</span></td>
          <td><b>${esc(mv.materialNombre)}</b>${m && m.serial ? ' <span style="color:var(--texto-mute)">[' + esc(m.serial) + ']</span>' : ''}</td>
          <td style="text-align:right"><b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</td>
          <td>${esc(mv.ordenNumero || '-')}</td>
          <td>${estadoBadge}</td>
        </tr>`;
      }
    }
    html += `<tr><td colspan="5" style="padding:4px"></td></tr>`;
  }

  // --- Seccion: Historial de Materiales (por fecha) ---
  if (movsMat.length > 0) {
    html += `<tr><td colspan="5" style="padding:14px 12px 8px;background:rgba(46,204,113,0.08);border-left:4px solid #2ecc71">
      <b style="font-size:14px;color:#7ee6a8">📦 HISTORIAL DE MATERIALES (${movsMat.length} movimientos)</b>
    </td></tr>`;
    const gruposFecha = agruparPorFecha(movsMat);
    for (const gf of gruposFecha) {
      html += `<tr><td colspan="5" style="padding:8px 12px 4px;font-size:12px;font-weight:700;color:var(--texto-dim);background:rgba(46,204,113,0.04)">📅 ${fmtFechaCorta(gf.dia)}</td></tr>`;
      for (const mv of gf.movs) {
        const lugar = mv.frente ? esc(mv.frente) : esc(mv.proveedor || '-');
        html += `<tr>
          <td style="padding-left:18px"><span class="tipo-badge ${mv.tipo}">${(TIPOS[mv.tipo] || {}).label || mv.tipo}</span></td>
          <td><b>${esc(mv.materialNombre)}</b></td>
          <td style="text-align:right"><b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</td>
          <td>${esc(mv.ordenNumero || '-')}</td>
          <td>${lugar}</td>
        </tr>`;
      }
    }
  }

  cuerpo.innerHTML = html;

  // Evento para devolucion directa de herramienta desde la vista de responsable
  cuerpo.querySelectorAll('.btn-devolver-directa').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const materialId = btn.dataset.devolverId;
      const responsable = btn.dataset.devolverNombre;
      const frente = btn.dataset.devolverFrente;
      const mat = estado.materiales.find((m) => m.id === materialId);
      if (!mat) { toast('Herramienta no encontrada', 'error'); return; }
      if (!confirm('Devolver "' + (mat.nombre || '') + '" al almacen?')) return;
      btn.disabled = true; btn.textContent = 'Procesando...';
      try {
        await actualizarHerramientaDespacho(materialId, responsable, frente, 'devolucion');
        await registrarMovimiento({
          tipo: 'devolucion',
          materialId: materialId,
          materialNombre: mat.nombre || '',
          cantidad: 1,
          unidad: mat.unidad || 'unidad',
          frente: frente,
          contrato: contratoDeFrente(frente),
          proveedor: '',
          responsable: responsable,
          nota: 'Devolucion directa desde vista de responsable',
          usuario: nombreUsuario()
        });
        const ordenAsociada = estado.ordenes.find((o) => o.tipo === 'salida' && estadoOrden(o) !== 'devolucion_completada' && (o.items || []).some((it) => it.materialId === materialId && !it.devuelto));
        if (ordenAsociada) {
          ordenAsociada.items.forEach((it) => { if (it.materialId === materialId) it.devuelto = true; });
          const nuevoEst = recalcularEstadoDevolucionOrden(ordenAsociada);
          ordenAsociada.estado = nuevoEst;
          await actualizarEstadoOrden(ordenAsociada.id, nuevoEst, ordenAsociada.items);
        }
        toast('Herramienta "' + (mat.nombre || '') + '" devuelta al almacen', 'ok');
        renderResponsable();
        const pseudoOrden = { numero: ordenAsociada ? ordenAsociada.numero : 'DEV-' + Date.now().toString(36), frente: frente, responsable: responsable };
        const itemsDevueltos = [{ materialId, materialNombre: mat.nombre, cantidad: 1, unidad: mat.unidad || 'unidad' }];
        imprimirOrdenDevolucionWhatsApp(pseudoOrden, itemsDevueltos);
      } catch (err) { toast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = '↩ Devolver'; }
    });
  });

  // Evento para devolucion directa de material marcado con reqDevolucion desde la vista de responsable
  cuerpo.querySelectorAll('.btn-devolver-item-orden').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ordId = btn.dataset.ordId;
      if (ordId) modalDevolverHerramientas(ordId);
    });
  });
}

// Genera el doc de devolucion y abre el modal de imprimir/compartir.
// El texto de WhatsApp es un resumen corto con emoji ✅.
function imprimirOrdenDevolucionWhatsApp(orden, itemsDevueltos) {
  const contrato = contratoReal(orden);
  const filas = itemsDevueltos.map((it, i) => {
    const m = estado.materiales.find((x) => x.id === it.materialId);
    return `<tr><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td>${esc(m && m.serial ? m.serial : '-')}</td><td style="text-align:right">${fmtNum(it.cantidad)}</td><td>${esc(it.unidad || '')}</td></tr>`;
  }).join('');
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">ORDEN DE DEVOLUCION DE HERRAMIENTAS</h2>
    <div class="doc-meta">
      <div><b>Orden original:</b> ${esc(orden.numero || '-')}</div>
      <div><b>Fecha de devolucion:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Contrato:</b> ${esc(contrato || '-')}</div>
      <div><b>Frente de obra:</b> ${esc(orden.frente || '-')}</div>
      <div><b>Responsable:</b> ${esc(orden.responsable || '-')}</div>
    </div>
    <table class="doc-tabla">
      <thead><tr><th>#</th><th>Herramienta</th><th>Serial</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div style="border:2px solid #2ecc71;border-radius:10px;padding:14px 18px;margin:18px 0;text-align:center;color:#27ae60;font-size:14px;font-weight:bold;line-height:1.5">
      ✅ HERRAMIENTAS RECIBIDAS EN ALMACEN
    </div>
    ${firmasDoc(nombreUsuario(), orden.responsable)}
  </div>`;
  // Guardar texto especial para WhatsApp de devoluciones
  const waTexto = '✅ *Devolución de la orden (' + (orden.numero || '-') + ')*\n\n'
    + itemsDevueltos.map((it) => '• ' + it.materialNombre).join('\n')
    + '\n\n✅ Devuelto exitosamente';
  window._devolucionWhatsAppTexto = waTexto;
  imprimir(html, 'Devolucion_' + (orden.numero || 'herramienta'));
}

/* ==================================================================
   CONSUMO POR CONTRATO / FRENTE
   ================================================================== */
function llenarConsumo() {
  const selC = $('#cons-contrato');
  const selF = $('#cons-frente');
  if (!selC || !selF) return;
  const cActual = selC.value;
  const contratos = obtenerContratos();
  selC.innerHTML = '<option value="">Todos los contratos</option>' + Object.keys(contratos).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (Object.keys(contratos).includes(cActual)) selC.value = cActual;
  llenarFrentesConsumo();
  aplicarPeriodoConsumo();
  renderConsumo();
}
function llenarFrentesConsumo() {
  const selC = $('#cons-contrato');
  const selF = $('#cons-frente');
  if (!selC || !selF) return;
  const c = selC.value;
  const fActual = selF.value;
  const contratos = obtenerContratos();
  let frentes = [];
  if (c) frentes = contratos[c] || [];
  else Object.keys(contratos).forEach((k) => { frentes = frentes.concat(contratos[k] || []); });
  frentes = Array.from(new Set(frentes));
  selF.innerHTML = '<option value="">Todos los frentes</option>' + frentes.map((f) => `<option value="${esc(f)}">Frente ${esc(f)}</option>`).join('');
  if (frentes.includes(fActual)) selF.value = fActual;
}
// Una "herramienta" es un material cuya categoria contiene "herramient".
function esHerramienta(categoria) { return /herramient/i.test(String(categoria || '')); }
function fmtFechaCorta(iso) {
  const p = String(iso || '').slice(0, 10).split('-');
  return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : (iso || '');
}
function rangoDePeriodo(periodo) {
  const hoy = new Date();
  const z = (n) => String(n).padStart(2, '0');
  const iso = (dt) => dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate());
  const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  const hasta = iso(hoy);
  if (periodo === 'hoy') return { desde: iso(hoy), hasta };
  if (periodo === 'semana') return { desde: iso(new Date(y, m, d - 6)), hasta };
  if (periodo === 'mes') return { desde: iso(new Date(y, m, 1)), hasta };
  if (periodo === 'trimestre') return { desde: iso(new Date(y, Math.floor(m / 3) * 3, 1)), hasta };
  if (periodo === 'anio') return { desde: iso(new Date(y, 0, 1)), hasta };
  return null;
}
function aplicarPeriodoConsumo() {
  const per = (($('#cons-periodo') || {}).value) || 'todo';
  const dEl = $('#cons-desde'), hEl = $('#cons-hasta');
  if (!dEl || !hEl) return;
  if (per === 'personalizado') { dEl.disabled = false; hEl.disabled = false; }
  else if (per === 'todo') { dEl.value = ''; hEl.value = ''; dEl.disabled = true; hEl.disabled = true; }
  else { const r = rangoDePeriodo(per); if (r) { dEl.value = r.desde; hEl.value = r.hasta; } dEl.disabled = true; hEl.disabled = true; }
}
function rangoTextoConsumo(desde, hasta) {
  if (!desde && !hasta) return 'Historico completo';
  return 'Del ' + (desde ? fmtFechaCorta(desde) : 'el inicio') + ' al ' + (hasta ? fmtFechaCorta(hasta) : 'hoy');
}
function graficoConsumoHtml(filas) {
  const datos = filas.map((r) => ({ nombre: r.nombre, neto: (r.salidas - r.devoluciones) }))
    .filter((x) => x.neto > 0).sort((a, b) => b.neto - a.neto).slice(0, 20);
  if (datos.length === 0) return '';
  const max = Math.max.apply(null, datos.map((x) => x.neto).concat([1]));
  // Grafico de barras horizontales en SVG (se imprime como vector, siempre
  // visible completo). Texto en currentColor: claro en la app, oscuro en PDF.
  const W = 720, labelW = 200, valW = 56, gap = 6;
  const barMaxW = W - labelW - valW - gap;
  const rowH = 22, padY = 8;
  const H = padY * 2 + datos.length * rowH;
  const barras = datos.map((x, i) => {
    const y = padY + i * rowH;
    const bw = Math.max(2, (x.neto / max) * barMaxW);
    const nom = x.nombre.length > 32 ? (x.nombre.slice(0, 31) + '…') : x.nombre;
    return `<text x="0" y="${y + 14}" font-size="11" fill="currentColor">${esc(nom)}</text>`
      + `<rect x="${labelW}" y="${y + 4}" width="${bw.toFixed(1)}" height="${rowH - 8}" rx="3" fill="#0d6efd"></rect>`
      + `<text x="${(labelW + bw + 5).toFixed(1)}" y="${y + 14}" font-size="11" font-weight="bold" fill="currentColor">${fmtNum(x.neto)}</text>`;
  }).join('');
  return `<div class="grafico-barras">
    <div class="gb-eje">Grafico: material (Y) · consumo neto (X)</div>
    <svg class="gb-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Grafico de consumo por material">${barras}</svg>
  </div>`;
}
function seccionConsumoHtml(titulo, filas, rangoTxt, conGrafico) {
  if (filas.length === 0) return '';
  const filasHtml = filas.map((r) => `<tr><td>${esc(r.nombre)}</td><td style="text-align:right">${fmtNum(r.salidas)}</td><td style="text-align:right">${fmtNum(r.devoluciones)}</td><td style="text-align:right">${fmtNum(r.salidas - r.devoluciones)}</td><td>${esc(r.unidad || '')}</td></tr>`).join('');
  const totalNeto = filas.reduce((s, r) => s + (r.salidas - r.devoluciones), 0);
  return `
    <h3 class="doc-sub">${esc(titulo)}</h3>
    <div class="doc-rango">${esc(rangoTxt)} · ${filas.length} item(s) · Consumo neto total: <b>${fmtNum(totalNeto)}</b></div>
    ${conGrafico ? graficoConsumoHtml(filas) : ''}
    <table class="doc-tabla">
      <thead><tr><th>Material</th><th style="text-align:right">Salidas</th><th style="text-align:right">Devoluciones</th><th style="text-align:right">Consumo neto</th><th>Unidad</th></tr></thead>
      <tbody>${filasHtml}</tbody>
    </table>`;
}
function datosConsumo() {
  const c = ($('#cons-contrato') || {}).value || '';
  const f = ($('#cons-frente') || {}).value || '';
  const desde = (($('#cons-desde') || {}).value) || '';
  const hasta = (($('#cons-hasta') || {}).value) || '';
  const movs = estado.movimientos.filter((mv) => {
    if (mv.tipo !== 'salida' && mv.tipo !== 'devolucion') return false;
    if (!mv.frente) return false;
    const dia = (mv.fecha || '').slice(0, 10);
    if (desde && (!dia || dia < desde)) return false;
    if (hasta && dia && dia > hasta) return false;
    if (f) return String(mv.frente).toUpperCase().trim() === String(f).toUpperCase().trim();
    if (c) return contratoDeFrente(mv.frente) === c;
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
  return { filas, alcance, desde, hasta };
}
function filasPorTipoItem(filas, tipoItem) {
  if (tipoItem === 'materiales') return filas.filter((r) => !esHerramienta(r.categoria));
  if (tipoItem === 'herramientas') return filas.filter((r) => esHerramienta(r.categoria));
  return filas;
}
function renderConsumo() {
  const cuerpo = $('#cuerpo-consumo');
  if (!cuerpo) return;
  const { filas } = datosConsumo();
  const tipoItem = (($('#cons-tipo-item') || {}).value) || 'todo';
  const fil = filasPorTipoItem(filas, tipoItem);
  $('#cons-vacio').hidden = fil.length !== 0;
  if (fil.length === 0) $('#cons-vacio').textContent = 'No hay consumo para esa seleccion.';
  const totalNeto = fil.reduce((s, r) => s + (r.salidas - r.devoluciones), 0);
  const nMat = fil.filter((r) => !esHerramienta(r.categoria)).length;
  const nHer = fil.filter((r) => esHerramienta(r.categoria)).length;
  $('#cons-cards').innerHTML = fil.length === 0 ? '' :
    `${cardHtml('Items', fil.length, '▦')}${cardHtml('Materiales', nMat, '▦')}${cardHtml('Herramientas', nHer, '🛠')}${cardHtml('Consumo neto', fmtNum(totalNeto), '∑')}`;
  const gcont = $('#cons-grafico-cont');
  if (gcont) gcont.innerHTML = ((($('#cons-grafico') || {}).checked) && fil.length) ? `<div class="panel">${graficoConsumoHtml(fil)}</div>` : '';
  cuerpo.innerHTML = fil.map((r) => {
    const neto = r.salidas - r.devoluciones;
    const tag = esHerramienta(r.categoria) ? '🛠' : '▦';
    return `<tr>
      <td>${tag} ${esc(r.nombre)}</td>
      <td><span class="chip">${esc(r.categoria || 'Sin clasificar')}</span></td>
      <td class="der">${fmtNum(r.salidas)}</td>
      <td class="der">${fmtNum(r.devoluciones)}</td>
      <td class="der"><b>${fmtNum(neto)}</b></td>
      <td>${esc(r.unidad || '')}</td>
    </tr>`;
  }).join('');
}
function imprimirConsumo() {
  const { filas, alcance, desde, hasta } = datosConsumo();
  const tipoItem = (($('#cons-tipo-item') || {}).value) || 'todo';
  const conGrafico = !!(($('#cons-grafico') || {}).checked);
  const rangoTxt = rangoTextoConsumo(desde, hasta);
  const mats = filas.filter((r) => !esHerramienta(r.categoria));
  const herr = filas.filter((r) => esHerramienta(r.categoria));
  let secciones = '';
  if (tipoItem === 'materiales') secciones = seccionConsumoHtml('Consumo de materiales', mats, rangoTxt, conGrafico);
  else if (tipoItem === 'herramientas') secciones = seccionConsumoHtml('Consumo de herramientas', herr, rangoTxt, conGrafico);
  else secciones = seccionConsumoHtml('Consumo de materiales', mats, rangoTxt, conGrafico) + seccionConsumoHtml('Consumo de herramientas', herr, rangoTxt, conGrafico);
  if (!secciones) { toast('No hay consumo para imprimir en esa seleccion', 'error'); return; }
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">REPORTE DE CONSUMO</h2>
    <div class="doc-meta">
      <div><b>Alcance:</b> ${esc(alcance)}</div>
      <div><b>Periodo:</b> ${esc(rangoTxt)}</div>
      <div><b>Emitido:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Almacenista:</b> ${esc(nombreUsuario())}</div>
    </div>
    ${secciones}
    ${firmasDoc(nombreUsuario(), '')}
  </div>`;
  imprimir(html, 'Consumo_' + (alcance.replace(/\s+/g, '_')));
}

/* ==================================================================
   IMPRESION
   ================================================================== */
let docNombreActual = 'Documento_FVIECOM';

// Muestra el documento y ofrece: Imprimir, Guardar como PDF, Compartir por Gmail, WhatsApp (en foto tipo factura).
function imprimir(html, nombre) {
  const area = $('#print-area');
  if (!area) return;
  area.innerHTML = html;
  docNombreActual = String(nombre || 'Documento_FVIECOM').replace(/[^\w\-]+/g, '_');
  abrirModal('Documento generado', `
    <p style="color:var(--texto-dim);margin-bottom:16px;line-height:1.5">El documento está listo. Elige qué deseas hacer:</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn-primary" id="doc-whatsapp" style="background:linear-gradient(135deg,#25d366,#128c7e);border-color:#25d366;color:#fff;font-size:14.5px">📱 Enviar Factura en Foto por WhatsApp</button>
      <button class="btn-primary" id="doc-imprimir">🖨️ Imprimir</button>
      <button class="btn-primary" id="doc-guardar">💾 Guardar como PDF</button>
      <button class="btn-primary" id="doc-compartir">📧 Compartir por Gmail</button>
    </div>
    <p style="color:var(--texto-mute);font-size:11.5px;margin-top:14px;line-height:1.6">
      💡 <b>WhatsApp (Factura en foto)</b>: genera una sola imagen nítida estilo factura comercial con todos los materiales para enviarla en una foto.<br>
      💡 <b>Guardar como PDF</b>: se abre la ventana de impresión; en <b>Destino</b> elige <b>"Guardar como PDF"</b>.<br>
      💡 <b>Compartir</b>: se abre Gmail con el destinatario ya puesto (${esc(CORREO_COMPARTIR)}); adjunta el PDF y lo envías tú.
    </p>
    <div class="modal-acciones"><button class="btn-ghost" id="doc-cerrar">Cerrar</button></div>
  `);
  $('#doc-imprimir').addEventListener('click', () => window.print());
  $('#doc-guardar').addEventListener('click', () => { toast('En "Destino" elige "Guardar como PDF"', 'ok'); setTimeout(() => window.print(), 500); });
  $('#doc-compartir').addEventListener('click', compartirPorGmail);
  $('#doc-whatsapp').addEventListener('click', () => compartirPorWhatsApp());
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

// Cache del logo para dibujar el canvas rapido
let _logoImgCache = null;
function cargarLogoFactura() {
  if (_logoImgCache && _logoImgCache.complete && _logoImgCache.naturalWidth > 0) {
    return Promise.resolve(_logoImgCache);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { _logoImgCache = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = 'assets/logo-fviecom.png';
  });
}

// Parte un texto en lineas que quepan en maxWidth dentro del contexto 2D
function partirLineasCanvas(ctx, texto, maxWidth) {
  const str = String(texto == null ? '' : texto).trim() || '-';
  const palabras = str.split(/\s+/);
  const lineas = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? (actual + ' ' + p) : p;
    if (ctx.measureText(prueba).width <= maxWidth) {
      actual = prueba;
    } else {
      if (actual) lineas.push(actual);
      // Si una sola palabra es mas larga que maxWidth, cortarla por caracteres
      if (ctx.measureText(p).width > maxWidth) {
        let sub = '';
        for (const ch of p) {
          if (ctx.measureText(sub + ch).width > maxWidth && sub) {
            lineas.push(sub);
            sub = ch;
          } else {
            sub += ch;
          }
        }
        actual = sub;
      } else {
        actual = p;
      }
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : ['-'];
}

function rectRedondeadoCanvas(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Extrae todos los datos estructurados desde #print-area para dibujar y editar la factura en imagen
function extraerDatosFacturaDesdeArea(area, ordenDirecta) {
  const titulo = (area.querySelector('.doc-titulo') || {}).textContent?.trim() || 'COMPROBANTE DE ALMACÉN';
  const metaItems = [];
  let numeroDoc = '';
  const responsNombres = [];

  const metaEl = area.querySelector('.doc-meta');
  if (metaEl) {
    metaEl.querySelectorAll('div').forEach((d) => {
      const txt = d.textContent.trim();
      if (!txt) return;
      const idx = txt.indexOf(':');
      if (idx > -1) {
        const k = txt.slice(0, idx).trim();
        const v = txt.slice(idx + 1).trim();
        metaItems.push({ label: k, value: v || '-' });
        if (/orden|pedido/i.test(k) && v && v !== '-') numeroDoc = v;
        if (/responsable/i.test(k) && v && v !== '-') {
          v.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => {
            if (!responsNombres.includes(n)) responsNombres.push(n);
          });
        }
      } else {
        metaItems.push({ label: 'Detalle', value: txt });
      }
    });
  }
  if (!numeroDoc && ordenDirecta && ordenDirecta.numero) numeroDoc = ordenDirecta.numero;
  if (!numeroDoc) numeroDoc = docNombreActual.replace(/_/g, ' ');

  // Buscar orden en estado.ordenes si no se paso directamente
  const ordenObj = ordenDirecta || estado.ordenes.find((o) => o.numero === numeroDoc);

  // Recopilar destinatarios de WhatsApp conocidos
  const destinatarios = [];
  const agregarDest = (nombre, wa) => {
    const nom = (nombre || '').trim();
    const num = (wa || buscarWhatsappResp(nom) || '').replace(/[^\d+]/g, '');
    if (!nom && !num) return;
    const ya = destinatarios.find((d) => d.nombre.toLowerCase() === nom.toLowerCase());
    if (ya) {
      if (!ya.whatsapp && num) ya.whatsapp = num;
    } else {
      destinatarios.push({ nombre: nom || 'Responsable', whatsapp: num });
    }
  };
  if (ordenObj && Array.isArray(ordenObj.responsables)) {
    ordenObj.responsables.forEach((r) => {
      if (typeof r === 'object') agregarDest(r.nombre, r.whatsapp);
      else agregarDest(r, '');
    });
  }
  if (ordenObj && ordenObj.responsable) agregarDest(ordenObj.responsable, '');
  responsNombres.forEach((n) => agregarDest(n, ''));

  // Extraer tablas y sus subtitulos
  const tablas = [];
  const tablasDom = Array.from(area.querySelectorAll('table.doc-tabla'));
  tablasDom.forEach((tb, idx) => {
    let subtitulo = '';
    let prev = tb.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('doc-sub') || prev.tagName === 'H3') {
        subtitulo = prev.textContent.trim();
        break;
      }
      if (prev.tagName === 'TABLE' || prev.classList.contains('doc-meta')) break;
      prev = prev.previousElementSibling;
    }
    if (!subtitulo) subtitulo = tablasDom.length > 1 ? `SECCIÓN ${idx + 1}` : 'DETALLE DE MATERIALES / HERRAMIENTAS';

    const esTablaHerr = /herramienta/i.test(subtitulo);
    const headers = Array.from(tb.querySelectorAll('thead th')).map((th) => ({
      texto: th.textContent.trim(),
      align: (th.style.textAlign === 'right' || th.classList.contains('der')) ? 'right' : 'left'
    }));
    const filas = Array.from(tb.querySelectorAll('tbody tr')).map((tr, rIdx) => {
      const celdas = Array.from(tr.querySelectorAll('td')).map((td, cIdx) => ({
        texto: td.textContent.trim(),
        align: (td.style.textAlign === 'right' || td.classList.contains('der') || (headers[cIdx] && headers[cIdx].align === 'right')) ? 'right' : 'left'
      }));
      const attrIdx = tr.getAttribute('data-item-idx');
      const origIdx = (attrIdx !== null && attrIdx !== '') ? Number(attrIdx) : (ordenObj && ordenObj.items && ordenObj.items[rIdx] ? rIdx : null);
      let reqDev = tr.getAttribute('data-req-dev') === '1' || esTablaHerr;
      if (origIdx !== null && ordenObj && ordenObj.items && ordenObj.items[origIdx]) {
        reqDev = esItemReqDevolucion(ordenObj.items[origIdx]);
      }
      celdas.reqDevolucion = !!reqDev;
      celdas.itemOrigIdx = origIdx;
      return celdas;
    });
    tablas.push({ subtitulo, headers, filas });
  });

  // Avisos especiales (devolucion requerida o devolucion completada)
  const avisoRojoEl = area.querySelector('[style*="c0392b"]');
  const avisoVerdeEl = area.querySelector('[style*="2ecc71"]');
  const avisoRojo = avisoRojoEl ? avisoRojoEl.textContent.trim().replace(/\s+/g, ' ') : '';
  const avisoVerde = avisoVerdeEl ? avisoVerdeEl.textContent.trim().replace(/\s+/g, ' ') : '';

  // Herramientas y materiales pendientes de devolución del responsable (si no es ya una orden de devolucion)
  let herrPendientes = [];
  const lineasHerrPend = [];
  if (!avisoVerde && responsNombres.length > 0) {
    herrPendientes = estado.materiales.filter((m) =>
      m.esHerramienta &&
      m.estadoHerr === 'en_uso' &&
      responsNombres.some((rn) => rn.toLowerCase() === (m.responsableActual || '').trim().toLowerCase())
    );
    herrPendientes.forEach((h) => {
      lineasHerrPend.push(`${lineasHerrPend.length + 1}. 🔧 ${h.nombre} — Serial: ${h.serial || '-'}${h.frenteActual ? ' (Frente ' + h.frenteActual + ')' : ''}`);
    });
    // Incluir tambien materiales con reqDevolucion pendiente en ordenes de este responsable
    for (const o of estado.ordenes) {
      if (o.tipo !== 'salida' || estadoOrden(o) === 'devolucion_completada') continue;
      const coincideResp = responsNombres.some((rn) =>
        rn.toLowerCase() === (o.responsable || '').trim().toLowerCase() ||
        (Array.isArray(o.responsables) && o.responsables.some((r) => rn.toLowerCase() === ((typeof r === 'object' ? r.nombre : r) || '').trim().toLowerCase()))
      );
      if (!coincideResp) continue;
      (o.items || []).forEach((it) => {
        if (!esItemPendienteDevolucion(it, o)) return;
        const m = it.materialId ? estado.materiales.find((x) => x.id === it.materialId) : null;
        if (m && m.esHerramienta && herrPendientes.some((h) => h.id === m.id)) return;
        lineasHerrPend.push(`${lineasHerrPend.length + 1}. 📦 ${it.materialNombre} (${fmtNum(it.cantidad)} ${it.unidad || ''}) — Orden ${o.numero || '-'}`);
      });
    }
  }
  const tituloHerrPend = lineasHerrPend.length > 0
    ? `⚠️ RECORDATORIO — ÍTEMS PENDIENTES DE DEVOLUCIÓN DEL RESPONSABLE (${lineasHerrPend.length}):`
    : '⚠️ RECORDATORIO / HERRAMIENTAS PENDIENTES:';

  // Nota
  const notaEl = area.querySelector('.doc-nota');
  const nota = notaEl ? notaEl.textContent.replace(/^Nota:\s*/i, '').trim() : '';

  // Firmas
  const firmas = Array.from(area.querySelectorAll('.doc-firmas .doc-firma')).map((f) => ({
    rol: (f.querySelector('.rol') || {}).textContent?.trim() || 'Firma',
    nombre: (f.querySelector('.nombre') || {}).textContent?.trim() || '-'
  }));

  const fechaEmision = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });

  return {
    ordenObj,
    empresaNombre: 'FVIECOM S.A.S',
    empresaSub: 'FV Ingeniería Eléctrica y Telecomunicaciones',
    empresaProy: 'Proyecto: Aeropuerto Intl. José María Córdova — Rionegro',
    empresaSello: 'F V   I N G E N I E R I A   ·   A L M A C É N   T É C N I C O',
    etiquetaComprobante: 'COMPROBANTE DE ALMACÉN',
    subComprobante: 'DOCUMENTO OFICIAL',
    titulo,
    numeroDoc,
    metaItems,
    tablas,
    avisoRojo,
    avisoVerde,
    tituloHerrPend,
    lineasHerrPend,
    nota,
    firmas,
    pieIzq: `📅 Emitido: ${fechaEmision}   ·   👤 Almacenista: ${nombreUsuario()}`,
    pieDer: 'FV INGENIERIA   ·   FVIECOM S.A.S',
    destinatarios
  };
}

// Genera el <canvas> en alta resolucion (2x) con estilo de factura corporativa FVIECOM S.A.S
async function generarFacturaCanvas(datos) {
  const logoImg = await cargarLogoFactura();
  const W = 860;
  const SCALE = 2;
  const PAD = 24;
  const INNER_W = W - PAD * 2;
  const CONTENT_X = PAD + 26;
  const CONTENT_W = INNER_W - 52;

  // Canvas temporal para medir textos
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');

  // Calculamos las geometrias de cada tabla (anchos de columna y lineas envueltas)
  const tablasLayout = (datos.tablas || []).map((tb) => {
    const numCols = Math.max(1, (tb.headers || []).length);
    let colWidths = [];
    if (numCols === 4 && tb.headers[0] && tb.headers[0].texto === '#') {
      colWidths = [46, CONTENT_W - 46 - 115 - 110, 115, 110];
    } else if (numCols === 5 && tb.headers[0] && tb.headers[0].texto === '#') {
      colWidths = [44, CONTENT_W - 44 - 140 - 105 - 95, 140, 105, 95];
    } else if (numCols === 6 && tb.headers[0] && tb.headers[0].texto === '#') {
      colWidths = [40, CONTENT_W - 40 - 85 - 85 - 85 - 110, 85, 85, 85, 110];
    } else {
      const w = Math.floor(CONTENT_W / numCols);
      colWidths = Array(numCols).fill(w);
      colWidths[numCols - 1] += CONTENT_W - w * numCols;
    }

    const filasMedidas = (tb.filas || []).map((fila) => {
      const reqDev = !!fila.reqDevolucion;
      let maxLineas = 1;
      const celdasLineas = fila.map((celda, cIdx) => {
        const cw = (colWidths[cIdx] || 100) - 18;
        const textoCelda = (cIdx === 1 && reqDev && !/req\.\s*devol/i.test(String(celda.texto || '')))
          ? `${celda.texto}  ⚠️ [REQ. DEVOLUCIÓN]`
          : celda.texto;
        mctx.font = (celda.align === 'right' || cIdx === 0 || (cIdx === 1 && reqDev)) ? 'bold 13px "Segoe UI", Arial, sans-serif' : '13px "Segoe UI", Arial, sans-serif';
        const lns = partirLineasCanvas(mctx, textoCelda, Math.max(40, cw));
        if (lns.length > maxLineas) maxLineas = lns.length;
        return { lineas: lns, align: celda.align, bold: celda.align === 'right' || cIdx === 0, reqDev: cIdx === 1 && reqDev };
      });
      const rowH = Math.max(32, maxLineas * 18 + 14);
      return { celdasLineas, rowH, reqDev };
    });

    const totalTablaH = 38 + 34 + filasMedidas.reduce((s, r) => s + r.rowH, 0) + 18;
    return { ...tb, colWidths, filasMedidas, totalTablaH };
  });

  // Medir alto de metadatos (2 columnas)
  const metaActivos = (datos.metaItems || []).filter((m) => (m.label || '').trim() || (m.value || '').trim());
  const metaRowsCount = Math.ceil(metaActivos.length / 2);
  const metaBoxH = metaActivos.length > 0 ? Math.max(54, metaRowsCount * 28 + 24) : 0;

  // Medir avisos y notas
  mctx.font = 'bold 13.5px "Segoe UI", Arial, sans-serif';
  const txtRojo = (datos.avisoRojo || '').trim();
  const lineasAvisoRojo = txtRojo ? partirLineasCanvas(mctx, txtRojo, CONTENT_W - 40) : [];
  const avisoRojoH = lineasAvisoRojo.length ? (lineasAvisoRojo.length * 20 + 28) : 0;

  const txtVerde = (datos.avisoVerde || '').trim();
  const lineasAvisoVerde = txtVerde ? partirLineasCanvas(mctx, txtVerde, CONTENT_W - 40) : [];
  const avisoVerdeH = lineasAvisoVerde.length ? (lineasAvisoVerde.length * 20 + 28) : 0;

  // Medir recuadro ambar de recordatorio / herramientas pendientes
  const lineasAmbarRaw = (datos.lineasHerrPend || []).map((s) => String(s || '').trim()).filter(Boolean);
  mctx.font = '12.5px "Segoe UI", Arial, sans-serif';
  const lineasAmbarEnvueltas = [];
  lineasAmbarRaw.forEach((ln) => {
    partirLineasCanvas(mctx, ln, CONTENT_W - 36).forEach((sub) => lineasAmbarEnvueltas.push(sub));
  });
  const herrPendH = lineasAmbarEnvueltas.length > 0 ? (42 + lineasAmbarEnvueltas.length * 21 + 14) : 0;

  mctx.font = '13px "Segoe UI", Arial, sans-serif';
  const txtNota = (datos.nota || '').trim();
  const notaConPrefijo = txtNota ? (/^nota\s*:/i.test(txtNota) ? txtNota : ('Nota: ' + txtNota)) : '';
  const lineasNota = notaConPrefijo ? partirLineasCanvas(mctx, notaConPrefijo, CONTENT_W - 36) : [];
  const notaH = lineasNota.length ? (lineasNota.length * 19 + 24) : 0;

  const firmasActivas = (datos.firmas || []).filter((f) => (f.rol || '').trim() || (f.nombre || '').trim());
  const firmasH = firmasActivas.length > 0 ? 105 : 0;
  const headerH = 128;
  const titleBarH = 54;
  const footerH = 48;

  const totalTablasH = tablasLayout.reduce((s, t) => s + t.totalTablaH, 0);
  const totalH = PAD * 2 + headerH + titleBarH + (metaBoxH ? metaBoxH + 18 : 12) + totalTablasH +
    (avisoRojoH ? avisoRojoH + 14 : 0) +
    (avisoVerdeH ? avisoVerdeH + 14 : 0) +
    (herrPendH ? herrPendH + 14 : 0) +
    (notaH ? notaH + 14 : 0) +
    firmasH + footerH + 20;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // 1. Fondo exterior gris azulado muy sutil
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, W, totalH);

  // 2. Hoja de factura blanca con bordes redondeados y sombra
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  rectRedondeadoCanvas(ctx, PAD, PAD, INNER_W, totalH - PAD * 2, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // Recortar todo al interior de la tarjeta de factura
  ctx.save();
  rectRedondeadoCanvas(ctx, PAD, PAD, INNER_W, totalH - PAD * 2, 16);
  ctx.clip();

  // Marca de agua diagonal sutil en el fondo de la factura
  ctx.save();
  ctx.translate(W / 2, totalH / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = '900 68px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(14, 165, 233, 0.035)';
  ctx.textAlign = 'center';
  ctx.fillText(datos.empresaNombre || 'FVIECOM S.A.S', 0, 0);
  ctx.font = '800 28px "Segoe UI", Arial, sans-serif';
  ctx.fillText('FV INGENIERIA · ALMACÉN RIONEGRO', 0, 42);
  ctx.restore();

  // 3. Encabezado Corporativo Azul Marino + Cian
  let y = PAD;
  const gradHead = ctx.createLinearGradient(PAD, y, PAD + INNER_W, y + headerH);
  gradHead.addColorStop(0, '#061229');
  gradHead.addColorStop(0.55, '#0b254e');
  gradHead.addColorStop(1, '#081b3a');
  ctx.fillStyle = gradHead;
  ctx.fillRect(PAD, y, INNER_W, headerH);

  // Franja inferior luminosa azul claro en el header
  const gradLine = ctx.createLinearGradient(PAD, 0, PAD + INNER_W, 0);
  gradLine.addColorStop(0, '#0d6efd');
  gradLine.addColorStop(0.5, '#38bdf8');
  gradLine.addColorStop(1, '#0d6efd');
  ctx.fillStyle = gradLine;
  ctx.fillRect(PAD, y + headerH - 4, INNER_W, 4);

  // Logo en recuadro blanco
  const logoX = CONTENT_X;
  const logoY = y + 20;
  const logoSize = 84;
  rectRedondeadoCanvas(ctx, logoX, logoY, logoSize, logoSize, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (logoImg) {
    ctx.drawImage(logoImg, logoX + 6, logoY + 6, logoSize - 12, logoSize - 12);
  } else {
    ctx.fillStyle = '#0a1a3a';
    ctx.font = '900 20px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FV', logoX + logoSize / 2, logoY + 50);
  }

  // Textos de empresa
  const empX = logoX + logoSize + 18;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 24px "Segoe UI", Arial, sans-serif';
  ctx.fillText(datos.empresaNombre || 'FVIECOM S.A.S', empX, y + 44);

  ctx.fillStyle = '#7dd3fc';
  ctx.font = '600 13px "Segoe UI", Arial, sans-serif';
  ctx.fillText(datos.empresaSub || 'FV Ingeniería Eléctrica y Telecomunicaciones', empX, y + 66);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillText(datos.empresaProy || 'Proyecto: Aeropuerto Intl. José María Córdova — Rionegro', empX, y + 86);

  ctx.fillStyle = 'rgba(186, 230, 253, 0.45)';
  ctx.font = '800 10px "Segoe UI", Arial, sans-serif';
  ctx.fillText(datos.empresaSello || 'F V   I N G E N I E R I A   ·   A L M A C É N   T É C N I C O', empX, y + 105);

  // Recuadro derecho estilo Factura (N° Comprobante)
  const boxW = 235;
  const boxH = 84;
  const boxX = PAD + INNER_W - boxW - 24;
  const boxY = y + 20;
  rectRedondeadoCanvas(ctx, boxX, boxY, boxW, boxH, 12);
  ctx.fillStyle = 'rgba(14, 165, 233, 0.14)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dd3fc';
  ctx.font = '800 10.5px "Segoe UI", Arial, sans-serif';
  ctx.fillText((datos.etiquetaComprobante || 'COMPROBANTE DE ALMACÉN').toUpperCase(), boxX + boxW / 2, boxY + 24);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 15.5px Consolas, "Courier New", monospace';
  const numStr = String(datos.numeroDoc || '-');
  const numCorto = numStr.length > 21 ? numStr.slice(0, 21) : numStr;
  ctx.fillText(numCorto, boxX + boxW / 2, boxY + 50);

  ctx.fillStyle = '#bae6fd';
  ctx.font = '600 11px "Segoe UI", Arial, sans-serif';
  ctx.fillText((datos.subComprobante || 'DOCUMENTO OFICIAL').toUpperCase(), boxX + boxW / 2, boxY + 70);

  y += headerH;

  // 4. Barra de Titulo del Documento
  ctx.fillStyle = '#f0f7ff';
  ctx.fillRect(PAD, y, INNER_W, titleBarH);
  ctx.strokeStyle = '#bae6fd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + titleBarH);
  ctx.lineTo(PAD + INNER_W, y + titleBarH);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0a1a3a';
  ctx.font = '800 17px "Segoe UI", Arial, sans-serif';
  ctx.fillText((datos.titulo || 'COMPROBANTE').toUpperCase(), W / 2, y + 33);

  y += titleBarH + 16;

  // 5. Tarjeta de Metadatos (2 columnas)
  if (metaBoxH > 0) {
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, metaBoxH, 10);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Borde izquierdo azul en la tarjeta de metadatos
    ctx.fillStyle = '#0d6efd';
    ctx.fillRect(CONTENT_X, y + 6, 4, metaBoxH - 12);

    const colMetaW = (CONTENT_W - 36) / 2;
    metaActivos.forEach((m, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const mx = CONTENT_X + 18 + col * colMetaW;
      const my = y + 26 + row * 28;
      ctx.textAlign = 'left';
      ctx.font = 'bold 12.5px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#0f172a';
      const lbl = (m.label ? m.label + ': ' : '');
      ctx.fillText(lbl, mx, my);
      const lblW = ctx.measureText(lbl).width;
      ctx.font = '12.5px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#334155';
      const maxValW = colMetaW - lblW - 12;
      let valTxt = String(m.value || '');
      while (valTxt.length > 3 && ctx.measureText(valTxt).width > maxValW) {
        valTxt = valTxt.slice(0, -2) + '…';
      }
      ctx.fillText(valTxt, mx + lblW, my);
    });

    y += metaBoxH + 18;
  }

  // 6. Tablas de Materiales / Herramientas
  for (const tb of tablasLayout) {
    const esHerr = /herramienta/i.test(tb.subtitulo);
    // Franja de subtitulo de seccion
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, 32, 8);
    ctx.fillStyle = esHerr ? '#fff7ed' : '#eff6ff';
    ctx.fill();
    ctx.strokeStyle = esHerr ? '#fed7aa' : '#bfdbfe';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '800 13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = esHerr ? '#9a3412' : '#1e3a8a';
    ctx.fillText((esHerr ? '🔧 ' : '📦 ') + (tb.subtitulo || '').toUpperCase(), CONTENT_X + 12, y + 21);

    ctx.textAlign = 'right';
    ctx.font = '700 11.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = esHerr ? '#c2410c' : '#0284c7';
    ctx.fillText(`${tb.filas.length} ${tb.filas.length === 1 ? 'ítem' : 'ítems'}`, CONTENT_X + CONTENT_W - 12, y + 21);

    y += 38;

    // Cabecera de la tabla
    const thH = 34;
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, thH, 6);
    ctx.fillStyle = esHerr ? '#0f172a' : '#0a2558';
    ctx.fill();

    let cx = CONTENT_X;
    tb.headers.forEach((h, cIdx) => {
      const cw = tb.colWidths[cIdx];
      ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      if (h.align === 'right') {
        ctx.textAlign = 'right';
        ctx.fillText(h.texto.toUpperCase(), cx + cw - 10, y + 21);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(h.texto.toUpperCase(), cx + 10, y + 21);
      }
      cx += cw;
    });
    y += thH;

    // Filas de la tabla
    tb.filasMedidas.forEach((fm, rIdx) => {
      const rowH = fm.rowH;
      ctx.fillStyle = fm.reqDev ? '#fffbeb' : (rIdx % 2 === 0 ? '#ffffff' : '#f8fafc');
      ctx.fillRect(CONTENT_X, y, CONTENT_W, rowH);

      if (fm.reqDev) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(CONTENT_X, y, 4, rowH);
      }

      // Borde inferior e izquierdo/derecho de fila
      ctx.strokeStyle = fm.reqDev ? '#fde68a' : '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.strokeRect(CONTENT_X, y, CONTENT_W, rowH);

      let cellX = CONTENT_X;
      fm.celdasLineas.forEach((cl, cIdx) => {
        const cw = tb.colWidths[cIdx];
        ctx.font = (cl.bold || cl.reqDev) ? 'bold 13px "Segoe UI", Arial, sans-serif' : '13px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = cl.reqDev ? '#9a3412' : (cl.bold ? '#0f172a' : '#1e293b');
        const blockH = cl.lineas.length * 18;
        let textY = y + (rowH - blockH) / 2 + 14;
        cl.lineas.forEach((ln) => {
          if (cl.align === 'right') {
            ctx.textAlign = 'right';
            ctx.fillText(ln, cellX + cw - 10, textY);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(ln, cellX + 10, textY);
          }
          textY += 18;
        });
        // Linea divisoria vertical entre columnas
        if (cIdx > 0) {
          ctx.beginPath();
          ctx.moveTo(cellX, y);
          ctx.lineTo(cellX, y + rowH);
          ctx.strokeStyle = '#e2e8f0';
          ctx.stroke();
        }
        cellX += cw;
      });
      y += rowH;
    });

    y += 18;
  }

  // 7. Aviso Rojo (Recordatorio importante / Devolucion de herramientas)
  if (avisoRojoH > 0) {
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, avisoRojoH, 10);
    ctx.fillStyle = '#fef2f2';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#dc2626';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 13.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#b91c1c';
    let ay = y + 24;
    lineasAvisoRojo.forEach((ln) => {
      ctx.fillText(ln, W / 2, ay);
      ay += 20;
    });
    y += avisoRojoH + 14;
  }

  // 8. Aviso Verde (Confirmacion / Devolucion recibida)
  if (avisoVerdeH > 0) {
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, avisoVerdeH, 10);
    ctx.fillStyle = '#f0fdf4';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#16a34a';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#15803d';
    let ay = y + 24;
    lineasAvisoVerde.forEach((ln) => {
      ctx.fillText(ln, W / 2, ay);
      ay += 20;
    });
    y += avisoVerdeH + 14;
  }

  // 9. Recuadro Ambar (Recordatorio de herramientas pendientes u otros recordatorios)
  if (herrPendH > 0) {
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, herrPendH, 10);
    ctx.fillStyle = '#fffbeb';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#b45309';
    ctx.fillText(datos.tituloHerrPend || '⚠️ RECORDATORIO:', CONTENT_X + 14, y + 24);

    ctx.font = '12.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#78350f';
    let hy = y + 46;
    lineasAmbarEnvueltas.forEach((ln) => {
      ctx.fillText(ln, CONTENT_X + 18, hy);
      hy += 21;
    });
    y += herrPendH + 14;
  }

  // 10. Nota / Observaciones
  if (notaH > 0) {
    rectRedondeadoCanvas(ctx, CONTENT_X, y, CONTENT_W, notaH, 8);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#0d6efd';
    ctx.fillRect(CONTENT_X, y + 4, 4, notaH - 8);

    ctx.textAlign = 'left';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    let ny = y + 22;
    lineasNota.forEach((ln) => {
      ctx.fillText(ln, CONTENT_X + 16, ny);
      ny += 19;
    });
    y += notaH + 14;
  }

  // 11. Bloques de Firma
  if (firmasH > 0) {
    const numF = firmasActivas.length;
    const fWidth = Math.min(260, (CONTENT_W - (numF - 1) * 40) / numF);
    const totalFWidth = numF * fWidth + (numF - 1) * 40;
    let fx = CONTENT_X + (CONTENT_W - totalFWidth) / 2;
    const fy = y + 58;

    firmasActivas.forEach((f) => {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + fWidth, fy);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText((f.rol || '').toUpperCase(), fx + fWidth / 2, fy + 18);

      ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(f.nombre || '-', fx + fWidth / 2, fy + 36);

      fx += fWidth + 40;
    });
    y += firmasH;
  }

  // 12. Pie de pagina corporativo (al fondo de la tarjeta)
  const footY = totalH - PAD - footerH;
  const gradFoot = ctx.createLinearGradient(PAD, footY, PAD + INNER_W, footY);
  gradFoot.addColorStop(0, '#eff6ff');
  gradFoot.addColorStop(0.5, '#e0f2fe');
  gradFoot.addColorStop(1, '#eff6ff');
  ctx.fillStyle = gradFoot;
  ctx.fillRect(PAD, footY, INNER_W, footerH);

  ctx.strokeStyle = '#bae6fd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footY);
  ctx.lineTo(PAD + INNER_W, footY);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = '600 11.5px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#0369a1';
  ctx.fillText(datos.pieIzq || '', CONTENT_X, footY + 29);

  ctx.textAlign = 'right';
  ctx.font = '800 11px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#0284c7';
  ctx.fillText(datos.pieDer || 'FV INGENIERIA   ·   FVIECOM S.A.S', CONTENT_X + CONTENT_W, footY + 29);

  ctx.restore();
  return canvas;
}

// Abre un modal con la Factura / Comprobante editable en vivo y lista para enviar en una sola foto por WhatsApp
async function compartirPorWhatsApp(ordenDirecta) {
  const area = $('#print-area');
  if (!area || !area.innerHTML.trim()) {
    toast('No hay documento para compartir', 'error');
    return;
  }

  const textoEspecialDev = window._devolucionWhatsAppTexto || '';
  window._devolucionWhatsAppTexto = null;

  toast('Preparando editor y factura en imagen HD...', 'ok');
  const datos = extraerDatosFacturaDesdeArea(area, ordenDirecta);
  let canvas = await generarFacturaCanvas(datos);
  let dataUrl = canvas.toDataURL('image/png');
  let blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const getNombreArchivo = () => `${docNombreActual || ('Factura_' + datos.numeroDoc)}.png`.replace(/[^\w\-.]+/g, '_');

  // Opciones de telefono del responsable
  const listaDir = Object.entries(leerDirectorioResp()).filter(([, w]) => w);
  const destPrincipal = datos.destinatarios.find((d) => d.whatsapp) || datos.destinatarios[0] || { nombre: '', whatsapp: '' };

  const chipsDest = datos.destinatarios.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        ${datos.destinatarios.map((d, idx) => `
          <button type="button" class="btn-ghost wa-chip-dest" data-wa-num="${esc(d.whatsapp)}" data-wa-nom="${esc(d.nombre)}" style="font-size:12px;padding:4px 10px;border-color:${idx === 0 ? 'var(--cian)' : 'var(--linea)'}">
            👤 ${esc(d.nombre)}${d.whatsapp ? ` (${esc(d.whatsapp)})` : ' (sin número)'}
          </button>`).join('')}
      </div>`
    : '';

  const msgWaInicial = textoEspecialDev
    ? `📋 *FVIECOM S.A.S* — ✅ *Devolución de orden (${datos.numeroDoc})*\nAdjunto comprobante oficial de devolución en imagen.`
    : (datos.avisoRojo || datos.lineasHerrPend.length > 0)
      ? `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})\n⚠️ *Recordatorio:* Por favor verificar los materiales/herramientas en la factura adjunta y recordar devolver los ítems marcados al almacén al finalizar la labor.`
      : `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})\nAdjunto comprobante oficial de almacén en imagen.`;

  abrirModal('📱 Editar y Enviar Factura por WhatsApp — ' + datos.numeroDoc, `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div id="wa-copy-banner" style="background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.4);border-radius:10px;padding:10px 14px;font-size:12.5px;color:#bbf7d0;line-height:1.5">
        ✨ <b>Edita todo lo que necesites antes de enviar:</b> Cualquier cambio abajo actualiza la foto de la factura en tiempo real. Al pulsar <b>"Copiar foto y abrir WhatsApp"</b>, solo presionas <b>Ctrl + V (Pegar)</b> en el chat.
      </div>

      <!-- Destinatario y Mensaje de texto / recordatorio de WhatsApp -->
      <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:12px;background:rgba(255,255,255,0.03);border:1px solid var(--linea);border-radius:12px;padding:12px">
        <div class="campo" style="margin:0">
          <label style="font-size:12px;color:var(--texto-dim);margin-bottom:4px;display:block">📱 Teléfono WhatsApp del destinatario</label>
          ${chipsDest}
          <input id="wa-input-telefono" list="wa-dl-numeros" value="${esc(destPrincipal.whatsapp || '')}" placeholder="Ej: 573001234567 (o vacío para elegir en WhatsApp)" style="width:100%" />
          <datalist id="wa-dl-numeros">
            ${listaDir.map(([n, w]) => `<option value="${esc(w)}" label="${esc(n)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="campo" style="margin:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px">
            <label style="font-size:12px;color:var(--texto-dim);margin:0">💬 Mensaje / Recordatorio que irá escrito en el chat de WhatsApp</label>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button type="button" class="btn-ghost" data-wa-preset="devolucion" style="font-size:10.5px;padding:2px 7px" title="Poner recordatorio de devolución de herramientas">🔔 Recordar devolución</button>
              <button type="button" class="btn-ghost" data-wa-preset="confirmar" style="font-size:10.5px;padding:2px 7px" title="Pedir confirmación de recibido">✅ Confirmar recibido</button>
              <button type="button" class="btn-ghost" data-wa-preset="corto" style="font-size:10.5px;padding:2px 7px" title="Mensaje corto estándar">📄 Corto</button>
            </div>
          </div>
          <textarea id="wa-input-mensaje" rows="3" style="width:100%;font-size:12.5px;line-height:1.4" placeholder="Escribe el mensaje o recordatorio que acompañará la foto en WhatsApp...">${esc(msgWaInicial)}</textarea>
        </div>
      </div>

      <!-- Panel Editor de la Factura (Pestañas) -->
      <div style="background:rgba(13,110,253,0.06);border:1px solid rgba(56,189,248,0.28);border-radius:12px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700;color:#7dd3fc">✏️ Personalizar contenido de la Factura antes de enviar (se actualiza en vivo)</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="wa-edit-tabs">
            <button type="button" class="btn-ghost wa-tab-btn activo" data-wtab="recordatorios" style="font-size:11.5px;padding:4px 10px;border-color:var(--cian);color:#fff">🔔 Recordatorios y Nota</button>
            <button type="button" class="btn-ghost wa-tab-btn" data-wtab="cabecera" style="font-size:11.5px;padding:4px 10px">📋 Cabecera y Datos</button>
            <button type="button" class="btn-ghost wa-tab-btn" data-wtab="items" style="font-size:11.5px;padding:4px 10px">📦 Materiales / Tabla</button>
            <button type="button" class="btn-ghost wa-tab-btn" data-wtab="firmas" style="font-size:11.5px;padding:4px 10px">✍️ Firmas y Pie</button>
          </div>
        </div>

        <!-- TAB 1: Recordatorios, Alertas y Nota dentro de la Factura -->
        <div class="wa-tab-pane" data-wpane="recordatorios" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="campo" style="margin:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="font-size:11.5px;color:#fca5a5;margin:0">🚨 Recuadro Rojo (Recordatorio / Alerta de Devolución en la factura)</label>
              <div style="display:flex;gap:4px">
                <button type="button" class="btn-ghost" id="wa-preset-rojo-herr" style="font-size:10px;padding:1px 6px">＋ Devolución herr.</button>
                <button type="button" class="btn-ghost" id="wa-clear-rojo" style="font-size:10px;padding:1px 6px">Limpiar</button>
              </div>
            </div>
            <textarea id="wa-ed-aviso-rojo" rows="2" placeholder="Vacío = no se muestra. Escribe aquí un recordatorio destacado en rojo..." style="width:100%;font-size:12px">${esc(datos.avisoRojo)}</textarea>
          </div>

          <div class="campo" style="margin:0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="font-size:11.5px;color:#93c5fd;margin:0">📝 Nota / Observaciones en la factura</label>
              <button type="button" class="btn-ghost" id="wa-clear-nota" style="font-size:10px;padding:1px 6px">Limpiar</button>
            </div>
            <textarea id="wa-ed-nota" rows="2" placeholder="Vacío = sin nota. Escribe observaciones o notas para la factura..." style="width:100%;font-size:12px">${esc(datos.nota)}</textarea>
          </div>

          <div class="campo" style="margin:0;grid-column:1 / -1">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:6px">
              <label style="font-size:11.5px;color:#fcd34d;margin:0">⚠️ Recuadro Ámbar de Recordatorio / Herramientas Pendientes (1 renglón por línea)</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input id="wa-ed-tit-ambar" value="${esc(datos.tituloHerrPend)}" placeholder="Título del recuadro ámbar" style="font-size:11.5px;padding:3px 8px;width:330px;max-width:55vw" />
                <button type="button" class="btn-ghost" id="wa-add-ambar-ejemplo" style="font-size:10px;padding:2px 7px">＋ Ejemplo recordatorio</button>
                <button type="button" class="btn-ghost" id="wa-clear-ambar" style="font-size:10px;padding:2px 7px">Ocultar recuadro</button>
              </div>
            </div>
            <textarea id="wa-ed-lineas-ambar" rows="2" placeholder="Vacío = no se muestra este recuadro. Escribe aquí herramientas pendientes o puntos de recordatorio (uno por línea)..." style="width:100%;font-size:12px">${esc(datos.lineasHerrPend.join('\n'))}</textarea>
          </div>

          <div class="campo" style="margin:0;grid-column:1 / -1">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <label style="font-size:11.5px;color:#86efac;margin:0">✅ Recuadro Verde de Confirmación (opcional)</label>
              <div style="display:flex;gap:4px">
                <button type="button" class="btn-ghost" id="wa-preset-verde" style="font-size:10px;padding:1px 6px">＋ Recibido conforme</button>
                <button type="button" class="btn-ghost" id="wa-clear-verde" style="font-size:10px;padding:1px 6px">Limpiar</button>
              </div>
            </div>
            <input id="wa-ed-aviso-verde" value="${esc(datos.avisoVerde)}" placeholder="Vacío = no se muestra (ej: ✅ HERRAMIENTAS RECIBIDAS EN ALMACÉN)" style="width:100%;font-size:12px" />
          </div>
        </div>

        <!-- TAB 2: Cabecera y Metadatos -->
        <div class="wa-tab-pane" data-wpane="cabecera" hidden style="display:flex;flex-direction:column;gap:10px">
          <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px">
            <div class="campo" style="margin:0"><label style="font-size:11px">Título principal del documento</label><input id="wa-ed-titulo" value="${esc(datos.titulo)}" style="font-size:12px" /></div>
            <div class="campo" style="margin:0"><label style="font-size:11px">N° Comprobante / Orden</label><input id="wa-ed-numdoc" value="${esc(datos.numeroDoc)}" style="font-size:12px" /></div>
            <div class="campo" style="margin:0"><label style="font-size:11px">Etiqueta recuadro derecho</label><input id="wa-ed-etqcomp" value="${esc(datos.etiquetaComprobante)}" style="font-size:12px" /></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;color:var(--texto-dim);font-weight:600">Datos de la Orden (Etiqueta : Valor)</span>
              <button type="button" class="btn-ghost" id="wa-add-meta" style="font-size:11px;padding:2px 8px">＋ Agregar dato</button>
            </div>
            <div id="wa-meta-list" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>
          </div>
        </div>

        <!-- TAB 3: Materiales / Herramientas (Tablas) -->
        <div class="wa-tab-pane" data-wpane="items" hidden style="display:flex;flex-direction:column;gap:10px;max-height:220px;overflow-y:auto;padding-right:4px">
          <div id="wa-tablas-editor"></div>
        </div>

        <!-- TAB 4: Firmas y Pie de pagina -->
        <div class="wa-tab-pane" data-wpane="firmas" hidden style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;color:var(--texto-dim);font-weight:600">Bloques de Firma</span>
              <button type="button" class="btn-ghost" id="wa-add-firma" style="font-size:11px;padding:2px 8px">＋ Agregar firma</button>
            </div>
            <div id="wa-firmas-list" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px">
            <div class="campo" style="margin:0"><label style="font-size:11px">Texto pie de página izquierdo</label><input id="wa-ed-pie-izq" value="${esc(datos.pieIzq)}" style="font-size:12px" /></div>
            <div class="campo" style="margin:0"><label style="font-size:11px">Texto pie de página derecho</label><input id="wa-ed-pie-der" value="${esc(datos.pieDer)}" style="font-size:12px" /></div>
          </div>
        </div>
      </div>

      <!-- Vista previa en vivo de la Factura -->
      <div style="background:#071124;border:1px solid var(--linea);border-radius:12px;padding:10px;max-height:46vh;overflow-y:auto;text-align:center;position:relative">
        <div style="font-size:11px;color:var(--texto-mute);margin-bottom:6px">👁️ Vista previa en vivo de la foto que se enviará por WhatsApp:</div>
        <img id="wa-factura-preview" src="${dataUrl}" alt="Factura FVIECOM" style="max-width:100%;height:auto;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.45)" />
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="wa-btn-descargar">⬇️ Descargar PNG</button>
          <button type="button" class="btn-ghost" id="wa-btn-solo-copiar">📋 Solo copiar foto</button>
          <button type="button" class="btn-ghost" id="wa-btn-share-nativo" hidden>📲 Compartir directo</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="wa-btn-volver">🖨️ Opciones de impresión</button>
          <button type="button" class="btn-primary" id="wa-btn-enviar" style="background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-size:14px;padding:10px 18px">📋📱 Copiar foto y abrir WhatsApp</button>
        </div>
      </div>
    </div>
  `, '820px');

  // Re-renderizar el canvas en vivo cuando el usuario edita cualquier campo
  let renderTimer = null;
  const regenerarFacturaEnVivo = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(async () => {
      canvas = await generarFacturaCanvas(datos);
      dataUrl = canvas.toDataURL('image/png');
      blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const imgEl = $('#wa-factura-preview');
      if (imgEl) imgEl.src = dataUrl;
    }, 90);
  };

  // Pestañas del editor
  document.querySelectorAll('.wa-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.wtab;
      document.querySelectorAll('.wa-tab-btn').forEach((b) => {
        const on = b.dataset.wtab === tab;
        b.classList.toggle('activo', on);
        b.style.borderColor = on ? 'var(--cian)' : 'var(--linea)';
        b.style.color = on ? '#fff' : '';
      });
      document.querySelectorAll('.wa-tab-pane').forEach((p) => {
        p.hidden = p.dataset.wpane !== tab;
      });
    });
  });

  // Eventos de Presets del mensaje de texto de WhatsApp
  document.querySelectorAll('[data-wa-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tipoP = btn.dataset.waPreset;
      const inpMsg = $('#wa-input-mensaje');
      if (!inpMsg) return;
      if (tipoP === 'devolucion') {
        inpMsg.value = `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})\n🔔 *Recordatorio importante:* Por favor recuerda devolver al almacén los materiales y herramientas marcados con devolución tan pronto finalices la labor. Adjunto comprobante en foto.`;
      } else if (tipoP === 'confirmar') {
        inpMsg.value = `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})\n✅ Adjunto comprobante de despacho en foto. Por favor confirmar de recibido por este medio.`;
      } else {
        inpMsg.value = `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})`;
      }
      inpMsg.focus();
    });
  });

  // Eventos TAB 1: Recordatorios, Alertas y Nota
  const inpRojo = $('#wa-ed-aviso-rojo');
  const inpNota = $('#wa-ed-nota');
  const inpTitAmbar = $('#wa-ed-tit-ambar');
  const inpLineasAmbar = $('#wa-ed-lineas-ambar');
  const inpVerde = $('#wa-ed-aviso-verde');

  if (inpRojo) inpRojo.addEventListener('input', () => { datos.avisoRojo = inpRojo.value; regenerarFacturaEnVivo(); });
  if (inpNota) inpNota.addEventListener('input', () => { datos.nota = inpNota.value; regenerarFacturaEnVivo(); });
  if (inpTitAmbar) inpTitAmbar.addEventListener('input', () => { datos.tituloHerrPend = inpTitAmbar.value; regenerarFacturaEnVivo(); });
  if (inpLineasAmbar) inpLineasAmbar.addEventListener('input', () => {
    datos.lineasHerrPend = inpLineasAmbar.value.split('\n').map((s) => s.trim()).filter(Boolean);
    regenerarFacturaEnVivo();
  });
  if (inpVerde) inpVerde.addEventListener('input', () => { datos.avisoVerde = inpVerde.value; regenerarFacturaEnVivo(); });

  $('#wa-preset-rojo-herr')?.addEventListener('click', () => {
    datos.avisoRojo = '⚠️ LOS MATERIALES / HERRAMIENTAS MARCADOS REQUIEREN DEVOLUCIÓN — POR FAVOR ENTREGAR EN ALMACÉN AL FINALIZAR LA LABOR';
    if (inpRojo) inpRojo.value = datos.avisoRojo;
    regenerarFacturaEnVivo();
  });
  $('#wa-clear-rojo')?.addEventListener('click', () => {
    datos.avisoRojo = '';
    if (inpRojo) inpRojo.value = '';
    regenerarFacturaEnVivo();
  });
  $('#wa-clear-nota')?.addEventListener('click', () => {
    datos.nota = '';
    if (inpNota) inpNota.value = '';
    regenerarFacturaEnVivo();
  });
  $('#wa-add-ambar-ejemplo')?.addEventListener('click', () => {
    const nuevaLinea = '• Por favor verificar el estado de los materiales y reportar cualquier novedad al almacén.';
    datos.lineasHerrPend.push(nuevaLinea);
    if (inpLineasAmbar) inpLineasAmbar.value = datos.lineasHerrPend.join('\n');
    regenerarFacturaEnVivo();
  });
  $('#wa-clear-ambar')?.addEventListener('click', () => {
    datos.lineasHerrPend = [];
    if (inpLineasAmbar) inpLineasAmbar.value = '';
    regenerarFacturaEnVivo();
  });
  $('#wa-preset-verde')?.addEventListener('click', () => {
    datos.avisoVerde = '✅ MATERIALES Y HERRAMIENTAS VERIFICADOS EN ALMACÉN';
    if (inpVerde) inpVerde.value = datos.avisoVerde;
    regenerarFacturaEnVivo();
  });
  $('#wa-clear-verde')?.addEventListener('click', () => {
    datos.avisoVerde = '';
    if (inpVerde) inpVerde.value = '';
    regenerarFacturaEnVivo();
  });

  // Eventos TAB 2: Cabecera y Metadatos
  $('#wa-ed-titulo')?.addEventListener('input', (e) => { datos.titulo = e.target.value; regenerarFacturaEnVivo(); });
  $('#wa-ed-numdoc')?.addEventListener('input', (e) => { datos.numeroDoc = e.target.value; regenerarFacturaEnVivo(); });
  $('#wa-ed-etqcomp')?.addEventListener('input', (e) => { datos.etiquetaComprobante = e.target.value; regenerarFacturaEnVivo(); });

  const renderMetaEditor = () => {
    const cont = $('#wa-meta-list');
    if (!cont) return;
    cont.innerHTML = datos.metaItems.map((m, i) => `
      <div style="display:flex;gap:4px;align-items:center">
        <input data-meta-lbl="${i}" value="${esc(m.label)}" placeholder="Campo" style="width:110px;font-size:11.5px;padding:5px 7px" />
        <input data-meta-val="${i}" value="${esc(m.value)}" placeholder="Valor" style="flex:1;font-size:11.5px;padding:5px 7px" />
        <button type="button" class="btn-icon peligro" data-meta-del="${i}" title="Quitar campo" style="padding:3px 7px">✕</button>
      </div>
    `).join('');
    cont.querySelectorAll('[data-meta-lbl]').forEach((inp) => inp.addEventListener('input', () => {
      datos.metaItems[Number(inp.dataset.metaLbl)].label = inp.value;
      regenerarFacturaEnVivo();
    }));
    cont.querySelectorAll('[data-meta-val]').forEach((inp) => inp.addEventListener('input', () => {
      datos.metaItems[Number(inp.dataset.metaVal)].value = inp.value;
      regenerarFacturaEnVivo();
    }));
    cont.querySelectorAll('[data-meta-del]').forEach((btn) => btn.addEventListener('click', () => {
      datos.metaItems.splice(Number(btn.dataset.metaDel), 1);
      renderMetaEditor();
      regenerarFacturaEnVivo();
    }));
  };
  renderMetaEditor();
  $('#wa-add-meta')?.addEventListener('click', () => {
    datos.metaItems.push({ label: 'Recordatorio', value: 'Revisar entrega' });
    renderMetaEditor();
    regenerarFacturaEnVivo();
  });

  // Sincroniza las casillas de "Requiere devolucion" y renglones con la orden en Firestore y la vista de Ordenes
  const AVISO_ROJO_AUTO = '⚠️ LOS MATERIALES / HERRAMIENTAS MARCADOS REQUIEREN DEVOLUCIÓN — POR FAVOR ENTREGAR EN ALMACÉN AL FINALIZAR LA LABOR';
  const sincronizarReqDevConOrden = async () => {
    const hayAlgunReqDev = datos.tablas.some((t) => (t.filas || []).some((f) => f.reqDevolucion));
    if (hayAlgunReqDev && !(datos.avisoRojo || '').trim()) {
      datos.avisoRojo = AVISO_ROJO_AUTO;
      if (inpRojo) inpRojo.value = datos.avisoRojo;
    } else if (!hayAlgunReqDev && datos.avisoRojo === AVISO_ROJO_AUTO) {
      datos.avisoRojo = '';
      if (inpRojo) inpRojo.value = '';
    }

    const ord = datos.ordenObj;
    if (!ord || !ord.id) return;
    ord.items = Array.isArray(ord.items) ? ord.items : [];

    // Recorrer todas las filas de las tablas para actualizar o agregar items en la orden
    datos.tablas.forEach((tb) => {
      (tb.filas || []).forEach((fila) => {
        const nomTxt = (fila[1] && fila[1].texto || '').trim();
        const cantIndex = tb.headers.findIndex((h) => /cantidad/i.test(h.texto));
        const unidIndex = tb.headers.findIndex((h) => /unidad/i.test(h.texto));
        const cantVal = Number((fila[cantIndex > -1 ? cantIndex : 2] || {}).texto) || 1;
        const unidVal = ((fila[unidIndex > -1 ? unidIndex : 3] || {}).texto || 'unidad').trim();

        if (fila.itemOrigIdx != null && ord.items[fila.itemOrigIdx]) {
          const it = ord.items[fila.itemOrigIdx];
          it.reqDevolucion = !!fila.reqDevolucion;
          if (fila.reqDevolucion && ord.estado === 'devolucion_completada') it.devuelto = false;
          if (nomTxt) it.materialNombre = nomTxt;
          if (cantVal > 0) it.cantidad = cantVal;
          if (unidIndex > -1 && unidVal) it.unidad = unidVal;
        } else if (nomTxt && fila.reqDevolucion) {
          // Si es un renglon nuevo agregado en esta pantalla y marcado con reqDevolucion, vincularlo a la orden
          const matMatch = estado.materiales.find((m) => normTxt(m.nombre) === normTxt(nomTxt));
          const nuevoItem = {
            materialId: matMatch ? matMatch.id : '',
            materialNombre: nomTxt,
            cantidad: cantVal,
            unidad: unidVal || (matMatch ? matMatch.unidad : 'unidad'),
            reqDevolucion: true,
            devuelto: false
          };
          ord.items.push(nuevoItem);
          fila.itemOrigIdx = ord.items.length - 1;
        }
      });
    });

    const nuevoEst = recalcularEstadoDevolucionOrden(ord);
    ord.estado = nuevoEst;
    try {
      await actualizarEstadoOrden(ord.id, nuevoEst, ord.items);
      renderOrdenes();
      renderResponsable();
    } catch (e) {
      console.warn('Error sincronizando reqDevolucion en orden:', e);
    }
  };

  // Eventos TAB 3: Editor de Tablas (Materiales / Herramientas)
  const renderTablasEditor = () => {
    const cont = $('#wa-tablas-editor');
    if (!cont) return;
    cont.innerHTML = datos.tablas.map((tb, tIdx) => `
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--linea);border-radius:8px;padding:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <input data-tb-sub="${tIdx}" value="${esc(tb.subtitulo)}" placeholder="Título de sección" style="font-size:12px;font-weight:700;padding:4px 8px;flex:1;min-width:140px" />
          <span style="font-size:10.5px;color:#fcd34d">☑️ Marca la casilla al final del renglón si requiere devolución</span>
          <button type="button" class="btn-ghost" data-tb-addrow="${tIdx}" style="font-size:11px;padding:3px 8px;flex:none">＋ Agregar renglón</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${tb.filas.map((fila, rIdx) => `
            <div style="display:flex;gap:5px;align-items:center;width:100%">
              ${fila.map((cel, cIdx) => `
                <input data-tb-cell="${tIdx}-${rIdx}-${cIdx}" value="${esc(cel.texto)}" placeholder="${esc((tb.headers[cIdx] || {}).texto || '')}" style="flex:${cIdx === 1 ? '2.4 1 0%' : (cIdx === 0 ? '0.45 1 0%' : '0.9 1 0%')};min-width:0;width:0;font-size:11.5px;padding:4px 6px;text-align:${cel.align}" />
              `).join('')}
              <label class="chk-req-dev ${fila.reqDevolucion ? 'activo' : ''}" title="Marcar si este material o herramienta requiere devolución al almacén" style="padding:4px 7px;font-size:11px">
                <input type="checkbox" data-tb-reqdev="${tIdx}-${rIdx}" ${fila.reqDevolucion ? 'checked' : ''} />
                <span>Req. dev.</span>
              </label>
              <button type="button" class="btn-icon peligro" data-tb-delrow="${tIdx}-${rIdx}" title="Quitar renglón" style="padding:2px 6px;flex:none">✕</button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    cont.querySelectorAll('[data-tb-sub]').forEach((inp) => inp.addEventListener('input', () => {
      datos.tablas[Number(inp.dataset.tbSub)].subtitulo = inp.value;
      regenerarFacturaEnVivo();
    }));
    cont.querySelectorAll('[data-tb-cell]').forEach((inp) => inp.addEventListener('input', () => {
      const [tIdx, rIdx, cIdx] = inp.dataset.tbCell.split('-').map(Number);
      if (datos.tablas[tIdx] && datos.tablas[tIdx].filas[rIdx] && datos.tablas[tIdx].filas[rIdx][cIdx]) {
        datos.tablas[tIdx].filas[rIdx][cIdx].texto = inp.value;
        regenerarFacturaEnVivo();
        if (datos.tablas[tIdx].filas[rIdx].reqDevolucion) {
          sincronizarReqDevConOrden();
        }
      }
    }));
    cont.querySelectorAll('[data-tb-reqdev]').forEach((chk) => chk.addEventListener('change', async () => {
      const [tIdx, rIdx] = chk.dataset.tbReqdev.split('-').map(Number);
      const fila = datos.tablas[tIdx] && datos.tablas[tIdx].filas[rIdx];
      if (!fila) return;
      fila.reqDevolucion = chk.checked;
      const lbl = chk.closest('.chk-req-dev');
      if (lbl) lbl.classList.toggle('activo', chk.checked);
      await sincronizarReqDevConOrden();
      regenerarFacturaEnVivo();
      toast(chk.checked ? 'Marcado: Requiere devolución al almacén' : 'Desmarcado de devolución', 'ok');
    }));
    cont.querySelectorAll('[data-tb-delrow]').forEach((btn) => btn.addEventListener('click', async () => {
      const [tIdx, rIdx] = btn.dataset.tbDelrow.split('-').map(Number);
      if (datos.tablas[tIdx]) {
        const filaElim = datos.tablas[tIdx].filas[rIdx];
        if (filaElim && filaElim.itemOrigIdx != null && datos.ordenObj && datos.ordenObj.items && datos.ordenObj.items[filaElim.itemOrigIdx]) {
          datos.ordenObj.items[filaElim.itemOrigIdx].reqDevolucion = false;
        }
        datos.tablas[tIdx].filas.splice(rIdx, 1);
        renderTablasEditor();
        await sincronizarReqDevConOrden();
        regenerarFacturaEnVivo();
      }
    }));
    cont.querySelectorAll('[data-tb-addrow]').forEach((btn) => btn.addEventListener('click', () => {
      const tIdx = Number(btn.dataset.tbAddrow);
      const tb = datos.tablas[tIdx];
      if (!tb) return;
      const nuevaFila = tb.headers.map((h, cIdx) => ({
        texto: cIdx === 0 ? String(tb.filas.length + 1) : (h.align === 'right' ? '1' : 'unidad'),
        align: h.align
      }));
      if (nuevaFila[1]) nuevaFila[1].texto = 'Nuevo ítem';
      nuevaFila.reqDevolucion = /herramienta/i.test(tb.subtitulo);
      nuevaFila.itemOrigIdx = null;
      tb.filas.push(nuevaFila);
      renderTablasEditor();
      if (nuevaFila.reqDevolucion) sincronizarReqDevConOrden();
      regenerarFacturaEnVivo();
    }));
  };
  renderTablasEditor();

  // Eventos TAB 4: Firmas y Pie de pagina
  const renderFirmasEditor = () => {
    const cont = $('#wa-firmas-list');
    if (!cont) return;
    cont.innerHTML = datos.firmas.map((f, i) => `
      <div style="display:flex;gap:4px;align-items:center">
        <input data-firma-rol="${i}" value="${esc(f.rol)}" placeholder="Rol (ej: Responsable)" style="width:120px;font-size:11.5px;padding:5px 7px" />
        <input data-firma-nom="${i}" value="${esc(f.nombre)}" placeholder="Nombre" style="flex:1;font-size:11.5px;padding:5px 7px" />
        <button type="button" class="btn-icon peligro" data-firma-del="${i}" title="Quitar firma" style="padding:3px 7px">✕</button>
      </div>
    `).join('');
    cont.querySelectorAll('[data-firma-rol]').forEach((inp) => inp.addEventListener('input', () => {
      datos.firmas[Number(inp.dataset.firmaRol)].rol = inp.value;
      regenerarFacturaEnVivo();
    }));
    cont.querySelectorAll('[data-firma-nom]').forEach((inp) => inp.addEventListener('input', () => {
      datos.firmas[Number(inp.dataset.firmaNom)].nombre = inp.value;
      regenerarFacturaEnVivo();
    }));
    cont.querySelectorAll('[data-firma-del]').forEach((btn) => btn.addEventListener('click', () => {
      datos.firmas.splice(Number(btn.dataset.firmaDel), 1);
      renderFirmasEditor();
      regenerarFacturaEnVivo();
    }));
  };
  renderFirmasEditor();
  $('#wa-add-firma')?.addEventListener('click', () => {
    datos.firmas.push({ rol: 'Vo. Bo. / Testigo', nombre: '' });
    renderFirmasEditor();
    regenerarFacturaEnVivo();
  });
  $('#wa-ed-pie-izq')?.addEventListener('input', (e) => { datos.pieIzq = e.target.value; regenerarFacturaEnVivo(); });
  $('#wa-ed-pie-der')?.addEventListener('input', (e) => { datos.pieDer = e.target.value; regenerarFacturaEnVivo(); });

  // Seleccionar chip de responsable
  document.querySelectorAll('.wa-chip-dest').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wa-chip-dest').forEach((b) => { b.style.borderColor = 'var(--linea)'; });
      btn.style.borderColor = 'var(--cian)';
      const inp = $('#wa-input-telefono');
      if (inp) inp.value = btn.dataset.waNum || '';
    });
  });

  // Asegura que el canvas/blob refleje el ultimo cambio antes de copiar o descargar
  const asegurarImagenActualizada = async () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
      canvas = await generarFacturaCanvas(datos);
      dataUrl = canvas.toDataURL('image/png');
      blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const imgEl = $('#wa-factura-preview');
      if (imgEl) imgEl.src = dataUrl;
    }
  };

  // Funcion auxiliar para copiar el PNG al portapapeles
  const copiarFotoAlPortapapeles = async () => {
    await asegurarImagenActualizada();
    if (!blob || !navigator.clipboard || !window.ClipboardItem) return false;
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      const banner = $('#wa-copy-banner');
      if (banner) {
        banner.style.background = 'rgba(46, 204, 113, 0.22)';
        banner.style.borderColor = '#2ecc71';
        banner.innerHTML = '✅ <b>¡FOTO DE LA FACTURA COPIADA AL PORTAPAPELES!</b><br>Ahora en la ventana de WhatsApp solo presiona <b>Ctrl + V</b> (Pegar) y <b>Enter</b> para enviarla.';
      }
      return true;
    } catch (_e) {
      return false;
    }
  };

  // Mostrar boton de compartir nativo si el navegador soporta compartir archivos (celulares/tablets)
  const btnShareNativo = $('#wa-btn-share-nativo');
  if (btnShareNativo && blob && navigator.canShare) {
    const testFile = new File([blob], getNombreArchivo(), { type: 'image/png' });
    if (navigator.canShare({ files: [testFile] })) {
      btnShareNativo.hidden = false;
      btnShareNativo.addEventListener('click', async () => {
        await asegurarImagenActualizada();
        const archivoActual = new File([blob], getNombreArchivo(), { type: 'image/png' });
        const msgTexto = (($('#wa-input-mensaje') || {}).value || '').trim();
        try {
          await navigator.share({
            files: [archivoActual],
            title: `Comprobante FVIECOM — ${datos.numeroDoc}`,
            text: msgTexto || `📋 FVIECOM S.A.S — ${datos.titulo} (${datos.numeroDoc})`
          });
        } catch (_e) { /* usuario cancelo share */ }
      });
    }
  }

  // Descargar PNG
  $('#wa-btn-descargar').addEventListener('click', async () => {
    await asegurarImagenActualizada();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = getNombreArchivo();
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Factura descargada como imagen PNG', 'ok');
  });

  // Solo copiar foto al portapapeles
  $('#wa-btn-solo-copiar').addEventListener('click', async () => {
    const ok = await copiarFotoAlPortapapeles();
    if (ok) toast('✅ Foto actualizada y copiada al portapapeles. Pégala con Ctrl + V en WhatsApp.', 'ok');
    else toast('Tu navegador no permitió copiar directo; usa "Descargar PNG".', 'error');
  });

  // Volver al modal de impresion
  $('#wa-btn-volver').addEventListener('click', () => {
    imprimir(area.innerHTML, docNombreActual);
  });

  // Copiar foto + abrir WhatsApp
  $('#wa-btn-enviar').addEventListener('click', async () => {
    const copiado = await copiarFotoAlPortapapeles();
    if (!copiado) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = getNombreArchivo();
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    let numRaw = (($('#wa-input-telefono') || {}).value || '').replace(/[^\d]/g, '');
    if (numRaw.length === 10 && numRaw.startsWith('3')) {
      numRaw = '57' + numRaw; // Prefijo Colombia automatico para celulares de 10 digitos
    }

    const caption = (($('#wa-input-mensaje') || {}).value || '').trim() ||
      `📋 *FVIECOM S.A.S* — *${datos.titulo}* (${datos.numeroDoc})`;

    const url = `https://wa.me/${numRaw}?text=${encodeURIComponent(caption)}`;
    window.open(url, '_blank');
    toast(copiado ? '✅ Foto copiada. En WhatsApp presiona Ctrl + V para pegar la factura.' : 'Abriendo WhatsApp... adjunta la imagen descargada.', 'ok');
  });

  // Copiar automaticamente la version inicial al abrir el modal
  copiarFotoAlPortapapeles();
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
  // Soporta multiples responsables: si se pasa un array, genera una firma por cada uno.
  const resps = Array.isArray(responsable) ? responsable : (responsable ? [responsable] : ['-']);
  const firmasResp = resps.map((r) => {
    const nombre = typeof r === 'object' ? (r.nombre || '-') : (r || '-');
    return `<div class="doc-firma"><div class="linea"></div><div class="rol">Responsable</div><div class="nombre">${esc(nombre)}</div></div>`;
  }).join('');
  return `<div class="doc-firmas">
    <div class="doc-firma"><div class="linea"></div><div class="rol">Almacenista</div><div class="nombre">${esc(almacenista || '-')}</div></div>
    ${firmasResp}
  </div>`;
}
// Helpers para mostrar responsables (retrocompatible con ordenes antiguas que solo tienen string).
function ordenResponsablesLista(o) {
  if (Array.isArray(o.responsables) && o.responsables.length > 0) return o.responsables;
  return o.responsable ? [o.responsable] : [];
}
function ordenResponsablesTexto(o) {
  const lista = ordenResponsablesLista(o);
  if (lista.length === 0) return esc('-');
  return lista.map((r) => esc(typeof r === 'object' ? r.nombre : r)).join(', ');
}
function docOrden(o, almacenista) {
  const t = TIPOS[o.tipo] || TIPOS.salida;
  const esProv = t.campo === 'proveedor';
  const contrato = contratoReal(o);

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
        <div><b>Responsable(s):</b> ${ordenResponsablesTexto(o)}</div>
      </div>
      <table class="doc-tabla">
        <thead><tr><th>#</th><th>Material</th><th style="text-align:right">Pedido</th><th style="text-align:right">Recibido</th><th>Unidad</th><th>Estado</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="6">Sin materiales.</td></tr>'}</tbody>
      </table>
      ${adic ? `<h3 style="font-size:13px;margin:16px 0 6px;color:#0a1a3a">Adiciones (llegaron de mas o materiales nuevos)</h3>
      <table class="doc-tabla"><thead><tr><th>#</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead><tbody>${adic}</tbody></table>` : ''}
      ${o.nota ? `<p class="doc-nota"><b>Nota:</b> ${esc(o.nota)}</p>` : ''}
      ${firmasDoc(almacenista, ordenResponsablesLista(o))}
    </div>`;
  }
  const metaLugar = esProv
    ? (`<div><b>Proveedor:</b> ${esc(o.proveedor || '-')}</div>` + (o.frente ? `<div><b>Contrato:</b> ${esc(contrato || '-')}</div><div><b>Frente:</b> ${esc(o.frente)}</div>` : ''))
    : `<div><b>Contrato:</b> ${esc(contrato || '-')}</div><div><b>Frente de obra:</b> ${esc(o.frente || '-')}</div>`;
  const itemsConIdx = (o.items || []).map((it, origIdx) => ({ it, origIdx }));
  const itemsMat = itemsConIdx.filter(({ it }) => { const m = estado.materiales.find((x) => x.id === it.materialId); return !m || !m.esHerramienta; });
  const itemsHerr = itemsConIdx.filter(({ it }) => { const m = estado.materiales.find((x) => x.id === it.materialId); return m && m.esHerramienta; });
  const filasMat = itemsMat.map(({ it, origIdx }, i) => {
    const req = esItemReqDevolucion(it);
    return `<tr data-item-idx="${origIdx}"${req ? ' data-req-dev="1"' : ''}><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td style="text-align:right">${fmtNum(it.cantidad)}</td><td>${esc(it.unidad)}</td></tr>`;
  }).join('');
  const filasHerr = itemsHerr.map(({ it, origIdx }, i) => {
    const m = estado.materiales.find((x) => x.id === it.materialId);
    const req = esItemReqDevolucion(it);
    return `<tr data-item-idx="${origIdx}"${req ? ' data-req-dev="1"' : ''}><td>${i + 1}</td><td>${esc(it.materialNombre)}</td><td>${esc(m ? m.serial || '' : '')}</td><td style="text-align:right">${fmtNum(it.cantidad)}</td></tr>`;
  }).join('');
  const algunReqDev = (o.items || []).some((it) => esItemReqDevolucion(it));
  const tablaMateriales = itemsMat.length > 0 ? `
    <h3 class="doc-sub">MATERIALES</h3>
    <table class="doc-tabla">
      <thead><tr><th>#</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Unidad</th></tr></thead>
      <tbody>${filasMat}</tbody>
    </table>` : '';
  const tablaHerramientas = itemsHerr.length > 0 ? `
    <h3 class="doc-sub">HERRAMIENTAS${o.tipo !== 'entrada' ? ' — ⚠️ REQUIERE DEVOLUCIÓN' : ''}</h3>
    <table class="doc-tabla">
      <thead><tr><th>#</th><th>Herramienta</th><th>Serial</th><th style="text-align:right">Cantidad</th></tr></thead>
      <tbody>${filasHerr}</tbody>
    </table>` : '';
  const bloqueAvisoDevolucion = (algunReqDev && o.tipo !== 'entrada') ? `<div style="border:3px solid #c0392b;border-radius:10px;padding:16px 20px;margin:14px 0;text-align:center;color:#c0392b;font-size:16px;font-weight:bold;line-height:1.5">
      ⚠️ LOS MATERIALES / HERRAMIENTAS MARCADOS REQUIEREN DEVOLUCIÓN<br>
      <span style="font-size:13px;font-weight:normal">POR FAVOR ENTREGAR EN ALMACÉN AL FINALIZAR LA LABOR</span>
    </div>` : '';
  return `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">${t.titulo}</h2>
    <div class="doc-meta">
      <div><b>N° Orden:</b> ${esc(o.numero || '-')}</div>
      <div><b>Fecha:</b> ${fmtFecha(o.fecha)}</div>
      ${metaLugar}
      <div><b>Responsable(s):</b> ${ordenResponsablesTexto(o)}</div>
    </div>
    ${tablaMateriales}
    ${tablaHerramientas}
    ${bloqueAvisoDevolucion}
    ${o.nota ? `<p class="doc-nota"><b>Nota:</b> ${esc(o.nota)}</p>` : ''}
    ${firmasDoc(almacenista, ordenResponsablesLista(o))}
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
  const catDe = (mv) => { const m = estado.materiales.find((x) => x.id === mv.materialId); return m ? m.categoria : ''; };
  const mats = lista.filter((mv) => !esHerramienta(catDe(mv)));
  const herr = lista.filter((mv) => esHerramienta(catDe(mv)));
  const seccion = (titulo, arr) => {
    if (arr.length === 0) return '';
    const filas = arr.map((m) => `<tr><td>${fmtFecha(m.fecha)}</td><td>${(TIPOS[m.tipo] || {}).label || m.tipo}</td><td>${esc(m.materialNombre)}</td><td style="text-align:right">${fmtNum(m.cantidad)} ${esc(m.unidad || '')}</td><td>${esc(m.ordenNumero || '-')}</td><td>${esc(m.frente || m.proveedor || '-')}</td></tr>`).join('');
    return `
      <h3 class="doc-sub">${esc(titulo)}</h3>
      <div class="doc-rango">${arr.length} movimiento(s)</div>
      <table class="doc-tabla">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th style="text-align:right">Cantidad</th><th>Orden</th><th>Frente/Prov.</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  };
  const html = `<div class="doc">
    ${cabeceraDoc()}
    <h2 class="doc-titulo">HISTORIAL DEL RESPONSABLE</h2>
    <div class="doc-meta">
      <div><b>Responsable:</b> ${esc(nombre)}</div>
      <div><b>Fecha de emision:</b> ${fmtFecha(new Date().toISOString())}</div>
      <div><b>Total de movimientos:</b> ${lista.length}</div>
      <div><b>Materiales:</b> ${mats.length} · <b>Herramientas:</b> ${herr.length}</div>
    </div>
    ${seccion('Materiales', mats)}
    ${seccion('Herramientas', herr)}
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
   CONTRATOS Y FRENTES - MODAL DE ADMINISTRACION
   ================================================================== */
function modalGestionarContratos() {
  const renderContenido = () => {
    const contratos = obtenerContratos();
    let listaHtml = '';
    for (const c in contratos) {
      const frentes = contratos[c] || [];
      const chips = frentes.map((f) => `
        <span class="tipo-badge" style="display:inline-flex;align-items:center;gap:5px;padding:5px 9px;background:rgba(0,200,255,0.12);color:#00c8ff;border-radius:6px;font-size:12px;margin:2px">
          Frente ${esc(f)}
          <button type="button" class="btn-quitar-frente" data-contrato="${esc(c)}" data-frente="${esc(f)}" title="Eliminar frente" style="background:none;border:none;color:#ff5470;cursor:pointer;font-size:13px;padding:0 2px;line-height:1">✕</button>
        </span>
      `).join('');

      listaHtml += `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:700;color:#e8edf5;font-size:13.5px">📁 ${esc(c)}</span>
            <span style="font-size:11.5px;color:var(--texto-dim)">${frentes.length} frente(s)</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${chips || '<span style="color:var(--texto-dim);font-style:italic;font-size:12px">Sin frentes</span>'}
          </div>
        </div>
      `;
    }

    return `
      <p style="color:var(--texto-dim);line-height:1.5;margin-bottom:14px;font-size:12.5px">
        Administra los contratos y frentes de obra. Estarán disponibles automáticamente en órdenes, movimientos y reportes de consumo.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:rgba(0,200,255,0.04);border:1px solid rgba(0,200,255,0.18);border-radius:10px;padding:12px;margin-bottom:16px">
        <div>
          <label style="display:block;font-size:11.5px;color:var(--texto-dim);margin-bottom:4px">Contrato</label>
          <select id="m-contrato-sel" class="select" style="width:100%;font-size:12px;padding:7px 8px"></select>
          <input type="text" id="m-nuevo-contrato-inp" placeholder="Nombre nuevo contrato..." style="width:100%;font-size:12px;margin-top:6px;display:none;padding:7px 8px" />
        </div>
        <div>
          <label style="display:block;font-size:11.5px;color:var(--texto-dim);margin-bottom:4px">Nuevo frente</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="m-nuevo-frente-inp" placeholder="Ej: B, 6, Pista..." style="flex:1;font-size:12px;padding:7px 8px" />
            <button class="btn-primary" id="m-btn-add-frente" style="white-space:nowrap;padding:7px 12px">+ Agregar</button>
          </div>
        </div>
      </div>
      <label style="display:block;font-size:12px;color:var(--texto-dim);margin-bottom:8px;font-weight:700">Contratos y frentes configurados</label>
      <div id="m-lista-contratos" style="max-height:260px;overflow-y:auto">${listaHtml}</div>
      <div class="modal-acciones" style="margin-top:14px">
        <button class="btn-ghost" id="m-cerrar-contratos">Cerrar</button>
      </div>
    `;
  };

  abrirModal('Gestión de Contratos y Frentes', renderContenido(), '580px');

  const setupContratosModal = () => {
    const sel = $('#m-contrato-sel');
    const inpNuevoC = $('#m-nuevo-contrato-inp');
    const inpNuevoF = $('#m-nuevo-frente-inp');
    const btnAdd = $('#m-btn-add-frente');
    const btnCerrar = $('#m-cerrar-contratos');
    const contLista = $('#m-lista-contratos');

    if (!sel || !btnAdd) return;

    const contratos = obtenerContratos();
    let optC = '';
    for (const c in contratos) optC += `<option value="${esc(c)}">${esc(c)}</option>`;
    optC += `<option value="__NUEVO__">+ Crear nuevo contrato...</option>`;
    sel.innerHTML = optC;

    sel.onchange = () => {
      if (sel.value === '__NUEVO__') {
        inpNuevoC.style.display = 'block';
        inpNuevoC.focus();
      } else {
        inpNuevoC.style.display = 'none';
      }
    };

    btnAdd.onclick = () => {
      let c = sel.value;
      if (c === '__NUEVO__') {
        c = (inpNuevoC.value || '').trim();
        if (!c) { toast('Escribe el nombre del nuevo contrato', 'error'); inpNuevoC.focus(); return; }
      }
      const f = (inpNuevoF.value || '').trim();
      if (!f) { toast('Escribe el nombre del nuevo frente', 'error'); inpNuevoF.focus(); return; }
      try {
        agregarFrenteAContrato(c, f);
        toast(`Frente "${f}" agregado a ${c}`, 'ok');
        inpNuevoF.value = '';
        if (inpNuevoC) { inpNuevoC.value = ''; inpNuevoC.style.display = 'none'; }
        $('#modal-body').innerHTML = renderContenido();
        setupContratosModal();
      } catch (err) { toast(err.message, 'error'); }
    };

    if (contLista) {
      contLista.onclick = (e) => {
        const btnQ = e.target.closest('.btn-quitar-frente');
        if (btnQ) {
          const c = btnQ.dataset.contrato;
          const f = btnQ.dataset.frente;
          if (confirm(`¿Deseas quitar el Frente ${f} de ${c}? (Los movimientos históricos se conservarán intactos)`)) {
            eliminarFrenteDeContrato(c, f);
            toast(`Frente "${f}" eliminado de ${c}`, 'ok');
            $('#modal-body').innerHTML = renderContenido();
            setupContratosModal();
          }
        }
      };
    }

    if (btnCerrar) btnCerrar.onclick = cerrarModal;
  };

  setupContratosModal();
}

// Delegacion global para abrir/cerrar/guardar frentes inline
document.addEventListener('click', (e) => {
  const btnToggle = e.target.closest('.btn-toggle-frente');
  if (btnToggle) {
    const fid = btnToggle.dataset.frenteId;
    const box = document.getElementById(`${fid}-creador`);
    if (box) {
      const oculto = box.style.display === 'none' || !box.style.display;
      box.style.display = oculto ? 'block' : 'none';
      if (oculto) poblarSelectorContratosInline(fid);
    }
    return;
  }
  const btnCerrar = e.target.closest('.btn-cerrar-frente-box, .btn-cancelar-frente');
  if (btnCerrar) {
    const fid = btnCerrar.dataset.frenteId;
    const box = document.getElementById(`${fid}-creador`);
    if (box) box.style.display = 'none';
    return;
  }
  const btnGuardar = e.target.closest('.btn-guardar-frente');
  if (btnGuardar) {
    const fid = btnGuardar.dataset.frenteId;
    ejecutarGuardarFrenteInline(fid);
    return;
  }
});

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
if ($('#btn-escanear-ia-inv')) $('#btn-escanear-ia-inv').addEventListener('click', () => modalEscanearListaIA({ destinoInicial: 'inventario' }));
if ($('#btn-escanear-ia-imp')) $('#btn-escanear-ia-imp').addEventListener('click', () => modalEscanearListaIA({ destinoInicial: 'inventario' }));
if ($('#btn-escanear-ia-ord')) $('#btn-escanear-ia-ord').addEventListener('click', () => modalEscanearListaIA({ destinoInicial: 'orden', tipoOrden: 'salida' }));
$('#buscar-mov').addEventListener('input', renderMovimientos);
$('#filtro-tipo-mov').addEventListener('change', renderMovimientos);
$('#btn-nuevo-mov').addEventListener('click', () => modalMovimiento(null));
if ($('#btn-nuevo-kit')) $('#btn-nuevo-kit').addEventListener('click', () => modalKit(null));
if ($('#btn-nueva-categoria')) $('#btn-nueva-categoria').addEventListener('click', modalCategorias);
if ($('#btn-nueva-herr')) $('#btn-nueva-herr').addEventListener('click', () => modalMaterial(null, { esHerramienta: true }));

$$('[data-nueva-orden]').forEach((b) => b.addEventListener('click', () => modalOrden(b.dataset.nuevaOrden)));
$('#sel-responsable').addEventListener('change', renderResponsable);
$('#filtro-tipo-resp').addEventListener('change', renderResponsable);
if ($('#buscar-resp')) $('#buscar-resp').addEventListener('input', renderResponsable);
if ($('#vista-resp')) $('#vista-resp').addEventListener('change', renderResponsable);
$('#btn-imprimir-historial').addEventListener('click', imprimirHistorialResponsable);
$('#cons-contrato').addEventListener('change', () => { llenarFrentesConsumo(); renderConsumo(); });
$('#cons-frente').addEventListener('change', renderConsumo);
if ($('#cons-periodo')) $('#cons-periodo').addEventListener('change', () => { aplicarPeriodoConsumo(); renderConsumo(); });
if ($('#cons-desde')) $('#cons-desde').addEventListener('change', renderConsumo);
if ($('#cons-hasta')) $('#cons-hasta').addEventListener('change', renderConsumo);
if ($('#cons-tipo-item')) $('#cons-tipo-item').addEventListener('change', renderConsumo);
if ($('#cons-grafico')) $('#cons-grafico').addEventListener('change', renderConsumo);
$('#btn-imprimir-consumo').addEventListener('click', imprimirConsumo);
if ($('#btn-gestionar-contratos')) $('#btn-gestionar-contratos').addEventListener('click', modalGestionarContratos);
llenarConsumo();


/* ==================================================================
   INTELIGENCIA ARTIFICIAL APLICADA:
   1. Emparejamiento difuso inteligente con el inventario
   2. Preprocesamiento y mejora de contraste para fotos de letra a mano
   3. Escáner interactivo de listas manuscritas / fotos / texto
   4. Asistente fluido (Voz + Chat escrito + Fotos + Contexto en vivo)
   ================================================================== */
const CLOUD_FUNCTION_URL = 'https://asistente-5lyachxl4a-uc.a.run.app';

// Sinónimos y normalización de jerga eléctrica para emparejar manuscritos con inventario
function normalizarJergaElectrica(str) {
  let s = normTxt(str || '');
  s = s
    .replace(/\b(?:calibre|cal|no\.?|nro\.?|num\.?)\s*(\d+)\b/g, '#$1')
    .replace(/\bcable\s+(\d+)\b/g, 'cable #$1')
    .replace(/\b5800\b/g, '2x4')
    .replace(/\b2400\b/g, '4x4')
    .replace(/\btuberia\b/g, 'tubo')
    .replace(/\bcoraza\b/g, 'flexible')
    .replace(/\bminibreaker\b|\btaco\b|\bdisyuntor\b/g, 'breaker')
    .replace(/\bprensa\s*estopa\b/g, 'prensacable')
    .replace(/\bregleta\b/g, 'bornera')
    .replace(/\bgrapa\b/g, 'abrazadera')
    .replace(/\bsonda\b|\bpasacables\b/g, 'pesca')
    .replace(/\bdobladora\b/g, 'curvador')
    .replace(/\bunds?\b|\bunid(?:ades|ad)?\b|\bmts?\b|\bmetros?\b|\brollos?\b/g, ' ')
    .replace(/[",.;:()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

// Busca el mejor material del inventario para un renglón leído por IA o voz
function buscarMaterialInteligente(nombreBuscado, nombreInvSugerido = '') {
  if (!estado.materiales || estado.materiales.length === 0) {
    return { material: null, score: 0, confianza: 'baja' };
  }
  const candidatosTexto = [nombreInvSugerido, nombreBuscado].map((x) => (x || '').trim()).filter(Boolean);
  if (candidatosTexto.length === 0) return { material: null, score: 0, confianza: 'baja' };

  // 1. Coincidencia exacta por nombre normalizado o código
  for (const cand of candidatosTexto) {
    const cn = normTxt(cand);
    const exacto = estado.materiales.find((m) => normTxt(m.nombre) === cn || (m.codigo && normTxt(m.codigo) === cn));
    if (exacto) return { material: exacto, score: 1, confianza: 'alta' };
  }

  // 2. Puntaje difuso por tokens, calibres, medidas y colores
  const stopWords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'en', 'por', 'tipo', 'awg', 'thhn']);
  const colores = ['rojo', 'blanco', 'verde', 'amarillo', 'azul', 'negro', 'gris', 'naranja', 'tierra'];
  const qNorm = normalizarJergaElectrica(candidatosTexto.join(' '));
  const qRaw = normTxt(candidatosTexto[0]);
  const tokensQ = Array.from(new Set(qNorm.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w))));

  // Extraer especificaciones críticas (calibres #12, fracciones 3/4, medidas 2x4, colores)
  const specsCriticas = tokensQ.filter((w) =>
    /^#?\d+$/.test(w) || /^\d+\/\d+$/.test(w) || /^\d+x\d+$/.test(w) || colores.includes(w)
  );

  let mejorMat = null;
  let mejorScore = 0;

  for (const m of estado.materiales) {
    const mNorm = normalizarJergaElectrica((m.nombre || '') + ' ' + (m.codigo || '') + ' ' + (m.serial || ''));
    const mRaw = normTxt(m.nombre || '');
    const tokensM = new Set(mNorm.split(' ').filter((w) => w.length >= 2 && !stopWords.has(w)));

    let score = 0;
    if (mRaw.includes(qRaw) || qRaw.includes(mRaw)) {
      score += 0.45;
    }

    let coincidencias = 0;
    for (const tk of tokensQ) {
      if (tokensM.has(tk)) {
        coincidencias += 1;
      } else {
        // Coincidencia parcial de raíz (ej. "curvadora" vs "curvador", "cajas" vs "caja")
        const raiz = tk.replace(/(?:es|s|a|o)$/, '');
        if (raiz.length >= 3 && Array.from(tokensM).some((tm) => tm.startsWith(raiz) || raiz.startsWith(tm.replace(/(?:es|s|a|o)$/, '')))) {
          coincidencias += 0.8;
        }
      }
    }

    if (tokensQ.length > 0) {
      score += (coincidencias / tokensQ.length) * 0.65;
    }

    // Penalizar si una especificación crítica (color, calibre, fracción) está en la búsqueda pero NO en el material
    let penalizacionSpec = 0;
    for (const sp of specsCriticas) {
      const spSinHash = sp.replace(/^#/, '');
      const tieneSpec = tokensM.has(sp) || tokensM.has('#' + spSinHash) || tokensM.has(spSinHash) || mNorm.includes(sp);
      if (!tieneSpec) penalizacionSpec += 0.28;
      else score += 0.12;
    }
    score -= penalizacionSpec;

    if (score > mejorScore) {
      mejorScore = score;
      mejorMat = m;
    }
  }

  if (!mejorMat || mejorScore < 0.32) {
    return { material: null, score: mejorScore, confianza: 'baja' };
  }
  const confianza = mejorScore >= 0.72 ? 'alta' : mejorScore >= 0.48 ? 'media' : 'baja';
  return { material: mejorMat, score: mejorScore, confianza };
}

// Preprocesa una imagen (File, Blob o DataURL): redimensiona a máx 1800px, aplica rotación
// y opcionalmente mejora nitidez/contraste para que Gemini lea letra escrita a mano con máxima precisión.
function optimizarImagenParaIA(fuente, realzarManuscrito = true, rotacionGrados = 0) {
  return new Promise((resolve, reject) => {
    const cargarDataUrl = (f) => new Promise((res, rej) => {
      if (typeof f === 'string' && f.startsWith('data:')) { res(f); return; }
      if (f instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = () => rej(new Error('No se pudo leer el archivo de imagen'));
        reader.readAsDataURL(f);
        return;
      }
      rej(new Error('Formato de imagen no soportado'));
    });

    cargarDataUrl(fuente).then((dataUrlOrig) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1800;
          let w = img.naturalWidth || img.width || 1000;
          let h = img.naturalHeight || img.height || 1000;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; }
            else { w = Math.round((w * maxDim) / h); h = maxDim; }
          }
          const rot = ((rotacionGrados % 360) + 360) % 360;
          const intercambiar = rot === 90 || rot === 270;
          const canvas = document.createElement('canvas');
          canvas.width = intercambiar ? h : w;
          canvas.height = intercambiar ? w : h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.save();
          if (realzarManuscrito) {
            ctx.filter = 'contrast(1.28) brightness(1.04) saturate(0.85)';
          }
          ctx.translate(canvas.width / 2, canvas.height / 2);
          if (rot) ctx.rotate((rot * Math.PI) / 180);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();

          const jpegUrl = canvas.toDataURL('image/jpeg', 0.86);
          const base64 = jpegUrl.replace(/^data:[^;]+;base64,/, '');
          resolve({
            base64,
            mimeType: 'image/jpeg',
            dataUrl: jpegUrl,
            dataUrlOriginal: dataUrlOrig,
            width: canvas.width,
            height: canvas.height
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = dataUrlOrig;
    }).catch(reject);
  });
}

// Envía una foto de lista (manuscrita o impresa) o un texto pegado a Gemini y devuelve los renglones estructurados
async function analizarListaConIA({ base64, mimeType, textoLista, instruccionExtra, tipoOrden = 'salida' }) {
  const inv = estado.materiales.slice(0, 800).map((m) => ({
    nombre: m.nombre,
    cantidad: m.cantidad,
    unidad: m.unidad,
    esHerramienta: !!m.esHerramienta,
    serial: m.serial || ''
  }));

  const promptLectura = [
    'MODO ESCANER DE LISTA MANUSCRITA / IMAGEN DE ALMACEN.',
    'Lee con maximo cuidado TODOS los renglones de materiales o herramientas escritos en la imagen o texto (incluso letra cursiva o rapida hecha a mano en cuaderno, hoja o WhatsApp).',
    'Reglas importantes:',
    '1. No omitas ningun renglon legible (ignora solo lo que este completamente tachado).',
    '2. Distingue bien las medidas del material (ej. 1/2, 3/4, 3/8, 2x4, 4x4, #12, #10, #8) de la CANTIDAD solicitada.',
    '3. Si dice "circuito 120V" o "circuito 220V", desglosalo en sus cables individuales por color.',
    '4. Empareja cada renglon con el nombre mas exacto posible del INVENTARIO ACTUAL.',
    '5. Devuelve un JSON con accion:"abrir_orden" (o "lista_escaneada"), tipo:"' + (tipoOrden || 'salida') + '", responsables:[...], frente:"...", proveedor:"...", nota:"...", mensaje:"Resumen de lo leido", e items:[{ "textoOriginal":"lo que dice el papel tal cual", "nombre":"nombre del material en inventario o interpretado", "nombreInventario":"nombre exacto en inventario si existe", "cantidad":numero, "unidad":"metro|unidad|...", "esHerramienta":true/false, "confianza":"alta|media|baja" }].',
    instruccionExtra ? ('Instruccion adicional del usuario: ' + instruccionExtra) : '',
    textoLista ? ('Texto de la lista proporcionado:\n' + textoLista) : ''
  ].filter(Boolean).join('\n');

  const payload = {
    texto: promptLectura,
    modo: 'lista',
    inventario: inv,
    contratos: obtenerContratos(),
    vistaActual: 'ordenes',
    historial: []
  };
  if (base64) {
    payload.imagen = base64;
    payload.mimeType = mimeType || 'image/jpeg';
  }

  const resp = await fetch(CLOUD_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    throw new Error('Error del servidor IA (' + resp.status + ')');
  }
  const json = await resp.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}

// Modal interactivo para escanear listas escritas a mano (fotos, cámara, Ctrl+V o texto)
function modalEscanearListaIA(opciones = {}) {
  const enOrdenActiva = !!opciones.enOrdenActiva;
  const alConfirmarEnOrden = opciones.alConfirmarEnOrden || null;
  let tipoSeleccionado = opciones.tipoOrden || 'salida';
  let fuenteImagenActual = opciones.archivoInicial || opciones.dataUrlInicial || null;
  let realzarContraste = true;
  let rotacionActual = 0;
  let imagenProcesada = null;
  let analizando = false;

  // Renglones detectados: [{ _id, textoOriginal, nombreDetectado, materialId, cantidad, unidad, reqDevolucion, confianza, _filtro }]
  let renglonesIA = [];
  let metaIA = {
    frente: '',
    responsable: '',
    proveedor: '',
    nota: '',
    mensajeIA: ''
  };

  // Si ya vienen datos pre-analizados (por ejemplo desde el botón de cámara del asistente)
  const poblarDesdeRespuestaIA = (json) => {
    if (!json) return;
    if (json.tipo && TIPOS[json.tipo] && !enOrdenActiva) tipoSeleccionado = json.tipo;
    if (json.frente) metaIA.frente = json.frente;
    if (json.proveedor) metaIA.proveedor = json.proveedor;
    if (json.nota) metaIA.nota = json.nota;
    if (Array.isArray(json.responsables) && json.responsables[0]) metaIA.responsable = json.responsables[0];
    metaIA.mensajeIA = json.mensaje || '';

    const rawItems = Array.isArray(json.items) ? json.items : [];
    renglonesIA = rawItems.map((it, idx) => {
      const match = buscarMaterialInteligente(it.nombre || it.textoOriginal || '', it.nombreInventario || '');
      const mat = match.material;
      const conf = it.confianza || match.confianza || (mat ? 'alta' : 'baja');
      const esHerr = !!(it.esHerramienta || (mat && mat.esHerramienta));
      return {
        _id: Date.now() + idx + Math.random(),
        textoOriginal: it.textoOriginal || it.nombre || '',
        nombreDetectado: it.nombre || it.nombreInventario || it.textoOriginal || 'Material sin nombre',
        materialId: mat ? mat.id : '',
        cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1,
        unidad: mat ? mat.unidad : (it.unidad || 'unidad'),
        esHerramienta: esHerr,
        reqDevolucion: !!(it.reqDevolucion || esHerr),
        confianza: mat ? conf : 'baja',
        _filtro: ''
      };
    });
  };

  if (opciones.respuestaInicial) {
    poblarDesdeRespuestaIA(opciones.respuestaInicial);
  }

  const htmlModal = `
    <div id="ia-scan-root" style="display:flex;flex-direction:column;gap:14px">
      <div style="background:linear-gradient(135deg,rgba(0,200,255,0.09),rgba(99,102,241,0.09));border:1px solid rgba(0,200,255,0.25);border-radius:10px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:12.5px;color:#dbeafe;line-height:1.45">
          ✨ <b>Lector IA de Listas Manuscritas y Fotos:</b> Sube o toma una foto de un cuaderno/hoja escrita a mano, <b>pégala con Ctrl+V</b> o pega una lista de WhatsApp. La IA transcribe cada renglón y lo conecta con tu inventario.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;align-items:start">
        <!-- Columna izquierda: Imagen / Entrada -->
        <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px">
          <div id="ia-dropzone" class="ia-dropzone">
            <div id="ia-preview-vacio">
              <div style="font-size:28px;margin-bottom:4px">📷 ✍️</div>
              <div style="font-weight:700;color:#e2e8f0;font-size:13px">Haz clic para subir/tomar foto, arrástrala aquí o presiona <kbd style="background:rgba(0,200,255,0.2);padding:2px 6px;border-radius:4px;color:#7dd3fc">Ctrl + V</kbd></div>
              <div style="font-size:11.5px;color:var(--texto-dim);margin-top:4px">Soporta letra escrita a mano en cuaderno, hojas, tableros o capturas de WhatsApp</div>
            </div>
            <div id="ia-preview-img-wrap" hidden style="display:none;flex-direction:column;align-items:center;gap:8px">
              <img id="ia-preview-img" alt="Lista escaneada" style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid rgba(0,200,255,0.3);object-fit:contain;background:#0b1325" />
            </div>
            <input type="file" id="ia-file-input" accept="image/*" style="display:none" />
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:space-between">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn-ghost" id="ia-btn-subir" style="font-size:11.5px;padding:5px 10px">📂 Elegir / Tomar foto</button>
              <button type="button" class="btn-ghost" id="ia-btn-rotar" style="font-size:11.5px;padding:5px 10px" title="Girar foto 90° si salió volteada">↻ Girar 90°</button>
            </div>
            <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#93c5fd;cursor:pointer" title="Aumenta la nitidez de trazos de lapicero o lápiz sobre papel">
              <input type="checkbox" id="ia-chk-contraste" checked />
              <span>✨ Realzar letra a mano</span>
            </label>
          </div>

          <details style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:7px 10px">
            <summary style="cursor:pointer;font-size:12px;color:#7dd3fc;font-weight:600">📋 ¿Tienes una lista en texto de WhatsApp? Pégala aquí</summary>
            <textarea id="ia-texto-lista" rows="3" placeholder="Ej:\n50m cable 12 rojo\n10 cajas 2x4\n1 curvadora 3/4 para Pedro frente 3B" style="width:100%;margin-top:7px;font-size:12px;background:rgba(15,23,42,0.8);color:#fff;border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:7px"></textarea>
          </details>

          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="ia-instruccion-extra" placeholder="Pista opcional (ej: 'ignora lo tachado', 'todo es calibre 12')..." style="flex:1;font-size:12px;padding:7px 9px" />
            <button type="button" class="btn-primary" id="ia-btn-analizar" style="white-space:nowrap;padding:7px 14px;font-size:12.5px">🧠 Leer con IA</button>
          </div>

          <div id="ia-estado-lectura" style="font-size:12px;color:#7dd3fc;min-height:20px"></div>

          <!-- Datos de cabecera detectados -->
          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${!enOrdenActiva ? `
            <div class="campo" style="margin:0">
              <label style="font-size:11px">Tipo de orden</label>
              <select id="ia-meta-tipo" class="select" style="width:100%;font-size:12px;padding:6px">
                <option value="salida" ${tipoSeleccionado === 'salida' ? 'selected' : ''}>📤 Salida de almacén</option>
                <option value="entrada" ${tipoSeleccionado === 'entrada' ? 'selected' : ''}>📥 Entrada / Pedido</option>
                <option value="devolucion" ${tipoSeleccionado === 'devolucion' ? 'selected' : ''}>🔄 Devolución</option>
              </select>
            </div>` : ''}
            <div class="campo" style="margin:0">
              <label style="font-size:11px">Frente detectado</label>
              ${frenteSelectHtml('ia-meta-frente', metaIA.frente, false)}
            </div>
            <div class="campo" style="margin:0">
              <label style="font-size:11px">Responsable detectado</label>
              <input type="text" id="ia-meta-resp" list="lista-resp-ia" value="${esc(metaIA.responsable)}" placeholder="Nombre responsable..." style="font-size:12px;padding:6px 8px" />
              <datalist id="lista-resp-ia">${responsablesExistentes().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
            </div>
            <div class="campo" style="margin:0">
              <label style="font-size:11px">Nota / Observación</label>
              <input type="text" id="ia-meta-nota" value="${esc(metaIA.nota)}" placeholder="Opcional..." style="font-size:12px;padding:6px 8px" />
            </div>
          </div>
        </div>

        <!-- Columna derecha: Renglones reconocidos -->
        <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span style="font-weight:700;font-size:13.5px;color:#e2e8f0">📋 Renglones reconocidos (<span id="ia-count-items">0</span>)</span>
              <span id="ia-resumen-match" style="font-size:11.5px;color:var(--texto-dim);margin-left:8px"></span>
            </div>
            <button type="button" class="btn-ghost" id="ia-btn-add-fila" style="font-size:11.5px;padding:4px 10px">＋ Agregar renglón</button>
          </div>

          <div id="ia-lista-renglones" style="max-height:380px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px"></div>
        </div>
      </div>

      <div class="modal-acciones" style="flex-wrap:wrap;gap:8px;margin-top:4px">
        <button type="button" class="btn-ghost" id="ia-btn-cancelar" style="margin-right:auto">Cancelar</button>
        ${enOrdenActiva ? `
          <button type="button" class="btn-primary" id="ia-btn-pasar-orden">✅ Pasar renglones a la orden actual</button>
        ` : `
          <button type="button" class="btn-ghost" id="ia-btn-importar-inv" title="Crear o sumar estos elementos directamente al catálogo de inventario">📦 Agregar al Inventario</button>
          <button type="button" class="btn-ghost" id="ia-btn-despachar-directo" style="border-color:rgba(16,185,129,0.45);color:#6ee7b7" title="Registrar la orden de inmediato sin pasos intermedios">⚡ Crear orden directo</button>
          <button type="button" class="btn-primary" id="ia-btn-abrir-orden">📝 Revisar en formulario de Orden</button>
        `}
      </div>
    </div>
  `;

  abrirModal('📷 Escáner IA de Listas (Letra a Mano / Fotos / Texto)', htmlModal, '980px');

  const root = $('#ia-scan-root');
  const dropzone = $('#ia-dropzone');
  const fileInput = $('#ia-file-input');
  const previewVacio = $('#ia-preview-vacio');
  const previewWrap = $('#ia-preview-img-wrap');
  const previewImg = $('#ia-preview-img');
  const chkContraste = $('#ia-chk-contraste');
  const txtListaEl = $('#ia-texto-lista');
  const inpExtraEl = $('#ia-instruccion-extra');
  const btnAnalizar = $('#ia-btn-analizar');
  const estadoLectura = $('#ia-estado-lectura');
  const contRenglones = $('#ia-lista-renglones');

  const renderRenglonesIA = () => {
    $('#ia-count-items').textContent = renglonesIA.length;
    const vinculados = renglonesIA.filter((r) => r.materialId).length;
    const sinVincular = renglonesIA.length - vinculados;
    $('#ia-resumen-match').innerHTML = renglonesIA.length > 0
      ? (`<span style="color:#6ee7b7">✓ ${vinculados} en inventario</span>` + (sinVincular > 0 ? ` · <span style="color:#fcd34d">⚠️ ${sinVincular} por asignar o crear</span>` : ''))
      : '';

    if (renglonesIA.length === 0) {
      contRenglones.innerHTML = `
        <div style="padding:36px 16px;text-align:center;color:var(--texto-dim);font-size:12.5px;border:1px dashed rgba(255,255,255,0.1);border-radius:10px">
          Sube o pega una foto de la lista escrita a mano y pulsa <b>"🧠 Leer con IA"</b>.<br>
          Aquí aparecerá cada renglón transcrito junto con su material del inventario.
        </div>`;
      return;
    }

    contRenglones.innerHTML = renglonesIA.map((r, i) => {
      const confClase = r.confianza === 'alta' ? 'ia-conf-alta' : r.confianza === 'media' ? 'ia-conf-media' : 'ia-conf-baja';
      const confTexto = r.confianza === 'alta' ? '🟢 Clara' : r.confianza === 'media' ? '🟡 Media' : '🟠 Revisar';
      return `
        <div class="ia-renglon-card" data-rid="${r._id}" style="background:rgba(15,23,42,0.65);border:1px solid ${r.materialId ? 'rgba(255,255,255,0.1)' : 'rgba(245,158,11,0.45)'};border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
            <div style="font-size:11.5px;color:#cbd5e1;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="color:var(--texto-dim);font-weight:700">#${i + 1}</span>
              <span title="Texto leído por la IA en el papel">📝 Manuscrito leído: <b style="color:#7dd3fc">"${esc(r.textoOriginal || r.nombreDetectado)}"</b></span>
              <span class="ia-conf-badge ${confClase}">${confTexto}</span>
            </div>
            ${!r.materialId ? `<button type="button" class="btn-ghost ia-btn-crear-mat" data-crear-mat="${r._id}" style="font-size:11px;padding:2px 8px;border-color:rgba(16,185,129,0.5);color:#6ee7b7" title="Crear este material automáticamente en el inventario y seleccionarlo">⚡ Crear "${esc((r.nombreDetectado || '').slice(0, 22))}" en inventario</button>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap">
            <input type="text" class="ia-row-filtro" placeholder="🔎 Filtrar..." value="${esc(r._filtro || '')}" style="flex:0.9;min-width:0;width:0;font-size:11.5px;padding:5px 7px" title="Escribe para buscar en el inventario" />
            <select class="ia-row-mat select" style="flex:2.2;min-width:0;width:0;font-size:12px;padding:5px 7px">
              ${opcionesMaterialAgrupadas(r.materialId, r._filtro)}
            </select>
            <input type="number" step="any" min="0" class="ia-row-cant" value="${r.cantidad}" placeholder="Cant." style="flex:0.65;min-width:0;width:0;font-size:12px;padding:5px 6px;text-align:right" />
            <label class="chk-req-dev ${r.reqDevolucion ? 'activo' : ''}" title="Marcar si requiere devolución al almacén" style="padding:4px 7px;font-size:10.5px">
              <input type="checkbox" class="ia-row-reqdev" ${r.reqDevolucion ? 'checked' : ''} />
              <span>Req. dev.</span>
            </label>
            <button type="button" class="btn-icon peligro ia-row-del" title="Quitar renglón" style="flex:none">✕</button>
          </div>
        </div>
      `;
    }).join('');

    contRenglones.querySelectorAll('.ia-renglon-card').forEach((card) => {
      const rid = Number(card.dataset.rid);
      const item = renglonesIA.find((x) => x._id === rid);
      if (!item) return;
      const filtroEl = card.querySelector('.ia-row-filtro');
      const selEl = card.querySelector('.ia-row-mat');
      const cantEl = card.querySelector('.ia-row-cant');
      const chkDev = card.querySelector('.ia-row-reqdev');
      const lblDev = card.querySelector('.chk-req-dev');
      const btnDel = card.querySelector('.ia-row-del');
      const btnCrear = card.querySelector('.ia-btn-crear-mat');

      filtroEl.addEventListener('input', () => {
        item._filtro = filtroEl.value;
        selEl.innerHTML = opcionesMaterialAgrupadas(item.materialId, item._filtro);
      });
      selEl.addEventListener('change', () => {
        item.materialId = selEl.value;
        const m = estado.materiales.find((x) => x.id === item.materialId);
        if (m) {
          item.unidad = m.unidad || 'unidad';
          item.confianza = 'alta';
          if (m.esHerramienta) {
            item.reqDevolucion = true;
          }
        }
        renderRenglonesIA();
      });
      cantEl.addEventListener('input', () => {
        item.cantidad = Number(cantEl.value) || 0;
      });
      chkDev.addEventListener('change', () => {
        item.reqDevolucion = chkDev.checked;
        lblDev.classList.toggle('activo', chkDev.checked);
      });
      btnDel.addEventListener('click', () => {
        renglonesIA = renglonesIA.filter((x) => x._id !== rid);
        renderRenglonesIA();
      });
      if (btnCrear) {
        btnCrear.addEventListener('click', async () => {
          btnCrear.disabled = true;
          btnCrear.textContent = 'Creando...';
          try {
            const nombreNuevo = (item.nombreDetectado || item.textoOriginal || 'Material nuevo').trim();
            const creado = await agregarMaterial({
              codigo: '',
              nombre: nombreNuevo,
              categoria: item.esHerramienta ? 'Herramientas' : 'Sin clasificar',
              cantidad: Math.max(Number(item.cantidad) || 1, 100),
              unidad: item.unidad || 'unidad',
              minimo: 0,
              ubicacion: '',
              esHerramienta: !!item.esHerramienta,
              serial: ''
            });
            item.materialId = creado.id;
            item.confianza = 'alta';
            toast(`Material "${nombreNuevo}" creado en inventario`, 'ok');
            renderRenglonesIA();
          } catch (err) {
            toast('Error al crear material: ' + err.message, 'error');
            btnCrear.disabled = false;
            btnCrear.textContent = '⚡ Crear en inventario';
          }
        });
      }
    });
  };

  const ejecutarAnalisis = async () => {
    if (analizando) return;
    const textoLista = (txtListaEl.value || '').trim();
    const instruccionExtra = (inpExtraEl.value || '').trim();
    if (!imagenProcesada && !textoLista) {
      toast('Primero sube o pega una foto de la lista (o escribe el texto)', 'error');
      return;
    }
    analizando = true;
    btnAnalizar.disabled = true;
    btnAnalizar.textContent = '⏳ Leyendo...';
    estadoLectura.innerHTML = '🧠 <b>Analizando trazos y emparejando con tu inventario...</b> (toma unos segundos)';

    try {
      const json = await analizarListaConIA({
        base64: imagenProcesada ? imagenProcesada.base64 : null,
        mimeType: imagenProcesada ? imagenProcesada.mimeType : null,
        textoLista,
        instruccionExtra,
        tipoOrden: ($('#ia-meta-tipo') ? $('#ia-meta-tipo').value : tipoSeleccionado)
      });
      poblarDesdeRespuestaIA(json);
      if ($('#ia-meta-tipo') && tipoSeleccionado) $('#ia-meta-tipo').value = tipoSeleccionado;
      if ($('#ia-meta-frente') && metaIA.frente) $('#ia-meta-frente').value = metaIA.frente;
      if ($('#ia-meta-resp') && metaIA.responsable) $('#ia-meta-resp').value = metaIA.responsable;
      if ($('#ia-meta-nota') && metaIA.nota) $('#ia-meta-nota').value = metaIA.nota;

      estadoLectura.innerHTML = `✅ <b>${esc(metaIA.mensajeIA || (`Se reconocieron ${renglonesIA.length} renglones.`))}</b>`;
      renderRenglonesIA();
    } catch (err) {
      estadoLectura.innerHTML = `<span style="color:#fda4af">❌ ${esc(err.message)}</span>`;
      toast('Error leyendo la lista: ' + err.message, 'error');
    } finally {
      analizando = false;
      btnAnalizar.disabled = false;
      btnAnalizar.textContent = '🧠 Leer con IA';
    }
  };

  const cargarFuenteImagen = async (fuente, autoAnalizar = true) => {
    try {
      fuenteImagenActual = fuente;
      estadoLectura.innerHTML = '⚙️ Optimizando nitidez de la imagen para lectura de manuscritos...';
      imagenProcesada = await optimizarImagenParaIA(fuenteImagenActual, realzarContraste, rotacionActual);
      previewVacio.hidden = true;
      previewWrap.hidden = false;
      previewWrap.style.display = 'flex';
      previewImg.src = imagenProcesada.dataUrl;
      if (autoAnalizar) {
        await ejecutarAnalisis();
      } else {
        estadoLectura.innerHTML = 'Imagen lista. Haz clic en <b>"🧠 Leer con IA"</b> para volver a analizar.';
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Eventos de imagen
  dropzone.addEventListener('click', () => fileInput.click());
  $('#ia-btn-subir').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      rotacionActual = 0;
      cargarFuenteImagen(fileInput.files[0], true);
    }
  });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) {
      rotacionActual = 0;
      cargarFuenteImagen(f, true);
    }
  });

  $('#ia-btn-rotar').addEventListener('click', () => {
    if (!fuenteImagenActual) { toast('Primero carga una foto', 'error'); return; }
    rotacionActual = (rotacionActual + 90) % 360;
    cargarFuenteImagen(fuenteImagenActual, false);
  });

  chkContraste.addEventListener('change', () => {
    realzarContraste = chkContraste.checked;
    if (fuenteImagenActual) cargarFuenteImagen(fuenteImagenActual, false);
  });

  btnAnalizar.addEventListener('click', ejecutarAnalisis);

  $('#ia-btn-add-fila').addEventListener('click', () => {
    renglonesIA.push({
      _id: Date.now() + Math.random(),
      textoOriginal: 'Agregado manual',
      nombreDetectado: '',
      materialId: '',
      cantidad: 1,
      unidad: 'unidad',
      esHerramienta: false,
      reqDevolucion: false,
      confianza: 'alta',
      _filtro: ''
    });
    renderRenglonesIA();
  });

  // Pegar imagen con Ctrl+V mientras el modal está abierto
  const onPasteModal = (e) => {
    if (!document.body.contains(root)) {
      document.removeEventListener('paste', onPasteModal);
      return;
    }
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        e.preventDefault();
        const blob = it.getAsFile();
        if (blob) {
          rotacionActual = 0;
          cargarFuenteImagen(blob, true);
        }
        return;
      }
    }
  };
  document.addEventListener('paste', onPasteModal);

  const recolectarDatosConfirmados = () => {
    const tipoFinal = $('#ia-meta-tipo') ? $('#ia-meta-tipo').value : tipoSeleccionado;
    const frenteFinal = ($('#ia-meta-frente') ? $('#ia-meta-frente').value : metaIA.frente || '').trim();
    const respFinal = ($('#ia-meta-resp') ? $('#ia-meta-resp').value : metaIA.responsable || '').trim();
    const notaFinal = ($('#ia-meta-nota') ? $('#ia-meta-nota').value : metaIA.nota || '').trim();
    return {
      tipo: tipoFinal,
      frente: frenteFinal,
      responsable: respFinal,
      responsables: respFinal ? [respFinal] : [],
      proveedor: metaIA.proveedor || '',
      nota: notaFinal,
      items: renglonesIA
    };
  };

  $('#ia-btn-cancelar').addEventListener('click', () => {
    document.removeEventListener('paste', onPasteModal);
    cerrarModal();
  });

  if ($('#ia-btn-pasar-orden')) {
    $('#ia-btn-pasar-orden').addEventListener('click', () => {
      const d = recolectarDatosConfirmados();
      const conMat = d.items.filter((x) => x.materialId && Number(x.cantidad) > 0);
      if (conMat.length === 0) {
        toast('Selecciona o crea al menos un material del inventario en los renglones', 'error');
        return;
      }
      document.removeEventListener('paste', onPasteModal);
      cerrarModal({ sinRestaurar: true });
      if (alConfirmarEnOrden) alConfirmarEnOrden({ ...d, items: conMat });
    });
  }

  if ($('#ia-btn-abrir-orden')) {
    $('#ia-btn-abrir-orden').addEventListener('click', () => {
      const d = recolectarDatosConfirmados();
      const conMat = d.items.filter((x) => x.materialId && Number(x.cantidad) > 0);
      if (conMat.length === 0) {
        toast('Asigna o crea al menos un material del inventario antes de continuar', 'error');
        return;
      }
      document.removeEventListener('paste', onPasteModal);
      cerrarModal({ sinRestaurar: true });
      const vistaActual = document.querySelector('.menu-item.active')?.dataset?.vista || '';
      if (vistaActual !== 'ordenes') {
        const btnOrd = document.querySelector('.menu-item[data-vista="ordenes"]');
        if (btnOrd) btnOrd.click();
      }
      modalOrden(d.tipo, {
        aviso: `✨ Lista escaneada con IA (${conMat.length} renglones cargados). Verifica y pulsa "Generar e imprimir".`,
        frente: d.frente,
        proveedor: d.proveedor,
        responsable: d.responsable,
        responsables: d.responsables.map((n) => ({ nombre: n, whatsapp: buscarWhatsappResp(n) })),
        nota: d.nota,
        items: conMat.map((it) => ({
          materialId: it.materialId,
          cantidad: it.cantidad,
          reqDevolucion: !!it.reqDevolucion
        }))
      });
    });
  }

  if ($('#ia-btn-despachar-directo')) {
    $('#ia-btn-despachar-directo').addEventListener('click', async () => {
      const d = recolectarDatosConfirmados();
      const conMat = d.items.filter((x) => x.materialId && Number(x.cantidad) > 0);
      if (conMat.length === 0) {
        toast('Asigna al menos un material con cantidad válida', 'error');
        return;
      }
      document.removeEventListener('paste', onPasteModal);
      cerrarModal();
      await ejecutarOrden({
        tipo: d.tipo,
        frente: d.frente,
        responsables: d.responsables,
        nota: d.nota,
        items: conMat.map((it) => {
          const m = estado.materiales.find((x) => x.id === it.materialId);
          return {
            materialId: it.materialId,
            nombre: m ? m.nombre : it.nombreDetectado,
            cantidad: it.cantidad,
            unidad: m ? m.unidad : it.unidad,
            reqDevolucion: !!it.reqDevolucion
          };
        }),
        mensaje: `Orden generada desde lista escaneada (${conMat.length} materiales).`
      });
    });
  }

  if ($('#ia-btn-importar-inv')) {
    $('#ia-btn-importar-inv').addEventListener('click', async () => {
      if (renglonesIA.length === 0) {
        toast('Primero escanea una lista con materiales', 'error');
        return;
      }
      const btn = $('#ia-btn-importar-inv');
      btn.disabled = true;
      btn.textContent = 'Importando...';
      try {
        const listaImp = renglonesIA.map((r) => {
          const m = r.materialId ? estado.materiales.find((x) => x.id === r.materialId) : null;
          return {
            codigo: m ? m.codigo : '',
            nombre: m ? m.nombre : (r.nombreDetectado || r.textoOriginal || '').trim(),
            categoria: m ? m.categoria : (r.esHerramienta ? 'Herramientas' : 'Sin clasificar'),
            cantidad: Number(r.cantidad) || 0,
            unidad: m ? m.unidad : (r.unidad || 'unidad')
          };
        }).filter((x) => x.nombre);
        const res = await importarMateriales(listaImp, estado.materiales);
        document.removeEventListener('paste', onPasteModal);
        cerrarModal();
        toast(`Inventario actualizado: ${res.creados} nuevos, ${res.actualizados} sumados`, 'ok');
      } catch (err) {
        toast('Error al importar: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '📦 Agregar al Inventario';
      }
    });
  }

  renderRenglonesIA();
  if (fuenteImagenActual) {
    cargarFuenteImagen(fuenteImagenActual, !opciones.respuestaInicial);
  }
}

/* ==================================================================
   ASISTENTE FLUIDO MULTIMODAL (VOZ + TEXTO + FOTOS + CONTEXTO)
   ================================================================== */
const asistente = {
  recognition: null,
  escuchando: false,
  grabando: false,
  hablando: false,
  procesando: false,
  panelVisible: false,
  historial: [],
  buffer: '',
  lastText: '',
  lastTextTime: 0
};

const ALIAS_VISTAS = {
  panel: 'dashboard', inicio: 'dashboard', home: 'dashboard', principal: 'dashboard',
  materiales: 'inventario', stock: 'inventario',
  movimiento: 'movimientos', historial: 'movimientos', despachos: 'movimientos', salidas: 'movimientos',
  orden: 'ordenes', pedidos: 'ordenes',
  responsable: 'responsables', gente: 'responsables',
  herramienta: 'herramientas', equipos: 'herramientas',
  kit: 'kits', plantilla: 'kits',
  importacion: 'importar', pdf: 'importar',
  reporte: 'reportes', informe: 'reportes',
  info: 'acerca', acercade: 'acerca'
};

let _reactivarTimer = null;
let _autoSendVoiceTimer = null;

async function hablarAgente(_texto) {
  return;
}

function reactivarMicrofono() {
  if (!asistente.escuchando || !asistente.recognition || asistente.hablando) return;
  if (_reactivarTimer) return;
  _reactivarTimer = setTimeout(() => {
    _reactivarTimer = null;
    if (!asistente.escuchando || asistente.hablando) return;
    try {
      asistente.recognition.start();
      asistente.grabando = true;
      const btn = $('.ai-fab-mic');
      if (btn) btn.classList.add('grabando');
    } catch (e) { /* ya corriendo */ }
  }, 300);
}

function agregarAlHistorial(rol, texto) {
  asistente.historial.push({ rol, texto, ts: Date.now() });
  if (asistente.historial.length > 16) asistente.historial.shift();
}

function actualizarPanel() {
  const body = $('.ai-panel-body');
  if (!body) return;
  const ultimos = asistente.historial.slice(-14);
  if (ultimos.length === 0) {
    body.innerHTML = `<div class="ai-bubble ai-bubble-agent">👋 ¡Hola! Puedes hablarme con 🎤, escribirme abajo o enviarme una 📷 <b>foto de una lista escrita a mano</b> para armar la orden automáticamente.</div>`;
    return;
  }
  body.innerHTML = ultimos.map((m) => {
    const isUser = m.rol === 'usuario';
    return `<div class="ai-bubble ${isUser ? 'ai-bubble-user' : 'ai-bubble-agent'}">${esc(m.texto)}</div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

function actualizarEstado(txt) {
  const el = $('.ai-panel-status');
  if (!el) return;
  if (txt) { el.innerHTML = `<span class="ai-status-text">${esc(txt)}</span>`; return; }
  if (asistente.procesando) {
    el.innerHTML = '<span class="ai-status-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span> Procesando con IA...</span>';
    return;
  }
  if (asistente.escuchando && asistente.grabando) {
    el.innerHTML = '<span class="ai-status-listening"><span class="ai-bar"></span><span class="ai-bar"></span><span class="ai-bar"></span><span class="ai-bar"></span><span class="ai-bar"></span> Escuchando (se envía solo al pausar)</span>';
    return;
  }
  if (asistente.escuchando) { el.innerHTML = '<span class="ai-status-text">Micrófono activo</span>'; return; }
  el.innerHTML = '<span class="ai-status-text">Escribe abajo, pega una foto (Ctrl+V) o usa 🎤</span>';
}

function intentarNavLocal(texto) {
  const t = normTxt(texto).replace(/[.,;:!?]+/g, '').trim();
  const regexNav = /^(?:abre|abrir|ve a|ve al|muestra|muestrame|ir a|ir al|vamos a|llevame a|abreme)\s+(.+)$/;
  const match = t.match(regexNav);
  if (!match) return false;
  const destino = match[1].trim();
  const vista = ALIAS_VISTAS[destino] || destino;
  const btn = document.querySelector(`.menu-item[data-vista="${vista}"]`);
  if (!btn) return false;
  btn.click();
  agregarAlHistorial('usuario', texto);
  agregarAlHistorial('agente', `Abrí ${TITULOS[vista] || vista}.`);
  actualizarPanel();
  return true;
}

function mostrarBtnEnviar(visible) {
  const btn = document.getElementById('ai-btn-send');
  if (!btn) return;
  btn.hidden = !visible;
}

function enviarBuffer() {
  if (_autoSendVoiceTimer) { clearTimeout(_autoSendVoiceTimer); _autoSendVoiceTimer = null; }
  const texto = asistente.buffer.trim();
  asistente.buffer = '';
  mostrarBtnEnviar(false);
  actualizarEstado();
  if (!texto) return;
  if (intentarNavLocal(texto)) return;
  enviarAGemini(texto);
}

async function enviarAGemini(texto) {
  if (asistente.procesando) return;
  asistente.procesando = true;
  agregarAlHistorial('usuario', texto);
  actualizarPanel();
  actualizarEstado('🧠 Procesando...');

  try {
    const vistaActual = document.querySelector('.menu-item.active')?.dataset?.vista || 'dashboard';
    const inv = estado.materiales.slice(0, 500).map((m) => ({
      nombre: m.nombre, cantidad: m.cantidad, unidad: m.unidad,
      esHerramienta: !!m.esHerramienta, serial: m.serial || ''
    }));
    const histCtx = asistente.historial.slice(-8).map((h) => ({ rol: h.rol, texto: h.texto }));

    const resp = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, inventario: inv, contratos: obtenerContratos(), vistaActual, historial: histCtx })
    });

    if (!resp.ok) throw new Error('Error del servidor: ' + resp.status);
    const json = await resp.json();
    await ejecutarRespuesta(json);
  } catch (_err) {
    const msg = 'Error de comunicación con IA. Intenta de nuevo.';
    agregarAlHistorial('agente', msg);
    actualizarPanel();
  } finally {
    asistente.procesando = false;
    actualizarEstado();
  }
}

async function ejecutarRespuesta(json) {
  const accion = json.accion;
  const mensaje = json.mensaje || '';

  if (accion === 'navegar') {
    const dest = ALIAS_VISTAS[normTxt(json.destino || '')] || normTxt(json.destino || '');
    const btn = document.querySelector(`.menu-item[data-vista="${dest}"]`);
    if (btn) btn.click();
    agregarAlHistorial('agente', mensaje || `Abrí ${TITULOS[dest] || dest}.`);
    actualizarPanel();

  } else if (accion === 'lista_escaneada') {
    agregarAlHistorial('agente', mensaje || 'Lista escaneada. Revisa los renglones en pantalla.');
    actualizarPanel();
    const vAct = ventanas.activa;
    modalEscanearListaIA({
      enOrdenActiva: !!(vAct && vAct.aplicarDatosIA),
      tipoOrden: (vAct && vAct.ordenTipo) || json.tipo || 'salida',
      alConfirmarEnOrden: (vAct && vAct.aplicarDatosIA) || null,
      respuestaInicial: json
    });

  } else if (accion === 'ejecutar_orden') {
    // Si el usuario tiene una ventana de orden abierta en este momento, cargar ahí o ejecutar
    const vAct = ventanas.activa;
    if (vAct && vAct.aplicarDatosIA && (!json.frente || !json.responsables || json.responsables.length === 0)) {
      const itemsResueltos = (json.items || []).map((it) => {
        const { material } = buscarMaterialInteligente(it.nombre, it.nombreInventario);
        return {
          materialId: material ? material.id : '',
          cantidad: Number(it.cantidad) || 1,
          reqDevolucion: !!(it.reqDevolucion || (material && material.esHerramienta))
        };
      }).filter((x) => x.materialId);
      if (itemsResueltos.length > 0) {
        vAct.aplicarDatosIA({
          frente: json.frente,
          responsables: json.responsables,
          nota: json.nota,
          items: itemsResueltos
        });
        agregarAlHistorial('agente', mensaje || `Agregué ${itemsResueltos.length} material(es) a la orden que tienes abierta.`);
        actualizarPanel();
        return;
      }
    }
    await ejecutarOrden(json);

  } else if (accion === 'abrir_orden') {
    const tipo = json.tipo || 'salida';
    const items = (json.items || []).map((it) => {
      const { material } = buscarMaterialInteligente(it.nombre, it.nombreInventario);
      return {
        materialId: material ? material.id : '',
        cantidad: it.cantidad || 1,
        reqDevolucion: !!(it.reqDevolucion || (material && material.esHerramienta))
      };
    });
    // Si ya hay una orden abierta, inyectar los renglones ahí mismo
    const vAct = ventanas.activa;
    if (vAct && vAct.aplicarDatosIA) {
      vAct.aplicarDatosIA({
        frente: json.frente,
        responsables: json.responsables,
        nota: json.nota,
        items: items.filter((x) => x.materialId)
      });
      agregarAlHistorial('agente', mensaje || 'Agregué los materiales a la orden que tienes en pantalla.');
      actualizarPanel();
      return;
    }
    const precarga = {
      aviso: '✨ Orden preparada por el Asistente IA. Revisa y confirma.',
      frente: json.frente || '',
      responsable: (json.responsables && json.responsables[0]) || '',
      responsables: (json.responsables || []).map((n) => ({ nombre: n, whatsapp: buscarWhatsappResp(n) })),
      nota: json.nota || '',
      items: items.length ? items : [{ materialId: '', cantidad: '' }]
    };
    const vistaActual = document.querySelector('.menu-item.active')?.dataset?.vista || '';
    if (vistaActual !== 'ordenes') {
      const btnOrd = document.querySelector('.menu-item[data-vista="ordenes"]');
      if (btnOrd) btnOrd.click();
    }
    modalOrden(tipo, precarga);
    agregarAlHistorial('agente', mensaje || 'Abrí la orden con los materiales reconocidos para que la revises.');
    actualizarPanel();

  } else if (accion === 'consulta' || accion === 'respuesta') {
    agregarAlHistorial('agente', mensaje);
    actualizarPanel();

  } else if (accion === 'agregar_inventario') {
    const it = (json.items && json.items[0]) || {};
    const prefill = {
      nombre: it.nombre || '', cantidad: it.cantidad || '',
      unidad: it.unidad || 'unidad', esHerramienta: !!it.esHerramienta,
      serial: it.serial || ''
    };
    modalMaterial(null, prefill);
    agregarAlHistorial('agente', mensaje || 'Abrí formulario de material.');
    actualizarPanel();

  } else if (mensaje) {
    agregarAlHistorial('agente', mensaje);
    actualizarPanel();
  }
}

async function ejecutarOrden(json) {
  const tipo = json.tipo || 'salida';
  const mensaje = json.mensaje || '';
  try {
    const items = (json.items || []).map((it) => {
      const mat = it.materialId
        ? estado.materiales.find((m) => m.id === it.materialId)
        : buscarMaterialInteligente(it.nombre, it.nombreInventario).material;
      return {
        materialId: mat ? mat.id : '',
        materialNombre: mat ? mat.nombre : it.nombre,
        cantidad: Number(it.cantidad) || 1,
        unidad: mat ? mat.unidad : (it.unidad || 'unidad'),
        reqDevolucion: !!(it.reqDevolucion || (mat && mat.esHerramienta)),
        devuelto: false
      };
    }).filter((it) => it.materialId);

    if (items.length === 0) {
      modalEscanearListaIA({
        tipoOrden: tipo,
        respuestaInicial: json
      });
      const msg = 'Algunos materiales no coincidieron exacto con el inventario. Te abrí el verificador IA para asignarlos.';
      agregarAlHistorial('agente', msg);
      actualizarPanel();
      return;
    }

    if (tipo === 'salida') {
      for (const it of items) {
        const mat = estado.materiales.find((m) => m.id === it.materialId);
        if (mat && it.cantidad > (Number(mat.cantidad) || 0)) {
          const msg = `Stock insuficiente de "${mat.nombre}". Disponible: ${fmtNum(mat.cantidad)} ${mat.unidad}. Te abro la orden para ajustar.`;
          agregarAlHistorial('agente', msg);
          actualizarPanel();
          toast(msg, 'error');
          modalOrden(tipo, {
            aviso: `⚠️ Ajusta las cantidades con stock insuficiente antes de generar.`,
            frente: json.frente || '',
            responsable: (json.responsables && json.responsables[0]) || '',
            responsables: (json.responsables || []).map((n) => ({ nombre: n, whatsapp: buscarWhatsappResp(n) })),
            nota: json.nota || '',
            items
          });
          return;
        }
      }
    }

    const frenteVal = (json.frente || '').trim();
    const responsablePrincipal = (json.responsables && json.responsables[0]) || '';
    const responsablesArr = (json.responsables || []).map((n) => ({ nombre: n, whatsapp: buscarWhatsappResp(n) }));

    const orden = await registrarOrden({
      tipo,
      frente: frenteVal,
      contrato: contratoDeFrente(frenteVal),
      proveedor: '',
      responsable: responsablePrincipal,
      responsables: responsablesArr,
      nota: json.nota || '',
      usuario: nombreUsuario(),
      items,
      fecha: null
    });

    if (tipo === 'salida') {
      for (const it of items) {
        const mat = estado.materiales.find((m) => m.id === it.materialId);
        if (mat && mat.esHerramienta) {
          await actualizarHerramientaDespacho(it.materialId, responsablePrincipal, frenteVal, 'salida');
        }
      }
    }

    const resumen = items.map((it) => `${fmtNum(it.cantidad)} ${it.unidad} de ${it.materialNombre}`).join(', ');
    const msg = mensaje || `Listo: ${resumen}. Orden ${orden.numero}.`;
    toast(msg, 'ok');
    agregarAlHistorial('agente', msg);
    actualizarPanel();
  } catch (e) {
    const msg = 'Error al ejecutar: ' + e.message;
    toast(msg, 'error');
    agregarAlHistorial('agente', msg);
    actualizarPanel();
  }
}

// Enviar archivo/foto desde el botón de cámara del asistente o al pegar en el chat
async function procesarImagenEnAsistente(fileOrDataUrl) {
  const vAct = ventanas.activa;
  modalEscanearListaIA({
    enOrdenActiva: !!(vAct && vAct.aplicarDatosIA),
    tipoOrden: (vAct && vAct.ordenTipo) || 'salida',
    alConfirmarEnOrden: (vAct && vAct.aplicarDatosIA) || null,
    archivoInicial: fileOrDataUrl
  });
}

function initAsistente() {
  const style = document.createElement('style');
  style.textContent = `
    .ai-widget { position:fixed; bottom:24px; right:24px; z-index:9999; user-select:none; }
    .ai-fab-group { display:flex; flex-direction:column-reverse; align-items:center; gap:10px; }
    .ai-fab-main { width:60px; height:60px; border-radius:50%; border:2px solid rgba(0,200,255,0.35); background:rgba(4,18,43,0.92); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); color:#00c8ff; font-size:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 4px 20px rgba(0,200,255,0.3), inset 0 0 20px rgba(0,200,255,0.05); transition:all 0.25s ease; position:relative; }
    .ai-fab-main:hover { transform:scale(1.08); box-shadow:0 6px 30px rgba(0,200,255,0.5), inset 0 0 30px rgba(0,200,255,0.08); }
    .ai-fab-main.activo { animation:ai-breathe 2s ease-in-out infinite; }
    .ai-fab-mic, .ai-fab-cam { width:46px; height:46px; border-radius:50%; border:1.5px solid rgba(0,200,255,0.25); background:rgba(4,18,43,0.88); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); color:#e8edf5; font-size:20px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 3px 14px rgba(0,0,0,0.4); transition:all 0.25s ease; opacity:0; transform:scale(0.5) translateY(10px); pointer-events:none; }
    .ai-fab-group.expanded .ai-fab-mic, .ai-fab-group.expanded .ai-fab-cam { opacity:1; transform:scale(1) translateY(0); pointer-events:auto; }
    .ai-fab-mic:hover, .ai-fab-cam:hover { transform:scale(1.1) translateY(0); border-color:rgba(0,200,255,0.6); }
    .ai-fab-mic.grabando { background:rgba(255,84,112,0.25); border-color:rgba(255,84,112,0.6); color:#ff5470; animation:ai-ripple-red 1.2s ease-in-out infinite; }

    .ai-panel { position:fixed; bottom:100px; right:24px; z-index:9998; width:400px; max-width:calc(100vw - 32px); background:rgba(4,18,43,0.92); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(0,200,255,0.28); border-radius:18px; box-shadow:0 12px 50px rgba(0,0,0,0.65), 0 0 30px rgba(0,200,255,0.1); display:none; flex-direction:column; overflow:hidden; transition:all 0.25s ease; }
    .ai-panel.visible { display:flex; }
    .ai-panel.minimized .ai-panel-body, .ai-panel.minimized .ai-panel-chips, .ai-panel.minimized .ai-panel-status, .ai-panel.minimized .ai-panel-inputbar { display:none; }
    .ai-panel-header { display:flex; align-items:center; justify-content:space-between; padding:11px 15px; background:linear-gradient(135deg, rgba(0,200,255,0.12), rgba(13,110,253,0.08)); border-bottom:1px solid rgba(0,200,255,0.14); cursor:move; }
    .ai-panel-title { font-size:13px; font-weight:700; color:#00c8ff; display:flex; align-items:center; gap:6px; }
    .ai-panel-btns { display:flex; gap:4px; }
    .ai-panel-btn { width:26px; height:26px; border-radius:8px; border:none; background:rgba(255,255,255,0.06); color:#7a8ba5; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s ease; }
    .ai-panel-btn:hover { background:rgba(255,255,255,0.14); color:#e8edf5; }
    .ai-panel-chips { display:flex; gap:6px; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); overflow-x:auto; }
    .ai-chip { border:1px solid rgba(0,200,255,0.3); background:rgba(0,200,255,0.08); color:#bae6fd; border-radius:999px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; transition:all 0.15s ease; }
    .ai-chip:hover { background:rgba(0,200,255,0.2); color:#fff; }
    .ai-panel-body { flex:1; max-height:250px; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:8px; scroll-behavior:smooth; }
    .ai-panel-status { padding:6px 14px; border-top:1px solid rgba(0,200,255,0.1); font-size:11.5px; color:#7a8ba5; min-height:28px; display:flex; align-items:center; }
    .ai-panel-inputbar { display:flex; gap:6px; padding:8px 12px 10px; border-top:1px solid rgba(255,255,255,0.07); background:rgba(2,10,26,0.6); align-items:center; }
    .ai-panel-inputbar input { flex:1; min-width:0; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:7px 10px; color:#fff; font-size:12.5px; outline:none; }
    .ai-panel-inputbar input:focus { border-color:#00c8ff; }
    .ai-panel-iconbtn { width:34px; height:34px; border-radius:10px; border:1px solid rgba(0,200,255,0.3); background:rgba(0,200,255,0.1); color:#7dd3fc; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:15px; flex:none; }
    .ai-panel-iconbtn:hover { background:rgba(0,200,255,0.24); color:#fff; }
    .ai-btn-send { margin:6px 14px 0; padding:7px 14px; border:none; border-radius:20px; background:linear-gradient(135deg, #00c8ff, #0d6efd); color:#fff; font-size:12.5px; font-weight:600; cursor:pointer; }
    .ai-bubble { max-width:86%; padding:8px 12px; border-radius:12px; font-size:12.5px; line-height:1.45; word-break:break-word; }
    .ai-bubble-user { align-self:flex-end; background:rgba(0,200,255,0.16); color:#c8efff; border-bottom-right-radius:4px; }
    .ai-bubble-agent { align-self:flex-start; background:rgba(255,255,255,0.07); color:#e8edf5; border-bottom-left-radius:4px; }
    .ai-status-thinking { display:flex; align-items:center; gap:4px; }
    .ai-dot { width:6px; height:6px; border-radius:50%; background:#00c8ff; animation:ai-dots 1.4s ease-in-out infinite; }
    .ai-dot:nth-child(2) { animation-delay:0.2s; }
    .ai-dot:nth-child(3) { animation-delay:0.4s; }
    .ai-status-listening { display:flex; align-items:center; gap:3px; }
    .ai-bar { width:3px; height:12px; border-radius:2px; background:#00c8ff; animation:ai-bars 0.8s ease-in-out infinite; }
    .ai-bar:nth-child(2) { animation-delay:0.1s; }
    .ai-bar:nth-child(3) { animation-delay:0.2s; }
    .ai-bar:nth-child(4) { animation-delay:0.3s; }
    .ai-bar:nth-child(5) { animation-delay:0.4s; }
    @keyframes ai-breathe { 0%,100%{ box-shadow:0 4px 20px rgba(0,200,255,0.3); } 50%{ box-shadow:0 6px 35px rgba(0,200,255,0.55); } }
    @keyframes ai-ripple-red { 0%{ box-shadow:0 0 0 0 rgba(255,84,112,0.5); } 70%{ box-shadow:0 0 0 12px rgba(255,84,112,0); } 100%{ box-shadow:0 0 0 0 rgba(255,84,112,0); } }
    @keyframes ai-dots { 0%,80%,100%{ transform:scale(0.6); opacity:0.4; } 40%{ transform:scale(1); opacity:1; } }
    @keyframes ai-bars { 0%,100%{ height:4px; opacity:0.4; } 50%{ height:14px; opacity:1; } }
    @media (max-width:600px) {
      .ai-widget { bottom:16px; right:16px; }
      .ai-panel { bottom:80px; right:12px; width:calc(100vw - 24px); max-width:calc(100vw - 24px); }
    }
  `;
  document.head.appendChild(style);

  const widget = document.createElement('div');
  widget.className = 'ai-widget';
  widget.innerHTML = `
    <div class="ai-fab-group expanded">
      <div class="ai-fab-main" title="Abrir Asistente IA FVIECOM">🧠</div>
      <div class="ai-fab-mic" title="Hablar por micrófono">🎤</div>
      <div class="ai-fab-cam" title="Escanear lista escrita a mano / foto">📷</div>
    </div>`;
  document.body.appendChild(widget);

  const panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-panel-title">🤖 Agente IA FVIECOM</div>
      <div class="ai-panel-btns">
        <button class="ai-panel-btn ai-btn-min" title="Minimizar">▬</button>
        <button class="ai-panel-btn ai-btn-close" title="Cerrar">✕</button>
      </div>
    </div>
    <div class="ai-panel-chips">
      <button type="button" class="ai-chip" data-ai-chip="scan">📷 Escanear lista a mano</button>
      <button type="button" class="ai-chip" data-ai-chip="salida">📤 Nueva salida</button>
      <button type="button" class="ai-chip" data-ai-chip="stock">🔎 Consultar stock</button>
    </div>
    <div class="ai-panel-body"></div>
    <button class="ai-btn-send" id="ai-btn-send" hidden>✈️ Enviar comando de voz</button>
    <div class="ai-panel-status"><span class="ai-status-text">Escribe abajo, pega una foto (Ctrl+V) o usa 🎤</span></div>
    <div class="ai-panel-inputbar">
      <button type="button" class="ai-panel-iconbtn" id="ai-chat-cam" title="Escanear foto o lista escrita a mano">📷</button>
      <input type="text" id="ai-chat-input" placeholder="Escribe un comando o pega foto (Ctrl+V)..." />
      <button type="button" class="ai-panel-iconbtn" id="ai-chat-send" title="Enviar">➤</button>
    </div>`;
  document.body.appendChild(panel);
  actualizarPanel();

  const fabMain = widget.querySelector('.ai-fab-main');
  const fabGroup = widget.querySelector('.ai-fab-group');
  const fabMic = widget.querySelector('.ai-fab-mic');
  const fabCam = widget.querySelector('.ai-fab-cam');
  const btnMin = panel.querySelector('.ai-btn-min');
  const btnClose = panel.querySelector('.ai-btn-close');
  const chatInput = panel.querySelector('#ai-chat-input');
  const chatSend = panel.querySelector('#ai-chat-send');
  const chatCam = panel.querySelector('#ai-chat-cam');

  // Un solo clic en el botón principal abre/cierra el panel de IA de inmediato
  fabMain.addEventListener('click', () => {
    const visible = panel.classList.toggle('visible');
    asistente.panelVisible = visible;
    fabGroup.classList.add('expanded');
    if (visible && chatInput) setTimeout(() => chatInput.focus(), 80);
  });

  btnMin.addEventListener('click', () => panel.classList.toggle('minimized'));
  btnClose.addEventListener('click', () => {
    panel.classList.remove('visible');
    asistente.panelVisible = false;
  });

  // Chips de acción rápida
  panel.querySelectorAll('[data-ai-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const tipo = chip.dataset.aiChip;
      if (tipo === 'scan') {
        procesarImagenEnAsistente(null);
      } else if (tipo === 'salida') {
        modalOrden('salida');
      } else if (tipo === 'stock' && chatInput) {
        chatInput.value = '¿Cuánto stock tenemos de ';
        chatInput.focus();
      }
    });
  });

  // Envío por texto escrito en la barra del panel
  const enviarTextoChat = () => {
    const txt = (chatInput.value || '').trim();
    if (!txt) return;
    chatInput.value = '';
    if (intentarNavLocal(txt)) return;
    enviarAGemini(txt);
  };
  chatSend.addEventListener('click', enviarTextoChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarTextoChat();
    }
  });
  chatInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        e.preventDefault();
        const f = it.getAsFile();
        if (f) procesarImagenEnAsistente(f);
        return;
      }
    }
  });

  chatCam.addEventListener('click', () => procesarImagenEnAsistente(null));

  const btnSend = panel.querySelector('#ai-btn-send');
  btnSend.addEventListener('click', (e) => {
    e.stopPropagation();
    enviarBuffer();
  });

  // Hacer arrastrable el widget y el panel
  function makeDraggable(el, handleSelector) {
    let isDragging = false;
    let startX, startY, origX, origY;
    let moved = false;
    const handle = handleSelector ? el.querySelector(handleSelector) : el;
    const onStart = (e) => {
      if (e.target.closest('.ai-fab-mic') || e.target.closest('.ai-fab-cam') || e.target.closest('.ai-panel-btn') || e.target.closest('input') || e.target.closest('button')) return;
      isDragging = true;
      moved = false;
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      startY = touch.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      el.classList.add('dragging');
    };
    const onMove = (e) => {
      if (!isDragging) return;
      const touch = e.touches ? e.touches[0] : e;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      e.preventDefault();
      el.style.position = 'fixed';
      el.style.left = (origX + dx) + 'px';
      el.style.top = (origY + dy) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };
    const onEnd = () => {
      isDragging = false;
      el.classList.remove('dragging');
    };
    handle.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    handle.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  makeDraggable(widget, null);
  makeDraggable(panel, '.ai-panel-header');

  // Botón de cámara flotante: abre el escáner inteligente de listas manuscritas
  fabCam.addEventListener('click', (e) => {
    e.stopPropagation();
    procesarImagenEnAsistente(null);
  });

  // Reconocimiento de voz con auto-envío fluido al pausar
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    fabMic.style.opacity = '0.4';
    fabMic.title = 'Navegador no soporta reconocimiento de voz';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'es-CO';
  recognition.continuous = false;
  recognition.interimResults = true;
  asistente.recognition = recognition;

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (interim) {
      if (_autoSendVoiceTimer) { clearTimeout(_autoSendVoiceTimer); _autoSendVoiceTimer = null; }
      actualizarEstado('🎤 ' + (asistente.buffer ? asistente.buffer + ' ' : '') + interim);
    }
    if (!finalText) return;
    const texto = finalText.trim();
    if (!texto) return;

    const ahora = Date.now();
    if (texto === asistente.lastText && (ahora - asistente.lastTextTime) < 2000) return;
    asistente.lastText = texto;
    asistente.lastTextTime = ahora;

    const t = normTxt(texto);
    if (['detente', 'silencio', 'deja de escuchar', 'apaga el asistente'].includes(t)) {
      try { recognition.stop(); } catch (_e) {}
      asistente.escuchando = false;
      asistente.grabando = false;
      asistente.buffer = '';
      mostrarBtnEnviar(false);
      fabMic.classList.remove('grabando');
      fabMain.classList.remove('activo');
      agregarAlHistorial('usuario', texto);
      agregarAlHistorial('agente', 'Entendido, micrófono desactivado.');
      actualizarPanel();
      actualizarEstado();
      return;
    }

    if (intentarNavLocal(texto)) return;

    const envioTriggers = ['listo', 'enviar', 'eso es todo'];
    const esTriggerEnvio = envioTriggers.some((tr) => t === tr || t.endsWith(' ' + tr) || t.startsWith(tr + ' '));
    if (esTriggerEnvio) {
      let textoLimpio = texto;
      for (const tr of envioTriggers) {
        textoLimpio = textoLimpio.replace(new RegExp('\\b' + tr + '\\b', 'gi'), '').trim();
      }
      if (textoLimpio) asistente.buffer += (asistente.buffer ? ' ' : '') + textoLimpio;
      enviarBuffer();
      return;
    }

    asistente.buffer += (asistente.buffer ? ' ' : '') + texto;
    mostrarBtnEnviar(true);
    actualizarEstado('🎤 ' + asistente.buffer);

    // Envío automático tras 2.4 segundos de pausa para que la conversación sea fluida
    if (_autoSendVoiceTimer) clearTimeout(_autoSendVoiceTimer);
    _autoSendVoiceTimer = setTimeout(() => {
      _autoSendVoiceTimer = null;
      if (asistente.buffer.trim() && !asistente.procesando) {
        enviarBuffer();
      }
    }, 2400);
  };

  recognition.onend = () => {
    asistente.grabando = false;
    fabMic.classList.remove('grabando');
    if (asistente.escuchando && !asistente.hablando) reactivarMicrofono();
  };

  recognition.onerror = (e) => {
    asistente.grabando = false;
    if (e.error === 'not-allowed') {
      actualizarEstado('Permiso de micrófono denegado.');
      asistente.escuchando = false;
      fabMic.classList.remove('grabando');
      fabMain.classList.remove('activo');
    } else if (e.error === 'no-speech' || e.error === 'network' || e.error === 'aborted') {
      if (asistente.escuchando && !asistente.hablando) reactivarMicrofono();
    }
  };

  fabMic.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.classList.contains('visible')) {
      panel.classList.add('visible');
      asistente.panelVisible = true;
    }
    if (asistente.escuchando) {
      if (asistente.buffer.trim()) enviarBuffer();
      asistente.escuchando = false;
      asistente.grabando = false;
      fabMic.classList.remove('grabando');
      fabMain.classList.remove('activo');
      try { recognition.stop(); } catch (_e2) {}
      actualizarEstado();
    } else {
      asistente.escuchando = true;
      asistente.grabando = true;
      asistente.buffer = '';
      mostrarBtnEnviar(false);
      fabMic.classList.add('grabando');
      fabMain.classList.add('activo');
      actualizarEstado();
      try { recognition.start(); } catch (_e2) {}
    }
  });
}

initAsistente();

