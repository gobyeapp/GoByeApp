import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Sheet, Text, layout, useTheme, type IconName } from '@gobye/ui';

/**
 * In-trip Help (brief §8): emergency (112), safety centre, report an issue, and — once on board —
 * ask the driver to end the trip here. There is no generic Cancel after the trip starts.
 */
export function HelpSheet({
  visible,
  onClose,
  inProgress,
  fareText,
  onSafety,
  onSafetyCentre,
  onReport,
  onEndHere,
}: {
  visible: boolean;
  onClose: () => void;
  inProgress: boolean;
  fareText: string;
  onSafety: () => void;
  onSafetyCentre: () => void;
  onReport: () => void;
  onEndHere: () => void;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const close = () => {
    setConfirmEnd(false);
    onClose();
  };

  if (confirmEnd) {
    return (
      <Sheet
        visible={visible}
        onClose={close}
        title="End the trip here?"
        subtitle="Your driver stops where it’s safe."
        footer={
          <>
            <Button
              title="End trip here"
              onPress={() => {
                setConfirmEnd(false);
                onEndHere();
              }}
              testID="confirm-end-here"
            />
            <Button title="Keep riding" variant="tertiary" onPress={() => setConfirmEnd(false)} />
          </>
        }
      >
        <Text variant="body">
          Your fare stays {fareText}.
        </Text>
        <Text variant="footnote" color="textSecondary">
          Simulated. No real driver is contacted.
        </Text>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} title="Help" testID="help-sheet">
      <HelpRow icon="sos" title="Emergency: call 112" body="Police, fire and ambulance" danger onPress={onSafety} />
      <HelpRow icon="shield" title="Safety centre" body="Trusted contact and tips" onPress={onSafetyCentre} />
      <HelpRow icon="support" title="Report an issue" body="Driver, vehicle, route or fare" onPress={onReport} />
      {inProgress ? <HelpRow icon="flag" title="End trip here" body="Stop early at a safe place" onPress={() => setConfirmEnd(true)} testID="end-here" /> : null}
    </Sheet>
  );
}

function HelpRow({ icon, title, body, danger, onPress, testID }: { icon: IconName; title: string; body: string; danger?: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceSelected : colors.surfaceMuted }]}
    >
      <View style={[styles.iconBox, { backgroundColor: danger ? colors.dangerSurface : colors.surface }]}>
        <Icon name={icon} variant="filled" size="sm" color={danger ? 'danger' : 'primary'} />
      </View>
      <View style={styles.flex}>
        <Text variant="headline" color={danger ? 'danger' : 'text'}>
          {title}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {body}
        </Text>
      </View>
      <Icon name="chevronRight" size="sm" color="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 64, paddingHorizontal: layout.container, borderRadius: layout.cardRadius },
  iconBox: { width: layout.iconBox, height: layout.iconBox, borderRadius: layout.iconBox / 2, alignItems: 'center', justifyContent: 'center' },
});
