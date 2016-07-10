/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('netatmo');

var netatmo = require('netatmo-homey');
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

adapter.on('ready', function () {

    if (adapter.config.username && adapter.config.password && adapter.config.client_id && adapter.config.client_secret && (adapter.config.netatmoWeather || adapter.config.netatmoWelcome) ) {

        var scope ="";
        if (adapter.config.netatmoWeather) {
            scope += " read_station";
        }
        if (adapter.config.netatmoWelcome) {
            scope += " read_camera";
        }
        scope = scope.trim();

        var auth = {
            "client_id": adapter.config.client_id,
            "client_secret": adapter.config.client_secret,
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
            },  adapter.config.check_interval *  60 * 1000);
        }

        if (adapter.config.netatmoWelcome) {
            welcome = new NetatmoWelcome(api, adapter);
            welcome.requestUpdateIndoorCamera();

            _welcomeUpdateTimer = setInterval(function () {
                welcome.requestUpdateIndoorCamera();
            }, adapter.config.check_interval * 60 * 1000);
        }

    } else
        adapter.log.error("Please add username, password, client_id, client_secret and choose a product within the adapter settings!");
});



