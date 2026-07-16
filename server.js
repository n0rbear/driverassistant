// FIXED SERVER v17 - TRACE LIVE UPDATES
const express = require('express');
const initDb = require('./src/database/init');
const { PORT } = require('./src/config/env');
const setupUploads = require('./src/infrastructure/uploads');
const healthRoutes = require('./src/routes/health.routes');
const downloadRoutes = require('./src/routes/download.routes');
const chatRoutes = require('./src/routes/chat.routes');
const {
    worktimeReadRoutes,
    worktimeSyncRoutes
} = require('./src/routes/worktime.routes');
const {
    costReadRoutes,
    costManagementRoutes
} = require('./src/routes/cost.routes');
const { uploadRoutes } = require('./src/routes/upload.routes');
const {
    hotelManagementRoutes,
    hotelReadRoutes
} = require('./src/routes/hotel.routes');
const {
    driverProfileRoutes,
    driverReadRoutes
} = require('./src/routes/driver.routes');
const fleetRoutes = require('./src/routes/fleet.routes');
const statsRoutes = require('./src/routes/stats.routes');
const createRootRoutes = require('./src/routes/root.routes');
const createDriverDashboardRoutes = require('./src/routes/driver-dashboard.routes');
const historyRoutes = require('./src/routes/history.routes');
const currentTourRoutes = require('./src/routes/current-tour.routes');
const tourRoutes = require('./src/routes/tour.routes');
const adminTourRoutes = require('./src/routes/admin-tour.routes');
const devResetRoutes = require('./src/routes/dev-reset.routes');
const devSeedRoutes = require('./src/routes/dev-seed.routes');
const createAdminSaveTourRoutes = require('./src/routes/admin-save-tour.routes');
const adminTransferTourRoutes = require('./src/routes/admin-transfer-tour.routes');
const createSyncTourRoutes = require('./src/routes/sync-tour.routes');
const createLiveUpdateRoutes = require('./src/routes/live-update.routes');
const { escapeHtml, escapeJsString } = require('./src/utils/escape');
const ImportEngine = require('./src/engines/import-engine');
const StatusEngine = require('./src/engines/status-engine');
const app = express();
app.use(express.json({ limit: '10mb' }));
setupUploads(app);

app.use(downloadRoutes);

app.use(worktimeReadRoutes);

app.use(costReadRoutes);

app.use(healthRoutes);

app.use(createLiveUpdateRoutes({ StatusEngine }));

app.use(historyRoutes);

app.use(chatRoutes);

app.use(worktimeSyncRoutes);

app.use(costManagementRoutes);

app.use(hotelManagementRoutes);

app.use(devResetRoutes);

app.use(devSeedRoutes);

app.use(currentTourRoutes);

// ==========================================
// DRIVER PROFILE & AUTH
// ==========================================

app.use(driverProfileRoutes);

app.use(uploadRoutes);

app.use(driverReadRoutes);

app.use(createSyncTourRoutes({ ImportEngine }));

app.use(tourRoutes);

app.use(hotelReadRoutes);

app.use(createAdminSaveTourRoutes({ ImportEngine }));

app.use(adminTransferTourRoutes);

app.use(adminTourRoutes);

app.use(fleetRoutes);

app.use(statsRoutes);

app.use(createRootRoutes({ escapeHtml }));

app.use(createDriverDashboardRoutes({ escapeHtml, escapeJsString }));

const start = async () => {
    try {
        await initDb();
        app.listen(PORT, () => console.log('[STARTUP] Express server starting on port ' + PORT));
    } catch (err) {
        console.error('[STARTUP] Fatal error during initDb:', err);
        process.exit(1);
    }
};
start();
