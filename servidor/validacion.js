/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/validacion.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de backend · seguridad
 * Qué hace: Valida todo lo que entra al sistema con lista blanca y rangos permitidos.
 */
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

    case 'estado': // reporte periódico de batería (%) y señal WiFi (dBm)
      if (!Number.isInteger(m.bateria) || m.bateria < 0 || m.bateria > 100) return fallo('bateria fuera de rango');
      if (!Number.isInteger(m.wifi) || m.wifi < -120 || m.wifi > 0) return fallo('wifi fuera de rango');
      return ok({ tipo: 'estado', bateria: m.bateria, wifi: m.wifi });

    case 'prueba_ok': // el dispositivo confirma que hizo sonar la alarma de prueba
      return ok({ tipo: 'prueba_ok' });

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

/* ---------- app del cliente ---------- */
const UMBRAL_MIN = 0.05; // más sensible no tiene sentido: el ruido normal de una casa daría falsas alarmas
const UMBRAL_MAX = 0.4; // menos sensible pondría en riesgo detectar un sismo fuerte
const texto = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,100}\.[a-z]{2,}$/i;

function validarRegistro(b) {
  if (!b || typeof b !== 'object') return fallo('Cuerpo inválido');
  if (!texto(b.nombre, 2, 60)) return fallo('Escribe tu nombre (entre 2 y 60 caracteres)');
  if (typeof b.correo !== 'string' || !CORREO.test(b.correo.trim())) return fallo('Escribe un correo válido');
  if (typeof b.clave !== 'string' || b.clave.length < 8 || b.clave.length > 200) return fallo('La contraseña debe tener al menos 8 caracteres');
  return ok({ nombre: b.nombre.trim(), correo: b.correo.trim().toLowerCase(), clave: b.clave });
}

function validarLoginCliente(b) {
  if (!b || typeof b !== 'object' || typeof b.correo !== 'string' || typeof b.clave !== 'string' || b.clave.length > 200) {
    return fallo('Usuario o contraseña incorrectos');
  }
  return ok({ id: b.correo.trim().toLowerCase().slice(0, 170), clave: b.clave });
}

/** Código impreso en la caja del dispositivo, por ejemplo VG-7K3P-9Q2M. */
function validarCodigo(b) {
  const c = typeof b?.codigo === 'string' ? b.codigo.trim().toUpperCase().replace(/\s+/g, '') : '';
  if (!/^VG-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)) return fallo('El código tiene la forma VG-XXXX-XXXX');
  return ok({ codigo: c });
}

function validarAjustes(b) {
  if (!b || typeof b !== 'object') return fallo('Cuerpo inválido');
  if (!texto(b.nombre, 2, 40)) return fallo('El nombre del dispositivo debe tener entre 2 y 40 caracteres');
  if (typeof b.direccion !== 'string' || b.direccion.trim().length > 120) return fallo('La dirección es demasiado larga');
  if (!esNumero(b.umbral) || b.umbral < UMBRAL_MIN || b.umbral > UMBRAL_MAX) return fallo(`La sensibilidad debe estar entre ${UMBRAL_MIN} y ${UMBRAL_MAX} g`);
  return ok({ nombre: b.nombre.trim(), direccion: b.direccion.trim(), umbral: Math.round(b.umbral * 100) / 100 });
}

function validarContacto(b) {
  if (!b || typeof b !== 'object') return fallo('Cuerpo inválido');
  if (!texto(b.nombre, 2, 60)) return fallo('Escribe el nombre del contacto');
  const tel = typeof b.telefono === 'string' ? b.telefono.trim() : '';
  if (!/^\+?[0-9 ]{7,16}$/.test(tel)) return fallo('Escribe un teléfono válido (solo números)');
  if (b.relacion !== undefined && (typeof b.relacion !== 'string' || b.relacion.trim().length > 30)) return fallo('La relación es demasiado larga');
  return ok({ nombre: b.nombre.trim(), telefono: tel, relacion: (b.relacion || '').trim() });
}

function validarRespuesta(b) {
  if (!b || !Number.isInteger(b.alertaId) || b.alertaId <= 0) return fallo('Alerta inválida');
  if (b.estado !== 'bien' && b.estado !== 'ayuda') return fallo('La respuesta debe ser «bien» o «ayuda»');
  return ok({ alertaId: b.alertaId, estado: b.estado });
}

module.exports = {
  validarMensajeDispositivo, validarSimulacion, validarLogin, LIMITE_G,
  validarRegistro, validarLoginCliente, validarCodigo, validarAjustes, validarContacto, validarRespuesta, UMBRAL_MIN, UMBRAL_MAX,
};
