module.exports = function (myapi, myadapter) {

    var api = myapi;
    var adapter = myadapter;

    var dewpoint = require('dewpoint');

    this.requestUpdateCoachStation = function () {
        api.getCoachData({}, function (err, data) {
            if (err === null) {
                if (Array.isArray(data)) {
                    data.forEach(function (aDevice) {
                        handleDevice(aDevice);
                    });
                } else {
                    handleDevice(data);
                }
            } else {

            }
        });
    };

    function getDeviceName(aDeviceName) {
        if (!aDeviceName)
            return "Unnamed";

        return aDeviceName.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
    }

    function handleDevice(aDevice, aParent) {
        var deviceName = getDeviceName(aDevice.name);
        aParent = aParent ? aParent + "." + deviceName : deviceName;
        adapter.setObject(aParent, {
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
            handleCoachModule(aDevice, aParent);
        });

    }

    function handleCoachModule(aModule, aParent) {
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
                case "health_idx":
                    handleHealthIdx(aModule, aParent);
                    break;
                default:
                    adapter.log.info("UNKNOWN DEVICE TYPE: " + aDeviceType + " " + JSON.stringify(aModule));
                    break;
            }
        });


        if (aModule.dashboard_data && (typeof aModule.dashboard_data.Temperature) !== "undefined" && (typeof aModule.dashboard_data.Humidity) !== "undefined") {
            var dp = new dewpoint(myadapter.config.location_elevation);
            var point = dp.Calc(+aModule.dashboard_data.Temperature, +aModule.dashboard_data.Humidity);

            adapter.setObjectNotExists(aParent + ".Temperature.DewPoint", {
                type: "state",
                common: {
                    name: "Dew point temperature",
                    type: "number",
                    role: "indicator.temperature",
                    read: true,
                    write: false,
                    unit: "°C"
                }
            });

            adapter.setObjectNotExists(aParent + ".Humidity.AbsoluteHumidity", {
                type: "state",
                common: {
                    name: "Absolute humidity in gram per kilogram air",
                    type: "number",
                    role: "indicator.humidity",
                    read: true,
                    write: false,
                    unit: "g/kg"
                }
            });

            adapter.setState(aParent + ".Temperature.DewPoint", {val: point.dp.toFixed(1), ack: true});
            adapter.setState(aParent + ".Humidity.AbsoluteHumidity", {val: point.x.toFixed(3), ack: true});
        }

        if (aModule._id) {
            adapter.setObjectNotExists(aParent + "._id", {
                type: "state",
                common: {
                    name: "_id",
                    type: "string",
                    role: "indicator._id",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + "._id", {val: aModule._id, ack: true});
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

        if (aModule.place.city)
            handlePlace(aModule, aParent);

        if (aModule.type) {
            adapter.setObjectNotExists(aParent + ".type", {
                type: "state",
                common: {
                    name: "type",
                    type: "string",
                    role: "indicator.type",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".type", {val: aModule.type, ack: true});
        }

        if (aModule.date_setup) {
            var theDate4 = new Date(aModule.date_setup * 1000);

            adapter.setObjectNotExists(aParent + ".date_setup", {
                type: "state",
                common: {
                    name: "date setup",
                    type: "datetime",
                    role: "indicator.date",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".date_setup", {val: theDate4.toString(), ack: true});
        }

        if (aModule.last_setup) {
            var theDate3 = new Date(aModule.last_setup * 1000);

            adapter.setObjectNotExists(aParent + ".last_setup", {
                type: "state",
                common: {
                    name: "Last setup",
                    type: "datetime",
                    role: "indicator.date",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".last_setup", {val: theDate3.toString(), ack: true});
        }

        if (aModule.firmware) {
            adapter.setObjectNotExists(aParent + ".firmware", {
                type: "state",
                common: {
                    name: "firmware",
                    type: "number",
                    role: "indicator.firmware",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".firmware", {val: aModule.firmware, ack: true});
        }

        if (aModule.last_upgrade) {
            var theDate2 = new Date(aModule.last_upgrade * 1000);

            adapter.setObjectNotExists(aParent + ".Last_fw_Ugrade", {
                type: "state",
                common: {
                    name: "Last firmware upgrate",
                    type: "datetime",
                    role: "indicator.date",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".Last_fw_Ugrade", {val: theDate2.toString(), ack: true});
        }

        if (aModule.wifi_status) {
            var wifi_status = "good";

            if (aModule.wifi_status > 85)
                wifi_status = "bad";
            else if (aModule.wifi_status > 70)
                wifi_status = "average";

            adapter.setObjectNotExists(aParent + ".wifi_status", {
                type: "state",
                common: {
                    name: "WiFi status",
                    type: "string",
                    role: "indicator.wifi_status",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".wifi_status", {val: wifi_status, ack: true});

            adapter.setObjectNotExists(aParent + ".wifi_status_num", {
                type: "state",
                common: {
                    name: "WiFi status NUM",
                    type: "number",
                    role: "indicator.wifi_status_num",
                    read: true,
                    write: false
                }
            });

            adapter.setState(aParent + ".wifi_status_num", {val: aModule.wifi_status, ack: true});
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
                    adapter.setState(aParent + ".TemperatureAbsoluteMinDate", {
                        val: (new Date()).toString(),
                        ack: true
                    });
                }
            });

            adapter.getState(aParent + ".TemperatureAbsoluteMax", function (err, state) {
                if (!state || state.val < aModule.dashboard_data.Temperature) {
                    adapter.setState(aParent + ".TemperatureAbsoluteMax", {
                        val: aModule.dashboard_data.Temperature,
                        ack: true
                    });
                    adapter.setState(aParent + ".TemperatureAbsoluteMaxDate", {
                        val: (new Date()).toString(),
                        ack: true
                    });
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

    function handleHealthIdx(aModule, aParent) {
        aParent += ".HealthIdx";

        if (!aModule.dashboard_data)
            return;

        if (typeof aModule.dashboard_data.health_idx !== "undefined") {
            adapter.setObjectNotExists(aParent + ".HealthIdx", {
                type: "state",
                common: {
                    name: "Health Index",
                    type: "number",
                    role: "indicator.HealthIdx",
                    read: true,
                    write: false,
                }
            });

            adapter.setState(aParent + ".HealthIdx", {val: aModule.dashboard_data.health_idx, ack: true});

            adapter.setObjectNotExists(aParent + ".HealthIdxString", {
                type: "state",
                common: {
                    name: "Health Index (String)",
                    type: "string",
                    role: "indicator.HealthIdxStr",
                    read: true,
                    write: false,
                }
            });

            var health_status = "unknown";
            switch (aModule.dashboard_data.health_idx) {
                case 0:
                    health_status = "0 = Healthy";
                    break;
                case 1:
                    health_status = "1 = Fine";
                    break;
                case 2:
                    health_status = "2 = Fair";
                    break;
                case 3:
                    health_status = "3 = Poor";
                    break;
                case 4:
                    health_status = "4 = Unhealthy";
                    break;
                default:
                    health_status = "unkonwn IDX";
                    break;
            }

            adapter.setState(aParent + ".HealthIdxString", {val: health_status, ack: true});
        }
    }

    function handlePlace(aModule, aParent) {
        aParent += ".Place";

        if (typeof aModule.place.city !== "undefined") {
            adapter.setObjectNotExists(aParent + ".city", {
                type: "state",
                common: {
                    name: "city",
                    type: "string",
                    role: "indicator.city",
                    read: true,
                    write: false,
                }
            });

            adapter.setState(aParent + ".city", {val: aModule.place.city, ack: true});
        }
        if (typeof aModule.place.country !== "undefined") {
            adapter.setObjectNotExists(aParent + ".country", {
                type: "state",
                common: {
                    name: "country",
                    type: "string",
                    role: "indicator.country",
                    read: true,
                    write: false,
                }
            });

            adapter.setState(aParent + ".country", {val: aModule.place.country, ack: true});
        }
        if (typeof aModule.place.timezone !== "undefined") {
            adapter.setObjectNotExists(aParent + ".timezone", {
                type: "state",
                common: {
                    name: "timezone",
                    type: "string",
                    role: "indicator.timezone",
                    read: true,
                    write: false,
                }
            });

            adapter.setState(aParent + ".timezone", {val: aModule.place.timezone, ack: true});
        }
        if (typeof aModule.place.location !== "undefined") {
            adapter.setObjectNotExists(aParent + ".location", {
                type: "state",
                common: {
                    name: "location",
                    type: "string",
                    role: "indicator.location",
                    read: true,
                    write: false,
                }
            });

            adapter.setState(aParent + ".location", {val: aModule.place.location, ack: true});
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
};