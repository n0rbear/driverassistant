// FIXED SERVER v5 - ARCHITECTURE OVERHAUL
const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ==========================================
// ADDRESS ENGINE
// ==========================================
const AddressEngine = {
    normalize(addr) {
        if (!addr) return null;
        // Ensure all fields exist
        const result = {
            recipient: (addr.recipient || '').trim(),
            company: (addr.company || '').trim(),
            street: (addr.street || '').trim(),
            house_number: (addr.house_number || addr.houseNumber || '').trim(),
            postal_code: (addr.postal_code || addr.postalCode || '').trim(),
            city: (addr.city || '').trim(),
            state: (addr.state || '').trim(),
            country: (addr.country || '').trim(),
            address_full: (addr.address_full || addr.addressFull || addr.address || '').trim(),
            latitude: addr.latitude !== undefined ? parseFloat(addr.latitude) : null,
            longitude: addr.longitude !== undefined ? parseFloat(addr.longitude) : null,
            notes: (addr.notes || '').trim()
        };

        // Fallback parsing if structured fields are missing
        if (!result.street && !result.city && result.address_full) {
            const match = result.address_full.match(/^(.+)\s+([^,]+),\s*(\d{4})\s+(.+)$/);
            if (match) {
                result.street = match[1].trim();
                result.house_number = match[2].trim();
                result.postal_code = match[3].trim();
                result.city = match[4].trim();
            }
        }

        // Generate normalized full address if missing
        if (!result.address_full && result.street && result.city) {
            result.address_full = `${result.street} ${result.house_number}, ${result.postal_code} ${result.city}`;
        }

        return result;
    },

    getFingerprint(addr) {
        const n = this.normalize(addr);
        if (!n) return '';
        // Physical location fingerprint (ignores recipient/notes)
        return `${n.country}|${n.postal_code}|${n.city}|${n.street}|${n.house_number}`.toLowerCase();
    }
};

// ==========================================
// IMPORT ENGINE
// ==========================================
const ImportEngine = {
    async processTour(client, driverName, tourData, stopsData) {
        // 1. Normalize Tour & Depot
        const tour = {
            ...tourData,
            driver_name: driverName,
            updated_at: Date.now()
        };
        const depot = AddressEngine.normalize(tourData.depot || tourData);

        // 2. Normalize and Group Stops
        const groupedStops = new Map();
        for (const rawStop of stopsData) {
            const normalized = AddressEngine.normalize(rawStop);
            const fingerprint = AddressEngine.getFingerprint(normalized);

            const deliveryItem = {
                uuid: rawStop.uuid || null,
                recipient: normalized.recipient,
                company: normalized.company,
                contact_name: rawStop.contact_name || rawStop.contactName || '',
                phone_number: rawStop.phone_number || rawStop.phoneNumber || '',
                email: rawStop.email || '',
                time_window: rawStop.time_window || rawStop.timeWindow || '',
                notes: normalized.notes,
                stop_type: rawStop.stop_type || rawStop.stopType || 'DELIVERY',
                is_completed: !!(rawStop.is_completed || rawStop.isCompleted),
                arrival_time: rawStop.arrival_time || rawStop.arrivalTime || null
            };

            if (groupedStops.has(fingerprint)) {
                groupedStops.get(fingerprint).items.push(deliveryItem);
            } else {
                groupedStops.set(fingerprint, {
                    ...normalized,
                    items: [deliveryItem]
                });
            }
        }

        // 3. Persist Tour
        let tourId = tour.id;
        if (tourId) {
            // Check ownership for security/transfer logic
            const ownerCheck = await client.query('SELECT driver_name FROM tours WHERE id = $1', [tourId]);
            if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].driver_name !== driverName) {
                throw new Error("Ownership mismatch: You cannot modify a tour transferred to someone else.");
            }

            await client.query(`
                UPDATE tours SET
                    name = $1, customer = $2, date = $3, day_of_week = $4, notes = $5, is_closed = $6, is_current = $7,
                    depot_name = $8, depot_company = $9, depot_street = $10, depot_house_number = $11,
                    depot_postal_code = $12, depot_city = $13, depot_state = $14, depot_country = $15,
                    depot_address_full = $16, depot_lat = $17, depot_lng = $18, updated_at = $19
                WHERE id = $20`,
                [tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current,
                 depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number,
                 depot.postal_code, depot.city, depot.state, depot.country,
                 depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tourId]
            );
        } else {
            const res = await client.query(`
                INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current,
                                   depot_name, depot_company, depot_street, depot_house_number, depot_postal_code, depot_city,
                                   depot_state, depot_country, depot_address_full, depot_lat, depot_lng, updated_at)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING id`,
                [tour.uuid || null, driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current,
                 depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number,
                 depot.postal_code, depot.city, depot.state, depot.country,
                 depot.address_full, depot.latitude, depot.longitude, tour.updated_at]
            );
            tourId = res.rows[0].id;
        }

        // 4. Persist Stops
        const currentStopUuids = [];
        let orderIndex = 0;
        for (const stop of groupedStops.values()) {
            const stopUuid = stop.items[0].uuid || null; // Use first item's UUID or generate
            const itemsJson = JSON.stringify(stop.items);

            // Legacy compatibility: use first item's data for top-level columns
            const mainItem = stop.items[0];

            const stopRes = await client.query(`
                INSERT INTO stops (uuid, tour_id, address, recipient, company, street, house_number, postal_code, city, state, country,
                                   address_full, contact_name, phone_number, email, time_window, notes, alternative_names,
                                   order_index, latitude, longitude, is_completed, arrival_time, stop_type, updated_at, items)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
                ON CONFLICT (uuid) DO UPDATE SET
                    tour_id = EXCLUDED.tour_id, address = EXCLUDED.address, recipient = EXCLUDED.recipient, company = EXCLUDED.company,
                    street = EXCLUDED.street, house_number = EXCLUDED.house_number, postal_code = EXCLUDED.postal_code,
                    city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country, address_full = EXCLUDED.address_full,
                    contact_name = EXCLUDED.contact_name, phone_number = EXCLUDED.phone_number, email = EXCLUDED.email,
                    time_window = EXCLUDED.time_window, notes = EXCLUDED.notes, order_index = EXCLUDED.order_index,
                    latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, is_completed = EXCLUDED.is_completed,
                    arrival_time = EXCLUDED.arrival_time, stop_type = EXCLUDED.stop_type, updated_at = EXCLUDED.updated_at,
                    items = EXCLUDED.items
                RETURNING uuid`,
                [stopUuid, tourId, stop.address_full, mainItem.recipient, stop.company, stop.street, stop.house_number,
                 stop.postal_code, stop.city, stop.state, stop.country, stop.address_full, mainItem.contact_name,
                 mainItem.phone_number, mainItem.email, mainItem.time_window, mainItem.notes, null,
                 orderIndex++, stop.latitude, stop.longitude, mainItem.is_completed, mainItem.arrival_time, mainItem.stop_type, tour.updated_at, itemsJson]
            );
            currentStopUuids.push(stopRes.rows[0].uuid);
        }

        // 5. Cleanup removed stops
        await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND NOT (uuid = ANY($3::UUID[]))', [tour.updated_at, tourId, currentStopUuids]);

        return tourId;
    }
};

function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ADATBÁZIS SÉMA FRISSÍTÉSE
const initDb = async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    const queries = [
        `CREATE TABLE IF NOT EXISTS drivers (uuid UUID UNIQUE DEFAULT gen_random_uuid(), name TEXT UNIQUE, email TEXT, phone TEXT, license_plate TEXT, photo_url TEXT, is_active BOOLEAN DEFAULT TRUE)`,
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, driver_photo TEXT, driver_phone TEXT, driver_email TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, next_stop_dist FLOAT, tour_remaining_dist FLOAT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT)`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT)`,
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN, depot_name TEXT, depot_company TEXT, depot_street TEXT, depot_house_number TEXT, depot_postal_code TEXT, depot_city TEXT, depot_state TEXT, depot_country TEXT, depot_address_full TEXT, depot_lat DOUBLE PRECISION, depot_lng DOUBLE PRECISION, deleted_at BIGINT, updated_at BIGINT)`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), tour_id INT, address TEXT, recipient TEXT, company TEXT, street TEXT, house_number TEXT, postal_code TEXT, city TEXT, state TEXT, country TEXT, address_full TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT, deleted_at BIGINT, updated_at BIGINT, stop_type TEXT DEFAULT 'DELIVERY', items JSONB)`
    ];
    for (let q of queries) { await pool.query(q); }

    const addColumns = [
        ['stops', 'items', 'JSONB'],
        ['tours', 'depot_company', 'TEXT'],
        ['tours', 'depot_street', 'TEXT'],
        ['tours', 'depot_house_number', 'TEXT'],
        ['tours', 'depot_postal_code', 'TEXT'],
        ['tours', 'depot_city', 'TEXT'],
        ['tours', 'depot_state', 'TEXT'],
        ['tours', 'depot_country', 'TEXT'],
        ['tours', 'depot_address_full', 'TEXT'],
        ['stops', 'company', 'TEXT'],
        ['stops', 'state', 'TEXT'],
        ['stops', 'country', 'TEXT']
    ];

    for (const [table, col, type] of addColumns) {
        try { await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (e) {}
    }

    try { await pool.query('ALTER TABLE work_times ADD CONSTRAINT unique_worktime UNIQUE (driver_name, start_time)'); } catch(e) {}
    try { await pool.query('ALTER TABLE costs ADD CONSTRAINT unique_cost UNIQUE (driver_name, timestamp, amount)'); } catch(e) {}
    try { await pool.query('ALTER TABLE hotels ADD CONSTRAINT unique_hotel UNIQUE (driver_name, timestamp, name)'); } catch(e) {}
};
initDb().catch(console.error);

// API-K
app.get('/health', (req, res) => res.sendStatus(200));

app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    await pool.query('INSERT INTO live_updates (uuid, driver_name, driver_photo, driver_phone, driver_email, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, next_stop_dist, tour_remaining_dist, depot_name, depot_lat, depot_lng, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)',
        [d.uuid || null, d.driverName, d.driverPhoto, d.driverPhone, d.driverEmail, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.nextStopDistance, d.tourRemainingDistance, d.depotName, d.depotLat, d.depotLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/send-chat', async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5)', [uuid || null, driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [driverName]);
    res.json(result.rows.map(r => ({ uuid: r.uuid, driverName, sender: r.sender || 'RENDSZER', message: r.message || '', timestamp: Number(r.timestamp) || Date.now() })));
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query(`INSERT INTO work_times (uuid, driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (driver_name, start_time) DO UPDATE SET end_time = EXCLUDED.end_time, end_mileage = EXCLUDED.end_mileage, notes = EXCLUDED.notes`,
            [wt.uuid || null, wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (driver_name, timestamp, amount) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes', [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-tours/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of (req.body || [])) {
            if (!item.tour) continue;
            if (item.tour.deletedAt) {
                if (item.tour.uuid) {
                    const now = Date.now();
                    await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id IN (SELECT id FROM tours WHERE uuid::text = $2 AND driver_name = $3)', [now, item.tour.uuid, driverName]);
                    await client.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE uuid::text = $2 AND driver_name = $3', [now, item.tour.uuid, driverName]);
                }
                continue;
            }
            await ImportEngine.processTour(client, driverName, item.tour, item.stops || []);
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); }
    finally { client.release(); }
});

app.get('/api/get-tours/:driverName', async (req, res) => {
    try {
        const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [req.params.driverName]);
        const results = [];
        for (let tour of toursRes.rows) {
            const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [tour.id]);
            results.push({
                tour: {
                    ...tour, date: Number(tour.date), deletedAt: tour.deleted_at ? Number(tour.deleted_at) : null, updatedAt: tour.updated_at ? Number(tour.updated_at) : null,
                    depotLatitude: tour.depot_lat, depotLongitude: tour.depot_lng // Map DB snake_case to camelCase for app
                },
                stops: stopsRes.rows.map(s => ({
                    ...s, latitude: s.latitude, longitude: s.longitude, isCompleted: !!s.is_completed, stopType: s.stop_type,
                    arrivalTime: s.arrival_time ? Number(s.arrival_time) : null, updatedAt: s.updated_at ? Number(s.updated_at) : null
                }))
            });
        }
        res.json(results);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/admin/save-tour', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tourId = await ImportEngine.processTour(client, req.body.driver_name, req.body, req.body.stops || []);
        await client.query('COMMIT');
        res.json({ success: true, tourId });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); }
    finally { client.release(); }
});

app.post('/admin/transfer-tour', async (req, res) => {
    const { tourId, newDriverName } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        await client.query('UPDATE tours SET driver_name = $1, updated_at = $2 WHERE id = $3', [newDriverName, now, tourId]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).send(e.message); }
    finally { client.release(); }
});

app.post('/admin/delete-tour', async (req, res) => {
    const now = Date.now();
    await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2', [now, req.body.id]);
    await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, req.body.id]);
    res.json({ success: true });
});

// FRONTEND
app.get('/', async (req, res) => {
    try {
        const drivers = await pool.query(`SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp FROM (SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates UNION ALL SELECT driver_name, NULL as driver_photo, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp FROM tours WHERE deleted_at IS NULL) AS all_drivers ORDER BY driver_name, timestamp DESC`);
        let list = drivers.rows.map(d => `<div class="card" onclick="location.href='/driver/${encodeURIComponent(d.driver_name)}'"><img src="${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right;background:#444"><h3>${d.driver_name}</h3><p>${d.status} ${d.license_plate ? '| ' + d.license_plate : ''}</p></div>`).join('');
        res.send(`<html><head><title>Driver ERP</title><style>body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; } .card:hover { transform: scale(1.02); background: #444; }</style></head><body><h1>🚛 Flotta kiválasztása</h1><div class="grid">${list}</div></body></html>`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const allDriversRes = await pool.query('SELECT DISTINCT driver_name FROM (SELECT driver_name FROM live_updates UNION SELECT driver_name FROM tours UNION SELECT driver_name FROM work_times) as d');
    const allDrivers = allDriversRes.rows.map(r => r.driver_name).filter(n => n && n !== name);
    const update = await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name]);
    const costs = await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    const chat = await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name]);
    const work = await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name]);
    const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [name]);
    const hotelsRes = await pool.query(`SELECT name::TEXT, address::TEXT, timestamp::BIGINT FROM hotels WHERE driver_name = $1 UNION ALL SELECT COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1) AND stop_type = 'HOTEL' ORDER BY timestamp DESC`, [name]);
    for (let tour of toursRes.rows) { tour.stops = (await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [tour.id])).rows; }
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
        input, select, textarea { width: 100%; padding: 8px; background: #333; border: 1px solid #444; color: white; border-radius: 4px; box-sizing: border-box; }
        label { display: block; font-size: 11px; color: #aaa; margin-bottom: 2px; }
    </style></head>
    <body>
        <header><button onclick="location.href='/'">⬅</button><img src="${d.driver_photo || ''}" style="width:40px;height:40px;border-radius:50%;margin-left:15px;margin-right:15px;" id="headerPhoto"><h2><span id="headerName">${name}</span> - ERP</h2></header>
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
                    <h3>Státusz: <span style="color:#3498db" id="statusText">${d.status}</span></h3>
                    <p id="speedBox">Sebesség: ${Math.round(d.speed || 0)} km/h</p>
                    <p id="nextDistBox">📍 Következő megálló: - km</p>
                    <p id="tourDistBox">🏁 Túra összesen: - km</p>
                    <hr><p id="nextStopName">🎯 Cél: ${d.next_stop || 'Nincs'}</p>
                </div>
            </div>
        </div>
        <div id="tours" class="tab-content">
            <button onclick="editTour()" style="background:#2ecc71; color:white; padding:10px; margin-bottom:20px;">+ Új túra</button>
            ${toursRes.rows.map(t => `<div class="tour-card"><div style="float:right; display:flex; gap:5px;"><select onchange="transferTour(${t.id}, this.value)"><option value="">-- Áthelyezés --</option>${allDrivers.map(n => `<option value="${n}">${n}</option>`).join('')}</select><button onclick='editTour(${JSON.stringify(t).replace(/'/g, "&apos;")})'>✏</button><button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button></div><b>${t.name}</b> (${t.customer}) - ${new Date(Number(t.date)).toLocaleDateString()}${t.stops.map(s => `<div class="stop-item">${s.order_index + 1}. ${s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')}${s.address}</div>`).join('')}</div>`).join('')}
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
                <h2>Túra szerkesztése</h2><input type="hidden" id="tourId"><input type="hidden" id="tourUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                    <input type="text" id="tName" placeholder="Név"><input type="text" id="tCustomer" placeholder="Megrendelő">
                    <input type="date" id="tDate"><input type="text" id="tDay" placeholder="Nap">
                </div>
                <textarea id="tNotes" placeholder="Megjegyzések" style="height:60px; margin-bottom:20px;"></textarea>

                <h3>Depó (Visszatérés ide)</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div><label>Név</label><input type="text" id="tDepotName"></div>
                    <div><label>Cég</label><input type="text" id="tDepotCompany"></div>
                </div>
                <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-bottom:10px;">
                    <div><label>Utca</label><input type="text" id="tDepotStreet"></div>
                    <div><label>Házszám</label><input type="text" id="tDepotHouse"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-bottom:10px;">
                    <div><label>Irsz</label><input type="text" id="tDepotPostal"></div>
                    <div><label>Város</label><input type="text" id="tDepotCity"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                    <div><label>Megye</label><input type="text" id="tDepotState"></div>
                    <div><label>Ország</label><input type="text" id="tDepotCountry"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:20px;">
                    <div><label>Teljes cím</label><input type="text" id="tDepotAddressFull"></div>
                    <div><label>Lat</label><input type="text" id="tDepotLat"></div>
                    <div><label>Lng</label><input type="text" id="tDepotLng"></div>
                </div>

                <h3>Megállók</h3><div id="modalStops"></div><button onclick="addStopRow()">+ Megálló</button>
                <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;"><button onclick="closeModal()">Mégse</button><button onclick="saveTour()" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button></div>
            </div>
        </div>

        <script>
            function openTab(e, t) {
                document.querySelectorAll('.tab-content').forEach(x => x.style.display = 'none');
                document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
                const target = document.getElementById(t);
                if (target) { target.style.display = 'block'; if (e) e.currentTarget.classList.add('active'); else { const btn = Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.toLowerCase() === t.toLowerCase()); if (btn) btn.classList.add('active'); } }
            }
            openTab(null, 'tours');

            function transferTour(tourId, newDriverName) { if (!newDriverName) return; if (confirm(`Áthelyezed ${newDriverName} részére?`)) fetch('/admin/transfer-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tourId, newDriverName }) }).then(() => location.reload()); }
            function deleteTour(id) { if(confirm('Törlöd?')) fetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }).then(() => location.reload()); }
            function closeModal() { document.getElementById('tourModal').style.display = 'none'; }

            function editTour(t) {
                document.getElementById('tourId').value = t ? t.id : '';
                document.getElementById('tourUuid').value = t ? t.uuid : '';
                document.getElementById('tName').value = t ? t.name : '';
                document.getElementById('tCustomer').value = t ? t.customer : '';
                document.getElementById('tDate').value = t ? new Date(Number(t.date)).toISOString().split('T')[0] : '';
                document.getElementById('tDay').value = t ? (t.day_of_week || '') : '';
                document.getElementById('tNotes').value = t ? t.notes : '';
                document.getElementById('tDepotName').value = t ? (t.depot_name || '') : '';
                document.getElementById('tDepotCompany').value = t ? (t.depot_company || '') : '';
                document.getElementById('tDepotStreet').value = t ? (t.depot_street || '') : '';
                document.getElementById('tDepotHouse').value = t ? (t.depot_house_number || '') : '';
                document.getElementById('tDepotPostal').value = t ? (t.depot_postal_code || '') : '';
                document.getElementById('tDepotCity').value = t ? (t.depot_city || '') : '';
                document.getElementById('tDepotState').value = t ? (t.depot_state || '') : '';
                document.getElementById('tDepotCountry').value = t ? (t.depot_country || '') : '';
                document.getElementById('tDepotAddressFull').value = t ? (t.depot_address_full || '') : '';
                document.getElementById('tDepotLat').value = t ? (t.depot_lat || '') : '';
                document.getElementById('tDepotLng').value = t ? (t.depot_lng || '') : '';
                document.getElementById('modalStops').innerHTML = '';
                if(t && t.stops) t.stops.forEach(s => addStopRow(s)); else addStopRow(null);
                document.getElementById('tourModal').style.display = 'block';
            }

            function addStopRow(s) {
                const d = document.createElement('div');
                d.className = 'stop-edit-row';
                d.style = 'border:1px solid #444; padding:15px; margin-bottom:15px; border-radius:8px; position:relative;';
                const uuid = s ? s.uuid : (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2,15));
                const items = s && s.items ? s.items : [{ recipient: s ? s.recipient : '', notes: s ? s.notes : '', stop_type: s ? s.stop_type : 'DELIVERY', is_completed: s ? s.is_completed : false }];

                d.innerHTML = `
                    <button onclick="this.parentElement.remove()" style="position:absolute; right:10px; top:10px; background:#e74c3c; border:none; color:white;">X</button>
                    <input type="hidden" class="stop-uuid" value="${uuid}">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div><label>Címzett (Első)</label><input type="text" class="stop-recipient" value="${items[0].recipient}"></div>
                        <div><label>Cég</label><input type="text" class="stop-company" value="${s ? s.company : ''}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px;">
                        <div><label>Utca</label><input type="text" class="stop-street" value="${s ? s.street : ''}"></div>
                        <div><label>Házszám</label><input type="text" class="stop-house" value="${s ? (s.house_number || '') : ''}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px;">
                        <div><label>Irsz</label><input type="text" class="stop-postal" value="${s ? (s.postal_code || '') : ''}"></div>
                        <div><label>Város</label><input type="text" class="stop-city" value="${s ? s.city : ''}"></div>
                    </div>
                    <div><label>Teljes cím (Fallback)</label><input type="text" class="stop-address-full" value="${s ? s.address_full : ''}"></div>
                    <div style="margin-top:10px;"><label>Típus</label><select class="stop-type"><option value="DELIVERY" ${items[0].stop_type==='DELIVERY'?'selected':''}>DELIVERY</option><option value="PICKUP" ${items[0].stop_type==='PICKUP'?'selected':''}>PICKUP</option><option value="HOTEL" ${items[0].stop_type==='HOTEL'?'selected':''}>HOTEL</option></select></div>
                `;
                document.getElementById('modalStops').appendChild(d);
            }

            function saveTour() {
                const stops = [];
                document.querySelectorAll('.stop-edit-row').forEach((r, i) => {
                    stops.push({
                        uuid: r.querySelector('.stop-uuid').value, recipient: r.querySelector('.stop-recipient').value, company: r.querySelector('.stop-company').value,
                        street: r.querySelector('.stop-street').value, house_number: r.querySelector('.stop-house').value, postal_code: r.querySelector('.stop-postal').value,
                        city: r.querySelector('.stop-city').value, address_full: r.querySelector('.stop-address-full').value, stop_type: r.querySelector('.stop-type').value, order_index: i
                    });
                });
                const data = {
                    id: document.getElementById('tourId').value, uuid: document.getElementById('tourUuid').value, driver_name: '${name}', name: document.getElementById('tName').value,
                    customer: document.getElementById('tCustomer').value, date: new Date(document.getElementById('tDate').value).getTime(), day_of_week: document.getElementById('tDay').value,
                    notes: document.getElementById('tNotes').value, depot_name: document.getElementById('tDepotName').value, depot_company: document.getElementById('tDepotCompany').value,
                    depot_street: document.getElementById('tDepotStreet').value, depot_house_number: document.getElementById('tDepotHouse').value, depot_postal_code: document.getElementById('tDepotPostal').value,
                    depot_city: document.getElementById('tDepotCity').value, depot_state: document.getElementById('tDepotState').value, depot_country: document.getElementById('tDepotCountry').value,
                    depot_address_full: document.getElementById('tDepotAddressFull').value, depot_lat: document.getElementById('tDepotLat').value, depot_lng: document.getElementById('tDepotLng').value, stops
                };
                fetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }).then(() => location.reload());
            }

            // Map and Poll logic (Keep as is, but updated to handle V5 schema if needed)
            var map = L.map('map').setView([${d.latitude || 47.5}, ${d.longitude || 19.0}], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            var driverMarker = L.marker([${d.latitude || 47.5}, ${d.longitude || 19.0}]).addTo(map);
        </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
