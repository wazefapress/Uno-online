const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

const rooms = {};
const disconnectTimeouts = {};

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

// 🎯 دالة جديدة لحساب مجموع الأوراق المتبقية في اليد
function calculateHandPoints(hand) {
    return hand.reduce((total, card) => total + parseInt(card.v), 0);
}

function initGame(player1, player2) {
    const deck = generateDeck();
    const player1Hand = [];
    const player2Hand = [];
    
    for (let i = 0; i < 7; i++) {
        player1Hand.push(deck.pop());
        player2Hand.push(deck.pop());
    }

    return {
        deck: deck,
        discardPile: [deck.pop()],
        hands: {
            [player1]: player1Hand,
            [player2]: player2Hand
        },
        turnIndex: 0,
        players: [player1, player2]
    };
}

function sendGameStateToPlayers(roomCode, room) {
    const state = room.gameState;
    room.players.forEach((playerId, index) => {
        if (playerId === 'AI_BOT') return;

        const opponentId = room.players[1 - index];
        const sanitizedState = {
            topCard: state.discardPile[0],
            myHand: state.hands[playerId],
            opponentCardCount: state.hands[opponentId] ? state.hands[opponentId].length : 0,
            isMyTurn: state.players[state.turnIndex] === playerId,
            myScore: room.scores[playerId] || 0, // 🎯 إرسال نقاط اللاعب
            opponentScore: room.scores[opponentId] || 0 // 🎯 إرسال نقاط الخصم
        };
        io.to(playerId).emit('updateGameState', sanitizedState);
    });
}

function makeAiMoveIfAiTurn(roomCode, room) {
    if (!room || !room.isAi || !room.gameState) return;
    const state = room.gameState;

    if (state.players[state.turnIndex] !== 'AI_BOT') return;

    setTimeout(() => {
        if (!rooms[roomCode] || !rooms[roomCode].gameState) return;

        const aiHand = state.hands['AI_BOT'];
        const topCard = state.discardPile[0];

        // 🤖 إذا بقيت ورقتان للكمبيوتر، يصيح UNO تلقائياً!
        if (aiHand.length === 2) {
            io.to(roomCode).emit('playerSaidUno', { playerId: 'AI_BOT', name: 'الكمبيوتر 🤖' });
        }

        const cardIndex = aiHand.findIndex(card => card.v === topCard.v || card.s === topCard.s);

        if (cardIndex !== -1) {
            const cardToPlay = aiHand.splice(cardIndex, 1)[0];
            state.discardPile.unshift(cardToPlay);

            if (aiHand.length === 0) {
                // 🎯 الذكاء الاصطناعي فاز بالجولة
                const playerId = room.players[0];
                const pointsEarned = calculateHandPoints(state.hands[playerId]);
                room.scores['AI_BOT'] += pointsEarned;

                if (room.scores['AI_BOT'] >= 100) {
                    io.to(roomCode).emit('gameOver', { winnerId: 'AI_BOT', reason: 'normal' });
                } else {
                    io.to(roomCode).emit('roundOver', { winnerId: 'AI_BOT', pointsWon: pointsEarned });
                    // بدء جولة جديدة تلقائياً بعد 4 ثوانٍ
                    setTimeout(() => {
                        if (rooms[roomCode]) {
                            room.gameState = initGame(room.players[0], 'AI_BOT');
                            io.to(roomCode).emit('newRoundStarted');
                            sendGameStateToPlayers(roomCode, room);
                        }
                    }, 4000);
                }
                return;
            }
        } else {
            if (state.deck.length === 0 && state.discardPile.length > 1) {
                const cardsToShuffle = state.discardPile.splice(1);
                state.deck = cardsToShuffle.sort(() => Math.random() - 0.5);
            }

            if (state.deck.length > 0) {
                aiHand.push(state.deck.pop());
            }
        }

        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(roomCode, room);

    }, 1200);
}

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        // 🎯 تهيئة كائن لحفظ النقاط
        rooms[roomCode] = { players: [socket.id], gameState: null, isAi: false, scores: {} };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('createAIRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { 
            players: [socket.id, 'AI_BOT'], 
            gameState: null, 
            isAi: true,
            scores: { [socket.id]: 0, 'AI_BOT': 0 } // 🎯 تصفير النقاط
        };
        
        socket.join(roomCode);
        socket.emit('gameStarted', roomCode); 
        socket.emit('roomCreated', roomCode);
        socket.emit('roomJoined', roomCode);
        
        io.to(socket.id).emit('startGame', { message: 'بدأت اللعبة ضد الكمبيوتر 🤖!', isAi: true });
        rooms[roomCode].gameState = initGame(socket.id, 'AI_BOT');
        sendGameStateToPlayers(roomCode, rooms[roomCode]);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (room.players.includes(socket.id)) {
                return socket.emit('errorMsg', 'أنت متواجد في هذه الغرفة بالفعل! شارك الكود أو الرابط مع صديقك بانتظار انضمامه...');
            }

            if (room.players.length >= 2 || room.isAi) {
                return socket.emit('errorMsg', 'الغرفة ممتلئة أو مخصصة للكمبيوتر!');
            }
            room.players.push(socket.id);
            socket.join(roomCode);
            socket.emit('roomJoined', roomCode);
            
            if (room.players.length === 2) {
                // 🎯 تصفير النقاط عند اكتمال اللاعبين
                room.scores[room.players[0]] = 0;
                room.scores[room.players[1]] = 0;
                
                io.to(roomCode).emit('startGame', { message: 'اكتمل العدد، ستبدأ اللعبة!', isAi: false });
                room.gameState = initGame(room.players[0], room.players[1]);
                sendGameStateToPlayers(roomCode, room);
            }
        } else {
            socket.emit('errorMsg', 'كود الغرفة غير صحيح!');
        }
    });

    // =========================================================
    // 💥 [جديد] استقبال حدث قول UNO وتعميمه على الغرفة
    // =========================================================
    socket.on('sayUno', (roomCode) => {
        let targetRoomCode = roomCode;

        // البحث عن الغرفة إذا لم يتم إرسال الكود مباشرة
        if (!targetRoomCode) {
            for (const code in rooms) {
                if (rooms[code].players.includes(socket.id)) {
                    targetRoomCode = code;
                    break;
                }
            }
        }

        const room = rooms[targetRoomCode];
        if (!room || !room.gameState) return;

        const playerHand = room.gameState.hands[socket.id];

        // التحقق من أن أوراق اللاعب 2 أو أقل للنداء بـ UNO
        if (playerHand && playerHand.length <= 2) {
            io.to(targetRoomCode).emit('playerSaidUno', {
                playerId: socket.id,
                message: '🔥 قال UNO!'
            });
        } else {
            socket.emit('errorMsg', 'لا يمكنك قول UNO ولديك أكثر من ورقتين!');
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
            // 🎯 اللاعب الحقيقي فاز بالجولة
            const opponentId = room.players.find(id => id !== playerId);
            const pointsEarned = calculateHandPoints(state.hands[opponentId]);
            room.scores[playerId] += pointsEarned;

            if (room.scores[playerId] >= 100) {
                // 🎯 إذا وصل 100 نقطة، تنتهي اللعبة
                io.to(data.roomCode).emit('gameOver', { winnerId: playerId, reason: 'normal' });
            } else {
                // 🎯 إذا لم يصل، ننهي الجولة فقط ونبدأ أخرى
                io.to(data.roomCode).emit('roundOver', { winnerId: playerId, pointsWon: pointsEarned });
                setTimeout(() => {
                    if (rooms[data.roomCode]) {
                        room.gameState = initGame(room.players[0], room.players[1]);
                        io.to(data.roomCode).emit('newRoundStarted');
                        sendGameStateToPlayers(data.roomCode, room);
                    }
                }, 4000);
            }
            return;
        }

        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(data.roomCode, room);

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

            if (room.isAi) {
                makeAiMoveIfAiTurn(roomCode, room);
            }
        }
    });

    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.isAi) {
            room.scores[socket.id] = 0;
            room.scores['AI_BOT'] = 0;
            room.gameState = initGame(socket.id, 'AI_BOT');
            io.to(socket.id).emit('startGame', { message: 'بدأت جولة جديدة!', isAi: true });
            sendGameStateToPlayers(roomCode, room);
        } else {
            socket.to(roomCode).emit('opponentWantsRematch');
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);

            if (playerIndex !== -1) {
                const disconnectedId = socket.id;

                disconnectTimeouts[disconnectedId] = setTimeout(() => {
                    if (!rooms[roomCode]) return;

                    if (room.isAi) {
                        delete rooms[roomCode];
                    } else if (room.gameState) {
                        const remainingPlayer = room.players.find(id => id !== disconnectedId && id !== 'AI_BOT');
                        if (remainingPlayer) {
                            io.to(remainingPlayer).emit('gameOver', { 
                                winnerId: remainingPlayer,
                                reason: 'opponent_left'
                            });
                        }
                        delete rooms[roomCode];
                    } else {
                        io.to(roomCode).emit('playerLeft', 'غادر اللاعب الغرفة لانقطاع الاتصال.');
                        delete rooms[roomCode];
                    }
                    delete disconnectTimeouts[disconnectedId];
                }, 30000);
                
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));