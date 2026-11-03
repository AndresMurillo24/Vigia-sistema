'use strict';

const { hashClave, verificarClave, generarToken, hashToken } = require('./seguridad');
const { validarLogin } = require('./validacion');

const COOKIE = 'vigia_sesion';
// Hash de relleno: si el usuario no existe se verifica igual, para que el tiempo de respuesta
// no revele qué usuarios existen.
const HASH_RELLENO = hashClave('relleno-para-igualar-tiempos');

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Inicio de sesión del panel con sesiones en el servidor:
 *  - la cookie es HttpOnly (JavaScript no la puede leer) y SameSite=Strict (frena CSRF);
 *  - en la base de datos solo se guarda el hash del token de sesión;
 *  - tras varios intentos fallidos desde la misma IP se bloquea temporalmente.
 */
function crearAutenticacion({ db, config, log = console.log, ahora = Date.now }) {
  const intentos = new Map(); // ip -> { fallos, bloqueadoHasta }

  function usuarioDeRequest(req) {
    const token = leerCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const usuario = db.buscarSesion(hashToken(token), ahora());
    return usuario ? { ...usuario, tokenHash: hashToken(token) } : null;
  }

  function cookie(req, valor, maxAgeSeg) {
    const segura = config.COOKIE_SEGURA || req.secure ? '; Secure' : '';
    return `${COOKIE}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeg}${segura}`;
  }

  function login(req, res) {
    const ip = req.ip || req.socket.remoteAddress;
    const registro = intentos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
    if (registro.bloqueadoHasta > ahora()) {
      const minutos = Math.ceil((registro.bloqueadoHasta - ahora()) / 60_000);
      return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.` });
    }

    const v = validarLogin(req.body);
    const u = v.ok ? db.buscarUsuario(v.datos.usuario) : null;
    const correcto = verificarClave(v.ok ? v.datos.clave : '', u ? u.clave_hash : HASH_RELLENO) && !!u;

    if (!correcto) {
      registro.fallos++;
      if (registro.fallos >= config.INTENTOS_MAXIMOS) {
        registro.bloqueadoHasta = ahora() + config.BLOQUEO_MS;
        registro.fallos = 0;
        log(`[SEGURIDAD] IP ${ip} bloqueada por ${config.INTENTOS_MAXIMOS} intentos fallidos`);
      }
      intentos.set(ip, registro);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    intentos.delete(ip);
    const token = generarToken();
    db.crearSesion(hashToken(token), u.id, ahora() + config.DURACION_SESION_MS);
    res.set('Set-Cookie', cookie(req, token, Math.floor(config.DURACION_SESION_MS / 1000)));
    log(`[SESIÓN] ${u.usuario} (${u.rol}) inició sesión`);
    res.json({ usuario: { usuario: u.usuario, nombre: u.nombre, rol: u.rol } });
  }

  function logout(req, res) {
    const u = usuarioDeRequest(req);
    if (u) db.borrarSesion(u.tokenHash);
    res.set('Set-Cookie', cookie(req, '', 0));
    res.json({ ok: true });
    return u;
  }

  /** Middleware: exige sesión y, si se indica, un rol. */
  const requerir = (rol) => (req, res, next) => {
    const u = usuarioDeRequest(req);
    if (!u) return res.status(401).json({ error: 'Debes iniciar sesión' });
    if (rol && u.rol !== rol) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    req.usuario = u;
    next();
  };

  return { login, logout, requerir, usuarioDeRequest };
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

module.exports = { crearAutenticacion, asegurarAdministrador, COOKIE };
