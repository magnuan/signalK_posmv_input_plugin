const dgram = require('dgram');
const source_label = {
  label: 'posmv',
  type: 'GNSS',
  src: 'PosMV-udp'
}

function parseGid1(buffer) {
    const result = {};
    let offset = 0;

    result.latitude = buffer.readDoubleLE(offset); offset += 8;
    result.longitude = buffer.readDoubleLE(offset); offset += 8;
    result.altitude = buffer.readDoubleLE(offset); offset += 8;

    result.north_velocity = buffer.readFloatLE(offset); offset += 4;
    result.east_velocity = buffer.readFloatLE(offset); offset += 4;
    result.down_velocity = buffer.readFloatLE(offset); offset += 4;

    result.roll = buffer.readDoubleLE(offset); offset += 8;
    result.pitch = buffer.readDoubleLE(offset); offset += 8;
    result.yaw = buffer.readDoubleLE(offset); offset += 8;
    result.wander_angle = buffer.readDoubleLE(offset); offset += 8;

    result.track_angle = buffer.readFloatLE(offset); offset += 4;
    result.speed = buffer.readFloatLE(offset); offset += 4;

    result.roll_rate = buffer.readFloatLE(offset); offset += 4;
    result.pitch_rate = buffer.readFloatLE(offset); offset += 4;
    result.yaw_rate = buffer.readFloatLE(offset); offset += 4;

    result.fwd_acceleration = buffer.readFloatLE(offset); offset += 4;
    result.stb_acceleration = buffer.readFloatLE(offset); offset += 4;
    result.down_acceleration = buffer.readFloatLE(offset); offset += 4;

    return result;
}

function parseGid3(buffer) {
    const result = {};
    let offset = 0;

    result.nav_status = buffer.readUInt8(offset); offset += 1;
    result.num_SV = buffer.readUInt8(offset); offset += 1;
    result.ch_status_byte_count = buffer.readUInt16LE(offset); offset += 2;

    // Skip variable-length channel status block
    offset += result.ch_status_byte_count;

    // Guard: ensure enough bytes remain
    const remaining = buffer.length - offset;
    const expected = 4 + 4 + 4 + 2 + 4 + 8 + 4 + 4 + 2 + 4; // 40 bytes

    if (remaining < expected) {
        return { error: `Payload too short for GID 3 fixed fields. Needed ${expected}, found ${remaining}` };
    }

    result.hdop = buffer.readFloatLE(offset); offset += 4;
    result.vdop = buffer.readFloatLE(offset); offset += 4;
    result.dgps_latency = buffer.readFloatLE(offset); offset += 4;
    result.dgps_ref_id = buffer.readUInt16LE(offset); offset += 2;
    result.week_number = buffer.readUInt32LE(offset); offset += 4;
    result.gps_utc_time_offset = buffer.readDoubleLE(offset); offset += 8;
    result.gps_nav_msg_latency = buffer.readFloatLE(offset); offset += 4;
    result.geoidal_separation = buffer.readFloatLE(offset); offset += 4;
    result.gps_rec_tpe = buffer.readUInt16LE(offset); offset += 2;
    result.gps_status = buffer.readUInt32LE(offset); offset += 4;

    return result;
}




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

      gps_utc_time_offset = 0;
      geoidal_separation = 0;

      app.debug(`Starting PosMV plugin on ${ip}:${port}, max rate ${maxRate}Hz`)

      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        app.error(`Socket error: ${err}`);
        socket.close();
        socket=null;
      });


      socket.on('message', (msg, rinfo) => {
        /** Basic packet filtering **/ 
        // Skip short packets
        if (msg.length < 6) {
            //app.debug(`Too short`);
            return;
        }
        // IP filtering if a specific IP is set
        const sourceIP = rinfo.address;
        if (ip !== '0.0.0.0' && sourceIP !== ip) {
            //app.debug(`Wrong IP`);
            return;
        }
        //Check that message starts as a PosMV GRP message
        const prefix = msg.toString('ascii', 0, 4);
        if (prefix !== '$GRP') {
            //app.debug(`Wrong Start`);
            return;
        }
        //Only process GID=1 and 3
        const gid = msg.readUInt16LE(4);
        if ((gid !== 1) && (gid!==3)) {
            //app.debug(`Wrong gid`);
            return;
        }
        // Rate limiting
        const now = Date.now();
        const rate = typeof maxRate === 'number' && maxRate > 0 ? maxRate : 1; // fallback
        const minInterval = 1000 / rate;
        if (lastMessageTime && (now - lastMessageTime) < minInterval) {
          //app.debug(`Rate skip`);
          return;
        }
        lastMessageTime = now;
        // Passed all filters, process message
        
        /** Process rest of header **/
        if (msg.length < 34) {
            app.debug(`Message too short (${msg.length} bytes), ignoring.`);
            return;
        }

        const count = msg.readUInt16LE(6);
        const time1 = msg.readDoubleLE(8);
        const time2 = msg.readDoubleLE(16);
        const dist = msg.readDoubleLE(24);
        const timeType = msg.readUInt8(32);
        const distType = msg.readUInt8(33);

        app.debug(`Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}, GID ${gid}: count=${count}, time1=${time1}, time2=${time2}, dist=${dist}, timeType=${timeType}, distType=${distType}`);
        
        //TODO convert PosMV format time to UTC here if PosMV time is wanted
        
        //** Process payload based on gid **/
        const payload = msg.slice(34); // Remaining message

        let data
        if (gid == 1) {
            data = parseGid1(payload);
            if(data) {
                data.altitude -= geoidal_separation;

                //Prepare and send data to SignalK 
                const toRad = deg => deg * Math.PI / 180;
                const delta = {
                  updates: [
                    {
                      source: source_label ,
                      timestamp: new Date().toISOString(), // TODO use time from PosMV instead of system time
                      values: [
                        { path: 'navigation.attitude', value: {yaw: toRad(data.yaw),roll: toRad(data.roll),pitch: toRad(data.pitch)}},
                        { path: 'navigation.position', value: {longitude: data.longitude, latitude: data.latitude}},
                        { path: 'navigation.courseOverGroundTrue', value: toRad(data.track_angle)  },
                        { path: 'navigation.rateOfTurn', value: toRad(data.yaw_rate)},
                        { path: 'navigation.speedOverGround', value: data.speed }
                      ]
                    }
                  ]
                };
                app.handleMessage(plugin.id, delta);
            }
        }
        else if (gid == 3) {
            data = parseGid3(payload);
            if (data) {
                gps_utc_time_offset = data.gps_utc_time_offset;
                geoidal_separation = data.geoidal_separation;
            }
        }
        else {
            return;
        }
        
        app.debug(`GID ${gid} payload: ${JSON.stringify(data)}`);
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

