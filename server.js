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

// تقديم الملفات الثابتة من مجلد المشروع
app.use(express.static(path.join(__dirname, 'public')));

// هيكل الغرف النشطة
const rooms = {};

// توليد مجموعة أوراق الأونو (الأرقام من 1 إلى 9 للأشكال الأربعة)
function generateDeck() {
    const suits = ['♥', '♠', '♦', '♣'];
    let deck = [];
    suits.forEach(suit => {
        for (let i = 1; i <= 9; i++) {
            deck.push({ v: i.toString(), s: suit });
            deck.push({ v: i.toString(), s: suit }); // نسختين من كل رقم لزيادة الحصيلة
        }
    });
    // خلط الأوراق عشوائياً (Shuffle)
    return deck.sort(() => Math.random() - 0.5);
}

// توليد رمز غرفة عشوائي من 4 أحرف
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

    // 1. إنشاء غرفة جديدة متعددة اللاعبين
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            players: [socket.id],
            hands: { [socket.id]: [] },
            scores: { [socket.id]: 0 },
            deck: [],
            topCard: null,
            turnIndex: 0,
            isAi: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // 2. إنشاء غرفة لعب ضد الكمبيوتر (AI)
    socket.on('createAIRoom', () => {
        const roomCode = generateRoomCode();
        const aiId = 'AI_PLAYER';
        rooms[roomCode] = {
            code: roomCode,
            players: [socket.id, aiId],
            hands: { [socket.id]: [], [aiId]: [] },
            scores: { [socket.id]: 0, [aiId]: 0 },
            deck: [],
            topCard: null,
            turnIndex: 0, // يبدأ الدور مباشرة للاعب البشري الأول
            isAi: true
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        startNewRound(roomCode);
    });

    // 3. الانضمام إلى غرفة موجودة
    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) {
            return socket.emit('errorMsg', 'هذه الغرفة غير موجودة!');
        }
        if (room.players.length >= 2) {
            return socket.emit('errorMsg', 'الغرفة ممتلئة بالفعل!');
        }
        if (room.players.includes(socket.id)) return;

        room.players.push(socket.id);
        room.hands[socket.id] = [];
        room.scores[socket.id] = 0;
        socket.join(roomCode);
        
        socket.emit('roomJoined', roomCode);
        startNewRound(roomCode);
    });

    // بدء جولة جديدة وتوزيع الأوراق
    function startNewRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.deck = generateDeck();
        room.players.forEach(playerId => {
            if (playerId !== 'AI_PLAYER') {
                room.hands[playerId] = room.deck.splice(0, 7);
            } else {
                room.hands['AI_PLAYER'] = room.deck.splice(0, 7);
            }
        });
        room.topCard = room.deck.pop();
        room.turnIndex = Math.floor(Math.random() * room.players.length);

        io.to(roomCode).emit('startGame', { isAi: room.isAi });
        io.to(roomCode).emit('newRoundStarted');
        updateGameState(roomCode);
    }

    // تحديث وإرسال حالة اللعبة لكل لاعب بشكل خاص
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
                opponentScore: room.scores[opponentId] || 0
            });
        });
    }

    // 4. لعب ورقة من يد اللاعب
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

                if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
                    setTimeout(() => processAiTurn(roomCode), 1000);
                }
            }
        } else {
            socket.emit('errorMsg', 'هذه الورقة لا تتطابق مع الورقة المركزية!');
        }
    });

    // 5. سحب ورقة من الكوم
    socket.on('drawCard', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        if (room.deck.length === 0) {
            room.deck = generateDeck();
        }

        const drawnCard = room.deck.pop();
        room.hands[socket.id].push(drawnCard);

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        updateGameState(roomCode);

        if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
            setTimeout(() => processAiTurn(roomCode), 1000);
        }
    });

    // دور الذكاء الاصطناعي (AI)
    function processAiTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.players[room.turnIndex] !== 'AI_PLAYER') return;

        const aiHand = room.hands['AI_PLAYER'];
        const validCardIndex = aiHand.findIndex(card => card.v === room.topCard.v || card.s === room.topCard.s);

        if (validCardIndex !== -1) {
            const playedCard = aiHand.splice(validCardIndex, 1)[0];
            room.topCard = playedCard;

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

    // إدارة فوز لاعب بالجولة
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

    // إعادة الاتصال (Reconnect)
    socket.on('reconnectPlayer', ({ roomCode, oldId }) => {
        const room = rooms[roomCode];
        if (room) {
            const index = room.players.indexOf(oldId);
            if (index !== -1) {
                room.players[index] = socket.id;
                room.hands[socket.id] = room.hands[oldId];
                delete room.hands[oldId];
                room.scores[socket.id] = room.scores[oldId];
                delete room.scores[oldId];
                
                socket.join(roomCode);
                updateGameState(roomCode);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`مستخدم انقطع: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});
