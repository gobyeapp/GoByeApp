import { useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPhone } from '@gobye/core';
import { Avatar, Bone, Icon, SkeletonGroup, Text, layout, spacing, useTheme } from '@gobye/ui';
import { ProfilePhotoSheet } from '@/features/account/ProfilePhotoSheet';
import { SettingsGroup, SettingsGroupSkeleton, SettingsRow } from '@/features/account/ui';
import { useAccount } from '@/state/account';
import { useSession } from '@/state/session';

const APPEARANCE_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const;

/** "+234 803 123 4567" → "+234 803 *** 4567": enough to recognise, not to read out in public. */
function maskPhone(e164: string) {
  const parts = formatPhone(e164).split(' ');
  if (parts.length < 4) return formatPhone(e164);
  return [parts[0], parts[1], '***', parts[parts.length - 1]].join(' ');
}

/**
 * R19 Account (profile.jpg). Title, a centred identity block with the passenger's real photo and a
 * subtle edit badge, then nested groups: Profile, Preferences, Security, Account actions, and a separate
 * destructive section for Delete account at the bottom. Unread notifications show only on the bell.
 */
export default function Account() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, status, signOut } = useSession();
  const { settings, updateSettings, ready } = useAccount();
  const [photoOpen, setPhotoOpen] = useState(false);
  const name = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  const loading = status === 'loading' || !ready;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="title2" accessibilityRole="header" style={styles.title}>
        Account
      </Text>

      {loading ? (
        <SkeletonGroup label="Loading your account" style={styles.identity}>
          <View style={styles.identityInner}>
            <Bone width={76} height={76} radius={38} />
            <Bone width={150} height={16} />
            <Bone width={120} height={12} />
          </View>
          <View style={styles.groups}>
            <SettingsGroupSkeleton rows={3} />
            <SettingsGroupSkeleton rows={4} />
          </View>
        </SkeletonGroup>
      ) : (
        <>
          <View style={styles.identity}>
            <Pressable
              onPress={() => setPhotoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={user?.photoUri ? 'Change profile photo' : 'Add profile photo'}
              hitSlop={8}
              testID="account-photo"
              style={({ pressed }) => pressed && { opacity: 0.8 }}
            >
              <Avatar uri={user?.photoUri} name={name} size={76} />
              <View style={[styles.editBadge, { backgroundColor: colors.card, borderColor: colors.background }]}>
                <Icon name={user?.photoUri ? 'edit' : 'camera'} size={14} color="text" />
              </View>
            </Pressable>
            <View style={styles.identityText}>
              <Text variant="headline" align="center">
                {name || 'Your profile'}
              </Text>
              {user ? (
                <Text variant="footnote" color="textSecondary" align="center">
                  {user.email ? user.email : formatPhone(user.phone)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.groups}>
            <SettingsGroup title="Profile">
              <SettingsRow icon="account" title="Personal details" onPress={() => router.push('/account/profile')} testID="row-profile" />
              <SettingsRow icon="destination" title="Saved places" onPress={() => router.push('/account/places')} />
              <SettingsRow icon="gift" title="Invite friends" onPress={() => router.push('/account/rewards')} testID="row-referrals" />
            </SettingsGroup>

            <SettingsGroup title="Preferences">
              <SettingsRow icon="notification" title="Notification preferences" onPress={() => router.push('/account/notifications')} testID="row-notification-prefs" />
              <SettingsRow icon="settings" title="Appearance" value={APPEARANCE_LABEL[settings.appearance]} onPress={() => router.push('/account/appearance')} testID="row-appearance" />
              <SettingsRow icon="locate" title="Location access" onPress={() => router.push('/account/location')} />
              <SettingsRow icon="phone" title="Haptic feedback" trailing="switch" switchValue={settings.haptics} onSwitch={(v) => updateSettings({ haptics: v })} testID="row-haptics" />
            </SettingsGroup>

            <SettingsGroup title="Security">
              <SettingsRow
                icon="lock"
                title="Sign in method"
                value={user ? maskPhone(user.phone) : undefined}
                trailing="none"
                accessibilityHint="Information only"
              />
              <SettingsRow icon="shield" title="Safety and emergency" onPress={() => router.push('/account/safety')} />
            </SettingsGroup>

            <SettingsGroup title="Account actions">
              <SettingsRow icon="support" title="Help and support" onPress={() => router.push('/account/support')} />
              <SettingsRow icon="document" title="Legal and licences" onPress={() => router.push('/account/settings')} />
              <SettingsRow
                icon="signOut"
                title="Log out"
                onPress={() =>
                  Alert.alert('Log out?', 'You’ll sign in again with your phone number.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Log out', style: 'destructive', onPress: () => void signOut().then(() => router.replace('/auth/phone')) },
                  ])
                }
                testID="sign-out"
              />
            </SettingsGroup>
          </View>

          {/* Destructive action, kept apart from everything else. */}
          <View style={[styles.danger, { borderTopColor: colors.border }]}>
            <SettingsRow icon="delete" title="Delete account" destructive trailing="none" onPress={() => router.push('/account/delete')} testID="row-delete" />
          </View>

          <Text variant="caption" color="textSecondary" align="center">
            GoBye preview 0.1.0
          </Text>
        </>
      )}
      <ProfilePhotoSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.page, paddingBottom: spacing.xxl, gap: spacing.lg },
  title: { paddingTop: spacing.xs },
  identity: { alignItems: 'center', gap: spacing.md },
  identityInner: { alignItems: 'center', gap: spacing.sm, alignSelf: 'center' },
  identityText: { alignItems: 'center', gap: 2 },
  groups: { gap: spacing.md, alignSelf: 'stretch' },
  danger: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg, paddingTop: spacing.lg, paddingHorizontal: spacing.xs },
  editBadge: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
