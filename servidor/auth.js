'use strict';

const { hashClave, verificarClave, generarToken, hashToken } = require('./seguridad');
const { validarLogin } = require('./validacion');

// Hash de relleno: si la cuenta no existe se verifica igual, para que el tiempo de respuesta
// no revele qué cuentas existen.
const HASH_RELLENO = hashClave('relleno-para-igualar-tiempos');

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Inicio de sesión con sesiones en el servidor. Se usa dos veces: para el panel de la empresa
 * (usuarios admin/operador) y para la app de los clientes (cuentas de hogar).
 *  - la cookie es HttpOnly (JavaScript no la puede leer) y SameSite=Strict (frena CSRF);
 *  - en la base de datos solo se guarda el hash del token de sesión;
 *  - tras varios intentos fallidos desde la misma IP se bloquea temporalmente.
 *
 * @param {object} o
 * @param {string} o.cookie      nombre de la cookie de sesión
 * @param {string} o.campo       nombre de la cuenta en la respuesta JSON ('usuario' o 'cliente')
 * @param {object} o.almacen     { buscar(id), crearSesion(hash, cuentaId, expira), buscarSesion(hash, ahora), borrarSesion(hash) }
 * @param {Function} o.validar   valida el cuerpo y devuelve { ok, datos: { id, clave } }
 * @param {Function} o.publico   datos de la cuenta que se pueden enviar al navegador
 */
function crearAutenticacion({ config, log = console.log, ahora = Date.now, cookie, campo, almacen, validar, publico }) {
  const intentos = new Map(); // ip -> { fallos, bloqueadoHasta }

  function cuentaDeRequest(req) {
    const token = leerCookie(req, cookie);
    if (!token || token.length > 100) return null;
    const cuenta = almacen.buscarSesion(hashToken(token), ahora());
    return cuenta ? { ...cuenta, tokenHash: hashToken(token) } : null;
  }

  function encabezadoCookie(req, valor, maxAgeSeg) {
    const segura = config.COOKIE_SEGURA || req.secure ? '; Secure' : '';
    return `${cookie}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeg}${segura}`;
  }

  /** Abre una sesión para una cuenta ya verificada (login o registro). */
  function abrirSesion(req, res, cuenta) {
    const token = generarToken();
    almacen.crearSesion(hashToken(token), cuenta.id, ahora() + config.DURACION_SESION_MS);
    res.set('Set-Cookie', encabezadoCookie(req, token, Math.floor(config.DURACION_SESION_MS / 1000)));
  }

  function login(req, res) {
    const ip = req.ip || req.socket.remoteAddress;
    const registro = intentos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
    if (registro.bloqueadoHasta > ahora()) {
      const minutos = Math.ceil((registro.bloqueadoHasta - ahora()) / 60_000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.` });
    }

    const v = validar(req.body);
    const cuenta = v.ok ? almacen.buscar(v.datos.id) : null;
    const correcto = verificarClave(v.ok ? v.datos.clave : '', cuenta ? cuenta.clave_hash : HASH_RELLENO) && !!cuenta;

    if (!correcto) {
      registro.fallos++;
      if (registro.fallos >= config.INTENTOS_MAXIMOS) {
        registro.bloqueadoHasta = ahora() + config.BLOQUEO_MS;
        registro.fallos = 0;
        log(`[SEGURIDAD] IP ${ip} bloqueada por ${config.INTENTOS_MAXIMOS} intentos fallidos (${campo})`);
      }
      intentos.set(ip, registro);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    intentos.delete(ip);
    abrirSesion(req, res, cuenta);
    log(`[SESIÓN] ${v.datos.id} inició sesión (${campo})`);
    res.json({ [campo]: publico(cuenta) });
  }

  function logout(req, res) {
    const cuenta = cuentaDeRequest(req);
    if (cuenta) almacen.borrarSesion(cuenta.tokenHash);
    res.set('Set-Cookie', encabezadoCookie(req, '', 0));
    res.json({ ok: true });
    return cuenta;
  }

  /** Middleware: exige sesión y, si se indica, un rol. Deja la cuenta en req.cuenta. */
  const requerir = (rol) => (req, res, next) => {
    const cuenta = cuentaDeRequest(req);
    if (!cuenta) return res.status(401).json({ error: 'Debes iniciar sesión' });
    if (rol && cuenta.rol !== rol) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    req.cuenta = cuenta;
    next();
  };

  return { login, logout, requerir, abrirSesion, cuentaDeRequest };
}

/** Autenticación del panel de la empresa (usuarios admin y operador). */
function autenticacionPanel({ db, config, log, ahora }) {
  return crearAutenticacion({
    config, log, ahora,
    cookie: 'vigia_sesion',
    campo: 'usuario',
    almacen: { buscar: db.buscarUsuario, crearSesion: db.crearSesion, buscarSesion: db.buscarSesion, borrarSesion: db.borrarSesion },
    validar: (b) => { const v = validarLogin(b); return v.ok ? { ok: true, datos: { id: v.datos.usuario, clave: v.datos.clave } } : v; },
    publico: (u) => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol }),
  });
}

/** Crea el administrador inicial la primera vez que se ejecuta el sistema. */
function asegurarAdministrador(db, log = console.log) {
  if (db.contarUsuarios() > 0) return null;
  const clave = process.env.ADMIN_CLAVE || generarToken().slice(0, 14);
  db.guardarUsuario({ usuario: 'admin', nombre: 'Administrador', rol: 'admin', clave_hash: hashClave(clave) });
  log('');
  log('  Se creó el usuario administrador del panel:');
  log('    usuario:    admin');
  log(`    contraseña: ${process.env.ADMIN_CLAVE ? '(la definida en ADMIN_CLAVE)' : clave}`);
  log('  Guárdala. Para cambiarla o crear más usuarios: npm run usuario');
  log('');
  return clave;
}

module.exports = { crearAutenticacion, autenticacionPanel, asegurarAdministrador };
