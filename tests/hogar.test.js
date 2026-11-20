/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  tests/hogar.test.js
 * Tipo:     JavaScript (pruebas · node:test)
 * Capa:     Pruebas
 * Qué hace: Pruebas de las funciones del hogar en la app Mi Vigía: plan de emergencia familiar
 *           (kit y punto de encuentro) y cambio de contraseña del cliente.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayuda');

const resumen = async (p, cookie) => (await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: cookie } })).json();

test('plan de emergencia: se guarda por hogar y solo acepta elementos conocidos', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const a = await h.registrarCliente(p, 'familia.a@ejemplo.co');
  const b = await h.registrarCliente(p, 'familia.b@ejemplo.co');
  const inicial = await resumen(p, a.cookie);
  assert.deepEqual(inicial.plan.kit, []);
  assert.ok(inicial.kit.includes('agua') && inicial.kit.includes('botiquin'));

  const plan = { kit: ['agua', 'linterna', 'agua'], encuentro: 'Parque de la 60', encuentroAlterno: 'Iglesia del barrio', notas: 'Abuela toma insulina' };
  const r = await h.pedir(`${p.http}/api/cliente/plan`, 'PUT', plan, a.cookie);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).plan.kit, ['agua', 'linterna'], 'sin repetidos');
  assert.equal((await resumen(p, a.cookie)).plan.encuentro, 'Parque de la 60');
  assert.equal((await resumen(p, b.cookie)).plan.encuentro, '', 'cada hogar tiene su propio plan');

  assert.equal((await h.pedir(`${p.http}/api/cliente/plan`, 'PUT', { kit: ['<script>'] }, a.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/cliente/plan`, 'PUT', { kit: [], encuentro: 'x'.repeat(200) }, a.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/cliente/plan`, 'PUT', { kit: [] })).status, 401);
});

test('cliente: cambia su contraseña y se cierran sus otras sesiones', async (t) => {
  const p = await h.preparar();
  t.after(() => p.cerrar());
  const celular = await h.registrarCliente(p, 'marta@ejemplo.co');
  const login = (clave) => fetch(`${p.http}/api/cliente/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'marta@ejemplo.co', clave }) });
  const tablet = (await login(h.CLAVE)).headers.get('set-cookie').split(';')[0];

  assert.equal((await h.pedir(`${p.http}/api/cliente/clave`, 'POST', { actual: 'no-es', nueva: 'Marta2026ok' }, celular.cookie)).status, 403);
  assert.equal((await h.pedir(`${p.http}/api/cliente/clave`, 'POST', { actual: h.CLAVE, nueva: '12345678' }, celular.cookie)).status, 400);
  assert.equal((await h.pedir(`${p.http}/api/cliente/clave`, 'POST', { actual: h.CLAVE, nueva: 'Marta2026ok' }, celular.cookie)).status, 200);
  assert.equal((await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: celular.cookie } })).status, 200);
  assert.equal((await fetch(`${p.http}/api/cliente/resumen`, { headers: { Cookie: tablet } })).status, 401);
  assert.equal((await login(h.CLAVE)).status, 401);
  assert.equal((await login('Marta2026ok')).status, 200);
});
