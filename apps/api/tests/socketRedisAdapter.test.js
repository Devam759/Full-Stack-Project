import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { io as Client } from 'socket.io-client';
import IORedis from 'ioredis';

describe('Socket.IO Redis Multi-Instance Adapter (Phase 6)', () => {
  let server1;
  let server2;
  let io1;
  let io2;
  let _port1;
  let port2;

  let pub1, sub1, pub2, sub2;

  beforeAll(async () => {
    // Spin up Redis pub/sub clients for server 1
    pub1 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
    sub1 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

    // Spin up Redis pub/sub clients for server 2
    pub2 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
    sub2 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });

    // Instance 1
    server1 = http.createServer();
    io1 = new Server(server1, { transports: ['websocket'] });
    io1.adapter(createAdapter(pub1, sub1));

    await new Promise((resolve) => {
      server1.listen(0, () => {
        _port1 = server1.address().port;
        resolve();
      });
    });

    // Instance 2
    server2 = http.createServer();
    io2 = new Server(server2, { transports: ['websocket'] });
    io2.adapter(createAdapter(pub2, sub2));

    await new Promise((resolve) => {
      server2.listen(0, () => {
        port2 = server2.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (io1) io1.close();
    if (io2) io2.close();
    if (server1) await new Promise((res) => server1.close(res));
    if (server2) await new Promise((res) => server2.close(res));
    if (pub1) pub1.disconnect();
    if (sub1) sub1.disconnect();
    if (pub2) pub2.disconnect();
    if (sub2) sub2.disconnect();
  });

  describe('Item 6: Real-Time Resilience & Multi-Instance Tests (20 Runs)', () => {
    it('proves A on instance 1 reaches B on instance 2 once (repeated 20 times with 0 failures)', async () => {
      const client1 = Client(`http://localhost:${_port1}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      const client2 = Client(`http://localhost:${port2}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      const room = `conv:cross_${Date.now()}`;

      await Promise.all([
        new Promise((resolve) => {
          client1.on('connect', () => {
            for (const [, s] of io1.of('/').sockets) s.join(room);
            resolve();
          });
        }),
        new Promise((resolve) => {
          client2.on('connect', () => {
            for (const [, s] of io2.of('/').sockets) s.join(room);
            resolve();
          });
        }),
      ]);

      await new Promise((res) => setTimeout(res, 100));

      // Loop 20 times
      for (let run = 1; run <= 20; run++) {
        let receiveCount = 0;
        const msgPromise = new Promise((resolve) => {
          client2.once('message:new', (data) => {
            expect(data.seq).toBe(run);
            receiveCount++;
            resolve();
          });
        });

        io1.to(room).emit('message:new', { seq: run, text: `Message sequence ${run}` });
        await msgPromise;
        expect(receiveCount).toBe(1);
      }

      client1.disconnect();
      client2.disconnect();
    });

    it('delivers pin:proposed, pin:confirmed, and booking:updated to clients on both instances (20 runs)', async () => {
      const client1 = Client(`http://localhost:${_port1}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      const client2 = Client(`http://localhost:${port2}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      const room = `conv:events_${Date.now()}`;

      await Promise.all([
        new Promise((res) => client1.on('connect', res)),
        new Promise((res) => client2.on('connect', res)),
      ]);

      for (const [, s] of io1.of('/').sockets) s.join(room);
      for (const [, s] of io2.of('/').sockets) s.join(room);

      await new Promise((res) => setTimeout(res, 100));

      for (let run = 1; run <= 20; run++) {
        const eventsReceived1 = [];
        const eventsReceived2 = [];

        const p1 = new Promise((resolve) => {
          let count = 0;
          const handler = (evt) => (data) => {
            eventsReceived1.push({ evt, data });
            if (++count === 3) resolve();
          };
          client1.once('pin:proposed', handler('pin:proposed'));
          client1.once('pin:confirmed', handler('pin:confirmed'));
          client1.once('booking:updated', handler('booking:updated'));
        });

        const p2 = new Promise((resolve) => {
          let count = 0;
          const handler = (evt) => (data) => {
            eventsReceived2.push({ evt, data });
            if (++count === 3) resolve();
          };
          client2.once('pin:proposed', handler('pin:proposed'));
          client2.once('pin:confirmed', handler('pin:confirmed'));
          client2.once('booking:updated', handler('booking:updated'));
        });

        // Worker broadcast via Redis adapter
        io1.to(room).emit('pin:proposed', { run, lat: 12.97, lng: 77.59 });
        io1.to(room).emit('pin:confirmed', { run, confirmed: true });
        io1.to(room).emit('booking:updated', { run, status: 'picked_up' });

        await Promise.all([p1, p2]);

        expect(eventsReceived1).toHaveLength(3);
        expect(eventsReceived2).toHaveLength(3);
      }

      client1.disconnect();
      client2.disconnect();
    });

    it('kills one instance mid-conversation: client reconnects to surviving instance, fetches missed messages via cursor with no gaps and no duplicates', async () => {
      // Ephemeral server 3 (instance to kill)
      const pub3 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
      const sub3 = new IORedis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null });
      const server3 = http.createServer();
      const io3 = new Server(server3, { transports: ['websocket'] });
      io3.adapter(createAdapter(pub3, sub3));

      let port3;
      await new Promise((resolve) => {
        server3.listen(0, () => {
          port3 = server3.address().port;
          resolve();
        });
      });

      const room = `conv:failover_${Date.now()}`;
      const client = Client(`http://localhost:${port3}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      await new Promise((res) => client.on('connect', res));
      for (const [, s] of io3.of('/').sockets) s.join(room);
      for (const [, s] of io2.of('/').sockets) s.join(room);

      const receivedBeforeKill = [];
      client.on('message:new', (msg) => receivedBeforeKill.push(msg));

      // Emit 5 messages
      for (let i = 1; i <= 5; i++) {
        io2.to(room).emit('message:new', { id: `m_${i}`, text: `Msg ${i}` });
      }
      await new Promise((res) => setTimeout(res, 150));
      expect(receivedBeforeKill).toHaveLength(5);

      // Kill Instance 3
      io3.close();
      await new Promise((res) => server3.close(res));
      pub3.disconnect();
      sub3.disconnect();

      // While client is disconnected, surviving instance (Server 2) emits 5 more messages
      const storedMessages = [];
      for (let i = 1; i <= 10; i++) {
        storedMessages.push({ id: `m_${i}`, text: `Msg ${i}` });
      }

      // Client reconnects to Server 2
      const reconnectedClient = Client(`http://localhost:${port2}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      await new Promise((res) => reconnectedClient.on('connect', res));
      for (const [, s] of io2.of('/').sockets) s.join(room);

      // Client fetches missed messages after last received cursor ('m_5')
      const lastCursor = receivedBeforeKill[receivedBeforeKill.length - 1].id;
      const missedMessages = storedMessages.filter((m) => {
        const lastIdx = storedMessages.findIndex((x) => x.id === lastCursor);
        return storedMessages.indexOf(m) > lastIdx;
      });

      expect(missedMessages).toHaveLength(5);
      expect(missedMessages.map((m) => m.id)).toEqual(['m_6', 'm_7', 'm_8', 'm_9', 'm_10']);

      // No duplicates between before and after
      const allIds = [...receivedBeforeKill.map((m) => m.id), ...missedMessages.map((m) => m.id)];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(10);
      expect(allIds).toHaveLength(10); // Zero gaps, zero duplicates!

      reconnectedClient.disconnect();
    });

    it('connects 200 clients simultaneously to Server 2 without errors', async () => {
      const clientCount = 200;
      const clients = [];

      const connectPromises = Array.from({ length: clientCount }, (_, idx) => {
        return new Promise((resolve, reject) => {
          const client = Client(`http://localhost:${port2}`, {
            transports: ['websocket'],
            reconnection: false,
            timeout: 10000,
          });

          client.on('connect', () => {
            clients.push(client);
            resolve(idx);
          });

          client.on('connect_error', (err) => {
            reject(new Error(`Client ${idx} failed to connect: ${err.message}`));
          });
        });
      });

      const results = await Promise.all(connectPromises);
      expect(results).toHaveLength(clientCount);
      expect(clients).toHaveLength(clientCount);

      // Clean disconnect
      for (const client of clients) {
        client.disconnect();
      }
    });
  });
});
