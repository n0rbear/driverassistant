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
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN, deleted_at BIGINT, updated_at BIGINT)`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), tour_id INT, address TEXT, recipient TEXT, street TEXT, house_number TEXT, postal_code TEXT, city TEXT, address_full TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT, deleted_at BIGINT, updated_at BIGINT)`
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
        ['stops', 'recipient', 'TEXT'],
        ['stops', 'street', 'TEXT'],
        ['stops', 'house_number', 'TEXT'],
        ['stops', 'postal_code', 'TEXT'],
        ['stops', 'city', 'TEXT'],
        ['stops', 'address_full', 'TEXT'],
        ['tours', 'deleted_at', 'BIGINT'],
        ['stops', 'deleted_at', 'BIGINT'],
        ['tours', 'updated_at', 'BIGINT'],
        ['stops', 'updated_at', 'BIGINT'],
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
            if (type.includes('UUID')) {
                await pool.query(`UPDATE ${table} SET uuid = gen_random_uuid() WHERE uuid IS NULL`);
            }
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
    await pool.query('INSERT INTO live_updates (uuid, driver_name, driver_photo, driver_phone, driver_email, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, timestamp) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
        [d.uuid || null, d.driverName, d.driverPhoto, d.driverPhone, d.driverEmail, d.licensePlate, d.latitude, d.longitude, d.speed, d.status, d.currentTour, d.nextStop, d.nextLat, d.nextLng, d.timestamp]);
    res.sendStatus(200);
});

app.post('/api/send-chat', async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5)', [uuid || null, driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [driverName]);
    res.json(result.rows.map(r => ({
        uuid: r.uuid,
        driverName: driverName,
        sender: r.sender || 'RENDSZER',
        message: r.message || '',
        timestamp: Number(r.timestamp) || Date.now()
    })));
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query(`INSERT INTO work_times (uuid, driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (driver_name, start_time) DO UPDATE SET end_time = EXCLUDED.end_time, end_mileage = EXCLUDED.end_mileage, notes = EXCLUDED.notes`,
            [wt.uuid || null, wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    }
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query('INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, timestamp) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (driver_name, timestamp, amount) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes', [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
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
                    const now = Date.now();
                    await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id IN (SELECT id FROM tours WHERE uuid = $2)', [now, t.uuid]);
                    await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE uuid = $2', [now, t.uuid]);
                }
                continue;
            }

            let tourId;
            if (t.uuid) {
                const existing = await pool.query('SELECT id, updated_at FROM tours WHERE uuid = $1', [t.uuid]);
                if (existing.rows.length > 0) {
                    const dbTour = existing.rows[0];
                    tourId = dbTour.id;
                    const incomingUpdatedAt = Number(t.updatedAt || t.updated_at || 0);
                    const dbUpdatedAt = Number(dbTour.updated_at || 0);

                    if (incomingUpdatedAt > dbUpdatedAt) {
                        await pool.query(`
                            UPDATE tours SET
                                name = $1, customer = $2, date = $3, day_of_week = $4,
                                notes = $5, is_closed = $6, is_current = $7, updated_at = $8
                            WHERE id = $9
                        `, [t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent, incomingUpdatedAt, tourId]);
                    }
                } else {
                    const resT = await pool.query(`
                        INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING id
                    `, [t.uuid, driverName, t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent, Number(t.updatedAt || t.updated_at || Date.now())]);
                    tourId = resT.rows[0].id;
                }
            } else {
                const resT = await pool.query(`
                    INSERT INTO tours (driver_name, name, customer, date, day_of_week, notes, is_closed, is_current, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                `, [driverName, t.name || 'Túra', t.customer || '', t.date || Date.now(), t.dayOfWeek || '', t.notes || '', !!t.isClosed, !!t.isCurrent, Date.now()]);
                tourId = resT.rows[0].id;
            }

            if (item.stops && Array.isArray(item.stops)) {
                for (const s of item.stops) {
                    if (s.deletedAt) {
                        if (s.uuid) {
                            const now = Date.now();
                            await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE uuid = $2', [now, s.uuid]);
                        }
                        continue;
                    }

                    const incomingUpdatedAt = Number(s.updatedAt || s.updated_at || Date.now());

                    if (s.uuid) {
                        const existingStop = await pool.query('SELECT id, updated_at FROM stops WHERE uuid = $1', [s.uuid]);
                        if (existingStop.rows.length > 0) {
                            const dbStop = existingStop.rows[0];
                            const dbUpdatedAt = Number(dbStop.updated_at || 0);

                            if (incomingUpdatedAt > dbUpdatedAt) {
                                await pool.query(`
                                    UPDATE stops SET
                                        tour_id = $1, address = $2, recipient = $3, street = $4, house_number = $5,
                                        postal_code = $6, city = $7, address_full = $8, contact_name = $9,
                                        phone_number = $10, email = $11, time_window = $12, notes = $13,
                                        alternative_names = $14, order_index = $15, latitude = $16,
                                        longitude = $17, is_completed = $18, arrival_time = $19, updated_at = $20
                                    WHERE uuid = $21
                                `, [
                                    tourId, s.address || '', s.recipient || '', s.street || '', s.houseNumber || s.house_number || '',
                                    s.postalCode || s.postal_code || '', s.city || '', s.addressFull || s.address_full || '',
                                    s.contactName || s.contact_name || '', s.phoneNumber || s.phone_number || '', s.email || '',
                                    s.timeWindow || s.time_window || '', s.notes || '', s.alternativeNames || s.alternative_names || null,
                                    s.orderIndex !== undefined ? s.orderIndex : (s.order_index || 0),
                                    s.latitude !== undefined ? s.latitude : (s.latitude_gps || null),
                                    s.longitude !== undefined ? s.longitude : (s.longitude_gps || null),
                                    s.isCompleted !== undefined ? !!s.isCompleted : (!!s.is_completed),
                                    s.arrivalTime || s.arrival_time || null, incomingUpdatedAt, s.uuid
                                ]);
                            }
                        } else {
                            await pool.query(`
                                INSERT INTO stops (uuid, tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, alternative_names, order_index, latitude, longitude, is_completed, arrival_time, updated_at)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                            `, [
                                s.uuid, tourId, s.address || '', s.recipient || '', s.street || '', s.houseNumber || s.house_number || '',
                                s.postalCode || s.postal_code || '', s.city || '', s.addressFull || s.address_full || '',
                                s.contactName || s.contact_name || '', s.phoneNumber || s.phone_number || '', s.email || '',
                                s.timeWindow || s.time_window || '', s.notes || '', s.alternativeNames || s.alternative_names || null,
                                s.orderIndex !== undefined ? s.orderIndex : (s.order_index || 0),
                                s.latitude !== undefined ? s.latitude : (s.latitude_gps || null),
                                s.longitude !== undefined ? s.longitude : (s.longitude_gps || null),
                                s.isCompleted !== undefined ? !!s.isCompleted : (!!s.is_completed),
                                s.arrivalTime || s.arrival_time || null, incomingUpdatedAt
                            ]);
                        }
                    } else {
                        await pool.query(`
                            INSERT INTO stops (tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, alternative_names, order_index, latitude, longitude, is_completed, arrival_time, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                        `, [
                            tourId, s.address || '', s.recipient || '', s.street || '', s.houseNumber || s.house_number || '',
                            s.postalCode || s.postal_code || '', s.city || '', s.addressFull || s.address_full || '',
                            s.contactName || s.contact_name || '', s.phoneNumber || s.phone_number || '', s.email || '',
                            s.timeWindow || s.time_window || '', s.notes || '', s.alternativeNames || s.alternative_names || null,
                            s.orderIndex !== undefined ? s.orderIndex : (s.order_index || 0),
                            s.latitude !== undefined ? s.latitude : (s.latitude_gps || null),
                            s.longitude !== undefined ? s.longitude : (s.longitude_gps || null),
                            s.isCompleted !== undefined ? !!s.isCompleted : (!!s.is_completed),
                            s.arrivalTime || s.arrival_time || null, incomingUpdatedAt
                        ]);
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
        await pool.query('INSERT INTO hotels (uuid, driver_name, name, address, timestamp) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5) ON CONFLICT DO NOTHING', [h.uuid || null, h.driverName, h.name, h.address, h.timestamp]);
    }
    res.sendStatus(200);
});

app.post('/admin/update-cost', async (req, res) => {
    await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [req.body.status, req.body.id]);
    res.json({ success: true });
});

app.get('/api/cost-status/:driverName', async (req, res) => {
    const result = await pool.query('SELECT id, uuid, status, timestamp, amount FROM costs WHERE driver_name = $1', [req.params.driverName]);
    res.json(result.rows.map(r => ({
        id: r.id,
        uuid: r.uuid,
        status: r.status || 'Rögzítve',
        timestamp: Number(r.timestamp) || Date.now(),
        amount: Number(r.amount) || 0
    })));
});

app.post('/admin/save-tour', async (req, res) => {
    try {
        const { id, uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, stops } = req.body;
        let tourId = id;

        if (!tourId && uuid) {
            const resUuid = await pool.query('SELECT id FROM tours WHERE uuid = $1', [uuid]);
            if (resUuid.rows.length > 0) tourId = resUuid.rows[0].id;
        }

        const safeDate = (date && !isNaN(Number(date))) ? Number(date) : null;

        if (tourId) {
            await pool.query(`
                UPDATE tours SET
                    name = COALESCE($1, name),
                    customer = COALESCE($2, customer),
                    date = COALESCE($3, date),
                    day_of_week = COALESCE($4, day_of_week),
                    notes = COALESCE($5, notes),
                    is_closed = COALESCE($6, is_closed),
                    updated_at = ${Date.now()}
                WHERE id = $7
            `, [name || null, customer || null, safeDate, day_of_week || null, notes || null, is_closed === undefined ? null : !!is_closed, tourId]);
        } else {
            const result = await pool.query('INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, updated_at) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id', [uuid || null, driver_name || 'Ismeretlen', name || 'Túra', customer || '', safeDate || Date.now(), day_of_week || '', notes || '', !!is_closed, Date.now()]);
            tourId = result.rows[0].id;
        }

        if (stops && Array.isArray(stops)) {
            const incomingStopUuids = stops.map(s => s.uuid).filter(u => !!u);
            const now = Date.now();

            // Delete stops NOT in the incoming list for this tour
            // We do this BEFORE upserting to avoid deleting newly created stops that don't have UUIDs in the request yet
            if (tourId) {
                await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND uuid IS NOT NULL AND NOT (uuid = ANY($3))', [now, tourId, incomingStopUuids]);
            }

            for (const s of stops) {
                const params = [
                    s.uuid || null,
                    tourId,
                    s.address || '',
                    s.recipient || '',
                    s.street || '',
                    s.house_number || s.houseNumber || '',
                    s.postal_code || s.postalCode || '',
                    s.city || '',
                    s.address_full || s.addressFull || '',
                    s.contact_name !== undefined ? s.contact_name : (s.contactName !== undefined ? s.contactName : null),
                    s.phone_number !== undefined ? s.phone_number : (s.phoneNumber !== undefined ? s.phoneNumber : null),
                    s.email || null,
                    s.time_window !== undefined ? s.time_window : (s.timeWindow !== undefined ? s.timeWindow : null),
                    s.notes || null,
                    s.order_index !== undefined ? s.order_index : (s.orderIndex || 0),
                    s.is_completed !== undefined ? !!s.is_completed : (s.isCompleted !== undefined ? !!s.isCompleted : null),
                    s.latitude !== undefined ? s.latitude : null,
                    s.longitude !== undefined ? s.longitude : null,
                    s.alternative_names || s.alternativeNames || null
                ];

                if (s.uuid) {
                    await pool.query(`
                        INSERT INTO stops (uuid, tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, order_index, is_completed, latitude, longitude, alternative_names, updated_at, deleted_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NULL)
                        ON CONFLICT (uuid) DO UPDATE SET
                            tour_id = EXCLUDED.tour_id,
                            address = COALESCE(EXCLUDED.address, stops.address),
                            recipient = COALESCE(EXCLUDED.recipient, stops.recipient),
                            street = COALESCE(EXCLUDED.street, stops.street),
                            house_number = COALESCE(EXCLUDED.house_number, stops.house_number),
                            postal_code = COALESCE(EXCLUDED.postal_code, stops.postal_code),
                            city = COALESCE(EXCLUDED.city, stops.city),
                            address_full = COALESCE(EXCLUDED.address_full, stops.address_full),
                            contact_name = COALESCE(EXCLUDED.contact_name, stops.contact_name),
                            phone_number = COALESCE(EXCLUDED.phone_number, stops.phone_number),
                            email = COALESCE(EXCLUDED.email, stops.email),
                            time_window = COALESCE(EXCLUDED.time_window, stops.time_window),
                            notes = COALESCE(EXCLUDED.notes, stops.notes),
                            order_index = EXCLUDED.order_index,
                            is_completed = COALESCE(EXCLUDED.is_completed, stops.is_completed),
                            latitude = COALESCE(EXCLUDED.latitude, stops.latitude),
                            longitude = COALESCE(EXCLUDED.longitude, stops.longitude),
                            alternative_names = COALESCE(EXCLUDED.alternative_names, stops.alternative_names),
                            updated_at = EXCLUDED.updated_at,
                            deleted_at = NULL
                    `, [...params, now]);
                } else {
                    await pool.query('INSERT INTO stops (tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, order_index, is_completed, latitude, longitude, alternative_names, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)', [...params.slice(1), now]);
                }
            }
        }
        res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).send(e.message); }
});

app.post('/admin/delete-tour', async (req, res) => {
    const now = Date.now();
    await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2', [now, req.body.id]);
    await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, req.body.id]);
    res.json({ success: true });
});

app.get('/api/get-tours/:driverName', async (req, res) => {
    try {
        const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 ORDER BY date DESC', [req.params.driverName]);
        const results = [];
        for (let tour of toursRes.rows) {
            const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 ORDER BY order_index ASC', [tour.id]);
            results.push({
                tour: {
                    id: tour.id,
                    uuid: tour.uuid,
                    driverName: tour.driver_name || 'Ismeretlen',
                    name: tour.name || 'Túra',
                    customer: tour.customer || '',
                    date: Number(tour.date) || Date.now(),
                    dayOfWeek: tour.day_of_week || '',
                    notes: tour.notes || '',
                    isClosed: !!tour.is_closed,
                    isCurrent: !!tour.is_current,
                    deletedAt: tour.deleted_at ? Number(tour.deleted_at) : null,
                    updatedAt: tour.updated_at ? Number(tour.updated_at) : null
                },
                stops: stopsRes.rows.map(s => ({
                    id: s.id,
                    uuid: s.uuid,
                    tourId: s.tour_id,
                    address: s.address || '',
                    recipient: s.recipient || '',
                    street: s.street || '',
                    houseNumber: s.house_number || '',
                    postalCode: s.postal_code || '',
                    city: s.city || '',
                    addressFull: s.address_full || '',
                    contactName: s.contact_name || '',
                    phoneNumber: s.phone_number || '',
                    email: s.email || '',
                    timeWindow: s.time_window || '',
                    notes: s.notes || '',
                    alternativeNames: s.alternative_names || null,
                    orderIndex: s.order_index || 0,
                    latitude: s.latitude !== null ? Number(s.latitude) : null,
                    longitude: s.longitude !== null ? Number(s.longitude) : null,
                    isCompleted: !!s.is_completed,
                    arrivalTime: s.arrival_time ? Number(s.arrival_time) : null,
                    deletedAt: s.deleted_at ? Number(s.deleted_at) : null,
                    updatedAt: s.updated_at ? Number(s.updated_at) : null
                }))
            });
        }
        res.json(results);
    } catch (e) { res.status(500).send(e.message); }
});

// FRONTEND
app.get('/', async (req, res) => {
    try {
        const drivers = await pool.query(`SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp FROM (SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates UNION ALL SELECT driver_name, NULL as driver_photo, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp FROM tours WHERE deleted_at IS NULL UNION ALL SELECT driver_name, NULL as driver_photo, 'Munkaidő feltöltve' as status, license_plate, start_time::BIGINT as timestamp FROM work_times) AS all_drivers ORDER BY driver_name, timestamp DESC`);
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
    const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [name]);
    const hotelsRes = await pool.query('SELECT * FROM hotels WHERE driver_name = $1 ORDER BY timestamp DESC', [name]);
    for (let tour of toursRes.rows) {
        const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [tour.id]);
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
        .stop-edit-row label { display: block; font-size: 11px; color: #aaa; margin-bottom: 2px; }
        .stop-edit-row input, .stop-edit-row select { width: 100%; padding: 8px; background: #333; border: 1px solid #444; color: white; border-radius: 4px; box-sizing: border-box; }
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
                <h3>Megállók</h3><div id="modalStops"></div><button id="addStopBtn" onclick="addStopRow()">+ Megálló</button>
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
                const target = document.getElementById(t);
                if (target) {
                    target.style.display = 'block';
                    if (e) e.currentTarget.classList.add('active');
                    else {
                        const btn = Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.toLowerCase() === t.toLowerCase() || (t==='report' && b.innerText==='MENETLEVÉL'));
                        if (btn) btn.classList.add('active');
                    }
                    localStorage.setItem('activeTab_' + '${name}', t);
                }
                if(t === 'dashboard') setTimeout(() => map.invalidateSize(), 200);
            }
            const savedTab = localStorage.getItem('activeTab_' + '${name}') || 'dashboard';
            openTab(null, savedTab);

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
                document.getElementById('tName').disabled = !!t;
                document.getElementById('tCustomer').value = t ? t.customer : '';
                document.getElementById('tCustomer').disabled = !!t;
                document.getElementById('tDate').value = t ? new Date(Number(t.date)).toISOString().split('T')[0] : '';
                document.getElementById('tDate').disabled = !!t;
                document.getElementById('tDay').value = t ? (t.day_of_week || t.dayOfWeek || '') : '';
                document.getElementById('tDay').disabled = !!t;
                document.getElementById('tNotes').value = t ? t.notes : '';
                document.getElementById('tNotes').disabled = !!t;

                document.getElementById('addStopBtn').style.display = 'block';
                document.getElementById('modalStops').innerHTML = '';
                if(t && t.stops) t.stops.forEach(s => addStopRow(s, false)); else addStopRow(null, false);
                document.getElementById('tourModal').style.display = 'block';
            }

            async function geocodeStop(row) {
                const street = row.querySelector('.stop-street').value;
                const house = row.querySelector('.stop-house').value;
                const postal = row.querySelector('.stop-postal').value;
                const city = row.querySelector('.stop-city').value;
                if (!street || !city) return;
                const q = \`\${street} \${house}, \${postal} \${city}\`;
                try {
                    const res = await fetch(\`https://nominatim.openstreetmap.org/search?format=json&q=\${encodeURIComponent(q)}\`);
                    const data = await res.json();
                    if (data && data.length > 0) {
                        row.querySelector('.stop-lat').value = data[0].lat;
                        row.querySelector('.stop-lon').value = data[0].lon;
                    }
                } catch (e) { console.error(e); }
            }

            function addStopRow(s, isReadOnlyStructure) {
                const d = document.createElement('div');
                d.className = 'stop-edit-row';
                d.style = 'border:1px solid #444; padding:15px; margin-bottom:15px; border-radius:8px; position:relative;';

                // Generate UUID for new stops on the frontend to avoid deletion bug
                const uuid = s ? (s.uuid || '') : (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));
                const altNames = s ? (s.alternativeNames || s.alternative_names || '') : '';
                const lat = s ? (s.latitude || '') : '';
                const lon = s ? (s.longitude || '') : '';

                let recipientHtml = '';
                const altList = altNames ? altNames.split('|') : [];
                if (altList.length > 1) {
                    recipientHtml = \`<select class="stop-recipient" style="margin-bottom:5px;">\` +
                        altList.map(name => \`<option value="\${name}" \${name === (s.recipient || '') ? 'selected' : ''}>\${name}</option>\`).join('') +
                        '<option value="custom">-- Egyéni --</option></select>' +
                        '<input type="text" class="stop-recipient-input" value="' + (s ? (s.recipient || '') : '') + '" placeholder="Címzett" style="display:none;">';
                } else {
                    recipientHtml = '<input type="text" class="stop-recipient-input" value="' + (s ? (s.recipient || '') : '') + '" placeholder="Címzett" style="margin-bottom:5px;">';
                }

                d.innerHTML = \`
                    <button onclick="this.parentElement.remove()" style="position:absolute; right:10px; top:10px; background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">X</button>
                    <input type="hidden" class="stop-uuid" value="\${uuid}">
                    <input type="hidden" class="stop-lat" value="\${lat}">
                    <input type="hidden" class="stop-lon" value="\${lon}">
                    <input type="hidden" class="stop-alt-names" value="\${altNames}">

                    <label>Címzett</label>
                    \${recipientHtml}

                    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:5px;">
                        <div><label>Utca</label><input type="text" class="stop-street" value="\${s ? (s.street || '') : ''}" placeholder="Utca" onchange="geocodeStop(this.parentElement.parentElement.parentElement)"></div>
                        <div><label>Házszám</label><input type="text" class="stop-house" value="\${s ? (s.house_number || s.houseNumber || '') : ''}" placeholder="Házszám" onchange="geocodeStop(this.parentElement.parentElement.parentElement)"></div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 2fr; gap:10px; margin-bottom:5px;">
                        <div><label>Irányítószám</label><input type="text" class="stop-postal" value="\${s ? (s.postal_code || s.postalCode || '') : ''}" placeholder="Irsz" onchange="geocodeStop(this.parentElement.parentElement.parentElement)"></div>
                        <div><label>Város</label><input type="text" class="stop-city" value="\${s ? (s.city || '') : ''}" placeholder="Város" onchange="geocodeStop(this.parentElement.parentElement.parentElement)"></div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:5px;">
                        <div><label>Kapcsolattartó</label><input type="text" class="stop-contact" value="\${s ? (s.contact_name || s.contactName || '') : ''}" placeholder="Kapcsolattartó"></div>
                        <div><label>Telefonszám</label><input type="text" class="stop-phone" value="\${s ? (s.phone_number || s.phoneNumber || '') : ''}" placeholder="Telefon"></div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:5px;">
                        <div><label>Időablak</label><input type="text" class="stop-time" value="\${s ? (s.time_window || s.timeWindow || '') : ''}" placeholder="Időablak"></div>
                        <div><label>Megjegyzés</label><input type="text" class="stop-notes" value="\${s ? (s.notes || '') : ''}" placeholder="Megjegyzés"></div>
                    </div>
                    <div style="margin-bottom:5px;">
                        <label><input type="checkbox" class="stop-completed" \${s && (s.is_completed || s.isCompleted) ? 'checked' : ''}> Teljesítve</label>
                    </div>
                \`;

                const select = d.querySelector('.stop-recipient');
                const input = d.querySelector('.stop-recipient-input');
                if (select) {
                    select.addEventListener('change', () => {
                        if (select.value === 'custom') { input.style.display = 'block'; } else { input.style.display = 'none'; input.value = select.value; }
                    });
                }
                document.getElementById('modalStops').appendChild(d);
            }

            function closeModal() { document.getElementById('tourModal').style.display = 'none'; }
            function saveTour() {
                const stops = [];
                document.querySelectorAll('#modalStops .stop-edit-row').forEach((r, i) => {
                    const street = r.querySelector('.stop-street').value;
                    const house = r.querySelector('.stop-house').value;
                    const postal = r.querySelector('.stop-postal').value;
                    const city = r.querySelector('.stop-city').value;
                    const address_full = (street + ' ' + house + ', ' + postal + ' ' + city).trim().replace(/^,/, '').trim();

                    const select = r.querySelector('.stop-recipient');
                    const recipientInput = r.querySelector('.stop-recipient-input');
                    let recipient = recipientInput.value;
                    if (select && select.value !== 'custom') { recipient = select.value; }

                    stops.push({
                        uuid: r.querySelector('.stop-uuid').value || null,
                        recipient: recipient,
                        street: street,
                        house_number: house,
                        postal_code: postal,
                        city: city,
                        address_full: address_full,
                        address: address_full,
                        contact_name: r.querySelector('.stop-contact').value,
                        phone_number: r.querySelector('.stop-phone').value,
                        time_window: r.querySelector('.stop-time').value,
                        notes: r.querySelector('.stop-notes').value,
                        is_completed: r.querySelector('.stop-completed').checked,
                        order_index: i,
                        latitude: r.querySelector('.stop-lat').value ? parseFloat(r.querySelector('.stop-lat').value) : null,
                        longitude: r.querySelector('.stop-lon').value ? parseFloat(r.querySelector('.stop-lon').value) : null,
                        alternative_names: r.querySelector('.stop-alt-names').value || null
                    });
                });
                const data = {
                    id: document.getElementById('tourId').value,
                    uuid: document.getElementById('tourUuid').value,
                    driver_name: '${name}',
                    name: document.getElementById('tName').value,
                    customer: document.getElementById('tCustomer').value,
                    date: new Date(document.getElementById('tDate').value).getTime(),
                    day_of_week: document.getElementById('tDay').value,
                    notes: document.getElementById('tNotes').value,
                    stops
                };
                fetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }).then(() => location.reload());
            }
            function deleteTour(id) { if(confirm('Törlöd?')) fetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }).then(() => location.reload()); }
        </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
