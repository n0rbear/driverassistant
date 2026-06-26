res.send(`
    <html>
    <head>
        <meta http-equiv="refresh" content="30">
        <title>Driver ERP - Admin</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
            body { font-family: sans-serif; margin: 0; display: flex; height: 100vh; }
            #sidebar { width: 350px; background: #2c3e50; color: white; padding: 20px; overflow-y: auto; }
            #map-container { flex-grow: 1; position: relative; }
            #map { height: 100%; }
            .driver-card { background: #34495e; padding: 10px; border-radius: 5px; margin-bottom: 10px; border-left: 5px solid #27ae60; }
            .cost-table { width: 100%; font-size: 12px; border-collapse: collapse; }
            .cost-table th, .cost-table td { border: 1px solid #444; padding: 5px; }
            .status-badge { padding: 2px 5px; border-radius: 3px; font-size: 10px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div id="sidebar">
            <h1>🚚 Flotta Monitor</h1>
            <h3>Sofőrök állapota</h3>
            ${drivers.rows.map(d => `
                <div class="driver-card">
                    <b>${d.driver_name}</b> [${d.license_plate}]<br>
                    Státusz: <span style="color:#f1c40f">${d.status}</span> | ${Math.round(d.speed)} km/h<br>
                    <small>Cél: ${d.next_stop || 'Nincs aktív túra'}</small>
                </div>
            `).join('')}
            <hr>
            <h3>Tankolások és Kiadások</h3>
            <table class="cost-table">
                <tr><th>Sofőr</th><th>Összeg</th><th>Kategória</th><th>Akció</th></tr>
                ${costs.rows.map(c => `
                    <tr>
                        <td>${c.driver_name}</td>
                        <td>${c.amount} ${c.currency}</td>
                        <td>${c.category}</td>
                        <td><button onclick="alert('Kifizetve!')">OK</button></td>
                    </tr>
                `).join('')}
            </table>
        </div>
        <div id="map-container">
            <div id="map"></div>
        </div>
        <script>
            var map = L.map('map').setView([47.5, 19.0], 7);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            var drivers = ${JSON.stringify(drivers.rows)};
            drivers.forEach(d => {
                var m = L.marker([d.latitude, d.longitude]).addTo(map).bindPopup(d.driver_name + " - " + d.status);
                // Itt lehetne útvonalat rajzolni, ha megvannak a cél koordináták
            });
        </script>
    </body>
    </html>
`);
