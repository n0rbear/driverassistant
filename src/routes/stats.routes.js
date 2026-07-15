const express = require('express');
const pool = require('../database/pool');

const statsRoutes = express.Router();

statsRoutes.get('/api/stats/:driverName', async (req, res) => {
    try {
        const driverName = req.params.driverName;
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const month = today.slice(0, 7);
        const work = (await pool.query('SELECT * FROM work_times WHERE driver_name = $1 AND date LIKE $2', [driverName, `${month}%`])).rows;
        const costs = (await pool.query('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::INT AS count FROM costs WHERE driver_name = $1 AND timestamp >= $2', [driverName, new Date(`${month}-01T00:00:00.000Z`).getTime()])).rows[0];
        const tours = (await pool.query('SELECT COUNT(*)::INT AS count FROM tours WHERE driver_name = $1 AND deleted_at IS NULL AND date >= $2', [driverName, new Date(`${month}-01T00:00:00.000Z`).getTime()])).rows[0];

        const isType = (row, type) => String(row.type || '').startsWith(type);
        const sumSeconds = (rows, type, onlyToday = false) => rows
            .filter(w => (type ? isType(w, type) : !isType(w, 'Pihen')) && (!onlyToday || w.date === today))
            .reduce((sum, w) => sum + Math.max(0, Number(w.end_time || Date.now()) - Number(w.start_time || 0)) / 1000, 0);

        res.json({
            today,
            month,
            workTodaySeconds: Math.round(sumSeconds(work, null, true)),
            drivingTodaySeconds: Math.round(sumSeconds(work, 'Vezetés', true)),
            restTodaySeconds: Math.round(sumSeconds(work, 'Pihen', true)),
            workMonthSeconds: Math.round(sumSeconds(work, null, false)),
            drivingMonthSeconds: Math.round(sumSeconds(work, 'Vezetés', false)),
            restMonthSeconds: Math.round(sumSeconds(work, 'Pihen', false)),
            costMonthTotal: Number(costs.total || 0),
            costMonthCount: Number(costs.count || 0),
            tourMonthCount: Number(tours.count || 0)
        });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = statsRoutes;
