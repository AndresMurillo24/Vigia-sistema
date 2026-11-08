/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/cliente.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas de la app del cliente: registro, vinculación, IDOR, sensibilidad, prueba de
 *           alarma, contactos y alertas.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayuda');

test('un cliente crea su cuenta y queda con la sesión iniciada', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const { r, cookie } = await h.registrarCliente(p, 'familia@ejemplo.co');
  assert.equal(r.status, 201);
  const resumen = await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: cookie } });
  assert.equal(resumen.status, 200);
  assert.equal((await resumen.json()).cliente.correo, 'familia@ejemplo.co');
});

test('no se pueden crear dos cuentas con el mismo correo ni con contraseñas cortas', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  await h.registrarCliente(p, 'familia@ejemplo.co');
  assert.equal((await h.registrarCliente(p, 'FAMILIA@ejemplo.co')).r.status, 409);
  const corta = await h.pedir(`${p.http}/api/cliente/registro`, 'POST', { nombre: 'Ana', correo: 'ana@ejemplo.co', clave: '123' });
  assert.equal(corta.status, 400);
});

test('la sesión del cliente no sirve para el panel de la empresa, ni la del panel para la app', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const cliente = await h.registrarCliente(p, 'familia@ejemplo.co');
  const admin = await h.iniciarSesion(p, 'ana');
  assert.equal((await fetch(`${p.http}/api/estado`, { headers: { Cookie: cliente.cookie } })).status, 401);
  assert.equal((await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: admin.cookie } })).status, 401);
});

test('vincula un dispositivo con el código de la caja; un código ajeno o falso se rechaza', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  const b = await h.registrarCliente(p, 'b@ejemplo.co');
  const r = await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: ' vg-aaaa-1111 ' }, a.cookie);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).dispositivo.id, 'casa-a');
  assert.equal((await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, b.cookie)).status, 409);
  assert.equal((await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: 'VG-ZZZZ-9999' }, b.cookie)).status, 404);
  assert.equal((await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: 'hola' }, b.cookie)).status, 400);
});

test('un cliente no puede ver ni modificar el dispositivo de otro (IDOR)', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  const b = await h.registrarCliente(p, 'b@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, a.cookie);
  const ajuste = { nombre: 'Casa robada', direccion: '', umbral: 0.2 };
  assert.equal((await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a`, 'PATCH', ajuste, b.cookie)).status, 404);
  assert.equal((await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a/prueba`, 'POST', {}, b.cookie)).status, 404);
  const resumenB = await (await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: b.cookie } })).json();
  assert.equal(resumenB.dispositivos.length, 0);
});

test('el dueño cambia la sensibilidad y el nuevo umbral le llega al dispositivo', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, a.cookie);
  const { ws } = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const config = h.esperar(ws, 'config');
  const r = await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a`, 'PATCH', { nombre: 'Casa de la abuela', direccion: 'Calle 1', umbral: 0.25 }, a.cookie);
  assert.equal(r.status, 200);
  assert.equal((await config).umbral, 0.25);
  // Al reconectarse, el dispositivo recibe su umbral guardado.
  ws.close();
  const otra = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  assert.equal(otra.bienvenida.umbral, 0.25);
  otra.ws.close();
});

test('la sensibilidad solo acepta valores seguros', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, a.cookie);
  for (const umbral of [0, 0.01, 0.9, '0.2']) {
    const r = await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a`, 'PATCH', { nombre: 'Casa', direccion: '', umbral }, a.cookie);
    assert.equal(r.status, 400, `umbral ${umbral} debería rechazarse`);
  }
});

test('probar la alarma: el dispositivo la hace sonar y la app recibe la confirmación', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, a.cookie);
  assert.equal((await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a/prueba`, 'POST', {}, a.cookie)).status, 409, 'desconectado');
  const { ws } = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const app = await h.abrir(`${p.ws}/ws/cliente`, a.cookie);
  ws.on('message', (raw) => { if (JSON.parse(raw).tipo === 'prueba') ws.send(JSON.stringify({ tipo: 'prueba_ok' })); });
  const confirmacion = h.esperar(app, 'prueba_ok');
  assert.equal((await h.pedir(`${p.http}/api/cliente/dispositivos/casa-a/prueba`, 'POST', {}, a.cookie)).status, 202);
  assert.equal((await confirmacion).id, 'casa-a');
  ws.close(); app.close();
});

test('contactos de emergencia: máximo 5 y nadie borra los de otra cuenta', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  const b = await h.registrarCliente(p, 'b@ejemplo.co');
  let primero;
  for (let i = 0; i < 5; i++) {
    const r = await h.pedir(`${p.http}/api/cliente/contactos`, 'POST', { nombre: `Contacto ${i}`, telefono: '300 123 4567', relacion: 'Hijo' }, a.cookie);
    assert.equal(r.status, 201);
    primero ??= (await r.json()).contacto.id;
  }
  assert.equal((await h.pedir(`${p.http}/api/cliente/contactos`, 'POST', { nombre: 'Sexto', telefono: '3001234567' }, a.cookie)).status, 409);
  assert.equal((await h.pedir(`${p.http}/api/cliente/contactos`, 'POST', { nombre: 'Mal', telefono: 'llámame' }, b.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/cliente/contactos/${primero}`, 'DELETE', undefined, b.cookie)).status, 404);
  assert.equal((await h.pedir(`${p.http}/api/cliente/contactos/${primero}`, 'DELETE', undefined, a.cookie)).status, 204);
});

test('cuando hay un sismo la app del cliente recibe la alerta con la distancia a su casa, y su respuesta llega al panel', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'a@ejemplo.co');
  await h.pedir(`${p.http}/api/cliente/vincular`, 'POST', { codigo: h.CODIGO_A }, a.cookie);
  const app = await h.abrir(`${p.ws}/ws/cliente`, a.cookie);
  const admin = await h.iniciarSesion(p, 'oscar');
  const panel = await h.abrir(`${p.ws}/ws/panel`, admin.cookie);
  const d1 = await h.conectarDispositivo(p, 'casa-a', h.TOKEN_A);
  const d2 = await h.conectarDispositivo(p, 'casa-b', h.TOKEN_B);

  const alerta = h.esperar(app, 'alerta');
  d1.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.3 }));
  d2.ws.send(JSON.stringify({ tipo: 'evento', pga: 0.2 }));
  const { alerta: a1 } = await alerta;
  assert.equal(typeof a1.distanciaKm, 'number');
  assert.equal(a1.dispositivo, 'Casa A');
  assert.equal(a1.respuesta, null);

  const aviso = h.esperar(panel, 'respuesta');
  const r = await h.pedir(`${p.http}/api/cliente/respuestas`, 'POST', { alertaId: a1.id, estado: 'bien' }, a.cookie);
  assert.equal(r.status, 200);
  assert.deepEqual(await aviso, { tipo: 'respuesta', alertaId: a1.id, bien: 1, ayuda: 0 });
  for (const ws of [app, panel, d1.ws, d2.ws]) ws.close();
});

test('sin sesión de cliente no se abre el canal en vivo de la app', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  await assert.rejects(h.abrir(`${p.ws}/ws/cliente`));
});
