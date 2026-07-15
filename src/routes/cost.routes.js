const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const costReadRoutes = express.Router();
const costManagementRoutes = express.Router();

costReadRoutes.get('/api/get-costs/:driverName', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [req.params.driverName]);
        res.json(result.rows.map(r => ({
            ...r,
            driverName: r.driver_name,
            photoPath: r.photo_path,
            timestamp: Number(r.timestamp)
        })));
    } catch (e) { res.status(500).send(e.message); }
});

costManagementRoutes.post('/api/sync-costs', async (req, res) => {
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

costManagementRoutes.get('/api/cost-status/:driverName', async (req, res) => {
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

costManagementRoutes.post('/admin/update-cost-status', requireAdmin, async (req, res) => {
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

costManagementRoutes.post('/admin/save-cost', requireAdmin, async (req, res) => {
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

module.exports = {
    costReadRoutes,
    costManagementRoutes
};
