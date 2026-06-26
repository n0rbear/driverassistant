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
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`
    ];
    for (let q of queries) { await pool.query(q); }
    try { await pool.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS driver_name TEXT'); } catch(e) {}
};
initDb();

// API-K
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query('INSERT INTO live_updates (driver_name, driver_photo, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [d.driverName, d.driverPhoto, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/send-chat', async (req, res) => {
    const { driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (driver_name, sender, message, timestamp) VALUES ($1, $2, $3, $4)', [driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat/:driverName', async (req, res) => {
    const result = await pool.query('SELECT sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [req.params.driverName]);
    res.json(result.rows);
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query('INSERT INTO work_times (driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING',
            [wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING', [c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

// ADMIN FRONTEND
app.get('/', async (req, res) => {
    const drivers = await pool.query('SELECT DISTINCT ON (driver_name) * FROM live_updates ORDER BY driver_name, timestamp DESC');
    let list = drivers.rows.map(d => `
        <div class="card" onclick="location.href='/driver/${encodeURIComponent(d.driver_name)}'">
            <img src="${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right">
            <h3>${d.driver_name}</h3>
            <p>${d.status} | ${d.license_plate}</p>
        </div>
    `).join('');
    res.send(`<html><head><title>Driver ERP</title><style>body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; } .card:hover { transform: scale(1.02); background: #444; }</style></head><body><h1>🚛 Flotta kiválasztása</h1><div class="grid">${list}</div></body></html>`);
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const update = await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name]);
    const costs = await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    const chat = await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name]);
    const work = await pool.query('SELECT * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC', [name]);
    const d = update.rows[0] || { driver_name: name };

    res.send(`
        <html>
        <head>
            <title>ERP - ${name}</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
            <style>
                body { font-family: sans-serif; margin: 0; background: #1a1a1a; color: white; display: flex; flex-direction: column; height: 100vh; }
                header { background: #222; padding: 15px 30px; display: flex; align-items: center; border-bottom: 1px solid #444; }
                nav { background: #333; display: flex; padding: 0 30px; }
                nav button { background: none; border: none; color: #aaa; padding: 15px 20px; cursor: pointer; font-size: 14px; border-bottom: 3px solid transparent; }
                nav button.active { color: white; border-bottom-color: #3498db; background: #444; }
                .tab-content { flex-grow: 1; display: none; padding: 20px; overflow-y: auto; }
                .tab-content.active { display: block; }
                #map { height: 500px; width: 100%; border-radius: 8px; }
                .msg { padding: 8px; margin: 5px 0; border-radius: 8px; max-width: 80%; }
                .msg-boss { background: #F57F17; color: black; align-self: flex-end; margin-left: auto; }
                .msg-driver { background: #34495e; color: white; }
                table { width: 100%; border-collapse: collapse; }
                th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
            </style>
        </head>
        <body>
            <header>
                <button onclick="location.href='/'" style="margin-right:20px;">⬅</button>
                <img src="${d.driver_photo || ''}" style="width:40px;height:40px;border-radius:50%;margin-right:15px;">
                <h2>${name} - ERP Kontroll</h2>
            </header>
            <nav id="mainNav">
                <button onclick="openTab(event, 'dashboard')">DASHBOARD</button>
                <button onclick="openTab(event, 'report')">MENETLEVÉL</button>
                <button onclick="openTab(event, 'tours')">TÚRÁK</button>
                <button onclick="openTab(event, 'costs')">KÖLTSÉGEK</button>
                <button onclick="openTab(event, 'hotels')">HOTELEK</button>
                <button onclick="openTab(event, 'chat')">CHAT</button>
                <button onclick="openTab(event, 'stats')">STATISZTIKA</button>
                <button onclick="openTab(event, 'profile')">PROFIL</button>
                <button onclick="openTab(event, 'access')">HOZZÁFÉRÉS</button>
            </nav>

            <div id="dashboard" class="tab-content">
                <div style="display:grid; grid-template-columns: 1fr 300px; gap: 20px;">
                    <div id="map"></div>
                    <div style="background:#222; padding:20px; border-radius:8px;">
                        <h3>Státusz: <span style="color:#3498db">${d.status}</span></h3>
                        <p>Sebesség: ${Math.round(d.speed || 0)} km/h</p>
                        <p>Rendszám: ${d.license_plate || 'N/A'}</p>
                        <hr>
                        <p>🎯 Cél: ${d.next_stop || 'Nincs'}</p>
                        <p id="distBox" style="color:#2ecc71; font-weight:bold; font-size:20px;">Távolság: -- km</p>
                    </div>
                </div>
            </div>

            <div id="report" class="tab-content">
                <h3>Napi menetlevél adatok</h3>
                <table>
                    <tr><th>Típus</th><th>Időtartam</th><th>Rendszám</th><th>KM állás</th><th>Megjegyzés</th></tr>
                    ${work.rows.map(w => `<tr><td>${w.type}</td><td>${new Date(Number(w.start_time)).toLocaleTimeString()} - ${w.end_time ? new Date(Number(w.end_time)).toLocaleTimeString() : '...'}</td><td>${w.license_plate || '-'}</td><td>${w.mileage || ''} - ${w.end_mileage || ''}</td><td>${w.notes || ''}</td></tr>`).join('')}
                </table>
            </div>

            <div id="tours" class="tab-content"><h3>Túrák</h3><p>Túrák kezelése folyamatban...</p></div>

            <div id="costs" class="tab-content">
                <h3>Költségek</h3>
                <table>
                    <tr><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th><th>Művelet</th></tr>
                    ${costs.rows.map(c => `<tr><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${c.category}</td><td>${c.amount} ${c.currency}</td><td>${c.status}</td><td><button onclick="setStatus(${c.id}, 'Elfogadva')">✔</button><button onclick="setStatus(${c.id}, 'Kifizetve')">$</button></td></tr>`).join('')}
                </table>
            </div>

            <div id="chat" class="tab-content">
                <div style="height:400px; display:flex; flex-direction:column; background:#111; border-radius:8px; padding:15px;">
                    <div id="chatBox" style="flex-grow:1; overflow-y:auto; display:flex; flex-direction:column;">
                        ${chat.rows.map(m => {
                            const isBoss = m.sender === 'DISZPÉCSER' || m.sender === 'FŐNÖK';
                            return `<div class="msg ${isBoss ? 'msg-boss' : 'msg-driver'}"><b>${m.sender}:</b><br>${m.message}</div>`;
                        }).join('')}
                    </div>
                    <div style="margin-top:10px; display:flex; gap:10px;">
                        <input type="text" id="m" style="flex-grow:1; padding:10px;" onkeydown="if(event.key==='Enter') sendMsg()">
                        <button id="sendBtn" onclick="sendMsg()" style="padding:10px 20px; background:#3498db; border:none; color:white;">Küldés</button>
                    </div>
                </div>
            </div>

            <div id="stats" class="tab-content"><h3>Zeitkonto / Statisztika</h3><p>Havi összesítés...</p></div>
            <div id="profile" class="tab-content"><h3>Sofőr adatai</h3><p>Név: ${name}</p><p>Rendszám: ${d.license_plate}</p></div>

            <script>
                function openTab(evt, tabName) {
                    var i, tabcontent, tablinks;
                    tabcontent = document.getElementsByClassName("tab-content");
                    for (i = 0; i < tabcontent.length; i++) tabcontent[i].classList.remove("active");
                    tablinks = document.getElementById("mainNav").getElementsByTagName("button");
                    for (i = 0; i < tablinks.length; i++) tablinks[i].classList.remove("active");
                    document.getElementById(tabName).classList.add("active");
                    if (evt) evt.currentTarget.classList.add("active");
                    localStorage.setItem('activeTab_${name}', tabName);
                    if(tabName === 'dashboard') setTimeout(() => map.invalidateSize(), 200);
                    if(tabName === 'chat') scrollChat();
                }

                var savedTab = localStorage.getItem('activeTab_${name}') || 'dashboard';
                document.getElementById(savedTab).classList.add('active');
                var buttons = document.getElementById("mainNav").getElementsByTagName("button");
                for(var b of buttons) { if(b.innerText.toLowerCase() === savedTab) b.classList.add('active'); }

                var map = L.map('map').setView([${d.latitude || 47.5}, ${d.longitude || 19.0}], 13);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
                var driverMarker = L.marker([${d.latitude || 47.5}, ${d.longitude || 19.0}]).addTo(map);

                if(${!!(d.next_lat && d.next_lng)}) {
                    var routing = L.Routing.control({
                        waypoints: [L.latLng(${d.latitude}, ${d.longitude}), L.latLng(${d.next_lat}, ${d.next_lng})],
                        createMarker: function() { return null; },
                        lineOptions: { styles: [{color: '#3498db', opacity: 0.8, weight: 6}] },
                        addWaypoints: false,
                        routeWhileDragging: false,
                        show: false
                    }).addTo(map);

                    routing.on('routesfound', function(e) {
                        var routes = e.routes;
                        var summary = routes[0].summary;
                        document.getElementById('distBox').innerHTML = 'Távolság: ' + (summary.totalDistance / 1000).toFixed(1) + ' km';
                    });
                }

                function scrollChat() {
                    var chatBox = document.getElementById('chatBox');
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
                if(savedTab === 'chat') setTimeout(scrollChat, 100);

                let isSending = false;
                function sendMsg() {
                    if (isSending) return;
                    var input = document.getElementById('m');
                    var text = input.value;
                    if(!text) return;
                    isSending = true;
                    input.disabled = true;
                    fetch('/api/send-chat', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({driverName: '${name}', sender: 'DISZPÉCSER', message: text, timestamp: Date.now()})
                    }).then(() => location.reload());
                }

                function setStatus(id, status) {
                    fetch('/admin/update-cost', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, status}) }).then(() => location.reload());
                }

                setTimeout(() => { location.reload(); }, 30000);
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
