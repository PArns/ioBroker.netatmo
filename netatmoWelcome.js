module.exports = function (myapi, myadapter) {

    var api = myapi;
    var adapter = myadapter;
    var cleanUpInterval = adapter.config.cleanup_interval ? adapter.config.cleanup_interval : 5;
    var EventTime = adapter.config.event_time ? adapter.config.event_time : 12;
    var UnknownPersonTime = adapter.config.unknown_person_time ? adapter.config.unknown_person_time : 24;

    var EventCleanUpTimer = {};
    var PersonCleanUpTimer = {};

    var webServer = null;
    var that = null;

    this.init = function () {
        that = this;

        if (adapter.config.external_host && adapter.config.external_host !== "" && adapter.config.port) {
            initWebServer();
            var hookUrl = "http://" + adapter.config.external_host + ":" + adapter.config.port;

            api.addWebHook(hookUrl, function (err, body) {
                if (err)
                    adapter.log.info("Error registering WebHook: " + JSON.stringify(err));
                else
                    adapter.log.info("Registered WebHook " + hookUrl);
            });
        }
    };

    this.finalize = function () {
        if (webServer) {
            adapter.log.info("Unregistering WebHook");
            api.dropWebHook();
        }
    };

    this.requestUpdateIndoorCamera = function () {
        api.getHomeData({}, function (err, data) {
            if (err !== null)
                adapter.log.error(err);
            else {
                var homes = data.homes;

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

    function initWebServer() {
        if (adapter.config.ssl) {
            // subscribe on changes of permissions
            adapter.subscribeForeignObjects('system.group.*');
            adapter.subscribeForeignObjects('system.user.*');

            if (!adapter.config.certPublic) {
                adapter.config.certPublic = 'defaultPublic';
            }
            if (!adapter.config.certPrivate) {
                adapter.config.certPrivate = 'defaultPrivate';
            }

            // Load certificates
            adapter.getForeignObject('system.certificates', function (err, obj) {
                if (err || !obj || !obj.native.certificates || !adapter.config.certPublic || !adapter.config.certPrivate || !obj.native.certificates[adapter.config.certPublic] || !obj.native.certificates[adapter.config.certPrivate]
                ) {
                    adapter.log.error('Cannot enable secure web server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
                } else {
                    adapter.config.certificates = {
                        key: obj.native.certificates[adapter.config.certPrivate],
                        cert: obj.native.certificates[adapter.config.certPublic]
                    };

                }
                webServer = _initWebServer(adapter.config);
            });
        } else {
            webServer = _initWebServer(adapter.config);
        }
    }

    function _initWebServer(settings) {

        var server = {
            server: null,
            settings: settings
        };

        if (settings.port) {
            if (settings.ssl) {
                if (!adapter.config.certificates) {
                    return null;
                }
            }

            if (settings.ssl) {
                server.server = require('https').createServer(adapter.config.certificates, requestProcessor);
            } else {
                server.server = require('http').createServer(requestProcessor);
            }

            server.server.__server = server;
        } else {
            adapter.log.error('port missing');
            process.exit(1);
        }

        if (server.server) {
            adapter.getPort(settings.port, function (port) {
                if (port != settings.port && !adapter.config.findNextPort) {
                    adapter.log.error('port ' + settings.port + ' already in use');
                    process.exit(1);
                }
                server.server.listen(port);
                adapter.log.info('http' + (settings.ssl ? 's' : '') + ' server listening on port ' + port);
            });
        }

        if (server.server) {
            return server;
        } else {
            return null;
        }
    }

    function requestProcessor(req, res) {
        req.on('data', function (chunk) {
            // needed dummy event ...
        });

        req.on('end', function () {
            adapter.log.info("Got an realtime event!");

            // TODO: Parse event instead of full update
            that.requestUpdateIndoorCamera();

            res.writeHead(200);
            res.write("OK");
            res.end();
        });
    }

    function getHomeName(aHomeName) {
        return aHomeName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleHome(aHome) {

        var homeName = getHomeName(aHome.name);
        var fullPath = homeName;

        adapter.setObjectNotExists(homeName, {
            type: "enum",
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

        if (aHome.id) {
            adapter.setObjectNotExists(fullPath + ".id", {
                type: "state",
                common: {
                    name: "HomeID",
                    type: "string",
                    read: true,
                    write: false
                }
            });
            adapter.setState(fullPath + ".id", {val: aHome.id, ack: true});
        }

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
            aHome.persons.forEach(function (aPerson) {
                handlePerson(aPerson, homeName);
            });
        }

        if (aHome.events) {
            aHome.events.forEach(function (aEvent) {
                handleEvent(aEvent, homeName);
            });
        }

    }

    function getCameraName(aCameraName) {
        return aCameraName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleCamera(aCamera, aHome) {

        var aParent = getHomeName(aHome.name);
        var fullPath = aParent + "." + aCamera.name;
        var infoPath = fullPath + ".info";


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

        adapter.setObjectNotExists(infoPath, {
            type: "channel",
            common: {
                name: aCamera.name,
                type: "channel",
                read: true,
                write: false
            },
            native: {
                id: aCamera.id
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
                    type: "state",
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
                    type: "state",
                    read: true,
                    write: false
                },
                native: {
                    sd_status: aCamera.sd_status
                }
            });

            adapter.setState(infoPath + ".sd_status", {val: aCamera.sd_status, ack: true});
        }

        if (aCamera.alim_status) {
            adapter.setObjectNotExists(infoPath + ".alim_status", {
                type: "state",
                common: {
                    name: "Power Supply State (on/off)",
                    type: "state",
                    read: true,
                    write: false
                },
                native: {
                    alim_status: aCamera.alim_status
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
                },
                native: {
                    name: aCamera.name
                }
            });

            adapter.setState(infoPath + ".name", {val: aCamera.name, ack: true});
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


    function getPersonName(aPersonName, aParent) {
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
                type: "enum",
                common: {
                    name: "Persons",
                    type: "string",
                    read: true,
                    write: false
                }
            });

            if (bKnown) {
                fullPath += ".Known";
            }
            else {
                fullPath += ".Unknown";
            }


            if (fullPath) {
                adapter.setObjectNotExists(fullPath, {
                    type: "enum",
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
                        type: "state",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".out_of_sight", {val: aPerson.out_of_sight, ack: true});

                adapter.setObjectNotExists(fullPath + ".atHome", {
                    type: "state",
                    common: {
                        name: "Person at home (true/false)",
                        type: "state",
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

            api.getCameraPicture({"image_id": aFace.id, "key": aFace.key}, function (err, data) {
                if (err !== null)
                    adapter.log.error(err);
                else {

                    adapter.setObjectNotExists(fullPath + ".face_url", {
                        type: "state",
                        common: {
                            name: "Face Url",
                            type: "string",
                            read: true,
                            write: false
                        },
                        native: {
                            vis_url: "http://<vis-url>:<vis-port>/state/" + adapter.namespace + "." + fullPath + ".jpg"
                        }
                    });
                    adapter.setState(fullPath + ".face_url", {
                        val: adapter.namespace + "." + fullPath + ".jpg",
                        ack: true
                    });


                    adapter.setObjectNotExists(fullPath + ".jpg", {
                        type: "state",
                        common: {
                            name: "JPEG",
                            type: "object",
                            read: true,
                            write: false
                        },
                        native: {
                            vis_url: "http://<vis-url>:<vis-port>/state/" + adapter.namespace + "." + fullPath + ".jpg"
                        }
                    });
                    adapter.setBinaryState(adapter.namespace + "." + fullPath + ".jpg", data);
                }
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

    function handleEvent(aEvent, aParent) {

        var cleanupDate = new Date().getTime() - EventTime * 60 * 60 * 1000;
        var eventDate = aEvent.time ? aEvent.time * 1000 : cleanupDate;

        if (cleanupDate < eventDate) {


            var fullPath = aParent + ".Events";

            adapter.setObjectNotExists(fullPath, {
                type: "enum",
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

            if (aEvent.is_arrival !== "undefined") {
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

            api.getCameraPicture({"image_id": aSnapshot.id, "key": aSnapshot.key}, function (err, data) {
                if (err !== null)
                    adapter.log.error(err);
                else {

                    adapter.setObjectNotExists(fullPath + ".snapshot_url", {
                        type: "state",
                        common: {
                            name: "Snapshot Url",
                            type: "string",
                            read: true,
                            write: false
                        },
                        native: {
                            vis_url: "http://<vis-url>:<vis-port>/state/" + adapter.namespace + "." + fullPath + ".jpg"
                        }
                    });
                    adapter.setState(fullPath + ".snapshot_url", {
                        val: adapter.namespace + "." + fullPath + ".jpg",
                        ack: true
                    });


                    adapter.setObjectNotExists(fullPath + ".jpg", {
                        type: "state",
                        common: {
                            name: "JPEG",
                            type: "object",
                            read: true,
                            write: false
                        },
                        native: {
                            vis_url: "http://<vis-url>:<vis-port>/state/" + adapter.namespace + "." + fullPath + ".jpg"
                        }
                    });
                    adapter.setBinaryState(adapter.namespace + "." + fullPath + ".jpg", data);
                }
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
};