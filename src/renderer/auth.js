// ============================================================
//  Autenticacion (login) con Firebase Authentication
//  Metodo: correo electronico + contrasena
// ============================================================

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { firebaseApp } from './firebase-config.js';

const auth = getAuth(firebaseApp);

/**
 * Escucha cambios de sesion. Llama a callback(usuario|null).
 */
export function alCambiarSesion(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Inicia sesion con correo y contrasena.
 */
export async function iniciarSesion(correo, clave) {
  const cred = await signInWithEmailAndPassword(auth, correo.trim(), clave);
  return cred.user;
}

/**
 * Crea un nuevo usuario (para dar de alta al almacenista/administrador).
 * Opcionalmente guarda un nombre visible.
 */
export async function registrarUsuario(correo, clave, nombre) {
  const cred = await createUserWithEmailAndPassword(auth, correo.trim(), clave);
  if (nombre) {
    try { await updateProfile(cred.user, { displayName: nombre }); } catch (e) { /* ignore */ }
  }
  return cred.user;
}

/**
 * Envia correo para restablecer la contrasena.
 */
export async function recuperarClave(correo) {
  await sendPasswordResetEmail(auth, correo.trim());
}

/**
 * Cierra la sesion actual.
 */
export async function cerrarSesion() {
  await signOut(auth);
}

/**
 * Traduce codigos de error de Firebase a mensajes en espanol.
 */
export function mensajeError(err) {
  const code = (err && err.code) || '';
  const mapa = {
    'auth/invalid-email': 'El correo no es valido.',
    'auth/user-disabled': 'Este usuario esta deshabilitado.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contrasena incorrecta.',
    'auth/invalid-credential': 'Correo o contrasena incorrectos.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/weak-password': 'La contrasena debe tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
    'auth/network-request-failed': 'Sin conexion. Verifica tu internet.',
    'auth/operation-not-allowed': 'El metodo correo/contrasena no esta habilitado en Firebase.'
  };
  return mapa[code] || (err && err.message) || 'Ocurrio un error inesperado.';
}

export { auth };
