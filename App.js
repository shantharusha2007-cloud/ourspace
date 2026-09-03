import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';

const API_URL = 'https://ourspace-app-gules.vercel.app';
const USER_STORAGE_KEY = 'our-space-user-id';
const REACTIONS = ['❤️', '😂', '👍', '😮'];

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function PrimaryButton({ children, onPress, disabled }) {
  return (
    <TouchableOpacity style={[styles.primaryButton, disabled && styles.disabledButton]} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      {disabled ? <ActivityIndicator color="#08111f" /> : <Text style={styles.primaryButtonText}>{children}</Text>}
    </TouchableOpacity>
  );
}

function Header({ onSignOut, privateRoom = false }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>OUR SPACE</Text>
        {privateRoom && <Text style={styles.privateLabel}>PRIVATE ROOM</Text>}
      </View>
      <TouchableOpacity onPress={onSignOut} hitSlop={12}>
        <Text style={styles.signOut}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function NameScreen({ onSubmit, loading }) {
  const [name, setName] = useState('');
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.welcomeScreen} keyboardShouldPersistTaps="handled">
        <Text style={styles.welcomeBrand}>OUR@SPACE</Text>
        <Text style={styles.welcomeTitle}>A room for two.</Text>
        <Text style={styles.welcomeIntro}>Start with your name, then invite one person into a private space that stays yours.</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={60}
            autoCapitalize="words"
            autoComplete="name"
            placeholder="e.g. Alex"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
            returnKeyType="done"
          />
          <PrimaryButton onPress={() => onSubmit(name)} disabled={loading}>{loading ? 'Entering...' : 'Enter your space'}</PrimaryButton>
        </View>
        <Text style={styles.welcomeFooter}>Secure, private, and encrypted end-to-end.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PairingScreen({ user, onPair, onPairSuccess, onSignOut, loading }) {
  const [partnerCode, setPartnerCode] = useState('');
  const [activeTab, setActiveTab] = useState('code');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const qrUrl = `${API_URL}/api/qr/${user.pairCode}`;

  const extractPairCode = (value) => {
    const normalized = value.trim();
    const match = normalized.match(/our-space:\/\/pair\/([A-Z0-9]{6})/i);
    if (match) return match[1].toUpperCase();
    return /^[A-Z0-9]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    const code = extractPairCode(data);
    setScanned(true);
    if (!code) {
      Alert.alert('Invalid QR code', 'This QR code is not an Our Space Pair Code.');
      setScanned(false);
      return;
    }
    setPartnerCode(code);
    const paired = await onPair(code);
    if (!paired) setScanned(false);
  };

  const openScanner = () => {
    setActiveTab('scan');
    setScanned(false);
  };

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    const checkPairingStatus = async () => {
      if (!active || requestInFlight) return;
      requestInFlight = true;
      try {
        const data = await request(`/api/users/${user.id}`);
        const candidate = data?.user || data?.paired?.user || data?.partner?.user || data?.paired || data?.partner;
        const hasPairedStatus = data?.paired === true || Boolean(data?.partner) || Boolean(data?.paired) || Boolean(candidate?.roomId);
        const roomId = candidate?.roomId || candidate?.room?.id;
        if (active && hasPairedStatus && candidate?.id === user.id && roomId) {
          onPairSuccess({ ...candidate, roomId });
        }
      } catch {
        // Socket.IO remains the fast path when the status request is unavailable.
      } finally {
        requestInFlight = false;
      }
    };

    checkPairingStatus();
    const interval = setInterval(checkPairingStatus, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onPairSuccess, user.id]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header onSignOut={onSignOut} />
      <View style={styles.pairingScreen}>
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, activeTab === 'code' && styles.activeTab]} onPress={() => setActiveTab('code')}>
            <Text style={[styles.tabText, activeTab === 'code' && styles.activeTabText]}>MY CODE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'scan' && styles.activeTab]} onPress={openScanner}>
            <Text style={[styles.tabText, activeTab === 'scan' && styles.activeTabText]}>SCAN CODE</Text>
          </TouchableOpacity>
        </View>
        {activeTab === 'code' ? (
          <ScrollView contentContainerStyle={styles.pairingContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.eyebrow}>YOUR INVITATION</Text>
            <Text style={styles.screenTitle}>Make it just you two.</Text>
            <Text style={styles.intro}>Share this code with your partner. It never changes.</Text>
            <View style={styles.codeBlock}>
              <Text style={styles.code}>{user.pairCode}</Text>
              <Text style={styles.muted}>Your personal Pair Code</Text>
            </View>
            <View style={styles.qrPanel}>
              <Image source={{ uri: qrUrl }} style={styles.qrCode} resizeMode="contain" />
              <Text style={styles.qrCaption}>Scan to share your code</Text>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.scannerPanel}>
            {!permission ? (
              <ActivityIndicator size="large" color={COLORS.accent} />
            ) : !permission.granted ? (
              <View style={styles.permissionPanel}>
                <Text style={styles.permissionTitle}>Camera access needed</Text>
                <Text style={styles.permissionText}>Allow camera access to scan your partner's Pair Code.</Text>
                <PrimaryButton onPress={requestPermission}>Allow camera</PrimaryButton>
              </View>
            ) : (
              <View style={styles.cameraWrap}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                />
                <View style={styles.scanOverlay} pointerEvents="none">
                  <View style={styles.scanFrame} />
                  <Text style={styles.scanHint}>{loading ? 'Pairing...' : 'Align the QR code inside the frame'}</Text>
                </View>
              </View>
            )}
          </View>
        )}
        <View style={styles.pairForm}>
          <Text style={styles.label}>Have their Pair Code?</Text>
          <TextInput
            value={partnerCode}
            onChangeText={(value) => setPartnerCode(value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={6}
            autoCapitalize="characters"
            placeholder="ABC123"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />
          <PrimaryButton onPress={() => onPair(partnerCode)} disabled={loading}>{loading ? 'Pairing...' : 'Pair us'}</PrimaryButton>
        </View>
      </View>
    </SafeAreaView>
  );
}

function MessageBubble({ message, isMine, onReaction, reactions }) {
  return (
    <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
      <View style={[styles.messageBubble, isMine ? styles.mineBubble : styles.theirBubble]}>
        {!!message.imageDataUrl && <Image source={{ uri: message.imageDataUrl }} style={styles.messageImage} />}
        {!!message.text && <Text style={styles.messageText}>{message.text}</Text>}
        <Text style={styles.messageTime}>{formatTimestamp(message.createdAt)}</Text>
      </View>
      <View style={[styles.reactionBar, isMine && styles.reactionBarMine]}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} onPress={() => onReaction(message.id, emoji)} style={styles.reactionButton}>
            <Text>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[styles.reactions, isMine && styles.reactionsMine]}>
        {Object.entries(reactions || {}).filter(([, count]) => count > 0).map(([emoji, count]) => (
          <Text key={emoji} style={styles.reactionPill}>{emoji} {count}</Text>
        ))}
      </View>
    </View>
  );
}

function ChatScreen({ user, socket, onSignOut }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [pendingImage, setPendingImage] = useState('');
  const [reactions, setReactions] = useState({});
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const typingTimer = useRef(null);

  useEffect(() => {
    let mounted = true;
    request(`/api/rooms/${user.roomId}/messages?userId=${encodeURIComponent(user.id)}`)
      .then((data) => { if (mounted) setMessages(data.messages); })
      .catch((error) => Alert.alert('Could not load messages', error.message));

    const handleNewMessage = (message) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    const handleTyping = ({ userId }) => { if (userId !== user.id) setPartnerTyping(true); };
    const handleStopTyping = ({ userId }) => { if (userId !== user.id) setPartnerTyping(false); };
    const handleReaction = ({ messageId, emoji, userId }) => {
      if (userId === user.id) return;
      setReactions((current) => ({ ...current, [messageId]: { ...(current[messageId] || {}), [emoji]: (current[messageId]?.[emoji] || 0) + 1 } }));
    };
    socket.on('message:new', handleNewMessage);
    socket.on('typing', handleTyping);
    socket.on('stop_typing', handleStopTyping);
    socket.on('message:reaction', handleReaction);
    socket.on('disconnect', () => setPartnerOnline(false));
    return () => {
      mounted = false;
      socket.off('message:new', handleNewMessage);
      socket.off('typing', handleTyping);
      socket.off('stop_typing', handleStopTyping);
      socket.off('message:reaction', handleReaction);
      clearTimeout(typingTimer.current);
    };
  }, [socket, user.id, user.roomId]);

  const updateTyping = (value) => {
    setMessageText(value);
    if (!value.trim()) { socket.emit('stop_typing'); clearTimeout(typingTimer.current); return; }
    socket.emit('typing');
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('stop_typing'), 1200);
  };

  const sendMessage = () => {
    const text = messageText.trim();
    if (!text && !pendingImage) return;
    socket.emit('stop_typing');
    socket.emit('message:send', { text, imageDataUrl: pendingImage });
    setMessageText('');
    setPendingImage('');
  };

  const chooseImage = async (camera = false) => {
    setMenuOpen(false);
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64) setPendingImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
  };

  const addReaction = (messageId, emoji) => {
    setReactions((current) => ({ ...current, [messageId]: { ...(current[messageId] || {}), [emoji]: (current[messageId]?.[emoji] || 0) + 1 } }));
    socket.emit('message:reaction', { messageId, emoji });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header onSignOut={onSignOut} privateRoom />
      <View style={styles.chatScreen}>
        <View style={styles.chatHeading}>
          <View><Text style={styles.eyebrow}>JUST YOU TWO</Text><Text style={styles.partnerName}>{user.partnerName || 'Our space'}</Text></View>
          <View style={styles.status}><View style={[styles.statusDot, !partnerOnline && styles.awayDot]} /><Text style={styles.statusText}>{partnerOnline ? 'Online' : 'Away'}</Text></View>
        </View>
        {partnerTyping && <Text style={styles.typing}>Partner is typing...</Text>}
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isMine={item.senderId === user.id} onReaction={addReaction} reactions={reactions[item.id]} />}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
        {pendingImage && <View style={styles.previewWrap}><Image source={{ uri: pendingImage }} style={styles.preview} /><TouchableOpacity onPress={() => setPendingImage('')}><Text style={styles.removePreview}>Remove</Text></TouchableOpacity></View>}
        {menuOpen && <View style={styles.attachmentMenu}><TouchableOpacity onPress={() => chooseImage(true)}><Text style={styles.menuItem}>Camera</Text></TouchableOpacity><TouchableOpacity onPress={() => chooseImage(false)}><Text style={styles.menuItem}>Photos &amp; Files</Text></TouchableOpacity><TouchableOpacity onPress={() => { setMenuOpen(false); Alert.alert('Unavailable', 'Audio and contacts are not supported yet.'); }}><Text style={styles.menuItem}>Audio / Contact</Text></TouchableOpacity></View>}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composer}>
            <TouchableOpacity style={styles.addButton} onPress={() => setMenuOpen((open) => !open)}><Text style={styles.addText}>+</Text></TouchableOpacity>
            <TextInput value={messageText} onChangeText={updateTyping} multiline maxLength={4000} placeholder="Write something..." placeholderTextColor={COLORS.muted} style={styles.messageInput} />
            <TouchableOpacity style={styles.sendButton} onPress={sendMessage}><Text style={styles.sendText}>➤</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  const handlePairSuccess = useCallback(async (updatedUser) => {
    if (!updatedUser?.id || updatedUser.id !== user?.id || !updatedUser.roomId) return;
    await AsyncStorage.setItem(USER_STORAGE_KEY, updatedUser.id);
    setUser(updatedUser);
  }, [user?.id]);

  useEffect(() => {
    AsyncStorage.getItem(USER_STORAGE_KEY).then(async (userId) => {
      if (!userId) return;
      try { setUser((await request(`/api/users/${userId}`)).user); } catch { await AsyncStorage.removeItem(USER_STORAGE_KEY); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const nextSocket = io(API_URL, { auth: { userId: user.id }, transports: ['websocket', 'polling'] });
    socketRef.current = nextSocket;
    setSocket(nextSocket);
    const handlePaired = (data) => {
      const pairedUser = data?.user || data?.paired?.user || data?.partner?.user || data?.paired || data?.partner;
      const roomId = pairedUser?.roomId || pairedUser?.room?.id;
      if (pairedUser?.id === user.id && roomId) onPairSuccess({ ...pairedUser, roomId });
    };
    nextSocket.on('paired', handlePaired);
    return () => {
      nextSocket.disconnect();
      if (socketRef.current === nextSocket) socketRef.current = null;
      setSocket((current) => current === nextSocket ? null : current);
    };
  }, [user?.id, user?.roomId]);

  const saveUser = async (nextUser) => { await AsyncStorage.setItem(USER_STORAGE_KEY, nextUser.id); setUser(nextUser); };
  const enterSpace = async (name) => {
    if (!name.trim()) return Alert.alert('Name required', 'Enter a name between 1 and 60 characters.');
    setActionLoading(true);
    try { await saveUser((await request('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).user); } catch (error) { Alert.alert('Could not enter', error.message); } finally { setActionLoading(false); }
  };
  const pairUsers = async (pairCode) => {
    if (pairCode.length !== 6) { Alert.alert('Pair Code required', 'Enter the six-character Pair Code.'); return false; }
    setActionLoading(true);
    try { await saveUser((await request('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, pairCode }) })).user); return true; } catch (error) { Alert.alert('Could not pair', error.message); return false; } finally { setActionLoading(false); }
  };
  const signOut = async () => { socketRef.current?.disconnect(); await AsyncStorage.removeItem(USER_STORAGE_KEY); setUser(null); };

  if (loading) return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;
  if (!user) return <NameScreen onSubmit={enterSpace} loading={actionLoading} />;
  if (!user.roomId) return <PairingScreen user={user} onPair={pairUsers} onPairSuccess={handlePairSuccess} onSignOut={signOut} loading={actionLoading} />;
  return socket ? <ChatScreen user={user} socket={socket} onSignOut={signOut} /> : <SafeAreaView style={styles.loading}><ActivityIndicator color={COLORS.accent} /></SafeAreaView>;
}

const COLORS = { background: '#07111f', panel: '#101d2d', panelLight: '#17283b', text: '#f5f7fb', muted: '#8fa1b5', accent: '#63d6b2', accentDark: '#08111f', border: '#25384d', mine: '#245f55', theirs: '#17283b', danger: '#ff8d8d' };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  welcomeScreen: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  welcomeBrand: { color: COLORS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 2, marginBottom: 28 },
  welcomeTitle: { color: COLORS.text, fontSize: 42, fontWeight: '800', marginBottom: 14 },
  welcomeIntro: { color: COLORS.muted, fontSize: 17, lineHeight: 26, marginBottom: 42 },
  form: { gap: 10 }, label: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, color: COLORS.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 14 },
  primaryButton: { alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 12, minHeight: 52, justifyContent: 'center', marginTop: 8, paddingHorizontal: 18 },
  disabledButton: { opacity: 0.65 }, primaryButtonText: { color: COLORS.accentDark, fontSize: 16, fontWeight: '800' },
  welcomeFooter: { color: COLORS.muted, fontSize: 12, marginTop: 48, textAlign: 'center' },
  header: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  brand: { color: COLORS.text, fontSize: 14, fontWeight: '800', letterSpacing: 1.5 }, privateLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: 1.2, marginTop: 4 }, signOut: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
  pairingScreen: { flex: 1, padding: 24 }, pairingContent: { paddingBottom: 10 }, tabs: { backgroundColor: COLORS.panel, borderRadius: 12, flexDirection: 'row', marginBottom: 22, padding: 4 }, tab: { alignItems: 'center', borderRadius: 9, flex: 1, paddingVertical: 12 }, activeTab: { backgroundColor: COLORS.accent }, tabText: { color: COLORS.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }, activeTabText: { color: COLORS.accentDark }, eyebrow: { color: COLORS.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }, screenTitle: { color: COLORS.text, fontSize: 32, fontWeight: '800', marginBottom: 10 }, intro: { color: COLORS.muted, fontSize: 16, lineHeight: 24 },
  codeBlock: { alignItems: 'center', marginVertical: 28 }, code: { color: COLORS.text, fontSize: 36, fontWeight: '800', letterSpacing: 7 }, muted: { color: COLORS.muted, fontSize: 13, marginTop: 8 }, qrPanel: { alignItems: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, padding: 20 }, qrCode: { backgroundColor: '#fff', height: 200, width: 200 }, qrCaption: { color: COLORS.muted, fontSize: 13, marginTop: 14 }, pairForm: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, gap: 10, marginTop: 18, padding: 18 }, scannerPanel: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 360, overflow: 'hidden' }, permissionPanel: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 }, permissionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }, permissionText: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 18, marginTop: 10, textAlign: 'center' }, cameraWrap: { flex: 1, minHeight: 360 }, camera: { flex: 1 }, scanOverlay: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }, scanFrame: { borderColor: COLORS.accent, borderRadius: 18, borderWidth: 3, height: 230, width: 230 }, scanHint: { backgroundColor: 'rgba(7, 17, 31, 0.8)', borderRadius: 8, color: COLORS.text, fontSize: 13, marginTop: 24, paddingHorizontal: 12, paddingVertical: 8 },
  chatScreen: { flex: 1, paddingHorizontal: 14 }, chatHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 18 }, partnerName: { color: COLORS.text, fontSize: 24, fontWeight: '800' }, status: { alignItems: 'center', backgroundColor: COLORS.panel, borderRadius: 20, flexDirection: 'row', paddingHorizontal: 11, paddingVertical: 8 }, statusDot: { backgroundColor: COLORS.accent, borderRadius: 5, height: 9, marginRight: 7, width: 9 }, awayDot: { backgroundColor: COLORS.muted }, statusText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' }, typing: { color: COLORS.accent, fontSize: 12, paddingHorizontal: 6, paddingBottom: 8 }, messages: { gap: 12, paddingBottom: 12, paddingHorizontal: 2 },
  messageRow: { alignItems: 'flex-start' }, messageRowMine: { alignItems: 'flex-end' }, messageBubble: { borderRadius: 16, maxWidth: '84%', padding: 12 }, mineBubble: { backgroundColor: COLORS.mine, borderBottomRightRadius: 4 }, theirBubble: { backgroundColor: COLORS.theirs, borderBottomLeftRadius: 4 }, messageText: { color: COLORS.text, fontSize: 16, lineHeight: 22 }, messageTime: { color: '#b3c7c2', fontSize: 10, marginTop: 7, textAlign: 'right' }, messageImage: { borderRadius: 10, height: 190, marginBottom: 6, width: 220 }, reactionBar: { flexDirection: 'row', gap: 3, marginTop: 4 }, reactionBarMine: { alignSelf: 'flex-end' }, reactionButton: { backgroundColor: COLORS.panel, borderRadius: 14, paddingHorizontal: 6, paddingVertical: 3 }, reactions: { flexDirection: 'row', gap: 4, marginTop: 3 }, reactionsMine: { justifyContent: 'flex-end' }, reactionPill: { backgroundColor: COLORS.panelLight, borderRadius: 10, color: COLORS.text, fontSize: 11, paddingHorizontal: 6, paddingVertical: 3 },
  composer: { alignItems: 'flex-end', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 10, padding: 7 }, addButton: { alignItems: 'center', backgroundColor: COLORS.panelLight, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, addText: { color: COLORS.accent, fontSize: 24, fontWeight: '300', lineHeight: 26 }, messageInput: { color: COLORS.text, flex: 1, fontSize: 16, maxHeight: 100, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8 }, sendButton: { alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, sendText: { color: COLORS.accentDark, fontSize: 19, fontWeight: '800' }, attachmentMenu: { alignSelf: 'flex-start', backgroundColor: COLORS.panelLight, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, bottom: 62, paddingVertical: 5, position: 'absolute', zIndex: 2 }, menuItem: { color: COLORS.text, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 }, previewWrap: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingBottom: 8 }, preview: { borderRadius: 8, height: 58, width: 58 }, removePreview: { color: COLORS.danger, fontSize: 13 },
});