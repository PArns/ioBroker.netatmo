module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;

    const eventCleanUpTimer = {};

    let homeIds = [];
    let moduleIds = [];

    let that = null;

    const SmokeDetectorSubtypes = {
        0: 'OK',
        1: 'Alarm'
    };
    const SoundSubtypes = {
        0: 'OK',
        1: 'Failed'
    };
    const TamperedSubtypes = {
        0: 'OK',
        1: 'Failed'
    };
    const WifiSubtypes = {
        0: 'Failed',
        1: 'OK'
    };
    const BatterySubtypes = {
        0: 'LOW',
        1: 'Very LOW'
    };
    const ChamberSubtypes = {
        0: 'Clean',
        1: 'Dustiy'
    };
    const HushSubtypes = {
        0: 'Loud',
        1: 'Silent'
    };

    const EventEmitterBridge = require('./eventEmitterBridge.js')
    let eeB = null;

    const SmokeDetectorEvents = ['sound_test', 'detection_chamber_status', 'battery_status', 'wifi_status', 'tampered', 'smoke', 'hush']

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge(api, adapter)
        adapter.log.info(`Smoke-Detector: Registering realtime events with Socket instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
    };

    this.finalize = function () {
        if (eeB) {
            adapter.log.info('Smoke-Detector: Unregistering realtime events');
            eeB.destructor();
            api.dropWebHook();
        }
        Object.keys(eventCleanUpTimer)
            .forEach(id => clearInterval(eventCleanUpTimer[id]));
    };

    this.requestUpdateSmokedetector = function () {
        return new Promise(resolve => {
            api.homedataExtended({
                gateway_types: 'NSD'
            }, async (err, data) => {
                if (err !== null) {
                    adapter.log.error(err);
                } else {
                    const homes = data.homes;
                    homeIds = [];
                    moduleIds = [];

                    if (Array.isArray(homes)) {
                        for (let h = 0; h < homes.length; h++) {
                            const aHome = homes[h];
                            if (!aHome.modules) {
                                continue;
                            }
                            adapter.log.debug(`Get Smoke Detectors for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);

                            const homeName = formatName(aHome.name);

                            eventCleanUpTimer[homeName] =  eventCleanUpTimer[homeName] || setInterval(() =>
                                cleanUpEvents(homeName), cleanUpInterval * 60 * 1000);
                        }
                    }
                }
                resolve();
            });
        });
    };

    async function onSocketAlert(data) {
        if (!data || (data.device_id && !moduleIds.includes(data.device_id)) || data.event_type === undefined) {
            adapter.log.debug(`new alarm (smoke) IGNORE ${JSON.stringify(data)}`);
            return;
        }
        adapter.log.debug(`new alarm (smoke) ${JSON.stringify(data)}`);

        const now = new Date().toISOString();

        if (data) {
            const path = formatName(data.home_name) + '.LastEventData.';
            if (SmokeDetectorEvents.includes(data.event_type)) {
                await adapter.setStateAsync(path + 'LastPushType', {val: data.push_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventType', {val: data.event_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventDeviceId', {val: data.device_id, ack: true});
                await adapter.setStateAsync(path + 'LastEventId', {val: data.event_id, ack: true});
                await adapter.setStateAsync(path + 'LastEvent', {val: now, ack: true});

                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEvent`, {val: now, ack: true});
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEventId`, {val: data.event_id, ack: true});
		        if (data.event_type === 'smoke') {
               	    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                    	val: SmokeSubtypes[data.sub_type],
                    	ack: true
                    });
                } else
                if (data.event_type === 'wifi_status') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                    	val: WifiSubtypes[data.sub_type],
                    	ack: true
                    });
        		} else
                if (data.event_type === 'sound_test') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                    	val: SoundSubtypes[data.sub_type],
                    	ack: true
                    });
                } else
                if (data.event_type === 'tampered') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                    	val: TamperedSubtypes[data.sub_type],
                    	ack: true
                    });
                } else
                if (data.event_type === 'battery_status') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                        val: BatterySubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === 'detection_chamber_status') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                        val: ChamberSubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === 'hush') {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                        val: HushSubtypes[data.sub_type],
                        ack: true
                    });
                }

                // TODO
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: true, ack: true});
                // reset event after 10 sec
                setTimeout(async () =>
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: false, ack: true}), 10 * 1000);

                //await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: true, ack: true});
                //// reset event after 10 sec
                //setTimeout(async () => {
                 //   await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: false, ack: true});
                //}, 10 * 1000);
                let active = false;
                if (data.sub_type > 0) {
                   active = true;
                }
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {
                    val: active,
                    ack: true
                });
            }
        }
    }

    function formatName(aHomeName) {
        return aHomeName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }

    async function handleHome(aHome) {
        const homeName = formatName(aHome.name);
        const fullPath = homeName;

        homeIds.push(aHome.id);

        // Join HomeID
        if (eeB) {
            eeB.joinHome(aHome.id);
        }

        await adapter.extendOrSetObjectNotExistsAsync(homeName, {
            type: 'channel',
            common: {
                name: homeName,
            },
            native: {
                id: aHome.id
            }
        });


        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData', {
            type: 'channel',
            common: {
                name: 'LastEventData',
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.LastPushType', {
            type: 'state',
            common: {
                name: 'LastPushType',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.LastEventId', {
            type: 'state',
            common: {
                name: 'LastEventId',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.LastEventType', {
            type: 'state',
            common: {
                name: 'LastEventTypes',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.LastEventDeviceId', {
            type: 'state',
            common: {
                name: 'LastEventDeviceId',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.LastEvent', {
            type: 'state',
            common: {
                name: 'LastEvent',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        if (aHome.modules) {
            for (const aSmokeDetector of aHome.modules) {
                if (aSmokeDetector.id && aSmokeDetector.name) {
                    moduleIds.push(aSmokeDetector.id);
                    await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.' + aSmokeDetector.id, {
                        type: 'state',
                        common: {
                            name: aSmokeDetector.name,
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.' + aSmokeDetector.id, {val: aSmokeDetector.id, ack: true});
                }
                await handleSmokeDetector(aSmokeDetector, aHome);
            }
        }
    }

    async function handleSmokeDetector(aSmokeDetector, aHome) {
        const aParent = formatName(aHome.name);
        const fullPath = aParent + '.' + aSmokeDetector.id;
        const infoPath = fullPath + '.info';

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aSmokeDetector.name,
            },
            native: {
                id: aSmokeDetector.id,
                type: aSmokeDetector.type
            }
        });

        if (aSmokeDetector.id) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.id', {
                type: 'state',
                common: {
                    name: 'SmokeDetector ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(infoPath + '.id', {val: aSmokeDetector.id, ack: true});
        }



        if (aSmokeDetector.name) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.name', {
                type: 'state',
                common: {
                    name: 'SmokeDetector name',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.name', {val: aSmokeDetector.name, ack: true});
        }

        if (aSmokeDetector.last_setup) {
            await adapter.setObjectNotExistsAsync(infoPath + '.last_setup', {
                type: 'state',
                common: {
                    name: 'SmokeDetector setup date',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.last_setup', {
                val: new Date(aSmokeDetector.last_setup * 1000).toString(),
                ack: true
            });
        }

        for (const e of SmokeDetectorEvents) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}`, {
                type: 'channel',
                common: {
                    name: e,
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}.LastEventId`, {
                type: 'state',
                common: {
                    name: 'LastEventId',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}.LastEvent`, {
                type: 'state',
                common: {
                    name: 'LastEvent',
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {
                    id: aHome.id
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}.SubType`, {
                type: 'state',
                common: {
                    name: 'SubType',
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {
                    id: aHome.id,
                    event: e
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}.active`, {
                type: 'state',
                common: {
                    name: 'active',
                    type: 'boolean',
                    read: true,
                    write: false
                },
                native: {
                    id: aHome.id
                }
            });
        }

         // Initialize SmokeDetector Place
        if (aHome.place) {
            await handlePlace(aHome.place, fullPath);
        }
    }

    async function handlePlace(aPlace, aParent) {
        const fullPath = aParent + '.place';

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'channel',
            common: {
                name: 'place',
            }
        });

        if (aPlace.city) {
            await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.city', {
                type: 'state',
                common: {
                    name: 'city',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.city', {val: aPlace.city, ack: true});
        }

        if (aPlace.country) {
            await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.country', {
                type: 'state',
                common: {
                    name: 'country',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.country', {val: aPlace.country, ack: true});
        }

        if (aPlace.timezone) {
            await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.timezone', {
                type: 'state',
                common: {
                    name: 'timezone',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.timezone', {val: aPlace.timezone, ack: true});
        }
    }

    function cleanUpEvents(home) {
        adapter.getForeignObjects(`netatmo.${adapter.instance}.${home}.Events.*`, 'channel', (errEvents, objEvents) => {
            if (errEvents) {
                adapter.log.error(errEvents);
            } else if (objEvents) {
                const cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;

                for (const aEventId in objEvents) {
                    //adapter.getForeignObject(aEventId + '.time', 'state', function (errTime, objTime) {
                    adapter.getState(aEventId + '.time', async (errTime, stateTime) => {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (stateTime) {
                            let eventDate;

                            try {
                                eventDate = new Date(stateTime.val).getTime();
                            } catch(e) {
                                eventDate = null;
                            }

                            adapter.log.debug(`Cleanup Smoke Events: Check time for ${aEventId}: (${stateTime.val}) ${cleanupDate} > ${eventDate}`);
                            if ((cleanupDate > eventDate) || eventDate == null) {
                                adapter.log.info(`Smoke Event ${aEventId} expired, so cleanup`);
                                try {
                                    await adapter.delObjectAsync(aEventId, {recursive: true});
                                } catch (err) {
                                    adapter.log.warn(`Could not delete object ${aEventId} during cleanup. Please remove yourself.`);
                                }
                            }
                        }
                    });
                }
            }
        });
    }
}
