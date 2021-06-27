module.exports = function (myapi, myadapter) {
    const api = myapi;
    const adapter = myadapter;

    const DewPoint = require('dewpoint');

    this.requestUpdateCoachStation = function () {
        api.getCoachData({}, (err, data) => {
            if (err === null) {
                if (Array.isArray(data)) {
                    data.forEach(aDevice => handleDevice(aDevice));
                } else {
                    handleDevice(data);
                }
            } else {

            }
        });
    };

    function getDeviceName(aDeviceName) {
        if (!aDeviceName) {
            return 'Unnamed';
        }

        return aDeviceName.replaceAll(' ', '-').replaceAll('---', '-').replaceAll('--', '-');
    }

    async function handleDevice(aDevice, aParent) {
        const deviceName = getDeviceName(aDevice.station_name || aDevice.name);
        aParent = aParent ? aParent + '.' + deviceName : deviceName;
        await adapter.setObjectNotExistsAsync(aParent, {
            type: 'device',
            common: {
                name: deviceName,
            },
            native: {
                id: aDevice._id,
                type: aDevice.type
            }
        }, () => handleCoachModule(aDevice, aParent)
        );
    }

    async function handleCoachModule(aModule, aParent) {
        aModule.data_type.forEach(async aDeviceType => {
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
                case 'health_idx':
                    await handleHealthIdx(aModule, aParent);
                    break;
                default:
                    adapter.log.info(`UNKNOWN DEVICE TYPE: ${aDeviceType} ${JSON.stringify(aModule)}`);
                    break;
            }
        });

        if (aModule.dashboard_data && (typeof aModule.dashboard_data.Temperature) !== 'undefined' && (typeof aModule.dashboard_data.Humidity) !== 'undefined') {
            const dp = new DewPoint(myadapter.config.location_elevation);
            const point = dp.Calc(+aModule.dashboard_data.Temperature, +aModule.dashboard_data.Humidity);

            await adapter.setObjectNotExistsAsync(aParent + '.Temperature.DewPoint', {
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

            await adapter.setObjectNotExistsAsync(aParent + '.Humidity.AbsoluteHumidity', {
                type: 'state',
                common: {
                    name: 'Absolute humidity in gram per kilogram air',
                    type: 'number',
                    role: 'value.humidity.absolute',
                    read: true,
                    write: false,
                    unit: 'g/kg'
                }
            });

            await adapter.setStateAsync(aParent + '.Temperature.DewPoint', {val: parseFloat(point.dp.toFixed(1)), ack: true});
            await adapter.setStateAsync(aParent + '.Humidity.AbsoluteHumidity', {val: parseFloat(point.x.toFixed(3)), ack: true});
        }

        if (aModule._id) {
            await adapter.setObjectNotExistsAsync(aParent + '._id', {
                type: 'state',
                common: {
                    name: '_id',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '._id', {val: aModule._id, ack: true});
        }

        if (aModule.last_status_store) {
            const theDate = new Date(aModule.last_status_store * 1000);

            await adapter.setObjectNotExistsAsync(aParent + '.LastUpdate', {
                type: 'state',
                common: {
                    name: 'Last update',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.LastUpdate', {val: theDate.toString(), ack: true});
        }

        if (aModule.place.city) {
            await handlePlace(aModule, aParent);
        }

        if (aModule.type) {
            await adapter.setObjectNotExistsAsync(aParent + '.type', {
                type: 'state',
                common: {
                    name: 'type',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.type', {val: aModule.type, ack: true});
        }

        if (aModule.date_setup) {
            const theDate4 = new Date(aModule.date_setup * 1000);

            await adapter.setObjectNotExistsAsync(aParent + '.date_setup', {
                type: 'state',
                common: {
                    name: 'date setup',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.date_setup', {val: theDate4.toString(), ack: true});
        }

        if (aModule.last_setup) {
            const theDate3 = new Date(aModule.last_setup * 1000);

            await adapter.setObjectNotExistsAsync(aParent + '.last_setup', {
                type: 'state',
                common: {
                    name: 'Last setup',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.last_setup', {val: theDate3.toString(), ack: true});
        }

        if (aModule.firmware) {
            await adapter.setObjectNotExistsAsync(aParent + '.firmware', {
                type: 'state',
                common: {
                    name: 'firmware',
                    type: 'number',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.firmware', {val: aModule.firmware, ack: true});
        }

        if (aModule.last_upgrade) {
            const theDate2 = new Date(aModule.last_upgrade * 1000);

            await adapter.setObjectNotExistsAsync(aParent + '.Last_fw_Upgrade', {
                type: 'state',
                common: {
                    name: 'Last firmware upgrade',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.Last_fw_Upgrade', {val: theDate2.toString(), ack: true});
        }

        if (aModule.wifi_status) {
            let wifi_status = 'good';

            if (aModule.wifi_status > 85) {
                wifi_status = 'bad';
            }
            else if (aModule.wifi_status > 70) {
                wifi_status = 'average';
            }

            await adapter.setObjectNotExistsAsync(aParent + '.wifi_status', {
                type: 'state',
                common: {
                    name: 'WiFi status',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.wifi_status', {val: wifi_status, ack: true});

            await adapter.setObjectNotExistsAsync(aParent + '.wifi_status_num', {
                type: 'state',
                common: {
                    name: 'WiFi status NUM',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.wifi_status_num', {val: aModule.wifi_status, ack: true});
        }
    }

    async function handleTemperature(aModule, aParent) {
        aParent += '.Temperature';

        if (!aModule.dashboard_data)
            return;

        if (typeof aModule.dashboard_data.Temperature !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Temperature',
                    role: 'temperature'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.Temperature', {
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

            await adapter.setStateAsync(aParent + '.Temperature', {val: aModule.dashboard_data.Temperature, ack: true});

            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureAbsoluteMin', {
                type: 'state',
                common: {
                    name: 'Absolute temperature minimum',
                    type: 'number',
                    role: 'value.temperature.absolute.min',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureAbsoluteMax', {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum',
                    type: 'number',
                    role: 'value.temperature.absolute.max',
                    read: true,
                    write: false,
                    unit: '°C'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureAbsoluteMinDate', {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum date',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureAbsoluteMaxDate', {
                type: 'state',
                common: {
                    name: 'Absolute temperature maximum date',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            adapter.getState(aParent + '.TemperatureAbsoluteMin', async (err, state) => {
                if (!state || state.val > aModule.dashboard_data.Temperature) {
                    await adapter.setStateAsync(aParent + '.TemperatureAbsoluteMin', {
                        val: aModule.dashboard_data.Temperature,
                        ack: true
                    });
                    await adapter.setStateAsync(aParent + '.TemperatureAbsoluteMinDate', {
                        val: new Date().toString(),
                        ack: true
                    });
                }
            });

            adapter.getState(aParent + '.TemperatureAbsoluteMax', async (err, state) => {
                if (!state || state.val < aModule.dashboard_data.Temperature) {
                    await adapter.setStateAsync(aParent + '.TemperatureAbsoluteMax', {
                        val: aModule.dashboard_data.Temperature,
                        ack: true
                    });
                    await adapter.setStateAsync(aParent + '.TemperatureAbsoluteMaxDate', {
                        val: new Date().toString(),
                        ack: true
                    });
                }
            });
        }

        if (typeof aModule.dashboard_data.min_temp !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureMin', {
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

            await adapter.setStateAsync(aParent + '.TemperatureMin', {val: aModule.dashboard_data.min_temp, ack: true});
        }

        if (typeof aModule.dashboard_data.date_min_temp !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureMinDate', {
                type: 'state',
                common: {
                    name: 'Temperature minimum date',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.TemperatureMinDate', {
                val: (new Date(aModule.dashboard_data.date_min_temp * 1000)).toString(),
                ack: true
            });
        }

        if (typeof aModule.dashboard_data.max_temp !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureMax', {
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

            await adapter.setStateAsync(aParent + '.TemperatureMax', {val: aModule.dashboard_data.max_temp, ack: true});
        }

        if (typeof aModule.dashboard_data.date_max_temp !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureMaxDate', {
                type: 'state',
                common: {
                    name: 'Temperature maximum date',
                    type: 'string',
                    role: 'value.datetime',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.TemperatureMaxDate', {
                val: (new Date(aModule.dashboard_data.date_max_temp * 1000)).toString(),
                ack: true
            });
        }

        if (typeof aModule.dashboard_data.temp_trend !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.TemperatureTrend', {
                type: 'state',
                common: {
                    name: 'Temperature trend',
                    type: 'string',
                    role: 'value.direction',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.TemperatureTrend', {val: aModule.dashboard_data.temp_trend, ack: true});
        }
    }

    async function handleCO2(aModule, aParent) {
        aParent += '.CO2';

        if (!aModule.dashboard_data) {
            return;
        }

        if (typeof aModule.dashboard_data.CO2 !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'CO2',
                    role: 'co2'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.CO2', {
                type: 'state',
                common: {
                    name: 'CO2',
                    type: 'number',
                    role: 'value.co2',
                    read: true,
                    write: false,
                    unit: 'ppm'
                }
            });

            await adapter.setStateAsync(aParent + '.CO2', {val: aModule.dashboard_data.CO2, ack: true});
        }

        if (typeof aModule.co2_calibrating !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.Calibrating', {
                type: 'state',
                common: {
                    name: 'Calibrating',
                    type: 'boolean',
                    role: 'indicator.calibrating',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.Calibrating', {val: aModule.co2_calibrating, ack: true});
        }
    }

    async function handleHumidity(aModule, aParent) {
        aParent += '.Humidity';

        if (!aModule.dashboard_data) {
            return;
        }

        if (typeof aModule.dashboard_data.Humidity !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Humidity',
                    role: 'humidity'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.Humidity', {
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

            await adapter.setStateAsync(aParent + '.Humidity', {val: aModule.dashboard_data.Humidity, ack: true});
        }
    }

    async function handleNoise(aModule, aParent) {
        aParent += '.Noise';

        if (!aModule.dashboard_data) {
            return;
        }

        if (typeof aModule.dashboard_data.Noise !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Noise',
                    role: 'noise'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.Noise', {
                type: 'state',
                common: {
                    name: 'Noise',
                    type: 'number',
                    role: 'value.noise',
                    read: true,
                    write: false,
                    unit: 'dB'
                }
            });

            await adapter.setStateAsync(aParent + '.Noise', {val: aModule.dashboard_data.Noise, ack: true});
        }
    }

    async function handleHealthIdx(aModule, aParent) {
        aParent += '.HealthIdx';

        if (!aModule.dashboard_data) {
            return;
        }

        if (typeof aModule.dashboard_data.health_idx !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Health index',
                    role: 'health'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.HealthIdx', {
                type: 'state',
                common: {
                    name: 'Health Index',
                    type: 'number',
                    role: 'value.health',
                    read: true,
                    write: false,
                }
            });

            await adapter.setStateAsync(aParent + '.HealthIdx', {val: aModule.dashboard_data.health_idx, ack: true});

            await adapter.setObjectNotExistsAsync(aParent + '.HealthIdxString', {
                type: 'state',
                common: {
                    name: 'Health Index (String)',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false,
                }
            });

            let health_status = 'unknown';
            switch (aModule.dashboard_data.health_idx) {
                case 0:
                    health_status = '0 = Healthy';
                    break;
                case 1:
                    health_status = '1 = Fine';
                    break;
                case 2:
                    health_status = '2 = Fair';
                    break;
                case 3:
                    health_status = '3 = Poor';
                    break;
                case 4:
                    health_status = '4 = Unhealthy';
                    break;
                default:
                    health_status = 'unknown IDX';
                    break;
            }

            await adapter.setStateAsync(aParent + '.HealthIdxString', {val: health_status, ack: true});
        }
    }

    async function handlePlace(aModule, aParent) {
        aParent += '.Place';

        if (!aModule.place) {
            return;
        }

        if (typeof aModule.place.city !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Place',
                    role: 'location'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.city', {
                type: 'state',
                common: {
                    name: 'city',
                    type: 'string',
                    role: 'location.city',
                    read: true,
                    write: false,
                }
            });

            await adapter.setStateAsync(aParent + '.city', {val: aModule.place.city, ack: true});
        }
        if (typeof aModule.place.country !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.country', {
                type: 'state',
                common: {
                    name: 'country',
                    type: 'string',
                    role: 'location.country',
                    read: true,
                    write: false,
                }
            });

            await adapter.setStateAsync(aParent + '.country', {val: aModule.place.country, ack: true});
        }
        if (typeof aModule.place.timezone !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.timezone', {
                type: 'state',
                common: {
                    name: 'timezone',
                    type: 'string',
                    role: 'state',
                    read: true,
                    write: false,
                }
            });

            await adapter.setStateAsync(aParent + '.timezone', {val: aModule.place.timezone, ack: true});
        }
        if (typeof aModule.place.location !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.location', {
                type: 'state',
                common: {
                    name: 'location',
                    type: 'string',
                    role: 'value.gps',
                    read: true,
                    write: false,
                }
            });
            await adapter.setStateAsync(aParent + '.location', {val: aModule.place.location[0] + ';' + aModule.place.location[1], ack: true});
        }
    }

    async function handlePressure(aModule, aParent) {
        aParent += '.Pressure';

        if (!aModule.dashboard_data) {
            return;
        }

        if (typeof aModule.dashboard_data.Pressure !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent, {
                type: 'channel',
                common: {
                    name: 'Pressure',
                    role: 'pressure'
                }
            });

            await adapter.setObjectNotExistsAsync(aParent + '.Pressure', {
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

            await adapter.setStateAsync(aParent + '.Pressure', {val: aModule.dashboard_data.Pressure, ack: true});
        }

        if (typeof aModule.dashboard_data.AbsolutePressure !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.AbsolutePressure', {
                type: 'state',
                common: {
                    name: 'Absolute pressure',
                    type: 'number',
                    role: 'value.pressure.absolute',
                    read: true,
                    write: false,
                    unit: 'mbar'
                }
            });

            await adapter.setStateAsync(aParent + '.AbsolutePressure', {val: aModule.dashboard_data.AbsolutePressure, ack: true});
        }

        if (typeof aModule.dashboard_data.pressure_trend !== 'undefined') {
            await adapter.setObjectNotExistsAsync(aParent + '.PressureTrend', {
                type: 'state',
                common: {
                    name: 'Pressure trend',
                    type: 'string',
                    role: 'value.direction',
                    read: true,
                    write: false
                }
            });

            await adapter.setStateAsync(aParent + '.PressureTrend', {val: aModule.dashboard_data.pressure_trend, ack: true});
        }
    }
};
