/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  simulador/modelo.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de dispositivo
 * Qué hace: Modelo simplificado de cómo viajan las ondas P y S y de cuánto sacuden según la
 *           distancia al epicentro.
 */
'use strict';

/*
 * Modelo físico SIMPLIFICADO, solo para la simulación. No reemplaza un modelo sismológico real.
 *
 *  - La onda P (rápida y débil) viaja a ~6 km/s; la onda S (lenta y fuerte) a ~3,5 km/s.
 *  - La aceleración máxima del suelo (PGA) disminuye con la distancia al epicentro.
 *  - ESCALA_TIEMPO acelera la propagación para que la demostración no tome demasiado.
 */
const VELOCIDAD_P_KMS = 6;
const VELOCIDAD_S_KMS = 3.5;
const ESCALA_TIEMPO = 3;

/** PGA estimada en g para una magnitud y una distancia en km (tope de 1 g). */
function pgaEstimada(magnitud, distanciaKm) {
  return Math.min(1, 10 ** (0.3 * magnitud - 1.2 * Math.log10(distanciaKm + 20)));
}

/** Momentos (ms) en que llegan las ondas P y S a un punto a cierta distancia. */
function tiemposDeLlegada(inicio, distanciaKm) {
  return {
    tP: inicio + (distanciaKm / VELOCIDAD_P_KMS / ESCALA_TIEMPO) * 1000,
    tS: inicio + (distanciaKm / VELOCIDAD_S_KMS / ESCALA_TIEMPO) * 1000,
  };
}

/** Amplitud del movimiento en el instante t para un sismo programado. */
function amplitud(sismo, t) {
  if (t < sismo.tP) return 0;
  if (t < sismo.tS) return sismo.pga * 0.25; // onda P: vibración leve
  const s = (t - sismo.tS) / 1000;
  return sismo.pga * Math.min(1, s / 0.8) * Math.exp(-s / 4); // onda S: sube rápido y se apaga
}

module.exports = { pgaEstimada, tiemposDeLlegada, amplitud, ESCALA_TIEMPO, VELOCIDAD_S_KMS };
