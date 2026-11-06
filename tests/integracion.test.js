/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/integracion.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Prueba del flujo completo: dispositivos, plataforma, panel y alerta a la red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preparar, iniciarSesion, postJSON, abrir, esperar, cierre, TOKEN_A, TOKEN_B } = require('./ayuda');

test('rechaza un dispositivo con token incorrecto', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const ws = await abrir(`${p.ws}/ws/dispositivo`);
  ws.send(JSON.stringify({ tipo: 'hola', id: 'casa-a', token: 'token-falso-xxxxxxxxxxxxxxxxx' }));
  assert.equal(await cierre(ws), 4003);
});

test('dos dispositivos que detectan vibración generan una alerta en el panel y en la red', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const { cookie } = await iniciarSesion(p, 'oscar');
  const panel = await abrir(`${p.ws}/ws/panel`, cookie);
  const a = await abrir(`${p.ws}/ws/dispositivo`);
  const b = await abrir(`${p.ws}/ws/dispositivo`);
  a.send(JSON.stringify({ tipo: 'hola', id: 'casa-a', token: TOKEN_A }));
  b.send(JSON.stringify({ tipo: 'hola', id: 'casa-b', token: TOKEN_B }));
  await Promise.all([esperar(a, 'bienvenida'), esperar(b, 'bienvenida')]);

  const alertaPanel = esperar(panel, 'alerta');
  const alertaRed = esperar(a, 'alerta');
  a.send(JSON.stringify({ tipo: 'evento', pga: 0.32 }));
  b.send(JSON.stringify({ tipo: 'evento', pga: 0.21 }));

  const { alerta } = await alertaPanel;
  assert.equal(alerta.dispositivos, 2);
  assert.equal(alerta.pga_max, 0.32);
  await alertaRed;
  assert.equal(p.db.ultimasAlertas().length, 1);
  assert.equal(p.db.ultimosEventos().length, 2);
  for (const ws of [panel, a, b]) ws.close();
});

test('la API rechaza una simulación fuera de Colombia', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const { cookie } = await iniciarSesion(p, 'ana');
  const r = await postJSON(`${p.http}/api/simulacion`, { lat: 40, lon: -3, magnitud: 6 }, cookie);
  assert.equal(r.status, 400);
});
