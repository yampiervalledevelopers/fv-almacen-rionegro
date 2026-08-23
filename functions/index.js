/**
 * Cloud Function: Asistente de voz con IA (Gemini via Vertex AI).
 * Usa Vertex AI en vez de AI Studio para usar los creditos de Google Cloud.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'almacen-rio-jmc';
const LOCATION = 'global';
const MODEL = 'gemini-3.7-flash';
const VERTEX_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Eres el asistente de voz del sistema de inventario de FVIECOM S.A.S (empresa de ingenieria electrica y telecomunicaciones) en el proyecto del Aeropuerto Internacional Jose Maria Cordova, Rionegro, Colombia.

Tu trabajo: interpretar comandos de voz del almacenista y devolver una ACCION ESTRUCTURADA en JSON.

=== JERGA ELECTRICA (MUY IMPORTANTE) ===
- "Circuito rojo #12" = 3 cables calibre 12 AWG: ROJO + BLANCO + VERDE (tierra). La cantidad aplica a CADA cable.
- "Circuito 220 con neutro" = 4 cables: AMARILLO + ROJO + BLANCO (neutro) + VERDE (tierra).
- "Circuito 220 sin neutro" = 3 cables: AMARILLO + ROJO + VERDE (tierra). Sin blanco.
- "Cable 12" / "Cable 10" = Cable calibre #12 AWG / #10 AWG.
- "LSHF" = Low Smoke Halogen Free (tipo de cable).
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

=== REGLAS ===
1. Si es un CIRCUITO: desglosar en cables individuales por color. Cantidad x cada color.
2. Si menciona herramientas (taladro, curvador, escalera, pesca, pulidora, etc.): marcar esHerramienta=true y si da serial (FV-1, FV-4) incluirlo.
3. Si hay multiples responsables: ponerlos como array.
4. Si no menciona frente: dejar frente="".
5. Si no menciona cantidad: asumir 1 para herramientas.
6. Para entradas/pedidos: "traido por X" -> X es el responsable. "Recibe Y" -> Y es el almacenista.

=== FORMATO DE RESPUESTA (SIEMPRE JSON PURO, SIN MARKDOWN) ===
{"accion":"salida","confianza":0.95,"items":[{"nombre":"Cable #12 AWG Rojo","cantidad":20,"unidad":"metro","esHerramienta":false,"serial":"","esNuevo":false}],"responsables":["Jorge Celis"],"frente":"5B","nota":"","proveedor":"","almacenista":"","consulta":"","mensaje":"Despachar 20m cable #12 rojo al frente 5B"}

Acciones validas: salida, devolucion, entrada, agregar_inventario, consulta, error
`;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

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

    // Obtener token de autenticacion (automatico en Cloud Functions)
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const response = await fetch(VERTEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.token}`
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Vertex AI error:', response.status, errText);
      res.status(500).json({ error: 'Error de Gemini: ' + response.status, detalle: errText.substring(0, 200) });
      return;
    }

    const data = await response.json();
    const textResp = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';

    let json;
    try {
      const limpio = textResp.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      json = JSON.parse(limpio);
    } catch (e) {
      json = { accion: 'error', confianza: 0, mensaje: 'No pude interpretar la respuesta.', raw: textResp.substring(0, 300) };
    }

    res.status(200).json(json);
  } catch (error) {
    console.error('Error en asistente:', error);
    res.status(500).json({ error: 'Error interno: ' + (error.message || 'desconocido') });
  }
});
