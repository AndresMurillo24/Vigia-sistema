'use strict';

const RADIO_TIERRA_KM = 6371;
const rad = (grados) => (grados * Math.PI) / 180;

/** Distancia en kilómetros entre dos puntos { lat, lon } (fórmula de Haversine). */
function distanciaKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
}

module.exports = { distanciaKm };
