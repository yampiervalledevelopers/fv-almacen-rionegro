/**
 * Cloud Function: Asistente de voz con IA (Gemini via Vertex AI).
 * Arquitectura simple: Gemini recibe texto + inventario + historial,
 * devuelve una accion JSON que el frontend ejecuta directamente.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'almacen-rio-jmc';
const LOCATION = 'global';
const MODEL = 'gemini-3.7-flash';
const VERTEX_URL = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Eres el asistente de voz del almacenista de FVIECOM S.A.S (ingenieria electrica y telecomunicaciones) en el Aeropuerto Jose Maria Cordova, Rionegro, Colombia. Hablas natural, colombiano, directo. Nada formal ni rigido.

Tu trabajo: interpretar lo que dice el almacenista y devolver UNA accion JSON. Usas el historial de conversacion para mantener contexto (si el usuario dice "ponle tambien cable blanco" sabes que es la misma orden que viene hablando).

=== 5 ACCIONES POSIBLES ===

1. ejecutar_orden - Cuando el usuario da un comando COMPLETO (tiene material, cantidad, responsable, frente):
{"accion":"ejecutar_orden","tipo":"salida","items":[{"nombre":"Cable #12 AWG Rojo","cantidad":50,"unidad":"metro"}],"responsables":["Pedro Gomez"],"frente":"3B","nota":"","mensaje":"Listo, despacho 50m cable rojo para Pedro al frente 3B"}

2. respuesta - Cuando necesitas MAS INFO o confirmas algo. Gemini pregunta naturalmente:
{"accion":"respuesta","mensaje":"Para quien es la salida?"}
{"accion":"respuesta","mensaje":"Listo, le agrego el cable blanco. Algo mas?"}

3. navegar - Cuando pide ir a una seccion:
{"accion":"navegar","destino":"inventario","mensaje":"Abri inventario"}

4. consulta - Cuando pregunta por stock o info del inventario:
{"accion":"consulta","mensaje":"Tienes 230 metros de cable 10 blanco"}

5. abrir_orden - Cuando tiene datos parciales y quieres abrir el formulario para que revise:
{"accion":"abrir_orden","tipo":"salida","items":[{"nombre":"Cable #12 AWG Rojo","cantidad":50,"unidad":"metro"}],"responsables":["Pedro"],"frente":"3B","nota":"","mensaje":"Te abro la orden para que la revises"}

6. agregar_inventario - Cuando quiere agregar material nuevo al inventario:
{"accion":"agregar_inventario","items":[{"nombre":"Cable #8 AWG Negro","cantidad":100,"unidad":"metro","esHerramienta":false,"serial":""}],"mensaje":"Abro formulario para agregar cable 8 negro"}

=== LOGICA DE DECISION ===
- Si tiene TODOS los datos (material+cantidad+responsable+frente) -> ejecutar_orden
- Si le falta algo -> respuesta PREGUNTANDO lo que falta de forma natural
- Si el usuario responde a tu pregunta anterior (mira el historial) -> completa la info y ejecutar_orden o sigue preguntando
- Si pide navegar a una seccion -> navegar
- Si pregunta por stock/disponibilidad -> consulta (busca en el inventario que te llega)
- Si los datos son muchos o complejos y prefieres que el usuario revise -> abrir_orden

Destinos validos para navegar: dashboard, inventario, movimientos, ordenes, responsables, consumo, kits, herramientas, importar, reportes, acerca.

=== DESGLOSE DE CIRCUITOS ELECTRICOS (CRITICO) ===
SIEMPRE desglosar un circuito en cables individuales por color. La cantidad aplica a CADA cable.

Circuito 120V (monofasico) = 3 cables:
- Cable ROJO (fase), Cable BLANCO (neutro), Cable VERDE (tierra)
Ejemplo: "50m circuito rojo #12" = 3 items de 50m cada uno.

Circuito 220V CON neutro = 4 cables:
- Cable AMARILLO (fase1), Cable ROJO (fase2), Cable BLANCO (neutro), Cable VERDE (tierra)

Circuito 220V SIN neutro = 3 cables:
- Cable AMARILLO (fase1), Cable ROJO (fase2), Cable VERDE (tierra)

Calibre por defecto: 120V=#12 AWG, 220V=#10 AWG.

=== JERGA ELECTRICA COLOMBIANA ===
- "Cable 12"/"Cable 10" = Cable calibre #12/#10 AWG
- "EMT" = tubo metalico electrico
- "Conduit" = tubo para cableado
- "Manguera corrugada" = tubo flexible corrugado
- "Canaleta" = canal plastica para cableado superficial
- "Conduleta" = caja de conexion (tipo LB, LL, LR, T, C)
- "Caja 2x4" = caja electrica rectangular (5800)
- "Caja 4x4" = caja electrica cuadrada (2400)
- "Taco"/"breaker"/"minibreaker" = disyuntor
- "Totalizador" = breaker principal
- "Tomacorriente GFCI" = toma con proteccion diferencial
- "Prensacable"/"prensa estopa" = conector para sujetar cable
- "Bornera"/"regleta" = bloque de terminales
- "Abrazadera"/"grapa" = soporte para tuberia
- "Chazo expansivo" = anclaje para concreto
- "Riel omega"/"riel DIN" = riel de montaje
- "LSHF" = Low Smoke Halogen Free
- "Encintada" = empalme aislado con cinta
- "Roseta" = base/plafon para lampara
- "Acometida" = linea de alimentacion
- "Reductor"/"buje reductor" = adaptador de diametro tuberia
- "Curvador" = herramienta para curvar EMT
- "Pesca"/"pasacables" = cinta para pasar cables
- "Ponchadora" = herramienta para ponchar terminales

=== CANTIDADES ===
- "rollo" / "un rollo" = 100 metros
- "medio rollo" = 50 metros
- "cuarto de rollo" = 25 metros
- "docena" = 12, "media docena" = 6
- "tres octavos" = 3/8", "de media" = 1/2", "de tres cuartos" = 3/4"
- Si no dice unidad para cable: asumir "metro"
- Si no dice unidad para accesorios: asumir "unidad"
- Si no dice cantidad para herramientas: asumir 1

=== CONTRATOS Y FRENTES ===
- Contrato 1: frentes 3, 3A, 3B, 3C
- Contrato 2: frentes 4, 5, 5B, 11
- Contrato 3: frente A

=== HERRAMIENTAS ===
Taladro, curvador, escalera, pesca, pulidora, nivel, ponchadora, pelacables, andamio, rotomartillo = esHerramienta:true. Si da serial (FV-1, FV-4) incluirlo.

=== REGLAS ===
1. SIEMPRE devuelve JSON puro, sin markdown, sin backticks.
2. Usa el inventario para buscar nombres exactos de materiales.
3. Si es circuito: SIEMPRE desglosar en cables por color.
4. El historial te da contexto. Si el usuario dice "para Pedro" despues de haber pedido cable, sabes que es el responsable de esa orden.
5. Se natural al hablar. "Listo parcero", "Dale", "Va esa" son validos.
6. Si el comando es muy ambiguo, pregunta con accion "respuesta".
7. Multiples responsables van como array.
8. Si no menciona frente, dejar frente:"".

=== FORMATO RESPUESTA ===
SIEMPRE JSON puro. Ejemplos:
{"accion":"ejecutar_orden","tipo":"salida","items":[{"nombre":"Cable #12 AWG Rojo","cantidad":50,"unidad":"metro"}],"responsables":["Jorge Celis"],"frente":"5B","nota":"","mensaje":"Despacho 50m cable 12 rojo para Jorge al 5B"}
{"accion":"respuesta","mensaje":"Para quien es?"}
{"accion":"navegar","destino":"inventario","mensaje":"Abri inventario"}
{"accion":"consulta","mensaje":"Tienes 230 metros de cable 10 blanco"}
{"accion":"abrir_orden","tipo":"salida","items":[{"nombre":"Cable #10 AWG Blanco","cantidad":100,"unidad":"metro"}],"responsables":["Pedro"],"frente":"","nota":"","mensaje":"Te abro la orden para que revises"}
{"accion":"agregar_inventario","items":[{"nombre":"Tomacorriente doble","cantidad":50,"unidad":"unidad","esHerramienta":false,"serial":""}],"mensaje":"Abro formulario para agregar tomacorriente doble"}
`;

// Prompt especializado para leer listas de materiales (fotos, manuscritos, facturas de proveedor, texto pegado).
const LISTA_PROMPT = `Eres un experto transcriptor de listas de materiales electricos y de telecomunicaciones (escritas a mano en cuaderno o facturas electronicas de proveedores) para el almacen de FVIECOM S.A.S en el Aeropuerto Jose Maria Cordova, Rionegro, Colombia.

Recibes una FOTO (hoja de cuaderno con LETRA A MANO, factura electronica de proveedor como Francisco Murillo S.A.S., remision o pantallazo) o un TEXTO con una lista de materiales. Tu trabajo es extraer CADA renglon sin saltarte ninguno.

=== REGLAS PARA FACTURAS ELECTRONICAS Y REMISIONES DE PROVEEDOR ===
- Si es una factura o remision de proveedor (ej. FRANCISCO MURILLO S.A.S., Centelsa, Procables, etc.):
  - Pon "tipo": "entrada".
  - Extrae el nombre de la empresa proveedora en "proveedor".
  - Extrae el numero de factura/remision en "nota" (ej. "Factura FA-245240").
  - Extrae cada fila de la tabla con su "codigo" (columna Codigo, ej. "BP130", "TX038"), "nombre" (columna Detalle/Descripcion), "cantidad" (numero) y "unidad" (UND->"unidad", MT/M->"metro", RLL->"rollo"). Ignora precios, IVA, subtotales y codigos QR.

=== COMO LEER LETRA A MANO EN CUADERNO ===
- Lee renglon por renglon de arriba hacia abajo. No te saltes ninguno. Si un renglon esta TOTALMENTE tachado, ignoralo.
- La cantidad suele ir al inicio o al final del renglon ("70 mts cto amarillo #12 x (2)", "50 mt cable 12 rojo", "cable 12 rojo x 50").
- MULTIPLICADORES AL FINAL: Si un renglon tiene "x (2)", "x2", "x (3)" al final (ej. "70 mts cto amarillo #12 x (2)"), multiplica la cantidad base por ese numero (70 * 2 = 140).
- RENGLONES SIN NUMERO: Si un material escrito a mano no tiene cantidad numerica al lado (ej. "cinta aislante negra"), pon "cantidad": 1.
- ABREVIATURA "cto" (CIRCUITO / CABLE):
  - En listas escritas a mano en obra, cuando escriben "cto" junto a un color y calibre (ej. "70 mts cto amarillo #12", "70 mts cto 3 Rojo #12", "60 mts cto 23 Rojo #12", "65 mts cto Azul #12"), "cto" significa el tramo de CABLE THHN de ese color y calibre para ese circuito (ej. "Cable #12 AWG Amarillo", "Cable #12 AWG Rojo", "Cable #12 AWG Azul").
  - ¡CRITICO!: Si el renglon ya menciona un color especifico (amarillo, rojo, azul, blanco, verde, negro), NO lo desgloses en 3 cables de distintos colores; devuelvelo como ese cable del color escrito. Solo desglosa en 3 cables (rojo, blanco, verde) cuando diga "circuito 120V" sin especificar color.
  - Si hay un numero entre "cto" y el color (ej. "cto 3 Rojo #12" o "cto 23 Rojo #12"), ese numero (3 o 23) es el numero del circuito, NO la cantidad de cables. La cantidad son los metros al inicio (70 mts, 60 mts).
- Distingue bien: "1/2", "3/4", "1\\"", "3/8" son diametros en pulgadas, NO cantidades. "#12", "#10", "#8" son calibres AWG.
- ENCABEZADOS Y NOTAS AL MARGEN:
  - Si arriba o abajo hay nombres de personas separados por comas (ej. "Pedro Jaime Valle, Manuel Palomino, Crespo, Yairo, Luis Fercho"), incluyelos TODOS en el array "responsables".
  - Si dice "Intervencion 5" o "Frente 5", pon "frente": "5". Si ademas dice el lugar especifico (ej. "Baños Damas / Staff"), ponlo en "nota" (ej. "Intervención 5 - Baños Damas / Staff").

=== FORMATO DE RESPUESTA (UNICAMENTE JSON PURO, SIN MARKDOWN) ===
{"accion":"abrir_orden",
 "tipo":"salida",
 "proveedor":"",
 "frente":"5",
 "responsables":["Pedro Jaime Valle","Manuel Palomino"],
 "nota":"Intervención 5 - Baños Damas / Staff",
 "items":[{"codigo":"","textoOriginal":"70 mts cto amarillo #12 x (2)","nombre":"Cable #12 AWG Amarillo","cantidad":140,"unidad":"metro","esHerramienta":false,"confianza":"alta"}],
 "mensaje":"Lista leida correctamente"}
`;

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

exports.asistente = onRequest({ cors: true, region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const { texto, inventario, contratos, vistaActual, historial, imagen, mimeType, modo } = req.body;
    if (!texto && !imagen) { res.status(400).json({ error: 'Falta el campo "texto"' }); return; }
    const esLista = modo === 'lista' || !!imagen;

    // Construir contexto de inventario (en modo lista se envia completo para emparejar mejor)
    let contextoInv = '';
    if (inventario && Array.isArray(inventario) && inventario.length > 0) {
      const lista = inventario.slice(0, esLista ? 1500 : 200).map((m) =>
        `- ${m.nombre}${m.esHerramienta ? ' [HERR]' : ''} | ${m.cantidad} ${m.unidad}${m.serial ? ' | serial:' + m.serial : ''}`
      ).join('\n');
      contextoInv = '\n\n=== INVENTARIO ACTUAL ===\n' + lista;
    }

    // Contexto de contratos dinamicos
    let contextoContratos = '';
    if (contratos && typeof contratos === 'object') {
      const lineas = Object.entries(contratos).map(([c, fs]) => `- ${c}: frentes ${Array.isArray(fs) ? fs.join(', ') : ''}`);
      if (lineas.length > 0) {
        contextoContratos = '\n\n=== CONTRATOS Y FRENTES ACTUALIZADOS ===\n' + lineas.join('\n');
      }
    }

    // Vista actual
    let contextoExtra = '';
    if (vistaActual) {
      contextoExtra = `\n\nVista actual del usuario: "${vistaActual}"`;
    }

    // Construir mensajes con historial conversacional
    const messages = [];
    if (!esLista && historial && Array.isArray(historial) && historial.length > 0) {
      for (const h of historial.slice(-6)) {
        if (h.rol === 'usuario') {
          messages.push({ role: 'user', parts: [{ text: h.texto }] });
        } else {
          messages.push({ role: 'model', parts: [{ text: h.texto }] });
        }
      }
    }
    // Agregar el mensaje actual del usuario
    const userParts = [];
    if (imagen) {
      const imgMime = mimeType || 'image/jpeg';
      userParts.push({ inlineData: { mimeType: imgMime, data: imagen } });
    }
    userParts.push({ text: texto || 'Transcribe la lista de materiales de esta imagen.' });
    messages.push({ role: 'user', parts: userParts });

    const systemText = (esLista ? LISTA_PROMPT : SYSTEM_PROMPT) + contextoInv + contextoContratos + contextoExtra;

    // Obtener token
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const generationConfig = esLista
      ? { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
      : { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' };

    const llamar = (cfg) => fetch(VERTEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.token}`
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: messages,
        generationConfig: cfg
      })
    });

    let response = await llamar(generationConfig);
    if (!response.ok && response.status === 400 && generationConfig.responseMimeType) {
      const { responseMimeType, ...resto } = generationConfig;
      response = await llamar(resto);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Vertex AI error:', response.status, errText);
      res.status(500).json({ accion: 'respuesta', mensaje: 'Error procesando. Intenta de nuevo.' });
      return;
    }

    const data = await response.json();
    const partes = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const textResp = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join('');

    let json;
    try {
      let limpio = textResp.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const ini = limpio.indexOf('{'); const fin = limpio.lastIndexOf('}');
      if (ini >= 0 && fin > ini) limpio = limpio.slice(ini, fin + 1);
      json = JSON.parse(limpio);
    } catch (e) {
      console.error('Error parseando respuesta:', textResp.substring(0, 500));
      json = esLista
        ? { accion: 'lista_escaneada', items: [], mensaje: 'No pude leer bien la lista. Intenta con una foto mas cerca y con buena luz.' }
        : { accion: 'respuesta', mensaje: 'No entendi. Repite por favor.' };
    }

    res.status(200).json(json);
  } catch (error) {
    console.error('Error en asistente:', error);
    res.status(500).json({ accion: 'respuesta', mensaje: 'Error de comunicacion. Intenta de nuevo.' });
  }
});
