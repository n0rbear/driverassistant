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

devResetRoutes.post('/admin/dev-reset-demo', requireAdmin, async (req, res) => {
    if (req.body?.confirm !== 'RESET_DEMO_DATA') {
        return res.status(400).json({ error: 'Missing confirm: RESET_DEMO_DATA' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const demoCompanies = await client.query('SELECT uuid FROM companies WHERE is_demo = true');
        const companyUuids = demoCompanies.rows.map(r => r.uuid);
        if (companyUuids.length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true, cleared: [], message: 'No demo companies found.' });
        }

        await client.query('DELETE FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE company_uuid = ANY($1::UUID[]))', [companyUuids]);
        const tables = ['live_updates', 'chat_messages', 'costs', 'hotels', 'work_times', 'tours', 'role_permissions', 'web_users', 'drivers'];
        for (const table of tables) {
            await client.query(`DELETE FROM ${table} WHERE company_uuid = ANY($1::UUID[])`, [companyUuids]);
        }
        await client.query('DELETE FROM companies WHERE uuid = ANY($1::UUID[])', [companyUuids]);
        await client.query('COMMIT');
        res.json({ success: true, cleared: ['stops', ...tables, 'companies'], companyCount: companyUuids.length });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

module.exports = devResetRoutes;
