const SHORT_REST_GRACE_MS = 3 * 60 * 1000;

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

module.exports = StatusEngine;
