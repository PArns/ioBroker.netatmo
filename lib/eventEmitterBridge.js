const {EventEmitter} = require("events");
const socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

module.exports = class eventEmitterBridge extends EventEmitter {

    socket = null;

    constructor() {
        super();
        this.socket = require('socket.io-client')(socketServerUrl);

        if (this.socket) {
            this.socket.on('alert', async data => await this.onSocketAlert(data));
        }
    }

    destructor() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    joinHome(id) {
        if (this.socket) {
            this.socket.emit('registerHome', id);
        }
    }

    onSocketAlert(data) {
        this.emit('alert', data)
    }
}
