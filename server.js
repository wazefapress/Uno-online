const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } // يسمح للواجهة بالاتصال من أي نطاق (Cloudflare)
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
        const opponentId = room.players[1 - index];
        const sanitizedState = {
            topCard: state.discardPile[0],
            myHand: state.hands[playerId],
            opponentCardCount: state.hands[opponentId].length,
            isMyTurn: state.players[state.turnIndex] === playerId
        };
        io.to(playerId).emit('updateGameState', sanitizedState);
    });
}

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);
    // حدث طلب إعادة اللعب مع نفس اللاعبين
    socket.on('requestRematch', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMsg', 'الغرفة لم تعد موجودة!');
        
        if (!room.rematchRequests) room.rematchRequests = [];
        
        // إضافة معرف اللاعب الحالي لمصفوفة الطلبات إذا لم يكن موجوداً
        if (!room.rematchRequests.includes(socket.id)) {
            room.rematchRequests.push(socket.id);
        }
        
        // إشعار اللاعب الآخر برغبة خصمه في إعادة اللعب
        socket.to(roomCode).emit('opponentWantsRematch');
        
        // إذا وافق اللاعبان معاً، تبدأ الجولة الجديدة فوراً
        if (room.rematchRequests.length === 2) {
            room.rematchRequests = [];
            // إعادة تهيئة الكروت وتوزيعها
            room.gameState = initGame(room.players[0], room.players[1]);
            
            // إرسال أمر بدء اللعبة وتحديث الأوراق للجميع
            io.to(roomCode).emit('startGame', { message: 'بدأت جولة جديدة! بالتوفيق.' });
            sendGameStateToPlayers(roomCode, room);
        }
    });

    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { players: [socket.id], gameState: null };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (room.players.length >= 2) {
                return socket.emit('errorMsg', 'الغرفة ممتلئة!');
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
    
    // التعديل هنا: لا تحذف الغرفة، بل صفر حالة اللعبة وجهز مصفوفة طلب الإعادة
    room.gameState = null; 
    room.rematchRequests = []; 
    return;
}

        state.turnIndex = 1 - state.turnIndex;
        sendGameStateToPlayers(data.roomCode, room);
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
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);

            if (playerIndex !== -1) {
                if (room.gameState) {
                    const remainingPlayer = room.players.find(id => id !== socket.id);
                    if (remainingPlayer) {
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

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
