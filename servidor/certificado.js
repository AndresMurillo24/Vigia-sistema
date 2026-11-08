/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  servidor/certificado.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Capa de backend · seguridad
 * Qué hace: Obtiene el certificado TLS para servir la plataforma por HTTPS/WSS: usa uno real si
 *           se indica con TLS_CERT y TLS_KEY, o genera uno autofirmado para pruebas locales.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function obtenerCertificado(carpeta, log = console.log) {
  // Certificado real (por ejemplo de Let's Encrypt) en un despliegue.
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    return { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), autofirmado: false };
  }
  // Certificado autofirmado para desarrollo: el navegador mostrará una advertencia la primera vez.
  const rutaCert = path.join(carpeta, 'tls-cert.pem');
  const rutaClave = path.join(carpeta, 'tls-key.pem');
  if (!fs.existsSync(rutaCert) || !fs.existsSync(rutaClave)) {
    const selfsigned = require('selfsigned');
    const pem = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 365, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
    });
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(rutaCert, pem.cert);
    fs.writeFileSync(rutaClave, pem.private, { mode: 0o600 });
    log('Se generó un certificado autofirmado para HTTPS en la carpeta datos/.');
  }
  return { cert: fs.readFileSync(rutaCert), key: fs.readFileSync(rutaClave), autofirmado: true };
}

module.exports = { obtenerCertificado };
