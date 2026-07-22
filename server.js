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
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms[code] ? generateRoomCode() : code;
}

io.on('connection', (socket) => {

    socket.on('createRoom', (data) => {
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 1';
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            players: [socket.id],
            playerNames: { [socket.id]: playerName },
            hands: { [socket.id]: [] },
            scores: { [socket.id]: 0 },
            unoPressed: { [socket.id]: false }, // حالة التحدي
            deck: [],
            topCard: null,
            turnIndex: 0,
            isAi: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

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
            unoPressed: { [socket.id]: false, [aiId]: false }, // حالة التحدي
            deck: [],
            topCard: null,
            turnIndex: 0,
            isAi: true
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        startNewRound(roomCode);
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'هذه الغرفة غير موجودة!');
        if (room.players.length >= 2) return socket.emit('errorMsg', 'الغرفة ممتلئة بالفعل!');

        const pName = playerName || 'لاعب 2';
        room.players.push(socket.id);
        room.playerNames[socket.id] = pName;
        room.hands[socket.id] = [];
        room.scores[socket.id] = 0;
        room.unoPressed[socket.id] = false;
        socket.join(roomCode);
        socket.emit('roomJoined', roomCode);
        startNewRound(roomCode);
    });

    // أحداث تحدي UNO
    socket.on('pressUno', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.unoPressed[socket.id] = true;
            io.to(roomCode).emit('generalToast', `📢 ${room.playerNames[socket.id]} قال UNO!`);
        }
    });

    socket.on('challengeUno', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        const opponentId = room.players.find(id => id !== socket.id);
        if (!opponentId) return;

        // إذا كان الخصم يمتلك ورقة واحدة ولم يضغط UNO
        if (room.hands[opponentId].length === 1 && !room.unoPressed[opponentId]) {
            if (room.deck.length < 2) room.deck = generateDeck();
            room.hands[opponentId].push(room.deck.pop(), room.deck.pop());
            room.unoPressed[opponentId] = true; // نؤمنه بعد السحب
            
            io.to(roomCode).emit('generalToast', `🚨 تحدي ناجح! ${room.playerNames[opponentId]} سحب ورقتين لأنه نسي قول UNO!`);
            updateGameState(roomCode);
        } else {
            socket.emit('errorMsg', 'الخصم محمي (إما قال UNO أو يمتلك أكثر من ورقة).');
        }
    });

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
                unoPressed: room.unoPressed[playerId],
                opponentUnoPressed: room.unoPressed[opponentId]
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

            // إذا بقيت ورقة واحدة ولم يضغط اللاعب، سيقوم الذكاء الاصطناعي بتحديه
            if (hand.length === 1 && room.isAi && !room.unoPressed[socket.id]) {
                setTimeout(() => {
                    const currentRoom = rooms[roomCode];
                    if (currentRoom && currentRoom.hands[socket.id] && currentRoom.hands[socket.id].length === 1 && !currentRoom.unoPressed[socket.id]) {
                        if (currentRoom.deck.length < 2) currentRoom.deck = generateDeck();
                        currentRoom.hands[socket.id].push(currentRoom.deck.pop(), currentRoom.deck.pop());
                        currentRoom.unoPressed[socket.id] = true;
                        io.to(roomCode).emit('generalToast', `🚨 الكمبيوتر تحدى نسيانك لقول UNO! لقد سحبت ورقتين.`);
                        updateGameState(roomCode);
                    }
                }, 2000); // إعطاء اللاعب مهلة 2 ثانية لتدارك الأمر
            }

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
            socket.emit('errorMsg', 'هذه الورقة لا تتطابق!');
        }
    });

    socket.on('drawCard', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.players[room.turnIndex]) return;

        if (room.deck.length === 0) room.deck = generateDeck();
        room.hands[socket.id].push(room.deck.pop());
        
        room.unoPressed[socket.id] = false; // إعادة ضبط الحالة عند السحب
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        updateGameState(roomCode);

        if (room.isAi && room.players[room.turnIndex] === 'AI_PLAYER') {
            setTimeout(() => processAiTurn(roomCode), 1000);
        }
    });

    function processAiTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.players[room.turnIndex] !== 'AI_PLAYER') return;

        const aiHand = room.hands['AI_PLAYER'];
        const validCardIndex = aiHand.findIndex(card => card.v === room.topCard.v || card.s === room.topCard.s);

        if (validCardIndex !== -1) {
            room.topCard = aiHand.splice(validCardIndex, 1)[0];

            // AI يضغط UNO مع تأخير متعمد ليمنح اللاعب فرصة لتحديه
            if (aiHand.length === 1) {
                room.unoPressed['AI_PLAYER'] = false;
                setTimeout(() => {
                    const currentRoom = rooms[roomCode];
                    if (currentRoom && currentRoom.hands['AI_PLAYER'] && currentRoom.hands['AI_PLAYER'].length === 1 && !currentRoom.unoPressed['AI_PLAYER']) {
                        currentRoom.unoPressed['AI_PLAYER'] = true;
                        io.to(roomCode).emit('generalToast', `🤖 الكمبيوتر قال UNO!`);
                        updateGameState(roomCode);
                    }
                }, 2500); // اللاعب لديه 2.5 ثانية لمعاقبة الكمبيوتر
            }

            if (aiHand.length === 0) return handleRoundWin(roomCode, 'AI_PLAYER');
        } else {
            if (room.deck.length === 0) room.deck = generateDeck();
            aiHand.push(room.deck.pop());
            room.unoPressed['AI_PLAYER'] = false;
        }

        room.turnIndex = room.players.findIndex(id => id !== 'AI_PLAYER');
        updateGameState(roomCode);
    }

    function handleRoundWin(roomCode, winnerId) {
        const room = rooms[roomCode];
        const opponentId = room.players.find(id => id !== winnerId);
        
        let pointsWon = 0;
        if (room.hands[opponentId]) {
            room.hands[opponentId].forEach(card => pointsWon += parseInt(card.v) || 5);
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
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`السيرفر يعمل بنجاح على المنفذ ${PORT}`));