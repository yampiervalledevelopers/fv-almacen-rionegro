// ============================================================
//  Capa de datos - Firestore (base de datos en la nube)
//  - Sincronizacion en tiempo real (onSnapshot)
//  - Persistencia sin conexion (persistentLocalCache):
//    los cambios se guardan localmente y se suben al reconectar.
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

// Inicializar Firestore con cache local persistente (modo sin conexion).
const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const COL_MATERIALES = 'materiales';
const COL_MOVIMIENTOS = 'movimientos';

/* ------------------------------------------------------------------ */
/* Materiales                                                          */
/* ------------------------------------------------------------------ */

/**
 * Se suscribe en tiempo real a la lista de materiales.
 * callback(arrayDeMateriales) se llama cada vez que hay cambios.
 * Devuelve una funcion para cancelar la suscripcion.
 */
export function escucharMateriales(callback, onError) {
  const q = query(collection(db, COL_MATERIALES), orderBy('nombre'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

/**
 * Agrega un material nuevo. Devuelve el id generado.
 */
export async function agregarMaterial(datos) {
  const ref = await addDoc(collection(db, COL_MATERIALES), {
    codigo: datos.codigo || '',
    nombre: datos.nombre || '',
    categoria: datos.categoria || 'Sin clasificar',
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

/**
 * Actualiza un material existente.
 */
export async function actualizarMaterial(id, cambios) {
  const limpio = {};
  ['codigo', 'nombre', 'categoria', 'unidad', 'ubicacion', 'nota'].forEach((k) => {
    if (cambios[k] !== undefined) limpio[k] = cambios[k];
  });
  ['cantidad', 'minimo'].forEach((k) => {
    if (cambios[k] !== undefined) limpio[k] = Number(cambios[k]) || 0;
  });
  limpio.actualizado = serverTimestamp();
  await updateDoc(doc(db, COL_MATERIALES, id), limpio);
}

/**
 * Elimina un material.
 */
export async function eliminarMaterial(id) {
  await deleteDoc(doc(db, COL_MATERIALES, id));
}

/**
 * Importa varios materiales de una vez (desde un PDF).
 * Si un material ya existe (mismo nombre, sin distinguir mayusculas),
 * suma la cantidad; si no, lo crea. Usa un batch para eficiencia.
 * Devuelve { creados, actualizados }.
 */
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

/* ------------------------------------------------------------------ */
/* Movimientos (entradas / salidas)                                    */
/* ------------------------------------------------------------------ */

/**
 * Registra un movimiento (entrada o salida) y ajusta el stock del material
 * de forma atomica (batch): el documento del material y el movimiento se
 * guardan juntos.
 */
export async function registrarMovimiento(mov) {
  const cantidad = Number(mov.cantidad) || 0;
  if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  const delta = mov.tipo === 'entrada' ? cantidad : -cantidad;

  const batch = writeBatch(db);
  const matRef = doc(db, COL_MATERIALES, mov.materialId);
  batch.update(matRef, {
    cantidad: increment(delta),
    actualizado: serverTimestamp()
  });

  const movRef = doc(collection(db, COL_MOVIMIENTOS));
  batch.set(movRef, {
    tipo: mov.tipo === 'entrada' ? 'entrada' : 'salida',
    materialId: mov.materialId,
    materialNombre: mov.materialNombre || '',
    cantidad: cantidad,
    unidad: mov.unidad || 'unidad',
    frente: mov.frente || '',
    nota: mov.nota || '',
    usuario: mov.usuario || '',
    fecha: serverTimestamp()
  });

  await batch.commit();
}

/**
 * Escucha en tiempo real los movimientos (mas recientes primero).
 */
export function escucharMovimientos(callback, onError) {
  const q = query(collection(db, COL_MOVIMIENTOS), orderBy('fecha', 'desc'));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => {
      const data = d.data();
      items.push({
        id: d.id,
        ...data,
        // convertir Timestamp de Firestore a fecha ISO utilizable
        fecha: data.fecha && data.fecha.toDate ? data.fecha.toDate().toISOString() : (data.fecha || null)
      });
    });
    callback(items);
  }, (err) => { if (onError) onError(err); });
}

/**
 * Obtiene todos los movimientos una sola vez (para exportar reportes).
 */
export async function obtenerMovimientos() {
  const q = query(collection(db, COL_MOVIMIENTOS), orderBy('fecha', 'desc'));
  const snap = await getDocs(q);
  const items = [];
  snap.forEach((d) => {
    const data = d.data();
    items.push({
      id: d.id,
      ...data,
      fecha: data.fecha && data.fecha.toDate ? data.fecha.toDate().toISOString() : (data.fecha || null)
    });
  });
  return items;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export { db };
