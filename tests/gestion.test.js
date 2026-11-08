/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/gestion.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas del panel de gestión: historial con filtros y CSV (RF04), red de
 *           dispositivos y clientes, desvinculación, solicitudes de ayuda y eventos diferidos.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayuda');
const { celdaCSV } = require('../servidor/gestion');

/** Simula dos eventos (uno por casa) que confirman una alerta. */
async function provocarAlerta(p) {
  const a = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const b = await h.conectarDispositivo(p, 'casa-b', h.TOKEN_B);
  const alerta = h.esperar(a.ws, 'alerta');
  a.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.32 }));
  b.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.18 }));
  await alerta;
  return [a.ws, b.ws];
}
const get = (p, ruta, cookie) => fetch(`${p.http}${ruta}`, { headers: { Cookie: cookie } });

test('historial: filtra por ciudad y aceleración mínima, y pagina', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const sockets = await provocarAlerta(p);
  const { cookie } = await h.iniciarSesion(p, 'oscar');
  const todos = await (await get(p, '/api/historial', cookie)).json();
  assert.equal(todos.total, 2);
  const soacha = await (await get(p, '/api/historial?ciudad=Soacha', cookie)).json();
  assert.deepEqual(soacha.items.map((e) => e.nombre), ['Casa B']);
  const fuertes = await (await get(p, '/api/historial?min=0.3', cookie)).json();
  assert.equal(fuertes.total, 1);
  const alertas = await (await get(p, '/api/historial?tipo=alertas', cookie)).json();
  assert.equal(alertas.total, 1);
  const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const futuro = await (await get(p, `/api/historial?desde=${manana}`, cookie)).json();
  assert.equal(futuro.total, 0);
  sockets.forEach((ws) => ws.close());
});

test('historial: rechaza filtros inválidos y exige sesión', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const { cookie } = await h.iniciarSesion(p, 'oscar');
  assert.equal((await get(p, '/api/historial?desde=ayer', cookie)).status, 400);
  assert.equal((await get(p, '/api/historial?min=99', cookie)).status, 400);
  assert.equal((await get(p, '/api/historial?tipo=usuarios', cookie)).status, 400);
  assert.equal((await get(p, '/api/historial?desde=2026-12-10&hasta=2026-12-01', cookie)).status, 400);
  assert.equal((await fetch(`${p.http}/api/historial`)).status, 401);
});

test('exportación CSV: se descarga y neutraliza fórmulas de Excel', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const sockets = await provocarAlerta(p);
  const { cookie } = await h.iniciarSesion(p, 'oscar');
  const r = await get(p, '/api/historial.csv', cookie);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const texto = await r.text();
  assert.match(texto, /Casa A/);
  assert.equal(texto.trim().split('\r\n').length, 3); // encabezado + 2 eventos
  assert.equal(celdaCSV('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(celdaCSV('Casa; Suba'), '"Casa; Suba"');
  sockets.forEach((ws) => ws.close());
});

test('red: el operador ve dispositivos y clientes, pero solo el admin puede desvincular', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const cliente = await h.registrarCliente(p, 'familia@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, cliente.cookie);
  const app = await h.abrir(`${p.ws}/ws/cliente`, cliente.cookie);
  const operador = await h.iniciarSesion(p, 'oscar');
  const admin = await h.iniciarSesion(p, 'ana');

  const red = await (await get(p, '/api/red', operador.cookie)).json();
  assert.equal(red.dispositivos.find((d) => d.id === 'casa-a').dueno.correo, 'familia@ejemplo.co');
  assert.equal(red.clientes[0].dispositivos, 1);

  assert.equal((await h.pedir(`${p.http}/api/dispositivos/casa-a/desvincular`, 'POST', {}, operador.cookie)).status, 403);
  const aviso = h.esperar(app, 'desvinculado');
  assert.equal((await h.pedir(`${p.http}/api/dispositivos/casa-a/desvincular`, 'POST', {}, admin.cookie)).status, 200);
  assert.equal((await aviso).id, 'casa-a');
  const resumen = await (await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: cliente.cookie } })).json();
  assert.equal(resumen.dispositivos.length, 0);
  // Ya libre, otro cliente lo puede vincular con el mismo código.
  const otro = await h.registrarCliente(p, 'nuevos.duenos@ejemplo.co');
  assert.equal((await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, otro.cookie)).status, 200);
  app.close();
});

test('solicitudes de ayuda: el panel las recibe con dirección y contactos, y se marcan como atendidas', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const cliente = await h.registrarCliente(p, 'marta@ejemplo.co', 'Marta Rojas');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, cliente.cookie);
  await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a`, 'PATCH', { nombre: 'Casa Marta', direccion: 'Calle 60 # 9-23', umbral: 0.15 }, cliente.cookie);
  await h.pedir(`${p.http}/api/cliente/contactos`, 'POST', { nombre: 'Carlos Rojas', telefono: '300 555 1234', relacion: 'Hijo' }, cliente.cookie);
  const operador = await h.iniciarSesion(p, 'oscar');
  const panel = await h.abrir(`${p.ws}/ws/panel`, operador.cookie);
  const sockets = await provocarAlerta(p);
  const alerta = (await (await get(p, '/api/historial?tipo=alertas', operador.cookie)).json()).items[0];

  const aviso = h.esperar(panel, 'solicitudes');
  await h.pedir(`${p.http}/api/cliente/respuestas`, 'POST', { alertaId: alerta.id, estado: 'ayuda' }, cliente.cookie);
  assert.equal((await aviso).pendientes, 1);

  const { solicitudes } = await (await get(p, '/api/ayuda', operador.cookie)).json();
  assert.equal(solicitudes[0].nombre, 'Marta Rojas');
  assert.equal(solicitudes[0].dispositivos[0].direccion, 'Calle 60 # 9-23');
  assert.equal(solicitudes[0].contactos[0].telefono, '300 555 1234');

  assert.equal((await h.pedir(`${p.http}/api/ayuda/${solicitudes[0].id}/atender`, 'POST', {}, operador.cookie)).status, 200);
  assert.equal((await h.pedir(`${p.http}/api/ayuda/${solicitudes[0].id}/atender`, 'POST', {}, operador.cookie)).status, 404, 'no se atiende dos veces');
  const despues = await (await get(p, '/api/ayuda', operador.cookie)).json();
  assert.equal(despues.pendientes, 0);
  assert.equal(despues.solicitudes[0].atendida_por, 'oscar');
  [...sockets, panel].forEach((ws) => ws.close());
});

test('un evento guardado sin conexión se registra con su hora real, pero no dispara una alerta vieja', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const b = await h.conectarDispositivo(p, 'casa-b', h.TOKEN_B);
  const hace5min = Date.now() - 5 * 60_000;
  a.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.3, t: hace5min }));
  b.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.3, t: hace5min }));
  await new Promise((r) => setTimeout(r, 200));
  const eventos = p.db.ultimosEventos();
  assert.equal(eventos.length, 2);
  assert.equal(eventos[0].fecha, new Date(hace5min).toISOString());
  assert.equal(p.db.ultimasAlertas().length, 0);
  a.ws.close(); b.ws.close();
});
