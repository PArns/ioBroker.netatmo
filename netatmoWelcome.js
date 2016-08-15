module.exports = function (myapi, myadapter) {

    var api = myapi;
    var adapter = myadapter;

    var iPersonKnown = 0;
    var iPersonUnknown = 0;
    var iEvent = 0;

    this.requestUpdateIndoorCamera = function () {
        api.getHomeData({}, function (err, data) {
            if (err !== null)
                adapter.log.error(err);
            else {
                var homes = data.homes;

                if (Array.isArray(homes)) {
                    homes.forEach(function (aHome) {
                        handleHome(aHome);
                    });
                }
            }
        });
    }

    function getHomeName(aHomeName) {
        return aHomeName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleHome(aHome) {
        var homeName = getHomeName(aHome.name);

        adapter.setObjectNotExists(homeName, {
            type: "device",
            common: {
                name: homeName,
                type: "string",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(homeName + ".0", {
            type: "channel",
            common: {
                name: homeName + ":0",
                type: "channel",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(homeName + ".0.HOME_ID", {
            type: "state",
            common: {
                name: homeName + ":0 HOME_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myId = aHome.id ? aHome.id : "";
        adapter.setState(homeName + ".0.HOME_ID", {val: myId, ack: true});


        // Camera Objecte anlegen
        if (aHome.cameras) {
            aHome.cameras.forEach(function (aCamera) {
                handleCamera(aCamera, aHome);
            });
        }

        if (aHome.persons) {
            iPersonKnown = 0;
            iPersonUnknown = 0;
            aHome.persons.sort(function (a, b) {
                return b.last_seen - a.last_seen
            });
            aHome.persons.forEach(function (aPerson) {
                handlePerson(aPerson, homeName);
            });

            // Nicht angelieferte Unknown Persons löschen
            adapter.getChannelsOf(homeName + "_PERSON_UNKNOWN", function (err, obj) {
                if (!err && obj instanceof Array) {
                    for (var i = iPersonUnknown; i < obj.length; i++) {
                        adapter.deleteChannel(homeName + "_PERSON_UNKNOWN", "" + i);
                    }
                }
            });
        }


        if (aHome.events) {
            iEvent = 0;

            // Array nach Timestamp sortieren - Neueste zuerst
            aHome.events.sort(function(a, b){return b.time - a.time});
            aHome.events.forEach(function (aEvent) {
                handleEvent(aEvent, homeName);
            });

            // Nicht angelieferte Events löschen
            adapter.getChannelsOf(homeName + "_EVENT", function (err, obj) {
                if (!err && obj instanceof Array) {
                    for (var i = iEvent; i < obj.length; i++) {
                        adapter.deleteChannel(homeName + "_EVENT", "" + i);
                    }
                }
            });

            setEventsJSON(homeName, aHome.events);
        }
    }


    function getCameraName(aCameraName) {
        return aCameraName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleCamera(aCamera, aHome) {

        var homeName = getHomeName(aHome.name);
        var fullPath = homeName  + "_" + aCamera.name + ".0";
        var fullName = homeName  + " " + aCamera.name + ":0";

        adapter.setObjectNotExists(homeName + "_" + aCamera.name, {
            type: "device",
            common: {
                name: homeName + " " + aCamera.name,
                type: "string",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(fullPath, {
            type: "channel",
            common: {
                name: fullName,
                type: "channel",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(fullPath +".CAMERA_ID", {
            type: "state",
            common: {
                name: fullName + " CAMERA_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myId = aCamera.id ? aCamera.id : "";
        adapter.setState(fullPath + ".CAMERA_ID", {val: myId, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_STATUS", {
            type: "state",
            common: {
                name: fullName + " CAMERA_STATUS",
                type: "state",
                read: true,
                write: false
            }
        });
        var myStatus = aCamera.status ? aCamera.status : "";
        adapter.setState(fullPath + ".CAMERA_STATUS", {val: myStatus, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_STATUS_SD", {
            type: "state",
            common: {
                name: fullName + " CAMERA_STATUS_SD",
                type: "state",
                read: true,
                write: false
            }
        });
        var mySd_status = aCamera.sd_status ? aCamera.sd_status : "";
        adapter.setState(fullPath + ".CAMERA_STATUS_SD", {val: mySd_status, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_STATUS_ALIM", {
            type: "state",
            common: {
                name: fullName + " CAMERA_STATUS_ALIM",
                type: "state",
                read: true,
                write: false
            }
        });
        var myAlim_status = aCamera.alim_status ? aCamera.sd_status : "";
        adapter.setState(fullPath + ".CAMERA_STATUS_ALIM", {val: myAlim_status, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_NAME", {
            type: "state",
            common: {
                name: fullName + " CAMERA_NAME",
                type: "state",
                read: true,
                write: false
            }
        });
        var myName = aCamera.name ? aCamera.name : "";
        adapter.setState(fullPath + ".CAMERA_NAME", {val: myName, ack: true});


        // Initialize Camera Place
        if (aHome.place) {
            handlePlace(aHome.place, homeName  + "_" + aCamera.name + ".1", homeName  + " " + aCamera.name + ":1");
        }
    }


    function handlePlace(aPlace, fullPath, fullName) {

        adapter.setObjectNotExists(fullPath, {
            type: "channel",
            common: {
                name: fullName,
                type: "channel",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(fullPath + ".CAMERA_PLACE_CITY", {
            type: "state",
            common: {
                name: fullName + " CAMERA_PLACE_CITY",
                type: "string",
                read: true,
                write: false
            }
        });
        var myCity = aPlace.city ? aPlace.city : "";
        adapter.setState(fullPath + ".CAMERA_PLACE_CITY", {val: myCity, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_PLACE_COUNTRY", {
            type: "state",
            common: {
                name: fullName +" CAMERA_PLACE_COUNTRY",
                type: "string",
                read: true,
                write: false
            }
        });
        var myCountry = aPlace.country ? aPlace.country : "";
        adapter.setState(fullPath + ".CAMERA_PLACE_COUNTRY", {val: myCountry, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_PLACE_TIMEZONE", {
            type: "state",
            common: {
                name: fullName + " CAMERA_PLACE_TIMEZONE",
                type: "string",
                read: true,
                write: false
            }
        });
        var myTimezone = aPlace.timezone ? aPlace.timezone : "";
        adapter.setState(fullPath + ".CAMERA_PLACE_TIMEZONE", {val: myTimezone, ack: true});

    }


    function getPersonName(aPersonName, aParent) {
        return aPersonName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-").replaceAll("ß", "ss");
    }

    function handlePerson(aPerson, homeName) {

        var aPersonName = null;
        var bKnown = true;
        if (aPerson.pseudo) {
            aPersonName = getPersonName(aPerson.pseudo);
        } else {
            bKnown = false;
        }

        var fullPath = homeName + "_PERSON";
        var fullName = homeName + " PERSON";

        if (bKnown) {
            fullPath += "_KNOWN";
            fullName += "_KNOWN";
            iPersonKnown += 1;
        }
        else {
            fullPath += "_UNKNOWN";
            fullName += "_UNKNOWN";
            iPersonUnknown += 1;
        }

        adapter.setObjectNotExists(fullPath, {
            type: "device",
            common: {
                name: fullName,
                type: "string",
                read: true,
                write: false
            }
        });

        if (bKnown) {
            fullPath += "." + aPersonName;
            fullName += ":" + aPersonName;
        }
        else {
            fullPath += "." + iPersonUnknown;
            fullName += ":" + iPersonUnknown;
        }


        adapter.setObjectNotExists(fullPath, {
            type: "channel",
            common: {
                name: fullName,
                type: "channel",
                read: true,
                write: false
            }
        });


        adapter.setObjectNotExists(fullPath + ".NAME", {
            type: "state",
            common: {
                name: fullName + " NAME",
                type: "string",
                read: true,
                write: false
            }
        });
        var myPersonName = aPersonName ? aPersonName : "";
        adapter.setState(fullPath + ".NAME", {val: myPersonName, ack: true});


        adapter.setObjectNotExists(fullPath + ".ID", {
            type: "state",
            common: {
                name: fullName + " ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myId = aPerson.id ? aPerson.id : "";
        adapter.setState(fullPath + ".ID", {val: myId, ack: true});


        adapter.setObjectNotExists(fullPath + ".OUT_OF_SIGHT", {
            type: "state",
            common: {
                name: fullName + " OUT_OF_SIGHT",
                type: "state",
                read: true,
                write: false
            }
        });
        var myOut_of_sight = aPerson.out_of_sight ? aPerson.out_of_sight : "";
        adapter.setState(fullPath + ".OUT_OF_SIGHT", {val: myOut_of_sight, ack: true});


        adapter.setObjectNotExists(fullPath + ".AT_HOME", {
            type: "state",
            common: {
                name: fullName + " AT_HOME",
                type: "state",
                read: true,
                write: false
            }
        });
        var myAt_Home = aPerson.out_of_sight ? !aPerson.out_of_sight : "";
        adapter.setState(fullPath + ".AT_HOME", {val: myAt_Home, ack: true});


        adapter.setObjectNotExists(fullPath + ".LAST_SEEN", {
            type: "state",
            common: {
                name: fullName + " LAST_SEEN",
                type: "date",
                read: true,
                write: false
            }
        });
        var myLast_seen = aPerson.last_seen ? new Date(aPerson.last_seen * 1000) : "";
        adapter.setState(fullPath + ".LAST_SEEN", {val: myLast_seen, ack: true});


        if (aPerson.face !== "undefined") {
            handleFace(aPerson.face, fullPath, fullName);
        }

    }


    function handleFace(aFace, fullPath, fullName) {

        adapter.setObjectNotExists(fullPath + ".FACE_ID", {
            type: "state",
            common: {
                name: fullName + " FACE_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myId = aFace.id ? aFace.id : "";
        adapter.setState(fullPath + ".FACE_ID", {val: myId, ack: true});


        adapter.setObjectNotExists(fullPath + ".FACE_KEY", {
            type: "state",
            common: {
                name: fullName + " FACE_KEY",
                type: "string",
                read: true,
                write: false
            }
        });
        var myKey = aFace.key ? aFace.key : "";
        adapter.setState(fullPath + ".FACE_KEY", {val: myKey, ack: true});


        adapter.setObjectNotExists(fullPath + ".FACE_URL", {
            type: "state",
            common: {
                name: fullName + " FACE_URL",
                type: "string",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".FACE_URL", {val: "", ack: true});


        adapter.setObjectNotExists(fullPath + ".jpg", {
            type: "state",
            common: {
                name: fullName + " JPEG",
                type: "object",
                read: true,
                write: false
            }
        });
        adapter.setState(adapter.namespace + "." + fullPath + ".jpg", {val: "", ack: true});


        if (aFace.id && aFace.key) {
            api.getCameraPicture({"image_id": aFace.id, "key": aFace.key}, function (err, data) {
                if (err !== null)
                    adapter.log.error(err);
                else {
                    adapter.setState(fullPath + ".FACE_URL", {val: adapter.namespace + "." + fullPath + ".jpg", ack: true});
                    adapter.setBinaryState(adapter.namespace + "." + fullPath + ".jpg", data);
                }
            });
        }


        adapter.setObjectNotExists(fullPath + ".FACE_VERSION", {
            type: "state",
            common: {
                name: fullName + " FACE_VERSION",
                type: "string",
                read: true,
                write: false
            }
        });
        var myVersion = aFace.version ? aFace.version : "";
        adapter.setState(fullPath + ".FACE_VERSION", {val: myVersion, ack: true});

    }



    function handleEvent(aEvent, homeName) {

        var fullPath = homeName  + "_EVENT";
        var fullName = homeName  + " EVENT";

        adapter.setObjectNotExists(fullPath, {
            type: "device",
            common: {
                name: fullName,
                type: "string",
                read: true,
                write: false
            }
        });

        iEvent += 1;
        fullPath += "." + iEvent;
        fullName += ":" + iEvent;

        if (fullPath) {
            adapter.setObjectNotExists(fullPath, {
                type: "channel",
                common: {
                    name: fullName,
                    type: "string",
                    read: true,
                    write: false
                }
            });
        }


        adapter.setObjectNotExists(fullPath + ".ID", {
            type: "state",
            common: {
                name: fullName + " ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myEventID = aEvent.id ? aEvent.id : "";
        adapter.setState(fullPath + ".ID", {val: myEventID, ack: true});


        adapter.setObjectNotExists(fullPath + ".MESSAGE", {
            type: "state",
            common: {
                name: fullName + " MESSAGE",
                type: "string",
                read: true,
                write: false
            }
        });
        var myMessage = aEvent.message ? aEvent.message : "";
        adapter.setState(fullPath + ".MESSAGE", {val: myMessage, ack: true});


        adapter.setObjectNotExists(fullPath + ".TYPE", {
            type: "state",
            common: {
                name: fullName + " TYPE",
                type: "string",
                read: true,
                write: false
            }
        });
        var myType = aEvent.type ? aEvent.type : "";
        adapter.setState(fullPath + ".TYPE", {val: myType, ack: true});


        adapter.setObjectNotExists(fullPath + ".TIME", {
            type: "state",
            common: {
                name: fullName + "TIME",
                type: "date",
                read: true,
                write: false
            }
        });
        var myTime = aEvent.time ? new Date(aEvent.time * 1000) : "";
        adapter.setState(fullPath + ".TIME", {val: myTime, ack: true});


        adapter.setObjectNotExists(fullPath + ".PERSON_ID", {
            type: "state",
            common: {
                name: fullName + " PERSON_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myPerson_id = aEvent.person_id ? aEvent.person_id : "";
        adapter.setState(fullPath + ".PERSON_ID", {val: myPerson_id, ack: true});


        adapter.setObjectNotExists(fullPath + ".CAMERA_ID", {
            type: "state",
            common: {
                name: fullName + " CAMERA_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myCamera_id = aEvent.camera_id ? aEvent.camera_id : "";
        adapter.setState(fullPath + ".CAMERA_ID", {val: myCamera_id, ack: true});


        adapter.setObjectNotExists(fullPath + ".SUB_TYPE", {
            type: "state",
            common: {
                name: fullName + " SUB_TYPE",
                type: "string",
                read: true,
                write: false
            }
        });
        var mySub_type = aEvent.sub_type ? aEvent.sub_type : "";
        adapter.setState(fullPath + ".SUB_TYPE", {val: mySub_type, ack: true});


        adapter.setObjectNotExists(fullPath + ".VIDEO_ID", {
            type: "state",
            common: {
                name: fullName + " VIDEO_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myVideo_id = aEvent.video_id ? aEvent.video_id : "";
        adapter.setState(fullPath + ".VIDEO_ID", {val: myVideo_id, ack: true});


        adapter.setObjectNotExists(fullPath + ".VIDEO_STATUS", {
            type: "state",
            common: {
                name: fullName + " VIDEO_STATUS",
                type: "string",
                read: true,
                write: false
            }
        });
        var myVideo_status = aEvent.video_status ? aEvent.video_status : "";
        adapter.setState(fullPath + ".VIDEO_STATUS", {val: myVideo_status, ack: true});


        adapter.setObjectNotExists(fullPath + ".IS_ARRIVAL", {
            type: "state",
            common: {
                name: fullName + " IS_ARRIVAL",
                type: "string",
                read: true,
                write: false
            }
        });
        var myIs_arrival = aEvent.is_arrival ? aEvent.is_arrival : "";
        adapter.setState(fullPath + ".IS_ARRIVAL", {val: myIs_arrival, ack: true});


        if (aEvent.snapshot) {
            handleSnapshot(aEvent.snapshot, fullPath, fullName);
        }
    }

    function handleSnapshot(aSnapshot, fullPath, fullName) {

        adapter.setObjectNotExists(fullPath + ".SNAPSHOT_ID", {
            type: "state",
            common: {
                name: fullName + " SNAPSHOT_ID",
                type: "string",
                read: true,
                write: false
            }
        });
        var myId = aSnapshot.id ? aSnapshot.id : "";
        adapter.setState(fullPath + ".SNAPSHOT_ID", {val: myId, ack: true});


        adapter.setObjectNotExists(fullPath + ".SNAPSHOT_KEY", {
            type: "state",
            common: {
                name: fullName + " SNAPSHOT_KEY",
                type: "string",
                read: true,
                write: false
            }
        });
        var myKey = aSnapshot.key ? aSnapshot.key : "";
        adapter.setState(fullPath + ".SNAPSHOT_KEY", {val: myKey, ack: true});


        adapter.setObjectNotExists(fullPath + ".SNAPSHOT_URL", {
            type: "state",
            common: {
                name: fullName + " SNAPSHOT_URL",
                type: "string",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".SNAPSHOT_URL", {val: "", ack: true});


        adapter.setObjectNotExists(fullPath + ".jpg", {
            type: "state",
            common: {
                name: fullName + "JPEG",
                type: "object",
                read: true,
                write: false
            }
        });
        adapter.setState(adapter.namespace + "." + fullPath + ".jpg", "");


        if (aSnapshot.id && aSnapshot.key) {

            api.getCameraPicture({"image_id": aSnapshot.id, "key": aSnapshot.key}, function (err, data) {
                if (err !== null)
                    adapter.log.error(err);
                else {
                    adapter.setState(fullPath + ".SNAPSHOT_URL", {val: adapter.namespace + "." + fullPath + ".jpg", ack: true});
                    adapter.setBinaryState(adapter.namespace + "." + fullPath + ".jpg", data);
                }
            });
        }

        adapter.setObjectNotExists(fullPath + ".SNAPSHOT_VERSION", {
            type: "state",
            common: {
                name: fullName + " SNAPSHOT_VERSION",
                type: "string",
                read: true,
                write: false
            }
        });
        var myVersion = aSnapshot.version ? aSnapshot.version : "";
        adapter.setState(fullPath + ".SNAPSHOT_VERSION", {val: myVersion, ack: true});
    }



    function setEventsJSON(home, arrEvents) {

        var myJSON = "[";
        var i = 0;
        if (Array.isArray(arrEvents)) {
            arrEvents.forEach(function (aEvent) {
                i++;

                myJSON += '{';
                myJSON += '"type": "' + aEvent.type + '", ';
                var myTime = new Date(aEvent.time * 1000);
                myJSON += '"time": "' + adapter.formatDate(myTime, "DD.MM.YY hh:mm") + '", ';
                myJSON += '"message": "' + aEvent.message + '", ';
                var URL = adapter.namespace + "." + home + "_EVENT." + i + ".jpg";
                myJSON += '"snapshot": "<a href=\\\"/state/' + URL + '\\\" target=\\\"_blank\\\"><img src=\\\"/state/' + URL + '\\\" height=\\\"40px\\\"/></a>"';
                myJSON += '}, ';
            });
        }
        myJSON = myJSON.slice(0, myJSON.lastIndexOf(","))  + "]";

        adapter.setObjectNotExists(home + ".0.EVENTS_JSON", {
            type: "state",
            common: {
                name: home +":0 EVENTS_JSON",
                type: "string",
                read: true,
                write: false
            }
        });
        adapter.setState(home + ".0.EVENTS_JSON", {val: myJSON, ack: true});

    }

}
