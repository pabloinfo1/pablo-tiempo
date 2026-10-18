const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
let municipiosDB = [];
let municipiosCargando = true;
let deferredInstallPrompt = null;
let currentWeatherData = null;
let diaSeleccionadoIndex = null; // null = Próximas 24h desde hora actual, >0 = Día futuro seleccionado

const DEFAULT_ADV_PREFS = {
  uv: false,
  nieve: false,
  tormenta: false,
  sensacion: false,
  viento: false
};

function cargarPreferenciasAvanzadas() {
  try {
    const guardadas = JSON.parse(localStorage.getItem('app_advanced_prefs'));
    if (guardadas && typeof guardadas === 'object') {
      return { ...DEFAULT_ADV_PREFS, ...guardadas };
    }
  } catch (e) {
    console.warn('Preferencias avanzadas reiniciadas al valor por defecto.');
  }
  return { ...DEFAULT_ADV_PREFS };
}

let advPrefs = cargarPreferenciasAvanzadas();

/* --- UTILIDADES --- */
function normalizarTexto(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function primerValorDefinido(...valores) {
  for (const val of valores) {
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return undefined;
}

/**
 * Parsea la precipitación acumulada en mm (l/m²) sin confundirla nunca con porcentaje.
 * Soporta "Ip" (Inapreciable) de AEMET convirtiéndolo en 0.1 mm.
 */
function parsearPrecipitacionMm(valorRaw) {
  if (valorRaw === undefined || valorRaw === null || valorRaw === '') return 0;
  const str = String(valorRaw).trim().toLowerCase();
  if (str === 'ip') return 0.1;
  const num = parseFloat(str.replace(',', '.'));
  return (!isNaN(num) && num > 0) ? num : 0;
}

/**
 * Parsea estrictamente la probabilidad de precipitación en % (0 - 100).
 */
function parsearProbabilidadPct(valorRaw) {
  if (valorRaw === undefined || valorRaw === null || valorRaw === '') return null;
  const num = parseInt(String(valorRaw).trim(), 10);
  if (isNaN(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function extraerNumeroHora(horaStr) {
  if (horaStr === undefined || horaStr === null) return null;
  const limpia = String(horaStr).trim();
  const partes = limpia.split(':');
  const num = parseInt(partes[0], 10);
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

/* --- CONFIGURACIÓN PWA --- */
function inicializarPWA() {
  const manifest = {
    name: "Pablómetro - El Tiempo",
    short_name: "Pablómetro",
    start_url: window.location.pathname,
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#1b6ef3",
    icons: [
      {
        src: new URL('favicon.png', window.location.href).href,
        sizes: "192x192 512x512",
        type: "image/png",
        purpose: "any maskable"
      }
    ]
  };
  const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(manifestBlob);
  document.head.appendChild(link);

  if ('serviceWorker' in navigator) {
    const swCode = `
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', () => {});
    `;
    const swBlob = new Blob([swCode], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(() => {});
  }

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
    const horaNum = extraerNumeroHora(item.hora);
    if (idx > 0 && horaNum !== null && horaAnteriorNum !== null) {
      if (horaNum < horaAnteriorNum) {
        diaActualIdx++;
        grupos[diaActualIdx] = [];
      }
    }
    if (horaNum !== null) horaAnteriorNum = horaNum;
    grupos[diaActualIdx].push(item);
  });

  return grupos;
}

function obtenerHorasParaDia(data, diaObj, indexEnLista) {
  if (!data || !diaObj) return [];

  if (Array.isArray(diaObj.horas) && diaObj.horas.length > 0) {
    return diaObj.horas;
  }
  if (Array.isArray(diaObj.hoy_horas) && diaObj.hoy_horas.length > 0) {
    return diaObj.hoy_horas;
  }
  if (Array.isArray(data.horas_por_dia?.[indexEnLista]) && data.horas_por_dia[indexEnLista].length > 0) {
    return data.horas_por_dia[indexEnLista];
  }

  if (Array.isArray(data.hoy_horas) && data.hoy_horas.length > 0) {
    if (diaObj.fecha) {
      const porFecha = data.hoy_horas.filter(h => h.fecha && String(h.fecha).startsWith(String(diaObj.fecha).slice(0, 10)));
      if (porFecha.length > 0) return porFecha;
    }
    const grupos = agruparHorasPorSaltosDeDia(data.hoy_horas);
    if (grupos[indexEnLista] && grupos[indexEnLista].length > 0) {
      return grupos[indexEnLista];
    }
  }

  return [];
}

/**
 * Sincroniza la lista de próximas horas y los datos actuales con el reloj local del usuario,
 * descartando horas ya pasadas aunque el JSON provenga de la caché de 30 minutos.
 */
function obtenerEstadoSincronizado(data) {
  const ahora = new Date();
  const fechaHoyISO = obtenerFechaLocalISO(ahora);
  const horaActualNum = ahora.getHours();

  // Reunir todas las horas disponibles en secuencia cronológica
  let poolHoras = [];
  if (Array.isArray(data.hoy_horas) && data.hoy_horas.length > 0) {
    poolHoras = [...data.hoy_horas];
  } else if (Array.isArray(data.proximos_dias)) {
    data.proximos_dias.forEach((d, idx) => {
      const hDia = obtenerHorasParaDia(data, d, idx);
      if (hDia.length > 0) {
        poolHoras.push(...hDia.map(h => ({ ...h, _diaIdx: idx, fecha: h.fecha || d.fecha })));
      }
    });
  }

  let horasFuturas = [];

  if (poolHoras.length > 0) {
    const tienenFecha = poolHoras.some(h => Boolean(h.fecha));

    if (tienenFecha) {
      horasFuturas = poolHoras.filter(h => {
        const fechaItem = String(h.fecha || '').slice(0, 10);
        const horaNum = extraerNumeroHora(h.hora);
        if (!fechaItem || horaNum === null) return true;
        if (fechaItem > fechaHoyISO) return true;
        if (fechaItem === fechaHoyISO) return horaNum >= horaActualNum;
        return false;
      });
    } else {
      // Si el JSON no trae campo fecha en cada hora, agrupamos por saltos de medianoche (00:00)
      const grupos = agruparHorasPorSaltosDeDia(poolHoras);
      const grupoHoy = (grupos[0] || []).filter(h => {
        const horaNum = extraerNumeroHora(h.hora);
        return horaNum === null || horaNum >= horaActualNum;
      });
      const restoGrupos = grupos.slice(1).flat();
      horasFuturas = [...grupoHoy, ...restoGrupos];
    }
  }

  if (horasFuturas.length === 0 && poolHoras.length > 0) {
    horasFuturas = poolHoras;
  }

  const proximas24Horas = horasFuturas.slice(0, 24);
  const horaEnCurso = proximas24Horas[0] || {};
  const baseActual = data.actual || {};

  // Sincronizar tarjeta principal con la hora actual real
  const actualSincronizado = {
    ...baseActual,
    hora: primerValorDefinido(horaEnCurso.hora, baseActual.hora),
    temperatura: primerValorDefinido(horaEnCurso.temperatura, baseActual.temperatura),
    estado_cielo: primerValorDefinido(horaEnCurso.estado_cielo, baseActual.estado_cielo),
    icono: primerValorDefinido(horaEnCurso.icono, baseActual.icono, 'cloud'),
    humedad: primerValorDefinido(horaEnCurso.humedad, baseActual.humedad),
    viento_kmh: primerValorDefinido(horaEnCurso.viento_kmh, baseActual.viento_kmh),
    sensacion_termica: primerValorDefinido(
      horaEnCurso.sensacion_termica, horaEnCurso.sensTermica, horaEnCurso.sens_termica,
      baseActual.sensacion_termica, baseActual.sensTermica, baseActual.sens_termica,
      horaEnCurso.temperatura, baseActual.temperatura
    ),
    prob_precipitacion: primerValorDefinido(
      horaEnCurso.prob_precipitacion, horaEnCurso.probPrecipitacion, horaEnCurso.prob_lluvia,
      baseActual.prob_precipitacion, baseActual.probPrecipitacion
    ),
    precipitacion_mm: primerValorDefinido(
      horaEnCurso.precipitacion_mm, horaEnCurso.lluvia_mm, horaEnCurso.precipitacion,
      baseActual.precipitacion_mm, baseActual.lluvia_mm, baseActual.precipitacion
    ),
    cota_nieve: primerValorDefinido(
      horaEnCurso.cota_nieve, horaEnCurso.cotaNieve,
      baseActual.cota_nieve, baseActual.cotaNieve
    ),
    prob_tormenta: primerValorDefinido(
      horaEnCurso.prob_tormenta, horaEnCurso.probTormenta,
      baseActual.prob_tormenta, baseActual.probTormenta
    ),
    rachas_viento: primerValorDefinido(
      horaEnCurso.rachas_viento, horaEnCurso.racha_max, horaEnCurso.racha,
      baseActual.rachas_viento, baseActual.racha_max, baseActual.racha
    ),
    direccion_viento: primerValorDefinido(
      horaEnCurso.direccion_viento, horaEnCurso.viento_dir, horaEnCurso.direccion,
      baseActual.direccion_viento, baseActual.viento_dir, baseActual.direccion
    ),
    uv: primerValorDefinido(
      horaEnCurso.uv, baseActual.uv, baseActual.uv_max, baseActual.indice_uv
    )
  };

  return { actualSincronizado, proximas24Horas };
}

function extraerDatosAvanzadosActuales(data, actualSincronizado) {
  const actual = actualSincronizado || data.actual || {};
  const dia0 = (Array.isArray(data.proximos_dias) && data.proximos_dias[0]) || {};

  const uv = primerValorDefinido(
    actual.uv, actual.uv_max, actual.indice_uv, actual.radiacion_uv,
    dia0.uv, dia0.uv_max, dia0.indice_uv
  );

  const nieveRaw = primerValorDefinido(
    actual.cota_nieve, actual.cotaNieve, actual.nieve,
    dia0.cota_nieve, dia0.cotaNieve, dia0.nieve
  );

  const tormenta = primerValorDefinido(
    actual.prob_tormenta, actual.probTormenta, actual.tormenta,
    dia0.prob_tormenta, dia0.probTormenta, dia0.tormenta
  );

  const sensacion = primerValorDefinido(
    actual.sensacion_termica, actual.sensTermica, actual.sens_termica, actual.sensacion,
    actual.temperatura
  );

  const racha = primerValorDefinido(
    actual.rachas_viento, actual.racha_max, actual.rachaMax, actual.racha_viento, actual.racha,
    dia0.rachas_viento, dia0.racha_max, dia0.racha_viento, dia0.racha,
    actual.viento_kmh
  );

  const direccion = primerValorDefinido(
    actual.direccion_viento, actual.viento_direccion, actual.viento_dir, actual.dir_viento, actual.direccion,
    dia0.direccion_viento, dia0.viento_direccion, dia0.viento_dir, dia0.dir_viento, dia0.direccion
  );

  return { uv, nieveRaw, tormenta, sensacion, racha, direccion };
}

/**
 * Recopila y normaliza todas las alertas meteorológicas presentes en la respuesta.
 */
function extraerAlertasActivas(data) {
  if (!data) return [];
  const fuentes = [
    data.alertas,
    data.avisos,
    data.municipio?.alertas,
    data.municipio?.avisos,
    data.actual?.alertas,
    data.proximos_dias?.[0]?.alertas
  ];

  const listaBruta = [];
  fuentes.forEach(f => {
    if (Array.isArray(f)) listaBruta.push(...f);
    else if (f && typeof f === 'object') listaBruta.push(f);
    else if (typeof f === 'string' && f.trim() !== '') listaBruta.push({ nivel: f.trim() });
  });

  const vistas = new Set();
  const alertasLimpias = [];

  listaBruta.forEach(item => {
    if (!item) return;
    const nivel = typeof item === 'string'
      ? item
      : primerValorDefinido(item.nivel, item.level, item.riesgo, item.severidad, item.tipo, 'Aviso activo');
    const fenomeno = typeof item === 'object'
      ? primerValorDefinido(item.fenomeno, item.parametro, item.evento, item.titulo, '')
      : '';
    const descripcion = typeof item === 'object'
      ? primerValorDefinido(item.descripcion, item.detalle, item.comentario, '')
      : '';

    const clave = `${normalizarTexto(nivel)}-${normalizarTexto(fenomeno)}`;
    if (!vistas.has(clave)) {
      vistas.add(clave);
      alertasLimpias.push({ nivel, fenomeno, descripcion });
    }
  });

  return alertasLimpias;
}

/* --- LÓGICA METEOROLÓGICA --- */
async function cargarTiempo(ine) {
  setEstadoCarga(true);
  try {
    const res = await fetch(`${WORKER_URL}?ine=${encodeURIComponent(ine)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentWeatherData = await res.json();
    diaSeleccionadoIndex = null;

    localStorage.setItem('saved_ine', ine);
    renderizarUI();
  } catch (error) {
    console.error("Fallo al cargar el tiempo:", error);
    document.getElementById('ui-municipio').textContent = "Error de conexión";
    mostrarToast("No se pudo conectar con el servidor meteorológico", "cloud_off");
  } finally {
    setEstadoCarga(false);
  }
}

function renderizarCarrusel(horasArray, titulo = "Próximas horas", esDiaFuturo = false) {
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
    // 1. Probabilidad estrictamente en % (NUNCA usar hora.precipitacion aquí)
    const probPrecip = parsearProbabilidadPct(
      primerValorDefinido(hora.prob_precipitacion, hora.probPrecipitacion, hora.prob_lluvia)
    );

    // 2. Volumen acumulado estrictamente en mm (l/m²)
    const precipMm = parsearPrecipitacionMm(
      primerValorDefinido(hora.precipitacion_mm, hora.lluvia_mm, hora.precipitacion)
    );

    // Bloque de precipitación diferenciado (% vs mm)
    let bloquePrecipitacionHTML = '';
    const probMostrar = probPrecip !== null ? probPrecip : 0;

    bloquePrecipitacionHTML += `
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

    // Datos opcionales por hora
    let detallesExtraHoraHTML = '';
    const itemsExtraHora = [];

    if (advPrefs.sensacion) {
      const st = primerValorDefinido(hora.sensacion_termica, hora.sens_termica, hora.sensTermica, hora.sensacion);
      if (st !== undefined) itemsExtraHora.push(`ST ${st}°`);
    }
    if (advPrefs.tormenta) {
      const torm = parsearProbabilidadPct(primerValorDefinido(hora.prob_tormenta, hora.probTormenta, hora.tormenta));
      if (torm !== null) itemsExtraHora.push(`⚡ ${torm}%`);
    }
    if (advPrefs.viento) {
      const rachaH = primerValorDefinido(hora.rachas_viento, hora.racha_max, hora.racha, hora.viento_kmh);
      const dirH = primerValorDefinido(hora.direccion_viento, hora.viento_dir, hora.direccion, '');
      if (rachaH !== undefined) itemsExtraHora.push(`${rachaH}km/h${dirH ? ' ' + dirH : ''}`);
    }
    if (advPrefs.nieve) {
      const nieveH = primerValorDefinido(hora.cota_nieve, hora.cotaNieve, hora.nieve);
      if (nieveH !== undefined && nieveH !== '0' && nieveH !== 0) {
        const nieveTxt = String(nieveH).endsWith('m') ? nieveH : `${nieveH}m`;
        itemsExtraHora.push(`❄ ${nieveTxt}`);
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
    const etiquetaHora = esAhora ? 'Ahora' : (hora.hora || '--:--');
    const card = document.createElement('div');
    const anchoCard = (itemsExtraHora.length > 0 || precipMm > 0) ? 'w-[96px]' : 'w-[84px]';
    const bordeAhora = esAhora ? 'ring-1 ring-md-primary/40 bg-md-surface-container-high/70' : 'bg-md-surface-container';

    card.className = `snap-start shrink-0 ${bordeAhora} rounded-2xl p-3.5 flex flex-col items-center ${anchoCard} shadow-sm transition-all`;

    card.innerHTML = `
      <span class="text-xs ${esAhora ? 'font-bold text-md-primary' : 'font-medium text-text-muted'} mb-1.5">${etiquetaHora}</span>
      <span class="material-symbols-rounded text-[30px] text-md-primary mb-1.5">${hora.icono || 'cloud'}</span>
      <span class="text-[17px] font-semibold text-text-main leading-none mb-2">${hora.temperatura ?? '--'}°</span>
      <div class="flex flex-col items-center mt-auto">
        ${bloquePrecipitacionHTML}
      </div>
      ${detallesExtraHoraHTML}
    `;
    carrusel.appendChild(card);
  });
}

function renderizarUI() {
  if (!currentWeatherData) return;
  const data = currentWeatherData;

  const { actualSincronizado, proximas24Horas } = obtenerEstadoSincronizado(data);

  document.getElementById('ui-municipio').textContent = data.municipio?.nombre || 'Localidad';
  document.getElementById('ui-temp-actual').textContent = actualSincronizado.temperatura ?? '--';
  document.getElementById('ui-desc-actual').textContent = actualSincronizado.estado_cielo ?? '--';
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
        const nivelNorm = normalizarTexto(alerta.nivel);
        let badgeStyle = 'background-color: rgba(59, 130, 246, 0.16); border: 1px solid rgba(59, 130, 246, 0.45); color: var(--md-primary);';
        let etiquetaNivel = alerta.nivel;

        if (nivelNorm.includes('amarill')) {
          badgeStyle = 'background-color: rgba(234, 179, 8, 0.18); border: 1px solid rgba(234, 179, 8, 0.5); color: #eab308;';
          etiquetaNivel = 'Aviso Amarillo';
        } else if (nivelNorm.includes('naranj')) {
          badgeStyle = 'background-color: rgba(249, 115, 22, 0.18); border: 1px solid rgba(249, 115, 22, 0.5); color: #f97316;';
          etiquetaNivel = 'Aviso Naranja';
        } else if (nivelNorm.includes('roj')) {
          badgeStyle = 'background-color: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.5); color: #ef4444;';
          etiquetaNivel = 'Aviso Rojo';
        } else if (nivelNorm.includes('especial')) {
          badgeStyle = 'background-color: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.5); color: #c084fc;';
          etiquetaNivel = 'Aviso Especial';
        } else if (!etiquetaNivel.toLowerCase().startsWith('aviso')) {
          etiquetaNivel = `Aviso ${etiquetaNivel}`;
        }

        const textoFenomeno = alerta.fenomeno ? ` · ${alerta.fenomeno}` : '';
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.style.cssText = badgeStyle;
        badge.className = 'px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold shadow-sm transition active:scale-95';
        badge.innerHTML = `
          <span class="material-symbols-rounded text-[16px]">warning</span>
          <span>${etiquetaNivel}${textoFenomeno}</span>
        `;

        if (alerta.descripcion || alerta.fenomeno) {
          badge.addEventListener('click', () => {
            mostrarToast(alerta.descripcion || `${etiquetaNivel}: ${alerta.fenomeno}`, 'warning');
          });
        }

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
        <span class="material-symbols-rounded text-[20px] text-md-primary shrink-0">${icono}</span>
        <div class="flex flex-col min-w-0">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted leading-none truncate">${etiqueta}</span>
          <span class="text-sm font-semibold text-text-main leading-tight mt-1 truncate">${valor}</span>
        </div>
      </div>
    `;

    if (advPrefs.sensacion) {
      const valSens = sensacion !== undefined ? `${sensacion}°` : '--°';
      tarjetasExtra.push(crearChipExtra('thermostat', 'Sensación', valSens));
    }

    if (advPrefs.uv) {
      const valUv = uv !== undefined ? `${uv}` : '--';
      tarjetasExtra.push(crearChipExtra('wb_sunny', 'Índice UV', valUv));
    }

    if (advPrefs.tormenta) {
      const valTormenta = tormenta !== undefined ? `${tormenta}%` : '0%';
      tarjetasExtra.push(crearChipExtra('thunderstorm', 'Tormenta', valTormenta));
    }

    if (advPrefs.nieve) {
      let valNieve = 'Sin nieve';
      if (nieveRaw !== undefined && nieveRaw !== 0 && nieveRaw !== '0') {
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

  // Renderizado del carrusel según si hay un día futuro seleccionado o las próximas 24h sincronizadas
  if (diaSeleccionadoIndex !== null && data.proximos_dias?.[diaSeleccionadoIndex]) {
    const diaSel = data.proximos_dias[diaSeleccionadoIndex];
    const horasDiaSel = obtenerHorasParaDia(data, diaSel, diaSeleccionadoIndex);
    if (horasDiaSel.length > 0) {
      renderizarCarrusel(horasDiaSel, `Horas: ${diaSel.dia_semana}`, true);
    } else {
      diaSeleccionadoIndex = null;
      renderizarCarrusel(proximas24Horas, "Próximas horas", false);
    }
  } else {
    renderizarCarrusel(proximas24Horas, "Próximas horas", false);
  }

  renderizarListaDias(data);
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
      row.onclick = () => {
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
      };
    }

    // Separación estricta en la lista de días: solo probabilidad en %
    const probPrecipDia = parsearProbabilidadPct(
      primerValorDefinido(dia.prob_precipitacion, dia.probPrecipitacion, dia.prob_lluvia)
    ) ?? 0;

    row.innerHTML = `
      <div class="flex flex-col w-28">
        <span class="font-medium text-text-main leading-tight">${dia.dia_semana}</span>
        ${hasHoras ? `<span class="text-[11px] text-md-primary font-medium mt-0.5">${isSelected ? 'Viendo por horas' : 'Ver por horas'}</span>` : ''}
      </div>
      <div class="flex items-center gap-1.5 w-20">
        <span class="material-symbols-rounded text-md-primary text-[24px]">${dia.icono || 'cloud'}</span>
        <span class="text-xs font-bold ${probPrecipDia > 0 ? 'text-md-primary' : 'text-text-muted/60'}">${probPrecipDia}%</span>
      </div>
      <div class="flex gap-1 text-right w-auto items-center">
        <div class="flex gap-3 w-20 justify-end">
          <span class="font-semibold text-text-main">${dia.temp_max}°</span>
          <span class="text-text-muted">${dia.temp_min}°</span>
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

document.addEventListener('DOMContentLoaded', async () => {
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
  const iosPwaModal = document.getElementById('ios-pwa-modal');
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  const btnOkIosModal = document.getElementById('btn-ok-ios-modal');
  const btnPrivacy = document.getElementById('btn-privacy');

  /* --- CIERRES DE MODALES --- */
  const closeSearchModal = () => {
    if (!searchModal || searchModal.classList.contains('hidden')) return;
    searchModal.classList.add('hidden');
    searchModal.classList.remove('flex');
    searchInput.value = '';
    searchResults.innerHTML = '';
    btnGps.classList.remove('hidden');
  };

  const closeOptionsModal = () => {
    if (!optionsModal || optionsModal.classList.contains('hidden')) return;
    optionsOverlay.classList.add('opacity-0');
    optionsPanel.classList.add('translate-y-full');
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

  if (btnCloseOptions) btnCloseOptions.addEventListener('click', closeOptionsModal);

  if (btnVolverHoy) {
    btnVolverHoy.addEventListener('click', () => {
      diaSeleccionadoIndex = null;
      renderizarUI();
    });
  }

  if (btnTiempo) {
    btnTiempo.addEventListener('click', () => {
      closeSearchModal();
      closeOptionsModal();
      closeIosModal();
      if (currentWeatherData) {
        diaSeleccionadoIndex = null;
        renderizarUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Re-sincronizar automáticamente al volver a la pestaña/app si ha cambiado la hora
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentWeatherData) {
      renderizarUI();
    }
  });

  /* --- BUSCADOR --- */
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
      searchResults.innerHTML = `<div class="p-8 text-center text-text-muted">No se encontraron municipios para "${queryRaw}"</div>`;
      return;
    }

    searchResults.innerHTML = filtrados.map(m => `
      <div class="p-4 flex flex-col border-b border-border-color active:bg-md-surface-container hover:bg-md-surface-container/50 cursor-pointer transition" 
           onclick="seleccionarMunicipio('${m.id_ine}')">
        <span class="font-medium text-lg text-text-main">${m.nombre}</span>
        <span class="text-sm text-text-muted">${m.provincia}</span>
      </div>
    `).join('');
  };

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      closeOptionsModal();
      searchModal.classList.remove('hidden');
      searchModal.classList.add('flex');
      searchInput.focus();
      if (municipiosCargando) {
        searchResults.innerHTML = `<div class="p-6 text-center text-text-muted text-sm">Preparando lista de municipios...</div>`;
      }
    });
  }

  if (btnCloseSearch) btnCloseSearch.addEventListener('click', closeSearchModal);

  if (btnGps) {
    btnGps.addEventListener('click', () => {
      if (!navigator.geolocation) {
        mostrarToast('Tu navegador no soporta geolocalización', 'location_disabled');
        return;
      }
      if (municipiosCargando || municipiosDB.length === 0) {
        mostrarToast('Cargando municipios, inténtalo en un segundo...', 'hourglass_empty');
        return;
      }

      iconoGps.textContent = 'sync';
      iconoGps.classList.add('animate-spin');
      textoGps.textContent = 'Buscando tu zona...';

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

        iconoGps.textContent = 'my_location';
        iconoGps.classList.remove('animate-spin');
        textoGps.textContent = 'Usar mi ubicación actual';

        if (municipioMasCercano) seleccionarMunicipio(municipioMasCercano.id_ine);

      }, () => {
        mostrarToast('Activa el permiso de ubicación en tu navegador', 'location_off');
        iconoGps.textContent = 'my_location';
        iconoGps.classList.remove('animate-spin');
        textoGps.textContent = 'Usar mi ubicación actual';
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderizarResultadosBusqueda(e.target.value));
  }

  window.seleccionarMunicipio = (ine) => {
    closeSearchModal();
    document.getElementById('ui-municipio').textContent = "Cargando...";
    cargarTiempo(ine);
  };

  /* --- MENÚ DE OPCIONES --- */
  if (btnOptions) {
    btnOptions.addEventListener('click', () => {
      closeSearchModal();
      optionsModal.classList.remove('hidden');
      optionsModal.classList.add('flex');
      void optionsModal.offsetWidth;
      optionsOverlay.classList.remove('opacity-0');
      optionsPanel.classList.remove('translate-y-full');
    });
  }

  if (optionsOverlay) optionsOverlay.addEventListener('click', closeOptionsModal);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && pwaInstallSection) pwaInstallSection.classList.add('hidden');

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        closeOptionsModal();
        iosPwaModal.classList.remove('hidden');
        iosPwaModal.classList.add('flex');
        void iosPwaModal.offsetWidth;
        iosPwaModal.classList.remove('opacity-0');
      } else if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          deferredInstallPrompt = null;
          closeOptionsModal();
        }
      } else {
        mostrarToast('Abre el menú del navegador (⋮) y pulsa "Instalar aplicación"', 'install_mobile');
      }
    });
  }

  if (btnCloseIosModal) btnCloseIosModal.addEventListener('click', closeIosModal);
  if (btnOkIosModal) btnOkIosModal.addEventListener('click', closeIosModal);

  if (btnPrivacy) {
    btnPrivacy.addEventListener('click', () => {
      closeOptionsModal();
      mostrarToast('Sin cookies de rastreo. Solo guardamos tus ajustes en el dispositivo.', 'verified_user');
    });
  }

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
        document.documentElement.setAttribute('data-color', val);
        document.documentElement.style.removeProperty('--md-primary');
        updateSettingsUI();
      });
    }
  });

  if (colorPicker) {
    const savedColorInit = localStorage.getItem('app_color') || 'blue';
    if (savedColorInit.startsWith('#')) colorPicker.value = savedColorInit;

    const aplicarColorPersonalizado = (e) => {
      const hex = e.target.value;
      localStorage.setItem('app_color', hex);
      document.documentElement.setAttribute('data-color', 'custom');
      updateSettingsUI();
    };

    colorPicker.addEventListener('input', aplicarColorPersonalizado);
    colorPicker.addEventListener('change', aplicarColorPersonalizado);
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
      if (currentWeatherData) renderizarUI();
    });
  });

  updateSettingsUI();

  /* --- CARGA INICIAL --- */
  const savedIne = localStorage.getItem('saved_ine') || '07054';

  const cargarMunicipiosDB = async () => {
    try {
      const res = await fetch('municipios.json');
      if (res.ok) {
        const rawData = await res.json();
        municipiosDB = rawData.map(m => ({
          ...m,
          _nombreNorm: normalizarTexto(m.nombre),
          _provNorm: normalizarTexto(m.provincia)
        }));
      }
    } catch (error) {
      console.error("No se pudo cargar la base de datos de municipios", error);
      mostrarToast("Error al cargar la lista de municipios", "error");
    } finally {
      municipiosCargando = false;
      if (searchModal && !searchModal.classList.contains('hidden')) {
        renderizarResultadosBusqueda(searchInput.value);
      }
    }
  };

  await Promise.all([
    cargarMunicipiosDB(),
    cargarTiempo(savedIne)
  ]);
});
