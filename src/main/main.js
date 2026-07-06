'use strict';

/**
 * Proceso principal de Electron.
 * - Crea la ventana de la aplicacion.
 * - Expone via IPC las operaciones que requieren Node (leer/exportar PDF),
 *   ya que Firebase (datos) corre en el proceso "renderer" para tener
 *   sincronizacion en tiempo real y soporte sin conexion.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { parsePdfFile } = require('./pdfParser');
const { exportInventoryPdf } = require('./pdfExport');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0a0f1e',
    title: 'Inventario FVICOM',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Abrir enlaces externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ */
/* IPC: Importar PDF de lista de materiales                            */
/* ------------------------------------------------------------------ */

// Abre un dialogo para seleccionar un PDF y devuelve los materiales detectados.
ipcMain.handle('pdf:importar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar lista de materiales (PDF)',
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  try {
    const parsed = await parsePdfFile(filePath);
    return {
      canceled: false,
      fileName: path.basename(filePath),
      texto: parsed.rawText,
      items: parsed.items
    };
  } catch (err) {
    return { canceled: false, error: 'No se pudo leer el PDF: ' + err.message };
  }
});

/* ------------------------------------------------------------------ */
/* IPC: Exportar reporte PDF                                           */
/* ------------------------------------------------------------------ */

// Recibe { tipo: 'general'|'detallado', materiales, movimientos, meta }
ipcMain.handle('pdf:exportar', async (_evt, payload) => {
  const tipo = payload && payload.tipo === 'detallado' ? 'detallado' : 'general';
  const sugerido = `Reporte_Inventario_${tipo}_${fechaArchivo()}.pdf`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar reporte PDF',
    defaultPath: sugerido,
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  try {
    await exportInventoryPdf({
      tipo,
      materiales: (payload && payload.materiales) || [],
      movimientos: (payload && payload.movimientos) || [],
      meta: (payload && payload.meta) || {},
      outputPath: result.filePath
    });
    return { canceled: false, filePath: result.filePath };
  } catch (err) {
    return { canceled: false, error: 'No se pudo generar el PDF: ' + err.message };
  }
});

// Abrir un archivo generado con la app predeterminada del sistema
ipcMain.handle('archivo:abrir', async (_evt, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return true;
  }
  return false;
});

// Info de version para mostrar en "Acerca de"
ipcMain.handle('app:info', async () => {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    plataforma: process.platform
  };
});

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function fechaArchivo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
