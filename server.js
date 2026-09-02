const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATABASE_FILE = path.join(__dirname, 'database.json');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

function readDatabase() {
  if (!fs.existsSync(DATABASE_FILE)) return { users: {}, pairCodes: {}, rooms: {} };
  return JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
}

function writeDatabase(database) {
  const temporaryFile = `${DATABASE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2));
  fs.renameSync(temporaryFile, DATABASE_FILE);
}

function createPairCode(database) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
  while (database.pairCodes[code]);
  return code;
}

function userView(user) {
  const database = readDatabase();
  return { id: user.id, name: user.name, pairCode: user.pairCode, qrPayload: `our-space://pair/${user.pairCode}`, roomId: user.roomId, partnerName: user.partnerId ? database.users[user.partnerId].name : null };
}

function getUser(userId) { return readDatabase().users[userId]; }

app.use(express.json({ limit: '20mb' }));
app.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.get('/service-worker.js', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'), { dotfiles: 'allow' });
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/qr/:pairCode', async (req, res) => {
  const database = readDatabase();
  if (!database.pairCodes[req.params.pairCode]) return res.status(404).end();
  res.type('png').send(await QRCode.toBuffer(`our-space://pair/${req.params.pairCode}`, { width: 220, margin: 1 }));
});

app.post('/api/auth', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const existingId = typeof req.body.userId === 'string' ? req.body.userId : null;
  const database = readDatabase();
  if (existingId && database.users[existingId]) return res.json({ user: userView(database.users[existingId]) });
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter a name between 1 and 60 characters.' });
  const user = { id: crypto.randomUUID(), name, pairCode: createPairCode(database), partnerId: null, roomId: null };
  database.users[user.id] = user;
  database.pairCodes[user.pairCode] = user.id;
  writeDatabase(database);
  res.json({ user: userView(user) });
});

app.get('/api/users/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: userView(user) });
});

app.post('/api/pair', (req, res) => {
  const database = readDatabase();
  const user = database.users[req.body.userId];
  const code = typeof req.body.pairCode === 'string' ? req.body.pairCode.trim().toUpperCase() : '';
  const partner = database.users[database.pairCodes[code]];
  if (!user || !partner) return res.status(400).json({ error: 'That Pair Code is not valid.' });
  if (user.id === partner.id) return res.status(400).json({ error: 'You cannot pair with yourself.' });
  if (user.roomId || partner.roomId) return res.status(409).json({ error: 'One of these users is already permanently paired.' });
  const roomId = `room_${crypto.randomUUID()}`;
  database.rooms[roomId] = { id: roomId, memberIds: [user.id, partner.id], messages: [], createdAt: new Date().toISOString() };
  user.partnerId = partner.id; user.roomId = roomId;
  partner.partnerId = user.id; partner.roomId = roomId;
  writeDatabase(database);
  io.to(`user:${partner.id}`).emit('paired', { user: userView(partner) });
  res.json({ user: userView(user) });
});

app.get('/api/rooms/:roomId/messages', (req, res) => {
  const database = readDatabase();
  const room = database.rooms[req.params.roomId];
  if (!room || !room.memberIds.includes(req.query.userId)) return res.status(403).json({ error: 'Private room access denied.' });
  res.json({ messages: room.messages });
});

io.use((socket, next) => {
  const userId = socket.handshake.auth && socket.handshake.auth.userId;
  if (!getUser(userId)) return next(new Error('Authentication required.'));
  socket.userId = userId; next();
});

io.on('connection', (socket) => {
  const user = getUser(socket.userId);
  if (!user) return;
  socket.join(`user:${user.id}`);
  if (user.roomId) socket.join(user.roomId);

  socket.on('typing', () => {
    const currentUser = getUser(socket.userId);
    const room = currentUser && currentUser.roomId && readDatabase().rooms[currentUser.roomId];
    if (!room || !room.memberIds.includes(socket.userId)) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('typing', { userId: socket.userId, userName: currentUser.name });
  });

  socket.on('stop_typing', () => {
    const currentUser = getUser(socket.userId);
    const room = currentUser && currentUser.roomId && readDatabase().rooms[currentUser.roomId];
    if (!room || !room.memberIds.includes(socket.userId)) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('stop_typing', { userId: socket.userId, userName: currentUser.name });
  });

  socket.on('message:reaction', ({ messageId, emoji }) => {
    const currentUser = getUser(socket.userId);
    const room = currentUser && currentUser.roomId && readDatabase().rooms[currentUser.roomId];
    if (!room || !room.memberIds.includes(socket.userId) || typeof messageId !== 'string' || typeof emoji !== 'string') return;
    const message = room.messages.find((entry) => entry.id === messageId);
    if (!message) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('message:reaction', { messageId, emoji, userId: socket.userId });
  });

  socket.on('message:send', ({ text, imageDataUrl }) => {
    const database = readDatabase();
    const currentUser = database.users[socket.userId];
    const room = currentUser && currentUser.roomId && database.rooms[currentUser.roomId];
    const cleanText = typeof text === 'string' ? text.trim() : '';
    const cleanImage = typeof imageDataUrl === 'string' ? imageDataUrl.trim() : '';

    if (!room || !room.memberIds.includes(socket.userId)) return;
    if (!cleanText && !cleanImage) return;
    if (cleanText.length > 4000) return;
    if (cleanImage && !cleanImage.startsWith('data:image/')) return;

    const message = {
      id: crypto.randomUUID(),
      senderId: socket.userId,
      senderName: currentUser.name,
      text: cleanText,
      imageDataUrl: cleanImage || null,
      createdAt: new Date().toISOString(),
    };

    room.messages.push(message);
    writeDatabase(database);
    io.to(room.id).emit('message:new', message);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Our Space is running at http://localhost:${PORT}`));
