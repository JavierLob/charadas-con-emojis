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

// Normalize: word can be string (no image) or {title, image}
function norm(w) {
  return typeof w === 'string' ? { title: w, image: '' } : { title: w.title || '', image: w.image || '' };
}

function getCategory(id) { return data.categories.find(c => c.id === id); }

function getWords(categoryId) {
  const cat = getCategory(categoryId);
  if (!cat) return [];
  if (cat.combined && cat.combineIds) {
    return cat.combineIds.flatMap(id => (getCategory(id)?.words || []).map(norm));
  }
  return (cat.words || []).map(norm);
}

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getWord(categoryId) {
  const words = getWords(categoryId);
  if (!words.length) return { word: '???', image: '' };
  const item = getRandom(words);
  return { word: item.title, image: item.image || '' };
}

// ── Admin Auth ────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'charadas2024';
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// ── Admin API ─────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  res.json(data.categories.map(c => ({
    id: c.id, name: c.name, image: c.image,
    combined: c.combined || false,
    wordCount: getWords(c.id).length,
  })));
});

app.get('/api/categories/:id', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ...cat, words: getWords(cat.id) });
});

app.post('/api/categories', adminAuth, (req, res) => {
  const { name, image } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
  if (getCategory(id)) return res.status(400).json({ error: 'Ya existe' });
  const cat = { id, name, image: image || '', words: [] };
  data.categories.push(cat);
  saveData();
  res.json(cat);
});

app.put('/api/categories/:id', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'No encontrada' });
  if (req.body.name !== undefined) cat.name = req.body.name;
  if (req.body.image !== undefined) cat.image = req.body.image;
  saveData();
  res.json(cat);
});

app.delete('/api/categories/:id', adminAuth, (req, res) => {
  const idx = data.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  if (data.categories[idx].combined) return res.status(400).json({ error: 'No se puede eliminar la categoría combinada' });
  data.categories.splice(idx, 1);
  saveData();
  res.json({ ok: true });
});

// Add words: accepts [{title, image}] or ["string"]
app.post('/api/categories/:id/words', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat || cat.combined) return res.status(400).json({ error: 'Categoría inválida' });
  const incoming = (req.body.words || [])
    .map(w => typeof w === 'string' ? { title: w.trim(), image: '' } : { title: (w.title || '').trim(), image: w.image || '' })
    .filter(w => w.title);
  const existingTitles = new Set(cat.words.map(w => norm(w).title));
  const added = [];
  for (const w of incoming) {
    if (!existingTitles.has(w.title)) {
      // Store as string if no image (saves space), as object if has image
      cat.words.push(w.image ? w : w.title);
      added.push(w.title);
      existingTitles.add(w.title);
    }
  }
  saveData();
  res.json({ added, total: cat.words.length });
});

// Update a word's title and/or image
app.put('/api/categories/:id/words', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat || cat.combined) return res.status(400).json({ error: 'Categoría inválida' });
  const { oldTitle, title, image } = req.body;
  const idx = cat.words.findIndex(w => norm(w).title === oldTitle);
  if (idx === -1) return res.status(404).json({ error: 'Palabra no encontrada' });
  const newTitle = (title || oldTitle).trim();
  cat.words[idx] = image ? { title: newTitle, image } : newTitle;
  saveData();
  res.json({ ok: true });
});

// Delete words by title array
app.delete('/api/categories/:id/words', adminAuth, (req, res) => {
  const cat = getCategory(req.params.id);
  if (!cat || cat.combined) return res.status(400).json({ error: 'Categoría inválida' });
  const toRemove = new Set(req.body.words || []);
  cat.words = cat.words.filter(w => !toRemove.has(norm(w).title));
  saveData();
  res.json({ total: cat.words.length });
});

// ── Scraper ───────────────────────────────────────────────────────

app.post('/api/scrape', adminAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  try {
    const results = await scrapeUrl(url);
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al scrapear' });
  }
});

// Upgrade IMDB thumbnail to full poster
function fixImgUrl(url) {
  if (!url) return '';
  if (url.includes('media-amazon.com')) {
    return url.replace(/(_V1_).*(\.(jpg|jpeg|png|webp))/i, '$1$2');
  }
  return url;
}

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

  const $ = cheerio.load(resp.data);
  let results = [];

  // ── Strategy 1: IMDB list items (new design) ──────────────────
  // Each movie is in a <li class="ipc-metadata-list-summary-item">
  $('li.ipc-metadata-list-summary-item, li[class*="list-summary-item"]').each((_, li) => {
    const titleEl = $(li).find('h4.ipc-title__text, h3.ipc-title__text').first();
    const imgEl   = $(li).find('img[class*="ipc-image"], img.ipc-image').first();
    const title   = titleEl.text().trim().replace(/^\d+\.\s*/, '');
    const image   = fixImgUrl(imgEl.attr('src') || '');
    if (title.length > 1 && title.length < 150) results.push({ title, image });
  });

  // ── Strategy 2: IMDB old design ──────────────────────────────
  if (!results.length) {
    $('.lister-item').each((_, item) => {
      const title = $(item).find('.lister-item-header a').first().text().trim();
      const image = fixImgUrl($(item).find('.lister-item-image img').attr('src') || '');
      if (title) results.push({ title, image });
    });
  }

  // ── Strategy 3: JSON-LD (schema.org) ─────────────────────────
  if (!results.length) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const list = Array.isArray(json) ? json : [json];
        list.forEach(obj => {
          (obj.itemListElement || []).forEach(item => {
            const name  = item?.item?.name || item?.name;
            const image = item?.item?.image || '';
            if (name) results.push({ title: name.trim(), image });
          });
        });
      } catch {}
    });
  }

  // ── Strategy 4: __NEXT_DATA__ (Next.js) ──────────────────────
  if (!results.length) {
    const m = resp.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const found = new Map(); // title → image
        walkNextData(JSON.parse(m[1]), found);
        results = [...found.entries()].map(([title, image]) => ({ title, image }));
      } catch {}
    }
  }

  // ── Strategy 5: Generic CSS ───────────────────────────────────
  if (!results.length) {
    const titleSels = ['h3.ipc-title__text', '.titleColumn a', 'h2 a', 'h3 a', 'ol li a'];
    for (const sel of titleSels) {
      $(sel).each((_, el) => {
        const title = $(el).text().replace(/^\d+\.\s*/, '').trim();
        if (title.length > 1 && title.length < 150) results.push({ title, image: '' });
      });
      if (results.length > 3) break;
    }
  }

  return results.filter(r => r.title.length > 1 && r.title.length < 150);
}

function walkNextData(obj, found, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return;
  const title = obj.titleText?.text || obj.originalTitleText?.text;
  if (title && typeof title === 'string' && title.length > 1) {
    const image = obj.primaryImage?.url || obj.image?.url || '';
    if (!found.has(title)) found.set(title.trim(), image);
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object') walkNextData(v, found, depth + 1);
  }
}

// ── Game rooms ────────────────────────────────────────────────────

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
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
  const pool = room.players.filter(p => p.team == room.currentTeam);
  const clueGiver = (pool.length > 0 ? pool : room.players)[Math.floor(Math.random() * (pool.length || room.players.length))];
  if (!clueGiver) return;
  room.currentPlayer = clueGiver.id;
  const { word, image } = getWord(room.category);
  room.currentWord  = word;
  room.currentImage = image;
  room.emojiText = '';
  room.timeLeft  = 60;

  io.to(room.code).emit('newTurn', { room: sanitizeRoom(room) });
  io.to(room.currentPlayer).emit('yourWord', { word, image, category: room.category });

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
      state: 'lobby', currentTeam: 1, currentPlayer: null,
      currentWord: null, currentImage: '', emojiText: '', timerInterval: null, timeLeft: 0,
    };
    rooms.set(code, room);
    room.players.push({ id: socket.id, name, team: 1, isHost: true });
    socket.join(code); socket.data.roomCode = code;
    socket.emit('roomReady', { room: sanitizeRoom(room), playerId: socket.id });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(code.toUpperCase().trim());
    if (!room) { socket.emit('joinError', 'Sala no encontrada.'); return; }
    if (room.state !== 'lobby') { socket.emit('joinError', 'El juego ya comenzó.'); return; }
    room.players.push({ id: socket.id, name, team: 1, isHost: false });
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
    const p = room.players.find(p => p.id === socket.id); if (!p) return;
    p.team = team;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p?.isHost) return;
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
    const p = room.players.find(p => p.id === socket.id);
    if (!p?.isHost && room.currentPlayer !== socket.id) return;
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
    if (!room.players.length) { if (room.timerInterval) clearInterval(room.timerInterval); rooms.delete(room.code); return; }
    if (!room.players.some(p => p.isHost)) room.players[0].isHost = true;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`\n🎭 Charadas con Emojis → http://localhost:${PORT}`);
  console.log(`🔧 Admin             → http://localhost:${PORT}/admin.html  (pass: ${ADMIN_KEY})\n`);
});
