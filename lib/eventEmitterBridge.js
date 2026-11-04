const EventEmitter = require('events');

class EventEmitterBridge extends EventEmitter {
    constructor(api, adapter) {
        // Simulate a singleton
        if (EventEmitterBridge._instance) {
            return EventEmitterBridge._instance;
        }
        super();
        EventEmitterBridge._instance = this;
        this.homeIds = [];

        if (!adapter.config.iotInstance) {
            adapter.log.warn('Disable Realtime Events because no iot instance configured. Please see Adapter Readme for Details!');
            return;
        }
        this.adapter = adapter;
        this.apiInstance = api;
        adapter.sendTo(adapter.config.iotInstance, 'getServiceEndpoint', {serviceName: 'netatmo'}, result => {
            if (result && result.error) {
                adapter.log.error(`Cannot get service endpoint for callbacks: ${result.error}`);
            }
            if (!result || !result.url || !result.stateID) {
                adapter.log.error(`Cannot get service endpoint for callbacks: ${JSON.stringify(result)}`);
                return;
            }
            this.callbackUrl = result.url;
            this.stateId = result.stateID;
            adapter.subscribeForeignStates(this.stateId);

            this.stateChangeHandler = (id, state) => {
                if (id === this.stateId && state && state.val && state.ack) {
                    try {
                        this.adapter.log.debug(`Websocket incoming alert: ${state.val}`)
                        const obj = JSON.parse(state.val);
                        if (obj && this.homeIds.includes(obj.home_id)) {
                            this.emit('alert', obj);
                        }
                    } catch (e) {
                        adapter.log.error(`Cannot parse callback data: ${e.message}`);
                    }
                }
            };
            adapter.on('stateChange', this.stateChangeHandler);

            this.apiInstance.addWebHook(this.callbackUrl, (err, body, qs) => {
                if (err) {
                    this.adapter.log.error(`Error while adding webhook: ${err}`);
                } else {
                    this.adapter.log.info(`Webhook added: ${JSON.stringify(body.toString())}`);
                }
            });
        });
    }

    joinHome(id) {
        if (!this.homeIds.includes(id)) {
            this.homeIds.push(id);
        }
    }

    destructor() {
        // @KI_HINWEIS: Singleton zuruecksetzen, sonst liefert der naechste Konstruktor-Aufruf
        // (Re-Init nach erneuter Authentifizierung) die zerstoerte Instanz ohne Webhook zurueck.
        if (EventEmitterBridge._instance === this) {
            EventEmitterBridge._instance = null;
        }
        if (this.stateChangeHandler && this.adapter) {
            this.adapter.removeListener('stateChange', this.stateChangeHandler);
            this.stateChangeHandler = null;
        }
        this.removeAllListeners();
        if (this.stateId && this.adapter) {
            this.adapter.unsubscribeForeignStates(this.stateId);
        }
        this.apiInstance = null;
        this.stateId = null;
        this.callbackUrl = null;
    }
}

module.exports = EventEmitterBridge;
