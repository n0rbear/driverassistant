const express = require('express');
const pool = require('../database/pool');

const createDriverDashboardRoutes = ({ escapeHtml, escapeJsString }) => {
    const driverDashboardRoutes = express.Router();

driverDashboardRoutes.get('/driver/:name', async (req, res) => {
    const name = req.params.name;
    const allD = (await pool.query('SELECT DISTINCT driver_name FROM (SELECT name as driver_name FROM drivers WHERE is_active = true UNION SELECT driver_name FROM live_updates UNION SELECT driver_name FROM tours) as d')).rows.map(r => r.driver_name).filter(n => n && n !== name);
    const update = (await pool.query('SELECT * FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1', [name])).rows[0] || { driver_name: name };
    const driverRes = await pool.query('SELECT * FROM drivers WHERE name = $1', [name]);
    const dInfo = driverRes.rows[0] || {};

    const costs = (await pool.query('SELECT * FROM costs WHERE driver_name = $1 ORDER BY timestamp DESC', [name])).rows;
    const chat = (await pool.query('SELECT * FROM chat_messages WHERE driver_name = $1 ORDER BY timestamp ASC', [name])).rows;
    const work = (await pool.query('SELECT DISTINCT ON (start_time) * FROM work_times WHERE driver_name = $1 ORDER BY start_time DESC, id DESC', [name])).rows;
    const toursRes = (await pool.query('SELECT * FROM tours WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY date DESC', [name])).rows;
    const hotelsRes = (await pool.query(`SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, name::TEXT, address::TEXT, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, timestamp::BIGINT FROM hotels WHERE driver_name = $1 UNION ALL SELECT 'stop'::TEXT as source, id::INT, uuid::TEXT, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1 AND deleted_at IS NULL) AND deleted_at IS NULL AND stop_type = 'HOTEL' ORDER BY timestamp DESC`, [name])).rows;
    for (let t of toursRes) t.stops = (await pool.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC', [t.id])).rows;
    const currentTourObj = toursRes.find(t => t.is_current) || toursRes[0];
    const currentStopsJson = JSON.stringify(currentTourObj ? currentTourObj.stops : []);

    const drivingTodaySec = work
        .filter(w => w.type === 'Vezetés' && w.date === new Date().toISOString().split('T')[0])
        .reduce((sum, w) => sum + (Number(w.end_time || Date.now()) - Number(w.start_time)) / 1000, 0);

    const pageNameHtml = escapeHtml(name);
    const pageNameJs = escapeJsString(name);
    const profilePhotoHtml = escapeHtml(dInfo.photo_url || update.driver_photo || '');
    const licenseHtml = escapeHtml(dInfo.license_plate || update.license_plate || 'N/A');
    const statusHtml = escapeHtml(update.status || 'Offline');
    const currentTourHtml = escapeHtml(update.current_tour || '');
    const depotNameHtml = escapeHtml(update.depot_name || '');
    const driverEmailHtml = escapeHtml(dInfo.email || update.driver_email || '');
    const driverPhoneHtml = escapeHtml(dInfo.phone || update.driver_phone || '');
    let nextStopDetailsHtml = '';
    if (update.next_stop) {
        const nextParts = String(update.next_stop).split(' | ');
        nextStopDetailsHtml = nextParts.length > 1
            ? `<b style="display:block; margin-top:5px; color:#fff;">${escapeHtml(nextParts[0])}</b><p style="margin:2px 0; font-size:13px; color:#ccc;">${escapeHtml(nextParts.slice(1).join(' | '))}</p>`
            : `<p style="margin:5px 0; font-size:14px;">${escapeHtml(update.next_stop)}</p>`;
    }

    const html = `<html><head><title>ERP - ${pageNameHtml}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
    <style>
        body { font-family: sans-serif; margin: 0; background: #1a1a1a; color: white; display: flex; flex-direction: column; height: 100vh; }
        header { background: #222; padding: 15px 30px; display: flex; align-items: center; border-bottom: 1px solid #444; }
        nav { background: #333; display: flex; padding: 0 30px; }
        nav button { background: none; border: none; color: #aaa; padding: 15px 20px; cursor: pointer; font-size: 14px; border-bottom: 3px solid transparent; }
        nav button.active { color: white; border-bottom-color: #3498db; background: #444; }
        .tab-content { flex-grow: 1; display: none; padding: 20px; overflow-y: auto; }
        .tab-content.active { display: block; }
        #map { height: 500px; width: 100%; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #333; }
        .tour-card { background: #222; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .stop-item { margin-left: 20px; border-left: 2px solid #444; padding-left: 10px; margin-top: 5px; }
        .msg { padding: 8px; margin: 5px 0; border-radius: 8px; max-width: 80%; }
        .msg-boss { background: #F57F17; color: black; align-self: flex-end; margin-left: auto; }
        .msg-driver { background: #34495e; color: white; }
        input, select, textarea { width: 100%; padding: 8px; background: #333; border: 1px solid #444; color: white; border-radius: 4px; box-sizing: border-box; }
        label { display: block; font-size: 11px; color: #aaa; margin-bottom: 2px; }
        #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
        .toast { background: #2ecc71; color: white; padding: 12px 24px; border-radius: 8px; margin-top: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideIn 0.3s, fadeOut 0.5s 2.5s forwards; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    </style></head>
    <body>
        <div id="toast-container"></div>
        <header><button onclick="location.href='/'">⬅</button><img src="${profilePhotoHtml}" style="width:40px;height:40px;border-radius:50%;margin-left:15px;margin-right:15px;object-fit:cover;background:#333;"><h2><span>${pageNameHtml}</span> - ERP</h2></header>
        <nav>
            <button data-tab="dashboard" onclick="openTab(event, 'dashboard')">DASHBOARD</button>
            <button data-tab="tours" onclick="openTab(event, 'tours')">TÚRÁK</button>
            <button data-tab="history" onclick="openTab(event, 'history')">TÖRTÉNET</button>
            <button data-tab="costs" onclick="openTab(event, 'costs')">KÖLTSÉGEK</button>
            <button data-tab="hotels" onclick="openTab(event, 'hotels')">HOTELEK</button>
            <button data-tab="chat" onclick="openTab(event, 'chat')">CHAT</button>
            <button data-tab="stats" onclick="openTab(event, 'stats')">STATISZTIKA</button>
            <button data-tab="report" onclick="openTab(event, 'report')">MENETLEVÉL</button>
            <button data-tab="profile" onclick="openTab(event, 'profile')">PROFIL</button>
        </nav>
        <div id="dashboard" class="tab-content active" style="display:block;">
            <div style="display:grid; grid-template-columns: 1fr 300px; gap: 20px;">
                <div id="map"></div>
                <div style="background:#222; padding:20px; border-radius:8px;">
                    <h3>Státusz: <span id="live-status" style="color:#3498db">${statusHtml}</span></h3>
                    <p id="live-speed">🚗 Sebesség: ${Math.round(update.speed || 0)} km/h</p>
                    <p id="live-license">🚚 Rendszám: ${licenseHtml}</p>
                    <hr style="border-color:#444">

                    <div id="live-tour-container" style="${update.current_tour ? '' : 'display:none'}">
                        <div style="background:#333; padding:15px; border-radius:8px; margin-top:10px;">
                            <h4 style="margin:0; color:#2ecc71;">📦 Aktuális túra: <span id="live-tour-name">${currentTourHtml}</span></h4>
                            <div style="display:flex; justify-content:space-between; margin-top:10px;">
                                <div style="text-align:center; flex:1;">
                                    <div style="font-size:11px; color:#aaa; text-transform:uppercase;">Következőig</div>
                                    <div id="live-next-dist" style="font-size:18px; font-weight:bold; color:#3498db;">${update.next_stop_dist ? update.next_stop_dist.toFixed(1) + ' km' : 'N/A'}</div>
                                    <div style="font-size:11px; color:#3498db;" id="nextStopDurationDisplay"></div>
                                </div>
                                <div style="width:1px; background:#444;"></div>
                                <div style="text-align:center; flex:1;">
                                    <div style="font-size:11px; color:#aaa; text-transform:uppercase;">Túra összesen</div>
                                    <div id="live-tour-dist" style="font-size:18px; font-weight:bold; color:#2ecc71;">${update.tour_remaining_dist ? update.tour_remaining_dist.toFixed(1) + ' km' : 'N/A'}</div>
                                    <div style="font-size:11px; color:#2ecc71;" id="tourDurationDisplay"></div>
                                </div>
                            </div>
                            <div id="live-break-container" style="margin-top:10px; font-size:11px; color:#e74c3c; text-align:center; border-top:1px solid #444; padding-top:5px; ${update.next_break_in_seconds ? '' : 'display:none'}">
                                ⚠️ Következő pihenő kb. <span id="nextBreakDisplay"></span> múlva
                            </div>
                        </div>
                    </div>
                    <p id="no-tour-msg" style="color:#777; ${update.current_tour ? 'display:none' : ''}">Nincs aktív túra</p>

                    <div id="live-next-stop-container" style="background:#34495e; padding:15px; border-radius:8px; margin-top:10px; ${update.next_stop ? '' : 'display:none'}">
                        <h4 style="margin:0; color:#3498db;">📍 Következő cím:</h4>
                        <div id="live-next-stop-details">
                            ${nextStopDetailsHtml}
                        </div>
                    </div>

                    ${update.depot_name ? `
                        <p style="margin-top:20px; font-size:12px; color:#999;">🏠 Depó: ${depotNameHtml}</p>
                    ` : ''}
                </div>
            </div>
        </div>
        <div id="tours" class="tab-content">
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="editTour()" style="background:#2ecc71; color:white; padding:10px;">+ Új túra</button>
                <button onclick="document.getElementById('tourExcelImport').click()" style="background:#3498db; color:white; padding:10px;">Excel import</button>
                <button onclick="location.href='/tour-import-template.xlsx'" style="background:#555; color:white; padding:10px;">Sablon letöltése</button>
                <input type="file" id="tourExcelImport" accept=".xlsx,.xls,.csv" style="display:none" onchange="importTourFromExcel(this)">
            </div>
            <div id="tours-list">
                ${toursRes.map(t => `
                    <div class="tour-card">
                        <div style="float:right; display:flex; gap:5px;">
                            <small style="color:#777; align-self:center; margin-right:10px;">ID: #${t.id} | UUID: ${(t.uuid || '').slice(0,8)}...</small>
                            <select onchange="transferTour(${t.id}, this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>${allD.map(n => "<option value='" + escapeHtml(n) + "'>" + escapeHtml(n) + "</option>").join('')}</select>
                            <button onclick="editTour(JSON.parse(decodeURIComponent('${encodeURIComponent(JSON.stringify(t))}')))">✏</button>
                            <button onclick="deleteTour(${t.id})" style="background:#e74c3c; color:white;">🗑</button>
                        </div>
                        <b>${escapeHtml(t.name)}</b> (${escapeHtml(t.customer || '')}) - ${new Date(Number(t.date)).toLocaleDateString()}
                        ${t.stops.map(s => {
                            const stopTitle = s.recipient || s.contact_name || s.company || s.address_full || s.address || 'Megálló';
                            const stopAddress = s.address_full || s.address || '';
                            const stopDate = s.stop_date || s.stopDate;
                            const stopMeta = [s.time_window, s.phone_number, s.notes].filter(Boolean).map(escapeHtml).join(' | ');
                            const stopPhoto = s.photo_url || s.photoUrl || '';
                            return "<div class='stop-item'>" +
                                "<small style='color:#777;display:block;'>Stop ID: #" + s.id + " | UUID: " + (s.uuid || '').slice(0,8) + "...</small>" +
                                "<b>" + (s.order_index + 1) + ". " + (s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')) + escapeHtml(stopTitle) + "</b>" +
                                (stopAddress ? "<br><span>" + escapeHtml(stopAddress) + "</span>" : "") +
                                (stopDate ? "<br><small style='color:#9fd3ff;'>Dátum: " + new Date(Number(stopDate)).toLocaleDateString() + "</small>" : "") +
                                (stopMeta ? "<br><small style='color:#aaa;'>" + stopMeta + "</small>" : "") +
                                (stopPhoto ? "<br><img src='" + escapeHtml(stopPhoto) + "' style='margin-top:8px;max-width:220px;max-height:140px;border-radius:6px;object-fit:cover;border:1px solid #444;'>" : "") +
                                "</div>";
                        }).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
        <div id="history" class="tab-content">
            <div style="display:flex; gap:10px; margin-bottom:20px; align-items:center;">
                <label style="color:white; font-size:14px;">Dátum választása:</label>
                <input type="date" id="history-date" style="width:200px;" onchange="loadHistory()">
                <button onclick="loadHistory()" style="background:#3498db; color:white; padding:8px 20px;">BETÖLTÉS</button>
            </div>
            <div style="display:grid; grid-template-columns: 1fr; gap:20px;">
                <div id="history-map" style="height:400px; border-radius:8px;"></div>
                <div style="background:#222; padding:15px; border-radius:8px;">
                    <h3>Sebesség grafikon (km/h)</h3>
                    <canvas id="speedChart"></canvas>
                </div>
            </div>
        </div>
        <div id="costs" class="tab-content">
            <div style="background:#222; padding:15px; border-radius:8px; margin-bottom:15px;">
                <h3 style="margin-top:0;">Új költség</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px;">
                    <div><label>Összeg</label><input type="number" step="0.01" id="costAmount"></div>
                    <div><label>Pénznem</label><input type="text" id="costCurrency" value="EUR"></div>
                    <div><label>Kategória</label><select id="costCategory"><option>Tankolás</option><option>Parkolás</option><option>Matrica</option><option>Útdíj</option><option>Hotel</option><option>Szerviz</option><option>Adblue</option><option>Mosás</option><option>Egyéb</option></select></div>
                    <div><label>Km állás</label><input type="number" id="costMileage"></div>
                </div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <input type="text" id="costNotes" placeholder="Megjegyzés">
                    <button onclick="saveWebCost()" style="width:160px; background:#3498db; color:white;">Mentés</button>
                </div>
            </div>
            <table><thead><tr><th>ID / UUID</th><th>Dátum</th><th>Kategória</th><th>Összeg</th><th>Státusz</th><th>Művelet</th></tr></thead><tbody id="costs-list">${costs.map(c => `<tr data-cost-id="${c.id}" data-cost-uuid="${escapeHtml(c.uuid || '')}"><td><small style="color:#777;">#${c.id}<br>${(c.uuid || '').slice(0,8)}</small></td><td>${new Date(Number(c.timestamp)).toLocaleDateString()}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(c.amount)} ${escapeHtml(c.currency)}</td><td class="cost-status">${escapeHtml(c.status)}</td><td><button data-uuid="${escapeHtml(c.uuid || '')}" data-id="${c.id}" data-status="Elfogadva" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Elfogadás</button> <button data-uuid="${escapeHtml(c.uuid || '')}" data-id="${c.id}" data-status="Kifizetve" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Kifizetve</button></td></tr>`).join('')}</tbody></table>
        </div>
        <div id="hotels" class="tab-content">
            <div style="background:#222; padding:15px; border-radius:8px; margin-bottom:15px;">
                <h3 style="margin-top:0;" id="hotelFormTitle">Új hotel</h3>
                <input type="hidden" id="hotelSource">
                <input type="hidden" id="hotelId">
                <input type="hidden" id="hotelUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div><label>Név</label><input type="text" id="hotelName"></div>
                    <div><label>Cím</label><input type="text" id="hotelAddress"></div>
                    <div><label>Szoba</label><input type="text" id="hotelRoom"></div>
                    <div><label>Kód</label><input type="text" id="hotelCode"></div>
                    <div><label>Buchungsnummer</label><input type="text" id="hotelBooking"></div>
                    <div><label>Telefon</label><input type="text" id="hotelPhone"></div>
                    <div><label>Email</label><input type="text" id="hotelEmail"></div>
                    <div><label>Megjegyzés</label><input type="text" id="hotelNotes"></div>
                </div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button onclick="saveWebHotel()" style="width:160px; background:#3498db; color:white;">Mentés</button>
                    <button onclick="resetHotelForm()" style="width:120px;">Új adat</button>
                </div>
            </div>
            <table><thead><tr><th>ID / UUID</th><th>Dátum</th><th>Név</th><th>Cím</th><th>Szoba</th><th>Kód</th><th>Buchungsnummer</th><th>Művelet</th></tr></thead><tbody id="hotels-list">${hotelsRes.map(h => `<tr><td><small style="color:#777;">#${h.id}<br>${(h.uuid || '').slice(0,8)}</small></td><td>${new Date(Number(h.timestamp)).toLocaleDateString()}</td><td>${escapeHtml(h.name)}</td><td>${escapeHtml(h.address)}</td><td>${escapeHtml(h.room_number || '')}</td><td>${escapeHtml(h.entry_code || '')}</td><td>${escapeHtml(h.booking_number || '')}</td><td><button data-hotel="${escapeHtml(JSON.stringify(h))}" onclick="editHotelRecord(JSON.parse(this.dataset.hotel))">Szerkesztés</button> <button data-hotel="${escapeHtml(JSON.stringify(h))}" onclick="deleteHotelRecord(JSON.parse(this.dataset.hotel))" style="background:#e74c3c;color:white;">Törlés</button></td></tr>`).join('')}</tbody></table>
        </div>
        <div id="chat" class="tab-content">
            <div id="chat-messages" style="height:400px; background:#111; padding:15px; overflow-y:auto; display:flex; flex-direction:column; margin-bottom:15px;">
                ${chat.map(m => `<div class="msg ${m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver'}"><b>${escapeHtml(m.sender)}:</b><br>${escapeHtml(m.message)}</div>`).join('')}
            </div>
            <div style="display:flex; gap:10px;">
                <input type="text" id="chat-input" placeholder="Üzenet írása..." onkeypress="if(event.key==='Enter') sendChat()">
                <button onclick="sendChat()" style="width:100px; background:#F57F17; color:black; font-weight:bold;">KÜLDÉS</button>
            </div>
        </div>
        <div id="stats" class="tab-content"><div id="statsBox"></div></div>
        <div id="report" class="tab-content"><h3>Tagesfahrblatt</h3><div id="timelineContainer"></div></div>
        <div id="profile" class="tab-content">
            <div style="max-width:600px; background:#222; padding:30px; border-radius:12px;">
                <h3>SOFŐR PROFIL</h3>
                <input type="hidden" id="prof-uuid" value="${escapeHtml(dInfo.uuid || '')}">
                <div id="profile-display">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="position: relative; display: inline-block;">
                            <img id="p-photo" src="${profilePhotoHtml}" style="width:120px; height:120px; border-radius:50%; background:#333; object-fit: cover; border: 2px solid #444;">
                            <label for="prof-photo-upload" style="position: absolute; bottom: 0; right: 0; background: #3498db; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid #222; font-size: 18px;">📷</label>
                            <input type="file" id="prof-photo-upload" style="display: none;" onchange="uploadWebPhoto(this)" accept="image/*">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                        <div><label>Név</label><input type="text" id="prof-name" value="${pageNameHtml}"></div>
                        <div><label>Rendszám</label><input type="text" id="prof-plate" value="${escapeHtml(dInfo.license_plate || update.license_plate || '')}"></div>
                        <div><label>Email</label><input type="text" id="prof-email" value="${driverEmailHtml}"></div>
                        <div><label>Telefon</label><input type="text" id="prof-phone" value="${driverPhoneHtml}"></div>
                        <div><label>WhatsApp</label><input type="text" id="prof-whatsapp" value="${escapeHtml(dInfo.whatsapp || '')}"></div>
                        <div><label>Telegram</label><input type="text" id="prof-telegram" value="${escapeHtml(dInfo.telegram || '')}"></div>
                    </div>
                    <div style="margin-top:20px;"><label>Profilkép URL</label><input type="text" id="prof-photo-url" value="${profilePhotoHtml}"></div>
                    <button onclick="saveProfile()" style="margin-top:30px; background:#3498db; color:white; padding:12px; width:100%;">PROFIL MENTÉSE</button>
                </div>
            </div>
        </div>
        <div id="tourModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; padding:50px;">
            <div style="background:#222; padding:30px; border-radius:12px; max-width:800px; margin:auto; max-height:90vh; overflow-y:auto;">
                <h2>Túra szerkesztése</h2><input type="hidden" id="tourId"><input type="hidden" id="tourUuid">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                    <div><label>Túra neve</label><input type="text" id="tName"></div><div><label>Megrendelő</label><input type="text" id="tCustomer"></div>
                    <div><label>Dátum</label><input type="date" id="tDate"></div>
                    <div style="display:flex; align-items:center; gap:10px; margin-top:20px;">
                        <input type="checkbox" id="tIsCurrent" style="width:20px; height:20px;">
                        <label for="tIsCurrent" style="font-size:14px; color:white;">Aktuális túra (Appban ez jelenik meg)</label>
                    </div>
                </div>
                <label>Megjegyzések</label><textarea id="tNotes" style="height:60px; margin-bottom:20px;"></textarea>
                <h3>Depó</h3>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"><input type="text" id="tDepotName" placeholder="Név"><input type="text" id="tDepotCompany" placeholder="Cég"></div>
                <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:10px;"><input type="text" id="tDepotStreet" placeholder="Utca"><input type="text" id="tDepotHouse" placeholder="Házszám"></div>
                <div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:10px;"><input type="text" id="tDepotPostal" placeholder="Irsz"><input type="text" id="tDepotCity" placeholder="Város"></div>
                <h3>Megállók</h3><div id="modalStops"></div><button onclick="addStopRow()">+ Megálló</button>
                <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;"><button onclick="closeModal()">Mégse</button><button onclick="saveTour(event)" style="background:#3498db; color:white; padding:10px 30px;">Mentés</button></div>
            </div>
        </div>

        <script>
            function esc(value) {
                return String(value ?? '').replace(/[&<>"']/g, ch => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[ch]));
            }
            const DRIVER_NAME = '${pageNameJs}';

            function getAdminToken() {
                let token = localStorage.getItem('adminToken') || '';
                if (!token) {
                    token = prompt('Admin token:') || '';
                    if (token) localStorage.setItem('adminToken', token);
                }
                return token;
            }

            async function adminFetch(url, options = {}, retry = true) {
                const token = getAdminToken();
                const headers = Object.assign({}, options.headers || {});
                if (token) headers.Authorization = 'Bearer ' + token;
                const response = await fetch(url, Object.assign({}, options, { headers }));
                if ((response.status === 401 || response.status === 503) && retry) {
                    localStorage.removeItem('adminToken');
                    const message = await response.text().catch(() => '');
                    showToast(message || 'Admin token hibás vagy hiányzik.');
                    const nextToken = prompt('Admin token:') || '';
                    if (nextToken) {
                        localStorage.setItem('adminToken', nextToken);
                        return adminFetch(url, options, false);
                    }
                }
                return response;
            }

            function openTab(e, t) {
                localStorage.setItem('activeTab_' + DRIVER_NAME, t);
                document.querySelectorAll('.tab-content').forEach(x => {
                    x.style.display = 'none';
                    x.classList.remove('active');
                });
                document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
                const target = document.getElementById(t);
                if (target) {
                    target.style.display = 'block';
                    target.classList.add('active');
                    const btn = e ? e.currentTarget : document.querySelector('nav button[data-tab="' + t + '"]');
                    if (btn) btn.classList.add('active');
                    if (t === 'dashboard' && typeof map !== 'undefined') {
                        setTimeout(() => map.invalidateSize(), 100);
                    }
                    if (t === 'history') {
                        setTimeout(() => {
                            if (historyMap) historyMap.invalidateSize();
                            else initHistoryMap();
                        }, 100);
                    }
                    if (t === 'stats') {
                        loadStats();
                    }
                    if (t === 'hotels') {
                        refreshHotels();
                    }
                }
            }

            // History Logic
            let historyMap = null;
            let historyRouteLayer = null;
            let speedChart = null;

            function initHistoryMap() {
                if (historyMap) return;
                historyMap = L.map('history-map').setView([47.4979, 19.0402], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap'
                }).addTo(historyMap);
            }

            async function loadHistory() {
                const date = document.getElementById('history-date').value;
                if (!date) return;
                initHistoryMap();
                try {
                    const r = await fetch('/api/get-history/' + encodeURIComponent(DRIVER_NAME) + '/' + date);
                    const data = await r.json();
                    if (!data || data.length === 0) {
                        showToast('Nincs adat ehhez a naphoz.');
                        if (historyRouteLayer) historyMap.removeLayer(historyRouteLayer);
                        if (speedChart) speedChart.destroy();
                        return;
                    }

                    // Map Route
                    const points = data.filter(d => d.latitude && d.longitude).map(d => [d.latitude, d.longitude]);
                    if (historyRouteLayer) historyMap.removeLayer(historyRouteLayer);
                    if (points.length > 0) {
                        historyRouteLayer = L.polyline(points, { color: '#e74c3c', weight: 4 }).addTo(historyMap);
                        historyMap.fitBounds(historyRouteLayer.getBounds(), { padding: [30, 30] });
                    }

                    // Speed Chart
                    const labels = data.map(d => new Date(Number(d.timestamp)).toLocaleTimeString());
                    const speeds = data.map(d => Math.round(d.speed || 0));

                    if (speedChart) speedChart.destroy();
                    const ctx = document.getElementById('speedChart').getContext('2d');
                    speedChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{
                                label: 'Sebesség',
                                data: speeds,
                                borderColor: '#3498db',
                                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            scales: {
                                y: { beginAtZero: true, grid: { color: '#444' }, ticks: { color: '#aaa' } },
                                x: { grid: { display: false }, ticks: { color: '#aaa' } }
                            },
                            plugins: { legend: { display: false } }
                        }
                    });

                } catch (e) { console.error('History error:', e); showToast('Hiba a betöltés során.'); }
            }

            document.getElementById('history-date').value = new Date().toISOString().split('T')[0];

            // Kezdő tab betöltése
            const savedTab = localStorage.getItem('activeTab_' + DRIVER_NAME) || 'dashboard';

            // Térkép inicializálása
            let DRIVING_DONE_TODAY = ${drivingTodaySec};

            function formatDuration(seconds) {
                if (!seconds || seconds <= 0) return 'N/A';
                let mins = Math.round(seconds / 60);
                let hours = Math.floor(mins / 60);
                mins = mins % 60;
                let days = Math.floor(hours / 24);
                hours = hours % 24;
                if (days > 0) return days + ' nap, ' + hours + ':' + mins.toString().padStart(2, '0');
                return hours + ':' + mins.toString().padStart(2, '0');
            }

            function formatStatDuration(seconds) {
                const safeSeconds = Number(seconds || 0);
                let mins = Math.round(safeSeconds / 60);
                const hours = Math.floor(mins / 60);
                mins = mins % 60;
                return hours + ':' + mins.toString().padStart(2, '0');
            }

            async function loadStats() {
                const box = document.getElementById('statsBox');
                if (!box) return;
                box.innerHTML = '<p style="color:#aaa;">Statisztika betöltése...</p>';
                try {
                    const r = await fetch('/api/stats/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) throw new Error(await r.text());
                    const s = await r.json();
                    box.innerHTML =
                        '<h3 style="margin-top:0;">Statisztika - ' + esc(s.month || '') + '</h3>' +
                        '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:15px;">' +
                            statCard('Mai munkaidő', formatStatDuration(s.workTodaySeconds)) +
                            statCard('Mai vezetés', formatStatDuration(s.drivingTodaySeconds)) +
                            statCard('Mai pihenő', formatStatDuration(s.restTodaySeconds)) +
                            statCard('Havi munkaidő', formatStatDuration(s.workMonthSeconds)) +
                            statCard('Havi vezetés', formatStatDuration(s.drivingMonthSeconds)) +
                            statCard('Havi pihenő', formatStatDuration(s.restMonthSeconds)) +
                            statCard('Havi költség', Number(s.costMonthTotal || 0).toFixed(2) + ' EUR') +
                            statCard('Költség tételek', s.costMonthCount || 0) +
                            statCard('Havi túrák', s.tourMonthCount || 0) +
                        '</div>';
                } catch (e) {
                    box.innerHTML = '<p style="color:#e74c3c;">Nem sikerült betölteni a statisztikát.</p>';
                    console.error('Stats error:', e);
                }
            }

            function statCard(label, value) {
                return '<div style="background:#222; padding:18px; border-radius:8px;">' +
                    '<div style="font-size:12px; color:#aaa; text-transform:uppercase;">' + esc(label) + '</div>' +
                    '<div style="font-size:24px; font-weight:bold; margin-top:8px;">' + esc(value) + '</div>' +
                '</div>';
            }

            function calculateAdjustedDuration(pureSec, doneSec) {
                if (!pureSec) return 0;
                let total = pureSec;
                let blockSize = 16200; // 4.5h
                let restSize = 2700; // 45m
                let progress = doneSec % blockSize;
                let remaining = blockSize - progress;
                if (pureSec > remaining) {
                    total += restSize;
                    let left = pureSec - remaining;
                    total += Math.floor(left / blockSize) * restSize;
                }
                // Daily limit 9h
                if (doneSec + pureSec > 32400) {
                    total += 39600; // 11h
                }
                return total;
            }

            // Update displays
            let nextDur = ${update.next_stop_duration || 0};
            let tourDur = ${update.tour_remaining_duration || 0};
            let nextBreak = ${update.next_break_in_seconds || 0};
            let isAdjusted = ${update.include_rests ?? true};

            function updateTimeDisplays() {
                try {
                    if (nextDur > 0) {
                        const d = isAdjusted ? nextDur : calculateAdjustedDuration(nextDur, DRIVING_DONE_TODAY);
                        document.getElementById('nextStopDurationDisplay').innerText = formatDuration(d);
                    } else { document.getElementById('nextStopDurationDisplay').innerText = ''; }

                    if (tourDur > 0) {
                        const d = isAdjusted ? tourDur : calculateAdjustedDuration(tourDur, DRIVING_DONE_TODAY);
                        document.getElementById('tourDurationDisplay').innerText = formatDuration(d);
                    } else { document.getElementById('tourDurationDisplay').innerText = ''; }

                    if (nextBreak > 0 && document.getElementById('nextBreakDisplay')) {
                        document.getElementById('nextBreakDisplay').innerText = formatDuration(nextBreak);
                        document.getElementById('live-break-container').style.display = 'block';
                    } else if (document.getElementById('live-break-container')) {
                        document.getElementById('live-break-container').style.display = 'none';
                    }
                } catch(e) { console.error('Time update error:', e); }
            }
            updateTimeDisplays();

            const driverLat = ${update.latitude || 47.4979};
            const driverLng = ${update.longitude || 19.0402};
            const map = L.map('map', { zoomControl: true }).setView([driverLat, driverLng], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(map);

            // Sofőr marker (kék kör fehér szegéllyel)
            const driverMarker = L.circleMarker([driverLat, driverLng], {
                color: '#3498db', radius: 10, fillOpacity: 1, weight: 3, fillColor: '#fff'
            }).addTo(map).bindPopup('<b>' + esc(DRIVER_NAME) + '</b><br><span id="popup-speed">Sebesség: ${Math.round(update.speed || 0)} km/h</span>');

            let routeLayer = null;
            const stopMarkerLayer = L.layerGroup().addTo(map);
            let lastNextLat = ${update.next_lat || 0};
            let lastNextLng = ${update.next_lng || 0};

            async function drawRoute(currentLat, currentLng, stops, depotLat, depotLng) {
                const incompleteStops = (stops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
                let waypoints = [[currentLat, currentLng]];

                incompleteStops.forEach(s => {
                    waypoints.push([s.latitude, s.longitude]);
                });

                if (depotLat != null && depotLat !== 0 && !isNaN(depotLat)) {
                    waypoints.push([depotLat, depotLng]);
                }

                if (waypoints.length > 1) {
                    try {
                        const waypointStr = waypoints.map(w => w[1] + ',' + w[0]).join(';');
                        const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson');
                        const data = await r.json();
                        if (data.routes && data.routes[0]) {
                            if (routeLayer) map.removeLayer(routeLayer);
                            routeLayer = L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.7 } }).addTo(map);
                        }
                    } catch (e) { console.error('Route error:', e); }
                } else if (routeLayer) {
                    map.removeLayer(routeLayer);
                    routeLayer = null;
                }
            }

            function renderStopMarkers(stops) {
                stopMarkerLayer.clearLayers();
                (stops || []).forEach(s => {
                    if (s.latitude && s.longitude) {
                        const order = Number(s.order_index || 0) + 1;
                        const icon = L.divIcon({
                            className: 'custom-div-icon',
                            html: "<div style='background-color:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid white;'>" + order + "</div>",
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([s.latitude, s.longitude], { icon: icon }).addTo(stopMarkerLayer)
                            .bindPopup(order + '. ' + (s.recipient || s.address_full || s.address || 'Megálló'));
                    }
                });
            }

            async function refreshMapTour() {
                try {
                    const r = await fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const tourData = data.find(item => item.tour.is_current) || (data.length > 0 ? data[0] : null);
                    const stops = tourData ? tourData.stops : [];
                    const pos = driverMarker.getLatLng();
                    const dLat = (tourData && tourData.tour.depot_lat) ? tourData.tour.depot_lat : 0;
                    const dLng = (tourData && tourData.tour.depot_lng) ? tourData.tour.depot_lng : 0;
                    drawRoute(pos.lat, pos.lng, stops, dLat, dLng);
                    renderStopMarkers(stops);
                } catch (e) { console.error('Map tour refresh error:', e); }
            }

            // Kezdeti útvonal
            const rawStops = ${currentStopsJson};
            const tourDepotLat = ${currentTourObj ? currentTourObj.depot_lat || 0 : 0};
            const tourDepotLng = ${currentTourObj ? currentTourObj.depot_lng || 0 : 0};

            if (rawStops && rawStops.length > 0) {
                drawRoute(driverLat, driverLng, rawStops, tourDepotLat, tourDepotLng);
            }

            async function refreshLiveStatus() {
                try {
                    const r = await fetch('/api/live-status/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const d = await r.json();
                    if (!d.timestamp) return;

                    // Update UI text
                    document.getElementById('live-status').innerText = d.status || 'N/A';
                    document.getElementById('live-speed').innerText = '🚗 Sebesség: ' + Math.round(d.speed || 0) + ' km/h';
                    document.getElementById('live-license').innerText = '🚚 Rendszám: ' + (d.license_plate || 'N/A');
                    const popupSpeed = document.getElementById('popup-speed');
                    if (popupSpeed) popupSpeed.innerText = 'Sebesség: ' + Math.round(d.speed || 0) + ' km/h';

                    if (d.current_tour) {
                        document.getElementById('live-tour-container').style.display = 'block';
                        document.getElementById('no-tour-msg').style.display = 'none';
                        document.getElementById('live-tour-name').innerText = d.current_tour;

                        const nDist = (d.next_stop_dist !== null && d.next_stop_dist !== undefined) ? d.next_stop_dist : 0;
                        const tDist = (d.tour_remaining_dist !== null && d.tour_remaining_dist !== undefined) ? d.tour_remaining_dist : 0;

                        document.getElementById('live-next-dist').innerText = nDist.toFixed(1) + ' km';
                        document.getElementById('live-tour-dist').innerText = tDist.toFixed(1) + ' km';
                    } else {
                        document.getElementById('live-tour-container').style.display = 'none';
                        document.getElementById('no-tour-msg').style.display = 'block';
                    }

                    if (d.next_stop) {
                        document.getElementById('live-next-stop-container').style.display = 'block';
                        let html = '';
                        if (d.next_stop.includes(' | ')) {
                            const nextParts = d.next_stop.split(' | ');
                            html = '<b style="display:block; margin-top:5px; color:#fff;">' + esc(nextParts[0]) + '</b>' +
                                   '<p style="margin:2px 0; font-size:13px; color:#ccc;">' + esc(nextParts.slice(1).join(' | ')) + '</p>';
                        } else {
                            html = '<p style="margin:5px 0; font-size:14px;">' + esc(d.next_stop) + '</p>';
                        }
                        document.getElementById('live-next-stop-details').innerHTML = html;
                    } else {
                        document.getElementById('live-next-stop-container').style.display = 'none';
                    }

                    nextDur = d.next_stop_duration || 0;
                    tourDur = d.tour_remaining_duration || 0;
                    nextBreak = d.next_break_in_seconds || 0;
                    isAdjusted = d.include_rests ?? true;
                    if (d.drivingTodaySec !== undefined) DRIVING_DONE_TODAY = d.drivingTodaySec;
                    updateTimeDisplays();

                    // Update Map
            if (d.latitude && d.longitude) {
                        const newPos = [d.latitude, d.longitude];
                        driverMarker.setLatLng(newPos);
                        driverMarker.setPopupContent('<b>' + esc(DRIVER_NAME) + '</b><br>Sebesség: ' + Math.round(d.speed || 0) + ' km/h');

                        // Útvonal frissítése ha mozog vagy a célpont változott
                        if (d.next_lat !== lastNextLat || d.next_lng !== lastNextLng || Math.abs(d.latitude - lastUpdateLat) > 0.0005) {
                            lastNextLat = d.next_lat;
                            lastNextLng = d.next_lng;
                            lastUpdateLat = d.latitude;
                            lastUpdateLng = d.longitude;
                            refreshTours();
                            fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME))
                                .then(r => r.json())
                                .then(data => {
                                    const tourData = data.find(item => item.tour.is_current) || (data.length > 0 ? data[0] : null);
                                    const stops = tourData ? tourData.stops : [];
                                    const dLat = (tourData && tourData.tour.depot_lat) ? tourData.tour.depot_lat : d.depot_lat;
                                    const dLng = (tourData && tourData.tour.depot_lng) ? tourData.tour.depot_lng : d.depot_lng;
                                    drawRoute(d.latitude, d.longitude, stops, dLat, dLng);
                                    renderStopMarkers(stops);
                                });
                        }
                    }
                } catch (e) { console.error('Refresh error:', e); }
            }

            // Inicializálás
            let lastUpdateLat = driverLat;
            let lastUpdateLng = driverLng;

            refreshLiveStatus();
            refreshTours();
            refreshChat();
            openTab(null, savedTab);

            setInterval(refreshLiveStatus, 5000);
            setInterval(refreshMapTour, 15000);

            // Túra állomások
            const bounds = L.latLngBounds([driverLat, driverLng]);

            renderStopMarkers(rawStops);
            if (rawStops) {
                rawStops.forEach(s => {
                    if (s.latitude && s.longitude) bounds.extend([s.latitude, s.longitude]);
                });
            }

            // Depó marker
            if (${update.depot_lat != null && update.depot_lat !== 0 ? 'true' : 'false'}) {
                const depotIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: "<div style='background-color:#2ecc71; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid white;'>🏠</div>",
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                L.marker([${update.depot_lat || 0}, ${update.depot_lng || 0}], { icon: depotIcon }).addTo(map).bindPopup('🏠 Depó: ${escapeJsString(update.depot_name || 'Bázis')}');
                bounds.extend([${update.depot_lat || 0}, ${update.depot_lng || 0}]);
            }

            // Térkép igazítása
            if ((rawStops && rawStops.length > 0) || ${update.depot_lat ? 'true' : 'false'}) {
                const center = [driverLat, driverLng];
                let maxDLat = 0;
                let maxDLng = 0;

                if (rawStops) {
                    rawStops.forEach(s => {
                        if (s.latitude && s.longitude) {
                            maxDLat = Math.max(maxDLat, Math.abs(s.latitude - driverLat));
                            maxDLng = Math.max(maxDLng, Math.abs(s.longitude - driverLng));
                        }
                    });
                }

                if (${update.depot_lat ? 'true' : 'false'}) {
                    maxDLat = Math.max(maxDLat, Math.abs(${update.depot_lat || 0} - driverLat));
                    maxDLng = Math.max(maxDLng, Math.abs(${update.depot_lng || 0} - driverLng));
                }

                const fitBounds = [
                    [driverLat - maxDLat * 1.1 - 0.002, driverLng - maxDLng * 1.1 - 0.002],
                    [driverLat + maxDLat * 1.1 + 0.002, driverLng + maxDLng * 1.1 + 0.002]
                ];
                map.fitBounds(fitBounds, { padding: [50, 50], maxZoom: 15 });
            }

            // Útvonal tervezése a teljes hátralévő túrára
            const currentTourData = ${JSON.stringify(currentTourObj || (toursRes.length > 0 ? toursRes[0] : null))};
            const incompleteStops = (rawStops || []).filter(s => !s.is_completed && s.latitude && s.longitude);
            let waypointStr = driverLng + ',' + driverLat;

            incompleteStops.forEach(s => {
                waypointStr += ';' + s.longitude + ',' + s.latitude;
            });

            const initialDepotLat = (currentTourData && currentTourData.depot_lat) ? currentTourData.depot_lat : ${update.depot_lat || 0};
            const initialDepotLng = (currentTourData && currentTourData.depot_lng) ? currentTourData.depot_lng : ${update.depot_lng || 0};

            if (initialDepotLat != null && initialDepotLat !== 0) {
                waypointStr += ';' + initialDepotLng + ',' + initialDepotLat;
            }

            if (waypointStr.includes(';')) {
                fetch('https://router.project-osrm.org/route/v1/driving/' + waypointStr + '?overview=full&geometries=geojson')
                    .then(r => r.json())
                    .then(data => {
                        if (data.routes && data.routes[0]) {
                            L.geoJSON(data.routes[0].geometry, { style: { color: '#3498db', weight: 5, opacity: 0.7 } }).addTo(map);
                        }
                    });
            }

            // Kényszerített újrarajzolás a méretezési hiba ellen
            setTimeout(() => {
                map.invalidateSize();
                if ((rawStops && rawStops.length > 0) || ${update.depot_lat ? 'true' : 'false'}) {
                     try { map.fitBounds(map.getBounds(), { padding: [50, 50] }); } catch(e) {}
                }
            }, 800);

            // Periodikus térkép frissítés a szétesés ellen
            setInterval(() => {
                if (document.getElementById('dashboard').style.display !== 'none') {
                    map.invalidateSize();
                }
            }, 10000);

            // Végül nyissuk meg az elmentett fület
            openTab(null, savedTab);

            // Profile & Driver Admin JS
            async function loadProfile() {
                try {
                    const r = await fetch('/api/get-profile/' + encodeURIComponent(DRIVER_NAME));
                    if (r.ok) {
                        const d = await r.json();
                        document.getElementById('prof-whatsapp').value = d.whatsapp || '';
                        document.getElementById('prof-telegram').value = d.telegram || '';
                        if (d.photo_url) {
                            document.getElementById('p-photo').src = d.photo_url;
                            document.getElementById('prof-photo-url').value = d.photo_url;
                        }
                    }
                } catch(e) {}
            }
            loadProfile();

            async function saveProfile() {
                const data = {
                    uuid: document.getElementById('prof-uuid').value,
                    name: document.getElementById('prof-name').value,
                    licensePlate: document.getElementById('prof-plate').value,
                    email: document.getElementById('prof-email').value,
                    phone: document.getElementById('prof-phone').value,
                    whatsapp: document.getElementById('prof-whatsapp').value,
                    telegram: document.getElementById('prof-telegram').value,
                    photoUrl: document.getElementById('prof-photo-url').value
                };
                const r = await fetch('/api/sync-profile', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(r.ok) {
                    showToast('Profil mentve és szinkronizálva!');
                    if (data.name !== DRIVER_NAME) {
                        setTimeout(() => location.href = '/driver/' + encodeURIComponent(data.name), 1000);
                    }
                }
            }

            async function uploadWebPhoto(input) {
                if (!input.files || !input.files[0]) return;
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result.split(',')[1];
                    const res = await fetch('/api/upload-photo', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            uuid: document.getElementById('prof-uuid').value,
                            driverName: document.getElementById('prof-name').value,
                            imageBase64: base64
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('p-photo').src = data.photoUrl;
                        document.getElementById('prof-photo-url').value = data.photoUrl;
                        showToast('Kép sikeresen feltöltve!');
                    }
                };
                reader.readAsDataURL(file);
            }

            async function refreshDrivers() {
                try {
                    const r = await fetch('/api/all-drivers');
                    const drivers = await r.json();
                    const container = document.getElementById('drivers-list');
                    if (!container) return;
                    container.innerHTML = drivers.map(d =>
                        '<tr>' +
                            '<td><b>' + esc(d.name) + '</b></td>' +
                            '<td>' + esc(d.email || '') + '<br><small>' + esc(d.phone || '') + '</small></td>' +
                            '<td>' + esc(d.license_plate || '') + '</td>' +
                            '<td><code style="background:#444; padding:2px 5px;">' + esc(d.activation_code || '---') + '</code></td>' +
                            '<td><span style="color:' + (d.is_active ? '#2ecc71' : '#e74c3c') + '">' + (d.is_active ? 'AKTÍV' : 'INAKTÍV') + '</span></td>' +
                            '<td>' +
                                '<button data-driver="' + encodeURIComponent(JSON.stringify(d)) + '" onclick="editDriver(JSON.parse(decodeURIComponent(this.dataset.driver)))">✏</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="unlinkDriverDevices(this.dataset.uuid)" style="background:#f39c12; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">📱 leválaszt</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="deleteDriver(this.dataset.uuid)" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">🗑</button>' +
                            '</td>' +
                        '</tr>').join('');
                } catch(e) { console.error('refreshDrivers error:', e); }
            }
            refreshDrivers();

            async function deleteDriver(uuid) {
                if (!confirm('Biztosan törölni szeretnéd ezt a sofőrt? Minden adata elvész!')) return;
                const r = await adminFetch('/admin/delete-driver', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ uuid })
                });
                if (r.ok) {
                    showToast('Sofőr törölve.');
                    refreshDrivers();
                }
            }

            async function unlinkDriverDevices(uuid) {
                if (!confirm('Leválasztod a sofőr társított telefonjait? A sofőr és az adatai megmaradnak.')) return;
                const r = await adminFetch('/admin/unlink-driver-devices', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ uuid })
                });
                if (r.ok) {
                    showToast('Telefonos társítás leválasztva.');
                    refreshDrivers();
                }
            }

            function editDriver(d) {
                document.getElementById('dUuid').value = d ? d.uuid : '';
                document.getElementById('dName').value = d ? d.name : '';
                document.getElementById('dPlate').value = d ? d.license_plate : '';
                document.getElementById('dEmail').value = d ? d.email : '';
                document.getElementById('dPhone').value = d ? d.phone : '';
                document.getElementById('dWhatsapp').value = d ? d.whatsapp : '';
                document.getElementById('dTelegram').value = d ? d.telegram : '';
                document.getElementById('dPhoto').value = d ? d.photo_url : '';
                document.getElementById('dActive').checked = d ? d.is_active : true;
                document.getElementById('driverModal').style.display = 'block';
            }

            async function saveDriver() {
                const data = {
                    uuid: document.getElementById('dUuid').value || null,
                    name: document.getElementById('dName').value,
                    license_plate: document.getElementById('dPlate').value,
                    email: document.getElementById('dEmail').value,
                    phone: document.getElementById('dPhone').value,
                    whatsapp: document.getElementById('dWhatsapp').value,
                    telegram: document.getElementById('dTelegram').value,
                    photo_url: document.getElementById('dPhoto').value,
                    is_active: document.getElementById('dActive').checked
                };
                const r = await adminFetch('/admin/save-driver', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(r.ok) {
                    showToast('Sofőr adatai mentve!');
                    document.getElementById('driverModal').style.display = 'none';
                    refreshDrivers();
                }
            }

            async function importDriver() {
                const code = document.getElementById('importCode').value.trim();
                if (!code) return;
                try {
                    const r = await fetch('/api/activate-driver', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ code })
                    });
                    if (r.ok) {
                        const driver = await r.json();
                        showToast('Sofőr importálva: ' + driver.name);
                        document.getElementById('importCode').value = '';
                        refreshDrivers();
                    } else {
                        alert('Érvénytelen kód vagy a sofőr már importálva van.');
                    }
                } catch (e) { console.error('Import error:', e); }
            }

            function showToast(msg) {
                const c = document.getElementById('toast-container');
                const t = document.createElement('div');
                t.className = 'toast';
                t.innerText = msg;
                c.appendChild(t);
                setTimeout(() => t.remove(), 3000);
            }

            async function refreshTours() {
                try {
                    const r = await fetch('/api/get-tours/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('tours-list');
                    if (!container) return;

                    const allDNames = ${JSON.stringify(allD)};

                    container.innerHTML = data.map(item => {
                        const t = item.tour;
                        const stops = item.stops;
                        return '<div class="tour-card">' +
                            '<div style="float:right; display:flex; gap:5px;">' +
                                '<select onchange="transferTour(' + t.id + ', this.value)" style="width:auto;"><option value="">-- Áthelyezés --</option>' + allDNames.map(n => "<option value='" + esc(n) + "'>" + esc(n) + "</option>").join('') + '</select>' +
                                '<button data-tour="' + encodeURIComponent(JSON.stringify(Object.assign({}, t, { stops }))) + '" onclick="editTour(JSON.parse(decodeURIComponent(this.dataset.tour)))">✏</button>' +
                                '<button onclick="deleteTour(' + t.id + ')" style="background:#e74c3c; color:white;">🗑</button>' +
                            '</div>' +
                            '<b>' + esc(t.name) + '</b> (' + esc(t.customer || '') + ') - ' + new Date(Number(t.date)).toLocaleDateString() + ' ' +
                            stops.map(renderTourStop).join('') +
                        '</div>';
                    }).join('');
                } catch (e) { console.error('Refresh tours error:', e); }
            }

            function renderTourStop(s) {
                const stopTitle = s.recipient || s.contact_name || s.company || s.address_full || s.address || 'Megálló';
                const stopAddress = s.address_full || s.address || '';
                const stopMeta = [s.time_window, s.phone_number, s.notes].filter(Boolean).map(esc).join(' | ');
                const stopPhoto = s.photo_url || s.photoUrl || '';
                return "<div class='stop-item'><b>" + (s.order_index + 1) + ". " + (s.stop_type === 'HOTEL' ? '🏨 ' : (s.stop_type === 'DEPOT' ? '🏠 ' : '')) + esc(stopTitle) + "</b>" +
                    (stopAddress ? "<br><span>" + esc(stopAddress) + "</span>" : "") +
                    (stopMeta ? "<br><small style='color:#aaa;'>" + stopMeta + "</small>" : "") +
                    (stopPhoto ? "<br><img src='" + esc(stopPhoto) + "' style='margin-top:8px;max-width:220px;max-height:140px;border-radius:6px;object-fit:cover;border:1px solid #444;'>" : "") +
                    "</div>";
            }

            async function sendChat() {
                const input = document.getElementById('chat-input');
                const msg = input.value.trim();
                if (!msg) return;
                try {
                    const res = await fetch('/api/send-chat', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            driverName: DRIVER_NAME,
                            sender: 'DISZPÉCSER',
                            message: msg,
                            timestamp: Date.now()
                        })
                    });
                    if (res.ok) {
                        input.value = '';
                        refreshChat();
                    }
                } catch (e) { console.error('Chat error:', e); }
            }

            async function refreshChat() {
                try {
                    const r = await fetch('/api/get-chat/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const container = document.getElementById('chat-messages');
                    if (!container) return;
                    container.innerHTML = data.map(m =>
                        '<div class="msg ' + (m.sender === 'DISZPÉCSER' ? 'msg-boss' : 'msg-driver') + '">' +
                            '<b>' + esc(m.sender) + ':</b><br>' + esc(m.message) +
                        '</div>').join('');
                    container.scrollTop = container.scrollHeight;
                } catch (e) { console.error('Refresh chat error:', e); }
            }

            setInterval(refreshChat, 3000);

            function renderCostRow(c) {
                const id = Number(c.id || 0);
                const uuid = c.uuid || '';
                return '<tr data-cost-id="' + id + '" data-cost-uuid="' + esc(uuid) + '">' +
                    '<td>' + new Date(Number(c.timestamp || Date.now())).toLocaleDateString() + '</td>' +
                    '<td>' + esc(c.category || '') + '</td>' +
                    '<td>' + esc(c.amount || 0) + ' ' + esc(c.currency || 'EUR') + '</td>' +
                    '<td class="cost-status">' + esc(c.status || 'Rögzítve') + '</td>' +
                    '<td><button data-uuid="' + esc(uuid) + '" data-id="' + id + '" data-status="Elfogadva" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Elfogadás</button> ' +
                    '<button data-uuid="' + esc(uuid) + '" data-id="' + id + '" data-status="Kifizetve" onclick="updateCostStatus(this.dataset.uuid, Number(this.dataset.id), this.dataset.status)">Kifizetve</button></td>' +
                '</tr>';
            }

            function renderHotelRow(h) {
                const payload = esc(JSON.stringify(h || {}));
                return '<tr>' +
                    '<td>' + new Date(Number(h.timestamp || Date.now())).toLocaleDateString() + '</td>' +
                    '<td>' + esc(h.name || '') + '</td>' +
                    '<td>' + esc(h.address || '') + '</td>' +
                    '<td>' + esc(h.room_number || h.roomNumber || '') + '</td>' +
                    '<td>' + esc(h.entry_code || h.entryCode || '') + '</td>' +
                    '<td>' + esc(h.booking_number || h.bookingNumber || '') + '</td>' +
                    '<td><button data-hotel="' + payload + '" onclick="editHotelRecord(JSON.parse(this.dataset.hotel))">Szerkesztés</button> ' +
                    '<button data-hotel="' + payload + '" onclick="deleteHotelRecord(JSON.parse(this.dataset.hotel))" style="background:#e74c3c;color:white;">Törlés</button></td>' +
                '</tr>';
            }

            function resetHotelForm() {
                document.getElementById('hotelFormTitle').innerText = 'Új hotel';
                ['hotelSource', 'hotelId', 'hotelUuid', 'hotelName', 'hotelAddress', 'hotelRoom', 'hotelCode', 'hotelBooking', 'hotelPhone', 'hotelEmail', 'hotelNotes'].forEach(id => {
                    document.getElementById(id).value = '';
                });
            }

            function editHotelRecord(h) {
                document.getElementById('hotelFormTitle').innerText = h.source === 'stop' ? 'Túrához tartozó hotel szerkesztése' : 'Hotel szerkesztése';
                document.getElementById('hotelSource').value = h.source || 'hotel';
                document.getElementById('hotelId').value = h.id || '';
                document.getElementById('hotelUuid').value = h.uuid || '';
                document.getElementById('hotelName').value = h.name || '';
                document.getElementById('hotelAddress').value = h.address || '';
                document.getElementById('hotelRoom').value = h.room_number || h.roomNumber || '';
                document.getElementById('hotelCode').value = h.entry_code || h.entryCode || '';
                document.getElementById('hotelBooking').value = h.booking_number || h.bookingNumber || '';
                document.getElementById('hotelPhone').value = h.phone_number || h.phoneNumber || '';
                document.getElementById('hotelEmail').value = h.email || '';
                document.getElementById('hotelNotes').value = h.notes || '';
                document.getElementById('hotelName').focus();
            }

            async function refreshHotels() {
                try {
                    const r = await fetch('/api/get-hotels/' + encodeURIComponent(DRIVER_NAME));
                    if (!r.ok) return;
                    const data = await r.json();
                    const list = document.getElementById('hotels-list');
                    if (list) list.innerHTML = data.map(renderHotelRow).join('');
                } catch (e) {
                    console.error('Refresh hotels error:', e);
                }
            }

            async function saveWebHotel() {
                const name = document.getElementById('hotelName').value.trim();
                if (!name) {
                    showToast('Adj meg hotel nevet.');
                    return;
                }
                const payload = {
                    source: document.getElementById('hotelSource').value || 'hotel',
                    id: document.getElementById('hotelId').value || null,
                    uuid: document.getElementById('hotelUuid').value || null,
                    driverName: DRIVER_NAME,
                    name,
                    address: document.getElementById('hotelAddress').value || '',
                    roomNumber: document.getElementById('hotelRoom').value || '',
                    entryCode: document.getElementById('hotelCode').value || '',
                    bookingNumber: document.getElementById('hotelBooking').value || '',
                    phoneNumber: document.getElementById('hotelPhone').value || '',
                    email: document.getElementById('hotelEmail').value || '',
                    notes: document.getElementById('hotelNotes').value || '',
                    timestamp: Date.now()
                };
                try {
                    const r = await adminFetch('/admin/save-hotel-record', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    if (!r.ok) {
                        const errorText = await r.text().catch(() => '');
                        showToast('Nem sikerült menteni a hotelt: ' + (errorText || r.status));
                        return;
                    }
                    const saved = await r.json();
                    resetHotelForm();
                    refreshHotels();
                    showToast('Hotel mentve.');
                } catch (e) {
                    console.error('Save hotel error:', e);
                    showToast('Hiba a hotel mentésekor.');
                }
            }

            async function deleteHotelRecord(h) {
                if (!h || (!h.id && !h.uuid)) return;
                if (!confirm('Törlöd ezt a hotelt?')) return;
                try {
                    const r = await adminFetch('/admin/delete-hotel-record', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ source: h.source || 'hotel', id: h.id || null, uuid: h.uuid || null })
                    });
                    if (!r.ok) {
                        const errorText = await r.text().catch(() => '');
                        showToast('Nem sikerült törölni a hotelt: ' + (errorText || r.status));
                        return;
                    }
                    resetHotelForm();
                    refreshHotels();
                    refreshTours();
                    showToast('Hotel törölve.');
                } catch (e) {
                    console.error('Delete hotel error:', e);
                    showToast('Hiba a hotel törlésekor.');
                }
            }

            async function saveWebCost() {
                const amount = Number(document.getElementById('costAmount').value);
                if (!amount || amount <= 0) {
                    showToast('Adj meg érvényes összeget.');
                    return;
                }
                const payload = {
                    driverName: DRIVER_NAME,
                    amount,
                    currency: document.getElementById('costCurrency').value || 'EUR',
                    category: document.getElementById('costCategory').value || 'Egyéb',
                    notes: document.getElementById('costNotes').value || '',
                    mileage: document.getElementById('costMileage').value || null,
                    timestamp: Date.now()
                };
                try {
                    const r = await adminFetch('/admin/save-cost', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    if (!r.ok) {
                        showToast('Nem sikerült menteni a költséget.');
                        return;
                    }
                    const saved = await r.json();
                    document.getElementById('costs-list').insertAdjacentHTML('afterbegin', renderCostRow(saved));
                    document.getElementById('costAmount').value = '';
                    document.getElementById('costMileage').value = '';
                    document.getElementById('costNotes').value = '';
                    showToast('Költség mentve.');
                } catch (e) {
                    console.error('Save cost error:', e);
                    showToast('Hiba a költség mentésekor.');
                }
            }

            async function updateCostStatus(uuid, id, status) {
                try {
                    const r = await adminFetch('/admin/update-cost-status', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid: uuid || null, id, status })
                    });
                    if (!r.ok) {
                        showToast('Nem sikerult frissiteni a koltseg statuszat.');
                        return;
                    }
                    const row = document.querySelector('tr[data-cost-id="' + id + '"]');
                    if (row) row.querySelector('.cost-status').innerText = status;
                    showToast('Koltseg statusz frissitve.');
                } catch (e) {
                    console.error('Cost status error:', e);
                }
            }

            function pickColumn(row, names) {
                const keys = Object.keys(row || {});
                for (const name of names) {
                    const found = keys.find(k => k.trim().toLowerCase() === name.trim().toLowerCase());
                    if (found !== undefined && row[found] !== undefined && row[found] !== null) return String(row[found]).trim();
                }
                return '';
            }

            function excelDateToTimestamp(value) {
                if (!value) return Date.now();
                if (typeof value === 'number' && window.XLSX && XLSX.SSF) {
                    const parsed = XLSX.SSF.parse_date_code(value);
                    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
                }
                const text = String(value).trim();
                const parts = text.match(/^(\\d{4})[-.\\/](\\d{1,2})[-.\\/](\\d{1,2})/);
                if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
                const parsedDate = new Date(text);
                return Number.isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime();
            }

            function optionalExcelDateToTimestamp(value) {
                if (!value) return null;
                const ts = excelDateToTimestamp(value);
                return Number.isNaN(Number(ts)) ? null : ts;
            }

            async function importTourFromExcel(input) {
                const file = input.files && input.files[0];
                input.value = '';
                if (!file) return;
                if (!window.XLSX) {
                    showToast('Az Excel import könyvtár nem töltődött be.');
                    return;
                }
                try {
                    const buffer = await file.arrayBuffer();
                    const workbook = XLSX.read(buffer, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    if (!rows.length) {
                        showToast('Az Excel fájl üres.');
                        return;
                    }
                    const first = rows[0];
                    const tourName = pickColumn(first, ['Túra neve', 'Tura neve', 'Tour name', 'TourName', 'Name']) || file.name.replace(/\\.[^.]+$/, '');
                    const customer = pickColumn(first, ['Megrendelő', 'Megrendelo', 'Customer', 'Kunde']);
                    const tourDate = excelDateToTimestamp(pickColumn(first, ['Dátum', 'Datum', 'Date', 'Tour date']));

                    const stops = rows.map((row, index) => {
                        const street = pickColumn(row, ['Utca', 'Street', 'Straße', 'Strasse']);
                        const house = pickColumn(row, ['Házszám', 'Hazszam', 'House number', 'Hausnummer']);
                        const postal = pickColumn(row, ['Irányítószám', 'Iranyitoszam', 'Irsz', 'Postal code', 'PLZ']);
                        const city = pickColumn(row, ['Város', 'Varos', 'City', 'Ort']);
                        const addressFull = pickColumn(row, ['Teljes cím', 'Teljes cim', 'Address full', 'Address', 'Cím', 'Cim']) ||
                            ([street, house].filter(Boolean).join(' ') + ([postal, city].filter(Boolean).length ? ', ' + [postal, city].filter(Boolean).join(' ') : '')).trim();
                        return {
                            uuid: null,
                            recipient: pickColumn(row, ['Címzett', 'Cimzett', 'Recipient', 'Empfänger', 'Empfaenger', 'Kontakt']),
                            company: pickColumn(row, ['Cég', 'Ceg', 'Company', 'Firma']),
                            street,
                            house_number: house,
                            postal_code: postal,
                            city,
                            address_full: addressFull,
                            contact_name: pickColumn(row, ['Kapcsolattartó', 'Kapcsolattarto', 'Contact name']),
                            phone_number: pickColumn(row, ['Telefon', 'Phone', 'Telefonnummer']),
                            email: pickColumn(row, ['Email', 'E-mail']),
                            stop_date: optionalExcelDateToTimestamp(pickColumn(row, ['Stop dátum', 'Stop datum', 'Megálló dátuma', 'Megallo datuma', 'Dátum', 'Datum', 'Date'])),
                            room_number: pickColumn(row, ['Szoba', 'Room', 'Zimmer']),
                            entry_code: pickColumn(row, ['Belépőkód', 'Belepokod', 'Entry code', 'Code']),
                            booking_number: pickColumn(row, ['Buchungsnummer', 'Foglalási szám', 'Foglalasi szam', 'Booking number']),
                            time_window: pickColumn(row, ['Időablak', 'Idoablak', 'Time window', 'Zeitfenster']),
                            notes: pickColumn(row, ['Megjegyzés', 'Megjegyzes', 'Notes', 'Notiz']),
                            stop_type: (pickColumn(row, ['Típus', 'Tipus', 'Stop type', 'Type']) || 'DELIVERY').toUpperCase(),
                            order_index: index,
                            latitude: null,
                            longitude: null
                        };
                    }).filter(s => s.recipient || s.company || s.address_full || s.street || s.city);

                    if (!stops.length) {
                        showToast('Nem találtam importálható címsort.');
                        return;
                    }

                    const data = {
                        id: null,
                        uuid: null,
                        driver_name: DRIVER_NAME,
                        name: tourName,
                        customer,
                        date: tourDate,
                        is_current: true,
                        notes: pickColumn(first, ['Túra megjegyzés', 'Tura megjegyzes', 'Tour notes']),
                        depot_name: pickColumn(first, ['Depó név', 'Depo nev', 'Depot name']),
                        depot_company: pickColumn(first, ['Depó cég', 'Depo ceg', 'Depot company']),
                        depot_street: pickColumn(first, ['Depó utca', 'Depo utca', 'Depot street']),
                        depot_house_number: pickColumn(first, ['Depó házszám', 'Depo hazszam', 'Depot house number']),
                        depot_postal_code: pickColumn(first, ['Depó irsz', 'Depo irsz', 'Depot postal code']),
                        depot_city: pickColumn(first, ['Depó város', 'Depo varos', 'Depot city']),
                        depot_lat: null,
                        depot_lng: null,
                        stops
                    };

                    const res = await adminFetch('/admin/save-tour', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data)
                    });
                    if (res.ok) {
                        showToast('Excel túra importálva.');
                        refreshTours();
                    } else {
                        showToast('Nem sikerült importálni az Excel túrát.');
                    }
                } catch (e) {
                    console.error('Excel import error:', e);
                    showToast('Hiba az Excel import során.');
                }
            }

            async function transferTour(tourId, newDriverName) {
                if (!newDriverName) return;
                if (!confirm('Áthelyezed ' + newDriverName + ' részére?')) return;
                const r = await adminFetch('/admin/transfer-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ tourId, newDriverName }) });
                if (r.ok) {
                    showToast('Túra sikeresen áthelyezve!');
                    refreshTours();
                    refreshHotels();
                } else {
                    const msg = await r.text().catch(() => '');
                    showToast('Nem sikerült áthelyezni a túrát: ' + (msg || r.status));
                }
            }
            async function deleteTour(id) {
                if (!confirm('Törlöd?')) return;
                const r = await adminFetch('/admin/delete-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) });
                if (r.ok) {
                    showToast('Túra törölve!');
                    refreshTours();
                    refreshHotels();
                } else {
                    const msg = await r.text().catch(() => '');
                    showToast('Nem sikerült törölni a túrát: ' + (msg || r.status));
                }
            }
            function closeModal() { document.getElementById('tourModal').style.display = 'none'; }
            function editTour(t) {
                document.getElementById('tourId').value = t ? t.id : '';
                document.getElementById('tourUuid').value = t ? t.uuid : '';
                document.getElementById('tName').value = t ? t.name : '';
                document.getElementById('tCustomer').value = t ? t.customer : '';
                document.getElementById('tDate').value = t ? new Date(Number(t.date)).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                document.getElementById('tIsCurrent').checked = t ? !!t.is_current : true;
                document.getElementById('tNotes').value = t ? t.notes : '';
                document.getElementById('tDepotName').value = t ? (t.depot_name || '') : '';
                document.getElementById('tDepotCompany').value = t ? (t.depot_company || '') : '';
                document.getElementById('tDepotStreet').value = t ? (t.depot_street || '') : '';
                document.getElementById('tDepotHouse').value = t ? (t.depot_house_number || '') : '';
                document.getElementById('tDepotPostal').value = t ? (t.depot_postal_code || '') : '';
                document.getElementById('tDepotCity').value = t ? (t.depot_city || '') : '';

                // Koordináták megőrzése
                const modal = document.getElementById('tourModal');
                modal.dataset.lat = t ? (t.depot_lat || '') : '';
                modal.dataset.lng = t ? (t.depot_lng || '') : '';

                document.getElementById('modalStops').innerHTML = '';
                if(t && t.stops) t.stops.forEach(s => addStopRow(s)); else addStopRow(null);
                document.getElementById('tourModal').style.display = 'block';
            }

            function normalizeStopForEditor(s) {
                const src = s || {};
                const n = {
                    uuid: src.uuid || '',
                    recipient: src.recipient || src.contact_name || src.contactName || '',
                    company: src.company || '',
                    street: src.street || '',
                    house_number: src.house_number || src.houseNumber || '',
                    postal_code: src.postal_code || src.postalCode || '',
                    city: src.city || '',
                    state: src.state || '',
                    country: src.country || '',
                    address_full: src.address_full || src.addressFull || src.address || '',
                    phone_number: src.phone_number || src.phoneNumber || '',
                    email: src.email || '',
                    time_window: src.time_window || src.timeWindow || '',
                    stop_date: src.stop_date || src.stopDate || '',
                    notes: src.notes || '',
                    stop_type: src.stop_type || src.stopType || 'DELIVERY',
                    room_number: src.room_number || src.roomNumber || '',
                    entry_code: src.entry_code || src.entryCode || '',
                    booking_number: src.booking_number || src.bookingNumber || '',
                    latitude: src.latitude || '',
                    longitude: src.longitude || '',
                    items: src.items || null
                };
                if ((!n.street || !n.city) && n.address_full) {
                    const match = String(n.address_full).match(/^(.+?)\s+([^,\s]+)\s*,\s*(\d{4,6})\s+(.+)$/);
                    if (match) {
                        n.street = n.street || match[1];
                        n.house_number = n.house_number || match[2];
                        n.postal_code = n.postal_code || match[3];
                        n.city = n.city || match[4];
                    } else if (!n.street) {
                        n.street = n.address_full;
                    }
                }
                return n;
            }

            function dateInputValue(value) {
                if (!value) return '';
                const d = new Date(Number(value));
                return Number.isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
            }

            function dateInputToTimestamp(value) {
                return value ? new Date(value).getTime() : null;
            }

            function addStopRow(s) {
                s = normalizeStopForEditor(s);
                const d = document.createElement('div'); d.className = 'stop-edit-row'; d.style = 'border:1px solid #444; padding:15px; margin-bottom:15px; border-radius:8px; position:relative;';
                const uuid = s.uuid || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : null);
                const items = s.items ? (Array.isArray(s.items) ? s.items : [s.items]) : [{ recipient: s.recipient, notes: s.notes, stop_type: s.stop_type }];
                const mainItem = items[0] || {};
                d.dataset.lat = s.latitude || '';
                d.dataset.lng = s.longitude || '';
                d.innerHTML = '<button onclick="this.parentElement.remove()" style="position:absolute; right:10px; top:10px; background:#e74c3c; border:none; color:white; padding:5px 10px; border-radius:4px; cursor:pointer;">X</button>' +
                    '<input type="hidden" class="stop-uuid" value="' + esc(uuid || '') + '">' +
                    '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                        '<div><label>Címzett</label><input type="text" class="stop-recipient" value="' + esc(mainItem.recipient || s.recipient || '') + '"></div>' +
                        '<div><label>Cég</label><input type="text" class="stop-company" value="' + esc(s.company || '') + '"></div>' +
                    '</div>' +
                    '<div style="display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:5px;">' +
                        '<div><label>Utca</label><input type="text" class="stop-street" value="' + esc(s.street || '') + '"></div>' +
                        '<div><label>Házszám</label><input type="text" class="stop-house" value="' + esc(s.house_number || '') + '"></div>' +
                    '</div>' +
                    '<div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:5px;">' +
                        '<div><label>Irsz</label><input type="text" class="stop-postal" value="' + esc(s.postal_code || '') + '"></div>' +
                        '<div><label>Város</label><input type="text" class="stop-city" value="' + esc(s.city || '') + '"></div>' +
                    '</div>' +
                    '<div style="display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:5px;">' +
                        '<div><label>Dátum</label><input type="date" class="stop-date" value="' + esc(dateInputValue(s.stop_date)) + '"></div>' +
                        '<div><label>Időablak</label><input type="text" class="stop-time-window" value="' + esc(s.time_window || '') + '"></div>' +
                    '</div>' +
                    '<div style="margin-top:10px;"><label>Típus</label><select class="stop-type"><option value="DELIVERY" ' + ((mainItem.stop_type || s.stop_type)==='DELIVERY'?'selected':'') + '>DELIVERY</option><option value="PICKUP" ' + ((mainItem.stop_type || s.stop_type)==='PICKUP'?'selected':'') + '>PICKUP</option><option value="HOTEL" ' + ((mainItem.stop_type || s.stop_type)==='HOTEL'?'selected':'') + '>HOTEL</option></select></div>' +
                    '<div class="stop-hotel-fields" style="display:none; margin-top:10px; padding:10px; background:#2b2b2b; border-radius:6px;">' +
                        '<b style="display:block; margin-bottom:8px; color:#3498db;">Hotel adatok</b>' +
                        '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">' +
                            '<div><label>Szoba</label><input type="text" class="stop-room" value="' + esc(mainItem.room_number || s.room_number || '') + '"></div>' +
                            '<div><label>Belépőkód</label><input type="text" class="stop-entry-code" value="' + esc(mainItem.entry_code || s.entry_code || '') + '"></div>' +
                            '<div><label>Buchungsnummer</label><input type="text" class="stop-booking" value="' + esc(mainItem.booking_number || s.booking_number || '') + '"></div>' +
                        '</div>' +
                        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:8px;">' +
                            '<div><label>Telefon</label><input type="text" class="stop-phone" value="' + esc(mainItem.phone_number || s.phone_number || '') + '"></div>' +
                            '<div><label>Email</label><input type="text" class="stop-email" value="' + esc(mainItem.email || s.email || '') + '"></div>' +
                        '</div>' +
                        '<div style="margin-top:8px;"><label>Hotel megjegyzés</label><input type="text" class="stop-notes" value="' + esc(mainItem.notes || s.notes || '') + '"></div>' +
                    '</div>';
                document.getElementById('modalStops').appendChild(d);
                d.querySelector('.stop-type').addEventListener('change', () => toggleStopHotelFields(d));
                toggleStopHotelFields(d);
            }

            function toggleStopHotelFields(row) {
                if (!row) return;
                const fields = row.querySelector('.stop-hotel-fields');
                const type = row.querySelector('.stop-type')?.value;
                if (fields) fields.style.display = type === 'HOTEL' ? 'block' : 'none';
            }
            async function geocode(street, house, postal, city) {
                const q = (street + ' ' + house + ', ' + postal + ' ' + city).trim();
                if (q.length < 5) return null;
                try {
                    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q) + '&limit=1');
                    const d = await r.json();
                    return d && d.length > 0 ? { lat: d[0].lat, lon: d[0].lon } : null;
                } catch (e) { return null; }
            }

            async function saveTour(evt) {
                const btn = evt?.target;
                const oldText = btn?.innerText || 'Mentés';
                if (btn) {
                    btn.innerText = 'Mentés... (Geocoding)';
                    btn.disabled = true;
                }

                const modal = document.getElementById('tourModal');
                // Depó koordináták ha hiányzik
                if (!modal.dataset.lat || modal.dataset.lat === "") {
                    const c = await geocode(document.getElementById('tDepotStreet').value, document.getElementById('tDepotHouse').value, document.getElementById('tDepotPostal').value, document.getElementById('tDepotCity').value);
                    if (c) { modal.dataset.lat = c.lat; modal.dataset.lng = c.lon; }
                }

                const stops = [];
                const rows = document.querySelectorAll('.stop-edit-row');
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    const u = r.querySelector('.stop-uuid').value;
                    const street = r.querySelector('.stop-street').value;
                    const house = r.querySelector('.stop-house').value;
                    const postal = r.querySelector('.stop-postal').value;
                    const city = r.querySelector('.stop-city').value;
                    const addressFull = [street, house].filter(Boolean).join(' ') + ([postal, city].filter(Boolean).length ? ', ' + [postal, city].filter(Boolean).join(' ') : '');

                    if (!r.dataset.lat || r.dataset.lat === "") {
                        const c = await geocode(street, house, postal, city);
                        if (c) { r.dataset.lat = c.lat; r.dataset.lng = c.lon; }
                    }

                    stops.push({
                        uuid: u === "" ? null : u,
                        recipient: r.querySelector('.stop-recipient').value,
                        company: r.querySelector('.stop-company').value,
                        street,
                        house_number: house,
                        postal_code: postal,
                        city,
                        address_full: addressFull.trim(),
                        time_window: r.querySelector('.stop-time-window')?.value || '',
                        stop_date: dateInputToTimestamp(r.querySelector('.stop-date')?.value || ''),
                        stop_type: r.querySelector('.stop-type').value,
                        room_number: r.querySelector('.stop-room')?.value || '',
                        entry_code: r.querySelector('.stop-entry-code')?.value || '',
                        booking_number: r.querySelector('.stop-booking')?.value || '',
                        phone_number: r.querySelector('.stop-phone')?.value || '',
                        email: r.querySelector('.stop-email')?.value || '',
                        notes: r.querySelector('.stop-notes')?.value || '',
                        order_index: i,
                        latitude: r.dataset.lat ? parseFloat(r.dataset.lat) : null,
                        longitude: r.dataset.lng ? parseFloat(r.dataset.lng) : null
                    });
                }

                const tourId = document.getElementById('tourId').value;
                const uId = document.getElementById('tourUuid').value;
                const tourDate = document.getElementById('tDate').value ? new Date(document.getElementById('tDate').value).getTime() : Date.now();
                const data = {
                    id: tourId === "" ? null : parseInt(tourId),
                    uuid: uId === "" ? null : uId,
                    driver_name: DRIVER_NAME, name: document.getElementById('tName').value, customer: document.getElementById('tCustomer').value,
                    date: tourDate, is_current: document.getElementById('tIsCurrent').checked, notes: document.getElementById('tNotes').value,
                    depot_name: document.getElementById('tDepotName').value, depot_company: document.getElementById('tDepotCompany').value,
                    depot_street: document.getElementById('tDepotStreet').value, depot_house_number: document.getElementById('tDepotHouse').value,
                    depot_postal_code: document.getElementById('tDepotPostal').value, depot_city: document.getElementById('tDepotCity').value,
                    depot_lat: modal.dataset.lat ? parseFloat(modal.dataset.lat) : null,
                    depot_lng: modal.dataset.lng ? parseFloat(modal.dataset.lng) : null,
                    stops
                };
                const res = await adminFetch('/admin/save-tour', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                if(res.ok) {
                    showToast('Túra mentve!');
                    closeModal();
                    refreshTours();
                    refreshHotels();
                } else {
                    const msg = await res.text();
                    alert('Hiba a túra mentésekor: ' + msg);
                    if (btn) {
                        btn.innerText = oldText;
                        btn.disabled = false;
                    }
                }
            }
        </script>
    </body></html>`;
    res.send(html);
});

    return driverDashboardRoutes;
};

module.exports = createDriverDashboardRoutes;
