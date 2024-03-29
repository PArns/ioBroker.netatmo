module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;
    const cleanUpInterval = adapter.config.cleanup_interval;
    const EventTime = adapter.config.event_time ? adapter.config.event_time : 12;

    const eventCleanUpTimer = {};

    let homeIds = [];
    let moduleIds = [];

    let finalized = false;

    let that = null;

    const EventEmitterBridge = require('./eventEmitterBridge.js')
    let eeB = null;

    const CODetectorEvents = ['sound_test', 'battery_status', 'wifi_status', 'tampered', 'co_detected'];
    const CODetectorSubtypes = {
        0: 'OK',
        1: 'Pre-alarm',
        2: 'Alarm'
    };
    const WifiSubtypes = {
        0: 'Failed',
        1: 'OK'
    };
    const BatterySubtypes = {
        0: 'LOW',
        1: 'Very LOW'
    };
    const SoundSubtypes = {
        0: 'OK',
        1: 'Failed'
    };
    const TamperedSubtypes = {
        0: 'OK',
        1: 'Failed'
    };

    this.init = function () {
        that = this;

        eeB = new EventEmitterBridge(api, adapter)
        adapter.log.info(`CO-Sensor: Registering realtime events with iot instance`);
        eeB.on('alert', async data => await onSocketAlert(data));
    };

    this.finalize = function () {
        finalized = true;
        if (eeB) {
            adapter.log.info('CO-Sensor: Unregistering realtime events');
            eeB.destructor();
            eeB = null;
        }
        Object.keys(eventCleanUpTimer).forEach(id => clearInterval(eventCleanUpTimer[id]));
    };


    this.requestUpdateCOSensor = function () {
        return new Promise(resolve => {
            api.homedataExtended({
                gateway_types: 'NCO'
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
                            if (!aHome.modules) continue;
                            adapter.log.debug(`Get CO Sensor for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);

                            //const homeId = aHome.id.replace(/:/g, '-'); // formatName(aHome.name);
                            //eventCleanUpTimer[homeId] = eventCleanUpTimer[homeId] || setInterval(() =>
                            //    cleanUpEvents(homeId), cleanUpInterval * 60 * 1000);
                        }
                    }
                }
                resolve();
            });
        });
    };

    async function onSocketAlert(data) {
        if (!data || (data.device_id && !moduleIds.includes(data.device_id)) || data.event_type === undefined) {
            adapter.log.debug(`new alarm (carbon) IGNORE ${JSON.stringify(data)}`);
            return;
        }
        adapter.log.debug(`new alarm (carbon) ${JSON.stringify(data)}`);

        const now = new Date().toString();

        if (data) {
            const path = `${data.home_id.replace(/:/g, '-')}.LastEventData.`; // formatName(data.home_name) + '.LastEventData.';
            const devicePath = `${data.home_id.replace(/:/g, '-')}.${data.device_id.replace(/:/g, '-')}.`;
            if (CODetectorEvents.includes(data.event_type)) {
                await adapter.setStateAsync(`${path}LastPushType`, {val: data.push_type, ack: true});
                await adapter.setStateAsync(`${path}LastEventType`, {val: data.event_type, ack: true});
                await adapter.setStateAsync(`${path}LastEventDeviceId`, {val: data.device_id, ack: true});
                await adapter.setStateAsync(`${path}LastEventId`, {val: data.event_id, ack: true});
                await adapter.setStateAsync(`${path}LastEvent`, {val: now, ack: true});

                await adapter.setStateAsync(`${devicePath}${data.event_type}.LastEvent`, {
                    val: now,
                    ack: true
                });
                await adapter.setStateAsync(`${devicePath}${data.event_type}.LastEventId`, {
                    val: data.event_id,
                    ack: true
                });

		        if (data.event_type === 'co_detected') {
                    await adapter.setStateAsync(`${devicePath}${data.event_type}.SubType`, {
                        val: CODetectorSubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === 'wifi_status') {
                    await adapter.setStateAsync(`${devicePath}${data.event_type}.SubType`, {
                        val: WifiSubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === 'sound_test') {
                    await adapter.setStateAsync(`${devicePath}${data.event_type}.SubType`, {
                        val: SoundSubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === 'tampered') {
                    await adapter.setStateAsync(`${devicePath}${data.event_type}.SubType`, {
                        val: TamperedSubtypes[data.sub_type],
                        ack: true
                    });
                } else
                if (data.event_type === "battery_status") {
                    await adapter.setStateAsync(`${devicePath}${data.event_type}.SubType`, {
                        val: BatterySubtypes[data.sub_type],
                        ack: true
                    });
                }

                let active = false
                if (data.sub_type > 0) {
                    active = true
                }
                await adapter.setStateAsync(`${devicePath}${data.event_type}.active`, {
                    val: active,
                    ack: true
                });
            } else {
                await that.requestUpdateCOSensor();
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
                id: aHome.id,
            },
        });

        await adapter.extendOrSetObjectNotExistsAsync(`${homeId}.LastEventData`, {
            type: 'channel',
            common: {
                name: 'LastEventData',
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

        // adapter.log.debug(JSON.stringify(aHome))

        if (aHome.modules) {
            for (const aCODetector of aHome.modules) {
                if (aCODetector.id) {
                    moduleIds.push(aCODetector.id);
                    await handleCODetector(aCODetector, aHome);
                }
            }
        }
    }

    async function handleCODetector(aCODetector, aHome) {
        const aParent = aHome.id.replace(/:/g, '-'); // formatName(aHome.name);
        const aParentRooms = aHome.rooms;
        const fullPath = `${aParent}.${aCODetector.id.replace(/:/g, '-')}`;
        const infoPath = `${fullPath}.info`;

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aCODetector.name || aCODetector.id,
            },
            native: {
                id: aCODetector.id,
                type: aCODetector.type
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(infoPath, {
            type: 'channel',
            common: {
                name: `${aCODetector.name || aCODetector.id} Info`,
            },
            native: {
            }
        });

        if (aCODetector.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.id`, {
                type: 'state',
                common: {
                    name: 'CODetector ID',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${infoPath}.id`, {val: aCODetector.id, ack: true});
        }


        if (aCODetector.setup_date) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.setup_date`, {
                type: 'state',
                common: {
                    name: 'CODetector setup date',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.setup_date`, {
                val: new Date(aCODetector.setup_date * 1000).toString(),
                ack: true
            });
        }

        if (aCODetector.name) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.name`, {
                type: 'state',
                common: {
                    name: 'CODetector name',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.name`, {val: aCODetector.name, ack: true});
        }

        if (aCODetector.room_id) {
            const roomName = aParentRooms.find((r) => r.id === aCODetector.room_id)
            if (roomName) {
                await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.room`, {
                    type: 'state',
                    common: {
                        name: 'CODetector Room',
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${infoPath}.room`, {val: roomName.name, ack: true});
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
                    role: 'state',
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
                    role: 'value.date',
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
                    role: 'state',
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
                    role: 'state',
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
    function cleanUpEvents(home) {
        adapter.getForeignObjects(`netatmo.${adapter.instance}.${home}.Events.*`, 'channel', (errEvents, objEvents) => {
            if (errEvents) {
                adapter.log.error(errEvents);
            } else if (objEvents) {
                const cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;

                for (const aEventId in objEvents) {
                    //adapter.getForeignObject(aEventId + '.time', 'state', function (errTime, objTime) {
                    adapter.getState(`${aEventId}.time`, async (errTime, stateTime) => {
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
    */
}
