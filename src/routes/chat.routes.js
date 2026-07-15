const express = require('express');
const pool = require('../database/pool');
const router = express.Router();

router.post('/api/send-chat', async (req, res) => {
    const { uuid, driverName, sender, message, timestamp } = req.body;
    if (!message) return res.sendStatus(400);
    await pool.query('INSERT INTO chat_messages (uuid, driver_name, sender, message, timestamp) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5)', [uuid || null, driverName, sender, message, timestamp || Date.now()]);
    res.sendStatus(200);
});

router.get('/api/get-chat/:driverName', async (req, res) => {
    const result = await pool.query('SELECT uuid, sender, message, timestamp FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [req.params.driverName]);
    res.json(result.rows.map(r => ({ uuid: r.uuid, driverName: req.params.driverName, sender: r.sender || 'RENDSZER', message: r.message || '', timestamp: Number(r.timestamp) || Date.now() })));
});

module.exports = router;
