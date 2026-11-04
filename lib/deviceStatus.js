'use strict';

/**
 * Common device status handling for all Netatmo device types.
 *
 * Writes reachability, signal strength, battery, firmware and error status of a device
 * into its info channel and logs when a device goes offline or comes back.
 * @module deviceStatus
 */

/** Netatmo error texts that mean the device is not reachable */
const UNREACHABLE_ERRORS = ['device_unreachable', 'module_unreachable'];

/** Battery states as delivered by homestatus */
const BATTERY_STATES = {
    max: 'max',
    full: 'full',
    high: 'high',
    medium: 'medium',
    low: 'low',
    very_low: 'very low',
};

/**
 * Last known reachability per device, key: `<namespace>.<deviceId>`
 * @type {Map<string, boolean>}
 */
const lastReachable = new Map();

/**
 * @typedef {object} StatusModule
 * @property {string} id Netatmo module ID
 * @property {string} [name] device name
 * @property {boolean} [reachable] reachability from homestatus/getstationsdata
 * @property {boolean} [statusReceived] true if homestatus data was merged for this module
 * @property {string} [errorStatus] error text from homestatus "errors"
 * @property {number} [wifi_strength] WiFi signal (lower is better)
 * @property {number} [rf_strength] radio signal (lower is better)
 * @property {string} [battery_state] battery state
 * @property {number} [battery_level] battery voltage in mV
 * @property {number|string} [firmware_revision] firmware revision
 * @property {string} [firmware_name] firmware name
 */

/**
 * @typedef {object} StatusOptions
 * @property {string[]} [skip] info states the calling module already writes itself
 */

/**
 * State definitions of the info states, written only if the value is delivered by Netatmo
 * @type {Record<string, {name: string, type: ioBroker.CommonType, role: string, unit?: string, get: (m: StatusModule) => any}>}
 */
const STATUS_STATES = {
    wifi_strength: {
        name: 'WiFi signal strength (lower is better)',
        type: 'number',
        role: 'value',
        get: m => (typeof m.wifi_strength === 'number' ? m.wifi_strength : undefined),
    },
    rf_strength: {
        name: 'Radio signal strength (lower is better)',
        type: 'number',
        role: 'value',
        get: m => (typeof m.rf_strength === 'number' ? m.rf_strength : undefined),
    },
    battery_state: {
        name: 'Battery state',
        type: 'string',
        role: 'text',
        get: m => (m.battery_state ? BATTERY_STATES[m.battery_state] || m.battery_state : undefined),
    },
    battery_level: {
        name: 'Battery voltage',
        type: 'number',
        role: 'value.voltage',
        unit: 'mV',
        get: m => (typeof m.battery_level === 'number' ? m.battery_level : undefined),
    },
    firmware: {
        name: 'Firmware',
        type: 'string',
        role: 'text',
        get: m => {
            if (m.firmware_revision === undefined || m.firmware_revision === null) {
                return undefined;
            }
            return m.firmware_name ? `${m.firmware_name} (${m.firmware_revision})` : String(m.firmware_revision);
        },
    },
};

/**
 * Determines the reachability of a module from the merged homesdata/homestatus data.
 * @param {StatusModule} aModule module data
 * @returns {boolean|undefined} undefined if Netatmo delivered no status for this module
 */
function getReachable(aModule) {
    if (typeof aModule.reachable === 'boolean') {
        return aModule.reachable;
    }
    if (aModule.errorStatus && UNREACHABLE_ERRORS.includes(aModule.errorStatus)) {
        return false;
    }
    // @KI_HINWEIS: Nicht jedes Geraet liefert "reachable" (z. B. Klingel NDB). Liefert homestatus
    // Daten ohne Fehler fuer das Modul, ist es erreichbar. Ohne Statusdaten bleibt der Wert offen.
    if (aModule.statusReceived && !aModule.errorStatus) {
        return true;
    }
    return undefined;
}

/**
 * Writes a state, creating the object first.
 * @param {ioBroker.Adapter & {extendOrSetObjectNotExistsAsync: Function}} adapter adapter instance
 * @param {string} id state ID relative to the namespace
 * @param {{name: string, type: ioBroker.CommonType, role: string, unit?: string}} def state definition
 * @param {ioBroker.StateValue} val value
 */
async function writeState(adapter, id, def, val) {
    const common = {
        name: def.name,
        type: def.type,
        role: def.role,
        read: true,
        write: false,
    };
    if (def.unit) {
        common.unit = def.unit;
    }
    await adapter.extendOrSetObjectNotExistsAsync(id, { type: 'state', common, native: {} });
    await adapter.setStateAsync(id, { val, ack: true });
}

/**
 * Logs a change of the reachability of a device (offline as warning, back online as info).
 * The first known state is only logged if the device is offline.
 * @param {ioBroker.Adapter} adapter adapter instance
 * @param {string} deviceId Netatmo device ID
 * @param {string} label device name for the log
 * @param {boolean} reachable new reachability
 */
function logReachability(adapter, deviceId, label, reachable) {
    const key = `${adapter.namespace}.${deviceId}`;
    const previous = lastReachable.get(key);
    lastReachable.set(key, reachable);
    if (previous === reachable) {
        return;
    }
    if (!reachable) {
        adapter.log.warn(`${label}: device is not reachable (offline or no WiFi/radio connection)`);
    } else if (previous === false) {
        adapter.log.info(`${label}: device is reachable again`);
    }
}

/**
 * Writes the reachability of a device and logs changes.
 * @param {ioBroker.Adapter & {extendOrSetObjectNotExistsAsync: Function}} adapter adapter instance
 * @param {string} stateId full state ID relative to the namespace, e.g. "<home>.<device>.info.reachable"
 * @param {string} deviceId Netatmo device ID
 * @param {string} label device name for the log
 * @param {boolean} reachable reachability
 */
async function setReachable(adapter, stateId, deviceId, label, reachable) {
    await writeState(adapter, stateId, { name: 'Device reachable', type: 'boolean', role: 'indicator.reachable' }, reachable);
    logReachability(adapter, deviceId, label, reachable);
}

/**
 * Writes all status values of a device (homes based devices: cameras, doorbell, alarms, shutters)
 * into its info channel: reachable, error, wifi_strength, rf_strength, battery_state,
 * battery_level and firmware. Values Netatmo does not deliver for a device are not created.
 * @param {ioBroker.Adapter & {extendOrSetObjectNotExistsAsync: Function}} adapter adapter instance
 * @param {string} infoPath ID of the info channel of the device, relative to the namespace
 * @param {StatusModule} aModule merged homesdata/homestatus data of the device
 * @param {StatusOptions} [options] options
 */
async function updateDeviceStatus(adapter, infoPath, aModule, options) {
    if (!aModule || !aModule.id) {
        return;
    }
    const skip = (options && options.skip) || [];
    const label = aModule.name || aModule.id;

    const reachable = getReachable(aModule);
    if (reachable !== undefined) {
        await setReachable(adapter, `${infoPath}.reachable`, aModule.id, label, reachable);
    }

    if (aModule.statusReceived || aModule.errorStatus) {
        await writeState(adapter, `${infoPath}.error`, { name: 'Error status (empty if ok)', type: 'string', role: 'text' }, aModule.errorStatus || '');
    }

    for (const [key, def] of Object.entries(STATUS_STATES)) {
        if (skip.includes(key)) {
            continue;
        }
        const val = def.get(aModule);
        if (val !== undefined) {
            await writeState(adapter, `${infoPath}.${key}`, def, val);
        }
    }
}

module.exports = {
    updateDeviceStatus,
    setReachable,
    getReachable,
    writeState,
};
