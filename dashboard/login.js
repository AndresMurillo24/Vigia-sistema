/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/login.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Envía usuario y contraseña al servidor, muestra los errores y permite ver la contraseña.
 */
'use strict';

const $ = (id) => document.getElementById(id);

// Si ya hay una sesión abierta, ir directo al panel.
fetch('/api/sesion').then((r) => { if (r.ok) location.replace('/'); });

$('verClave').addEventListener('click', () => {
  const ver = $('clave').type === 'password';
  $('clave').type = ver ? 'text' : 'password';
  $('verClave').setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

function error(texto) {
  $('error').textContent = texto;
  const f = $('formLogin');
  f.classList.remove('agitar'); void f.offsetWidth; f.classList.add('agitar');
}

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = $('usuario').value.trim();
  const clave = $('clave').value;
  if (!usuario || !clave) return error('Escribe tu usuario y tu contraseña.');

  const boton = e.submitter;
  boton.disabled = true;
  boton.textContent = 'Verificando…';
  $('error').textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave }),
    });
    if (r.ok) { boton.textContent = 'Entrando…'; return location.replace('/'); }
    const datos = await r.json().catch(() => ({}));
    error(datos.error || 'No se pudo iniciar sesión.');
    $('clave').value = '';
    $('clave').focus();
  } catch {
    error('No se pudo contactar al servidor.');
  } finally {
    boton.disabled = false;
    if (boton.textContent === 'Verificando…') boton.textContent = 'Ingresar al panel';
  }
});
