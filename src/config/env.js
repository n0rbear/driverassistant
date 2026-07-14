const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const NODE_ENV = process.env.NODE_ENV;
const DATABASE_URL = process.env.DATABASE_URL;
const IS_DEPLOYED = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
const PORT = process.env.PORT || 3000;

module.exports = {
    ADMIN_TOKEN,
    MAX_UPLOAD_BYTES,
    NODE_ENV,
    DATABASE_URL,
    IS_DEPLOYED,
    PORT
};
