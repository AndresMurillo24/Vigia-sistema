/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/gestion.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Secciones de gestión del panel: historial con filtros y exportación CSV (RF04),
 *           dispositivos y clientes de la red, y solicitudes de ayuda después de un sismo.
 */
'use strict';

(() => {
  const porId = (id) => document.getElementById(id);
  // Todo texto que viene del servidor se escapa antes de insertarlo (evita XSS).
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = (v, d = 3) => (v == null ? '–' : Number(v).toFixed(d).replace('.', ','));
  const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
  let usuario = null;

  async function pedir(url, opciones) {
    const r = await fetch(url, opciones);
    if (r.status === 401) location.replace('/login.html');
    return { ok: r.ok, datos: await r.json().catch(() => ({})) };
  }
  const postJSON = (url) => pedir(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

  /* ---------------- navegación entre secciones ---------------- */
  const vistas = { vMonitoreo: null, vHistorial: () => buscar(1), vRed: cargarRed, vAyuda: cargarAyuda };
  let vistaActual = 'vMonitoreo';
  document.querySelectorAll('.vistas [data-vista]').forEach((b) => b.addEventListener('click', () => {
    vistaActual = b.dataset.vista;
    document.querySelectorAll('.vistas [data-vista]').forEach((x) => x.toggleAttribute('aria-current', x === b));
    for (const id of Object.keys(vistas)) porId(id).hidden = id !== vistaActual;
    if (vistaActual === 'vMonitoreo') window.dispatchEvent(new Event('resize')); // redibuja la gráfica
    vistas[vistaActual]?.();
    history.replaceState(null, '', vistaActual === 'vMonitoreo' ? location.pathname : '#' + vistaActual.slice(1).toLowerCase());
  }));

  /* ---------------- historial (RF04) ---------------- */
  let pagina = 1;
  const filtros = () => {
    const f = new FormData(porId('fFiltros'));
    const p = new URLSearchParams();
    for (const [k, v] of f) if (v !== '') p.set(k, k === 'min' ? String(v).replace(',', '.') : v);
    return p;
  };
  porId('fFiltros').addEventListener('submit', (e) => { e.preventDefault(); buscar(1); });
  porId('fFiltros').addEventListener('change', (e) => {
    if (e.target.name === 'tipo') porId('fFiltros').ciudad.disabled = e.target.value === 'alertas';
    porId('bCSV').href = '/api/historial.csv?' + filtros();
  });
  porId('hAnterior').onclick = () => buscar(pagina - 1);
  porId('hSiguiente').onclick = () => buscar(pagina + 1);

  async function buscar(n) {
    const p = filtros();
    p.set('pagina', n);
    porId('bCSV').href = '/api/historial.csv?' + filtros();
    const r = await pedir('/api/historial?' + p);
    if (!r.ok) { porId('hEstado').textContent = r.datos.error || 'No se pudo consultar.'; return; }
    const { tipo, total, items, porPagina } = r.datos;
    pagina = r.datos.pagina;
    const ini = total ? (pagina - 1) * porPagina + 1 : 0, fin = Math.min(total, pagina * porPagina);
    const nombre = tipo === 'alertas' ? (total === 1 ? 'alerta encontrada' : 'alertas encontradas') : (total === 1 ? 'evento encontrado' : 'eventos encontrados');
    porId('hEstado').textContent = total ? `${total} ${nombre}` : 'No hay resultados con esos filtros.';
    porId('hPagina').textContent = total ? `${ini}–${fin} de ${total}` : '';
    porId('hAnterior').disabled = pagina <= 1;
    porId('hSiguiente').disabled = fin >= total;
    porId('tHistorial').innerHTML = tipo === 'alertas'
      ? `<thead><tr><th>Alerta</th><th>Fecha</th><th>Epicentro estimado</th><th class="num">Dispositivos</th><th class="num">PGA máx (g)</th><th>Respuestas de los hogares</th></tr></thead><tbody>${items.map((a) => `<tr>
          <td>#${a.id}</td><td>${fechaHora(a.fecha)}</td><td>${g(a.lat, 2)}, ${g(a.lon, 2)}</td><td class="num">${a.dispositivos}</td><td class="num">${g(a.pga_max)}</td>
          <td>${a.bien || a.ayuda ? `${a.bien} bien · <b>${a.ayuda} piden ayuda</b>` : '–'}</td></tr>`).join('')}</tbody>`
      : `<thead><tr><th>Evento</th><th>Fecha</th><th>Dispositivo</th><th>Ciudad</th><th class="num">PGA (g)</th></tr></thead><tbody>${items.map((e) => `<tr>
          <td>#${e.id}</td><td>${fechaHora(e.fecha)}</td><td>${esc(e.nombre)}</td><td>${esc(e.ciudad)}</td><td class="num">${g(e.pga)}</td></tr>`).join('')}</tbody>`;
  }

  async function cargarCiudades() {
    const r = await pedir('/api/ciudades');
    if (!r.ok) return;
    porId('fFiltros').ciudad.insertAdjacentHTML('beforeend', r.datos.ciudades.map((c) => `<option>${esc(c)}</option>`).join(''));
  }

  /* ---------------- dispositivos y clientes ---------------- */
  const senal = (dbm) => (dbm == null ? '–' : dbm > -55 ? 'Excelente' : dbm > -67 ? 'Buena' : dbm > -75 ? 'Regular' : 'Débil');
  async function cargarRed() {
    const r = await pedir('/api/red');
    if (!r.ok) return;
    const { dispositivos, clientes } = r.datos;
    const enLinea = dispositivos.filter((d) => d.enLinea).length, vinculados = dispositivos.filter((d) => d.dueno).length;
    porId('rResumen').textContent = `${dispositivos.length} dispositivos · ${enLinea} en línea · ${vinculados} vinculados a un cliente`;
    const admin = usuario?.rol === 'admin';
    porId('tRedDispositivos').innerHTML = `<thead><tr><th>Dispositivo</th><th>Ciudad</th><th>Dueño</th><th>Conexión</th><th class="num">Batería</th><th>WiFi</th><th class="num">Sensibilidad</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>${dispositivos.map((d) => `<tr>
      <td><b>${esc(d.nombre)}</b><small>${esc(d.id)}</small></td><td>${esc(d.ciudad)}${d.direccion ? `<small>${esc(d.direccion)}</small>` : ''}</td>
      <td>${d.dueno ? `${esc(d.dueno.nombre)}<small>${esc(d.dueno.correo)}</small>` : '<span class="tenue">Sin vincular</span>'}</td>
      <td><span class="etq ${d.enLinea ? 'ok' : 'off'}">${d.enLinea ? 'En línea' : 'Desconectado'}</span><small>${d.ultimaConexion ? 'Última: ' + fechaHora(d.ultimaConexion) : ''}</small></td>
      <td class="num${d.bateria != null && d.bateria < 20 ? ' bajo' : ''}">${d.bateria == null ? '–' : d.bateria + ' %'}</td><td>${senal(d.wifi)}</td><td class="num">${g(d.umbral, 2)} g</td>
      ${admin ? `<td>${d.dueno ? `<button type="button" class="salir" data-desvincular="${esc(d.id)}">Desvincular</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody>`;
    porId('tClientes').innerHTML = clientes.length
      ? `<thead><tr><th>Cliente</th><th>Correo</th><th class="num">Dispositivos</th><th class="num">Contactos</th><th>Registro</th></tr></thead><tbody>${clientes.map((c) => `<tr>
        <td>${esc(c.nombre)}</td><td>${esc(c.correo)}</td><td class="num">${c.dispositivos}</td><td class="num">${c.contactos}</td><td>${fechaHora(c.creado)}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="tenue">Todavía no hay clientes registrados.</td></tr></tbody>';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-desvincular]');
    if (!b) return;
    if (!confirmarEnLinea(b, '¿Seguro? Toca otra vez para desvincular')) return;
    const r = await postJSON(`/api/dispositivos/${encodeURIComponent(b.dataset.desvincular)}/desvincular`);
    if (r.ok) cargarRed();
  });
  /** Confirmación en dos toques, sin ventanas emergentes del navegador. */
  function confirmarEnLinea(boton, texto) {
    if (boton.dataset.confirmando) return true;
    boton.dataset.confirmando = '1';
    const original = boton.textContent;
    boton.textContent = texto;
    setTimeout(() => { delete boton.dataset.confirmando; boton.textContent = original; }, 4000);
    return false;
  }

  /* ---------------- solicitudes de ayuda ---------------- */
  function contador(n) {
    porId('contAyuda').hidden = !n;
    porId('contAyuda').textContent = n;
  }
  async function cargarAyuda() {
    const r = await pedir('/api/ayuda');
    if (!r.ok) return;
    contador(r.datos.pendientes);
    const lista = r.datos.solicitudes;
    porId('listaAyuda').innerHTML = lista.length ? lista.map((s) => `<article class="solicitud${s.atendida ? ' atendida' : ''}">
      <header><div><h3>${esc(s.nombre)}</h3><p>${esc(s.correo)} · alerta #${s.alerta_id} · ${fechaHora(s.fecha)}</p></div>
        <span class="etq ${s.atendida ? 'ok' : 'al'}">${s.atendida ? 'Atendida' : 'Pendiente'}</span></header>
      <div class="cols">
        <div><h4>Dirección</h4>${s.dispositivos.length ? s.dispositivos.map((d) => `<p>${esc(d.nombre)}: ${esc(d.direccion || 'sin dirección registrada')}, ${esc(d.ciudad)}</p>`).join('') : '<p class="tenue">Sin dispositivos</p>'}</div>
        <div><h4>Contactos de emergencia</h4>${s.contactos.length ? s.contactos.map((c) => `<p>${esc(c.nombre)}${c.relacion ? ` (${esc(c.relacion)})` : ''}: <a href="tel:${esc(c.telefono.replace(/\s/g, ''))}">${esc(c.telefono)}</a></p>`).join('') : '<p class="tenue">No registró contactos</p>'}</div>
      </div>
      ${s.atendida ? `<p class="tenue">Atendida por ${esc(s.atendida_por)} · ${fechaHora(s.atendida_fecha)}</p>` : `<button type="button" class="boton" data-atender="${s.id}">Marcar como atendida</button>`}
    </article>`).join('') : '<p class="tenue">No hay solicitudes de ayuda.</p>';
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-atender]');
    if (!b) return;
    b.disabled = true;
    const r = await postJSON(`/api/ayuda/${encodeURIComponent(b.dataset.atender)}/atender`);
    if (r.ok) cargarAyuda(); else b.disabled = false;
  });

  /* ---------------- tiempo real ---------------- */
  document.addEventListener('vigia:mensaje', (e) => {
    const m = e.detail;
    if (m.tipo === 'solicitudes') {
      contador(m.pendientes);
      if (vistaActual === 'vAyuda') cargarAyuda();
    }
    if (m.tipo === 'evento' && vistaActual === 'vHistorial' && pagina === 1) buscar(1);
  });
  setInterval(() => { if (vistaActual === 'vRed' && !document.hidden) cargarRed(); }, 10_000);

  document.addEventListener('vigia:sesion', (e) => {
    usuario = e.detail;
    cargarCiudades();
    pedir('/api/ayuda').then((r) => r.ok && contador(r.datos.pendientes));
    const ir = { '#historial': 'vHistorial', '#red': 'vRed', '#ayuda': 'vAyuda' }[location.hash];
    if (ir) document.querySelector(`.vistas [data-vista="${ir}"]`).click();
  });
})();
