const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
let municipiosDB = [];

async function cargarTiempo(ine) {
  try {
    const res = await fetch(`${WORKER_URL}?ine=${ine}`);
    if (!res.ok) throw new Error('Error en la red');
    const data = await res.json();
    
    localStorage.setItem('saved_ine', ine);
    renderizarUI(data);
  } catch (error) {
    console.error("Fallo al cargar el tiempo:", error);
    document.getElementById('ui-municipio').textContent = "Error de conexión";
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
      <span class="text-xs font-medium mb-2">${hora.hora}</span>
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
        ${dia.prob_precipitacion > 0 ? `<span class="text-xs text-blue-600 font-bold">${dia.prob_precipitacion}%</span>` : ''}
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
  const btnSearch = document.getElementById('btn-search');
  const searchModal = document.getElementById('search-modal');
  const btnCloseSearch = document.getElementById('btn-close-search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const btnGps = document.getElementById('btn-gps');
  const iconoGps = document.getElementById('icono-gps');
  const textoGps = document.getElementById('texto-gps');

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      searchModal.classList.remove('hidden');
      searchModal.classList.add('flex');
      searchInput.focus();
    });
  }

  if (btnCloseSearch) {
    btnCloseSearch.addEventListener('click', () => {
      searchModal.classList.add('hidden');
      searchModal.classList.remove('flex');
      searchInput.value = '';
      searchResults.innerHTML = '';
      btnGps.classList.remove('hidden');
    });
  }

  if (btnGps) {
    btnGps.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Tu navegador no soporta geolocalización');
        return;
      }

      iconoGps.textContent = 'sync';
      iconoGps.classList.add('animate-spin');
      textoGps.textContent = 'Buscando tu zona...';

      navigator.geolocation.getCurrentPosition((position) => {
        const userLat = position.coords.latitude;
        const userLon = position.coords.longitude;

        let municipioMasCercano = null;
        let distanciaMinima = Infinity;

        municipiosDB.forEach(m => {
          if (m.lat && m.lon) {
            const dist = calcularDistancia(userLat, userLon, m.lat, m.lon);
            if (dist < distanciaMinima) {
              distanciaMinima = dist;
              municipioMasCercano = m;
            }
          }
        });

        iconoGps.textContent = 'my_location';
        iconoGps.classList.remove('animate-spin');
        textoGps.textContent = 'Usar mi ubicación actual';

        if (municipioMasCercano) {
          seleccionarMunicipio(municipioMasCercano.id_ine);
        }

      }, (error) => {
        console.error(error);
        alert('Activa el permiso de ubicación en tu navegador para usar esta función.');
        iconoGps.textContent = 'my_location';
        iconoGps.classList.remove('animate-spin');
        textoGps.textContent = 'Usar mi ubicación actual';
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      
      if (query.length > 0) {
        btnGps.classList.add('hidden');
      } else {
        btnGps.classList.remove('hidden');
        searchResults.innerHTML = '';
        return;
      }

      if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
      }
      
      const isNumber = /^\d+$/.test(query);
      
      const filtrados = municipiosDB.filter(m => {
        if (isNumber) {
          return m.cps && m.cps.some(cp => cp.startsWith(query));
        }
        return m.nombre.toLowerCase().includes(query) || m.provincia.toLowerCase().includes(query);
      }).slice(0, 15); 
      
      searchResults.innerHTML = filtrados.map(m => `
        <div class="p-4 flex flex-col border-b border-border-color active:bg-md-surface-container cursor-pointer transition" 
             onclick="seleccionarMunicipio('${m.id_ine}')">
          <span class="font-medium text-lg text-text-main">${m.nombre}</span>
          <span class="text-sm text-text-muted">${m.provincia}</span>
        </div>
      `).join('');
    });
  }

  window.seleccionarMunicipio = (ine) => {
    searchModal.classList.add('hidden');
    searchModal.classList.remove('flex');
    searchInput.value = '';
    searchResults.innerHTML = '';
    btnGps.classList.remove('hidden');
    
    document.getElementById('ui-municipio').textContent = "Cargando...";
    cargarTiempo(ine);
  };

  try {
    const res = await fetch('municipios.json');
    if (res.ok) {
      municipiosDB = await res.json();
    }
  } catch (error) {
    console.error("No se pudo cargar la base de datos de municipios", error);
  }
  
  const savedIne = localStorage.getItem('saved_ine') || '07054';
  cargarTiempo(savedIne);
});
