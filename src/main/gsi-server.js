'use strict';

const http = require('node:http');

const MAX_BODY_BYTES = 1024 * 1024;

// Lille lokal webserver som CS2/Dota 2 sender deres spiltilstand til.
// Lytter kun på 127.0.0.1, og beskeder uden den rigtige token afvises.
function startGsiServer({ port, getToken, onPayload, onError }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (!payload?.auth || payload.auth.token !== getToken()) {
        res.writeHead(401).end();
        return;
      }
      onPayload(payload);
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    });
  });
  server.on('error', onError);
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startGsiServer };
