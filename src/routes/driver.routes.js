const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const driverProfileRoutes = express.Router();
const driverReadRoutes = express.Router();

driverProfileRoutes.post('/api/activate-driver', async (req, res) => {
    const { code, deviceId, deviceName } = req.body;
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE activation_code = $1 AND is_active = true', [code]);
        if (result.rows.length === 0) return res.status(404).send('Érvénytelen vagy inaktív aktiváló kód.');
        const driver = result.rows[0];
        const now = Date.now();
        if (deviceId) {
            await pool.query(
                `INSERT INTO driver_devices (driver_uuid, device_id, device_name, is_active, linked_at, last_seen_at)
                 VALUES ($1, $2, $3, true, $4, $4)
                 ON CONFLICT (device_id) DO UPDATE SET
                    driver_uuid = EXCLUDED.driver_uuid,
                    device_name = EXCLUDED.device_name,
                    is_active = true,
                    last_seen_at = EXCLUDED.last_seen_at`,
                [driver.uuid, deviceId, deviceName || 'Android telefon', now]
            );
        }
        res.json(driver);
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/api/unlink-device', async (req, res) => {
    const { uuid, deviceId } = req.body;
    if (!deviceId) return res.status(400).send('Missing deviceId');
    try {
        if (uuid) {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2 AND driver_uuid = $3', [Date.now(), deviceId, uuid]);
        } else {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2', [Date.now(), deviceId]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/api/sync-profile', async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Először próbáljuk meg UUID alapján azonosítani, ha az app küldi
        let driverRes;
        if (d.uuid) {
            driverRes = await client.query('SELECT * FROM drivers WHERE uuid = $1', [d.uuid]);
        } else {
            // Ha nincs UUID, akkor név alapján keressük (visszafelé kompatibilitás)
            driverRes = await client.query('SELECT * FROM drivers WHERE name = $1', [d.name]);
        }

        const driver = driverRes.rows[0];
        const incomingUpdatedAt = Number(d.profileUpdatedAt || d.profile_updated_at || 0);
        const now = Date.now();

        if (driver) {
            const serverUpdatedAt = Number(driver.profile_updated_at || 0);
            if (incomingUpdatedAt > 0 && serverUpdatedAt > incomingUpdatedAt) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'PROFILE_CHANGED_ON_SERVER', profile: driver });
            }
            const oldName = driver.name;
            await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=true, profile_updated_at=$8
                 WHERE uuid=$9`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, now, driver.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is
            if (oldName !== d.name) {
                console.log(`[RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
        } else {
            // Új sofőr beszúrása (csak ha tényleg nem létezik)
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, is_active, profile_updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, code, now]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, profileUpdatedAt: now });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-PROFILE-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

driverProfileRoutes.get('/api/get-profile/:name', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE name = $1', [req.params.name]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.get('/api/get-profile-by-uuid/:uuid', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/admin/unlink-driver-devices', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).send('Missing driver uuid');
    try {
        await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE driver_uuid = $2', [Date.now(), uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/admin/save-driver', requireAdmin, async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (d.uuid) {
            // Régi név lekérése a módosítás előtt
            const oldRes = await client.query('SELECT name FROM drivers WHERE uuid = $1', [d.uuid]);
            const oldName = oldRes.rows[0]?.name;

            await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=$8, home_lat=$9, home_lng=$10, base_lat=$11, base_lng=$12, profile_updated_at=$13 WHERE uuid=$14`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, d.is_active, d.home_lat, d.home_lng, d.base_lat, d.base_lng, Date.now(), d.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is (cascade)
            if (oldName && oldName !== d.name) {
                console.log(`[ADMIN-RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
        } else {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, profile_updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, code, Date.now()]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[ADMIN-SAVE-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

driverProfileRoutes.post('/admin/delete-driver', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    try {
        await pool.query('DELETE FROM drivers WHERE uuid = $1', [uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

driverReadRoutes.get('/api/all-drivers', async (req, res) => {
    const result = await pool.query('SELECT * FROM drivers ORDER BY name ASC');
    res.json(result.rows);
});

module.exports = {
    driverProfileRoutes,
    driverReadRoutes
};
