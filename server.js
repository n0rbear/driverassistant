const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// --- ADATBÁZIS INICIALIZÁLÁSA ---
const initDb = async () => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY, name TEXT UNIQUE, photo TEXT, phone TEXT, 
            email TEXT, license_plate TEXT, status TEXT DEFAULT 'Aktív'
        )`,
        `CREATE TABLE IF NOT EXISTS live_updates (
            id SERIAL PRIMARY KEY, driver_name TEXT, driver_photo TEXT, license_plate TEXT,
            latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, 
            status TEXT, current_tour TEXT, next_stop TEXT, 
            next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, timestamp BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS costs (
            id SERIAL PRIMARY KEY, driver_name TEXT, amount DECIMAL, currency TEXT, 
            category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', 
            modified_by TEXT, timestamp BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY, sender TEXT, message TEXT, timestamp BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS tours (
            id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, customer TEXT, 
            date TEXT, status TEXT DEFAULT 'Aktív'
        )`,
        `CREATE TABLE IF NOT EXISTS hotels (
            id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, address TEXT, 
            notes TEXT, timestamp BIGINT
        )`
    ];
    for (let q of queries) { await pool.query(q); }
    console.log("✅ Minden tábla kész.");
};
initDb();

// --- API VÉGPONTOK (APP SZÁMÁRA) ---

app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query(`INSERT INTO live_updates (driver_name, driver_photo, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, 
        [d.driverName, d.driverPhoto, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING', 
            [c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

// --- ADMIN MŰVELETEK (WEB SZÁMÁRA) ---

app.post('/admin/update-cost-status', async (req, res) => {
    const { id, status, adminName } = req.body;
    await pool.query('UPDATE costs SET status = $1, modified_by = $2 WHERE id = $3', [status, adminName, id]);
    res.json({ success: true });
});

app.post('/admin/delete-employee', async (req, res) => {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.body.id]);
    res.json({ success: true });
});

// --- ADMIN FRONTEND (ALL-IN-ONE) ---
app.get('/', async (req, res) => {
    const drivers = await pool.query('SELECT DISTINCT ON (driver_name) * FROM live_updates ORDER BY driver_name, timestamp DESC');
    const costs = await pool.query('SELECT * FROM costs ORDER BY timestamp DESC LIMIT 50');
    const chat = await pool.query('SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT 20');
    const employees = await pool.query('SELECT * FROM employees');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="refresh" content="30">
            <title>Driver Assistant ERP - Corporate Admin</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
            <style>
                :root { --bg: #121212; --card: #1e1e1e; --primary: #3498db; --text: #e0e0e0; }
                body { font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }
                #sidebar { width: 450px; background: var(--card); padding: 20px; overflow-y: auto; border-right: 1px solid #333; }
                #map { flex-grow: 1; height: 100vh; }
                .card { background: #252525; padding: 15px; border-radius: 12px; margin-bottom: 15px; border-left: 4px solid var(--primary); }
                .status-tag { padding: 3px 8px; border-radius: 5px; font-size: 11px; text-transform: uppercase; font-weight: bold; }
                .Vezetés { background: #2980b9; } .Pihenő { background: #27ae60; } .Rakodás { background: #e67e22; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
                th, td { text-align: left; padding: 10px; border-bottom: 1px solid #333; }
                th { color: #888; }
                .btn { cursor: pointer; padding: 5px 10px; border: none; border-radius: 4px; font-size: 11px; transition: 0.2s; }
                .btn-approve { background: #27ae60; color: white; }
                .btn-chat { width: 100%; background: var(--primary); color: white; padding: 10px; margin-top: 5px; }
                .chat-box { height: 150px; background: #000; overflow-y: auto; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 11px; }
            </style>
        </head>
        <body>
            <div id="sidebar">
                <h1 style="color:var(--primary)">🚚 Fleet Control Center</h1>
                
                <section>
                    <h3>📡 Élő Flotta Állapot</h3>
                    ${drivers.rows.map(d => `
                        <div class="card">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <img src="${d.driver_photo || 'https://via.placeholder.com/40'}" style="width:45px;height:45px;border-radius:50%;border:2px solid #444;">
                                <div>
                                    <b style="font-size:16px;">${d.driver_name}</b> <br>
                                    <span class="status-tag ${d.status}">${d.status}</span> 
                                    <span style="color:#aaa; margin-left:10px;">${Math.round(d.speed)} km/h • ${d.license_plate}</span>
                                </div>
                            </div>
                            <div style="margin-top:10px; font-size:13px; color:#bbb;">
                                <b>🎯 Cél:</b> ${d.next_stop || 'Nincs aktív túra'}
                            </div>
                        </div>
                    `).join('')}
                </section>

                <hr style="border:0; border-top:1px solid #333; margin:20px 0;">

                <section>
                    <h3>💰 Költségek Jóváhagyása</h3>
                    <table>
                        <tr><th>Sofőr</th><th>Tétel</th><th>Összeg</th><th>Módosította</th><th>Akció</th></tr>
                        ${costs.rows.map(c => `
                            <tr>
                                <td>${c.driver_name}</td>
                                <td>${c.category}</td>
                                <td style="color:#2ecc71; font-weight:bold;">${c.amount} ${c.currency}</td>
                                <td style="color:#888">${c.modified_by || '-'}</td>
                                <td>
                                    ${c.status === 'Rögzítve' ? 
                                        `<button class="btn btn-approve" onclick="updateCost(${c.id}, 'Elfogadva')">Pipa</button>` : 
                                        `<span style="color:#27ae60">✔ ${c.status}</span>`}
                                </td>
                            </tr>
                        `).join('')}
                    </table>
                </section>

                <section style="margin-top:20px;">
                    <h3>💬 Központi Chat</h3>
                    <div class="chat-box">
                        ${chat.rows.map(m => `<div><b style="color:var(--primary)">[${m.sender}]</b>: ${m.message}</div>`).join('')}
                    </div>
                    <input type="text" id="chatInput" style="width:100%; background:#333; border:1px solid #444; color:white; padding:8px; margin-top:5px;" placeholder="Üzenet küldése...">
                    <button class="btn btn-chat">Küldés a sofőröknek</button>
                </section>
            </div>

            <div id="map"></div>

            <script>
                var map = L.map('map').setView([47.5, 19.0], 7);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
                
                var drivers = ${JSON.stringify(drivers.rows)};
                drivers.forEach(d => {
                    var icon = L.divIcon({className: 'custom-div-icon', html: "<div style='background:var(--primary); width:12px; height:12px; border-radius:50%; border:2px solid white;'></div>"});
                    L.marker([d.latitude, d.longitude], {icon: icon}).addTo(map)
                        .bindPopup("<b>" + d.driver_name + "</b><br>" + d.status);
                    
                    if(d.next_lat && d.next_lng) {
                        L.Routing.control({
                            waypoints: [L.latLng(d.latitude, d.longitude), L.latLng(d.next_lat, d.next_lng)],
                            createMarker: function() { return null; },
                            lineOptions: { styles: [{color: '#3498db', opacity: 0.6, weight: 4}] },
                            addWaypoints: false,
                            routeWhileDragging: false
                        }).addTo(map);
                    }
                });

                function updateCost(id, status) {
                    fetch('/admin/update-cost-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id, status, adminName: 'Admin/Főnök' })
                    }).then(() => location.reload());
                }
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
