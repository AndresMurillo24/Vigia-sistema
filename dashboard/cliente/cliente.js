/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/cliente/cliente.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · app del cliente
 * Qué hace: Lógica de la app Mi Vigía: cuenta, vinculación, estado del hogar y vibración en vivo,
 *           avisos de la empresa, plan de emergencia familiar, historial, ajustes, contactos,
 *           cambio de contraseña, alerta de sismo con «Estoy bien / Necesito ayuda» y simulacros.
 */
'use strict';

/* ============================ utilidades ============================ */
const $ = (id) => document.getElementById(id);
// Todo texto que viene del servidor (nombres, direcciones, contactos, avisos) se escapa antes de
// insertarlo en la página, para evitar XSS.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');
const ZONA = { timeZone: 'America/Bogota' };
const fecha = (iso) => new Date(iso).toLocaleString('es-CO', { ...ZONA, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const iniciales = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

async function api(ruta, metodo = 'GET', cuerpo) {
  const r = await fetch(ruta, {
    method: metodo,
    headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && !ruta.endsWith('/login') && !ruta.endsWith('/clave')) mostrar('pAcceso');
  return { ok: r.ok, status: r.status, datos };
}

let ocultarToast;
function toast(texto) {
  const t = $('toast');
  t.textContent = texto;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(ocultarToast);
  ocultarToast = setTimeout(() => { t.hidden = true; }, 4500);
}

function mostrar(id) {
  for (const p of ['pAcceso', 'pVincular', 'pApp']) $(p).hidden = p !== id;
  if (id !== 'pApp') ws?.close();
}

async function enviarFormulario(form, accion) {
  const boton = form.querySelector('button[type=submit]');
  const error = form.querySelector('.error');
  boton.disabled = true;
  error.textContent = '';
  const fallar = (msg) => { error.textContent = msg; form.classList.remove('agitar'); void form.offsetWidth; form.classList.add('agitar'); };
  try { await accion(Object.fromEntries(new FormData(form)), fallar); }
  catch { fallar('No se pudo contactar al servidor.'); }
  finally { boton.disabled = false; }
}

/* ============================ tema ============================ */
function pintarTema() { $('bTema').querySelector('use').setAttribute('href', document.documentElement.dataset.tema === 'oscuro' ? '#c-sol' : '#c-luna'); }
$('bTema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  document.documentElement.dataset.tema = nuevo;
  guardarLocal('vigia:tema', nuevo);
  pintarTema();
});
pintarTema();

/* ============================ estado ============================ */
const app = { cliente: null, dispositivos: new Map(), contactos: [], eventos: [], alertas: [], comunicados: [], plan: { kit: [] }, kit: [], limites: { umbralMin: .05, umbralMax: .4 } };
const VENTANA_MS = 30_000; // la onda muestra los últimos 30 segundos
const historia = new Map(); // id -> [{ v, t }]

const KIT = {
  agua: ['Agua potable', '3 litros por persona al día'], comida: ['Comida no perecedera', 'Enlatados, galletas, panela'],
  linterna: ['Linterna', 'Mejor si es de manivela o LED'], radio: ['Radio de pilas', 'Para oír a las autoridades'],
  botiquin: ['Botiquín', 'Gasas, alcohol, curitas'], medicamentos: ['Medicamentos', 'Los de uso diario de la familia'],
  documentos: ['Copia de documentos', 'Cédulas, escrituras, seguros'], pito: ['Pito', 'Para pedir ayuda si quedas atrapado'],
  baterias: ['Pilas de repuesto', 'Para la linterna y el radio'], abrigo: ['Abrigo o manta', 'Una por persona'],
  efectivo: ['Dinero en efectivo', 'Billetes y monedas pequeñas'], cargador: ['Batería para el celular', 'Cargada y lista'],
};

async function cargar() {
  const r = await api('/api/cliente/resumen');
  if (!r.ok) return;
  Object.assign(app, { cliente: r.datos.cliente, contactos: r.datos.contactos, eventos: r.datos.eventos, alertas: r.datos.alertas, comunicados: r.datos.comunicados, plan: r.datos.plan, kit: r.datos.kit, limites: r.datos.limites });
  app.dispositivos = new Map(r.datos.dispositivos.map((d) => [d.id, d]));
  if (!app.dispositivos.size) {
    $('bVolver').hidden = true;
    return mostrar('pVincular');
  }
  mostrar('pApp');
  $('hola').textContent = `Hola, ${app.cliente.nombre.split(' ')[0]}`;
  $('avatar').textContent = iniciales(app.cliente.nombre);
  $('fechaHoy').textContent = new Date().toLocaleDateString('es-CO', { ...ZONA, weekday: 'long', day: 'numeric', month: 'long' });
  renderTodo();
  conectar();
  // Si hubo una alerta en los últimos 10 minutos y no ha respondido, se le vuelve a preguntar.
  const reciente = app.alertas.find((a) => Date.now() - new Date(a.fecha) < 10 * 60_000 && !a.respuesta);
  if (reciente) abrirAlerta(reciente, false);
}

/* ============================ acceso ============================ */
function cambiarPestana(registro) {
  $('tabIngresar').setAttribute('aria-selected', !registro);
  $('tabRegistro').setAttribute('aria-selected', registro);
  $('tabIngresar').parentElement.classList.toggle('registro', registro);
  $('fIngresar').hidden = registro;
  $('fRegistro').hidden = !registro;
}
$('tabIngresar').onclick = () => cambiarPestana(false);
$('tabRegistro').onclick = () => cambiarPestana(true);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ver]');
  if (!b) return;
  const input = b.parentElement.querySelector('input');
  const ver = input.type === 'password';
  input.type = ver ? 'text' : 'password';
  b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

$('fIngresar').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    if (!d.correo || !d.clave) return error('Escribe tu correo y tu contraseña.');
    const r = await api('/api/cliente/login', 'POST', d);
    if (!r.ok) { e.target.clave.value = ''; return error(r.datos.error || 'No se pudo ingresar.'); }
    e.target.reset();
    cargar();
  });
});

$('fRegistro').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/registro', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo crear la cuenta.');
    e.target.reset();
    cargar();
  });
});

// El código se va formateando solo: VG-XXXX-XXXX.
$('fVincular').codigo.addEventListener('input', (e) => {
  const limpio = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^VG/, '').slice(0, 8);
  e.target.value = limpio ? `VG-${limpio.slice(0, 4)}${limpio.length > 4 ? '-' + limpio.slice(4) : ''}` : '';
});
$('fVincular').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/vincular', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo vincular.');
    e.target.reset();
    toast(`${r.datos.dispositivo.nombre} quedó vinculado a tu cuenta.`);
    cargar();
  });
});
$('bVolver').onclick = () => mostrar('pApp');
$('bOtro').onclick = () => { $('bVolver').hidden = false; mostrar('pVincular'); };

document.querySelectorAll('[data-salir]').forEach((b) => b.addEventListener('click', async () => {
  await api('/api/cliente/logout', 'POST', {});
  cambiarPestana(false);
  mostrar('pAcceso');
}));

/* ============================ pestañas ============================ */
const TABS = ['tInicio', 'tAvisos', 'tPlan', 'tHistorial', 'tAjustes'];
function irA(tab) {
  document.querySelectorAll('.tabs button').forEach((x) => x.toggleAttribute('aria-current', x.dataset.tab === tab));
  for (const s of TABS) $(s).hidden = s !== tab;
  $('indicador').style.transform = `translateX(${TABS.indexOf(tab) * 100}%)`;
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.tab)));

/* ============================ render ============================ */
function estadoDe(d) { return !d.enLinea ? ['off', 'Desconectado'] : d.enAlerta ? ['al', 'ALERTA'] : ['', 'En línea']; }
function wifiTexto(dbm) {
  if (dbm == null) return '–';
  return dbm > -55 ? 'Excelente' : dbm > -67 ? 'Buena' : dbm > -75 ? 'Regular' : 'Débil';
}

function renderEstado() {
  const ds = [...app.dispositivos.values()];
  const alerta = ds.some((d) => d.enLinea && d.enAlerta);
  const enLinea = ds.filter((d) => d.enLinea).length;
  const e = $('estadoHogar');
  e.className = `estado-hogar${alerta ? ' al' : enLinea ? '' : ' off'}`;
  $('estadoK').textContent = alerta ? 'Alerta activa' : 'Estado del hogar';
  $('estadoT').textContent = alerta ? 'Vibración fuerte detectada' : enLinea === ds.length ? 'Tu hogar está protegido' : enLinea ? 'Protección parcial' : 'Dispositivo sin conexión';
  $('estadoD').textContent = alerta ? 'Agáchate, cúbrete y sujétate.'
    : enLinea === ds.length ? `${ds.length === 1 ? 'Tu Vigía está' : `Tus ${ds.length} Vigía están`} vigilando en este momento.`
      : 'Revisa que el dispositivo tenga corriente y WiFi. La alarma local sigue funcionando con su batería.';
}

function tarjetaDispositivo(d, i) {
  const [clase, texto] = estadoDe(d);
  const bajaBateria = d.bateria != null && d.bateria < 20;
  return `<article class="tarjeta disp" data-id="${esc(d.id)}" style="animation-delay:${i * 60}ms">
    <header>
      <div><h3>${esc(d.nombre)}</h3><p class="lugar">${esc(d.direccion ? `${d.direccion} · ${d.ciudad}` : d.ciudad)}</p></div>
      <span class="etq ${clase}">${texto}</span>
    </header>
    <div class="medidas">
      <div class="medida${bajaBateria ? ' baja' : ''}"><svg><use href="#c-bat"/></svg><span>Batería</span><strong>${d.bateria == null ? '–' : d.bateria + ' %'}</strong></div>
      <div class="medida"><svg><use href="#c-wifi"/></svg><span>WiFi</span><strong>${wifiTexto(d.wifi)}</strong></div>
      <div class="medida"><svg><use href="#c-sens"/></svg><span>Sensibilidad</span><strong>${num(d.umbral)} g</strong></div>
    </div>
    <div class="onda-viva"><canvas aria-label="Vibración de los últimos 30 segundos"></canvas><span class="valor">–</span></div>
    <p class="leyenda">Vibración de los últimos 30 segundos. La línea punteada es tu umbral de alerta.</p>
    <button type="button" class="boton secundario" data-prueba="${esc(d.id)}"${d.enLinea ? '' : ' disabled'}><svg><use href="#c-campana"/></svg>Probar la alarma</button>
  </article>`;
}

function formularioAjustes(d) {
  const { umbralMin: mn, umbralMax: mx } = app.limites;
  return `<form class="tarjeta forma" data-ajustes="${esc(d.id)}" novalidate>
    <h3>${esc(d.nombre)}</h3>
    <label>Nombre del dispositivo <input name="nombre" value="${esc(d.nombre)}" maxlength="40" required></label>
    <label>Dirección <input name="direccion" value="${esc(d.direccion)}" maxlength="120" placeholder="Ej.: Calle 60 # 9-23, apto 402"></label>
    <div class="rango">
      <label for="u-${esc(d.id)}">Sensibilidad · alerta desde <output>${num(d.umbral)} g</output></label>
      <input id="u-${esc(d.id)}" name="umbral" type="range" min="${mn}" max="${mx}" step="0.01" value="${d.umbral}">
      <div class="extremos"><span>Más sensible</span><span>Menos sensible</span></div>
    </div>
    <p class="nota">Más sensible avisa con sismos leves, pero puede activarse con vibraciones fuertes de la calle. El valor recomendado es 0,15 g.</p>
    <p class="error" role="alert"></p>
    <button type="submit" class="boton">Guardar cambios</button>
  </form>`;
}

function renderInicio() {
  renderEstado();
  $('listaDispositivos').innerHTML = [...app.dispositivos.values()].map(tarjetaDispositivo).join('');
  const n = app.contactos.length;
  $('avisoContactos').innerHTML = n
    ? `<h3>Contactos de emergencia</h3><ul class="lista contactos">${app.contactos.map((c) => `<li><span class="contacto"><span class="avatar">${esc(iniciales(c.nombre))}</span><span><strong>${esc(c.nombre)}</strong><span class="fecha">${esc(c.relacion)}</span></span></span><a class="boton secundario" style="width:auto;min-height:46px;padding:10px 14px" href="tel:${esc(c.telefono.replace(/\s/g, ''))}" aria-label="Llamar a ${esc(c.nombre)}"><svg><use href="#c-tel"/></svg></a></li>`).join('')}</ul>`
    : `<h3>Agrega un contacto de emergencia</h3><p class="nota">Si después de un sismo marcas «Necesito ayuda», Vigía tendrá a quién llamar.</p><br><button type="button" class="boton secundario" data-ir="tAjustes"><svg><use href="#c-mas"/></svg>Agregar contacto</button>`;
  renderResumenPlan();
}

function renderResumenPlan() {
  const total = app.kit.length || 12, listos = app.plan.kit.length;
  const pct = Math.round((listos / total) * 100);
  $('anilloPlan').style.setProperty('--p', pct);
  $('resumenPlan').textContent = `Kit ${listos} de ${total} · ${app.plan.encuentro ? `Encuentro: ${app.plan.encuentro}` : 'Falta el punto de encuentro'}`;
}

function renderAvisos() {
  const nuevos = app.comunicados.filter((c) => !c.leido).length;
  $('insignia').hidden = !nuevos;
  $('insignia').textContent = nuevos;
  const TIPO = { informativo: ['Informativo', 'var(--teal)'], mantenimiento: ['Mantenimiento', 'var(--ambar)'], simulacro: ['Simulacro', 'var(--violeta)'] };
  $('listaAvisos').innerHTML = app.comunicados.length ? app.comunicados.map((c, i) => {
    const [t, col] = TIPO[c.tipo] || TIPO.informativo;
    return `<article class="aviso${c.leido ? '' : ' nuevo'}" data-aviso="${c.id}" style="--c:${col};animation-delay:${i * 50}ms" tabindex="0">
      <p class="tipo">${t}${c.ciudad ? ` · ${esc(c.ciudad)}` : ''}</p><h3>${esc(c.titulo)}</h3><p>${esc(c.mensaje)}</p><span class="fecha">${fecha(c.fecha)}</span></article>`;
  }).join('') : '<div class="vacio-grande"><svg><use href="#c-campana"/></svg><p>No tienes avisos por ahora.</p></div>';
}

function renderPlan() {
  const marcados = new Set(app.plan.kit);
  $('kit').innerHTML = app.kit.map((k) => `<label><input type="checkbox" value="${k}"${marcados.has(k) ? ' checked' : ''}><span>${KIT[k]?.[0] || k}<small>${KIT[k]?.[1] || ''}</small></span></label>`).join('');
  pintarKit();
  const f = $('fPlan');
  for (const k of ['encuentro', 'encuentroAlterno', 'notas']) if (document.activeElement !== f[k]) f[k].value = app.plan[k] || '';
}
function pintarKit() {
  const total = app.kit.length, listos = app.plan.kit.length;
  $('anilloKit').style.setProperty('--p', total ? Math.round((listos / total) * 100) : 0);
  $('kitTexto').textContent = listos === total ? '¡Completo! Revísalo cada 6 meses.' : `${listos} de ${total} listos · te faltan ${total - listos}`;
}

function renderHistorial() {
  $('listaAlertas').innerHTML = app.alertas.length ? app.alertas.map((a, i) => `<li class="alerta-item" style="animation-delay:${i * 40}ms">
      <strong>Sismo${a.distanciaKm != null ? ` a ${a.distanciaKm} km de ${esc(a.dispositivo)}` : ''}</strong>
      <span class="fecha">${fecha(a.fecha)}</span>
      ${a.respuesta ? `<span>Respondiste: <b>${a.respuesta === 'bien' ? 'Estoy bien' : 'Necesito ayuda'}</b></span>`
        : `<div class="resp"><button type="button" class="boton secundario" data-resp-alerta="${a.id}" data-estado="bien">Estoy bien</button><button type="button" class="boton peligro" data-resp-alerta="${a.id}" data-estado="ayuda">Necesito ayuda</button></div>`}
    </li>`).join('') : '<li class="vacio">No ha habido alertas de sismo.</li>';
  $('listaEventos').innerHTML = app.eventos.length ? app.eventos.map((e, i) => `<li style="animation-delay:${i * 30}ms">
      <strong>${esc(e.nombre)} detectó ${num(e.pga)} g</strong><span class="fecha">${fecha(e.fecha)}</span>
    </li>`).join('') : '<li class="vacio">Tus dispositivos no han detectado vibraciones fuertes.</li>';
}

function renderAjustes() {
  $('ajustesDispositivos').innerHTML = [...app.dispositivos.values()].map(formularioAjustes).join('');
  $('listaContactos').innerHTML = app.contactos.length ? app.contactos.map((c) => `<li>
      <span class="contacto"><span class="avatar">${esc(iniciales(c.nombre))}</span><span><strong>${esc(c.nombre)}</strong><span class="fecha">${esc(c.telefono)}${c.relacion ? ' · ' + esc(c.relacion) : ''}</span></span></span>
      <button type="button" class="quitar" data-quitar="${c.id}" aria-label="Quitar a ${esc(c.nombre)}">Quitar</button>
    </li>`).join('') : '<li class="vacio">Todavía no tienes contactos.</li>';
  $('fContacto').hidden = app.contactos.length >= 5;
}

function renderTodo() { renderInicio(); renderAvisos(); renderPlan(); renderHistorial(); renderAjustes(); }

/* ============================ onda en vivo ============================ */
// Se dibuja con requestAnimationFrame: la línea se desliza suave aunque los datos lleguen cada 200 ms.
function dibujarOndas() {
  requestAnimationFrame(dibujarOndas);
  if ($('pApp').hidden || $('tInicio').hidden || document.hidden) return;
  const ahora = Date.now();
  const oscuro = document.documentElement.dataset.tema === 'oscuro';
  document.querySelectorAll('#listaDispositivos .disp').forEach((art) => {
    const d = app.dispositivos.get(art.dataset.id);
    if (!d) return;
    const c = art.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    const tope = Math.max(.3, d.umbral * 1.8), y = (v) => h - 10 * dpr - Math.min(v, tope) / tope * (h - 20 * dpr);
    x.clearRect(0, 0, w, h);
    x.setLineDash([8 * dpr, 7 * dpr]); x.lineWidth = 1.6 * dpr; x.strokeStyle = oscuro ? '#f2b134' : '#a86a00';
    x.beginPath(); x.moveTo(0, y(d.umbral)); x.lineTo(w, y(d.umbral)); x.stroke(); x.setLineDash([]);
    const hs = (historia.get(d.id) || []).filter((p) => ahora - p.t < VENTANA_MS + 400);
    if (hs.length < 2) return;
    const col = d.enAlerta ? '#e0401c' : (oscuro ? '#5fd0b6' : '#1f9d84');
    const px = (t) => w - ((ahora - t) / VENTANA_MS) * w;
    x.beginPath();
    hs.forEach((p, i) => (i ? x.lineTo(px(p.t), y(p.v)) : x.moveTo(px(p.t), y(p.v))));
    x.lineWidth = 3 * dpr; x.lineJoin = 'round'; x.strokeStyle = col; x.stroke();
    x.lineTo(px(hs.at(-1).t), h); x.lineTo(px(hs[0].t), h); x.closePath();
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col + '44'); gr.addColorStop(1, col + '00');
    x.fillStyle = gr; x.fill();
    art.querySelector('.valor').textContent = `${num(hs.at(-1).v, 3)} g`;
  });
}
requestAnimationFrame(dibujarOndas);

/* ============================ acciones ============================ */
document.addEventListener('click', async (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) return irA(ir.dataset.ir);
  const aviso = e.target.closest('[data-aviso]');
  if (aviso) return leerAviso(Number(aviso.dataset.aviso));
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.prueba) {
    b.disabled = true;
    // El aviso se muestra antes: la confirmación del dispositivo puede llegar antes que la respuesta HTTP.
    toast('Enviando la prueba… la alarma de tu dispositivo debe sonar.');
    const r = await api(`/api/cliente/dispositivos/${encodeURIComponent(b.dataset.prueba)}/prueba`, 'POST', {});
    if (!r.ok) toast(r.datos.error || 'No se pudo probar.');
    setTimeout(() => { b.disabled = false; }, 4000);
  }
  if (b.dataset.quitar) {
    const r = await api(`/api/cliente/contactos/${encodeURIComponent(b.dataset.quitar)}`, 'DELETE');
    if (r.ok) { app.contactos = app.contactos.filter((c) => String(c.id) !== b.dataset.quitar); renderAjustes(); renderInicio(); toast('Contacto eliminado.'); }
  }
  if (b.dataset.respAlerta) responder(Number(b.dataset.respAlerta), b.dataset.estado);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest('[data-ir], [data-aviso]');
  if (t) t.click();
});

async function leerAviso(id) {
  const c = app.comunicados.find((x) => x.id === id);
  if (!c || c.leido) return;
  c.leido = true;
  renderAvisos();
  await api(`/api/cliente/comunicados/${id}/leido`, 'POST', {});
}

document.addEventListener('input', (e) => {
  if (e.target.name === 'umbral') e.target.closest('.rango').querySelector('output').textContent = `${num(e.target.value)} g`;
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-ajustes]');
  if (!form) return;
  e.preventDefault();
  enviarFormulario(form, async (d, error) => {
    const id = form.dataset.ajustes;
    const r = await api(`/api/cliente/dispositivos/${encodeURIComponent(id)}`, 'PATCH', { nombre: d.nombre, direccion: d.direccion, umbral: Number(d.umbral) });
    if (!r.ok) return error(r.datos.error || 'No se pudo guardar.');
    app.dispositivos.set(id, r.datos.dispositivo);
    renderInicio(); renderAjustes();
    toast('Cambios guardados. Tu dispositivo ya usa la nueva sensibilidad.');
  });
});

$('fContacto').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/contactos', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo agregar.');
    app.contactos.push(r.datos.contacto);
    e.target.reset();
    renderAjustes(); renderInicio();
    toast(`${r.datos.contacto.nombre} quedó como contacto de emergencia.`);
  });
});

$('fClave').addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario(e.target, async (d, error) => {
    const r = await api('/api/cliente/clave', 'POST', d);
    if (!r.ok) return error(r.datos.error || 'No se pudo cambiar la contraseña.');
    e.target.reset();
    toast('Tu contraseña se cambió. Las sesiones en otros celulares se cerraron.');
  });
});

/* ============================ plan de emergencia ============================ */
let temporizadorPlan;
function guardarPlan() {
  clearTimeout(temporizadorPlan);
  $('guardado').textContent = 'Guardando…';
  temporizadorPlan = setTimeout(async () => {
    const f = $('fPlan');
    const plan = { kit: app.plan.kit, encuentro: f.encuentro.value, encuentroAlterno: f.encuentroAlterno.value, notas: f.notas.value };
    const r = await api('/api/cliente/plan', 'PUT', plan);
    if (r.ok) { app.plan = r.datos.plan; $('guardado').textContent = '✓ Guardado'; renderResumenPlan(); }
    else $('guardado').textContent = r.datos.error || 'No se pudo guardar';
  }, 600);
}
$('kit').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  app.plan.kit = [...$('kit').querySelectorAll('input:checked')].map((i) => i.value);
  pintarKit();
  guardarPlan();
});
$('fPlan').addEventListener('input', guardarPlan);
$('fPlan').addEventListener('submit', (e) => e.preventDefault());

/* ============================ alerta de sismo y simulacro ============================ */
let alertaAbierta = null, cuenta = null;
const PASOS_MS = 3500;

function prepararPantalla({ simulacro, k, t, d }) {
  $('alerta').classList.toggle('simulacro', simulacro);
  $('alK').textContent = k;
  $('alT').textContent = t;
  $('alD').textContent = d;
  $('alGracias').hidden = true;
  $('alerta').hidden = false;
  const inicio = Date.now();
  const pasos = [...$('alPasos').children];
  clearInterval(cuenta);
  const tic = () => {
    const ms = Date.now() - inicio;
    const s = Math.floor(ms / 1000);
    $('alCuenta').textContent = `${simulacro ? 'Práctica' : 'Protégete'} · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const paso = Math.floor(ms / PASOS_MS);
    const fin = simulacro && paso >= 3; // el simulacro recorre los 3 pasos una vez; la alerta real los repite
    pasos.forEach((p, i) => { p.classList.toggle('activo', !fin && i === paso % 3); p.classList.toggle('hecho', simulacro && (fin || i < paso)); });
    if (fin && !$('alerta').dataset.fin) {
      $('alerta').dataset.fin = '1';
      $('alGracias').hidden = false;
      $('alGracias').textContent = '¡Bien hecho! Así debes protegerte en un sismo real. Después, sal con calma y ve a tu punto de encuentro.';
    }
  };
  delete $('alerta').dataset.fin;
  tic();
  cuenta = setInterval(tic, 250);
}

function abrirAlerta(a, sonar = true) {
  alertaAbierta = a;
  prepararPantalla({
    simulacro: false, k: 'Alerta sísmica Vigía', t: '¡SISMO!',
    d: a.distanciaKm != null ? `Se detectó un sismo a ${a.distanciaKm} km de ${a.dispositivo}. Aléjate de las ventanas.` : 'Se detectó un sismo en la red Vigía. Aléjate de las ventanas.',
  });
  $('alBotones').hidden = !!a.respuesta;
  $('alerta').querySelector('.bien').focus();
  if (sonar) sirena();
  navigator.vibrate?.([600, 300, 600, 300, 600]);
}

function abrirSimulacro(titulo = 'Simulacro de sismo') {
  alertaAbierta = null;
  prepararPantalla({ simulacro: true, k: 'Simulacro · esto es una práctica', t: 'SIMULACRO', d: `${titulo}. Sigue los pasos que se iluminan.` });
  $('alBotones').hidden = true;
  navigator.vibrate?.([300, 200, 300]);
}
$('bPracticar').addEventListener('click', () => abrirSimulacro('Práctica en casa'));

$('alCerrar').onclick = () => { $('alerta').hidden = true; clearInterval(cuenta); };
$('alBotones').addEventListener('click', (e) => {
  const b = e.target.closest('[data-resp]');
  if (b && alertaAbierta) responder(alertaAbierta.id, b.dataset.resp);
});

async function responder(alertaId, estado) {
  const r = await api('/api/cliente/respuestas', 'POST', { alertaId, estado });
  if (!r.ok) return toast(r.datos.error || 'No se pudo enviar tu respuesta.');
  const a = app.alertas.find((x) => x.id === alertaId);
  if (a) a.respuesta = estado;
  renderHistorial();
  if (!$('alerta').hidden) {
    $('alBotones').hidden = true;
    $('alGracias').hidden = false;
    $('alGracias').textContent = estado === 'bien'
      ? 'Gracias. Registramos que estás bien.'
      : app.contactos.length
        ? `Registramos que necesitas ayuda. El equipo de Vigía ya ve tu solicitud con tu dirección y llamará a: ${app.contactos.map((c) => c.nombre).join(', ')}.`
        : 'Registramos que necesitas ayuda. El equipo de Vigía ya ve tu solicitud. Agrega contactos de emergencia en Ajustes.';
  } else {
    toast('Respuesta enviada.');
  }
}

function sirena() {
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)(), o = A.createOscillator(), g = A.createGain(), n = A.currentTime;
    o.type = 'square'; o.connect(g); g.connect(A.destination);
    for (let i = 0; i < 6; i++) { o.frequency.setValueAtTime(i % 2 ? 660 : 990, n + i * .45); }
    g.gain.setValueAtTime(.05, n); g.gain.setValueAtTime(0, n + 2.7);
    o.start(n); o.stop(n + 2.8); o.onended = () => A.close();
  } catch { /* el navegador puede bloquear el sonido si no hubo interacción */ }
}

/* ============================ tiempo real ============================ */
let ws = null;
function conectar() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/cliente`);
  const chip = $('conexion');
  ws.onopen = () => { chip.lastElementChild.textContent = 'En vivo'; chip.className = 'chip'; };
  ws.onclose = async (e) => {
    chip.lastElementChild.textContent = 'Sin conexión';
    chip.className = 'chip off';
    if ($('pApp').hidden || e.code === 4401) return;
    const sigue = await fetch('/api/cliente/resumen').then((r) => r.ok).catch(() => true);
    if (sigue) setTimeout(conectar, 2500); else mostrar('pAcceso');
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    switch (m.tipo) {
      case 'lecturas': {
        const t = Date.now();
        for (const l of m.datos) {
          const h = historia.get(l.id) || [];
          h.push({ v: l.m, t });
          while (h.length && t - h[0].t > VENTANA_MS + 1000) h.shift();
          historia.set(l.id, h);
          const d = app.dispositivos.get(l.id);
          if (d && d.enAlerta !== l.alerta) { d.enAlerta = l.alerta; renderInicio(); }
        }
        break;
      }
      case 'dispositivo':
        if (app.dispositivos.has(m.dispositivo.id)) { app.dispositivos.set(m.dispositivo.id, m.dispositivo); renderInicio(); }
        break;
      case 'evento':
        app.eventos.unshift(m.evento);
        if (app.dispositivos.has(m.dispositivo.id)) app.dispositivos.set(m.dispositivo.id, m.dispositivo);
        renderInicio(); renderHistorial();
        toast(`${m.evento.nombre} detectó una vibración de ${num(m.evento.pga)} g.`);
        break;
      case 'alerta':
        app.alertas.unshift(m.alerta);
        renderHistorial();
        abrirAlerta(m.alerta);
        break;
      case 'comunicado':
        app.comunicados.unshift(m.comunicado);
        renderAvisos();
        if (m.comunicado.tipo === 'simulacro') abrirSimulacro(m.comunicado.titulo);
        else toast(`Nuevo aviso de Vigía: ${m.comunicado.titulo}`);
        break;
      case 'desvinculado': { // la empresa desvinculó el dispositivo (por ejemplo, venta de la casa)
        const d = app.dispositivos.get(m.id);
        app.dispositivos.delete(m.id);
        toast(`${d ? d.nombre : 'Un dispositivo'} ya no está vinculado a tu cuenta.`);
        if (!app.dispositivos.size) { $('bVolver').hidden = true; mostrar('pVincular'); } else renderTodo();
        break;
      }
      case 'prueba_ok': {
        const d = app.dispositivos.get(m.id);
        toast(`La alarma de ${d ? d.nombre : 'tu dispositivo'} sonó correctamente.`);
        break;
      }
    }
  };
}

cargar().then(() => { if ($('pApp').hidden && $('pVincular').hidden) mostrar('pAcceso'); });
