# Inventario FVICOM

Aplicación de escritorio para el **control de inventario de materiales de obra eléctrica**, desarrollada para **FVICOM S.A.S** (FV Ingeniería Eléctrica y Telecomunicaciones S.A.S) en el proyecto del **Aeropuerto Internacional José María Córdova (Rionegro)**.

Los datos se guardan en la nube con **Firebase (Firestore)**, con **sincronización en tiempo real** entre equipos y **soporte sin conexión** (los cambios se guardan localmente y se suben al recuperar internet).

---

## · Funciones

- 🔐 **Inicio de sesión** con correo y contraseña (Firebase Authentication).
- ▚ **Panel general** con estadísticas, alertas de stock bajo e inventario por categoría.
- 📦 **Inventario completo**: agregar, editar y eliminar materiales.
- 📏 **Cualquier unidad de medida**: unidad, metro, kilómetro, kilogramo, litro, galón, bulto, rollo, caja, paquete, tramo, juego, par, etc.
- 🗂️ **Agrupación por tipo**: cables, canalización/tubería, iluminación, tableros, tomas, cajas y accesorios, puesta a tierra, comunicaciones, herramientas, EPP.
- 🔄 **Entradas y salidas** con historial de movimientos, frente de obra, responsable y ajuste automático del stock.
- 📥 **Importar PDF**: carga listas de materiales, detecta automáticamente los elementos y permite revisarlos antes de agregarlos.
- 📤 **Exportar PDF**: reporte **general** (resumen por categoría) o **detallado** (inventario completo + movimientos), con membrete corporativo.
- 🎨 Diseño **futurista y corporativo**, con el logo de FVICOM siempre visible.

---

## 🧩 Requisitos para ejecutarla

1. **Node.js 18 o superior** — descárgalo en [nodejs.org](https://nodejs.org) (elige la versión "LTS").
2. Conexión a internet (para sincronizar con Firebase; una vez cargada, funciona sin conexión y sincroniza al reconectar).

---

## ▶️ Cómo ejecutar la aplicación

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
npm install    # instala las dependencias (solo la primera vez)
npm start      # abre la aplicación
```

---

## 💿 Crear el instalador (.exe para Windows)

Para entregar la app al almacenista como un programa instalable:

```bash
npm run dist:win     # genera el instalador para Windows
```

El instalador quedará en la carpeta `dist/`. También existen `npm run dist:mac` y `npm run dist:linux`.

---

## 🔥 Configuración de Firebase (importante, una sola vez)

El proyecto ya viene conectado al proyecto de Firebase **`almacen-rio-jmc`**. Solo falta activar 3 cosas en la [consola de Firebase](https://console.firebase.google.com):

### 1. Crear la base de datos
- Menú **Build → Firestore Database → "Crear base de datos"**.
- Elige una ubicación y créala.

### 2. Habilitar el inicio de sesión
- Menú **Build → Authentication → "Comenzar"**.
- En **Sign-in method**, habilita **"Correo electrónico/contraseña"**.

### 3. Crear el primer usuario
Tienes dos opciones:
- **Desde la app**: en la pantalla de login, clic en **"Crear usuario"**.
- **Desde Firebase**: Authentication → pestaña **Users → "Agregar usuario"**.

### 4. Aplicar las reglas de seguridad (recomendado)
Para que solo usuarios con sesión puedan ver/editar los datos:
- Firestore Database → pestaña **"Reglas"**.
- Copia el contenido del archivo [`firestore.rules`](firestore.rules) de este proyecto y pégalo.
- Clic en **"Publicar"**.

> 💡 La configuración de Firebase (archivo `src/renderer/firebase-config.js`) **no es secreta**. La seguridad real la dan las reglas del paso 4.

---

## 🛠️ Cómo modificar la aplicación

Todo el proyecto está comentado en español. Estructura:

```
fv-almacen-rionegro/
├── package.json                → configuración y dependencias
├── firestore.rules             → reglas de seguridad de Firebase
├── src/
│   ├── main/                   → proceso principal de Electron (Node)
│   │   ├── main.js             → crea la ventana y conecta con el PDF
│   │   ├── preload.js          → puente seguro con la interfaz
│   │   ├── pdfParser.js        → LEE los PDF de listas de materiales
│   │   └── pdfExport.js        → GENERA los reportes PDF
│   └── renderer/               → la interfaz (lo que se ve)
│       ├── index.html          → estructura de las pantallas
│       ├── styles.css          → diseño y colores
│       ├── renderer.js         → lógica de la interfaz
│       ├── firebase-config.js  → datos del proyecto de Firebase
│       ├── auth.js             → inicio de sesión
│       ├── db.js               → base de datos (Firestore)
│       └── assets/logo.svg     → logo de la empresa
└── test/
    └── logic.test.js           → pruebas de la lectura de PDF
```

### Cambiar el logo
Reemplaza `src/renderer/assets/logo.svg` por el logo oficial (SVG o PNG). Si usas PNG, cambia la extensión en `index.html` (busca `assets/logo.svg`).

### Cambiar colores del diseño
Edita las variables al inicio de `src/renderer/styles.css` (sección `:root`).

### Cambiar las categorías de materiales
Edita la lista `CATEGORIAS` al inicio de `src/renderer/renderer.js` y las reglas `categoriaSugerida()` en `src/main/pdfParser.js`.

### Afinar la lectura de PDF
El detector de materiales está en `src/main/pdfParser.js` (función `parseLinea`). Reconoce patrones como:
- `10 UND Interruptor 15A`
- `Cable THHN #12 AWG   500 m`
- `CBL-12 Cable THHN #12 250 mts`

Si las listas de FVICOM tienen otro formato, comparte un PDF de ejemplo y se ajustan las reglas.

---

## ✓ Pruebas

```bash
npm test
```

Verifica la lógica de lectura de PDF (detección de cantidad, unidad, código y categoría).

---

## 📄 Notas técnicas

- El SDK de Firebase se carga desde su CDN oficial (`gstatic.com`), por eso la app necesita internet al abrir. Firestore mantiene una copia local para trabajar sin conexión.
- Las dependencias de Node (`electron`, `pdf-parse`, `pdfkit`) se instalan con `npm install`.

---

FV Ingeniería Eléctrica y Telecomunicaciones S.A.S — Proyecto Aeropuerto JMC, Rionegro.
