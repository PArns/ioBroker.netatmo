/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require(__dirname + '/lib/utils');
var adapter = utils.adapter('netatmo');

var netatmo = require('netatmo-homey');
var api = null;

adapter.on('ready', function () {
    if (adapter.config.username && adapter.config.password || adapter.config.access_token) {

        var auth = {
            "client_id": "574ddd152baa3cf9598b46cd",
            "client_secret": "6e3UcBKp005k9N0tpwp69fGYECqOpuhtEE9sWJW",
            "scope": "read_station read_thermostat",
            "username": adapter.config.username,
            "password": adapter.config.password,
            "access_token": adapter.config.access_token
        };

        api = new netatmo(auth);

        // Update access_token once we'll get one so that the API doesn't rerequests each time a new token
        api.on("access_token", function (token) {
            adapter.getForeignObject('system.adapter.' + adapter.namespace, function (err, object) {
                if (object) {
                    object.native.access_token = token;
                    adapter.setForeignObject('system.adapter.' + adapter.namespace, object);
                }
            });
        });

        // Update all stations
        api.getStationsData({}, function (err, data) {
            if (err !== null)
                adapter.log.error(err);
            else {
                adapter.log.info(data);
            }
        });
    } else
        adapter.log.error("Please add username and password within the adapter settings!");
});