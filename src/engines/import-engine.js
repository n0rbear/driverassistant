const AddressEngine = require('./address-engine');

const ImportEngine = {
    async processTour(client, driverName, tourData, stopsData, options = {}) {
        const isMobileSync = options.source === 'mobile';
        // UUID alapú keresés, hogy elkerüljük a kliens/szerver ID ütközést
        const existingRes = await client.query('SELECT id, updated_at FROM tours WHERE uuid = $1', [tourData.uuid]);
        let tourId = existingRes.rows.length > 0 ? existingRes.rows[0].id : null;

        const tour = { ...tourData, driver_name: driverName, updated_at: tourData.updated_at || tourData.updatedAt || Date.now() };
        const incomingTourUpdatedAt = Number(tour.updated_at || Date.now());
        const existingTourUpdatedAt = Number(existingRes.rows[0]?.updated_at || 0);
        const shouldApplyTourPayload = !tourId || incomingTourUpdatedAt >= existingTourUpdatedAt;
        const depot = AddressEngine.normalize(tourData);
        const groupedStops = [];
        const deletedStopUuids = [];

        for (const rawStop of stopsData) {
            if ((rawStop.deleted_at || rawStop.deletedAt) && rawStop.uuid) {
                deletedStopUuids.push(String(rawStop.uuid));
                continue;
            }
            const n = AddressEngine.normalize(rawStop);
            const fp = AddressEngine.getFingerprint(n);
            const item = {
                uuid: (rawStop.uuid && String(rawStop.uuid).trim() !== "") ? String(rawStop.uuid) : null,
                recipient: n.recipient, company: n.company, notes: n.notes,
                contact_name: rawStop.contact_name || rawStop.contactName || '',
                phone_number: rawStop.phone_number || rawStop.phoneNumber || '',
                email: rawStop.email || '', time_window: rawStop.time_window || rawStop.timeWindow || '',
                stop_date: rawStop.stop_date || rawStop.stopDate || null,
                room_number: rawStop.room_number || rawStop.roomNumber || '',
                entry_code: rawStop.entry_code || rawStop.entryCode || '',
                booking_number: rawStop.booking_number || rawStop.bookingNumber || '',
                stop_type: rawStop.stop_type || rawStop.stopType || 'DELIVERY',
                is_completed: !!(rawStop.is_completed || rawStop.isCompleted),
                arrival_time: rawStop.arrival_time || rawStop.arrivalTime || null,
                updated_at: rawStop.updated_at || rawStop.updatedAt || Date.now()
            };
            groupedStops.push({ ...n, fingerprint: fp, items: [item] });
        }

        if (tourId && shouldApplyTourPayload && !isMobileSync) {
            await client.query(`UPDATE tours SET driver_name=$1, name=$2, customer=$3, date=$4, day_of_week=$5, notes=$6, is_closed=$7, is_current=$8, depot_name=$9, depot_company=$10, depot_street=$11, depot_house_number=$12, depot_postal_code=$13, depot_city=$14, depot_state=$15, depot_country=$16, depot_address_full=$17, depot_lat=$18, depot_lng=$19, updated_at=$20, deleted_at=$22 WHERE id=$21`,
                [driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tourId, tour.deleted_at || tour.deletedAt || null]);
        } else if (!tourId) {
            const res = await client.query(`INSERT INTO tours (uuid, driver_name, name, customer, date, day_of_week, notes, is_closed, is_current, depot_name, depot_company, depot_street, depot_house_number, depot_postal_code, depot_city, depot_state, depot_country, depot_address_full, depot_lat, depot_lng, updated_at, deleted_at) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id, uuid`,
                [tour.uuid || null, driverName, tour.name, tour.customer, tour.date, tour.day_of_week, tour.notes, !!tour.is_closed, !!tour.is_current, depot.recipient || depot.address_full, depot.company, depot.street, depot.house_number, depot.postal_code, depot.city, depot.state, depot.country, depot.address_full, depot.latitude, depot.longitude, tour.updated_at, tour.deleted_at || tour.deletedAt || null]);
            tourId = res.rows[0].id;
            if (!tour.uuid) tour.uuid = res.rows[0].uuid;
        }

        if (deletedStopUuids.length > 0 && !isMobileSync) {
            await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND uuid::text = ANY($3::text[]) AND (updated_at IS NULL OR updated_at <= $1)', [tour.updated_at, tourId, deletedStopUuids]);
        }

        const currentUuids = [];
        let idx = 0;
        for (const s of groupedStops.values()) {
            const main = s.items[0];
            const stopConflictUpdate = isMobileSync
                ? `is_completed=EXCLUDED.is_completed, arrival_time=COALESCE(EXCLUDED.arrival_time, stops.arrival_time), photo_url=COALESCE(EXCLUDED.photo_url, stops.photo_url), stop_type=EXCLUDED.stop_type, room_number=EXCLUDED.room_number, entry_code=EXCLUDED.entry_code, booking_number=EXCLUDED.booking_number, notes=EXCLUDED.notes, updated_at=GREATEST(COALESCE(stops.updated_at, 0), COALESCE(EXCLUDED.updated_at, 0)) WHERE stops.updated_at IS NULL OR EXCLUDED.updated_at >= stops.updated_at`
                : `tour_id=EXCLUDED.tour_id, address=EXCLUDED.address, recipient=EXCLUDED.recipient, company=EXCLUDED.company, street=EXCLUDED.street, house_number=EXCLUDED.house_number, postal_code=EXCLUDED.postal_code, city=EXCLUDED.city, state=EXCLUDED.state, country=EXCLUDED.country, address_full=EXCLUDED.address_full, contact_name=EXCLUDED.contact_name, phone_number=EXCLUDED.phone_number, email=EXCLUDED.email, time_window=EXCLUDED.time_window, stop_date=EXCLUDED.stop_date, notes=EXCLUDED.notes, order_index=EXCLUDED.order_index, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, is_completed=EXCLUDED.is_completed, arrival_time=EXCLUDED.arrival_time, stop_type=EXCLUDED.stop_type, updated_at=EXCLUDED.updated_at, items=EXCLUDED.items, photo_url=COALESCE(EXCLUDED.photo_url, stops.photo_url), room_number=EXCLUDED.room_number, entry_code=EXCLUDED.entry_code, booking_number=EXCLUDED.booking_number, deleted_at=NULL WHERE stops.updated_at IS NULL OR EXCLUDED.updated_at >= stops.updated_at`;
            const res = await client.query(`INSERT INTO stops (uuid, tour_id, address, recipient, company, street, house_number, postal_code, city, state, country, address_full, contact_name, phone_number, email, time_window, stop_date, notes, order_index, latitude, longitude, is_completed, arrival_time, stop_type, updated_at, items, photo_url, room_number, entry_code, booking_number) VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30) ON CONFLICT (uuid) DO UPDATE SET ${stopConflictUpdate} RETURNING uuid`,
                [main.uuid, tourId, s.address_full, main.recipient, s.company, s.street, s.house_number, s.postal_code, s.city, s.state, s.country, s.address_full, main.contact_name, main.phone_number, main.email, main.time_window, main.stop_date, main.notes, idx++, s.latitude, s.longitude, main.is_completed, main.arrival_time, main.stop_type, main.updated_at, JSON.stringify(s.items), main.photo_url || main.photoUrl || null, main.room_number, main.entry_code, main.booking_number]);
            currentUuids.push(res.rows[0]?.uuid || main.uuid);
        }
        if (shouldApplyTourPayload && !isMobileSync) {
            await client.query('UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id = $2 AND deleted_at IS NULL AND NOT (uuid = ANY($3::UUID[]))', [tour.updated_at, tourId, currentUuids]);
        }

        if (tour.is_current && shouldApplyTourPayload) {
            try {
                const tourUuid = tour.uuid || tourData.uuid;
                if (tourUuid) {
                    console.log(`[TRACE-TOUR] Calling set_current_tour for driver: ${driverName}, tourUuid: ${tourUuid}`);
                    await client.query('SELECT set_current_tour($1, $2)', [driverName, tourUuid]);
                } else {
                    console.warn(`[TRACE-TOUR] Cannot call set_current_tour, UUID is missing for tourId: ${tourId}`);
                }
            } catch (err) {
                console.error(`[TRACE-TOUR] Failed to set current tour in processTour: ${err.message}`);
            }
        }

        return tourId;
    }
};

module.exports = ImportEngine;
