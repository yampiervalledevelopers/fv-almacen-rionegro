# Inventario FVIECOM

Aplicación de escritorio y web para el **control de inventario de materiales de obra eléctrica**, desarrollada para **FVIECOM S.A.S** (FV Ingeniería Eléctrica y Telecomunicaciones S.A.S) en el proyecto del **Aeropuerto Internacional José María Córdova (Rionegro)**.

Los datos se guardan en la nube con **Firebase (Firestore)**, con **sincronización en tiempo real** entre equipos y **soporte sin conexión** (los cambios se guardan localmente y se suben al recuperar internet).

---

## · Funciones

- 🔐 **Inicio de sesión** con correo y contraseña (Firebase Authentication).
- ▚ **Panel general** con estadísticas, alertas de stock bajo e inventario por categoría.
- 📦 **Inventario completo**: agregar, editar y eliminar materiales.
- 📏 **Cualquier unidad de medida**: unidad, metro, kilómetro, kilogramo, litro, galón, bulto, rollo, caja, paquete, tramo, juego, par, etc.
- 🗂️ **Agrupación por tipo**: cables, canalización/tubería, iluminación, tableros, tomas, cajas y accesorios, puesta a tierra, comunicaciones, herramientas, EPP.
- 🔄 **Movimientos** con Nota y Responsable separados. Tres tipos: **Salida**, **Entrada/Pedido** y **Devolución**.
- 🧾 **Órdenes** con varios materiales a la vez (salida, entrada o devolución), reimprimibles.
- 👷 **Historial por responsable** (imprimible).
- 🖨️ **Impresión con firmas**: logo, fecha, N° de orden, frente/proveedor, tabla de materiales y dos firmas (Almacenista y Responsable). Funciona en la web (imprimir o "Guardar como PDF") y en la app de escritorio.
- 📥 **Importar PDF**: carga listas de materiales y detecta los elementos (versión de escritorio).
- 📤 **Exportar reportes PDF** general y detallado (versión de escritorio).
- 🎨 Diseño **futurista y corporativo**, con el logo de FVIECOM siempre visible.

---

## 🧩 Requisitos para ejecutarla

1. **Node.js 18 o superior** — descárgalo en [nodejs.org](https://nodejs.org) (versión "LTS").
2. Conexión a internet (para sincronizar con Firebase; una vez cargada funciona sin conexión y sincroniza al reconectar).

---

## ▶️ Cómo ejecutar la aplicación (escritorio)

En una terminal, dentro de la carpeta del proyecto:

```bash
npm install    # instala dependencias (solo la primera vez)
npm start      # abre la aplicación
```

---

## 💿 Crear el instalador (.exe para Windows)

Para entregar la app al almacenista como programa instalable:

```bash
npm run dist:win     # genera el instalador para Windows
```

El instalador queda en la carpeta `dist/`. También existen `npm run dist:mac` y `npm run dist:linux`.

### 🖼️ Ícono de la aplicación
El ícono del programa (el que aparece en el `.exe` y en el acceso directo del escritorio) usa el logo `src/renderer/assets/logo-fviecom.png`, configurado en `package.json` (sección `build`). electron-builder lo convierte automáticamente al formato de cada sistema. Si quieres cambiarlo, reemplaza esa imagen (idealmente cuadrada, mínimo 512x512, y de preferencia con fondo transparente).

---

## 🔥 Configuración de Firebase (una sola vez)

Proyecto de Firebase: **`almacen-rio-jmc`**. En la [consola de Firebase](https://console.firebase.google.com):

1. **Firestore Database** → "Crear base de datos".
2. **Authentication** → "Comenzar" → habilitar **Correo electrónico/contraseña**.
3. Crear el primer usuario (desde la app con "Crear usuario", o en Authentication → Users).
4. **Reglas de seguridad** (recomendado): Firestore → pestaña "Reglas" → pega el contenido de [`firestore.rules`](firestore.rules) → "Publicar".

> 💡 La configuración de Firebase (`src/renderer/firebase-config.js`) no es secreta. La seguridad real la dan las reglas del paso 4 y el login.

---

## 🌐 Versión web (GitHub Pages)

La interfaz también funciona en el navegador (login, inventario, movimientos, órdenes e impresión). La importación/exportación de PDF por archivo es exclusiva de la versión de escritorio.

---

## 🛠️ Estructura del proyecto

```
fv-almacen-rionegro/
├── package.json                → configuración, dependencias e ícono
├── firestore.rules             → reglas de seguridad de Firebase
├── src/
│   ├── main/                   → proceso principal de Electron (Node)
│   │   ├── main.js             → ventana + IPC de PDF
│   │   ├── preload.js          → puente seguro con la interfaz
│   │   ├── pdfParser.js        → lee los PDF de listas de materiales
│   │   └── pdfExport.js        → genera reportes PDF
│   └── renderer/               → la interfaz (lo que se ve)
│       ├── index.html          → estructura de las pantallas
│       ├── styles.css          → diseño y colores
│       ├── renderer.js         → lógica de la interfaz (movimientos, órdenes, impresión)
│       ├── firebase-config.js  → datos del proyecto de Firebase
│       ├── auth.js             → inicio de sesión
│       ├── db.js               → base de datos (Firestore)
│       └── assets/             → logo-fviecom.png (logo real) y logo.svg (ícono)
└── test/
    └── logic.test.js           → pruebas de la lectura de PDF
```

---

FV Ingeniería Eléctrica y Telecomunicaciones S.A.S — Proyecto Aeropuerto JMC, Rionegro.
