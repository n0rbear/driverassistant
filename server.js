// FIXED SERVER v17 - TRACE LIVE UPDATES
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
        const find = (keys) => {
            for (const k of keys) if (addr[k] !== undefined && addr[k] !== null) return String(addr[k]).trim();
            return '';
        };
        const result = {
            recipient: find(['recipient', 'depot_name', 'depotName']),
            company: find(['company', 'depot_company', 'depotCompany']),
            street: find(['street', 'depot_street', 'depotStreet']),
            house_number: find(['house_number', 'houseNumber', 'depot_house_number', 'depotHouseNumber']),
            postal_code: find(['postal_code', 'postalCode', 'depot_postal_code', 'depotPostalCode']),
            city: find(['city', 'depot_city', 'depotCity']),
            state: find(['state', 'depot_state', 'depotState']),
            country: find(['country', 'depot_country', 'depotCountry']),
            address_full: find(['address_full', 'addressFull', 'address', 'depot_address_full', 'depotAddressFull']),
            latitude: null, longitude: null, notes: find(['notes'])
        };
        const lat = addr.latitude ?? addr.depot_lat ?? addr.depotLatitude;
        const lng = addr.longitude ?? addr.depot_lng ?? addr.depotLongitude;
        if (lat) result.latitude = parseFloat(lat);
        if (lng) result.longitude = parseFloat(lng);
        if (!result.street && !result.city && result.address_full) {
            const match = result.address_full.match(/^(.+)\s+([^,]+),\s*(\d{4})\s+(.+)$/);
            if (match) { result.street = match[1]; result.house_number = match[2]; result.postal_code = match[3]; result.city = match[4]; }
        }
        if (!result.address_full && result.street && result.city) result.address_full = `${result.street} ${result.house_number}, ${result.postal_code} ${result.city}`;
        return result;
    },
    getFingerprint(addr) {
        const n = this.normalize(addr);
        return n ? `${n.country}|${n.postal_code}|${n.city}|${n.street}|${n.house_number}`.toLowerCase() : '';
    }
};

// ==========================================
// STATUS ENGINE
// ==========================================
const StatusEngine = {
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dPhi = (lat2 - lat1) * Math.PI / 180;
        const dLambda = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    },

    async updateStatus(client, d) {
        const driverName = d.driverName;
        const now = d.timestamp || Date.now();
        const today = new Date(now).toISOString().split('T')[0];

        // 1. Get current ongoing task
        const ongoingRes = await client.query('SELECT * FROM work_times WHERE driver_name = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1', [driverName]);
        const ongoing = ongoingRes.rows[0];

        // 2. Get today's work times
        const todayWorkRes = await client.query('SELECT * FROM work_times WHERE driver_name = $1 AND date = $2', [driverName, today]);
        const workTimesToday = todayWorkRes.rows;

        // 3. Get current tour and stops
        const tourRes = await client.query('SELECT id, name FROM tours WHERE driver_name = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1', [driverName]);
        const currentTour = tourRes.rows[0];
        let stops = [];
        if (currentTour) {
            const stopsRes = await client.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [currentTour.id]);
            stops = stopsRes.rows;
        }

        // 4. Determine Status
        let calculatedStatus = ongoing ? ongoing.type : 'Offline';
        let isAtTourStop = false;
        let isNearKnownPlace = false;

        // OSRM Data
        let nextStopDist = null;
        let nextStopDur = null;
        let tourRemainingDist = null;
        let tourRemainingDur = null;
        let nextStopInfo = null;

        const incompleteStops = stops.filter(s => !s.is_completed);
        const nextStop = incompleteStops[0];

        // 0. Initial Morning Start
        if (!ongoing && workTimesToday.length === 0 && d.speed > 8) {
            console.log(`[STATUS] Morning start for ${driverName}`);
            await this.startWork(client, driverName, 'Munka', today, d.licensePlate, null, now);
            calculatedStatus = 'Munka';
        }

        // 1. Proximity check (Home/Base)
        const driverInfoRes = await client.query('SELECT home_lat, home_lng, base_lat, base_lng FROM drivers WHERE name = $1', [driverName]);
        const dInfo = driverInfoRes.rows[0];
        if (dInfo) {
            const places = [{ lat: dInfo.home_lat, lng: dInfo.home_lng, name: 'Home' }, { lat: dInfo.base_lat, lng: dInfo.base_lng, name: 'Base' }];
            for (const p of places) {
                if (p.lat && p.lng) {
                    const dist = this.calculateDistance(d.latitude, d.longitude, p.lat, p.lng);
                    if (dist < 200) {
                        isNearKnownPlace = true;
                        if (d.speed < 1 && ongoing && ongoing.type === 'Vezetés') {
                            await client.query('UPDATE work_times SET end_time = $1 WHERE id = $2', [now, ongoing.id]);
                            calculatedStatus = 'Offline';
                        }
                    }
                }
            }
        }

        // 2. Tour stops proximity
        for (const stop of stops) {
            if (stop.latitude && stop.longitude) {
                const dist = this.calculateDistance(d.latitude, d.longitude, stop.latitude, stop.longitude);
                if (dist < 200) {
                    isAtTourStop = true;
                    if (d.speed < 2) {
                        if (!ongoing || ongoing.type === 'Vezetés') {
                            await this.startWork(client, driverName, 'Rakodás', today, d.licensePlate, ongoing?.mileage, now);
                            calculatedStatus = 'Rakodás';
                        }
                        if (!stop.is_completed) {
                            const twoMinsAgo = now - (2 * 60 * 1000);
                            const recentUpdatesAtStop = await client.query('SELECT latitude, longitude FROM live_updates WHERE driver_name = $1 AND timestamp > $2 ORDER BY timestamp ASC', [driverName, twoMinsAgo]);
                            const stayedNear = recentUpdatesAtStop.rows.length > 3 && recentUpdatesAtStop.rows.every(r => this.calculateDistance(r.latitude, r.longitude, stop.latitude, stop.longitude) < 300);
                            if (stayedNear) {
                                await client.query('UPDATE stops SET is_completed = true, arrival_time = $1, updated_at = $1 WHERE id = $2', [now, stop.id]);
                            }
                        }
                        calculatedStatus = 'Rakodás';
                        break;
                    }
                }
            }
        }

        // 3. Movement logic
        if (d.speed > 10 && !isAtTourStop) {
            if (!ongoing || ongoing.type === 'Pihenő') {
                await this.startWork(client, driverName, 'Vezetés', today, d.licensePlate, null, now);
                calculatedStatus = 'Vezetés';
            }
        } else if (d.speed < 1 && ongoing && ongoing.type === 'Vezetés' && !isAtTourStop && !isNearKnownPlace) {
            const threeMinsAgo = now - (3 * 60 * 1000);
            const recentUpdates = await client.query('SELECT speed FROM live_updates WHERE driver_name = $1 AND timestamp > $2', [driverName, threeMinsAgo]);
            if (recentUpdates.rows.length > 5 && recentUpdates.rows.every(r => r.speed < 1.5)) {
                await this.startWork(client, driverName, 'Pihenő', today, d.licensePlate, ongoing.mileage, now);
                calculatedStatus = 'Pihenő';
            }
        }

        // 4. OSRM Calculations (Moved from App)
        if (nextStop) {
            try {
                const waypoints = incompleteStops
                    .filter(s => s.latitude && s.longitude)
                    .map(s => `${s.longitude},${s.latitude}`);

                const url = `https://router.project-osrm.org/route/v1/driving/${d.longitude},${d.latitude};${waypoints.join(';')}?overview=false`;
                const r = await fetch(url).then(res => res.json());
                if (r.routes && r.routes[0]) {
                     tourRemainingDist = r.routes[0].distance / 1000;
                     tourRemainingDur = Math.round(r.routes[0].duration);
                     if (r.routes[0].legs && r.routes[0].legs[0]) {
                         nextStopDist = r.routes[0].legs[0].distance / 1000;
                         nextStopDur = Math.round(r.routes[0].legs[0].duration);
                     }
                }
                nextStopInfo = `${nextStop.contact_name || nextStop.recipient} | ${nextStop.address}`;
            } catch (e) {}
        }

        return { status: calculatedStatus, nextStopDist, nextStopDur, tourRemainingDist, tourRemainingDur, nextStopInfo, currentTourName: currentTour?.name };
    },

    async startWork(client, driverName, type, date, plate, mileage, now) {
        // Close existing
        await client.query('UPDATE work_times SET end_time = $1 WHERE driver_name = $2 AND end_time IS NULL', [now, driverName]);
        // Insert new
        await client.query('INSERT INTO work_times (uuid, driver_name, type, start_time, date, license_plate, mileage) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)',
            [driverName, type, now, date, plate || 'N/A', mileage || 0]);
    }
};

// ==========================================
// IMPORT ENGINE
// ==========================================
const ImportEngine = {
    async processTour(client, driverName, tourData, stopsData) {
        // UUID alapú keresés, hogy elkerüljük a kliens/szerver ID ütközést
        const existingRes = await client.query('SELECT id FROM tours WHERE uuid = $1', [tourData.uuid]);
        let tourId = existingRes.rows.length > 0 ? existingRes.rows[0].id : null;

        const tour = { ...tourData, driver_name: driverName, updated_at: tourData.updated_at || tourData.updatedAt || Date.now() };
        const depot = AddressEngine.normalize(tourData);
        const groupedStops = new Map();

        for (const rawStop of stopsData) {
            const n = AddressEngine.normalize(rawStop);
            const fp = AddressEngine.getFingerprint(n);
            const item = {
                uuid: (rawStop.uuid && String(rawStop.uuid).trim() !== "") ? String(rawStop.uuid) : null,
                recipient: n.recipient, company: n.company, notes: n.notes,
                contact_name: rawStop.contact_name || rawStop.contactName || '',
                phone_number: rawStop.phone_number || rawStop.phoneNumber || '',
                email: rawStop.email || '', time_window: rawStop.time_window || rawStop.timeWindow || '',
                stop_type: rawStop.stop_type || rawStop.stopType || 'DELIVERY',
                is_completed: !!(rawStop.is_completed || rawStop.isCompleted),
                arrival_time: rawStop.arrival_time || rawStop.arrivalTime || null,
                updated_at: rawStop.updated_at || rawStop.updatedAt || Date.now()
            };
            if (groupedStops.has(fp)) groupedStops.get(fp).items.push(item);
            else groupedStops.set(fp, { ...n, items: [item] });
        }

        if (tourId) {
            await client.query(`UPDATE tours SET driver_name=$1, name=$2, customer=$3, date=$4, day_of_week=$5, notes=$6, is_closed=$7, is_current=$8, depot_name=$9, depot_company=$10, depot_street=$11, depot_house_number=$12, depot_postal_code=$13, depot_city=$14, depot_state=$15, depot_country=$16, depot_address_full=$17, depot_lat=$18, depot_lng=$19, updated_at=$20, deleted_at=$22 WHERE id=$21`,
                [driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tourId, tour.deleted_at || tour.deletedAt || null]);
        } else {
            const res = await client.query(`INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current, depot_name, depot_company, depot_street, depot_house_number, depot_postal_code, depot_city, depot_state, depot_country, depot_address_full, depot_lat, depot_lng, updated_at, deleted_at) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id, uuid`,
                [tour.uuid || null, driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tour.deleted_at || tour.deletedAt || null]);
            tourId = res.rows[0].id;
            if (!tour.uuid) tour.uuid = res.rows[0].uuid;
        }

        const currentUuids = [];
        let idx = 0;
        for (const s of groupedStops.values()) {
            const main = s.items[0];
            const res = await client.query(`INSERT INTO stops (uuid, tour_id, address, recipient, company, street, house_number, postal_code, city, state, country, address_full, contact_name, phone_number, email, time_window, notes, order_index, latitude, longitude, is_completed, arrival_time, stop_type, updated_at, items) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) ON CONFLICT (uuid) DO UPDATE SET tour_id=EXCLUDED.tour_id, address=EXCLUDED.address, recipient=EXCLUDED.recipient, company=EXCLUDED.company, street=EXCLUDED.street, house_number=EXCLUDED.house_number, postal_code=EXCLUDED.postal_code, city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country, address_full=EXCLUDED.address_full, contact_name=EXCLUDED.contact_name, phone_number=EXCLUDED.phone_number, email=EXCLUDED.email, time_window=EXCLUDED.time_window, notes=EXCLUDED.notes, order_index=EXCLUDED.order_index, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, is_completed=EXCLUDED.is_completed, arrival_time=EXCLUDED.arrival_time, stop_type=EXCLUDED.stop_type, updated_at=EXCLUDED.updated_at, items=EXCLUDED.items RETURNING uuid`,
                [main.uuid, tourId, s.address_full, main.recipient, s.company, s.street, s.house_number, s.postal_code, s.city, s.state, s.country, s.address_full, main.contact_name, main.phone_number, main.email, main.time_window, main.notes, idx++, s.latitude, s.longitude, main.is_completed, main.arrival_time, main.stop_type, main.updated_at, JSON.stringify(s.items)]);
            currentUuids.push(res.rows[0].uuid);
        }
        await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND deleted_at IS NULL AND NOT (uuid = ANY($3::UUID[]))', [tour.updated_at, tourId, currentUuids]);

        if (tour.is_current) {
            try {
                const tourUuid = tour.uuid || tourData.uuid;
                if (tourUuid) {
                    console.log(`[TRACE-TOUR] Calling set_current_tour for driver: ${driverName}, tourUuid: ${tourUuid}`);
                    await client.query('SELECT set_current_tour($1, $2)', [driverName, tourUuid]);
                } else {
                    console.warn(`[TRACE-TOUR] Cannot call set_current_tour, UUID is missing for tourId: ${tourId}`);
                }
            } catch (err) {
                console.error(`[TRACE-TOUR] Failed to set current tour in processTour: ${err.message}`);
            }
        }

        return tourId;
    }
};

const initDb = async () => {
    console.log('[STARTUP] initDb started');
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    const queries = [
        `CREATE TABLE IF NOT EXISTS drivers (uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY, name TEXT UNIQUE, email TEXT, phone TEXT, license_plate TEXT, photo_url TEXT, is_active BOOLEAN DEFAULT TRUE, home_lat DOUBLE PRECISION, home_lng DOUBLE PRECISION, base_lat DOUBLE PRECISION, base_lng DOUBLE PRECISION)`,
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, driver_photo TEXT, driver_phone TEXT, driver_email TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, next_stop_dist FLOAT, next_stop_duration BIGINT, tour_remaining_dist FLOAT, tour_remaining_duration BIGINT, depot_name TEXT, depot_lat DOUBLE PRECISION, depot_lng DOUBLE PRECISION, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, name TEXT, address TEXT, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN, depot_name TEXT, depot_company TEXT, depot_street TEXT, depot_house_number TEXT, depot_postal_code TEXT, depot_city TEXT, depot_state TEXT, depot_country TEXT, depot_address_full TEXT, depot_lat DOUBLE PRECISION, depot_lng DOUBLE PRECISION, deleted_at BIGINT, updated_at BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, tour_id INT, address TEXT, recipient TEXT, company TEXT, street TEXT, house_number TEXT, postal_code TEXT, city TEXT, state TEXT, country TEXT, address_full TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT, deleted_at BIGINT, updated_at BIGINT, stop_type TEXT DEFAULT 'DELIVERY', items JSONB, UNIQUE(uuid))`,
        `CREATE OR REPLACE FUNCTION set_current_tour(p_driver_name TEXT, p_tour_uuid UUID) RETURNS VOID AS $$
        BEGIN
            UPDATE tours SET is_current = false, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE driver_name = p_driver_name AND uuid != p_tour_uuid;
            UPDATE tours SET is_current = true, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE uuid = p_tour_uuid AND driver_name = p_driver_name;
        END;
        $$ LANGUAGE plpgsql;`
    ];
    for (let q of queries) await pool.query(q);
    const cols = [
        ['stops', 'items', 'JSONB'],
        ['stops', 'stop_type', 'TEXT DEFAULT \'DELIVERY\''],
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
        ['stops', 'country', 'TEXT'],
        ['live_updates', 'depot_name', 'TEXT'],
        ['live_updates', 'depot_lat', 'DOUBLE PRECISION'],
        ['live_updates', 'depot_lng', 'DOUBLE PRECISION'],
        ['live_updates', 'next_stop_duration', 'BIGINT'],
        ['live_updates', 'tour_remaining_duration', 'BIGINT'],
        ['live_updates', 'include_rests', 'BOOLEAN DEFAULT TRUE'],
        ['live_updates', 'next_break_in_seconds', 'BIGINT'],
        ['drivers', 'home_lat', 'DOUBLE PRECISION'],
        ['drivers', 'home_lng', 'DOUBLE PRECISION'],
        ['drivers', 'base_lat', 'DOUBLE PRECISION'],
        ['drivers', 'base_lng', 'DOUBLE PRECISION']
    ];
    for (const [t, c, type] of cols) {
        if (t === 'stops' && c === 'items') console.log('[SCHEMA] checking stops.items');
        const check = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [t, c]);
        if (check.rows.length === 0) {
            if (t === 'stops' && c === 'items') console.log('[SCHEMA] adding items column');
            await pool.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
        }
    }
    const verifyItems = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='stops' AND column_name='items'");
    if (verifyItems.rows.length === 0) throw new Error("FATAL: Schema migration failed - column 'items' still does not exist in table 'stops'.");
    console.log('[SCHEMA] items column exists');
    const constraints = [['work_times', 'unique_worktime', 'UNIQUE (driver_name, start_time)'], ['costs', 'unique_cost', 'UNIQUE (driver_name, timestamp, amount)'], ['hotels', 'unique_hotel', 'UNIQUE (driver_name, timestamp, name)']];
    for (const [t, name, def] of constraints) {
        try {
            const check = await pool.query("SELECT conname FROM pg_constraint WHERE conname = $1", [name]);
            if (check.rows.length === 0) {
                console.log(`[SCHEMA] adding constraint ${name} to ${t}`);
                await pool.query(`ALTER TABLE ${t} ADD CONSTRAINT ${name} ${def}`);
            }
        } catch (e) { console.error(`[SCHEMA] Skip constraint ${name}:`, e.message); }
    }
    console.log('[STARTUP] initDb finished');
};

app.get('/health', (req, res) => res.sendStatus(200));

app.post('/api/live-update', async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Determine Status & OSRM Data
        const resObj = await StatusEngine.updateStatus(client, d);

        // 2. Save Live Update
        const prevRes = await client.query('SELECT status, license_plate FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [d.driverName]);
        const prevPlate = prevRes.rows.length > 0 ? prevRes.rows[0].license_plate : 'N/A';

        let currentPlate = d.licensePlate;
        if ((!currentPlate || currentPlate === 'N/A') && prevPlate && prevPlate !== 'N/A') {
            currentPlate = prevPlate;
        }

        const sql = 'INSERT INTO live_updates (uuid, driver_name, driver_photo, driver_phone, driver_email, license_plate, latitude, longitude, speed, status, current_tour, next_stop, next_lat, next_lng, next_stop_dist, next_stop_duration, tour_remaining_dist, tour_remaining_duration, depot_name, depot_lat, depot_lng, timestamp, include_rests, next_break_in_seconds) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)';

        await client.query(sql, [
            d.uuid || null,
            d.driverName,
            d.driverPhoto,
            d.driverPhone,
            d.driverEmail,
            currentPlate,
            d.latitude,
            d.longitude,
            d.speed,
            resObj.status,
            resObj.currentTourName || d.currentTour,
            resObj.nextStopInfo || d.nextStop,
            d.nextLat,
            d.nextLng,
            resObj.nextStopDist || d.nextStopDistance,
            Math.round(resObj.nextStopDur || d.nextStopDuration || 0),
            resObj.tourRemainingDist || d.tourRemainingDistance,
            Math.round(resObj.tourRemainingDur || d.tourRemainingDuration || 0),
            d.depotName,
            d.depotLat,
            d.depotLng,
            d.timestamp,
            d.includeRests ?? true,
            d.nextBreakInSeconds ? Math.round(d.nextBreakInSeconds) : null
        ]);

        await client.query('COMMIT');

        // 3. Return result to app
        res.json({ status: resObj.status, licensePlate: currentPlate });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[TRACE-LIVE] Error: ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.get('/api/get-history/:driverName/:date', async (req, res) => {
    try {
        const { driverName, date } = req.params;
        const startOfDay = new Date(date).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
        const result = await pool.query(
            'SELECT latitude, longitude, speed, timestamp FROM live_updates WHERE driver_name = $1 AND timestamp >= $2 AND timestamp < $3 ORDER BY timestamp ASC',
            [driverName, startOfDay, endOfDay]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/send-chat', async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5)', [uuid || null, driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

app.get('/api/get-chat/:driverName', async (req, res) => {
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [req.params.driverName]);
    res.json(result.rows.map(r => ({ uuid: r.uuid, driverName: req.params.driverName, sender: r.sender || 'RENDSZER', message: r.message || '', timestamp: Number(r.timestamp) || Date.now() })));
});

app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) await pool.query(`INSERT INTO work_times (uuid, driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (driver_name, start_time) DO UPDATE SET end_time = EXCLUDED.end_time, end_mileage = EXCLUDED.end_mileage, notes = EXCLUDED.notes`, [wt.uuid || null, wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
    res.sendStatus(200);
});

app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) await pool.query('INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (driver_name, timestamp, amount) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes', [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.timestamp]);
    res.sendStatus(200);
});

app.post('/api/set-current-tour', async (req, res) => {
    const { driverName, tourUuid } = req.body;
    console.log(`[TRACE-TOUR] Endpoint: /api/set-current-tour | Driver: ${driverName} | TourUUID: ${tourUuid}`);
    try {
        await pool.query('SELECT set_current_tour($1, $2)', [driverName, tourUuid]);
        res.sendStatus(200);
    } catch (e) {
        console.error(`[TRACE-TOUR] Error in set-current-tour: ${e.message}`);
        res.status(500).send(e.message);
    }
});

app.post('/api/sync-tours/:driverName', async (req, res) => {
    const driverName = req.params.driverName;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of (req.body || [])) {
            if (!item.tour) continue;
            if (item.tour.deletedAt && item.tour.uuid) {
                const now = Date.now();
                await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id IN (SELECT id FROM tours WHERE uuid::text = $2 AND driver_name = $3)', [now, item.tour.uuid, driverName]);
                await client.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE uuid::text = $2 AND driver_name = $3', [now, item.tour.uuid, driverName]);
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
                tour: { ...tour, date: Number(tour.date), deletedAt: tour.deleted_at ? Number(tour.deleted_at) : null, updatedAt: tour.updated_at ? Number(tour.updated_at) : null, depotLatitude: tour.depot_lat, depotLongitude: tour.depot_lng },
                stops: stopsRes.rows.map(s => ({ ...s, latitude: s.latitude, longitude: s.longitude, isCompleted: !!s.is_completed, stopType: s.stop_type, arrivalTime: s.arrival_time ? Number(s.arrival_time) : null, updatedAt: s.updated_at ? Number(s.updated_at) : null }))
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
        const tourRes = await client.query('SELECT uuid, is_current FROM tours WHERE id = $1', [tourId]);
        if (tourRes.rows.length === 0) throw new Error('Tour not found');
        const { uuid, is_current } = tourRes.rows[0];

        await client.query('UPDATE tours SET driver_name = $1, updated_at = $2 WHERE id = $3', [newDriverName, Date.now(), tourId]);

        if (is_current) {
            await client.query('SELECT set_current_tour($1, $2)', [newDriverName, uuid]);
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/admin/delete-tour', async (req, res) => {
    const now = Date.now();
    await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2', [now, req.body.id]);
    await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, req.body.id]);
    res.json({ success: true });
});

app.get('/api/live-status/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const update = (await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name])).rows[0] || {};

        const today = new Date().toISOString().split('T')[0];
        const work = (await pool.query('SELECT * FROM work_times WHERE driver_name = $1 AND date = $2', [name, today])).rows;
        const drivingTodaySec = work
            .filter(w => w.type === 'Vezetés')
            .reduce((sum, w) => sum + (Number(w.end_time || Date.now()) - Number(w.start_time)) / 1000, 0);

        res.json({ ...update, drivingTodaySec });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/fleet-status', async (req, res) => {
    try {
        const drivers = await pool.query(`SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp FROM (SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates UNION ALL SELECT driver_name, NULL as driver_photo, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp FROM tours WHERE deleted_at IS NULL) AS all_drivers ORDER BY driver_name, timestamp DESC`);
        res.json(drivers.rows);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/', async (req, res) => {
    try {
        const drivers = await pool.query(`SELECT DISTINCT ON (driver_name) driver_name, driver_photo, status, license_plate, timestamp FROM (SELECT driver_name, driver_photo, status, license_plate, timestamp::BIGINT FROM live_updates UNION ALL SELECT driver_name, NULL as driver_photo, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp FROM tours WHERE deleted_at IS NULL) AS all_drivers ORDER BY driver_name, timestamp DESC`);
        let list = drivers.rows.map(d => `<div class="card" onclick="location.href='/driver/${encodeURIComponent(d.driver_name)}'"><img src="${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right;background:#444"><h3>${d.driver_name}</h3><p>${d.status} ${d.license_plate ? '| ' + d.license_plate : ''}</p></div>`).join('');
        res.send(`<html><head><title>Driver ERP</title><style>body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; } .card:hover { transform: scale(1.02); background: #444; }</style></head><body><h1>🚛 Flotta kiválasztása</h1><div class="grid" id="driver-grid">${list}</div>
        <script>
            async function refreshFleet() {
                try {
                    const r = await fetch('/api/fleet-status');
                    if (!r.ok) return;
                    const drivers = await r.json();
                    document.getElementById('driver-grid').innerHTML = drivers.map(d => \`
                        <div class="card" onclick="location.href='/driver/\${encodeURIComponent(d.driver_name)}'">
                            <img src="\${d.driver_photo || ''}" style="width:50px;height:50px;border-radius:50%;float:right;background:#444">
                            <h3>\${d.driver_name}</h3>
                            <p>\${d.status} \${d.license_plate ? '| ' + d.license_plate : ''}</p>
                        </div>\`).join('');
                } catch (e) { console.error('Fleet refresh error:', e); }
            }
            setInterval(refreshFleet, 5000);
        </script>
        </body></html>`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const allD = (await pool.query('SELECT DISTINCT driver_name FROM (SELECT driver_name FROM live_updates UNION SELECT driver_name FROM tours) as d')).rows.map(r => r.driver_name).filter(n => n && n !== name);
    const update = (await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name])).rows[0] || { driver_name: name };
    const costs = (await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name])).rows;
    const chat = (await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name])).rows;
    const work = (await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name])).rows;
    const toursRes = (await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [name])).rows;
    const hotelsRes = (await pool.query(`SELECT name::TEXT, address::TEXT, timestamp::BIGINT FROM hotels WHERE driver_name = $1 UNION ALL SELECT COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1) AND stop_type = 'HOTEL' ORDER BY timestamp DESC`, [name])).rows;
    for (let t of toursRes) t.stops = (await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [t.id])).rows;
    const currentTourObj = toursRes.find(t => t.is_current);
    const currentStopsJson = JSON.stringify(currentTourObj ? currentTourObj.stops : []);

    const drivingTodaySec = work
        .filter(w => w.type === 'Vezetés' && w.date === new Date().toISOString().split('T')[0])
        .reduce((sum, w) => sum + (Number(w.end_time || Date.now()) - Number(w.start_time)) / 1000, 0);

    const html = `<html><head><title>ERP - ${name}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
        #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
        .toast { background: #2ecc71; color: white; padding: 12px 24px; border-radius: 8px; margin-top: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideIn 0.3s, fadeOut 0.5s 2.5s forwards; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    </style></head>
    <body>
        <div id="toast-container"></div>
        <header><button onclick="location.href='/'">⬅</button><img src="${update.driver_photo || ''}" style="width:40px;height:40px;border-radius:50%;margin-left:15px;margin-right:15px;"><h2><span>${name}</span> - ERP</h2></header>
        <nav><button data-tab="dashboard" onclick="openTab(event, 'dashboard')">DASHBOARD</button><button data-tab="tours" onclick="openTab(event, 'tours')">TÚRÁK</button><button data-tab="history" onclick="openTab(event, 'history')">TÖRTÉNET</button><button data-tab="costs" onclick="openTab(event, 'costs')">KÖLTSÉGEK</button><button data-tab="hotels" onclick="openTab(event, 'hotels')">HOTELEK</button><button data-tab="chat" onclick="openTab(event, 'chat')">CHAT</button><button data-tab="stats" onclick="openTab(event, 'stats')">STATISZTIKA</button><button data-tab="report" onclick="openTab(event, 'report')">MENETLEVÉL</button><button data-tab="profile" onclick="openTab(event, 'profile')">PROFIL</button></nav>
        <div id="dashboard" class="tab-content">
            <div style="display:grid; grid-template-columns: 1fr 300px; gap: 20px;">
                <div id="map"></div>
                <div style="background:#222; padding:20px; border-radius:8px;">
                    <h3>Státusz: <span id="live-status" style="color:#3498db">${update.status}</span></h3>
                    <p id="live-speed">🚗 Sebesség: ${Math.round(update.speed || 0)} km/h</p>
                    <p id="live-license">🚚 Rendszám: ${update.license_plate || 'N/A'}</p>
                    <hr style="border-color:#444">

                    <div id="live-tour-container" style="${update.current_tour ? '' : 'display:none'}">
                        <div style="background:#333; padding:15px; border-radius:8px; margin-top:10px;">
                            <h4 style="margin:0; color:#2ecc71;">📦 Aktuális túra: <span id="live-tour-name">${update.current_tour || ''}</span></h4>
                            <div style="display:flex; justify-content:space-between; margin-top:10px;">
                                <div style="text-align:center; flex:1;">
                                    <div style="font-size:11px; color:#aaa; text-transform:uppercase;">Következőig</div>
                                    <div id="live-next-dist" style="font-size:18px; font-weight:bold; color:#3498db;">${update.next_stop_dist ? update.next_stop_dist.toFixed(1) + ' km' : 'N/A'}</div>
                                    <div style="font-size:11px; color:#3498db;" id="nextStopDurationDisplay"></div>
                                </div>
                                <div style="width:1px; background:#444;"></div>
                                <div style="text-align:center; flex:1;">
                                    <div style="font-size:11px; color:#aaa; text-transform:uppercase;">Túra összesen</div>
                                    <div id="live-tour-dist" style="font-size:18px; font-weight:bold; color:#2ecc71;">${update.tour_remaining_dist ? update.tour_remaining_dist.toFixed(1) + ' km' : 'N/A'}</div>
                                    <div style="font-size:11px; color:#2ecc71;" id="tourDurationDisplay"></div>
                                </div>
                            </div>
                            <div id="live-break-container" style="margin-top:10px; font-size:11px; color:#e74c3c; text-align:center; border-top:1px solid #444; padding-top:5px; ${update.next_break_in_seconds ? '' : 'display:none'}">
                                ⚠️ Következő pihenő kb. <span id="nextBreakDisplay"></span> múlva
                            </div>
                        </div>
                    </div>
                    <p id="no-tour-msg" style="color:#777; ${update.current_tour ? 'display:none' : ''}">Nincs aktív túra</p>

                    <div id="live-next-stop-container" style="background:#34495e; padding:15px; border-radius:8px; margin-top:10px; ${update.next_stop ? '' : 'display:none'}">
                        <h4 style="margin:0; color:#3498db;">📍 Következő cím:</h4>
                        <div id="live-next-stop-details">
                            ${update.next_stop ? (update.next_stop.includes(' | ') ? `
                                <b style="display:block; margin-top:5px; color:#fff;">${update.next_stop.split(' | ')[0]}</b>
                                <p style="margin:2px 0; font-size:13px; color:#ccc;">${update.next_stop.split(' | ')[1]}</p>
                            ` : `<p style="margin:5px 0; font-size:14px;">${update.next_stop}</p>`) : ''}
                        </div>
                    </div>

                    ${update.depot_name ? `
                        <p style="margin-top:20px; font-size:12px; color:#999;">🏠 Depó: ${update.depot_name}</p>
                    ` : ''}
                </div>
            </div>
        </div>
        <div id="tours" class="tab-content">
            <button onclick="editTour()" style="background:#2ecc71; color:white; padding:10px; margin-bottom:20px;">+ Új túra</button>
            <div id="tours-list">
                ${toursRes.map(t => `
                    <div class="tour-card">
                        <div style="float:right; display:flex; gap:5px;">
                            <select onchange="transferTour(${t.id}, this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>${allD.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
                            <button onclick='editTour(${JSON.stringify(t).replace(/'/g, "&apos;")})'>✏</button>
                            <button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button>
                        </div>
                        <b>${t.name}</b> (${t.customer}) - ${new Date(Number(t.date)).toLocaleDateString()}
                        ${t.stops.map(s => `<div class="stop-item">${s.order_index + 1}. ${s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')}${s.address}</div>`).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
        <div id="history" class="tab-content">
            <div style="display:flex; gap:10px; margin-bottom:20px; align-items:center;">
                <label style="color:white; font-size:14px;">Dátum választása:</label>
                <input type="date" id="history-date" style="width:200px;" onchange="loadHistory()">
                <button onclick="loadHistory()" style="background:#3498db; color:white; padding:8px 20px;">BETÖLTÉS</button>
            </div>
            <div style="display:grid; grid-template-columns: 1fr; gap:20px;">
                <div id="history-map" style="height:400px; border-radius:8px;"></div>
                <div style="background:#222; padding:15px; border-radius:8px;">
                    <h3>Sebesség grafikon (km/h)</h3>
                    <canvas id="speedChart"></canvas>
                </div>
            </div>
        </div>
        <div id="costs" class="tab-content"><table><tr><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th></tr>${costs.map(c => `<tr><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${c.category}</td><td>${c.amount} ${c.currency}</td><td>${c.status}</td></tr>`).join('')}</table></div>
        <div id="hotels" class="tab-content"><table><tr><th>Dátum</th><th>Név</th><th>Cím</th></tr>${hotelsRes.map(h => `<tr><td>${new Date(Number(h.timestamp)).toLocaleDateString()}</td><td>${h.name}</td><td>${h.address}</td></tr>`).join('')}</table></div>
        <div id="chat" class="tab-content">
            <div id="chat-messages" style="height:400px; background:#111; padding:15px; overflow-y:auto; display:flex; flex-direction:column; margin-bottom:15px;">
                ${chat.map(m => `<div class="msg ${m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver'}"><b>${m.sender}:</b><br>${m.message}</div>`).join('')}
            </div>
            <div style="display:flex; gap:10px;">
                <input type="text" id="chat-input" placeholder="Üzenet írása..." onkeypress="if(event.key==='Enter') sendChat()">
                <button onclick="sendChat()" style="width:100px; background:#F57F17; color:black; font-weight:bold;">KÜLDÉS</button>
            </div>
        </div>
        <div id="stats" class="tab-content"><div id="statsBox"></div></div>
        <div id="report" class="tab-content"><h3>Tagesfahrblatt</h3><div id="timelineContainer"></div></div>
        <div id="profile" class="tab-content"><h3>PROFIL</h3><p>Név: ${name}</p></div>

        <div id="tourModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; padding:50px;">
            <div style="background:#222; padding:30px; border-radius:12px; max-width:800px; margin:auto; max-height:90vh; overflow-y:auto;">
                <h2>Túra szerkesztése</h2><input type="hidden" id="tourId"><input type="hidden" id="tourUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                    <div><label>Túra neve</label><input type="text" id="tName"></div><div><label>Megrendelő</label><input type="text" id="tCustomer"></div>
                    <div><label>Dátum</label><input type="date" id="tDate"></div>
                    <div style="display:flex; align-items:center; gap:10px; margin-top:20px;">
                        <input type="checkbox" id="tIsCurrent" style="width:20px; height:20px;">
                        <label for="tIsCurrent" style="font-size:14px; color:white;">Aktuális túra (Appban ez jelenik meg)</label>
                    </div>
                </div>
                <label>Megjegyzések</label><textarea id="tNotes" style="height:60px; margin-bottom:20px;"></textarea>
                <h3>Depó</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"><input type="text" id="tDepotName" placeholder="Név"><input type="text" id="tDepotCompany" placeholder="Cég"></div>
                <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:10px;"><input type="text" id="tDepotStreet" placeholder="Utca"><input type="text" id="tDepotHouse" placeholder="Házszám"></div>
                <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:10px;"><input type="text" id="tDepotPostal" placeholder="Irsz"><input type="text" id="tDepotCity" placeholder="Város"></div>
                <h3>Megállók</h3><div id="modalStops"></div><button onclick="addStopRow()">+ Megálló</button>
                <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;"><button onclick="closeModal()">Mégse</button><button onclick="saveTour()" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button></div>
            </div>
        </div>

        <script>
            function openTab(e, t) {
                localStorage.setItem('activeTab_${name}', t);
                document.querySelectorAll('.tab-content').forEach(x => x.style.display = 'none');
                document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
                const target = document.getElementById(t);
                if (target) {
                    target.style.display = 'block';
                    const btn = e ? e.currentTarget : document.querySelector('nav button[data-tab="' + t + '"]');
                    if (btn) btn.classList.add('active');
                    if (t === 'dashboard' && typeof map !== 'undefined') {
                        setTimeout(() => map.invalidateSize(), 100);
                    }
                    if (t === 'history') {
                        setTimeout(() => {
                            if (historyMap) historyMap.invalidateSize();
                            else initHistoryMap();
                        }, 100);
                    }
                }
            }

            // History Logic
            let historyMap = null;
            let historyRouteLayer = null;
            let speedChart = null;

            function initHistoryMap() {
                if (historyMap) return;
                historyMap = L.map('history-map').setView([47.4979, 19.0402], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap'
                }).addTo(historyMap);
            }

            async function loadHistory() {
                const date = document.getElementById('history-date').value;
                if (!date) return;
                initHistoryMap();
                try {
                    const r = await fetch('/api/get-history/' + encodeURIComponent('${name}') + '/' + date);
                    const data = await r.json();
                    if (!data || data.length === 0) {
                        showToast('Nincs adat ehhez a naphoz.');
                        if (historyRouteLayer) historyMap.removeLayer(historyRouteLayer);
                        if (speedChart) speedChart.destroy();
                        return;
                    }

                    // Map Route
                    const points = data.filter(d => d.latitude && d.longitude).map(d => [d.latitude, d.longitude]);
                    if (historyRouteLayer) historyMap.removeLayer(historyRouteLayer);
                    if (points.length > 0) {
                        historyRouteLayer = L.polyline(points, { color: '#e74c3c', weight: 4 }).addTo(historyMap);
                        historyMap.fitBounds(historyRouteLayer.getBounds(), { padding: [30, 30] });
                    }

                    // Speed Chart
                    const labels = data.map(d => new Date(Number(d.timestamp)).toLocaleTimeString());
                    const speeds = data.map(d => Math.round(d.speed || 0));

                    if (speedChart) speedChart.destroy();
                    const ctx = document.getElementById('speedChart').getContext('2d');
                    speedChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{
                                label: 'Sebesség',
                                data: speeds,
                                borderColor: '#3498db',
                                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: { beginAtZero: true, grid: { color: '#444' }, ticks: { color: '#aaa' } },
                                x: { grid: { display: false }, ticks: { color: '#aaa' } }
                            },
                            plugins: { legend: { display: false } }
                        }
                    });

                } catch (e) { console.error('History error:', e); showToast('Hiba a betöltés során.'); }
            }

            document.getElementById('history-date').value = new Date().toISOString().split('T')[0];

            // Kezdő tab betöltése
            const savedTab = localStorage.getItem('activeTab_${name}') || 'dashboard';

            // Térkép inicializálása
            let DRIVING_DONE_TODAY = ${drivingTodaySec};

            function formatDuration(seconds) {
                if (!seconds || seconds <= 0) return 'N/A';
                let mins = Math.round(seconds / 60);
                let hours = Math.floor(mins / 60);
                mins = mins % 60;
                let days = Math.floor(hours / 24);
                hours = hours % 24;
                if (days > 0) return days + ' nap, ' + hours + ':' + mins.toString().padStart(2, '0');
                return hours + ':' + mins.toString().padStart(2, '0');
            }

            function calculateAdjustedDuration(pureSec, doneSec) {
                if (!pureSec) return 0;
                let total = pureSec;
                let blockSize = 16200; // 4.5h
                let restSize = 2700; // 45m
                let progress = doneSec % blockSize;
                let remaining = blockSize - progress;
                if (pureSec > remaining) {
                    total += restSize;
                    let left = pureSec - remaining;
                    total += Math.floor(left / blockSize) * restSize;
                }
                // Daily limit 9h
                if (doneSec + pureSec > 32400) {
                    total += 39600; // 11h
                }
                return total;
            }

            // Update displays
            let nextDur = ${update.next_stop_duration || 0};
            let tourDur = ${update.tour_remaining_duration || 0};
            let nextBreak = ${update.next_break_in_seconds || 0};
            let isAdjusted = ${update.include_rests ?? true};

            function updateTimeDisplays() {
                try {
                    if (nextDur > 0) {
                        const d = isAdjusted ? nextDur : calculateAdjustedDuration(nextDur, DRIVING_DONE_TODAY);
                        document.getElementById('nextStopDurationDisplay').innerText = formatDuration(d);
                    } else { document.getElementById('nextStopDurationDisplay').innerText = ''; }

                    if (tourDur > 0) {
                        const d = isAdjusted ? tourDur : calculateAdjustedDuration(tourDur, DRIVING_DONE_TODAY);
                        document.getElementById('tourDurationDisplay').innerText = formatDuration(d);
                    } else { document.getElementById('tourDurationDisplay').innerText = ''; }

                    if (nextBreak > 0 && document.getElementById('nextBreakDisplay')) {
                        document.getElementById('nextBreakDisplay').innerText = formatDuration(nextBreak);
                        document.getElementById('live-break-container').style.display = 'block';
                    } else if (document.getElementById('live-break-container')) {
                        document.getElementById('live-break-container').style.display = 'none';
                    }
                } catch(e) { console.error('Time update error:', e); }
            }
            updateTimeDisplays();

            const driverLat = ${update.latitude || 47.4979};
            const driverLng = ${update.longitude || 19.0402};
            const map = L.map('map', { zoomControl: true }).setView([driverLat, driverLng], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(map);

            // Sofőr marker (kék kör fehér szegéllyel)
            const driverMarker = L.circleMarker([driverLat, driverLng], {
                color: '#3498db', radius: 10, fillOpacity: 1, weight: 3, fillColor: '#fff'
            }).addTo(map).bindPopup('<b>${name}</b><br><span id="popup-speed">Sebesség: ${Math.round(update.speed || 0)} km/h</span>');

            let routeLayer = null;
            let lastNextLat = ${update.next_lat || 0};
            let lastNextLng = ${update.next_lng || 0};

            async function drawRoute(currentLat, currentLng, stops, depotLat, depotLng) {
                const incompleteStops = (stops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
                let waypointStr = currentLng + ',' + currentLat;

                incompleteStops.forEach(s => {
                    waypointStr += ';' + s.longitude + ',' + s.latitude;
                });

                if (depotLat) {
                    waypointStr += ';' + depotLng + ',' + depotLat;
                }

                if (waypointStr.includes(';')) {
                    try {
                        const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson');
                        const data = await r.json();
                        if (data.routes && data.routes[0]) {
                            if (routeLayer) map.removeLayer(routeLayer);
                            routeLayer = L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.7 } }).addTo(map);
                        }
                    } catch (e) { console.error('Route error:', e); }
                }
            }

            // Kezdeti útvonal
            const rawStops = ${currentStopsJson};
            if (rawStops && rawStops.length > 0) {
                drawRoute(driverLat, driverLng, rawStops, ${update.depot_lat || 0}, ${update.depot_lng || 0});
            }

            async function refreshLiveStatus() {
                try {
                    const r = await fetch('/api/live-status/' + encodeURIComponent('${name}'));
                    if (!r.ok) return;
                    const d = await r.json();
                    if (!d.timestamp) return;

                    // Update UI text
                    document.getElementById('live-status').innerText = d.status || 'N/A';
                    document.getElementById('live-speed').innerText = '🚗 Sebesség: ' + Math.round(d.speed || 0) + ' km/h';
                    document.getElementById('live-license').innerText = '🚚 Rendszám: ' + (d.license_plate || 'N/A');
                    const popupSpeed = document.getElementById('popup-speed');
                    if (popupSpeed) popupSpeed.innerText = 'Sebesség: ' + Math.round(d.speed || 0) + ' km/h';

                    if (d.current_tour) {
                        document.getElementById('live-tour-container').style.display = 'block';
                        document.getElementById('no-tour-msg').style.display = 'none';
                        document.getElementById('live-tour-name').innerText = d.current_tour;
                        document.getElementById('live-next-dist').innerText = d.next_stop_dist ? d.next_stop_dist.toFixed(1) + ' km' : 'N/A';
                        document.getElementById('live-tour-dist').innerText = d.tour_remaining_dist ? d.tour_remaining_dist.toFixed(1) + ' km' : 'N/A';
                    } else {
                        document.getElementById('live-tour-container').style.display = 'none';
                        document.getElementById('no-tour-msg').style.display = 'block';
                    }

                    if (d.next_stop) {
                        document.getElementById('live-next-stop-container').style.display = 'block';
                        let html = '';
                        if (d.next_stop.includes(' | ')) {
                            html = '<b style="display:block; margin-top:5px; color:#fff;">' + d.next_stop.split(' | ')[0] + '</b>' +
                                   '<p style="margin:2px 0; font-size:13px; color:#ccc;">' + d.next_stop.split(' | ')[1] + '</p>';
                        } else {
                            html = '<p style="margin:5px 0; font-size:14px;">' + d.next_stop + '</p>';
                        }
                        document.getElementById('live-next-stop-details').innerHTML = html;
                    } else {
                        document.getElementById('live-next-stop-container').style.display = 'none';
                    }

                    nextDur = d.next_stop_duration || 0;
                    tourDur = d.tour_remaining_duration || 0;
                    nextBreak = d.next_break_in_seconds || 0;
                    isAdjusted = d.include_rests ?? true;
                    if (d.drivingTodaySec !== undefined) DRIVING_DONE_TODAY = d.drivingTodaySec;
                    updateTimeDisplays();

                    // Update Map
                    if (d.latitude && d.longitude) {
                        const newPos = [d.latitude, d.longitude];
                        driverMarker.setLatLng(newPos);
                        driverMarker.setPopupContent('<b>${name}</b><br>Sebesség: ' + Math.round(d.speed || 0) + ' km/h');

                        // Útvonal frissítése ha a célpont változott
                        if (d.next_lat !== lastNextLat || d.next_lng !== lastNextLng) {
                            lastNextLat = d.next_lat;
                            lastNextLng = d.next_lng;
                            refreshTours();
                            fetch('/api/get-tours/' + encodeURIComponent('${name}'))
                                .then(r => r.json())
                                .then(data => {
                                    const stops = data.length > 0 ? data[0].stops : [];
                                    drawRoute(d.latitude, d.longitude, stops, d.depot_lat, d.depot_lng);
                                });
                        }
                    }
                } catch (e) { console.error('Refresh error:', e); }
            }

            setInterval(refreshLiveStatus, 5000);

            // Ha a dashboardon vagyunk, 5 másodpercenként oldalfrissítés (felhasználói kérésre)
            setInterval(() => {
                if (localStorage.getItem('activeTab_${name}') === 'dashboard') {
                    // location.reload(); // Ezt egyelőre kommentben hagyom, mert a refreshLiveStatus-nak kéne működnie
                }
            }, 5000);

            // Túra állomások
            const bounds = L.latLngBounds([driverLat, driverLng]);

            if (rawStops) {
                rawStops.forEach(s => {
                    if (s.latitude && s.longitude) {
                        const icon = L.divIcon({
                            className: 'custom-div-icon',
                            html: "<div style='background-color:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid white;'>" + (s.order_index + 1) + "</div>",
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([s.latitude, s.longitude], { icon: icon }).addTo(map)
                            .bindPopup((s.order_index + 1) + '. ' + (s.recipient || s.address_full || s.address));
                        bounds.extend([s.latitude, s.longitude]);
                    }
                });
            }

            // Depó marker
            if (${update.depot_lat ? 'true' : 'false'}) {
                const depotIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: "<div style='background-color:#2ecc71; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid white;'>🏠</div>",
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                L.marker([${update.depot_lat || 0}, ${update.depot_lng || 0}], { icon: depotIcon }).addTo(map).bindPopup('🏠 Depó: ${update.depot_name}');
                bounds.extend([${update.depot_lat || 0}, ${update.depot_lng || 0}]);
            }

            // Térkép igazítása
            if ((rawStops && rawStops.length > 0) || ${update.depot_lat ? 'true' : 'false'}) {
                const center = [driverLat, driverLng];
                let maxDLat = 0;
                let maxDLng = 0;

                if (rawStops) {
                    rawStops.forEach(s => {
                        if (s.latitude && s.longitude) {
                            maxDLat = Math.max(maxDLat, Math.abs(s.latitude - driverLat));
                            maxDLng = Math.max(maxDLng, Math.abs(s.longitude - driverLng));
                        }
                    });
                }

                if (${update.depot_lat ? 'true' : 'false'}) {
                    maxDLat = Math.max(maxDLat, Math.abs(${update.depot_lat || 0} - driverLat));
                    maxDLng = Math.max(maxDLng, Math.abs(${update.depot_lng || 0} - driverLng));
                }

                const fitBounds = [
                    [driverLat - maxDLat * 1.1 - 0.002, driverLng - maxDLng * 1.1 - 0.002],
                    [driverLat + maxDLat * 1.1 + 0.002, driverLng + maxDLng * 1.1 + 0.002]
                ];
                map.fitBounds(fitBounds, { padding: [50, 50], maxZoom: 15 });
            }

            // Útvonal tervezése a teljes hátralévő túrára
            const incompleteStops = (rawStops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
            let waypointStr = driverLng + ',' + driverLat;

            incompleteStops.forEach(s => {
                waypointStr += ';' + s.longitude + ',' + s.latitude;
            });

            if (${update.depot_lat ? 'true' : 'false'}) {
                waypointStr += ';' + ${update.depot_lng || 0} + ',' + ${update.depot_lat || 0};
            }

            if (waypointStr.includes(';')) {
                fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson')
                    .then(r => r.json())
                    .then(data => {
                        if (data.routes && data.routes[0]) {
                            L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.7 } }).addTo(map);
                        }
                    });
            }

            // Kényszerített újrarajzolás a méretezési hiba ellen
            setTimeout(() => {
                map.invalidateSize();
                if ((rawStops && rawStops.length > 0) || ${update.depot_lat ? 'true' : 'false'}) {
                     try { map.fitBounds(map.getBounds(), { padding: [50, 50] }); } catch(e) {}
                }
            }, 800);

            // Periodikus térkép frissítés a szétesés ellen
            setInterval(() => {
                if (document.getElementById('dashboard').style.display !== 'none') {
                    map.invalidateSize();
                }
            }, 10000);

            // Végül nyissuk meg az elmentett fület
            openTab(null, savedTab);

            // Alapértelmezett tab
            // Eltávolítva az openTab hívás, mert feljebb már megoldottuk a localStorage-al

            function showToast(msg) {
                const c = document.getElementById('toast-container');
                const t = document.createElement('div');
                t.className = 'toast';
                t.innerText = msg;
                c.appendChild(t);
                setTimeout(() => t.remove(), 3000);
            }

            async function refreshTours() {
                try {
                    const r = await fetch('/api/get-tours/' + encodeURIComponent('${name}'));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('tours-list');
                    if (!container) return;

                    const allDNames = ${JSON.stringify(allD)};

                    container.innerHTML = data.map(item => {
                        const t = item.tour;
                        const stops = item.stops;
                        return \`
                        <div class="tour-card">
                            <div style="float:right; display:flex; gap:5px;">
                                <select onchange="transferTour(\${t.id}, this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>\${allDNames.map(n => "<option value='" + n + "'>" + n + "</option>").join('')}</select>
                                <button onclick='editTour(\${JSON.stringify(t).replace(/'/g, "&apos;")})'>✏</button>
                                <button onclick="deleteTour(\${t.id})" style="background:#e74c3c; color:white;">🗑</button>
                            </div>
                            <b>\${t.name}</b> (\${t.customer}) - \${new Date(Number(t.date)).toLocaleDateString()}
                            \${stops.map(s => "<div class='stop-item'>" + (s.order_index + 1) + ". " + (s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')) + s.address + "</div>").join('')}
                        </div>\`;
                    }).join('');
                } catch (e) { console.error('Refresh tours error:', e); }
            }

            async function sendChat() {
                const input = document.getElementById('chat-input');
                const msg = input.value.trim();
                if (!msg) return;
                try {
                    const res = await fetch('/api/send-chat', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            driverName: '${name}',
                            sender: 'DISZPÉCSER',
                            message: msg,
                            timestamp: Date.now()
                        })
                    });
                    if (res.ok) {
                        input.value = '';
                        refreshChat();
                    }
                } catch (e) { console.error('Chat error:', e); }
            }

            async function refreshChat() {
                try {
                    const r = await fetch('/api/get-chat/' + encodeURIComponent('${name}'));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('chat-messages');
                    if (!container) return;
                    container.innerHTML = data.map(m => \`
                        <div class="msg \${m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver'}">
                            <b>\${m.sender}:</b><br>\${m.message}
                        </div>\`).join('');
                    container.scrollTop = container.scrollHeight;
                } catch (e) { console.error('Refresh chat error:', e); }
            }

            setInterval(refreshChat, 3000);

            function transferTour(tourId, newDriverName) { if (!newDriverName) return; if (confirm('Áthelyezed ' + newDriverName + ' részére?')) fetch('/admin/transfer-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tourId, newDriverName }) }).then(r => { if(r.ok) { showToast('Túra sikeresen áthelyezve!'); refreshTours(); } }); }
            function deleteTour(id) { if(confirm('Törlöd?')) fetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }).then(r => { if(r.ok) { showToast('Túra törölve!'); refreshTours(); } }); }
            function closeModal() { document.getElementById('tourModal').style.display = 'none'; }
            function editTour(t) {
                document.getElementById('tourId').value = t ? t.id : '';
                document.getElementById('tourUuid').value = t ? t.uuid : '';
                document.getElementById('tName').value = t ? t.name : '';
                document.getElementById('tCustomer').value = t ? t.customer : '';
                document.getElementById('tDate').value = t ? new Date(Number(t.date)).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                document.getElementById('tIsCurrent').checked = t ? !!t.is_current : true;
                document.getElementById('tNotes').value = t ? t.notes : '';
                document.getElementById('tDepotName').value = t ? (t.depot_name || '') : '';
                document.getElementById('tDepotCompany').value = t ? (t.depot_company || '') : '';
                document.getElementById('tDepotStreet').value = t ? (t.depot_street || '') : '';
                document.getElementById('tDepotHouse').value = t ? (t.depot_house_number || '') : '';
                document.getElementById('tDepotPostal').value = t ? (t.depot_postal_code || '') : '';
                document.getElementById('tDepotCity').value = t ? (t.depot_city || '') : '';

                // Koordináták megőrzése
                const modal = document.getElementById('tourModal');
                modal.dataset.lat = t ? (t.depot_lat || '') : '';
                modal.dataset.lng = t ? (t.depot_lng || '') : '';

                document.getElementById('modalStops').innerHTML = '';
                if(t && t.stops) t.stops.forEach(s => addStopRow(s)); else addStopRow(null);
                document.getElementById('tourModal').style.display = 'block';
            }
            function addStopRow(s) {
                const d = document.createElement('div'); d.className = 'stop-edit-row'; d.style = 'border:1px solid #444; padding:15px; margin-bottom:15px; border-radius:8px; position:relative;';
                const uuid = s ? s.uuid : (window.crypto && crypto.randomUUID ? crypto.randomUUID() : null);
                const items = s && s.items ? (Array.isArray(s.items) ? s.items : [s.items]) : [{ recipient: s ? s.recipient : '', notes: s ? s.notes : '', stop_type: s ? s.stop_type : 'DELIVERY' }];

                d.dataset.lat = s ? (s.latitude || '') : '';
                d.dataset.lng = s ? (s.longitude || '') : '';

                d.innerHTML = \`<button onclick="this.parentElement.remove()" style="position:absolute; right:10px; top:10px; background:#e74c3c; border:none; color:white; padding:5px 10px; border-radius:4px; cursor:pointer;">X</button>
                    <input type="hidden" class="stop-uuid" value="\${uuid || ''}">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div><label>Címzett</label><input type="text" class="stop-recipient" value="\${items[0].recipient || ''}"></div>
                        <div><label>Cég</label><input type="text" class="stop-company" value="\${s ? (s.company || '') : ''}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:5px;">
                        <div><label>Utca</label><input type="text" class="stop-street" value="\${s ? (s.street || '') : ''}"></div>
                        <div><label>Házszám</label><input type="text" class="stop-house" value="\${s ? (s.house_number || '') : ''}"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:5px;">
                        <div><label>Irsz</label><input type="text" class="stop-postal" value="\${s ? (s.postal_code || '') : ''}"></div>
                        <div><label>Város</label><input type="text" class="stop-city" value="\${s ? (s.city || '') : ''}"></div>
                    </div>
                    <div style="margin-top:10px;"><label>Típus</label><select class="stop-type"><option value="DELIVERY" \${items[0].stop_type==='DELIVERY'?'selected':''}>DELIVERY</option><option value="PICKUP" \${items[0].stop_type==='PICKUP'?'selected':''}>PICKUP</option><option value="HOTEL" \${items[0].stop_type==='HOTEL'?'selected':''}>HOTEL</option></select></div>\`;
                document.getElementById('modalStops').appendChild(d);
            }
            async function geocode(street, house, postal, city) {
                const q = (street + ' ' + house + ', ' + postal + ' ' + city).trim();
                if (q.length < 5) return null;
                try {
                    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q) + '&limit=1');
                    const d = await r.json();
                    return d && d.length > 0 ? { lat: d[0].lat, lon: d[0].lon } : null;
                } catch (e) { return null; }
            }

            async function saveTour() {
                const btn = event.target;
                const oldText = btn.innerText;
                btn.innerText = 'Mentés... (Geocoding)';
                btn.disabled = true;

                const modal = document.getElementById('tourModal');
                // Depó koordináták ha hiányzik
                if (!modal.dataset.lat || modal.dataset.lat === "") {
                    const c = await geocode(document.getElementById('tDepotStreet').value, document.getElementById('tDepotHouse').value, document.getElementById('tDepotPostal').value, document.getElementById('tDepotCity').value);
                    if (c) { modal.dataset.lat = c.lat; modal.dataset.lng = c.lon; }
                }

                const stops = [];
                const rows = document.querySelectorAll('.stop-edit-row');
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    const u = r.querySelector('.stop-uuid').value;

                    if (!r.dataset.lat || r.dataset.lat === "") {
                        const c = await geocode(r.querySelector('.stop-street').value, r.querySelector('.stop-house').value, r.querySelector('.stop-postal').value, r.querySelector('.stop-city').value);
                        if (c) { r.dataset.lat = c.lat; r.dataset.lng = c.lon; }
                    }

                    stops.push({
                        uuid: u === "" ? null : u,
                        recipient: r.querySelector('.stop-recipient').value,
                        company: r.querySelector('.stop-company').value,
                        street: r.querySelector('.stop-street').value,
                        house_number: r.querySelector('.stop-house').value,
                        postal_code: r.querySelector('.stop-postal').value,
                        city: r.querySelector('.stop-city').value,
                        stop_type: r.querySelector('.stop-type').value,
                        order_index: i,
                        latitude: r.dataset.lat ? parseFloat(r.dataset.lat) : null,
                        longitude: r.dataset.lng ? parseFloat(r.dataset.lng) : null
                    });
                }

                const tourId = document.getElementById('tourId').value;
                const uId = document.getElementById('tourUuid').value;
                const tourDate = document.getElementById('tDate').value ? new Date(document.getElementById('tDate').value).getTime() : Date.now();
                const data = {
                    id: tourId === "" ? null : parseInt(tourId),
                    uuid: uId === "" ? null : uId,
                    driver_name: '${name}', name: document.getElementById('tName').value, customer: document.getElementById('tCustomer').value,
                    date: tourDate, is_current: document.getElementById('tIsCurrent').checked, notes: document.getElementById('tNotes').value,
                    depot_name: document.getElementById('tDepotName').value, depot_company: document.getElementById('tDepotCompany').value,
                    depot_street: document.getElementById('tDepotStreet').value, depot_house_number: document.getElementById('tDepotHouse').value,
                    depot_postal_code: document.getElementById('tDepotPostal').value, depot_city: document.getElementById('tDepotCity').value,
                    depot_lat: modal.dataset.lat ? parseFloat(modal.dataset.lat) : null,
                    depot_lng: modal.dataset.lng ? parseFloat(modal.dataset.lng) : null,
                    stops
                };
                const res = await fetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(res.ok) { showToast('Túra mentve!'); closeModal(); refreshTours(); } else { alert('Hiba!'); btn.innerText = oldText; btn.disabled = false; }
            }
        </script>
    </body></html>`;
    res.send(html);
});

const PORT = process.env.PORT || 3000;
const start = async () => {
    try {
        await initDb();
        app.listen(PORT, () => console.log('[STARTUP] Express server starting on port ' + PORT));
    } catch (err) {
        console.error('[STARTUP] Fatal error during initDb:', err);
        process.exit(1);
    }
};
start();
