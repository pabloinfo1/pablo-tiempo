const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
let municipiosDB = [];

async function cargarTiempo(ine) {
  try {
    const res = await fetch(`${WORKER_URL}?ine=${ine}`);
    if (!res.ok) throw new Error('Error en la red');
    const data = await res.json();
    
    // Guardamos la ciudad consultada para la próxima visita
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
      <span class="text-lg font-medium">${hora.temperatura}°</span>
    `;
    carrusel.appendChild(card);
  });

  const lista = document.getElementById('ui-lista-dias');
  lista.innerHTML = '';
  data.proximos_dias.forEach((dia, index) => {
    if (index === 0) return; 
    
    const row = document.createElement('div');
    row.className = 'flex justify-between items-center p-4 border-b border-slate-200/50 last:border-0';
    row.innerHTML = `
      <span class="w-24 font-medium text-slate-700">${dia.dia_semana}</span>
      <div class="flex items-center gap-1 w-16">
        <span class="material-symbols-rounded text-md-primary">${dia.icono}</span>
        ${dia.prob_precipitacion > 0 ? `<span class="text-xs text-blue-600 font-bold">${dia.prob_precipitacion}%</span>` : ''}
      </div>
      <div class="flex gap-3 text-right w-24">
        <span class="font-medium">${dia.temp_max}°</span>
        <span class="text-slate-500">${dia.temp_min}°</span>
      </div>
    `;
    lista.appendChild(row);
  });
}

// Inicializamos todo cuando el DOM esté completamente listo
document.addEventListener('DOMContentLoaded', async () => {
  
  const btnSearch = document.getElementById('btn-search');
  const searchModal = document.getElementById('search-modal');
  const btnCloseSearch = document.getElementById('btn-close-search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  // Evento para abrir el modal
  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      searchModal.classList.remove('hidden');
      searchModal.classList.add('flex');
      searchInput.focus();
    });
  }

  // Evento para cerrar el modal
  if (btnCloseSearch) {
    btnCloseSearch.addEventListener('click', () => {
      searchModal.classList.add('hidden');
      searchModal.classList.remove('flex');
      searchInput.value = '';
      searchResults.innerHTML = '';
    });
  }

  // Evento de escritura para el buscador
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      
      if (query.length < 2) {
        searchResults.innerHTML = '';
        return;
      }
      
      // Detectar si es un código postal (solo números)
      const isNumber = /^\d+$/.test(query);
      
      const filtrados = municipiosDB.filter(m => {
        if (isNumber) {
          return m.cps && m.cps.some(cp => cp.startsWith(query));
        }
        return m.nombre.toLowerCase().includes(query) || m.provincia.toLowerCase().includes(query);
      }).slice(0, 15); 
      
      searchResults.innerHTML = filtrados.map(m => `
        <div class="p-4 flex flex-col border-b border-slate-100 active:bg-md-surface-container cursor-pointer transition" 
             onclick="seleccionarMunicipio('${m.id_ine}')">
          <span class="font-medium text-lg text-slate-800">${m.nombre}</span>
          <span class="text-sm text-slate-500">${m.provincia}</span>
        </div>
      `).join('');
    });
  }

  // Función global asignada al objeto window para el evento onclick
  window.seleccionarMunicipio = (ine) => {
    searchModal.classList.add('hidden');
    searchModal.classList.remove('flex');
    searchInput.value = '';
    searchResults.innerHTML = '';
    
    document.getElementById('ui-municipio').textContent = "Cargando...";
    cargarTiempo(ine);
  };

  // Carga del JSON de municipios. Si falla, carga un array de emergencia para probar.
  try {
    const res = await fetch('municipios.json');
    if (res.ok) {
      municipiosDB = await res.json();
    } else {
      console.warn('No se encontró municipios.json. Cargando base de datos temporal.');
      municipiosDB = [
        { "id_ine": "07054", "nombre": "Santa Eulària des Riu", "provincia": "Illes Balears", "cps": ["07840", "07849", "07819"] },
        { "id_ine": "28079", "nombre": "Madrid", "provincia": "Madrid", "cps": ["28001", "28002", "28013"] },
        { "id_ine": "08019", "nombre": "Barcelona", "provincia": "Barcelona", "cps": ["08001", "08002"] },
        { "id_ine": "48020", "nombre": "Bilbao", "provincia": "Bizkaia", "cps": ["48001", "48002"] }
      ];
    }
  } catch (error) {
    console.error("No se pudo cargar la base de datos de municipios", error);
  }
  
  // Recuperar INE guardado de visitas anteriores, o cargar 07054 (Santa Eulària) por defecto
  const savedIne = localStorage.getItem('saved_ine') || '07054';
  cargarTiempo(savedIne);
});
