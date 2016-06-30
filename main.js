/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('netatmo');

var netatmo = require('netatmo-homey');
var api = null;

var _deviceUpdateTimer;

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

adapter.on('ready', function () {

    if (adapter.config.username && adapter.config.password && adapter.config.scope) {

        var auth = {
            "client_id": "574ddd152baa3cf9598b46cd",
            "client_secret": "6e3UcBKp005k9N0tpwp69fGYECqOpuhtEE9sWJW",
            "scope": adapter.config.scope,
            "username": adapter.config.username,
            "password": adapter.config.password
        };

        api = new netatmo(auth);

        if(adapter.config.scope == "read_station") {
            // Update all stations
            requestUpdateWeatherStation();
        }
        else if (adapter.config.scope == "read_camera") {
            // Update all stations
            requestUpdateIndoorCamera();
        }
    } else
        adapter.log.error("Please add username, password and product within the adapter settings!");
});

function requestUpdateWeatherStation() {
    api.getStationsData({}, function (err, data) {
        if (err !== null)
            adapter.log.error(err);
        else {
            if (Array.isArray(data)) {
                data.forEach(function (aDevice) {
                    handleDevice(aDevice);
                });
            } else {
                handleDevice(data);
            }
        }
    });

    _deviceUpdateTimer = setTimeout(requestUpdateWeatherStation, 1000 * 60 * 5);
}

function requestUpdateIndoorCamera() {

    adapter.log.error("Indoor camera under construction");

    api.getHomeData({}, function (err, data) {
        if (err !== null)
            adapter.log.error(err);
        else {
            var homes = data.homes;

            if (Array.isArray(homes)) {
                homes.forEach(function (aHome) {
                    handleHome(aHome);
                });
            } else {
                handleHome(homes);
            }
        }
    });

    _deviceUpdateTimer = setTimeout(requestUpdateIndoorCamera, 1000 * 60 * 5);
}

function getDeviceName(aDeviceName) {
    return aDeviceName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function handleDevice(aDevice, aParent) {
    if (aDevice.station_name && !aParent) {
        var stationName = getDeviceName(aDevice.station_name);
        aParent = aParent ? aParent + "." + stationName : stationName;
        handleDevice(aDevice, aParent);
    } else {
        var deviceName = getDeviceName(aDevice.module_name);
        var fullPath = aParent ? aParent + "." + deviceName : deviceName;


        adapter.setObject(fullPath, {
            type: "device",
            common: {
                name: deviceName,
                type: aDevice.type,
                read: true,
                write: false
            },
            native: {
                id: aDevice._id
            }
        }, function () {
            handleModule(aDevice, fullPath);

            if (aDevice.modules) {
                aDevice.modules.forEach(function (aModule) {
                    handleDevice(aModule, aParent);
                });
            }
        });
    }
}

function handleModule(aModule, aParent) {
    aModule.data_type.forEach(function (aDeviceType) {
        switch (aDeviceType) {
            case "Temperature":
                handleTemperature(aModule, aParent);
                break;
            case "CO2":
                handleCO2(aModule, aParent);
                break;
            case "Humidity":
                handleHumidity(aModule, aParent);
                break;
            case "Noise":
                handleNoise(aModule, aParent);
                break;
            case "Pressure":
                handlePressure(aModule, aParent);
                break;
            case "Rain":
                handleRain(aModule, aParent);
                break;
            case "Wind":
                handleWind(aModule, aParent);
            default:
                adapter.log.info("UNKNOWN DEVICE TYPE: " + aDeviceType + " " + JSON.stringify(aModule));
                break;
        }
    });

    if (aModule.wifi_status) {
        var wifiStatus = "good";

        if (aModule.wifi_status > 85)
            wifiStatus = "bad";
        else if (aModule.wifi_status > 70)
            wifiStatus = "average";

        adapter.setObjectNotExists(aParent + ".WifiStatus", {
            type: "state",
            common: {
                name: "Wifi status",
                type: "string",
                role: "indicator.wifi",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".WifiStatus", {val: wifiStatus, ack: true});
    }

    if (aModule.battery_percent) {
        adapter.setObjectNotExists(aParent + ".BatteryStatus", {
            type: "state",
            common: {
                name: "Battery status",
                type: "number",
                role: "indicator.battery",
                read: true,
                write: false,
                unit: "%"
            }
        });

        adapter.setState(aParent + ".BatteryStatus", {val: aModule.battery_percent, ack: true});
    }

    if (aModule.rf_status) {
        var rfStatus = "good";

        if (aModule.rf_status > 85)
            rfStatus = "bad";
        else if (aModule.rf_status > 70)
            rfStatus = "average";

        adapter.setObjectNotExists(aParent + ".RfStatus", {
            type: "state",
            common: {
                name: "Radio status",
                type: "string",
                role: "indicator.rf",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".RfStatus", {val: rfStatus, ack: true});
    }

    if (aModule.last_status_store) {
        var theDate = new Date(aModule.last_status_store * 1000);

        adapter.setObjectNotExists(aParent + ".LastUpdate", {
            type: "state",
            common: {
                name: "Last update",
                type: "datetime",
                role: "indicator.date",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".LastUpdate", {val: theDate.toString(), ack: true});
    }

    if (aModule.last_seen) {
        var theDate = new Date(aModule.last_seen * 1000);

        adapter.setObjectNotExists(aParent + ".LastUpdate", {
            type: "state",
            common: {
                name: "Last update",
                type: "datetime",
                role: "indicator.date",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".LastUpdate", {val: theDate.toString(), ack: true});
    }
}

function handleTemperature(aModule, aParent) {
    aParent += ".Temperature";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.Temperature !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Temperature", {
            type: "state",
            common: {
                name: "Temperature",
                type: "number",
                role: "indicator.temperature",
                read: true,
                write: false,
                unit: "°C"
            }
        });

        adapter.setState(aParent + ".Temperature", {val: aModule.dashboard_data.Temperature, ack: true});


        adapter.setObjectNotExists(aParent + ".TemperatureAbsoluteMin", {
            type: "state",
            common: {
                name: "Absolute temperature minimum",
                type: "number",
                role: "indicator.temperature",
                read: true,
                write: false,
                unit: "°C"
            }
        });

        adapter.setObjectNotExists(aParent + ".TemperatureAbsoluteMax", {
            type: "state",
            common: {
                name: "Absolute temperature maximum",
                type: "number",
                role: "indicator.temperature",
                read: true,
                write: false,
                unit: "°C"
            }
        });

        adapter.setObjectNotExists(aParent + ".TemperatureAbsoluteMinDate", {
            type: "state",
            common: {
                name: "Absolute temperature maximum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });

        adapter.setObjectNotExists(aParent + ".TemperatureAbsoluteMaxDate", {
            type: "state",
            common: {
                name: "Absolute temperature maximum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });


        adapter.getState(aParent + ".TemperatureAbsoluteMin", function (err, state) {
            if (!state || state.val > aModule.dashboard_data.Temperature) {
                adapter.setState(aParent + ".TemperatureAbsoluteMin", {
                    val: aModule.dashboard_data.Temperature,
                    ack: true
                });
                adapter.setState(aParent + ".TemperatureAbsoluteMinDate", {val: (new Date()).toString(), ack: true});
            }
        });

        adapter.getState(aParent + ".TemperatureAbsoluteMax", function (err, state) {
            if (!state || state.val < aModule.dashboard_data.Temperature) {
                adapter.setState(aParent + ".TemperatureAbsoluteMax", {
                    val: aModule.dashboard_data.Temperature,
                    ack: true
                });
                adapter.setState(aParent + ".TemperatureAbsoluteMaxDate", {val: (new Date()).toString(), ack: true});
            }
        });
    }


    if (typeof aModule.dashboard_data.min_temp !== "undefined") {
        adapter.setObjectNotExists(aParent + ".TemperatureMin", {
            type: "state",
            common: {
                name: "Temperature minimum",
                type: "number",
                role: "indicator.temperature",
                read: true,
                write: false,
                unit: "°C"
            }
        });

        adapter.setState(aParent + ".TemperatureMin", {val: aModule.dashboard_data.min_temp, ack: true});
    }

    if (typeof aModule.dashboard_data.date_min_temp !== "undefined") {
        adapter.setObjectNotExists(aParent + ".TemperatureMinDate", {
            type: "state",
            common: {
                name: "Temperature minimum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".TemperatureMinDate", {
            val: (new Date(aModule.dashboard_data.date_min_temp * 1000)).toString(),
            ack: true
        });
    }

    if (typeof aModule.dashboard_data.max_temp !== "undefined") {
        adapter.setObjectNotExists(aParent + ".TemperatureMax", {
            type: "state",
            common: {
                name: "Temperature maximum",
                type: "number",
                role: "indicator.temperature",
                read: true,
                write: false,
                unit: "°C"
            }
        });

        adapter.setState(aParent + ".TemperatureMax", {val: aModule.dashboard_data.max_temp, ack: true});
    }

    if (typeof aModule.dashboard_data.date_max_temp !== "undefined") {
        adapter.setObjectNotExists(aParent + ".TemperatureMaxDate", {
            type: "state",
            common: {
                name: "Temperature maximum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".TemperatureMaxDate", {
            val: (new Date(aModule.dashboard_data.date_max_temp * 1000)).toString(),
            ack: true
        });
    }

    if (typeof aModule.dashboard_data.temp_trend !== "undefined") {
        adapter.setObjectNotExists(aParent + ".TemperatureTrend", {
            type: "state",
            common: {
                name: "Temperature trend",
                type: "string",
                role: "indicator.trend",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".TemperatureTrend", {val: aModule.dashboard_data.temp_trend, ack: true});
    }
}

function handleCO2(aModule, aParent) {
    aParent += ".CO2";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.CO2 !== "undefined") {
        adapter.setObjectNotExists(aParent + ".CO2", {
            type: "state",
            common: {
                name: "CO2",
                type: "number",
                role: "indicator.co2",
                read: true,
                write: false,
                unit: "ppm"
            }
        });

        adapter.setState(aParent + ".CO2", {val: aModule.dashboard_data.CO2, ack: true});
    }

    if (typeof aModule.co2_calibrating !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Calibrating", {
            type: "state",
            common: {
                name: "Calibrating",
                type: "boolean",
                role: "indicator.calibrating",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".Calibrating", {val: aModule.co2_calibrating, ack: true});
    }
}

function handleHumidity(aModule, aParent) {
    aParent += ".Humidity";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.Humidity !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Humidity", {
            type: "state",
            common: {
                name: "Humidity",
                type: "number",
                role: "indicator.humidity",
                read: true,
                write: false,
                unit: "%"
            }
        });

        adapter.setState(aParent + ".Humidity", {val: aModule.dashboard_data.Humidity, ack: true});
    }
}

function handleNoise(aModule, aParent) {
    aParent += ".Noise";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.Noise !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Noise", {
            type: "state",
            common: {
                name: "Noise",
                type: "number",
                role: "indicator.noise",
                read: true,
                write: false,
                unit: "dB"
            }
        });

        adapter.setState(aParent + ".Noise", {val: aModule.dashboard_data.Noise, ack: true});
    }
}

function handlePressure(aModule, aParent) {
    aParent += ".Pressure";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.Pressure !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Pressure", {
            type: "state",
            common: {
                name: "Pressure",
                type: "number",
                role: "indicator.pressure",
                read: true,
                write: false,
                unit: "mbar"
            }
        });

        adapter.setState(aParent + ".Pressure", {val: aModule.dashboard_data.Pressure, ack: true});
    }

    if (typeof aModule.dashboard_data.AbsolutePressure !== "undefined") {
        adapter.setObjectNotExists(aParent + ".AbsolutePressure", {
            type: "state",
            common: {
                name: "Absolute pressure",
                type: "number",
                role: "indicator.pressure",
                read: true,
                write: false,
                unit: "mbar"
            }
        });

        adapter.setState(aParent + ".AbsolutePressure", {val: aModule.dashboard_data.AbsolutePressure, ack: true});
    }

    if (typeof aModule.dashboard_data.pressure_trend !== "undefined") {
        adapter.setObjectNotExists(aParent + ".PressureTrend", {
            type: "state",
            common: {
                name: "Pressure trend",
                type: "string",
                role: "indicator.trend",
                read: true,
                write: false
            }
        });

        adapter.setState(aParent + ".PressureTrend", {val: aModule.dashboard_data.pressure_trend, ack: true});
    }
}

function handleRain(aModule, aParent) {
    aParent += ".Rain";

    if (!aModule.dashboard_data)
        return;

    if (typeof aModule.dashboard_data.Rain !== "undefined") {
        adapter.setObjectNotExists(aParent + ".Rain", {
            type: "state",
            common: {
                name: "Rain",
                type: "number",
                role: "indicator.rain",
                read: true,
                write: false,
                unit: "mm"
            }
        });

        adapter.setState(aParent + ".Rain", {val: aModule.dashboard_data.Rain, ack: true});
    }

    if (typeof aModule.dashboard_data.sum_rain_1 !== "undefined") {
        adapter.setObjectNotExists(aParent + ".SumRain1", {
            type: "state",
            common: {
                name: "Rain in the last hour",
                type: "number",
                role: "indicator.rain",
                read: true,
                write: false,
                unit: "mm"
            }
        });

        adapter.setState(aParent + ".SumRain1", {val: aModule.dashboard_data.sum_rain_1, ack: true});

        adapter.setObjectNotExists(aParent + ".SumRain1Max", {
            type: "state",
            common: {
                name: "Absolute rain in 1 hour maximum",
                type: "number",
                role: "indicator.rain",
                read: true,
                write: false,
                unit: "mm"
            }
        });

        adapter.setObjectNotExists(aParent + ".SumRain1MaxDate", {
            type: "state",
            common: {
                name: "Absolute rain in 1 hour maximum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });

        adapter.getState(aParent + ".SumRain1Max", function (err, state) {
            if (!state || state.val < aModule.dashboard_data.sum_rain_1) {
                adapter.setState(aParent + ".SumRain1Max", {val: aModule.dashboard_data.sum_rain_1, ack: true});
                adapter.setState(aParent + ".SumRain1MaxDate", {val: (new Date()).toString(), ack: true});
            }
        });
    }

    if (typeof aModule.dashboard_data.sum_rain_24 !== "undefined") {
        adapter.setObjectNotExists(aParent + ".SumRain24", {
            type: "state",
            common: {
                name: "Rain in the last 24 hours",
                type: "number",
                role: "indicator.rain",
                read: true,
                write: false,
                unit: "mm"
            }
        });

        adapter.setState(aParent + ".SumRain24", {val: aModule.dashboard_data.sum_rain_24, ack: true});

        adapter.setObjectNotExists(aParent + ".SumRain24Max", {
            type: "state",
            common: {
                name: "Absolute rain in 24 hours maximum",
                type: "number",
                role: "indicator.rain",
                read: true,
                write: false,
                unit: "mm"
            }
        });

        adapter.setObjectNotExists(aParent + ".SumRain24MaxDate", {
            type: "state",
            common: {
                name: "Absolute rain in 24 hours maximum date",
                type: "string",
                role: "indicator.datetime",
                read: true,
                write: false
            }
        });

        adapter.getState(aParent + ".SumRain24Max", function (err, state) {
            if (!state || state.val < aModule.dashboard_data.sum_rain_24) {
                adapter.setState(aParent + ".SumRain24Max", {val: aModule.dashboard_data.sum_rain_24, ack: true});
                adapter.setState(aParent + ".SumRain24MaxDate", {val: (new Date()).toString(), ack: true});
            }
        });
    }
}

function handleWind(aModule, aParent) {
    aParent += ".Wind";

    if (typeof aModule.dashboard_data.WindStrength !== "undefined") {
        adapter.setObjectNotExists(aParent + ".WindStrength", {
            type: "state",
            common: {
                name: "Wind strength",
                type: "number",
                role: "indicator.windstrength",
                read: true,
                write: false,
                unit: "km/h"
            }
        });

        adapter.setState(aParent + ".WindStrength", {val: aModule.dashboard_data.WindStrength, ack: true});
    }

    if (typeof aModule.dashboard_data.WindAngle !== "undefined") {
        adapter.setObjectNotExists(aParent + ".WindAngle", {
            type: "state",
            common: {
                name: "Wind angle",
                type: "number",
                role: "indicator.windangle",
                read: true,
                write: false,
                unit: "°"
            }
        });

        adapter.setState(aParent + ".WindAngle", {val: aModule.dashboard_data.WindAngle, ack: true});
    }

    if (typeof aModule.dashboard_data.GustStrength !== "undefined") {
        adapter.setObjectNotExists(aParent + ".GustStrength", {
            type: "state",
            common: {
                name: "Wind strength",
                type: "number",
                role: "indicator.guststrength",
                read: true,
                write: false,
                unit: "km/h"
            }
        });

        adapter.setState(aParent + ".GustStrength", {val: aModule.dashboard_data.GustStrength, ack: true});
    }

    if (typeof aModule.dashboard_data.GustAngle !== "undefined") {
        adapter.setObjectNotExists(aParent + ".GustAngle", {
            type: "state",
            common: {
                name: "Gust angle",
                type: "number",
                role: "indicator.windangle",
                read: true,
                write: false,
                unit: "°"
            }
        });

        adapter.setState(aParent + ".GustAngle", {val: aModule.dashboard_data.GustAngle, ack: true});
    }
}


// Welcome Indoor Camera implementation
function getHomeName(aHomeName) {
    return aHomeName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function handleHome(aHome, aParent) {
    if (!aParent) {
        handleHome(aHome, "Welcome-Camera");
    } else {
        var homeName = getHomeName(aHome.name);
        var fullPath = aParent ? aParent + "." + homeName : homeName;

        adapter.setObject(fullPath, {
            type: "location",
            common: {
                name: homeName,
                type: "location",
                read: true,
                write: false
            },
            native: {
                id: aHome.id
            }
        }, function () {


            if (aHome.id) {
                adapter.setObjectNotExists(fullPath + ".id", {
                    type: "place",
                    common: {
                        name: "Home ID",
                        type: "string",
                        role: "indicator.place",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".id", {val: aHome.id, ack: true});
            }

            if (aHome.place) {
                handlePlace(aHome.place, fullPath);
            }

            if (aHome.cameras) {
                aHome.cameras.forEach(function (aCamera) {
                    handleCamera(aCamera, fullPath);
                });
            }

            if (aHome.persons) {
                aHome.persons.forEach(function (aPerson) {
                    handlePerson(aPerson, fullPath);
                });
            }

            if (aHome.events) {
                aHome.events.forEach(function (aEvent) {
                    handleEvent(aEvent, fullPath);
                });
            }

        });
    }
}

function handlePlace(aPlace, aParent) {
    var fullPath = aParent + ".Place";

    adapter.setObject(fullPath, {
        type: "place",
        common: {
            name: "place",
            type: "place",
            read: true,
            write: false
        }
    }, function () {

        if (aPlace.city) {
            adapter.setObjectNotExists(fullPath + ".city", {
                type: "place",
                common: {
                    name: "city",
                    type: "string",
                    role: "indicator.place",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".city", {val: aPlace.city, ack: true});
        }

        if (aPlace.country) {
            adapter.setObjectNotExists(fullPath + ".country", {
                type: "place",
                common: {
                    name: "country",
                    type: "string",
                    role: "indicator.place",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".country", {val: aPlace.country, ack: true});
        }

        if (aPlace.timezone) {
            adapter.setObjectNotExists(fullPath + ".timezone", {
                type: "place",
                common: {
                    name: "timezone",
                    type: "string",
                    role: "indicator.place",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".timezone", {val: aPlace.timezone, ack: true});
        }
    });
}

function getCameraName(aCameraName) {
    return aCameraName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function handleCamera(aCamera, aParent) {

    if (aCamera.type == "NACamera") {
        var aCameraName = getCameraName(aCamera.name);
        var fullPath = aParent ? aParent + ".Cameras." + aCameraName : ".Cameras." + aCameraName;

        adapter.setObject(fullPath, {
            type: "camera",
            common: {
                name: aCameraName,
                type: "camera",
                read: true,
                write: false
            },
            native: {
                id: aCamera.id,
                type: aCamera.type
            }
        }, function () {

            if (aCamera.id) {
                adapter.setObjectNotExists(fullPath + ".id", {
                    type: "camera",
                    common: {
                        name: "Camera ID",
                        type: "string",
                        role: "indicator.camera",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".id", {val: aCamera.id, ack: true});
            }

            if (aCamera.status) {
                adapter.setObjectNotExists(fullPath + ".status", {
                    type: "state",
                    common: {
                        name: "Monitoring State (on/off)",
                        type: "state",
                        role: "indicator.camera",
                        read: true,
                        write: false
                    },
                    native: {
                        status: aCamera.status
                    }
                });

                adapter.setState(fullPath + ".status", {val: aCamera.status, ack: true});
            }

            if (aCamera.sd_status) {
                adapter.setObjectNotExists(fullPath + ".sd_status", {
                    type: "state",
                    common: {
                        name: "SD card State (on/off)",
                        type: "state",
                        role: "indicator.camera",
                        read: true,
                        write: false
                    },
                    native: {
                        sd_status: aCamera.sd_status
                    }
                });

                adapter.setState(fullPath + ".sd_status", {val: aCamera.sd_status, ack: true});
            }

            if (aCamera.alim_status) {
                adapter.setObjectNotExists(fullPath + ".alim_status", {
                    type: "state",
                    common: {
                        name: "Power Supply State (on/off)",
                        type: "state",
                        role: "indicator.camera",
                        read: true,
                        write: false
                    },
                    native: {
                        alim_status: aCamera.alim_status
                    }
                });

                adapter.setState(fullPath + ".alim_status", {val: aCamera.alim_status, ack: true});
            }
        });
    }
}

function getPersonName(aPersonName) {
    return aPersonName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function handlePerson(aPerson, aParent) {

    var aPersonName;
    if(aPerson.pseudo){
        aPersonName = getPersonName(aPerson.pseudo);
    } else {
        aPersonName = "Unknown." + aPerson.id;
    }

    var fullPath = aParent ? aParent + ".Persons." + aPersonName : ".Persons." + aPersonName;

    adapter.setObject(fullPath, {
        type: "person",
        common: {
            name: aPersonName,
            type: "person",
            read: true,
            write: false
        },
        native: {
            id: aPerson.id
        }
    }, function () {

        if (aPerson.id) {
            adapter.setObjectNotExists(fullPath + ".id", {
                type: "person",
                common: {
                    name: "Person ID",
                    type: "string",
                    role: "indicator.person",
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
                    name: "Person away (true/false)",
                    type: "state",
                    role: "indicator.person",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".out_of_sight", {val: aPerson.out_of_sight, ack: true});
        }

        if (aPerson.last_seen) {
            adapter.setObjectNotExists(fullPath + ".last_seen", {
                type: "state",
                common: {
                    name: "Last seen",
                    type: "date",
                    role: "indicator.person",
                    read: true,
                    write: false
                }
            });

            adapter.setState(fullPath + ".last_seen", {
                val: (new Date(aPerson.last_seen * 1000)).toString(),
                ack: true
            });
        }
        if (aPerson.face !== "undefined") {
            handleFace(aPerson.face, fullPath);
        }
    });
}


function handleFace(aFace, aParent) {

    var fullPath = aParent + ".face";

    if (aFace.id) {
        adapter.setObjectNotExists(fullPath + ".id", {
            type: "face",
            common: {
                name: "Face ID",
                type: "string",
                role: "indicator.face",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".id", {val: aFace.id, ack: true});
    }

    if (aFace.key) {
        adapter.setObjectNotExists(fullPath + ".key", {
            type: "face",
            common: {
                name: "Face Key",
                type: "string",
                role: "indicator.face",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".key", {val: aFace.key, ack: true});
    }

    if (aFace.version) {
        adapter.setObjectNotExists(fullPath + ".version", {
            type: "face",
            common: {
                name: "Version",
                type: "string",
                role: "indicator.face",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".version", {val: aFace.version, ack: true});
    }
}

function handleEvent(aEvent, aParent) {

    if (aEvent.id != "undefined") {
        var fullPath = aParent ? aParent + ".Events." + aEvent.id : ".Events." + aEvent.id;

        adapter.setObject(fullPath, {
            type: "event",
            common: {
                name: aEvent.id,
                type: aEvent.type,
                read: true,
                write: false
            },
            native: {
                id: aEvent.id
            }
        }, function () {

            if (aEvent.id) {
                adapter.setObjectNotExists(fullPath + ".id", {
                    type: "event",
                    common: {
                        name: "Event ID",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".id", {val: aEvent.id, ack: true});
            }

            if (aEvent.message) {
                adapter.setObjectNotExists(fullPath + ".message", {
                    type: "event",
                    common: {
                        name: "Message",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".message", {val: aEvent.message, ack: true});
            }

            if (aEvent.type) {
                adapter.setObjectNotExists(fullPath + ".type", {
                    type: "event",
                    common: {
                        name: "Type",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".type", {val: aEvent.type, ack: true});
            }

            if (aEvent.time) {
                adapter.setObjectNotExists(fullPath + ".time", {
                    type: "event",
                    common: {
                        name: "Time",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".time", {
                    val: (new Date(aEvent.time * 1000)).toString(),
                    ack: true
                });
            }

            if (aEvent.person_id) {
                adapter.setObjectNotExists(fullPath + ".person_id", {
                    type: "event",
                    common: {
                        name: "Person ID",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".person_id", {val: aEvent.person_id, ack: true});
            }

            if (aEvent.camera_id) {
                adapter.setObjectNotExists(fullPath + ".camera_id", {
                    type: "event",
                    common: {
                        name: "Camera ID",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".camera_id", {val: aEvent.camera_id, ack: true});
            }

            if (aEvent.sub_type) {
                adapter.setObjectNotExists(fullPath + ".sub_type", {
                    type: "event",
                    common: {
                        name: "Sub Type",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".sub_type", {val: aEvent.sub_type, ack: true});
            }

            if (aEvent.video_id) {
                adapter.setObjectNotExists(fullPath + ".video_id", {
                    type: "event",
                    common: {
                        name: "Video ID",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".video_id", {val: aEvent.video_id, ack: true});
            }

            if (aEvent.video_status) {
                adapter.setObjectNotExists(fullPath + ".video_status", {
                    type: "event",
                    common: {
                        name: "Video Status",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".video_status", {val: aEvent.video_status, ack: true});
            }

            if (aEvent.is_arrival !== "undefined") {
                adapter.setObjectNotExists(fullPath + ".is_arrival", {
                    type: "event",
                    common: {
                        name: "Is Arrival",
                        type: "string",
                        role: "indicator.event",
                        read: true,
                        write: false
                    }
                });
                adapter.setState(fullPath + ".is_arrival", {val: aEvent.is_arrival, ack: true});
            }

            if (aEvent.snapshot) {
                handleSnapshot(aEvent.snapshot, fullPath);
            }

        });
    }
}

function handleSnapshot(aSnapshot, aParent) {

    var fullPath = aParent + ".snapshot";

    if (aSnapshot.id) {
        adapter.setObjectNotExists(fullPath + ".id", {
            type: "snapshot",
            common: {
                name: "Snapshot ID",
                type: "string",
                role: "indicator.snapshot",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".id", {val: aSnapshot.id, ack: true});
    }

    if (aSnapshot.key) {
        adapter.setObjectNotExists(fullPath + ".key", {
            type: "snapshot",
            common: {
                name: "Snapshot Key",
                type: "string",
                role: "indicator.snapshot",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".key", {val: aSnapshot.key, ack: true});
    }

    if (aSnapshot.version) {
        adapter.setObjectNotExists(fullPath + ".version", {
            type: "snapshot",
            common: {
                name: "Version",
                type: "string",
                role: "indicator.snapshot",
                read: true,
                write: false
            }
        });
        adapter.setState(fullPath + ".version", {val: aSnapshot.version, ack: true});
    }
}
