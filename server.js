const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Data ──────────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { categories: [] }; }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

function getCategory(id) {
  return data.categories.find(c => c.id === id);
}

function getWords(categoryId) {
  const cat = getCategory(categoryId);
  if (!cat) return [];
  if (cat.combined && cat.combineIds) {
    return cat.combineIds.flatMap(id => getCategory(id)?.words || []);
  }
  return cat.words || [];
}

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWord(categoryId) {
  const words = getWords(categoryId);
  return words.length ? getRandom(words) : '???';
}

// ── Admin Auth ────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'charadas2024';

function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ── Admin API ─────────────────────────────────────────────────────

// List categories (public – needed for the game home screen)
app.get('/api/categories', (req, res) => {
  res.json(data.categories.map(c => ({
    id: c.id, name: c.name, image: c.image,
    combined: c.combined || false,
    wordCount: getWords(c.id).length,
  })));
});

// Get one category with words (admin)
app.get('/api/categories/:id', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ...cat, words: getWords(cat.id) });
});

// Create category
app.post('/api/categories', adminAuth, (req, res) => {
  const { name, image } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
  if (getCategory(id)) return res.status(400).json({ error: 'Ya existe' });
  const cat = { id, name, image: image || '', words: [] };
  data.categories.push(cat);
  saveData();
  res.json(cat);
});

// Update category name/image
app.put('/api/categories/:id', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'No encontrada' });
  if (req.body.name !== undefined) cat.name = req.body.name;
  if (req.body.image !== undefined) cat.image = req.body.image;
  saveData();
  res.json(cat);
});

// Delete category
app.delete('/api/categories/:id', adminAuth, (req, res) => {
  const idx = data.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  if (data.categories[idx].combined) return res.status(400).json({ error: 'No se puede eliminar la categoría combinada' });
  data.categories.splice(idx, 1);
  saveData();
  res.json({ ok: true });
});

// Add words to category
app.post('/api/categories/:id/words', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat || cat.combined) return res.status(400).json({ error: 'Categoría inválida' });
  const incoming = (req.body.words || []).map(w => w.trim()).filter(Boolean);
  const added = [];
  for (const w of incoming) {
    if (!cat.words.includes(w)) { cat.words.push(w); added.push(w); }
  }
  saveData();
  res.json({ added, total: cat.words.length });
});

// Delete words from category
app.delete('/api/categories/:id/words', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat || cat.combined) return res.status(400).json({ error: 'Categoría inválida' });
  const toRemove = new Set(req.body.words || []);
  cat.words = cat.words.filter(w => !toRemove.has(w));
  saveData();
  res.json({ total: cat.words.length });
});

// ── Scraper ───────────────────────────────────────────────────────

app.post('/api/scrape', adminAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  try {
    const titles = await scrapeUrl(url);
    res.json({ titles, count: titles.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al scrapear' });
  }
});

async function scrapeUrl(url) {
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
    },
    timeout: 20000,
  });

  const html = resp.data;
  const $ = cheerio.load(html);
  const found = new Set();

  // 1) JSON-LD (IMDB lists, schema.org)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const list = Array.isArray(json) ? json : [json];
      list.forEach(obj => {
        if (obj.itemListElement) {
          obj.itemListElement.forEach(item => {
            const name = item?.item?.name || item?.name;
            if (name) found.add(clean(name));
          });
        }
        if (obj.name && (obj['@type'] === 'Movie' || obj['@type'] === 'TVSeries' || obj['@type'] === 'TVEpisode')) {
          found.add(clean(obj.name));
        }
      });
    } catch {}
  });

  // 2) __NEXT_DATA__ (Next.js – IMDB nuevo diseño)
  if (found.size === 0) {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      try {
        walkForTitles(JSON.parse(match[1]), found);
      } catch {}
    }
  }

  // 3) CSS selectors genéricos
  if (found.size === 0) {
    const selectors = [
      '.lister-item-header a',           // IMDB viejo
      'h3.ipc-title__text',             // IMDB nuevo
      '[data-testid="list-item-title"]',
      '.titleColumn a',
      '.article li a',
      'ol.ranked-list li .title',
      'table.chart tbody tr td.titleColumn a',
      'h2.article a', 'h3 a', 'h4 a',
    ];
    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const t = clean($(el).text());
        if (t.length > 1 && t.length < 120) found.add(t);
      });
      if (found.size > 5) break;
    }
  }

  // Filtrar basura
  return [...found]
    .map(t => t.replace(/^\d+\.\s*/, '').trim())
    .filter(t => t.length > 1 && t.length < 150 && !/^(see more|ver más|load more|página|page|\d+)$/i.test(t));
}

function clean(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function walkForTitles(obj, found, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return;
  if (obj.titleText?.text) found.add(clean(obj.titleText.text));
  if (obj.originalTitleText?.text) found.add(clean(obj.originalTitleText.text));
  if (typeof obj.name === 'string' && obj.name.length > 1 && obj.name.length < 120) {
    found.add(clean(obj.name));
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object') walkForTitles(v, found, depth + 1);
  }
}

// ── Game rooms ────────────────────────────────────────────────────

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function sanitizeRoom(room) {
  return {
    code: room.code, category: room.category,
    players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team, isHost: p.isHost })),
    scores: room.scores, state: room.state,
    currentTeam: room.currentTeam, currentPlayer: room.currentPlayer,
    emojiText: room.emojiText, timeLeft: room.timeLeft,
  };
}

function startTurn(room) {
  const teamPlayers = room.players.filter(p => p.team == room.currentTeam);
  const pool = teamPlayers.length > 0 ? teamPlayers : room.players;
  if (!pool.length) return;
  const clueGiver = pool[Math.floor(Math.random() * pool.length)];
  room.currentPlayer = clueGiver.id;
  room.currentWord = getWord(room.category);
  room.emojiText = '';
  room.timeLeft = 60;

  io.to(room.code).emit('newTurn', { room: sanitizeRoom(room) });
  io.to(room.currentPlayer).emit('yourWord', { word: room.currentWord, category: room.category });

  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval); room.timerInterval = null;
      io.to(room.code).emit('timeUp', { word: room.currentWord });
      setTimeout(() => { room.currentTeam = room.currentTeam === 1 ? 2 : 1; startTurn(room); }, 3500);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, category }) => {
    let code; do { code = generateCode(); } while (rooms.has(code));
    const room = {
      code, category: category || 'both', players: [], scores: { 1: 0, 2: 0 },
      state: 'lobby', currentTeam: 1, currentPlayer: null, currentWord: null,
      emojiText: '', timerInterval: null, timeLeft: 0,
    };
    rooms.set(code, room);
    const player = { id: socket.id, name, team: 1, isHost: true };
    room.players.push(player);
    socket.join(code); socket.data.roomCode = code;
    socket.emit('roomReady', { room: sanitizeRoom(room), playerId: socket.id });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(code.toUpperCase().trim());
    if (!room) { socket.emit('joinError', 'Sala no encontrada.'); return; }
    if (room.state !== 'lobby') { socket.emit('joinError', 'El juego ya comenzó.'); return; }
    const player = { id: socket.id, name, team: 1, isHost: false };
    room.players.push(player);
    socket.join(room.code); socket.data.roomCode = room.code;
    socket.emit('roomReady', { room: sanitizeRoom(room), playerId: socket.id });
    socket.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });

  socket.on('joinDisplay', ({ code }) => {
    const room = rooms.get(code.toUpperCase().trim());
    if (!room) { socket.emit('joinError', 'Sala no encontrada.'); return; }
    socket.join(room.code); socket.data.roomCode = room.code; socket.data.isDisplay = true;
    socket.emit('displayReady', { room: sanitizeRoom(room) });
  });

  socket.on('setTeam', ({ team }) => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.find(p => p.id === socket.id); if (!player) return;
    player.team = team;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost) return;
    room.state = 'playing'; startTurn(room);
  });

  socket.on('updateEmojiText', ({ text }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.currentPlayer !== socket.id) return;
    room.emojiText = text;
    socket.to(room.code).emit('emojiTextUpdate', { text });
  });

  socket.on('correctGuess', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost && room.currentPlayer !== socket.id) return;
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    room.scores[room.currentTeam]++;
    io.to(room.code).emit('roundWon', { word: room.currentWord, team: room.currentTeam, scores: room.scores });
    setTimeout(() => { room.currentTeam = room.currentTeam === 1 ? 2 : 1; startTurn(room); }, 3500);
  });

  socket.on('skipWord', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.currentPlayer !== socket.id) return;
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    io.to(room.code).emit('wordSkipped', { word: room.currentWord });
    setTimeout(() => { room.currentTeam = room.currentTeam === 1 ? 2 : 1; startTurn(room); }, 2500);
  });

  socket.on('disconnect', () => {
    if (socket.data.isDisplay) return;
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { if (room.timerInterval) clearInterval(room.timerInterval); rooms.delete(room.code); return; }
    if (!room.players.some(p => p.isHost)) room.players[0].isHost = true;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });
});

// ── Start ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const os = require('os');
  const ips = Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`\n🎭 Charadas con Emojis`);
  console.log(`📱 Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`🌐 Red:     http://${ip}:${PORT}`));
  console.log(`🔧 Admin:   http://localhost:${PORT}/admin.html  (pass: ${ADMIN_KEY})\n`);
});
