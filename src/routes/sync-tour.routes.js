const express = require('express');
const pool = require('../database/pool');

const createSyncTourRoutes = ({ ImportEngine }) => {
    const syncTourRoutes = express.Router();

    syncTourRoutes.post('/api/sync-tours/:driverName', async (req, res) => {
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
                await ImportEngine.processTour(client, driverName, item.tour, item.stops || [], { source: 'mobile' });
            }
            await client.query('COMMIT');
            res.sendStatus(200);
        } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); }
        finally { client.release(); }
    });

    return syncTourRoutes;
};

module.exports = createSyncTourRoutes;
