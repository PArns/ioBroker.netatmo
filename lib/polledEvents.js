'use strict';

/**
 * Takes over events from the regular update (getevents) for devices whose states were only
 * written by realtime events (iot instance).
 *
 * @KI_HINWEIS: CO-Melder und Rauchmelder haben ihre Ereignis-Datenpunkte bisher nur ueber
 * Echtzeit-Ereignisse (iot-Instanz, Pro-Lizenz) gefuellt. Die bei jedem Abruf ohnehin geholte
 * Ereignisliste (getevents) wurde nicht ausgewertet: ohne iot blieben die Werte null (Issue #190),
 * und die Abfrage war umsonst. Jetzt wird pro Geraet und Ereignistyp das neueste Ereignis
 * uebernommen, wenn es neuer ist als das bereits gespeicherte (Abgleich ueber die Ereignis-ID).
 * @module polledEvents
 */

/**
 * @typedef {object} PolledEventOptions
 * @property {Date} eventTime time of the event from Netatmo
 * @property {boolean} polled true: event comes from the regular update, not in realtime
 */

/**
 * Passes the newest event per device and event type of a home to the realtime handler,
 * if it is not yet stored.
 * @param {ioBroker.Adapter} adapter adapter instance
 * @param {{id: string, modules?: {id: string}[], events?: {id: string, type: string, time: number, module_id: string, sub_type?: number}[]}} aHome home from homedataExtended
 * @param {string[]} eventTypes event types the product handles
 * @param {(data: object, options: PolledEventOptions) => Promise<void>} handler realtime event handler
 */
async function applyPolledEvents(adapter, aHome, eventTypes, handler) {
    if (!aHome || !Array.isArray(aHome.events) || !Array.isArray(aHome.modules)) {
        return;
    }
    const homePath = aHome.id.replace(/:/g, '-');

    /** @type {Map<string, any>} newest event per device and type */
    const newest = new Map();
    for (const event of aHome.events) {
        if (!event || !event.id || !event.module_id || typeof event.time !== 'number' || !eventTypes.includes(event.type)) {
            continue;
        }
        if (!aHome.modules.some(m => m.id === event.module_id)) {
            continue;
        }
        const key = `${event.module_id}|${event.type}`;
        const known = newest.get(key);
        if (!known || event.time > known.time) {
            newest.set(key, event);
        }
    }

    // oldest first, so the home wide "LastEventData" ends with the newest event
    const events = [...newest.values()].sort((a, b) => a.time - b.time);
    for (const event of events) {
        const statePath = `${homePath}.${event.module_id.replace(/:/g, '-')}.${event.type}`;
        const storedId = await adapter.getStateAsync(`${statePath}.LastEventId`);
        if (storedId && storedId.val === event.id) {
            continue;
        }
        const storedTime = await adapter.getStateAsync(`${statePath}.LastEvent`);
        const storedTs = storedTime && storedTime.val ? Date.parse(String(storedTime.val)) : NaN;
        if (!isNaN(storedTs) && storedTs > event.time * 1000) {
            // a newer event was already received in realtime
            continue;
        }
        adapter.log.debug(`Take over event from regular update: ${JSON.stringify(event)}`);
        await handler({
            push_type: 'polling',
            event_type: event.type,
            event_id: event.id,
            device_id: event.module_id,
            home_id: aHome.id,
            sub_type: event.sub_type,
        }, {eventTime: new Date(event.time * 1000), polled: true});
    }
}

module.exports = {
    applyPolledEvents,
};
