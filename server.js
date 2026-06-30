const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORDS = {
  infantiles: [
    'El Rey León','Toy Story','Toy Story 2','Toy Story 3','Frozen','Frozen 2',
    'Shrek','Shrek 2','Shrek Tercero','Coco','Moana','Vaiana','WALL-E','Up',
    'Buscando a Nemo','Buscando a Dory','Monsters Inc','Monsters University',
    'Los Increíbles','Los Increíbles 2','Ratatouille','Cars','Cars 2','Brave',
    'Mérida Valiente','Encanto','Luca','Soul','Turning Red','Onward',
    'Inside Out','Inside Out 2','Lightyear','Elemental','Wish',
    'Blancanieves','Cenicienta','La Bella y la Bestia','La Sirenita',
    'Alicia en el País de las Maravillas','Mulan','Aladdin','Hércules',
    'Tarzán','Pocahontas','Bambi','Dumbo','Pinocho','Peter Pan',
    'La Bella Durmiente','El Libro de la Selva','El Jorobado de Notre Dame',
    'Enredados','Rapunzel','Zootopia','Big Hero 6','Tiana y el Sapo',
    'Kung Fu Panda','Kung Fu Panda 2','Kung Fu Panda 3',
    'Madagascar','Madagascar 2','Los Pingüinos de Madagascar',
    'La Era de Hielo','La Era de Hielo 2','La Era de Hielo 3',
    'Los Croods','Los Croods 2','Gru: Mi Villano Favorito','Gru 2','Gru 3',
    'Cómo Entrenar a tu Dragón','Cómo Entrenar a tu Dragón 2',
    'El Príncipe de Egipto','Lilo y Stitch','Bolt',
    'El Planeta del Tesoro','Atlantis','El Espantatiburones',
    'Paddington','Paddington 2','Matilda','Stuart Little',
    'Charlie y la Fábrica de Chocolate','La Historia Sin Fin',
    'Mi Vecino Totoro','El Viaje de Chihiro','El Castillo Ambulante',
    'La Princesa Mononoke','Nausicaä del Valle del Viento',
    'Oliver y su Pandilla','El Coraje de Lassie',
    'Babe el Cerdito Valiente','Homeward Bound','Lassie',
    'Detective Pikachu','Sonic la Película','Sonic la Película 2',
    'Los Minions','El Origen de los Guardianes',
  ],
  movies: [
    'El Rey León','Toy Story','Frozen','Titanic','Matrix','Inception','Avatar',
    'Avengers','Spider-Man','Batman','Shrek','Coco','Up','WALL-E','Ratatouille',
    'Los Increíbles','Buscando a Nemo','Monsters Inc','Harry Potter',
    'El Señor de los Anillos','Star Wars','Jurassic Park','El Joker',
    'La La Land','Interstellar','Gravity','Forrest Gump','El Padrino',
    'Pulp Fiction','Rocky','Gladiador','Braveheart','Piratas del Caribe',
    'Indiana Jones','Volver al Futuro','E.T.','Terminator','El Exorcista',
    'Tiburón','Beetlejuice','El club de la lucha','Soul','Luca','Encanto',
    'Moana','Vaiana','Maléfica','La Bella y la Bestia','Blancanieves',
    'Cenicienta','La Sirenita','Dumbo','Bambi','Pinocho','Alicia en el País de las Maravillas',
    'Mulan','Hércules','Aladdin','Tarzán','Pocahontas','Peter Pan',
    'Kung Fu Panda','Madagascar','La Era de Hielo','Los Croods',
    'Capitán América','Iron Man','Thor','Black Panther','Doctor Strange',
    'Guardianes de la Galaxia','Ant-Man','Superman','Wonder Woman','Aquaman',
    'Liga de la Justicia','El Gran Pez','Amélie','La vida es bella',
    'Intocable','Whiplash','Bohemian Rhapsody','Joker','Dune',
    'No Time to Die','Top Gun','Mission Impossible','El Hobbit',
    'El Origen','El Prestidigitador','Memento','La Propuesta','Hitch',
  ],
  series: [
    'Breaking Bad','Game of Thrones','Friends','La Casa de Papel',
    'Stranger Things','The Office','Black Mirror','Dark','Narcos',
    'Peaky Blinders','The Crown','Ozark','Squid Game','Lupin',
    'Mindhunter','True Detective','House of Cards','Better Call Saul',
    'The Mandalorian','WandaVision','Loki','Emily in Paris','Bridgerton',
    'The Witcher','Lost','Prison Break','Dexter','Seinfeld',
    'How I Met Your Mother','Big Bang Theory','Grey\'s Anatomy','House',
    'The Walking Dead','American Horror Story','Sherlock','Downton Abbey',
    'Ted Lasso','Succession','Yellowstone','Euphoria','Sex Education',
    'Cobra Kai','Outer Banks','The Boys','Invincible','Umbrella Academy',
    'Vikings','Westworld','Altered Carbon','Vis a Vis','Élite',
    'Gran Hotel','MasterChef','La Voz','Survivor','Big Brother',
    'Hawkeye','Moon Knight','She-Hulk','Secret Invasion','Andor',
    'Rings of Power','House of the Dragon','The Last of Us',
    'Wednesday','Ginny and Georgia','Heartstopper','The Bear',
    'Abbott Elementary','Severance','Pachinko','Squid Game',
    'Alice in Borderland','All of Us Are Dead','Hometown Cha-Cha-Cha',
    'Money Heist Korea','Hellbound','Kingdom','Parasyte',
  ],
};

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWord(category) {
  if (category === 'movies') return getRandom(WORDS.movies);
  if (category === 'series') return getRandom(WORDS.series);
  if (category === 'infantiles') return getRandom(WORDS.infantiles);
  return getRandom([...WORDS.movies, ...WORDS.series]);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const rooms = new Map();

function sanitizeRoom(room) {
  return {
    code: room.code,
    category: room.category,
    players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team, isHost: p.isHost })),
    scores: room.scores,
    state: room.state,
    currentTeam: room.currentTeam,
    currentPlayer: room.currentPlayer,
    emojiText: room.emojiText,
    timeLeft: room.timeLeft,
  };
}

function startTurn(room) {
  const teamPlayers = room.players.filter(p => p.team == room.currentTeam);
  const pool = teamPlayers.length > 0 ? teamPlayers : room.players;
  if (pool.length === 0) return;

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
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      io.to(room.code).emit('timeUp', { word: room.currentWord });
      setTimeout(() => {
        room.currentTeam = room.currentTeam === 1 ? 2 : 1;
        startTurn(room);
      }, 3500);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, category }) => {
    let code;
    do { code = generateCode(); } while (rooms.has(code));

    const room = {
      code, category: category || 'both',
      players: [], scores: { 1: 0, 2: 0 },
      state: 'lobby', currentTeam: 1,
      currentPlayer: null, currentWord: null,
      emojiText: '', timerInterval: null, timeLeft: 0,
    };
    rooms.set(code, room);

    const player = { id: socket.id, name, team: 1, isHost: true };
    room.players.push(player);

    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomReady', { room: sanitizeRoom(room), playerId: socket.id });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(code.toUpperCase().trim());
    if (!room) { socket.emit('joinError', 'Sala no encontrada. Verifica el código.'); return; }
    if (room.state !== 'lobby') { socket.emit('joinError', 'El juego ya comenzó.'); return; }

    const player = { id: socket.id, name, team: 1, isHost: false };
    room.players.push(player);

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit('roomReady', { room: sanitizeRoom(room), playerId: socket.id });
    socket.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });

  socket.on('joinDisplay', ({ code }) => {
    const room = rooms.get(code.toUpperCase().trim());
    if (!room) { socket.emit('joinError', 'Sala no encontrada.'); return; }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.isDisplay = true;
    socket.emit('displayReady', { room: sanitizeRoom(room) });
  });

  socket.on('setTeam', ({ team }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.team = team;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player?.isHost) return;
    room.state = 'playing';
    startTurn(room);
  });

  socket.on('updateEmojiText', ({ text }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.currentPlayer !== socket.id) return;
    room.emojiText = text;
    socket.to(room.code).emit('emojiTextUpdate', { text });
  });

  socket.on('correctGuess', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    // Allow host OR current clue giver to mark correct
    if (!player?.isHost && room.currentPlayer !== socket.id) return;
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    room.scores[room.currentTeam]++;
    io.to(room.code).emit('roundWon', { word: room.currentWord, team: room.currentTeam, scores: room.scores });
    setTimeout(() => {
      room.currentTeam = room.currentTeam === 1 ? 2 : 1;
      startTurn(room);
    }, 3500);
  });

  socket.on('skipWord', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.currentPlayer !== socket.id) return;
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    io.to(room.code).emit('wordSkipped', { word: room.currentWord });
    setTimeout(() => {
      room.currentTeam = room.currentTeam === 1 ? 2 : 1;
      startTurn(room);
    }, 2500);
  });

  socket.on('disconnect', () => {
    if (socket.data.isDisplay) return;
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      rooms.delete(room.code);
      return;
    }
    if (!room.players.some(p => p.isHost)) room.players[0].isHost = true;
    io.to(room.code).emit('playerUpdate', { room: sanitizeRoom(room) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log(`\n🎭 Charadas con Emojis`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📱 Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`🌐 Red:     http://${ip}:${PORT}`));
  console.log(`📺 Display: http://${ips[0] || 'localhost'}:${PORT}/display.html`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
