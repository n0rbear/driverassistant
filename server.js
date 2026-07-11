// FIXED SERVER v17 - TRACE LIVE UPDATES
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));
const fs = require('fs');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const SHORT_REST_GRACE_MS = 3 * 60 * 1000;
const IS_DEPLOYED = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
const requireAdmin = (req, res, next) => {
    if (!ADMIN_TOKEN) {
        if (IS_DEPLOYED) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured.' });
        return next();
    }
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-admin-token'] || req.query.adminToken);
    if (token === ADMIN_TOKEN) return next();
    return res.sendStatus(401);
};

app.get('/tour-import-template.xlsx', (req, res) => {
    res.download(path.join(__dirname, 'DriverAssistant_tura_import_sablon.xlsx'), 'DriverAssistant_tura_import_sablon.xlsx');
});
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const escapeJsString = (value) => String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3C');

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
        const tourRes = await client.query('SELECT id, name, depot_name, depot_lat, depot_lng FROM tours WHERE driver_name = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1', [driverName]);
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
                            const tenMinsAgo = now - (10 * 60 * 1000);
                            const recentUpdatesAtStop = await client.query('SELECT timestamp, latitude, longitude FROM live_updates WHERE driver_name = $1 AND timestamp > $2 ORDER BY timestamp ASC', [driverName, tenMinsAgo]);
                            const stayedNear = recentUpdatesAtStop.rows.some(r => (now - Number(r.timestamp)) > 90000 && this.calculateDistance(r.latitude, r.longitude, stop.latitude, stop.longitude) < 400);
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
        if (d.speed > 8) {
            if (ongoing && String(ongoing.type || '').startsWith('Pihen') && (now - Number(ongoing.start_time)) < SHORT_REST_GRACE_MS) {
                await this.discardShortRest(client, driverName, ongoing);
                calculatedStatus = 'Vezetés';
            } else if (!ongoing || ongoing.type !== 'Vezetés') {
                await this.startWork(client, driverName, 'Vezetés', today, d.licensePlate, null, now);
                calculatedStatus = 'Vezetés';
            }
        } else if (d.speed < 1.5 && ongoing && ongoing.type === 'Vezetés' && !isAtTourStop && !isNearKnownPlace) {
            await this.startWork(client, driverName, 'Pihenő', today, d.licensePlate, ongoing.mileage, now);
            calculatedStatus = 'Pihenő';
        }

        // 4. OSRM Calculations (Moved from App)
        if (currentTour) {
            try {
                // Csak azokat a megállókat vegyük bele, amik még nincsenek kész
                const waypoints = stops
                    .filter(s => !s.is_completed && s.latitude && s.longitude)
                    .map(s => `${s.longitude},${s.latitude}`);

                // Ha van depó (túrához rendelt, app által küldött vagy sofőrhöz rendelt bázis), azt MINDIG adjuk hozzá a végéhez
                const finalDepotLat = currentTour.depot_lat || d.depotLat || dInfo?.base_lat;
                const finalDepotLng = currentTour.depot_lng || d.depotLng || dInfo?.base_lng;

                if (finalDepotLat && finalDepotLng) {
                    waypoints.push(`${finalDepotLng},${finalDepotLat}`);
                }

                if (waypoints.length > 0) {
                    const url = `https://router.project-osrm.org/route/v1/driving/${d.longitude},${d.latitude};${waypoints.join(';')}?overview=false`;
                    const response = await fetch(url);
                    const r = await response.json();

                    if (r.routes && r.routes[0]) {
                         tourRemainingDist = r.routes[0].distance / 1000;
                         tourRemainingDur = Math.round(r.routes[0].duration);

                         // A következő célpont távolsága (lehet megálló vagy depó)
                         if (r.routes[0].legs && r.routes[0].legs[0]) {
                             nextStopDist = r.routes[0].legs[0].distance / 1000;
                             nextStopDur = Math.round(r.routes[0].legs[0].duration);
                         }
                         console.log(`[OSRM] ${driverName} -> Összesen: ${tourRemainingDist.toFixed(1)}km, Következőig: ${nextStopDist?.toFixed(1)}km`);
                    }

                    if (nextStop) {
                        nextStopInfo = `${nextStop.contact_name || nextStop.recipient} | ${nextStop.address}`;
                    } else if (finalDepotLat) {
                        nextStopInfo = `Vissza a depóba | ${currentTour.depot_name || d.depotName || 'Telephely'}`;
                    }
                }
            } catch (e) {
                console.error(`[OSRM-ERROR] ${driverName}: ${e.message}`);
            }
        }

        return {
            status: calculatedStatus,
            nextStopDist,
            nextStopDur,
            tourRemainingDist,
            tourRemainingDur,
            nextStopInfo,
            currentTourName: currentTour?.name,
            depotName: currentTour?.depot_name || d.depotName || (dInfo?.base_lat ? 'Alapértelmezett Depó' : null),
            depotLat: currentTour?.depot_lat || d.depotLat || dInfo?.base_lat,
            depotLng: currentTour?.depot_lng || d.depotLng || dInfo?.base_lng,
            nextLat: nextStop ? nextStop.latitude : (currentTour?.depot_lat || d.depotLat || dInfo?.base_lat || d.nextLat),
            nextLng: nextStop ? nextStop.longitude : (currentTour?.depot_lng || d.depotLng || dInfo?.base_lng || d.nextLng)
        };
    },

    async startWork(client, driverName, type, date, plate, mileage, now) {
        // Close existing
        await client.query('UPDATE work_times SET end_time = $1 WHERE driver_name = $2 AND end_time IS NULL', [now, driverName]);
        // Insert new
        await client.query('INSERT INTO work_times (uuid, driver_name, type, start_time, date, license_plate, mileage) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)',
            [driverName, type, now, date, plate || 'N/A', mileage || 0]);
    },

    async discardShortRest(client, driverName, rest) {
        const restStart = Number(rest.start_time);
        const minPreviousEnd = restStart - (SHORT_REST_GRACE_MS * 3);
        const maxPreviousEnd = restStart + 1000;
        let previousDrivingRes = await client.query(
            `SELECT id FROM work_times
             WHERE driver_name = $1
               AND type LIKE $2
               AND end_time IS NOT NULL
               AND end_time BETWEEN $3 AND $4
             ORDER BY end_time DESC, start_time DESC
             LIMIT 1`,
            [driverName, 'Vezet%', minPreviousEnd, maxPreviousEnd]
        );
        if (!previousDrivingRes.rows[0]) {
            previousDrivingRes = await client.query(
                `SELECT id FROM work_times
                 WHERE driver_name = $1
                   AND type LIKE $2
                   AND end_time IS NOT NULL
                   AND end_time <= $3
                 ORDER BY end_time DESC, start_time DESC
                 LIMIT 1`,
                [driverName, 'Vezet%', restStart]
            );
        }
        if (previousDrivingRes.rows[0]) {
            await client.query('UPDATE work_times SET end_time = NULL, end_mileage = NULL WHERE id = $1', [previousDrivingRes.rows[0].id]);
            await client.query('DELETE FROM work_times WHERE id = $1', [rest.id]);
        } else {
            console.warn(`[STATUS] Short rest discarded for ${driverName}, but previous driving block was not found near ${restStart}`);
            await client.query('UPDATE work_times SET type = $1 WHERE id = $2', ['Vezetés', rest.id]);
        }
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
        const groupedStops = [];

        for (const rawStop of stopsData) {
            const n = AddressEngine.normalize(rawStop);
            const fp = AddressEngine.getFingerprint(n);
            const item = {
                uuid: (rawStop.uuid && String(rawStop.uuid).trim() !== "") ? String(rawStop.uuid) : null,
                recipient: n.recipient, company: n.company, notes: n.notes,
                contact_name: rawStop.contact_name || rawStop.contactName || '',
                phone_number: rawStop.phone_number || rawStop.phoneNumber || '',
                email: rawStop.email || '', time_window: rawStop.time_window || rawStop.timeWindow || '',
                room_number: rawStop.room_number || rawStop.roomNumber || '',
                entry_code: rawStop.entry_code || rawStop.entryCode || '',
                booking_number: rawStop.booking_number || rawStop.bookingNumber || '',
                stop_type: rawStop.stop_type || rawStop.stopType || 'DELIVERY',
                is_completed: !!(rawStop.is_completed || rawStop.isCompleted),
                arrival_time: rawStop.arrival_time || rawStop.arrivalTime || null,
                updated_at: rawStop.updated_at || rawStop.updatedAt || Date.now()
            };
            groupedStops.push({ ...n, fingerprint: fp, items: [item] });
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
            const res = await client.query(`INSERT INTO stops (uuid, tour_id, address, recipient, company, street, house_number, postal_code, city, state, country, address_full, contact_name, phone_number, email, time_window, notes, order_index, latitude, longitude, is_completed, arrival_time, stop_type, updated_at, items, photo_url, room_number, entry_code, booking_number) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29) ON CONFLICT (uuid) DO UPDATE SET tour_id=EXCLUDED.tour_id, address=EXCLUDED.address, recipient=EXCLUDED.recipient, company=EXCLUDED.company, street=EXCLUDED.street, house_number=EXCLUDED.house_number, postal_code=EXCLUDED.postal_code, city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country, address_full=EXCLUDED.address_full, contact_name=EXCLUDED.contact_name, phone_number=EXCLUDED.phone_number, email=EXCLUDED.email, time_window=EXCLUDED.time_window, notes=EXCLUDED.notes, order_index=EXCLUDED.order_index, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, is_completed=EXCLUDED.is_completed, arrival_time=EXCLUDED.arrival_time, stop_type=EXCLUDED.stop_type, updated_at=EXCLUDED.updated_at, items=EXCLUDED.items, photo_url=COALESCE(EXCLUDED.photo_url, stops.photo_url), room_number=EXCLUDED.room_number, entry_code=EXCLUDED.entry_code, booking_number=EXCLUDED.booking_number RETURNING uuid`,
                [main.uuid, tourId, s.address_full, main.recipient, s.company, s.street, s.house_number, s.postal_code, s.city, s.state, s.country, s.address_full, main.contact_name, main.phone_number, main.email, main.time_window, main.notes, idx++, s.latitude, s.longitude, main.is_completed, main.arrival_time, main.stop_type, main.updated_at, JSON.stringify(s.items), main.photo_url || main.photoUrl || null, main.room_number, main.entry_code, main.booking_number]);
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
        `CREATE TABLE IF NOT EXISTS companies (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            is_demo BOOLEAN DEFAULT FALSE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS drivers (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            company_uuid UUID,
            name TEXT UNIQUE,
            email TEXT,
            phone TEXT,
            whatsapp TEXT,
            telegram TEXT,
            license_plate TEXT,
            photo_url TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            home_lat DOUBLE PRECISION,
            home_lng DOUBLE PRECISION,
            base_lat DOUBLE PRECISION,
            base_lng DOUBLE PRECISION,
            activation_code TEXT UNIQUE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS web_users (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            company_uuid UUID,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS role_permissions (
            id SERIAL PRIMARY KEY,
            company_uuid UUID,
            role TEXT NOT NULL,
            module TEXT NOT NULL,
            can_view BOOLEAN DEFAULT TRUE,
            can_edit BOOLEAN DEFAULT FALSE,
            UNIQUE(company_uuid, role, module)
        )`,
        `CREATE TABLE IF NOT EXISTS driver_devices (
            id SERIAL PRIMARY KEY,
            driver_uuid UUID,
            device_id TEXT UNIQUE NOT NULL,
            device_name TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            linked_at BIGINT,
            last_seen_at BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS live_updates (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, driver_photo TEXT, driver_phone TEXT, driver_email TEXT, license_plate TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, speed FLOAT, status TEXT, current_tour TEXT, next_stop TEXT, next_lat DOUBLE PRECISION, next_lng DOUBLE PRECISION, next_stop_dist FLOAT, next_stop_duration BIGINT, tour_remaining_dist FLOAT, tour_remaining_duration BIGINT, depot_name TEXT, depot_lat DOUBLE PRECISION, depot_lng DOUBLE PRECISION, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS costs (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, amount DECIMAL, currency TEXT, category TEXT, notes TEXT, mileage INT, status TEXT DEFAULT 'Rögzítve', timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, sender TEXT, message TEXT, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS work_times (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, type TEXT, start_time BIGINT, end_time BIGINT, mileage INT, end_mileage INT, license_plate TEXT, notes TEXT, date TEXT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS hotels (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, name TEXT, address TEXT, booking_number TEXT, timestamp BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS tours (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, driver_name TEXT, name TEXT, customer TEXT, date BIGINT, day_of_week TEXT, notes TEXT, is_closed BOOLEAN, is_current BOOLEAN, depot_name TEXT, depot_company TEXT, depot_street TEXT, depot_house_number TEXT, depot_postal_code TEXT, depot_city TEXT, depot_state TEXT, depot_country TEXT, depot_address_full TEXT, depot_lat DOUBLE PRECISION, depot_lng DOUBLE PRECISION, deleted_at BIGINT, updated_at BIGINT, UNIQUE(uuid))`,
        `CREATE TABLE IF NOT EXISTS stops (id SERIAL PRIMARY KEY, uuid UUID DEFAULT gen_random_uuid() UNIQUE, tour_id INT, address TEXT, recipient TEXT, company TEXT, street TEXT, house_number TEXT, postal_code TEXT, city TEXT, state TEXT, country TEXT, address_full TEXT, contact_name TEXT, phone_number TEXT, email TEXT, time_window TEXT, notes TEXT, alternative_names TEXT, order_index INT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, is_completed BOOLEAN, arrival_time BIGINT, photo_url TEXT, deleted_at BIGINT, updated_at BIGINT, stop_type TEXT DEFAULT 'DELIVERY', items JSONB, UNIQUE(uuid))`,
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
        ['stops', 'photo_url', 'TEXT'],
        ['stops', 'room_number', 'TEXT'],
        ['stops', 'entry_code', 'TEXT'],
        ['stops', 'booking_number', 'TEXT'],
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
        ['live_updates', 'driver_photo', 'TEXT'],
        ['live_updates', 'depot_name', 'TEXT'],
        ['live_updates', 'depot_lat', 'DOUBLE PRECISION'],
        ['live_updates', 'depot_lng', 'DOUBLE PRECISION'],
        ['live_updates', 'next_stop_duration', 'BIGINT'],
        ['live_updates', 'tour_remaining_duration', 'BIGINT'],
        ['live_updates', 'include_rests', 'BOOLEAN DEFAULT TRUE'],
        ['live_updates', 'next_break_in_seconds', 'BIGINT'],
        ['live_updates', 'company_uuid', 'UUID'],
        ['live_updates', 'driver_uuid', 'UUID'],
        ['costs', 'company_uuid', 'UUID'],
        ['costs', 'driver_uuid', 'UUID'],
        ['costs', 'photo_path', 'TEXT'],
        ['chat_messages', 'company_uuid', 'UUID'],
        ['chat_messages', 'driver_uuid', 'UUID'],
        ['work_times', 'company_uuid', 'UUID'],
        ['work_times', 'driver_uuid', 'UUID'],
        ['hotels', 'company_uuid', 'UUID'],
        ['hotels', 'driver_uuid', 'UUID'],
        ['hotels', 'room_number', 'TEXT'],
        ['hotels', 'entry_code', 'TEXT'],
        ['hotels', 'booking_number', 'TEXT'],
        ['hotels', 'phone_number', 'TEXT'],
        ['hotels', 'email', 'TEXT'],
        ['hotels', 'notes', 'TEXT'],
        ['tours', 'company_uuid', 'UUID'],
        ['tours', 'driver_uuid', 'UUID'],
        ['stops', 'company_uuid', 'UUID'],
        ['stops', 'driver_uuid', 'UUID'],
        ['drivers', 'company_uuid', 'UUID'],
        ['drivers', 'photo_url', 'TEXT'],
        ['drivers', 'profile_updated_at', 'BIGINT DEFAULT 0'],
        ['drivers', 'home_lat', 'DOUBLE PRECISION'],
        ['drivers', 'home_lng', 'DOUBLE PRECISION'],
        ['drivers', 'base_lat', 'DOUBLE PRECISION'],
        ['drivers', 'base_lng', 'DOUBLE PRECISION'],
        ['driver_devices', 'device_name', 'TEXT'],
        ['driver_devices', 'is_active', 'BOOLEAN DEFAULT TRUE'],
        ['driver_devices', 'linked_at', 'BIGINT'],
        ['driver_devices', 'last_seen_at', 'BIGINT']
    ];
    for (const [t, c, type] of cols) {
        if (t === 'stops' && c === 'items') console.log('[SCHEMA] checking stops.items');
        const check = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [t, c]);
        if (check.rows.length === 0) {
            if (t === 'stops' && c === 'items') console.log('[SCHEMA] adding items column');
            await pool.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
        }
    }

    await pool.query(`
        INSERT INTO companies (name, slug, is_demo)
        VALUES ('Demo Company', 'demo-company', true)
        ON CONFLICT (slug) DO NOTHING
    `);
    const defaultCompany = (await pool.query("SELECT uuid FROM companies WHERE slug = 'demo-company' LIMIT 1")).rows[0];
    if (defaultCompany) {
        const companyUuid = defaultCompany.uuid;
        await pool.query('UPDATE drivers SET company_uuid = $1 WHERE company_uuid IS NULL', [companyUuid]);
        const driverLinkedTables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
        for (const table of driverLinkedTables) {
            await pool.query(`UPDATE ${table} SET company_uuid = $1 WHERE company_uuid IS NULL`, [companyUuid]);
            await pool.query(`UPDATE ${table} t SET driver_uuid = d.uuid FROM drivers d WHERE t.driver_uuid IS NULL AND t.driver_name = d.name`);
        }
        await pool.query(`UPDATE stops s SET company_uuid = t.company_uuid, driver_uuid = t.driver_uuid FROM tours t WHERE s.tour_id = t.id AND (s.company_uuid IS NULL OR s.driver_uuid IS NULL)`);
        const permissionRows = [
            ['CEO', 'tours', true, true],
            ['CEO', 'live_status', true, false],
            ['CEO', 'fuel', true, false],
            ['CEO', 'costs', true, true],
            ['CEO', 'chat', false, false],
            ['CEO', 'reports', true, false],
            ['DISPATCHER', 'tours', true, true],
            ['DISPATCHER', 'live_status', true, false],
            ['DISPATCHER', 'fuel', false, false],
            ['DISPATCHER', 'costs', false, false],
            ['DISPATCHER', 'chat', true, true],
            ['DISPATCHER', 'reports', true, false]
        ];
        for (const [role, module, canView, canEdit] of permissionRows) {
            await pool.query(`INSERT INTO role_permissions (company_uuid, role, module, can_view, can_edit)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (company_uuid, role, module) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
                [companyUuid, role, module, canView, canEdit]);
        }
    }

    // Additional driver columns
    const driverCols = [
        ['drivers', 'whatsapp', 'TEXT'],
        ['drivers', 'telegram', 'TEXT'],
        ['drivers', 'activation_code', 'TEXT UNIQUE'],
        ['drivers', 'created_at', 'BIGINT']
    ];
    for (const [t, c, type] of driverCols) {
        const check = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [t, c]);
        if (check.rows.length === 0) {
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
        const prevRes = await client.query('SELECT status, license_plate, depot_name, depot_lat, depot_lng FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [d.driverName]);
        const prev = prevRes.rows[0] || {};
        const prevPlate = prev.license_plate || 'N/A';

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
            resObj.nextLat || d.nextLat,
            resObj.nextLng || d.nextLng,
            (resObj.nextStopDist !== null) ? resObj.nextStopDist : (d.nextStopDistance || 0),
            Math.round((resObj.nextStopDur !== null) ? resObj.nextStopDur : (d.nextStopDuration || 0)),
            (resObj.tourRemainingDist !== null) ? resObj.tourRemainingDist : (d.tourRemainingDistance || 0),
            Math.round((resObj.tourRemainingDur !== null) ? resObj.tourRemainingDur : (d.tourRemainingDuration || 0)),
            resObj.depotName || d.depotName || prev.depot_name,
            resObj.depotLat || d.depotLat || prev.depot_lat,
            resObj.depotLng || d.depotLng || prev.depot_lng,
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const wt of req.body) {
            await client.query(`INSERT INTO work_times (uuid, driver_name, type, start_time, end_time, mileage, end_mileage, license_plate, notes, date)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (uuid) DO UPDATE SET
                    driver_name = EXCLUDED.driver_name,
                    type = EXCLUDED.type,
                    start_time = EXCLUDED.start_time,
                    end_time = EXCLUDED.end_time,
                    mileage = EXCLUDED.mileage,
                    end_mileage = EXCLUDED.end_mileage,
                    license_plate = EXCLUDED.license_plate,
                    notes = EXCLUDED.notes,
                    date = EXCLUDED.date`,
                [wt.uuid || null, wt.driverName, wt.type, wt.startTime, wt.endTime, wt.mileage, wt.endMileage, wt.licensePlate, wt.notes, wt.date]);
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-WORKTIMES-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/api/sync-costs', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const c of req.body) {
            await client.query(`INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, photo_path, status, timestamp)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'Rögzítve'), $10)
                ON CONFLICT (uuid) DO UPDATE SET
                    driver_name = EXCLUDED.driver_name,
                    amount = EXCLUDED.amount,
                    currency = EXCLUDED.currency,
                    category = EXCLUDED.category,
                    notes = EXCLUDED.notes,
                    mileage = EXCLUDED.mileage,
                    photo_path = EXCLUDED.photo_path,
                    status = EXCLUDED.status,
                    timestamp = EXCLUDED.timestamp`,
                [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.photoPath || c.photo_path || null, c.status || null, c.timestamp]);
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-COSTS-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.get('/api/cost-status/:driverName', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, uuid, status, timestamp, amount FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC',
            [req.params.driverName]
        );
        res.json(result.rows.map(r => ({
            id: r.id,
            uuid: r.uuid,
            status: r.status,
            timestamp: Number(r.timestamp),
            amount: Number(r.amount)
        })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/admin/update-cost-status', requireAdmin, async (req, res) => {
    const { uuid, id, status } = req.body;
    const allowed = new Set(['Rögzítve', 'Beküldve', 'Elfogadva', 'Kifizetve', 'Rogzitve', 'Bekuldve']);
    if (!status || (!uuid && !id)) return res.sendStatus(400);
    if (!allowed.has(status)) return res.status(400).send('Invalid status');
    try {
        if (uuid) {
            await pool.query('UPDATE costs SET status = $1 WHERE uuid::text = $2', [status, uuid]);
        } else {
            await pool.query('UPDATE costs SET status = $1 WHERE id = $2', [status, id]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/admin/save-cost', requireAdmin, async (req, res) => {
    const { driverName, amount, currency, category, notes, mileage, timestamp } = req.body;
    const parsedAmount = Number(amount);
    const parsedMileage = mileage === '' || mileage === null || mileage === undefined ? null : Number(mileage);
    const costTimestamp = Number(timestamp || Date.now());
    if (!driverName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.sendStatus(400);
    try {
        const driverRes = await pool.query('SELECT company_uuid, uuid FROM drivers WHERE name = $1 LIMIT 1', [driverName]);
        const driver = driverRes.rows[0] || {};
        const result = await pool.query(
            `INSERT INTO costs (company_uuid, driver_uuid, uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp)
             VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, 'Rögzítve', $9)
             RETURNING id, uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp`,
            [
                driver.company_uuid || null,
                driver.uuid || null,
                driverName,
                parsedAmount,
                currency || 'EUR',
                category || 'Egyéb',
                notes || '',
                Number.isFinite(parsedMileage) ? parsedMileage : null,
                costTimestamp
            ]
        );
        const row = result.rows[0];
        res.json({ ...row, amount: Number(row.amount), timestamp: Number(row.timestamp) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/admin/save-hotel', requireAdmin, async (req, res) => {
    const { driverName, name, address, roomNumber, entryCode, bookingNumber, phoneNumber, email, notes, timestamp } = req.body;
    const hotelTimestamp = Number(timestamp || Date.now());
    if (!driverName || !name) return res.sendStatus(400);
    try {
        const driverRes = await pool.query('SELECT company_uuid, uuid FROM drivers WHERE name = $1 LIMIT 1', [driverName]);
        const driver = driverRes.rows[0] || {};
        const result = await pool.query(
            `INSERT INTO hotels (company_uuid, driver_uuid, uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
             VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp`,
            [
                driver.company_uuid || null,
                driver.uuid || null,
                driverName,
                name,
                address || '',
                roomNumber || '',
                entryCode || '',
                bookingNumber || '',
                phoneNumber || '',
                email || '',
                notes || '',
                Number.isFinite(hotelTimestamp) ? hotelTimestamp : Date.now()
            ]
        );
        const row = result.rows[0];
        res.json({ ...row, timestamp: Number(row.timestamp) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/admin/save-hotel-record', requireAdmin, async (req, res) => {
    const { source, id, uuid, driverName, name, address, roomNumber, entryCode, bookingNumber, phoneNumber, email, notes, timestamp } = req.body;
    if (!name || (!id && !uuid && source !== 'hotel')) return res.sendStatus(400);
    try {
        if (source === 'stop') {
            const result = await pool.query(
                `UPDATE stops SET recipient=$1, address=$2, address_full=$2, room_number=$3, entry_code=$4, booking_number=$5, phone_number=$6, email=$7, notes=$8, updated_at=$9
                 WHERE ${uuid ? 'uuid::text = $10' : 'id = $10'}
                 RETURNING 'stop'::TEXT as source, id, uuid::TEXT, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, room_number, entry_code, booking_number, phone_number, email, notes, updated_at::BIGINT as timestamp`,
                [name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', Date.now(), uuid || id]
            );
            if (!result.rows[0]) return res.sendStatus(404);
            const row = result.rows[0];
            return res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
        }

        if (id || uuid) {
            const result = await pool.query(
                `UPDATE hotels SET name=$1, address=$2, room_number=$3, entry_code=$4, booking_number=$5, phone_number=$6, email=$7, notes=$8, timestamp=$9
                 WHERE ${uuid ? 'uuid::text = $10' : 'id = $10'}
                 RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp::BIGINT`,
                [name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', Number(timestamp || Date.now()), uuid || id]
            );
            if (!result.rows[0]) return res.sendStatus(404);
            const row = result.rows[0];
            return res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
        }

        const driverRes = await pool.query('SELECT company_uuid, uuid FROM drivers WHERE name = $1 LIMIT 1', [driverName]);
        const driver = driverRes.rows[0] || {};
        const result = await pool.query(
            `INSERT INTO hotels (company_uuid, driver_uuid, uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
             VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp::BIGINT`,
            [driver.company_uuid || null, driver.uuid || null, driverName, name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', Number(timestamp || Date.now())]
        );
        const row = result.rows[0];
        res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/api/sync-hotels', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const h of (req.body || [])) {
            await client.query(`INSERT INTO hotels (uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (uuid) DO UPDATE SET
                    driver_name = EXCLUDED.driver_name,
                    name = EXCLUDED.name,
                    address = EXCLUDED.address,
                    room_number = EXCLUDED.room_number,
                    entry_code = EXCLUDED.entry_code,
                    booking_number = EXCLUDED.booking_number,
                    phone_number = EXCLUDED.phone_number,
                    email = EXCLUDED.email,
                    notes = EXCLUDED.notes,
                    timestamp = EXCLUDED.timestamp`,
                [h.uuid || null, h.driverName, h.name, h.address, h.roomNumber || h.room_number || '', h.entryCode || h.entry_code || '', h.bookingNumber || h.booking_number || '', h.phoneNumber || h.phone_number || '', h.email || '', h.notes || '', h.timestamp || Date.now()]);
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-HOTELS-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/admin/dev-reset-database', requireAdmin, async (req, res) => {
    if (req.body?.confirm !== 'RESET_DEV_DATABASE') {
        return res.status(400).json({ error: 'Missing confirm: RESET_DEV_DATABASE' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tables = [
            'live_updates',
            'chat_messages',
            'costs',
            'hotels',
            'work_times',
            'stops',
            'tours',
            'role_permissions',
            'web_users',
            'drivers',
            'companies'
        ];
        for (const table of tables) {
            await client.query(`DELETE FROM ${table}`);
        }
        await client.query('COMMIT');
        res.json({ success: true, cleared: tables });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/admin/dev-reset-demo', requireAdmin, async (req, res) => {
    if (req.body?.confirm !== 'RESET_DEMO_DATA') {
        return res.status(400).json({ error: 'Missing confirm: RESET_DEMO_DATA' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const demoCompanies = await client.query('SELECT uuid FROM companies WHERE is_demo = true');
        const companyUuids = demoCompanies.rows.map(r => r.uuid);
        if (companyUuids.length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true, cleared: [], message: 'No demo companies found.' });
        }

        await client.query('DELETE FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE company_uuid = ANY($1::UUID[]))', [companyUuids]);
        const tables = ['live_updates', 'chat_messages', 'costs', 'hotels', 'work_times', 'tours', 'role_permissions', 'web_users', 'drivers'];
        for (const table of tables) {
            await client.query(`DELETE FROM ${table} WHERE company_uuid = ANY($1::UUID[])`, [companyUuids]);
        }
        await client.query('DELETE FROM companies WHERE uuid = ANY($1::UUID[])', [companyUuids]);
        await client.query('COMMIT');
        res.json({ success: true, cleared: ['stops', ...tables, 'companies'], companyCount: companyUuids.length });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/admin/dev-seed-demo', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        const companies = [
            { name: 'Demo Logistics GmbH', slug: 'demo-logistics' },
            { name: 'Cargo Pilot Kft.', slug: 'cargo-pilot' }
        ];
        const result = { companies: [], users: [], drivers: [], tours: [] };

        for (const company of companies) {
            const companyRow = (await client.query(
                `INSERT INTO companies (name, slug, is_demo)
                 VALUES ($1, $2, true)
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                 RETURNING uuid, name, slug`,
                [company.name, company.slug]
            )).rows[0];
            result.companies.push(companyRow);

            const permissions = [
                ['CEO', 'tours', true, true],
                ['CEO', 'live_status', true, false],
                ['CEO', 'fuel', true, false],
                ['CEO', 'costs', true, true],
                ['CEO', 'chat', false, false],
                ['CEO', 'reports', true, false],
                ['DISPATCHER', 'tours', true, true],
                ['DISPATCHER', 'live_status', true, false],
                ['DISPATCHER', 'fuel', false, false],
                ['DISPATCHER', 'costs', false, false],
                ['DISPATCHER', 'chat', true, true],
                ['DISPATCHER', 'reports', true, false]
            ];
            for (const [role, module, canView, canEdit] of permissions) {
                await client.query(`INSERT INTO role_permissions (company_uuid, role, module, can_view, can_edit)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (company_uuid, role, module) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
                    [companyRow.uuid, role, module, canView, canEdit]);
            }

            const users = [
                { name: `${company.name} CEO`, email: `ceo@${company.slug}.test`, role: 'CEO' },
                { name: `${company.name} Dispatcher`, email: `dispatch@${company.slug}.test`, role: 'DISPATCHER' }
            ];
            for (const user of users) {
                const userRow = (await client.query(`INSERT INTO web_users (company_uuid, name, email, role, is_active)
                    VALUES ($1, $2, $3, $4, true)
                    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, company_uuid = EXCLUDED.company_uuid
                    RETURNING uuid, name, email, role`,
                    [companyRow.uuid, user.name, user.email, user.role])).rows[0];
                result.users.push(userRow);
            }

            const drivers = [
                { name: `${company.slug}-driver-1`, email: `driver1@${company.slug}.test`, plate: 'DEMO-101', code: `${company.slug.slice(0, 3).toUpperCase()}101` },
                { name: `${company.slug}-driver-2`, email: `driver2@${company.slug}.test`, plate: 'DEMO-202', code: `${company.slug.slice(0, 3).toUpperCase()}202` }
            ];
            for (const driver of drivers) {
                const driverRow = (await client.query(`INSERT INTO drivers (company_uuid, name, email, phone, license_plate, is_active, activation_code)
                    VALUES ($1, $2, $3, '+490000000', $4, true, $5)
                    ON CONFLICT (name) DO UPDATE SET company_uuid = EXCLUDED.company_uuid, email = EXCLUDED.email, license_plate = EXCLUDED.license_plate, activation_code = EXCLUDED.activation_code
                    RETURNING uuid, name, license_plate`,
                    [companyRow.uuid, driver.name, driver.email, driver.plate, driver.code])).rows[0];
                result.drivers.push(driverRow);

                const tourRow = (await client.query(`INSERT INTO tours (company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'Demo tour', false, true, $7)
                    RETURNING id, uuid, name`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, `Demo Tour ${driverRow.name}`, company.name, now, now])).rows[0];
                result.tours.push(tourRow);

                await client.query(`INSERT INTO stops (company_uuid, driver_uuid, tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, order_index, latitude, longitude, is_completed, stop_type, updated_at)
                    VALUES ($1, $2, $3, 'Arthur-Junghans-Str 1, 78713 Schramberg', 'Demo Recipient', 'Arthur-Junghans-Str', '1', '78713', 'Schramberg', 'Arthur-Junghans-Str 1, 78713 Schramberg', '', '', '', '08:00-12:00', '', 0, 48.2238915, 8.384806, false, 'DELIVERY', $4)`,
                    [companyRow.uuid, driverRow.uuid, tourRow.id, now]);

                await client.query(`INSERT INTO costs (company_uuid, driver_uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp)
                    VALUES ($1, $2, $3, 75.50, 'EUR', 'Tankolas', 'Demo fuel receipt', 12345, 'Bekuldve', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO chat_messages (company_uuid, driver_uuid, driver_name, sender, message, timestamp)
                    VALUES ($1, $2, $3, 'DISPATCHER', 'Demo uzenet a sofornek.', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO live_updates (company_uuid, driver_uuid, driver_name, license_plate, latitude, longitude, speed, status, current_tour, timestamp)
                    VALUES ($1, $2, $3, $4, 48.2280912, 8.3869585, 0, 'Offline', $5, $6)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, driverRow.license_plate, tourRow.name, now]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, ...result });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
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

// ==========================================
// DRIVER PROFILE & AUTH
// ==========================================

app.post('/api/activate-driver', async (req, res) => {
    const { code, deviceId, deviceName } = req.body;
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE activation_code = $1 AND is_active = true', [code]);
        if (result.rows.length === 0) return res.status(404).send('Érvénytelen vagy inaktív aktiváló kód.');
        const driver = result.rows[0];
        const now = Date.now();
        if (deviceId) {
            await pool.query(
                `INSERT INTO driver_devices (driver_uuid, device_id, device_name, is_active, linked_at, last_seen_at)
                 VALUES ($1, $2, $3, true, $4, $4)
                 ON CONFLICT (device_id) DO UPDATE SET
                    driver_uuid = EXCLUDED.driver_uuid,
                    device_name = EXCLUDED.device_name,
                    is_active = true,
                    last_seen_at = EXCLUDED.last_seen_at`,
                [driver.uuid, deviceId, deviceName || 'Android telefon', now]
            );
        }
        res.json(driver);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/unlink-device', async (req, res) => {
    const { uuid, deviceId } = req.body;
    if (!deviceId) return res.status(400).send('Missing deviceId');
    try {
        if (uuid) {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2 AND driver_uuid = $3', [Date.now(), deviceId, uuid]);
        } else {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2', [Date.now(), deviceId]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/sync-profile', async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Először próbáljuk meg UUID alapján azonosítani, ha az app küldi
        let driverRes;
        if (d.uuid) {
            driverRes = await client.query('SELECT * FROM drivers WHERE uuid = $1', [d.uuid]);
        } else {
            // Ha nincs UUID, akkor név alapján keressük (visszafelé kompatibilitás)
            driverRes = await client.query('SELECT * FROM drivers WHERE name = $1', [d.name]);
        }

        const driver = driverRes.rows[0];
        const incomingUpdatedAt = Number(d.profileUpdatedAt || d.profile_updated_at || 0);
        const now = Date.now();

        if (driver) {
            const serverUpdatedAt = Number(driver.profile_updated_at || 0);
            if (incomingUpdatedAt > 0 && serverUpdatedAt > incomingUpdatedAt) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'PROFILE_CHANGED_ON_SERVER', profile: driver });
            }
            const oldName = driver.name;
            await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=true, profile_updated_at=$8
                 WHERE uuid=$9`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, now, driver.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is
            if (oldName !== d.name) {
                console.log(`[RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
        } else {
            // Új sofőr beszúrása (csak ha tényleg nem létezik)
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, is_active, profile_updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, code, now]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, profileUpdatedAt: now });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-PROFILE-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.get('/api/get-profile/:name', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE name = $1', [req.params.name]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/get-profile-by-uuid/:uuid', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/admin/unlink-driver-devices', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).send('Missing driver uuid');
    try {
        await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE driver_uuid = $2', [Date.now(), uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/admin/save-driver', requireAdmin, async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (d.uuid) {
            // Régi név lekérése a módosítás előtt
            const oldRes = await client.query('SELECT name FROM drivers WHERE uuid = $1', [d.uuid]);
            const oldName = oldRes.rows[0]?.name;

            await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=$8, home_lat=$9, home_lng=$10, base_lat=$11, base_lng=$12, profile_updated_at=$13 WHERE uuid=$14`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, d.is_active, d.home_lat, d.home_lng, d.base_lat, d.base_lng, Date.now(), d.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is (cascade)
            if (oldName && oldName !== d.name) {
                console.log(`[ADMIN-RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
        } else {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, profile_updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, code, Date.now()]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[ADMIN-SAVE-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

app.post('/admin/delete-driver', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    try {
        await pool.query('DELETE FROM drivers WHERE uuid = $1', [uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/upload-photo', async (req, res) => {
    try {
        const { driverName, imageBase64, uuid } = req.body;
        if (!imageBase64) {
            console.warn('[UPLOAD] No image data received');
            return res.status(400).send('No image data');
        }

        const identifier = uuid || driverName;
        if (!identifier) {
            console.warn('[UPLOAD] No driver identifier (uuid or name) received');
            return res.status(400).send('No driver identifier');
        }

        console.log(`[UPLOAD] Receiving photo for ${identifier}, size: ${imageBase64.length} chars`);

        const normalizedBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(normalizedBase64)) {
            return res.status(400).send('Invalid base64 data');
        }

        const buffer = Buffer.from(normalizedBase64, 'base64');

        if (buffer.length === 0) {
            console.warn('[UPLOAD] Decoded buffer is empty');
            return res.status(400).send('Invalid base64 data');
        }
        if (buffer.length > MAX_UPLOAD_BYTES) {
            return res.status(413).send('Image too large');
        }

        let ext = null;
        if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
        if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ext = 'png';
        if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
        if (!ext) {
            return res.status(400).send('Unsupported image type');
        }

        const fileName = `photo_${String(identifier).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${ext}`;
        const filePath = `uploads/${fileName}`;

        fs.writeFileSync(filePath, buffer);
        console.log(`[UPLOAD] Saved to ${filePath}, size: ${buffer.length} bytes`);

        const photoUrl = `/uploads/${fileName}`;
        const now = Date.now();
        if (uuid) {
            await pool.query('UPDATE drivers SET photo_url = $1, profile_updated_at = $2 WHERE uuid = $3', [photoUrl, now, uuid]);
        } else {
            await pool.query('UPDATE drivers SET photo_url = $1, profile_updated_at = $2 WHERE name = $3', [photoUrl, now, driverName]);
        }

        res.json({ photoUrl, profileUpdatedAt: now });
    } catch (e) {
        console.error(`[UPLOAD-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    }
});

app.post('/api/upload-stop-photo', async (req, res) => {
    try {
        const { stopUuid, imageBase64 } = req.body;
        if (!stopUuid || !imageBase64) {
            return res.status(400).send('Missing stopUuid or image data');
        }

        const normalizedBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(normalizedBase64)) {
            return res.status(400).send('Invalid base64 data');
        }

        const buffer = Buffer.from(normalizedBase64, 'base64');
        if (buffer.length === 0) return res.status(400).send('Invalid base64 data');
        if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).send('Image too large');

        let ext = null;
        if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
        if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ext = 'png';
        if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
        if (!ext) return res.status(400).send('Unsupported image type');

        const safeStop = String(stopUuid).replace(/[^a-z0-9-]/gi, '_');
        const fileName = `stop_${safeStop}_${Date.now()}.${ext}`;
        const filePath = `uploads/${fileName}`;
        fs.writeFileSync(filePath, buffer);

        const photoUrl = `/uploads/${fileName}`;
        const now = Date.now();
        const result = await pool.query('UPDATE stops SET photo_url = $1, updated_at = $2 WHERE uuid::text = $3', [photoUrl, now, stopUuid]);
        if (result.rowCount === 0) return res.status(404).send('Stop not found');

        res.json({ photoUrl, updatedAt: now });
    } catch (e) {
        console.error(`[STOP-UPLOAD-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    }
});

app.get('/api/all-drivers', async (req, res) => {
    const result = await pool.query('SELECT * FROM drivers ORDER BY name ASC');
    res.json(result.rows);
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
                stops: stopsRes.rows.map(s => ({ ...s, latitude: s.latitude, longitude: s.longitude, isCompleted: !!s.is_completed, stopType: s.stop_type, arrivalTime: s.arrival_time ? Number(s.arrival_time) : null, photoUrl: s.photo_url || null, updatedAt: s.updated_at ? Number(s.updated_at) : null }))
            });
        }
        res.json(results);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/get-hotels/:driverName', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, name::TEXT, address::TEXT, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, timestamp::BIGINT
             FROM hotels
             WHERE driver_name = $1
             UNION ALL
             SELECT 'stop'::TEXT as source,
                    id::INT,
                    uuid::TEXT,
                    COALESCE(recipient, address_full)::TEXT as name,
                    address_full::TEXT as address,
                    room_number::TEXT,
                    entry_code::TEXT,
                    booking_number::TEXT,
                    phone_number::TEXT,
                    email::TEXT,
                    notes::TEXT,
                    COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp
             FROM stops
             WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1 AND deleted_at IS NULL)
               AND deleted_at IS NULL
               AND stop_type = 'HOTEL'
             ORDER BY timestamp DESC`,
            [req.params.driverName]
        );
        res.json(result.rows.map(h => ({ ...h, timestamp: Number(h.timestamp || Date.now()) })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/admin/save-tour', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tourId = await ImportEngine.processTour(client, req.body.driver_name, req.body, req.body.stops || []);
        await client.query('COMMIT');
        res.json({ success: true, tourId });
    } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); }
    finally { client.release(); }
});

app.post('/admin/transfer-tour', requireAdmin, async (req, res) => {
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

app.post('/admin/delete-tour', requireAdmin, async (req, res) => {
    const now = Date.now();
    await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2', [now, req.body.id]);
    await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, req.body.id]);
    res.json({ success: true });
});

app.get('/api/live-status/:name', async (req, res) => {
    try {
        const name = req.params.name;
        const updateRes = await pool.query(`
            SELECT lu.*, d.photo_url as driver_photo, COALESCE(d.license_plate, lu.license_plate) as license_plate
            FROM live_updates lu
            LEFT JOIN drivers d ON d.name = lu.driver_name
            WHERE lu.driver_name = $1
            ORDER BY lu.timestamp DESC
            LIMIT 1
        `, [name]);

        const update = updateRes.rows[0] || {};

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
        const drivers = await pool.query(`
            SELECT DISTINCT ON (all_drivers.driver_name)
                all_drivers.driver_name,
                d.photo_url as driver_photo,
                all_drivers.status,
                COALESCE(d.license_plate, all_drivers.license_plate) as license_plate,
                all_drivers.timestamp
            FROM (
                SELECT driver_name, status, license_plate, timestamp::BIGINT, 1 as source_rank FROM live_updates
                UNION ALL
                SELECT driver_name, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp, 2 as source_rank FROM tours WHERE deleted_at IS NULL
                UNION ALL
                SELECT name as driver_name, 'Új sofőr' as status, license_plate, COALESCE(profile_updated_at, created_at, 0)::BIGINT as timestamp, 3 as source_rank FROM drivers WHERE is_active = true
            ) AS all_drivers
            LEFT JOIN drivers d ON d.name = all_drivers.driver_name
            ORDER BY all_drivers.driver_name, all_drivers.source_rank ASC, all_drivers.timestamp DESC
        `);
        res.json(drivers.rows);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/stats/:driverName', async (req, res) => {
    try {
        const driverName = req.params.driverName;
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const month = today.slice(0, 7);
        const work = (await pool.query('SELECT * FROM work_times WHERE driver_name = $1 AND date LIKE $2', [driverName, `${month}%`])).rows;
        const costs = (await pool.query('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::INT AS count FROM costs WHERE driver_name = $1 AND timestamp >= $2', [driverName, new Date(`${month}-01T00:00:00.000Z`).getTime()])).rows[0];
        const tours = (await pool.query('SELECT COUNT(*)::INT AS count FROM tours WHERE driver_name = $1 AND deleted_at IS NULL AND date >= $2', [driverName, new Date(`${month}-01T00:00:00.000Z`).getTime()])).rows[0];

        const isType = (row, type) => String(row.type || '').startsWith(type);
        const sumSeconds = (rows, type, onlyToday = false) => rows
            .filter(w => (type ? isType(w, type) : !isType(w, 'Pihen')) && (!onlyToday || w.date === today))
            .reduce((sum, w) => sum + Math.max(0, Number(w.end_time || Date.now()) - Number(w.start_time || 0)) / 1000, 0);

        res.json({
            today,
            month,
            workTodaySeconds: Math.round(sumSeconds(work, null, true)),
            drivingTodaySeconds: Math.round(sumSeconds(work, 'Vezetés', true)),
            restTodaySeconds: Math.round(sumSeconds(work, 'Pihen', true)),
            workMonthSeconds: Math.round(sumSeconds(work, null, false)),
            drivingMonthSeconds: Math.round(sumSeconds(work, 'Vezetés', false)),
            restMonthSeconds: Math.round(sumSeconds(work, 'Pihen', false)),
            costMonthTotal: Number(costs.total || 0),
            costMonthCount: Number(costs.count || 0),
            tourMonthCount: Number(tours.count || 0)
        });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/', async (req, res) => {
    try {
        const driversRes = await pool.query(`
            SELECT DISTINCT ON (all_drivers.driver_name)
                all_drivers.driver_name,
                d.photo_url as driver_photo,
                all_drivers.status,
                COALESCE(d.license_plate, all_drivers.license_plate) as license_plate,
                all_drivers.timestamp
            FROM (
                SELECT driver_name, status, license_plate, timestamp::BIGINT, 1 as source_rank FROM live_updates
                UNION ALL
                SELECT driver_name, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp, 2 as source_rank FROM tours WHERE deleted_at IS NULL
                UNION ALL
                SELECT name as driver_name, 'Új sofőr' as status, license_plate, COALESCE(profile_updated_at, created_at, 0)::BIGINT as timestamp, 3 as source_rank FROM drivers WHERE is_active = true
            ) AS all_drivers
            LEFT JOIN drivers d ON d.name = all_drivers.driver_name
            ORDER BY all_drivers.driver_name, all_drivers.source_rank ASC, all_drivers.timestamp DESC
        `);
        let list = driversRes.rows.map(d => '<div class="card driver-card" data-driver-name="' + escapeHtml(d.driver_name) + '"><img src="' + escapeHtml(d.driver_photo || '') + '" style="width:50px;height:50px;border-radius:50%;float:right;background:#444;object-fit:cover;"><h3>' + escapeHtml(d.driver_name) + '</h3><p>' + escapeHtml(d.status) + (d.license_plate ? ' | ' + escapeHtml(d.license_plate) : '') + '</p></div>').join('');
        res.send(`<html><head><title>Driver ERP</title><style>
            body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 40px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .card { background: #333; padding: 20px; border-radius: 12px; cursor: pointer; border-left: 8px solid #3498db; transition: 0.2s; }
            .card:hover { transform: scale(1.02); background: #444; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
            input, select { padding: 8px; background: #333; border: 1px solid #444; color: white; border-radius: 4px; }
            .btn-admin { background: #f1c40f; color: black; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: bold; margin-bottom: 20px; }
            .section { display: none; }
            .section.active { display: block; }
            #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
            .toast { background: #2ecc71; color: white; padding: 12px 24px; border-radius: 8px; margin-top: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideIn 0.3s, fadeOut 0.5s 2.5s forwards; }
            @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        </style></head>
        <body>
            <div id="toast-container"></div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h1>🚛 Flotta kiválasztása</h1>
                <button class="btn-admin" id="admin-toggle" onclick="toggleAdmin()">⚙️ SOFŐRÖK KEZELÉSE</button>
            </div>

            <div id="fleet-section" class="section active">
                <div class="grid" id="driver-grid">${list}</div>
            </div>

            <div id="admin-section" class="section">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>SOFŐRÖK LISTÁJA</h3>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="importCode" placeholder="Aktiváló kód" style="width:150px;">
                        <button onclick="importDriver()" style="background:#3498db; color:white; padding:10px; border:none; border-radius:4px; cursor:pointer;">Importálás</button>
                        <button onclick="editDriver()" style="background:#2ecc71; color:white; padding:10px 20px; border:none; border-radius:4px; cursor:pointer;">+ Új sofőr</button>
                    </div>
                </div>
                <table>
                    <thead><tr><th>Név</th><th>Email / Telefon</th><th>Rendszám</th><th>Aktiváló kód</th><th>Állapot</th><th>Művelet</th></tr></thead>
                    <tbody id="drivers-list"></tbody>
                </table>
            </div>

            <div id="driverModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1001; padding:50px;">
                <div style="background:#222; padding:30px; border-radius:12px; max-width:600px; margin:auto;">
                    <h2>Sofőr szerkesztése</h2>
                    <input type="hidden" id="dUuid">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="position: relative; display: inline-block;">
                            <img id="dPhotoPreview" src="" style="width:100px; height:100px; border-radius:50%; background:#333; object-fit: cover; border: 2px solid #444;">
                            <label for="admin-photo-upload" style="position: absolute; bottom: 0; right: 0; background: #3498db; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid #222;">📷</label>
                            <input type="file" id="admin-photo-upload" style="display: none;" onchange="uploadAdminPhoto(this)" accept="image/*">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                        <div><label style="display:block; font-size:11px; color:#aaa;">Név</label><input type="text" id="dName" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Rendszám</label><input type="text" id="dPlate" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Email</label><input type="text" id="dEmail" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Telefon</label><input type="text" id="dPhone" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">WhatsApp</label><input type="text" id="dWhatsapp" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Telegram</label><input type="text" id="dTelegram" style="width:100%"></div>
                    </div>
                    <div><label style="display:block; font-size:11px; color:#aaa;">Profilkép URL</label><input type="text" id="dPhoto" style="width:100%"></div>
                    <div style="margin-top:15px;">
                        <input type="checkbox" id="dActive" checked style="width:20px; height:20px; display:inline-block; vertical-align:middle;">
                        <label style="display:inline-block; margin-left:10px;">Aktív felhasználó</label>
                    </div>
                    <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;">
                        <button onclick="document.getElementById('driverModal').style.display='none'">Mégse</button>
                        <button onclick="saveDriver()" style="background:#3498db; color:white; padding:10px 30px; border:none; border-radius:4px; cursor:pointer;">Mentés</button>
                    </div>
                </div>
            </div>

            <script>
                function esc(value) {
                    return String(value ?? '').replace(/[&<>"']/g, ch => ({
                        '&': '&amp;',
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#39;'
                    }[ch]));
                }
                function toggleAdmin() {
                    const isAdmin = document.getElementById('admin-section').classList.toggle('active');
                    document.getElementById('fleet-section').classList.toggle('active', !isAdmin);
                    document.getElementById('admin-toggle').innerText = isAdmin ? '⬅️ VISSZA A FLOTTÁHOZ' : '⚙️ SOFŐRÖK KEZELÉSE';
                    if (isAdmin) refreshDrivers();
                }

                async function refreshFleet() {
                    if (document.getElementById('admin-section').classList.contains('active')) return;
                    try {
                        const r = await fetch('/api/fleet-status');
                        if (!r.ok) return;
                        const drivers = await r.json();
                        const grid = document.getElementById('driver-grid');
                        grid.innerHTML = drivers.map(d =>
                            '<div class="card driver-card" data-driver-name="' + esc(d.driver_name) + '">' +
                                '<img src="' + esc(d.driver_photo || '') + '" style="width:50px;height:50px;border-radius:50%;float:right;background:#444;object-fit:cover;">' +
                                '<h3>' + esc(d.driver_name) + '</h3>' +
                                '<p>' + esc(d.status) + (d.license_plate ? ' | ' + esc(d.license_plate) : '') + '</p>' +
                            '</div>').join('');
                        bindDriverCards();
                    } catch (e) { console.error('Fleet refresh error:', e); }
                }

                function bindDriverCards() {
                    document.querySelectorAll('.driver-card').forEach(card => {
                        card.onclick = () => {
                            const driverName = card.dataset.driverName || '';
                            if (driverName) location.href = '/driver/' + encodeURIComponent(driverName);
                        };
                    });
                }

                async function refreshDrivers() {
                    const r = await fetch('/api/all-drivers');
                    const drivers = await r.json();
                    document.getElementById('drivers-list').innerHTML = drivers.map(d =>
                        '<tr>' +
                            '<td>' +
                                '<img src="' + esc(d.photo_url || '') + '" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;background:#444;object-fit:cover;">' +
                                '<b>' + esc(d.name) + '</b>' +
                            '</td>' +
                            '<td>' + esc(d.email || '') + '<br><small>' + esc(d.phone || '') + '</small></td>' +
                            '<td>' + esc(d.license_plate || '') + '</td>' +
                            '<td><code style="background:#444; padding:2px 5px;">' + esc(d.activation_code || '---') + '</code></td>' +
                            '<td><span style="color:' + (d.is_active ? '#2ecc71' : '#e74c3c') + '">' + (d.is_active ? 'AKTÍV' : 'INAKTÍV') + '</span></td>' +
                            '<td>' +
                                '<button data-driver="' + encodeURIComponent(JSON.stringify(d)) + '" onclick="editDriver(JSON.parse(decodeURIComponent(this.dataset.driver)))">✏</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="unlinkDriverDevices(this.dataset.uuid)" style="background:#f39c12; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">📱 leválaszt</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="deleteDriver(this.dataset.uuid)" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">🗑</button>' +
                            '</td>' +
                        '</tr>').join('');
                }

                function editDriver(d) {
                    document.getElementById('dUuid').value = d ? d.uuid : '';
                    document.getElementById('dName').value = d ? d.name : '';
                    document.getElementById('dPlate').value = d ? d.license_plate : '';
                    document.getElementById('dEmail').value = d ? d.email : '';
                    document.getElementById('dPhone').value = d ? d.phone : '';
                    document.getElementById('dWhatsapp').value = d ? d.whatsapp : '';
                    document.getElementById('dTelegram').value = d ? d.telegram : '';
                    document.getElementById('dPhoto').value = d ? d.photo_url : '';
                    document.getElementById('dPhotoPreview').src = d ? (d.photo_url || '') : '';
                    document.getElementById('dActive').checked = d ? d.is_active : true;
                    document.getElementById('driverModal').style.display = 'block';
                }

                async function uploadAdminPhoto(input) {
                    if (!input.files || !input.files[0]) return;
                    const file = input.files[0];
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const base64 = e.target.result.split(',')[1];
                        const res = await fetch('/api/upload-photo', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                uuid: document.getElementById('dUuid').value,
                                driverName: document.getElementById('dName').value,
                                imageBase64: base64
                            })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            document.getElementById('dPhotoPreview').src = data.photoUrl;
                            document.getElementById('dPhoto').value = data.photoUrl;
                            showToast('Kép feltöltve!');
                        }
                    };
                    reader.readAsDataURL(file);
                }

                async function saveDriver() {
                    const data = {
                        uuid: document.getElementById('dUuid').value || null,
                        name: document.getElementById('dName').value,
                        license_plate: document.getElementById('dPlate').value,
                        email: document.getElementById('dEmail').value,
                        phone: document.getElementById('dPhone').value,
                        whatsapp: document.getElementById('dWhatsapp').value,
                        telegram: document.getElementById('dTelegram').value,
                        photo_url: document.getElementById('dPhoto').value,
                        is_active: document.getElementById('dActive').checked
                    };
                    const r = await adminFetch('/admin/save-driver', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                    if(r.ok) {
                        showToast('Sofőr adatai mentve!');
                        document.getElementById('driverModal').style.display = 'none';
                        refreshDrivers();
                    }
                }

                async function deleteDriver(uuid) {
                    if (!confirm('Biztosan törölni szeretnéd ezt a sofőrt? Minden adata elvész!')) return;
                    const r = await adminFetch('/admin/delete-driver', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid })
                    });
                    if (r.ok) {
                        showToast('Sofőr törölve.');
                        refreshDrivers();
                    }
                }

                async function unlinkDriverDevices(uuid) {
                    if (!confirm('Leválasztod a sofőr társított telefonjait? A sofőr és az adatai megmaradnak.')) return;
                    const r = await adminFetch('/admin/unlink-driver-devices', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid })
                    });
                    if (r.ok) {
                        showToast('Telefonos társítás leválasztva.');
                        refreshDrivers();
                    }
                }

                async function importDriver() {
                    const code = document.getElementById('importCode').value.trim();
                    if (!code) return;
                    try {
                        const r = await fetch('/api/activate-driver', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ code })
                        });
                        if (r.ok) {
                            const driver = await r.json();
                            showToast('Sofőr importálva: ' + driver.name);
                            document.getElementById('importCode').value = '';
                            refreshDrivers();
                        } else {
                            alert('Érvénytelen kód vagy a sofőr már importálva van.');
                        }
                    } catch (e) { console.error('Import error:', e); }
                }

                function showToast(msg) {
                    const c = document.getElementById('toast-container');
                    const t = document.createElement('div');
                    t.className = 'toast';
                    t.innerText = msg;
                    c.appendChild(t);
                    setTimeout(() => t.remove(), 3000);
                }

                function getAdminToken() {
                    let token = localStorage.getItem('adminToken') || '';
                    if (!token) {
                        token = prompt('Admin token:') || '';
                        if (token) localStorage.setItem('adminToken', token);
                    }
                    return token;
                }

                function adminFetch(url, options = {}) {
                    const token = getAdminToken();
                    const headers = Object.assign({}, options.headers || {});
                    if (token) headers.Authorization = 'Bearer ' + token;
                    return fetch(url, Object.assign({}, options, { headers })).then(r => {
                        if (r.status === 401 || r.status === 503) {
                            localStorage.removeItem('adminToken');
                            showToast('Admin token hibás vagy hiányzik.');
                        }
                        return r;
                    });
                }

                setInterval(refreshFleet, 5000);
                bindDriverCards();
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const allD = (await pool.query('SELECT DISTINCT driver_name FROM (SELECT name as driver_name FROM drivers WHERE is_active = true UNION SELECT driver_name FROM live_updates UNION SELECT driver_name FROM tours) as d')).rows.map(r => r.driver_name).filter(n => n && n !== name);
    const update = (await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name])).rows[0] || { driver_name: name };
    const driverRes = await pool.query('SELECT * FROM drivers WHERE name = $1', [name]);
    const dInfo = driverRes.rows[0] || {};

    const costs = (await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name])).rows;
    const chat = (await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name])).rows;
    const work = (await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name])).rows;
    const toursRes = (await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [name])).rows;
    const hotelsRes = (await pool.query(`SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, name::TEXT, address::TEXT, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, timestamp::BIGINT FROM hotels WHERE driver_name = $1 UNION ALL SELECT 'stop'::TEXT as source, id::INT, uuid::TEXT, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1 AND deleted_at IS NULL) AND deleted_at IS NULL AND stop_type = 'HOTEL' ORDER BY timestamp DESC`, [name])).rows;
    for (let t of toursRes) t.stops = (await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [t.id])).rows;
    const currentTourObj = toursRes.find(t => t.is_current) || toursRes[0];
    const currentStopsJson = JSON.stringify(currentTourObj ? currentTourObj.stops : []);

    const drivingTodaySec = work
        .filter(w => w.type === 'Vezetés' && w.date === new Date().toISOString().split('T')[0])
        .reduce((sum, w) => sum + (Number(w.end_time || Date.now()) - Number(w.start_time)) / 1000, 0);

    const pageNameHtml = escapeHtml(name);
    const pageNameJs = escapeJsString(name);
    const profilePhotoHtml = escapeHtml(dInfo.photo_url || update.driver_photo || '');
    const licenseHtml = escapeHtml(dInfo.license_plate || update.license_plate || 'N/A');
    const statusHtml = escapeHtml(update.status || 'Offline');
    const currentTourHtml = escapeHtml(update.current_tour || '');
    const depotNameHtml = escapeHtml(update.depot_name || '');
    const driverEmailHtml = escapeHtml(dInfo.email || update.driver_email || '');
    const driverPhoneHtml = escapeHtml(dInfo.phone || update.driver_phone || '');
    let nextStopDetailsHtml = '';
    if (update.next_stop) {
        const nextParts = String(update.next_stop).split(' | ');
        nextStopDetailsHtml = nextParts.length > 1
            ? `<b style="display:block; margin-top:5px; color:#fff;">${escapeHtml(nextParts[0])}</b><p style="margin:2px 0; font-size:13px; color:#ccc;">${escapeHtml(nextParts.slice(1).join(' | '))}</p>`
            : `<p style="margin:5px 0; font-size:14px;">${escapeHtml(update.next_stop)}</p>`;
    }

    const html = `<html><head><title>ERP - ${pageNameHtml}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
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
        <header><button onclick="location.href='/'">⬅</button><img src="${profilePhotoHtml}" style="width:40px;height:40px;border-radius:50%;margin-left:15px;margin-right:15px;object-fit:cover;background:#333;"><h2><span>${pageNameHtml}</span> - ERP</h2></header>
        <nav>
            <button data-tab="dashboard" onclick="openTab(event, 'dashboard')">DASHBOARD</button>
            <button data-tab="tours" onclick="openTab(event, 'tours')">TÚRÁK</button>
            <button data-tab="history" onclick="openTab(event, 'history')">TÖRTÉNET</button>
            <button data-tab="costs" onclick="openTab(event, 'costs')">KÖLTSÉGEK</button>
            <button data-tab="hotels" onclick="openTab(event, 'hotels')">HOTELEK</button>
            <button data-tab="chat" onclick="openTab(event, 'chat')">CHAT</button>
            <button data-tab="stats" onclick="openTab(event, 'stats')">STATISZTIKA</button>
            <button data-tab="report" onclick="openTab(event, 'report')">MENETLEVÉL</button>
            <button data-tab="profile" onclick="openTab(event, 'profile')">PROFIL</button>
        </nav>
        <div id="dashboard" class="tab-content active" style="display:block;">
            <div style="display:grid; grid-template-columns: 1fr 300px; gap: 20px;">
                <div id="map"></div>
                <div style="background:#222; padding:20px; border-radius:8px;">
                    <h3>Státusz: <span id="live-status" style="color:#3498db">${statusHtml}</span></h3>
                    <p id="live-speed">🚗 Sebesség: ${Math.round(update.speed || 0)} km/h</p>
                    <p id="live-license">🚚 Rendszám: ${licenseHtml}</p>
                    <hr style="border-color:#444">

                    <div id="live-tour-container" style="${update.current_tour ? '' : 'display:none'}">
                        <div style="background:#333; padding:15px; border-radius:8px; margin-top:10px;">
                            <h4 style="margin:0; color:#2ecc71;">📦 Aktuális túra: <span id="live-tour-name">${currentTourHtml}</span></h4>
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
                            ${nextStopDetailsHtml}
                        </div>
                    </div>

                    ${update.depot_name ? `
                        <p style="margin-top:20px; font-size:12px; color:#999;">🏠 Depó: ${depotNameHtml}</p>
                    ` : ''}
                </div>
            </div>
        </div>
        <div id="tours" class="tab-content">
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="editTour()" style="background:#2ecc71; color:white; padding:10px;">+ Új túra</button>
                <button onclick="document.getElementById('tourExcelImport').click()" style="background:#3498db; color:white; padding:10px;">Excel import</button>
                <button onclick="location.href='/tour-import-template.xlsx'" style="background:#555; color:white; padding:10px;">Sablon letöltése</button>
                <input type="file" id="tourExcelImport" accept=".xlsx,.xls,.csv" style="display:none" onchange="importTourFromExcel(this)">
            </div>
            <div id="tours-list">
                ${toursRes.map(t => `
                    <div class="tour-card">
                        <div style="float:right; display:flex; gap:5px;">
                            <select onchange="transferTour(${t.id}, this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>${allD.map(n => "<option value='" + escapeHtml(n) + "'>" + escapeHtml(n) + "</option>").join('')}</select>
                            <button onclick="editTour(JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(t))}')))">✏</button>
                            <button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button>
                        </div>
                        <b>${escapeHtml(t.name)}</b> (${escapeHtml(t.customer || '')}) - ${new Date(Number(t.date)).toLocaleDateString()}
                        ${t.stops.map(s => {
                            const stopTitle = s.recipient || s.contact_name || s.company || s.address_full || s.address || 'Megálló';
                            const stopAddress = s.address_full || s.address || '';
                            const stopMeta = [s.time_window, s.phone_number, s.notes].filter(Boolean).map(escapeHtml).join(' | ');
                            const stopPhoto = s.photo_url || s.photoUrl || '';
                            return "<div class='stop-item'><b>" + (s.order_index + 1) + ". " + (s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')) + escapeHtml(stopTitle) + "</b>" +
                                (stopAddress ? "<br><span>" + escapeHtml(stopAddress) + "</span>" : "") +
                                (stopMeta ? "<br><small style='color:#aaa;'>" + stopMeta + "</small>" : "") +
                                (stopPhoto ? "<br><img src='" + escapeHtml(stopPhoto) + "' style='margin-top:8px;max-width:220px;max-height:140px;border-radius:6px;object-fit:cover;border:1px solid #444;'>" : "") +
                                "</div>";
                        }).join('')}
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
        <div id="costs" class="tab-content">
            <div style="background:#222; padding:15px; border-radius:8px; margin-bottom:15px;">
                <h3 style="margin-top:0;">Új költség</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px;">
                    <div><label>Összeg</label><input type="number" step="0.01" id="costAmount"></div>
                    <div><label>Pénznem</label><input type="text" id="costCurrency" value="EUR"></div>
                    <div><label>Kategória</label><select id="costCategory"><option>Tankolás</option><option>Parkolás</option><option>Matrica</option><option>Útdíj</option><option>Hotel</option><option>Szerviz</option><option>Adblue</option><option>Mosás</option><option>Egyéb</option></select></div>
                    <div><label>Km állás</label><input type="number" id="costMileage"></div>
                </div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" id="costNotes" placeholder="Megjegyzés">
                    <button onclick="saveWebCost()" style="width:160px; background:#3498db; color:white;">Mentés</button>
                </div>
            </div>
            <table><thead><tr><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th><th>Művelet</th></tr></thead><tbody id="costs-list">${costs.map(c => `<tr data-cost-id="${c.id}" data-cost-uuid="${escapeHtml(c.uuid || '')}"><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(c.amount)} ${escapeHtml(c.currency)}</td><td class="cost-status">${escapeHtml(c.status)}</td><td><button data-uuid="${escapeHtml(c.uuid || '')}" data-id="${c.id}" data-status="Elfogadva" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Elfogadás</button> <button data-uuid="${escapeHtml(c.uuid || '')}" data-id="${c.id}" data-status="Kifizetve" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Kifizetve</button></td></tr>`).join('')}</tbody></table>
        </div>
        <div id="hotels" class="tab-content">
            <div style="background:#222; padding:15px; border-radius:8px; margin-bottom:15px;">
                <h3 style="margin-top:0;" id="hotelFormTitle">Új hotel</h3>
                <input type="hidden" id="hotelSource">
                <input type="hidden" id="hotelId">
                <input type="hidden" id="hotelUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div><label>Név</label><input type="text" id="hotelName"></div>
                    <div><label>Cím</label><input type="text" id="hotelAddress"></div>
                    <div><label>Szoba</label><input type="text" id="hotelRoom"></div>
                    <div><label>Kód</label><input type="text" id="hotelCode"></div>
                    <div><label>Buchungsnummer</label><input type="text" id="hotelBooking"></div>
                    <div><label>Telefon</label><input type="text" id="hotelPhone"></div>
                    <div><label>Email</label><input type="text" id="hotelEmail"></div>
                    <div><label>Megjegyzés</label><input type="text" id="hotelNotes"></div>
                </div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button onclick="saveWebHotel()" style="width:160px; background:#3498db; color:white;">Mentés</button>
                    <button onclick="resetHotelForm()" style="width:120px;">Új adat</button>
                </div>
            </div>
            <table><thead><tr><th>Dátum</th><th>Név</th><th>Cím</th><th>Szoba</th><th>Kód</th><th>Buchungsnummer</th><th>Művelet</th></tr></thead><tbody id="hotels-list">${hotelsRes.map(h => `<tr><td>${new Date(Number(h.timestamp)).toLocaleDateString()}</td><td>${escapeHtml(h.name)}</td><td>${escapeHtml(h.address)}</td><td>${escapeHtml(h.room_number || '')}</td><td>${escapeHtml(h.entry_code || '')}</td><td>${escapeHtml(h.booking_number || '')}</td><td><button data-hotel="${escapeHtml(JSON.stringify(h))}" onclick="editHotelRecord(JSON.parse(this.dataset.hotel))">Szerkesztés</button></td></tr>`).join('')}</tbody></table>
        </div>
        <div id="chat" class="tab-content">
            <div id="chat-messages" style="height:400px; background:#111; padding:15px; overflow-y:auto; display:flex; flex-direction:column; margin-bottom:15px;">
                ${chat.map(m => `<div class="msg ${m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver'}"><b>${escapeHtml(m.sender)}:</b><br>${escapeHtml(m.message)}</div>`).join('')}
            </div>
            <div style="display:flex; gap:10px;">
                <input type="text" id="chat-input" placeholder="Üzenet írása..." onkeypress="if(event.key==='Enter') sendChat()">
                <button onclick="sendChat()" style="width:100px; background:#F57F17; color:black; font-weight:bold;">KÜLDÉS</button>
            </div>
        </div>
        <div id="stats" class="tab-content"><div id="statsBox"></div></div>
        <div id="report" class="tab-content"><h3>Tagesfahrblatt</h3><div id="timelineContainer"></div></div>
        <div id="profile" class="tab-content">
            <div style="max-width:600px; background:#222; padding:30px; border-radius:12px;">
                <h3>SOFŐR PROFIL</h3>
                <input type="hidden" id="prof-uuid" value="${escapeHtml(dInfo.uuid || '')}">
                <div id="profile-display">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="position: relative; display: inline-block;">
                            <img id="p-photo" src="${profilePhotoHtml}" style="width:120px; height:120px; border-radius:50%; background:#333; object-fit: cover; border: 2px solid #444;">
                            <label for="prof-photo-upload" style="position: absolute; bottom: 0; right: 0; background: #3498db; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid #222; font-size: 18px;">📷</label>
                            <input type="file" id="prof-photo-upload" style="display: none;" onchange="uploadWebPhoto(this)" accept="image/*">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                        <div><label>Név</label><input type="text" id="prof-name" value="${pageNameHtml}"></div>
                        <div><label>Rendszám</label><input type="text" id="prof-plate" value="${escapeHtml(dInfo.license_plate || update.license_plate || '')}"></div>
                        <div><label>Email</label><input type="text" id="prof-email" value="${driverEmailHtml}"></div>
                        <div><label>Telefon</label><input type="text" id="prof-phone" value="${driverPhoneHtml}"></div>
                        <div><label>WhatsApp</label><input type="text" id="prof-whatsapp" value="${escapeHtml(dInfo.whatsapp || '')}"></div>
                        <div><label>Telegram</label><input type="text" id="prof-telegram" value="${escapeHtml(dInfo.telegram || '')}"></div>
                    </div>
                    <div style="margin-top:20px;"><label>Profilkép URL</label><input type="text" id="prof-photo-url" value="${profilePhotoHtml}"></div>
                    <button onclick="saveProfile()" style="margin-top:30px; background:#3498db; color:white; padding:12px; width:100%;">PROFIL MENTÉSE</button>
                </div>
            </div>
        </div>
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
                <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;"><button onclick="closeModal()">Mégse</button><button onclick="saveTour(event)" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button></div>
            </div>
        </div>

        <script>
            function esc(value) {
                return String(value ?? '').replace(/[&<>"']/g, ch => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[ch]));
            }
            const DRIVER_NAME = '${pageNameJs}';

            function getAdminToken() {
                let token = localStorage.getItem('adminToken') || '';
                if (!token) {
                    token = prompt('Admin token:') || '';
                    if (token) localStorage.setItem('adminToken', token);
                }
                return token;
            }

            function adminFetch(url, options = {}) {
                const token = getAdminToken();
                const headers = Object.assign({}, options.headers || {});
                if (token) headers.Authorization = 'Bearer ' + token;
                return fetch(url, Object.assign({}, options, { headers })).then(r => {
                    if (r.status === 401 || r.status === 503) {
                        localStorage.removeItem('adminToken');
                        showToast('Admin token hibás vagy hiányzik.');
                    }
                    return r;
                });
            }

            function openTab(e, t) {
                localStorage.setItem('activeTab_' + DRIVER_NAME, t);
                document.querySelectorAll('.tab-content').forEach(x => {
                    x.style.display = 'none';
                    x.classList.remove('active');
                });
                document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
                const target = document.getElementById(t);
                if (target) {
                    target.style.display = 'block';
                    target.classList.add('active');
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
                    if (t === 'stats') {
                        loadStats();
                    }
                    if (t === 'hotels') {
                        refreshHotels();
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
                    const r = await fetch('/api/get-history/' + encodeURIComponent(DRIVER_NAME) + '/' + date);
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
            const savedTab = localStorage.getItem('activeTab_' + DRIVER_NAME) || 'dashboard';

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

            function formatStatDuration(seconds) {
                const safeSeconds = Number(seconds || 0);
                let mins = Math.round(safeSeconds / 60);
                const hours = Math.floor(mins / 60);
                mins = mins % 60;
                return hours + ':' + mins.toString().padStart(2, '0');
            }

            async function loadStats() {
                const box = document.getElementById('statsBox');
                if (!box) return;
                box.innerHTML = '<p style="color:#aaa;">Statisztika betöltése...</p>';
                try {
                    const r = await fetch('/api/stats/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) throw new Error(await r.text());
                    const s = await r.json();
                    box.innerHTML =
                        '<h3 style="margin-top:0;">Statisztika - ' + esc(s.month || '') + '</h3>' +
                        '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:15px;">' +
                            statCard('Mai munkaidő', formatStatDuration(s.workTodaySeconds)) +
                            statCard('Mai vezetés', formatStatDuration(s.drivingTodaySeconds)) +
                            statCard('Mai pihenő', formatStatDuration(s.restTodaySeconds)) +
                            statCard('Havi munkaidő', formatStatDuration(s.workMonthSeconds)) +
                            statCard('Havi vezetés', formatStatDuration(s.drivingMonthSeconds)) +
                            statCard('Havi pihenő', formatStatDuration(s.restMonthSeconds)) +
                            statCard('Havi költség', Number(s.costMonthTotal || 0).toFixed(2) + ' EUR') +
                            statCard('Költség tételek', s.costMonthCount || 0) +
                            statCard('Havi túrák', s.tourMonthCount || 0) +
                        '</div>';
                } catch (e) {
                    box.innerHTML = '<p style="color:#e74c3c;">Nem sikerült betölteni a statisztikát.</p>';
                    console.error('Stats error:', e);
                }
            }

            function statCard(label, value) {
                return '<div style="background:#222; padding:18px; border-radius:8px;">' +
                    '<div style="font-size:12px; color:#aaa; text-transform:uppercase;">' + esc(label) + '</div>' +
                    '<div style="font-size:24px; font-weight:bold; margin-top:8px;">' + esc(value) + '</div>' +
                '</div>';
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
            }).addTo(map).bindPopup('<b>' + esc(DRIVER_NAME) + '</b><br><span id="popup-speed">Sebesség: ${Math.round(update.speed || 0)} km/h</span>');

            let routeLayer = null;
            const stopMarkerLayer = L.layerGroup().addTo(map);
            let lastNextLat = ${update.next_lat || 0};
            let lastNextLng = ${update.next_lng || 0};

            async function drawRoute(currentLat, currentLng, stops, depotLat, depotLng) {
                const incompleteStops = (stops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
                let waypoints = [[currentLat, currentLng]];

                incompleteStops.forEach(s => {
                    waypoints.push([s.latitude, s.longitude]);
                });

                if (depotLat != null && depotLat !== 0 && !isNaN(depotLat)) {
                    waypoints.push([depotLat, depotLng]);
                }

                if (waypoints.length > 1) {
                    try {
                        const waypointStr = waypoints.map(w => w[1] + ',' + w[0]).join(';');
                        const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson');
                        const data = await r.json();
                        if (data.routes && data.routes[0]) {
                            if (routeLayer) map.removeLayer(routeLayer);
                            routeLayer = L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.7 } }).addTo(map);
                        }
                    } catch (e) { console.error('Route error:', e); }
                } else if (routeLayer) {
                    map.removeLayer(routeLayer);
                    routeLayer = null;
                }
            }

            function renderStopMarkers(stops) {
                stopMarkerLayer.clearLayers();
                (stops || []).forEach(s => {
                    if (s.latitude && s.longitude) {
                        const order = Number(s.order_index || 0) + 1;
                        const icon = L.divIcon({
                            className: 'custom-div-icon',
                            html: "<div style='background-color:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid white;'>" + order + "</div>",
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([s.latitude, s.longitude], { icon: icon }).addTo(stopMarkerLayer)
                            .bindPopup(order + '. ' + (s.recipient || s.address_full || s.address || 'Megálló'));
                    }
                });
            }

            async function refreshMapTour() {
                try {
                    const r = await fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const tourData = data.find(item => item.tour.is_current) || (data.length > 0 ? data[0] : null);
                    const stops = tourData ? tourData.stops : [];
                    const pos = driverMarker.getLatLng();
                    const dLat = (tourData && tourData.tour.depot_lat) ? tourData.tour.depot_lat : 0;
                    const dLng = (tourData && tourData.tour.depot_lng) ? tourData.tour.depot_lng : 0;
                    drawRoute(pos.lat, pos.lng, stops, dLat, dLng);
                    renderStopMarkers(stops);
                } catch (e) { console.error('Map tour refresh error:', e); }
            }

            // Kezdeti útvonal
            const rawStops = ${currentStopsJson};
            const tourDepotLat = ${currentTourObj ? currentTourObj.depot_lat || 0 : 0};
            const tourDepotLng = ${currentTourObj ? currentTourObj.depot_lng || 0 : 0};

            if (rawStops && rawStops.length > 0) {
                drawRoute(driverLat, driverLng, rawStops, tourDepotLat, tourDepotLng);
            }

            async function refreshLiveStatus() {
                try {
                    const r = await fetch('/api/live-status/' + encodeURIComponent(DRIVER_NAME));
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

                        const nDist = (d.next_stop_dist !== null && d.next_stop_dist !== undefined) ? d.next_stop_dist : 0;
                        const tDist = (d.tour_remaining_dist !== null && d.tour_remaining_dist !== undefined) ? d.tour_remaining_dist : 0;

                        document.getElementById('live-next-dist').innerText = nDist.toFixed(1) + ' km';
                        document.getElementById('live-tour-dist').innerText = tDist.toFixed(1) + ' km';
                    } else {
                        document.getElementById('live-tour-container').style.display = 'none';
                        document.getElementById('no-tour-msg').style.display = 'block';
                    }

                    if (d.next_stop) {
                        document.getElementById('live-next-stop-container').style.display = 'block';
                        let html = '';
                        if (d.next_stop.includes(' | ')) {
                            const nextParts = d.next_stop.split(' | ');
                            html = '<b style="display:block; margin-top:5px; color:#fff;">' + esc(nextParts[0]) + '</b>' +
                                   '<p style="margin:2px 0; font-size:13px; color:#ccc;">' + esc(nextParts.slice(1).join(' | ')) + '</p>';
                        } else {
                            html = '<p style="margin:5px 0; font-size:14px;">' + esc(d.next_stop) + '</p>';
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
                        driverMarker.setPopupContent('<b>' + esc(DRIVER_NAME) + '</b><br>Sebesség: ' + Math.round(d.speed || 0) + ' km/h');

                        // Útvonal frissítése ha mozog vagy a célpont változott
                        if (d.next_lat !== lastNextLat || d.next_lng !== lastNextLng || Math.abs(d.latitude - lastUpdateLat) > 0.0005) {
                            lastNextLat = d.next_lat;
                            lastNextLng = d.next_lng;
                            lastUpdateLat = d.latitude;
                            lastUpdateLng = d.longitude;
                            refreshTours();
                            fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME))
                                .then(r => r.json())
                                .then(data => {
                                    const tourData = data.find(item => item.tour.is_current) || (data.length > 0 ? data[0] : null);
                                    const stops = tourData ? tourData.stops : [];
                                    const dLat = (tourData && tourData.tour.depot_lat) ? tourData.tour.depot_lat : d.depot_lat;
                                    const dLng = (tourData && tourData.tour.depot_lng) ? tourData.tour.depot_lng : d.depot_lng;
                                    drawRoute(d.latitude, d.longitude, stops, dLat, dLng);
                                    renderStopMarkers(stops);
                                });
                        }
                    }
                } catch (e) { console.error('Refresh error:', e); }
            }

            // Inicializálás
            let lastUpdateLat = driverLat;
            let lastUpdateLng = driverLng;

            refreshLiveStatus();
            refreshTours();
            refreshChat();
            openTab(null, savedTab);

            setInterval(refreshLiveStatus, 5000);
            setInterval(refreshMapTour, 15000);

            // Túra állomások
            const bounds = L.latLngBounds([driverLat, driverLng]);

            renderStopMarkers(rawStops);
            if (rawStops) {
                rawStops.forEach(s => {
                    if (s.latitude && s.longitude) bounds.extend([s.latitude, s.longitude]);
                });
            }

            // Depó marker
            if (${update.depot_lat != null && update.depot_lat !== 0 ? 'true' : 'false'}) {
                const depotIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: "<div style='background-color:#2ecc71; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid white;'>🏠</div>",
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                L.marker([${update.depot_lat || 0}, ${update.depot_lng || 0}], { icon: depotIcon }).addTo(map).bindPopup('🏠 Depó: ${escapeJsString(update.depot_name || 'Bázis')}');
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
            const currentTourData = ${JSON.stringify(currentTourObj || (toursRes.length > 0 ? toursRes[0] : null))};
            const incompleteStops = (rawStops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
            let waypointStr = driverLng + ',' + driverLat;

            incompleteStops.forEach(s => {
                waypointStr += ';' + s.longitude + ',' + s.latitude;
            });

            const initialDepotLat = (currentTourData && currentTourData.depot_lat) ? currentTourData.depot_lat : ${update.depot_lat || 0};
            const initialDepotLng = (currentTourData && currentTourData.depot_lng) ? currentTourData.depot_lng : ${update.depot_lng || 0};

            if (initialDepotLat != null && initialDepotLat !== 0) {
                waypointStr += ';' + initialDepotLng + ',' + initialDepotLat;
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

            // Profile & Driver Admin JS
            async function loadProfile() {
                try {
                    const r = await fetch('/api/get-profile/' + encodeURIComponent(DRIVER_NAME));
                    if (r.ok) {
                        const d = await r.json();
                        document.getElementById('prof-whatsapp').value = d.whatsapp || '';
                        document.getElementById('prof-telegram').value = d.telegram || '';
                        if (d.photo_url) {
                            document.getElementById('p-photo').src = d.photo_url;
                            document.getElementById('prof-photo-url').value = d.photo_url;
                        }
                    }
                } catch(e) {}
            }
            loadProfile();

            async function saveProfile() {
                const data = {
                    uuid: document.getElementById('prof-uuid').value,
                    name: document.getElementById('prof-name').value,
                    licensePlate: document.getElementById('prof-plate').value,
                    email: document.getElementById('prof-email').value,
                    phone: document.getElementById('prof-phone').value,
                    whatsapp: document.getElementById('prof-whatsapp').value,
                    telegram: document.getElementById('prof-telegram').value,
                    photoUrl: document.getElementById('prof-photo-url').value
                };
                const r = await fetch('/api/sync-profile', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(r.ok) {
                    showToast('Profil mentve és szinkronizálva!');
                    if (data.name !== DRIVER_NAME) {
                        setTimeout(() => location.href = '/driver/' + encodeURIComponent(data.name), 1000);
                    }
                }
            }

            async function uploadWebPhoto(input) {
                if (!input.files || !input.files[0]) return;
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result.split(',')[1];
                    const res = await fetch('/api/upload-photo', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            uuid: document.getElementById('prof-uuid').value,
                            driverName: document.getElementById('prof-name').value,
                            imageBase64: base64
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('p-photo').src = data.photoUrl;
                        document.getElementById('prof-photo-url').value = data.photoUrl;
                        showToast('Kép sikeresen feltöltve!');
                    }
                };
                reader.readAsDataURL(file);
            }

            async function refreshDrivers() {
                try {
                    const r = await fetch('/api/all-drivers');
                    const drivers = await r.json();
                    const container = document.getElementById('drivers-list');
                    if (!container) return;
                    container.innerHTML = drivers.map(d =>
                        '<tr>' +
                            '<td><b>' + esc(d.name) + '</b></td>' +
                            '<td>' + esc(d.email || '') + '<br><small>' + esc(d.phone || '') + '</small></td>' +
                            '<td>' + esc(d.license_plate || '') + '</td>' +
                            '<td><code style="background:#444; padding:2px 5px;">' + esc(d.activation_code || '---') + '</code></td>' +
                            '<td><span style="color:' + (d.is_active ? '#2ecc71' : '#e74c3c') + '">' + (d.is_active ? 'AKTÍV' : 'INAKTÍV') + '</span></td>' +
                            '<td>' +
                                '<button data-driver="' + encodeURIComponent(JSON.stringify(d)) + '" onclick="editDriver(JSON.parse(decodeURIComponent(this.dataset.driver)))">✏</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="unlinkDriverDevices(this.dataset.uuid)" style="background:#f39c12; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">📱 leválaszt</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="deleteDriver(this.dataset.uuid)" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">🗑</button>' +
                            '</td>' +
                        '</tr>').join('');
                } catch(e) { console.error('refreshDrivers error:', e); }
            }
            refreshDrivers();

            async function deleteDriver(uuid) {
                if (!confirm('Biztosan törölni szeretnéd ezt a sofőrt? Minden adata elvész!')) return;
                const r = await adminFetch('/admin/delete-driver', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ uuid })
                });
                if (r.ok) {
                    showToast('Sofőr törölve.');
                    refreshDrivers();
                }
            }

            async function unlinkDriverDevices(uuid) {
                if (!confirm('Leválasztod a sofőr társított telefonjait? A sofőr és az adatai megmaradnak.')) return;
                const r = await adminFetch('/admin/unlink-driver-devices', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ uuid })
                });
                if (r.ok) {
                    showToast('Telefonos társítás leválasztva.');
                    refreshDrivers();
                }
            }

            function editDriver(d) {
                document.getElementById('dUuid').value = d ? d.uuid : '';
                document.getElementById('dName').value = d ? d.name : '';
                document.getElementById('dPlate').value = d ? d.license_plate : '';
                document.getElementById('dEmail').value = d ? d.email : '';
                document.getElementById('dPhone').value = d ? d.phone : '';
                document.getElementById('dWhatsapp').value = d ? d.whatsapp : '';
                document.getElementById('dTelegram').value = d ? d.telegram : '';
                document.getElementById('dPhoto').value = d ? d.photo_url : '';
                document.getElementById('dActive').checked = d ? d.is_active : true;
                document.getElementById('driverModal').style.display = 'block';
            }

            async function saveDriver() {
                const data = {
                    uuid: document.getElementById('dUuid').value || null,
                    name: document.getElementById('dName').value,
                    license_plate: document.getElementById('dPlate').value,
                    email: document.getElementById('dEmail').value,
                    phone: document.getElementById('dPhone').value,
                    whatsapp: document.getElementById('dWhatsapp').value,
                    telegram: document.getElementById('dTelegram').value,
                    photo_url: document.getElementById('dPhoto').value,
                    is_active: document.getElementById('dActive').checked
                };
                const r = await adminFetch('/admin/save-driver', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(r.ok) {
                    showToast('Sofőr adatai mentve!');
                    document.getElementById('driverModal').style.display = 'none';
                    refreshDrivers();
                }
            }

            async function importDriver() {
                const code = document.getElementById('importCode').value.trim();
                if (!code) return;
                try {
                    const r = await fetch('/api/activate-driver', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ code })
                    });
                    if (r.ok) {
                        const driver = await r.json();
                        showToast('Sofőr importálva: ' + driver.name);
                        document.getElementById('importCode').value = '';
                        refreshDrivers();
                    } else {
                        alert('Érvénytelen kód vagy a sofőr már importálva van.');
                    }
                } catch (e) { console.error('Import error:', e); }
            }

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
                    const r = await fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('tours-list');
                    if (!container) return;

                    const allDNames = ${JSON.stringify(allD)};

                    container.innerHTML = data.map(item => {
                        const t = item.tour;
                        const stops = item.stops;
                        return '<div class="tour-card">' +
                            '<div style="float:right; display:flex; gap:5px;">' +
                                '<select onchange="transferTour(' + t.id + ', this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>' + allDNames.map(n => "<option value='" + esc(n) + "'>" + esc(n) + "</option>").join('') + '</select>' +
                                '<button data-tour="' + encodeURIComponent(JSON.stringify(Object.assign({}, t, { stops }))) + '" onclick="editTour(JSON.parse(decodeURIComponent(this.dataset.tour)))">✏</button>' +
                                '<button onclick="deleteTour(' + t.id + ')" style="background:#e74c3c; color:white;">🗑</button>' +
                            '</div>' +
                            '<b>' + esc(t.name) + '</b> (' + esc(t.customer || '') + ') - ' + new Date(Number(t.date)).toLocaleDateString() + ' ' +
                            stops.map(renderTourStop).join('') +
                        '</div>';
                    }).join('');
                } catch (e) { console.error('Refresh tours error:', e); }
            }

            function renderTourStop(s) {
                const stopTitle = s.recipient || s.contact_name || s.company || s.address_full || s.address || 'Megálló';
                const stopAddress = s.address_full || s.address || '';
                const stopMeta = [s.time_window, s.phone_number, s.notes].filter(Boolean).map(esc).join(' | ');
                const stopPhoto = s.photo_url || s.photoUrl || '';
                return "<div class='stop-item'><b>" + (s.order_index + 1) + ". " + (s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')) + esc(stopTitle) + "</b>" +
                    (stopAddress ? "<br><span>" + esc(stopAddress) + "</span>" : "") +
                    (stopMeta ? "<br><small style='color:#aaa;'>" + stopMeta + "</small>" : "") +
                    (stopPhoto ? "<br><img src='" + esc(stopPhoto) + "' style='margin-top:8px;max-width:220px;max-height:140px;border-radius:6px;object-fit:cover;border:1px solid #444;'>" : "") +
                    "</div>";
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
                            driverName: DRIVER_NAME,
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
                    const r = await fetch('/api/get-chat/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('chat-messages');
                    if (!container) return;
                    container.innerHTML = data.map(m =>
                        '<div class="msg ' + (m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver') + '">' +
                            '<b>' + esc(m.sender) + ':</b><br>' + esc(m.message) +
                        '</div>').join('');
                    container.scrollTop = container.scrollHeight;
                } catch (e) { console.error('Refresh chat error:', e); }
            }

            setInterval(refreshChat, 3000);

            function renderCostRow(c) {
                const id = Number(c.id || 0);
                const uuid = c.uuid || '';
                return '<tr data-cost-id="' + id + '" data-cost-uuid="' + esc(uuid) + '">' +
                    '<td>' + new Date(Number(c.timestamp || Date.now())).toLocaleDateString() + '</td>' +
                    '<td>' + esc(c.category || '') + '</td>' +
                    '<td>' + esc(c.amount || 0) + ' ' + esc(c.currency || 'EUR') + '</td>' +
                    '<td class="cost-status">' + esc(c.status || 'Rögzítve') + '</td>' +
                    '<td><button data-uuid="' + esc(uuid) + '" data-id="' + id + '" data-status="Elfogadva" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Elfogadás</button> ' +
                    '<button data-uuid="' + esc(uuid) + '" data-id="' + id + '" data-status="Kifizetve" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Kifizetve</button></td>' +
                '</tr>';
            }

            function renderHotelRow(h) {
                const payload = esc(JSON.stringify(h || {}));
                return '<tr>' +
                    '<td>' + new Date(Number(h.timestamp || Date.now())).toLocaleDateString() + '</td>' +
                    '<td>' + esc(h.name || '') + '</td>' +
                    '<td>' + esc(h.address || '') + '</td>' +
                    '<td>' + esc(h.room_number || h.roomNumber || '') + '</td>' +
                    '<td>' + esc(h.entry_code || h.entryCode || '') + '</td>' +
                    '<td>' + esc(h.booking_number || h.bookingNumber || '') + '</td>' +
                    '<td><button data-hotel="' + payload + '" onclick="editHotelRecord(JSON.parse(this.dataset.hotel))">Szerkesztés</button></td>' +
                '</tr>';
            }

            function resetHotelForm() {
                document.getElementById('hotelFormTitle').innerText = 'Új hotel';
                ['hotelSource', 'hotelId', 'hotelUuid', 'hotelName', 'hotelAddress', 'hotelRoom', 'hotelCode', 'hotelBooking', 'hotelPhone', 'hotelEmail', 'hotelNotes'].forEach(id => {
                    document.getElementById(id).value = '';
                });
            }

            function editHotelRecord(h) {
                document.getElementById('hotelFormTitle').innerText = h.source === 'stop' ? 'Túrához tartozó hotel szerkesztése' : 'Hotel szerkesztése';
                document.getElementById('hotelSource').value = h.source || 'hotel';
                document.getElementById('hotelId').value = h.id || '';
                document.getElementById('hotelUuid').value = h.uuid || '';
                document.getElementById('hotelName').value = h.name || '';
                document.getElementById('hotelAddress').value = h.address || '';
                document.getElementById('hotelRoom').value = h.room_number || h.roomNumber || '';
                document.getElementById('hotelCode').value = h.entry_code || h.entryCode || '';
                document.getElementById('hotelBooking').value = h.booking_number || h.bookingNumber || '';
                document.getElementById('hotelPhone').value = h.phone_number || h.phoneNumber || '';
                document.getElementById('hotelEmail').value = h.email || '';
                document.getElementById('hotelNotes').value = h.notes || '';
                document.getElementById('hotelName').focus();
            }

            async function refreshHotels() {
                try {
                    const r = await fetch('/api/get-hotels/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const list = document.getElementById('hotels-list');
                    if (list) list.innerHTML = data.map(renderHotelRow).join('');
                } catch (e) {
                    console.error('Refresh hotels error:', e);
                }
            }

            async function saveWebHotel() {
                const name = document.getElementById('hotelName').value.trim();
                if (!name) {
                    showToast('Adj meg hotel nevet.');
                    return;
                }
                const payload = {
                    source: document.getElementById('hotelSource').value || 'hotel',
                    id: document.getElementById('hotelId').value || null,
                    uuid: document.getElementById('hotelUuid').value || null,
                    driverName: DRIVER_NAME,
                    name,
                    address: document.getElementById('hotelAddress').value || '',
                    roomNumber: document.getElementById('hotelRoom').value || '',
                    entryCode: document.getElementById('hotelCode').value || '',
                    bookingNumber: document.getElementById('hotelBooking').value || '',
                    phoneNumber: document.getElementById('hotelPhone').value || '',
                    email: document.getElementById('hotelEmail').value || '',
                    notes: document.getElementById('hotelNotes').value || '',
                    timestamp: Date.now()
                };
                try {
                    const r = await adminFetch('/admin/save-hotel-record', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    if (!r.ok) {
                        showToast('Nem sikerült menteni a hotelt.');
                        return;
                    }
                    const saved = await r.json();
                    resetHotelForm();
                    refreshHotels();
                    showToast('Hotel mentve.');
                } catch (e) {
                    console.error('Save hotel error:', e);
                    showToast('Hiba a hotel mentésekor.');
                }
            }

            async function saveWebCost() {
                const amount = Number(document.getElementById('costAmount').value);
                if (!amount || amount <= 0) {
                    showToast('Adj meg érvényes összeget.');
                    return;
                }
                const payload = {
                    driverName: DRIVER_NAME,
                    amount,
                    currency: document.getElementById('costCurrency').value || 'EUR',
                    category: document.getElementById('costCategory').value || 'Egyéb',
                    notes: document.getElementById('costNotes').value || '',
                    mileage: document.getElementById('costMileage').value || null,
                    timestamp: Date.now()
                };
                try {
                    const r = await adminFetch('/admin/save-cost', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    if (!r.ok) {
                        showToast('Nem sikerült menteni a költséget.');
                        return;
                    }
                    const saved = await r.json();
                    document.getElementById('costs-list').insertAdjacentHTML('afterbegin', renderCostRow(saved));
                    document.getElementById('costAmount').value = '';
                    document.getElementById('costMileage').value = '';
                    document.getElementById('costNotes').value = '';
                    showToast('Költség mentve.');
                } catch (e) {
                    console.error('Save cost error:', e);
                    showToast('Hiba a költség mentésekor.');
                }
            }

            async function updateCostStatus(uuid, id, status) {
                try {
                    const r = await adminFetch('/admin/update-cost-status', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid: uuid || null, id, status })
                    });
                    if (!r.ok) {
                        showToast('Nem sikerult frissiteni a koltseg statuszat.');
                        return;
                    }
                    const row = document.querySelector('tr[data-cost-id="' + id + '"]');
                    if (row) row.querySelector('.cost-status').innerText = status;
                    showToast('Koltseg statusz frissitve.');
                } catch (e) {
                    console.error('Cost status error:', e);
                }
            }

            function pickColumn(row, names) {
                const keys = Object.keys(row || {});
                for (const name of names) {
                    const found = keys.find(k => k.trim().toLowerCase() === name.trim().toLowerCase());
                    if (found !== undefined && row[found] !== undefined && row[found] !== null) return String(row[found]).trim();
                }
                return '';
            }

            function excelDateToTimestamp(value) {
                if (!value) return Date.now();
                if (typeof value === 'number' && window.XLSX && XLSX.SSF) {
                    const parsed = XLSX.SSF.parse_date_code(value);
                    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
                }
                const text = String(value).trim();
                const parts = text.match(/^(\\d{4})[-.\\/](\\d{1,2})[-.\\/](\\d{1,2})/);
                if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
                const parsedDate = new Date(text);
                return Number.isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime();
            }

            async function importTourFromExcel(input) {
                const file = input.files && input.files[0];
                input.value = '';
                if (!file) return;
                if (!window.XLSX) {
                    showToast('Az Excel import könyvtár nem töltődött be.');
                    return;
                }
                try {
                    const buffer = await file.arrayBuffer();
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    if (!rows.length) {
                        showToast('Az Excel fájl üres.');
                        return;
                    }
                    const first = rows[0];
                    const tourName = pickColumn(first, ['Túra neve', 'Tura neve', 'Tour name', 'TourName', 'Name']) || file.name.replace(/\\.[^.]+$/, '');
                    const customer = pickColumn(first, ['Megrendelő', 'Megrendelo', 'Customer', 'Kunde']);
                    const tourDate = excelDateToTimestamp(pickColumn(first, ['Dátum', 'Datum', 'Date', 'Tour date']));

                    const stops = rows.map((row, index) => {
                        const street = pickColumn(row, ['Utca', 'Street', 'Straße', 'Strasse']);
                        const house = pickColumn(row, ['Házszám', 'Hazszam', 'House number', 'Hausnummer']);
                        const postal = pickColumn(row, ['Irányítószám', 'Iranyitoszam', 'Irsz', 'Postal code', 'PLZ']);
                        const city = pickColumn(row, ['Város', 'Varos', 'City', 'Ort']);
                        const addressFull = pickColumn(row, ['Teljes cím', 'Teljes cim', 'Address full', 'Address', 'Cím', 'Cim']) ||
                            ([street, house].filter(Boolean).join(' ') + ([postal, city].filter(Boolean).length ? ', ' + [postal, city].filter(Boolean).join(' ') : '')).trim();
                        return {
                            uuid: null,
                            recipient: pickColumn(row, ['Címzett', 'Cimzett', 'Recipient', 'Empfänger', 'Empfaenger', 'Kontakt']),
                            company: pickColumn(row, ['Cég', 'Ceg', 'Company', 'Firma']),
                            street,
                            house_number: house,
                            postal_code: postal,
                            city,
                            address_full: addressFull,
                            contact_name: pickColumn(row, ['Kapcsolattartó', 'Kapcsolattarto', 'Contact name']),
                            phone_number: pickColumn(row, ['Telefon', 'Phone', 'Telefonnummer']),
                            email: pickColumn(row, ['Email', 'E-mail']),
                            room_number: pickColumn(row, ['Szoba', 'Room', 'Zimmer']),
                            entry_code: pickColumn(row, ['Belépőkód', 'Belepokod', 'Entry code', 'Code']),
                            booking_number: pickColumn(row, ['Buchungsnummer', 'Foglalási szám', 'Foglalasi szam', 'Booking number']),
                            time_window: pickColumn(row, ['Időablak', 'Idoablak', 'Time window', 'Zeitfenster']),
                            notes: pickColumn(row, ['Megjegyzés', 'Megjegyzes', 'Notes', 'Notiz']),
                            stop_type: (pickColumn(row, ['Típus', 'Tipus', 'Stop type', 'Type']) || 'DELIVERY').toUpperCase(),
                            order_index: index,
                            latitude: null,
                            longitude: null
                        };
                    }).filter(s => s.recipient || s.company || s.address_full || s.street || s.city);

                    if (!stops.length) {
                        showToast('Nem találtam importálható címsort.');
                        return;
                    }

                    const data = {
                        id: null,
                        uuid: null,
                        driver_name: DRIVER_NAME,
                        name: tourName,
                        customer,
                        date: tourDate,
                        is_current: true,
                        notes: pickColumn(first, ['Túra megjegyzés', 'Tura megjegyzes', 'Tour notes']),
                        depot_name: pickColumn(first, ['Depó név', 'Depo nev', 'Depot name']),
                        depot_company: pickColumn(first, ['Depó cég', 'Depo ceg', 'Depot company']),
                        depot_street: pickColumn(first, ['Depó utca', 'Depo utca', 'Depot street']),
                        depot_house_number: pickColumn(first, ['Depó házszám', 'Depo hazszam', 'Depot house number']),
                        depot_postal_code: pickColumn(first, ['Depó irsz', 'Depo irsz', 'Depot postal code']),
                        depot_city: pickColumn(first, ['Depó város', 'Depo varos', 'Depot city']),
                        depot_lat: null,
                        depot_lng: null,
                        stops
                    };

                    const res = await adminFetch('/admin/save-tour', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    });
                    if (res.ok) {
                        showToast('Excel túra importálva.');
                        refreshTours();
                    } else {
                        showToast('Nem sikerült importálni az Excel túrát.');
                    }
                } catch (e) {
                    console.error('Excel import error:', e);
                    showToast('Hiba az Excel import során.');
                }
            }

            function transferTour(tourId, newDriverName) { if (!newDriverName) return; if (confirm('Áthelyezed ' + newDriverName + ' részére?')) adminFetch('/admin/transfer-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tourId, newDriverName }) }).then(r => { if(r.ok) { showToast('Túra sikeresen áthelyezve!'); refreshTours(); } }); }
            function deleteTour(id) { if(confirm('Törlöd?')) adminFetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) }).then(r => { if(r.ok) { showToast('Túra törölve!'); refreshTours(); } }); }
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

            function normalizeStopForEditor(s) {
                const src = s || {};
                const n = {
                    uuid: src.uuid || '',
                    recipient: src.recipient || src.contact_name || src.contactName || '',
                    company: src.company || '',
                    street: src.street || '',
                    house_number: src.house_number || src.houseNumber || '',
                    postal_code: src.postal_code || src.postalCode || '',
                    city: src.city || '',
                    state: src.state || '',
                    country: src.country || '',
                    address_full: src.address_full || src.addressFull || src.address || '',
                    phone_number: src.phone_number || src.phoneNumber || '',
                    email: src.email || '',
                    time_window: src.time_window || src.timeWindow || '',
                    notes: src.notes || '',
                    stop_type: src.stop_type || src.stopType || 'DELIVERY',
                    room_number: src.room_number || src.roomNumber || '',
                    entry_code: src.entry_code || src.entryCode || '',
                    booking_number: src.booking_number || src.bookingNumber || '',
                    latitude: src.latitude || '',
                    longitude: src.longitude || '',
                    items: src.items || null
                };
                if ((!n.street || !n.city) && n.address_full) {
                    const match = String(n.address_full).match(/^(.+?)\s+([^,\s]+)\s*,\s*(\d{4,6})\s+(.+)$/);
                    if (match) {
                        n.street = n.street || match[1];
                        n.house_number = n.house_number || match[2];
                        n.postal_code = n.postal_code || match[3];
                        n.city = n.city || match[4];
                    } else if (!n.street) {
                        n.street = n.address_full;
                    }
                }
                return n;
            }

            function addStopRow(s) {
                s = normalizeStopForEditor(s);
                const d = document.createElement('div'); d.className = 'stop-edit-row'; d.style = 'border:1px solid #444; padding:15px; margin-bottom:15px; border-radius:8px; position:relative;';
                const uuid = s.uuid || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : null);
                const items = s.items ? (Array.isArray(s.items) ? s.items : [s.items]) : [{ recipient: s.recipient, notes: s.notes, stop_type: s.stop_type }];
                const mainItem = items[0] || {};
                d.dataset.lat = s.latitude || '';
                d.dataset.lng = s.longitude || '';
                d.innerHTML = '<button onclick="this.parentElement.remove()" style="position:absolute; right:10px; top:10px; background:#e74c3c; border:none; color:white; padding:5px 10px; border-radius:4px; cursor:pointer;">X</button>' +
                    '<input type="hidden" class="stop-uuid" value="' + esc(uuid || '') + '">' +
                    '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                        '<div><label>Címzett</label><input type="text" class="stop-recipient" value="' + esc(mainItem.recipient || s.recipient || '') + '"></div>' +
                        '<div><label>Cég</label><input type="text" class="stop-company" value="' + esc(s.company || '') + '"></div>' +
                    '</div>' +
                    '<div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:5px;">' +
                        '<div><label>Utca</label><input type="text" class="stop-street" value="' + esc(s.street || '') + '"></div>' +
                        '<div><label>Házszám</label><input type="text" class="stop-house" value="' + esc(s.house_number || '') + '"></div>' +
                    '</div>' +
                    '<div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:5px;">' +
                        '<div><label>Irsz</label><input type="text" class="stop-postal" value="' + esc(s.postal_code || '') + '"></div>' +
                        '<div><label>Város</label><input type="text" class="stop-city" value="' + esc(s.city || '') + '"></div>' +
                    '</div>' +
                    '<div style="margin-top:10px;"><label>Típus</label><select class="stop-type"><option value="DELIVERY" ' + ((mainItem.stop_type || s.stop_type)==='DELIVERY'?'selected':'') + '>DELIVERY</option><option value="PICKUP" ' + ((mainItem.stop_type || s.stop_type)==='PICKUP'?'selected':'') + '>PICKUP</option><option value="HOTEL" ' + ((mainItem.stop_type || s.stop_type)==='HOTEL'?'selected':'') + '>HOTEL</option></select></div>' +
                    '<div class="stop-hotel-fields" style="display:none; margin-top:10px; padding:10px; background:#2b2b2b; border-radius:6px;">' +
                        '<b style="display:block; margin-bottom:8px; color:#3498db;">Hotel adatok</b>' +
                        '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">' +
                            '<div><label>Szoba</label><input type="text" class="stop-room" value="' + esc(mainItem.room_number || s.room_number || '') + '"></div>' +
                            '<div><label>Belépőkód</label><input type="text" class="stop-entry-code" value="' + esc(mainItem.entry_code || s.entry_code || '') + '"></div>' +
                            '<div><label>Buchungsnummer</label><input type="text" class="stop-booking" value="' + esc(mainItem.booking_number || s.booking_number || '') + '"></div>' +
                        '</div>' +
                        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:8px;">' +
                            '<div><label>Telefon</label><input type="text" class="stop-phone" value="' + esc(mainItem.phone_number || s.phone_number || '') + '"></div>' +
                            '<div><label>Email</label><input type="text" class="stop-email" value="' + esc(mainItem.email || s.email || '') + '"></div>' +
                        '</div>' +
                        '<div style="margin-top:8px;"><label>Hotel megjegyzés</label><input type="text" class="stop-notes" value="' + esc(mainItem.notes || s.notes || '') + '"></div>' +
                    '</div>';
                document.getElementById('modalStops').appendChild(d);
                d.querySelector('.stop-type').addEventListener('change', () => toggleStopHotelFields(d));
                toggleStopHotelFields(d);
            }

            function toggleStopHotelFields(row) {
                if (!row) return;
                const fields = row.querySelector('.stop-hotel-fields');
                const type = row.querySelector('.stop-type')?.value;
                if (fields) fields.style.display = type === 'HOTEL' ? 'block' : 'none';
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

            async function saveTour(evt) {
                const btn = evt?.target;
                const oldText = btn?.innerText || 'Mentés';
                if (btn) {
                    btn.innerText = 'Mentés... (Geocoding)';
                    btn.disabled = true;
                }

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
                    const street = r.querySelector('.stop-street').value;
                    const house = r.querySelector('.stop-house').value;
                    const postal = r.querySelector('.stop-postal').value;
                    const city = r.querySelector('.stop-city').value;
                    const addressFull = [street, house].filter(Boolean).join(' ') + ([postal, city].filter(Boolean).length ? ', ' + [postal, city].filter(Boolean).join(' ') : '');

                    if (!r.dataset.lat || r.dataset.lat === "") {
                        const c = await geocode(street, house, postal, city);
                        if (c) { r.dataset.lat = c.lat; r.dataset.lng = c.lon; }
                    }

                    stops.push({
                        uuid: u === "" ? null : u,
                        recipient: r.querySelector('.stop-recipient').value,
                        company: r.querySelector('.stop-company').value,
                        street,
                        house_number: house,
                        postal_code: postal,
                        city,
                        address_full: addressFull.trim(),
                        stop_type: r.querySelector('.stop-type').value,
                        room_number: r.querySelector('.stop-room')?.value || '',
                        entry_code: r.querySelector('.stop-entry-code')?.value || '',
                        booking_number: r.querySelector('.stop-booking')?.value || '',
                        phone_number: r.querySelector('.stop-phone')?.value || '',
                        email: r.querySelector('.stop-email')?.value || '',
                        notes: r.querySelector('.stop-notes')?.value || '',
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
                    driver_name: DRIVER_NAME, name: document.getElementById('tName').value, customer: document.getElementById('tCustomer').value,
                    date: tourDate, is_current: document.getElementById('tIsCurrent').checked, notes: document.getElementById('tNotes').value,
                    depot_name: document.getElementById('tDepotName').value, depot_company: document.getElementById('tDepotCompany').value,
                    depot_street: document.getElementById('tDepotStreet').value, depot_house_number: document.getElementById('tDepotHouse').value,
                    depot_postal_code: document.getElementById('tDepotPostal').value, depot_city: document.getElementById('tDepotCity').value,
                    depot_lat: modal.dataset.lat ? parseFloat(modal.dataset.lat) : null,
                    depot_lng: modal.dataset.lng ? parseFloat(modal.dataset.lng) : null,
                    stops
                };
                const res = await adminFetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(res.ok) {
                    showToast('Túra mentve!');
                    closeModal();
                    refreshTours();
                    refreshHotels();
                } else {
                    const msg = await res.text();
                    alert('Hiba a túra mentésekor: ' + msg);
                    if (btn) {
                        btn.innerText = oldText;
                        btn.disabled = false;
                    }
                }
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
