/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/tema.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación
 * Qué hace: Aplica el tema claro u oscuro elegido antes de dibujar la página (evita el parpadeo).
 *           Lo usan el panel, su inicio de sesión y la app del cliente.
 */
'use strict';
(() => {
  let tema = null;
  try { tema = localStorage.getItem('vigia:tema'); } catch { /* almacenamiento no disponible */ }
  if (tema !== 'claro' && tema !== 'oscuro') tema = matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  document.documentElement.dataset.tema = tema;
})();
