const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generateDeck() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    let deck = [];
    suits.forEach(s => values.forEach(v => deck.push({v, s})));
    return deck.sort(() => Math.random() - 0.5);
}

function initGame(player1, player2) {
    const deck = generateDeck();
    return {
        deck: deck,
        discardPile: [deck.pop()],
        hands: {
            [player1]: [deck.pop(), deck.pop(), deck.pop(), deck.pop()],
            [player2]: [deck.pop(), deck.pop(), deck.pop(), deck.pop()]
        },
        turnIndex: 0,
        players: [player1, player2]
    };
}

function sendGameStateToPlayers(roomCode, room) {
    const state = room.gameState;
    room.players.forEach((playerId, index) => {
        // إذا كان المعرف هو البوت، لا نرسل له عبر السوكيت
        if (playerId === 'AI_BOT') return;

        const opponentId = room.players[1 - index];
        const sanitizedState = {
            topCard: state.discardPile[0],
            myHand: state.hands[playerId],
            opponentCardCount: state.hands[opponentId] ? state.hands[opponentId].length : 0,
            isMyTurn: state.players[state.turnIndex] === playerId
        };
        io.to(playerId).emit('updateGameState', sanitizedState);
    });
}

// 🤖 دالة إدارة حركة الذكاء الاصطناعي
function makeAiMoveIfAiTurn(roomCode, room) {
    if (!room || !room.isAi || !room.gameState) return;
    const state = room.gameState;

    // التحقق مما إذا كان الدور الحالي للكمبيوتر
    if (state.players[state.turnIndex] !== 'AI_BOT') return;

    // تأخير بسيط (1.2 ثانية) لمحاكاة تفكير الكمبيوتر
    setTimeout(() => {
        // التأكد من أن اللاعب لم يغادر أثناء وقت التفكير
        if (!rooms[roomCode] || !rooms[roomCode].gameState) return;

        const aiHand = state.hands['AI_BOT'];
        const topCard = state.discardPile[0];

        // البحث عن ورقة مطابقة في يد البوت (اللون أو القيمة)
        const cardIndex = aiHand.findIndex(card => card.v === topCard.v || card.s === topCard.s);

        if (cardIndex !== -1) {
            // البوت وجد ورقة مطابقة -> يلعبه
            const cardToPlay = aiHand.splice(cardIndex, 1)[0];
            state.discardPile.unshift(cardToPlay);

            // التحقق من فوز البوت
            if (aiHand.length === 0) {
                io.to(roomCode).emit('gameOver', { winnerId: 'AI_BOT', reason: 'normal' });
                delete rooms[roomCode];
                return;
            }
        } else {
            // البوت لم يجد ورقة مطابقة -> يسحب من السطح
            if (state.deck.length === 0 && state.discardPile.length > 1) {
                const cardsToShuffle = state.discardPile.splice(1);
                state.deck = cardsToShuffle.sort(() => Math.random() - 0.5);
            }

            if (state.deck.length > 0) {
                aiHand.push(state.deck.pop());
            }
        }

        // نقل الدور للاعب الحقيقي وتحديث الواجهة
        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(roomCode, room);

    }, 1200);
}

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // إنشاء غرفة للعب الجماعي المعتاد
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { players: [socket.id], gameState: null, isAi: false };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // 🤖 حدث جديد: إنشاء غرفة ضد الذكاء الاصطناعي وبدء اللعب فوراً
    socket.on('createAIRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { 
            players: [socket.id, 'AI_BOT'], 
            gameState: null, 
            isAi: true 
        };
        
        // 1. إدخال اللاعب فعلياً في قناة الاتصال (Room)
        socket.join(roomCode);

        // 2. إرسال رد للمتصفح لإخفاء شاشة البداية
        socket.emit('gameStarted', roomCode); 
        
        // 3. إرسال أحداث الانضمام وبدء اللعبة
        socket.emit('roomCreated', roomCode);
        socket.emit('roomJoined', roomCode);
        
        // 4. بدء اللعبة وتوزيع الأوراق فوراً
        io.to(socket.id).emit('startGame', { message: 'بدأت اللعبة ضد الكمبيوتر 🤖!' });
        rooms[roomCode].gameState = initGame(socket.id, 'AI_BOT');
        sendGameStateToPlayers(roomCode, rooms[roomCode]);
    }); // تم إصلاح مكان الإغلاق هنا ليكون شاملاً لكل العمليات!

    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (room.players.length >= 2 || room.isAi) {
                return socket.emit('errorMsg', 'الغرفة ممتلئة أو مخصصة للكمبيوتر!');
            }
            room.players.push(socket.id);
            socket.join(roomCode);
            socket.emit('roomJoined', roomCode);
            
            if (room.players.length === 2) {
                io.to(roomCode).emit('startGame', { message: 'اكتمل العدد، ستبدأ اللعبة!' });
                room.gameState = initGame(room.players[0], room.players[1]);
                sendGameStateToPlayers(roomCode, room);
            }
        } else {
            socket.emit('errorMsg', 'كود الغرفة غير صحيح!');
        }
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameState) return;

        const state = room.gameState;
        const playerId = socket.id;

        if (state.players[state.turnIndex] !== playerId) return;

        const playerHand = state.hands[playerId];
        const cardToPlay = playerHand[data.cardIndex];
        if (!cardToPlay) return socket.emit('errorMsg', 'الورقة غير موجودة!');

        const topCard = state.discardPile[0];
        if (cardToPlay.v !== topCard.v && cardToPlay.s !== topCard.s) {
            return socket.emit('errorMsg', 'حركة غير قانونية!');
        }

        playerHand.splice(data.cardIndex, 1);
        state.discardPile.unshift(cardToPlay);

        if (playerHand.length === 0) {
            io.to(data.roomCode).emit('gameOver', { winnerId: playerId, reason: 'normal' });
            delete rooms[data.roomCode];
            return;
        }

        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(data.roomCode, room);

        // تشغيل دور الـ AI إذا كانت الغرفة ضده
        if (room.isAi) {
            makeAiMoveIfAiTurn(data.roomCode, room);
        }
    });

    socket.on('drawCard', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;
        const state = room.gameState;
        
        if (state.players[state.turnIndex] !== socket.id) return;
        
        if (state.deck.length === 0) {
            if (state.discardPile.length > 1) {
                const cardsToShuffle = state.discardPile.splice(1);
                state.deck = cardsToShuffle.sort(() => Math.random() - 0.5);
            } else {
                return socket.emit('errorMsg', 'لا توجد أوراق كافية للسحب!');
            }
        }

        if (state.deck.length > 0) {
            state.hands[socket.id].push(state.deck.pop());
            state.turnIndex = 1 - state.turnIndex;
            sendGameStateToPlayers(roomCode, room);

            // تشغيل دور الـ AI بعد سحب اللاعب لكارت
            if (room.isAi) {
                makeAiMoveIfAiTurn(roomCode, room);
            }
        }
    });

    // طلب إعادة اللعب (Rematch)
    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.isAi) {
            // إذا كان ضد الكمبيوتر، يوافق السيرفر فوراً ويبدأ جولة جديدة
            io.to(socket.id).emit('startGame', { message: 'بدأت جولة جديدة!' });
            room.gameState = initGame(socket.id, 'AI_BOT');
            sendGameStateToPlayers(roomCode, room);
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);

            if (playerIndex !== -1) {
                if (room.isAi) {
                    delete rooms[roomCode];
                    break;
                }
                if (room.gameState) {
                    const remainingPlayer = room.players.find(id => id !== socket.id);
                    if (remainingPlayer && remainingPlayer !== 'AI_BOT') {
                        io.to(remainingPlayer).emit('gameOver', { 
                            winnerId: remainingPlayer,
                            reason: 'opponent_left'
                        });
                    }
                } else {
                    io.to(roomCode).emit('playerLeft', 'غادر اللاعب الغرفة قبل بدء اللعبة.');
                }
                delete rooms[roomCode];
                break;
            }
        }
    });
});
// قراءة المنفذ الديناميكي من Railway أو استخدام 3000 محلياً
const PORT = process.env.PORT || 10000;

// تشغيل سيرفر الـ Express والـ Socket.io على هذا المنفذ
server.listen(PORT, () => {
    console.log(`UNO Server is running on port ${PORT}`);
});
