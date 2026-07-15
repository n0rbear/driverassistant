const express = require('express');
const pool = require('../database/pool');

const tourRoutes = express.Router();

tourRoutes.get('/api/get-tours/:driverName', async (req, res) => {
    try {
        const toursRes = await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [req.params.driverName]);
        const results = [];
        for (let tour of toursRes.rows) {
            const stopsRes = await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [tour.id]);
            results.push({
                tour: { ...tour, date: Number(tour.date), deletedAt: tour.deleted_at ? Number(tour.deleted_at) : null, updatedAt: tour.updated_at ? Number(tour.updated_at) : null, depotLatitude: tour.depot_lat, depotLongitude: tour.depot_lng },
                stops: stopsRes.rows.map(s => ({ ...s, latitude: s.latitude, longitude: s.longitude, isCompleted: !!s.is_completed, stopType: s.stop_type, stopDate: s.stop_date ? Number(s.stop_date) : null, arrivalTime: s.arrival_time ? Number(s.arrival_time) : null, photoUrl: s.photo_url || null, updatedAt: s.updated_at ? Number(s.updated_at) : null }))
            });
        }
        res.json(results);
    } catch (e) { res.status(500).send(e.message); }
});

module.exports = tourRoutes;
