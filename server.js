const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// إعداد الـ CORS للسماح بالاتصال من موقعك على Cloudflare
const io = new Server(server, { 
    cors: { 
        origin: "*", // يمكنك استبداله برابط موقعك على Cloudflare لزيادة الأمان
        methods: ["GET", "POST"] 
    } 
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('لاعب متصل:', socket.id);

    socket.on('createRoom', (playerName) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = {
            players: [{ id: socket.id, name: playerName, hand: [], saidUno: false }],
            deck: [],
            discardPile: [],
            activePlayerIndex: 0,
            gameStarted: false
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode); // إرسال الكود للعميل
        console.log('تم إنشاء غرفة:', roomCode);
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        if (room && !room.gameStarted && room.players.length < 4) {
            room.players.push({ id: socket.id, name: playerName, hand: [], saidUno: false });
            socket.join(roomCode);
            io.to(roomCode).emit('updateLobby', room.players);
        } else {
            socket.emit('errorMsg', 'الغرفة غير موجودة أو بدأت اللعبة!');
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.gameStarted = true;
            io.to(roomCode).emit('gameStateUpdate', room);
        }
    });

    socket.on('sendMessage', ({ roomCode, message, playerName }) => {
        io.to(roomCode).emit('chatMessage', { sender: playerName, text: message });
    });

    socket.on('disconnect', () => {
        console.log('انقطع الاتصال:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`الخادم يعمل على المنفذ ${PORT}`));