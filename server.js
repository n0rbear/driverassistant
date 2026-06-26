const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Adatbázis kapcsolat
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- AUTOMATA TÁBLA INICIALIZÁLÁS ---
const initDb = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS live_updates (
            id SERIAL PRIMARY KEY, driver_name TEXT, license_plate TEXT,
            latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
            speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, timestamp BIGINT
        );
        CREATE TABLE IF NOT EXISTS work_times (
            id SERIAL PRIMARY KEY, driver_name TEXT, type TEXT,
            start_time BIGINT, end_time BIGINT, mileage INT,
            end_mileage INT, license_plate TEXT, notes TEXT, date TEXT
        );
        CREATE TABLE IF NOT EXISTS costs (
            id SERIAL PRIMARY KEY, driver_name TEXT, amount DECIMAL,
            currency TEXT, category TEXT, notes TEXT, mileage INT, timestamp BIGINT
        );
        CREATE TABLE IF NOT EXISTS hotels (
            id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT,
            address TEXT, timestamp BIGINT
        );
    `;
    await pool.query(query);
    console.log("✅ Adatbázis kész.");
};
initDb();

// --- API VÉGPONTOK ---

app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query(
        'INSERT INTO live_updates (driver_name, license_plate, latitude, longitude, speed, status, current_tour, next_stop, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [d.driverName, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.timestamp]
    );
    res.sendStatus(200);
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query(
            'INSERT INTO work_times (driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]
        );
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query(
            'INSERT INTO costs (driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]
        );
    }
    res.sendStatus(200);
});

// --- ADMIN FRONTEND (Térkép + Adatok) ---
app.get('/', async (req, res) => {
    const live = await pool.query('SELECT * FROM live_updates ORDER BY timestamp DESC LIMIT 50');
    const costs = await pool.query('SELECT * FROM costs ORDER BY timestamp DESC LIMIT 20');
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Driver Assistant Admin</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <style>
                body { font-family: sans-serif; margin: 20px; background: #f0f2f5; }
                #map { height: 400px; border-radius: 8px; margin-bottom: 20px; }
                .card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
                th { background: #007bff; color: white; }
                .status { padding: 4px 8px; border-radius: 4px; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>🚚 Driver Assistant - Flotta Monitor</h1>
            <div id="map"></div>
            
            <div class="card">
                <h2>Aktuális pozíciók (Utolsó 50 frissítés)</h2>
                <table>
                    <tr><th>Sofőr</th><th>Rendszám</th><th>Státusz</th><th>Sebesség</th><th>Túra / Köv. Cím</th><th>Idő</th></tr>
                    ${live.rows.map(r => `
                        <tr>
                            <td><b>${r.driver_name}</b></td>
                            <td>${r.license_plate}</td>
                            <td><span class="status">${r.status}</span></td>
                            <td>${Math.round(r.speed)} km/h</td>
                            <td>${r.current_tour || '-'} <br><small>${r.next_stop || ''}</small></td>
                            <td>${new Date(Number(r.timestamp)).toLocaleString('hu-HU')}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>

            <script>
                var map = L.map('map').setView([47.5, 19.0], 7);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                
                var points = ${JSON.stringify(live.rows)};
                points.forEach(p => {
                    L.marker([p.latitude, p.longitude])
                        .bindPopup("<b>" + p.driver_name + "</b><br>" + p.status + " (" + Math.round(p.speed) + " km/h)")
                        .addTo(map);
                });
                if(points.length > 0) map.panTo([points[0].latitude, points[0].longitude]);
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Szerver fut: ${PORT}`));
