import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPhone, summariseEarnings } from '@gobye/core';
import { Avatar, ConnectionPill, Icon, SettingsGroup, SettingsRow, Text, VehicleSummary, layout, spacing, useTheme } from '@gobye/ui';
import { confirmAction } from '@/features/common/confirm';
import { passName } from '@/features/common/format';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useRelayStatus } from '@/state/relay';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

const APPEARANCE_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

/**
 * D17 Account. Identity (selfie, name, rating), the vehicle riders look for, then grouped settings in
 * the same nested-group style as the rider app (shared SettingsGroup / SettingsRow). Delete account sits
 * apart at the bottom.
 */
export default function Account() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const d = useDriver();
  const { phone, signOut } = useSession();
  const { settings, updateSettings } = useSettings();
  const p = d.application.personal;
  const name = p ? `${p.firstName} ${p.lastName}` : 'Driver';
  const done = summariseEarnings(d.history, 0).trips;
  const relay = useRelayStatus();

  const logOut = () =>
    confirmAction({
      title: 'Log out?',
      message: d.location.activity !== 'offline' ? 'You’ll go offline and sign in again with your phone number.' : 'You’ll sign in again with your phone number.',
      confirm: 'Log out',
      destructive: true,
      onConfirm: () => {
        const off = d.goOffline();
        if (!off.ok) return Alert.alert('Finish your trip first');
        void signOut().then(() => resetTo('/welcome'));
      },
    });

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="title2" accessibilityRole="header" style={styles.title}>
        Account
      </Text>

      <View style={styles.identity}>
        <Avatar uri={d.application.identity?.selfieUri} name={name} size={76} />
        <View style={styles.center}>
          <Text variant="headline">{name}</Text>
          <View style={styles.pill}>
            <ConnectionPill state={relay.state} host={relay.host} testID="account-relay" />
          </View>
          <View style={styles.inline}>
            <Icon name="star" variant="filled" size="xs" color="accent" />
            <Text variant="footnote" color="textSecondary">
              {done >= 5 ? '4.92' : 'New driver'} · {done} trips{phone ? ` · ${formatPhone(phone)}` : ''}
            </Text>
          </View>
        </View>
      </View>

      {d.application.vehicle ? (
        <View style={[styles.vehicle, { backgroundColor: colors.surfaceMuted }]}>
          <VehicleSummary vehicle={d.application.vehicle} size="sm" />
        </View>
      ) : null}

      <SettingsGroup title="Driving">
 {d.verification !== 'approved' ? <SettingsRow icon="shield" title="Verification" value={d.verification === 'changes_requested' ? 'Needs a fix' : d.verification === 'pending_review' ? 'In review' : d.verification === 'rejected' ? 'Not approved' : 'Registering'} onPress={() => router.push('/onboarding/status')} testID="row-verification" /> : null}
        <SettingsRow icon="certificate" title="Documents" subtitle="Licence, ID and vehicle papers" onPress={() => router.push('/account/documents')} testID="row-documents" />
        <SettingsRow icon="ticket" title="Access pass" value={d.hasAccess ? passName(d.subscription) : 'None'} onPress={() => router.push('/access')} />
        <SettingsRow icon="bank" title="Payout account" value={d.payout ? d.payout.bankName : 'Add'} onPress={() => router.push('/account/payout')} testID="row-payout" />
      </SettingsGroup>

      <SettingsGroup title="Requests">
        <SettingsRow icon="chat" title="Negotiation requests" subtitle="Riders who offer their own fare" trailing="switch" switchValue={settings.negotiationRequests} onSwitch={(v) => updateSettings({ negotiationRequests: v })} />
        <SettingsRow icon="notification" title="Request alerts" trailing="switch" switchValue={settings.requestAlerts} onSwitch={(v) => updateSettings({ requestAlerts: v })} />
        <SettingsRow icon="locate" title="Location access" onPress={() => router.push('/permission-location')} />
      </SettingsGroup>

      <SettingsGroup title="App">
        <SettingsRow icon="settings" title="Appearance" value={APPEARANCE_LABEL[settings.appearance]} onPress={() => router.push('/account/appearance')} />
        <SettingsRow icon="phone" title="Haptic feedback" trailing="switch" switchValue={settings.haptics} onSwitch={(v) => updateSettings({ haptics: v })} />
        <SettingsRow icon="support" title="Help and safety" onPress={() => router.push('/account/support')} />
        <SettingsRow icon="signOut" title="Log out" onPress={logOut} testID="sign-out" />
      </SettingsGroup>

      <SettingsGroup title="Preview" footer="Clears your application, pass and trips on this device so you can try sign up again.">
        <SettingsRow
          icon="refresh"
          title="Start the preview again"
          onPress={() =>
            confirmAction({
              title: 'Start again?',
              message: 'Your application, pass and trips on this device will be cleared.',
              confirm: 'Start again',
              destructive: true,
              onConfirm: () => {
                d.resetPreview();
                resetTo('/onboarding');
              },
            })
          }
        />
      </SettingsGroup>

      <View style={[styles.danger, { borderTopColor: colors.border }]}>
        <SettingsRow icon="delete" title="Delete account" destructive trailing="none" onPress={() => router.push('/account/delete')} />
      </View>
      <Text variant="caption" color="textSecondary" align="center">
        GoBye Driver preview 0.1.0
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.lg },
  title: { paddingTop: spacing.xs },
  identity: { alignItems: 'center', gap: spacing.md },
  center: { alignItems: 'center', gap: 2 },
  pill: { marginTop: spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  vehicle: { borderRadius: layout.cardRadius, padding: spacing.lg },
  danger: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg, paddingTop: spacing.lg, paddingHorizontal: spacing.xs },
});
