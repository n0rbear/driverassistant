const fs = require('fs');
const express = require('express');

function setupUploads(app) {
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }

    app.use('/uploads', express.static('uploads'));
}

module.exports = setupUploads;
