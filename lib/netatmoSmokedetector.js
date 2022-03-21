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

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge()
        adapter.log.info(`Registering realtime events with Socket instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
        api.addWebHook(socketServerUrl);
    };

    this.finalize = function () {
        if (eeB) {
            adapter.log.info('Unregistering realtime events');
            eeB.destructor();
            api.dropWebHook();
        }
        Object.keys(eventCleanUpTimer).forEach(id => clearInterval(eventCleanUpTimer[id]));
    };


    this.requestUpdateSmokedetector = function () {
        return new Promise(resolve => {
            api.getHomeData({}, async (err, data) => {
                if (err !== null) {
                    adapter.log.error(err);
                } else {
                    const homes = data.homes;
                    homeIds = [];

                    if (Array.isArray(homes)) {
                        for (let h = 0; h < homes.length; h++) {
                            const aHome = homes[h];

                            await handleHome(aHome);

                            const homeName = getHomeName(aHome.name);

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
        adapter.log.debug('new alarm (smoke) ' + JSON.stringify(data));

        await that.requestUpdateSmokedetector();

        const now = new Date().toISOString();

        if (data) {
            const path = data.home_name + '.LastEventData.';
            const smokeDetectorEvents = ["sound_test","detection_chamber_status","battery_status","wifi_status","tampered","smoke","hush"]
            if (smokeDetectorEvents.includes(data.event_type)) {
                await adapter.setStateAsync(path + 'LastPushType', {val: data.push_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventType', {val: data.event_type, ack: true});
                await adapter.setStateAsync(path + 'LastEventDeviceId', {val: data.device_id, ack: true});
                await adapter.setStateAsync(path + 'LastEventId', {val: data.event_id, ack: true});
                await adapter.setStateAsync(path + 'LastEvent', {val: now, ack: true});

                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEvent`, {val: now, ack: true});
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.LastEventId`, {val: data.event_id, ack: true});
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: true, ack: true});
                // reset event after 10 sec
                setTimeout(async () => {
                    await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.active`, {val: false, ack: true});
                }, 10 * 1000);
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

        await adapter.setObjectNotExistsAsync(homeName, {
            type: 'channel',
            common: {
                name: homeName,
            },
            native: {
                id: aHome.id
            }
        });


        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData', {
            type: 'channel',
            common: {
                name: 'LastEventData',
            }
        });

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastPushType', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastEventId', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastEventType', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastEventDeviceId', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastEvent', {
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


        if (aHome.smokedetectors) {
            for (const aSmokeDetector of aHome.smokedetectors) {
                if (aSmokeDetector.id && aSmokeDetector.name) {
                    await adapter.setObjectNotExistsAsync(fullPath + '.' + aSmokeDetector.id, {
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
            }
        }

        // Smoke Detector Objects anlegen
        if (aHome.smokedetectors) {
            for (const aSmokeDetector of aHome.smokedetectors) {
                await handleSmokeDetector(aSmokeDetector, aHome);
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

    async function handleSmokeDetector(aSmokeDetector, aHome) {
        const aParent = getHomeName(aHome.name);
        const fullPath = aParent + '.' + aSmokeDetector.id;
        const infoPath = fullPath + '.info';
        const smokeDetectorEvents = ["sound_test","detection_chamber_status","battery_status","wifi_status","tampered","smoke","hush"]

        await adapter.setObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aSmokeDetector.name,
                type: 'device',
                read: true,
                write: false
            },
            native: {
                id: aSmokeDetector.id,
                type: aSmokeDetector.type
            }
        });

        if (aSmokeDetector.id) {
            await adapter.setObjectNotExistsAsync(infoPath + '.id', {
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
            await adapter.setObjectNotExistsAsync(infoPath + '.name', {
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

        for (const e of smokeDetectorEvents) {
            await adapter.setObjectNotExistsAsync(`${fullPath}.${e}`, {
                type: 'channel',
                common: {
                    name: e,
                }
            });

            await adapter.setObjectNotExistsAsync(`${fullPath}.${e}.LastEventId`, {
                type: 'state',
                common: {
                    name: 'LastEventId',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setObjectNotExistsAsync(`${fullPath}.${e}.LastEvent`, {
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

            await adapter.setObjectNotExistsAsync(`${fullPath}.${e}.active`, {
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

        await adapter.setObjectNotExistsAsync(fullPath, {
            type: 'channel',
            common: {
                name: 'place',
            }
        });

        if (aPlace.city) {
            await adapter.setObjectNotExistsAsync(fullPath + '.city', {
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
            await adapter.setObjectNotExistsAsync(fullPath + '.country', {
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
            await adapter.setObjectNotExistsAsync(fullPath + '.timezone', {
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
                    adapter.getForeignStates(aEventId + '.time', async (errTime, objTime) => {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (objTime) {
                            for (const aTimeId in objTime) {
                                let eventDate = null;

                                try {
                                    eventDate = Date.parse(objTime[aTimeId].val);
                                } catch(e) {
                                    eventDate = null;
                                }

                                if ((cleanupDate > eventDate) || eventDate == null) {
                                    const parentId = aTimeId.substring(0, aTimeId.length - 5);

                                    adapter.getForeignObjects(parentId + '.*', 'state', async (errState, objState) => {
                                        if (errState) {
                                            adapter.log.error(errState);
                                        } else {
                                            for (const aStateId in objState) {
                                                adapter.log.debug(`State ${aStateId} abgelaufen daher löschen!`);
                                                await adapter.delObjectAsync(aStateId);
                                            }
                                        }
                                    });

                                    adapter.log.info(`Event ${parentId} abgelaufen daher löschen!`);
                                    await adapter.delObjectAsync(parentId);
                                }
                            }
                        }
                    });
                }
            }
        });
    }
}
