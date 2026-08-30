/**
 * Servo AI — the voice round trip from docs/DESIGN.md §9.3:
 *   record -> /ai/stt -> /ai/chat -> /ai/tts -> navigate
 *
 * Every state has a visual, not just audio. The transcript is shown so a
 * mis-transcription is visible, a pending confirmation is shown as text so a
 * farmer in a noisy field can read what they are agreeing to, and the flow always
 * stops at the checkout handoff — it never pays (ADR-014).
 */
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';
import type { AiChatResponse, Language } from '@kisanpool/shared';
import { api } from '../lib/api';
import { toAppError } from '../lib/errors';
import { colors, elevation, layout, radius, space } from '../theme';
import { Button, Txt } from './ui';

type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Tap to speak',
  listening: 'Listening…',
  transcribing: 'Understanding…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Something went wrong',
};

export function VoiceAssistantButton({ language = 'en' }: { language?: Language }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState<AiChatResponse['pendingConfirmation']>();

  const recording = useRef<Audio.Recording | null>(null);
  const sound = useRef<Audio.Sound | null>(null);
  const sessionId = useRef(`voice_${Date.now()}`);

  const startRecording = async (): Promise<void> => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setState('error');
        setReply('I need microphone permission to listen.');
        return;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording.current = rec;
      setState('listening');
      setTranscript('');
      setReply('');
    } catch (err) {
      setState('error');
      setReply(toAppError(err).message);
    }
  };

  const stopAndSend = async (): Promise<void> => {
    try {
      const rec = recording.current;
      if (!rec) return;

      setState('transcribing');
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recording.current = null;
      if (!uri) throw new Error('no audio');

      const stt = await api.stt({ uri, name: 'speech.m4a', type: 'audio/m4a' });
      setTranscript(stt.transcript);
      if (!stt.transcript.trim()) {
        setState('idle');
        setReply('I did not catch that. Please try again.');
        return;
      }

      await send(stt.transcript, stt.language);
    } catch (err) {
      setState('error');
      setReply(toAppError(err).message);
    }
  };

  const send = async (message: string, lang: Language): Promise<void> => {
    setState('thinking');
    const answer = await api.aiChat(message, sessionId.current, lang);

    setReply(answer.reply);
    setPending(answer.pendingConfirmation);

    // speak the reply — a failure here is not fatal, the text is already on screen
    try {
      setState('speaking');
      const { audio } = await api.tts(answer.reply, answer.language);
      const { sound: playback } = await Audio.Sound.createAsync({
        uri: `data:audio/wav;base64,${audio}`,
      });
      sound.current = playback;
      await playback.playAsync();
    } catch {
      // silent — the reply is displayed
    }

    setState('idle');

    // the assistant navigates; the destination screen owns the action
    if (answer.action?.type === 'NAVIGATE') {
      setOpen(false);
      router.push(answer.action.route as never);
    }
  };

  const confirm = async (answer: 'yes' | 'no'): Promise<void> => {
    setPending(undefined);
    try {
      await send(answer, language);
    } catch (err) {
      setState('error');
      setReply(toAppError(err).message);
    }
  };

  const close = (): void => {
    void recording.current?.stopAndUnloadAsync().catch(() => undefined);
    void sound.current?.unloadAsync().catch(() => undefined);
    recording.current = null;
    setOpen(false);
    setState('idle');
    setTranscript('');
    setReply('');
    setPending(undefined);
  };

  return (
    <>
      <Pressable
        style={s.fab}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open Servo AI voice assistant"
      >
        <MaterialIcons name="mic" size={28} color={colors.onPrimary} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.headerRow}>
              <View>
                <Txt variant="headlineMd">Servo AI</Txt>
                <Txt variant="bilingualSubtext" color={colors.onSurfaceVariant}>
                  Speak in your own language
                </Txt>
              </View>
              <Pressable
                onPress={close}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close voice assistant"
              >
                <MaterialIcons name="close" size={24} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {transcript ? (
              <View style={s.transcript}>
                <Txt variant="labelSm" color={colors.onSurfaceVariant}>
                  You said
                </Txt>
                <Txt variant="bodyLg">{transcript}</Txt>
              </View>
            ) : null}

            {reply ? (
              <View style={s.reply}>
                <Txt variant="bodyLg" color={colors.onSurface}>
                  {reply}
                </Txt>
              </View>
            ) : null}

            {/* a state-changing action, shown as text before it happens */}
            {pending ? (
              <View style={s.confirmRow}>
                <Button label="Yes, go ahead" onPress={() => void confirm('yes')} icon="check" />
                <Button
                  label="No"
                  variant="secondary"
                  icon={null}
                  onPress={() => void confirm('no')}
                />
              </View>
            ) : (
              <View style={s.micWrap}>
                <Pressable
                  style={[
                    s.mic,
                    state === 'listening' ? { backgroundColor: colors.error } : null,
                  ]}
                  onPress={() =>
                    state === 'listening' ? void stopAndSend() : void startRecording()
                  }
                  disabled={state === 'transcribing' || state === 'thinking'}
                  accessibilityRole="button"
                  accessibilityLabel={
                    state === 'listening' ? 'Stop recording and process audio' : 'Start voice input'
                  }
                  accessibilityState={{
                    disabled: state === 'transcribing' || state === 'thinking',
                    busy: state === 'transcribing' || state === 'thinking',
                  }}
                >
                  <MaterialIcons
                    name={state === 'listening' ? 'stop' : 'mic'}
                    size={36}
                    color={colors.onPrimary}
                  />
                </Pressable>
                <Txt
                  variant="labelLg"
                  color={state === 'error' ? colors.error : colors.onSurfaceVariant}
                  style={{ marginTop: space.sm }}
                >
                  {STATE_LABEL[state]}
                </Txt>
              </View>
            )}

            <Txt variant="labelSm" color={colors.onSurfaceVariant} style={s.disclaimer}>
              Servo AI never takes payment — it hands you to the payment screen.
            </Txt>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: layout.edgeMargin,
    // clears <BottomNav />, which floats over the same corner (Stitch: bottom-20 right-4)
    bottom: layout.fabOffset,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.level2,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(25,28,27,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: layout.edgeMargin,
    paddingBottom: space.xl,
    gap: space.md,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  transcript: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
  },
  reply: {
    backgroundColor: colors.secondaryContainer,
    borderRadius: radius.lg,
    padding: space.gutter,
  },
  micWrap: { alignItems: 'center', paddingVertical: space.md },
  mic: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.level2,
  },
  confirmRow: { gap: space.sm },
  disclaimer: { textAlign: 'center' },
});
