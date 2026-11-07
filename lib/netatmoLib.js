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
const requestLib = require('request');
const moment = require('moment');
let glob_lib_adapter = null;

const BASE_URL = 'https://api.netatmo.com';

/** Pause after Netatmo reported the request limit without Retry-After (ms) */
const RATE_LIMIT_DEFAULT_PAUSE = 15 * 60 * 1000;
/** Maximum pause after Netatmo reported the request limit (ms) */
const RATE_LIMIT_MAX_PAUSE = 60 * 60 * 1000;
/** Lifetime of the cached homesdata (structure of the homes, changes rarely) (ms) */
const HOMESDATA_CACHE_TIME = 3 * 60 * 60 * 1000;
/** Requests of the product modules within this time are combined into one Netatmo request (ms) */
const HOMEDATA_COMBINE_DELAY = 1000;

/** Time until requests are allowed again after Netatmo reported the request limit (ms timestamp) */
let rateLimitedUntil = 0;

/**
 * Wrapper around request: while Netatmo's request limit is reached, API requests are not sent
 * at all but answered with an error, so the limit is not used up any further.
 * @KI_HINWEIS: Netatmo meldet das Limit mit HTTP 429 oder HTTP 403 + error.code 26. Weitere
 * Anfragen (auch Token-Refresh) verlaengern die Sperre nur, deshalb zentral hier blockieren.
 * Token-Requests (oauth2) bleiben erlaubt, sonst liefe das Access-Token in der Pause ab.
 * @param {object} options request options
 * @param {(err: Error|null, response?: any, body?: any) => void} callback result
 */
function request(options, callback) {
    if (rateLimitedUntil && Date.now() < rateLimitedUntil && !String(options.url).includes('/oauth2/')) {
        const err = new Error(`Netatmo request limit reached, requests paused until ${new Date(rateLimitedUntil).toLocaleTimeString()}`);
        err.rateLimited = true;
        return setImmediate(() => callback(err));
    }
    return requestLib(options, callback);
}

/**
 * Starts the request pause after Netatmo reported the request limit.
 * @param {any} response HTTP response
 */
function startRateLimitPause(response) {
    const header = response && response.headers && response.headers['retry-after'];
    let pause = RATE_LIMIT_DEFAULT_PAUSE;
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds) && seconds > 0) {
        pause = seconds * 1000;
    } else if (header && !isNaN(Date.parse(header))) {
        pause = Date.parse(header) - Date.now();
    }
    pause = Math.min(Math.max(pause, 60 * 1000), RATE_LIMIT_MAX_PAUSE);
    const until = Date.now() + pause;
    if (until > rateLimitedUntil) {
        const first = !rateLimitedUntil || Date.now() >= rateLimitedUntil;
        rateLimitedUntil = until;
        if (first && glob_lib_adapter) {
            glob_lib_adapter.log.warn(`Netatmo request limit reached. Requests are paused until ${new Date(until).toLocaleTimeString()} and resume automatically. Tip: use an own Netatmo app and do not set the check interval lower than needed.`);
        }
    }
}

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
    let limitReached = !!response && response.statusCode === 429;
    const contentType = (response && response.headers && response.headers['content-type']) || '';
    if (body && response && contentType.includes('application/json')) {
        let parsed = body;
        if (typeof body === 'string') {
            try {
                parsed = JSON.parse(body);
            } catch {
                parsed = null;
            }
        }
        const apiError = parsed && parsed.error;
        if (apiError && apiError.code === 26) {
            limitReached = true;
        }
        if (this.refresh_token && apiError && (apiError.code === 2 || apiError.code === 3)) {
            // @KI_HINWEIS: Access-Token abgelaufen/ungueltig -> einmal refreshen. Der urspruengliche
            // Request wird nur nach erfolgreichem Refresh wiederholt; vorher wurde retry auch mit
            // dem Fehlerobjekt aufgerufen, was bei ungueltigem Refresh-Token eine Endlosschleife ergab.
            return this.authenticate_refresh(this.refresh_token, refreshErr => {
                if (!refreshErr && retry) {
                    return retry();
                }
                const error = refreshErr || new Error(`${message}: token refreshed, request not repeated`);
                return callback ? callback(error) : error;
            });
        }
        if (apiError) {
            errorMessage = typeof apiError === 'string' ? apiError : (apiError.message || JSON.stringify(apiError));
        } else {
            errorMessage = `Status code ${response.statusCode}`;
        }
    } else if (response) {
        errorMessage = `Status code ${response.statusCode}`;
    } else {
        errorMessage = err ? err.message || String(err) : 'No response';
    }

    if (limitReached) {
        startRateLimitPause(response);
    }

    const error = new Error(`${message}: ${errorMessage}`);
    error.statusCode = response ? response.statusCode : undefined;
    // @KI_HINWEIS: Voruebergehende Stoerungen bei Netatmo (keine Antwort, 5xx, 429,
    // "Service temporarily unavailable") werden markiert, damit reportResult() sie erst nach
    // mehreren Fehlschlaegen in Folge als Fehler meldet.
    error.rateLimited = !!(err && err.rateLimited) || limitReached;
    error.transient = !response || error.rateLimited ||
        response.statusCode >= 500 ||
        response.statusCode === 429 ||
        /temporarily unavailable|timeout|timed out/i.test(errorMessage);
    error.ignorable = message.includes('getHomeData') || errorMessage.includes('Application does not have the good scope rights');
    // Mit Callback entscheidet der Aufrufer ueber das Logging (sonst wurde jeder Fehler doppelt geloggt)
    if (callback) {
        return callback(error);
    }
    if (!error.ignorable) {
        if (critical) {
            this.emit('error', error);
        } else {
            this.emit('warning', error);
        }
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

        // @KI_HINWEIS: Frueher wurde "authenticated" auch bei fehlgeschlagenem Refresh gemeldet
        // (Callback bekam bei Erfolg den Body, bei Fehler den Error - beides truthy).
        // Jetzt: Erfolg -> authenticated; ungueltiges Token (4xx) -> Fehler mit Hinweis auf
        // Neu-Authentifizierung; Netzwerk-/Serverfehler -> erneuter Versuch nach 60 s.
        const tryRefresh = () => {
            this.authenticate_refresh(args.refresh_token, err => {
                if (!err) {
                    this.emit('authenticated');
                    return callback && callback();
                }
                if (err.permanent) {
                    this.setConnected(false);
                    this.emit('error', new Error('Stored tokens are no longer valid. Please authenticate again in the instance configuration.'));
                    return callback && callback(err);
                }
                glob_lib_adapter && glob_lib_adapter.log.info('Token refresh failed, retrying in 60 seconds');
                clearTimeout(this.auth_retry_timeout);
                this.auth_retry_timeout = setTimeout(tryRefresh, 60 * 1000);
            });
        };
        tryRefresh();

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

    glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate: grant_type=${form.grant_type}, scope=${form.scope}`);

    request({
        url,
        method: 'POST',
        form,
    }, (err, response, body) => {
        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate err ${err}`);
        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: authenticate status ${response && response.statusCode}`);
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
    // @KI_HINWEIS: Netatmo rotiert das Refresh-Token seit 04/2023 bei jedem Refresh und entwertet
    // das alte. Parallele Refreshes (mehrere Module mit abgelaufenem Token) wuerden sich gegenseitig
    // invalidieren. Deshalb laeuft immer nur ein Refresh; weitere Aufrufer haengen sich an.
    if (this.refresh_pending) {
        callback && this.refresh_pending.push(callback);
        return this;
    }
    this.refresh_pending = callback ? [callback] : [];
    const finish = (error, data) => {
        const callbacks = this.refresh_pending || [];
        this.refresh_pending = null;
        if (!callbacks.length) {
            // Refresh per Timer ohne wartenden Aufrufer: Ergebnis selbst melden
            this.reportResult('Token refresh', error);
        }
        callbacks.forEach(cb => cb(error, data));
    };

    const form = {
        grant_type: 'refresh_token',
        refresh_token: this.refresh_token || refresh_token,
        client_id: this.client_id,
        client_secret: this.client_secret,
    };

    const url = util.format('%s/oauth2/token', BASE_URL);

    glob_lib_adapter && glob_lib_adapter.log.debug('netatmo: authenticate_refresh');
    request({
        url,
        method: 'POST',
        form,
    }, (err, response, body) => {
        if (err || !response || response.statusCode !== 200) {
            const permanent = !!response && response.statusCode >= 400 && response.statusCode < 500;
            return this.handleRequestError(err, response, body, 'Authenticate refresh error', permanent, error => {
                // the request limit is no reason to log in again
                error.permanent = permanent && !error.rateLimited;
                finish(error);
            });
        }

        try {
            body = JSON.parse(body);
        } catch (e) {
            return finish(new Error(`Authenticate refresh error: invalid response (${e.message})`));
        }

        this.access_token = body.access_token;
        this.refresh_token = body.refresh_token;

        this.emit('access_token', this.access_token);
        this.emit('refresh_token', this.refresh_token);

        if (body.expires_in) {
            clearTimeout(this.auth_refresh_timeout);
            this.auth_refresh_timeout = setTimeout(this.authenticate_refresh.bind(this), (body.expires_in - 10) * 1000, body.refresh_token);
        }

        finish(null, body);
    });

    return this;
};

/** Number of consecutive transient failures after which they are logged as error */
const TRANSIENT_ERROR_THRESHOLD = 3;

/**
 * Central logging of the result of a periodic API request.
 * Transient Netatmo outages are logged as warning for the first failures, as error once
 * TRANSIENT_ERROR_THRESHOLD consecutive requests failed, and the recovery is logged as info.
 * Other errors are logged as error immediately.
 * @param {string} source name of the requesting part, e.g. "Doorbell"
 * @param {Error|null|undefined} err error of the request, empty on success
 */
netatmo.prototype.reportResult = function (source, err) {
    this.failures = this.failures || {};
    const log = glob_lib_adapter && glob_lib_adapter.log;
    if (!log) {
        return;
    }
    const count = this.failures[source] || 0;
    if (err && err.rateLimited) {
        // already logged once when the pause started, see startRateLimitPause()
        this.rateLimitSeen = true;
        log.debug(`${source}: ${err.message}`);
        return;
    }
    if (!err && this.rateLimitSeen && Date.now() >= rateLimitedUntil) {
        this.rateLimitSeen = false;
        log.info('Netatmo requests resumed after the request limit pause');
    }
    if (!err) {
        this.setConnected(true);
        if (count) {
            // a single failed request was only logged as debug, so its recovery is debug too
            const text = `${source}: Netatmo API reachable again after ${count} failed request(s)`;
            count > 1 ? log.info(text) : log.debug(text);
            this.failures[source] = 0;
        }
        return;
    }
    if (err.ignorable) {
        log.debug(`${source}: ${err.message}`);
        return;
    }
    const failures = count + 1;
    this.failures[source] = failures;
    if (!err.transient || failures >= TRANSIENT_ERROR_THRESHOLD) {
        this.setConnected(false);
    }
    if (!err.transient) {
        log.error(`${source}: ${err.message}`);
    } else if (failures === 1) {
        // @KI_HINWEIS: Netatmo liefert mehrmals taeglich einzelne 503 ("Service temporarily
        // unavailable"), die beim naechsten Abruf weg sind. Erst ab dem 2. Fehlschlag in Folge warnen.
        log.debug(`${source}: Netatmo API temporarily not available (${err.message}), retrying with the next update (1/${TRANSIENT_ERROR_THRESHOLD})`);
    } else if (failures < TRANSIENT_ERROR_THRESHOLD) {
        log.warn(`${source}: Netatmo API temporarily not available (${err.message}), retrying with the next update (${failures}/${TRANSIENT_ERROR_THRESHOLD})`);
    } else if (failures === TRANSIENT_ERROR_THRESHOLD || failures % 10 === 0) {
        log.error(`${source}: Netatmo API not available for ${failures} requests in a row: ${err.message}`);
    } else {
        log.debug(`${source}: Netatmo API still not available (${failures}): ${err.message}`);
    }
};

/**
 * Updates the adapter state info.connection (only on change).
 * @param {boolean} connected true if the Netatmo cloud is reachable and the authentication is valid
 */
netatmo.prototype.setConnected = function (connected) {
    if (this.connected === connected || !glob_lib_adapter) {
        return;
    }
    this.connected = connected;
    glob_lib_adapter.setState('info.connection', {val: connected, ack: true});
};

/**
 * Stops all pending token timers (called on adapter unload).
 */
netatmo.prototype.stop = function () {
    clearTimeout(this.auth_refresh_timeout);
    clearTimeout(this.auth_retry_timeout);
    this.auth_refresh_timeout = null;
    this.auth_retry_timeout = null;
    this.removeAllListeners('authenticated');
};


/**
 * https://dev.netatmo.com/doc/methods/getuser
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getUser = function (callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () =>
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
        return this.once('authenticated', () =>
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
        return this.once('authenticated', () =>
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () =>
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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

netatmo.prototype.setState = function (homeId, moduleId, fieldName, fieldValue, bridgeId, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => {
            this.setState(homeId, moduleId, fieldName, fieldValue, bridgeId, callback);
        });
    }

    if (typeof bridgeId === 'function') {
        callback = bridgeId;
        bridgeId = undefined;
    }
    if (typeof bridgeId !== 'string') {
        bridgeId = undefined;
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

    if (fieldValue === undefined || fieldValue === null) {
        this.emit('error', new Error('setState "fieldValue" not set.'));
        return this;
    }

    const url = util.format('%s/api/setstate', BASE_URL);

    const body = {
        home: {
            id: homeId,
            modules: [
                {
                    id: moduleId,
                    bridge: bridgeId
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
            return this.handleRequestError(err, response, body, 'setstate error', false, callback, this.setState.bind(this, homeId, moduleId, fieldName, fieldValue, bridgeId, callback));
        }

        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (err) {
                if (callback) {
                    return callback(err);
                }
            }
        }

        if (body && typeof body === 'object') {
            if (callback) {
                return callback(err, body.status);
            }
        } else {
            if (callback) {
                return callback(err, body);
            }
        }

        return this;

    });

    return this;
};


/**
 * https://dev.netatmo.com/doc/methods/homesdata - new call for gethomesdata
 * @param options
 * @param callback
 * @returns {*}
 * CHECKED
 */
netatmo.prototype.homesdata = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => {
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
            qs.home_id = options.home_id;
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
 * Returns homesdata, merged with homestatus and the events of each home, filtered to the
 * requested gateway types.
 *
 * @KI_HINWEIS: Kameras, Klingel, Rauch-/CO-Melder und Rolllaeden fragen im selben Takt ab. Frueher
 * holte jedes Produkt homesdata + homestatus + getevents selbst (3 Requests pro Produkt und Home).
 * Jetzt werden Anfragen innerhalb von HOMEDATA_COMBINE_DELAY zu einer Abfrage fuer alle Typen
 * zusammengefasst, und homesdata (Struktur der Homes) wird HOMESDATA_CACHE_TIME zwischengespeichert,
 * wie bei Home Assistant. Netatmo reduziert ab 03/2027 die Limits fuer Polling.
 * @param {{gateway_types?: string|string[]}} options gateway types of the requesting product
 * @param {(err: Error|null, data?: any) => void} callback result: {homes: [...]} like homesdata
 */
netatmo.prototype.homedataExtended = function (options, callback) {
    const types = [].concat((options && options.gateway_types) || []);
    this.homedataPending = this.homedataPending || [];
    this.homedataPending.push({types, callback});
    if (!this.homedataTimer) {
        this.homedataTimer = setTimeout(() => {
            this.homedataTimer = null;
            const pending = this.homedataPending;
            this.homedataPending = [];
            const allTypes = [...new Set(pending.flatMap(p => p.types))].sort();
            this.homedataCombined(allTypes, (err, data) => {
                for (const p of pending) {
                    if (err) {
                        p.callback && p.callback(err);
                    } else {
                        p.callback && p.callback(null, filterHomeData(data, p.types));
                    }
                }
            });
        }, HOMEDATA_COMBINE_DELAY);
    }
    return this;
};

/**
 * Forgets the cached homesdata, e.g. after Netatmo reported a changed home structure.
 */
netatmo.prototype.invalidateHomesData = function () {
    this.homesdataCache = null;
};

/**
 * Reads homesdata (cached), homestatus and getevents for all requested gateway types.
 * @param {string[]} types gateway types
 * @param {(err: Error|null, data?: any) => void} callback merged data, events of each home unfiltered
 */
netatmo.prototype.homedataCombined = function (types, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => this.homedataCombined(types, callback));
    }
    const options = types.length ? {gateway_types: types} : null;
    const key = types.join(',');

    (async () => {
        let homesdata;
        const cache = this.homesdataCache;
        if (cache && cache.key === key && Date.now() - cache.ts < HOMESDATA_CACHE_TIME) {
            homesdata = cache.data;
        } else {
            homesdata = await new Promise((resolve, reject) => {
                this.homesdata(options, (err, data) => err ? reject(err) : resolve(data));
            });
            glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: homesdata: ${JSON.stringify(homesdata)}`);
            this.homesdataCache = {key, ts: Date.now(), data: homesdata};
        }
        // copy, the merge below must not change the cached data
        const homeData = JSON.parse(JSON.stringify(homesdata || {}));

        for (const home of homeData.homes || []) {
            if (!home.modules || !home.modules.length) {
                // no device of the requested types in this home, status and events not needed
                continue;
            }
            const homeStatus = await new Promise((resolve, reject) => {
                this.homestatus(home.id, options, (err, data) => err ? reject(err) : resolve(data));
            });
            glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: homestatus for ${home.id}: ${JSON.stringify(homeStatus)}`);
            // @KI_HINWEIS: Events sind optional. Ein Fehler bei getevents (z. B. "Service temporarily
            // unavailable") hat frueher homesdata/homestatus des ganzen Zyklus verworfen.
            const homeEvents = await new Promise(resolve => {
                this.getevents(home.id, options, (err, data) => {
                    if (err) {
                        glob_lib_adapter && glob_lib_adapter.log.debug(`netatmo: getevents for ${home.id} failed, continuing without events: ${err.message}`);
                        resolve(null);
                    } else {
                        glob_lib_adapter && glob_lib_adapter.log.silly(`netatmo: getevents for ${home.id}: ${JSON.stringify(data)}`);
                        resolve(data);
                    }
                });
            });
            mergeHomeStatus(home, homeStatus, homeEvents, () => this.invalidateHomesData());
        }
        return homeData;
    })().then(data => callback(null, data), err => {
        this.invalidateHomesData();
        callback(err);
    });
};

/**
 * Merges homestatus and events into the modules of a home from homesdata.
 * @param {any} home home from homesdata (copy)
 * @param {any} homeStatus result of homestatus
 * @param {any} homeEvents result of getevents or null
 * @param {() => void} onUnknownModule called if homestatus knows a module homesdata does not know (new device)
 */
function mergeHomeStatus(home, homeStatus, homeEvents, onUnknownModule) {
    const modules = home.modules || [];
    const statusModules = (homeStatus && homeStatus.home && homeStatus.home.modules) || [];
    for (const statusModule of statusModules) {
        const aModule = modules.find(m => m.id === statusModule.id);
        if (aModule) {
            Object.assign(aModule, statusModule);
            // marker for deviceStatus: status data of this module was received
            aModule.statusReceived = true;
        } else {
            onUnknownModule();
        }
    }
    for (const error of (homeStatus && homeStatus.errors) || []) {
        const aModule = modules.find(m => m.id === error.id);
        if (aModule) {
            aModule.errorStatus = errorStatusTexts[error.code] || `unknown_error_${error.code}`;
        }
    }
    if (homeEvents && homeEvents.home && homeEvents.home.events) {
        home.events = homeEvents.home.events;
    }
}

/**
 * Filters the combined data to the gateway types of one product, like Netatmo does with
 * gateway_types: the gateways of these types and the modules bridged to them.
 * @param {any} data combined data
 * @param {string[]} types gateway types of the product
 * @returns {any} copy with filtered modules and events
 */
function filterHomeData(data, types) {
    const result = JSON.parse(JSON.stringify(data));
    if (!types.length) {
        return result;
    }
    for (const home of result.homes || []) {
        if (!home.modules) {
            delete home.events;
            continue;
        }
        const gatewayIds = home.modules.filter(m => types.includes(m.type)).map(m => m.id);
        const modules = home.modules.filter(m => gatewayIds.includes(m.id) || (m.bridge && gatewayIds.includes(m.bridge)));
        if (modules.length) {
            home.modules = modules;
            const ids = modules.map(m => m.id);
            if (home.events) {
                home.events = home.events.filter(event => ids.includes(event.module_id));
            }
        } else {
            delete home.modules;
            delete home.events;
        }
    }
    return result;
}

/**
 * https://dev.netatmo.com/doc/methods/homestatus - new call for homestatus
 * @param home_id
 * @param options
 * @param callback
 * @returns {*}
 * CHECKED
 */
netatmo.prototype.homestatus = function (home_id, options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => {
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
            return this.handleRequestError(err, response, body, 'homestatus error', false, callback, this.homestatus.bind(this, home_id, options, callback));
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
 * https://dev.netatmo.com/doc/methods/getnextevents
 * @param options
 * @param callback
 * @returns {*}
 * @deprecated Now use `Getevents`
 */
netatmo.prototype.getNextEvents = function (options, callback) {
    // Wait until authenticated.
    if (!this.access_token) {
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () =>
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
        return this.once('authenticated', () => {
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
            return this.handleRequestError(err, response, body, 'getevents error', false, callback, this.getevents.bind(this, home_id, options, callback));
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
