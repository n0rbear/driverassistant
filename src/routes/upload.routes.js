const express = require('express');
const fs = require('fs');
const pool = require('../database/pool');
const { MAX_UPLOAD_BYTES } = require('../config/env');

const uploadRoutes = express.Router();

uploadRoutes.post('/api/upload-photo', async (req, res) => {
    try {
        const { driverName, imageBase64, uuid } = req.body;
        if (!imageBase64) {
            console.warn('[UPLOAD] No image data received');
            return res.status(400).send('No image data');
        }

        const identifier = uuid || driverName;
        if (!identifier) {
            console.warn('[UPLOAD] No driver identifier (uuid or name) received');
            return res.status(400).send('No driver identifier');
        }

        console.log(`[UPLOAD] Receiving photo for ${identifier}, size: ${imageBase64.length} chars`);

        const normalizedBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(normalizedBase64)) {
            return res.status(400).send('Invalid base64 data');
        }

        const buffer = Buffer.from(normalizedBase64, 'base64');

        if (buffer.length === 0) {
            console.warn('[UPLOAD] Decoded buffer is empty');
            return res.status(400).send('Invalid base64 data');
        }
        if (buffer.length > MAX_UPLOAD_BYTES) {
            return res.status(413).send('Image too large');
        }

        let ext = null;
        if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
        if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ext = 'png';
        if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
        if (!ext) {
            return res.status(400).send('Unsupported image type');
        }

        const fileName = `photo_${String(identifier).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${ext}`;
        const filePath = `uploads/${fileName}`;

        fs.writeFileSync(filePath, buffer);
        console.log(`[UPLOAD] Saved to ${filePath}, size: ${buffer.length} bytes`);

        const photoUrl = `/uploads/${fileName}`;
        const now = Date.now();
        if (uuid) {
            await pool.query('UPDATE drivers SET photo_url = $1, profile_updated_at = $2 WHERE uuid = $3', [photoUrl, now, uuid]);
        } else {
            await pool.query('UPDATE drivers SET photo_url = $1, profile_updated_at = $2 WHERE name = $3', [photoUrl, now, driverName]);
        }

        res.json({ photoUrl, profileUpdatedAt: now });
    } catch (e) {
        console.error(`[UPLOAD-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    }
});

uploadRoutes.post('/api/upload-stop-photo', async (req, res) => {
    try {
        const { stopUuid, imageBase64 } = req.body;
        if (!stopUuid || !imageBase64) {
            return res.status(400).send('Missing stopUuid or image data');
        }

        const normalizedBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(normalizedBase64)) {
            return res.status(400).send('Invalid base64 data');
        }

        const buffer = Buffer.from(normalizedBase64, 'base64');
        if (buffer.length === 0) return res.status(400).send('Invalid base64 data');
        if (buffer.length > MAX_UPLOAD_BYTES) return res.status(413).send('Image too large');

        let ext = null;
        if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
        if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ext = 'png';
        if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
        if (!ext) return res.status(400).send('Unsupported image type');

        const safeStop = String(stopUuid).replace(/[^a-z0-9-]/gi, '_');
        const fileName = `stop_${safeStop}_${Date.now()}.${ext}`;
        const filePath = `uploads/${fileName}`;
        fs.writeFileSync(filePath, buffer);

        const photoUrl = `/uploads/${fileName}`;
        const now = Date.now();
        const result = await pool.query('UPDATE stops SET photo_url = $1, updated_at = $2 WHERE uuid::text = $3', [photoUrl, now, stopUuid]);
        if (result.rowCount === 0) return res.status(404).send('Stop not found');

        res.json({ photoUrl, updatedAt: now });
    } catch (e) {
        console.error(`[STOP-UPLOAD-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    }
});

module.exports = {
    uploadRoutes
};
