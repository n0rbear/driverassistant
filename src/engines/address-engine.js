const AddressEngine = {
    normalize(addr) {
        if (!addr) return null;
        const find = (keys) => {
            for (const k of keys) if (addr[k] !== undefined && addr[k] !== null) return String(addr[k]).trim();
            return '';
        };
        const result = {
            recipient: find(['recipient', 'depot_name', 'depotName']),
            company: find(['company', 'depot_company', 'depotCompany']),
            street: find(['street', 'depot_street', 'depotStreet']),
            house_number: find(['house_number', 'houseNumber', 'depot_house_number', 'depotHouseNumber']),
            postal_code: find(['postal_code', 'postalCode', 'depot_postal_code', 'depotPostalCode']),
            city: find(['city', 'depot_city', 'depotCity']),
            state: find(['state', 'depot_state', 'depotState']),
            country: find(['country', 'depot_country', 'depotCountry']),
            address_full: find(['address_full', 'addressFull', 'address', 'depot_address_full', 'depotAddressFull']),
            latitude: null, longitude: null, notes: find(['notes'])
        };
        const lat = addr.latitude ?? addr.depot_lat ?? addr.depotLatitude;
        const lng = addr.longitude ?? addr.depot_lng ?? addr.depotLongitude;
        if (lat) result.latitude = parseFloat(lat);
        if (lng) result.longitude = parseFloat(lng);
        if (!result.street && !result.city && result.address_full) {
            const match = result.address_full.match(/^(.+)\s+([^,]+),\s*(\d{4})\s+(.+)$/);
            if (match) { result.street = match[1]; result.house_number = match[2]; result.postal_code = match[3]; result.city = match[4]; }
        }
        if (!result.address_full && result.street && result.city) result.address_full = `${result.street} ${result.house_number}, ${result.postal_code} ${result.city}`;
        return result;
    },
    getFingerprint(addr) {
        const n = this.normalize(addr);
        return n ? `${n.country}|${n.postal_code}|${n.city}|${n.street}|${n.house_number}`.toLowerCase() : '';
    }
};

module.exports = AddressEngine;
