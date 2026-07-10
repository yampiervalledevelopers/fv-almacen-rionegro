// ============================================================
//  Capa de datos - Firestore (base de datos en la nube)
//  - Movimientos con responsable, contrato y 3 tipos
//  - Ordenes: entrada = pedido pendiente (no suma stock hasta recibir)
// ============================================================

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseApp } from './firebase-config.js';

const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const COL_MATERIALES = 'materiales';
const COL_MOVIMIENTOS = 'movimientos';
const COL_ORDENES = 'ordenes';

function deltaStock(tipo, cantidad) {
  const c = Number(cantidad) || 0;
  return tipo === 'salida' ? -c : c;
}

function generarNumeroOrden(tipo) {
  const p = tipo === 'salida' ? 'SAL' : tipo === 'entrada' ? 'ENT' : 'DEV';
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${p}-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function fechaISO(data) {
  return data && data.fecha && data.fecha.toDate ? data.fecha.toDate().toISOString() : (data && data.fecha) || null;
}

/* ---------------- Materiales ---------------- */

export function escucharMateriales(callback, onError) {
  const q = query(collection(db, COL_MATERIALES), orderBy('nombre'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

export async function agregarMaterial(datos) {
  const ref = await addDoc(collection(db, COL_MATERIALES), {
    codigo: datos.codigo || '',
    nombre: datos.nombre || '',
    categoria: datos.categoria || 'Sin clasificar',
    clase: datos.clase || '',
    cantidad: Number(datos.cantidad) || 0,
    unidad: datos.unidad || 'unidad',
    minimo: Number(datos.minimo) || 0,
    ubicacion: datos.ubicacion || '',
    nota: datos.nota || '',
    creado: serverTimestamp(),
    actualizado: serverTimestamp()
  });
  return ref.id;
}

export async function actualizarMaterial(id, cambios) {
  const limpio = {};
  ['codigo', 'nombre', 'categoria', 'clase', 'unidad', 'ubicacion', 'nota'].forEach((k) => {
    if (cambios[k] !== undefined) limpio[k] = cambios[k];
  });
  ['cantidad', 'minimo'].forEach((k) => {
    if (cambios[k] !== undefined) limpio[k] = Number(cambios[k]) || 0;
  });
  limpio.actualizado = serverTimestamp();
  await updateDoc(doc(db, COL_MATERIALES, id), limpio);
}

export async function eliminarMaterial(id) {
  await deleteDoc(doc(db, COL_MATERIALES, id));
}

export async function importarMateriales(lista, existentes) {
  const batch = writeBatch(db);
  const porNombre = {};
  (existentes || []).forEach((m) => { porNombre[normalizar(m.nombre)] = m; });

  let creados = 0;
  let actualizados = 0;

  for (const it of lista) {
    const clave = normalizar(it.nombre);
    const ya = porNombre[clave];
    if (ya) {
      const ref = doc(db, COL_MATERIALES, ya.id);
      batch.update(ref, {
        cantidad: increment(Number(it.cantidad) || 0),
        actualizado: serverTimestamp()
      });
      actualizados++;
    } else {
      const ref = doc(collection(db, COL_MATERIALES));
      batch.set(ref, {
        codigo: it.codigo || '',
        nombre: it.nombre || '',
        categoria: it.categoria || 'Sin clasificar',
        cantidad: Number(it.cantidad) || 0,
        unidad: it.unidad || 'unidad',
        minimo: 0,
        ubicacion: '',
        nota: 'Importado de PDF',
        creado: serverTimestamp(),
        actualizado: serverTimestamp()
      });
      creados++;
    }
  }

  await batch.commit();
  return { creados, actualizados };
}

/* ---------------- Movimientos individuales ---------------- */

export async function registrarMovimiento(mov) {
  const cantidad = Number(mov.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  const tipo = ['entrada', 'salida', 'devolucion'].includes(mov.tipo) ? mov.tipo : 'salida';
  const delta = deltaStock(tipo, cantidad);

  const batch = writeBatch(db);
  const matRef = doc(db, COL_MATERIALES, mov.materialId);
  batch.update(matRef, { cantidad: increment(delta), actualizado: serverTimestamp() });

  const movRef = doc(collection(db, COL_MOVIMIENTOS));
  batch.set(movRef, {
    tipo,
    materialId: mov.materialId,
    materialNombre: mov.materialNombre || '',
    cantidad,
    unidad: mov.unidad || 'unidad',
    frente: mov.frente || '',
    contrato: mov.contrato || '',
    proveedor: mov.proveedor || '',
    responsable: mov.responsable || '',
    nota: mov.nota || '',
    usuario: mov.usuario || '',
    fecha: serverTimestamp(),
    ordenId: '',
    ordenNumero: ''
  });

  await batch.commit();
}

export function escucharMovimientos(callback, onError) {
  const q = query(collection(db, COL_MOVIMIENTOS), orderBy('fecha', 'desc'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data(), fecha: fechaISO(d.data()) }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

export async function obtenerMovimientos() {
  const q = query(collection(db, COL_MOVIMIENTOS), orderBy('fecha', 'desc'));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data(), fecha: fechaISO(d.data()) }));
  return items;
}

/* ---------------- Ordenes ---------------- */

export async function registrarOrden(orden) {
  const tipo = ['entrada', 'salida', 'devolucion'].includes(orden.tipo) ? orden.tipo : 'salida';
  const items = (orden.items || [])
    .filter((it) => it.materialId && (Number(it.cantidad) || 0) > 0)
    .map((it) => ({
      materialId: it.materialId,
      materialNombre: it.materialNombre || '',
      cantidad: Number(it.cantidad) || 0,
      unidad: it.unidad || 'unidad'
    }));

  if (items.length === 0) throw new Error('Agrega al menos un material con cantidad valida.');

  const numero = generarNumeroOrden(tipo);
  const fecha = serverTimestamp();
  const batch = writeBatch(db);
  const ordenRef = doc(collection(db, COL_ORDENES));

  const esPedidoPendiente = (tipo === 'entrada');
  const estadoOrden = esPedidoPendiente ? 'pendiente' : 'completado';

  if (!esPedidoPendiente) {
    for (const it of items) {
      batch.update(doc(db, COL_MATERIALES, it.materialId), {
        cantidad: increment(deltaStock(tipo, it.cantidad)),
        actualizado: fecha
      });
      const movRef = doc(collection(db, COL_MOVIMIENTOS));
      batch.set(movRef, {
        tipo,
        materialId: it.materialId,
        materialNombre: it.materialNombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
        frente: orden.frente || '',
        contrato: orden.contrato || '',
        proveedor: orden.proveedor || '',
        responsable: orden.responsable || '',
        nota: orden.nota || '',
        usuario: orden.usuario || '',
        fecha,
        ordenId: ordenRef.id,
        ordenNumero: numero
      });
    }
  }

  batch.set(ordenRef, {
    numero,
    tipo,
    estado: estadoOrden,
    frente: orden.frente || '',
    contrato: orden.contrato || '',
    proveedor: orden.proveedor || '',
    responsable: orden.responsable || '',
    nota: orden.nota || '',
    usuario: orden.usuario || '',
    fecha,
    items
  });

  await batch.commit();

  return {
    id: ordenRef.id, numero, tipo, estado: estadoOrden,
    frente: orden.frente || '', contrato: orden.contrato || '',
    proveedor: orden.proveedor || '', responsable: orden.responsable || '',
    nota: orden.nota || '', usuario: orden.usuario || '',
    fecha: new Date().toISOString(), items
  };
}

export async function recibirOrden(orden, recibidos, usuario) {
  const items = (recibidos || []).filter((it) => it.materialId && (Number(it.cantidad) || 0) > 0);
  if (items.length === 0) throw new Error('Ingresa al menos una cantidad recibida.');

  const fecha = serverTimestamp();
  const batch = writeBatch(db);

  for (const it of items) {
    batch.update(doc(db, COL_MATERIALES, it.materialId), {
      cantidad: increment(Number(it.cantidad) || 0),
      actualizado: fecha
    });
    const movRef = doc(collection(db, COL_MOVIMIENTOS));
    batch.set(movRef, {
      tipo: 'entrada',
      materialId: it.materialId,
      materialNombre: it.materialNombre || '',
      cantidad: Number(it.cantidad) || 0,
      unidad: it.unidad || 'unidad',
      frente: '',
      proveedor: orden.proveedor || '',
      responsable: orden.responsable || '',
      nota: 'Recepcion de pedido ' + (orden.numero || ''),
      usuario: usuario || '',
      fecha,
      ordenId: orden.id,
      ordenNumero: orden.numero || ''
    });
  }

  batch.update(doc(db, COL_ORDENES, orden.id), {
    estado: 'recibido',
    fechaRecepcion: fecha
  });

  await batch.commit();
}

export function escucharOrdenes(callback, onError) {
  const q = query(collection(db, COL_ORDENES), orderBy('fecha', 'desc'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data(), fecha: fechaISO(d.data()) }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

export async function obtenerOrdenes() {
  const q = query(collection(db, COL_ORDENES), orderBy('fecha', 'desc'));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data(), fecha: fechaISO(d.data()) }));
  return items;
}

/* ---------------- Eliminar (limpieza de datos) ---------------- */

// Elimina un movimiento individual. Si ajustarStock=true y hay materialId,
// revierte en el stock el efecto que ese movimiento tuvo (una salida se
// devuelve al stock; una entrada/devolucion se descuenta).
export async function eliminarMovimiento(mov, ajustarStock) {
  if (!mov || !mov.id) throw new Error('Movimiento invalido.');
  const batch = writeBatch(db);
  if (ajustarStock && mov.materialId) {
    const deltaOriginal = deltaStock(mov.tipo, Number(mov.cantidad) || 0);
    batch.update(doc(db, COL_MATERIALES, mov.materialId), {
      cantidad: increment(-deltaOriginal),
      actualizado: serverTimestamp()
    });
  }
  batch.delete(doc(db, COL_MOVIMIENTOS, mov.id));
  await batch.commit();
}

// Elimina una orden junto con TODOS sus movimientos asociados. El ajuste de
// stock se agrupa por material (para no aplicar dos transforms al mismo doc)
// y solo se hace para los materiales cuyos ids vengan en idsMaterialesAjustar;
// si ese arreglo va vacio, no se toca el inventario.
export async function eliminarOrden(orden, movimientosLigados, idsMaterialesAjustar) {
  if (!orden || !orden.id) throw new Error('Orden invalida.');
  const batch = writeBatch(db);
  const ajustables = new Set(idsMaterialesAjustar || []);
  const ajustePorMaterial = {};

  for (const mv of (movimientosLigados || [])) {
    if (mv && mv.id) batch.delete(doc(db, COL_MOVIMIENTOS, mv.id));
    if (mv && mv.materialId && ajustables.has(mv.materialId)) {
      const deltaOriginal = deltaStock(mv.tipo, Number(mv.cantidad) || 0);
      ajustePorMaterial[mv.materialId] = (ajustePorMaterial[mv.materialId] || 0) + deltaOriginal;
    }
  }
  for (const matId in ajustePorMaterial) {
    batch.update(doc(db, COL_MATERIALES, matId), {
      cantidad: increment(-ajustePorMaterial[matId]),
      actualizado: serverTimestamp()
    });
  }
  batch.delete(doc(db, COL_ORDENES, orden.id));
  await batch.commit();
}

/* ---------------- Kits (plantillas de materiales) ---------------- */

const COL_KITS = 'kits';

function limpiarItemsKit(items) {
  return (items || [])
    .filter((it) => it.materialId && (Number(it.cantidad) || 0) > 0)
    .map((it) => ({
      materialId: it.materialId,
      materialNombre: it.materialNombre || '',
      cantidad: Number(it.cantidad) || 0,
      unidad: it.unidad || 'unidad'
    }));
}

export function escucharKits(callback, onError) {
  const q = query(collection(db, COL_KITS), orderBy('nombre'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

export async function agregarKit(kit) {
  const ref = await addDoc(collection(db, COL_KITS), {
    nombre: kit.nombre || '',
    items: limpiarItemsKit(kit.items),
    creado: serverTimestamp(),
    actualizado: serverTimestamp()
  });
  return ref.id;
}

export async function actualizarKit(id, kit) {
  await updateDoc(doc(db, COL_KITS, id), {
    nombre: kit.nombre || '',
    items: limpiarItemsKit(kit.items),
    actualizado: serverTimestamp()
  });
}

export async function eliminarKit(id) {
  await deleteDoc(doc(db, COL_KITS, id));
}

/* ---------------- Categorias (tipos personalizados) ---------------- */

const COL_CATEGORIAS = 'categorias';

export function escucharCategorias(callback, onError) {
  const q = query(collection(db, COL_CATEGORIAS), orderBy('nombre'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

export async function agregarCategoria(nombre) {
  const n = String(nombre || '').trim();
  if (!n) throw new Error('El nombre de la categoria no puede estar vacio.');
  const ref = await addDoc(collection(db, COL_CATEGORIAS), { nombre: n, creado: serverTimestamp() });
  return ref.id;
}

export async function eliminarCategoria(id) {
  await deleteDoc(doc(db, COL_CATEGORIAS, id));
}

export { db };
