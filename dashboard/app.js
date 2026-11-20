/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/app.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Monitoreo en vivo: sesión del usuario, canal WebSocket, mapa animado de la red,
 *           sismógrafo (Chart.js), indicadores, lista de dispositivos con nivel de vibración,
 *           actividad reciente, aviso de alerta sísmica y simulación de sismos.
 */
'use strict';

const { $, g: fmt, hora, esc } = UI;

/* Estado del monitoreo */
const estado = {
  dispositivos: new Map(), // id -> { datos, m, x, y, z, punto, halo, fila }
  seleccionado: null,
  umbral: 0.15,
  eventos: [],
  alertas: [],
};
const HISTORIA = 150; // 150 lecturas × 200 ms = 30 s en el sismógrafo
const historia = new Map(); // id -> números

/* ============================== mapa ============================== */
const NS = 'http://www.w3.org/2000/svg';
const svg = $('mapa');
function el(nombre, attrs, padre = svg) {
  const n = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  padre.appendChild(n);
  return n;
}
el('polygon', { class: 'pais', points: MAPA.contorno.map(([lo, la]) => `${MAPA.x(lo)},${MAPA.y(la)}`).join(' ') });
const capaOndas = el('g', {});
const capaEtiquetas = el('g', {});
const capaHalos = el('g', {});
const capaPuntos = el('g', {});
const ciudadesDibujadas = new Set();
const tip = $('mapaTip');

function dibujarDispositivo(d) {
  const cx = MAPA.x(d.lon), cy = MAPA.y(d.lat);
  const halo = el('circle', { class: 'halo off', r: 7, cx, cy, style: `animation-delay:${(Math.random() * 3).toFixed(2)}s` }, capaHalos);
  const punto = el('circle', { class: 'disp off', r: 7, cx, cy, tabindex: 0, role: 'button', 'aria-label': `${d.nombre}, ${d.ciudad}` }, capaPuntos);
  punto.addEventListener('click', () => seleccionar(d.id));
  punto.addEventListener('keydown', (e) => { if (e.key === 'Enter') seleccionar(d.id); });
  punto.addEventListener('mouseenter', () => mostrarTip(d.id));
  punto.addEventListener('mouseleave', () => { tip.hidden = true; });
  const pos = d.ciudad in MAPA.etiquetas ? MAPA.etiquetas[d.ciudad] : [10, 4, 'start'];
  if (pos && !ciudadesDibujadas.has(d.ciudad)) {
    ciudadesDibujadas.add(d.ciudad);
    el('text', { class: 'ciudad', x: cx + pos[0], y: cy + pos[1], 'text-anchor': pos[2] }, capaEtiquetas).textContent = d.ciudad;
  }
  return { punto, halo };
}

function mostrarTip(id) {
  const d = estado.dispositivos.get(id);
  const caja = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const escala = Math.min(caja.width / vb.width, caja.height / vb.height);
  const ox = (caja.width - vb.width * escala) / 2, oy = (caja.height - vb.height * escala) / 2;
  tip.style.left = `${ox + MAPA.x(d.datos.lon) * escala}px`;
  tip.style.top = `${oy + MAPA.y(d.datos.lat) * escala}px`;
  const c = claseEstado(d.datos);
  tip.innerHTML = `<b>${esc(d.datos.nombre)}</b>${esc(d.datos.ciudad)} · ${textoEstado[c]}${d.datos.enLinea && d.m != null ? ` · ${fmt(d.m)} g` : ''}`;
  tip.hidden = false;
}

function mostrarEpicentro(lat, lon) {
  capaOndas.replaceChildren();
  const cx = MAPA.x(lon), cy = MAPA.y(lat);
  for (let i = 0; i < 4; i++) {
    const c = el('circle', { class: 'onda', cx, cy, r: 8 }, capaOndas);
    el('animate', { attributeName: 'r', from: 8, to: 150, dur: '3.2s', begin: `${i * 0.8}s`, repeatCount: 'indefinite' }, c);
    el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '3.2s', begin: `${i * 0.8}s`, repeatCount: 'indefinite' }, c);
  }
  el('path', { class: 'cruz', d: `M${cx - 12} ${cy}h24M${cx} ${cy - 12}v24` }, capaOndas);
  el('circle', { class: 'epi', cx, cy, r: 6 }, capaOndas);
  clearTimeout(mostrarEpicentro.t);
  mostrarEpicentro.t = setTimeout(() => capaOndas.replaceChildren(), 90_000);
}

/* ============================== sismógrafo ============================== */
let grafica = null;
function crearGrafica() {
  if (!window.Chart) { $('gSub').textContent = 'No se pudo cargar Chart.js (ejecuta npm install)'; return; }
  const c = UI.colores();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = c.tenue;
  const ctx = $('grafica').getContext('2d');
  const relleno = (col) => {
    const gr = ctx.createLinearGradient(0, 0, 0, 230);
    gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00');
    return gr;
  };
  grafica?.destroy();
  grafica = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(HISTORIA).fill(''),
      datasets: [
        { label: 'Aceleración |a| (g)', data: Array(HISTORIA).fill(null), borderColor: c.teal, backgroundColor: relleno(c.teal.startsWith('#') ? c.teal : '#17806c'), fill: true, borderWidth: 2.2, pointRadius: 0, tension: .3 },
        { label: 'Umbral de alerta', data: Array(HISTORIA).fill(estado.umbral), borderColor: c.ambar, borderDash: [6, 5], borderWidth: 1.6, pointRadius: 0, fill: false },
      ],
    },
    options: {
      animation: false, maintainAspectRatio: false, responsive: true,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: { display: false },
        y: { min: 0, suggestedMax: .3, grid: { color: c.linea }, border: { display: false }, ticks: { callback: (v) => `${String(v).replace('.', ',')} g`, maxTicksLimit: 6 } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { enabled: false } },
    },
  });
  grafica.$relleno = relleno;
  actualizarGrafica();
}

function actualizarGrafica() {
  if (!grafica || !estado.seleccionado) return;
  const h = historia.get(estado.seleccionado) || [];
  const d = estado.dispositivos.get(estado.seleccionado);
  const c = UI.colores();
  const col = d?.datos.enAlerta ? c.coral : c.teal;
  const ds = grafica.data.datasets[0];
  ds.data = Array(HISTORIA - h.length).fill(null).concat(h);
  if (ds.borderColor !== col) { ds.borderColor = col; ds.backgroundColor = grafica.$relleno(col.startsWith('#') ? col : '#17806c'); }
  grafica.data.datasets[1].data = Array(HISTORIA).fill(d?.datos.umbral ?? estado.umbral);
  grafica.update('none');
  const pico = h.length ? Math.max(...h) : null;
  $('gPico').textContent = pico == null ? '' : `Pico 30 s: ${fmt(pico)} g`;
}

/* ============================== render ============================== */
function claseEstado(d) { return !d.enLinea ? 'off' : d.enAlerta ? 'al' : 'ok'; }
const textoEstado = { ok: 'En línea', off: 'Desconectado', al: 'ALERTA' };

function crearFila(d) {
  const fila = document.createElement('div');
  fila.className = 'fila-disp off';
  fila.setAttribute('role', 'listitem');
  fila.tabIndex = 0;
  fila.innerHTML = `<span class="led"></span><span><b>${esc(d.nombre)}</b><small>${esc(d.ciudad)}</small></span><span class="nivel"><i></i></span><span class="valor">–</span>`;
  fila.addEventListener('click', () => seleccionar(d.id));
  fila.addEventListener('keydown', (e) => { if (e.key === 'Enter') seleccionar(d.id); });
  $('tablaDispositivos').appendChild(fila);
  return { fila, barra: fila.querySelector('.nivel i'), valor: fila.querySelector('.valor') };
}

function renderDispositivo(id) {
  const d = estado.dispositivos.get(id);
  const c = claseEstado(d.datos);
  const sel = id === estado.seleccionado;
  d.punto.setAttribute('class', `disp ${c}${sel ? ' sel' : ''}`);
  d.halo.setAttribute('class', `halo ${c}`);
  d.fila.className = `fila-disp ${c}${sel ? ' sel' : ''}`;
  const m = d.datos.enLinea ? d.m : null;
  d.valor.textContent = m == null ? '–' : fmt(m, 2);
  d.barra.style.width = m == null ? '0' : `${Math.min(100, (m / Math.max(.3, d.datos.umbral * 2)) * 100)}%`;
}

function renderKpis() {
  const todos = [...estado.dispositivos.values()].map((d) => d.datos);
  const enLinea = todos.filter((d) => d.enLinea).length;
  const enAlerta = todos.filter((d) => d.enLinea && d.enAlerta).length;
  UI.contar($('kEnLinea'), enLinea);
  $('kTotal').textContent = `/ ${todos.length}`;
  $('anilloLinea').style.setProperty('--p', todos.length ? Math.round((enLinea / todos.length) * 100) : 0);
  UI.contar($('kAlerta'), enAlerta);
  $('kAlerta').closest('.kpi').classList.toggle('activo', enAlerta > 0);
  UI.contar($('kEventos'), estado.eventos.length);
  UI.contar($('kAlertas'), estado.alertas.length);
  $('estadoRed').textContent = enAlerta ? `Sismo en curso · ${enAlerta} en alerta` : enLinea === todos.length ? 'Red estable' : `${todos.length - enLinea} sin conexión`;
  $('estadoRed').className = `estado-red${enAlerta ? ' al' : ''}`;
}

function renderActividad() {
  const items = [
    ...estado.alertas.map((a) => ({ tipo: 'alerta', fecha: a.fecha, titulo: `Sismo confirmado · ${a.dispositivos} dispositivos`, texto: `PGA máx ${fmt(a.pga_max, 2)} g${a.bien || a.ayuda ? ` · ${a.bien || 0} bien, ${a.ayuda || 0} piden ayuda` : ''}` })),
    ...estado.eventos.map((e) => ({ tipo: 'evento', fecha: e.fecha, titulo: `${e.nombre} · ${fmt(e.pga, 2)} g`, texto: e.ciudad })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 25);
  $('actividad').innerHTML = items.length
    ? items.map((i) => `<li class="${i.tipo}"><b>${esc(i.titulo)}</b><span>${esc(i.texto)} · ${hora(i.fecha)}</span></li>`).join('')
    : '<li class="vacio">Sin actividad todavía. Cuando un dispositivo detecte una vibración aparecerá aquí.</li>';
}

function seleccionar(id) {
  const anterior = estado.seleccionado;
  estado.seleccionado = id;
  if (anterior && anterior !== id) renderDispositivo(anterior);
  renderDispositivo(id);
  const d = estado.dispositivos.get(id);
  $('gTitulo').textContent = d.datos.nombre;
  $('gSub').textContent = `${d.datos.ciudad} · ${d.datos.lat.toFixed(3)}, ${d.datos.lon.toFixed(3)} · umbral ${fmt(d.datos.umbral ?? estado.umbral, 2)} g`;
  for (const k of ['x', 'y', 'z', 'm']) $('v' + k).textContent = d[k] == null ? '–' : fmt(d[k]);
  actualizarGrafica();
}

/* ============================== alerta ============================== */
let alertaActiva = null, relojAlerta = null;
function mostrarAviso(a, nueva = true) {
  alertaActiva = a;
  $('avisoTexto').textContent = `Confirmada por ${a.dispositivos} dispositivos · aceleración máxima ${fmt(a.pga_max, 2)} g · epicentro estimado ${fmt(a.lat, 2)}, ${fmt(a.lon, 2)}`;
  $('aviso').hidden = false;
  if (nueva) {
    document.body.classList.add('en-alerta');
    UI.sirena();
    clearTimeout(mostrarAviso.t);
    mostrarAviso.t = setTimeout(() => document.body.classList.remove('en-alerta'), 20_000);
  }
  clearInterval(relojAlerta);
  const pintar = () => {
    const s = Math.round((Date.now() - new Date(a.fecha)) / 1000);
    $('avisoTiempo').textContent = s < 60 ? `hace ${s} s` : `hace ${Math.floor(s / 60)} min`;
    if (s > 300) ocultarAviso();
  };
  pintar();
  relojAlerta = setInterval(pintar, 1000);
}
function ocultarAviso() {
  $('aviso').hidden = true;
  document.body.classList.remove('en-alerta');
  clearInterval(relojAlerta);
}
$('avisoCerrar').addEventListener('click', ocultarAviso);

/* ============================== sesión ============================== */
const irAlLogin = () => location.replace('/login.html');

async function verificarSesion() {
  const r = await fetch('/api/sesion');
  if (!r.ok) { irAlLogin(); return null; }
  const u = (await r.json()).usuario;
  UI.usuario = u;
  $('nombreUsuario').textContent = u.nombre;
  $('rolUsuario').textContent = u.rol === 'admin' ? 'Administrador' : 'Operador';
  $('avatar').textContent = UI.iniciales(u.nombre);
  document.querySelectorAll('.solo-admin').forEach((n) => { n.hidden = u.rol !== 'admin'; });
  document.dispatchEvent(new CustomEvent('vigia:sesion', { detail: u }));
  document.body.classList.remove('cargando');
  UI.ir(location.hash.slice(1) || 'monitoreo');
  return u;
}

$('salir').addEventListener('click', async () => {
  if (!(await UI.confirmar('Cerrar sesión', '¿Quieres salir del panel de monitoreo?', 'Cerrar sesión'))) return;
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  irAlLogin();
});

UI.registrar('monitoreo', {
  id: 'vMonitoreo', titulo: 'Monitoreo en vivo', miga: 'Operación',
  alMostrar: () => { grafica?.resize(); actualizarGrafica(); },
});
document.addEventListener('vigia:tema', crearGrafica);

/* ============================== datos iniciales ============================== */
async function cargar() {
  const r = await fetch('/api/estado');
  if (r.status === 401) return irAlLogin();
  const datos = await r.json();
  estado.umbral = datos.config.umbral;
  estado.eventos = datos.eventos;
  estado.alertas = datos.alertas;
  // La simulación solo la ve un administrador y solo si el modo simulación está activo.
  $('cajaSimulacion').hidden = !(datos.config.modoSimulacion && UI.usuario?.rol === 'admin');
  for (const d of datos.dispositivos) {
    if (!estado.dispositivos.has(d.id)) estado.dispositivos.set(d.id, { datos: d, m: null, ...dibujarDispositivo(d), ...crearFila(d) });
    estado.dispositivos.get(d.id).datos = d;
    renderDispositivo(d.id);
  }
  if (!estado.seleccionado && datos.dispositivos.length) seleccionar((datos.dispositivos.find((d) => d.ciudad === 'Bogotá') || datos.dispositivos[0]).id);
  renderActividad(); renderKpis();
  // Si hay una alerta de hace menos de 5 minutos, el aviso sigue visible al recargar.
  const reciente = estado.alertas[0];
  if (reciente && Date.now() - new Date(reciente.fecha) < 300_000) { mostrarAviso(reciente, false); mostrarEpicentro(reciente.lat, reciente.lon); }
}

/* ============================== tiempo real ============================== */
let pendienteRender = false;
function conectar() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/panel`);
  const chip = $('conexion');
  ws.onopen = () => { chip.lastElementChild.textContent = 'En vivo'; chip.classList.remove('caido'); cargar(); };
  ws.onclose = async (e) => {
    chip.lastElementChild.textContent = 'Reconectando…';
    chip.classList.add('caido');
    // Si la sesión venció o se cerró, volver al inicio de sesión en lugar de reintentar.
    const sigue = e.code !== 4401 && (await fetch('/api/sesion').then((r) => r.ok).catch(() => true));
    if (sigue) setTimeout(conectar, 2000); else irAlLogin();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    // Las demás secciones del panel también escuchan los mensajes en vivo.
    document.dispatchEvent(new CustomEvent('vigia:mensaje', { detail: msg }));
    switch (msg.tipo) {
      case 'lecturas': {
        for (const l of msg.datos) {
          const d = estado.dispositivos.get(l.id);
          if (!d) continue;
          Object.assign(d, { m: l.m, x: l.x, y: l.y, z: l.z });
          d.datos.enAlerta = l.alerta;
          const h = historia.get(l.id) || [];
          h.push(l.m); if (h.length > HISTORIA) h.shift();
          historia.set(l.id, h);
        }
        // Se dibuja en el siguiente cuadro de animación para que el panel se mueva fluido.
        if (!pendienteRender && UI.vista === 'monitoreo' && !document.hidden) {
          pendienteRender = true;
          requestAnimationFrame(() => {
            pendienteRender = false;
            for (const id of estado.dispositivos.keys()) renderDispositivo(id);
            const s = estado.dispositivos.get(estado.seleccionado);
            if (s) for (const k of ['x', 'y', 'z', 'm']) $('v' + k).textContent = s[k] == null ? '–' : fmt(s[k]);
            actualizarGrafica(); renderKpis();
          });
        }
        break;
      }
      case 'dispositivo': {
        const d = estado.dispositivos.get(msg.dispositivo.id);
        if (d) { d.datos = { ...d.datos, ...msg.dispositivo }; renderDispositivo(d.datos.id); renderKpis(); }
        break;
      }
      case 'evento':
        estado.eventos.unshift(msg.evento);
        estado.eventos.length = Math.min(estado.eventos.length, 50);
        if (estado.dispositivos.has(msg.dispositivo.id)) { const d = estado.dispositivos.get(msg.dispositivo.id); d.datos = { ...d.datos, ...msg.dispositivo }; renderDispositivo(d.datos.id); }
        renderActividad(); renderKpis();
        break;
      case 'alerta': {
        estado.alertas.unshift(msg.alerta);
        // El sismógrafo salta al dispositivo que registró la mayor sacudida reciente.
        const fuerte = estado.eventos.filter((ev) => Date.now() - new Date(ev.fecha) < 30_000).sort((a, b) => b.pga - a.pga)[0];
        if (fuerte && estado.dispositivos.has(fuerte.dispositivo_id)) seleccionar(fuerte.dispositivo_id);
        mostrarAviso(msg.alerta);
        mostrarEpicentro(msg.alerta.lat, msg.alerta.lon);
        renderActividad(); renderKpis();
        UI.toast(`Sismo confirmado por ${msg.alerta.dispositivos} dispositivos. Se avisó a toda la red.`, 'alerta', 7000);
        break;
      }
      case 'respuesta': { // un hogar respondió «Estoy bien» o «Necesito ayuda» desde Mi Vigía
        const a = estado.alertas.find((x) => x.id === msg.alertaId);
        if (a) { a.bien = msg.bien; a.ayuda = msg.ayuda; renderActividad(); }
        break;
      }
      case 'alerta_actualizada': {
        const a = estado.alertas.find((x) => x.id === msg.alerta.id);
        if (a) { Object.assign(a, msg.alerta); renderActividad(); if (alertaActiva?.id === a.id && !$('aviso').hidden) mostrarAviso(a, false); }
        break;
      }
      case 'prueba_ok':
        UI.toast(`La alarma de ${msg.nombre} sonó correctamente.`, 'ok');
        break;
    }
  };
}

/* ============================== simulación ============================== */
const NIVELES = [[5, 'Leve', 'var(--ok)'], [6, 'Moderado', 'var(--ambar)'], [7, 'Fuerte', 'var(--coral)'], [9, 'Severo', '#8c1d06']];
function pintarMagnitud() {
  const v = Number($('magnitud').value);
  $('magTxt').textContent = v.toFixed(1).replace('.', ',');
  const [, nombre, col] = NIVELES.find(([max]) => v < max) || NIVELES.at(-1);
  $('magNivel').textContent = nombre;
  $('magNivel').style.color = col;
}
$('magnitud').addEventListener('input', pintarMagnitud);
pintarMagnitud();
$('formSimulacion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const [lat, lon] = $('epicentro').value.split(',').map(Number);
  const boton = e.submitter; boton.disabled = true;
  try {
    const r = await UI.pedir('/api/simulacion', 'POST', { lat, lon, magnitud: Number($('magnitud').value) });
    $('simEstado').textContent = r.ok ? `Sismo enviado a ${r.datos.enviados} dispositivos. Observa el mapa y el sismógrafo.` : `Error: ${r.datos.error}`;
    if (r.ok) UI.toast(`Simulación enviada a ${r.datos.enviados} dispositivos.`, 'aviso');
  } catch {
    $('simEstado').textContent = 'No se pudo contactar al servidor.';
  } finally {
    setTimeout(() => { boton.disabled = false; }, 3000);
  }
});

crearGrafica();
verificarSesion().then((u) => { if (u) conectar(); });
