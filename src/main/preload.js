'use strict';

/**
 * Puente seguro entre el proceso principal (Node) y la interfaz (renderer).
 * Solo se exponen las funciones necesarias, sin dar acceso completo a Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativo', {
  // Importar un PDF de lista de materiales. Devuelve items detectados.
  importarPdf: () => ipcRenderer.invoke('pdf:importar'),

  // Exportar un reporte PDF (general o detallado).
  exportarPdf: (payload) => ipcRenderer.invoke('pdf:exportar', payload),

  // Abrir un archivo con la app del sistema.
  abrirArchivo: (filePath) => ipcRenderer.invoke('archivo:abrir', filePath),

  // Informacion de la app.
  infoApp: () => ipcRenderer.invoke('app:info')
});
