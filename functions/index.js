/**
 * Cloud Function: Asistente de voz con IA (Gemini) para Inventario FVIECOM.
 * Recibe texto (del reconocimiento de voz) + contexto del inventario.
 * Devuelve una accion estructurada (JSON) para que la app la ejecute.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors')({ origin: true });

// API key de Gemini (se configura via firebase functions:secrets:set GEMINI_API_KEY)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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
Responde SOLO con un JSON valido, sin texto adicional. El formato es:

{
  "accion": "salida" | "devolucion" | "entrada" | "agregar_inventario" | "consulta",
  "confianza": 0.0-1.0,
  "items": [
    {
      "nombre": "Cable #12 AWG LSHF Rojo",
      "cantidad": 20,
      "unidad": "metro",
      "esHerramienta": false,
      "serial": "",
      "esNuevo": false
    }
  ],
  "responsables": ["Jorge Celis", "Ing. Milton"],
  "frente": "5B",
  "nota": "Frente 5Ba",
  "proveedor": "",
  "almacenista": "",
  "consulta": "",
  "mensaje": "Despachar 20m de cable #12 rojo + 20m blanco + 20m verde al frente 5B"
}

Para CONSULTAS (preguntas sobre stock):
{
  "accion": "consulta",
  "confianza": 1.0,
  "consulta": "cable 10",
  "mensaje": "Buscando stock de cable #10..."
}

Si NO entiendes el comando:
{
  "accion": "error",
  "confianza": 0,
  "mensaje": "No entendi. Intenta de nuevo con mas detalle."
}
`;

exports.asistente = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { texto, inventario } = req.body;

    if (!texto) {
      res.status(400).json({ error: 'Falta el campo "texto"' });
      return;
    }

    // Construir contexto del inventario (nombres de materiales para que Gemini
    // pueda emparejar con lo que existe).
    let contextoInv = '';
    if (inventario && Array.isArray(inventario)) {
      const lista = inventario.slice(0, 200).map((m) =>
        `- ${m.nombre}${m.esHerramienta ? ' [HERR]' : ''} | ${m.cantidad} ${m.unidad} | serial: ${m.serial || '-'}`
      ).join('\n');
      contextoInv = `\n\n=== INVENTARIO ACTUAL (materiales disponibles) ===\n${lista}`;
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const result = await model.generateContent([
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + contextoInv + '\n\n=== COMANDO DEL USUARIO ===\n' + texto }] }
    ]);

    const response = result.response;
    const textResp = response.text().trim();

    // Intentar parsear como JSON (Gemini a veces pone ```json ... ```)
    let json;
    try {
      const limpio = textResp.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      json = JSON.parse(limpio);
    } catch (e) {
      json = { accion: 'error', confianza: 0, mensaje: 'No pude interpretar la respuesta de la IA.', raw: textResp };
    }

    res.status(200).json(json);
  } catch (error) {
    console.error('Error en asistente:', error);
    res.status(500).json({ error: 'Error interno: ' + (error.message || 'desconocido') });
  }
});
