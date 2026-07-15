const express = require('express');
const pool = require('../database/pool');

const historyRoutes = express.Router();

historyRoutes.get('/api/get-history/:driverName/:date', async (req, res) => {
    try {
        const { driverName, date } = req.params;
        const startOfDay = new Date(date).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
        const result = await pool.query(
            'SELECT latitude, longitude, speed, timestamp FROM live_updates WHERE driver_name = $1 AND timestamp >= $2 AND timestamp < $3 ORDER BY timestamp ASC',
            [driverName, startOfDay, endOfDay]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).send(e.message); }
});

module.exports = historyRoutes;
