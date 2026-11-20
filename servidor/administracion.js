/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/administracion.js
 * Tipo:     JavaScript (Node.js · Express)
 * Capa:     Capa de backend
 * Qué hace: Administración del panel: usuarios y roles, cambio de contraseña, bitácora de
 *           auditoría, estadísticas de la red, comunicados y simulacros para los clientes, y
 *           prueba remota de los dispositivos.
 */
'use strict';

const { hashClave, verificarClave } = require('./seguridad');
const v = require('./validacion');

const POR_PAGINA = 30;
const DIAS_ESTADISTICAS = 14;
const BATERIA_BAJA = 20;

/** Nombres legibles de cada acción de la bitácora (se usan en el panel y en la exportación). */
const ACCIONES = {
  login: 'Inicio de sesión', login_fallido: 'Intento fallido', bloqueo: 'Bloqueo por intentos', logout: 'Cierre de sesión',
  simulacion: 'Simulación de sismo', desvincular: 'Desvinculación', atender_ayuda: 'Solicitud atendida',
  usuario_creado: 'Usuario creado', usuario_modificado: 'Usuario modificado', usuario_eliminado: 'Usuario eliminado',
  cambio_clave: 'Cambio de contraseña', comunicado: 'Comunicado enviado', prueba_remota: 'Prueba remota',
};

function montarAdministracion({ app, db, auth, estado, portal, log, auditar, enviarADispositivo, cerrarSesionesPanel }) {
  const usuarioPublico = (u) => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, creado: u.creado, ultimoAcceso: u.ultimo_acceso });

  /* ---------- mi cuenta: cambiar la propia contraseña ---------- */
  app.post('/api/cuenta/clave', auth.requerir(), (req, res) => {
    const r = v.validarCambioClave(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const u = db.buscarUsuario(req.cuenta.usuario);
    if (!u || !verificarClave(r.datos.actual, u.clave_hash)) return res.status(403).json({ error: 'La contraseña actual no es correcta' });
    db.actualizarUsuario(u.usuario, { nombre: u.nombre, rol: u.rol, clave_hash: hashClave(r.datos.nueva) });
    // Las demás sesiones abiertas con la contraseña anterior se cierran; la actual sigue.
    db.borrarOtrasSesiones(u.id, req.cuenta.tokenHash);
    auditar(req, 'cambio_clave', 'Cambió su propia contraseña');
    res.json({ ok: true });
  });

  /* ---------- usuarios del panel (solo administradores) ---------- */
  app.get('/api/usuarios', auth.requerir('admin'), (req, res) => {
    res.json({ usuarios: db.listarUsuarios().map(usuarioPublico) });
  });

  app.post('/api/usuarios', auth.requerir('admin'), (req, res) => {
    const r = v.validarUsuarioNuevo(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if (db.buscarUsuario(r.datos.usuario)) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    db.guardarUsuario({ usuario: r.datos.usuario, nombre: r.datos.nombre, rol: r.datos.rol, clave_hash: hashClave(r.datos.clave) });
    auditar(req, 'usuario_creado', `${r.datos.usuario} (${r.datos.rol})`);
    log(`[USUARIOS] ${req.cuenta.usuario} creó a ${r.datos.usuario} (${r.datos.rol})`);
    res.status(201).json({ usuario: usuarioPublico(db.buscarUsuario(r.datos.usuario)) });
  });

  app.patch('/api/usuarios/:usuario', auth.requerir('admin'), (req, res) => {
    const u = db.buscarUsuario(String(req.params.usuario).toLowerCase());
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    const r = v.validarCambioUsuario(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    // Siempre debe quedar al menos un administrador, y nadie se quita a sí mismo el rol.
    if (r.datos.rol === 'operador' && u.rol === 'admin') {
      if (u.usuario === req.cuenta.usuario) return res.status(409).json({ error: 'No puedes quitarte a ti mismo el rol de administrador' });
      if (db.contarAdmins() <= 1) return res.status(409).json({ error: 'Debe quedar al menos un administrador' });
    }
    db.actualizarUsuario(u.usuario, {
      nombre: r.datos.nombre ?? u.nombre,
      rol: r.datos.rol ?? u.rol,
      clave_hash: r.datos.clave ? hashClave(r.datos.clave) : u.clave_hash,
    });
    // Si un administrador restablece la contraseña de otro usuario, sus sesiones se cierran.
    if (r.datos.clave && u.usuario !== req.cuenta.usuario) { db.borrarSesionesUsuario(u.id); cerrarSesionesPanel(u.id); }
    const cambios = [r.datos.nombre && 'nombre', r.datos.rol && `rol → ${r.datos.rol}`, r.datos.clave && 'contraseña'].filter(Boolean).join(', ');
    auditar(req, 'usuario_modificado', `${u.usuario}: ${cambios}`);
    res.json({ usuario: usuarioPublico(db.buscarUsuario(u.usuario)) });
  });

  app.delete('/api/usuarios/:usuario', auth.requerir('admin'), (req, res) => {
    const u = db.buscarUsuario(String(req.params.usuario).toLowerCase());
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (u.usuario === req.cuenta.usuario) return res.status(409).json({ error: 'No puedes eliminar tu propio usuario' });
    if (u.rol === 'admin' && db.contarAdmins() <= 1) return res.status(409).json({ error: 'Debe quedar al menos un administrador' });
    db.borrarUsuario(u.usuario); // sus sesiones se borran en cascada
    cerrarSesionesPanel(u.id);
    auditar(req, 'usuario_eliminado', u.usuario);
    res.json({ ok: true });
  });

  /* ---------- bitácora de auditoría (solo administradores) ---------- */
  app.get('/api/auditoria', auth.requerir('admin'), (req, res) => {
    const r = v.validarFiltroAuditoria(req.query);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const { total, items } = db.auditoria(r.datos.filtros, POR_PAGINA, (r.datos.pagina - 1) * POR_PAGINA);
    res.json({ total, pagina: r.datos.pagina, porPagina: POR_PAGINA, items, acciones: ACCIONES });
  });

  /* ---------- estadísticas de la red ---------- */
  app.get('/api/estadisticas', auth.requerir(), (req, res) => {
    const hoy = new Date(Date.now() - 5 * 3_600_000); // fecha de Colombia (UTC−5)
    const dias = [];
    for (let i = DIAS_ESTADISTICAS - 1; i >= 0; i--) dias.push(new Date(hoy.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    const desde = new Date(`${dias[0]}T00:00:00-05:00`).toISOString();
    const s = db.estadisticas(desde);
    const porDia = new Map(s.eventosPorDia.map((d) => [d.dia, d]));
    const alertasDia = new Map(s.alertasPorDia.map((d) => [d.dia, d.n]));
    const todos = [...estado.values()];
    res.json({
      dias: dias.map((dia) => ({ dia, eventos: porDia.get(dia)?.n || 0, pgaMax: porDia.get(dia)?.max || 0, alertas: alertasDia.get(dia) || 0 })),
      ciudades: s.eventosPorCiudad,
      distribucion: s.distribucion,
      totales: s.totales,
      red: {
        total: todos.length,
        enLinea: todos.filter((e) => e.enLinea).length,
        vinculados: todos.filter((e) => e.d.cliente_id).length,
        bateriaBaja: todos.filter((e) => e.bateria != null && e.bateria < BATERIA_BAJA).map((e) => ({ id: e.d.id, nombre: e.d.nombre, bateria: e.bateria })),
        desconectados: todos.filter((e) => !e.enLinea).map((e) => ({ id: e.d.id, nombre: e.d.nombre, ciudad: e.d.ciudad, ultimaConexion: e.d.ultima_conexion })),
      },
    });
  });

  /* ---------- comunicados y simulacros para los clientes ---------- */
  app.get('/api/comunicados', auth.requerir(), (req, res) => {
    res.json({ comunicados: db.listarComunicados(30), clientes: db.clientesDestino(null).length });
  });

  app.post('/api/comunicados', auth.requerir('admin'), (req, res) => {
    const r = v.validarComunicado(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    if (r.datos.ciudad && !db.ciudades().includes(r.datos.ciudad)) return res.status(400).json({ error: 'Ciudad inválida' });
    const id = db.guardarComunicado({ ...r.datos, autor: req.cuenta.usuario });
    const comunicado = db.obtenerComunicado(id);
    const destino = db.clientesDestino(r.datos.ciudad);
    portal.alComunicado(comunicado, destino);
    auditar(req, 'comunicado', `${r.datos.tipo}: «${r.datos.titulo}» → ${r.datos.ciudad || 'todos'} (${destino.length} hogares)`);
    log(`[COMUNICADO] ${req.cuenta.usuario} envió «${r.datos.titulo}» (${r.datos.tipo}) a ${destino.length} hogares`);
    res.status(201).json({ comunicado: { ...comunicado, leidos: 0 }, destinatarios: destino.length });
  });

  /* ---------- prueba remota de un dispositivo (diagnóstico) ---------- */
  app.post('/api/dispositivos/:id/prueba', auth.requerir(), (req, res) => {
    const e = estado.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (!e.enLinea) return res.status(409).json({ error: 'El dispositivo no está conectado' });
    enviarADispositivo(e.d.id, { tipo: 'prueba' });
    auditar(req, 'prueba_remota', e.d.nombre);
    res.status(202).json({ ok: true });
  });
}

module.exports = { montarAdministracion, ACCIONES };
