/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/login.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Envía usuario y contraseña al servidor y muestra los errores.
 */
'use strict';

const $ = (id) => document.getElementById(id);

// Si ya hay una sesión abierta, ir directo al panel.
fetch('/api/sesion').then((r) => { if (r.ok) location.replace('/'); });

$('formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = $('usuario').value.trim();
  const clave = $('clave').value;
  if (!usuario || !clave) { $('error').textContent = 'Escribe tu usuario y tu contraseña.'; return; }

  const boton = e.submitter;
  boton.disabled = true;
  $('error').textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave }),
    });
    if (r.ok) return location.replace('/');
    const datos = await r.json().catch(() => ({}));
    $('error').textContent = datos.error || 'No se pudo iniciar sesión.';
    $('clave').value = '';
    $('clave').focus();
  } catch {
    $('error').textContent = 'No se pudo contactar al servidor.';
  } finally {
    boton.disabled = false;
  }
});
