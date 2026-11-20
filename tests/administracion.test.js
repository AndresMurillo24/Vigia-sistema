/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/administracion.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas de la administración del panel: usuarios y roles, cambio de contraseña,
 *           bitácora de auditoría, estadísticas, comunicados a los clientes y prueba remota.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayuda');

const get = (p, ruta, cookie) => fetch(`${p.http}${ruta}`, { headers: { Cookie: cookie } });
const json = async (r) => (await r).json();

async function provocarAlerta(p) {
  const a = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const b = await h.conectarDispositivo(p, 'casa-b', h.TOKEN_B);
  const alerta = h.esperar(a.ws, 'alerta');
  a.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.32 }));
  b.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.18 }));
  await alerta;
  return [a.ws, b.ws];
}

test('usuarios: solo el admin los gestiona y la contraseña nueva debe ser segura', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const admin = await h.iniciarSesion(p, 'ana');
  const operador = await h.iniciarSesion(p, 'oscar');
  assert.equal((await get(p, '/api/usuarios', operador.cookie)).status, 403);
  assert.equal((await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'daniel', nombre: 'Daniel Márquez', rol: 'operador', clave: 'Segura2026' }, operador.cookie)).status, 403);

  assert.equal((await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'daniel', nombre: 'Daniel Márquez', rol: 'operador', clave: 'corta' }, admin.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'daniel', nombre: 'Daniel Márquez', rol: 'operador', clave: 'sololetras' }, admin.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'daniel', nombre: 'Daniel Márquez', rol: 'jefe', clave: 'Segura2026' }, admin.cookie)).status, 400);
  const creado = await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'Daniel', nombre: 'Daniel Márquez', rol: 'operador', clave: 'Segura2026' }, admin.cookie);
  assert.equal(creado.status, 201);
  assert.equal((await creado.json()).usuario.usuario, 'daniel');
  assert.equal((await h.pedir(`${p.http}/api/usuarios`, 'POST', { usuario: 'daniel', nombre: 'Otro', rol: 'admin', clave: 'Segura2026' }, admin.cookie)).status, 409);

  const daniel = await h.iniciarSesion(p, 'daniel', 'Segura2026');
  assert.equal(daniel.r.status, 200);
  const lista = await json(get(p, '/api/usuarios', admin.cookie));
  assert.ok(lista.usuarios.find((u) => u.usuario === 'daniel').ultimoAcceso, 'registra el último acceso');
  assert.ok(lista.usuarios.every((u) => !('clave_hash' in u)), 'nunca envía el hash de la contraseña');

  // El admin restablece la contraseña de Daniel: su sesión abierta deja de servir.
  assert.equal((await h.pedir(`${p.http}/api/usuarios/daniel`, 'PATCH', { clave: 'NuevaClave99' }, admin.cookie)).status, 200);
  assert.equal((await get(p, '/api/sesion', daniel.cookie)).status, 401);
  assert.equal((await h.iniciarSesion(p, 'daniel', 'NuevaClave99')).r.status, 200);
  // Ascenso a administrador y eliminación.
  assert.equal((await json(h.pedir(`${p.http}/api/usuarios/daniel`, 'PATCH', { rol: 'admin' }, admin.cookie))).usuario.rol, 'admin');
  assert.equal((await h.pedir(`${p.http}/api/usuarios/daniel`, 'DELETE', undefined, admin.cookie)).status, 200);
  assert.equal((await h.iniciarSesion(p, 'daniel', 'NuevaClave99')).r.status, 401);
  assert.equal((await h.pedir(`${p.http}/api/usuarios/nadie`, 'DELETE', undefined, admin.cookie)).status, 404);
});

test('usuarios: siempre queda al menos un administrador y nadie se elimina a sí mismo', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const admin = await h.iniciarSesion(p, 'ana');
  assert.equal((await h.pedir(`${p.http}/api/usuarios/ana`, 'DELETE', undefined, admin.cookie)).status, 409);
  assert.equal((await h.pedir(`${p.http}/api/usuarios/ana`, 'PATCH', { rol: 'operador' }, admin.cookie)).status, 409);
  // Con un segundo admin, el primero puede bajar de rol al segundo, pero no al revés si queda solo uno.
  await h.pedir(`${p.http}/api/usuarios/oscar`, 'PATCH', { rol: 'admin' }, admin.cookie);
  assert.equal((await h.pedir(`${p.http}/api/usuarios/oscar`, 'PATCH', { rol: 'operador' }, admin.cookie)).status, 200);
  assert.equal((await h.pedir(`${p.http}/api/usuarios/oscar`, 'PATCH', {}, admin.cookie)).status, 400);
});

test('mi cuenta: cambiar la contraseña exige la actual y cierra las otras sesiones', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const aqui = await h.iniciarSesion(p, 'oscar');
  const otroPC = await h.iniciarSesion(p, 'oscar');
  assert.equal((await h.pedir(`${p.http}/api/cuenta/clave`, 'POST', { actual: 'equivocada', nueva: 'OtraClave2026' }, aqui.cookie)).status, 403);
  assert.equal((await h.pedir(`${p.http}/api/cuenta/clave`, 'POST', { actual: h.CLAVE, nueva: 'debil' }, aqui.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/cuenta/clave`, 'POST', { actual: h.CLAVE, nueva: 'OtraClave2026' }, aqui.cookie)).status, 200);
  assert.equal((await get(p, '/api/sesion', aqui.cookie)).status, 200, 'la sesión actual sigue abierta');
  assert.equal((await get(p, '/api/sesion', otroPC.cookie)).status, 401, 'las demás se cierran');
  assert.equal((await h.iniciarSesion(p, 'oscar')).r.status, 401);
  assert.equal((await h.iniciarSesion(p, 'oscar', 'OtraClave2026')).r.status, 200);
});

test('auditoría: registra ingresos, fallos y acciones; solo la ve el admin', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  await h.iniciarSesion(p, 'ana', 'equivocada');
  const admin = await h.iniciarSesion(p, 'ana');
  await h.pedir(`${p.http}/api/simulacion`, 'POST', { lat: 4.6, lon: -74.1, magnitud: 6 }, admin.cookie);
  const operador = await h.iniciarSesion(p, 'oscar');
  assert.equal((await get(p, '/api/auditoria', operador.cookie)).status, 403);

  const todo = await json(get(p, '/api/auditoria', admin.cookie));
  const acciones = todo.items.map((i) => i.accion);
  for (const a of ['login_fallido', 'login', 'simulacion']) assert.ok(acciones.includes(a), `falta ${a}`);
  assert.equal(todo.items[0].accion, 'login', 'lo más reciente primero (ingreso de oscar)');
  const sim = await json(get(p, '/api/auditoria?accion=simulacion', admin.cookie));
  assert.equal(sim.total, 1);
  assert.equal(sim.items[0].usuario, 'ana');
  assert.equal((await get(p, '/api/auditoria?accion=DROP%20TABLE', admin.cookie)).status, 400);
});

test('estadísticas: cuenta eventos por día y ciudad, alertas y estado de la red', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const sockets = await provocarAlerta(p);
  sockets[0].send(JSON.stringify({ tipo: 'estado', bateria: 12, wifi: -60 }));
  await new Promise((r) => setTimeout(r, 100));
  const { cookie } = await h.iniciarSesion(p, 'oscar');
  const e = await json(get(p, '/api/estadisticas', cookie));
  assert.equal(e.dias.length, 14);
  assert.equal(e.dias.at(-1).eventos, 2, 'hoy hubo 2 eventos');
  assert.equal(e.dias.at(-1).alertas, 1);
  assert.equal(e.totales.eventos, 2);
  assert.equal(e.totales.alertas, 1);
  assert.deepEqual(e.ciudades.map((c) => c.ciudad).sort(), ['Bogotá', 'Soacha']);
  assert.deepEqual(e.distribucion, { leve: 1, moderado: 0, fuerte: 1, severo: 0 });
  assert.equal(e.red.enLinea, 2);
  assert.deepEqual(e.red.bateriaBaja.map((d) => d.id), ['casa-a']);
  assert.equal((await fetch(`${p.http}/api/estadisticas`)).status, 401);
  sockets.forEach((ws) => ws.close());
});

test('comunicados: el admin avisa por ciudad y solo esos hogares lo reciben', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const bogota = await h.registrarCliente(p, 'bogota@ejemplo.co');
  const soacha = await h.registrarCliente(p, 'soacha@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, bogota.cookie);
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_B }, soacha.cookie);
  const appBogota = await h.abrir(`${p.ws}/ws/cliente`, bogota.cookie);
  const appSoacha = await h.abrir(`${p.ws}/ws/cliente`, soacha.cookie);
  const recibidos = [];
  appBogota.on('message', (m) => recibidos.push(JSON.parse(m).tipo));

  const admin = await h.iniciarSesion(p, 'ana');
  const operador = await h.iniciarSesion(p, 'oscar');
  const aviso = { tipo: 'simulacro', titulo: 'Simulacro distrital', mensaje: 'Mañana a las 10 a. m. sonará la alarma de prueba.', ciudad: 'Soacha' };
  assert.equal((await h.pedir(`${p.http}/api/comunicados`, 'POST', aviso, operador.cookie)).status, 403);
  assert.equal((await h.pedir(`${p.http}/api/comunicados`, 'POST', { ...aviso, tipo: 'spam' }, admin.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/comunicados`, 'POST', { ...aviso, ciudad: 'Marte' }, admin.cookie)).status, 400);

  const llega = h.esperar(appSoacha, 'comunicado');
  const r = await h.pedir(`${p.http}/api/comunicados`, 'POST', aviso, admin.cookie);
  assert.equal(r.status, 201);
  assert.equal((await r.json()).destinatarios, 1);
  const { comunicado } = await llega;
  assert.equal(comunicado.titulo, 'Simulacro distrital');
  await new Promise((ok) => setTimeout(ok, 100));
  assert.ok(!recibidos.includes('comunicado'), 'Bogotá no recibe el aviso de Soacha');

  const resumenB = await json(get(p, '/api/cliente/resumen', bogota.cookie));
  assert.equal(resumenB.comunicados.length, 0);
  assert.equal((await h.pedir(`${p.http}/api/cliente/comunicados/${comunicado.id}/leido`, 'POST', {}, bogota.cookie)).status, 404);
  const resumenS = await json(get(p, '/api/cliente/resumen', soacha.cookie));
  assert.equal(resumenS.comunicados[0].leido, false);
  assert.equal((await h.pedir(`${p.http}/api/cliente/comunicados/${comunicado.id}/leido`, 'POST', {}, soacha.cookie)).status, 200);
  assert.equal((await json(get(p, '/api/cliente/resumen', soacha.cookie))).comunicados[0].leido, true);
  assert.equal((await json(get(p, '/api/comunicados', operador.cookie))).comunicados[0].leidos, 1);
  [appBogota, appSoacha].forEach((ws) => ws.close());
});

test('prueba remota: el panel hace sonar un dispositivo y recibe la confirmación', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const { cookie } = await h.iniciarSesion(p, 'oscar');
  const panel = await h.abrir(`${p.ws}/ws/panel`, cookie);
  assert.equal((await h.pedir(`${p.http}/api/dispositivos/casa-a/prueba`, 'POST', {}, cookie)).status, 409, 'desconectado');
  const a = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const orden = h.esperar(a.ws, 'prueba');
  assert.equal((await h.pedir(`${p.http}/api/dispositivos/casa-a/prueba`, 'POST', {}, cookie)).status, 202);
  await orden;
  const confirmacion = h.esperar(panel, 'prueba_ok');
  a.ws.send(JSON.stringify({ tipo: 'prueba_ok' }));
  assert.equal((await confirmacion).nombre, 'Casa A');
  assert.equal((await h.pedir(`${p.http}/api/dispositivos/no-existe/prueba`, 'POST', {}, cookie)).status, 404);
  a.ws.close(); panel.close();
});
