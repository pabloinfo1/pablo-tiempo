const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
let municipiosDB = [];
let municipiosCargando = true;
let deferredInstallPrompt = null;

/* --- UTILIDADES --- */
// Normalizar texto eliminando tildes y diéresis para el buscador
function normalizarTexto(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Sistema de notificaciones Toast (sustituye a alert())
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

// Estado de carga visual (Skeleton)
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

/* --- CONFIGURACIÓN PWA (Manifest + Service Worker + Evento diferido) --- */
function inicializarPWA() {
  // Generar manifest dinámico para habilitar la instalación en Android
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

  // Registrar un Service Worker básico si el navegador lo permite
  if ('serviceWorker' in navigator) {
    const swCode = `
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', () => {});
    `;
    const swBlob = new Blob([swCode], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(() => {});
  }

  // Interceptar y silenciar el banner nativo de Android hasta que el usuario pulse el botón
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
    const data = await res.json();
    
    localStorage.setItem('saved_ine', ine);
    renderizarUI(data);
  } catch (error) {
    console.error("Fallo al cargar el tiempo:", error);
    document.getElementById('ui-municipio').textContent = "Error de conexión";
    mostrarToast("No se pudo conectar con el servidor meteorológico", "cloud_off");
  } finally {
    setEstadoCarga(false);
  }
}

function renderizarUI(data) {
  document.getElementById('ui-municipio').textContent = data.municipio.nombre;
  
  document.getElementById('ui-temp-actual').textContent = data.actual.temperatura;
  document.getElementById('ui-desc-actual').textContent = data.actual.estado_cielo;
  document.getElementById('ui-humedad').textContent = `${data.actual.humedad}%`;
  document.getElementById('ui-viento').textContent = `${data.actual.viento_kmh} km/h`;
  document.getElementById('ui-icono-actual').textContent = data.actual.icono;

  const carrusel = document.getElementById('ui-carrusel-horas');
  carrusel.innerHTML = '';
  data.hoy_horas.slice(0, 12).forEach(hora => {
    const card = document.createElement('div');
    card.className = 'snap-start shrink-0 bg-md-surface-container rounded-2xl p-4 flex flex-col items-center w-20 shadow-sm';
    card.innerHTML = `
      <span class="text-xs font-medium mb-2 text-text-muted">${hora.hora}</span>
      <span class="material-symbols-rounded text-3xl text-md-primary mb-2">${hora.icono}</span>
      <span class="text-lg font-medium text-text-main">${hora.temperatura}°</span>
    `;
    carrusel.appendChild(card);
  });

  const lista = document.getElementById('ui-lista-dias');
  lista.innerHTML = '';
  data.proximos_dias.forEach((dia, index) => {
    if (index === 0) return; 
    
    const row = document.createElement('div');
    row.className = 'flex justify-between items-center p-4 border-b border-border-color last:border-0';
    row.innerHTML = `
      <span class="w-24 font-medium text-text-main">${dia.dia_semana}</span>
      <div class="flex items-center gap-1 w-16">
        <span class="material-symbols-rounded text-md-primary">${dia.icono}</span>
        ${dia.prob_precipitacion > 0 ? `<span class="text-xs text-md-primary font-bold">${dia.prob_precipitacion}%</span>` : ''}
      </div>
      <div class="flex gap-3 text-right w-24">
        <span class="font-medium text-text-main">${dia.temp_max}°</span>
        <span class="text-text-muted">${dia.temp_min}°</span>
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

  // El botón "Tiempo" cierra cualquier modal abierto
  if (btnTiempo) {
    btnTiempo.addEventListener('click', () => {
      closeSearchModal();
      closeOptionsModal();
      closeIosModal();
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

  // Ocultar sección de instalar PWA si ya se está ejecutando como PWA instalada
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone && pwaInstallSection) {
    pwaInstallSection.classList.add('hidden');
  }

  // Acción del botón "Instalar aplicación (PWA)"
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
        // Dispara el diálogo nativo de Android / Chrome solo al pulsar aquí
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

  // Botón Privacidad y Cookies
  if (btnPrivacy) {
    btnPrivacy.addEventListener('click', () => {
      closeOptionsModal();
      mostrarToast('Sin cookies de rastreo. Solo guardamos tus ajustes en el dispositivo.', 'verified_user');
    });
  }

  // Refrescar UI de botones y aplicar contraste de colores
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

  // Escuchar cambios del tema del sistema en tiempo real para reajustar el color custom si es necesario
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentColor = localStorage.getItem('app_color') || 'blue';
    if (currentColor.startsWith('#')) window.applyCustomColor(currentColor);
  });

  // Cambio de Tema
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

  // Cambio de Color Predefinido
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

  // Cambio de Color Personalizado Libre
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

  updateSettingsUI();

  /* --- INICIO DE DATOS EN PARALELO (Promise.all) --- */
  const savedIne = localStorage.getItem('saved_ine') || '07054';

  const cargarMunicipiosDB = async () => {
    try {
      const res = await fetch('municipios.json');
      if (res.ok) {
        const rawData = await res.json();
        // Pre-normalizamos nombres y provincias al cargar para que la búsqueda sea instantánea
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
      // Si el usuario tenía el modal de búsqueda abierto esperando, refrescamos resultados
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
