const crypto = require("crypto");

const DEFAULT_VAPID_PUBLIC = "BI8n4OC4xauSq1r6fMuZ4ImHZ_m9l4jvEMDKoopVKNrSkCXOP0eI0YLyMdm5uei2TE39uFkUJInJMhGelSw0I_k";
const DEFAULT_VAPID_PRIVATE = "4AjSyOXL2U8cmrnY--lrK3L7TV_7wUWFXNiQQB2E6to";
const DEFAULT_VAPID_SUBJECT = "mailto:vicentealvarez1134@gmail.com";
const FIREBASE_PROJECT_ID = "un-espacio-para-tu-fe";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(str) {
  const norm = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  return Buffer.from(norm + pad, "base64");
}

function buildVapidJwt(endpoint, subject, publicKeyB64, privateKeyB64) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const headerB64 = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payloadB64 = base64UrlEncode(JSON.stringify({ aud: audience, exp, sub: subject }));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pubRaw = base64UrlDecode(publicKeyB64); // 65 bytes uncompressed (0x04 || x || y)
  const privRaw = base64UrlDecode(privateKeyB64); // 32 bytes d

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(pubRaw.subarray(1, 33)),
    y: base64UrlEncode(pubRaw.subarray(33, 65)),
    d: base64UrlEncode(privRaw)
  };

  const privateKeyObj = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(unsignedToken), {
    key: privateKeyObj,
    dsaEncoding: "ieee-p1363"
  });

  return `${unsignedToken}.${base64UrlEncode(sig)}`;
}

function hkdfExtractAndExpand(salt, ikm, info, length) {
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  const okm = crypto.createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
  return okm.subarray(0, length);
}

// RFC 8291 Web Push Message Encryption (aes128gcm)
function encryptWebPushPayload(payloadString, uaPublicB64, authSecretB64) {
  const uaPublic = base64UrlDecode(uaPublicB64);
  const authSecret = base64UrlDecode(authSecretB64);

  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65 bytes
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic
  ]);
  const ikm = hkdfExtractAndExpand(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.randomBytes(16);
  const cek = hkdfExtractAndExpand(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdfExtractAndExpand(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  const plaintext = Buffer.concat([Buffer.from(payloadString, "utf8"), Buffer.from([2])]); // 0x02 = final record delimiter
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idlenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idlenBuf, asPublic, ciphertext]);
}

async function obtenerSuscripcionesDesdeFirestore() {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/push_subscriptions?pageSize=100`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => ({}));
  const docs = Array.isArray(data.documents) ? data.documents : [];
  return docs
    .map(doc => {
      const fields = doc.fields || {};
      const subJsonStr = fields.subscriptionJson?.stringValue || "";
      try {
        const sub = JSON.parse(subJsonStr);
        if (sub && sub.endpoint && sub.keys?.p256dh && sub.keys?.auth) {
          return { docName: doc.name, sub };
        }
      } catch {}
      return null;
    })
    .filter(Boolean);
}

async function eliminarSuscripcionObsoleta(docName) {
  if (!docName) return;
  try {
    await fetch(`https://firestore.googleapis.com/v1/${docName}`, { method: "DELETE" });
  } catch {}
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const vapidPublic = (process.env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC).trim();
  const vapidPrivate = (process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE).trim();
  const vapidSubject = (process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT).trim();

  const titulo = String(body.title || "Un nuevo mensaje").slice(0, 120);
  const cuerpo = String(body.body || "Tienes un nuevo mensaje en Encuentro.").slice(0, 220);
  const chatId = String(body.chatId || "");

  const pushPayload = JSON.stringify({
    title: titulo,
    body: cuerpo,
    chatId,
    url: chatId ? `/chat-admin.html?chat=${encodeURIComponent(chatId)}` : "/chat-admin.html"
  });

  try {
    const suscripciones = await obtenerSuscripcionesDesdeFirestore();
    if (suscripciones.length === 0) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, enviados: 0 }) };
    }

    let enviados = 0;
    await Promise.all(
      suscripciones.map(async ({ docName, sub }) => {
        try {
          const jwt = buildVapidJwt(sub.endpoint, vapidSubject, vapidPublic, vapidPrivate);
          const encryptedBody = encryptWebPushPayload(pushPayload, sub.keys.p256dh, sub.keys.auth);

          const pushResp = await fetch(sub.endpoint, {
            method: "POST",
            headers: {
              "TTL": "86400",
              "Urgency": "high",
              "Content-Encoding": "aes128gcm",
              "Content-Type": "application/octet-stream",
              "Authorization": `vapid t=${jwt}, k=${vapidPublic}`
            },
            body: encryptedBody
          });

          if (pushResp.status === 201 || pushResp.status === 200) {
            enviados++;
          } else if (pushResp.status === 404 || pushResp.status === 410) {
            await eliminarSuscripcionObsoleta(docName);
          }
        } catch (err) {
          console.error("Error enviando Push individual:", err.message);
        }
      })
    );

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, enviados })
    };
  } catch (err) {
    console.error("Error general push-notify:", err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
