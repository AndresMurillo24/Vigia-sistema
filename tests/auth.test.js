'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashClave, verificarClave } = require('../servidor/seguridad');
const { preparar, iniciarSesion, postJSON, abrir } = require('./ayuda');

test('las contraseñas se guardan con sal: el mismo texto da hashes distintos', () => {
  const a = hashClave('una-clave-segura');
  const b = hashClave('una-clave-segura');
  assert.notEqual(a, b);
  assert.equal(verificarClave('una-clave-segura', a), true);
  assert.equal(verificarClave('otra-clave', a), false);
  assert.ok(!a.includes('una-clave-segura'));
});

test('sin sesión no se pueden ver los datos ni abrir el canal en vivo', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  assert.equal((await fetch(`${p.http}/api/estado`)).status, 401);
  await assert.rejects(abrir(`${p.ws}/ws/panel`));
});

test('con usuario y contraseña correctos se obtiene una cookie de sesión segura', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const { r, cookie } = await iniciarSesion(p, 'oscar');
  assert.equal(r.status, 200);
  const encabezado = r.headers.get('set-cookie');
  assert.match(encabezado, /HttpOnly/);
  assert.match(encabezado, /SameSite=Strict/);
  assert.equal((await r.json()).usuario.rol, 'operador');
  assert.equal((await fetch(`${p.http}/api/estado`, { headers: { Cookie: cookie } })).status, 200);
});

test('una contraseña incorrecta y un usuario inexistente dan el mismo mensaje', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const a = await iniciarSesion(p, 'oscar', 'clave-equivocada');
  const b = await iniciarSesion(p, 'nadie', 'clave-equivocada');
  assert.equal(a.r.status, 401);
  assert.equal(b.r.status, 401);
  assert.deepEqual(await a.r.json(), await b.r.json());
});

test('un operador no puede simular sismos; un administrador sí', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const sismo = { lat: 4.37, lon: -73.21, magnitud: 6.3 };
  const operador = await iniciarSesion(p, 'oscar');
  const admin = await iniciarSesion(p, 'ana');
  assert.equal((await postJSON(`${p.http}/api/simulacion`, sismo, operador.cookie)).status, 403);
  assert.equal((await postJSON(`${p.http}/api/simulacion`, sismo, admin.cookie)).status, 202);
});

test('después de 5 intentos fallidos se bloquea, aunque luego se use la contraseña correcta', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  for (let i = 0; i < 5; i++) await iniciarSesion(p, 'ana', 'adivinando-' + i);
  const { r } = await iniciarSesion(p, 'ana');
  assert.equal(r.status, 429);
});

test('al cerrar sesión la cookie deja de servir', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const { cookie } = await iniciarSesion(p, 'oscar');
  await postJSON(`${p.http}/api/logout`, {}, cookie);
  assert.equal((await fetch(`${p.http}/api/estado`, { headers: { Cookie: cookie } })).status, 401);
});

test('la API no acepta formularios que no sean JSON', async (t) => {
  const p = await preparar();
  t.after(() => p.cerrar());
  const r = await fetch(`${p.http}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'usuario=ana&clave=x' });
  assert.equal(r.status, 415);
});
