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

            // Kezdeti útvonal
            const rawStops = ${currentStopsJson};
            const tourDepotLat = ${currentTourObj ? currentTourObj.depot_lat || 0 : 0};
            const tourDepotLng = ${currentTourObj ? currentTourObj.depot_lng || 0 : 0};

            if (rawStops && rawStops.length > 0) {
                drawRoute(driverLat, driverLng, rawStops, tourDepotLat, tourDepotLng);
            }

            async function refreshLiveStatus() {
                try {
                    const r = await fetch('/api/live-status/' + encodeURIComponent('${name}'));
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
                            html = '<b style="display:block; margin-top:5px; color:#fff;">' + d.next_stop.split(' | ')[0] + '</b>' +
                                   '<p style="margin:2px 0; font-size:13px; color:#ccc;">' + d.next_stop.split(' | ')[1] + '</p>';
                        } else {
                            html = '<p style="margin:5px 0; font-size:14px;">' + d.next_stop + '</p>';
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
                        driverMarker.setPopupContent('<b>' + '${name}' + '</b><br>Sebesség: ' + Math.round(d.speed || 0) + ' km/h');

                        // Útvonal frissítése ha mozog vagy a célpont változott
                        if (d.next_lat !== lastNextLat || d.next_lng !== lastNextLng || Math.abs(d.latitude - lastUpdateLat) > 0.0005) {
                            lastNextLat = d.next_lat;
                            lastNextLng = d.next_lng;
                            lastUpdateLat = d.latitude;
                            lastUpdateLng = d.longitude;
                            refreshTours();
                            fetch('/api/get-tours/' + encodeURIComponent('${name}'))
                                .then(r => r.json())
                                .then(data => {
                                    const tourData = data.find(item => item.tour.is_current) || (data.length > 0 ? data[0] : null);
                                    const stops = tourData ? tourData.stops : [];
                                    const dLat = (tourData && tourData.tour.depot_lat) ? tourData.tour.depot_lat : d.depot_lat;
                                    const dLng = (tourData && tourData.tour.depot_lng) ? tourData.tour.depot_lng : d.depot_lng;
                                    drawRoute(d.latitude, d.longitude, stops, dLat, dLng);
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

            // Ha a dashboardon vagyunk, 5 másodpercenként oldalfrissítés (felhasználói kérésre)
            setInterval(() => {
                if (localStorage.getItem('activeTab_${name}') === 'dashboard') {
                    // location.reload(); // Ezt egyelőre kommentben hagyom, mert a refreshLiveStatus-nak kéne működnie
                }
            }, 5000);

            // Túra állomások
            const bounds = L.latLngBounds([driverLat, driverLng]);

            if (rawStops) {
                rawStops.forEach(s => {
                    if (s.latitude && s.longitude) {
                        const icon = L.divIcon({
                            className: 'custom-div-icon',
                            html: "<div style='background-color:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; border:2px solid white;'>" + (s.order_index + 1) + "</div>",
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([s.latitude, s.longitude], { icon: icon }).addTo(map)
                            .bindPopup((s.order_index + 1) + '. ' + (s.recipient || s.address_full || s.address));
                        bounds.extend([s.latitude, s.longitude]);
                    }
                });
            }

            // Depó marker
            if (update.depot_lat != null && update.depot_lat !== 0) {
                const depotIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: "<div style='background-color:#2ecc71; color:white; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid white;'>🏠</div>",
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                L.marker([update.depot_lat, update.depot_lng], { icon: depotIcon }).addTo(map).bindPopup('🏠 Depó: ' + (update.depot_name || 'Bázis'));
                bounds.extend([update.depot_lat, update.depot_lng]);
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
                    const r = await fetch('/api/get-profile/' + encodeURIComponent('${name}'));
                    if (r.ok) {
                        const d = await r.json();
                        document.getElementById('prof-whatsapp').value = d.whatsapp || '';
                        document.getElementById('prof-telegram').value = d.telegram || '';
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
                    if (data.name !== '${name}') {
                        setTimeout(() => location.href = '/driver/' + encodeURIComponent(data.name), 1000);
                    }
                }
            }
