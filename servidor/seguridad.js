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

/*
 * Contraseñas de los usuarios del panel: scrypt con sal aleatoria. scrypt es lento a propósito,
 * para que adivinar contraseñas por fuerza bruta sea muy costoso aunque se robe la base de datos.
 */
const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(clave), sal, 64, SCRYPT);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function verificarClave(clave, guardado) {
  const [tipo, salHex, hashHex] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(String(clave), Buffer.from(salHex, 'hex'), esperado.length, SCRYPT);
  return crypto.timingSafeEqual(esperado, calculado);
}

/** Token aleatorio para sesiones (256 bits). */
const generarToken = () => crypto.randomBytes(32).toString('base64url');

module.exports = { hashToken, verificarToken, hashClave, verificarClave, generarToken };
