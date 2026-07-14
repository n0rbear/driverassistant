const { ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');

const requireAdmin = (req, res, next) => {
    if (!ADMIN_TOKEN) {
        if (IS_DEPLOYED) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured.' });
        return next();
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : (req.headers['x-admin-token'] || req.query.adminToken);

    if (token === ADMIN_TOKEN) return next();

    return res.sendStatus(401);
};

module.exports = requireAdmin;
