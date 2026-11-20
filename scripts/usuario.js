/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  scripts/usuario.js
 * Tipo:     JavaScript (Node.js)
 * Capa:     Herramientas
 * Qué hace: Herramienta de consola para crear usuarios del panel o cambiar su contraseña
 *           (también se puede hacer desde la sección Usuarios del panel).
 */
'use strict';

/*
 * Crea un usuario del panel o cambia su contraseña.
 *
 *   npm run usuario -- <usuario> <rol> "<Nombre completo>"
 *
 * rol: admin (puede simular sismos) u operador (solo observa). La contraseña se pide al ejecutar.
 */
const readline = require('node:readline/promises');
const config = require('../servidor/config');
const { abrirBaseDatos } = require('../servidor/db');
const { hashClave } = require('../servidor/seguridad');
const { claveSegura } = require('../servidor/validacion');

async function main() {
  const [usuario, rol = 'operador', nombre] = process.argv.slice(2);
  if (!usuario || !/^[a-z0-9._-]{3,40}$/i.test(usuario) || !['admin', 'operador'].includes(rol)) {
    console.log('Uso: npm run usuario -- <usuario> <admin|operador> "<Nombre completo>"');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const clave = await rl.question('Contraseña (mínimo 8 caracteres, con letras y números): ');
  const repetida = await rl.question('Repite la contraseña: ');
  rl.close();
  if (!claveSegura(clave)) return console.log('La contraseña debe tener al menos 8 caracteres, con letras y números.');
  if (clave !== repetida) return console.log('Las contraseñas no coinciden.');

  const db = abrirBaseDatos(config.RUTA_DB);
  const existente = db.buscarUsuario(usuario.toLowerCase());
  db.guardarUsuario({ usuario: usuario.toLowerCase(), nombre: nombre || existente?.nombre || usuario, rol, clave_hash: hashClave(clave) });
  if (existente) db.borrarSesionesUsuario(existente.id); // cerrar las sesiones abiertas con la clave anterior
  console.log(`${existente ? 'Usuario actualizado' : 'Usuario creado'}: ${usuario.toLowerCase()} (${rol})`);
  db.cerrar();
}

main();
