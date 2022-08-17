module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;

    const eventCleanUpTimer = {};

    let homeIds = [];

    let that = null;

    const EventEmitterBridge = require('./eventEmitterBridge.js')
    let eeB = null;

    const CODetectorEvents = ["co_detected"]
    const CODetectorSubtypes = {
        0: 'OK',
        1: 'Pre-alarm',
        2: 'Alarm'
    }

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge(api, adapter)
        adapter.log.info(`CO-Sensor: Registering realtime events with Socket instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
    };

    this.finalize = function () {
        if (eeB) {
            adapter.log.info('CO-Sensor: Unregistering realtime events');
            eeB.destructor();
            api.dropWebHook();
        }
        Object.keys(eventCleanUpTimer).forEach(id => clearInterval(eventCleanUpTimer[id]));
    };


    this.requestUpdateCOSensor = function () {
        return new Promise(resolve => {
            api.homesdata({
                'gateway_types': 'NCO'
            }, async (err, data) => {
                if (err !== null) {
                    adapter.log.error(err);
                } else {
                    const homes = data.homes;
                    homeIds = [];

                    if (Array.isArray(homes)) {
                        for (let h = 0; h < homes.length; h++) {
                            const aHome = homes[h];
                            adapter.log.debug(`Get CO Sensor for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);

                            const homeName = getHomeName(aHome.name);

                            eventCleanUpTimer[homeName] = eventCleanUpTimer[homeName] || setInterval(() =>
                                cleanUpEvents(homeName), cleanUpInterval * 60 * 1000);
                        }
                    }
                }
                resolve();
            });
        });
    };

    async function onSocketAlert(data) {
        adapter.log.debug('new alarm (carbon) ' + JSON.stringify(data));

        await that.requestUpdateCOSensor();

        const now = new Date().toISOString();

        if (data) {
            const path = data.home_name + '.LastEventData.';
            const carbonDetectorEvents = ["co_detected"]
            if (carbonDetectorEvents.includes(data.event_type)) {
                await adapter.setStateAsync(path + 'LastPushType', {val: data.push_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventType', {val: data.event_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventDeviceId', {val: data.device_id, ack: true});
                await adapter.setStateAsync(path + 'LastEventId', {val: data.event_id, ack: true});
                await adapter.setStateAsync(path + 'LastEvent', {val: now, ack: true});

                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEvent`, {
                    val: now,
                    ack: true
                });
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEventId`, {
                    val: data.event_id,
                    ack: true
                });

                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.SubType`, {
                    val: CODetectorSubtypes[data.sub_type],
                    ack: true
                });

                let active = false
                if (data.sub_type > 0) {
                    active = true
                }
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {
                    val: active,
                    ack: true
                });

            }
        }
    }

    function getHomeName(aHomeName) {
        return aHomeName.replaceAll(' ', '-').replaceAll('---', '-').replaceAll('--', '-');
    }

    async function handleHome(aHome) {
        const homeName = getHomeName(aHome.name);
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

        // adapter.log.debug(JSON.stringify(aHome))

        if (aHome.modules) {
            for (const aCODetector of aHome.modules) {
                if (aCODetector.id && aCODetector.name) {
                    await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.' + aCODetector.id, {
                        type: 'state',
                        common: {
                            name: aCODetector.name,
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.' + aCODetector.id, {val: aCODetector.id, ack: true});
                }
                await handleCODetector(aCODetector, aHome);
            }
        }

        // Disabled due to no usage ...
        /*
        if (aHome.events) {

            const latestEventDate = 0;
            const latestEvent = null;

            aHome.events.forEach(function (aEvent) {
                const eventDate = aEvent.time * 1000;

                handleEvent(aEvent, homeName, aHome.cameras);
                if (eventDate > latestEventDate) {
                    latestEventDate = eventDate;
                    latestEvent = aEvent;
                }
            });

            if (latestEvent) {
                await adapter.setStateAsync(homeName + '.LastEventData.LastEventId', {val: latestEvent.id, ack: true});
            }
        }
         */
    }

    async function handleCODetector(aCODetector, aHome) {
        const aParent = getHomeName(aHome.name);
        const aParentRooms = aHome.rooms;
        const fullPath = aParent + '.' + aCODetector.id;
        const infoPath = fullPath + '.info';

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aCODetector.name,
            },
            native: {
                id: aCODetector.id,
                type: aCODetector.type
            }
        });

        // console.log(JSON.stringify(aCODetector))

        if (aCODetector.id) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.id', {
                type: 'state',
                common: {
                    name: 'CODetector ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(infoPath + '.id', {val: aCODetector.id, ack: true});
        }


        if (aCODetector.setup_date) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.setup_date', {
                type: 'state',
                common: {
                    name: 'CODetector setup date',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.setup_date', {
                val: new Date(aCODetector.setup_date * 1000).toString(),
                ack: true
            });
        }

        if (aCODetector.setup_date) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.name', {
                type: 'state',
                common: {
                    name: 'CODetector name',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.name', {val: aCODetector.name, ack: true});
        }

        if (aCODetector.room_id) {
            const roomName = aParentRooms.find((r) => r.id == aCODetector.room_id)
            if (roomName) {
                await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.room', {
                    type: 'state',
                    common: {
                        name: 'CODetector Room',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(infoPath + '.room', {val: roomName.name, ack: true});
            }
        }

        for (const e of CODetectorEvents) {
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
                },
                native: {
                    id: aHome.id,
                    event: e
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
                    id: aHome.id,
                    event: e
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
                    id: aHome.id,
                    event: e
                }
            });
        }

        // Initialize CODetector Place
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
        adapter.getForeignObjects('netatmo.' + adapter.instance + '.' + home + '.Events.*', 'channel', (errEvents, objEvents) => {
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
                            } catch (e) {
                                eventDate = null;
                            }

                            adapter.log.debug(`Cleanup CO Events: Check time for ${aEventId}: (${stateTime.val}) ${cleanupDate} > ${eventDate}`);
                            if ((cleanupDate > eventDate) || eventDate == null) {
                                adapter.log.info(`CO Event ${aEventId} expired, so cleanup`);
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
