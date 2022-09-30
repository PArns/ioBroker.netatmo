/**
 * Based on the "netatmo" package, originally created by Ali Karbassi (https://github.com/karbassi/netatmo/)
 * Licensed under MIT
 *
 * The MIT License (MIT)
 *
 * Copyright (c) Ali Karbassi, Patrick Arns, Ingo Fischer
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
* **/

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const request = require('request');
const moment = require('moment');
let glob_lib_adapter = null;

const BASE_URL = 'https://api.netatmo.com';

const errorStatusTexts = {
    1: 'unknown_error',
    2: 'internal_error',
    3: 'parser_error',
    5: 'command_invalid_params',
    6: 'device_unreachable',
    7: 'command_error',
    8: 'battery_level',
    14: 'busy',
    19: 'module_unreachable',
    23: 'nothing_to_modify',
    27: 'temporarily_banned'
}

/**
 * @constructor
 * @param args
 */
const netatmo = function (args) {
    EventEmitter.call(this);
    this.storedOAuthStates = {};
    if (args) {
        this.authenticate(args);
    }
};

util.inherits(netatmo, EventEmitter);

/**
 * setAdapter
 * @param myAdapter
 */
netatmo.prototype.setAdapter = function (myAdapter) {
    glob_lib_adapter = myAdapter;
};

/**
 * handleRequestError
 * @param err
 * @param response
 * @param body
 * @param message
 * @param critical
 * @param callback to give the error to
 * @param retry function to execute if error was recovered
 * @returns {Error}
 */
netatmo.prototype.handleRequestError = function (err, response, body, message, critical, callback, retry) {
    let errorMessage;
    if (body && response && response.headers['content-type'].indexOf('application/json') !== -1) {
        errorMessage = JSON.parse(body);
        if (this.refresh_token && errorMessage.error && (errorMessage.error.code === 2 || errorMessage.error.code === 3)) {
            //authConstants token is expired, refresh it and retry
            return this.authenticate_refresh(this.refresh_token, retry);
        }
        errorMessage = errorMessage && (errorMessage.error.message || errorMessage.error);
    } else if (response !== undefined) {
        errorMessage = `Status code${response.statusCode}`;
    } else {
        errorMessage = 'No response';
    }

    const error = new Error(`${message}: ${errorMessage}`);
    if (critical) {
        this.emit('error', error);
    } else {
        this.emit('warning', error);
    }
    if (callback) {
        return callback(error);
    }
    return error;
};

netatmo.prototype.getOAuth2AuthenticateStartLink = function (args) {
    if (!args) {
        this.emit('error', new Error('Authenticate "args" not set.'));
        return this;
    }

    const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomState = '';
    for (let i = 0; i < 40; i++) {
        randomState += validChars.charAt(Math.floor(Math.random() * validChars.length));
    }

    const url = `${BASE_URL}/oauth2/authorize?client_id=${encodeURIComponent(args.client_id)}&redirect_uri=${encodeURIComponent(args.redirect_uri)}&scope=${encodeURIComponent(args.scope)}&state=${randomState}`;
    this.storedOAuthStates[randomState] = args;

    return {
        url,
        state: randomState
    };
}

/**
 * http://dev.netatmo.com/doc/authentication
 * @param args
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate = function (args, callback) {
    if (!args) {
        this.emit('error', new Error('Authenticate "args" not set.'));
        return this;
    }

    if (args.access_token) {
        this.client_id = args.client_id;
        this.client_secret = args.client_secret;
        this.scope = args.scope || 'read_homecoach read_station read_thermostat write_thermostat read_camera';

        this.authenticate_refresh(args.refresh_token, err => {
            if (err) {
                this.emit('authenticated');
            }
            if (callback) {
                return callback(err);
            }
        });

        return this;
    }

    if (args.state && this.storedOAuthStates[args.state]) {
        args = Object.assign(args, this.storedOAuthStates[args.state]);
        delete this.storedOAuthStates[args.state];
    }

    if (!args.client_id) {
        this.emit('error', new Error('Authenticate "client_id" not set.'));
        return this;
    }

    if (!args.client_secret) {
        this.emit('error', new Error('Authenticate "client_secret" not set.'));
        return this;
    }

    const form = {};

    if (args.code) {
        if (!args.redirect_uri) {
            this.emit('error', new Error('Authenticate "code" set but "redirectUri" not set.'));
            return this;
        }

        Object.assign(
            form,
            {
                code: args.code,
                redirect_uri: args.redirect_uri,
                grant_type: 'authorization_code'
            }
        );
    } else {
        if (!args.username || !args.password) {
            this.emit('error', new Error('Please Authenticate manually once using the Admin UI of this instance.'));
            return this;
        }

        glob_lib_adapter && glob_lib_adapter.log.info('Try one time fallback authentication with username and password. Might not work after october 2022');

        this.username = args.username;
        this.password = args.password;

        Object.assign(
            form,
            {
                username: this.username,
                password: this.password,
                grant_type: 'password'
            }
        );
    }

    this.client_id = args.client_id;
    this.client_secret = args.client_secret;
    this.scope = args.scope || 'read_homecoach read_station read_camera';

    Object.assign(
        form,
        {
            client_id: this.client_id,
            client_secret: this.client_secret,
            scope: this.scope
        }
    );

    const url = util.format('%s/oauth2/token', BASE_URL);

    glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate: ${JSON.stringify(form)}`);

    request({
        url,
        method: 'POST',
        form,
    }, (err, response, body) => {
        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate err ${err}`);
        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate status ${response && response.statusCode}`);
        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate body ${body}`);
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'Authenticate error', true, callback);
        }

        body = JSON.parse(body);

        this.access_token = body.access_token;
        this.refresh_token = body.refresh_token;

        this.emit('access_token', this.access_token);
        this.emit('refresh_token', this.refresh_token);

        if (body.expires_in) {
            clearTimeout(this.auth_refresh_timeout);
            this.auth_refresh_timeout = setTimeout(this.authenticate_refresh.bind(this), (body.expires_in - 10) * 1000, body.refresh_token);
        }

        this.emit('authenticated');

        if (callback) {
            return callback();
        }

        return this;
    });

    return this;
};

/**
 * http://dev.netatmo.com/doc/authentication
 * @param refresh_token
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate_refresh = function (refresh_token, callback) {

    const form = {
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
        client_id: this.client_id,
        client_secret: this.client_secret,
    };

    const url = util.format('%s/oauth2/token', BASE_URL);

    glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate_refresh: ${JSON.stringify(form)}`);
    request({
        url,
        method: 'POST',
        form,
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'Authenticate refresh error', false, callback);
        }

        body = JSON.parse(body);

        this.access_token = body.access_token;
        this.refresh_token = body.refresh_token;

        this.emit('access_token', this.access_token);
        this.emit('refresh_token', this.refresh_token);

        if (body.expires_in) {
            clearTimeout(this.auth_refresh_timeout);
            this.auth_refresh_timeout = setTimeout(this.authenticate_refresh.bind(this), (body.expires_in - 10) * 1000, body.refresh_token);
        }

        if (callback) {
            return callback(body);
        }

        return this;
    });

    return this;
};


/**
 * https://dev.netatmo.com/doc/methods/getuser
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getUser = function (callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getUser(callback);
        });
    }

    let url;

    if (this.scope.includes('read_homecoach')) {
        url = util.format('%s/api/gethomecoachsdata', BASE_URL);
    } else if (this.scope.includes('read_station')) {
        url = util.format('%s/api/getstationsdata', BASE_URL);
    } else if (this.scope.includes('read_thermostat')) {
        url = util.format('%s/api/getthermostatsdata', BASE_URL);
    } else if (this.scope.includes('read_camera')) {
        url = util.format('%s/api/gethomedata', BASE_URL);
    } else {
        this.emit('error', new Error('You do not have permission to get user data!'));
    }

    const form = {
    };

    request({
        url,
        method: 'POST',
        form,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getUser error', false, callback, this.getUser.bind(this, callback));
        }

        body = JSON.parse(body);

        this.emit('get-user', err, body.body.user);

        if (callback) {
            return callback(err, body.body.user);
        }

        return this;

    });

    return this;
};


/**
 * https://dev.netatmo.com/doc/methods/devicelist
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated
 */
netatmo.prototype.getDevicelist = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () =>
            this.getDevicelist(options, callback));
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    const url = util.format('%s/api/devicelist', BASE_URL);

    const qs = {
    };

    if (options && options.app_type) {
        qs.app_type = options.app_type;
    }

    request({
        url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getDevicelist error', false, callback, this.getDevicelist.bind(this, options, callback));
        }

        body = JSON.parse(body);

        const devices = body.body.devices;
        const modules = body.body.modules;

        this.emit('get-devicelist', err, devices, modules);

        if (callback) {
            return callback(err, devices, modules);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getstationsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getStationsData = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () =>
            this.getStationsData(options, callback));
    }

    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const url = util.format('%s/api/getstationsdata', BASE_URL);

    const qs = {
    };

    if (options.device_id) {
        qs.device_id = options.device_id;
    }
    if (options.get_favorites) {
        qs.get_favorites = !!options.get_favorites;
    }

    request({
        url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getStationsDataError error', false, callback, this.getStationsData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        glob_lib_adapter && glob_lib_adapter.log.debug(`getStationsData Raw Response: ${JSON.stringify(body)}`);

        const devices = body.body.devices;

        this.emit('get-stationsdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;
    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/gethomecoachsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getCoachData = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () =>
            this.getCoachData(options, callback));
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    const url = util.format('%s/api/gethomecoachsdata', BASE_URL);

    const qs = {
    };

    if (options && options.device_id) {
        qs.device_id = options.device_id;
    }

    request({
        url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'gethomecoachsdata error', false, callback, this.getCoachData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        const devices = body.body.devices;

        this.emit('get-coachdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;
    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getthermostatsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getThermostatsData = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getThermostatsData(options, callback);
        });
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    let url = util.format('%s/api/getthermostatsdata', BASE_URL);

    const qs = {
    };

    if (options && options.device_id) {
        qs.device_id = options.device_id;
    }

    request({
        url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getThermostatsDataError error', false, callback, this.getThermostatsData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        const devices = body.body.devices;

        this.emit('get-thermostatsdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getmeasure
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getMeasure = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getMeasure(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('getMeasure "options" not set.'));
        return this;
    }

    if (!options.device_id) {
        this.emit('error', new Error('getMeasure "device_id" not set.'));
        return this;
    }

    if (!options.scale) {
        this.emit('error', new Error('getMeasure "scale" not set.'));
        return this;
    }

    if (!options.type) {
        this.emit('error', new Error('getMeasure "type" not set.'));
        return this;
    }

    /*
    if (util.isArray(options.type)) {
        options.type = options.type.join(',');
    }

    // Remove any spaces from the type list if there is any.
    options.type = options.type.replace(/\s/g, '').toLowerCase();
    */

    const url = util.format('%s/api/getmeasure', BASE_URL);

    const qs = {
        device_id: options.device_id,
        scale: options.scale,
        type: options.type,
    };

    if (options) {

        if (options.module_id) {
            qs.module_id = options.module_id;
        }

        if (options.date_begin) {
            if (options.date_begin <= 1E10) {
                options.date_begin *= 1E3;
            }

            qs.date_begin = moment(options.date_begin).utc().unix();
        }

        if (options.date_end === 'last') {
            qs.date_end = 'last';
        } else if (options.date_end) {
            if (options.date_end <= 1E10) {
                options.date_end *= 1E3;
            }
            qs.date_end = moment(options.date_end).utc().unix();
        }

        if (options.limit) {
            qs.limit = parseInt(options.limit, 10);

            if (qs.limit > 1024) {
                qs.limit = 1024;
            }
        }

        if (options.optimize !== undefined) {
            qs.optimize = !!options.optimize;
        }

        if (options.real_time !== undefined) {
            qs.real_time = !!options.real_time;
        }
    }

    request({
        url,
        method: 'GET',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            const error = this.handleRequestError(err, response, body, 'getMeasure error', false, callback, this.getMeasure.bind(this, options, callback));
            if (callback) {
                callback(error);
            }
            return;
        }

        body = JSON.parse(body);

        const measure = body.body;

        this.emit('get-measure', err, measure);

        if (callback) {
            return callback(err, measure);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getthermstate
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated
 */
netatmo.prototype.getThermstate = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () =>
            this.getThermstate(options, callback));
    }

    if (!options) {
        this.emit('error', new Error('getThermstate "options" not set.'));
        return this;
    }

    if (!options.device_id) {
        this.emit('error', new Error('getThermstate "device_id" not set.'));
        return this;
    }

    if (!options.module_id) {
        this.emit('error', new Error('getThermstate "module_id" not set.'));
        return this;
    }

    const url = util.format('%s/api/getthermstate', BASE_URL);

    const qs = {
        device_id: options.device_id,
        module_id: options.module_id,
    };

    request({
        url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getThermstate error', false, callback, this.getThermstate.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-thermstate', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};

netatmo.prototype.switchSchedule = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.switchSchedule(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('setSyncSchedule "options" not set.'));
        return this;
    }

    if (!options.device_id) {
        this.emit('error', new Error('setSyncSchedule "device_id" not set.'));
        return this;
    }

    if (!options.module_id) {
        this.emit('error', new Error('setSyncSchedule "module_id" not set.'));
        return this;
    }

    if (!options.schedule_id) {
        this.emit('error', new Error('setSyncSchedule "schedule_id" not set.'));
        return this;
    }

    const url = util.format('%s/api/switchschedule', BASE_URL);

    const qs = {
        device_id: options.device_id,
        module_id: options.module_id,
        schedule_id: options.schedule_id,
    };

    request({
        url,
        method: 'POST',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'switchSchedule error', false, callback, this.switchSchedule.bind(this, options, callback));
        }

        body = JSON.parse(body);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/syncschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setSyncSchedule = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.setSyncSchedule(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('setSyncSchedule "options" not set.'));
        return this;
    }

    if (!options.device_id) {
        this.emit('error', new Error('setSyncSchedule "device_id" not set.'));
        return this;
    }

    if (!options.module_id) {
        this.emit('error', new Error('setSyncSchedule "module_id" not set.'));
        return this;
    }

    if (!options.zones) {
        this.emit('error', new Error('setSyncSchedule "zones" not set.'));
        return this;
    }

    if (!options.timetable) {
        this.emit('error', new Error('setSyncSchedule "timetable" not set.'));
        return this;
    }

    const url = util.format('%s/api/syncschedule', BASE_URL);

    const qs = {
        device_id: options.device_id,
        module_id: options.module_id,
        zones: options.zones,
        timetable: options.timetable,
    };

    request({
        url,
        method: 'POST',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'setSyncSchedule error', false, callback, this.setSyncSchedule.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('set-syncschedule', err, body.status);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/setthermpoint
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setThermpoint = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.setThermpoint(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('setThermpoint "options" not set.'));
        return this;
    }

    if (!options.device_id) {
        this.emit('error', new Error('setThermpoint "device_id" not set.'));
        return this;
    }

    if (!options.module_id) {
        this.emit('error', new Error('setThermpoint "module_id" not set.'));
        return this;
    }

    if (!options.setpoint_mode) {
        this.emit('error', new Error('setThermpoint "setpoint_mode" not set.'));
        return this;
    }

    const url = util.format('%s/api/setthermpoint', BASE_URL);

    const qs = {
        device_id: options.device_id,
        module_id: options.module_id,
        setpoint_mode: options.setpoint_mode,
    };

    if (options) {

        if (options.setpoint_endtime) {
            qs.setpoint_endtime = options.setpoint_endtime;
        }

        if (options.setpoint_temp) {
            qs.setpoint_temp = options.setpoint_temp;
        }

    }

    request({
        url,
        method: 'POST',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'setThermpoint error', false, callback, this.setThermpoint.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-thermostatsdata', err, body.status);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    });

    return this;
};

netatmo.prototype.setState = function (homeId, moduleId, fieldName, fieldValue, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.setState(home_id, moduleId, fieldName, fieldValue, callback);
        });
    }

    if (!homeId) {
        this.emit('error', new Error('setState "homeId" not set.'));
        return this;
    }

    if (!moduleId) {
        this.emit('error', new Error('setState "moduleId" not set.'));
        return this;
    }

    if (!fieldName) {
        this.emit('error', new Error('setState "fieldName" not set.'));
        return this;
    }

    if (!fieldValue) {
        this.emit('error', new Error('setState "fieldValue" not set.'));
        return this;
    }

    const url = util.format('%s/api/setstate', BASE_URL);

    const body = {
        home: {
            id: homeId,
            modules: [
                {
                    id: moduleId
                }
            ]
        }
    };
    body.home.modules[0][fieldName] = fieldValue;

    request({
        url: url,
        method: 'POST',
        body,
        json: true,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'setstate error', false, callback, this.switchSchedule.bind(this, options, callback));
        }

        body = JSON.parse(body);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    });

    return this;
};


/**
 * https://dev.netatmo.com/doc/methods/homesdata - new call for gethomedata
 * @param options
 * @param callback
 * @returns {*}
 * CHECKED
 */
netatmo.prototype.homesdata = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.homesdata(options, callback);
        });
    }

    const url = util.format('%s/api/homesdata', BASE_URL);

    const qs = {
    };

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    if (options) {

        if (options.home_id) {
            q.home_id = options.home_id;
        }

        if (options.gateway_types) {
            qs.gateway_types = options.gateway_types;
        }

    }

    request({
        url,
        method: 'GET',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'homesdata error', false, callback, this.homesdata.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-homesdata', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
}


/**
 * The method combines homesdata, homestatus and events
 * @param options
 * @param callback
 * @returns {*}
 * CHECKED
 */
netatmo.prototype.homedataExtended = async function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.homedataExtended(options, callback);
        });
    }

    try {
        const homeData = await new Promise((resolve, reject) => {
            this.homesdata(options, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: homesdata: ${JSON.stringify(data)}`);
                    resolve(data);
                }
            });
        });
        const legacyHomeData = await new Promise((resolve, reject) => {
            this.getHomeData(options, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: gethomedata: ${JSON.stringify(data)}`);
                    resolve(data);
                }
            });
        });
        if (homeData.homes) {
            for (let i = 0; i < homeData.homes.length; i++) {
                const homeStatus = await new Promise((resolve, reject) => {
                    this.homestatus(homeData.homes[i].id, options, (err, data) => {
                        if (err) {
                            reject(err);
                        } else {
                            glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: homestatus for ${homeData.homes[i].id}: ${JSON.stringify(data)}`);
                            resolve(data);
                        }
                    });
                });
                const homeEvents = await new Promise((resolve, reject) => {
                    this.getevents(homeData.homes[i].id, options, (err, data) => {
                        if (err) {
                            reject(err);
                        } else {
                            glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: getevents for ${homeData.homes[i].id}: ${JSON.stringify(data)}`);
                            resolve(data);
                        }
                    });
                });
                if (homeData.homes[i].modules) {
                    const moduleIdList = [];
                    for (let homeModuleIndex = 0; homeModuleIndex < homeData.homes[i].modules.length; homeModuleIndex++) {
                        moduleIdList.push(homeData.homes[i].modules[homeModuleIndex].id);
                        if (homeStatus.home.modules) {
                            const statusModuleIndex = homeStatus.home.modules.findIndex(statusModule => statusModule.id === homeData.homes[i].modules[homeModuleIndex].id);
                            if (statusModuleIndex !== -1) {
                                homeData.homes[i].modules[homeModuleIndex] = Object.assign(homeData.homes[i].modules[homeModuleIndex], homeStatus.home.modules[statusModuleIndex]);
                            }
                        }
                    }
                    if (homeStatus.errors) {
                        for (let errorIndex = 0; errorIndex < homeStatus.errors.length; errorIndex++) {
                            const error = homeStatus.errors[errorIndex];
                            const moduleIndex = homeData.homes[i].modules.findIndex(module => module.id === error.id);
                            if (moduleIndex !== -1) {
                                homeData.homes[i].modules[moduleIndex].errorStatus = errorStatusTexts[error.code] || `unknown_error_${error.code}`;
                            }
                        }
                    }
                    if (homeEvents && homeEvents.home && homeEvents.home.events) {
                        homeData.homes[i].events = homeEvents.home.events.filter(event => moduleIdList.includes(event.module_id));
                    }
                }
                if (homeData.homes[i].persons) {
                    const legacyHomeDetails = legacyHomeData.homes.find(legacyHome => legacyHome.id === homeData.homes[i].id);
                    if (legacyHomeDetails && legacyHomeDetails.persons) {
                        for (let personIndex = 0; personIndex < homeData.homes[i].persons.length; personIndex++) {
                            const legacyPerson = legacyHomeDetails.persons.find(legacyPerson => legacyPerson.id === homeData.homes[i].persons[personIndex].id);
                            if (legacyPerson) {
                                homeData.homes[i].persons[personIndex] = Object.assign(homeData.homes[i].persons[personIndex], legacyPerson);
                            }
                        }
                    }
                }
            }
        }
        callback && callback(null, homeData);
    } catch (err) {
        callback && callback(err);
    }
}

/**
 * https://dev.netatmo.com/doc/methods/homestatus - new call for gethomedata
 * @param home_id
 * @param options
 * @param callback
 * @returns {*}
 * CHECKED
 */
netatmo.prototype.homestatus = function (home_id, options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.homestatus(home_id, options, callback);
        });
    }

    const url = util.format('%s/api/homestatus', BASE_URL);

    const qs = {
        home_id
    };

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    if (options) {

        if (options.home_id) {
            qs.home_id = options.home_id;
        }

        if (options.gateway_types) {
            qs.gateway_types = options.gateway_types;
        }

    }

    request({
        url: url,
        method: 'GET',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'homestatus error', false, callback, this.homesdata.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-homestatus', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
}

/**
 * https://dev.netatmo.com/doc/methods/gethomedata
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Now use `Homesdata` to get topology information and `Homestatus` to get the status of the home
 * CHECKED
 */
netatmo.prototype.getHomeData = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getHomeData(options, callback);
        });
    }

    const url = util.format('%s/api/gethomedata', BASE_URL);

    const qs = {
    };

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    if (options) {

        if (options.home_id) {
            qs.home_id = options.home_id;
        }

        if (options.size) {
            qs.size = options.size;
        }

    }

    request({
        url: url,
        method: 'GET',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getHomeData error', false, callback, this.getHomeData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-homedata', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getnextevents
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Now use `Getevents`
 */
netatmo.prototype.getNextEvents = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getNextEvents(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('getNextEvents "options" not set.'));
        return this;
    }

    if (!options.home_id) {
        this.emit('error', new Error('getNextEvents "home_id" not set.'));
        return this;
    }

    if (!options.event_id) {
        this.emit('error', new Error('getNextEvents "event_id" not set.'));
        return this;
    }

    const url = util.format('%s/api/getnextevents', BASE_URL);

    const qs = {
        home_id: options.home_id,
        event_id: options.event_id,
    };

    if (options.size) {
        qs.size = options.size;
    }

    request({
        url: url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getNextEvents error', false, callback, this.getNextEvents.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-nextevents', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getlasteventof
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Now use `Getevents`
 */
netatmo.prototype.getLastEventOf = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getLastEventOf(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('getLastEventOf "options" not set.'));
        return this;
    }

    if (!options.home_id) {
        this.emit('error', new Error('getLastEventOf "home_id" not set.'));
        return this;
    }

    if (!options.person_id) {
        this.emit('error', new Error('getLastEventOf "person_id" not set.'));
        return this;
    }

    const url = util.format('%s/api/getlasteventof', BASE_URL);

    const qs = {
        home_id: options.home_id,
        person_id: options.person_id,
    };

    if (options.offset) {
        qs.offset = options.offset;
    }

    request({
        url: url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getLastEventOf error', false, callback, this.getLastEventOf.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-lasteventof', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/geteventsuntil
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Now use `Getevents`
 */
netatmo.prototype.getEventsUntil = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getEventsUntil(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('getEventsUntil "options" not set.'));
        return this;
    }

    if (!options.home_id) {
        this.emit('error', new Error('getEventsUntil "home_id" not set.'));
        return this;
    }

    if (!options.event_id) {
        this.emit('error', new Error('getEventsUntil "event_id" not set.'));
        return this;
    }

    const url = util.format('%s/api/geteventsuntil', BASE_URL);

    const qs = {
        home_id: options.home_id,
        event_id: options.event_id,
    };

    request({
        url: url,
        method: 'GET',
        qs,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getEventsUntil error', false, callback, this.getEventsUntil.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-eventsuntil', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getcamerapicture
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Snapshots are now retrievable in the event object directly, use `Getevents`
 */
netatmo.prototype.getCameraPicture = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getCameraPicture(options, callback);
        });
    }

    if (!options) {
        this.emit('error', new Error('getCameraPicture "options" not set.'));
        return this;
    }

    if (!options.image_id) {
        this.emit('error', new Error('getCameraPicture "image_id" not set.'));
        return this;
    }

    if (!options.key) {
        this.emit('error', new Error('getCameraPicture "key" not set.'));
        return this;
    }

    const url = util.format('%s/api/getcamerapicture', BASE_URL);

    const qs = {
        image_id: options.image_id,
        key: options.key,
    };

    request({
        url: url,
        method: 'GET',
        form: qs,
        encoding: null,
        contentType: 'image/jpg',
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getCameraPicture error', false, callback, this.getCameraPicture.bind(this, options, callback));
        }

        this.emit('get-camerapicture', err, body);

        if (callback) {
            return callback(err, body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/cameras/addwebhook
 * @param callbackUrl
 * @param callback
 * @returns {*}
 */
netatmo.prototype.addWebHook = function (callbackUrl, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.addWebHook(callbackUrl, callback);
        });
    }

    const url = util.format('%s/api/addwebhook', BASE_URL);

    const qs = {
        url: callbackUrl
    };

    request({
        url: url,
        method: 'POST',
        qs,
        encoding: null,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            if (callback) {
                callback(err, body, qs);
            }
            return;
            //return this.handleRequestError(err, response, body, 'addWebHook error');
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/cameras/dropwebhook
 * @param callback
 * @returns {*}
 */
netatmo.prototype.dropWebHook = function (callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () =>
            this.dropWebHook(callback));
    }

    const url = util.format('%s/api/dropwebhook', BASE_URL);

    request({
        url: url,
        method: 'POST',
        encoding: null,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'dropWebHook error');
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/cameras/setpersonsaway
 * @param homeId
 * @param personsId string
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setPersonsAway = function (homeId, personsId, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.setPersonsAway(homeId, personsId, callback);
        });
    }

    const url = util.format('%s/api/setpersonsaway', BASE_URL);

    const qs = {
        home_id: homeId
    };

    if (personsId)
        qs.person_id = personsId;

    request({
        url: url,
        method: 'POST',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        encoding: null,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'setPersonsAway error');
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/cameras/setpersonshome
 * @param homeId
 * @param personsId array
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setPersonsHome = function (homeId, personsId, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.setPersonsHome(homeId, personsId, callback);
        });
    }

    const url = util.format('%s/api/setpersonshome', BASE_URL);

    const qs = {
        home_id: homeId
    };

    if (personsId)
        qs.person_ids = personsId;

    request({
        url: url,
        method: 'POST',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        encoding: null,
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'setPersonsHome error');
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    });

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getevents - new call for get all events
 * @param home_id
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getevents = function (home_id, options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', () => {
            this.getevents(home_id, options, callback);
        });
    }

    const url = util.format('%s/api/getevents', BASE_URL);

    const qs = {
        home_id
    };

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    if (options) {

        if (options.home_id) {
            qs.home_id = options.home_id;
        }

        if (options.device_types) {
            qs.device_types = options.device_types;
        }

        if (options.event_id) {
            qs.event_id = options.event_id;
        }

        if (options.person_id) {
            qs.person_id = options.person_id;
        }

        if (options.device_id) {
            qs.device_id = options.device_id;
        }

        if (options.module_id) {
            qs.module_id = options.module_id;
        }

        if (options.offset) {
            qs.offset = options.offset;
        }

        if (options.size) {
            qs.size = options.size;
        }

        if (options.locale) {
            qs.locale = options.locale;
        }

    }

    request({
        url: url,
        method: 'GET',
        qs,
        qsStringifyOptions: {
            arrayFormat: 'indices'
        },
        headers: {
            'Authorization': `Bearer ${this.access_token}`
        }
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            return this.handleRequestError(err, response, body, 'getevents error', false, callback, this.getevents.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-events', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    });

    return this;
};


module.exports = netatmo;
