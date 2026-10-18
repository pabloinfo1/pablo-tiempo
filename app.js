const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
let municipiosDB = [];
let municipiosCargando = true;
let deferredInstallPrompt = null;
let currentWeatherData = null; // Almacenamos el JSON globalmente para poder pintar horas de otros días

/* --- UTILIDADES --- */
function normalizarTexto(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

/* --- LÓGICA METEOROLÓGICA --- */
async function cargarTiempo(ine) {
  setEstadoCarga(true);
  try {
    const res = await fetch(`${WORKER_URL}?ine=${ine}`);
    if (!res.ok) throw new Error('Error en la red');
    currentWeatherData = await res.json();
    
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

// Subfunción para pintar el carrusel de las horas
function renderizarCarrusel(horasArray, titulo = "Próximas horas") {
  document.getElementById('titulo-carrusel-horas').textContent = titulo;
  const carrusel = document.getElementById('ui-carrusel-horas');
  carrusel.innerHTML = '';
  
  // Hacemos scroll al inicio suavemente si cambió el contenido
  carrusel.scrollTo({ left: 0, behavior: 'smooth' });

  horasArray.forEach(hora => {
    const card = document.createElement('div');
    card.className = 'snap-start shrink-0 bg-md-surface-container rounded-2xl p-4 pt-3 pb-3 flex flex-col items-center w-[84px] shadow-sm';
    
    // Se ha añadido la probabilidad de lluvia con su icono correspondiente
    card.innerHTML = `
      <span class="text-xs font-medium mb-1 text-text-muted">${hora.hora}</span>
      <span class="material-symbols-rounded text-[32px] text-md-primary mb-1">${hora.icono}</span>
      <span class="text-[17px] font-semibold text-text-main leading-none mb-1">${hora.temperatura}°</span>
      <div class="flex items-center gap-[2px] text-md-primary mt-auto">
        <span class="material-symbols-rounded text-[14px]">water_drop</span>
        <span class="text-[11px] font-bold">${hora.prob_precipitacion !== undefined ? hora.prob_precipitacion : 0}%</span>
      </div>
    `;
    carrusel.appendChild(card);
  });
}

function renderizarUI() {
  if (!currentWeatherData) return;
  const data = currentWeatherData;

  document.getElementById('ui-municipio').textContent = data.municipio.nombre;
  
  document.getElementById('ui-temp-actual').textContent = data.actual.temperatura;
  document.getElementById('ui-desc-actual').textContent = data.actual.estado_cielo;
  document.getElementById('ui-humedad').textContent = `${data.actual.humedad}%`;
  document.getElementById('ui-viento').textContent = `${data.actual.viento_kmh} km/h`;
  document.getElementById('ui-icono-actual').textContent = data.actual.icono;

  // Renderizar la capa de Datos Avanzados
  const extraDiv = document.getElementById('ui-datos-extra');
  const advancedEnabled = localStorage.getItem('app_advanced_data') === 'true';
  
  if (advancedEnabled && extraDiv) {
    extraDiv.classList.remove('hidden');
    extraDiv.classList.add('grid');
    let extraHTML = '';
    
    // Se añaden celdas minimalistas basándose en la disponibilidad de datos
    if (data.actual.uv !== undefined) extraHTML += `<div class="flex flex-col items-center justify-center gap-1 bg-md-surface/80 p-2.5 rounded-xl"><span class="material-symbols-rounded text-[20px] text-md-primary">routine</span> <span class="text-[11px] font-semibold uppercase tracking-wide">UV: ${data.actual.uv}</span></div>`;
    if (data.actual.cota_nieve !== undefined && data.actual.cota_nieve !== null && data.actual.cota_nieve !== "") extraHTML += `<div class="flex flex-col items-center justify-center gap-1 bg-md-surface/80 p-2.5 rounded-xl"><span class="material-symbols-rounded text-[20px] text-md-primary">ac_unit</span> <span class="text-[11px] font-semibold uppercase tracking-wide">Nieve: ${data.actual.cota_nieve}m</span></div>`;
    if (data.actual.prob_tormenta !== undefined) extraHTML += `<div class="flex flex-col items-center justify-center gap-1 bg-md-surface/80 p-2.5 rounded-xl"><span class="material-symbols-rounded text-[20px] text-md-primary">thunderstorm</span> <span class="text-[11px] font-semibold uppercase tracking-wide">Tormentas: ${data.actual.prob_tormenta}%</span></div>`;
    if (data.actual.sensacion_termica !== undefined) extraHTML += `<div class="flex flex-col items-center justify-center gap-1 bg-md-surface/80 p-2.5 rounded-xl"><span class="material-symbols-rounded text-[20px] text-md-primary">thermostat</span> <span class="text-[11px] font-semibold uppercase tracking-wide">Sensación: ${data.actual.sensacion_termica}°</span></div>`;
    if (data.actual.rachas_viento !== undefined || data.actual.direccion_viento !== undefined) extraHTML += `<div class="flex flex-col items-center justify-center gap-1 bg-md-surface/80 p-2.5 rounded-xl"><span class="material-symbols-rounded text-[20px] text-md-primary">airwave</span> <span class="text-[11px] font-semibold uppercase tracking-wide text-center leading-tight">Racha: ${data.actual.rachas_viento || '--'}km/h ${data.actual.direccion_viento || ''}</span></div>`;
    
    if (extraHTML === '') {
      extraHTML = `<div class="col-span-full text-center text-xs text-text-muted py-2">Datos adicionales no disponibles en este momento.</div>`;
    }
    extraDiv.innerHTML = extraHTML;
  } else if (extraDiv) {
    extraDiv.classList.add('hidden');
    extraDiv.classList.remove('grid');
  }

  // Pintar horas del día actual por defecto
  renderizarCarrusel(data.hoy_horas.slice(0, 24), "Próximas horas");

  // Lista de próximos días
  const lista = document.getElementById('ui-lista-dias');
  lista.innerHTML = '';
  data.proximos_dias.forEach((dia, index) => {
    if (index === 0) return; 
    
    const hasHoras = dia.horas && dia.horas.length > 0;
    const row = document.createElement('div');
    
    // Si el día incluye los datos por hora (los próximos 2 días), lo hacemos clicable de forma visual
    row.className = `flex justify-between items-center p-4 border-b border-border-color last:border-0 transition ${hasHoras ? 'cursor-pointer active:bg-md-surface hover:bg-md-surface-container/80 hover:pl-5' : ''}`;
    
    if (hasHoras) {
      row.onclick = () => {
        renderizarCarrusel(dia.horas, `Horas: ${dia.dia_semana}`);
        
        // Destacar visualmente el título para guiar la vista del usuario
        const titulo = document.getElementById('titulo-carrusel-horas');
        titulo.classList.remove('text-text-muted');
        titulo.classList.add('text-md-primary');
        setTimeout(() => {
          titulo.classList.add('text-text-muted');
          titulo.classList.remove('text-md-primary');
        }, 1000);
      };
    }

    row.innerHTML = `
      <span class="w-24 font-medium text-text-main">${dia.dia_semana}</span>
      <div class="flex items-center gap-1 w-16">
        <span class="material-symbols-rounded text-md-primary">${dia.icono}</span>
        ${dia.prob_precipitacion > 0 ? `<span class="text-xs text-md-primary font-bold">${dia.prob_precipitacion}%</span>` : ''}
      </div>
      <div class="flex gap-1 text-right w-auto items-center">
        <div class="flex gap-3 w-20 justify-end">
          <span class="font-medium text-text-main">${dia.temp_max}°</span>
          <span class="text-text-muted">${dia.temp_min}°</span>
        </div>
        ${hasHoras ? `<span class="material-symbols-rounded text-text-muted text-lg ml-1 opacity-60">chevron_right</span>` : `<span class="w-5 ml-1"></span>`}
      </div>
    `;
    lista.appendChild(row);
  });
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

document.addEventListener('DOMContentLoaded', async () => {
  /* --- Elementos del DOM --- */
  const btnTiempo = document.getElementById('btn-tiempo');
  const btnSearch = document.getElementById('btn-search');
  const searchModal = document.getElementById('search-modal');
  const btnCloseSearch = document.getElementById('btn-close-search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  
  const btnGps = document.getElementById('btn-gps');
  const iconoGps = document.getElementById('icono-gps');
  const textoGps = document.getElementById('texto-gps');

  const btnOptions = document.getElementById('btn-options');
  const optionsModal = document.getElementById('options-modal');
  const optionsOverlay = document.getElementById('options-overlay');
  const optionsPanel = document.getElementById('options-panel');
  const themeBtns = document.querySelectorAll('.theme-btn');
  const colorBtns = document.querySelectorAll('.color-btn');
  const colorPicker = document.getElementById('custom-color-picker');
  const customColorPreview = document.getElementById('custom-color-preview');
  
  const btnToggleAdvanced = document.getElementById('btn-toggle-advanced');
  const trackAdvanced = document.getElementById('advanced-toggle-track');
  const thumbAdvanced = document.getElementById('advanced-toggle-thumb');

  const pwaInstallSection = document.getElementById('pwa-install-section');
  const btnInstallPwa = document.getElementById('btn-install-pwa');
  const iosPwaModal = document.getElementById('ios-pwa-modal');
  const btnCloseIosModal = document.getElementById('btn-close-ios-modal');
  const btnOkIosModal = document.getElementById('btn-ok-ios-modal');
  const btnPrivacy = document.getElementById('btn-privacy');

  /* --- FUNCIONES DE CIERRE DE MODALES --- */
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

  if (btnTiempo) {
    btnTiempo.addEventListener('click', () => {
      closeSearchModal();
      closeOptionsModal();
      closeIosModal();
      // Si estamos en la vista de otro día, volvemos a pintar "hoy"
      if (currentWeatherData) renderizarCarrusel(currentWeatherData.hoy_horas.slice(0, 24), "Próximas horas");
    });
  }

  /* --- LÓGICA DE BÚSQUEDA --- */
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

  if (btnCloseSearch) {
    btnCloseSearch.addEventListener('click', closeSearchModal);
  }

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
    searchInput.addEventListener('input', (e) => {
      renderizarResultadosBusqueda(e.target.value);
    });
  }

  window.seleccionarMunicipio = (ine) => {
    closeSearchModal();
    document.getElementById('ui-municipio').textContent = "Cargando...";
    cargarTiempo(ine);
  };

  /* --- LÓGICA DEL MENÚ DE OPCIONES --- */
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
  
  if (optionsOverlay) {
    optionsOverlay.addEventListener('click', closeOptionsModal);
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && pwaInstallSection) {
    pwaInstallSection.classList.add('hidden');
  }

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

  /* --- AJUSTES Y COLORES UI --- */
  const updateSettingsUI = () => {
    const currentTheme = localStorage.getItem('app_theme') || 'system';
    const currentColor = localStorage.getItem('app_color') || 'blue';
    const advancedEnabled = localStorage.getItem('app_advanced_data') === 'true';

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
    
    // UI del Toggle de Datos Avanzados
    if (advancedEnabled) {
      trackAdvanced.classList.replace('bg-border-color', 'bg-md-primary');
      thumbAdvanced.classList.add('translate-x-6');
    } else {
      trackAdvanced.classList.replace('bg-md-primary', 'bg-border-color');
      thumbAdvanced.classList.remove('translate-x-6');
    }
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentColor = localStorage.getItem('app_color') || 'blue';
    if (currentColor.startsWith('#')) window.applyCustomColor(currentColor);
  });

  themeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const val = e.currentTarget.dataset.themeVal;
      localStorage.setItem('app_theme', val);
      if (val === 'system') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', val);
      }
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
    if (savedColorInit.startsWith('#')) {
      colorPicker.value = savedColorInit;
    }

    colorPicker.addEventListener('input', (e) => {
      const hex = e.target.value;
      localStorage.setItem('app_color', hex);
      document.documentElement.setAttribute('data-color', 'custom');
      updateSettingsUI();
    });
  }

  // Cambio del Switch de Datos Avanzados
  if (btnToggleAdvanced) {
    btnToggleAdvanced.addEventListener('click', () => {
      let isAdv = localStorage.getItem('app_advanced_data') === 'true';
      localStorage.setItem('app_advanced_data', !isAdv);
      updateSettingsUI();
      if (currentWeatherData) renderizarUI(); // Refresca en tiempo real
    });
  }

  updateSettingsUI();

  /* --- INICIO DE DATOS --- */
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
