const express = require('express');
const pool = require('../database/pool');

const currentTourRoutes = express.Router();

currentTourRoutes.post('/api/set-current-tour', async (req, res) => {
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

module.exports = currentTourRoutes;
