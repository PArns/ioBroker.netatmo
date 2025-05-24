module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;
    const UnknownPersonTime = adapter.config.unknown_person_time ? adapter.config.unknown_person_time : 24;

    const eventCleanUpTimer = {};
    const personCleanUpTimer = {};

    let knownPeople = [];
    let homeIds = [];
    let moduleIds = [];

    let finalized = false;

    let that = null;
    const EventEmitterBridge = require('./eventEmitterBridge.js');
    let eeB = null;

    let camera_vpn;

    const SDSubtypes = {
        1: 'Missing SD Card',
        2: 'SD Card inserted',
        3: 'SD Card formatted',
        4: 'Working SD Card',
        5: 'Defective SD Card',
        6: 'Incompatible SD Card speed',
        7: 'Insufficient SD Card space'
    };

    const AlimentationSubtypes = {
        1: 'incorrect power adapter',
        2: 'correct power adapter'
    };

    const SirenSoundingSubtypes = {
        0: 'the module stopped sounding',
        1: 'the module is sounding',
    };

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge(api, adapter)
        adapter.log.info(`Welcome: Registering realtime events with iot instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
    };

    this.finalize = function () {
        finalized = true;
        if (eeB) {
            adapter.log.info('Welcome: Unregistering realtime events');
            eeB.destructor();
            eeB = null;
        }
        Object.keys(eventCleanUpTimer).forEach(id => clearInterval(eventCleanUpTimer[id]));
        Object.keys(personCleanUpTimer).forEach(id => clearInterval(personCleanUpTimer[id]));
    };

    this.setAway = function (data, callback) {
        let homes = homeIds;
        data = data || {};
        if (data && data.homeId) {
            homes = [data.homeId];
        }
        if (data.personsId && !Array.isArray(data.personsId)) {
            data.personsId = [data.personsId];
        } else if (!data.personsId) {
            data.personsId = [null];
        }
        let cnt = homes.length * data.personsId.length;
        let errs = [];
        let ress = [];
        homes.forEach(aHomeId => {
            data.personsId.forEach(personId => {
                api.setPersonsAway(aHomeId, personId, (err, res) => {
                    if (err) {
                        adapter.log.error(`Error on setPersonsAway: ${err} ${res}`);
                        errs.push(err);
                    }
                    ress.push(res)
                    if (!--cnt && callback) {
                        const err = errs.length ? `Errors on setPersonsAway: ${errs.join(', ')}` : null;
                        callback(err, ress);
                    }
                });
            });
        });
    };

    this.setHome = function (data, callback) {
        let homes = homeIds;
        if (data && data.homeId) {
            homes = [data.homeId];
        }
        let cnt = homes.length;
        let errs = [];
        let ress = [];
        homes.forEach(aHomeId =>
            api.setPersonsHome(aHomeId, data ? data.personsId : null, (err, res) => {
                if (err) {
                    adapter.log.error(`Error on setPersonsAway: ${err} ${res}`);
                    errs.push(err);
                }
                ress.push(res)
                if (!--cnt && callback) {
                    const err = errs.length ? `Errors on setPersonsAway: ${errs.join(', ')}` : null;
                    callback(err, ress);
                }
            })
        );

    };

    this.situativeUpdate = function (homeId, moduleId) {
        if (finalized) return;
        if (homeIds.includes(homeId) && moduleIds.includes(moduleId)) {
            that.requestUpdateIndoorCamera();
        }
    }

    this.requestUpdateIndoorCamera = function () {
        return new Promise(resolve => {
            api.homedataExtended({
                gateway_types: ['NACamera', 'NOC'], // 'NACamDoorTag', 'NIS' ?? no cameras
            }, async (err, data) => {
                if (finalized) return;
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
                            adapter.log.debug(`Get Welcome/Presence for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);

                            const homeId = aHome.id.replace(/:/g, '-'); // formatName(aHome.name);

                            eventCleanUpTimer[homeId] =  eventCleanUpTimer[homeId] || setInterval(() =>
                                cleanUpEvents(homeId), cleanUpInterval * 60 * 1000);

                            personCleanUpTimer[homeId] = personCleanUpTimer[homeId] || setInterval(() =>
                                cleanUpUnknownPersons(homeId), cleanUpInterval * 60 * 1000);
                        }
                    }
                }
                resolve();
            });
        });
    };

    async function onSocketAlert(data) {
        if (!data || !data.device_id || (data.device_id && !moduleIds.includes(data.device_id)) || data.event_type === undefined) {
            adapter.log.debug(`new alarm (welcome) IGNORE ${JSON.stringify(data)}`);
            return;
        }
        adapter.log.debug(`new alarm (welcome) ${JSON.stringify(data)}`);

        const now = new Date().toISOString();
        let handledEvent = true;

        if (data) {
            const path = `${data.home_id.replace(/:/g, '-')}.LastEventData.`; // formatName(data.home_name) + '.LastEventData.';
            const deviceEventPath = `${path}${data.device_id.replace(/:/g, '-')}.`;
            const devicePath = `${data.home_id.replace(/:/g, '-')}.${data.device_id.replace(/:/g, '-')}.`;

            if (data.event_type === 'person') {
                for (const person of data.persons) {
                    let dataPath = '';

                    if (person.is_known) {
                        dataPath = 'LastKnownPersonSeen';
                    } else {
                        dataPath = 'LastUnknownPersonSeen';
                    }

                    await adapter.setStateAsync(path + dataPath, {val: now, ack: true});

                    // Set state first ...
                    if (person.is_known) {
                        for (const aPerson of knownPeople) {
                            if (aPerson.face && aPerson.face.id === person.face_id) {
                                await adapter.setStateAsync(`${path}LastKnownPersonName`, {val: aPerson.pseudo, ack: true});
                                break;
                            }
                        }
                    }
                }
            } else if (data.event_type === 'movement') {
                await adapter.setStateAsync(`${path}LastMovementDetected`, {val: now, ack: true});

                if (data.type) {
                    await adapter.setStateAsync(`${path}LastMovementType`, {val: data.type, ack: true});
                } else {
                    await adapter.setStateAsync(`${path}LastMovementType`, {val: 'unknown', ack: true});
                }
            }

            //add events for Presence
            //type: 1 human; 2 animal; 3 vehicle
            else if (data.event_type === 'human') {
                await adapter.setStateAsync(`${deviceEventPath}event`, { val: true, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}time`, { val: now, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}camera_id`, { val: data.camera_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}type`, { val: 1, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}typename`, { val: data.event_type, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}message`, { val: data.message, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_id`, { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_key`, { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_url`, { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_id`, { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_key`, { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_url`, { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}event_id`, { val: data.event_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}subevent_id`, { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'animal') {
                await adapter.setStateAsync(`${deviceEventPath}event`, { val: true, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}time`, { val: now, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}camera_id`, { val: data.camera_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}type`, { val: 2, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}typename`, { val: data.event_type, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}message`, { val: data.message, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_id`, { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_key`, { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_url`, { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_id`, { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_key`, { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_url`, { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}event_id`, { val: data.event_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}subevent_id`, { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'vehicle') {
                await adapter.setStateAsync(`${deviceEventPath}event`, { val: true, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}time`, { val: now, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}camera_id`, { val: data.camera_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}type`, { val: 3, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}typename`, { val: data.event_type, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}message`, { val: data.message, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_id`, { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_key`, { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_url`, { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_id`, { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_key`, { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_url`, { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}event_id`, { val: data.event_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}subevent_id`, { val: data.subevent_id, ack: true });
            }
            else if (data.snapshot_id || data.vignette_id) {
                await adapter.setStateAsync(`${deviceEventPath}event`, { val: false, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}time`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}camera_id`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}type`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}typename`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}message`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_id`, { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_key`, { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}snapshot_url`, { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_id`, { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_key`, { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}vignette_url`, { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}event_id`, { val: null, ack: true });
                await adapter.setStateAsync(`${deviceEventPath}subevent_id`, { val: null, ack: true });
            } else {
                handledEvent = false;
                that.requestUpdateIndoorCamera();
            }
            if (handledEvent) {
                await adapter.setStateAsync(`${path}LastPushType`, {val: data.push_type, ack: true});
                await adapter.setStateAsync(`${path}LastEventType`, {val: data.event_type, ack: true});
                await adapter.setStateAsync(`${path}LastEventDeviceId`, {val: data.device_id, ack: true});
                await adapter.setStateAsync(`${path}LastEventId`, {val: data.event_id, ack: true});
                await adapter.setStateAsync(`${path}LastEvent`, {val: now, ack: true});

                /*await adapter.setStateAsync(`${devicePath}${data.event_type}.LastEvent`, {
                    val: now,
                    ack: true
                });
                await adapter.setStateAsync(`${devicePath}${data.event_type}.LastEventId`, {
                    val: data.event_id,
                    ack: true
                });*/
            }
        }
    }

    /*
    function formatName(aHomeName) {
        return aHomeName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }
    */

    async function handleHome(aHome) {
        const homeId = aHome.id.replace(/:/g, '-'); //formatName(aHome.name);
        const fullPath = homeId;

        homeIds.push(aHome.id);

        // Join HomeID
        if (eeB) {
            eeB.joinHome(aHome.id);
        }

        await adapter.extendOrSetObjectNotExistsAsync(homeId, {
            type: 'folder',
            common: {
                name: aHome.name || aHome.id,
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastMovementDetected`, {
            type: 'state',
            common: {
                name: 'LastMovementDetected',
                type: 'string',
                role: 'value.date',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastKnownPersonSeen`, {
            type: 'state',
            common: {
                name: 'LastKnownPersonSeen',
                type: 'string',
                role: 'value.date',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastMovementType`, {
            type: 'state',
            common: {
                name: 'LastMovementType',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastEventType`, {
            type: 'state',
            common: {
                name: 'LastEventTypes',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastEventDeviceId`, {
            type: 'state',
            common: {
                name: 'LastEventDeviceId',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastPushType`, {
            type: 'state',
            common: {
                name: 'LastPushType',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastEventId`, {
            type: 'state',
            common: {
                name: 'LastEventId',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastEvent`, {
            type: 'state',
            common: {
                name: 'LastEvent',
                type: 'string',
                role: 'value.date',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastKnownPersonName`, {
            type: 'state',
            common: {
                name: 'LastKnownPersonName',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData.LastUnknownPersonSeen`, {
            type: 'state',
            common: {
                name: 'LastUnknownPersonSeen',
                type: 'string',
                role: 'value.date',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData`, {
            type: 'channel',
            common: {
                name: 'LastEventData',
            }
        });

        if (aHome.modules) {
            for (const aCamera of aHome.modules) {
                if (aCamera.id) {
                    moduleIds.push(aCamera.id);
                    await handleCamera(aCamera, aHome);
                }
            }
        }

        if (aHome.persons) {
            knownPeople = [];

            for (const aPerson of aHome.persons) {
                await handlePerson(aPerson, homeId);
            }
        }

        if (aHome.events) {
            let latestEventDate = 0;
            let latestEvent = null;

            for (const aEvent of aHome.events) {
                const eventDate = aEvent.time * 1000;

                adapter.log.debug(`Handle Event: ${JSON.stringify(aEvent)}`);
                await handleEvent(aEvent, homeId, aHome.modules);
                if (eventDate > latestEventDate) {
                    latestEventDate = eventDate;
                    latestEvent = aEvent;
                }
            }

            if (latestEvent) {
                await adapter.setStateAsync(`${homeId}.LastEventData.LastEventId`, {val: latestEvent.id, ack: true});
            }
        }
    }

    async function handleCamera(aCamera, aHome) {
        const aParent = aHome.id.replace(/:/g, '-'); // formatName(aHome.name);
        const fullPath = `${aParent}.${aCamera.id.replace(/:/g, '-')}`;
        const infoPath = `${fullPath}.info`;
        const livePath = `${fullPath}.live`;

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aCamera.name || aCamera.id,
            },
            native: {
                id: aCamera.id,
                type: aCamera.type
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(infoPath, {
            type: 'channel',
            common: {
                name: `${aCamera.name || aCamera.id} Info`,
            },
            native: {
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(livePath, {
            type: 'channel',
            common: {
                name: `${aCamera.name || aCamera.id} Live`,
            },
            native: {
            }
        });

        if (aCamera.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.id`, {
                type: 'state',
                common: {
                    name: 'Camera ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${infoPath}.id`, {val: aCamera.id, ack: true});
        }

        if (aCamera.monitoring) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.monitoring`, {
                type: 'state',
                common: {
                    name: 'Monitoring State (on/off)',
                    type: 'string',
                    states: {'on': 'on', 'off': 'off'},
                    role: 'state',
                    read: true,
                    write: true
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aCamera.id,
                    field: 'monitoring'
                }
            });

            await adapter.setStateAsync(`${infoPath}.monitoring`, {val: aCamera.monitoring, ack: true});
        }

        if (aCamera.status) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.status`, {
                type: 'state',
                common: {
                    name: 'Status (on/off)',
                    type: 'string',
                    states: {'on': 'on', 'off': 'off'},
                    role: 'state',
                    read: true,
                    write: true
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aCamera.id,
                    field: 'status'
                }
            });

            await adapter.setStateAsync(`${infoPath}.status`, {val: aCamera.status, ack: true});
        }

        if (aCamera.floodlight) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.floodlight`, {
                type: 'state',
                common: {
                    name: 'Floodlight State (on/off/auto)',
                    type: 'string',
                    states: {'on': 'on', 'off': 'off', 'auto': 'auto'},
                    role: 'state',
                    read: true,
                    write: true
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aCamera.id,
                    field: 'floodlight'
                }
            });

            await adapter.setStateAsync(`${infoPath}.floodlight`, {val: aCamera.floodlight, ack: true});
        }

        if (aCamera.sd_status) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.sd_status`, {
                type: 'state',
                common: {
                    name: 'SD card State (on/off)',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.sd_status`, {val: SDSubtypes[aCamera.sd_status], ack: true});
        }

        if (aCamera.alim_status) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.alim_status`, {
                type: 'state',
                common: {
                    name: 'Power Supply State (on/off)',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.alim_status`, {val: AlimentationSubtypes[aCamera.alim_status], ack: true});
        }

        if (aCamera.name) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.name`, {
                type: 'state',
                common: {
                    name: 'Camera name',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.name`, {val: aCamera.name, ack: true});
        }

        if (aCamera.vpn_url) {
            await adapter.extendOrSetObjectNotExistsAsync(`${livePath}.picture`, {
                type: 'state',
                common: {
                    name: 'Live camera picture URL',
                    type: 'string',
                    role: 'url.cam',
                    read: true,
                    write: false
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${livePath}.stream`, {
                type: 'state',
                common: {
                    name: 'Live camera picture URL',
                    type: 'string',
                    role: 'url.cam',
                    read: true,
                    write: false
                }
            });

            camera_vpn = aCamera.vpn_url;

            await adapter.setStateAsync(`${livePath}.picture`, {val: `${aCamera.vpn_url}/live/snapshot_720.jpg`, ack: true});
            await adapter.setStateAsync(`${livePath}.stream`, {
                val: `${aCamera.vpn_url}${aCamera.is_local ? '/live/index_local.m3u8' : '/live/index.m3u8'}`,
                ack: true
            });
        }

        const deviceEventPath = `${aParent}.LastEventData.${aCamera.id.replace(/:/g, '-')}.`;

        // create sub-states for Doorbell
        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath.substring(0, deviceEventPath.length - 1)}`, {
            type: 'channel',
            common: {
                name: 'Events',

            },
            native: {
            }
        });

        // create sub-states for Presence
        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}event`, {
            type: 'state',
            common: {
                name: 'event',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}time`, {
            type: 'state',
            common: {
                name: 'time',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}camera_id`, {
            type: 'state',
            common: {
                name: 'camera_id',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}type`, {
            type: 'state',
            common: {
                name: 'type',
                type: 'number',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}typename`, {
            type: 'state',
            common: {
                name: 'typename',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}message`, {
            type: 'state',
            common: {
                name: 'message',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}snapshot_id`, {
            type: 'state',
            common: {
                name: 'snapshot_id',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}snapshot_key`, {
            type: 'state',
            common: {
                name: 'snapshot_key',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}snapshot_url`, {
            type: 'state',
            common: {
                name: 'snapshot_url',
                type: 'string',
                role: 'url.cam',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}vignette_id`, {
            type: 'state',
            common: {
                name: 'vignette_id',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}vignette_key`, {
            type: 'state',
            common: {
                name: 'vignette_key',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });


        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}vignette_url`, {
            type: 'state',
            common: {
                name: 'vignette_url',
                type: 'string',
                role: 'url',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}event_id`, {
            type: 'state',
            common: {
                name: 'event_id',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${deviceEventPath}subevent_id`, {
            type: 'state',
            common: {
                name: 'subevent_id',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        // Initialize Camera Place
        if (aHome.place) {
            await handlePlace(aHome.place, fullPath);
        }
    }

    async function handlePlace(aPlace, aParent) {
        const fullPath = `${aParent}.place`;

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'channel',
            common: {
                name: 'place',
            }
        });

        if (aPlace.city) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.city`, {
                type: 'state',
                common: {
                    name: 'city',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.city`, {val: aPlace.city, ack: true});
        }

        if (aPlace.country) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.country`, {
                type: 'state',
                common: {
                    name: 'country',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.country`, {val: aPlace.country, ack: true});
        }

        if (aPlace.timezone) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.timezone`, {
                type: 'state',
                common: {
                    name: 'timezone',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.timezone`, {val: aPlace.timezone, ack: true});
        }
    }

    /*
    function formatPersonName(aPersonName) {
        return aPersonName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replaceAll('ß', 'ss').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }
    */

    async function handlePerson(aPerson, aParent) {
        let personId = aPerson.id;
        let bKnown = true;
        let cleanupDate = new Date().getTime();
        if (!aPerson.pseudo) {
            bKnown = false;
            cleanupDate -= UnknownPersonTime * 60 * 60 * 1000;
        }

        const personDate = aPerson.last_seen ? aPerson.last_seen * 1000 : cleanupDate;

        adapter.log.debug(`handlePerson: ${personId} ${aPerson.pseudo} ${aPerson.last_seen} ${personDate} ${cleanupDate}`);
        if (bKnown || personDate > cleanupDate) {
            let fullPath = `${aParent}.Persons`;

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: 'folder',
                common: {
                    name: 'Persons',
                }
            });

            if (bKnown) {
                fullPath += '.Known';
                knownPeople.push(aPerson);
            }
            else {
                fullPath += '.Unknown';
            }

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: 'folder',
                common: {
                    name: fullPath,
                }
            });

            fullPath += `.${personId}`;

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: 'channel',
                common: {
                    name: aPerson.pseudo || fullPath,
                },
                native: {
                    id: personId
                }
            });

            if (aPerson.id) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.id`, {
                    type: 'state',
                    common: {
                        name: 'Person ID',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.id`, {val: aPerson.id, ack: true});
            }

            if (aPerson.pseudo) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.name`, {
                    type: 'state',
                    common: {
                        name: 'Person Name',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.name`, {val: aPerson.pseudo, ack: true});
            }

            if (aPerson.out_of_sight !== undefined) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.out_of_sight`, {
                    type: 'state',
                    common: {
                        name: 'Person out of sight (true/false)',
                        type: 'boolean',
                        role: 'indicator',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.out_of_sight`, {val: aPerson.out_of_sight, ack: true});

                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.atHome`, {
                    type: 'state',
                    common: {
                        name: 'Person at home (true/false)',
                        type: 'boolean',
                        role: 'indicator',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.atHome`, {val: !aPerson.out_of_sight, ack: true});
            }

            if (aPerson.last_seen) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.last_seen`, {
                    type: 'state',
                    common: {
                        name: 'Last seen',
                        type: 'number',
                        role: 'value.date',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${fullPath}.last_seen`, {
                    val: aPerson.last_seen * 1000,
                    ack: true
                });
            }

            if (aPerson.face !== undefined) {
                await handleFace(aPerson.face, fullPath);
            }

        }
    }

    async function handleFace(aFace, aParent) {
        const fullPath = aParent;

        if (aFace.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.face_id`, {
                type: 'state',
                common: {
                    name: 'Face ID',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.face_id`, {val: aFace.id, ack: true});
        }

        if (aFace.key) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.face_key`, {
                type: 'state',
                common: {
                    name: 'Face Key',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.face_key`, {val: aFace.key, ack: true});
        }

        if (aFace.id && aFace.key) {
            const imageUrl = `https://api.netatmo.com/api/getcamerapicture?image_id=${aFace.id}&key=${aFace.key}`;

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.face_url`, {
                type: 'state',
                common: {
                    name: 'Face Url',
                    type: 'string',
                    role: 'url',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.face_url`, {
                val: imageUrl,
                ack: true
            });
        }

        if (aFace.version) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.face_version`, {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.face_version`, {val: aFace.version, ack: true});
        }
    }

    async function handleEvent(aEvent, aParent, aCameraList) {
        const cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;
        const eventDate = aEvent.time ? aEvent.time * 1000 : cleanupDate;

        if (cleanupDate < eventDate) {
            let fullPath = `${aParent}.Events`;
            let camera = null;

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: 'folder',
                common: {
                    name: 'Events',
                }
            });

            fullPath += `.${aEvent.id}`;

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: 'channel',
                common: {
                    name: aEvent.id,
                },
                native: {
                    id: `Events.${aEvent.id}`
                }
            });

            if (aEvent.id) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.id`, {
                    type: 'state',
                    common: {
                        name: 'Event ID',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.id`, {val: aEvent.id, ack: true});
            }

            if (aEvent.message) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.message`, {
                    type: 'state',
                    common: {
                        name: 'Message',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.message`, {val: aEvent.message, ack: true});
            }

            if (aEvent.type) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.type`, {
                    type: 'state',
                    common: {
                        name: 'Type',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.type`, {val: aEvent.type, ack: true});
            }

            if (aEvent.category) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.category`, {
                    type: 'state',
                    common: {
                        name: 'Category',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.category`, {val: aEvent.category, ack: true});
            }

            if (aEvent.time) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.time`, {
                    type: 'state',
                    common: {
                        name: 'Time',
                        type: 'number',
                        role: 'value.date',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.time`, {
                    val: aEvent.time * 1000,
                    ack: true
                });
            }

            if (aEvent.person_id) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.person_id`, {
                    type: 'state',
                    common: {
                        name: 'Person ID',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.person_id`, {val: aEvent.person_id, ack: true});
            }

            if (aEvent.camera_id) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.camera_id`, {
                    type: 'state',
                    common: {
                        name: 'Camera ID',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${fullPath}.camera_id`, {val: aEvent.camera_id, ack: true});

                aCameraList.forEach(function (aCamera) {
                    if (aCamera.id === aEvent.camera_id)
                        camera = aCamera;
                });
            }

            if (aEvent.sub_type) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.sub_type`, {
                    type: 'state',
                    common: {
                        name: 'Sub Type',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.sub_type`, {val: aEvent.sub_type, ack: true});
            }

            if (aEvent.video_id) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.video_id`, {
                    type: 'state',
                    common: {
                        name: 'Video ID',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${fullPath}.video_id`, {val: aEvent.video_id, ack: true});

                if (camera) {
                    await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.video_url`, {
                        type: 'state',
                        common: {
                            name: 'Video URL',
                            type: 'string',
                            role: 'url',
                            read: true,
                            write: false
                        }
                    });

                    await adapter.setStateAsync(`${fullPath}.video_url`, {
                        val: `${camera.vpn_url}/vod/${aEvent.video_id}${camera.is_local ? '/index_local.m3u8' : '/index.m3u8'}`,
                        ack: true
                    });

                }
            }

            if (aEvent.video_status) {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.video_status`, {
                    type: 'state',
                    common: {
                        name: 'Video Status',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(`${fullPath}.video_status`, {val: aEvent.video_status, ack: true});
            }

            if (aEvent.is_arrival !== undefined && aEvent.is_arrival !== '') {
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.is_arrival`, {
                    type: 'state',
                    common: {
                        name: 'Is Arrival',
                        type: 'boolean',
                        role: 'indicator',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${fullPath}.is_arrival`, {val: aEvent.is_arrival, ack: true});
            }

            if (aEvent.snapshot) {
                await handleSnapshot(aEvent.snapshot, fullPath);
            }

            if (aEvent.vignette) {
                await handleVignette(aEvent.vignette, fullPath);
            }

            //add event history for Presence with subevent tree
            if (aEvent.type === 'outdoor') {
                let counter = 0;
                await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.eventcount`, {
                    type: 'state',
                    common: {
                        name: 'eventcount',
                        type: 'number',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });
                if (aEvent.event_list) {
                    for (const aEventList of aEvent.event_list) {
                        EventList = aEventList;
                        counter++;
                        await adapter.setStateAsync(`${fullPath}.Presence.eventcount`, {val: counter, ack: true});

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.message`, {
                            type: 'state',
                            common: {
                                name: 'Type',
                                type: 'string',
                                role: 'state',
                                read: true,
                                write: false
                            }
                        });
                        await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.message`, {
                            val: EventList.message,
                            ack: true
                        });

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.type`, {
                            type: 'state',
                            common: {
                                name: 'Type',
                                type: 'number',
                                role: 'state',
                                read: true,
                                write: false
                            }
                        });

                        if (EventList.type === 'human') {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.type`, {
                                val: 1,
                                ack: true
                            });
                        } else if (EventList.type === 'animal') {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.type`, {
                                val: 2,
                                ack: true
                            });
                        } else if (EventList.type === 'vehicle') {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.type`, {
                                val: 3,
                                ack: true
                            });
                        } else  {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.type`, {
                                val: null,
                                ack: true
                            });
                        }

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.typename`, {
                            type: 'state',
                            common: {
                                name: 'Type',
                                type: 'string',
                                role: 'state',
                                read: true,
                                write: false
                            }
                        });
                        await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.typename`, {
                            val: EventList.type,
                            ack: true
                        });

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.time`, {
                            type: 'state',
                            common: {
                                name: 'Time',
                                type: 'number',
                                role: 'value.date',
                                read: true,
                                write: false
                            }
                        });
                        await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.time`, {
                            val: aEvent.time * 1000,
                            ack: true
                        });

                        // val: (new Date(aEvent.time * 1000)),

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.snapshoturl`, {
                            type: 'state',
                            common: {
                                name: 'Type',
                                type: 'string',
                                role: 'url',
                                read: true,
                                write: false
                            }
                        });

                        await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.vignetteurl`, {
                            type: 'state',
                            common: {
                                name: 'Type',
                                type: 'string',
                                role: 'state',
                                read: true,
                                write: false
                            }
                        });

                        if (EventList.snapshot.url) {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.snapshoturl`, {
                                val: EventList.snapshot.url,
                                ack: true
                            });
                        }
                        if (EventList.vignette.url) {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.vignetteurl`, {
                                val: EventList.vignette.url,
                                ack: true
                            });
                        }
                        if (EventList.snapshot.filename) {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.snapshoturl`, {
                                val: `${camera_vpn}/${EventList.snapshot.filename}`,
                                ack: true
                            });
                        }
                        if (EventList.vignette.filename) {
                            await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.vignetteurl`, {
                                val: `${camera_vpn}/${EventList.vignette.filename}`,
                                ack: true
                            });
                        }
                    }
                }
            }
        }
    }

    async function handleVignette(aVignette, aParent) {
        const fullPath = aParent;

        if (aVignette.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.vignette_id`, {
                type: 'state',
                common: {
                    name: 'Vignette ID',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.vignette_id`, {val: aVignette.id, ack: true});
        }


        if (aVignette.key) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.vignette_key`, {
                type: 'state',
                common: {
                    name: 'Vignette Key',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.vignette_key`, {val: aVignette.key, ack: true});
        }

        if (aVignette.id && aVignette.key) {
            const imageUrl = `https://api.netatmo.com/api/getcamerapicture?image_id=${aVignette.id}&key=${aVignette.key}`;

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.vignette_url`, {
                type: 'state',
                common: {
                    name: 'Vignette Url',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.vignette_url`, {
                val: imageUrl,
                ack: true
            });
        }

        if (aVignette.version) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.vignette_version`, {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.vignette_version`, {val: aVignette.version, ack: true});
        }
    }

    async function handleSnapshot(aSnapshot, aParent) {
        const fullPath = aParent;

        if (aSnapshot.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.snapshot_id`, {
                type: 'state',
                common: {
                    name: 'Snapshot ID',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.snapshot_id`, {val: aSnapshot.id, ack: true});
        }


        if (aSnapshot.key) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.snapshot_key`, {
                type: 'state',
                common: {
                    name: 'Snapshot Key',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.snapshot_key`, {val: aSnapshot.key, ack: true});
        }

        if (aSnapshot.id && aSnapshot.key) {
            const imageUrl = `https://api.netatmo.com/api/getcamerapicture?image_id=${aSnapshot.id}&key=${aSnapshot.key}`;

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.snapshot_url`, {
                type: 'state',
                common: {
                    name: 'Snapshot Url',
                    type: 'string',
                    role: 'url',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${fullPath}.snapshot_url`, {
                val: imageUrl,
                ack: true
            });
        }

        if (aSnapshot.version) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.snapshot_version`, {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.snapshot_version`, {val: aSnapshot.version, ack: true});
        }
    }

    function cleanUpEvents(home) {
        adapter.getForeignObjects(`netatmo.${adapter.instance}.${home}.Events.*`, 'channel', async (errEvents, objEvents) => {
            if (errEvents) {
                adapter.log.error(errEvents);
            } else if (objEvents) {
                const cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;

                adapter.log.debug(`Cleanup: Found ${Object.keys(objEvents).length} events to cleanup`);
                for (const aEventId in objEvents) {
                    //adapter.getForeignObject(aEventId + '.time', 'state', function (errTime, objTime) {
                    try {
                        const stateTime = await adapter.getStateAsync(`${aEventId}.time`);
                        if (stateTime) {
                            let eventDate;

                            try {
                                eventDate = stateTime.val;
                            } catch(e) {
                                eventDate = null;
                            }

                            adapter.log.debug(`Cleanup Events: Check time for ${aEventId}: (${stateTime.val}) ${cleanupDate} > ${eventDate}`);
                            if ((cleanupDate > eventDate) || eventDate == null) {
                                adapter.log.info(`Event ${aEventId} expired, so cleanup`);
                                try {
                                    await adapter.delObjectAsync(aEventId, {recursive: true});
                                } catch (err) {
                                    adapter.log.warn(`Could not delete object ${aEventId} during cleanup. Please remove yourself.`);
                                }
                            }
                        }
                    } catch (err) {
                        adapter.log.error(`Could not read time for ${aEventId} during cleanup. Please remove yourself.`);
                    }
                }
            }
        });
    }

    function cleanUpUnknownPersons(home) {
        adapter.getForeignObjects(`${adapter.namespace}.${home}.Persons.Unknown.*`, 'channel', (errPerson, objPerson) => {
            if (errPerson) {
                adapter.log.error(errPerson);
            } else if (objPerson) {
                const cleanupDate = new Date().getTime() - UnknownPersonTime * 60 * 60 * 1000;

                for (const aPersonId in objPerson) {
                    adapter.getState(`${aPersonId}.last_seen`, async (errTime, stateTime) => {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (stateTime) {
                            const personDate = new Date(stateTime.val).getTime();
                            adapter.log.debug(`Cleanup Persons: Check time for ${aPersonId}: (${stateTime.val}) ${cleanupDate} > ${personDate}`);
                            if (cleanupDate > personDate) {
                                adapter.log.info(`Person ${aPersonId} expired, so cleanup`);
                                try {
                                    await adapter.delObjectAsync(aPersonId, {recursive: true});
                                } catch (err) {
                                    adapter.log.warn(`Could not delete object ${aPersonId} during cleanup. Please remove yourself.`);
                                }
                            }
                        }
                    });
                }
            }
        });
    }
}
