const EventEmitter = require('events');

let socket = null; // We use the same socket instance
const socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

class EventEmitterBridge extends EventEmitter {
    constructor(api, adapter) {
        super();
        this.adapter = adapter;
        if (!socket)  {
            console.log('connecting to socket')
            socket = require('socket.io-client')(socketServerUrl);

            socket.on("connect", () => this.adapter.log.info('Websocket connected for events'));
            socket.on("disconnect", (reason) => this.adapter.log.info(`Websocket disconnected for events : ${reason}`));
            socket.on("connect_error", (err) => this.adapter.log.info(`Websocket error : ${err}`));
        }

        if (socket) {
            socket.on('alert', data => {
                this.adapter.log.debug(`Websocket incoming alert: ${JSON.stringify(data)}`)
                this.emit('alert', data)
            });
            api.addWebHook(socketServerUrl);
        }
    }

    destructor() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
    }

    joinHome(id) {
        if (socket) {
            socket.emit('registerHome', id);
        }
    }
}

module.exports = EventEmitterBridge;
