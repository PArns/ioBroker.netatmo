/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('netatmo');

var netatmo = require('netatmo');
var api = null;

var NetatmoStation = require("./netatmoStation");
var station = null;

var NetatmoWelcome = require("./netatmoWelcome");
var welcome = null;

var _deviceUpdateTimer;
var _welcomeUpdateTimer;

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

adapter.on('message', function (obj) {

    adapter.log.info(JSON.stringify(obj));

    if (obj) {
        switch (obj.command) {
            case 'setAway':
                if (welcome && obj.message) {
                    welcome.setAway(obj.message);
                }

                if (obj.callback)
                    adapter.sendTo(obj.from, obj.command, {}, obj.callback);

                break;
            default:
                adapter.log.warn("Unknown command: " + obj.command);
                break;
        }
    }

    return true;
});

adapter.on('unload', function (callback) {
    try {
        if (welcome)
            welcome.finalize();

        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('ready', function () {
    if (adapter.config.username && adapter.config.password) {
        var scope = "";
        var id = "574ddd152baa3cf9598b46cd";
        var secret = "6e3UcBKp005k9N0tpwp69fGYECqOpuhtEE9sWJW";

        // Backward compatibility begin ...
        // --------------------------------------------------------
        // If nothing is set, activate at least the Weatherstation
        if (!(adapter.config.netatmoWeather || adapter.config.netatmoWelcome)) {
            adapter.log.info("No product was choosen, using WeatherStation as default!");
            adapter.config.netatmoWeather = true;
        }

        if (!adapter.config.check_interval)
            adapter.config.check_interval = 5;

        if (!adapter.config.cleanup_interval)
            adapter.config.cleanup_interval = 60;

        if (!adapter.config.unknown_person_time)
            adapter.config.unknown_person_time = 24;

        if (!adapter.config.location_elevation)
            adapter.config.location_elevation = 0;

        if (adapter.config.netatmoWeather) {
            scope += " read_station";
        }
        // --------------------------------------------------------
        // Backward compatibility end ...

        if (adapter.config.netatmoWelcome) {
            scope += " read_camera read_presence";

            if (adapter.config.id && adapter.config.secret) {
                id = adapter.config.id;
                secret = adapter.config.secret;

                scope += " access_camera access_presence write_camera"
            }
        }

        scope = scope.trim();

        var auth = {
            "client_id": id,
            "client_secret": secret,
            "scope": scope,
            "username": adapter.config.username,
            "password": adapter.config.password
        };

        api = new netatmo(auth);

        if (adapter.config.netatmoWeather) {
            station = new NetatmoStation(api, adapter);

            station.requestUpdateWeatherStation();

            _deviceUpdateTimer = setInterval(function () {
                station.requestUpdateWeatherStation();
            }, adapter.config.check_interval * 60 * 1000);
        }

        if (adapter.config.netatmoWelcome) {
            welcome = new NetatmoWelcome(api, adapter);
            welcome.init();
            welcome.requestUpdateIndoorCamera();

            _welcomeUpdateTimer = setInterval(function () {
                welcome.requestUpdateIndoorCamera();
            }, adapter.config.check_interval * 2 * 60 * 1000);
        }

    } else
        adapter.log.error("Please add username, password and choose at least one product within the adapter settings!");
});