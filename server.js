const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

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
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms[code] ? generateRoomCode() : code;
}

io.on('connection', (socket) => {
    console.log(`مستخدم متصل: ${socket.id}`);

    socket.on('createRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 1';
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode, 
            players: [socket.id], 
            playerNames: { [socket.id]: playerName },
            hands: { [socket.id]: [] }, 
            scores: { [socket.id]: 0 },
            deck: [], 
            topCard: null, 
            turnIndex: 0, 
            isAi: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('lobbyUpdated', {
            players: [{ id: socket.id, name: playerName }], hostId: socket.id
        });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'هذه الغرفة غير موجودة!');
        if (room.players.length >= 4) return socket.emit('errorMsg', 'الغرفة ممتلئة!');
        if (room.players.includes(socket.id)) return;

        const pName = playerName || `لاعب ${room.players.length + 1}`;
        room.players.push(socket.id);
        room.playerNames[socket.id] = pName;
        room.hands[socket.id] = [];
        room.scores[socket.id] = 0;
        socket.join(roomCode);
        
        socket.emit('roomJoined', roomCode);
        io.to(roomCode).emit('lobbyUpdated', {
            players: room.players.map(id => ({ id, name: room.playerNames[id] })),
            hostId: room.players[0]
        });
    });

    socket.on('hostStartGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.players[0] === socket.id && room.players.length >= 2) {
            startNewRound(roomCode);
        }
    });

    socket.on('sendChatMessage', ({ roomCode, message }) => {
        if (!roomCode || !message) return;
        const cleanCode = roomCode.toString().toUpperCase().trim();
        const room = rooms[cleanCode];
        if (!room) return;
        const senderName = (room.playerNames && room.playerNames[socket.id]) ? room.playerNames[socket.id] : 'لاعب';
        io.to(cleanCode).emit('receiveChatMessage', { senderId: socket.id, senderName: senderName, message: message.trim() });
    });

    function startNewRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        room.deck = generateDeck();
        room.players.forEach(playerId => {
            room.hands[playerId] = room.deck.splice(0, 7);
        });
        room.topCard = room.deck.pop();
        room.turnIndex = Math.floor(Math.random() * room.players.length);

        io.to(roomCode).emit('startGame', { isAi: room.isAi });
        io.to(roomCode).emit('newRoundStarted');
        updateGameState(roomCode);
    }

    function updateGameState(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach(playerId => {
            const myIndex = room.players.indexOf(playerId);
            const total = room.players.length;
            const opponents = [];

            // 🚀 توزيع دقيق ومطابق لمعرفات الواجهة (top, left, right)
            if (total === 2) {
                const oppId = room.players[(myIndex + 1) % total];
                opponents.push({ pos: 'top', id: oppId, name: room.playerNames[oppId], count: room.hands[oppId].length, score: room.scores[oppId] });
            } else if (total === 3) {
                const opp1Id = room.players[(myIndex + 1) % total];
                const opp2Id = room.players[(myIndex + 2) % total];
                opponents.push({ pos: 'left', id: opp1Id, name: room.playerNames[opp1Id], count: room.hands[opp1Id].length, score: room.scores[opp1Id] });
                opponents.push({ pos: 'right', id: opp2Id, name: room.playerNames[opp2Id], count: room.hands[opp2Id].length, score: room.scores[opp2Id] });
            } else if (total === 4) {
                const opp1Id = room.players[(myIndex + 1) % total];
                const opp2Id = room.players[(myIndex + 2) % total];
                const opp3Id = room.players[(myIndex + 3) % total];
                opponents.push({ pos: 'left', id: opp1Id, name: room.playerNames[opp1Id], count: room.hands[opp1Id].length, score: room.scores[opp1Id] });
                opponents.push({ pos: 'top', id: opp2Id, name: room.playerNames[opp2Id], count: room.hands[opp2Id].length, score: room.scores[opp2Id] });
                opponents.push({ pos: 'right', id: opp3Id, name: room.playerNames[opp3Id], count: room.hands[opp3Id].length, score: room.scores[opp3Id] });
            }

            io.to(playerId).emit('updateGameState', {
                myHand: room.hands[playerId],
                opponents: opponents,
                topCard: room.topCard,
                isMyTurn: room.players[room.turnIndex] === playerId,
                myScore: room.scores[playerId] || 0,
                myName: room.playerNames[playerId] || 'أنا',
                currentTurnId: room.players[room.turnIndex]
            });
        });
    }

    socket.on('playCard', ({ roomCode, cardIndex }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;
        const hand = room.hands[socket.id];
        if (!hand || cardIndex < 0 || cardIndex >= hand.length) return;
        
        const cardToPlay = hand[cardIndex];
        if (cardToPlay.v === room.topCard.v || cardToPlay.s === room.topCard.s) {
            hand.splice(cardIndex, 1);
            room.topCard = cardToPlay;
            if (hand.length === 0) {
                handleRoundWin(roomCode, socket.id);
            } else {
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                updateGameState(roomCode);
            }
        } else {
            socket.emit('errorMsg', 'هذه الورقة لا تتطابق مع الورقة المركزية!');
        }
    });

    socket.on('drawCard', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        
        if (room.deck.length === 0) room.deck = generateDeck();
        room.hands[socket.id].push(room.deck.pop());
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        updateGameState(roomCode);
    });

    function handleRoundWin(roomCode, winnerId) {
        const room = rooms[roomCode];
        let pointsWon = 0;
        
        room.players.forEach(playerId => {
            if (playerId !== winnerId && room.hands[playerId]) {
                room.hands[playerId].forEach(card => {
                    pointsWon += parseInt(card.v) || 5;
                });
            }
        });

        room.scores[winnerId] = (room.scores[winnerId] || 0) + pointsWon;
        io.to(roomCode).emit('roundOver', { winnerId, pointsWon });

        if (room.scores[winnerId] >= 100) {
            io.to(roomCode).emit('gameOver', { winnerId });
            delete rooms[roomCode];
        } else {
            setTimeout(() => startNewRound(roomCode), 3000);
        }
    }

    socket.on('disconnect', () => {
        console.log(`مستخدم انقطع: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`); });