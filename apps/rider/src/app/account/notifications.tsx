import { router } from 'expo-router';
import { Screen, Text } from '@gobye/ui';
import { useNotificationPrefs } from '@/features/account/notificationPrefs';
import { PageHeader, SettingsGroup, SettingsGroupSkeleton, SettingsRow } from '@/features/account/ui';

/**
 * Notification preferences (Account → Preferences). Controls which alerts and sounds the passenger gets.
 * The inbox itself is a separate screen reached from the bell (`/notifications`).
 */
export default function NotificationPreferences() {
  const { prefs, update, ready } = useNotificationPrefs();
  return (
    <Screen header={<PageHeader title="Notification preferences" onBack={() => router.back()} />}>
      {!ready ? (
        <>
          <SettingsGroupSkeleton rows={4} />
          <SettingsGroupSkeleton rows={1} />
        </>
      ) : (
        <>
          <SettingsGroup title="Alerts">
            <SettingsRow icon="car" title="Trip updates" trailing="switch" switchValue={prefs.trips} onSwitch={(v) => update({ trips: v })} testID="pref-trips" />
            <SettingsRow icon="wallet" title="Payments and wallet" trailing="switch" switchValue={prefs.payments} onSwitch={(v) => update({ payments: v })} testID="pref-payments" />
            <SettingsRow icon="gift" title="Offers and referrals" trailing="switch" switchValue={prefs.offers} onSwitch={(v) => update({ offers: v })} testID="pref-offers" />
            <SettingsRow icon="shield" title="Safety alerts" value="Always on" trailing="none" accessibilityHint="Can’t be turned off" testID="pref-safety" />
          </SettingsGroup>
          <SettingsGroup title="Sound">
            <SettingsRow icon="notification" title="Alert sounds" trailing="switch" switchValue={prefs.sounds} onSwitch={(v) => update({ sounds: v })} testID="pref-sounds" />
          </SettingsGroup>
          <Text variant="footnote" color="textSecondary">
            Push alerts aren’t live in this preview.
          </Text>
        </>
      )}
    </Screen>
  );
}
