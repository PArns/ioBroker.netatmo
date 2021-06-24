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

let _deviceUpdateTimer;
let _welcomeUpdateTimer;

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

    adapter.on('unload', function (callback) {
        try {
            welcome && welcome.finalize();

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

        // Backward compatibility begin ...
        // --------------------------------------------------------
        // If nothing is set, activate at least the Weatherstation
        if (!(adapter.config.netatmoCoach || adapter.config.netatmoWeather || adapter.config.netatmoWelcome)) {
            adapter.log.info('No product was chosen, using Weatherstation as default!');
            adapter.config.netatmoWeather = true;
        }

        adapter.config.check_interval = adapter.config.check_interval || 10;

        adapter.config.cleanup_interval = adapter.config.cleanup_interval || 60;

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

            if (adapter.config.id && adapter.config.secret) {
                id = adapter.config.id;
                secret = adapter.config.secret;

                scope += ' access_camera access_presence write_camera'
            }
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

        api.setAdapter(adapter);

        if (adapter.config.netatmoCoach) {
            coach = new NetatmoCoach(api, adapter);

            coach.requestUpdateCoachStation();

            _deviceUpdateTimer = setInterval(() =>
                coach.requestUpdateCoachStation(), adapter.config.check_interval * 60 * 1000);
        }

        if (adapter.config.netatmoWeather) {
            station = new NetatmoStation(api, adapter);

            station.requestUpdateWeatherStation();

            _deviceUpdateTimer = setInterval(() =>
                station.requestUpdateWeatherStation(), adapter.config.check_interval * 60 * 1000);
        }

        if (adapter.config.netatmoWelcome) {
            welcome = new NetatmoWelcome(api, adapter);
            welcome.init();
            welcome.requestUpdateIndoorCamera();

            _welcomeUpdateTimer = setInterval(() =>
                welcome.requestUpdateIndoorCamera(), adapter.config.check_interval * 2 * 60 * 1000);
        }
    } else {
        adapter.log.error('Please add username, password and choose at least one product within the adapter settings!');
    }
}

// If started as allInOne mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}

