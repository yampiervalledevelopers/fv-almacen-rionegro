/**
 * Cloud Function: Asistente de voz con IA (Gemini) para Inventario FVIECOM.
 * Usa llamada directa a la API REST (sin SDK) para maxima compatibilidad.
 */
const { onRequest } = require('firebase-functions/v2/https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `Eres el asistente de voz del sistema de inventario de FVIECOM S.A.S (empresa de ingenieria electrica y telecomunicaciones) en el proyecto del Aeropuerto Internacional Jose Maria Cordova, Rionegro, Colombia.

Tu trabajo: interpretar comandos de voz del almacenista y devolver una ACCION ESTRUCTURADA en JSON.

=== JERGA ELECTRICA (MUY IMPORTANTE) ===
- "Circuito rojo #12" = 3 cables calibre 12 AWG: ROJO + BLANCO + VERDE (tierra). La cantidad aplica a CADA cable.
- "Circuito 220 con neutro" = 4 cables: AMARILLO + ROJO + BLANCO (neutro) + VERDE (tierra).
- "Circuito 220 sin neutro" = 3 cables: AMARILLO + ROJO + VERDE (tierra). Sin blanco.
- "Cable 12" / "Cable 10" = Cable calibre #12 AWG / #10 AWG.
- "LSHF" = Low Smoke Halogen Free (tipo de cable).
- "AWG" = American Wire Gauge (calibre).
- Medidas: "tres octavos"=3/8", "de cuarto"=1/4", "de media"=1/2", "de tres cuartos"=3/4", "de pulgada"=1".
- "EMT" = tubo metalico electrico.
- "Curvador" = herramienta para curvar tubo (es HERRAMIENTA, requiere devolucion).
- "Pesca" / "pasacables" = cinta para pasar cables (es HERRAMIENTA).
- "Chazos supra mas" = tipo de chazo de expansion.
- "Tomas" = tomacorrientes.
- "Platinas de separacion cablofil" = accesorios de bandeja portacables.
- "mt" = metros.

=== CONTRATOS Y FRENTES ===
- Contrato 1: frentes 3, 3A, 3B, 3C
- Contrato 2: frentes 4, 5, 5B, 11

=== REGLAS PARA GENERAR LA ACCION ===
1. Si es un CIRCUITO: desglosar en cables individuales por color. Cantidad x cada color.
2. Si menciona herramientas (taladro, curvador, escalera, pesca, pulidora, etc.): marcar esHerramienta=true y si da serial (FV-1, FV-4) incluirlo.
3. Si hay multiples responsables: ponerlos como array.
4. Si no menciona frente: dejar frente="".
5. Si no menciona cantidad: asumir 1 para herramientas, preguntar para materiales.
6. Para entradas/pedidos: si dice "traido por X" -> X es el responsable/proveedor. "Recibe Y" -> Y es el almacenista/usuario.

=== FORMATO DE RESPUESTA (SIEMPRE JSON) ===
Responde SOLO con un JSON valido, sin texto adicional, sin markdown, sin backticks. El formato es:

{"accion":"salida","confianza":0.95,"items":[{"nombre":"Cable #12 AWG LSHF Rojo","cantidad":20,"unidad":"metro","esHerramienta":false,"serial":"","esNuevo":false}],"responsables":["Jorge Celis","Ing. Milton"],"frente":"5B","nota":"","proveedor":"","almacenista":"","consulta":"","mensaje":"Despachar 20m de cable #12 rojo al frente 5B"}

Para CONSULTAS:
{"accion":"consulta","confianza":1.0,"items":[],"responsables":[],"frente":"","nota":"","proveedor":"","almacenista":"","consulta":"cable 10","mensaje":"Buscando stock de cable #10..."}

Si NO entiendes:
{"accion":"error","confianza":0,"items":[],"responsables":[],"frente":"","nota":"","proveedor":"","almacenista":"","consulta":"","mensaje":"No entendi. Intenta de nuevo con mas detalle."}
`;

exports.asistente = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { texto, inventario } = req.body;
    if (!texto) { res.status(400).json({ error: 'Falta el campo "texto"' }); return; }

    let contextoInv = '';
    if (inventario && Array.isArray(inventario)) {
      const lista = inventario.slice(0, 150).map((m) =>
        `- ${m.nombre}${m.esHerramienta ? ' [HERR]' : ''} | ${m.cantidad} ${m.unidad}${m.serial ? ' | serial:' + m.serial : ''}`
      ).join('\n');
      contextoInv = '\n\n=== INVENTARIO ACTUAL ===\n' + lista;
    }

    const prompt = SYSTEM_PROMPT + contextoInv + '\n\n=== COMANDO DEL USUARIO ===\n' + texto;

    // Llamada directa a la API REST de Gemini (sin SDK)
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      res.status(500).json({ error: 'Error de Gemini: ' + response.status });
      return;
    }

    const data = await response.json();
    const textResp = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';

    let json;
    try {
      const limpio = textResp.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      json = JSON.parse(limpio);
    } catch (e) {
      json = { accion: 'error', confianza: 0, mensaje: 'No pude interpretar la respuesta.', raw: textResp };
    }

    res.status(200).json(json);
  } catch (error) {
    console.error('Error en asistente:', error);
    res.status(500).json({ error: 'Error interno: ' + (error.message || 'desconocido') });
  }
});
