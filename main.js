/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const adapterName = require('./package.json').name.split('.').pop();
const utils = require('@iobroker/adapter-core');
const fs = require('fs');

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

const NetatmoDoorBell = require('./lib/netatmoDoorBell');
let doorbell = null;

const NetatmoBubendorff = require('./lib/netatmoBubendorff');
let bubendorff = null;

let _coachUpdateInterval;
let _weatherUpdateInterval;
let _welcomeUpdateInterval;
let _smokedetectorUpdateInterval;
let _cosensorUpdateInterval;
let _doorbellUpdateInterval;
let _bubendorffUpdateInterval;

let usedClientId;
let usedClientSecret;
let usedScopes;
let storedOAuthData = {};
let dataDir;
let stopped = false;

const extendedObjects = {};

const DEFAULT_CLIENT_ID = '574ddd152baa3cf9598b46cd';
const DEFAULT_CLIENT_SECRET = '6e3UcBKp005k9N0tpwp69fGYECqOpuhtEE9sWJW';

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
                    welcome && welcome.setAway(obj.message, (err, res) => {
                        obj.callback && adapter.sendTo(obj.from, obj.command, {err, res}, obj.callback);
                    });
                    break;
                case 'setHome':
                    welcome && welcome.setHome(obj.message, (err, res) => {
                        obj.callback && adapter.sendTo(obj.from, obj.command, {err, res}, obj.callback);
                    });
                    break;
                case 'getOAuthStartLink': {
                    const args = obj.message;
                    adapter.log.debug(`Received OAuth start message: ${JSON.stringify(args)}`);
                    args.scope = getScopeList(args.scopes, !!(args.client_id && args.client_secret));
                    if (!args.client_id || !args.client_secret) {
                        if (args.client_id || args.client_secret) {
                            adapter.log.warn(`Only one of client_id or client_secret was set, using default values!`);
                        }
                        args.client_id = DEFAULT_CLIENT_ID;
                        args.client_secret = DEFAULT_CLIENT_SECRET;
                    }
                    if (!args.redirect_uri_base.endsWith('/')) args.redirect_uri_base += '/';
                    args.redirect_uri = `${args.redirect_uri_base}oauth2_callbacks/${adapter.namespace}/`;
                    delete args.redirect_uri_base;
                    adapter.log.debug(`Get OAuth start link data: ${JSON.stringify(args)}`);
                    const redirectData = api.getOAuth2AuthenticateStartLink(args);
                    storedOAuthData[redirectData.state] = args;

                    adapter.log.debug(`Get OAuth start link: ${redirectData.url}`);
                    obj.callback && adapter.sendTo(obj.from, obj.command, {openUrl: redirectData.url}, obj.callback);
                    break;
                }
                case 'oauth2Callback': {
                    const args = obj.message;
                    adapter.log.debug(`OAuthRedirectReceived: ${JSON.stringify(args)}`);

                    if (!args.state || !args.code) {
                        adapter.log.warn(`Error on OAuth callback: ${JSON.stringify(args)}`);
                        if (args.error) {
                            obj.callback && adapter.sendTo(obj.from, obj.command, {error: `Netatmo error: ${args.error}. Please try again.`}, obj.callback);
                        } else {
                            obj.callback && adapter.sendTo(obj.from, obj.command, {error: `Netatmo invalid response: ${JSON.stringify(args)}. Please try again.`}, obj.callback);
                        }
                        return;
                    }

                    api.authenticate(args, async err => {
                        if (!err && storedOAuthData[args.state]) {
                            const storedArgs = storedOAuthData[args.state];
                            const native = storedArgs.scopes;
                            if (api.client_id !== DEFAULT_CLIENT_ID) {
                                native.id = api.client_id;
                                native.secret = api.client_secret;
                            }
                            native.username = null;
                            native.password = null;

                            const tokenData = {
                                access_token: api.access_token,
                                refresh_token: api.refresh_token,
                                scope: api.scope,
                                client_id: api.client_id
                            }
                            try {
                                adapter.log.info(`Save OAuth data: ${JSON.stringify(tokenData)}`);
                                fs.writeFileSync(`${dataDir}/tokens.json`, JSON.stringify(tokenData), 'utf8');
                            } catch (err) {
                                adapter.log.error(`Cannot write token file: ${err}`);
                            }

                            obj.callback && adapter.sendTo(obj.from, obj.command, {result: 'Tokens updated successfully.'}, obj.callback);

                            adapter.log.info('Update data in adapter configuration ... restarting ...');
                            adapter.extendForeignObject(`system.adapter.${adapter.namespace}`, {
                                native
                            });
                        } else {
                            adapter.log.error(`OAuthRedirectReceived: ${err}`);
                            obj.callback && adapter.sendTo(obj.from, obj.command, {error: `Error getting new tokens from Netatmo: ${err}. Please try again.`}, obj.callback);
                        }
                    });

                    break;
                }
                default:
                    adapter.log.warn(`Unknown command: ${obj.command}`);
                    break;
            }
        }

        return true;
    });

    adapter.on('unload', callback => {
        try {
            stopped = true;
            cleanupResources();
            adapter.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    });

    adapter.on('stateChange', (id, state) => {
        adapter.log.debug(`stateChange ${id} ${JSON.stringify(state)}`);
        if (state && !state.ack) {
            if (id.startsWith(adapter.namespace)) {
                id = id.substring(adapter.namespace.length + 1);
            }
            if (extendedObjects[id] && extendedObjects[id].native && extendedObjects[id].native.homeId) {
                const obj = extendedObjects[id];
                adapter.log.debug(`set state for field ${obj.native.field}`);
                api.setState(
                    obj.native.homeId,
                    obj.native.moduleId,
                    obj.native.field,
                    obj.native.setValue !== undefined ? obj.native.setValue : state.val,
                    obj.native.bridgeId,
                    (err, res) => {
                    if (err) {
                        adapter.log.error(`Cannot set state ${id}: ${err}`);
                    } else {
                        adapter.log.debug(`State ${id} set successfully`);
                        // update data if set was successful
                        welcome && welcome.situativeUpdate(obj.native.homeId, obj.native.moduleId);
                        bubendorff && bubendorff.situativeUpdate(obj.native.homeId, obj.native.moduleId);
                    }
                });
            }
        }
    });

    adapter.on('ready', () => main());
}

function cleanupResources() {
    try {
        _coachUpdateInterval && clearInterval(_coachUpdateInterval);
        _weatherUpdateInterval && clearInterval(_weatherUpdateInterval);
        _welcomeUpdateInterval && clearInterval(_welcomeUpdateInterval);
        _smokedetectorUpdateInterval && clearInterval(_smokedetectorUpdateInterval);
        _cosensorUpdateInterval && clearInterval(_cosensorUpdateInterval);
        _doorbellUpdateInterval && clearInterval(_doorbellUpdateInterval);
        _bubendorffUpdateInterval && clearInterval(_bubendorffUpdateInterval);

        welcome && welcome.finalize();
        smokedetector && smokedetector.finalize();
        cosensor && cosensor.finalize();
        doorbell && doorbell.finalize();
        bubendorff && bubendorff.finalize();
    } catch (err) {
        // ignore
    }
}

function getScopeList(scopes, individualCredentials) {
    let scope = '';

    if (scopes.netatmoCoach) {
        scope += ' read_homecoach';
    }

    if (scopes.netatmoWelcome) {
        scope += ' read_camera read_presence';

        if (individualCredentials) {
            scope += ' access_camera access_presence write_camera write_presence'
        } else {
            adapter.log.info(`Welcome & Presence support limited because no individual ID/Secret provided.`);
        }
    }

    if (scopes.netatmoSmokedetector) {
        if (individualCredentials) {
            scope += ' read_smokedetector';
        } else {
            adapter.log.warn(`Smoke detector only supported with individual ID/Secret. Disabling!`);
            scopes.netatmoSmokedetector = false;
        }
    }

    if (scopes.netatmoCOSensor) {
        if (individualCredentials) {
            scope += ' read_carbonmonoxidedetector';
        } else {
            adapter.log.warn(`CO sensor only supported with individual ID/Secret. Disabling!`);
            scopes.netatmoCOSensor = false;
        }
    }

    if (scopes.netatmoDoorBell) {
        if (individualCredentials) {
            scope += ' read_doorbell access_doorbell';
        } else {
            adapter.log.warn(`Doorbell only supported with individual ID/Secret. Disabling!`);
            scopes.netatmoDoorBell = false;
        }
    }

    if (scopes.netatmoBubendorff) {
        scope += ' read_bubendorff write_bubendorff';
    }

    // If nothing is set, activate at least the Weatherstation
    if (!(scopes.netatmoCoach || scopes.netatmoWeather || scopes.netatmoWelcome || scopes.netatmoSmokedetector || scopes.netatmoCOSensor || scopes.netatmoDoorBell || scopes.netatmoBubendorff)) {
        adapter.log.info('No product was chosen, using Weather station as default!');
        scopes.netatmoWeather = true;
    }

    if (scopes.netatmoWeather) {
        scope += ' read_station';
    }

    scope = scope.trim();

    return scope;
}

function isEquivalent(a, b) {
    //adapter.log.debug('Compare ' + JSON.stringify(a) + ' with ' +  JSON.stringify(b));
    // Create arrays of property names
    if (a === null || a === undefined || b === null || b === undefined) {
        return (a === b);
    }
    const aProps = Object.getOwnPropertyNames(a);
    const bProps = Object.getOwnPropertyNames(b);

    // If number of properties is different,
    // objects are not equivalent
    if (aProps.length !== bProps.length) {
        //console.log('num props different: ' + JSON.stringify(aProps) + ' / ' + JSON.stringify(bProps));
        return false;
    }

    for (let i = 0; i < aProps.length; i++) {
        const propName = aProps[i];

        if (typeof a[propName] !== typeof b[propName]) {
            //console.log('type props ' + propName + ' different');
            return false;
        }
        if (typeof a[propName] === 'object') {
            if (!isEquivalent(a[propName], b[propName])) {
                return false;
            }
        }
        else {
            // If values of same property are not equal,
            // objects are not equivalent
            if (a[propName] !== b[propName]) {
                //console.log('props ' + propName + ' different');
                return false;
            }
        }
    }

    // If we made it this far, objects
    // are considered equivalent
    return true;
}


function main() {
    let scope = '';
    let id = DEFAULT_CLIENT_ID;
    let secret = DEFAULT_CLIENT_SECRET;
    let individualCredentials = false;
    let access_token;
    let refresh_token;

    adapter.extendOrSetObjectNotExistsAsync = async (id, obj, options) => {
        if (!extendedObjects[id]) {
            adapter.log.debug(`Initially Check/Extend object ${id} ...`);
            extendedObjects[id] = JSON.parse(JSON.stringify(obj));
            return adapter.extendObjectAsync(id, obj, options);
        } else {
            if (!isEquivalent(extendedObjects[id], obj)) {
                adapter.log.debug(`Update object ${id} ...${JSON.stringify(extendedObjects[id])} => ${JSON.stringify(obj)}`);
                extendedObjects[id] = JSON.parse(JSON.stringify(obj));
                return adapter.extendObjectAsync(id, obj, options);
            }
        }
    }

    if (adapter.config.id && adapter.config.secret) {
        id = adapter.config.id;
        secret = adapter.config.secret;
        individualCredentials = true;
        adapter.log.debug(`Use individual ID/Secret`);
    }

    scope = getScopeList(adapter.config, individualCredentials);

    dataDir = utils.getAbsoluteInstanceDataDir(adapter);

    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }
        if (fs.existsSync(`${dataDir}/tokens.json`)) {
            const tokens = JSON.parse(fs.readFileSync(`${dataDir}/tokens.json`, 'utf8'));
            if (tokens.client_id !== id) {
                adapter.log.info(`Stored tokens belong to the different client ID ${tokens.client_id} and not to the configured ID ... deleting`);
                fs.unlinkSync(`${dataDir}/tokens.json`);
            } else {
                access_token = tokens.access_token;
                refresh_token = tokens.refresh_token;
                adapter.log.info(`Using stored tokens to initialize ... ${JSON.stringify(tokens)}`);
            }
            if (tokens.scope !== scope) {
                adapter.log.info(`Stored tokens have different scope ${tokens.scope} and not the configured scope ${scope} ... If you miss data please authenticate again!`);
            }
        }
    } catch (err) {
        adapter.log.error(`Error reading stored tokens: ${err.message}`);
    }

    adapter.config.check_interval = parseInt(adapter.config.check_interval, 10);
    adapter.config.cleanup_interval = parseInt(adapter.config.cleanup_interval, 10);

    // we do not allow intervals below 5 minutes
    if (!individualCredentials && (isNaN(adapter.config.check_interval) || adapter.config.check_interval < 10)) {
        adapter.config.check_interval = 10;
        adapter.log.warn(`Invalid check interval "${adapter.config.check_interval}", fallback to 10 minutes`);
    }

    if (!individualCredentials && (isNaN(adapter.config.cleanup_interval) || adapter.config.cleanup_interval < 20)) {
        adapter.config.cleanup_interval = 60;
        adapter.log.warn(`Invalid cleanup interval "${adapter.config.cleanup_interval}", fallback to 60 minutes`);
    }

    adapter.config.unknown_person_time = adapter.config.unknown_person_time || 24;

    adapter.config.location_elevation = adapter.config.location_elevation || 0;

    usedClientId = id;
    usedClientSecret = secret;
    usedScopes = scope;

    const auth = {
        'client_id': id,
        'client_secret': secret,
        'scope': scope,
        'username': adapter.config.username,
        'password': adapter.config.password
    };
    if (refresh_token) {
        auth.access_token = access_token;
        auth.refresh_token = refresh_token;
    }

    api = new netatmo();
    api.setAdapter(adapter);

    api.on('error', err => {
        adapter.log.warn(`API Error: ${err.message}`);
    });
    api.on('warning', err => {
        adapter.log.info(`API Warning: ${err.message}`);
    });
    api.on('access_token', access_token => {
        adapter.log.debug(`Access Token: ${access_token}`);
    });
    api.on('refresh_token', refresh_token => {
        adapter.log.debug(`Update Refresh tokens: ${refresh_token}`);
        const tokenData = {
            access_token: api.access_token,
            refresh_token: api.refresh_token,
            scope: api.scope,
            client_id: api.client_id
        }
        try {
            fs.writeFileSync(`${dataDir}/tokens.json`, JSON.stringify(tokenData), 'utf8');
        } catch (err) {
            adapter.log.error(`Cannot write token file: ${err}`);
        }
    });
    api.on('authenticated', () => {
        if (stopped) {
            return;
        }
        adapter.log.info(`Successfully authenticated with Netatmo ${api.client_id === DEFAULT_CLIENT_ID ? 'with general ioBroker client' : `with individual client-ID ${api.client_id}`}`);

        cleanupResources();
        initialize();
        adapter.subscribeStates('*');
    });

    adapter.log.info(`Authenticating with Netatmo ${auth.client_id === DEFAULT_CLIENT_ID ? 'using general ioBroker client' : `using individual client-ID ${auth.client_id}`}`);
    try {
        api.authenticate(auth);
    } catch (err) {
        adapter.log.error(`Error while authenticating: ${err.message}`);
    }
}

function initialize() {
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

    if (adapter.config.netatmoDoorBell) {
        doorbell = new NetatmoDoorBell(api, adapter);
        doorbell.init();
        doorbell.requestUpdateDoorBell();

        _doorbellUpdateInterval = setInterval(() =>
            doorbell.requestUpdateDoorBell(), adapter.config.check_interval * 2 * 60 * 1000);
    }

    if (adapter.config.netatmoBubendorff) {
        bubendorff = new NetatmoBubendorff(api, adapter);
        bubendorff.init();
        bubendorff.requestUpdateBubendorff();

        _bubendorffUpdateInterval = setInterval(() =>
            bubendorff.requestUpdateBubendorff(), adapter.config.check_interval * 2 * 60 * 1000);
    }
}

// If started as allInOne mode => return function to create instance
if (require.main === module) {
    startAdapter();
} else {
    // compact mode
    module.exports = startAdapter;
}

