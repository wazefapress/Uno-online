import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { io } from 'socket.io-client';

// استبدل هذا الرابط برابط سيرفرك الحقيقي على Railway.app
const SERVER_URL = "https://uno-online-production-307a.up.railway.app"; 
const socket = io(SERVER_URL);

export default function UnoOnlineGame() {
  const [roomCode, setRoomCode] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [myCards, setMyCards] = useState([]);

  // إنشاء غرفة لعب جديدة
  const createRoom = () => {
    socket.emit('createRoom', (code) => {
      setRoomCode(code);
      setInRoom(true);
    });
  };

  // الانضمام لغرفة عبر الكود
  const joinRoom = () => {
    socket.emit('joinRoom', roomCode, (success) => {
      if (success) setInRoom(true);
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>UNO Online Game</Text>

      {!inRoom ? (
        <View style={styles.menu}>
          <TouchableOpacity style={styles.btn} onPress={createRoom}>
            <Text style={styles.btnText}>إنشاء غرفة جديدة</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="أدخل كود الغرفة"
            placeholderTextColor="#888"
            value={roomCode}
            onChangeText={setRoomCode}
          />

          <TouchableOpacity style={styles.btn} onPress={joinRoom}>
            <Text style={styles.btnText}>انضمام للغرفة</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.roomContainer}>
          <Text style={styles.roomText}>أنت داخل الغرفة: {roomCode}</Text>
          {/* هنا يتم عرض أوراق الـ UNO وطاولة اللعب */}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d2818', justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 28, color: '#ffd100', fontWeight: 'bold', marginBottom: 30 },
  menu: { width: '100%', alignItems: 'center' },
  btn: { backgroundColor: '#d90429', padding: 15, borderRadius: 10, width: '80%', alignItems: 'center', marginVertical: 10 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  input: { backgroundColor: '#fff', width: '80%', padding: 12, borderRadius: 10, textAlign: 'center', fontSize: 16, marginVertical: 10 },
  roomContainer: { alignItems: 'center' },
  roomText: { color: '#fff', fontSize: 20 }
});