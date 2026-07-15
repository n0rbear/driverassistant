const express = require('express');
const pool = require('../database/pool');

const worktimeReadRoutes = express.Router();
const worktimeSyncRoutes = express.Router();

worktimeReadRoutes.get('/api/get-worktimes/:driverName', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC', [req.params.driverName]);
        res.json(result.rows.map(r => ({
            ...r,
            startTime: Number(r.start_time),
            endTime: r.end_time ? Number(r.end_time) : null,
            driverName: r.driver_name,
            licensePlate: r.license_plate,
            endMileage: r.end_mileage
        })));
    } catch (e) { res.status(500).send(e.message); }
});

worktimeSyncRoutes.post('/api/sync-worktimes', async (req, res) => {
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

module.exports = {
    worktimeReadRoutes,
    worktimeSyncRoutes
};
