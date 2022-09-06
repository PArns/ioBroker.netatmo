module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;

    const eventCleanUpTimer = {};

    let homeIds = [];
    let moduleIds = [];

    let that = null;

    const EventEmitterBridge = require('./eventEmitterBridge.js');
    let eeB = null;

    const DoorbellEvents = ['incoming_call', 'accepted_call', 'missed_call'];

    const SDSubtypes = {
        1: 'Missing SD Card',
        2: 'SD Card inserted',
        3: 'SD Card formated',
        4: 'Working SD Card',
        5: 'Defective SD Card',
        6: 'Incompatible SD Card speed',
        7: 'Insufficient SD Card space'
    };

    const AlimentationSubtypes = {
        1: 'incorrect power adapter',
        2: 'correct power adapter'
    }

    const SirenSoundingSubtypes = {
        0: 'the module stopped sounding',
        1: 'the module is sounding',
    }

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge(api, adapter);
        adapter.log.info(`Doorbell: Registering realtime events with Socket instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
    };

    this.finalize = function () {
        if (eeB) {
            adapter.log.info('Doorbell: Unregistering realtime events');
            eeB.destructor();
            api.dropWebHook();
        }
        Object.keys(eventCleanUpTimer)
            .forEach(id => clearInterval(eventCleanUpTimer[id]));
    };


    this.requestUpdateDoorBell = function () {
        return new Promise(resolve => {
            api.homedataExtended({
                gateway_types: 'NDB'
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

                            adapter.log.debug(`Initialize DoorBell for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);

                            const homeName = formatName(aHome.name);

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
        if (!data || (data.device_id && !moduleIds.includes(data.device_id)) || data.event_type === undefined) {
            adapter.log.debug(`new alarm (doorbell) IGNORE ${JSON.stringify(data)}`);
            return;
        }
        adapter.log.debug(`new alarm (doorbell) ${JSON.stringify(data)}`);

        const now = new Date().toISOString();

        if (data) {
            const path = formatName(data.home_name) + '.LastEventData.';
            if (DoorbellEvents.includes(data.event_type)) {
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

                let active = data.event_type === 'incoming_call';
                await adapter.setStateAsync(`${data.home_name}.${data.device_id}.${data.event_type}.ring`, {
                    val: active,
                    ack: true
                });

            }
            //add events for Doorbell
            //type: 1 human; 2 animal; 3 vehicle
            else if (data.event_type === 'human') {
                await adapter.setStateAsync(path + 'Doorbell.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.type', { val: 1, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'animal') {
                await adapter.setStateAsync(path + 'Doorbell.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.type', { val: 2, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'vehicle') {
                await adapter.setStateAsync(path + 'Doorbell.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.type', { val: 3, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type !== 'vehicle') {
                await adapter.setStateAsync(path + 'Doorbell.event', { val: false, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.time', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.camera_id', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.type', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.typename', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.message', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.event_id', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Doorbell.subevent_id', { val: null, ack: true });
            } else {
                this.requestUpdateDoorBell();
            }
        }
    }

    function formatName(aHomeName) {
        return aHomeName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }

    // Initialize DoorBell for Home 0:
    // {"id":"5826e917743c36ee998c547c","name":"HomeKit","altitude":122,"coordinates":[12.381157535045338,51.385008535665726],"country":"DE","timezone":"Europe/Berlin","rooms":[{"id":"1023855399","name":"Wohnzimmer","type":"livingroom"},{"id":"2459706030","name":"Schlafzimmer","type":"bedroom"},{"id":"4140847963","name":"Garten","type":"outdoor"},{"id":"4224394592","name":"Haustür","type":"custom","module_ids":["70:ee:50:73:68:b2"]}],"modules":[{"id":"70:ee:50:73:68:b2","type":"NDB","name":"Netatmo Türklingel","setup_date":1608902813,"room_id":"4224394592"}]}
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

        // create sub-states for Doorbell
        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.event', {
            type: 'state',
            common: {
                name: 'event',
                type: 'boolean',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.time', {
            type: 'state',
            common: {
                name: 'time',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.camera_id', {
            type: 'state',
            common: {
                name: 'camera_id',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.type', {
            type: 'state',
            common: {
                name: 'type',
                type: 'number',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.typename', {
            type: 'state',
            common: {
                name: 'typename',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.message', {
            type: 'state',
            common: {
                name: 'message',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.snapshot_id', {
            type: 'state',
            common: {
                name: 'snapshot_id',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.snapshot_key', {
            type: 'state',
            common: {
                name: 'snapshot_key',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.snapshot_url', {
            type: 'state',
            common: {
                name: 'snapshot_url',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.vignette_id', {
            type: 'state',
            common: {
                name: 'vignette_id',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.vignette_key', {
            type: 'state',
            common: {
                name: 'vignette_key',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });


        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.vignette_url', {
            type: 'state',
            common: {
                name: 'vignette_url',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.event_id', {
            type: 'state',
            common: {
                name: 'event_id',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(homeName + '.LastEventData.Doorbell.subevent_id', {
            type: 'state',
            common: {
                name: 'subevent_id',
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
            for (const aDoorBell of aHome.modules) {
                moduleIds.push(aDoorBell.id);
                if (aDoorBell.id && aDoorBell.name) {
                    await adapter.extendOrSetObjectNotExistsAsync(fullPath + '.' + aDoorBell.id, {
                        type: 'state',
                        common: {
                            name: aDoorBell.name,
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.' + aDoorBell.id, {val: aDoorBell.id, ack: true});
                }
                await handleDoorbell(aDoorBell, aHome);
            }
        }
    }

    async function handleDoorbell(aDoorbell, aHome) {
        const aParent = formatName(aHome.name);
        const aParentRooms = aHome.rooms;
        const fullPath = aParent + '.' + aDoorbell.id;
        const infoPath = fullPath + '.info';

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aDoorbell.name,
            },
            native: {
                id: aDoorbell.id,
                type: aDoorbell.type
            }
        });

        // console.log(JSON.stringify(aCODetector))

        if (aDoorbell.id) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.id', {
                type: 'state',
                common: {
                    name: 'CODetector ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(infoPath + '.id', {val: aDoorbell.id, ack: true});
        }


        if (aDoorbell.setup_date) {
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
                val: new Date(aDoorbell.setup_date * 1000).toString(),
                ack: true
            });
        }

        if (aDoorbell.name) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.name', {
                type: 'state',
                common: {
                    name: 'CODetector name',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.name', {val: aDoorbell.name, ack: true});
        }

        if (aDoorbell.sd_status) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.sd_status', {
                type: 'state',
                common: {
                    name: 'SD card State (on/off)',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.sd_status', {val: SDSubtypes[aDoorbell.sd_status], ack: true});
        }

        if (aDoorbell.alim_status) {
            await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.alim_status', {
                type: 'state',
                common: {
                    name: 'Power Supply State (on/off)',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.alim_status', {val: AlimentationSubtypes[aDoorbell.alim_status], ack: true});
        }


        if (aDoorbell.room_id) {
            const roomName = aParentRooms.find((r) => r.id == aDoorbell.room_id)
            if (roomName) {
                await adapter.extendOrSetObjectNotExistsAsync(infoPath + '.room', {
                    type: 'state',
                    common: {
                        name: 'Doorbell Room',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(infoPath + '.room', {val: roomName.name, ack: true});
            }
        }

        for (const e of DoorbellEvents) {
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


            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.${e}.ring`, {
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

        // Initialize Doorbell Place
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
