const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const devResetRoutes = express.Router();

devResetRoutes.post('/admin/dev-reset-database', requireAdmin, async (req, res) => {
    if (req.body?.confirm !== 'RESET_DEV_DATABASE') {
        return res.status(400).json({ error: 'Missing confirm: RESET_DEV_DATABASE' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const tables = [
            'live_updates',
            'chat_messages',
            'costs',
            'hotels',
            'work_times',
            'stops',
            'tours',
            'role_permissions',
            'web_users',
            'drivers',
            'companies'
        ];
        for (const table of tables) {
            await client.query(`DELETE FROM ${table}`);
        }
        await client.query('COMMIT');
        res.json({ success: true, cleared: tables });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

module.exports = devResetRoutes;
