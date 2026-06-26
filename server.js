const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- ADATBÁZIS SÉMA FRISSÍTÉSE ---
const initDb = async () => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, driver_name TEXT, driver_photo TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, date TEXT)`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`
    ];
    for (let q of queries) { await pool.query(q); }
};
initDb();

// --- API-K AZ APPNAK ---
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query(`INSERT INTO live_updates (driver_name, driver_photo, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, 
        [d.driverName, d.driverPhoto, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.get('/api/cost-status/:driverName', async (req, res) => {
    const result = await pool.query('SELECT id, status FROM costs WHERE driver_name = $1', [req.params.driverName]);
    res.json(result.rows);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING', [c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

// --- ADMIN MŰVELETEK ---
app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

app.post('/api/send-chat', async (req, res) => {
    await pool.query('INSERT INTO chat_messages (sender, message, timestamp) VALUES ($1, $2, $3)', [req.body.sender, req.body.message, Date.now()]);
    res.json({ success: true });
});

// --- KOMPLEX ADMIN FRONTEND ---
app.get('/', async (req, res) => {
    const drivers = await pool.query('SELECT DISTINCT ON (driver_name) * FROM live_updates ORDER BY driver_name, timestamp DESC');
    const costs = await pool.query('SELECT * FROM costs ORDER BY timestamp DESC LIMIT 30');
    const work = await pool.query('SELECT * FROM work_times ORDER BY start_time DESC LIMIT 20');
    const chat = await pool.query('SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT 20');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="refresh" content="30">
            <title>Driver Assistant ERP - Boss Panel</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
            <style>
                body { font-family: sans-serif; margin: 0; display: flex; height: 100vh; background: #121212; color: #eee; }
                #side { width: 450px; background: #1e1e1e; padding: 20px; overflow-y: auto; border-right: 2px solid #333; }
                #map { flex-grow: 1; height: 100vh; }
                .driver-box { background: #2c2c2c; padding: 15px; border-radius: 10px; margin-bottom: 10px; cursor: pointer; border-left: 5px solid #3498db; }
                .driver-box:hover { background: #3d3d3d; }
                .badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
                .cost-row { border-bottom: 1px solid #333; padding: 10px 0; display: flex; justify-content: space-between; align-items: center; }
                .paid { color: #2ecc71; } .approved { color: #3498db; } .pending { color: #e67e22; }
                .chat-msg { background: #000; padding: 5px; margin: 2px; border-radius: 4px; font-size: 12px; }
            </style>
        </head>
        <body>
            <div id="side">
                <h1 style="color:#3498db">🚛 Fleet BOSS Console</h1>
                
                <h3>📍 Élő Flotta</h3>
                ${drivers.rows.map(d => `
                    <div class="driver-box" onclick="focusDriver(${d.latitude}, ${d.longitude})">
                        <img src="${d.driver_photo || ''}" style="width:45px;height:45px;border-radius:50%;float:right">
                        <b>${d.driver_name}</b> <span class="badge" style="background:#2980b9">${d.status}</span><br>
                        <small>${d.license_plate} | ${Math.round(d.speed)} km/h</small><br>
                        <div style="margin-top:8px; font-size:12px; color:#bbb;">🎯 Cél: ${d.next_stop || 'Nincs'}</div>
                    </div>
                `).join('')}

                <hr style="border:1px solid #333">
                <h3>💰 Költségek Kezelése</h3>
                ${costs.rows.map(c => `
                    <div class="cost-row">
                        <span>${c.driver_name}<br><small>${c.category}: <b>${c.amount} ${c.currency}</b></small></span>
                        <div>
                            <span class="badge ${c.status.toLowerCase()}">${c.status}</span>
                            <button onclick="setStatus(${c.id}, 'Elfogadva')" style="background:#3498db; color:white; border:none; padding:4px;">✔</button>
                            <button onclick="setStatus(${c.id}, 'Kifizetve')" style="background:#2ecc71; color:white; border:none; padding:4px;">$</button>
                        </div>
                    </div>
                `).join('')}

                <hr style="border:1px solid #333">
                <h3>💬 Admin Chat</h3>
                <div id="chat" style="height:150px; overflow-y:auto; margin-bottom:10px;">
                    ${chat.rows.map(m => `<div class="chat-msg"><b>${m.sender}:</b> ${m.message}</div>`).join('')}
                </div>
                <input type="text" id="msg" style="width:70%; padding:5px;"> <button onclick="sendMsg()" style="width:25%;">Küldés</button>
            </div>
            <div id="map"></div>

            <script>
                var map = L.map('map').setView([47.5, 19.0], 7);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
                
                var drivers = ${JSON.stringify(drivers.rows)};
                if(drivers.length > 0) map.setView([drivers[0].latitude, drivers[0].longitude], 10);

                drivers.forEach(d => {
                    var m = L.marker([d.latitude, d.longitude]).addTo(map).bindPopup("<b>" + d.driver_name + "</b><br>" + d.status);
                    if(d.next_lat && d.next_lng) {
                        L.Routing.control({
                            waypoints: [L.latLng(d.latitude, d.longitude), L.latLng(d.next_lat, d.next_lng)],
                            createMarker: function() { return null; },
                            lineOptions: { styles: [{color: '#3498db', opacity: 0.7, weight: 5}] },
                            addWaypoints: false,
                            routeWhileDragging: false
                        }).addTo(map);
                    }
                });

                function focusDriver(lat, lng) { map.setView([lat, lng], 13); }
                function setStatus(id, status) {
                    fetch('/admin/update-cost', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, status}) }).then(() => location.reload());
                }
                function sendMsg() {
                    var m = document.getElementById('msg').value;
                    fetch('/api/send-chat', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sender: 'FŐNÖK', message: m}) }).then(() => location.reload());
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(process.env.PORT || 3000);
