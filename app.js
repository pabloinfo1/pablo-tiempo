// Apuntamos a tu Worker en Cloudflare
const WORKER_URL = 'https://aemet-proxy.pabloinfo1.workers.dev/';
const DEFAULT_INE = '07054'; // Por defecto

async function cargarTiempo(ine) {
  try {
    const res = await fetch(`${WORKER_URL}?ine=${ine}`);
    if (!res.ok) throw new Error('Error en la red');
    const data = await res.json();
    
    renderizarUI(data);
  } catch (error) {
    console.error("Fallo al cargar el tiempo:", error);
    document.getElementById('ui-municipio').textContent = "Error de conexión";
  }
}

function renderizarUI(data) {
  // 1. Cabecera
  document.getElementById('ui-municipio').textContent = data.municipio.nombre;
  
  // 2. Tiempo Actual
  document.getElementById('ui-temp-actual').textContent = data.actual.temperatura;
  document.getElementById('ui-desc-actual').textContent = data.actual.estado_cielo;
  document.getElementById('ui-humedad').textContent = `${data.actual.humedad}%`;
  document.getElementById('ui-viento').textContent = `${data.actual.viento_kmh} km/h`;
  document.getElementById('ui-icono-actual').textContent = data.actual.icono;

  // 3. Horas (Mostramos las próximas 12 horas)
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

  // 4. Próximos Días
  const lista = document.getElementById('ui-lista-dias');
  lista.innerHTML = '';
  data.proximos_dias.forEach((dia, index) => {
    // Evitamos mostrar hoy si ya está pasando
    if (index === 0) return; 
    
    const row = document.createElement('div');
    row.className = 'flex justify-between items-center p-4 border-b border-slate-200/50 last:border-0';
    row.innerHTML = `
      <span class="w-24 font-medium">${dia.dia_semana}</span>
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

// Inicializar la app
document.addEventListener('DOMContentLoaded', () => {
  cargarTiempo(DEFAULT_INE);
});