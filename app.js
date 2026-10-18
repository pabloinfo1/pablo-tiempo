// ==========================================
// CONFIGURACIÓN Y ESTADO DE LA APLICACIÓN
// ==========================================

// Cargar preferencias del usuario desde localStorage o valores por defecto
const defaultSettings = {
    uv: false,
    snow: false,
    storm: false,
    wind: false,
    feelsLike: false
};

let userSettings = JSON.parse(localStorage.getItem('pablometro_settings')) || defaultSettings;

// Nombres para mostrar en el menú de ajustes
const settingLabels = {
    uv: "Radiación Ultravioleta",
    snow: "Cota de nieve",
    storm: "Probabilidad de tormenta",
    wind: "Velocidad y dirección del viento",
    feelsLike: "Sensación térmica"
};

// ==========================================
// MOCK DATA (Simulación de la API de AEMET)
// *Sustituye esta lógica por tu fetch real*
// ==========================================
const mockData = {
    location: "Santa Eulària des Riu (Illes Balears)",
    upcomingHours: [
        { time: "14:00", temp: 24, precip: 0, uv: 6, snow: "0m", storm: 0, windSpeed: 15, windDir: "NE", feelsLike: 25 },
        { time: "15:00", temp: 25, precip: 10, uv: 5, snow: "0m", storm: 5, windSpeed: 18, windDir: "NE", feelsLike: 26 },
        { time: "16:00", temp: 23, precip: 40, uv: 3, snow: "0m", storm: 20, windSpeed: 25, windDir: "N", feelsLike: 22 },
        { time: "17:00", temp: 21, precip: 80, uv: 1, snow: "0m", storm: 60, windSpeed: 30, windDir: "N", feelsLike: 19 }
    ],
    nextDays: [
        {
            id: "day1", date: "Mañana, 19 Oct", min: 18, max: 26,
            hours: [
                { time: "08:00", temp: 18, precip: 0, uv: 1, snow: "0m", storm: 0, windSpeed: 10, windDir: "E", feelsLike: 18 },
                { time: "14:00", temp: 26, precip: 5, uv: 7, snow: "0m", storm: 0, windSpeed: 12, windDir: "SE", feelsLike: 27 },
                { time: "20:00", temp: 21, precip: 0, uv: 0, snow: "0m", storm: 0, windSpeed: 8, windDir: "S", feelsLike: 21 }
            ]
        },
        {
            id: "day2", date: "Lunes, 20 Oct", min: 19, max: 25,
            hours: [
                { time: "08:00", temp: 19, precip: 20, uv: 1, snow: "0m", storm: 10, windSpeed: 20, windDir: "W", feelsLike: 18 },
                { time: "14:00", temp: 25, precip: 60, uv: 4, snow: "0m", storm: 40, windSpeed: 35, windDir: "NW", feelsLike: 23 },
                { time: "20:00", temp: 20, precip: 10, uv: 0, snow: "0m", storm: 5, windSpeed: 15, windDir: "NW", feelsLike: 19 }
            ]
        }
    ]
};

// ==========================================
// LÓGICA DE RENDERIZADO (UI)
// ==========================================

// Genera el HTML de una tarjeta horaria, inyectando datos extra solo si están activados
function createHourlyCard(hour) {
    let extraDataHtml = '';
    
    // Si hay alguna opción activada, creamos el contenedor minimalista
    if (userSettings.uv || userSettings.snow || userSettings.storm || userSettings.wind || userSettings.feelsLike) {
        extraDataHtml += `<div class="extra-data-container">`;
        
        if (userSettings.feelsLike) extraDataHtml += `<div class="extra-item"><span>Sens:</span> <span>${hour.feelsLike}º</span></div>`;
        if (userSettings.storm) extraDataHtml += `<div class="extra-item"><span>Torm:</span> <span>${hour.storm}%</span></div>`;
        if (userSettings.wind) extraDataHtml += `<div class="extra-item"><span>Viento:</span> <span>${hour.windSpeed}km/h ${hour.windDir}</span></div>`;
        if (userSettings.uv) extraDataHtml += `<div class="extra-item"><span>UV:</span> <span>${hour.uv}</span></div>`;
        if (userSettings.snow) extraDataHtml += `<div class="extra-item"><span>Nieve:</span> <span>${hour.snow}</span></div>`;
        
        extraDataHtml += `</div>`;
    }

    return `
        <div class="hourly-card">
            <span class="hourly-time">${hour.time}</span>
            <span class="hourly-temp">${hour.temp}º</span>
            <span class="hourly-precip">💧 ${hour.precip}%</span>
            ${extraDataHtml}
        </div>
    `;
}

function renderApp() {
    // 1. Título de ubicación
    document.getElementById('location-name').innerText = mockData.location;

    // 2. Próximas horas
    const upcomingContainer = document.getElementById('upcoming-hours');
    upcomingContainer.innerHTML = mockData.upcomingHours.map(createHourlyCard).join('');

    // 3. Próximos días (Clicables)
    const nextDaysContainer = document.getElementById('next-days');
    // Mantenemos el H2 inicial y añadimos los días
    nextDaysContainer.innerHTML = '<h2>Próximos días</h2>' + mockData.nextDays.map(day => `
        <div class="daily-card" onclick="openDayDetails('${day.id}')">
            <span style="font-weight: 600;">${day.date}</span>
            <span>${day.min}º / ${day.max}º ➔</span>
        </div>
    `).join('');
}

function renderSettingsMenu() {
    const container = document.getElementById('settings-container');
    container.innerHTML = Object.keys(defaultSettings).map(key => `
        <div class="settings-option">
            <span>${settingLabels[key]}</span>
            <label class="switch">
                <input type="checkbox" id="setting-${key}" ${userSettings[key] ? 'checked' : ''} onchange="toggleSetting('${key}')">
                <span class="slider"></span>
            </label>
        </div>
    `).join('');
}

// ==========================================
// CONTROLADORES DE EVENTOS Y MODALES
// ==========================================

function toggleSetting(key) {
    userSettings[key] = !userSettings[key];
    localStorage.setItem('pablometro_settings', JSON.stringify(userSettings));
    
    // Re-renderizamos la app en tiempo real para reflejar los cambios
    renderApp();
    
    // Si el modal de detalles del día está abierto, también lo actualizamos
    const activeDayModal = document.getElementById('modal-day');
    if (activeDayModal.classList.contains('active')) {
        const currentTitle = document.getElementById('modal-day-title').innerText;
        const currentDay = mockData.nextDays.find(d => d.date === currentTitle);
        if (currentDay) {
            document.getElementById('modal-day-hours').innerHTML = currentDay.hours.map(createHourlyCard).join('');
        }
    }
}

function openDayDetails(dayId) {
    const dayData = mockData.nextDays.find(d => d.id === dayId);
    if (!dayData) return;

    document.getElementById('modal-day-title').innerText = dayData.date;
    document.getElementById('modal-day-hours').innerHTML = dayData.hours.map(createHourlyCard).join('');
    
    openModal('modal-day');
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Abrir menú de ajustes
document.getElementById('btn-settings').addEventListener('click', () => {
    openModal('modal-settings');
});

// Cerrar modales al hacer clic fuera del contenido
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    renderSettingsMenu();
    renderApp();
});
