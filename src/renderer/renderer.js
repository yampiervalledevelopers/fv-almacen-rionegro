// ============================================================
//  Inventario FVICOM - Logica de la interfaz (renderer)
// ============================================================

import {
  alCambiarSesion, iniciarSesion, registrarUsuario,
  recuperarClave, cerrarSesion, mensajeError
} from './auth.js';

import {
  escucharMateriales, agregarMaterial, actualizarMaterial, eliminarMaterial,
  importarMateriales, registrarMovimiento, escucharMovimientos, obtenerMovimientos
} from './db.js';

/* ------------------------------------------------------------------ */
/* Estado global                                                       */
/* ------------------------------------------------------------------ */
const estado = {
  usuario: null,
  materiales: [],
  movimientos: [],
  itemsImportados: [],
  desuscribirMateriales: null,
  desuscribirMovimientos: null
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

/* ------------------------------------------------------------------ */
/* Utilidades DOM                                                      */
/* ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '<').replace(/>/g, '>')
    .replace(/"/g, '"').replace(/'/g, '&#39;');
}

function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function esBajoStock(m) {
  const min = Number(m.minimo);
  return min > 0 && (Number(m.cantidad) || 0) <= min;
}

/* ------------------------------------------------------------------ */
/* Modal generico                                                      */
/* ------------------------------------------------------------------ */
function abrirModal(titulo, htmlBody) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-body').innerHTML = htmlBody;
  $('#modal').hidden = false;
}
function cerrarModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

$('#modal-cerrar').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

/* ==================================================================
   LOGIN
   ================================================================== */
const formLogin = $('#form-login');
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const correo = $('#login-correo').value;
  const clave = $('#login-clave').value;
  const btn = $('#btn-login');
  const errBox = $('#login-error');
  errBox.hidden = true;
  btn.disabled = true; btn.textContent = 'Ingresando...';
  try {
    await iniciarSesion(correo, clave);
    // onAuthStateChanged se encarga de mostrar la app
  } catch (err) {
    errBox.textContent = mensajeError(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
});

// Crear usuario
$('#link-registro').addEventListener('click', (e) => {
  e.preventDefault();
  abrirModal('Crear nuevo usuario', `
    <div class="campo full" style="margin-bottom:14px">
      <label>Nombre completo</label>
      <input id="reg-nombre" type="text" placeholder="Ej: Almacenista Obra JMC" />
    </div>
    <div class="campo full" style="margin-bottom:14px">
      <label>Correo electronico</label>
      <input id="reg-correo" type="email" placeholder="usuario@fvicom.com" />
    </div>
    <div class="campo full">
      <label>Contrasena (minimo 6 caracteres)</label>
      <input id="reg-clave" type="password" placeholder="********" />
    </div>
    <div id="reg-error" class="login-error" hidden style="margin-top:14px"></div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="reg-cancelar">Cancelar</button>
      <button class="btn-primary" id="reg-guardar">Crear usuario</button>
    </div>
  `);
  $('#reg-cancelar').addEventListener('click', cerrarModal);
  $('#reg-guardar').addEventListener('click', async () => {
    const nombre = $('#reg-nombre').value.trim();
    const correo = $('#reg-correo').value.trim();
    const clave = $('#reg-clave').value;
    const err = $('#reg-error');
    err.hidden = true;
    if (!correo || clave.length < 6) {
      err.textContent = 'Ingresa un correo valido y una contrasena de al menos 6 caracteres.';
      err.hidden = false; return;
    }
    try {
      await registrarUsuario(correo, clave, nombre);
      cerrarModal();
      toast('Usuario creado correctamente', 'ok');
    } catch (e2) {
      err.textContent = mensajeError(e2); err.hidden = false;
    }
  });
});

// Recuperar contrasena
$('#link-recuperar').addEventListener('click', async (e) => {
  e.preventDefault();
  const correo = $('#login-correo').value.trim();
  if (!correo) { toast('Escribe tu correo en el campo de arriba primero', 'error'); return; }
  try {
    await recuperarClave(correo);
    toast('Te enviamos un correo para restablecer la contrasena', 'ok');
  } catch (err) { toast(mensajeError(err), 'error'); }
});

// Cerrar sesion
$('#btn-salir').addEventListener('click', async () => {
  await cerrarSesion();
});

/* ==================================================================
   Manejo de sesion
   ================================================================== */
alCambiarSesion((usuario) => {
  estado.usuario = usuario;
  if (usuario) {
    $('#pantalla-login').hidden = true;
    $('#app').hidden = false;
    const nombre = usuario.displayName || usuario.email;
    $('#usuario-nombre').textContent = nombre;
    $('#usuario-avatar').textContent = (nombre || '?').charAt(0).toUpperCase();
    iniciarSuscripciones();
    cargarInfoApp();
  } else {
    $('#pantalla-login').hidden = false;
    $('#app').hidden = true;
    if (estado.desuscribirMateriales) estado.desuscribirMateriales();
    if (estado.desuscribirMovimientos) estado.desuscribirMovimientos();
    estado.materiales = []; estado.movimientos = [];
  }
});

function iniciarSuscripciones() {
  if (estado.desuscribirMateriales) estado.desuscribirMateriales();
  if (estado.desuscribirMovimientos) estado.desuscribirMovimientos();

  estado.desuscribirMateriales = escucharMateriales((items) => {
    estado.materiales = items;
    renderInventario();
    renderDashboard();
    llenarFiltroCategorias();
    marcarConexion(true);
  }, (err) => {
    console.error(err);
    toast('Error al conectar con la base de datos: ' + err.message, 'error');
  });

  estado.desuscribirMovimientos = escucharMovimientos((items) => {
    estado.movimientos = items;
    renderMovimientos();
    renderDashboard();
  }, (err) => console.error(err));
}

function marcarConexion(ok) {
  const el = $('#estado-conexion');
  if (ok) { el.classList.remove('offline'); el.innerHTML = '<span class="dot"></span> Conectado'; }
}

// Indicador online/offline del navegador
window.addEventListener('online', () => {
  $('#estado-conexion').classList.remove('offline');
  $('#estado-conexion').innerHTML = '<span class="dot"></span> Conectado';
});
window.addEventListener('offline', () => {
  $('#estado-conexion').classList.add('offline');
  $('#estado-conexion').innerHTML = '<span class="dot"></span> Sin conexion (guardando local)';
});

/* ==================================================================
   Navegacion entre vistas
   ================================================================== */
const TITULOS = {
  dashboard: 'Panel general', inventario: 'Inventario', movimientos: 'Movimientos',
  importar: 'Importar PDF', reportes: 'Reportes PDF', acerca: 'Acerca de'
};

$$('.menu-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const vista = btn.dataset.vista;
    $$('.menu-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.vista').forEach((v) => v.hidden = true);
    $('#vista-' + vista).hidden = false;
    $('#titulo-vista').textContent = TITULOS[vista] || '';
  });
});

/* ==================================================================
   DASHBOARD
   ================================================================== */
function renderDashboard() {
  const mats = estado.materiales;
  const totalTipos = mats.length;
  const totalCant = mats.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  const bajos = mats.filter(esBajoStock);
  const categorias = new Set(mats.map((m) => m.categoria || 'Sin clasificar')).size;

  $('#dash-cards').innerHTML = `
    ${cardHtml('Tipos de material', totalTipos, '▦')}
    ${cardHtml('Cantidad total', fmtNum(totalCant), '∑')}
    ${cardHtml('Categorias', categorias, '▚')}
    ${cardHtml('Stock bajo', bajos.length, '⚠', bajos.length > 0)}
  `;

  // Alertas de stock bajo
  const cont = $('#dash-bajos');
  if (bajos.length === 0) {
    cont.innerHTML = '<div class="vacio" style="padding:20px">Sin alertas. Todo el stock esta por encima del minimo. ✓</div>';
  } else {
    cont.innerHTML = bajos.slice(0, 8).map((m) => `
      <div class="alerta-item">
        <span>${esc(m.nombre)}</span>
        <span class="cant">${fmtNum(m.cantidad)} ${esc(m.unidad)} (min ${fmtNum(m.minimo)})</span>
      </div>`).join('');
  }

  // Barras por categoria
  const grupos = agrupar(mats, 'categoria');
  const cats = Object.keys(grupos).sort((a, b) => grupos[b].length - grupos[a].length);
  const max = Math.max(1, ...cats.map((c) => grupos[c].length));
  $('#dash-categorias').innerHTML = cats.length === 0
    ? '<div class="vacio" style="padding:20px">Aun no hay materiales.</div>'
    : cats.map((c) => `
      <div class="barra-row">
        <div class="barra-top"><span>${esc(c)}</span><span>${grupos[c].length}</span></div>
        <div class="barra-bg"><div class="barra-fill" style="width:${(grupos[c].length / max) * 100}%"></div></div>
      </div>`).join('');

  // Ultimos movimientos
  const ult = estado.movimientos.slice(0, 6);
  $('#dash-movimientos').innerHTML = ult.length === 0
    ? '<div class="vacio" style="padding:20px">Sin movimientos recientes.</div>'
    : ult.map((mv) => `
      <div class="mov-item">
        <span class="mov-tag ${mv.tipo}">${mv.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'}</span>
        <span class="mov-desc">${esc(mv.materialNombre)} — <b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</span>
        <span class="mov-fecha">${fmtFecha(mv.fecha)}</span>
      </div>`).join('');
}

function cardHtml(label, valor, ic, warn) {
  return `<div class="card ${warn ? 'warn' : ''}">
    <div class="card-label">${label}</div>
    <div class="card-valor">${valor}</div>
    <div class="card-ic">${ic}</div>
  </div>`;
}

/* ==================================================================
   INVENTARIO
   ================================================================== */
function llenarFiltroCategorias() {
  const sel = $('#filtro-categoria');
  const actual = sel.value;
  const cats = Array.from(new Set(estado.materiales.map((m) => m.categoria || 'Sin clasificar'))).sort();
  sel.innerHTML = '<option value="">Todas las categorias</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = actual;
}

function materialesFiltrados() {
  const q = ($('#buscar-material').value || '').toLowerCase().trim();
  const cat = $('#filtro-categoria').value;
  return estado.materiales.filter((m) => {
    if (cat && (m.categoria || 'Sin clasificar') !== cat) return false;
    if (!q) return true;
    return [m.nombre, m.codigo, m.categoria, m.ubicacion]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function renderInventario() {
  const lista = materialesFiltrados();
  const cuerpo = $('#cuerpo-inventario');
  $('#inv-vacio').hidden = estado.materiales.length !== 0;

  cuerpo.innerHTML = lista.map((m) => `
    <tr>
      <td class="codigo-cel">${esc(m.codigo || '-')}</td>
      <td>${esc(m.nombre)}${esBajoStock(m) ? '<span class="badge-bajo">STOCK BAJO</span>' : ''}</td>
      <td><span class="chip">${esc(m.categoria || 'Sin clasificar')}</span></td>
      <td class="der ${esBajoStock(m) ? 'cant-bajo' : ''}">${fmtNum(m.cantidad)}</td>
      <td>${esc(m.unidad)}</td>
      <td class="der">${m.minimo ? fmtNum(m.minimo) : '-'}</td>
      <td>${esc(m.ubicacion || '-')}</td>
      <td class="cen">
        <div class="acciones-cel">
          <button class="btn-icon" title="Registrar movimiento" data-mov="${m.id}">⇄</button>
          <button class="btn-icon" title="Editar" data-editar="${m.id}">✎</button>
          <button class="btn-icon peligro" title="Eliminar" data-eliminar="${m.id}">🗑</button>
        </div>
      </td>
    </tr>`).join('');

  cuerpo.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => modalMaterial(b.dataset.editar)));
  cuerpo.querySelectorAll('[data-eliminar]').forEach((b) =>
    b.addEventListener('click', () => confirmarEliminar(b.dataset.eliminar)));
  cuerpo.querySelectorAll('[data-mov]').forEach((b) =>
    b.addEventListener('click', () => modalMovimiento(b.dataset.mov)));
}

$('#buscar-material').addEventListener('input', renderInventario);
$('#filtro-categoria').addEventListener('change', renderInventario);
$('#btn-nuevo-material').addEventListener('click', () => modalMaterial(null));

function opcionesSelect(lista, sel) {
  return lista.map((v) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

function modalMaterial(id) {
  const m = id ? estado.materiales.find((x) => x.id === id) : null;
  abrirModal(m ? 'Editar material' : 'Nuevo material', `
    <div class="form-grid">
      <div class="campo"><label>Codigo</label><input id="f-codigo" value="${esc(m ? m.codigo : '')}" placeholder="Opcional" /></div>
      <div class="campo"><label>Unidad de medida</label><select id="f-unidad">${opcionesSelect(UNIDADES, m ? m.unidad : 'unidad')}</select></div>
      <div class="campo full"><label>Nombre del material *</label><input id="f-nombre" value="${esc(m ? m.nombre : '')}" placeholder="Ej: Cable THHN #12 AWG" /></div>
      <div class="campo full"><label>Categoria</label><select id="f-categoria">${opcionesSelect(CATEGORIAS, m ? m.categoria : 'Sin clasificar')}</select></div>
      <div class="campo"><label>Cantidad</label><input id="f-cantidad" type="number" step="any" min="0" value="${m ? m.cantidad : 0}" /></div>
      <div class="campo"><label>Stock minimo (alerta)</label><input id="f-minimo" type="number" step="any" min="0" value="${m ? (m.minimo || 0) : 0}" /></div>
      <div class="campo full"><label>Ubicacion en almacen</label><input id="f-ubicacion" value="${esc(m ? m.ubicacion : '')}" placeholder="Ej: Estante A-3" /></div>
      <div class="campo full"><label>Nota</label><textarea id="f-nota" placeholder="Opcional">${esc(m ? m.nota : '')}</textarea></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="m-cancelar">Cancelar</button>
      <button class="btn-primary" id="m-guardar">${m ? 'Guardar cambios' : 'Agregar material'}</button>
    </div>
  `);
  $('#m-cancelar').addEventListener('click', cerrarModal);
  $('#m-guardar').addEventListener('click', async () => {
    const datos = {
      codigo: $('#f-codigo').value.trim(),
      nombre: $('#f-nombre').value.trim(),
      categoria: $('#f-categoria').value,
      cantidad: $('#f-cantidad').value,
      unidad: $('#f-unidad').value,
      minimo: $('#f-minimo').value,
      ubicacion: $('#f-ubicacion').value.trim(),
      nota: $('#f-nota').value.trim()
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
    <p style="color:var(--texto-dim);line-height:1.6">
      Vas a eliminar <b style="color:#fff">${esc(m.nombre)}</b> del inventario.
      Esta accion no se puede deshacer.
    </p>
    <div class="modal-acciones">
      <button class="btn-ghost" id="del-cancelar">Cancelar</button>
      <button class="btn-primary" id="del-ok" style="background:linear-gradient(135deg,#ff5470,#c0392b);color:#fff">Si, eliminar</button>
    </div>
  `);
  $('#del-cancelar').addEventListener('click', cerrarModal);
  $('#del-ok').addEventListener('click', async () => {
    try { await eliminarMaterial(id); toast('Material eliminado', 'ok'); cerrarModal(); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   MOVIMIENTOS
   ================================================================== */
function renderMovimientos() {
  const q = ($('#buscar-mov').value || '').toLowerCase().trim();
  const tipo = $('#filtro-tipo-mov').value;
  const lista = estado.movimientos.filter((mv) => {
    if (tipo && mv.tipo !== tipo) return false;
    if (!q) return true;
    return [mv.materialNombre, mv.frente, mv.nota, mv.usuario]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  $('#mov-vacio').hidden = estado.movimientos.length !== 0;
  $('#cuerpo-mov').innerHTML = lista.map((mv) => `
    <tr>
      <td>${fmtFecha(mv.fecha)}</td>
      <td><span class="mov-tag ${mv.tipo}">${mv.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'}</span></td>
      <td>${esc(mv.materialNombre)}</td>
      <td class="der"><b>${fmtNum(mv.cantidad)}</b> ${esc(mv.unidad || '')}</td>
      <td>${esc(mv.frente || mv.nota || '-')}</td>
      <td>${esc(mv.usuario || '-')}</td>
    </tr>`).join('');
}

$('#buscar-mov').addEventListener('input', renderMovimientos);
$('#filtro-tipo-mov').addEventListener('change', renderMovimientos);
$('#btn-nuevo-mov').addEventListener('click', () => modalMovimiento(null));

function modalMovimiento(materialId) {
  if (estado.materiales.length === 0) {
    toast('Primero agrega materiales al inventario', 'error'); return;
  }
  let tipoSel = 'salida';
  const opciones = estado.materiales
    .slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    .map((m) => `<option value="${m.id}" ${m.id === materialId ? 'selected' : ''}>${esc(m.nombre)} (${fmtNum(m.cantidad)} ${esc(m.unidad)})</option>`).join('');

  abrirModal('Registrar movimiento', `
    <div class="campo full" style="margin-bottom:14px">
      <label>Tipo de movimiento</label>
      <div class="seg" id="seg-tipo">
        <button type="button" data-t="entrada">↧ Entrada</button>
        <button type="button" data-t="salida" class="on">↥ Salida</button>
      </div>
    </div>
    <div class="campo full" style="margin-bottom:14px">
      <label>Material</label>
      <select id="mv-material">${opciones}</select>
    </div>
    <div class="form-grid">
      <div class="campo"><label>Cantidad *</label><input id="mv-cantidad" type="number" step="any" min="0" placeholder="0" /></div>
      <div class="campo"><label>Frente de obra</label><input id="mv-frente" placeholder="Ej: Torre de control" /></div>
      <div class="campo full"><label>Nota / responsable</label><input id="mv-nota" placeholder="Opcional" /></div>
    </div>
    <div class="modal-acciones">
      <button class="btn-ghost" id="mv-cancelar">Cancelar</button>
      <button class="btn-primary" id="mv-guardar">Registrar</button>
    </div>
  `);

  $('#seg-tipo').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      tipoSel = b.dataset.t;
      $('#seg-tipo').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  $('#mv-cancelar').addEventListener('click', cerrarModal);
  $('#mv-guardar').addEventListener('click', async () => {
    const matId = $('#mv-material').value;
    const mat = estado.materiales.find((x) => x.id === matId);
    const cantidad = parseFloat($('#mv-cantidad').value);
    if (!mat || !cantidad || cantidad <= 0) { toast('Ingresa una cantidad valida', 'error'); return; }
    if (tipoSel === 'salida' && cantidad > (Number(mat.cantidad) || 0)) {
      toast('No hay suficiente stock. Disponible: ' + fmtNum(mat.cantidad) + ' ' + mat.unidad, 'error'); return;
    }
    try {
      await registrarMovimiento({
        tipo: tipoSel, materialId: matId, materialNombre: mat.nombre,
        cantidad, unidad: mat.unidad, frente: $('#mv-frente').value.trim(),
        nota: $('#mv-nota').value.trim(),
        usuario: estado.usuario ? (estado.usuario.displayName || estado.usuario.email) : ''
      });
      toast('Movimiento registrado', 'ok');
      cerrarModal();
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
}

/* ==================================================================
   IMPORTAR PDF
   ================================================================== */
$('#btn-elegir-pdf').addEventListener('click', async () => {
  if (!window.nativo) { toast('Funcion disponible solo en la app de escritorio', 'error'); return; }
  const res = await window.nativo.importarPdf();
  if (!res || res.canceled) return;
  if (res.error) { toast(res.error, 'error'); return; }

  $('#pdf-nombre').textContent = res.fileName || '';
  estado.itemsImportados = (res.items || []).map((it, i) => ({ ...it, _id: i }));

  if (estado.itemsImportados.length === 0) {
    toast('No se detectaron materiales. Revisa el formato del PDF.', 'error');
    $('#panel-preview').hidden = true;
    return;
  }
  renderPreview();
  $('#panel-preview').hidden = false;
});

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

  cuerpo.querySelectorAll('input, select').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const row = parseInt(e.target.closest('tr').dataset.row, 10);
      const item = estado.itemsImportados.find((x) => x._id === row);
      if (item) item[e.target.dataset.campo] = e.target.value;
    });
  });
  cuerpo.querySelectorAll('[data-quitar]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = parseInt(b.dataset.quitar, 10);
      estado.itemsImportados = estado.itemsImportados.filter((x) => x._id !== id);
      renderPreview();
      if (estado.itemsImportados.length === 0) $('#panel-preview').hidden = true;
    });
  });
}

$('#btn-cancelar-import').addEventListener('click', () => {
  estado.itemsImportados = [];
  $('#panel-preview').hidden = true;
  $('#pdf-nombre').textContent = '';
});

$('#btn-confirmar-import').addEventListener('click', async () => {
  if (estado.itemsImportados.length === 0) return;
  const btn = $('#btn-confirmar-import');
  btn.disabled = true; btn.textContent = 'Agregando...';
  try {
    const limpio = estado.itemsImportados.map((it) => ({
      codigo: it.codigo, nombre: it.nombre, categoria: it.categoria,
      cantidad: it.cantidad, unidad: it.unidad
    })).filter((it) => it.nombre && it.nombre.trim());
    const r = await importarMateriales(limpio, estado.materiales);
    toast(`Importados: ${r.creados} nuevos, ${r.actualizados} actualizados`, 'ok');
    estado.itemsImportados = [];
    $('#panel-preview').hidden = true;
    $('#pdf-nombre').textContent = '';
    // Ir al inventario
    $('.menu-item[data-vista="inventario"]').click();
  } catch (e) {
    toast('Error al importar: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Agregar al inventario';
  }
});

/* ==================================================================
   REPORTES PDF
   ================================================================== */
$('#btn-rep-general').addEventListener('click', () => generarReporte('general'));
$('#btn-rep-detallado').addEventListener('click', () => generarReporte('detallado'));

async function generarReporte(tipo) {
  if (!window.nativo) { toast('Funcion disponible solo en la app de escritorio', 'error'); return; }
  if (estado.materiales.length === 0) { toast('No hay materiales para exportar', 'error'); return; }

  const estadoBox = $('#rep-estado');
  estadoBox.hidden = false;
  estadoBox.textContent = 'Generando reporte...';
  try {
    let movimientos = estado.movimientos;
    if (tipo === 'detallado') {
      try { movimientos = await obtenerMovimientos(); } catch (e) { /* usar cache */ }
    }
    const res = await window.nativo.exportarPdf({
      tipo,
      materiales: estado.materiales.map((m) => ({
        codigo: m.codigo, nombre: m.nombre, categoria: m.categoria,
        cantidad: m.cantidad, unidad: m.unidad, minimo: m.minimo, ubicacion: m.ubicacion
      })),
      movimientos: movimientos.map((mv) => ({
        tipo: mv.tipo, materialNombre: mv.materialNombre, cantidad: mv.cantidad,
        unidad: mv.unidad, frente: mv.frente, nota: mv.nota, fecha: mv.fecha
      })),
      meta: {
        fecha: new Date().toLocaleString('es-CO'),
        usuario: estado.usuario ? (estado.usuario.displayName || estado.usuario.email) : ''
      }
    });
    if (res.canceled) { estadoBox.hidden = true; return; }
    if (res.error) { estadoBox.textContent = res.error; toast(res.error, 'error'); return; }
    estadoBox.innerHTML = `✓ Reporte generado: <b>${esc(res.filePath)}</b>`;
    toast('Reporte PDF generado', 'ok');
    window.nativo.abrirArchivo(res.filePath);
  } catch (e) {
    estadoBox.textContent = 'Error: ' + e.message;
    toast('Error al generar el PDF', 'error');
  }
}

/* ==================================================================
   ACERCA DE
   ================================================================== */
async function cargarInfoApp() {
  if (!window.nativo) return;
  try {
    const info = await window.nativo.infoApp();
    $('#acerca-info').textContent =
      `Version ${info.version} · Electron ${info.electron} · Node ${info.node} · ${info.plataforma}`;
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function agrupar(lista, campo) {
  const g = {};
  for (const item of lista) {
    const k = item[campo] || 'Sin clasificar';
    (g[k] = g[k] || []).push(item);
  }
  return g;
}
