const express = require('express');
const path = require('path');
const router = express.Router();

const projectRoot = path.resolve(__dirname, '../..');

router.get('/tour-import-template.xlsx', (req, res) => {
    res.download(
        path.join(projectRoot, 'DriverAssistant_tura_import_sablon.xlsx'),
        'DriverAssistant_tura_import_sablon.xlsx'
    );
});

module.exports = router;
