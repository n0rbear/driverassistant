const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const hotelManagementRoutes = express.Router();
const hotelReadRoutes = express.Router();

hotelManagementRoutes.post('/admin/save-hotel', requireAdmin, async (req, res) => {
    const { driverName, name, address, roomNumber, entryCode, bookingNumber, phoneNumber, email, notes, timestamp } = req.body;
    const hotelTimestamp = Number(timestamp || Date.now());
    if (!driverName || !name) return res.sendStatus(400);
    try {
        const result = await pool.query(
            `INSERT INTO hotels (uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING id, uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp`,
            [
                driverName,
                name,
                address || '',
                roomNumber || '',
                entryCode || '',
                bookingNumber || '',
                phoneNumber || '',
                email || '',
                notes || '',
                Number.isFinite(hotelTimestamp) ? hotelTimestamp : Date.now()
            ]
        );
        const row = result.rows[0];
        res.json({ ...row, timestamp: Number(row.timestamp) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.post('/admin/save-hotel-record', requireAdmin, async (req, res) => {
    const { source, id, uuid, driverName, name, address, roomNumber, entryCode, bookingNumber, phoneNumber, email, notes, timestamp } = req.body;
    if (!name || (!id && !uuid && source !== 'hotel')) return res.sendStatus(400);
    const now = Date.now();
    try {
        if (source === 'stop') {
            const result = await pool.query(
                `UPDATE stops SET recipient=$1, address=$2, address_full=$2, room_number=$3, entry_code=$4, booking_number=$5, phone_number=$6, email=$7, notes=$8, updated_at=$9
                 WHERE ${uuid ? 'uuid::text = $10' : 'id = $10'}
                 RETURNING 'stop'::TEXT as source, id, uuid::TEXT, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, room_number, entry_code, booking_number, phone_number, email, notes, updated_at::BIGINT as timestamp`,
                [name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', now, uuid || id]
            );
            if (!result.rows[0]) return res.sendStatus(404);
            const row = result.rows[0];
            return res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
        }

        if (id || uuid) {
            const result = await pool.query(
                `UPDATE hotels SET name=$1, address=$2, room_number=$3, entry_code=$4, booking_number=$5, phone_number=$6, email=$7, notes=$8, timestamp=$9
                 WHERE ${uuid ? 'uuid::text = $10' : 'id = $10'}
                 RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp::BIGINT`,
                [name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', now, uuid || id]
            );
            if (!result.rows[0]) return res.sendStatus(404);
            const row = result.rows[0];
            return res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
        }

        if (!driverName) return res.status(400).send('Missing driverName');
        const result = await pool.query(
            `INSERT INTO hotels (uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp::BIGINT`,
            [driverName, name, address || '', roomNumber || '', entryCode || '', bookingNumber || '', phoneNumber || '', email || '', notes || '', now]
        );
        const row = result.rows[0];
        res.json({ ...row, timestamp: Number(row.timestamp || Date.now()) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.post('/admin/delete-hotel-record', requireAdmin, async (req, res) => {
    const { source, id, uuid } = req.body;
    if (!id && !uuid) return res.sendStatus(400);
    try {
        if (source === 'stop') {
            const now = Date.now();
            const result = await pool.query(
                `UPDATE stops SET deleted_at=$1, updated_at=$1 WHERE ${uuid ? 'uuid::text = $2' : 'id = $2'}`,
                [now, uuid || id]
            );
            return res.json({ success: true, count: result.rowCount });
        }
        const result = await pool.query(
            `DELETE FROM hotels WHERE ${uuid ? 'uuid::text = $1' : 'id = $1'}`,
            [uuid || id]
        );
        res.json({ success: true, count: result.rowCount });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.post('/api/sync-hotels', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const h of (req.body || [])) {
            const driverName = h.driverName || h.driver_name;
            if (!driverName || !h.name) continue;
            if (h.uuid) {
                const stopHotelRes = await client.query(
                    `SELECT 1
                     FROM stops
                     JOIN tours ON tours.id = stops.tour_id
                     WHERE stops.uuid::TEXT = $1
                       AND tours.driver_name = $2
                       AND stops.stop_type = 'HOTEL'
                     LIMIT 1`,
                    [h.uuid, driverName]
                );
                if (stopHotelRes.rows[0]) continue;
            }
            await client.query(`INSERT INTO hotels (uuid, driver_name, name, address, room_number, entry_code, booking_number, phone_number, email, notes, timestamp)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (uuid) DO UPDATE SET
                    driver_name = EXCLUDED.driver_name,
                    name = EXCLUDED.name,
                    address = EXCLUDED.address,
                    room_number = EXCLUDED.room_number,
                    entry_code = EXCLUDED.entry_code,
                    booking_number = EXCLUDED.booking_number,
                    phone_number = EXCLUDED.phone_number,
                    email = EXCLUDED.email,
                    notes = EXCLUDED.notes,
                    timestamp = EXCLUDED.timestamp
                WHERE hotels.timestamp IS NULL OR EXCLUDED.timestamp >= hotels.timestamp`,
                [h.uuid || null, driverName, h.name, h.address, h.roomNumber || h.room_number || '', h.entryCode || h.entry_code || '', h.bookingNumber || h.booking_number || '', h.phoneNumber || h.phone_number || '', h.email || '', h.notes || '', h.timestamp || Date.now()]);
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-HOTELS-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

hotelReadRoutes.get('/api/get-hotels/:driverName', async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM hotels h
             USING stops s, tours t
             WHERE h.uuid = s.uuid
               AND s.tour_id = t.id
               AND h.driver_name = t.driver_name
               AND h.driver_name = $1
               AND s.stop_type = 'HOTEL'`,
            [req.params.driverName]
        );
        const result = await pool.query(
            `SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, driver_name::TEXT, name::TEXT, address::TEXT, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, timestamp::BIGINT
             FROM hotels
             WHERE driver_name = $1
             UNION ALL
             SELECT 'stop'::TEXT as source,
                    id::INT,
                    uuid::TEXT,
                    $1::TEXT as driver_name,
                    COALESCE(recipient, address_full)::TEXT as name,
                    address_full::TEXT as address,
                    room_number::TEXT,
                    entry_code::TEXT,
                    booking_number::TEXT,
                    phone_number::TEXT,
                    email::TEXT,
                    notes::TEXT,
                    COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp
             FROM stops
             WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1 AND deleted_at IS NULL)
               AND deleted_at IS NULL
               AND stop_type = 'HOTEL'
             ORDER BY timestamp DESC`,
            [req.params.driverName]
        );
        res.json(result.rows.map(h => ({ ...h, timestamp: Number(h.timestamp || Date.now()) })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelReadRoutes.get('/api/get-manual-hotels/:driverName', async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM hotels h
             USING stops s, tours t
             WHERE h.uuid = s.uuid
               AND s.tour_id = t.id
               AND h.driver_name = t.driver_name
               AND h.driver_name = $1
               AND s.stop_type = 'HOTEL'`,
            [req.params.driverName]
        );
        const result = await pool.query(
            `SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, driver_name::TEXT, name::TEXT, address::TEXT, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, timestamp::BIGINT
             FROM hotels
             WHERE driver_name = $1
             ORDER BY timestamp DESC`,
            [req.params.driverName]
        );
        res.json(result.rows.map(h => ({ ...h, timestamp: Number(h.timestamp || Date.now()) })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = {
    hotelManagementRoutes,
    hotelReadRoutes
};
