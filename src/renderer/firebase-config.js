// ============================================================
//  Configuracion de Firebase - Proyecto: almacen-rio-jmc
// ============================================================
//  Estos datos NO son secretos: es normal que la configuracion
//  web de Firebase viaje dentro de la app. La seguridad real la
//  dan las "reglas de seguridad" de Firestore (ver README).
//
//  Si algun dia cambian de proyecto de Firebase, solo hay que
//  reemplazar el objeto firebaseConfig de abajo.
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyAm5MQK4fh1Z0zqRYDQsaou-I7rpEEjJik',
  authDomain: 'almacen-rio-jmc.firebaseapp.com',
  projectId: 'almacen-rio-jmc',
  storageBucket: 'almacen-rio-jmc.firebasestorage.app',
  messagingSenderId: '426371132496',
  appId: '1:426371132496:web:366a70baaf0de399b13555',
  measurementId: 'G-TMJEF6YE7H'
};

// Nota: No se inicializa Analytics porque no funciona dentro de Electron
// (no hay entorno de navegador completo) y no es necesario para el inventario.

export const firebaseApp = initializeApp(firebaseConfig);
