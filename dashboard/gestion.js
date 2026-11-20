/*
 * Proyecto: Vigía · Sistema de alerta sísmica temprana
 * Archivo:  dashboard/gestion.js
 * Tipo:     JavaScript (navegador)
 * Capa:     Capa de presentación · panel de la empresa
 * Qué hace: Secciones de gestión del panel: historial con filtros y exportación CSV (RF04),
 *           dispositivos y clientes (búsqueda, batería, señal, prueba remota y desvinculación)
 *           y solicitudes de ayuda después de un sismo.
 */
'use strict';

(() => {
  const { $, esc, g, fechaHora, haceCuanto, pedir } = UI;

  /** Barra de intensidad para una aceleración (PGA). */
  const barraPga = (v) => {
    const col = v >= 0.5 ? '#8c1d06' : v >= 0.3 ? 'var(--coral)' : v >= 0.2 ? 'var(--ambar)' : 'var(--ok)';
    return `<span class="pga">${g(v)}<i style="--w:${Math.min(100, (v / 0.6) * 100)}%;--col:${col}"></i></span>`;
  };
  const vacio = (icono, texto) => `<div class="vacio-grande"><svg><use href="#${icono}"/></svg><p>${texto}</p></div>`;

  /* ============================== historial (RF04) ============================== */
  let pagina = 1;
  const filtros = () => {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData($('fFiltros'))) if (v !== '') p.set(k, k === 'min' ? String(v).replace(',', '.') : v);
    return p;
  };
  $('fFiltros').addEventListener('submit', (e) => { e.preventDefault(); buscar(1); });
  $('fFiltros').addEventListener('change', (e) => {
    if (e.target.name === 'tipo') { $('fFiltros').ciudad.disabled = e.target.value === 'alertas'; buscar(1); }
    $('bCSV').href = '/api/historial.csv?' + filtros();
  });
  $('hAnterior').onclick = () => buscar(pagina - 1);
  $('hSiguiente').onclick = () => buscar(pagina + 1);

  async function buscar(n) {
    const p = filtros();
    p.set('pagina', n);
    $('bCSV').href = '/api/historial.csv?' + filtros();
    const r = await pedir('/api/historial?' + p);
    if (!r.ok) { $('hEstado').textContent = r.datos.error || 'No se pudo consultar.'; return; }
    const { tipo, total, items, porPagina } = r.datos;
    pagina = r.datos.pagina;
    const ini = total ? (pagina - 1) * porPagina + 1 : 0, fin = Math.min(total, pagina * porPagina);
    const nombre = tipo === 'alertas' ? (total === 1 ? 'alerta encontrada' : 'alertas encontradas') : (total === 1 ? 'evento encontrado' : 'eventos encontrados');
    $('hEstado').textContent = total ? `${total.toLocaleString('es-CO')} ${nombre}` : '';
    $('hPagina').textContent = total ? `${ini}–${fin} de ${total}` : '';
    $('hAnterior').disabled = pagina <= 1;
    $('hSiguiente').disabled = fin >= total;
    if (!total) { $('tHistorial').innerHTML = `<tbody><tr><td>${vacio('i-reloj', 'No hay resultados con esos filtros.')}</td></tr></tbody>`; return; }
    $('tHistorial').innerHTML = tipo === 'alertas'
      ? `<thead><tr><th>Alerta</th><th>Fecha</th><th>Epicentro estimado</th><th class="num">Dispositivos</th><th class="num">PGA máx (g)</th><th>Respuesta de los hogares</th></tr></thead><tbody>${items.map((a, i) => `<tr style="animation-delay:${i * 15}ms">
          <td><span class="etq al plano">#${a.id}</span></td><td>${fechaHora(a.fecha)}</td><td>${g(a.lat, 2)}, ${g(a.lon, 2)}</td><td class="num">${a.dispositivos}</td><td class="num">${barraPga(a.pga_max)}</td>
          <td>${a.bien || a.ayuda ? `<span class="etq ok">${a.bien} bien</span> <span class="etq ${a.ayuda ? 'al' : 'off'}">${a.ayuda} piden ayuda</span>` : '<span class="tenue">Sin respuestas</span>'}</td></tr>`).join('')}</tbody>`
      : `<thead><tr><th>Evento</th><th>Fecha</th><th>Dispositivo</th><th>Ciudad</th><th class="num">PGA (g)</th></tr></thead><tbody>${items.map((e, i) => `<tr style="animation-delay:${i * 15}ms">
          <td class="tenue">#${e.id}</td><td>${fechaHora(e.fecha)}</td><td><b>${esc(e.nombre)}</b></td><td>${esc(e.ciudad)}</td><td class="num">${barraPga(e.pga)}</td></tr>`).join('')}</tbody>`;
  }

  async function cargarCiudades() {
    const r = await pedir('/api/ciudades');
    if (!r.ok) return;
    const opciones = r.datos.ciudades.map((c) => `<option>${esc(c)}</option>`).join('');
    $('fFiltros').ciudad.insertAdjacentHTML('beforeend', opciones);
    $('fComunicado').ciudad.insertAdjacentHTML('beforeend', r.datos.ciudades.map((c) => `<option value="${esc(c)}">Hogares de ${esc(c)}</option>`).join(''));
  }

  /* ============================== dispositivos y clientes ============================== */
  const barras = (dbm) => (dbm == null ? 0 : dbm > -55 ? 4 : dbm > -67 ? 3 : dbm > -75 ? 2 : 1);
  const senal = (dbm) => (dbm == null ? '<span class="tenue">–</span>' : `<span class="senal">${[1, 2, 3, 4].map((i) => `<i${i <= barras(dbm) ? ' class="on"' : ''}></i>`).join('')}</span>${['', 'Débil', 'Regular', 'Buena', 'Excelente'][barras(dbm)]}`);
  const bateria = (b) => (b == null ? '<span class="tenue">–</span>' : `<span class="bateria${b < 20 ? ' baja' : ''}"><i style="--b:${b / 100}"></i>${b} %</span>`);
  let red = null;

  async function cargarRed() {
    const r = await pedir('/api/red');
    if (!r.ok) return;
    red = r.datos;
    pintarRed();
  }
  function pintarRed() {
    if (!red) return;
    const { dispositivos, clientes } = red;
    const enLinea = dispositivos.filter((d) => d.enLinea).length, vinculados = dispositivos.filter((d) => d.dueno).length;
    const baja = dispositivos.filter((d) => d.bateria != null && d.bateria < 20).length;
    $('rCifras').innerHTML = [
      ['Dispositivos', dispositivos.length, 'en la red'], ['En línea', enLinea, `${Math.round((enLinea / (dispositivos.length || 1)) * 100)} % de la red`],
      ['Vinculados', vinculados, `${dispositivos.length - vinculados} libres`], ['Hogares', clientes.length, 'cuentas en Mi Vigía'],
      ['Contactos', clientes.reduce((s, c) => s + c.contactos, 0), 'de emergencia'], ['Batería baja', baja, baja ? 'requieren revisión' : 'todo en orden'],
    ].map(([t, n, s]) => `<div class="cifra"><span>${t}</span><strong>${n}</strong><small>${s}</small></div>`).join('');
    $('rResumen').textContent = `${dispositivos.length} dispositivos · ${enLinea} en línea · ${vinculados} vinculados a un hogar`;
    const q = $('rBuscar').value.trim().toLowerCase();
    const lista = dispositivos.filter((d) => !q || [d.nombre, d.ciudad, d.id, d.dueno?.nombre, d.dueno?.correo].some((x) => String(x || '').toLowerCase().includes(q)));
    const admin = UI.usuario?.rol === 'admin';
    $('tRedDispositivos').innerHTML = lista.length ? `<thead><tr><th>Dispositivo</th><th>Ciudad</th><th>Dueño</th><th>Conexión</th><th>Batería</th><th>WiFi</th><th class="num">Sensibilidad</th><th></th></tr></thead><tbody>${lista.map((d, i) => `<tr style="animation-delay:${i * 20}ms">
      <td><b>${esc(d.nombre)}</b><small>${esc(d.id)}</small></td><td>${esc(d.ciudad)}${d.direccion ? `<small>${esc(d.direccion)}</small>` : ''}</td>
      <td>${d.dueno ? `${esc(d.dueno.nombre)}<small>${esc(d.dueno.correo)}</small>` : '<span class="etq off">Sin vincular</span>'}</td>
      <td><span class="etq ${d.enLinea ? 'ok' : 'off'}">${d.enLinea ? 'En línea' : 'Desconectado'}</span><small>${d.enLinea ? '' : 'Última: ' + haceCuanto(d.ultimaConexion)}</small></td>
      <td>${bateria(d.bateria)}</td><td>${senal(d.wifi)}</td><td class="num">${g(d.umbral, 2)} g</td>
      <td><div class="acciones-fila">
        <button type="button" class="boton secundario mini" data-probar="${esc(d.id)}" ${d.enLinea ? '' : 'disabled'} title="Hacer sonar la alarma de prueba"><svg><use href="#i-campana"/></svg>Probar</button>
        ${admin && d.dueno ? `<button type="button" class="boton fantasma mini" data-desvincular="${esc(d.id)}" data-nombre="${esc(d.nombre)}" data-dueno="${esc(d.dueno.nombre)}">Desvincular</button>` : ''}
      </div></td></tr>`).join('')}</tbody>` : `<tbody><tr><td>${vacio('i-buscar', 'Ningún dispositivo coincide con la búsqueda.')}</td></tr></tbody>`;
    $('tClientes').innerHTML = clientes.length
      ? `<thead><tr><th>Cliente</th><th>Correo</th><th class="num">Dispositivos</th><th class="num">Contactos</th><th>Registro</th></tr></thead><tbody>${clientes.map((c, i) => `<tr style="animation-delay:${i * 20}ms">
        <td><span class="usuario-celda"><span class="avatar">${esc(UI.iniciales(c.nombre))}</span><b>${esc(c.nombre)}</b></span></td><td>${esc(c.correo)}</td><td class="num">${c.dispositivos}</td><td class="num">${c.contactos}</td><td>${fechaHora(c.creado)}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td>${vacio('i-users', 'Todavía no hay hogares registrados en Mi Vigía.')}</td></tr></tbody>`;
  }
  $('rBuscar').addEventListener('input', pintarRed);

  document.addEventListener('click', async (e) => {
    const probar = e.target.closest('[data-probar]');
    if (probar) {
      probar.disabled = true;
      const r = await pedir(`/api/dispositivos/${encodeURIComponent(probar.dataset.probar)}/prueba`, 'POST', {});
      UI.toast(r.ok ? 'Orden de prueba enviada. Esperando confirmación del dispositivo…' : r.datos.error || 'No se pudo probar.', r.ok ? 'info' : 'error');
      setTimeout(() => { probar.disabled = false; }, 3000);
      return;
    }
    const b = e.target.closest('[data-desvincular]');
    if (!b) return;
    const ok = await UI.confirmar('Desvincular dispositivo', `${b.dataset.nombre} dejará de pertenecer a ${b.dataset.dueno}. Su sensibilidad vuelve al valor recomendado y la app del cliente recibirá el aviso.`, 'Desvincular');
    if (!ok) return;
    const r = await pedir(`/api/dispositivos/${encodeURIComponent(b.dataset.desvincular)}/desvincular`, 'POST', {});
    UI.toast(r.ok ? `${b.dataset.nombre} quedó libre para vincularse de nuevo.` : r.datos.error || 'No se pudo desvincular.', r.ok ? 'ok' : 'error');
    if (r.ok) cargarRed();
  });

  /* ============================== solicitudes de ayuda ============================== */
  function contador(n) {
    $('contAyuda').hidden = !n;
    if ($('contAyuda').textContent !== String(n)) { $('contAyuda').textContent = n; $('contAyuda').style.animation = 'none'; void $('contAyuda').offsetWidth; $('contAyuda').style.animation = ''; }
    UI.contar($('kAyuda'), n);
    $('kAyuda').closest('.kpi').classList.toggle('activo', n > 0);
  }
  let solicitudes = [];
  async function cargarAyuda() {
    const r = await pedir('/api/ayuda');
    if (!r.ok) return;
    contador(r.datos.pendientes);
    solicitudes = r.datos.solicitudes;
    pintarAyuda();
  }
  function pintarAyuda() {
    const soloPendientes = document.querySelector('[name=fAyuda]:checked').value === 'pendientes';
    const lista = solicitudes.filter((s) => !soloPendientes || !s.atendida);
    $('listaAyuda').innerHTML = lista.length ? lista.map((s, i) => `<article class="solicitud ${s.atendida ? 'atendida' : 'pendiente'}" style="animation-delay:${i * 40}ms">
      <header><div><h3>${esc(s.nombre)}</h3><p>${esc(s.correo)} · alerta #${s.alerta_id} · ${haceCuanto(s.fecha)}</p></div>
        <span class="etq ${s.atendida ? 'ok' : 'al'}">${s.atendida ? 'Atendida' : 'Pendiente'}</span></header>
      <div class="cols">
        <div><h4>Dirección</h4>${s.dispositivos.length ? s.dispositivos.map((d) => `<p><b>${esc(d.nombre)}</b><br>${esc(d.direccion || 'Sin dirección registrada')}, ${esc(d.ciudad)}</p>`).join('') : '<p class="tenue">Sin dispositivos</p>'}</div>
        <div><h4>Contactos de emergencia</h4>${s.contactos.length ? s.contactos.map((c) => `<p>${esc(c.nombre)}${c.relacion ? ` <span class="tenue">(${esc(c.relacion)})</span>` : ''}<br><a class="tel" href="tel:${esc(c.telefono.replace(/\s/g, ''))}"><svg><use href="#i-tel"/></svg>${esc(c.telefono)}</a></p>`).join('') : '<p class="tenue">No registró contactos</p>'}</div>
      </div>
      ${s.atendida ? `<p class="nota">Atendida por <b>${esc(s.atendida_por)}</b> · ${fechaHora(s.atendida_fecha)}</p>` : `<button type="button" class="boton" data-atender="${s.id}"><svg><use href="#i-escudo"/></svg>Marcar como atendida</button>`}
    </article>`).join('') : vacio('i-sos', soloPendientes ? 'No hay solicitudes pendientes. ¡Todo atendido!' : 'No hay solicitudes de ayuda.');
  }
  document.querySelectorAll('[name=fAyuda]').forEach((r) => r.addEventListener('change', pintarAyuda));
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-atender]');
    if (!b) return;
    b.disabled = true;
    const r = await pedir(`/api/ayuda/${encodeURIComponent(b.dataset.atender)}/atender`, 'POST', {});
    if (r.ok) { UI.toast('Solicitud marcada como atendida.', 'ok'); cargarAyuda(); } else b.disabled = false;
  });

  /* ============================== registro de secciones ============================== */
  UI.registrar('historial', { id: 'vHistorial', titulo: 'Historial', miga: 'Operación', alMostrar: () => buscar(1) });
  UI.registrar('red', { id: 'vRed', titulo: 'Dispositivos y clientes', miga: 'Red y clientes', alMostrar: cargarRed });
  UI.registrar('ayuda', { id: 'vAyuda', titulo: 'Solicitudes de ayuda', miga: 'Red y clientes', alMostrar: cargarAyuda });

  /* ============================== tiempo real ============================== */
  document.addEventListener('vigia:mensaje', (e) => {
    const m = e.detail;
    if (m.tipo === 'solicitudes') {
      if (m.pendientes > Number($('contAyuda').textContent || 0)) UI.toast('Un hogar pidió ayuda después del sismo.', 'alerta', 7000);
      contador(m.pendientes);
      if (UI.vista === 'ayuda') cargarAyuda();
    }
    if (m.tipo === 'evento' && UI.vista === 'historial' && pagina === 1) buscar(1);
    if ((m.tipo === 'dispositivo' || m.tipo === 'prueba_ok') && UI.vista === 'red') cargarRed();
  });
  setInterval(() => { if (UI.vista === 'red' && !document.hidden) cargarRed(); }, 10_000);

  document.addEventListener('vigia:sesion', () => {
    cargarCiudades();
    pedir('/api/ayuda').then((r) => r.ok && contador(r.datos.pendientes));
  });
})();
