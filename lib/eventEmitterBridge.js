const EventEmitter = require('events')
const inherits = require('util').inherits;
const { io } = require('socket.io-client');

let socket = null;
const socketServerUrl = 'https://iobroker.herokuapp.com/netatmo/';

function eventEmitterBridge() {
    EventEmitter.call(this);
}

inherits(eventEmitterBridge, EventEmitter);

eventEmitterBridge.prototype.init = function() {

    if (!socket)  {
        console.log('connecting to socket')
        socket = io(socketServerUrl);
    }

    const _this = this;
    if (socket) {
        socket.on('alert', data => onSocketAlert(_this,data));
    }

}

 function onSocketAlert(_this,data) {
    _this.emit('alert', data)
}

eventEmitterBridge.prototype.destructor = function() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

eventEmitterBridge.prototype.joinHome = function(id) {
    if (socket) {
        socket.emit('registerHome', id);
    }
}

module.exports = eventEmitterBridge;
