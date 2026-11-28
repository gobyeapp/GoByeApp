import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '../../icons/Icon';
import { useTheme } from '../../theme/useTheme';
import { fontFamily, inputFontSize, layout, spacing } from '../../theme/tokens';
import { Sheet } from '../patterns';
import { Text } from '../Text';

export interface ChatBubble {
  id: string;
  mine: boolean;
  text: string;
  at: number;
}

/**
 * A short conversation between a rider and their driver (D-108): the messages, one-tap replies for what
 * people usually need to say at pickup, and a box to type anything else. Used by both apps; the apps
 * supply the messages and the send action.
 */
export function ChatSheet({
  visible,
  onClose,
  title,
  messages,
  quickReplies,
  onSend,
  note,
  maxLength = 300,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  messages: ChatBubble[];
  quickReplies: readonly string[];
  /** Resolves with an error message when the text could not be sent. */
  onSend: (text: string) => Promise<string | null>;
  /** One quiet line under the title, e.g. why there are no phone numbers. */
  note?: string;
  maxLength?: number;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [visible, messages.length]);

  const send = async (text: string) => {
    if (sending || !text.trim()) return;
    setSending(true);
    setError(null);
    const failed = await onSend(text);
    setSending(false);
    if (failed) return setError(failed);
    setDraft('');
  };
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={note} testID="chat-sheet">
      <ScrollView ref={list} style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {messages.length === 0 ? (
          <Text variant="footnote" color="textSecondary" align="center" style={styles.empty}>
            No messages yet. Tap a quick message or type your own.
          </Text>
        ) : (
          messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.mine ? styles.mine : styles.theirs, { backgroundColor: m.mine ? colors.primary : colors.secondary }]} accessible accessibilityLabel={`${m.mine ? 'You' : title}: ${m.text}, ${time(m.at)}`}>
              <Text variant="callout" style={{ color: m.mine ? colors.onPrimary : colors.text }}>
                {m.text}
              </Text>
              <Text variant="caption" style={{ color: m.mine ? colors.onPrimary : colors.textSecondary, opacity: 0.7 }}>
                {time(m.at)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.quick}>
        {quickReplies.map((q) => (
          <Pressable key={q} onPress={() => void send(q)} disabled={sending} accessibilityRole="button" accessibilityLabel={`Send: ${q}`} style={({ pressed }) => [styles.chip, { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.surfaceSelected : colors.surface }]}>
            <Text variant="footnote" weight="medium">
              {q}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text variant="footnote" color="danger" accessibilityLiveRegion="polite" testID="chat-error">
          {error}
        </Text>
      ) : null}

      <View style={[styles.inputRow, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message"
          placeholderTextColor={colors.textSecondary}
          maxLength={maxLength}
          returnKeyType="send"
          onSubmitEditing={() => void send(draft)}
          accessibilityLabel="Message"
          testID="chat-input"
          style={[styles.input, { color: colors.text }]}
        />
        <Pressable onPress={() => void send(draft)} disabled={sending || !draft.trim()} accessibilityRole="button" accessibilityLabel="Send message" testID="chat-send" style={[styles.send, { backgroundColor: draft.trim() ? colors.primary : colors.secondary }]}>
          <Icon name="arrowRight" size={18} color={draft.trim() ? 'onPrimary' : 'textSecondary'} />
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 260, minHeight: 96 },
  listContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  empty: { paddingVertical: spacing.lg },
  bubble: { maxWidth: '82%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 16, gap: 2 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: layout.cardRadius, paddingLeft: spacing.md, paddingRight: spacing.xs, minHeight: 52 },
  input: { flex: 1, fontFamily: fontFamily.regular, fontSize: inputFontSize, paddingVertical: spacing.sm },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
