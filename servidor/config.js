/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/config.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de backend
 * Qué hace: Parámetros del sistema: puerto, umbral de detección, ventana de confirmación y
 *           duración de sesiones.
 */
'use strict';

const path = require('node:path');

module.exports = {
  PUERTO: Number(process.env.PUERTO) || 3000,
  RUTA_DB: process.env.RUTA_DB || path.join(__dirname, '..', 'datos', 'vigia.db'),

  // Detección
  UMBRAL_G: 0.15, // aceleración (en g) a partir de la cual un dispositivo reporta un evento
  VENTANA_CONFIRMACION_MS: 10_000, // tiempo en que otros dispositivos deben coincidir
  MIN_DISPOSITIVOS: 2, // dispositivos cercanos necesarios para declarar un sismo
  RADIO_KM: 300, // distancia máxima entre los dispositivos que confirman
  DURACION_ALERTA_MS: 20_000, // tiempo que un dispositivo permanece en estado de alerta

  // Acceso al panel
  DURACION_SESION_MS: 8 * 60 * 60 * 1000, // una jornada de trabajo
  INTENTOS_MAXIMOS: 5, // intentos fallidos de inicio de sesión antes de bloquear
  BLOQUEO_MS: 15 * 60 * 1000,
  COOKIE_SEGURA: process.env.COOKIE_SEGURA === 'true', // activar cuando el sitio use HTTPS

  // Permite que el panel ordene sismos simulados. Debe desactivarse en producción.
  MODO_SIMULACION: process.env.MODO_SIMULACION !== 'false',
};
