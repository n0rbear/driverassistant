const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const adminTransferTourRoutes = express.Router();

adminTransferTourRoutes.post('/admin/transfer-tour', requireAdmin, async (req, res) => {
    const { tourId, newDriverName } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (!tourId || !newDriverName) return res.status(400).send('Missing tourId or newDriverName');
        const tourRes = await client.query('SELECT uuid, is_current FROM tours WHERE id = $1 AND deleted_at IS NULL', [tourId]);
        if (tourRes.rows.length === 0) throw new Error('Tour not found');
        const { uuid, is_current } = tourRes.rows[0];
        const driverRes = await client.query('SELECT uuid, company_uuid FROM drivers WHERE name = $1 LIMIT 1', [newDriverName]);
        const newDriver = driverRes.rows[0] || {};

        const now = Date.now();
        await client.query('UPDATE tours SET driver_name = $1, driver_uuid = COALESCE($2, driver_uuid), company_uuid = COALESCE($3, company_uuid), updated_at = $4 WHERE id = $5', [newDriverName, newDriver.uuid || null, newDriver.company_uuid || null, now, tourId]);
        await client.query('UPDATE stops SET driver_uuid = COALESCE($1, driver_uuid), company_uuid = COALESCE($2, company_uuid), updated_at = $3 WHERE tour_id = $4 AND deleted_at IS NULL', [newDriver.uuid || null, newDriver.company_uuid || null, now, tourId]);

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

module.exports = adminTransferTourRoutes;
