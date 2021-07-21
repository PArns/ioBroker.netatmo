module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval ? adapter.config.cleanup_interval : 5;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;
    const UnknownPersonTime = adapter.config.unknown_person_time ? adapter.config.unknown_person_time : 24;

    const eventCleanUpTimer = {};
    const personCleanUpTimer = {};

    let knownPeople = [];
    let homeIds = [];

    let socket = null;
    let that = null;

    const socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

    this.init = function () {
        that = this;
        socket = require('socket.io-client')(socketServerUrl);

        if (socket) {
            adapter.log.info(`Registering realtime events with ${socketServerUrl}`);
            socket.on('alert', async data => await onSocketAlert(data));
            api.addWebHook(socketServerUrl);
        }
    };

    this.finalize = function () {
        if (socket) {
            adapter.log.info('Unregistering realtime events');
            socket.disconnect();
            api.dropWebHook();
        }
        Object.keys(eventCleanUpTimer).forEach(id => clearInterval(eventCleanUpTimer[id]));
        Object.keys(personCleanUpTimer).forEach(id => clearInterval(personCleanUpTimer[id]));
    };

    this.setAway = function (data) {
        if (data && data.homeId) {
            api.setPersonsAway(data.homeId, data.personsId, err =>
                err &&adapter.log.error(err));
        } else {
            homeIds.forEach(aHomeId =>
                api.setPersonsAway(aHomeId, data ? data.personsId : null, err =>
                    err && adapter.log.error(err)));
        }
    };

    this.requestUpdateIndoorCamera = function () {
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

                            personCleanUpTimer[homeName] = personCleanUpTimer[homeName] || setInterval(() =>
                                cleanUpUnknownPersons(homeName), cleanUpInterval * 60 * 1000);
                        }
                    }
                }
                resolve();
            });
        });
    };

    async function onSocketAlert(data) {
        adapter.log.debug(JSON.stringify(data));

        await that.requestUpdateIndoorCamera();

        const now = new Date().toISOString();

        if (data) {
            const path = data.home_name + '.LastEventData.';

            if (data.event_type === 'person') {
                data.persons.forEach(async person => {
                    let dataPath = '';

                    if (person.is_known) {
                        dataPath = 'LastKnownPersonSeen';
                    } else {
                        dataPath = 'LastUnknownPersonSeen';
                    }

                    await adapter.setStateAsync(path + dataPath, {val: now, ack: true});

                    // Set state first ...
                    if (person.is_known) {
                        knownPeople.forEach(async aPerson => {
                            if (aPerson.face && aPerson.face.id === person.face_id) {
                                await adapter.setStateAsync(path + 'LastKnownPersonName', {val: aPerson.pseudo, ack: true});
                            }
                        })
                    }
                });
            } else if (data.event_type === 'movement') {
                await adapter.setStateAsync(path + 'LastMovementDetected', {val: now, ack: true});

                if (data.type) {
                    await adapter.setStateAsync(path + 'LastMovementType', {val: data.type, ack: true});
                } else {
                    await adapter.setStateAsync(path + 'LastMovementType', {val: 'unknown', ack: true});
                }
            }

            //add events for Presence
            //type: 1 human; 2 animal; 3 vehicle
            else if (data.event_type === 'human') {
                await adapter.setStateAsync(path + 'Presence.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Presence.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Presence.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.type', { val: 1, ack: true });
                await adapter.setStateAsync(path + 'Presence.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Presence.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'animal') {
                await adapter.setStateAsync(path + 'Presence.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Presence.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Presence.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.type', { val: 2, ack: true });
                await adapter.setStateAsync(path + 'Presence.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Presence.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type === 'vehicle') {
                await adapter.setStateAsync(path + 'Presence.event', { val: true, ack: true });
                await adapter.setStateAsync(path + 'Presence.time', { val: now, ack: true });
                await adapter.setStateAsync(path + 'Presence.camera_id', { val: data.camera_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.type', { val: 3, ack: true });
                await adapter.setStateAsync(path + 'Presence.typename', { val: data.event_type, ack: true });
                await adapter.setStateAsync(path + 'Presence.message', { val: data.message, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.event_id', { val: data.event_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.subevent_id', { val: data.subevent_id, ack: true });
            }
            else if (data.event_type !== 'vehicle') {
                await adapter.setStateAsync(path + 'Presence.event', { val: false, ack: true });
                await adapter.setStateAsync(path + 'Presence.time', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.camera_id', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.type', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.typename', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.message', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_id', { val: data.snapshot_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_key', { val: data.snapshot_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.snapshot_url', { val: data.snapshot_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_id', { val: data.vignette_id, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_key', { val: data.vignette_key, ack: true });
                await adapter.setStateAsync(path + 'Presence.vignette_url', { val: data.vignette_url, ack: true });
                await adapter.setStateAsync(path + 'Presence.event_id', { val: null, ack: true });
                await adapter.setStateAsync(path + 'Presence.subevent_id', { val: null, ack: true });
            }

            await adapter.setStateAsync(path + 'LastEventId', {val: data.event_id, ack: true});
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
        if (socket) {
            socket.emit('registerHome', aHome.id);
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastMovementDetected', {
            type: 'state',
            common: {
                name: 'LastMovementDetected',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastKnownPersonSeen', {
            type: 'state',
            common: {
                name: 'LastKnownPersonSeen',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastMovementType', {
            type: 'state',
            common: {
                name: 'LastMovementType',
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastKnownPersonName', {
            type: 'state',
            common: {
                name: 'LastKnownPersonName',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.LastUnknownPersonSeen', {
            type: 'state',
            common: {
                name: 'LastUnknownPersonSeen',
                type: 'string',
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        // create sub-states for Presence
        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.event', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.time', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.camera_id', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.type', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.typename', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.message', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.snapshot_id', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.snapshot_key', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.snapshot_url', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.vignette_id', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.vignette_key', {
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


        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.vignette_url', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.event_id', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData.Presence.subevent_id', {
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

        await adapter.setObjectNotExistsAsync(homeName + '.LastEventData', {
            type: 'channel',
            common: {
                name: 'LastEventData',
            }
        });

        if (aHome.cameras) {
            aHome.cameras.forEach(async aCamera => {
                if (aCamera.id && aCamera.name) {
                    await adapter.setObjectNotExistsAsync(fullPath + '.' + aCamera.name, {
                        type: 'state',
                        common: {
                            name: aCamera.name,
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.' + aCamera.name, {val: aCamera.id, ack: true});
                }
            });
        }

        // Camera Objects anlegen
        if (aHome.cameras) {
            aHome.cameras.forEach(async aCamera =>
                await handleCamera(aCamera, aHome));
        }

        if (aHome.persons) {
            knownPeople = [];

            aHome.persons.forEach(async aPerson =>
                await handlePerson(aPerson, homeName));
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

    async function handleCamera(aCamera, aHome) {
        const aParent = getHomeName(aHome.name);
        const fullPath = aParent + '.' + aCamera.name;
        const infoPath = fullPath + '.info';
        const livePath = fullPath + '.live';

        await adapter.setObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aCamera.name,
                type: 'device',
                read: true,
                write: false
            },
            native: {
                id: aCamera.id,
                type: aCamera.type
            }
        });

        if (aCamera.id) {
            await adapter.setObjectNotExistsAsync(infoPath + '.id', {
                type: 'state',
                common: {
                    name: 'Camera ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(infoPath + '.id', {val: aCamera.id, ack: true});
        }

        if (aCamera.status) {
            await adapter.setObjectNotExistsAsync(infoPath + '.status', {
                type: 'state',
                common: {
                    name: 'Monitoring State (on/off)',
                    type: 'string',
                    read: true,
                    write: false
                },
                native: {
                    status: aCamera.status
                }
            });

            await adapter.setStateAsync(infoPath + '.status', {val: aCamera.status, ack: true});
        }

        if (aCamera.sd_status) {
            await adapter.setObjectNotExistsAsync(infoPath + '.sd_status', {
                type: 'state',
                common: {
                    name: 'SD card State (on/off)',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.sd_status', {val: aCamera.sd_status, ack: true});
        }

        if (aCamera.alim_status) {
            await adapter.setObjectNotExistsAsync(infoPath + '.alim_status', {
                type: 'state',
                common: {
                    name: 'Power Supply State (on/off)',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.alim_status', {val: aCamera.alim_status, ack: true});
        }

        if (aCamera.name) {
            await adapter.setObjectNotExistsAsync(infoPath + '.name', {
                type: 'state',
                common: {
                    name: 'Camera name',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(infoPath + '.name', {val: aCamera.name, ack: true});
        }

        if (aCamera.vpn_url) {
            await adapter.setObjectNotExistsAsync(livePath + '.picture', {
                type: 'state',
                common: {
                    name: 'Live camera picture URL',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setObjectNotExistsAsync(livePath + '.stream', {
                type: 'state',
                common: {
                    name: 'Live camera picture URL',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            camera_vpn = aCamera.vpn_url;

            await adapter.setStateAsync(livePath + '.picture', {val: aCamera.vpn_url + '/live/snapshot_720.jpg', ack: true});
            await adapter.setStateAsync(livePath + '.stream', {
                val: aCamera.vpn_url + (aCamera.is_local ? '/live/index_local.m3u8' : '/live/index.m3u8'),
                ack: true
            });
        }

        // Initialize Camera Place
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

    function getPersonName(aPersonName) {
        return aPersonName.replaceAll(' ', '-').replaceAll('---', '-').replaceAll('--', '-').replaceAll('ß', 'ss');
    }

    async function handlePerson(aPerson, aParent) {
        let aPersonName;
        let bKnown = true;
        let cleanupDate = new Date().getTime();
        if (aPerson.pseudo) {
            aPersonName = getPersonName(aPerson.pseudo);
        } else {
            aPersonName = aPerson.id;
            bKnown = false;
            cleanupDate -= UnknownPersonTime * 60 * 60 * 1000;
        }

        const personDate = aPerson.last_seen ? aPerson.last_seen * 1000 : cleanupDate;

        if (bKnown || cleanupDate < personDate) {
            let fullPath = aParent + '.Persons';

            await adapter.setObjectNotExistsAsync(fullPath, {
                type: 'channel',
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


            if (fullPath) {
                await adapter.setObjectNotExistsAsync(fullPath, {
                    type: 'channel',
                    common: {
                        name: fullPath,
                    }
                });
            }

            fullPath += '.' + aPersonName;

            if (aPersonName) {
                await adapter.setObjectNotExistsAsync(fullPath, {
                    type: 'channel',
                    common: {
                        name: fullPath,
                    }
                });
            }

            if (aPerson.id) {
                await adapter.setObjectNotExistsAsync(fullPath + '.id', {
                    type: 'state',
                    common: {
                        name: 'Person ID',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.id', {val: aPerson.id, ack: true});
            }

            if (aPerson.out_of_sight !== 'undefined') {
                await adapter.setObjectNotExistsAsync(fullPath + '.out_of_sight', {
                    type: 'state',
                    common: {
                        name: 'Person out of sight (true/false)',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.out_of_sight', {val: aPerson.out_of_sight, ack: true});

                await adapter.setObjectNotExistsAsync(fullPath + '.atHome', {
                    type: 'state',
                    common: {
                        name: 'Person at home (true/false)',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.atHome', {val: !aPerson.out_of_sight, ack: true});
            }

            if (aPerson.last_seen) {
                await adapter.setObjectNotExistsAsync(fullPath + '.last_seen', {
                    type: 'state',
                    common: {
                        name: 'Last seen',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(fullPath + '.last_seen', {
                    val: (new Date(aPerson.last_seen * 1000)),
                    ack: true
                });
            }

            if (aPerson.face !== 'undefined') {
                await handleFace(aPerson.face, fullPath);
            }

        }
    }

    async function handleFace(aFace, aParent) {
        const fullPath = aParent;

        if (aFace.id) {
            await adapter.setObjectNotExistsAsync(fullPath + '.face_id', {
                type: 'state',
                common: {
                    name: 'Face ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.face_id', {val: aFace.id, ack: true});
        }

        if (aFace.key) {
            await adapter.setObjectNotExistsAsync(fullPath + '.face_key', {
                type: 'state',
                common: {
                    name: 'Face Key',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.face_key', {val: aFace.key, ack: true});
        }

        if (aFace.id && aFace.key) {
            const imageUrl = 'https://api.netatmo.com/api/getcamerapicture?image_id=' + aFace.id + '&key=' + aFace.key;

            await adapter.setObjectNotExistsAsync(fullPath + '.face_url', {
                type: 'state',
                common: {
                    name: 'Face Url',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.face_url', {
                val: imageUrl,
                ack: true
            });
        }

        if (aFace.version) {
            await adapter.setObjectNotExistsAsync(fullPath + '.face_version', {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.face_version', {val: aFace.version, ack: true});
        }
    }

    async function handleEvent(aEvent, aParent, aCameraList) {
        const cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;
        const eventDate = aEvent.time ? aEvent.time * 1000 : cleanupDate;

        if (cleanupDate < eventDate) {
            let fullPath = aParent + '.Events';
            let camera = null;

            await adapter.setObjectNotExistsAsync(fullPath, {
                type: 'channel',
                common: {
                    name: 'Events',
                }
            });

            fullPath += '.' + aEvent.id;

            if (fullPath) {
                await adapter.setObjectNotExistsAsync(fullPath, {
                    type: 'channel',
                    common: {
                        name: aEvent.id,
                    },
                    native: {
                        id: 'Events.' + aEvent.id
                    }
                });
            }

            if (aEvent.id) {
                await adapter.setObjectNotExistsAsync(fullPath + '.id', {
                    type: 'state',
                    common: {
                        name: 'Event ID',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.id', {val: aEvent.id, ack: true});
            }

            if (aEvent.message) {
                await adapter.setObjectNotExistsAsync(fullPath + '.message', {
                    type: 'state',
                    common: {
                        name: 'Message',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.message', {val: aEvent.message, ack: true});
            }

            if (aEvent.type) {
                await adapter.setObjectNotExistsAsync(fullPath + '.type', {
                    type: 'state',
                    common: {
                        name: 'Type',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.type', {val: aEvent.type, ack: true});
            }

            if (aEvent.category) {
                await adapter.setObjectNotExistsAsync(fullPath + '.category', {
                    type: 'state',
                    common: {
                        name: 'Category',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.category', {val: aEvent.category, ack: true});
            }

            if (aEvent.time) {
                await adapter.setObjectNotExistsAsync(fullPath + '.time', {
                    type: 'state',
                    common: {
                        name: 'Time',
                        type: 'date',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.time', {
                    val: (new Date(aEvent.time * 1000)),
                    ack: true
                });
            }

            if (aEvent.person_id) {
                await adapter.setObjectNotExistsAsync(fullPath + '.person_id', {
                    type: 'state',
                    common: {
                        name: 'Person ID',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.person_id', {val: aEvent.person_id, ack: true});
            }

            if (aEvent.camera_id) {
                await adapter.setObjectNotExistsAsync(fullPath + '.camera_id', {
                    type: 'state',
                    common: {
                        name: 'Camera ID',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(fullPath + '.camera_id', {val: aEvent.camera_id, ack: true});

                aCameraList.forEach(function (aCamera) {
                    if (aCamera.id === aEvent.camera_id)
                        camera = aCamera;
                });
            }

            if (aEvent.sub_type) {
                await adapter.setObjectNotExistsAsync(fullPath + '.sub_type', {
                    type: 'state',
                    common: {
                        name: 'Sub Type',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.sub_type', {val: aEvent.sub_type, ack: true});
            }

            if (aEvent.video_id) {
                await adapter.setObjectNotExistsAsync(fullPath + '.video_id', {
                    type: 'state',
                    common: {
                        name: 'Video ID',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(fullPath + '.video_id', {val: aEvent.video_id, ack: true});

                if (camera) {
                    await adapter.setObjectNotExistsAsync(fullPath + '.video_url', {
                        type: 'state',
                        common: {
                            name: 'Video URL',
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });

                    await adapter.setStateAsync(fullPath + '.video_url', {
                        val: camera.vpn_url + '/vod/' + aEvent.video_id + (camera.is_local ? '/index_local.m3u8' : '/index.m3u8'),
                        ack: true
                    });

                }
            }

            if (aEvent.video_status) {
                await adapter.setObjectNotExistsAsync(fullPath + '.video_status', {
                    type: 'state',
                    common: {
                        name: 'Video Status',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });
                await adapter.setStateAsync(fullPath + '.video_status', {val: aEvent.video_status, ack: true});
            }

            if (aEvent.is_arrival !== 'undefined' && aEvent.is_arrival !== '') {
                await adapter.setObjectNotExistsAsync(fullPath + '.is_arrival', {
                    type: 'state',
                    common: {
                        name: 'Is Arrival',
                        type: 'string',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(fullPath + '.is_arrival', {val: aEvent.is_arrival, ack: true});
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
                await adapter.setObjectNotExistsAsync(fullPath + '.Presence.eventcount', {
                    type: 'state',
                    common: {
                        name: 'eventcount',
                        type: 'number',
                        read: true,
                        write: false
                    }
                });
                aEvent.event_list.forEach(async aEventList => {
                    EventList = aEventList;
                    counter++;
                    await adapter.setStateAsync(`${fullPath}.Presence.eventcount`, { val: counter, ack: true });

                    await adapter.setObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.message`, {
                        type: 'state',
                        common: {
                            name: 'Type',
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(`${fullPath}.Presence.event-${counter}.message`, { val: EventList.message, ack: true });

                    await adapter.setObjectNotExistsAsync(`${fullPath}.Presence.event-${counter}.type`, {
                        type: 'state',
                        common: {
                            name: 'Type',
                            type: 'number',
                            read: true,
                            write: false
                        }
                    });

                    if (EventList.type === 'human') {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.type', { val: 1, ack: true });
                    }
                    else if (EventList.type === 'animal') {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.type', { val: 2, ack: true });
                    }
                    else if (EventList.type === 'vehicle') {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.type', { val: 3, ack: true });
                    }

                    await adapter.setObjectNotExistsAsync(fullPath + '.Presence.event-' + counter + '.typename', {
                        type: 'state',
                        common: {
                            name: 'Type',
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.typename', { val: EventList.type, ack: true });

                    await adapter.setObjectNotExistsAsync(fullPath + '.Presence.event-' + counter + '.time', {
                        type: 'state',
                        common: {
                            name: 'Time',
                            type: 'date',
                            read: true,
                            write: false
                        }
                    });
                    await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.time', { val: (new Date(aEvent.time * 1000)), ack: true });

                    // val: (new Date(aEvent.time * 1000)),

                    await adapter.setObjectNotExistsAsync(fullPath + '.Presence.event-' + counter + '.snapshoturl', {
                        type: 'state',
                        common: {
                            name: 'Type',
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });

                    await adapter.setObjectNotExistsAsync(fullPath + '.Presence.event-' + counter + '.vignetteurl', {
                        type: 'state',
                        common: {
                            name: 'Type',
                            type: 'string',
                            read: true,
                            write: false
                        }
                    });

                    if (EventList.snapshot.url) {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.snapshoturl', { val: EventList.snapshot.url, ack: true });
                    }
                    if (EventList.vignette.url) {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.vignetteurl', { val: EventList.vignette.url, ack: true });
                    }
                    if (EventList.snapshot.filename) {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.snapshoturl', { val: camera_vpn + '/' + EventList.snapshot.filename, ack: true });
                    }
                    if (EventList.vignette.filename) {
                        await adapter.setStateAsync(fullPath + '.Presence.event-' + counter + '.vignetteurl', { val: camera_vpn + '/' + EventList.vignette.filename, ack: true });
                    }
                });
            }
        }
    }

    async function handleVignette(aVignette, aParent) {
        const fullPath = aParent;

        if (aVignette.id) {
            await adapter.setObjectNotExistsAsync(fullPath + '.vignette_id', {
                type: 'state',
                common: {
                    name: 'Vignette ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.vignette_id', {val: aVignette.id, ack: true});
        }


        if (aVignette.key) {
            await adapter.setObjectNotExistsAsync(fullPath + '.vignette_key', {
                type: 'state',
                common: {
                    name: 'Vignette Key',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.vignette_key', {val: aVignette.key, ack: true});
        }

        if (aVignette.id && aVignette.key) {
            const imageUrl = 'https://api.netatmo.com/api/getcamerapicture?image_id=' + aVignette.id + '&key=' + aVignette.key;

            await adapter.setObjectNotExistsAsync(fullPath + '.vignette_url', {
                type: 'state',
                common: {
                    name: 'Vignette Url',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.vignette_url', {
                val: imageUrl,
                ack: true
            });
        }

        if (aVignette.version) {
            await adapter.setObjectNotExistsAsync(fullPath + '.vignette_version', {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.vignette_version', {val: aVignette.version, ack: true});
        }
    }

    async function handleSnapshot(aSnapshot, aParent) {
        const fullPath = aParent;

        if (aSnapshot.id) {
            await adapter.setObjectNotExistsAsync(fullPath + '.snapshot_id', {
                type: 'state',
                common: {
                    name: 'Snapshot ID',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.snapshot_id', {val: aSnapshot.id, ack: true});
        }


        if (aSnapshot.key) {
            await adapter.setObjectNotExistsAsync(fullPath + '.snapshot_key', {
                type: 'state',
                common: {
                    name: 'Snapshot Key',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.snapshot_key', {val: aSnapshot.key, ack: true});
        }

        if (aSnapshot.id && aSnapshot.key) {
            const imageUrl = 'https://api.netatmo.com/api/getcamerapicture?image_id=' + aSnapshot.id + '&key=' + aSnapshot.key;

            await adapter.setObjectNotExistsAsync(fullPath + '.snapshot_url', {
                type: 'state',
                common: {
                    name: 'Snapshot Url',
                    type: 'string',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(fullPath + '.snapshot_url', {
                val: imageUrl,
                ack: true
            });
        }

        if (aSnapshot.version) {
            await adapter.setObjectNotExistsAsync(fullPath + '.snapshot_version', {
                type: 'state',
                common: {
                    name: 'Version',
                    type: 'string',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(fullPath + '.snapshot_version', {val: aSnapshot.version, ack: true});
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

    function cleanUpUnknownPersons(home) {
        adapter.getForeignObjects(`netatmo.${adapter.instance}.${home}.Persons.Unknown.*`, 'channel', (errPerson, objPerson) => {
            if (errPerson) {
                adapter.log.error(errPerson);
            } else if (objPerson) {
                const cleanupDate = new Date().getTime() - UnknownPersonTime * 60 * 60 * 1000;

                for (const aPersonId in objPerson) {
                    adapter.getForeignStates(aPersonId + '.last_seen', (errTime, objTime) => {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (objTime) {
                            for (const aTimeId in objTime) {

                                const personDate = Date.parse(objTime[aTimeId].val);
                                if (cleanupDate > personDate) {
                                    const parentId = aTimeId.substring(0, aTimeId.length - 10);

                                    adapter.getForeignObjects(parentId + '.*', 'state', async (errState, objState) => {
                                        if (errState) {
                                            adapter.log.error(errState);
                                        } else {
                                            for (const aStateId in objState) {
                                                adapter.log.debug(`State ${aStateId} abgelaufen daher löschen!`);
                                                await adapter.delObject(aStateId);
                                            }
                                        }
                                    });

                                    adapter.log.info(`Person ${parentId} abgelaufen daher löschen!`);
                                    adapter.delObject(parentId);
                                }
                            }
                        }
                    });
                }
            }
        });
    }
}