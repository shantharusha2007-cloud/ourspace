import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
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
import * as SecureStore from 'expo-secure-store';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';

const API_URL = 'http://192.168.100.192:3000';
const USER_STORAGE_KEY = 'our-space-user-id';
const SESSION_STORAGE_KEY = 'our-space-session';
const REACTIONS = ['❤️', '😂', '👍', '😮'];
const GOOGLE_WEB_CLIENT_ID = '595386365098-qc1iooesd3p2f1vh40m6t51na83keoqs.apps.googleusercontent.com';
let Audio = null;
let FileSystem = null;

try {
  Audio = require('expo-av').Audio;
} catch (error) {
  console.warn('Voice messaging is unavailable in this build:', error.message);
}

try {
  FileSystem = require('expo-file-system');
} catch (error) {
  console.warn('Voice message file access is unavailable in this build:', error.message);
}

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
  offlineAccess: true,
});

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const responseText = await response.text();
  console.log(`API ${path} response status: ${response.status}`);
  if (!response.ok || !contentType.includes('application/json')) {
    console.error(`API ${path} returned an unexpected response:`, {
      status: response.status,
      contentType,
      response: responseText,
    });
  }
  if (!contentType.includes('application/json')) {
    throw new Error(`API returned a non-JSON response (HTTP ${response.status}).`);
  }
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error(`API ${path} returned invalid JSON:`, responseText);
    throw new Error(`API returned invalid JSON (HTTP ${response.status}).`);
  }
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

function Header({ onSignOut, onSettings, onBack }) {
  return (
    <View style={styles.header}>
      {onBack ? <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to entry screen"><Text style={styles.backArrow}>&lt;</Text></TouchableOpacity> : <View />}
      {onSettings ? <TouchableOpacity onPress={onSettings} hitSlop={12} style={styles.settingsButton} accessibilityRole="button" accessibilityLabel="Open settings"><Text style={styles.settingsIcon}>⚙</Text></TouchableOpacity> : onSignOut ? <TouchableOpacity onPress={onSignOut} hitSlop={12}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity> : <View />}
    </View>
  );
}

function SettingsModal({ visible, user, onClose, onSave, onSignOut, onRequestUnpair }) {
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [partnerName, setPartnerName] = useState(user?.partnerName || '');
  const [profilePicture, setProfilePicture] = useState(user?.profilePicture || '');
  const [background, setBackground] = useState(user?.entryBackground || COLORS.background);
  useEffect(() => { if (visible) { setName(user?.name || ''); setBio(user?.bio || ''); setPartnerName(user?.partnerName || ''); setProfilePicture(user?.profilePicture || ''); setBackground(user?.entryBackground || COLORS.background); } }, [visible, user]);
  const choosePicture = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]?.uri) setProfilePicture(result.assets[0].uri);
  };
  const chooseBackground = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]?.uri) setBackground(result.assets[0].uri);
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.settingsBackdrop}>
        <View style={styles.settingsSheet}>
          <View style={styles.settingsHeading}><Text style={styles.settingsTitle}>Settings</Text><TouchableOpacity onPress={onClose}><Text style={styles.closeButton}>×</Text></TouchableOpacity></View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.settingsLabel}>Your name</Text><TextInput value={name} onChangeText={setName} maxLength={60} style={styles.input} />
            <Text style={styles.settingsLabel}>Your bio</Text><TextInput value={bio} onChangeText={setBio} maxLength={500} multiline style={[styles.input, styles.bioInput]} />
            <Text style={styles.settingsLabel}>Profile picture</Text><TouchableOpacity onPress={choosePicture} style={styles.settingsPicture}><Text style={styles.settingsActionText}>{profilePicture ? 'Change profile picture' : 'Add profile picture'}</Text></TouchableOpacity>
            <Text style={styles.settingsLabel}>Partner display name</Text><TextInput value={partnerName} onChangeText={setPartnerName} maxLength={60} style={styles.input} />
            <Text style={styles.settingsLabel}>Entry background</Text><TouchableOpacity onPress={chooseBackground} style={styles.settingsPicture}><Text style={styles.settingsActionText}>{background.startsWith('file') || background.startsWith('content') || background.startsWith('http') ? 'Change custom background photo' : 'Upload custom background photo'}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onSave({ name, bio, profilePicture, partnerName, background })} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Save changes</Text></TouchableOpacity>
            <TouchableOpacity onPress={onRequestUnpair} style={styles.settingsDanger}><Text style={styles.settingsDangerText}>Request unpair</Text></TouchableOpacity>
            <TouchableOpacity onPress={onSignOut} style={styles.settingsSignOut}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function WelcomeScreen({ onSignIn, loading }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.welcomeScreen} keyboardShouldPersistTaps="handled">
        <Text style={styles.welcomeBrand}>OUR@SPACE</Text>
        <Text style={styles.welcomeTitle}>A room for two.</Text>
        <Text style={styles.welcomeIntro}>This is your end-to-end encrypted private space.</Text>
        <View style={styles.form}><PrimaryButton onPress={onSignIn} disabled={loading}>{loading ? 'Signing in...' : 'Sign in with Google'}</PrimaryButton></View>
        <Text style={styles.welcomeFooter}>Your identity and room stay yours across devices.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileOnboarding({ initialUser, onSubmit, loading }) {
  const [name, setName] = useState(initialUser.name || '');
  const [profilePicture, setProfilePicture] = useState(initialUser.profilePicture || '');
  const [gender, setGender] = useState(initialUser.gender || '');
  const [bio, setBio] = useState(initialUser.bio || '');
  const editPicture = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]?.uri) setProfilePicture(result.assets[0].uri);
  };
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.welcomeScreen} keyboardShouldPersistTaps="handled">
        <Text style={styles.welcomeBrand}>YOUR PROFILE</Text>
        <Text style={styles.screenTitle}>Make it yours.</Text>
        <TouchableOpacity style={styles.profilePreviewWrap} onPress={editPicture}>
          {profilePicture ? <Image source={{ uri: profilePicture }} style={styles.profilePreview} /> : <Text style={styles.profilePlaceholder}>Add photo</Text>}
        </TouchableOpacity>
        <View style={styles.form}>
          <Text style={styles.label}>Display name</Text>
          <TextInput value={name} onChangeText={setName} maxLength={60} placeholder="Your name" placeholderTextColor={COLORS.muted} style={styles.input} />
          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderRow}>{['Woman', 'Man', 'Non-binary', 'Prefer not to say'].map((option) => <TouchableOpacity key={option} style={[styles.genderOption, gender === option && styles.genderSelected]} onPress={() => setGender(option)}><Text style={styles.genderText}>{option}</Text></TouchableOpacity>)}</View>
          <Text style={styles.label}>Bio (optional)</Text>
          <TextInput value={bio} onChangeText={setBio} maxLength={500} multiline placeholder="A little about you" placeholderTextColor={COLORS.muted} style={[styles.input, styles.bioInput]} />
          <PrimaryButton onPress={() => onSubmit({ name, profilePicture, gender, bio })} disabled={loading}>{loading ? 'Saving...' : 'Continue'}</PrimaryButton>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AuthScreen({ onAuthenticated, loading }) {
  const handleGoogleSignIn = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken || userInfo.idToken;
      if (!idToken) throw new Error('Google did not return an identity token.');
      await onAuthenticated(idToken);
    } catch (error) {
      if (error.code === 'SIGN_IN_CANCELLED' || error.code === '12501') return;
      console.error('Google Sign-In Error:', error);
      Alert.alert('Google sign-in failed', error.message || 'Please try again.');
    }
  };
  return <WelcomeScreen onSignIn={handleGoogleSignIn} loading={loading} />;
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
            onChangeText={setPartnerCode}
            maxLength={254}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Pair Code or Gmail address"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />
          <PrimaryButton onPress={() => onPair(partnerCode)} disabled={loading}>{loading ? 'Pairing...' : 'Pair us'}</PrimaryButton>
        </View>
      </View>
    </SafeAreaView>
  );
}

function CozyEntryScreen({ user, onEnter, onSettings }) {
  const partner = user.partner || {};
  const partnerName = user.partnerName || partner.name || 'Your partner';
  const entryBackground = user.entryBackground || COLORS.background;
  return (
    <SafeAreaView style={styles.safeArea}>
      <ImageBackground source={entryBackground.startsWith('file') || entryBackground.startsWith('content') || entryBackground.startsWith('http') ? { uri: entryBackground } : undefined} style={[styles.entryScreen, !entryBackground.startsWith('file') && !entryBackground.startsWith('content') && !entryBackground.startsWith('http') && { backgroundColor: entryBackground }]} imageStyle={styles.entryBackgroundImage}>
        <TouchableOpacity onPress={onSettings} style={styles.entrySettingsButton} accessibilityRole="button" accessibilityLabel="Open settings"><Text style={styles.settingsIcon}>⚙</Text></TouchableOpacity>
        <Text style={styles.entryBrand}>OUR SPACE</Text>
        <Text style={styles.entryEyebrow}>YOUR PRIVATE ROOM</Text>
        <TouchableOpacity style={styles.entryPortal} onPress={onEnter} activeOpacity={0.88} accessibilityRole="button" accessibilityLabel={`Enter your space with ${partnerName}`}>
          <View style={styles.entryGlow} />
          <View style={styles.entryRingOuter}>
            <View style={styles.entryRingInner}>
              {partner.profilePicture ? <Image source={{ uri: partner.profilePicture }} style={styles.entryAvatar} /> : <Text style={styles.entryAvatarFallback}>{partnerName.charAt(0).toUpperCase()}</Text>}
            </View>
          </View>
        </TouchableOpacity>
        <Text style={styles.entryName}>{partnerName}</Text>
        <View style={styles.entryStatus}><View style={styles.entryStatusDot} /><Text style={styles.entryStatusText}>Online</Text></View>
        <Text style={styles.entryPrompt}>Tap to enter our space</Text>
      </ImageBackground>
    </SafeAreaView>
  );
}

function HighlightedMessageText({ text, query }) {
  if (!query.trim()) return <Text style={styles.messageText}>{text}</Text>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return <Text style={styles.messageText}>{parts.map((part, index) => part.toLowerCase() === query.trim().toLowerCase() ? <Text key={`${part}-${index}`} style={styles.searchHighlight}>{part}</Text> : part)}</Text>;
}

function VoiceMessage({ message }) {
  const soundRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const duration = message.audioDuration || 0;

  useEffect(() => () => { soundRef.current?.unloadAsync(); }, []);

  const togglePlayback = async () => {
    if (!Audio) {
      Alert.alert('Voice messages require a custom development build');
      return;
    }
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync({ uri: message.audioDataUrl }, { shouldPlay: true }, (status) => {
        if (!status.isLoaded) return;
        setPlaying(status.isPlaying);
        setPosition(status.positionMillis || 0);
        if (status.didJustFinish) setPosition(0);
      });
      soundRef.current = sound;
      setPlaying(true);
      return;
    }
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.didJustFinish || status.positionMillis >= (status.durationMillis || duration)) {
      await soundRef.current.replayAsync();
    } else if (status.isPlaying) {
      await soundRef.current.pauseAsync();
    } else {
      await soundRef.current.playAsync();
    }
  };

  return <View style={styles.voiceMessage}><TouchableOpacity onPress={togglePlayback} style={styles.voicePlayButton} accessibilityRole="button" accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}><Text style={styles.voicePlayIcon}>{playing ? '❚❚' : '▶'}</Text></TouchableOpacity><View style={styles.voiceTrack}><View style={[styles.voiceProgress, { width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%` }]} /></View><Text style={styles.voiceDuration}>{formatDuration(duration || position)}</Text></View>;
}

function MessageBubble({ message, isMine, onReaction, reactions, searchQuery }) {
  return (
    <View style={[styles.messageRow, isMine && styles.messageRowMine]}>
      <View style={[styles.messageBubble, isMine ? styles.mineBubble : styles.theirBubble]}>
        {!!message.audioDataUrl && <VoiceMessage message={message} />}
        {!!message.imageDataUrl && <Image source={{ uri: message.imageDataUrl }} style={styles.messageImage} />}
        {!!message.text && <HighlightedMessageText text={message.text} query={searchQuery} />}
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

function ChatScreen({ user, socket, onSignOut, onUnpair, onBack }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [pendingImage, setPendingImage] = useState('');
  const [reactions, setReactions] = useState({});
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(true);
  const [partnerLastSeen, setPartnerLastSeen] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [recording, setRecording] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const typingTimer = useRef(null);
  const recordingRef = useRef(null);
  const recordingStartRef = useRef(null);
  const recordingStartedAt = useRef(0);
  const recordingTimer = useRef(null);

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
    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    socket.on('message:new', handleNewMessage);
    socket.on('typing', handleTyping);
    socket.on('stop_typing', handleStopTyping);
    socket.on('message:reaction', handleReaction);
    socket.on('disconnect', () => { setPartnerOnline(false); setPartnerLastSeen(Date.now()); });
    return () => {
      mounted = false;
      socket.off('message:new', handleNewMessage);
      socket.off('typing', handleTyping);
      socket.off('stop_typing', handleStopTyping);
      socket.off('message:reaction', handleReaction);
      backSubscription.remove();
      clearTimeout(typingTimer.current);
      clearInterval(recordingTimer.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
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

  const startRecording = async () => {
    if (recordingRef.current || recordingStartRef.current || messageText.trim()) return;
    if (!Audio || !FileSystem) {
      Alert.alert('Voice messages require a custom development build');
      return;
    }
    recordingStartRef.current = (async () => {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone access is required to record a voice message.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const nextRecording = new Audio.Recording();
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await nextRecording.startAsync();
      recordingRef.current = nextRecording;
      recordingStartedAt.current = Date.now();
      setRecording(nextRecording);
      setRecordingDuration(0);
      recordingTimer.current = setInterval(() => setRecordingDuration(Date.now() - recordingStartedAt.current), 250);
    })();
    try { await recordingStartRef.current; } catch (error) { recordingStartRef.current = null; Alert.alert('Could not start recording', error.message); }
    recordingStartRef.current = null;
  };

  const stopRecording = async () => {
    if (recordingStartRef.current) {
      try { await recordingStartRef.current; } catch { return; }
    }
    const activeRecording = recordingRef.current;
    if (!activeRecording) return;
    if (!Audio || !FileSystem) {
      recordingRef.current = null;
      setRecording(null);
      return;
    }
    clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    recordingRef.current = null;
    setRecording(null);
    const duration = Date.now() - recordingStartedAt.current;
    setRecordingDuration(duration);
    await activeRecording.stopAndUnloadAsync();
    const uri = activeRecording.getURI();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    if (!uri || duration < 250) return;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const mimeType = uri.endsWith('.caf') ? 'audio/x-caf' : 'audio/mp4';
    socket.emit('message:send', { text: '', imageDataUrl: '', audioDataUrl: `data:${mimeType};base64,${base64}`, audioDuration: duration });
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

  const partner = user.partner || {};
  const partnerName = user.partnerName || partner.name || 'Our space';
  const visibleMessages = searchQuery.trim()
    ? messages.filter((message) => message.text?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : messages;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.chatKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}>
      <View style={styles.chatHeader}>
        <View style={styles.chatHeaderLeft}>
          <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to entry screen"><Text style={styles.backArrow}>←</Text></TouchableOpacity>
          <View style={styles.miniAvatar}>{partner.profilePicture ? <Image source={{ uri: partner.profilePicture }} style={styles.miniAvatarImage} /> : <Text style={styles.miniAvatarFallback}>{partnerName.charAt(0).toUpperCase()}</Text>}</View>
          <View style={styles.chatHeaderIdentity}><Text style={styles.partnerName}>{partnerName}</Text><Text style={styles.chatPresence}>{partnerTyping ? 'typing...' : partnerOnline ? 'Online' : `Last seen ${partnerLastSeen ? formatTimestamp(partnerLastSeen) : 'recently'}`}</Text></View>
        </View>
        <View style={styles.chatHeaderActions}>
          <TouchableOpacity onPress={() => { setSearchOpen((open) => !open); setMenuOpen(false); }} hitSlop={10} style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel="Search messages"><Text style={styles.headerActionIcon}>🔍</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setMenuOpen((open) => !open); setSearchOpen(false); }} hitSlop={10} style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel="Open chat actions"><Text style={styles.headerActionIcon}>⋮</Text></TouchableOpacity>
        </View>
      </View>
      <View style={styles.chatScreen}>
        {searchOpen && <View style={styles.searchBar}><TextInput autoFocus value={searchQuery} onChangeText={setSearchQuery} placeholder="Search messages" placeholderTextColor={COLORS.muted} style={styles.searchInput} /><TouchableOpacity onPress={() => { setSearchQuery(''); setSearchOpen(false); }} accessibilityLabel="Close message search"><Text style={styles.closeButton}>×</Text></TouchableOpacity></View>}
        {menuOpen && <View style={styles.chatActionSheet}><TouchableOpacity style={styles.chatAction} onPress={() => { setSearchOpen(true); setMenuOpen(false); }}><Text style={styles.chatActionText}>Search Messages</Text></TouchableOpacity><TouchableOpacity style={styles.chatAction} onPress={() => Alert.alert('Shared media', 'Shared media gallery is coming soon.')}><Text style={styles.chatActionText}>Shared Media Gallery</Text></TouchableOpacity><TouchableOpacity style={styles.chatAction} onPress={() => Alert.alert('Clear chat history', 'This action is not available yet.')}><Text style={styles.chatActionText}>Clear Chat History</Text></TouchableOpacity><TouchableOpacity style={styles.chatAction} onPress={() => { setNotificationsMuted((muted) => !muted); setMenuOpen(false); }}><Text style={styles.chatActionText}>{notificationsMuted ? 'Unmute Notifications' : 'Mute Notifications'}</Text></TouchableOpacity></View>}
        {partnerTyping && <Text style={styles.typing}>Partner is typing...</Text>}
        <FlatList
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isMine={item.senderId === user.id} onReaction={addReaction} reactions={reactions[item.id]} searchQuery={searchQuery} />}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
        {pendingImage && <View style={styles.previewWrap}><Image source={{ uri: pendingImage }} style={styles.preview} /><TouchableOpacity onPress={() => setPendingImage('')}><Text style={styles.removePreview}>Remove</Text></TouchableOpacity></View>}
        {menuOpen && <View style={styles.attachmentMenu}><TouchableOpacity onPress={() => chooseImage(true)}><Text style={styles.menuItem}>Camera</Text></TouchableOpacity><TouchableOpacity onPress={() => chooseImage(false)}><Text style={styles.menuItem}>Photos &amp; Files</Text></TouchableOpacity><TouchableOpacity onPress={() => { setMenuOpen(false); Alert.alert('Unavailable', 'Audio and contacts are not supported yet.'); }}><Text style={styles.menuItem}>Audio / Contact</Text></TouchableOpacity></View>}
          <View style={styles.composer}>
            <TouchableOpacity style={styles.addButton} onPress={() => setMenuOpen((open) => !open)}><Text style={styles.addText}>+</Text></TouchableOpacity>
            {recording ? <View style={styles.recordingStatus}><Text style={styles.recordingWave}>▂▅▃▇▂</Text><Text style={styles.recordingTimer}>{formatDuration(recordingDuration)}</Text></View> : <TextInput value={messageText} onChangeText={updateTyping} multiline maxLength={4000} placeholder="Write something..." placeholderTextColor={COLORS.muted} style={styles.messageInput} />}
            {messageText.trim() || recording ? <TouchableOpacity style={[styles.sendButton, recording && styles.stopRecordingButton]} onPress={recording ? stopRecording : sendMessage} accessibilityRole="button" accessibilityLabel={recording ? 'Stop and send voice message' : 'Send message'}><Text style={styles.sendText}>{recording ? '■' : '➤'}</Text></TouchableOpacity> : <TouchableOpacity style={styles.micButton} onPressIn={startRecording} onPressOut={stopRecording} accessibilityRole="button" accessibilityLabel="Record voice message"><Text style={styles.micIcon}>🎙️</Text></TouchableOpacity>}
          </View>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [onboardingUser, setOnboardingUser] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const [hasEnteredSpace, setHasEnteredSpace] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    setHasEnteredSpace(false);
  }, [user?.roomId]);

  const handlePairSuccess = useCallback(async (updatedUser) => {
    if (!updatedUser?.id || updatedUser.id !== user?.id || !updatedUser.roomId) return;
    await AsyncStorage.setItem(USER_STORAGE_KEY, updatedUser.id);
    setUser(updatedUser);
  }, [user?.id]);

  useEffect(() => {
    SecureStore.getItemAsync(SESSION_STORAGE_KEY).then(async (storedSession) => {
      if (!storedSession) return;
      try {
        const session = JSON.parse(storedSession);
        const restored = (await request(`/api/users/${session.userId}`, { headers: { Authorization: `Bearer ${session.token}` } })).user;
        restored.partnerName = await AsyncStorage.getItem(`our-space-partner-name:${restored.id}`) || restored.partnerName;
        restored.entryBackground = await AsyncStorage.getItem(`our-space-background:${restored.id}`) || COLORS.background;
        setSessionToken(session.token); setUser(restored);
      } catch { await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY); await AsyncStorage.removeItem(USER_STORAGE_KEY); }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const nextSocket = io(API_URL, { auth: { userId: user.id, token: sessionToken }, transports: ['websocket', 'polling'] });
    socketRef.current = nextSocket;
    setSocket(nextSocket);
    const handlePaired = (data) => {
      const pairedUser = data?.user || data?.paired?.user || data?.partner?.user || data?.paired || data?.partner;
      const roomId = pairedUser?.roomId || pairedUser?.room?.id;
      if (pairedUser?.id === user.id && roomId) onPairSuccess({ ...pairedUser, roomId });
    };
    nextSocket.on('paired', handlePaired);
    nextSocket.on('unpaired', () => setUser((current) => current ? { ...current, partnerId: null, pairedWith: null, roomId: null, partner: null, partnerName: null } : current));
    nextSocket.on('unpair:request', ({ userName } = {}) => Alert.alert(`${userName || 'Your partner'} requested to unpair.`, 'Accept / Decline?', [{ text: 'Decline', style: 'cancel', onPress: () => nextSocket.emit('unpair:respond', { accepted: false }) }, { text: 'Accept', style: 'destructive', onPress: () => nextSocket.emit('unpair:respond', { accepted: true }) }]));
    return () => {
      nextSocket.disconnect();
      if (socketRef.current === nextSocket) socketRef.current = null;
      setSocket((current) => current === nextSocket ? null : current);
    };
  }, [user?.id, user?.roomId, sessionToken]);

  const saveUser = async (nextUser, token = sessionToken) => { await AsyncStorage.setItem(USER_STORAGE_KEY, nextUser.id); if (token) { await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify({ token, userId: nextUser.id })); setSessionToken(token); } setUser(nextUser); setOnboardingUser(null); };
  const authenticateWithGoogle = async (idToken) => {
    setActionLoading(true);
    try {
      const result = await request('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify({ token: result.token, userId: result.user.id }));
      setSessionToken(result.token);
      if (result.isNew || !result.user.name) setOnboardingUser(result.user); else setUser(result.user);
    } catch (error) { Alert.alert('Could not sign in', error.message); } finally { setActionLoading(false); }
  };
  const saveProfile = async (profile) => {
    setActionLoading(true);
    try {
      const result = await request('/api/users/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify(profile) });
      await saveUser(result.user);
    } catch (error) { Alert.alert('Could not save profile', error.message); } finally { setActionLoading(false); }
  };
  const pairUsers = async (pairCode) => {
    if (!pairCode.trim()) { Alert.alert('Pair Code required', 'Enter a Pair Code or partner email.'); return false; }
    setActionLoading(true);
    try { await saveUser((await request('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ userId: user.id, pairCode }) })).user); return true; } catch (error) { Alert.alert('Could not pair', error.message); return false; } finally { setActionLoading(false); }
  };
  const unpair = () => Alert.alert('Unpair this space?', 'Your profiles stay saved, and this room history remains stored.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: async () => {
    setActionLoading(true);
    try { await saveUser((await request('/api/pair', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ userId: user.id }) })).user); } catch (error) { Alert.alert('Could not unpair', error.message); } finally { setActionLoading(false); }
  } }]);
  const requestUnpair = () => { setSettingsVisible(false); socketRef.current?.emit('unpair:request'); Alert.alert('Request sent', 'Your partner must accept the unpair request.'); };
  const saveSettings = async ({ name, bio, profilePicture, partnerName, background }) => {
    setActionLoading(true);
    try {
      const result = await request('/api/users/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ name, bio, profilePicture }) });
      const nextUser = { ...result.user, partnerName: partnerName.trim() || result.user.partnerName };
      await AsyncStorage.setItem(`our-space-partner-name:${result.user.id}`, partnerName.trim());
      await AsyncStorage.setItem(`our-space-background:${result.user.id}`, background);
      await saveUser({ ...nextUser, entryBackground: background });
      setSettingsVisible(false);
    } catch (error) { Alert.alert('Could not save settings', error.message); } finally { setActionLoading(false); }
  };
  const signOut = async () => { socketRef.current?.disconnect(); await AsyncStorage.removeItem(USER_STORAGE_KEY); await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY); setSessionToken(null); setOnboardingUser(null); setUser(null); };

  if (loading) return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;
  if (!user && onboardingUser) return <ProfileOnboarding initialUser={onboardingUser} onSubmit={saveProfile} loading={actionLoading} />;
  if (!user) return <AuthScreen onAuthenticated={authenticateWithGoogle} loading={actionLoading} />;
  if (!user.roomId) return <PairingScreen user={user} onPair={pairUsers} onPairSuccess={handlePairSuccess} onSignOut={signOut} loading={actionLoading} />;
  if (!hasEnteredSpace) return <><CozyEntryScreen user={user} onEnter={() => setHasEnteredSpace(true)} onSettings={() => setSettingsVisible(true)} /><SettingsModal visible={settingsVisible} user={user} onClose={() => setSettingsVisible(false)} onSave={saveSettings} onSignOut={signOut} onRequestUnpair={requestUnpair} /></>;
  return socket ? <><ChatScreen user={user} socket={socket} onSignOut={signOut} onUnpair={unpair} onBack={() => setHasEnteredSpace(false)} /><SettingsModal visible={settingsVisible} user={user} onClose={() => setSettingsVisible(false)} onSave={saveSettings} onSignOut={signOut} onRequestUnpair={requestUnpair} /></> : <SafeAreaView style={styles.loading}><ActivityIndicator color={COLORS.accent} /></SafeAreaView>;
}

const COLORS = { background: '#0A0B1A', panel: 'rgba(30, 25, 55, 0.45)', panelLight: '#241d43', text: '#f8f3ff', muted: '#a49ab8', accent: '#E056FD', accentDark: '#180c27', border: 'rgba(224, 86, 253, 0.3)', mine: '#402052', theirs: '#1e1937', danger: '#ff9bbd' };

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
  entryScreen: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  entryBackgroundImage: { opacity: 0.55 },
  entryBrand: { color: COLORS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 3, marginBottom: 64 },
  entryEyebrow: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 2, marginBottom: 28 },
  entryPortal: { alignItems: 'center', height: 260, justifyContent: 'center', width: 260 },
  entryGlow: { backgroundColor: 'rgba(224, 86, 253, 0.16)', borderRadius: 120, height: 220, position: 'absolute', width: 220 },
  entryRingOuter: { alignItems: 'center', borderColor: 'rgba(199, 66, 255, 0.85)', borderRadius: 110, borderWidth: 2, height: 220, justifyContent: 'center', shadowColor: '#E056FD', shadowOpacity: 0.8, shadowRadius: 28, width: 220 },
  entryRingInner: { alignItems: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.accent, borderRadius: 88, borderWidth: 1, height: 176, justifyContent: 'center', overflow: 'hidden', width: 176 },
  entryAvatar: { height: 176, width: 176 },
  entryAvatarFallback: { color: COLORS.accent, fontSize: 68, fontWeight: '800' },
  entryName: { color: COLORS.text, fontSize: 30, fontWeight: '800', marginTop: 30 },
  entryStatus: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  entryStatusDot: { backgroundColor: '#77f0b1', borderRadius: 5, height: 9, marginRight: 8, width: 9 },
  entryStatusText: { color: '#77f0b1', fontSize: 13, fontWeight: '700' },
  entryPrompt: { color: COLORS.muted, fontSize: 14, letterSpacing: 0.4, marginTop: 52 },
  settingsButton: { alignItems: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 22, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  backButton: { paddingHorizontal: 4, paddingVertical: 3 },
  backArrow: { color: COLORS.muted, fontSize: 28, fontWeight: '300', lineHeight: 30 },
  entrySettingsButton: { position: 'absolute', right: 24, top: 22 },
  settingsIcon: { color: COLORS.accent, fontSize: 22 },
  settingsBackdrop: { backgroundColor: 'rgba(4, 3, 15, 0.62)', flex: 1, justifyContent: 'flex-end' },
  settingsSheet: { backgroundColor: '#1e1937', borderColor: COLORS.border, borderRadius: 24, borderWidth: 1, maxHeight: '88%', padding: 22 },
  settingsHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  settingsTitle: { color: COLORS.text, fontSize: 25, fontWeight: '800' },
  closeButton: { color: COLORS.muted, fontSize: 30, lineHeight: 30 },
  settingsLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '800', marginBottom: 7, marginTop: 14, textTransform: 'uppercase' },
  settingsPicture: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, padding: 14 },
  settingsActionText: { color: COLORS.accent, fontSize: 14, fontWeight: '700' },
  settingsDanger: { marginTop: 24, paddingVertical: 12 },
  settingsDangerText: { color: COLORS.danger, fontSize: 14, fontWeight: '700' },
  settingsSignOut: { paddingVertical: 8 },
  auraRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  auraSwatch: { borderColor: COLORS.border, borderRadius: 22, borderWidth: 1, height: 44, width: 44 },
  auraSelected: { borderColor: COLORS.accent, borderWidth: 3, shadowColor: COLORS.accent, shadowOpacity: 0.8, shadowRadius: 8 },
  chatPresence: { color: '#77f0b1', fontSize: 12, fontWeight: '700', marginTop: 6 },
  chatKeyboard: { flex: 1 },
  chatHeader: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 9 },
  chatHeaderLeft: { alignItems: 'center', flexDirection: 'row', flex: 1, minWidth: 0 },
  chatHeaderIdentity: { flex: 1, minWidth: 0 },
  miniAvatar: { alignItems: 'center', backgroundColor: COLORS.panelLight, borderColor: COLORS.border, borderRadius: 19, borderWidth: 1, height: 38, justifyContent: 'center', marginLeft: 4, marginRight: 10, overflow: 'hidden', width: 38 },
  miniAvatarImage: { height: 38, width: 38 },
  miniAvatarFallback: { color: COLORS.accent, fontSize: 16, fontWeight: '800' },
  chatHeaderActions: { alignItems: 'center', flexDirection: 'row', gap: 2, marginLeft: 8 },
  headerIconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 36 },
  headerActionIcon: { color: COLORS.text, fontSize: 20 },
  searchBar: { alignItems: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', marginBottom: 10, paddingHorizontal: 10 },
  searchInput: { color: COLORS.text, flex: 1, fontSize: 15, paddingHorizontal: 4, paddingVertical: 10 },
  searchHighlight: { backgroundColor: 'rgba(224, 86, 253, 0.35)', borderRadius: 3, color: COLORS.text },
  chatActionSheet: { backgroundColor: '#1e1937', borderColor: COLORS.border, borderRadius: 14, padding: 6, position: 'absolute', right: 12, top: 52, width: 220, zIndex: 3 },
  chatAction: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 12 },
  chatActionText: { color: COLORS.text, fontSize: 14 },
  profilePreviewWrap: { alignItems: 'center', alignSelf: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 60, borderWidth: 1, height: 120, justifyContent: 'center', marginBottom: 24, overflow: 'hidden', width: 120 },
  profilePreview: { height: 120, width: 120 }, profilePlaceholder: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, genderOption: { borderColor: COLORS.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 10 }, genderSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent }, genderText: { color: COLORS.text, fontSize: 13 }, bioInput: { minHeight: 90, textAlignVertical: 'top' },
  header: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 }, headerActions: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  brand: { color: COLORS.text, fontSize: 14, fontWeight: '800', letterSpacing: 1.5 }, privateLabel: { color: COLORS.muted, fontSize: 10, letterSpacing: 1.2, marginTop: 4 }, signOut: { color: COLORS.accent, fontSize: 14, fontWeight: '700' }, unpair: { color: COLORS.danger, fontSize: 14, fontWeight: '700' },
  pairingScreen: { flex: 1, padding: 24 }, pairingContent: { paddingBottom: 10 }, tabs: { backgroundColor: COLORS.panel, borderRadius: 12, flexDirection: 'row', marginBottom: 22, padding: 4 }, tab: { alignItems: 'center', borderRadius: 9, flex: 1, paddingVertical: 12 }, activeTab: { backgroundColor: COLORS.accent }, tabText: { color: COLORS.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }, activeTabText: { color: COLORS.accentDark }, eyebrow: { color: COLORS.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }, screenTitle: { color: COLORS.text, fontSize: 32, fontWeight: '800', marginBottom: 10 }, intro: { color: COLORS.muted, fontSize: 16, lineHeight: 24 },
  codeBlock: { alignItems: 'center', marginVertical: 28 }, code: { color: COLORS.text, fontSize: 36, fontWeight: '800', letterSpacing: 7 }, muted: { color: COLORS.muted, fontSize: 13, marginTop: 8 }, qrPanel: { alignItems: 'center', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, padding: 20 }, qrCode: { backgroundColor: '#fff', height: 200, width: 200 }, qrCaption: { color: COLORS.muted, fontSize: 13, marginTop: 14 }, pairForm: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, gap: 10, marginTop: 18, padding: 18 }, scannerPanel: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 360, overflow: 'hidden' }, permissionPanel: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 }, permissionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', textAlign: 'center' }, permissionText: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 18, marginTop: 10, textAlign: 'center' }, cameraWrap: { flex: 1, minHeight: 360 }, camera: { flex: 1 }, scanOverlay: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }, scanFrame: { borderColor: COLORS.accent, borderRadius: 18, borderWidth: 3, height: 230, width: 230 }, scanHint: { backgroundColor: 'rgba(7, 17, 31, 0.8)', borderRadius: 8, color: COLORS.text, fontSize: 13, marginTop: 24, paddingHorizontal: 12, paddingVertical: 8 },
  chatScreen: { flex: 1, paddingHorizontal: 14 }, chatHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 18 }, partnerName: { color: COLORS.text, fontSize: 24, fontWeight: '800' }, status: { alignItems: 'center', backgroundColor: COLORS.panel, borderRadius: 20, flexDirection: 'row', paddingHorizontal: 11, paddingVertical: 8 }, statusDot: { backgroundColor: COLORS.accent, borderRadius: 5, height: 9, marginRight: 7, width: 9 }, awayDot: { backgroundColor: COLORS.muted }, statusText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' }, typing: { color: COLORS.accent, fontSize: 12, paddingHorizontal: 6, paddingBottom: 8 }, messages: { gap: 12, paddingBottom: 12, paddingHorizontal: 2 },
  messageRow: { alignItems: 'flex-start' }, messageRowMine: { alignItems: 'flex-end' }, messageBubble: { borderRadius: 16, maxWidth: '84%', padding: 12 }, mineBubble: { backgroundColor: COLORS.mine, borderBottomRightRadius: 4 }, theirBubble: { backgroundColor: COLORS.theirs, borderBottomLeftRadius: 4 }, messageText: { color: COLORS.text, fontSize: 16, lineHeight: 22 }, messageTime: { color: '#b3c7c2', fontSize: 10, marginTop: 7, textAlign: 'right' }, messageImage: { borderRadius: 10, height: 190, marginBottom: 6, width: 220 }, reactionBar: { flexDirection: 'row', gap: 3, marginTop: 4 }, reactionBarMine: { alignSelf: 'flex-end' }, reactionButton: { backgroundColor: COLORS.panel, borderRadius: 14, paddingHorizontal: 6, paddingVertical: 3 }, reactions: { flexDirection: 'row', gap: 4, marginTop: 3 }, reactionsMine: { justifyContent: 'flex-end' }, reactionPill: { backgroundColor: COLORS.panelLight, borderRadius: 10, color: COLORS.text, fontSize: 11, paddingHorizontal: 6, paddingVertical: 3 },
  voiceMessage: { alignItems: 'center', flexDirection: 'row', gap: 9, minWidth: 220 }, voicePlayButton: { alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, voicePlayIcon: { color: COLORS.accentDark, fontSize: 14 }, voiceTrack: { backgroundColor: 'rgba(224, 86, 253, 0.2)', borderRadius: 4, flex: 1, height: 6, overflow: 'hidden' }, voiceProgress: { backgroundColor: COLORS.accent, borderRadius: 4, height: 6 }, voiceDuration: { color: COLORS.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  composer: { alignItems: 'flex-end', backgroundColor: COLORS.panel, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 10, padding: 7 }, addButton: { alignItems: 'center', backgroundColor: COLORS.panelLight, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, addText: { color: COLORS.accent, fontSize: 24, fontWeight: '300', lineHeight: 26 }, messageInput: { color: COLORS.text, flex: 1, fontSize: 16, maxHeight: 100, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8 }, sendButton: { alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 }, sendText: { color: COLORS.accentDark, fontSize: 19, fontWeight: '800' }, attachmentMenu: { alignSelf: 'flex-start', backgroundColor: COLORS.panelLight, borderColor: COLORS.border, borderRadius: 12, borderWidth: 1, bottom: 62, paddingVertical: 5, position: 'absolute', zIndex: 2 }, menuItem: { color: COLORS.text, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 }, previewWrap: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingBottom: 8 }, preview: { borderRadius: 8, height: 58, width: 58 }, removePreview: { color: COLORS.danger, fontSize: 13 },
  micButton: { alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, micIcon: { fontSize: 20 }, recordingStatus: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, minHeight: 36, paddingHorizontal: 12 }, recordingWave: { color: COLORS.accent, fontSize: 18, letterSpacing: 2 }, recordingTimer: { color: COLORS.text, fontSize: 14, fontVariant: ['tabular-nums'] }, stopRecordingButton: { backgroundColor: COLORS.danger },
});