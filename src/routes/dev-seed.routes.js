const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const devSeedRoutes = express.Router();

devSeedRoutes.post('/admin/dev-seed-demo', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const now = Date.now();
        const companies = [
            { name: 'Demo Logistics GmbH', slug: 'demo-logistics' },
            { name: 'Cargo Pilot Kft.', slug: 'cargo-pilot' }
        ];
        const result = { companies: [], users: [], drivers: [], tours: [] };

        for (const company of companies) {
            const companyRow = (await client.query(
                `INSERT INTO companies (name, slug, is_demo)
                 VALUES ($1, $2, true)
                 ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                 RETURNING uuid, name, slug`,
                [company.name, company.slug]
            )).rows[0];
            result.companies.push(companyRow);

            const permissions = [
                ['CEO', 'tours', true, true],
                ['CEO', 'live_status', true, false],
                ['CEO', 'fuel', true, false],
                ['CEO', 'costs', true, true],
                ['CEO', 'chat', false, false],
                ['CEO', 'reports', true, false],
                ['DISPATCHER', 'tours', true, true],
                ['DISPATCHER', 'live_status', true, false],
                ['DISPATCHER', 'fuel', false, false],
                ['DISPATCHER', 'costs', false, false],
                ['DISPATCHER', 'chat', true, true],
                ['DISPATCHER', 'reports', true, false]
            ];
            for (const [role, module, canView, canEdit] of permissions) {
                await client.query(`INSERT INTO role_permissions (company_uuid, role, module, can_view, can_edit)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (company_uuid, role, module) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
                    [companyRow.uuid, role, module, canView, canEdit]);
            }

            const users = [
                { name: `${company.name} CEO`, email: `ceo@${company.slug}.test`, role: 'CEO' },
                { name: `${company.name} Dispatcher`, email: `dispatch@${company.slug}.test`, role: 'DISPATCHER' }
            ];
            for (const user of users) {
                const userRow = (await client.query(`INSERT INTO web_users (company_uuid, name, email, role, is_active)
                    VALUES ($1, $2, $3, $4, true)
                    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, company_uuid = EXCLUDED.company_uuid
                    RETURNING uuid, name, email, role`,
                    [companyRow.uuid, user.name, user.email, user.role])).rows[0];
                result.users.push(userRow);
            }

            const drivers = [
                { name: `${company.slug}-driver-1`, email: `driver1@${company.slug}.test`, plate: 'DEMO-101', code: `${company.slug.slice(0, 3).toUpperCase()}101` },
                { name: `${company.slug}-driver-2`, email: `driver2@${company.slug}.test`, plate: 'DEMO-202', code: `${company.slug.slice(0, 3).toUpperCase()}202` }
            ];
            for (const driver of drivers) {
                const driverRow = (await client.query(`INSERT INTO drivers (company_uuid, name, email, phone, license_plate, is_active, activation_code)
                    VALUES ($1, $2, $3, '+490000000', $4, true, $5)
                    ON CONFLICT (name) DO UPDATE SET company_uuid = EXCLUDED.company_uuid, email = EXCLUDED.email, license_plate = EXCLUDED.license_plate, activation_code = EXCLUDED.activation_code
                    RETURNING uuid, name, license_plate`,
                    [companyRow.uuid, driver.name, driver.email, driver.plate, driver.code])).rows[0];
                result.drivers.push(driverRow);

                const tourRow = (await client.query(`INSERT INTO tours (company_uuid, driver_uuid, driver_name, name, customer, date, notes, is_closed, is_current, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'Demo tour', false, true, $7)
                    RETURNING id, uuid, name`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, `Demo Tour ${driverRow.name}`, company.name, now, now])).rows[0];
                result.tours.push(tourRow);

                await client.query(`INSERT INTO stops (company_uuid, driver_uuid, tour_id, address, recipient, street, house_number, postal_code, city, address_full, contact_name, phone_number, email, time_window, notes, order_index, latitude, longitude, is_completed, stop_type, updated_at)
                    VALUES ($1, $2, $3, 'Arthur-Junghans-Str 1, 78713 Schramberg', 'Demo Recipient', 'Arthur-Junghans-Str', '1', '78713', 'Schramberg', 'Arthur-Junghans-Str 1, 78713 Schramberg', '', '', '', '08:00-12:00', '', 0, 48.2238915, 8.384806, false, 'DELIVERY', $4)`,
                    [companyRow.uuid, driverRow.uuid, tourRow.id, now]);

                await client.query(`INSERT INTO costs (company_uuid, driver_uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp)
                    VALUES ($1, $2, $3, 75.50, 'EUR', 'Tankolas', 'Demo fuel receipt', 12345, 'Bekuldve', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO chat_messages (company_uuid, driver_uuid, driver_name, sender, message, timestamp)
                    VALUES ($1, $2, $3, 'DISPATCHER', 'Demo uzenet a sofornek.', $4)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, now]);

                await client.query(`INSERT INTO live_updates (company_uuid, driver_uuid, driver_name, license_plate, latitude, longitude, speed, status, current_tour, timestamp)
                    VALUES ($1, $2, $3, $4, 48.2280912, 8.3869585, 0, 'Offline', $5, $6)`,
                    [companyRow.uuid, driverRow.uuid, driverRow.name, driverRow.license_plate, tourRow.name, now]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, ...result });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

module.exports = devSeedRoutes;
