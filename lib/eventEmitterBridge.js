const EventEmitter = require('events');

class EventEmitterBridge extends EventEmitter {
    constructor(api, adapter) {
        // Simulate a singleton
        if (EventEmitterBridge._instance) {
            return EventEmitterBridge._instance
        }
        super();
        EventEmitterBridge._instance = this;

        if (!adapter.config.iotInstance) {
            adapter.log.warn('Disable Realtime Events because no iot instance configured. Please see Adapter Readme for Details!');
            return;
        }
        this.adapter = adapter;
        this.apiInstance = api;
        adapter.sendTo(adapter.config.iotInstance, 'getServiceEndpoint', {serviceName: 'netatmo'}, (err, res) => {
            if (err) {
                adapter.log.error('Cannot get service endpoint for callbacks: ' + err);
                return;
            }
            if (!res || !res.url || !res.stateID) {
                adapter.log.error('Cannot get service endpoint for callbacks: ' + JSON.stringify(res));
                return;
            }
            this.callbackUrl = res.url;
            this.stateId = res.stateID;
            adapter.subscribeForeignStates(this.stateId);

            adapter.on('stateChange', (id, state) => {
                if (id === res.stateID && state && state.val && state.ack) {
                    try {
                        this.adapter.log.debug(`Websocket incoming alert: ${state.val}`)
                        const obj = JSON.parse(state.val);
                        if (obj) {
                            this.emit('alert', obj);
                        }
                    } catch (e) {
                        adapter.log.error('Cannot parse callback data: ' + e.message);
                    }
                }
            });

            this.apiInstance.addWebHook(this.callbackUrl, (err, body, qs) => {
                if (err) {
                    this.adapter.log.error(`Error while adding webhook: ${err}`);
                } else {
                    this.adapter.log.info(`Webhook added: ${JSON.stringify(body.toString())}`);
                }
            });
        });
    }

    destructor() {
        if (this.stateId) {
            this.adapter.unsubscribeForeignStates(this.stateId);
        }
        this.apiInstance = null;
        this.stateId = null;
        this.callbackUrl = null;
    }
}

module.exports = EventEmitterBridge;
