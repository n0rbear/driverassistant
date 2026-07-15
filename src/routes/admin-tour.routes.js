const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const adminTourRoutes = express.Router();

adminTourRoutes.post('/admin/delete-tour', requireAdmin, async (req, res) => {
    const id = req.body.id;
    if (!id) return res.status(400).send('Missing tour id');
    try {
        const now = Date.now();
        await pool.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2', [now, id]);
        const result = await pool.query('UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, id]);
        if (result.rowCount === 0) return res.status(404).send('Tour not found');
        res.json({ success: true });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = adminTourRoutes;
