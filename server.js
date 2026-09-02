const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  text: { type: String, default: '' },
  imageDataUrl: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  pairCode: { type: String, required: true, unique: true, uppercase: true },
  partnerId: { type: String, default: null },
  roomId: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
});

const roomSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  memberIds: { type: [String], required: true },
  messages: { type: [messageSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);
let databaseConnection;

function connectDatabase() {
  if (!MONGODB_URI) return Promise.reject(new Error('MONGODB_URI is not configured.'));
  if (!databaseConnection) databaseConnection = mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  return databaseConnection;
}

async function createPairCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from(crypto.randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('');
  while (await User.exists({ pairCode: code }));
  return code;
}

async function userView(user) {
  const partner = user.partnerId ? await User.findById(user.partnerId).select('name').lean() : null;
  return { id: user._id, name: user.name, pairCode: user.pairCode, qrPayload: `our-space://pair/${user.pairCode}`, roomId: user.roomId, partnerName: partner ? partner.name : null };
}

function getUser(userId) { return User.findById(userId); }

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

app.get('/api/qr/:pairCode', async (req, res, next) => {
  try {
    await connectDatabase();
    if (!await User.exists({ pairCode: req.params.pairCode.toUpperCase() })) return res.status(404).end();
  res.type('png').send(await QRCode.toBuffer(`our-space://pair/${req.params.pairCode}`, { width: 220, margin: 1 }));
  } catch (error) { next(error); }
});

app.post('/api/auth', async (req, res, next) => {
  try {
    await connectDatabase();
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const existingId = typeof req.body.userId === 'string' ? req.body.userId : null;
  if (existingId) {
    const existingUser = await User.findById(existingId);
    if (existingUser) return res.json({ user: await userView(existingUser) });
  }
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter a name between 1 and 60 characters.' });
  const user = await User.create({ _id: crypto.randomUUID(), name, pairCode: await createPairCode() });
  res.json({ user: await userView(user) });
  } catch (error) { next(error); }
});

app.get('/api/users/:userId', async (req, res, next) => {
  try {
  await connectDatabase();
  const user = await getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: await userView(user) });
  } catch (error) { next(error); }
});

app.post('/api/pair', async (req, res, next) => {
  try {
  await connectDatabase();
  const user = await User.findById(req.body.userId);
  const code = typeof req.body.pairCode === 'string' ? req.body.pairCode.trim().toUpperCase() : '';
  const partner = await User.findOne({ pairCode: code });
  if (!user || !partner) return res.status(400).json({ error: 'That Pair Code is not valid.' });
  if (user.id === partner.id) return res.status(400).json({ error: 'You cannot pair with yourself.' });
  if (user.roomId || partner.roomId) return res.status(409).json({ error: 'One of these users is already permanently paired.' });
  const roomId = `room_${crypto.randomUUID()}`;
  await Room.create({ _id: roomId, memberIds: [user.id, partner.id] });
  user.partnerId = partner.id; user.roomId = roomId;
  partner.partnerId = user.id; partner.roomId = roomId;
  await Promise.all([user.save(), partner.save()]);
  io.to(`user:${partner.id}`).emit('paired', { user: await userView(partner) });
  res.json({ user: await userView(user) });
  } catch (error) { next(error); }
});

app.get('/api/rooms/:roomId/messages', async (req, res, next) => {
  try {
  await connectDatabase();
  const room = await Room.findById(req.params.roomId).lean();
  if (!room || !room.memberIds.includes(req.query.userId)) return res.status(403).json({ error: 'Private room access denied.' });
  res.json({ messages: room.messages });
  } catch (error) { next(error); }
});

app.use('/api', (error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'The server could not complete that request.' });
});

io.use((socket, next) => {
  const userId = socket.handshake.auth && socket.handshake.auth.userId;
  connectDatabase().then(() => getUser(userId)).then((user) => {
    if (!user) return next(new Error('Authentication required.'));
    socket.userId = userId; next();
  }).catch(next);
});

io.on('connection', (socket) => {
  getUser(socket.userId).then((user) => {
    if (!user) return;
    socket.join(`user:${user.id}`);
    if (user.roomId) socket.join(user.roomId);
  }).catch(() => socket.disconnect(true));

  socket.on('typing', async () => {
    const currentUser = await getUser(socket.userId);
    const room = currentUser && currentUser.roomId && await Room.findById(currentUser.roomId).lean();
    if (!room || !room.memberIds.includes(socket.userId)) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('typing', { userId: socket.userId, userName: currentUser.name });
  });

  socket.on('stop_typing', async () => {
    const currentUser = await getUser(socket.userId);
    const room = currentUser && currentUser.roomId && await Room.findById(currentUser.roomId).lean();
    if (!room || !room.memberIds.includes(socket.userId)) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('stop_typing', { userId: socket.userId, userName: currentUser.name });
  });

  socket.on('message:reaction', async ({ messageId, emoji }) => {
    const currentUser = await getUser(socket.userId);
    const room = currentUser && currentUser.roomId && await Room.findById(currentUser.roomId).lean();
    if (!room || !room.memberIds.includes(socket.userId) || typeof messageId !== 'string' || typeof emoji !== 'string') return;
    const message = room.messages.find((entry) => entry.id === messageId);
    if (!message) return;
    const partnerId = room.memberIds.find((memberId) => memberId !== socket.userId);
    if (partnerId) io.to(`user:${partnerId}`).emit('message:reaction', { messageId, emoji, userId: socket.userId });
  });

  socket.on('message:send', async ({ text, imageDataUrl }) => {
    const currentUser = await getUser(socket.userId);
    const room = currentUser && currentUser.roomId && await Room.findById(currentUser.roomId);
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
    await room.save();
    io.to(room._id).emit('message:new', message);
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Our Space is running at http://localhost:${PORT}`));
}

module.exports = app;
