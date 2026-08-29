/**
 * In-trip chat. History comes from the persisted ChatMessage list so a reconnect
 * doesn't blank the thread; live messages arrive over the socket (docs/DESIGN.md §9.2).
 */
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { Socket } from 'socket.io-client';
import type { ChatMessageDTO } from '@kisanpool/shared';
import { api } from '../lib/api';
import { colors, layout, radius, space, type } from '../theme';
import { Txt } from './ui';

interface Message {
  _id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export function ChatSheet({
  visible,
  onClose,
  tripId,
  myUserId,
  socket,
  otherPartyName,
}: {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  myUserId: string;
  socket: Socket | null;
  otherPartyName: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (!visible) return;
    void api
      .messages(tripId)
      .then((history: ChatMessageDTO[]) =>
        setMessages(
          history.map((m) => ({
            _id: m._id,
            senderId: m.senderId,
            text: m.text,
            createdAt: m.createdAt,
          })),
        ),
      )
      .catch(() => setMessages([]));
  }, [visible, tripId]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (payload: { senderId: string; text: string; ts: string }) => {
      setMessages((prev) => [
        ...prev,
        { _id: `${payload.ts}-${payload.senderId}`, ...payload, createdAt: payload.ts },
      ]);
    };
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:message', onMessage);
    };
  }, [socket]);

  const send = (): void => {
    const text = draft.trim();
    if (!text || !socket) return;
    socket.emit('chat:send', { tripId, text });
    setDraft('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.sheet}
        >
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>

          <View style={s.header}>
            <Txt variant="headlineMd">{otherPartyName}</Txt>
            <Pressable onPress={onClose} hitSlop={12}>
              <MaterialIcons name="close" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{ padding: layout.edgeMargin, gap: space.sm }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
              const mine = item.senderId === myUserId;
              return (
                <View
                  style={[
                    s.bubble,
                    {
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      backgroundColor: mine ? colors.primaryContainer : colors.surfaceContainer,
                    },
                  ]}
                >
                  <Txt variant="bodyMd" color={mine ? colors.onPrimary : colors.onSurface}>
                    {item.text}
                  </Txt>
                </View>
              );
            }}
            ListEmptyComponent={
              <Txt
                variant="bodyMd"
                color={colors.onSurfaceVariant}
                style={{ textAlign: 'center', paddingVertical: space.xl }}
              >
                Say hello — messages appear here.
              </Txt>
            }
          />

          <View style={s.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              placeholderTextColor={colors.outline}
              style={s.input}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable onPress={send} style={s.send} disabled={!draft.trim()}>
              <MaterialIcons name="send" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(25,28,27,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl, // 24px — sheet tier
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    minHeight: '55%',
  },
  handleRow: { alignItems: 'center', paddingTop: space.sm },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.outlineVariant,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: layout.edgeMargin,
  },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, padding: space.gutter },
  composer: {
    flexDirection: 'row',
    gap: space.sm,
    padding: layout.edgeMargin,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  input: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: space.gutter,
    fontFamily: type.bodyLg.fontFamily,
    fontSize: 16,
    color: colors.onSurface,
  },
  send: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radius.base,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
