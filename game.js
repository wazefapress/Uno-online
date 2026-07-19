// ⚠️ ملاحظة هامة: بعد رفع السيرفر على Render، استبدل هذا الرابط برابط Render الخاص بك
const socket = io("https://uno-online-zbb7.onrender.com");
let currentRoomCode = null;

// ==========================================
// 1. معالجة الرابط المباشر عند تحميل الصفحة
// ==========================================
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('room');
    
    if (roomIdFromUrl) {
        // إذا كان هناك كود في الرابط، نحاول الانضمام تلقائياً
        document.getElementById('room-code-input').value = roomIdFromUrl;
        joinRoom(roomIdFromUrl);
    }
};

// ==========================================
// 2. دوال إنشاء والانضمام للغرف
// ==========================================
function createRoom() { 
    socket.emit('createRoom'); 
}

function joinRoom(codeFromUrl = null) {
    // نأخذ الكود من الرابط إذا وجد، أو من الخانة
    const code = codeFromUrl || document.getElementById('room-code-input').value.toUpperCase();
    if (code) socket.emit('joinRoom', code);
}

function resetToHome() { 
    // إزالة كود الغرفة من الرابط عند العودة للرئيسية
    window.location.href = window.location.pathname; 
}

// ==========================================
// 3. أحداث الاتصال والغرف (Socket Events)
// ==========================================
socket.on('roomCreated', (roomCode) => {
    currentRoomCode = roomCode;
    const fullLink = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    
    const statusMsg = document.getElementById('status-msg');
    statusMsg.style.color = "#2ecc71";
    
    // عرض الكود والرابط مع زر النسخ داخل رسالة الحالة
    statusMsg.innerHTML = `
        تم إنشاء الغرفة! كود الغرفة: <strong>${roomCode}</strong><br>
        <div style="margin-top: 10px;">
            <input type="text" id="link-box" value="${fullLink}" readonly style="width: 80%; padding: 5px; text-align: left;" dir="ltr">
            <button onclick="copyInviteLink()" style="padding: 6px 10px; background: #3498db; color: white; border: none; cursor: pointer;">نسخ الرابط</button>
        </div>
    `;
});

// دالة لنسخ الرابط من مربع النص أعلاه
function copyInviteLink() {
    const copyText = document.getElementById("link-box");
    copyText.select();
    document.execCommand("copy");
    alert("تم نسخ الرابط! أرسله لصديقك الآن.");
}

socket.on('roomJoined', (roomCode) => {
    currentRoomCode = roomCode;
    document.getElementById('status-msg').style.color = "#3498db";
    document.getElementById('status-msg').innerText = "تم الانضمام للغرفة! ننتظر بدء اللعبة...";
});

socket.on('startGame', (data) => {
    // إخفاء شاشة البداية وعرض الطاولة
    document.getElementById('start-screen').classList.remove('active');
    
    // ملاحظة: تأكد أن طاولة اللعب ظاهرة عبر الـ CSS الخاص بك بمجرد إزالة الـ active من شاشة البداية
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
    resetToHome();
});

// ==========================================
// 4. أحداث اللعبة والرندرة (توزيع الكروت)
// ==========================================
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

// ==========================================
// 5. زر المشاركة العام
// ==========================================
document.getElementById('share-btn').addEventListener('click', () => {
    // تحديد الرابط: إذا كان اللاعب في غرفة يشارك رابط الغرفة، وإلا يشارك رابط الموقع العام
    const shareUrl = currentRoomCode 
        ? `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`
        : window.location.href;

    if (navigator.share) {
        navigator.share({
            title: 'لعبة UNO',
            text: 'انضم إليّ في تحدي UNO!',
            url: shareUrl
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(shareUrl);
        alert('تم نسخ رابط اللعبة للحافظة!');
    }
});
