const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
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

    // 1. إنشاء غرفة جديدة
    socket.on('createRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 1';
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            players: [socket.id],
            playerNames: { [socket.id]: playerName },
            hands: { [socket.id]: [] },
            scores: { [socket.id]: 0 },
            unoPressed: { [socket.id]: false },
            deck: [],
            topCard: null,
            turnIndex: 0,
            isAi: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // 2. إنشاء غرفة AI
    socket.on('createAIRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب';
        const roomCode = generateRoomCode();
        const aiId = 'AI_PLAYER';
        rooms[roomCode] = {
            code: roomCode,
            players: [socket.id, aiId],
            playerNames: { [socket.id]: playerName, [aiId]: 'الكمبيوتر 🤖' },
            hands: { [socket.id]: [], [aiId]: [] },
            scores: { [socket.id]: 0, [aiId]: 0 },
            unoPressed: { [socket.id]: false, [aiId]: true },
            deck: [],
            topCard: null,
            turnIndex: 0,
            isAi: true
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        startNewRound(roomCode);
    });

    // 3. الانضمام إلى غرفة
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (!room) {
            return socket.emit('errorMsg', 'هذه الغرفة غير موجودة!');
        }
        if (room.players.length >= 2) {
            return socket.emit('errorMsg', 'الغرفة ممتلئة بالفعل!');
        }
        if (room.players.includes(socket.id)) return;

        const pName = playerName || 'لاعب 2';
        room.players.push(socket.id);
        room.playerNames[socket.id] = pName;
        room.hands[socket.id] = [];
        room.scores[socket.id] = 0;
        room.unoPressed[socket.id] = false;
        socket.join(cleanCode);
        
        socket.emit('roomJoined', cleanCode);
        startNewRound(cleanCode);
    });

    // 4. المحادثة الفورية (Chat)
    socket.on('sendChatMessage', ({ roomCode, message }) => {
        if (!roomCode || !message) return;

        const cleanCode = roomCode.toString().toUpperCase().trim();
        const room = rooms[cleanCode];
        if (!room) return;

        const senderName = (room.playerNames && room.playerNames[socket.id]) ? room.playerNames[socket.id] : 'لاعب';

        io.to(cleanCode).emit('receiveChatMessage', {
            senderId: socket.id,
            senderName: senderName,
            message: message.trim()
        });
    });

    // 5. زر UNO
    socket.on('pressUno', (roomCode) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (!room) return;

        if (room.hands[socket.id] && room.hands[socket.id].length <= 2) {
            room.unoPressed[socket.id] = true;
            io.to(cleanCode).emit('generalToast', `🗣️ ${room.playerNames[socket.id]} ضغط على زر UNO!`);
            updateGameState(cleanCode);
        }
    });

    // 6. زر التحدي (Challenge) وتطبيق العقوبة
    socket.on('challengeUno', (roomCode) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (!room) return;

        const opponentId = room.players.find(id => id !== socket.id);
        if (!opponentId) return;

        // التحقق مما إذا كان الخصم لديه ورقة واحدة ولم يضغط UNO
        if (room.hands[opponentId] && room.hands[opponentId].length === 1 && !room.unoPressed[opponentId]) {
            // عقوبة: سحب ورقتين للخصم
            for (let i = 0; i < 2; i++) {
                if (room.deck.length === 0) room.deck = generateDeck();
                room.hands[opponentId].push(room.deck.pop());
            }
            // إعادة ضبط الـ unoPressed بعد العقوبة
            room.unoPressed[opponentId] = false;

            io.to(cleanCode).emit('generalToast', `⚠️ نجح التحدي! ${room.playerNames[opponentId]} نسي قول UNO وتمت معاقبته بسحب ورقتين! 🃏🃏`);
            updateGameState(cleanCode);
        } else {
            socket.emit('errorMsg', 'التحدي غير صحيح! الخصم ضغط UNO أو ليس لديه ورقة واحدة.');
        }
    });

    // 7. إعادة الاتصال (Reconnect)
    socket.on('reconnectPlayer', ({ roomCode, oldId }) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (room) {
            const index = room.players.indexOf(oldId);
            if (index !== -1) {
                room.players[index] = socket.id;
                room.hands[socket.id] = room.hands[oldId];
                delete room.hands[oldId];
                room.scores[socket.id] = room.scores[oldId];
                delete room.scores[oldId];
                room.unoPressed[socket.id] = room.unoPressed[oldId] || false;
                delete room.unoPressed[oldId];

                if (room.playerNames) {
                    room.playerNames[socket.id] = room.playerNames[oldId] || 'لاعب';
                    delete room.playerNames[oldId];
                }

                socket.join(cleanCode);
                updateGameState(cleanCode);
            }
        }
    });

    // 8. بدء جولة جديدة
    function startNewRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.deck = generateDeck();
        room.players.forEach(playerId => {
            room.hands[playerId] = room.deck.splice(0, 7);
            room.unoPressed[playerId] = false;
        });
        room.topCard = room.deck.pop();
        room.turnIndex = Math.floor(Math.random() * room.players.length);

        io.to(roomCode).emit('startGame', { isAi: room.isAi });
        io.to(roomCode).emit('newRoundStarted');
        updateGameState(roomCode);

        if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
            setTimeout(() => processAiTurn(roomCode), 1000);
        }
    }

    // 9. تحديث حالة اللعبة
    function updateGameState(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.players.forEach(playerId => {
            if (playerId === 'AI_PLAYER') return;

            const opponentId = room.players.find(id => id !== playerId);
            const isMyTurn = room.players[room.turnIndex] === playerId;

            io.to(playerId).emit('updateGameState', {
                myHand: room.hands[playerId],
                opponentCardCount: room.hands[opponentId] ? room.hands[opponentId].length : 0,
                topCard: room.topCard,
                isMyTurn: isMyTurn,
                myScore: room.scores[playerId] || 0,
                opponentScore: room.scores[opponentId] || 0,
                myName: room.playerNames[playerId] || 'أنا',
                opponentName: room.playerNames[opponentId] || 'الخصم',
                unoPressed: room.unoPressed[playerId] || false,
                opponentUnoPressed: room.unoPressed[opponentId] || false
            });
        });
    }

    // 10. لعب ورقة
    socket.on('playCard', ({ roomCode, cardIndex }) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (!room) return;

        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        const hand = room.hands[socket.id];
        if (!hand || cardIndex < 0 || cardIndex >= hand.length) return;

        const cardToPlay = hand[cardIndex];

        if (cardToPlay.v === room.topCard.v || cardToPlay.s === room.topCard.s) {
            hand.splice(cardIndex, 1);
            room.topCard = cardToPlay;

            // إذا تبقى لدى اللاعب ورقة واحدة، يتم تصفير حالة الunoPressed ليضطر للضغط
            if (hand.length === 1) {
                room.unoPressed[socket.id] = false;
            } else {
                room.unoPressed[socket.id] = false;
            }

            if (hand.length === 0) {
                handleRoundWin(cleanCode, socket.id);
            } else {
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                updateGameState(cleanCode);

                if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
                    setTimeout(() => processAiTurn(cleanCode), 1000);
                }
            }
        } else {
            socket.emit('errorMsg', 'هذه الورقة لا تتطابق مع الورقة المركزية!');
        }
    });

    // 11. سحب ورقة
    socket.on('drawCard', (roomCode) => {
        const cleanCode = roomCode ? roomCode.toUpperCase().trim() : '';
        const room = rooms[cleanCode];
        if (!room) return;

        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        if (room.deck.length === 0) {
            room.deck = generateDeck();
        }

        const drawnCard = room.deck.pop();
        room.hands[socket.id].push(drawnCard);
        room.unoPressed[socket.id] = false;

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        updateGameState(cleanCode);

        if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
            setTimeout(() => processAiTurn(cleanCode), 1000);
        }
    });

    // 12. معالجة دور الكمبيوتر (AI)
    function processAiTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.players[room.turnIndex] !== 'AI_PLAYER') return;

        const aiHand = room.hands['AI_PLAYER'];
        const validCardIndex = aiHand.findIndex(card => card.v === room.topCard.v || card.s === room.topCard.s);

        if (validCardIndex !== -1) {
            const playedCard = aiHand.splice(validCardIndex, 1)[0];
            room.topCard = playedCard;

            if (aiHand.length === 1) {
                room.unoPressed['AI_PLAYER'] = true;
            }

            if (aiHand.length === 0) {
                handleRoundWin(roomCode, 'AI_PLAYER');
                return;
            }
        } else {
            if (room.deck.length === 0) room.deck = generateDeck();
            aiHand.push(room.deck.pop());
        }

        room.turnIndex = room.players.findIndex(id => id !== 'AI_PLAYER');
        updateGameState(roomCode);
    }

    // 13. انتهاء الجولة وحساب النقاط
    function handleRoundWin(roomCode, winnerId) {
        const room = rooms[roomCode];
        const opponentId = room.players.find(id => id !== winnerId);
        
        let pointsWon = 0;
        if (room.hands[opponentId]) {
            room.hands[opponentId].forEach(card => {
                pointsWon += parseInt(card.v) || 5;
            });
        }

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
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});