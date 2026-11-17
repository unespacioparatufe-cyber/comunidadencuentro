const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.0-flash"
];
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant"
];
const OPENROUTER_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free"
];
const MISTRAL_MODEL = "mistral-small-latest";

const MAX_MESSAGE_LENGTH = 4000;

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: HEADERS,
    body: JSON.stringify(data)
  };
}

const SYSTEM_INSTRUCTION = `Eres parte del equipo de acompañamiento cristiano de "Un espacio para tu fe". Responde en español natural, cálido, sencillo y cercano, como una persona madura en la fe que se sienta al lado de quien está sufriendo. No hables como un informe, una evaluación psicológica, un chatbot ni un folleto.

ESCUCHA Y PERSONALIZA:
- Comprende primero qué ocurrió, qué emociones expresa la persona y qué parece necesitar ahora.
- Responde a los detalles concretos que contó, sin repetir todo su mensaje ni citarlo entre comillas.
- No inventes datos, diagnósticos, relaciones, pronósticos ni sentimientos que la persona no haya expresado. Puedes decir "imagino que puede ser..." cuando sea una posibilidad, no una certeza.
- Evita aperturas prefabricadas como "Gracias por abrir tu corazón", "Lamento profundamente lo que estás atravesando respecto a lo que me compartes" o "Entiendo que estás pasando por un momento difícil".
- No uses frases grandilocuentes ni repitas palabras como fuerza, ánimo, consuelo en cada párrafo. Habla con sencillez y autenticidad.
- Normalmente bastan 2 a 3 párrafos breves; adapta la extensión a la situación.

ACOMPAÑAMIENTO CRISTIANO:
- Escoge un pasaje bíblico pertinente a lo que la persona contó, en Reina-Valera 1960. Elige uno que realmente acompañe su situación, no un versículo al azar.
- Explica brevemente y con sensibilidad qué puede significar ese pasaje en medio de lo que vive. No conviertas la respuesta en un sermón.
- Da uno o dos pasos prácticos, realistas y posibles para hoy. No prometas que Dios hará que una enfermedad desaparezca, que un problema se resolverá pronto ni que todo saldrá como la persona espera.
- La fe puede acompañar el tratamiento médico, la ayuda psicológica y el apoyo de personas de confianza; nunca los reemplaza.
- Habla de Jesús y de la esperanza del evangelio con naturalidad cuando sea pertinente.
- Puedes terminar con una pregunta breve y genuina si ayuda a continuar la conversación.

CUIDADO Y SEGURIDAD, PRIORIDAD MÁXIMA:
- Si la persona describe violencia, golpes, abuso, amenazas o peligro en casa, dile con calidez que su seguridad importa, que no tiene que afrontar esto sola y que busque un lugar seguro y apoyo de confianza o servicios de emergencia.
- Si expresa intención o riesgo de hacerse daño o suicidarse, responde de forma directa y compasiva. Anímale a no quedarse sola, contactar ahora a alguien de confianza y acudir a emergencias.
- Nunca culpes a la persona ni presentes la oración como sustituto de ayuda profesional o urgente.

Devuelve únicamente JSON válido con estas tres propiedades exactas:
{
  "reference": "Cita bíblica",
  "verse": "Texto del versículo en Reina-Valera 1960",
  "textoUnico": "Respuesta de acompañamiento personalizada"
}`;

function parseAndValidate(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonCandidate = (firstBrace !== -1 && lastBrace !== -1)
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;

  const parsed = JSON.parse(jsonCandidate);
  const reference = typeof parsed.reference === "string" ? parsed.reference.trim() : "";
  const verse = typeof parsed.verse === "string" ? parsed.verse.trim() : "";
  const textoUnico = typeof parsed.textoUnico === "string" ? parsed.textoUnico.trim() : "";
  if (reference && verse && textoUnico.length >= 20) {
    return { reference, verse, textoUnico };
  }
  return null;
}

// Permite configurar 1 o varias claves por proveedor (separadas por coma o con _1, _2, _3) y las rota aleatoriamente
function obtenerListaClaves(prefijoEnv) {
  const brutas = [
    process.env[prefijoEnv],
    process.env[`${prefijoEnv}_1`],
    process.env[`${prefijoEnv}_2`],
    process.env[`${prefijoEnv}_3`],
    process.env[`${prefijoEnv}_4`],
    process.env[`${prefijoEnv}_5`]
  ].filter(Boolean).join(",");

  const unicas = [...new Set(brutas.split(",").map(k => k.trim()).filter(Boolean))];
  for (let i = unicas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unicas[i], unicas[j]] = [unicas[j], unicas[i]];
  }
  return unicas;
}

function esperarMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Descubre automáticamente los modelos activos en la cuenta de Google si los nombres cambian
async function descubrirModelosDisponibles(apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal }
    );
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .filter(m =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent") &&
        typeof m.name === "string" &&
        m.name.includes("gemini") &&
        !m.name.includes("embedding") &&
        !m.name.includes("vision") &&
        !m.name.includes("imagen")
      )
      .map(m => m.name.replace(/^models\//, ""))
      // Priorizar modelos flash y lite por velocidad
      .sort((a, b) => {
        const score = (name) => (name.includes("lite") ? 0 : name.includes("flash") ? 1 : 2);
        return score(a) - score(b);
      })
      .slice(0, 4);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// MOTOR 1: GROQ (Ultrarrápido ~1 segundo)
async function callGroq(apiKey, modelName, mensaje, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: mensaje }
        ],
        temperature: 0.75,
        max_tokens: 900,
        response_format: { type: "json_object" }
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Groq ${modelName} (${response.status}): ${payload?.error?.message || "Error"}`);
    }
    const raw = payload?.choices?.[0]?.message?.content || "";
    return parseAndValidate(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}

// MOTOR 2: GOOGLE GEMINI (Usa exactamente gemini-3.5-flash-lite y gemini-3.8-flash con reintento rápido ante 503)
async function callGemini(modelName, apiKey, mensaje, timeoutMs = 7500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: mensaje }] }],
          generationConfig: {
            temperature: 0.75,
            responseMimeType: "application/json",
            maxOutputTokens: 850
          }
        })
      }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(`Gemini ${modelName} (${response.status}): ${payload?.error?.message || "Error"}`);
      err.status = response.status;
      throw err;
    }
    const raw = payload?.candidates?.[0]?.content?.parts
      ?.map(part => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    return parseAndValidate(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}

// MOTOR 3 (TERCER RESPALDO): OPENROUTER / MISTRAL / OPENAI
async function callThirdBackupAI(url, apiKey, modelName, mensaje, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };
    if (url.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "https://unespacioparatufe.netlify.app";
      headers["X-Title"] = "Un Espacio Para Tu Fe";
    }
    const bodyObj = {
      model: modelName,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: mensaje }
      ],
      temperature: 0.75,
      max_tokens: 900
    };
    if (!url.includes("openrouter.ai")) {
      bodyObj.response_format = { type: "json_object" };
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(bodyObj)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`BackupAI ${modelName} (${response.status}): ${payload?.error?.message || "Error"}`);
    }
    const raw = payload?.choices?.[0]?.message?.content || "";
    return parseAndValidate(raw);
  } finally {
    clearTimeout(timeoutId);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Método no permitido." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "La solicitud no contiene un JSON válido." });
  }

  const mensaje = typeof body.mensaje === "string" ? body.mensaje.trim() : "";
  if (!mensaje) return jsonResponse(400, { error: "Cuéntanos lo que estás viviendo." });
  if (mensaje.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(413, { error: "Tu mensaje es demasiado largo. Intenta resumirlo." });
  }

  // Además de leer variables separadas, detecta automáticamente si pegaste una clave gsk_ (Groq) o sk-or- (OpenRouter) dentro de GEMINI_API_KEY
  const todasLasClavesBrutas = [
    ...obtenerListaClaves("GROQ_API_KEY"),
    ...obtenerListaClaves("GEMINI_API_KEY"),
    ...obtenerListaClaves("OPENROUTER_API_KEY")
  ];

  const groqKeys = [
    ...obtenerListaClaves("GROQ_API_KEY"),
    ...todasLasClavesBrutas.filter(k => k.startsWith("gsk_"))
  ];
  const openRouterKeys = [
    ...obtenerListaClaves("OPENROUTER_API_KEY"),
    ...todasLasClavesBrutas.filter(k => k.startsWith("sk-or-"))
  ];
  const geminiKeys = obtenerListaClaves("GEMINI_API_KEY").filter(
    k => !k.startsWith("gsk_") && !k.startsWith("sk-or-")
  );
  const mistralKeys = obtenerListaClaves("MISTRAL_API_KEY");
  const openaiKeys = obtenerListaClaves("OPENAI_API_KEY");

  const totalClaves = groqKeys.length + geminiKeys.length + openRouterKeys.length + mistralKeys.length + openaiKeys.length;
  if (totalClaves === 0) {
    console.error("Falta configurar al menos una API Key en Netlify.");
    return jsonResponse(503, {
      error: "El servicio de orientación todavía no está configurado."
    });
  }

  const inicioMs = Date.now();

  // 1. PRIMERA OPCIÓN: GROQ (Responde en ~1 segundo sin picos 503)
  for (const modelName of GROQ_MODELS) {
    for (const gKey of [...new Set(groqKeys)]) {
      if (Date.now() - inicioMs > 20000) break;
      try {
        const result = await callGroq(gKey, modelName, mensaje, 6000);
        if (result) return jsonResponse(200, result);
      } catch (err) {
        console.error(`Fallo con Groq (${modelName}):`, err.message);
      }
    }
  }

  // 2. SEGUNDA OPCIÓN: GEMINI (Empezando por gemini-3.5-flash-lite y gemini-3.8-flash con reintento automático si hay pico 503)
  let huboAlMenosUn404 = false;
  for (let intento = 1; intento <= 2; intento++) {
    for (const modelName of ["gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
      for (const apiKey of geminiKeys) {
        if (Date.now() - inicioMs > 20000) break;
        try {
          const timeout = modelName.includes("lite") ? 6500 : 8000;
          const result = await callGemini(modelName, apiKey, mensaje, timeout);
          if (result) return jsonResponse(200, result);
        } catch (err) {
          if (err.status === 404) huboAlMenosUn404 = true;
          console.error(`Fallo con Gemini (${modelName}, intento ${intento}):`, err.message);
        }
      }
    }
    // Si ambos modelos tuvieron pico de demanda (503), espera 600ms y vuelve a intentar automáticamente sin obligar al usuario a apretar F5
    if (Date.now() - inicioMs < 15000) {
      await esperarMs(600);
    }
  }

  // Autodescubrimiento de modelos de Google en caso de que Google actualice los nombres en el futuro
  if (huboAlMenosUn404 && geminiKeys.length > 0 && Date.now() - inicioMs < 18000) {
    const modelosDescubiertos = await descubrirModelosDisponibles(geminiKeys[0]);
    for (const modDesc of modelosDescubiertos) {
      if (modDesc === "gemini-3.5-flash-lite" || modDesc === "gemini-3.8-flash") continue;
      if (Date.now() - inicioMs > 21000) break;
      try {
        const result = await callGemini(modDesc, geminiKeys[0], mensaje, 6000);
        if (result) return jsonResponse(200, result);
      } catch (err) {
        console.error(`Fallo con modelo autodescubierto (${modDesc}):`, err.message);
      }
    }
  }

  // 3. TERCERA OPCIÓN DE RESPALDO: OPENROUTER / MISTRAL / OPENAI
  for (const modelName of OPENROUTER_MODELS) {
    for (const orKey of [...new Set(openRouterKeys)]) {
      if (Date.now() - inicioMs > 23000) break;
      try {
        const result = await callThirdBackupAI("https://openrouter.ai/api/v1/chat/completions", orKey, modelName, mensaje, 6000);
        if (result) return jsonResponse(200, result);
      } catch (err) {
        console.error(`Fallo con OpenRouter (${modelName}):`, err.message);
      }
    }
  }

  for (const mKey of mistralKeys) {
    if (Date.now() - inicioMs > 23000) break;
    try {
      const result = await callThirdBackupAI("https://api.mistral.ai/v1/chat/completions", mKey, MISTRAL_MODEL, mensaje, 6000);
      if (result) return jsonResponse(200, result);
    } catch (err) {
      console.error("Fallo con Mistral:", err.message);
    }
  }

  for (const oaKey of openaiKeys) {
    if (Date.now() - inicioMs > 23000) break;
    try {
      const result = await callThirdBackupAI("https://api.openai.com/v1/chat/completions", oaKey, "gpt-4o-mini", mensaje, 6000);
      if (result) return jsonResponse(200, result);
    } catch (err) {
      console.error("Fallo con OpenAI:", err.message);
    }
  }

  return jsonResponse(502, {
    error: "No pudimos generar la respuesta en este momento. Por favor inténtalo nuevamente."
  });
};
