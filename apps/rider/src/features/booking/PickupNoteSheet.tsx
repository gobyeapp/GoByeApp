import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Sheet, Text, TextField, spacing } from '@gobye/ui';

const MAX = 120;

/**
 * Pickup note (brief 2026-10-21 §7): short landmark or gate instructions for the driver.
 * Closing with unsaved text asks before discarding it (§16).
 */
export function PickupNoteSheet({ visible, value, onSave, onClose }: { visible: boolean; value: string; onSave: (note: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (visible) {
      setText(value);
      setConfirming(false);
    }
  }, [visible, value]);

  const dirty = text.trim() !== value.trim();
  const requestClose = () => (dirty ? setConfirming(true) : onClose());

  return (
    <Sheet
      visible={visible}
      onClose={requestClose}
      title="Pickup note"
      subtitle="A gate, landmark or entrance."
      testID="pickup-note-sheet"
      footer={
        confirming ? (
          <View style={styles.confirm}>
            <Text variant="callout" weight="semibold">
              Discard note?
            </Text>
            <View style={styles.row}>
              <Button title="Keep editing" variant="secondary" size="md" style={styles.flex} onPress={() => setConfirming(false)} />
              <Button title="Discard" variant="destructive" size="md" style={styles.flex} onPress={onClose} />
            </View>
          </View>
        ) : (
          <Button
            title="Save note"
            onPress={() => {
              onSave(text.trim());
              onClose();
            }}
            disabled={!dirty}
            testID="save-pickup-note"
          />
        )
      }
    >
      <TextField
        label="Note for your driver"
        placeholder="Gate 2, opposite the pharmacy"
        value={text}
        onChangeText={(t) => setText(t.slice(0, MAX))}
        helper={`${text.length}/${MAX}`}
        autoFocus
        returnKeyType="done"
        testID="pickup-note-input"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  confirm: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
