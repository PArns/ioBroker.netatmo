module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;

    let homeIds = [];
    let moduleIds = [];

    let updateTimer = null;
    let finalized = false;

    let that = null;

    this.init = function () {
        that = this;
    };

    this.finalize = function () {
        finalized = true;
        if (updateTimer) {
            clearTimeout(updateTimer);
            updateTimer = null;
        }
    };

    this.situativeUpdate = function (homeId, moduleId) {
        if (finalized) return;
        if (homeIds.includes(homeId) && moduleIds.includes(moduleId)) {
            updateTimer && clearTimeout(updateTimer);
            updateTimer = setTimeout(async () => {
                await that.requestUpdateBubendorff(true);
                updateTimer && clearTimeout(updateTimer);
                updateTimer = setTimeout(async () => {
                    updateTimer && clearTimeout(updateTimer);
                    updateTimer = null;
                    await that.requestUpdateBubendorff(true);
                }, 15000);
            }, 2000);
        }
    }

    this.requestUpdateBubendorff = function (ignoreTimer) {
        return new Promise(resolve => {
            if (updateTimer && !ignoreTimer) {
                adapter.log.debug('Update already scheduled');
                resolve();
                return;
            }

            api.homedataExtended({
                gateway_types: 'NBG'
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
                            adapter.log.debug(`Get Shutter for Home ${h}: ${JSON.stringify(aHome)}`);

                            await handleHome(aHome);
                        }
                    }
                }
                resolve();
            });
        });
    };

    /*
    function formatName(aHomeName) {
        return aHomeName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }
    */

    async function handleHome(aHome) {
        const homeId = aHome.id.replace(/:/g, '-'); //formatName(aHome.name);

        homeIds.push(aHome.id);

        await adapter.extendOrSetObjectNotExistsAsync(homeId, {
            type: 'folder',
            common: {
                name: aHome.name || aHome.id,
            },
            native: {
                id: aHome.id,
            },
        });

        if (aHome.modules) {
            for (const aRollerShutter of aHome.modules) {
                if (aRollerShutter.id) {
                    moduleIds.push(aRollerShutter.id);
                    await handleRollerShutter(aRollerShutter, aHome);
                }
            }
        }
    }

    async function handleRollerShutter(aRollerShutter, aHome) {
        const aParent = aHome.id.replace(/:/g, '-'); // formatName(aHome.name);
        const aParentRooms = aHome.rooms;
        const fullPath = `${aParent}.${aRollerShutter.id.replace(/:/g, '-')}`;
        const infoPath = `${fullPath}.info`;

        await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
            type: 'device',
            common: {
                name: aRollerShutter.name || aRollerShutter.id,
            },
            native: {
                id: aRollerShutter.id,
                type: aRollerShutter.type,
                bridge: aRollerShutter.bridge,
            }
        });

        await adapter.extendOrSetObjectNotExistsAsync(infoPath, {
            type: 'channel',
            common: {
                name: `${aRollerShutter.name || aRollerShutter.id} Info`,
            },
            native: {
            }
        });

        if (aRollerShutter.id) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.id`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} ID`,
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${infoPath}.id`, {val: aRollerShutter.id, ack: true});
        }

        if (aRollerShutter.setup_date) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.setup_date`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Setup date`,
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.setup_date`, {
                val: new Date(aRollerShutter.setup_date * 1000).toString(),
                ack: true
            });
        }

        if (aRollerShutter.name) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.name`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Name`,
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.name`, {val: aRollerShutter.name, ack: true});
        }

        if (aRollerShutter.wifi_strength) {
            await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.wifi_strength`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Wifi Strength`,
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${infoPath}.wifi_strength`, {val: aRollerShutter.wifi_strength, ack: true});
        }

        await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.isBridge`, {
            type: 'state',
            common: {
                name: `${aRollerShutter.name || aRollerShutter.id} Is Bridge?`,
                type: 'boolean',
                role: 'state',
                read: true,
                write: false
            }
        });

        await adapter.setStateAsync(`${infoPath}.isBridge`, {val: !!aRollerShutter.modules_bridged, ack: true});

        if (aRollerShutter.room_id) {
            const roomName = aParentRooms.find((r) => r.id === aRollerShutter.room_id)
            if (roomName) {
                await adapter.extendOrSetObjectNotExistsAsync(`${infoPath}.room`, {
                    type: 'state',
                    common: {
                        name: `${aRollerShutter.name || aRollerShutter.id} Room`,
                        type: 'string',
                        role: 'state',
                        read: true,
                        write: false
                    }
                });

                await adapter.setStateAsync(`${infoPath}.room`, {val: roomName.name, ack: true});
            }
        }

        if (!aRollerShutter.modules_bridged) {
            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.currentPosition`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Current Position`,
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });
            await adapter.setStateAsync(`${fullPath}.currentPosition`, {val: aRollerShutter.current_position, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.targetPosition`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Target Position`,
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: true,
                    min: -2,
                    max: 100,
                    step: aRollerShutter['target_position:step']
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aRollerShutter.id,
                    bridgeId: aRollerShutter.bridge,
                    field: 'target_position'
                }
            });
            await adapter.setStateAsync(`${fullPath}.targetPosition`, {val: aRollerShutter.target_position, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.open`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Open`,
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aRollerShutter.id,
                    bridgeId: aRollerShutter.bridge,
                    field: 'target_position',
                    setValue: 100
                }
            });
            await adapter.setStateAsync(`${fullPath}.open`, {val: false, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.close`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Close`,
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aRollerShutter.id,
                    bridgeId: aRollerShutter.bridge,
                    field: 'target_position',
                    setValue: 0
                }
            });
            await adapter.setStateAsync(`${fullPath}.close`, {val: false, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${fullPath}.stop`, {
                type: 'state',
                common: {
                    name: `${aRollerShutter.name || aRollerShutter.id} Stop`,
                    type: 'boolean',
                    role: 'button',
                    read: false,
                    write: true,
                },
                native: {
                    homeId: aHome.id,
                    moduleId: aRollerShutter.id,
                    bridgeId: aRollerShutter.bridge,
                    field: 'target_position',
                    setValue: -1
                }
            });
            await adapter.setStateAsync(`${fullPath}.stop`, {val: false, ack: true});
        }

    }

}
