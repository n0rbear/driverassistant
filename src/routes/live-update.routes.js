const express = require('express');
const pool = require('../database/pool');

const createLiveUpdateRoutes = ({ StatusEngine }) => {
    const liveUpdateRoutes = express.Router();

    liveUpdateRoutes.post('/api/live-update', async (req, res) => {
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
            res.json({
                status: resObj.status,
                licensePlate: currentPlate,
                nextStopDist: resObj.nextStopDist,
                nextStopDur: resObj.nextStopDur,
                tourRemainingDist: resObj.tourRemainingDist,
                tourRemainingDur: resObj.tourRemainingDur,
                nextStopInfo: resObj.nextStopInfo,
                nextLat: resObj.nextLat,
                nextLng: resObj.nextLng,
                depotName: resObj.depotName,
                depotLat: resObj.depotLat,
                depotLng: resObj.depotLng
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`[TRACE-LIVE] Error: ${e.message}`);
            res.status(500).send(e.message);
        } finally {
            client.release();
        }
    });

    return liveUpdateRoutes;
};

module.exports = createLiveUpdateRoutes;
