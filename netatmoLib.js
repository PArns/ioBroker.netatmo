var util = require('util');
var EventEmitter = require("events").EventEmitter;
var request = require('request');
var moment = require('moment');
var glob_lib_adapter = null;


var BASE_URL = 'https://api.netatmo.com';

/**
 * @constructor
 * @param args
 */
var netatmo = function (args) {
    EventEmitter.call(this);
    if (args) {
        this.authenticate(args);
    }
};

util.inherits(netatmo, EventEmitter);

/**
 * setAdapter
 * @param myadapter
 */
netatmo.prototype.setAdapter = function (myadapter) {
    glob_lib_adapter = myadapter;
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
    var errorMessage = "";
    if (body && response.headers['content-type'].indexOf('application/json') !== -1) {
        errorMessage = JSON.parse(body);
        if (this.refresh_token && errorMessage.error && (errorMessage.error.code === 2 || errorMessage.error.code === 3)) {
            //authConstants token is expired, refresh it and retry
            return this.authenticate_refresh(this.refresh_token, retry);
        }
        errorMessage = errorMessage && (errorMessage.error.message || errorMessage.error);
    } else if (typeof response !== 'undefined') {
        errorMessage = "Status code" + response.statusCode;
    } else {
        errorMessage = "No response";
    }

    var error = new Error(message + ": " + errorMessage);
    if (critical) {
        this.emit("error", error);
    } else {
        this.emit("warning", error);
    }
    if (callback) {
        return callback(error);
    }
    return error;
};

/**
 * http://dev.netatmo.com/doc/authentication
 * @param args
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate = function (args, callback) {
    if (!args) {
        this.emit("error", new Error("Authenticate 'args' not set."));
        return this;
    }

    if (args.access_token) {
        this.client_id = args.client_id;
        this.client_secret = args.client_secret;
        this.access_token = args.access_token;
        this.refresh_token = args.refresh_token;
        this.scope = args.scope || 'read_homecoach read_station read_thermostat write_thermostat read_camera';

        this.emit('access_token', this.access_token);
        this.emit('refresh_token', this.refresh_token);
        this.emit('authenticated');
        if (callback) {
            return callback();
        }
        return this;
    }

    if (!args.client_id) {
        this.emit("error", new Error("Authenticate 'client_id' not set."));
        return this;
    }

    if (!args.client_secret) {
        this.emit("error", new Error("Authenticate 'client_secret' not set."));
        return this;
    }

    var form = {};

    if (args.code) {
        if (!args.redirect_uri) {
            this.emit("error", new Error("Authenticate 'code' set but 'redirectUri' not set."));
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
        if (!args.username) {
            this.emit("error", new Error("Authenticate 'username' not set."));
            return this;
        }

        if (!args.password) {
            this.emit("error", new Error("Authenticate 'password' not set."));
            return this;
        }

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

    var url = util.format('%s/oauth2/token', BASE_URL);

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "Authenticate error", true, callback);
        }

        body = JSON.parse(body);

        this.access_token = body.access_token;
        this.refresh_token = body.refresh_token;

        this.emit('access_token', this.access_token);
        this.emit('refresh_token', this.refresh_token);

        if (body.expires_in) {
            clearTimeout(this.auth_refresh_timeout);
            this.auth_refresh_timeout = setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
        }

        this.emit('authenticated');

        if (callback) {
            return callback();
        }

        return this;
    }.bind(this));

    return this;
};

/**
 * http://dev.netatmo.com/doc/authentication
 * @param refresh_token
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate_refresh = function (refresh_token, callback) {

    var form = {
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
        client_id: this.client_id,
        client_secret: this.client_secret,
    };

    var url = util.format('%s/oauth2/token', BASE_URL);

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "Authenticate refresh error", false, callback);
        }

        body = JSON.parse(body);

        this.access_token = body.access_token;
        refresh_token = body.refresh_token;

        this.emit('refresh_token', refresh_token);

        if (body.expires_in) {
            clearTimeout(this.auth_refresh_timeout);
            this.auth_refresh_timeout = setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
        }

        if (callback) {
            return callback(body);
        }

        return this;
    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getUser(callback);
        });
    }

    var url;

    if (this.scope.indexOf('read_homecoach') !== -1) {
        url = util.format('%s/api/gethomecoachsdata', BASE_URL);
    } else if (this.scope.indexOf('read_station') !== -1) {
        url = util.format('%s/api/getstationsdata', BASE_URL);
    } else if (this.scope.indexOf('read_thermostat') !== -1) {
        url = util.format('%s/api/getthermostatsdata', BASE_URL);
    } else if (this.scope.indexOf('read_camera') !== -1) {
        url = util.format('%s/api/gethomedata', BASE_URL);
    } else {
        this.emit('error', new Error('You do not have permission to get user data!'));
    }

    var form = {
        access_token: this.access_token,
    };

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getUser error", false, callback, this.getUser.bind(this, callback));
        }

        body = JSON.parse(body);

        this.emit('get-user', err, body.body.user);

        if (callback) {
            return callback(err, body.body.user);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getDevicelist(options, callback);
        });
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    var url = util.format('%s/api/devicelist', BASE_URL);

    var form = {
        access_token: this.access_token,
    };

    if (options && options.app_type) {
        form.app_type = options.app_type;
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getDevicelist error", false, callback, this.getDevicelist.bind(this, options, callback));
        }

        body = JSON.parse(body);

        var devices = body.body.devices;
        var modules = body.body.modules;

        this.emit('get-devicelist', err, devices, modules);

        if (callback) {
            return callback(err, devices, modules);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getStationsData(options, callback);
        });
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    var url = util.format('%s/api/getstationsdata', BASE_URL);

    var form = {
        access_token: this.access_token,
    };

    if (options && options.app_type) {
        form.app_type = options.app_type;
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getStationsDataError error", false, callback, this.getStationsData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        var devices = body.body.devices;

        this.emit('get-stationsdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getCoachData(options, callback);
        });
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    var url = util.format('%s/api/gethomecoachsdata', BASE_URL);

    var form = {
        access_token: this.access_token,
    };

    if (options && options.app_type) {
        form.app_type = options.app_type;
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "gethomecoachsdata error", false, callback, this.getCoachData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        var devices = body.body.devices;

        this.emit('get-coachdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getThermostatsData(options, callback);
        });
    }

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    var url = util.format('%s/api/getthermostatsdata?access_token=%s', BASE_URL, this.access_token);

    if (options != null) {
        url = util.format(url + '?device_id=%s', options.device_id);
    }

    request({
        url: url,
        method: "GET",
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getThermostatsDataError error", false, callback, this.getThermostatsData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        var devices = body.body.devices;

        this.emit('get-thermostatsdata', err, devices);

        if (callback) {
            return callback(err, devices);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getMeasure(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getMeasure 'options' not set."));
        return this;
    }

    if (!options.device_id) {
        this.emit("error", new Error("getMeasure 'device_id' not set."));
        return this;
    }

    if (!options.scale) {
        this.emit("error", new Error("getMeasure 'scale' not set."));
        return this;
    }

    if (!options.type) {
        this.emit("error", new Error("getMeasure 'type' not set."));
        return this;
    }

    if (util.isArray(options.type)) {
        options.type = options.type.join(',');
    }

    // Remove any spaces from the type list if there is any.
    options.type = options.type.replace(/\s/g, '').toLowerCase();


    var url = util.format('%s/api/getmeasure', BASE_URL);

    var form = {
        access_token: this.access_token,
        device_id: options.device_id,
        scale: options.scale,
        type: options.type,
    };

    if (options) {

        if (options.module_id) {
            form.module_id = options.module_id;
        }

        if (options.date_begin) {
            if (options.date_begin <= 1E10) {
                options.date_begin *= 1E3;
            }

            form.date_begin = moment(options.date_begin).utc().unix();
        }

        if (options.date_end === 'last') {
            form.date_end = 'last';
        } else if (options.date_end) {
            if (options.date_end <= 1E10) {
                options.date_end *= 1E3;
            }
            form.date_end = moment(options.date_end).utc().unix();
        }

        if (options.limit) {
            form.limit = parseInt(options.limit, 10);

            if (form.limit > 1024) {
                form.limit = 1024;
            }
        }

        if (options.optimize !== undefined) {
            form.optimize = !!options.optimize;
        }

        if (options.real_time !== undefined) {
            form.real_time = !!options.real_time;
        }
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            var error = this.handleRequestError(err, response, body, "getMeasure error", false, callback, this.getMeasure.bind(this, options, callback));
            if (callback) {
                callback(error);
            }
            return;
        }

        body = JSON.parse(body);

        var measure = body.body;

        this.emit('get-measure', err, measure);

        if (callback) {
            return callback(err, measure);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.getThermstate(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getThermstate 'options' not set."));
        return this;
    }

    if (!options.device_id) {
        this.emit("error", new Error("getThermstate 'device_id' not set."));
        return this;
    }

    if (!options.module_id) {
        this.emit("error", new Error("getThermstate 'module_id' not set."));
        return this;
    }

    var url = util.format('%s/api/getthermstate', BASE_URL);

    var form = {
        access_token: this.access_token,
        device_id: options.device_id,
        module_id: options.module_id,
    };

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getThermstate error", false, callback, this.getThermstate.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-thermstate', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    }.bind(this));

    return this;
};

netatmo.prototype.switchSchedule = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.setSyncSchedule(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("setSyncSchedule 'options' not set."));
        return this;
    }

    if (!options.device_id) {
        this.emit("error", new Error("setSyncSchedule 'device_id' not set."));
        return this;
    }

    if (!options.module_id) {
        this.emit("error", new Error("setSyncSchedule 'module_id' not set."));
        return this;
    }

    if (!options.schedule_id) {
        this.emit("error", new Error("setSyncSchedule 'schedule_id' not set."));
        return this;
    }

    var url = util.format('%s/api/switchschedule', BASE_URL);

    var form = {
        access_token: this.access_token,
        device_id: options.device_id,
        module_id: options.module_id,
        schedule_id: options.schedule_id,
    };

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "switchSchedule error", false, callback, this.switchSchedule.bind(this, options, callback));
        }

        body = JSON.parse(body);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.setSyncSchedule(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("setSyncSchedule 'options' not set."));
        return this;
    }

    if (!options.device_id) {
        this.emit("error", new Error("setSyncSchedule 'device_id' not set."));
        return this;
    }

    if (!options.module_id) {
        this.emit("error", new Error("setSyncSchedule 'module_id' not set."));
        return this;
    }

    if (!options.zones) {
        this.emit("error", new Error("setSyncSchedule 'zones' not set."));
        return this;
    }

    if (!options.timetable) {
        this.emit("error", new Error("setSyncSchedule 'timetable' not set."));
        return this;
    }

    var url = util.format('%s/api/syncschedule', BASE_URL);

    var form = {
        access_token: this.access_token,
        device_id: options.device_id,
        module_id: options.module_id,
        zones: options.zones,
        timetable: options.timetable,
    };

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "setSyncSchedule error", false, callback, this.setSyncSchedule.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('set-syncschedule', err, body.status);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.setThermpoint(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("setThermpoint 'options' not set."));
        return this;
    }

    if (!options.device_id) {
        this.emit("error", new Error("setThermpoint 'device_id' not set."));
        return this;
    }

    if (!options.module_id) {
        this.emit("error", new Error("setThermpoint 'module_id' not set."));
        return this;
    }

    if (!options.setpoint_mode) {
        this.emit("error", new Error("setThermpoint 'setpoint_mode' not set."));
        return this;
    }

    var url = util.format('%s/api/setthermpoint', BASE_URL);

    var form = {
        access_token: this.access_token,
        device_id: options.device_id,
        module_id: options.module_id,
        setpoint_mode: options.setpoint_mode,
    };

    if (options) {

        if (options.setpoint_endtime) {
            form.setpoint_endtime = options.setpoint_endtime;
        }

        if (options.setpoint_temp) {
            form.setpoint_temp = options.setpoint_temp;
        }

    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "setThermpoint error", false, callback, this.setThermpoint.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-thermostatsdata', err, body.status);

        if (callback) {
            return callback(err, body.status);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/gethomedata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomeData = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.getHomeData(options, callback);
        });
    }

    var url = util.format('%s/api/gethomedata', BASE_URL);

    var form = {
        access_token: this.access_token
    };

    if (options != null && callback == null) {
        callback = options;
        options = null;
    }

    if (options) {

        if (options.home_id) {
            form.home_id = options.home_id;
        }

        if (options.size) {
            form.size = options.size;
        }

    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getHomeData error", false, callback, this.getHomeData.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-homedata', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getnextevents
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getNextEvents = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.getNextEvents(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getNextEvents 'options' not set."));
        return this;
    }

    if (!options.home_id) {
        this.emit("error", new Error("getNextEvents 'home_id' not set."));
        return this;
    }

    if (!options.event_id) {
        this.emit("error", new Error("getNextEvents 'event_id' not set."));
        return this;
    }

    var url = util.format('%s/api/getnextevents', BASE_URL);

    var form = {
        access_token: this.access_token,
        home_id: options.home_id,
        event_id: options.event_id,
    };

    if (options.size) {
        form.size = options.size;
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getNextEvents error", false, callback, this.getNextEvents.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-nextevents', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getlasteventof
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getLastEventOf = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.getLastEventOf(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getLastEventOf 'options' not set."));
        return this;
    }

    if (!options.home_id) {
        this.emit("error", new Error("getLastEventOf 'home_id' not set."));
        return this;
    }

    if (!options.person_id) {
        this.emit("error", new Error("getLastEventOf 'person_id' not set."));
        return this;
    }

    var url = util.format('%s/api/getlasteventof', BASE_URL);

    var form = {
        access_token: this.access_token,
        home_id: options.home_id,
        person_id: options.person_id,
    };

    if (options.offset) {
        form.offset = options.offset;
    }

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getLastEventOf error", false, callback, this.getLastEventOf.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-lasteventof', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/geteventsuntil
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getEventsUntil = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.getEventsUntil(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getEventsUntil 'options' not set."));
        return this;
    }

    if (!options.home_id) {
        this.emit("error", new Error("getEventsUntil 'home_id' not set."));
        return this;
    }

    if (!options.event_id) {
        this.emit("error", new Error("getEventsUntil 'event_id' not set."));
        return this;
    }

    var url = util.format('%s/api/geteventsuntil', BASE_URL);

    var form = {
        access_token: this.access_token,
        home_id: options.home_id,
        event_id: options.event_id,
    };

    request({
        url: url,
        method: "POST",
        form: form,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getEventsUntil error", false, callback, this.getEventsUntil.bind(this, options, callback));
        }

        body = JSON.parse(body);

        this.emit('get-eventsuntil', err, body.body);

        if (callback) {
            return callback(err, body.body);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/doc/methods/getcamerapicture
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getCameraPicture = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.getCameraPicture(options, callback);
        });
    }

    if (!options) {
        this.emit("error", new Error("getCameraPicture 'options' not set."));
        return this;
    }

    if (!options.image_id) {
        this.emit("error", new Error("getCameraPicture 'image_id' not set."));
        return this;
    }

    if (!options.key) {
        this.emit("error", new Error("getCameraPicture 'key' not set."));
        return this;
    }

    var url = util.format('%s/api/getcamerapicture', BASE_URL);

    var qs = {
        access_token: this.access_token,
        image_id: options.image_id,
        key: options.key,
    };

    request({
        url: url,
        method: "GET",
        qs: qs,
        encoding: null,
        contentType: 'image/jpg'
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "getCameraPicture error", false, callback, this.getCameraPicture.bind(this, options, callback));
        }

        this.emit('get-camerapicture', err, body);

        if (callback) {
            return callback(err, body);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.addWebHook(callbackUrl, callback);
        });
    }

    var url = util.format('%s/api/addwebhook', BASE_URL);

    var qs = {
        access_token: this.access_token,
        app_type: "app_security"
    };

    if (callbackUrl)
        qs.url = callbackUrl;

    request({
        url: url,
        method: "GET",
        qs: qs,
        encoding: null,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return callback(err, body, qs);
            return this.handleRequestError(err, response, body, "addWebHook error");
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    }.bind(this));

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
        return this.on('authenticated', function () {
            this.dropWebHook(callback);
        });
    }

    var url = util.format('%s/api/dropwebhook', BASE_URL);

    var qs = {
        access_token: this.access_token,
        app_type: "app_security",
    };

    request({
        url: url,
        method: "GET",
        qs: qs,
        encoding: null,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "dropWebHook error");
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    }.bind(this));

    return this;
};

/**
 * https://dev.netatmo.com/dev/resources/technical/reference/cameras/setpersonsaway
 * @param homeId
 * @param personsId
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setPersonsAway = function (homeId, personsId, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.on('authenticated', function () {
            this.dropWebHook(callback);
        });
    }

    var url = util.format('%s/api/setpersonsaway', BASE_URL);

    var qs = {
        access_token: this.access_token,
        home_id: homeId
    };

    if (personsId)
        qs.person_id = personsId;

    request({
        url: url,
        method: "GET",
        qs: qs,
        encoding: null,
    }, function (err, response, body) {
        if (err || response.statusCode != 200) {
            return this.handleRequestError(err, response, body, "setPersonsAway error");
        }

        if (callback) {
            return callback(err, body);
        }

        return this;

    }.bind(this));

    return this;
};

module.exports = netatmo;