const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateDeck() {
    const suits = ['♥', '♠', '♦', '♣'];
    let deck = [];
    suits.forEach(suit => {
        for (let i = 1; i <= 9; i++) {
            deck.push({ v: i.toString(), s: suit });
            deck.push({ v: i.toString(), s: suit });
        }
    });
    return deck.sort(() => Math.random() - 0.5);
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return rooms[code] ? generateRoomCode() : code;
}

function startTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.turnTimer) clearInterval(room.turnTimer);
    
    room.timeLeft = 15;
    io.to(roomCode).emit('timerUpdate', room.timeLeft);
    
    room.turnTimer = setInterval(() => {
        room.timeLeft--;
        io.to(roomCode).emit('timerUpdate', room.timeLeft);
        
        if (room.timeLeft <= 0) {
            clearInterval(room.turnTimer);
            const currentPlayerId = room.players[room.turnIndex];
            if (currentPlayerId !== 'AI_PLAYER') {
                forceDrawAndPass(roomCode, currentPlayerId);
            }
        }
    }, 1000);
}

function forceDrawAndPass(roomCode, playerId) {
    const room = rooms[roomCode];
    if (!room || room.players[room.turnIndex] !== playerId) return;
    
    if (room.deck.length === 0) room.deck = generateDeck();
    room.hands[playerId].push(room.deck.pop());
    
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    updateGameState(roomCode);
    checkAiTurn(roomCode);
}

function checkAiTurn(roomCode) {
    const room = rooms[roomCode];
    if (room && room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
        setTimeout(() => processAiTurn(roomCode), 1500);
    } else {
        startTurnTimer(roomCode);
    }
}

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode, players: [socket.id],
            playerNames: { [socket.id]: data.playerName || 'لاعب 1' },
            hands: { [socket.id]: [] }, scores: { [socket.id]: 0 }, unoSafe: { [socket.id]: true },
            deck: [], topCard: null, turnIndex: 0, isAi: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('createAIRoom', (data) => {
        const roomCode = generateRoomCode();
        const aiId = 'AI_PLAYER';
        rooms[roomCode] = {
            code: roomCode, players: [socket.id, aiId],
            playerNames: { [socket.id]: data.playerName || 'لاعب', [aiId]: 'الكمبيوتر 🤖' },
            hands: { [socket.id]: [], [aiId]: [] }, scores: { [socket.id]: 0, [aiId]: 0 }, unoSafe: { [socket.id]: true, [aiId]: true },
            deck: [], topCard: null, turnIndex: 0, isAi: true
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        startNewRound(roomCode);
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'الغرفة غير موجودة!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'الغرفة ممتلئة (الحد الأقصى 4 لاعبين)!');
        if (room.players.includes(socket.id)) return;

        room.players.push(socket.id);
        room.playerNames[socket.id] = playerName || `لاعب ${room.players.length}`;
        room.hands[socket.id] = [];
        room.scores[socket.id] = 0;
        room.unoSafe[socket.id] = true;
        socket.join(roomCode);
        socket.emit('roomJoined', roomCode);
        
        io.to(roomCode).emit('lobbyUpdate', room.players.map(id => room.playerNames[id]));
        
        // بدأ اللعب فوراً إذا اكتمل 4 أو يمكن بدء اللعبة يدوياً (للتسهيل سنبدأ بمجرد دخول شخصين كحد أدنى)
        if(room.players.length === 2) {
             startNewRound(roomCode);
        }
    });

    socket.on('callUno', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].hands[socket.id].length === 1) {
            rooms[roomCode].unoSafe[socket.id] = true;
            io.to(roomCode).emit('toastMsg', `${rooms[roomCode].playerNames[socket.id]} قال UNO!`);
        }
    });

    socket.on('challengeUno', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (room && room.hands[targetId] && room.hands[targetId].length === 1 && !room.unoSafe[targetId]) {
            if (room.deck.length < 2) room.deck = generateDeck();
            room.hands[targetId].push(room.deck.pop(), room.deck.pop());
            room.unoSafe[targetId] = true; // تم عقابه
            io.to(roomCode).emit('toastMsg', `تم تحدي ${room.playerNames[targetId]} بنجاح! سحب بطاقتين.`);
            updateGameState(roomCode);
        }
    });

    function startNewRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        room.deck = generateDeck();
        room.players.forEach(playerId => {
            room.hands[playerId] = room.deck.splice(0, 7);
            room.unoSafe[playerId] = true;
        });
        room.topCard = room.deck.pop();
        room.turnIndex = Math.floor(Math.random() * room.players.length);

        io.to(roomCode).emit('startGame', { isAi: room.isAi, isNewRound: true });
        updateGameState(roomCode);
        checkAiTurn(roomCode);
    }

    function updateGameState(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach(playerId => {
            if (playerId === 'AI_PLAYER') return;
            const opponents = room.players.filter(id => id !== playerId).map(id => ({
                id: id, name: room.playerNames[id], count: room.hands[id].length, score: room.scores[id] || 0, isVulnerable: (room.hands[id].length === 1 && !room.unoSafe[id])
            }));

            io.to(playerId).emit('updateGameState', {
                myHand: room.hands[playerId], opponents: opponents, topCard: room.topCard,
                isMyTurn: room.players[room.turnIndex] === playerId,
                myScore: room.scores[playerId] || 0, myName: room.playerNames[playerId],
                isNewRound: room.isNewRoundMarker
            });
        });
        room.isNewRoundMarker = false;
    }

    socket.on('playCard', ({ roomCode, cardIndex }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.players[room.turnIndex]) return;

        const hand = room.hands[socket.id];
        const cardToPlay = hand[cardIndex];

        if (cardToPlay.v === room.topCard.v || cardToPlay.s === room.topCard.s) {
            hand.splice(cardIndex, 1);
            room.topCard = cardToPlay;
            
            // تحقق من الـ UNO
            if (hand.length === 1) room.unoSafe[socket.id] = false;

            if (hand.length === 0) return handleRoundWin(roomCode, socket.id);

            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            updateGameState(roomCode);
            checkAiTurn(roomCode);
        } else {
            socket.emit('errorMsg', 'ورقة غير صالحة!');
        }
    });

    socket.on('drawCard', (roomCode) => {
        forceDrawAndPass(roomCode, socket.id);
    });

    function processAiTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        const aiHand = room.hands['AI_PLAYER'];
        const validIdx = aiHand.findIndex(c => c.v === room.topCard.v || c.s === room.topCard.s);

        if (validIdx !== -1) {
            room.topCard = aiHand.splice(validIdx, 1)[0];
            if (aiHand.length === 1) room.unoSafe['AI_PLAYER'] = true; // البوت يقول اونو تلقائياً
            if (aiHand.length === 0) return handleRoundWin(roomCode, 'AI_PLAYER');
        } else {
            if (room.deck.length === 0) room.deck = generateDeck();
            aiHand.push(room.deck.pop());
        }
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        updateGameState(roomCode);
        checkAiTurn(roomCode);
    }

    function handleRoundWin(roomCode, winnerId) {
        const room = rooms[roomCode];
        if(room.turnTimer) clearInterval(room.turnTimer);
        
        let pointsWon = 0;
        room.players.forEach(id => {
            if(id !== winnerId) room.hands[id].forEach(c => pointsWon += parseInt(c.v) || 5);
        });
        room.scores[winnerId] = (room.scores[winnerId] || 0) + pointsWon;
        room.isNewRoundMarker = true;

        io.to(roomCode).emit('roundOver', { winnerId, pointsWon });
        if (room.scores[winnerId] >= 100) {
            io.to(roomCode).emit('gameOver', { winnerId });
            delete rooms[roomCode];
        } else {
            setTimeout(() => startNewRound(roomCode), 4000);
        }
    }
    
    socket.on('sendChatMessage', (data) => {
        if(rooms[data.roomCode]) io.to(data.roomCode).emit('receiveChatMessage', { senderId: socket.id, senderName: rooms[data.roomCode].playerNames[socket.id], message: data.message });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));