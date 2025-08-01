const dgram = require('dgram');

module.exports = (app) => {
  let socket;

  const plugin = {
    id: 'posmv-input-plugin',
    name: 'PosMV Input Plugin',

    start: (settings, restartPlugin) => {
      const ip = settings.ip || '0.0.0.0'
      const port = settings.port || 5602
      const maxRate = settings.maxRate || 10
      lastMessageTime = 0;

      app.debug(`Starting PosMV plugin on ${ip}:${port}, max rate ${maxRate}Hz`)

      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        app.error(`Socket error: ${err}`);
        socket.close();
        socket=null;
      });


      socket.on('message', (msg, rinfo) => {
        //app.debug(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
        // Skip short packets
        if (msg.length < 6) {
            app.debug(`Too short`);
            return;
        }
          

        // IP filtering if a specific IP is set
        const sourceIP = rinfo.address;
        if (ip !== '0.0.0.0' && sourceIP !== ip) {
            app.debug(`Wrong IP`);
            return;
        }

        //Check that message starts as a PosMV GRP message
        const prefix = msg.toString('ascii', 0, 4);
        if (prefix !== '$GRP') {
            app.debug(`Wrong Start`);
            // Skip unrelated messages
            return;
        }
        //Only process GID=1
        const gid = msg.readUInt16LE(4);
        if (gid !== 1) {
            app.debug(`Wrong gid`);
            return;
        }


        // Rate limiting
        const now = Date.now();
        const rate = typeof maxRate === 'number' && maxRate > 0 ? maxRate : 1; // fallback
        const minInterval = 1000 / rate;

        if (lastMessageTime && (now - lastMessageTime) < minInterval) {
          app.debug(`Rate skip`);
          return;
        }
        lastMessageTime = now;
        // Passed all filters, process message
        
        app.debug(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}, gid: ${gid}`);
        // Further message handling goes here
      });

      socket.bind(port, '0.0.0.0', () => {
        app.debug(`Listening for UDP packets on ${ip}:${port}`);
      });

      // startup logic using ip, port, maxRate
    },

    stop: () => {
      app.debug('Stopping PosMV plugin')
      if (socket) {
        app.debug('Closing UDP socket');
        socket.close();
        socket = null;
      }
      // cleanup logic
    },

    schema: () => ({
      type: 'object',
      properties: {
        ip: {
          type: 'string',
          title: 'PosMV IP Address ("0.0.0.0" for any)',
          default: '0.0.0.0'
        },
        port: {
          type: 'number',
          title: 'UDP Port to Listen On',
          default: 5602
        },
        maxRate: {
          type: 'number',
          title: 'Max Update Rate (Hz)',
          default: 10
        }
      }
    })
  }

  return plugin
}

