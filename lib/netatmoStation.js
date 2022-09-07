module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;

    const DewPoint = require('dewpoint');

    this.requestUpdateWeatherStation = function () {
        api.getStationsData({}, async (err, data) => {
            adapter.log.debug(`Get WeatherStation data: ${JSON.stringify(data)}`);
            if (!err) {
                if (Array.isArray(data)) {
                    for (const aDevice of data) {
                        await handleDevice(aDevice);
                    }
                } else {
                    await handleDevice(data);
                }
            }
        });
    };

    function formatDeviceName(aDeviceName) {
        if (!aDeviceName) {
            return 'Unnamed';
        }

        return aDeviceName.replace(/ /g, '-').replace(/---/g, '-').replace(/--/g, '-').replace(adapter.FORBIDDEN_CHARS, '_').replace(/\s|\./g, '_');
    }

    async function handleDevice(aDevice, aParent) {
        if (aDevice.home_id && !aParent) {
            const homeId = aDevice.home_id.replace(/:/g, '-'); // formatDeviceName(aDevice.station_name);
            aParent = homeId;
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'folder',
                common: {
                    name: aDevice.home_name || aDevice.home_id,
                },
                native: {
                    type: aDevice.type,
                    id: aDevice._id
                }
            });
            await handleDevice(aDevice, aParent);
        } else {
            const deviceId = aDevice._id.replace(/:/g, '-'); // formatDeviceName(aDevice.module_name);
            const fullPath = aParent ? `${aParent}.${deviceId}` : deviceId;

            await adapter.extendOrSetObjectNotExistsAsync(fullPath, {
                type: aDevice.station_name ? 'device' : 'channel',
                common: {
                    name: aDevice.station_name || aDevice.module_name || aDevice._id,
                },
                native: {
                    type: aDevice.type,
                    id: aDevice._id
                }
            });

            await handleModule(aDevice, fullPath);

            if (aDevice.modules) {
                for (const aModule of aDevice.modules) {
                    await handleDevice(aModule, aParent);
                }
            }
        }
    }

    async function handleModule(aModule, aParent) {
        for (const aDeviceType of aModule.data_type) {
            switch (aDeviceType) {
                case 'Temperature':
                    await handleTemperature(aModule, aParent);
                    break;
                case 'CO2':
                    await handleCO2(aModule, aParent);
                    break;
                case 'Humidity':
                    await handleHumidity(aModule, aParent);
                    break;
                case 'Noise':
                    await handleNoise(aModule, aParent);
                    break;
                case 'Pressure':
                    await handlePressure(aModule, aParent);
                    break;
                case 'Rain':
                    await handleRain(aModule, aParent);
                    break;
                case 'Wind':
                    await handleWind(aModule, aParent);
                    break;
                default:
                    adapter.log.info(`UNKNOWN DEVICE TYPE: ${aDeviceType} ${JSON.stringify(aModule)}`);
                    break;
            }
        }

        if (aModule.dashboard_data && (typeof aModule.dashboard_data.Temperature) !== 'undefined' && (typeof aModule.dashboard_data.Humidity) !== 'undefined') {
            const dp = new DewPoint(myadapter.config.location_elevation);
            const point = dp.Calc(+aModule.dashboard_data.Temperature, +aModule.dashboard_data.Humidity);

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Temperature.DewPoint`, {
                type: 'state',
                common: {
                    name: 'Dew point temperature',
                    type: 'number',
                    role: 'value.temperature.dewpoint',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Humidity.AbsoluteHumidity`, {
                type: 'state',
                common: {
                    name: 'Absolute humidity in gram per kilogram air',
                    type: 'number',
                    role: 'value.humidity',
                    read: true,
                    write: false,
                    unit: 'g/kg'
                }
            });

            await adapter.setStateAsync(`${aParent}.Temperature.DewPoint`, {val: parseFloat(point.dp.toFixed(1)), ack: true});
            await adapter.setStateAsync(`${aParent}.Humidity.AbsoluteHumidity`, {val: parseFloat(point.x.toFixed(3)), ack: true});
        }

        if (aModule.wifi_status) {
            let wifiStatus = 'good';

            if (aModule.wifi_status > 85) {
                wifiStatus = 'bad';
            }
            else if (aModule.wifi_status > 70) {
                wifiStatus = 'average';
            }

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.WifiStatus`, {
                type: 'state',
                common: {
                    name: 'Wifi status',
                    type: 'string',
                    role: 'value',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.WifiStatus`, {val: wifiStatus, ack: true});
        }

        if (aModule.battery_percent) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.BatteryStatus`, {
                type: 'state',
                common: {
                    name: 'Battery status',
                    type: 'number',
                    role: 'value.battery',
                    read: true,
                    write: false,
                    min: 0,
                    max: 100,
                    unit: '%'
                }
            });

            await adapter.setStateAsync(`${aParent}.BatteryStatus`, {val: aModule.battery_percent, ack: true});
        }

        if (aModule.rf_status) {
            let rfStatus = 'good';

            if (aModule.rf_status > 85) {
                rfStatus = 'bad';
            }
            else if (aModule.rf_status > 70) {
                rfStatus = 'average';
            }

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.RfStatus`, {
                type: 'state',
                common: {
                    name: 'Radio status',
                    type: 'string',
                    role: 'value.rf',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.RfStatus`, {val: rfStatus, ack: true});
        }

        if (aModule.last_status_store) {
            const theDate = new Date(aModule.last_status_store * 1000);

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.LastUpdate`, {
                type: 'state',
                common: {
                    name: 'Last update',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.LastUpdate`, {val: theDate.toString(), ack: true});
        } else if (aModule.last_seen) {
            const theDate = new Date(aModule.last_seen * 1000);

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.LastUpdate`, {
                type: 'state',
                common: {
                    name: 'Last update',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.LastUpdate`, {val: theDate.toString(), ack: true});
        }
    }

    async function handleTemperature(aModule, aParent) {
        aParent += '.Temperature';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.Temperature !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Temperature',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Temperature`, {
                type: 'state',
                common: {
                    name: 'Temperature',
                    type: 'number',
                    role: 'value.temperature',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.setStateAsync(`${aParent}.Temperature`, {val: aModule.dashboard_data.Temperature, ack: true});


            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureAbsoluteMin`, {
                type: 'state',
                common: {
                    name: 'Absolute temperature minimum',
                    type: 'number',
                    role: 'value.temperature.min',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureAbsoluteMax`, {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum',
                    type: 'number',
                    role: 'value.temperature.max',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureAbsoluteMinDate`, {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum date',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureAbsoluteMaxDate`, {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum date',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            adapter.getState(`${aParent}.TemperatureAbsoluteMin`, async (err, state) => {
                if (!state || state.val > aModule.dashboard_data.Temperature) {
                    await adapter.setStateAsync(`${aParent}.TemperatureAbsoluteMin`, {
                        val: aModule.dashboard_data.Temperature,
                        ack: true
                    });
                    await adapter.setStateAsync(`${aParent}.TemperatureAbsoluteMinDate`, {
                        val: (new Date()).toString(),
                        ack: true
                    });
                }
            });

            adapter.getState(`${aParent}.TemperatureAbsoluteMax`, async (err, state) => {
                if (!state || state.val < aModule.dashboard_data.Temperature) {
                    await adapter.setStateAsync(`${aParent}.TemperatureAbsoluteMax`, {
                        val: aModule.dashboard_data.Temperature,
                        ack: true
                    });
                    await adapter.setStateAsync(`${aParent}.TemperatureAbsoluteMaxDate`, {
                        val: (new Date()).toString(),
                        ack: true
                    });
                }
            });
        }

        if (aModule.dashboard_data.min_temp !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureMin`, {
                type: 'state',
                common: {
                    name: 'Temperature minimum',
                    type: 'number',
                    role: 'value.temperature.min',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.setStateAsync(`${aParent}.TemperatureMin`, {val: aModule.dashboard_data.min_temp, ack: true});
        }

        if (aModule.dashboard_data.date_min_temp !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureMinDate`, {
                type: 'state',
                common: {
                    name: 'Temperature minimum date',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.TemperatureMinDate`, {
                val: (new Date(aModule.dashboard_data.date_min_temp * 1000)).toString(),
                ack: true
            });
        }

        if (aModule.dashboard_data.max_temp !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureMax`, {
                type: 'state',
                common: {
                    name: 'Temperature maximum',
                    type: 'number',
                    role: 'value.temperature.max',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.setStateAsync(`${aParent}.TemperatureMax`, {val: aModule.dashboard_data.max_temp, ack: true});
        }

        if (aModule.dashboard_data.date_max_temp !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureMaxDate`, {
                type: 'state',
                common: {
                    name: 'Temperature maximum date',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.TemperatureMaxDate`, {
                val: (new Date(aModule.dashboard_data.date_max_temp * 1000)).toString(),
                ack: true
            });
        }

        if (aModule.dashboard_data.temp_trend !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.TemperatureTrend`, {
                type: 'state',
                common: {
                    name: 'Temperature trend',
                    type: 'string',
                    role: 'value.direction',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.TemperatureTrend`, {val: aModule.dashboard_data.temp_trend, ack: true});
        }
    }

    async function handleCO2(aModule, aParent) {
        aParent += '.CO2';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.CO2 !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'CO2',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.CO2`, {
                type: 'state',
                common: {
                    name: 'CO2',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'ppm'
                }
            });

            await adapter.setStateAsync(`${aParent}.CO2`, {val: aModule.dashboard_data.CO2, ack: true});
        }

        if (aModule.co2_calibrating !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Calibrating`, {
                type: 'state',
                common: {
                    name: 'Calibrating',
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.Calibrating`, {val: aModule.co2_calibrating, ack: true});
        }
    }

    async function handleHumidity(aModule, aParent) {
        aParent += '.Humidity';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.Humidity !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Humidity',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Humidity`, {
                type: 'state',
                common: {
                    name: 'Humidity',
                    type: 'number',
                    role: 'value.humidity',
                    read: true,
                    write: false,
                    unit: '%'
                }
            });

            await adapter.setStateAsync(`${aParent}.Humidity`, {val: aModule.dashboard_data.Humidity, ack: true});
        }
    }

    async function handleNoise(aModule, aParent) {
        aParent += '.Noise';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.Noise !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Noise',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Noise`, {
                type: 'state',
                common: {
                    name: 'Noise',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'dB'
                }
            });

            await adapter.setStateAsync(`${aParent}.Noise`, {val: aModule.dashboard_data.Noise, ack: true});
        }
    }

    async function handlePressure(aModule, aParent) {
        aParent += '.Pressure';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.Pressure !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Pressure',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Pressure`, {
                type: 'state',
                common: {
                    name: 'Pressure',
                    type: 'number',
                    role: 'value.pressure',
                    read: true,
                    write: false,
                    unit: 'mbar'
                }
            });

            await adapter.setStateAsync(`${aParent}.Pressure`, {val: aModule.dashboard_data.Pressure, ack: true});
        }

        if (aModule.dashboard_data.AbsolutePressure !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.AbsolutePressure`, {
                type: 'state',
                common: {
                    name: 'Absolute pressure',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'mbar'
                }
            });

            await adapter.setStateAsync(`${aParent}.AbsolutePressure`, {val: aModule.dashboard_data.AbsolutePressure, ack: true});
        }

        if (aModule.dashboard_data.pressure_trend !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.PressureTrend`, {
                type: 'state',
                common: {
                    name: 'Pressure trend',
                    type: 'string',
                    role: 'value.direction',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(`${aParent}.PressureTrend`, {val: aModule.dashboard_data.pressure_trend, ack: true});
        }
    }

    async function handleRain(aModule, aParent) {
        aParent += '.Rain';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.Rain !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Rain',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.Rain`, {
                type: 'state',
                common: {
                    name: 'Rain',
                    type: 'number',
                    role: 'value.rain.today',
                    read: true,
                    write: false,
                    unit: 'mm'
                }
            });

            await adapter.setStateAsync(`${aParent}.Rain`, {val: aModule.dashboard_data.Rain, ack: true});
        }

        if (aModule.dashboard_data.sum_rain_1 !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain1`, {
                type: 'state',
                common: {
                    name: 'Rain in the last hour',
                    type: 'number',
                    role: 'value.rain.hour',
                    read: true,
                    write: false,
                    unit: 'mm'
                }
            });

            await adapter.setStateAsync(`${aParent}.SumRain1`, {val: aModule.dashboard_data.sum_rain_1, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain1Max`, {
                type: 'state',
                common: {
                    name: 'Absolute rain in 1 hour maximum',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'mm'
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain1MaxDate`, {
                type: 'state',
                common: {
                    name: 'Absolute rain in 1 hour maximum date',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            adapter.getState(`${aParent}.SumRain1Max`, async (err, state) => {
                if (!state || state.val < aModule.dashboard_data.sum_rain_1) {
                    await adapter.setStateAsync(`${aParent}.SumRain1Max`, {val: aModule.dashboard_data.sum_rain_1, ack: true});
                    await adapter.setStateAsync(`${aParent}.SumRain1MaxDate`, {val: (new Date()).toString(), ack: true});
                }
            });
        }

        if (aModule.dashboard_data.sum_rain_24 !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain24`, {
                type: 'state',
                common: {
                    name: 'Rain in the last 24 hours',
                    type: 'number',
                    role: 'value.rain',
                    read: true,
                    write: false,
                    unit: 'mm'
                }
            });

            await adapter.setStateAsync(`${aParent}.SumRain24`, {val: aModule.dashboard_data.sum_rain_24, ack: true});

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain24Max`, {
                type: 'state',
                common: {
                    name: 'Absolute rain in 24 hours maximum',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'mm'
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.SumRain24MaxDate`, {
                type: 'state',
                common: {
                    name: 'Absolute rain in 24 hours maximum date',
                    type: 'string',
                    role: 'value.date',
                    read: true,
                    write: false
                }
            });

            adapter.getState(`${aParent}.SumRain24Max`, async (err, state) => {
                if (!state || state.val < aModule.dashboard_data.sum_rain_24) {
                    await adapter.setStateAsync(`${aParent}.SumRain24Max`, {val: aModule.dashboard_data.sum_rain_24, ack: true});
                    await adapter.setStateAsync(`${aParent}.SumRain24MaxDate`, {val: new Date().toString(), ack: true});
                }
            });
        }
    }

    async function handleWind(aModule, aParent) {
        aParent += '.Wind';

        if (!aModule.dashboard_data) {
            return;
        }

        if (aModule.dashboard_data.WindStrength !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Wind',
                }
            });

            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.WindStrength`, {
                type: 'state',
                common: {
                    name: 'Wind strength',
                    type: 'number',
                    role: 'value.speed.wind',
                    read: true,
                    write: false,
                    unit: 'km/h'
                }
            });

            await adapter.setStateAsync(`${aParent}.WindStrength`, {val: aModule.dashboard_data.WindStrength, ack: true});
        }

        if (aModule.dashboard_data.WindAngle !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.WindAngle`, {
                type: 'state',
                common: {
                    name: 'Wind angle',
                    type: 'number',
                    role: 'value.direction.wind',
                    read: true,
                    write: false,
                    unit: '°'
                }
            });

            await adapter.setStateAsync(`${aParent}.WindAngle`, {val: aModule.dashboard_data.WindAngle, ack: true});
        }

        if (aModule.dashboard_data.GustStrength !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.GustStrength`, {
                type: 'state',
                common: {
                    name: 'Wind strength',
                    type: 'number',
                    role: 'value.speed.wind.gust',
                    read: true,
                    write: false,
                    unit: 'km/h'
                }
            });

            await adapter.setStateAsync(`${aParent}.GustStrength`, {val: aModule.dashboard_data.GustStrength, ack: true});
        }

        if (aModule.dashboard_data.GustAngle !== undefined) {
            await adapter.extendOrSetObjectNotExistsAsync(`${aParent}.GustAngle`, {
                type: 'state',
                common: {
                    name: 'Gust angle',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: '°'
                }
            });

            await adapter.setStateAsync(`${aParent}.GustAngle`, {val: aModule.dashboard_data.GustAngle, ack: true});
        }
    }
};
