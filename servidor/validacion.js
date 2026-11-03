'use strict';

// Ningún acelerómetro doméstico mide más de ±16 g: cualquier valor mayor es un error o un ataque.
const LIMITE_G = 16;
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const ok = (datos) => ({ ok: true, datos });
const fallo = (error) => ({ ok: false, error });

/**
 * Valida un mensaje recibido de un dispositivo y devuelve solo los campos permitidos
 * (lista blanca), descartando cualquier dato extra.
 */
function validarMensajeDispositivo(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fallo('El mensaje debe ser un objeto JSON');

  switch (m.tipo) {
    case 'hola':
      if (typeof m.id !== 'string' || !/^[a-z0-9-]{3,40}$/.test(m.id)) return fallo('id inválido');
      if (typeof m.token !== 'string' || m.token.length < 16 || m.token.length > 128) return fallo('token inválido');
      return ok({ tipo: 'hola', id: m.id, token: m.token });

    case 'lectura':
      for (const eje of ['x', 'y', 'z']) {
        if (!esNumero(m[eje]) || Math.abs(m[eje]) > LIMITE_G) return fallo(`Valor del eje ${eje} fuera de rango`);
      }
      return ok({ tipo: 'lectura', x: m.x, y: m.y, z: m.z });

    case 'evento':
      if (!esNumero(m.pga) || m.pga <= 0 || m.pga > LIMITE_G) return fallo('pga fuera de rango');
      return ok({ tipo: 'evento', pga: m.pga });

    default:
      return fallo('Tipo de mensaje desconocido');
  }
}

/** Valida la orden de simulación que envía el panel. */
function validarSimulacion(b) {
  if (!b || typeof b !== 'object') return fallo('Cuerpo inválido');
  const { lat, lon, magnitud } = b;
  if (!esNumero(lat) || lat < -5 || lat > 14) return fallo('Latitud fuera de Colombia');
  if (!esNumero(lon) || lon < -80 || lon > -66) return fallo('Longitud fuera de Colombia');
  if (!esNumero(magnitud) || magnitud < 3 || magnitud > 9) return fallo('La magnitud debe estar entre 3 y 9');
  return ok({ lat, lon, magnitud });
}

/** Valida el formulario de inicio de sesión. */
function validarLogin(b) {
  if (!b || typeof b !== 'object') return fallo('Cuerpo inválido');
  const { usuario, clave } = b;
  if (typeof usuario !== 'string' || !/^[a-z0-9._-]{3,40}$/i.test(usuario)) return fallo('Usuario o contraseña incorrectos');
  if (typeof clave !== 'string' || clave.length < 1 || clave.length > 200) return fallo('Usuario o contraseña incorrectos');
  return ok({ usuario: usuario.toLowerCase(), clave });
}

module.exports = { validarMensajeDispositivo, validarSimulacion, validarLogin, LIMITE_G };
