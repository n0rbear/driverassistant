const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const createAdminSaveTourRoutes = ({ ImportEngine }) => {
    const adminSaveTourRoutes = express.Router();

    adminSaveTourRoutes.post('/admin/save-tour', requireAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const tourId = await ImportEngine.processTour(client, req.body.driver_name, req.body, req.body.stops || []);
            await client.query('COMMIT');
            res.json({ success: true, tourId });
        } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).send(e.message); }
        finally { client.release(); }
    });

    return adminSaveTourRoutes;
};

module.exports = createAdminSaveTourRoutes;
