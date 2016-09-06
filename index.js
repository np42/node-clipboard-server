'use strict';

const ncp    = require('copy-paste');
const net    = require('net');
const config = require('./config.json');
const crypto = require('crypto');

let paste = null;
let connection = null;

const serverConnect = function connect() {
  console.log('Listening on:', config.server);
  const server = net.createServer( (socket) => {
    if (connection != null) return console.log('Rejecting new client');
    console.log('New client');
    connection = socket;
    socket.on('data', receive);
    socket.on('end', () => { connection = null; });
    socket.on('error', () => { connection = null; });
  }).on('error', (err) => {
    console.log('close', err);
    server.close();
    connection = null;
    setTimeout(connect, config.retry || 1000);
  }).listen(config.server);
  return server;
};

const clientConnect = function connect() {
  const retry = () => {
    connection = null;
    setTimeout(connect, config.retry || 1000);
  };
  const client = net.connect(config.client, () => {
    console.log('Connected on:', config.client);
    connection = client;
  });
  client.on('end', () => {
    console.log('connection end');
    retry();
  });
  client.on('data', receive);
  client.on('error', () => { retry(); });
};

const emit = function (data) {
  if (connection == null) return ;
  const buffer = new Buffer(encrypt(data));
  //console.log('sending buffer:', buffer.toString());
  try { connection.write(buffer.length + ':' + buffer); }
  catch (e) { console.log(e); }
};

const receive = (function () {
  let length = 0;
  let timeout = null;
  const buffer = [];
  const clear = () => {
    length = 0;
    buffer.splice(0, Infinity);
    timeout = null;
  };
  const renew = () => {
    if (timeout != null) clearTimeout(timeout);
    timeout = setTimeout(clear, 1000);
  };
  return function (data) {
    if (buffer.length == 0) {
      renew();
      const offset = data.indexOf(':');
      length = parseInt(data.slice(0, offset).toString(), 10);
      if (!(length > 0)) return clear();
      const chunk = data.slice(offset + 1);
      console.log('receiving new data', chunk.length, '/', length);
      buffer.push(chunk);
      length -= chunk.length;
    } else if (length > 0) {
      console.log('receiving complementaty data:', data.length);
      buffer.push(data);
      length -= data.length;
    }
    if (length < 0) {
      console.log('out of length - reset');
      clear();
    } else if (length == 0) {
      let size = 0;
      for (let i = 0; i < buffer.length; i++)
        size += buffer[i].length;
      let result = new Buffer(size);
      for (let i = 0, count = 0; i < buffer.length; i++) {
        result.write(buffer[i].toString('binary'), count);
        count += buffer[i].length;
      }
      clear();
      clearTimeout(timeout);
      timeout = null;
      const data = decrypt(result);
      //console.log('received buffer: ' + data);
      paste = data;
      ncp.copy(data);
    }
  };
})();

const encrypt = function (data) {
  const cipher = crypto.createCipher('aes-256-ctr', config.secret);
  const message = Buffer.concat([cipher.update(data), cipher.final()]);
  return message.toString('base64');
};

const decrypt = function (data) {
  const message = new Buffer(data.toString(), 'base64');
  const decipher = crypto.createDecipher('aes-256-ctr', config.secret);
  return Buffer.concat([decipher.update(message), decipher.final()]).toString();
};

/************************/

process.on('uncaughtException', (err) => {
  console.log(err);
});

(function loop() {
  return setTimeout(() => {
    return ncp.paste(function (err, data) {
      loop();
      if (err) {
        if (~(err + '').indexOf('target STRING not available')) return ;
        else return console.log(err);
      }
      if (paste == data) return ;
      paste = data;
      data = new Buffer(data);
      if (data.length == 0) return ;
      emit(paste);
    });
  }, 1000);
})();

/******************/

if (config.mode == 'server') {
  return serverConnect();
} else {
  return clientConnect();
}
