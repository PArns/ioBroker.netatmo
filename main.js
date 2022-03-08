/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const adapterName = require('./package.json').name.split('.').pop();
const utils = require('@iobroker/adapter-core');

const netatmo = require('./lib/netatmoLib');
let api = null;

const NetatmoCoach = require('./lib/netatmoCoach');
let coach = null;

const NetatmoStation = require('./lib/netatmoStation');
let station = null;

const NetatmoWelcome = require('./lib/netatmoWelcome');
let welcome = null;

const NetatmoSmokedetector = require('./lib/netatmoSmokedetector');
let smokedetector = null;

const NetatmoCOSensor = require('./lib/netatmoCOSensor');
let cosensor = null;

let _coachUpdateInterval;
let _weatherUpdateInterval;
let _welcomeUpdateInterval;
let _smokedetectorUpdateInterval;
let _cosensorUpdateInterval;

String.prototype.replaceAll = function (search, replacement) {
    const target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: adapterName, // adapter name
    });

    adapter = new utils.Adapter(options);
    adapter.on('message', obj => {
        if (obj.command === 'send') {
            obj.command = obj.message;
            obj.message = null;
        }

        if (obj) {
            switch (obj.command) {
                case 'setAway':
                    welcome && welcome.setAway(obj.message);

                    obj.callback && adapter.sendTo(obj.from, obj.command, {}, obj.callback);

                    break;
                default:
                    adapter.log.warn('Unknown command: ' + obj.command);
                    break;
            }
        }

        return true;
    });

    adapter.on('unload', callback => {
        try {
            _coachUpdateInterval && clearInterval(_coachUpdateInterval);
            _weatherUpdateInterval && clearInterval(_weatherUpdateInterval);
            _welcomeUpdateInterval && clearInterval(_welcomeUpdateInterval);
            _smokedetectorUpdateInterval && clearInterval(_smokedetectorUpdateInterval);
            _cosensorUpdateInterval && clearInterval(_cosensorUpdateInterval);

            welcome && welcome.finalize();
            smokedetector && smokedetector.finalize();
            cosensor && cosensor.finalize();

            adapter.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    });

    adapter.on('ready', main);
}

function main() {
    if (adapter.config.username && adapter.config.password) {
        let scope = '';
        let id = '574ddd152baa3cf9598b46cd';
        let secret = '6e3UcBKp005k9N0tpwp69fGYECqOpuhtEE9sWJW';
        let individualCredentials = false;

        if (adapter.config.id && adapter.config.secret) {
            id = adapter.config.id;
            secret = adapter.config.secret;
            individualCredentials = true;
            adapter.log.info(`Use individual ID/Secret`);
        }

        // Backward compatibility begin ...
        // --------------------------------------------------------
        // If nothing is set, activate at least the Weatherstation
        if (!(adapter.config.netatmoCoach || adapter.config.netatmoWeather || adapter.config.netatmoWelcome || adapter.config.netatmoSmokedetector || adapter.config.netatmoCOSensor)) {
            adapter.log.info('No product was chosen, using Weatherstation as default!');
            adapter.config.netatmoWeather = true;
        }

        adapter.config.check_interval = parseInt(adapter.config.check_interval, 10);
        adapter.config.cleanup_interval = parseInt(adapter.config.cleanup_interval, 10);

        // we do not allow intervals below 5 minutes
        if (!individualCredentials && isNaN(adapter.config.check_interval) || adapter.config.check_interval < 10) {
            adapter.config.check_interval = 10;
            adapter.log.warn(`Invalid check interval "${adapter.config.check_interval}", fallback to 10 minutes`);
        }

        if (!individualCredentials && isNaN(adapter.config.cleanup_interval) || adapter.config.cleanup_interval < 20) {
            adapter.config.cleanup_interval = 60;
            adapter.log.warn(`Invalid cleanup interval "${adapter.config.cleanup_interval}", fallback to 60 minutes`);
        }

        adapter.config.unknown_person_time = adapter.config.unknown_person_time || 24;

        adapter.config.location_elevation = adapter.config.location_elevation || 0;

        if (adapter.config.netatmoWeather) {
            scope += ' read_station';
        }

        if (adapter.config.netatmoCoach) {
            scope += ' read_homecoach';
        }

        // --------------------------------------------------------
        // Backward compatibility end ...

        if (adapter.config.netatmoWelcome) {
            scope += ' read_camera read_presence';

            if (individualCredentials) {
                scope += ' access_camera access_presence write_camera'
            }
        }

        if (adapter.config.netatmoSmokedetector) {
            scope += ' read_smokedetector';
        }

        if (adapter.config.netatmoCOSensor) {
            scope += ' read_carbonmonoxidedetector';
        }

        scope = scope.trim();

        const auth = {
            'client_id': id,
            'client_secret': secret,
            'scope': scope,
            'username': adapter.config.username,
            'password': adapter.config.password
        };

        api = new netatmo(auth);

        api.on('error', err => {
            adapter.log.warn(`API Error: ${err.message}`);
        });
        api.on('warning', err => {
            adapter.log.info(`API Warning: ${err.message}`);
        });

        api.setAdapter(adapter);

        if (adapter.config.netatmoCoach) {
            coach = new NetatmoCoach(api, adapter);

            coach.requestUpdateCoachStation();

            _coachUpdateInterval = setInterval(() =>
                coach.requestUpdateCoachStation(), adapter.config.check_interval * 60 * 1000);
        }

        if (adapter.config.netatmoWeather) {
            station = new NetatmoStation(api, adapter);

            station.requestUpdateWeatherStation();

            _weatherUpdateInterval = setInterval(() =>
                station.requestUpdateWeatherStation(), adapter.config.check_interval * 60 * 1000);
        }

        if (adapter.config.netatmoWelcome) {
            welcome = new NetatmoWelcome(api, adapter);
            welcome.init();
            welcome.requestUpdateIndoorCamera();

            _welcomeUpdateInterval = setInterval(() =>
                welcome.requestUpdateIndoorCamera(), adapter.config.check_interval * 2 * 60 * 1000);
        }

        if (adapter.config.netatmoSmokedetector) {
            smokedetector = new NetatmoSmokedetector(api, adapter);
            smokedetector.init();
            smokedetector.requestUpdateSmokedetector();

            _smokedetectorUpdateInterval = setInterval(() =>
                smokedetector.requestUpdateSmokedetector(), adapter.config.check_interval * 2 * 60 * 1000);
        }

        if (adapter.config.netatmoCOSensor) {
            cosensor = new NetatmoCOSensor(api, adapter);
            cosensor.init();
            cosensor.requestUpdateCOSensor();

            _cosensorUpdateInterval = setInterval(() =>
                cosensor.requestUpdateCOSensor(), adapter.config.check_interval * 2 * 60 * 1000);
        }
    } else {
        adapter.log.error('Please add username, password and choose at least one product within the adapter settings!');
    }
}

// If started as allInOne mode => return function to create instance
if (require.main === module) {
    startAdapter();
} else {
    // compact mode
    module.exports = startAdapter;
}

