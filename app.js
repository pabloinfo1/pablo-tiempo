const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
const MAX_DATA_AGE_MS = 30 * 60 * 1000; // 30 minutos
let municipiosDB = [];
let municipiosCargando = true;
let deferredInstallPrompt = null;
let currentWeatherData = null;
let lastFetchTimestamp = 0;
let diaSeleccionadoIndex = null; // null = Próximas 24h desde hora actual, >0 = Día futuro seleccionado

const DEFAULT_ADV_PREFS = {
  uv: false,
  nieve: false,
  tormenta: false,
  sensacion: false,
  viento: false
};

/* --- FUNCIÓN DE RASTREO (ANALYTICS) --- */
function trackEvent(eventName, eventParams = {}) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, eventParams);
  }
}

function cargarPreferenciasAvanzadas() {
  try {
    const guardadas = JSON.parse(localStorage.getItem('app_advanced_prefs'));
    if (guardadas && typeof guardadas === 'object') {
      return { ...DEFAULT_ADV_PREFS, ...guardadas };
    }
  } catch {
    // Ignorar error de parseo y usar valores por defecto
  }
  return { ...DEFAULT_ADV_PREFS };
}

let advPrefs = cargarPreferenciasAvanzadas();

/* --- UTILIDADES, ESCAPADO XSS Y REPARACIÓN DE CODIFICACIÓN --- */
function escaparHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function repararTextoMojibake(str) {
  if (typeof str !== 'string') return str;
  if (!/[ÃÂâ]/.test(str)) return str;
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code > 255) return str;
      bytes[i] = code;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return str;
  }
}

function obtenerNombreMunicipioLimpio(data) {
  const ineActual = String(data?.municipio?.id_ine || localStorage.getItem('saved_ine') || '').padStart(5, '0');
  if (municipiosDB.length > 0 && ineActual) {
    const encontrado = municipiosDB.find(m => m.id_ine === ineActual);
    if (encontrado && encontrado.nombre) {
      return encontrado.nombre;
    }
  }
  return repararTextoMojibake(data?.municipio?.nombre || 'Localidad');
}

function normalizarTexto(str) {
  if (!str) return '';
  return repararTextoMojibake(String(str))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function primerValorDefinido(...valores) {
  for (const val of valores) {
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return undefined;
}

function parsearPrecipitacionMm(valorRaw) {
  if (valorRaw === undefined || valorRaw === null || valorRaw === '') return 0;
  if (typeof valorRaw === 'number') return valorRaw > 0 ? valorRaw : 0;
  const str = String(valorRaw).trim().toLowerCase();
  if (str === 'ip') return 0.1;
  const num = parseFloat(str.replace(',', '.'));
  return (!isNaN(num) && num > 0) ? num : 0;
}

function parsearProbabilidadPct(valorRaw) {
  if (valorRaw === undefined || valorRaw === null || valorRaw === '') return null;
  const num = typeof valorRaw === 'number' ? valorRaw : parseInt(String(valorRaw).trim(), 10);
  if (isNaN(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function extraerNumeroHora(horaStr) {
  if (horaStr === undefined || horaStr === null) return null;
  const num = parseInt(String(horaStr).trim().split(':')[0], 10);
  return isNaN(num) ? null : num;
}

function obtenerFechaLocalISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let toastTimeout;
function mostrarToast(mensaje, icono = 'info') {
  const toast = document.getElementById('toast-notification');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');
  if (!toast) return;

  toastMsg.textContent = mensaje;
  toastIcon.textContent = icono;

  toast.classList.remove('opacity-0', '-translate-y-4');
  toast.classList.add('opacity-100', 'translate-y-0');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', '-translate-y-4');
  }, 3500);
}

function setEstadoCarga(cargando) {
  const content = document.getElementById('weather-content');
  if (!content) return;

  if (cargando) {
    content.classList.add('animate-pulse', 'opacity-50', 'pointer-events-none');
    const carrusel = document.getElementById('ui-carrusel-horas');
    if (carrusel && carrusel.children.length === 0) {
      carrusel.innerHTML = Array(6).fill(`
        <div class="snap-start shrink-0 bg-md-surface-container rounded-2xl p-4 flex flex-col items-center w-20 h-28 shadow-sm"></div>
      `).join('');
    }
    const lista = document.getElementById('ui-lista-dias');
    if (lista && lista.children.length === 0) {
      lista.innerHTML = Array(5).fill(`
        <div class="h-14 border-b border-border-color last:border-0"></div>
      `).join('');
    }
  } else {
    content.classList.remove('animate-pulse', 'opacity-50', 'pointer-events-none');
  }
}

/* --- BLOQUEO DE ZOOM POR DOBLE TOQUE Y PINCH EN iOS --- */
function bloquearZoomIOS() {
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('gesturestart', (event) => {
    event.preventDefault();
  }, { passive: false });
}

bloquearZoomIOS();

/* --- NAVEGACIÓN INFERIOR DINÁMICA --- */
function actualizarBarraNavegacion(seccionActiva = 'tiempo') {
  const mapaBotones = {
    tiempo: document.getElementById('btn-tiempo'),
    buscar: document.getElementById('btn-search'),
    opciones: document.getElementById('btn-options')
  };

  Object.entries(mapaBotones).forEach(([clave, btn]) => {
    if (!btn) return;
    const icon = btn.querySelector('.nav-icon');
    const label = btn.querySelector('.nav-label');
    const activo = clave === seccionActiva;

    if (activo) {
      btn.className = 'nav-btn flex items-center justify-center gap-2 px-5 py-2.5 bg-md-surface-container-high rounded-full transition-all duration-200 text-md-primary';
      if (icon) icon.style.fontVariationSettings = "'FILL' 1";
      if (label) label.classList.remove('hidden');
    } else {
      btn.className = 'nav-btn flex items-center justify-center p-2.5 hover:bg-md-surface-container/50 rounded-full transition-all duration-200 text-text-muted hover:text-text-main';
      if (icon) icon.style.fontVariationSettings = "'FILL' 0";
      if (label) label.classList.add('hidden');
    }
  });
}

/* --- CONFIGURACIÓN PWA --- */
function inicializarPWA() {
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  const iconUrl = new URL('favicon.png', baseUrl).href;

  const manifest = {
    name: 'Pablómetro - El Tiempo',
    short_name: 'Pablómetro',
    start_url: baseUrl,
    scope: baseUrl,
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#1b6ef3',
    icons: [
      {
        src: iconUrl,
        sizes: '192x192 512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  };

  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(link);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const pwaSection = document.getElementById('pwa-install-section');
    if (pwaSection) pwaSection.classList.add('hidden');
    mostrarToast('Aplicación instalada correctamente', 'check_circle');
  });
}

inicializarPWA();

/* --- PROCESAMIENTO Y SINCRONIZACIÓN HORARIA --- */
function agruparHorasPorSaltosDeDia(horasTotales) {
  if (!Array.isArray(horasTotales) || horasTotales.length === 0) return [];
  const grupos = [[]];
  let diaActualIdx = 0;
  let horaAnteriorNum = null;

  horasTotales.forEach((item, idx) => {
    const horaNum = item._horaNum ?? extraerNumeroHora(item.hora);
    if (idx > 0 && horaNum !== null && horaAnteriorNum !== null && horaNum < horaAnteriorNum) {
      diaActualIdx++;
      grupos[diaActualIdx] = [];
    }
    if (horaNum !== null) horaAnteriorNum = horaNum;
    grupos[diaActualIdx].push(item);
  });

  return grupos;
}

function obtenerHorasParaDia(data, diaObj, indexEnLista) {
  if (!data || !diaObj) return [];
  if (Array.isArray(diaObj.horas) && diaObj.horas.length > 0) return diaObj.horas;

  if (Array.isArray(data.hoy_horas) && data.hoy_horas.length > 0) {
    if (diaObj.fecha) {
      const fechaDia = String(diaObj.fecha).slice(0, 10);
      const porFecha = data.hoy_horas.filter(h => h.fecha && String(h.fecha).startsWith(fechaDia));
      if (porFecha.length > 0) return porFecha;
    }
    const grupos = agruparHorasPorSaltosDeDia(data.hoy_horas);
    if (grupos[indexEnLista] && grupos[indexEnLista].length > 0) {
      return grupos[indexEnLista];
    }
  }

  return [];
}

function obtenerEstadoSincronizado(data) {
  const ahora = new Date();
  const fechaHoyISO = obtenerFechaLocalISO(ahora);
  const horaActualNum = ahora.getHours();

  let poolHoras = [];
  if (Array.isArray(data.hoy_horas) && data.hoy_horas.length > 0) {
    poolHoras = data.hoy_horas;
  } else if (Array.isArray(data.proximos_dias)) {
    data.proximos_dias.forEach((d, idx) => {
      const hDia = obtenerHorasParaDia(data, d, idx);
      if (hDia.length > 0) {
        poolHoras.push(...hDia.map(h => ({ ...h, fecha: h.fecha || d.fecha })));
      }
    });
  }

  let horasFuturas = [];
  if (poolHoras.length > 0) {
    horasFuturas = poolHoras.filter(h => {
      const fechaItem = String(h.fecha || '').slice(0, 10);
      const horaNum = h._horaNum ?? extraerNumeroHora(h.hora);
      if (!fechaItem || horaNum === null) return true;
      if (fechaItem > fechaHoyISO) return true;
      if (fechaItem === fechaHoyISO) return horaNum >= horaActualNum;
      return false;
    });
  }

  if (horasFuturas.length === 0 && poolHoras.length > 0) {
    horasFuturas = poolHoras;
  }

  const proximas24Horas = horasFuturas.slice(0, 24);
  const horaEnCurso = proximas24Horas[0] || {};
  const baseActual = data.actual || {};

  const actualSincronizado = {
    ...baseActual,
    hora: primerValorDefinido(horaEnCurso.hora, baseActual.hora),
    temperatura: primerValorDefinido(horaEnCurso.temperatura, baseActual.temperatura),
    estado_cielo: primerValorDefinido(horaEnCurso.estado_cielo, baseActual.estado_cielo),
    icono: primerValorDefinido(horaEnCurso.icono, baseActual.icono, 'cloud'),
    humedad: primerValorDefinido(horaEnCurso.humedad, baseActual.humedad),
    viento_kmh: primerValorDefinido(horaEnCurso.viento_kmh, baseActual.viento_kmh),
    sensacion_termica: primerValorDefinido(horaEnCurso.sensacion_termica, baseActual.sensacion_termica, horaEnCurso.temperatura, baseActual.temperatura),
    prob_precipitacion: primerValorDefinido(horaEnCurso.prob_precipitacion, baseActual.prob_precipitacion),
    precipitacion_mm: primerValorDefinido(horaEnCurso.precipitacion_mm, baseActual.precipitacion_mm),
    cota_nieve: primerValorDefinido(horaEnCurso.cota_nieve, baseActual.cota_nieve),
    prob_tormenta: primerValorDefinido(horaEnCurso.prob_tormenta, baseActual.prob_tormenta),
    rachas_viento: primerValorDefinido(horaEnCurso.rachas_viento, baseActual.rachas_viento),
    direccion_viento: primerValorDefinido(horaEnCurso.direccion_viento, baseActual.direccion_viento),
    uv: primerValorDefinido(horaEnCurso.uv, baseActual.uv)
  };

  return { actualSincronizado, proximas24Horas };
}

function extraerDatosAvanzadosActuales(data, actualSincronizado) {
  const actual = actualSincronizado || data.actual || {};
  const dia0 = (Array.isArray(data.proximos_dias) && data.proximos_dias[0]) || {};

  return {
    uv: primerValorDefinido(actual.uv, dia0.uv_max),
    nieveRaw: primerValorDefinido(actual.cota_nieve, dia0.cota_nieve),
    tormenta: primerValorDefinido(actual.prob_tormenta, dia0.prob_tormenta),
    sensacion: primerValorDefinido(actual.sensacion_termica, actual.temperatura),
    racha: primerValorDefinido(actual.rachas_viento, dia0.racha_max, actual.viento_kmh),
    direccion: primerValorDefinido(actual.direccion_viento, dia0.direccion_viento)
  };
}

/* --- ALERTAS Y MODAL DETALLADO DE AVISOS --- */
function obtenerEstilosNivelAlerta(nivelRaw) {
  const nivelNorm = normalizarTexto(nivelRaw);
  if (nivelNorm.includes('roj')) {
    return {
      etiqueta: 'Aviso Rojo · Riesgo Extremo',
      etiquetaCorta: 'Aviso Rojo',
      badgeStyle: 'background-color: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.5); color: #ef4444;',
      iconWrapStyle: 'background-color: rgba(239, 68, 68, 0.18); color: #ef4444;',
      descripcionFallback: 'Riesgo meteorológico extremo (fenómenos no habituales de intensidad excepcional). Se recomienda extremar la precaución y seguir las indicaciones oficiales.'
    };
  }
  if (nivelNorm.includes('naranj')) {
    return {
      etiqueta: 'Aviso Naranja · Riesgo Importante',
      etiquetaCorta: 'Aviso Naranja',
      badgeStyle: 'background-color: rgba(249, 115, 22, 0.18); border: 1px solid rgba(249, 115, 22, 0.5); color: #f97316;',
      iconWrapStyle: 'background-color: rgba(249, 115, 22, 0.18); color: #f97316;',
      descripcionFallback: 'Riesgo meteorológico importante. Existe un grado de peligro para las actividades usuales en la zona afectada.'
    };
  }
  if (nivelNorm.includes('amarill')) {
    return {
      etiqueta: 'Aviso Amarillo · Riesgo',
      etiquetaCorta: 'Aviso Amarillo',
      badgeStyle: 'background-color: rgba(234, 179, 8, 0.18); border: 1px solid rgba(234, 179, 8, 0.5); color: #eab308;',
      iconWrapStyle: 'background-color: rgba(234, 179, 8, 0.18); color: #eab308;',
      descripcionFallback: 'No existe riesgo meteorológico para la población en general, aunque sí para alguna actividad concreta expuesta al fenómeno.'
    };
  }
  const limpio = String(nivelRaw || 'Activo');
  return {
    etiqueta: limpio.toLowerCase().startsWith('aviso') ? limpio : `Aviso ${limpio}`,
    etiquetaCorta: limpio.toLowerCase().startsWith('aviso') ? limpio : `Aviso ${limpio}`,
    badgeStyle: 'background-color: rgba(59, 130, 246, 0.16); border: 1px solid rgba(59, 130, 246, 0.45); color: var(--md-primary);',
    iconWrapStyle: 'background-color: rgba(59, 130, 246, 0.16); color: var(--md-primary);',
    descripcionFallback: 'Aviso meteorológico oficial activo para este municipio o zona.'
  };
}

function extraerAlertasActivas(data) {
  if (!data || !Array.isArray(data.alertas)) return [];
  const vistas = new Set();
  const alertasLimpias = [];

  data.alertas.forEach(item => {
    if (!item) return;
    const nivel = repararTextoMojibake(String(item.nivel || 'Aviso activo'));
    const fenomeno = repararTextoMojibake(String(item.fenomeno || ''));
    const descripcion = repararTextoMojibake(String(item.descripcion || ''));

    const clave = `${normalizarTexto(nivel)}-${normalizarTexto(fenomeno)}`;
    if (!vistas.has(clave)) {
      vistas.add(clave);
      alertasLimpias.push({ nivel, fenomeno, descripcion });
    }
  });

  return alertasLimpias;
}

function abrirModalAlerta(alertaPrincipal, todasLasAlertas = []) {
  const modal = document.getElementById('alert-modal');
  const panel = document.getElementById('alert-modal-panel');
  const iconWrap = document.getElementById('alert-modal-icon-wrap');
  const badge = document.getElementById('alert-modal-badge');
  const title = document.getElementById('alert-modal-title');
  const municipioEl = document.getElementById('alert-modal-municipio');
  const descEl = document.getElementById('alert-modal-desc');
  const otherContainer = document.getElementById('alert-modal-list-container');
  const otherList = document.getElementById('alert-modal-other-list');

  if (!modal || !alertaPrincipal) return;

  const estilos = obtenerEstilosNivelAlerta(alertaPrincipal.nivel);
  iconWrap.style.cssText = estilos.iconWrapStyle;
  badge.style.cssText = estilos.badgeStyle;
  badge.textContent = estilos.etiqueta;

  title.textContent = alertaPrincipal.fenomeno || estilos.etiquetaCorta;
  municipioEl.textContent = obtenerNombreMunicipioLimpio(currentWeatherData);
  descEl.textContent = alertaPrincipal.descripcion || estilos.descripcionFallback;

  const otras = todasLasAlertas.filter(a => a !== alertaPrincipal);
  if (otras.length > 0 && otherContainer && otherList) {
    otherContainer.classList.remove('hidden');
    otherContainer.classList.add('flex');
    otherList.innerHTML = '';

    otras.forEach(otra => {
      const estOtra = obtenerEstilosNivelAlerta(otra.nivel);
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = 'w-full text-left p-3 rounded-2xl bg-md-surface-container hover:bg-md-surface-container-high transition flex items-center justify-between gap-2 border border-border-color/50';
      const tituloOtra = `${estOtra.etiquetaCorta}${otra.fenomeno ? ` · ${otra.fenomeno}` : ''}`;
      const descOtra = otra.descripcion || estOtra.descripcionFallback;

      itemBtn.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="material-symbols-rounded text-[18px] shrink-0" style="color: ${estOtra.badgeStyle.split('color:')[1] || 'var(--md-primary)'}">warning</span>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-bold text-text-main truncate">${escaparHTML(tituloOtra)}</span>
            <span class="text-xs text-text-muted truncate">${escaparHTML(descOtra)}</span>
          </div>
        </div>
        <span class="material-symbols-rounded text-text-muted text-base shrink-0">chevron_right</span>
      `;
      itemBtn.addEventListener('click', () => abrirModalAlerta(otra, todasLasAlertas));
      otherList.appendChild(itemBtn);
    });
  } else if (otherContainer) {
    otherContainer.classList.add('hidden');
    otherContainer.classList.remove('flex');
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  void modal.offsetWidth;
  modal.classList.remove('opacity-0');
  if (panel) panel.classList.remove('scale-95');
}

function cerrarModalAlerta() {
  const modal = document.getElementById('alert-modal');
  const panel = document.getElementById('alert-modal-panel');
  if (!modal || modal.classList.contains('hidden')) return;

  modal.classList.add('opacity-0');
  if (panel) panel.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 300);
}

/* --- LÓGICA METEOROLÓGICA --- */
async function cargarTiempo(ine, silencioso = false) {
  if (!silencioso) setEstadoCarga(true);
  try {
    const res = await fetch(`${WORKER_URL}?ine=${encodeURIComponent(ine)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentWeatherData = await res.json();
    lastFetchTimestamp = Date.now();
    if (!silencioso) diaSeleccionadoIndex = null;

    localStorage.setItem('saved_ine', ine);
    renderizarUI();
  } catch (error) {
    console.error('Fallo al cargar el tiempo:', error);
    if (!currentWeatherData) {
      document.getElementById('ui-municipio').textContent = 'Error de conexión';
    }
    mostrarToast('No se pudo conectar con el servidor meteorológico', 'cloud_off');
  } finally {
    if (!silencioso) setEstadoCarga(false);
  }
}

function renderizarCarrusel(horasArray, titulo = 'Próximas horas', esDiaFuturo = false) {
  const tituloEl = document.getElementById('titulo-carrusel-horas');
  const btnVolverHoy = document.getElementById('btn-volver-hoy');

  if (tituloEl) {
    tituloEl.textContent = titulo;
    tituloEl.classList.remove('text-text-muted');
    tituloEl.classList.add('text-md-primary');
    setTimeout(() => {
      tituloEl.classList.add('text-text-muted');
      tituloEl.classList.remove('text-md-primary');
    }, 900);
  }

  if (btnVolverHoy) {
    if (esDiaFuturo) {
      btnVolverHoy.classList.remove('hidden');
      btnVolverHoy.classList.add('flex');
    } else {
      btnVolverHoy.classList.add('hidden');
      btnVolverHoy.classList.remove('flex');
    }
  }

  const carrusel = document.getElementById('ui-carrusel-horas');
  if (!carrusel) return;
  carrusel.innerHTML = '';
  carrusel.scrollTo({ left: 0, behavior: 'smooth' });

  horasArray.forEach((hora, index) => {
    const probPrecip = parsearProbabilidadPct(hora.prob_precipitacion);
    const precipMm = parsearPrecipitacionMm(hora.precipitacion_mm);

    const probMostrar = probPrecip !== null ? probPrecip : 0;
    let bloquePrecipitacionHTML = `
      <div class="flex items-center gap-[2px] text-md-primary" title="Probabilidad de precipitación">
        <span class="material-symbols-rounded text-[14px]">water_drop</span>
        <span class="text-[11px] font-bold">${probMostrar}%</span>
      </div>
    `;

    if (precipMm > 0) {
      const mmFormateado = Number.isInteger(precipMm) ? precipMm : precipMm.toFixed(1).replace('.0', '');
      bloquePrecipitacionHTML += `
        <span class="mt-1 px-1.5 py-0.5 rounded-md bg-md-primary/15 text-md-primary text-[10px] font-semibold leading-none whitespace-nowrap" title="Precipitación acumulada prevista">
          💧 ${mmFormateado} mm
        </span>
      `;
    }

    let detallesExtraHoraHTML = '';
    const itemsExtraHora = [];

    if (advPrefs.sensacion && hora.sensacion_termica !== undefined) {
      itemsExtraHora.push(`ST ${escaparHTML(hora.sensacion_termica)}°`);
    }
    if (advPrefs.tormenta) {
      const torm = parsearProbabilidadPct(hora.prob_tormenta);
      if (torm !== null) itemsExtraHora.push(`⚡ ${torm}%`);
    }
    if (advPrefs.viento) {
      const rachaH = primerValorDefinido(hora.rachas_viento, hora.viento_kmh);
      const dirH = hora.direccion_viento || '';
      if (rachaH !== undefined) itemsExtraHora.push(`${escaparHTML(rachaH)}km/h${dirH ? ' ' + escaparHTML(dirH) : ''}`);
    }
    if (advPrefs.nieve) {
      const nieveH = hora.cota_nieve;
      if (nieveH !== undefined && nieveH !== null && nieveH !== '0' && nieveH !== 0) {
        const nieveTxt = String(nieveH).endsWith('m') ? nieveH : `${nieveH}m`;
        itemsExtraHora.push(`❄ ${escaparHTML(nieveTxt)}`);
      }
    }

    if (itemsExtraHora.length > 0) {
      detallesExtraHoraHTML = `
        <div class="w-full border-t border-border-color/60 mt-2 pt-1.5 flex flex-col items-center gap-0.5 text-[10px] text-text-muted font-medium leading-tight text-center">
          ${itemsExtraHora.map(txt => `<span class="truncate max-w-full">${txt}</span>`).join('')}
        </div>
      `;
    }

    const esAhora = !esDiaFuturo && index === 0;
    const etiquetaHora = esAhora ? 'Ahora' : escaparHTML(hora.hora || '--:--');
    const card = document.createElement('div');
    const anchoCard = (itemsExtraHora.length > 0 || precipMm > 0) ? 'w-[96px]' : 'w-[84px]';
    const bordeAhora = esAhora
      ? 'ring-2 ring-inset ring-md-primary/50 bg-md-surface-container-high/70'
      : 'bg-md-surface-container';

    card.className = `snap-start shrink-0 ${bordeAhora} rounded-2xl p-3.5 flex flex-col items-center ${anchoCard} shadow-sm transition-all`;

    card.innerHTML = `
      <span class="text-xs ${esAhora ? 'font-bold text-md-primary' : 'font-medium text-text-muted'} mb-1.5">${etiquetaHora}</span>
      <span class="material-symbols-rounded text-[30px] text-md-primary mb-1.5">${escaparHTML(hora.icono || 'cloud')}</span>
      <span class="text-[17px] font-semibold text-text-main leading-none mb-2">${escaparHTML(hora.temperatura ?? '--')}°</span>
      <div class="flex flex-col items-center mt-auto">
        ${bloquePrecipitacionHTML}
      </div>
      ${detallesExtraHoraHTML}
    `;
    carrusel.appendChild(card);
  });
}

function formatearFechaActualizacion(isoString) {
  const fecha = isoString ? new Date(isoString) : new Date();
  if (isNaN(fecha.getTime())) return '';

  const ahora = new Date();
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mm = String(fecha.getMinutes()).padStart(2, '0');

  const fechaISO = obtenerFechaLocalISO(fecha);
  const hoyISO = obtenerFechaLocalISO(ahora);

  if (fechaISO === hoyISO) {
    return `Última actualización: hoy a las ${hh}:${mm}`;
  }

  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  if (fechaISO === obtenerFechaLocalISO(ayer)) {
    return `Última actualización: ayer a las ${hh}:${mm}`;
  }

  const fechaCorta = fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `Última actualización: ${fechaCorta} a las ${hh}:${mm}`;
}

function renderizarUI() {
  if (!currentWeatherData) return;
  const data = currentWeatherData;

  const { actualSincronizado, proximas24Horas } = obtenerEstadoSincronizado(data);

  document.getElementById('ui-municipio').textContent = obtenerNombreMunicipioLimpio(data);
  document.getElementById('ui-temp-actual').textContent = actualSincronizado.temperatura ?? '--';
  document.getElementById('ui-desc-actual').textContent = repararTextoMojibake(actualSincronizado.estado_cielo ?? '--');
  document.getElementById('ui-humedad').textContent = `${actualSincronizado.humedad ?? '--'}%`;
  document.getElementById('ui-viento').textContent = `${actualSincronizado.viento_kmh ?? '--'} km/h`;
  document.getElementById('ui-icono-actual').textContent = actualSincronizado.icono || 'cloud';

  // Alertas y Avisos Meteorológicos (AEMET)
  const alertasDiv = document.getElementById('ui-alertas');
  const alertasActivas = extraerAlertasActivas(data);

  if (alertasDiv) {
    if (alertasActivas.length > 0) {
      alertasDiv.classList.remove('hidden');
      alertasDiv.classList.add('flex');
      alertasDiv.innerHTML = '';

      alertasActivas.forEach(alerta => {
        const estilos = obtenerEstilosNivelAlerta(alerta.nivel);
        const textoFenomeno = alerta.fenomeno ? ` · ${alerta.fenomeno}` : '';
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.style.cssText = estilos.badgeStyle;
        badge.className = 'px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold shadow-sm transition hover:opacity-90 active:scale-95 cursor-pointer';
        badge.innerHTML = `
          <span class="material-symbols-rounded text-[16px]">warning</span>
          <span>${escaparHTML(estilos.etiquetaCorta + textoFenomeno)}</span>
        `;

        badge.addEventListener('click', () => {
          abrirModalAlerta(alerta, alertasActivas);
        });

        alertasDiv.appendChild(badge);
      });
    } else {
      alertasDiv.classList.add('hidden');
      alertasDiv.classList.remove('flex');
      alertasDiv.innerHTML = '';
    }
  }

  // Datos extra configurables por el usuario
  const extraDiv = document.getElementById('ui-datos-extra');
  const showAnyAdv = Object.values(advPrefs).some(Boolean);

  if (showAnyAdv && extraDiv) {
    extraDiv.classList.remove('hidden');
    extraDiv.classList.add('flex');

    const { uv, nieveRaw, tormenta, sensacion, racha, direccion } = extraerDatosAvanzadosActuales(data, actualSincronizado);
    const tarjetasExtra = [];

    const crearChipExtra = (icono, etiqueta, valor) => `
      <div class="flex items-center gap-2.5 bg-md-surface/75 px-3.5 py-2.5 rounded-2xl border border-border-color/60 flex-1 min-w-[138px] max-w-[210px]">
        <span class="material-symbols-rounded text-[20px] text-md-primary shrink-0">${escaparHTML(icono)}</span>
        <div class="flex flex-col min-w-0">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none truncate">${escaparHTML(etiqueta)}</span>
          <span class="text-sm font-semibold text-text-main leading-tight mt-1 truncate">${escaparHTML(valor)}</span>
        </div>
      </div>
    `;

    if (advPrefs.sensacion) {
      tarjetasExtra.push(crearChipExtra('thermostat', 'Sensación', sensacion !== undefined ? `${sensacion}°` : '--°'));
    }
    if (advPrefs.uv) {
      tarjetasExtra.push(crearChipExtra('wb_sunny', 'Índice UV', uv !== undefined ? `${uv}` : '--'));
    }
    if (advPrefs.tormenta) {
      tarjetasExtra.push(crearChipExtra('thunderstorm', 'Tormenta', tormenta !== undefined ? `${tormenta}%` : '0%'));
    }
    if (advPrefs.nieve) {
      let valNieve = 'Sin nieve';
      if (nieveRaw !== undefined && nieveRaw !== null && nieveRaw !== 0 && nieveRaw !== '0') {
        valNieve = String(nieveRaw).endsWith('m') ? String(nieveRaw) : `${nieveRaw} m`;
      }
      tarjetasExtra.push(crearChipExtra('ac_unit', 'Cota nieve', valNieve));
    }
    if (advPrefs.viento) {
      const velTxt = racha !== undefined ? `${racha} km/h` : '-- km/h';
      const dirTxt = direccion ? ` ${direccion}` : '';
      tarjetasExtra.push(crearChipExtra('air', 'Rachas viento', `${velTxt}${dirTxt}`));
    }

    extraDiv.innerHTML = tarjetasExtra.join('');
  } else if (extraDiv) {
    extraDiv.classList.add('hidden');
    extraDiv.classList.remove('flex');
    extraDiv.innerHTML = '';
  }

  // Renderizado del carrusel
  if (diaSeleccionadoIndex !== null && data.proximos_dias?.[diaSeleccionadoIndex]) {
    const diaSel = data.proximos_dias[diaSeleccionadoIndex];
    const horasDiaSel = obtenerHorasParaDia(data, diaSel, diaSeleccionadoIndex);
    if (horasDiaSel.length > 0) {
      renderizarCarrusel(horasDiaSel, `Horas: ${repararTextoMojibake(diaSel.dia_semana)}`, true);
    } else {
      diaSeleccionadoIndex = null;
      renderizarCarrusel(proximas24Horas, 'Próximas horas', false);
    }
  } else {
    renderizarCarrusel(proximas24Horas, 'Próximas horas', false);
  }

  renderizarListaDias(data);

  const actualizacionEl = document.getElementById('ui-ultima-act');
  if (actualizacionEl) {
    actualizacionEl.textContent = formatearFechaActualizacion(data.actualizado_en);
  }
}

function renderizarListaDias(data) {
  const lista = document.getElementById('ui-lista-dias');
  if (!lista || !Array.isArray(data.proximos_dias)) return;
  lista.innerHTML = '';

  data.proximos_dias.forEach((dia, index) => {
    if (index === 0) return;

    const horasDelDia = obtenerHorasParaDia(data, dia, index);
    const hasHoras = horasDelDia.length > 0;
    const isSelected = diaSeleccionadoIndex === index;

    const row = document.createElement('div');
    const clasesInteractivas = hasHoras
      ? 'cursor-pointer hover:bg-md-surface-container-high/60 active:bg-md-surface-container-high'
      : '';
    const clasesSeleccionado = isSelected
      ? 'bg-md-surface-container-high/80 border-l-4 border-l-md-primary'
      : '';

    row.className = `flex justify-between items-center p-4 border-b border-border-color last:border-0 transition-all ${clasesInteractivas} ${clasesSeleccionado}`;

    if (hasHoras) {
      row.addEventListener('click', () => {
        if (diaSeleccionadoIndex === index) {
          diaSeleccionadoIndex = null;
          renderizarUI();
        } else {
          diaSeleccionadoIndex = index;
          renderizarUI();
          const seccionHoras = document.getElementById('seccion-horas');
          if (seccionHoras) {
            const y = seccionHoras.getBoundingClientRect().top + window.scrollY - 16;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }
        }
      });
    }

    const probPrecipDia = parsearProbabilidadPct(dia.prob_precipitacion) ?? 0;

    row.innerHTML = `
      <div class="flex flex-col w-28">
        <span class="font-medium text-text-main leading-tight">${escaparHTML(repararTextoMojibake(dia.dia_semana))}</span>
        ${hasHoras ? `<span class="text-[11px] text-md-primary font-medium mt-0.5">${isSelected ? 'Viendo por horas' : 'Ver por horas'}</span>` : ''}
      </div>
      <div class="flex items-center gap-1.5 w-20">
        <span class="material-symbols-rounded text-md-primary text-[24px]">${escaparHTML(dia.icono || 'cloud')}</span>
        <span class="text-xs font-bold ${probPrecipDia > 0 ? 'text-md-primary' : 'text-text-muted/60'}">${probPrecipDia}%</span>
      </div>
      <div class="flex gap-1 text-right w-auto items-center">
        <div class="flex gap-3 w-20 justify-end">
          <span class="font-semibold text-text-main">${escaparHTML(dia.temp_max)}°</span>
          <span class="text-text-muted">${escaparHTML(dia.temp_min)}°</span>
        </div>
        ${hasHoras
          ? `<span class="material-symbols-rounded text-lg ml-1 transition-transform ${isSelected ? 'text-md-primary rotate-90' : 'text-text-muted opacity-70'}">chevron_right</span>`
          : `<span class="w-5 ml-1"></span>`
        }
      </div>
    `;
    lista.appendChild(row);
  });
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* --- LÓGICA DE GEOLOCALIZACIÓN REUTILIZABLE --- */
function ubicarPorGPS(iconoEl, textoEl, callbackOnSuccess = null) {
  if (!navigator.geolocation) {
    mostrarToast('Tu navegador no soporta geolocalización', 'location_disabled');
    return;
  }
  if (municipiosCargando || municipiosDB.length === 0) {
    mostrarToast('Cargando municipios, inténtalo en un segundo...', 'hourglass_empty');
    return;
  }

  const textoOriginal = textoEl.textContent;
  iconoEl.textContent = 'sync';
  iconoEl.classList.add('animate-spin');
  textoEl.textContent = 'Buscando tu zona...';

  navigator.geolocation.getCurrentPosition((position) => {
    let municipioMasCercano = null;
    let distanciaMinima = Infinity;

    municipiosDB.forEach(m => {
      if (m.lat && m.lon) {
        const dist = calcularDistancia(position.coords.latitude, position.coords.longitude, m.lat, m.lon);
        if (dist < distanciaMinima) {
          distanciaMinima = dist;
          municipioMasCercano = m;
        }
      }
    });

    iconoEl.textContent = 'my_location';
    iconoEl.classList.remove('animate-spin');
    textoEl.textContent = textoOriginal;

    if (municipioMasCercano) {
      if (callbackOnSuccess) {
        callbackOnSuccess(municipioMasCercano.id_ine);
      } else {
        window.seleccionarMunicipio(municipioMasCercano.id_ine);
      }
    }
  }, () => {
    mostrarToast('Activa el permiso de ubicación en tu navegador', 'location_off');
    iconoEl.textContent = 'my_location';
    iconoEl.classList.remove('animate-spin');
    textoEl.textContent = textoOriginal;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const bottomNav = document.getElementById('bottom-nav');
  const welcomeModal = document.getElementById('welcome-modal');
  const btnWelcomeGps = document.getElementById('btn-welcome-gps');
  const btnWelcomeSearch = document.getElementById('btn-welcome-search');
  const iconoWelcomeGps = document.getElementById('icono-welcome-gps');
  const textoWelcomeGps = document.getElementById('texto-welcome-gps');
  const welcomeHintContainer = document.getElementById('welcome-hint-container');
  const welcomePrivacyLink = document.getElementById('welcome-privacy-link');

  const btnTiempo = document.getElementById('btn-tiempo');
  const btnVolverHoy = document.getElementById('btn-volver-hoy');
  const btnSearch = document.getElementById('btn-search');
  const searchModal = document.getElementById('search-modal');
  const btnCloseSearch = document.getElementById('btn-close-search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  const btnGps = document.getElementById('btn-gps');
  const iconoGps = document.getElementById('icono-gps');
  const textoGps = document.getElementById('texto-gps');

  const btnOptions = document.getElementById('btn-options');
  const btnCloseOptions = document.getElementById('btn-close-options');
  const optionsModal = document.getElementById('options-modal');
  const optionsOverlay = document.getElementById('options-overlay');
  const optionsPanel = document.getElementById('options-panel');
  const themeBtns = document.querySelectorAll('.theme-btn');
  const colorBtns = document.querySelectorAll('.color-btn');
  const colorPicker = document.getElementById('custom-color-picker');
  const customColorPreview = document.getElementById('custom-color-preview');

  const btnToggleAdvMenu = document.getElementById('btn-toggle-advanced-menu');
  const advMenuIcon = document.getElementById('advanced-menu-icon');
  const advOptionsList = document.getElementById('advanced-options-list');
  const advCheckboxes = document.querySelectorAll('.adv-pref-checkbox');

  const pwaInstallSection = document.getElementById('pwa-install-section');
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  const btnShareApp = document.getElementById('btn-share-app');
  const iosPwaModal = document.getElementById('ios-pwa-modal');
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  const btnOkIosModal = document.getElementById('btn-ok-ios-modal');

  const btnPrivacy = document.getElementById('btn-privacy');
  const privacyModal = document.getElementById('privacy-modal');
  const privacyModalPanel = document.getElementById('privacy-modal-panel');
  const btnClosePrivacyModal = document.getElementById('btn-close-privacy-modal');
  const btnOkPrivacyModal = document.getElementById('btn-ok-privacy-modal');

  const alertModal = document.getElementById('alert-modal');
  const btnCloseAlertModal = document.getElementById('btn-close-alert-modal');
  const btnOkAlertModal = document.getElementById('btn-ok-alert-modal');

  /* --- DETECCIÓN MÓVIL PARA EL WELCOME HINT --- */
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (welcomeHintContainer) {
    if (isMobile) {
      welcomeHintContainer.innerHTML = `
        <span class="material-symbols-rounded text-md-primary shrink-0 mt-0.5 text-[22px]">app_shortcut</span>
        <p class="text-xs text-text-main leading-snug">
          <strong>Instala la app:</strong> Desde el menú de opciones puedes instalar Pablómetro para mantenerla en tu pantalla de inicio.
        </p>
      `;
    } else {
      welcomeHintContainer.innerHTML = `
        <span class="material-symbols-rounded text-md-primary shrink-0 mt-0.5 text-[22px]">desktop_windows</span>
        <p class="text-xs text-text-main leading-snug">
          <strong>Aviso sobre PC:</strong> Esta aplicación está optimizada y pensada para dispositivos móviles, pero puedes utilizarla igualmente en tu ordenador sin problema.
        </p>
      `;
    }
  }

  /* --- GESTIÓN DEL MODAL DE PRIVACIDAD --- */
  const openPrivacyModal = () => {
    privacyModal.classList.remove('hidden');
    privacyModal.classList.add('flex');
    void privacyModal.offsetWidth;
    privacyModal.classList.remove('opacity-0');
    if (privacyModalPanel) privacyModalPanel.classList.remove('scale-95');
  };

  const closePrivacyModal = () => {
    privacyModal.classList.add('opacity-0');
    if (privacyModalPanel) privacyModalPanel.classList.add('scale-95');
    setTimeout(() => {
      privacyModal.classList.add('hidden');
      privacyModal.classList.remove('flex');
    }, 300);
  };

  if (btnClosePrivacyModal) btnClosePrivacyModal.addEventListener('click', closePrivacyModal);
  if (btnOkPrivacyModal) btnOkPrivacyModal.addEventListener('click', closePrivacyModal);
  if (privacyModal) {
    privacyModal.addEventListener('click', (e) => {
      if (e.target === privacyModal) closePrivacyModal();
    });
  }

  if (welcomePrivacyLink) {
    welcomePrivacyLink.addEventListener('click', openPrivacyModal);
  }

  /* --- CIERRES DE MODALES ADICIONALES --- */
  const closeSearchModal = (volverATiempo = true) => {
    if (!searchModal || searchModal.classList.contains('hidden')) return;
    searchModal.classList.add('hidden');
    searchModal.classList.remove('flex');
    searchInput.value = '';
    searchResults.innerHTML = '';
    btnGps.classList.remove('hidden');

    if (!localStorage.getItem('saved_ine')) {
      welcomeModal.classList.remove('hidden');
      welcomeModal.classList.add('flex');
    } else if (volverATiempo) {
      actualizarBarraNavegacion('tiempo');
    }
  };

  const closeOptionsModal = (volverATiempo = true) => {
    if (!optionsModal || optionsModal.classList.contains('hidden')) return;
    optionsOverlay.classList.add('opacity-0');
    optionsPanel.classList.add('translate-y-full');
    if (volverATiempo) actualizarBarraNavegacion('tiempo');
    setTimeout(() => {
      optionsModal.classList.add('hidden');
      optionsModal.classList.remove('flex');
    }, 300);
  };

  const closeIosModal = () => {
    if (!iosPwaModal || iosPwaModal.classList.contains('hidden')) return;
    iosPwaModal.classList.add('opacity-0');
    setTimeout(() => {
      iosPwaModal.classList.add('hidden');
      iosPwaModal.classList.remove('flex');
    }, 300);
  };

  if (btnCloseOptions) btnCloseOptions.addEventListener('click', () => closeOptionsModal(true));
  if (btnCloseAlertModal) btnCloseAlertModal.addEventListener('click', cerrarModalAlerta);
  if (btnOkAlertModal) btnOkAlertModal.addEventListener('click', cerrarModalAlerta);
  if (alertModal) {
    alertModal.addEventListener('click', (e) => {
      if (e.target === alertModal) cerrarModalAlerta();
    });
  }

  if (btnVolverHoy) {
    btnVolverHoy.addEventListener('click', () => {
      diaSeleccionadoIndex = null;
      renderizarUI();
    });
  }

  if (btnTiempo) {
    btnTiempo.addEventListener('click', () => {
      closeSearchModal(false);
      closeOptionsModal(false);
      closeIosModal();
      cerrarModalAlerta();
      actualizarBarraNavegacion('tiempo');
      if (currentWeatherData) {
        diaSeleccionadoIndex = null;
        renderizarUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Al volver a la pestaña/app: si los datos tienen más de 30 min, refrescar desde el Worker
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const savedIne = localStorage.getItem('saved_ine');
      if (savedIne && (Date.now() - lastFetchTimestamp > MAX_DATA_AGE_MS)) {
        cargarTiempo(savedIne, true);
      } else if (currentWeatherData) {
        renderizarUI();
      }
    }
  });

  /* --- BUSCADOR Y BIENVENIDA --- */
  if (btnWelcomeSearch) {
    btnWelcomeSearch.addEventListener('click', () => {
      welcomeModal.classList.add('hidden');
      welcomeModal.classList.remove('flex');

      searchModal.classList.remove('hidden');
      searchModal.classList.add('flex');
      searchInput.focus();
      if (municipiosCargando) {
        searchResults.innerHTML = `<div class="p-6 text-center text-text-muted text-sm">Preparando lista de municipios...</div>`;
      }
    });
  }

  if (btnWelcomeGps) {
    btnWelcomeGps.addEventListener('click', () => {
      ubicarPorGPS(iconoWelcomeGps, textoWelcomeGps, (ine) => {
        trackEvent('use_gps', { location_id: ine });
        window.seleccionarMunicipio(ine);
      });
    });
  }

  const renderizarResultadosBusqueda = (queryRaw) => {
    const query = normalizarTexto(queryRaw);
    if (query.length > 0) {
      btnGps.classList.add('hidden');
    } else {
      btnGps.classList.remove('hidden');
      searchResults.innerHTML = '';
      return;
    }

    if (municipiosCargando) {
      searchResults.innerHTML = `
        <div class="p-8 text-center text-text-muted flex flex-col items-center gap-2">
          <span class="material-symbols-rounded animate-spin text-md-primary text-3xl">sync</span>
          <span>Cargando base de datos de municipios...</span>
        </div>
      `;
      return;
    }

    if (query.length < 2) {
      searchResults.innerHTML = '';
      return;
    }

    const isNumber = /^\d+$/.test(query);
    const filtrados = municipiosDB.filter(m => {
      if (isNumber) return m.cps && m.cps.some(cp => cp.startsWith(query));
      return m._nombreNorm.includes(query) || m._provNorm.includes(query);
    }).slice(0, 15);

    if (filtrados.length === 0) {
      searchResults.innerHTML = `<div class="p-8 text-center text-text-muted">No se encontraron municipios para "${escaparHTML(queryRaw)}"</div>`;
      return;
    }

    searchResults.innerHTML = filtrados.map(m => `
      <div class="p-4 flex flex-col border-b border-border-color active:bg-md-surface-container hover:bg-md-surface-container/50 cursor-pointer transition"
           data-ine="${escaparHTML(m.id_ine)}">
        <span class="font-medium text-lg text-text-main">${escaparHTML(m.nombre)}</span>
        <span class="text-sm text-text-muted">${escaparHTML(m.provincia)}</span>
      </div>
    `).join('');
  };

  if (searchResults) {
    searchResults.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ine]');
      if (item && item.dataset.ine) {
        window.seleccionarMunicipio(item.dataset.ine);
      }
    });
  }

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      closeOptionsModal(false);
      cerrarModalAlerta();
      actualizarBarraNavegacion('buscar');
      searchModal.classList.remove('hidden');
      searchModal.classList.add('flex');
      searchInput.focus();
      if (municipiosCargando) {
        searchResults.innerHTML = `<div class="p-6 text-center text-text-muted text-sm">Preparando lista de municipios...</div>`;
      }
    });
  }

  if (btnCloseSearch) btnCloseSearch.addEventListener('click', () => closeSearchModal(true));

  if (btnGps) {
    btnGps.addEventListener('click', () => {
      ubicarPorGPS(iconoGps, textoGps, (ine) => {
        trackEvent('use_gps', { location_id: ine });
        window.seleccionarMunicipio(ine);
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderizarResultadosBusqueda(e.target.value));
  }

  window.seleccionarMunicipio = (ine) => {
    const ineNormalizado = String(ine).padStart(5, '0');
    closeSearchModal(true);

    const munData = municipiosDB.find(m => m.id_ine === ineNormalizado);
    const nombreMun = munData ? munData.nombre : ineNormalizado;
    trackEvent('select_location', { location_id: ineNormalizado, location_name: nombreMun });

    if (welcomeModal && !welcomeModal.classList.contains('hidden')) {
      welcomeModal.classList.add('hidden');
      welcomeModal.classList.remove('flex');
      if (bottomNav) {
        bottomNav.classList.remove('hidden');
        bottomNav.classList.add('flex');
      }
    }

    document.getElementById('ui-municipio').textContent = munData ? munData.nombre : 'Cargando...';
    cargarTiempo(ineNormalizado);
  };

  /* --- MENÚ DE OPCIONES --- */
  if (btnOptions) {
    btnOptions.addEventListener('click', () => {
      closeSearchModal(false);
      cerrarModalAlerta();
      actualizarBarraNavegacion('opciones');
      optionsModal.classList.remove('hidden');
      optionsModal.classList.add('flex');
      void optionsModal.offsetWidth;
      optionsOverlay.classList.remove('opacity-0');
      optionsPanel.classList.remove('translate-y-full');
    });
  }

  if (optionsOverlay) optionsOverlay.addEventListener('click', () => closeOptionsModal(true));

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && pwaInstallSection) pwaInstallSection.classList.add('hidden');

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      trackEvent('options_menu_click', { button: 'install_pwa' });
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        closeOptionsModal(true);
        iosPwaModal.classList.remove('hidden');
        iosPwaModal.classList.add('flex');
        void iosPwaModal.offsetWidth;
        iosPwaModal.classList.remove('opacity-0');
      } else if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredInstallPrompt = null;
          closeOptionsModal(true);
        }
      } else {
        mostrarToast('Abre el menú del navegador (⋮) y pulsa "Instalar aplicación"', 'install_mobile');
      }
    });
  }

  if (btnShareApp) {
    btnShareApp.addEventListener('click', async () => {
      trackEvent('options_menu_click', { button: 'share_app' });
      const shareData = {
        title: 'Pablómetro',
        text: 'El tiempo oficial de la AEMET, pero con buen gusto.',
        url: window.location.origin + window.location.pathname
      };

      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch (err) {
          if (err.name !== 'AbortError') {
            mostrarToast('No se pudo abrir el menú de compartir', 'error');
          }
        }
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(shareData.url);
          closeOptionsModal(true);
          mostrarToast('Enlace copiado al portapapeles', 'content_copy');
        } catch {
          mostrarToast('No se pudo copiar el enlace', 'error');
        }
      }
    });
  }

  if (btnCloseIosModal) btnCloseIosModal.addEventListener('click', closeIosModal);
  if (btnOkIosModal) btnOkIosModal.addEventListener('click', closeIosModal);

  if (btnPrivacy) {
    btnPrivacy.addEventListener('click', () => {
      trackEvent('options_menu_click', { button: 'privacy_cookies' });
      closeOptionsModal(true);
      openPrivacyModal();
    });
  }

  document.getElementById('btn-contact-email')?.addEventListener('click', () => {
    trackEvent('options_menu_click', { button: 'contact_email' });
  });

  document.getElementById('btn-instagram')?.addEventListener('click', () => {
    trackEvent('options_menu_click', { button: 'instagram' });
  });

  document.getElementById('btn-aemet-link')?.addEventListener('click', () => {
    trackEvent('options_menu_click', { button: 'aemet_info' });
  });

  /* --- AJUSTES DE TEMA Y COLOR --- */
  const updateSettingsUI = () => {
    const currentTheme = localStorage.getItem('app_theme') || 'system';
    const currentColor = localStorage.getItem('app_color') || 'blue';

    themeBtns.forEach(btn => {
      btn.dataset.active = btn.dataset.themeVal === currentTheme ? 'true' : 'false';
    });

    colorBtns.forEach(btn => {
      let isActive = false;
      if (btn.dataset.colorVal === 'custom') {
        isActive = currentColor.startsWith('#');
        if (isActive) {
          customColorPreview.style.background = currentColor;
          window.applyCustomColor(currentColor);
        }
      } else {
        isActive = btn.dataset.colorVal === currentColor;
      }
      btn.dataset.active = isActive ? 'true' : 'false';
    });
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentColor = localStorage.getItem('app_color') || 'blue';
    if (currentColor.startsWith('#')) window.applyCustomColor(currentColor);
  });

  themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const val = e.currentTarget.dataset.themeVal;
      localStorage.setItem('app_theme', val);
      trackEvent('change_theme', { theme: val });
      if (val === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', val);
      updateSettingsUI();
    });
  });

  colorBtns.forEach(btn => {
    if (btn.dataset.colorVal !== 'custom') {
      btn.addEventListener('click', (e) => {
        const val = e.currentTarget.dataset.colorVal;
        localStorage.setItem('app_color', val);
        trackEvent('change_color', { color: val });
        document.documentElement.setAttribute('data-color', val);
        document.documentElement.style.removeProperty('--md-primary');
        updateSettingsUI();
      });
    }
  });

  if (colorPicker) {
    const savedColorInit = localStorage.getItem('app_color') || 'blue';
    if (savedColorInit.startsWith('#')) colorPicker.value = savedColorInit;

    // Previsualización fluida a 60fps sin saturar Analytics ni localStorage
    colorPicker.addEventListener('input', (e) => {
      const hex = e.target.value;
      document.documentElement.setAttribute('data-color', 'custom');
      customColorPreview.style.background = hex;
      window.applyCustomColor(hex);
    });

    // Guardado y evento Analytics únicamente al soltar el selector
    colorPicker.addEventListener('change', (e) => {
      const hex = e.target.value;
      localStorage.setItem('app_color', hex);
      trackEvent('change_color', { color: 'custom', hex_value: hex });
      document.documentElement.setAttribute('data-color', 'custom');
      updateSettingsUI();
    });
  }

  /* --- DESPLEGABLE DE DATOS METEOROLÓGICOS EXTRA --- */
  if (btnToggleAdvMenu) {
    btnToggleAdvMenu.addEventListener('click', () => {
      advOptionsList.classList.toggle('hidden');
      advOptionsList.classList.toggle('flex');
      advMenuIcon.style.transform = advOptionsList.classList.contains('hidden')
        ? 'rotate(0deg)'
        : 'rotate(180deg)';
    });
  }

  advCheckboxes.forEach(checkbox => {
    const key = checkbox.dataset.key;
    checkbox.checked = Boolean(advPrefs[key]);

    checkbox.addEventListener('change', (e) => {
      advPrefs[key] = e.target.checked;
      localStorage.setItem('app_advanced_prefs', JSON.stringify(advPrefs));
      trackEvent('toggle_adv_weather', { option: key, enabled: e.target.checked });
      if (currentWeatherData) renderizarUI();
    });
  });

  updateSettingsUI();
  actualizarBarraNavegacion('tiempo');

  /* --- CARGA INICIAL EN PARALELO --- */
  const cargarMunicipiosDB = async () => {
    try {
      const res = await fetch('municipios.json');
      if (res.ok) {
        const rawData = await res.json();
        municipiosDB = rawData.map(m => {
          const nombreLimpio = repararTextoMojibake(m.nombre);
          const provLimpia = repararTextoMojibake(m.provincia);
          return {
            ...m,
            id_ine: String(m.id_ine).padStart(5, '0'),
            nombre: nombreLimpio,
            provincia: provLimpia,
            _nombreNorm: normalizarTexto(nombreLimpio),
            _provNorm: normalizarTexto(provLimpia)
          };
        });
        if (currentWeatherData) {
          document.getElementById('ui-municipio').textContent = obtenerNombreMunicipioLimpio(currentWeatherData);
        }
      }
    } catch (error) {
      console.error('No se pudo cargar la base de datos de municipios', error);
      mostrarToast('Error al cargar la lista de municipios', 'error');
    } finally {
      municipiosCargando = false;
      if (searchModal && !searchModal.classList.contains('hidden')) {
        renderizarResultadosBusqueda(searchInput.value);
      }
    }
  };

  const iniciarApp = () => {
    const savedIne = localStorage.getItem('saved_ine');

    if (!savedIne) {
      welcomeModal.classList.remove('hidden');
      welcomeModal.classList.add('flex');
      if (bottomNav) {
        bottomNav.classList.add('hidden');
        bottomNav.classList.remove('flex');
      }
      cargarMunicipiosDB();
    } else {
      // Ejecutar petición meteorológica y carga de municipios simultáneamente
      Promise.all([
        cargarTiempo(savedIne),
        cargarMunicipiosDB()
      ]);
    }
  };

  iniciarApp();
});
