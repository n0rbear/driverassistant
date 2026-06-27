// FIXED SERVER v4
const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ADATBÁZIS SÉMA FRISSÍTÉSE
const initDb = async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    const queries = [
        `CREATE TABLE IF NOT EXISTS drivers (uuid UUID UNIQUE DEFAULT gen_random_uuid(), name TEXT UNIQUE, email TEXT, phone TEXT, license_plate TEXT, photo_url TEXT, is_active BOOLEAN DEFAULT TRUE)`,
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, driver_photo TEXT, driver_phone TEXT, driver_email TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN, deleted_at BIGINT)`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), tour_id INT, address TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT, deleted_at BIGINT)`
    ];
    for (let q of queries) { await pool.query(q); }

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
        ['stops', 'arrival_time', 'BIGINT'],
        ['tours', 'deleted_at', 'BIGINT'],
        ['stops', 'deleted_at', 'BIGINT'],
        ['live_updates', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['costs', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['chat_messages', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['work_times', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['hotels', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['tours', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()'],
        ['stops', 'uuid', 'UUID UNIQUE DEFAULT gen_random_uuid()']
    ];

    for (const [table, col, type] of addColumns) {
        try {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        } catch (e) {}
    }

    try {
        await pool.query(`DELETE FROM work_times a USING work_times b WHERE a.id < b.id AND a.driver_name = b.driver_name AND a.start_time = b.start_time`);
        await pool.query('ALTER TABLE work_times ADD CONSTRAINT unique_worktime UNIQUE (driver_name, start_time)');
    } catch(e) {}
    try {
        await pool.query(`DELETE FROM costs a USING costs b WHERE a.id < b.id AND a.driver_name = b.driver_name AND a.timestamp = b.timestamp AND a.amount = b.amount`);
        await pool.query('ALTER TABLE costs ADD CONSTRAINT unique_cost UNIQUE (driver_name, timestamp, amount)');
    } catch(e) {}
    try { await pool.query('ALTER TABLE hotels ADD CONSTRAINT unique_hotel UNIQUE (driver_name, timestamp, name)'); } catch(e) {}
};
initDb().catch(console.error);

// API-K
app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query('INSERT INTO live_updates (uuid, driver_name, driver_photo, driver_phone, driver_email, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
        [d.uuid || null, d.driverName, d.driverPhoto, d.driverPhone, d.driverEmail, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/send-chat', async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES ($1, $2, $3, $4, $5)', [uuid || null, driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat/:driverName', async (req, res) => {
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [req.params.driverName]);
    res.json(result.rows);
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query(`INSERT INTO work_times (uuid, driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (driver_name, start_time) DO UPDATE SET end_time = EXCLUDED.end_time, end_mileage = EXCLUDED.end_mileage, notes = EXCLUDED.notes`,
            [wt.uuid || null, wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (driver_name, timestamp, amount) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes', [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-tours/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    try {
        await pool.query('BEGIN');
        const incomingTours = req.body || [];
        const incomingTourUuids = incomingTours.map(item => item.tour.uuid).filter(u => !!u);

        for (const item of incomingTours) {
            if (!item.tour) continue;
            const t = item.tour;

            if (t.deletedAt) {
                if (t.uuid) {
                    await pool.query('DELETE FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE uuid = $1)', [t.uuid]);
                    await pool.query('DELETE FROM tours WHERE uuid = $1', [t.uuid]);
                }
                continue;
            }

            let tourId;
            if (t.uuid) {
                const resT = await pool.query(`
                    INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (uuid) DO UPDATE SET
                        name = EXCLUDED.name,
                        customer = EXCLUDED.customer,
                        date = EXCLUDED.date,
                        day_of_week = EXCLUDED.day_of_week,
                        notes = EXCLUDED.notes,
                        is_closed = EXCLUDED.is_closed,
                        is_current = EXCLUDED.is_current
                    RETURNING id
                `, [t.uuid, driverName, t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent]);
                tourId = resT.rows[0].id;
            } else {
                const resT = await pool.query(`
                    INSERT INTO tours (driver_name, name, customer, date, day_of_week, notes, is_closed, is_current)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `, [driverName, t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent]);
                tourId = resT.rows[0].id;
            }

            if (item.stops && Array.isArray(item.stops)) {
                for (const s of item.stops) {
                    if (s.deletedAt) {
                        if (s.uuid) await pool.query('DELETE FROM stops WHERE uuid = $1', [s.uuid]);
                        continue;
                    }
                    if (s.uuid) {
                        await pool.query(`
                            INSERT INTO stops (uuid, tour_id, address, contact_name, phone_number, email, time_window, notes, alternative_names, order_index, latitude, longitude, is_completed, arrival_time)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                            ON CONFLICT (uuid) DO UPDATE SET
                                tour_id = EXCLUDED.tour_id,
                                address = EXCLUDED.address,
                                contact_name = EXCLUDED.contact_name,
                                phone_number = EXCLUDED.phone_number,
                                email = EXCLUDED.email,
                                time_window = EXCLUDED.time_window,
                                notes = EXCLUDED.notes,
                                alternative_names = EXCLUDED.alternative_names,
                                order_index = EXCLUDED.order_index,
                                latitude = EXCLUDED.latitude,
                                longitude = EXCLUDED.longitude,
                                is_completed = EXCLUDED.is_completed,
                                arrival_time = EXCLUDED.arrival_time
                        `, [s.uuid, tourId, s.address || '', s.contactName || '', s.phoneNumber || '', s.email || '', s.timeWindow || '', s.notes || '', s.alternativeNames || null, s.orderIndex || 0, s.latitude || null, s.longitude || null, !!s.isCompleted, s.arrivalTime || null]);
                    } else {
                        await pool.query(`
                            INSERT INTO stops (tour_id, address, contact_name, phone_number, email, time_window, notes, alternative_names, order_index, latitude, longitude, is_completed, arrival_time)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        `, [tourId, s.address || '', s.contactName || '', s.phoneNumber || '', s.email || '', s.timeWindow || '', s.notes || '', s.alternativeNames || null, s.orderIndex || 0, s.latitude || null, s.longitude || null, !!s.isCompleted, s.arrivalTime || null]);
                    }
                }
            }
        }

        await pool.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await pool.query('ROLLBACK');
        res.status(500).send(e.message);
    }
});

app.post('/api/sync-hotels', async (req, res) => {
    for (const h of req.body) {
        await pool.query('INSERT INTO hotels (uuid, driver_name, name, address, timestamp) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [h.uuid || null, h.driverName, h.name, h.address, h.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

app.get('/api/cost-status/:driverName', async (req, res) => {
    const result = await pool.query('SELECT id, uuid, status, timestamp, amount FROM costs WHERE driver_name = $1', [req.params.driverName]);
    res.json(result.rows.map(r => ({ id: r.id, uuid: r.uuid, status: r.status, timestamp: Number(r.timestamp), amount: Number(r.amount) })));
});

app.post('/admin/save-tour', async (req, res) => {
    try {
        const { id, uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, stops } = req.body;
        let tourId = id;

        if (!tourId && uuid) {
            const resUuid = await pool.query('SELECT id FROM tours WHERE uuid = $1', [uuid]);
            if (resUuid.rows.length > 0) tourId = resUuid.rows[0].id;
        }

        if (tourId) {
            await pool.query('UPDATE tours SET uuid=$1, name=$2, customer=$3, date=$4, day_of_week=$5, notes=$6, is_closed=$7 WHERE id=$8', [uuid || null, name, customer, date, day_of_week, notes, is_closed, tourId]);
        } else {
            const result = await pool.query('INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id', [uuid || null, driver_name, name, customer, date, day_of_week, notes, is_closed]);
            tourId = result.rows[0].id;
        }

        if (stops && Array.isArray(stops)) {
            const incomingStopUuids = stops.map(s => s.uuid).filter(u => !!u);
            for (const s of stops) {
                if (s.uuid) {
                    await pool.query(`
                        INSERT INTO stops (uuid, tour_id, address, contact_name, phone_number, email, time_window, notes, order_index, is_completed)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (uuid) DO UPDATE SET
                            tour_id = EXCLUDED.tour_id,
                            address = EXCLUDED.address,
                            contact_name = EXCLUDED.contact_name,
                            phone_number = EXCLUDED.phone_number,
                            email = EXCLUDED.email,
                            time_window = EXCLUDED.time_window,
                            notes = EXCLUDED.notes,
                            order_index = EXCLUDED.order_index,
                            is_completed = EXCLUDED.is_completed
                    `, [s.uuid, tourId, s.address, s.contact_name, s.phone_number, s.email, s.time_window, s.notes, s.order_index, !!s.is_completed]);
                } else {
                    await pool.query('INSERT INTO stops (tour_id, address, contact_name, phone_number, email, time_window, notes, order_index, is_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [tourId, s.address, s.contact_name, s.phone_number, s.email, s.time_window, s.notes, s.order_index, !!s.is_completed]);
                }
            }
            if (incomingStopUuids.length > 0) {
                await pool.query('DELETE FROM stops WHERE tour_id = $1 AND uuid IS NOT NULL AND NOT (uuid = ANY($2))', [tourId, incomingStopUuids]);
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
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
            results.push({
                tour: { id: tour.id, uuid: tour.uuid, driverName: tour.driver_name, name: tour.name, customer: tour.customer, date: Number(tour.date), dayOfWeek: tour.day_of_week, notes: tour.notes, isClosed: tour.is_closed, isCurrent: tour.is_current },
                stops: stopsRes.rows.map(s => ({ id: s.id, uuid: s.uuid, tourId: s.tour_id, address: s.address, contactName: s.contact_name, phoneNumber: s.phone_number, email: s.email, timeWindow: s.time_window, notes: s.notes, alternativeNames: s.alternative_names, orderIndex: s.order_index, latitude: s.latitude, longitude: s.longitude, isCompleted: s.is_completed, arrivalTime: s.arrival_time ? Number(s.arrival_time) : null }))
            });
        }
        res.json(results);
    } catch (e) { res.status(500).send(e.message); }
});

// FRONTEND
app.get('/', async (req, res) => {
    try {
        const drivers = await pool.query(`SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp FROM (SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates UNION ALL SELECT driver_name, NULL as driver_photo, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp FROM tours UNION ALL SELECT driver_name, NULL as driver_photo, 'Munkaidő feltöltve' as status, license_plate, start_time::BIGINT as timestamp FROM work_times) AS all_drivers ORDER BY driver_name, timestamp DESC`);
        let list = drivers.rows.map(d => `<div class="card" onclick="location.href='/driver/${encodeURIComponent(d.driver_name)}'"><img src="${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right;background:#444"><h3>${d.driver_name}</h3><p>${d.status} ${d.license_plate ? '| ' + d.license_plate : ''}</p></div>`).join('');
        res.send(`<html><head><title>Driver ERP</title><style>body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; } .card:hover { transform: scale(1.02); background: #444; }</style></head><body><h1>🚛 Flotta kiválasztása</h1><div class="grid">${list}</div></body></html>`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const update = await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name]);
    const costs = await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    const chat = await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name]);
    const work = await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name]);
    const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 ORDER BY date DESC', [name]);
    const hotelsRes = await pool.query('SELECT * FROM hotels WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    for (let tour of toursRes.rows) {
        const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 ORDER BY order_index ASC', [tour.id]);
        tour.stops = stopsRes.rows;
    }
    const d = update.rows[0] || { driver_name: name };

    res.send(`<html><head><title>ERP - ${name}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body { font-family: sans-serif; margin: 0; background: #1a1a1a; color: white; display: flex; flex-direction: column; height: 100vh; }
        header { background: #222; padding: 15px 30px; display: flex; align-items: center; border-bottom: 1px solid #444; }
        nav { background: #333; display: flex; padding: 0 30px; }
        nav button { background: none; border: none; color: #aaa; padding: 15px 20px; cursor: pointer; font-size: 14px; border-bottom: 3px solid transparent; }
        nav button.active { color: white; border-bottom-color: #3498db; background: #444; }
        .tab-content { flex-grow: 1; display: none; padding: 20px; overflow-y: auto; }
        .tab-content.active { display: block; }
        #map { height: 500px; width: 100%; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
        .tour-card { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .stop-item { margin-left: 20px; border-left: 2px solid #444; padding-left: 10px; margin-top: 5px; }
        .msg { padding: 8px; margin: 5px 0; border-radius: 8px; max-width: 80%; }
        .msg-boss { background: #F57F17; color: black; align-self: flex-end; margin-left: auto; }
        .msg-driver { background: #34495e; color: white; }
    </style></head>
    <body>
        <header><button onclick="location.href='/'">⬅</button><img src="${d.driver_photo || ''}" style="width:40px;height:40px;border-radius:50%;margin-left:15px;margin-right:15px;"><h2>${name} - ERP</h2></header>
        <nav id="mainNav">
            <button onclick="openTab(event, 'dashboard')">DASHBOARD</button>
            <button onclick="openTab(event, 'tours')">TÚRÁK</button>
            <button onclick="openTab(event, 'costs')">KÖLTSÉGEK</button>
            <button onclick="openTab(event, 'hotels')">HOTELEK</button>
            <button onclick="openTab(event, 'chat')">CHAT</button>
            <button onclick="openTab(event, 'stats')">STATISZTIKA</button>
            <button onclick="openTab(event, 'report')">MENETLEVÉL</button>
            <button onclick="openTab(event, 'profile')">PROFIL</button>
        </nav>
        <div id="dashboard" class="tab-content">
            <div style="display:grid; grid-template-columns: 1fr 300px; gap: 20px;">
                <div id="map"></div>
                <div style="background:#222; padding:20px; border-radius:8px;">
                    <h3>Státusz: <span style="color:#3498db">${d.status}</span></h3>
                    <p>Sebesség: ${Math.round(d.speed || 0)} km/h</p>
                    <hr><p>🎯 Cél: ${d.next_stop || 'Nincs'}</p>
                </div>
            </div>
        </div>
        <div id="tours" class="tab-content">
            <button onclick="editTour()" style="background:#2ecc71; color:white; padding:10px; margin-bottom:20px;">+ Új túra</button>
            ${toursRes.rows.map(t => `<div class="tour-card"><div style="float:right;"><button onclick='editTour(${JSON.stringify(t).replace(/'/g, "&apos;")})'>✏</button><button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button></div><b>${t.name}</b> (${t.customer}) - ${new Date(Number(t.date)).toLocaleDateString()}${t.stops.map(s => `<div class="stop-item">${s.order_index + 1}. ${s.address}</div>`).join('')}</div>`).join('')}
        </div>
        <div id="costs" class="tab-content">
            <table><tr><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th><th>Művelet</th></tr>
            ${costs.rows.map(c => `<tr><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${c.category}</td><td>${c.amount} ${c.currency}</td><td>${c.status}</td><td><button onclick="setStatus(${c.id}, 'Elfogadva')">✔</button></td></tr>`).join('')}</table>
        </div>
        <div id="hotels" class="tab-content">
            <table><tr><th>Dátum</th><th>Név</th><th>Cím</th></tr>${hotelsRes.rows.map(h => `<tr><td>${new Date(Number(h.timestamp)).toLocaleDateString()}</td><td>${h.name}</td><td>${h.address}</td></tr>`).join('')}</table>
        </div>
        <div id="chat" class="tab-content">
            <div style="height:400px; background:#111; padding:15px; overflow-y:auto; display:flex; flex-direction:column;" id="chatBox">
                ${chat.rows.map(m => `<div class="msg ${m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver'}"><b>${m.sender}:</b><br>${m.message}</div>`).join('')}
            </div>
            <div style="margin-top:10px; display:flex; gap:10px;"><input type="text" id="m" style="flex-grow:1; padding:10px;"><button onclick="sendMsg()" style="padding:10px 20px; background:#3498db; color:white; border:none;">Küldés</button></div>
        </div>
        <div id="stats" class="tab-content"><div id="statsBox" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;"></div></div>
        <div id="report" class="tab-content"><h3>Tagesfahrblatt - 28 nap</h3><div id="timelineContainer" style="background:#111; padding:20px; border-radius:12px;"></div></div>
        <div id="profile" class="tab-content"><h3>Profil</h3><p>Név: ${name}</p><p>Tel: ${d.driver_phone || '-'}</p><p>Rendszám: ${d.license_plate || '-'}</p></div>

        <div id="tourModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; padding:50px;">
            <div style="background:#222; padding:30px; border-radius:12px; max-width:800px; margin:auto; max-height:90vh; overflow-y:auto;">
                <h2 id="modalTitle">Túra</h2><input type="hidden" id="tourId"><input type="hidden" id="tourUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                    <input type="text" id="tName" placeholder="Név"><input type="text" id="tCustomer" placeholder="Megrendelő">
                    <input type="date" id="tDate"><input type="text" id="tDay" placeholder="Nap">
                </div>
                <textarea id="tNotes" placeholder="Megjegyzések" style="width:100%; height:60px; margin-bottom:20px;"></textarea>
                <h3>Megállók</h3><div id="modalStops"></div><button onclick="addStopRow()">+ Megálló</button>
                <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;"><button onclick="closeModal()">Mégse</button><button onclick="saveTour()" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button></div>
            </div>
        </div>

        <script>
            const workData = ${JSON.stringify(work.rows)};
            function updateStatsAndTimeline() {
                const stats = { drive: 0, work: 0, rest: 0, loading: 0, days: new Set() };
                const workByDate = {};
                workData.forEach(w => {
                    const dur = (w.end_time ? Number(w.end_time) : Date.now()) - Number(w.start_time);
                    if (w.type === 'Vezetés') stats.drive += dur;
                    else if (w.type === 'Munka') stats.work += dur;
                    else if (w.type === 'Pihenő') stats.rest += dur;
                    else if (w.type === 'Rakodás') stats.loading += dur;
                    stats.days.add(w.date);
                    if (!workByDate[w.date]) workByDate[w.date] = [];
                    workByDate[w.date].push(w);
                });
                const formatH = ms => (ms / 3600000).toFixed(1) + ' óra';
                const zeitkonto = (stats.work + stats.drive + stats.loading) - (stats.days.size * 8 * 3600000);
                document.getElementById('statsBox').innerHTML = '<div style="background:#333; padding:20px; border-radius:8px; border-left:5px solid ' + (zeitkonto >= 0 ? '#2ecc71' : '#e74c3c') + '"><h4>Zeitkonto</h4><h2>' + (zeitkonto / 3600000).toFixed(1) + ' óra</h2></div><div style="background:#222; padding:20px;"><h4>Vezetés</h4><p>' + formatH(stats.drive) + '</p></div><div style="background:#222; padding:20px;"><h4>Munkanapok</h4><p>' + stats.days.size + ' nap</p></div>';

                const colors = { 'Vezetés': '#3498db', 'Munka': '#f1c40f', 'Pihenő': '#2ecc71', 'Rakodás': '#e67e22' };
                let html = '';
                const today = new Date();
                for (let i = 0; i < 28; i++) {
                    const d = new Date(today); d.setDate(today.getDate() - i);
                    const dk = d.toISOString().split('T')[0];
                    const evs = workByDate[dk] || [];
                    html += '<div style="margin-bottom:20px;"><div style="display:flex; justify-content:space-between;"><span style="color:#aaa">' + dk + '</span><span style="font-size:10px; color:#555">00:00 ----------- 12:00 ----------- 24:00</span></div><div style="height:30px; width:100%; background:#222; border-radius:4px; position:relative; overflow:hidden; border:1px solid #333;">';
                    evs.forEach(w => {
                        const start = new Date(dk).setHours(0,0,0,0);
                        const left = ((Number(w.start_time) - start) / 86400000) * 100;
                        const width = (((w.end_time ? Number(w.end_time) : Date.now()) - Number(w.start_time)) / 86400000) * 100;
                        html += '<div style="height:100%; width:' + Math.max(0.5, width) + '%; background:' + (colors[w.type] || '#555') + '; position:absolute; left:' + left + '%;"></div>';
                    });
                    html += '</div></div>';
                }
                document.getElementById('timelineContainer').innerHTML = html;
            }
            updateStatsAndTimeline();

            function openTab(e, t) {
                document.querySelectorAll('.tab-content').forEach(x => x.style.display = 'none');
                document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
                document.getElementById(t).style.display = 'block';
                e.currentTarget.classList.add('active');
                if(t === 'dashboard') setTimeout(() => map.invalidateSize(), 200);
            }
            document.querySelector('nav button').click();

            var map = L.map('map').setView([${d.latitude || 47.5}, ${d.longitude || 19.0}], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            L.marker([${d.latitude || 47.5}, ${d.longitude || 19.0}]).addTo(map);

            function sendMsg() {
                const val = document.getElementById('m').value;
                if(!val) return;
                fetch('/api/send-chat', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({driverName: '${name}', sender: 'DISZPÉCSER', message: val}) }).then(() => location.reload());
            }

            function setStatus(id, status) {
                fetch('/admin/update-cost', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, status}) }).then(() => location.reload());
            }

            function editTour(t) {
                document.getElementById('tourId').value = t ? t.id : '';
                document.getElementById('tourUuid').value = t ? t.uuid : '';
                document.getElementById('tName').value = t ? t.name : '';
                document.getElementById('tCustomer').value = t ? t.customer : '';
                document.getElementById('tDate').value = t ? new Date(Number(t.date)).toISOString().split('T')[0] : '';
                document.getElementById('modalStops').innerHTML = '';
                if(t && t.stops) t.stops.forEach(s => addStopRow(s)); else addStopRow();
                document.getElementById('tourModal').style.display = 'block';
            }
            function addStopRow(s) {
                const d = document.createElement('div');
                d.dataset.uuid = s ? s.uuid : '';
                d.innerHTML = '<input type="text" value="' + (s?s.address:'') + '" placeholder="Cím"><button onclick="this.parentElement.remove()">X</button>';
                document.getElementById('modalStops').appendChild(d);
            }
            function closeModal() { document.getElementById('tourModal').style.display = 'none'; }
            function saveTour() {
                const stops = []; document.querySelectorAll('#modalStops div').forEach((r, i) => stops.push({ uuid: r.dataset.uuid || null, address: r.querySelector('input').value, order_index: i }));
                const data = { id: document.getElementById('tourId').value, uuid: document.getElementById('tourUuid').value, driver_name: '${name}', name: document.getElementById('tName').value, customer: document.getElementById('tCustomer').value, date: new Date(document.getElementById('tDate').value).getTime(), stops };
                fetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }).then(() => location.reload());
            }
            function deleteTour(id) { if(confirm('Törlöd?')) fetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }).then(() => location.reload()); }
        </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
