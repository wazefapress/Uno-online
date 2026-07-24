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
    for (let i = 0; i < 4; i++) { code += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return rooms[code] ? generateRoomCode() : code;
}

io.on('connection', (socket) => {
    console.log(`مستخدم متصل: ${socket.id}`);

    // إنشاء غرفة أونلاين مع دعم سقف النقاط الاختياري
    socket.on('createRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب';
        const targetScore = (data && data.targetScore) ? parseInt(data.targetScore) : 100;
        const roomCode = generateRoomCode();
        
        rooms[roomCode] = {
            code: roomCode, players: [socket.id], playerNames: { [socket.id]: playerName },
            hands: { [socket.id]: [] }, scores: { [socket.id]: 0 },
            deck: [], topCard: null, turnIndex: 0, isAi: false, targetScore: targetScore
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('lobbyUpdated', { players: [{ id: socket.id, name: playerName }], hostId: socket.id });
    });

    // 🤖 إنشاء غرفة اللعب ضد الكمبيوتر (تدعم من 2 لـ 4 لاعبين)
    socket.on('createAIRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب';
        const totalPlayers = (data && data.totalPlayers) ? parseInt(data.totalPlayers) : 2;
        const targetScore = (data && data.targetScore) ? parseInt(data.targetScore) : 100;
        const roomCode = generateRoomCode();
        
        const players = [socket.id];
        const playerNames = { [socket.id]: playerName };
        const hands = { [socket.id]: [] };
        const scores = { [socket.id]: 0 };

        for (let i = 1; i < totalPlayers; i++) {
            const aiId = `AI_BOT_${i}`;
            players.push(aiId);
            playerNames[aiId] = `الكمبيوتر ${i} 🤖`;
            hands[aiId] = [];
            scores[aiId] = 0;
        }

        rooms[roomCode] = {
            code: roomCode, players: players, playerNames: playerNames,
            hands: hands, scores: scores, deck: [], topCard: null,
            turnIndex: 0, isAi: true, isAiProcessing: false, targetScore: targetScore
        };

        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        startNewRound(roomCode);
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

    // معالجة إعادة اللعب وتصفير النقاط
    socket.on('requestRematch', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.players.forEach(playerId => {
            room.scores[playerId] = 0;
        });
        startNewRound(roomCode);
    });

    // استقبال رسائل الشات المتوافقة مع العميل
    socket.on('sendChatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        io.to(roomCode).emit('receiveChatMessage', {
            senderId: socket.id,
            senderName: room.playerNames[socket.id] || 'لاعب',
            message: message
        });
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

        if (room.isAi) { checkAiTurn(roomCode); }
    }

    function updateGameState(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach(playerId => {
            if (playerId.startsWith('AI_BOT')) return; 

            const myIndex = room.players.indexOf(playerId);
            const total = room.players.length;
            const opponents = [];

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
                currentTurnId: room.players[room.turnIndex],
                targetScore: room.targetScore || 100
            });
        });
    }

    function checkAiTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.isAi) return;
        
        const currentPlayerId = room.players[room.turnIndex];
        if (!currentPlayerId || !currentPlayerId.startsWith('AI_BOT')) return;

        if (room.isAiProcessing) return;
        room.isAiProcessing = true;

        setTimeout(() => {
            const currentRoom = rooms[roomCode];
            if (!currentRoom || !currentRoom.isAi) {
                if (currentRoom) currentRoom.isAiProcessing = false;
                return;
            }

            const activeAiId = currentRoom.players[currentRoom.turnIndex];
            if (!activeAiId || !activeAiId.startsWith('AI_BOT')) {
                currentRoom.isAiProcessing = false;
                return;
            }

            const aiHand = currentRoom.hands[activeAiId];
            if (!aiHand) {
                currentRoom.isAiProcessing = false;
                return;
            }

            const validCardIndex = aiHand.findIndex(card => card.v === currentRoom.topCard.v || card.s === currentRoom.topCard.s);

            if (validCardIndex !== -1) {
                const playedCard = aiHand.splice(validCardIndex, 1)[0];
                currentRoom.topCard = playedCard;
                if (aiHand.length === 0) {
                    currentRoom.isAiProcessing = false;
                    handleRoundWin(roomCode, activeAiId);
                    return;
                }
            } else {
                if (currentRoom.deck.length === 0) currentRoom.deck = generateDeck();
                aiHand.push(currentRoom.deck.pop());
            }

            currentRoom.turnIndex = (currentRoom.turnIndex + 1) % currentRoom.players.length;
            currentRoom.isAiProcessing = false;
            
            updateGameState(roomCode);

            const nextPlayerId = currentRoom.players[currentRoom.turnIndex];
            if (nextPlayerId && nextPlayerId.startsWith('AI_BOT')) {
                checkAiTurn(roomCode);
            }
        }, 1200);
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
                if (room.isAi) { checkAiTurn(roomCode); }
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

        if (room.isAi) { checkAiTurn(roomCode); }
    });

    function handleRoundWin(roomCode, winnerId) {
        const room = rooms[roomCode];
        let pointsWon = 0;
        
        room.players.forEach(playerId => {
            if (playerId !== winnerId && room.hands[playerId]) {
                room.hands[playerId].forEach(card => { pointsWon += parseInt(card.v) || 5; });
            }
        });

        room.scores[winnerId] = (room.scores[winnerId] || 0) + pointsWon;
        io.to(roomCode).emit('roundOver', { winnerId, pointsWon });

        const target = room.targetScore || 100;
        if (room.scores[winnerId] >= target) {
            io.to(roomCode).emit('gameOver', { winnerId });
        } else {
            setTimeout(() => startNewRound(roomCode), 10000);
        }
    }

    socket.on('disconnect', () => {
        console.log(`مستخدم انقطع: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`); 
});
