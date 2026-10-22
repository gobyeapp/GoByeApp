import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Icon, PageHeader, Screen, Text, layout, spacing, useTheme } from '@gobye/ui';
import { SimNote } from '@/features/common/SimNote';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useSession } from '@/state/session';

/**
 * Delete account (App Review 5.1.1(v)). Confirmation step with consequences; nothing happens on the first
 * tap. Blocked during a trip. The preview clears this device; the backend performs the real deletion and
 * keeps records the law requires (docs/SECURITY_PRIVACY.md).
 */
export default function DeleteAccount() {
  const { colors } = useTheme();
  const d = useDriver();
  const { deleteLocalData } = useSession();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const onTrip = !!d.activeTrip;

  const remove = async () => {
    setBusy(true);
    d.goOffline();
    d.resetPreview();
    await new Promise((r) => setTimeout(r, 1000));
    await deleteLocalData();
    resetTo('/welcome');
  };

  return (
    <Screen
      header={<PageHeader title="Delete account" onBack={() => router.back()} />}
      footer={
        <>
          <Button title="Delete my account" variant="destructive" disabled={!checked || onTrip} loading={busy} loadingLabel="Deleting" onPress={remove} />
          <Button title="Cancel" variant="tertiary" onPress={() => router.back()} />
        </>
      }
    >
      <View style={styles.body}>
        <View style={[styles.tile, { backgroundColor: colors.dangerSurface }]}>
          <Icon name="delete" size="lg" color="danger" />
        </View>
        <Text variant="title2">This can’t be undone</Text>
        {[
          'Your driver profile, documents and vehicle are removed.',
          'Any time left on your access pass is lost.',
          'Trip and payment records we must keep by law are retained, then deleted.',
        ].map((t) => (
          <View key={t} style={styles.point}>
            <Icon name="minusCircle" size="xs" color="textSecondary" />
            <Text variant="callout" color="textSecondary" style={styles.flex}>
              {t}
            </Text>
          </View>
        ))}
        {onTrip ? (
          <Text variant="callout" color="danger">
            Finish your current trip first.
          </Text>
        ) : (
          <Checkbox label="I understand my account will be deleted" checked={checked} onChange={setChecked} />
        )}
        <SimNote>The deletion request is simulated. This device is cleared.</SimNote>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: spacing.md, paddingTop: spacing.lg },
  tile: { width: 64, height: 64, borderRadius: layout.cardRadius, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  point: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
