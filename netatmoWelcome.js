module.exports = function (myapi, myadapter) {

    var api = myapi;
    var adapter = myadapter;
    var cleanUpInterval = adapter.config.cleanup_interval ? adapter.config.cleanup_interval : 5;
    var EventTime = adapter.config.event_time ? adapter.config.event_time : 12;
    var UnknownPersonTime = adapter.config.unknown_person_time ? adapter.config.unknown_person_time : 24;

    var EventCleanUpTimer = {};
    var PersonCleanUpTimer = {};

    var knownPeople = [];
    var homeIds = [];

    var socket = null;
    var that = null;

    var socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

    this.init = function () {
        that = this;
        socket = require('socket.io-client')(socketServerUrl);

        if (socket) {
            adapter.log.info("Registering realtime events with " + socketServerUrl);
            socket.on('alert', onSocketAlert);
            api.addWebHook(socketServerUrl);
        }
    };

    this.finalize = function () {
        if (socket) {
            adapter.log.info("Unregistering realtime events");
            socket.disconnect();
            api.dropWebHook();
        }
    };

    this.setAway = function (data) {
        if (data && data.homeId) {
            api.setPersonsAway(data.homeId, data.personsId, function (err, data) {
                if (err !== null)
                    adapter.log.error(err);
            });
        } else {
            homeIds.forEach(function (aHomeId) {
                api.setPersonsAway(aHomeId, data ? data.personsId : null, function (err, data) {
                    if (err !== null)
                        adapter.log.error(err);
                });
            });
        }
    };

    this.requestUpdateIndoorCamera = function () {
        api.getHomeData({}, function (err, data) {
            if (err !== null)
                adapter.log.error(err);
            else {
                var homes = data.homes;
                homeIds = [];

                if (Array.isArray(homes)) {
                    homes.forEach(function (aHome) {
                        handleHome(aHome);

                        var homeName = getHomeName(aHome.name);

                        if (!EventCleanUpTimer[homeName]) {
                            var _welcomeCleanUpTimer = setInterval(function () {
                                cleanUpEvents(homeName);
                            }, cleanUpInterval * 60 * 1000);
                            EventCleanUpTimer[homeName] = _welcomeCleanUpTimer;
                        }

                        if (!PersonCleanUpTimer[homeName]) {
                            var _welcomeCleanUpTimer = setInterval(function () {
                                cleanUpUnknownPersons(homeName);
                            }, cleanUpInterval * 60 * 1000);
                            PersonCleanUpTimer[homeName] = _welcomeCleanUpTimer;
                        }
                    });
                }
            }
        });
    };

    function onSocketAlert(data) {

        adapter.log.info(JSON.stringify(data));

        var now = (new Date()).toISOString();

        if (data) {
            var path = data.home_name + ".LastEventData.";

            if (data.event_type === "person") {
                data.persons.forEach(function (person) {
                    var dataPath = "";

                    if (person.is_known) {
                        dataPath = "LastKnownPersonSeen";
                    }
                    else
                        dataPath = "LastUnknownPersonSeen";

                    adapter.setState(path + dataPath, {val: now, ack: true});

                    // Set state first ...
                    if (person.is_known) {
                        knownPeople.forEach(function (aPerson) {
                            if (aPerson.face && aPerson.face.id === person.face_id) {
                                adapter.setState(path + "LastKnownPersonName", {val: aPerson.pseudo, ack: true});
                            }
                        })
                    }
                });
            } else if (data.event_type === "movement") {
                adapter.setState(path + "LastMovementDetected", {val: now, ack: true});

                if (data.type) {
                    adapter.setState(path + "LastMovementType", {val: data.type, ack: true});
                } else {
                    adapter.setState(path + "LastMovementType", {val: "unknown", ack: true});
                }
            }

            adapter.setState(path + "LastEventId", {val: data.id, ack: true});

            that.requestUpdateIndoorCamera();
        }
    }

    function getHomeName(aHomeName) {
        return aHomeName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleHome(aHome) {

        var homeName = getHomeName(aHome.name);
        var fullPath = homeName;

        homeIds.push(aHome.id);

        // Join HomeID
        if (socket) {
            socket.emit("registerHome", aHome.id);
        }

        adapter.setObjectNotExists(homeName, {
            type: "channel",
            common: {
                name: homeName,
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setState(homeName, aHome.id, true);

        adapter.setObjectNotExists(homeName + ".LastEventData.LastMovementDetected", {
            type: "state",
            common: {
                name: "LastMovementDetected",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData.LastKnownPersonSeen", {
            type: "state",
            common: {
                name: "LastKnownPersonSeen",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData.LastMovementType", {
            type: "state",
            common: {
                name: "LastMovementType",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData.LastEventId", {
            type: "state",
            common: {
                name: "LastEventId",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData.LastKnownPersonName", {
            type: "state",
            common: {
                name: "LastKnownPersonName",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData.LastUnknownPersonSeen", {
            type: "state",
            common: {
                name: "LastUnknownPersonSeen",
                type: "string",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        });

        adapter.setObjectNotExists(homeName + ".LastEventData", {
            type: "channel",
            common: {
                name: "LastEventData",
                type: "string",
                read: true,
                write: false
            }
        });

        if (aHome.cameras) {
            aHome.cameras.forEach(function (aCamera) {
                if (aCamera.id && aCamera.name) {
                    adapter.setObjectNotExists(fullPath + "." + aCamera.name, {
                        type: "state",
                        common: {
                            name: aCamera.name,
                            type: "string",
                            read: true,
                            write: false
                        }
                    });
                    adapter.setState(fullPath + "." + aCamera.name, {val: aCamera.id, ack: true});
                }
            });
        }

        // Camera Objecte anlegen
        if (aHome.cameras) {
            aHome.cameras.forEach(function (aCamera) {
                handleCamera(aCamera, aHome);
            });
        }

        if (aHome.persons) {
            knownPeople = [];

            aHome.persons.forEach(function (aPerson) {
                handlePerson(aPerson, homeName);
            });
        }

        if (aHome.events) {
            var latestEventDate = 0;
            var latestEvent = null;

            aHome.events.forEach(function (aEvent) {
                var eventDate = aEvent.time * 1000;

                handleEvent(aEvent, homeName, aHome.cameras);
                if (eventDate > latestEventDate) {
                    latestEventDate = eventDate;
                    latestEvent = aEvent;
                }
            });

            if (latestEvent) {
                adapter.setState(homeName + ".LastEventData.LastEventId", {val: latestEvent.id, ack: true});
            }
        }
    }

    function handleCamera(aCamera, aHome) {

        var aParent = getHomeName(aHome.name);
        var fullPath = aParent + "." + aCamera.name;
        var infoPath = fullPath + ".info";
        var livePath = fullPath + ".live";


        adapter.setObjectNotExists(fullPath, {
            type: "device",
            common: {
                name: aCamera.name,
                type: "device",
                read: true,
                write: false
            },
            native: {
                id: aCamera.id,
                type: aCamera.type
            }
        });

        if (aCamera.id) {
            adapter.setObjectNotExists(infoPath + ".id", {
                type: "state",
                common: {
                    name: "Camera ID",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(infoPath + ".id", {val: aCamera.id, ack: true});
        }

        if (aCamera.status) {
            adapter.setObjectNotExists(infoPath + ".status", {
                type: "state",
                common: {
                    name: "Monitoring State (on/off)",
                    type: "string",
                    read: true,
                    write: false
                },
                native: {
                    status: aCamera.status
                }
            });

            adapter.setState(infoPath + ".status", {val: aCamera.status, ack: true});
        }

        if (aCamera.sd_status) {
            adapter.setObjectNotExists(infoPath + ".sd_status", {
                type: "state",
                common: {
                    name: "SD card State (on/off)",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(infoPath + ".sd_status", {val: aCamera.sd_status, ack: true});
        }

        if (aCamera.alim_status) {
            adapter.setObjectNotExists(infoPath + ".alim_status", {
                type: "state",
                common: {
                    name: "Power Supply State (on/off)",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(infoPath + ".alim_status", {val: aCamera.alim_status, ack: true});
        }

        if (aCamera.name) {
            adapter.setObjectNotExists(infoPath + ".name", {
                type: "state",
                common: {
                    name: "Camera name",
                    type: "state",
                    read: true,
                    write: false
                }
            });

            adapter.setState(infoPath + ".name", {val: aCamera.name, ack: true});
        }

        if (aCamera.vpn_url) {
            adapter.setObjectNotExists(livePath + ".picture", {
                type: "state",
                common: {
                    name: "Live camera picture URL",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setObjectNotExists(livePath + ".stream", {
                type: "state",
                common: {
                    name: "Live camera picture URL",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(livePath + ".picture", {val: aCamera.vpn_url + "/live/snapshot_720.jpg", ack: true});
            adapter.setState(livePath + ".stream", {
                val: aCamera.vpn_url + (aCamera.is_local ? "/live/index_local.m3u8" : "/live/index.m3u8"),
                ack: true
            });
        }

        // Initialize Camera Place
        if (aHome.place) {
            handlePlace(aHome.place, fullPath);
        }
    }


    function handlePlace(aPlace, aParent) {
        var fullPath = aParent + ".place";

        adapter.setObjectNotExists(fullPath, {
            type: "channel",
            common: {
                name: "place",
                type: "channel",
                read: true,
                write: false
            }
        });

        if (aPlace.city) {
            adapter.setObjectNotExists(fullPath + ".city", {
                type: "state",
                common: {
                    name: "city",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".city", {val: aPlace.city, ack: true});
        }

        if (aPlace.country) {
            adapter.setObjectNotExists(fullPath + ".country", {
                type: "state",
                common: {
                    name: "country",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".country", {val: aPlace.country, ack: true});
        }

        if (aPlace.timezone) {
            adapter.setObjectNotExists(fullPath + ".timezone", {
                type: "state",
                common: {
                    name: "timezone",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".timezone", {val: aPlace.timezone, ack: true});
        }
    }


    function getPersonName(aPersonName) {
        return aPersonName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-").replaceAll("ß", "ss");
    }

    function handlePerson(aPerson, aParent) {

        var aPersonName;
        var bKnown = true;
        var cleanupDate = new Date().getTime();
        if (aPerson.pseudo) {
            aPersonName = getPersonName(aPerson.pseudo);
        } else {
            aPersonName = aPerson.id;
            bKnown = false;
            cleanupDate -= UnknownPersonTime * 60 * 60 * 1000;
        }

        var personDate = aPerson.last_seen ? aPerson.last_seen * 1000 : cleanupDate;

        if (bKnown || cleanupDate < personDate) {
            var fullPath = aParent + ".Persons";

            adapter.setObjectNotExists(fullPath, {
                type: "channel",
                common: {
                    name: "Persons",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            if (bKnown) {
                fullPath += ".Known";
                knownPeople.push(aPerson);
            }
            else {
                fullPath += ".Unknown";
            }


            if (fullPath) {
                adapter.setObjectNotExists(fullPath, {
                    type: "channel",
                    common: {
                        name: fullPath,
                        type: "string",
                        read: true,
                        write: false
                    }
                });
            }

            fullPath += "." + aPersonName;

            if (aPersonName) {
                adapter.setObjectNotExists(fullPath, {
                    type: "channel",
                    common: {
                        name: fullPath,
                        type: "string",
                        read: true,
                        write: false
                    }
                });
            }

            if (aPerson.id) {
                adapter.setObjectNotExists(fullPath + ".id", {
                    type: "state",
                    common: {
                        name: "Person ID",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".id", {val: aPerson.id, ack: true});
            }

            if (aPerson.out_of_sight !== "undefined") {
                adapter.setObjectNotExists(fullPath + ".out_of_sight", {
                    type: "state",
                    common: {
                        name: "Person out of sight (true/false)",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".out_of_sight", {val: aPerson.out_of_sight, ack: true});

                adapter.setObjectNotExists(fullPath + ".atHome", {
                    type: "state",
                    common: {
                        name: "Person at home (true/false)",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".atHome", {val: !aPerson.out_of_sight, ack: true});
            }

            if (aPerson.last_seen) {
                adapter.setObjectNotExists(fullPath + ".last_seen", {
                    type: "state",
                    common: {
                        name: "Last seen",
                        type: "date",
                        read: true,
                        write: false
                    }
                });

                adapter.setState(fullPath + ".last_seen", {
                    val: (new Date(aPerson.last_seen * 1000)),
                    ack: true
                });
            }

            if (aPerson.face !== "undefined") {
                handleFace(aPerson.face, fullPath);
            }

        }
    }


    function handleFace(aFace, aParent) {

        var fullPath = aParent;

        if (aFace.id) {
            adapter.setObjectNotExists(fullPath + ".face_id", {
                type: "state",
                common: {
                    name: "Face ID",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".face_id", {val: aFace.id, ack: true});
        }

        if (aFace.key) {
            adapter.setObjectNotExists(fullPath + ".face_key", {
                type: "state",
                common: {
                    name: "Face Key",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".face_key", {val: aFace.key, ack: true});
        }

        if (aFace.id && aFace.key) {
            var imageUrl = "https://api.netatmo.com/api/getcamerapicture?image_id=" + aFace.id + "&key=" + aFace.key;

            adapter.setObjectNotExists(fullPath + ".face_url", {
                type: "state",
                common: {
                    name: "Face Url",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".face_url", {
                val: imageUrl,
                ack: true
            });
        }

        if (aFace.version) {
            adapter.setObjectNotExists(fullPath + ".face_version", {
                type: "state",
                common: {
                    name: "Version",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".face_version", {val: aFace.version, ack: true});
        }
    }

    function handleEvent(aEvent, aParent, aCameraList) {

        var cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;
        var eventDate = aEvent.time ? aEvent.time * 1000 : cleanupDate;

        if (cleanupDate < eventDate) {
            var fullPath = aParent + ".Events";
            var camera = null;

            adapter.setObjectNotExists(fullPath, {
                type: "channel",
                common: {
                    name: "Events",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            fullPath += "." + aEvent.id;

            if (fullPath) {
                adapter.setObjectNotExists(fullPath, {
                    type: "channel",
                    common: {
                        name: aEvent.id,
                        type: "string",
                        read: true,
                        write: false
                    },
                    native: {
                        id: "Events." + aEvent.id
                    }
                });
            }

            if (aEvent.id) {
                adapter.setObjectNotExists(fullPath + ".id", {
                    type: "state",
                    common: {
                        name: "Event ID",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".id", {val: aEvent.id, ack: true});
            }

            if (aEvent.message) {
                adapter.setObjectNotExists(fullPath + ".message", {
                    type: "state",
                    common: {
                        name: "Message",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".message", {val: aEvent.message, ack: true});
            }

            if (aEvent.type) {
                adapter.setObjectNotExists(fullPath + ".type", {
                    type: "state",
                    common: {
                        name: "Type",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".type", {val: aEvent.type, ack: true});
            }

            if (aEvent.category) {
                adapter.setObjectNotExists(fullPath + ".category", {
                    type: "state",
                    common: {
                        name: "Category",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".category", {val: aEvent.category, ack: true});
            }

            if (aEvent.time) {
                adapter.setObjectNotExists(fullPath + ".time", {
                    type: "state",
                    common: {
                        name: "Time",
                        type: "date",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".time", {
                    val: (new Date(aEvent.time * 1000)),
                    ack: true
                });
            }

            if (aEvent.person_id) {
                adapter.setObjectNotExists(fullPath + ".person_id", {
                    type: "state",
                    common: {
                        name: "Person ID",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".person_id", {val: aEvent.person_id, ack: true});
            }

            if (aEvent.camera_id) {
                adapter.setObjectNotExists(fullPath + ".camera_id", {
                    type: "state",
                    common: {
                        name: "Camera ID",
                        type: "string",
                        read: true,
                        write: false
                    }
                });

                adapter.setState(fullPath + ".camera_id", {val: aEvent.camera_id, ack: true});

                aCameraList.forEach(function (aCamera) {
                    if (aCamera.id === aEvent.camera_id)
                        camera = aCamera;
                });
            }

            if (aEvent.sub_type) {
                adapter.setObjectNotExists(fullPath + ".sub_type", {
                    type: "state",
                    common: {
                        name: "Sub Type",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".sub_type", {val: aEvent.sub_type, ack: true});
            }

            if (aEvent.video_id) {
                adapter.setObjectNotExists(fullPath + ".video_id", {
                    type: "state",
                    common: {
                        name: "Video ID",
                        type: "string",
                        read: true,
                        write: false
                    }
                });

                adapter.setState(fullPath + ".video_id", {val: aEvent.video_id, ack: true});

                if (camera) {
                    adapter.setObjectNotExists(fullPath + ".video_url", {
                        type: "state",
                        common: {
                            name: "Video URL",
                            type: "string",
                            read: true,
                            write: false
                        }
                    });

                    adapter.setState(fullPath + ".video_url", {
                        val: camera.vpn_url + "/vod/" + aEvent.video_id + (camera.is_local ? "/index_local.m3u8" : "/index.m3u8"),
                        ack: true
                    });

                }
            }

            if (aEvent.video_status) {
                adapter.setObjectNotExists(fullPath + ".video_status", {
                    type: "state",
                    common: {
                        name: "Video Status",
                        type: "string",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".video_status", {val: aEvent.video_status, ack: true});
            }

            if (aEvent.is_arrival != "undefined" && aEvent.is_arrival != "") {
                adapter.setObjectNotExists(fullPath + ".is_arrival", {
                    type: "state",
                    common: {
                        name: "Is Arrival",
                        type: "string",
                        read: true,
                        write: false
                    }
                });

                adapter.setState(fullPath + ".is_arrival", {val: aEvent.is_arrival, ack: true});
            }

            if (aEvent.snapshot) {
                handleSnapshot(aEvent.snapshot, fullPath);
            }

            if (aEvent.vignette) {
                handleVignette(aEvent.vignette, fullPath);
            }
        }

    }

    function handleVignette(aVignette, aParent) {
        var fullPath = aParent;

        if (aVignette.id) {
            adapter.setObjectNotExists(fullPath + ".vignette_id", {
                type: "state",
                common: {
                    name: "Vignette ID",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".vignette_id", {val: aVignette.id, ack: true});
        }


        if (aVignette.key) {
            adapter.setObjectNotExists(fullPath + ".vignette_key", {
                type: "state",
                common: {
                    name: "Vignette Key",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".vignette_key", {val: aVignette.key, ack: true});
        }

        if (aVignette.id && aVignette.key) {
            var imageUrl = "https://api.netatmo.com/api/getcamerapicture?image_id=" + aVignette.id + "&key=" + aVignette.key;

            adapter.setObjectNotExists(fullPath + ".vignette_url", {
                type: "state",
                common: {
                    name: "Vignette Url",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".vignette_url", {
                val: imageUrl,
                ack: true
            });
        }

        if (aVignette.version) {
            adapter.setObjectNotExists(fullPath + ".vignette_version", {
                type: "state",
                common: {
                    name: "Version",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".vignette_version", {val: aVignette.version, ack: true});
        }
    }

    function handleSnapshot(aSnapshot, aParent) {

        var fullPath = aParent;

        if (aSnapshot.id) {
            adapter.setObjectNotExists(fullPath + ".snapshot_id", {
                type: "state",
                common: {
                    name: "Snapshot ID",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".snapshot_id", {val: aSnapshot.id, ack: true});
        }


        if (aSnapshot.key) {
            adapter.setObjectNotExists(fullPath + ".snapshot_key", {
                type: "state",
                common: {
                    name: "Snapshot Key",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".snapshot_key", {val: aSnapshot.key, ack: true});
        }

        if (aSnapshot.id && aSnapshot.key) {
            var imageUrl = "https://api.netatmo.com/api/getcamerapicture?image_id=" + aSnapshot.id + "&key=" + aSnapshot.key;

            adapter.setObjectNotExists(fullPath + ".snapshot_url", {
                type: "state",
                common: {
                    name: "Snapshot Url",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".snapshot_url", {
                val: imageUrl,
                ack: true
            });
        }

        if (aSnapshot.version) {
            adapter.setObjectNotExists(fullPath + ".snapshot_version", {
                type: "state",
                common: {
                    name: "Version",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".snapshot_version", {val: aSnapshot.version, ack: true});
        }
    }

    function cleanUpEvents(home) {

        adapter.getForeignObjects("netatmo." + adapter.instance + "." + home + ".Events.*", "channel", function (errEvents, objEvents) {
            if (errEvents) {
                adapter.log.error(errEvents);
            } else if (objEvents) {
                var cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;

                for (var aEventId in objEvents) {
                    //adapter.getForeignObject(aEventId + ".time", "state", function (errTime, objTime) {
                    adapter.getForeignStates(aEventId + ".time", function (errTime, objTime) {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (objTime) {
                            for (var aTimeId in objTime) {

                                var eventDate = Date.parse(objTime[aTimeId].val);
                                if (cleanupDate > eventDate) {
                                    var parentId = aTimeId.substring(0, aTimeId.length - 5);

                                    adapter.getForeignObjects(parentId + ".*", "state", function (errState, objState) {
                                        if (errState) {
                                            adapter.log.error(errState);
                                        } else {
                                            for (var aStateId in objState) {
                                                adapter.log.debug("State  " + aStateId + " abgelaufen daher löschen!");
                                                adapter.delObject(aStateId);
                                            }
                                        }
                                    });

                                    adapter.log.info("Event " + parentId + " abgelaufen daher löschen!");
                                    adapter.delObject(parentId);
                                }
                            }
                        }
                    });
                }
            }
        });
    }

    function cleanUpUnknownPersons(home) {

        adapter.getForeignObjects("netatmo." + adapter.instance + "." + home + ".Persons.Unknown.*", "channel", function (errPerson, objPerson) {
            if (errPerson) {
                adapter.log.error(errPerson);
            } else if (objPerson) {
                var cleanupDate = new Date().getTime() - UnknownPersonTime * 60 * 60 * 1000;

                for (var aPersonId in objPerson) {
                    adapter.getForeignStates(aPersonId + ".last_seen", function (errTime, objTime) {
                        if (errTime) {
                            adapter.log.error(errTime);
                        } else if (objTime) {
                            for (var aTimeId in objTime) {

                                var personDate = Date.parse(objTime[aTimeId].val);
                                if (cleanupDate > personDate) {
                                    var parentId = aTimeId.substring(0, aTimeId.length - 10);

                                    adapter.getForeignObjects(parentId + ".*", "state", function (errState, objState) {
                                        if (errState) {
                                            adapter.log.error(errState);
                                        } else {
                                            for (var aStateId in objState) {
                                                adapter.log.debug("State  " + aStateId + " abgelaufen daher löschen!");
                                                adapter.delObject(aStateId);
                                            }
                                        }
                                    });

                                    adapter.log.info("Person " + parentId + " abgelaufen daher löschen!");
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