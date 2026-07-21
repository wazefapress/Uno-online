const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// 🌟 [إضافة حاسمة] هذا السطر يجعل السيرفر يعرض ملفات (HTML, CSS, JS) مباشرة
app.use(express.static(__dirname));

const rooms = {};
const disconnectTimeouts = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generateDeck() {
    const suits = [
        { s: '♥', color: 'red' },
        { s: '♦', color: 'red' },
        { s: '♣', color: 'black' },
        { s: '♠', color: 'black' }
    ];
    const values = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    let deck = [];
    suits.forEach(suitObj => {
        values.forEach(v => {
            deck.push({ v, s: suitObj.s, value: v, color: suitObj.color });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

function calculateHandPoints(hand) {
    return hand.reduce((total, card) => total + parseInt(card.v || 0), 0);
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
    if (!state) return;

    room.players.forEach((playerId, index) => {
        if (playerId === 'AI_BOT') return;

        const opponentId = room.players[1 - index];
        const sanitizedState = {
            topCard: state.discardPile[0],
            myHand: state.hands[playerId],
            opponentCardCount: state.hands[opponentId] ? state.hands[opponentId].length : 0,
            isMyTurn: state.players[state.turnIndex] === playerId,
            currentTurnPlayerId: state.players[state.turnIndex],
            currentTurnPlayerName: room.playerNames[state.players[state.turnIndex]] || 'المنافس',
            myScore: room.scores[playerId] || 0,
            opponentScore: room.scores[opponentId] || 0
        };
        
        io.to(playerId).emit('updateGameState', sanitizedState);
        io.to(playerId).emit('gameState', sanitizedState);
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

        if (aiHand.length === 2) {
            io.to(roomCode).emit('playerSaidUno', { playerId: 'AI_BOT', playerName: 'الكمبيوتر 🤖', message: '🔥 قال UNO!' });
        }

        const cardIndex = aiHand.findIndex(card => card.v === topCard.v || card.s === topCard.s || card.color === topCard.color);

        if (cardIndex !== -1) {
            const cardToPlay = aiHand.splice(cardIndex, 1)[0];
            state.discardPile.unshift(cardToPlay);

            if (aiHand.length === 0) {
                const playerId = room.players[0];
                const pointsEarned = calculateHandPoints(state.hands[playerId] || []);
                room.scores['AI_BOT'] += pointsEarned;

                if (room.scores['AI_BOT'] >= 100) {
                    io.to(roomCode).emit('gameOver', { winnerId: 'AI_BOT', winnerName: 'الكمبيوتر 🤖', reason: 'normal' });
                } else {
                    io.to(roomCode).emit('roundOver', { winnerId: 'AI_BOT', winnerName: 'الكمبيوتر 🤖', pointsWon: pointsEarned });
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

    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 1';

        rooms[roomCode] = { 
            players: [socket.id], 
            playerNames: { [socket.id]: playerName },
            gameState: null, 
            isAi: false, 
            scores: { [socket.id]: 0 } 
        };

        socket.join(roomCode);
        socket.emit('roomCreated', { 
            roomCode, 
            players: [{ id: socket.id, name: playerName, isHost: true }] 
        });
    });

    socket.on('createAIRoom', (data) => {
        const roomCode = generateRoomCode();
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 1';

        rooms[roomCode] = { 
            players: [socket.id, 'AI_BOT'], 
            playerNames: { [socket.id]: playerName, 'AI_BOT': 'الكمبيوتر 🤖' },
            gameState: null, 
            isAi: true,
            scores: { [socket.id]: 0, 'AI_BOT': 0 }
        };
        
        socket.join(roomCode);
        
        const playerList = [
            { id: socket.id, name: playerName, isHost: true },
            { id: 'AI_BOT', name: 'الكمبيوتر 🤖', isHost: false }
        ];

        socket.emit('roomCreated', { roomCode, players: playerList });
        socket.emit('roomJoined', { roomCode, players: playerList });
        
        rooms[roomCode].gameState = initGame(socket.id, 'AI_BOT');
        io.to(socket.id).emit('gameStarted', rooms[roomCode].gameState);
        sendGameStateToPlayers(roomCode, rooms[roomCode]);
    });

    socket.on('joinRoom', (data) => {
        const roomCode = typeof data === 'string' ? data : data.roomCode;
        const playerName = (data && data.playerName) ? data.playerName : 'لاعب 2';

        const room = rooms[roomCode];
        if (room) {
            if (room.players.includes(socket.id)) {
                return socket.emit('errorMsg', 'أنت متواجد في هذه الغرفة بالفعل!');
            }
            if (room.players.length >= 2 || room.isAi) {
                return socket.emit('errorMsg', 'الغرفة ممتلئة أو مخصصة للكمبيوتر!');
            }

            room.players.push(socket.id);
            room.playerNames[socket.id] = playerName;
            room.scores[socket.id] = 0;

            socket.join(roomCode);
            
            const playerList = room.players.map(id => ({
                id: id,
                name: room.playerNames[id] || 'لاعب',
                isHost: id === room.players[0]
            }));

            socket.emit('roomJoined', { roomCode, players: playerList });
            io.to(roomCode).emit('updatePlayerList', playerList);

            if (room.players.length === 2) {
                room.gameState = initGame(room.players[0], room.players[1]);
                io.to(roomCode).emit('gameStarted', room.gameState);
                sendGameStateToPlayers(roomCode, room);
            }
        } else {
            socket.emit('errorMsg', 'كود الغرفة غير صحيح!');
        }
    });

    socket.on('startGame', (data) => {
        const roomCode = typeof data === 'string' ? data : data.roomCode;
        const room = rooms[roomCode];
        if (room && room.players.length === 2) {
            room.gameState = initGame(room.players[0], room.players[1]);
            io.to(roomCode).emit('gameStarted', room.gameState);
            sendGameStateToPlayers(roomCode, room);
        }
    });

    socket.on('sayUno', (data) => {
        let roomCode = typeof data === 'string' ? data : data?.roomCode;

        if (!roomCode) {
            for (const code in rooms) {
                if (rooms[code].players.includes(socket.id)) {
                    roomCode = code;
                    break;
                }
            }
        }

        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const playerHand = room.gameState.hands[socket.id];

        if (playerHand && playerHand.length <= 2) {
            io.to(roomCode).emit('playerSaidUno', {
                playerId: socket.id,
                playerName: room.playerNames[socket.id] || 'لاعب',
                message: '🔥 قال UNO!'
            });
        } else {
            socket.emit('errorMsg', 'لا يمكنك قول UNO ولديك أكثر من ورقتين!');
        }
    });

    socket.on('playCard', (data) => {
        const roomCode = typeof data === 'string' ? data : data.roomCode;
        const cardIndex = data.cardIndex;

        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const state = room.gameState;
        const playerId = socket.id;

        if (state.players[state.turnIndex] !== playerId) return;

        const playerHand = state.hands[playerId];
        const cardToPlay = playerHand[cardIndex];
        if (!cardToPlay) return socket.emit('errorMsg', 'الورقة غير موجودة!');

        const topCard = state.discardPile[0];
        if (cardToPlay.v !== topCard.v && cardToPlay.s !== topCard.s && cardToPlay.color !== topCard.color) {
            return socket.emit('errorMsg', 'حركة غير قانونية!');
        }

        playerHand.splice(cardIndex, 1);
        state.discardPile.unshift(cardToPlay);

        if (playerHand.length === 0) {
            const opponentId = room.players.find(id => id !== playerId);
            const pointsEarned = calculateHandPoints(state.hands[opponentId] || []);
            room.scores[playerId] = (room.scores[playerId] || 0) + pointsEarned;

            if (room.scores[playerId] >= 100) {
                io.to(roomCode).emit('gameOver', { winnerId: playerId, winnerName: room.playerNames[playerId], reason: 'normal' });
            } else {
                io.to(roomCode).emit('roundOver', { winnerId: playerId, winnerName: room.playerNames[playerId], pointsWon: pointsEarned });
                setTimeout(() => {
                    if (rooms[roomCode]) {
                        room.gameState = initGame(room.players[0], room.players[1]);
                        io.to(roomCode).emit('newRoundStarted');
                        sendGameStateToPlayers(roomCode, room);
                    }
                }, 4000);
            }
            return;
        }

        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(roomCode, room);

        if (room.isAi) {
            makeAiMoveIfAiTurn(roomCode, room);
        }
    });

    socket.on('drawCard', (data) => {
        const roomCode = typeof data === 'string' ? data : data?.roomCode;
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

    socket.on('requestRematch', (data) => {
        const roomCode = typeof data === 'string' ? data : data?.roomCode;
        const room = rooms[roomCode];
        if (!room) return;

        if (room.isAi) {
            room.scores[socket.id] = 0;
            room.scores['AI_BOT'] = 0;
            room.gameState = initGame(socket.id, 'AI_BOT');
            io.to(socket.id).emit('gameStarted', room.gameState);
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
                                winnerName: room.playerNames[remainingPlayer],
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