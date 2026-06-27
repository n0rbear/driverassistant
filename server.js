// FIXED SERVER v3
const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ADATBÁZIS SÉMA FRISSÍTÉSE
const initDb = async () => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, driver_name TEXT, driver_photo TEXT, driver_phone TEXT, driver_email TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN)`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, tour_id INT, address TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT)`
    ];
    for (let q of queries) { await pool.query(q); }

    // Oszlopok kényszerített hozzáadása, ha még nem léteznek (frissítéshez)
    const addColumns = [
        ['tours', 'day_of_week', 'TEXT'],
        ['tours', 'notes', 'TEXT'],
        ['tours', 'customer', 'TEXT'],
        ['tours', 'is_closed', 'BOOLEAN'],
        ['tours', 'is_current', 'BOOLEAN'],
        ['live_updates', 'driver_phone', 'TEXT'],
        ['live_updates', 'driver_email', 'TEXT'],
        ['stops', 'latitude', 'DOUBLE PRECISION'],
        ['stops', 'longitude', 'DOUBLE PRECISION'],
        ['stops', 'is_completed', 'BOOLEAN'],
        ['stops', 'arrival_time', 'BIGINT']
    ];

    for (const [table, col, type] of addColumns) {
        try {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        } catch (e) {
            console.log(`Column ${col} in ${table} might already exist or error:`, e.message);
        }
    }

    // Egyedi megszorítások hozzáadása a szinkronizációhoz
    try {
        // Először töröljük a duplikátumokat, hogy a CONSTRAINT ne bukjon el
        await pool.query(`
            DELETE FROM work_times a USING work_times b
            WHERE a.id < b.id AND a.driver_name = b.driver_name AND a.start_time = b.start_time
        `);
        await pool.query('ALTER TABLE work_times ADD CONSTRAINT unique_worktime UNIQUE (driver_name, start_time)');
    } catch(e) { console.log("WorkTime constraint check:", e.message); }

    try {
        await pool.query(`
            DELETE FROM costs a USING costs b
            WHERE a.id < b.id AND a.driver_name = b.driver_name AND a.timestamp = b.timestamp AND a.amount = b.amount
        `);
        await pool.query('ALTER TABLE costs ADD CONSTRAINT unique_cost UNIQUE (driver_name, timestamp, amount)');
    } catch(e) { console.log("Cost constraint check:", e.message); }

    try { await pool.query('ALTER TABLE hotels ADD CONSTRAINT unique_hotel UNIQUE (driver_name, timestamp, name)'); } catch(e) {}
};
initDb().catch(console.error);

// API-K (APP -> BACKEND)
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query('INSERT INTO live_updates (driver_name, driver_photo, driver_phone, driver_email, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
        [d.driverName, d.driverPhoto, d.driverPhone, d.driverEmail, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
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
        await pool.query(`
            INSERT INTO work_times (driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (driver_name, start_time)
            DO UPDATE SET end_time = EXCLUDED.end_time, end_mileage = EXCLUDED.end_mileage, notes = EXCLUDED.notes`,
            [wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (driver_name, timestamp, amount) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes', [c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-tours/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    if (!driverName) return res.sendStatus(400);

    try {
        await pool.query('BEGIN');

        // Töröljük a sofőr meglévő túráit és megállóit
        const oldTours = await pool.query('SELECT id FROM tours WHERE driver_name = $1', [driverName]);
        const tourIds = oldTours.rows.map(r => r.id);

        if (tourIds.length > 0) {
            await pool.query('DELETE FROM stops WHERE tour_id = ANY($1)', [tourIds]);
            await pool.query('DELETE FROM tours WHERE id = ANY($1)', [tourIds]);
        }

        if (req.body && Array.isArray(req.body) && req.body.length > 0) {
            for (const item of req.body) {
                if (!item.tour) continue;
                const t = item.tour;

                const result = await pool.query(
                    'INSERT INTO tours (driver_name, name, customer, date, day_of_week, notes, is_closed, is_current) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                    [driverName, t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent]
                );

                const tourId = result.rows[0].id;

                if (item.stops && Array.isArray(item.stops)) {
                    for (const s of item.stops) {
                        await pool.query(
                            'INSERT INTO stops (tour_id, address, contact_name, phone_number, email, time_window, notes, alternative_names, order_index, latitude, longitude, is_completed, arrival_time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
                            [tourId, s.address || '', s.contactName || '', s.phoneNumber || '', s.email || '', s.timeWindow || '', s.notes || '', s.alternativeNames || null, s.orderIndex || 0, s.latitude || null, s.longitude || null, !!s.isCompleted, s.arrivalTime || null]
                        );
                    }
                }
            }
        }

        await pool.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error('SYNC TOURS ERROR:', e);
        res.status(500).send(e.message);
    }
});

app.post('/api/sync-hotels', async (req, res) => {
    for (const h of req.body) {
        await pool.query('INSERT INTO hotels (driver_name, name, address, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [h.driverName, h.name, h.address, h.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

app.get('/api/cost-status/:driverName', async (req, res) => {
    const result = await pool.query('SELECT id, status, timestamp, amount FROM costs WHERE driver_name = $1', [req.params.driverName]);
    res.json(result.rows.map(r => ({
        id: r.id,
        status: r.status,
        timestamp: Number(r.timestamp),
        amount: Number(r.amount)
    })));
});

app.post('/admin/save-tour', async (req, res) => {
    try {
        const { id, driver_name, name, customer, date, day_of_week, notes, is_closed, stops } = req.body;
        let tourId = id;

        if (id) {
            await pool.query('UPDATE tours SET name=$1, customer=$2, date=$3, day_of_week=$4, notes=$5, is_closed=$6 WHERE id=$7',
                [name, customer, date, day_of_week, notes, is_closed, id]);
            await pool.query('DELETE FROM stops WHERE tour_id = $1', [id]);
        } else {
            const result = await pool.query('INSERT INTO tours (driver_name, name, customer, date, day_of_week, notes, is_closed) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [driver_name, name, customer, date, day_of_week, notes, is_closed]);
            tourId = result.rows[0].id;
        }

        for (const s of stops) {
            await pool.query('INSERT INTO stops (tour_id, address, contact_name, phone_number, email, time_window, notes, order_index, is_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [tourId, s.address, s.contact_name, s.phone_number, s.email, s.time_window, s.notes, s.order_index, !!s.is_completed]);
        }
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

app.post('/admin/delete-tour', async (req, res) => {
    await pool.query('DELETE FROM stops WHERE tour_id = $1', [req.body.id]);
    await pool.query('DELETE FROM tours WHERE id = $1', [req.body.id]);
    res.json({ success: true });
});

app.get('/api/get-tours/:driverName', async (req, res) => {
    try {
        const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 ORDER BY date DESC', [req.params.driverName]);
        const results = [];
        for (let tour of toursRes.rows) {
            const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 ORDER BY order_index ASC', [tour.id]);

            // Map snake_case to camelCase for the App
            const mappedTour = {
                id: tour.id,
                driverName: tour.driver_name,
                name: tour.name,
                customer: tour.customer,
                date: Number(tour.date),
                dayOfWeek: tour.day_of_week,
                notes: tour.notes,
                isClosed: tour.is_closed,
                isCurrent: tour.is_current
            };

            const mappedStops = stopsRes.rows.map(s => ({
                id: s.id,
                tourId: s.tour_id,
                address: s.address,
                contactName: s.contact_name,
                phoneNumber: s.phone_number,
                email: s.email,
                timeWindow: s.time_window,
                notes: s.notes,
                alternativeNames: s.alternative_names,
                orderIndex: s.order_index,
                latitude: s.latitude,
                longitude: s.longitude,
                isCompleted: s.is_completed,
                arrivalTime: s.arrival_time ? Number(s.arrival_time) : null
            }));

            results.push({
                tour: mappedTour,
                stops: mappedStops
            });
        }
        res.json(results);
    } catch (e) {
        console.error('GET TOURS ERROR:', e);
        res.status(500).send(e.message);
    }
});

// ADMIN FRONTEND
app.get('/', async (req, res) => {
    try {
        const drivers = await pool.query(`
            SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp
            FROM (
                SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates
                UNION ALL
                SELECT driver_name, NULL::TEXT as driver_photo, 'Túra feltöltve'::TEXT as status, ''::TEXT as license_plate, date::BIGINT as timestamp FROM tours
                UNION ALL
                SELECT driver_name, NULL::TEXT as driver_photo, 'Munkaidő feltöltve'::TEXT as status, license_plate, start_time::BIGINT as timestamp FROM work_times
            ) AS all_drivers
            ORDER BY driver_name, timestamp DESC
        `);
        let list = drivers.rows.map(d => `
            <div class="card" onclick="location.href='/driver/${encodeURIComponent(d.driver_name)}'">
                <img src="${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right;background:#444">
                <h3>${d.driver_name}</h3>
                <p>${d.status} ${d.license_plate ? '| ' + d.license_plate : ''}</p>
            </div>
        `).join('');
        res.send(`<html><head><title>Driver ERP</title><style>body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; } .card:hover { transform: scale(1.02); background: #444; }</style></head><body><h1>🚛 Flotta kiválasztása</h1><div class="grid">${list}</div></body></html>`);
    } catch (e) {
        console.error('INDEX ROUTE ERROR:', e);
        res.status(500).send(e.message);
    }
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const update = await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name]);
    const costs = await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    const chat = await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name]);
    const work = await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name]);
    const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 ORDER BY date DESC', [name]);
    const hotelsRes = await pool.query('SELECT * FROM hotels WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);

    // Fetch stops for each tour
    for (let tour of toursRes.rows) {
        const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 ORDER BY order_index ASC', [tour.id]);
        tour.stops = stopsRes.rows;
    }

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
                .tour-card { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
                .stop-item { margin-left: 20px; border-left: 2px solid #444; padding-left: 10px; margin-top: 5px; }
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
                <button onclick="openTab(event, 'tours')">TÚRÁK</button>
                <button onclick="openTab(event, 'costs')">KÖLTSÉGEK</button>
                <button onclick="openTab(event, 'hotels')">HOTELEK</button>
                <button onclick="openTab(event, 'chat')">CHAT</button>
                <button onclick="openTab(event, 'stats')">STATISZTIKA</button>
                <button onclick="openTab(event, 'report')">MENETLEVÉL</button>
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

            <div id="tours" class="tab-content">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3>Túrák</h3>
                    <button onclick="editTour()" style="background:#2ecc71; color:white; border:none; padding:10px 20px; border-radius:4px; cursor:pointer;">+ Új túra</button>
                </div>
                <div id="tourList">
                ${toursRes.rows.map(t => `
                    <div class="tour-card">
                        <div style="float:right;">
                            <button onclick='editTour(${JSON.stringify(t).replace(/'/g, "&apos;")})'>✏</button>
                            <button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button>
                        </div>
                        <b>${t.name}</b> (${t.customer}) - ${new Date(Number(t.date)).toLocaleDateString()}
                        ${t.stops.map(s => `
                            <div class="stop-item">
                                ${Number(s.order_index) + 1}. ${s.address} <br>
                                <small>${s.contact_name} | ${s.time_window}</small>
                                ${s.is_completed ? `<br><span style="color:green">✔ Érkezett: ${new Date(Number(s.arrival_time)).toLocaleTimeString()}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
                </div>
            </div>

            <!-- Túra szerkesztő Modal -->
            <div id="tourModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; padding:50px;">
                <div style="background:#222; padding:30px; border-radius:12px; max-width:800px; margin:auto; max-height:90vh; overflow-y:auto;">
                    <h2 id="modalTitle">Túra szerkesztése</h2>
                    <input type="hidden" id="tourId">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                        <input type="text" id="tName" placeholder="Túra neve" style="padding:10px;">
                        <input type="text" id="tCustomer" placeholder="Megrendelő" style="padding:10px;">
                        <input type="date" id="tDate" style="padding:10px;">
                        <input type="text" id="tDay" placeholder="Nap (pl. Hétfő)" style="padding:10px;">
                    </div>
                    <textarea id="tNotes" placeholder="Megjegyzések" style="width:100%; height:60px; margin-bottom:20px; padding:10px;"></textarea>

                    <h3>Megállók</h3>
                    <div id="modalStops"></div>
                    <button onclick="addStopRow()" style="margin-top:10px;">+ Megálló hozzáadása</button>

                    <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;">
                        <button onclick="closeModal()">Mégse</button>
                        <button onclick="saveTour()" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button>
                    </div>
                </div>
            </div>

            <div id="costs" class="tab-content">
                <h3>Költségek</h3>
                <table>
                    <tr><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th><th>Művelet</th></tr>
                    ${costs.rows.map(c => `<tr><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${c.category}</td><td>${c.amount} ${c.currency}</td><td>${c.status}</td><td><button onclick="setStatus(${c.id}, 'Elfogadva')">✔</button><button onclick="setStatus(${c.id}, 'Kifizetve')">$</button></td></tr>`).join('')}
                </table>
            </div>

            <div id="hotels" class="tab-content">
                <h3>Hotelek</h3>
                <table>
                    <tr><th>Dátum</th><th>Név</th><th>Cím</th></tr>
                    ${hotelsRes.rows.map(h => `<tr><td>${new Date(Number(h.timestamp)).toLocaleDateString()}</td><td>${h.name}</td><td>${h.address}</td></tr>`).join('')}
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

            <div id="stats" class="tab-content">
                <h3>Zeitkonto / Statisztika</h3>
                <div id="statsBox" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <!-- JS fills this -->
                </div>
            </div>

            <div id="report" class="tab-content">
                <h3>Napi menetlevél (Tagesfahrblatt) - Utolsó 28 nap</h3>
                <div style="display:flex; gap:20px; margin-bottom:20px; background:#222; padding:15px; border-radius:8px; font-size:14px;">
                    <div style="display:flex; align-items:center; gap:8px;"><div style="width:20px; height:20px; background:#3498db; border-radius:4px;"></div> Vezetés</div>
                    <div style="display:flex; align-items:center; gap:8px;"><div style="width:20px; height:20px; background:#e67e22; border-radius:4px;"></div> Rakodás</div>
                    <div style="display:flex; align-items:center; gap:8px;"><div style="width:20px; height:20px; background:#f1c40f; border-radius:4px;"></div> Egyéb munka</div>
                    <div style="display:flex; align-items:center; gap:8px;"><div style="width:20px; height:20px; background:#2ecc71; border-radius:4px;"></div> Pihenő</div>
                </div>
                <div id="timelineContainer" style="background:#111; padding:20px; border-radius:12px;"></div>
                <table style="margin-top:30px;">
                    <tr><th>Típus</th><th>Időtartam</th><th>Rendszám</th><th>KM állás</th><th>Megjegyzés</th></tr>
                    ${work.rows.map(w => `<tr><td>${w.type}</td><td>${new Date(Number(w.start_time)).toLocaleTimeString()} - ${w.end_time ? new Date(Number(w.end_time)).toLocaleTimeString() : '...'}</td><td>${w.license_plate || '-'}</td><td>${w.mileage || ''} - ${w.end_mileage || ''}</td><td>${w.notes || ''}</td></tr>`).join('')}
                </table>
            </div>

            <div id="profile" class="tab-content">
                <h3>Sofőr adatai</h3>
                <p>Név: ${name}</p>
                <p>Telefonszám: ${d.driver_phone || 'Nincs megadva'}</p>
                <p>Email: ${d.driver_email || 'Nincs megadva'}</p>
                <p>Rendszám: ${d.license_plate}</p>
            </div>

            <script>
                const workData = ${JSON.stringify(work.rows)};

                function updateStatsAndTimeline() {
                    const stats = { drive: 0, work: 0, rest: 0, loading: 0, days: new Set() };
                    const workByDate = {};

                    workData.forEach(w => {
                        const duration = (w.end_time ? Number(w.end_time) : Date.now()) - Number(w.start_time);
                        if (w.type === 'Vezetés') stats.drive += duration;
                        else if (w.type === 'Munka') stats.work += duration;
                        else if (w.type === 'Pihenő') stats.rest += duration;
                        else if (w.type === 'Rakodás') stats.loading += duration;
                        stats.days.add(w.date);

                        if (!workByDate[w.date]) workByDate[w.date] = [];
                        workByDate[w.date].push(w);
                    });

                    // Stats Render
                    const formatH = ms => (ms / 3600000).toFixed(1) + ' óra';
                    const zeitkonto = (stats.work + stats.drive + stats.loading) - (stats.days.size * 8 * 3600000);

                    document.getElementById('statsBox').innerHTML = `
                        <div style="background:#333; padding:20px; border-radius:8px; border-left: 5px solid \${zeitkonto >= 0 ? '#2ecc71' : '#e74c3c'}">
                            <h4>Zeitkonto Egyenleg</h4>
                            <h2 style="margin:0">\${(zeitkonto / 3600000).toFixed(1)} óra</h2>
                        </div>
                        <div style="background:#222; padding:20px; border-radius:8px;">
                            <h4>Összes vezetés</h4>
                            <p>\${formatH(stats.drive)}</p>
                        </div>
                        <div style="background:#222; padding:20px; border-radius:8px;">
                            <h4>Összes egyéb munka</h4>
                            <p>\${formatH(stats.work + stats.loading)}</p>
                        </div>
                        <div style="background:#222; padding:20px; border-radius:8px;">
                            <h4>Munkanapok</h4>
                            <p>\${stats.days.size} nap</p>
                        </div>
                    `;

                    // Timeline Render (28 Days)
                    const colors = { 'Vezetés': '#3498db', 'Munka': '#f1c40f', 'Pihenő': '#2ecc71', 'Rakodás': '#e67e22' };
                    let timelineHtml = '';

                    const today = new Date();
                    for (let i = 0; i < 28; i++) {
                        const d = new Date(today);
                        d.setDate(today.getDate() - i);
                        const dateKey = d.toISOString().split('T')[0];
                        const dayEvents = workByDate[dateKey] || [];

                        timelineHtml += `
                            <div style="margin-bottom:20px; position:relative;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                    <span style="font-weight:bold; color:#aaa;">\${dateKey}</span>
                                    <span style="font-size:12px; color:#666;">00:00 ------------------- 12:00 ------------------- 24:00</span>
                                </div>
                                <div style="height:40px; width:100%; background:#222; border-radius:4px; overflow:hidden; display:flex; position:relative; border:1px solid #333;">
                                    \${Array.from({length: 24}).map((_, h) => \`<div style="position:absolute; left:\${(h/24)*100}%; top:0; bottom:0; width:1px; background:rgba(255,255,255,0.05);"></div>\`).join('')}

                                    \${dayEvents.map(w => {
                                        const dayStart = new Date(dateKey).setHours(0,0,0,0);
                                        const startOffset = ((Number(w.start_time) - dayStart) / 86400000) * 100;
                                        const duration = (w.end_time ? Number(w.end_time) : Date.now()) - Number(w.start_time);
                                        const width = (duration / 86400000) * 100;
                                        const title = \`\${w.type}: \${new Date(Number(w.start_time)).toLocaleTimeString()} - \${w.end_time ? new Date(Number(w.end_time)).toLocaleTimeString() : 'aktív'}\`;

                                        return \`<div style="height:100%; width:\${Math.min(width, 100)}%; background:\${colors[w.type] || '#555'}; position:absolute; left:\${Math.max(0, startOffset)}%;" title="\${title}"></div>\`;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }
                    document.getElementById('timelineContainer').innerHTML = timelineHtml;
                }

                updateStatsAndTimeline();

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

                function editTour(tour) {
                    document.getElementById('tourId').value = tour ? tour.id : '';
                    document.getElementById('tName').value = tour ? tour.name : '';
                    document.getElementById('tCustomer').value = tour ? tour.customer : '';
                    document.getElementById('tDate').value = tour ? new Date(Number(tour.date)).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                    document.getElementById('tDay').value = tour ? (tour.day_of_week || '') : '';
                    document.getElementById('tNotes').value = tour ? (tour.notes || '') : '';
                    document.getElementById('modalTitle').innerText = tour ? 'Túra szerkesztése' : 'Új túra létrehozása';

                    const stopBox = document.getElementById('modalStops');
                    stopBox.innerHTML = '';
                    if (tour && tour.stops) {
                        tour.stops.forEach(s => addStopRow(s));
                    } else if (!tour) {
                        addStopRow();
                    }

                    document.getElementById('tourModal').style.display = 'block';
                }

                function addStopRow(s) {
                    const div = document.createElement('div');
                    div.className = 'stop-row';
                    div.style = 'background:#333; padding:15px; margin-bottom:10px; border-radius:8px; display:grid; grid-template-columns: 1fr 1fr auto; gap:10px;';
                    div.innerHTML = \`
                        <input type="text" placeholder="Cím" value="\${s ? s.address : ''}" style="grid-column: span 2;">
                        <input type="text" placeholder="Név" value="\${s ? s.contact_name : ''}">
                        <input type="text" placeholder="Időablak" value="\${s ? s.time_window : ''}">
                        <button onclick="this.parentElement.remove()" style="background:#e74c3c;">X</button>
                    \`;
                    document.getElementById('modalStops').appendChild(div);
                }

                function closeModal() { document.getElementById('tourModal').style.display = 'none'; }

                function saveTour() {
                    const stops = [];
                    document.getElementById('modalStops').querySelectorAll('.stop-row').forEach((row, index) => {
                        const inputs = row.querySelectorAll('input');
                        stops.push({
                            address: inputs[0].value,
                            contact_name: inputs[1].value,
                            time_window: inputs[2].value,
                            order_index: index,
                            phone_number: '', email: '', notes: '', is_completed: false
                        });
                    });

                    const data = {
                        id: document.getElementById('tourId').value,
                        driver_name: '${name}',
                        name: document.getElementById('tName').value,
                        customer: document.getElementById('tCustomer').value,
                        date: new Date(document.getElementById('tDate').value).getTime(),
                        day_of_week: document.getElementById('tDay').value,
                        notes: document.getElementById('tNotes').value,
                        is_closed: false,
                        stops: stops
                    };

                    fetch('/admin/save-tour', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    }).then(() => location.reload());
                }

                function deleteTour(id) {
                    if (!confirm('Biztosan törlöd?')) return;
                    fetch('/admin/delete-tour', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({id})
                    }).then(() => location.reload());
                }
            </script>
        </body>
        </html>
    \`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
