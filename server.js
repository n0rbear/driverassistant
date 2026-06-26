const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- ADATBÁZIS KARBANTARTÁS ÉS BŐVÍTÉS ---
const initDb = async () => {
    try {
        // Alaptáblák létrehozása
        await pool.query(`
            CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, driver_name TEXT, timestamp BIGINT);
            CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, driver_name TEXT, timestamp BIGINT);
            CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name TEXT UNIQUE);
            CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, name TEXT);
            CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, name TEXT);
        `);

        // Hiányzó oszlopok hozzáadása (ha már léteznek a táblák)
        const addColumn = async (table, column, type) => {
            try { await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`); } catch(e) {}
        };

        await addColumn('live_updates', 'driver_photo', 'TEXT');
        await addColumn('live_updates', 'license_plate', 'TEXT');
        await addColumn('live_updates', 'latitude', 'DOUBLE PRECISION');
        await addColumn('live_updates', 'longitude', 'DOUBLE PRECISION');
        await addColumn('live_updates', 'speed', 'FLOAT');
        await addColumn('live_updates', 'status', 'TEXT');
        await addColumn('live_updates', 'current_tour', 'TEXT');
        await addColumn('live_updates', 'next_stop', 'TEXT');
        await addColumn('live_updates', 'next_lat', 'DOUBLE PRECISION');
        await addColumn('live_updates', 'next_lng', 'DOUBLE PRECISION');

        await addColumn('costs', 'amount', 'DECIMAL');
        await addColumn('costs', 'currency', 'TEXT');
        await addColumn('costs', 'category', 'TEXT');
        await addColumn('costs', 'notes', 'TEXT');
        await addColumn('costs', 'status', "TEXT DEFAULT 'Rögzítve'");
        await addColumn('costs', 'modified_by', 'TEXT');

        console.log("✅ Adatbázis séma frissítve.");
    } catch (err) {
        console.error("❌ Hiba az inicializáláskor:", err);
    }
};
initDb();

// --- API VÉGPONTOK ---
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    try {
        await pool.query(`INSERT INTO live_updates (driver_name, driver_photo, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, 
            [d.driverName, d.driverPhoto, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
        res.sendStatus(200);
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/sync-costs', async (req, res) => {
    try {
        for (const c of req.body) {
            await pool.query('INSERT INTO costs (driver_name, amount, currency, category, notes, timestamp) VALUES ($1, $2, $3, $4, $5, $6)', 
                [c.driverName, c.amount, c.currency, c.category, c.notes, c.timestamp]);
        }
        res.sendStatus(200);
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/admin/update-cost', async (req, res) => {
    const { id, status } = req.body;
    await pool.query('UPDATE costs SET status = $1, modified_by = $2 WHERE id = $3', [status, 'Admin', id]);
    res.json({ success: true });
});

// --- ADMIN FELÜLET ---
app.get('/', async (req, res) => {
    const drivers = await pool.query('SELECT DISTINCT ON (driver_name) * FROM live_updates ORDER BY driver_name, timestamp DESC');
    const costs = await pool.query('SELECT * FROM costs ORDER BY timestamp DESC LIMIT 20');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="refresh" content="30">
            <title>Driver Admin ERP</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <style>
                body { font-family: sans-serif; margin: 0; display: flex; background: #121212; color: #eee; }
                #side { width: 400px; padding: 20px; background: #1e1e1e; height: 100vh; overflow-y: auto; }
                #map { flex-grow: 1; height: 100vh; }
                .card { background: #2c2c2c; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #3498db; }
                .btn { cursor: pointer; padding: 5px 10px; border: none; border-radius: 4px; background: #27ae60; color: white; margin-top: 5px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { padding: 8px; border-bottom: 1px solid #333; text-align: left; }
            </style>
        </head>
        <body>
            <div id="side">
                <h1>🚚 Flotta ERP</h1>
                <h3>Aktuális állapot</h3>
                ${drivers.rows.map(d => `
                    <div class="card">
                        <img src="${d.driver_photo || ''}" style="width:40px; height:40px; border-radius:50%; float:right;">
                        <b>${d.driver_name}</b> [${d.license_plate}]<br>
                        ${d.status} | ${Math.round(d.speed)} km/h<br>
                        <small>🎯 ${d.next_stop || '-'}</small>
                    </div>
                `).join('')}
                <hr>
                <h3>Költség Jóváhagyás</h3>
                <table>
                    ${costs.rows.map(c => `
                        <tr>
                            <td>${c.driver_name}<br><small>${c.category}</small></td>
                            <td>${c.amount} ${c.currency}</td>
                            <td>
                                ${c.status === 'Rögzítve' ? 
                                `<button class="btn" onclick="approve(${c.id})">OK</button>` : 
                                `<span style="color:green">✔</span>`}
                            </td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            <div id="map"></div>
            <script>
                var map = L.map('map').setView([47.5, 19.0], 7);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
                var drivers = ${JSON.stringify(drivers.rows)};
                drivers.forEach(d => {
                    L.marker([d.latitude, d.longitude]).addTo(map).bindPopup(d.driver_name + ": " + d.status);
                });
                function approve(id) {
                    fetch('/admin/update-cost', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({id, status: 'Elfogadva'})
                    }).then(() => location.reload());
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(process.env.PORT || 3000);
