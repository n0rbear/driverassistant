const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ADATBÁZIS SÉMA FRISSÍTÉSE
const initDb = async () => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, driver_name TEXT, driver_photo TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`
    ];
    for (let q of queries) { await pool.query(q); }
};
initDb();

// API-K (APP -> BACKEND)
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query('INSERT INTO live_updates (driver_name, driver_photo, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [d.driverName, d.driverPhoto, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/send-chat', async (req, res) => {
    const { sender, message, timestamp } = req.body;
    await pool.query('INSERT INTO chat_messages (sender, message, timestamp) VALUES ($1, $2, $3)', [sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat', async (req, res) => {
    const result = await pool.query('SELECT sender, message, timestamp FROM chat_messages ORDER BY timestamp ASC');
    res.json(result.rows);
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

// ADMIN MŰVELETEK (WEB -> DB)
app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

// ADMIN FRONTEND
app.get('/', async (req, res) => {
    const drivers = await pool.query('SELECT DISTINCT ON (driver_name) * FROM live_updates ORDER BY driver_name, timestamp DESC');
    const costs = await pool.query('SELECT * FROM costs ORDER BY timestamp DESC LIMIT 20');
    const chat = await pool.query('SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT 50');

    res.send(`
        <html>
        <head>
            <meta http-equiv="refresh" content="30">
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
            <style>
                body { font-family: sans-serif; margin: 0; display: flex; height: 100vh; background: #1a1a1a; color: white; }
                #side { width: 400px; padding: 20px; background: #222; overflow-y: auto; border-right: 1px solid #444; }
                #map { flex-grow: 1; height: 100vh; }
                .card { background: #333; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 5px solid #3498db; cursor: pointer; }
                .msg { padding: 8px; margin: 5px 0; border-radius: 8px; font-size: 13px; max-width: 90%; }
                .msg-boss { background: #F57F17; color: black; align-self: flex-end; margin-left: auto; }
                .msg-driver { background: #34495e; color: white; }
                .chat-container { height: 250px; overflow-y: auto; background: #111; padding: 10px; display: flex; flex-direction: column; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div id="side">
                <h1 style="color:#3498db">🚛 Fleet BOSS</h1>
                <h3>📍 Flotta Állapot</h3>
                \${drivers.rows.map(d => \`
                    <div class="card" onclick="focusMarker(\${d.latitude}, \${d.longitude})">
                        <img src="\${d.driver_photo || ''}" style="width:40px;height:40px;border-radius:50%;float:right">
                        <b>\${d.driver_name}</b><br>
                        <small>\${d.status} | \${d.license_plate}</small><br>
                        <small style="color:#aaa">🎯 Cél: \${d.next_stop || 'Nincs'}</small>
                    </div>
                \`).join('')}
                <hr>
                <h3>💰 Költségek</h3>
                \${costs.rows.map(c => \`
                    <div style="font-size:12px; border-bottom:1px solid #444; padding:5px;">
                        \${c.driver_name}: \${c.amount} \${c.currency} (\${c.status})
                        <button onclick="setStatus(\${c.id}, 'Kifizetve')">$</button>
                    </div>
                \`).join('')}
                <hr>
                <h3>💬 Chat</h3>
                <div class="chat-container">
                    \${chat.rows.map(m => {
                        const isBoss = m.sender === 'DISZPÉCSER' || m.sender === 'FŐNÖK';
                        return \`<div class="msg \${isBoss ? 'msg-boss' : 'msg-driver'}"><b>\${m.sender}:</b><br>\${m.message}</div>\`;
                    }).reverse().join('')}
                </div>
                <div style="margin-top:10px;">
                    <input type="text" id="m" style="width:70%; background:#333; border:1px solid #444; color:white; padding:5px;">
                    <button onclick="sendMsg()" style="width:25%; background:#3498db; border:none; color:white; padding:6px; cursor:pointer;">OK</button>
                </div>
            </div>
            <div id="map"></div>
            <script>
                var map = L.map('map').setView([47.5, 19.0], 7);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
                var drivers = \${JSON.stringify(drivers.rows)};
                if(drivers.length > 0) map.setView([drivers[0].latitude, drivers[0].longitude], 10);
                drivers.forEach(d => {
                    L.marker([d.latitude, d.longitude]).addTo(map).bindPopup(d.driver_name);
                    if(d.next_lat && d.next_lng) {
                        L.Routing.control({
                            waypoints: [L.latLng(d.latitude, d.longitude), L.latLng(d.next_lat, d.next_lng)],
                            createMarker: function() { return null; },
                            lineOptions: { styles: [{color: '#3498db', opacity: 0.8, weight: 6}] },
                            addWaypoints: false,
                            routeWhileDragging: false
                        }).addTo(map);
                    }
                });
                function focusMarker(lat, lng) { map.setView([lat, lng], 13); }
                function sendMsg() {
                    var text = document.getElementById('m').value;
                    if(!text) return;
                    fetch('/api/send-chat', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sender: 'DISZPÉCSER', message: text, timestamp: Date.now()}) }).then(() => location.reload());
                }
                function setStatus(id, status) {
                    fetch('/admin/update-cost', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, status}) }).then(() => location.reload());
                }
            </script>
        </body>
        </html>
    \`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
