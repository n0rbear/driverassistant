// FIXED SERVER v17 - TRACE LIVE UPDATES
const express = require('express');
const pool = require('./src/database/pool');
const { PORT } = require('./src/config/env');
const setupUploads = require('./src/infrastructure/uploads');
const healthRoutes = require('./src/routes/health.routes');
const downloadRoutes = require('./src/routes/download.routes');
const chatRoutes = require('./src/routes/chat.routes');
const {
    worktimeReadRoutes,
    worktimeSyncRoutes
} = require('./src/routes/worktime.routes');
const {
    costReadRoutes,
    costManagementRoutes
} = require('./src/routes/cost.routes');
const { uploadRoutes } = require('./src/routes/upload.routes');
const {
    hotelManagementRoutes,
    hotelReadRoutes
} = require('./src/routes/hotel.routes');
const {
    driverProfileRoutes,
    driverReadRoutes
} = require('./src/routes/driver.routes');
const fleetRoutes = require('./src/routes/fleet.routes');
const statsRoutes = require('./src/routes/stats.routes');
const createRootRoutes = require('./src/routes/root.routes');
const createDriverDashboardRoutes = require('./src/routes/driver-dashboard.routes');
const historyRoutes = require('./src/routes/history.routes');
const currentTourRoutes = require('./src/routes/current-tour.routes');
const tourRoutes = require('./src/routes/tour.routes');
const adminTourRoutes = require('./src/routes/admin-tour.routes');
const devResetRoutes = require('./src/routes/dev-reset.routes');
const devSeedRoutes = require('./src/routes/dev-seed.routes');
const createAdminSaveTourRoutes = require('./src/routes/admin-save-tour.routes');
const adminTransferTourRoutes = require('./src/routes/admin-transfer-tour.routes');
const createSyncTourRoutes = require('./src/routes/sync-tour.routes');
const createLiveUpdateRoutes = require('./src/routes/live-update.routes');
const { escapeHtml, escapeJsString } = require('./src/utils/escape');
const path = require('path');
const app = express();
app.use(express.json({ limit: '10mb' }));
setupUploads(app);

const SHORT_REST_GRACE_MS = 3 * 60 * 1000;
app.use(downloadRoutes);

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
    async processTour(client, driverName, tourData, stopsData, options = {}) {
        const isMobileSync = options.source === 'mobile';
        // UUID alapú keresés, hogy elkerüljük a kliens/szerver ID ütközést
        const existingRes = await client.query('SELECT id, updated_at FROM tours WHERE uuid = $1', [tourData.uuid]);
        let tourId = existingRes.rows.length > 0 ? existingRes.rows[0].id : null;

        const tour = { ...tourData, driver_name: driverName, updated_at: tourData.updated_at || tourData.updatedAt || Date.now() };
        const incomingTourUpdatedAt = Number(tour.updated_at || Date.now());
        const existingTourUpdatedAt = Number(existingRes.rows[0]?.updated_at || 0);
        const shouldApplyTourPayload = !tourId || incomingTourUpdatedAt >= existingTourUpdatedAt;
        const depot = AddressEngine.normalize(tourData);
        const groupedStops = [];
        const deletedStopUuids = [];

        for (const rawStop of stopsData) {
            if ((rawStop.deleted_at || rawStop.deletedAt) && rawStop.uuid) {
                deletedStopUuids.push(String(rawStop.uuid));
                continue;
            }
            const n = AddressEngine.normalize(rawStop);
            const fp = AddressEngine.getFingerprint(n);
            const item = {
                uuid: (rawStop.uuid && String(rawStop.uuid).trim() !== "") ? String(rawStop.uuid) : null,
                recipient: n.recipient, company: n.company, notes: n.notes,
                contact_name: rawStop.contact_name || rawStop.contactName || '',
                phone_number: rawStop.phone_number || rawStop.phoneNumber || '',
                email: rawStop.email || '', time_window: rawStop.time_window || rawStop.timeWindow || '',
                stop_date: rawStop.stop_date || rawStop.stopDate || null,
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

        if (tourId && shouldApplyTourPayload && !isMobileSync) {
            await client.query(`UPDATE tours SET driver_name=$1, name=$2, customer=$3, date=$4, day_of_week=$5, notes=$6, is_closed=$7, is_current=$8, depot_name=$9, depot_company=$10, depot_street=$11, depot_house_number=$12, depot_postal_code=$13, depot_city=$14, depot_state=$15, depot_country=$16, depot_address_full=$17, depot_lat=$18, depot_lng=$19, updated_at=$20, deleted_at=$22 WHERE id=$21`,
                [driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tourId, tour.deleted_at || tour.deletedAt || null]);
        } else if (!tourId) {
            const res = await client.query(`INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current, depot_name, depot_company, depot_street, depot_house_number, depot_postal_code, depot_city, depot_state, depot_country, depot_address_full, depot_lat, depot_lng, updated_at, deleted_at) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id, uuid`,
                [tour.uuid || null, driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tour.deleted_at || tour.deletedAt || null]);
            tourId = res.rows[0].id;
            if (!tour.uuid) tour.uuid = res.rows[0].uuid;
        }

        if (deletedStopUuids.length > 0 && !isMobileSync) {
            await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND uuid::text = ANY($3::text[]) AND (updated_at IS NULL OR updated_at <= $1)', [tour.updated_at, tourId, deletedStopUuids]);
        }

        const currentUuids = [];
        let idx = 0;
        for (const s of groupedStops.values()) {
            const main = s.items[0];
            const stopConflictUpdate = isMobileSync
                ? `is_completed=EXCLUDED.is_completed, arrival_time=COALESCE(EXCLUDED.arrival_time, stops.arrival_time), photo_url=COALESCE(EXCLUDED.photo_url, stops.photo_url), stop_type=EXCLUDED.stop_type, room_number=EXCLUDED.room_number, entry_code=EXCLUDED.entry_code, booking_number=EXCLUDED.booking_number, notes=EXCLUDED.notes, updated_at=GREATEST(COALESCE(stops.updated_at, 0), COALESCE(EXCLUDED.updated_at, 0)) WHERE stops.updated_at IS NULL OR EXCLUDED.updated_at >= stops.updated_at`
                : `tour_id=EXCLUDED.tour_id, address=EXCLUDED.address, recipient=EXCLUDED.recipient, company=EXCLUDED.company, street=EXCLUDED.street, house_number=EXCLUDED.house_number, postal_code=EXCLUDED.postal_code, city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country, address_full=EXCLUDED.address_full, contact_name=EXCLUDED.contact_name, phone_number=EXCLUDED.phone_number, email=EXCLUDED.email, time_window=EXCLUDED.time_window, stop_date=EXCLUDED.stop_date, notes=EXCLUDED.notes, order_index=EXCLUDED.order_index, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, is_completed=EXCLUDED.is_completed, arrival_time=EXCLUDED.arrival_time, stop_type=EXCLUDED.stop_type, updated_at=EXCLUDED.updated_at, items=EXCLUDED.items, photo_url=COALESCE(EXCLUDED.photo_url, stops.photo_url), room_number=EXCLUDED.room_number, entry_code=EXCLUDED.entry_code, booking_number=EXCLUDED.booking_number, deleted_at=NULL WHERE stops.updated_at IS NULL OR EXCLUDED.updated_at >= stops.updated_at`;
            const res = await client.query(`INSERT INTO stops (uuid, tour_id, address, recipient, company, street, house_number, postal_code, city, state, country, address_full, contact_name, phone_number, email, time_window, stop_date, notes, order_index, latitude, longitude, is_completed, arrival_time, stop_type, updated_at, items, photo_url, room_number, entry_code, booking_number) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30) ON CONFLICT (uuid) DO UPDATE SET ${stopConflictUpdate} RETURNING uuid`,
                [main.uuid, tourId, s.address_full, main.recipient, s.company, s.street, s.house_number, s.postal_code, s.city, s.state, s.country, s.address_full, main.contact_name, main.phone_number, main.email, main.time_window, main.stop_date, main.notes, idx++, s.latitude, s.longitude, main.is_completed, main.arrival_time, main.stop_type, main.updated_at, JSON.stringify(s.items), main.photo_url || main.photoUrl || null, main.room_number, main.entry_code, main.booking_number]);
            currentUuids.push(res.rows[0]?.uuid || main.uuid);
        }
        if (shouldApplyTourPayload && !isMobileSync) {
            await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND deleted_at IS NULL AND NOT (uuid = ANY($3::UUID[]))', [tour.updated_at, tourId, currentUuids]);
        }

        if (tour.is_current && shouldApplyTourPayload) {
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
        ['stops', 'stop_date', 'BIGINT'],
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

app.use(worktimeReadRoutes);

app.use(costReadRoutes);

app.use(healthRoutes);

app.use(createLiveUpdateRoutes({ StatusEngine }));

app.use(historyRoutes);

app.use(chatRoutes);

app.use(worktimeSyncRoutes);

app.use(costManagementRoutes);

app.use(hotelManagementRoutes);

app.use(devResetRoutes);

app.use(devSeedRoutes);

app.use(currentTourRoutes);

// ==========================================
// DRIVER PROFILE & AUTH
// ==========================================

app.use(driverProfileRoutes);

app.use(uploadRoutes);

app.use(driverReadRoutes);

app.use(createSyncTourRoutes({ ImportEngine }));

app.use(tourRoutes);

app.use(hotelReadRoutes);

app.use(createAdminSaveTourRoutes({ ImportEngine }));

app.use(adminTransferTourRoutes);

app.use(adminTourRoutes);

app.use(fleetRoutes);

app.use(statsRoutes);

app.use(createRootRoutes({ escapeHtml }));

app.use(createDriverDashboardRoutes({ escapeHtml, escapeJsString }));

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
