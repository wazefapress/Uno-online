
// ⚠️ ملاحظة هامة: بعد رفع السيرفر على Render، استبدل هذا الرابط برابط Render الخاص بك
const socket = io("https://uno-online-zbb7.onrender.com");

let currentRoomCode = null;

function createRoom() { socket.emit('createRoom'); }
function joinRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code) socket.emit('joinRoom', code);
}
function resetToHome() { location.reload(); }

// أحداث الاتصال والغرف
socket.on('roomCreated', (roomCode) => {
    currentRoomCode = roomCode;
    document.getElementById('status-msg').style.color = "#2ecc71";
    document.getElementById('status-msg').innerText = `شارك هذا الكود مع صديقك: ${roomCode}`;
    // وضع الكود في العنصر المخصص ليتمكن الزر من قراءته
    document.getElementById("room-code-display").innerText = roomId;
    
    // إظهار اللوبي (lobby) إذا كان مخفياً
    document.getElementById("lobby").style.display = "block";
});
function copyCode() {
    // جلب النص من المكان الذي نعرض فيه الكود
    const codeText = document.getElementById("room-code-display").innerText;
    
    // استخدام API الخاص بنسخ النصوص
    navigator.clipboard.writeText(codeText).then(() => {
        // تغيير نص الزر مؤقتاً لتأكيد النسخ
        const btn = document.getElementById("copy-btn");
        const originalText = btn.innerText;
        
        btn.innerText = "تم النسخ!";
        btn.style.backgroundColor = "#4CAF50"; // لون أخضر عند النجاح
        
        // إعادة الزر لحالته الأصلية بعد ثانيتين
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.backgroundColor = ""; // العودة للون الأصلي
        }, 2000);
    }).catch(err => {
        console.error("فشل النسخ: ", err);
        alert("حدث خطأ أثناء النسخ");
    });
}
socket.on('roomJoined', (roomCode) => {
    currentRoomCode = roomCode;
    document.getElementById('status-msg').style.color = "#3498db";
    document.getElementById('status-msg').innerText = "ننتظر بدء اللعبة...";
});

socket.on('startGame', (data) => {
    document.getElementById('start-screen').classList.remove('active');

});

socket.on('errorMsg', (msg) => {
    const status = document.getElementById('status-msg');
    if(status) {
        status.style.color = "#e74c3c";
        status.innerText = msg;
    } else {
        alert(msg);
    }
});

socket.on('playerLeft', (msg) => {
    alert(msg);
    location.reload();
});

// أحداث اللعبة والرندرة
socket.on('updateGameState', (state) => {
    renderOpponentHiddenCards(state.opponentCardCount);
    renderCenterCard(state.topCard);
    renderMyHand(state.myHand, state.isMyTurn);
});

socket.on('gameOver', (data) => {
    const gameOverScreen = document.getElementById('game-over-screen');
    const title = document.getElementById('game-over-title');
    const msg = document.getElementById('game-over-msg');

    if (data.winnerId === socket.id) {
        title.innerText = "🎉 ألف مبروك!";
        msg.innerHTML = data.reason === 'opponent_left' 
            ? '<div class="win-text">لقد فزت! (انسحب خصمك 🏃‍♂️) 🏆</div>'
            : '<div class="win-text">لقد فزت في اللعبة! 🏆</div>';
    } else {
        title.innerText = "😔 حظاً أوفر!";
        msg.innerHTML = '<div class="lose-text">لقد فاز خصمك هذه المرة.</div>';
    }
    gameOverScreen.classList.add('active');
});

function getSuitClass(card) {
    return (card.s === '♥' || card.s === '♦') ? 'suit-red' : 'suit-black';
}

function renderOpponentHiddenCards(count) {
    const oppArea = document.getElementById('opponent-area');
    let cardsHtml = Array(count).fill('<div class="card card-back">UNO</div>').join('');
    oppArea.innerHTML = `<h3>أوراق الخصم (${count})</h3><div class="hand">${cardsHtml}</div>`;
}

function renderCenterCard(topCard) {
    const centerArea = document.getElementById('center-area');
    centerArea.innerHTML = `
        <h3>الورقة المركزية</h3>
        <div class="card central ${getSuitClass(topCard)}">
            ${topCard.v}<br>${topCard.s}
        </div>
    `;
}

function renderMyHand(myHand, isMyTurn) {
    const myArea = document.getElementById('my-area');
    const statusText = isMyTurn ? "<span style='color: #2ecc71;'>(دورك الآن ✅)</span>" : "<span style='color: #e74c3c;'>(انتظر دورك ⏳)</span>";
    
    let cardsHtml = myHand.map((card, index) => {
        const disabledAttr = isMyTurn ? '' : 'disabled';
        const dimClass = isMyTurn ? '' : 'dimmed'; 
        return `
            <button class="card ${getSuitClass(card)} ${dimClass}" 
                    onclick="playCard(${index})" ${disabledAttr}>
                ${card.v}<br>${card.s}
            </button>
        `;
    }).join('');

    let drawButtonHtml = isMyTurn 
        ? `<br><button class="btn-small" onclick="drawCard()" style="margin-top: 15px; background-color: #f39c12;">سحب ورقة</button>` 
        : '';

    myArea.innerHTML = `<h3>أوراقي ${statusText}</h3><div class="hand">${cardsHtml}</div>${drawButtonHtml}`;
}

function playCard(index) {
    socket.emit('playCard', { roomCode: currentRoomCode, cardIndex: index });
}

function drawCard() {
    socket.emit('drawCard', currentRoomCode);
}
document.getElementById('share-btn').addEventListener('click', () => {
    if (navigator.share) {
        navigator.share({
            title: 'لعبة UNO',
            text: 'انضم إليّ في تحدي UNO!',
            url: window.location.href // هذا الرابط هو رابط GitHub Pages الخاص بك
        }).catch(console.error);
    } else {
        // بديل: نسخ الرابط للحافظة إذا لم يدعم المتصفح المشاركة المباشرة
        navigator.clipboard.writeText(window.location.href);
        alert('تم نسخ رابط اللعبة للحافظة!');
    }
});
