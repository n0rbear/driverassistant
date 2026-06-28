// FIXED SERVER v4 – updated to avoid COALESCE type mismatches
const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/* --------------------------------------------------------------
   DATABASE INITIALISATION (unchanged – kept for completeness)
-------------------------------------------------------------- */
const initDb = async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    const queries = [
        // … same CREATE TABLE statements …
    ];
    for (let q of queries) await pool.query(q);

    const addColumns = [
        // … same ALTER TABLE statements …
    ];
    for (const [table, col, type] of addColumns) {
        try {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
            if (type.includes('UUID')) {
                await pool.query(`UPDATE ${table} SET uuid = gen_random_uuid() WHERE uuid IS NULL`);
            }
        } catch (e) {}
    }

    // … UNIQUE constraints (unchanged) …
};
initDb().catch(console.error);

/* --------------------------------------------------------------
   1️⃣ LIVE‑UPDATE ENDPOINT (fixed)
-------------------------------------------------------------- */
app.post('/api/live-update', async (req, res) => {
    const d = req.body;

    // Normalise incoming numbers
    const latitude   = d.latitude   === undefined ? null : Number(d.latitude);
    const longitude  = d.longitude  === undefined ? null : Number(d.longitude);
    const speed      = d.speed      === undefined ? null : Number(d.speed);
    const timestamp  = d.timestamp  === undefined ? Date.now() : Number(d.timestamp);
    const nextLat    = d.nextLat    === undefined ? null : Number(d.nextLat);
    const nextLng    = d.nextLng    === undefined ? null : Number(d.nextLng);
    const nextStopDist = d.nextStopDistance === undefined ? null : Number(d.nextStopDistance);
    const tourRemainDist = d.tourRemainingDistance === undefined ? null : Number(d.tourRemainingDistance);
    const depotLat   = d.depotLat   === undefined ? null : Number(d.depotLat);
    const depotLng   = d.depotLng   === undefined ? null : Number(d.depotLng);

    await pool.query(`
        INSERT INTO live_updates (
            uuid, driver_name, driver_photo, driver_phone, driver_email,
            license_plate, latitude, longitude, speed, status,
            current_tour, next_stop, next_lat, next_lng,
            next_stop_dist, tour_remaining_dist,
            depot_name, depot_lat, depot_lng, timestamp
        ) VALUES (
            COALESCE($1::uuid, gen_random_uuid()),
            $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16,
            $17, $18, $19, $20
        )
    `, [
        d.uuid || null,
        d.driverName,
        d.driverPhoto,
        d.driverPhone,
        d.driverEmail,
        d.licensePlate,
        latitude,
        longitude,
        speed,
        d.status,
        d.currentTour,
        d.nextStop,
        nextLat,
        nextLng,
        nextStopDist,
        tourRemainDist,
        d.depotName,
        depotLat,
        depotLng,
        timestamp
    ]);

    // Tour‑completion logic (unchanged)
    if (d.currentTour) {
        const tourRes = await pool.query(
            `SELECT * FROM tours WHERE (name = $1 OR uuid::text = $1) AND driver_name = $2 AND is_closed = FALSE`,
            [d.currentTour, d.driverName]
        );
        if (tourRes.rows.length > 0) {
            const tour = tourRes.rows[0];
            const depotLat = d.depotLat;
            const depotLng = d.depotLng;
            if (depotLat && depotLng) {
                const stopsRes = await pool.query(
                    `SELECT * FROM stops WHERE tour_id = $1 AND is_completed = FALSE AND deleted_at IS NULL`,
                    [tour.id]
                );
                if (stopsRes.rows.length === 0) {
                    const distToDepot = getDistance(d.latitude, d.longitude, depotLat, depotLng);
                    if (distToDepot < 100) {
                        await pool.query(
                            `UPDATE tours SET is_closed = TRUE, is_current = FALSE, updated_at = $1 WHERE id = $2`,
                            [Date.now(), tour.id]
                        );
                    }
                }
            }
        }
    }

    res.sendStatus(200);
});

/* --------------------------------------------------------------
   2️⃣ SYNC‑COSTS ENDPOINT (fixed)
-------------------------------------------------------------- */
app.post('/api/sync-costs', async (req, res) => {
    for (const c of req.body) {
        await pool.query(`
            INSERT INTO costs (
                uuid, driver_name, amount, currency, category,
                notes, mileage, timestamp
            ) VALUES (
                COALESCE($1::uuid, gen_random_uuid()),
                $2, $3::numeric, $4, $5,
                $6, $7, $8::bigint
            )
            ON CONFLICT (driver_name, timestamp, amount)
            DO UPDATE SET
                status = EXCLUDED.status,
                notes  = EXCLUDED.notes
        `, [
            c.uuid || null,
            c.driverName,
            Number(c.amount),
            c.currency,
            c.category,
            c.notes,
            c.mileage,
            Number(c.timestamp)
        ]);
    }
    res.sendStatus(200);
});

/* --------------------------------------------------------------
   3️⃣ SYNC‑WORKTIMES ENDPOINT (fixed)
-------------------------------------------------------------- */
app.post('/api/sync-worktimes', async (req, res) => {
    for (const wt of req.body) {
        await pool.query(`
            INSERT INTO work_times (
                uuid, driver_name, type, start_time, end_time,
                mileage, end_mileage, license_plate, notes, date
            ) VALUES (
                COALESCE($1::uuid, gen_random_uuid()),
                $2, $3,
                $4::bigint, $5::bigint,
                $6, $7,
                $8, $9,
                $10::text
            )
            ON CONFLICT (driver_name, start_time) DO UPDATE SET
                end_time   = EXCLUDED.end_time,
                end_mileage = EXCLUDED.end_mileage,
                notes      = EXCLUDED.notes
        `, [
            wt.uuid || null,
            wt.driverName,
            wt.type,
            Number(wt.startTime),
            Number(wt.endTime),
            wt.mileage,
            wt.endMileage,
            wt.licensePlate,
            wt.notes,
            wt.date
        ]);
    }
    res.sendStatus(200);
});

/* --------------------------------------------------------------
   The rest of your routes (tours, hotels, chat, admin, UI) can stay
   exactly as you had them – they already use proper casts or only
   deal with text fields.
-------------------------------------------------------------- */

/* ---------- ... (unchanged routes) ---------- */

/* --------------------------------------------------------------
   SERVER START
-------------------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 ERP Rendszer elindult a ' + PORT + ' porton.'));
