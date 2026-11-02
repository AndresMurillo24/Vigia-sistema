'use strict';

const crypto = require('node:crypto');

/** Los tokens de los dispositivos nunca se guardan en texto plano: solo su hash SHA-256. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Compara en tiempo constante para no filtrar información por tiempos de respuesta. */
function verificarToken(token, hashGuardado) {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(String(hashGuardado || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashToken, verificarToken };
