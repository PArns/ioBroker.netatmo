const EventEmitter = require('events');

let socket = null; // We use the same socket instance
const socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

class EventEmitterBridge extends EventEmitter {
    constructor() {
        super();
        if (!socket)  {
            console.log('connecting to socket')
            socket = require('socket.io-client')(socketServerUrl);
        }

        if (socket) {
            socket.on('alert', data => {
                this.emit('alert', data)
            });
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
