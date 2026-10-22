import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { earningsToday, formatNaira, nairaAccessibilityLabel, trackingIssueMessage, type DriverLocationError } from '@gobye/core';
import { Button, ConnectionPill, Icon, IconButton, SimulatedBadge, Text, layout, shadows, spacing, useTheme, useToast } from '@gobye/ui';
import { MapCanvas, type MapCanvasHandle } from '@gobye/ui/src/map/MapCanvas';
import { formatRemaining, passName } from '@/features/common/format';
import { STEP_ROUTES } from '@/features/onboarding/parts';
import { VerificationAction, VerificationCard } from '@/features/verification/VerificationCard';
import { useDriver } from '@/state/driver';
import { openLocationSettings } from '@/state/location';
import { useRelayStatus } from '@/state/relay';
import { useHaptics } from '@/state/settings';
import { useNow } from '@/state/useNow';

/**
 * D09 Drive (dashboard). Full-bleed map with the driver's own position, today's earnings at the top,
 * and one panel at the bottom: status, access pass and the single Go online / Go offline control.
 * Requests open full screen on their own (RequestWatcher). Until the driver is approved the panel is
 * the verification card (stage, what's left, what's flagged, what's delayed) and Go online is off (D-049).
 */
export default function Drive() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const haptic = useHaptics();
  const now = useNow(30_000);
  const d = useDriver();
  const map = useRef<MapCanvasHandle>(null);
  const [busy, setBusy] = useState(false);
  const [panelH, setPanelH] = useState(260);
  const online = d.location.activity !== 'offline';
  const today = earningsToday(d.history, now);
  const issues = d.issues.filter((i) => i !== 'background_unavailable');
  const approved = d.verification === 'approved';
  const relay = useRelayStatus();
  const toast = useToast();
  const { height } = useWindowDimensions();

  const submit = () => {
    const r = d.submitApplication();
    if (!r.ok) return toast(r.error, 'error');
    haptic('success');
  };
  const resubmit = () => {
    const r = d.resubmitApplication();
    if (!r.ok) return toast(r.error, 'error');
    haptic('success');
  };

  const explain = (error: DriverLocationError) => {
    switch (error) {
      case 'permission_required':
        return router.push('/permission-location');
      case 'precise_required':
        return Alert.alert('Turn on Precise Location', 'GoBye needs your exact position so riders and pickups line up.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: openLocationSettings },
        ]);
      case 'no_access_package':
        return router.push('/access');
      case 'finish_trip_first':
        return Alert.alert('Finish your trip first', 'You can go offline once this trip has ended.');
      default:
        return undefined;
    }
  };

  const toggle = async () => {
    if (busy) return;
    if (online) {
      const r = d.goOffline();
      if (!r.ok) return explain(r.error);
      haptic('selection');
      return;
    }
    if (!d.hasAccess) return router.push('/access');
    if (!d.primerSeen) return router.push('/permission-location');
    setBusy(true);
    const r = await d.goOnline();
    setBusy(false);
    if (!r.ok) return explain(r.error);
    haptic('success');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surfaceMuted }]}>
      <MapCanvas ref={map} center={d.position} driver={d.position} topInset={insets.top + 64} bottomInset={panelH} testID="drive-map" />

      {/* Top: today's earnings (tap for details) and recenter. */}
      <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable
          onPress={() => router.push('/(tabs)/earnings')}
          accessibilityRole="button"
          accessibilityLabel={`Today, ${nairaAccessibilityLabel(today.total)}, ${today.trips} trips. Open earnings`}
          style={({ pressed }) => [
            styles.earn,
            { backgroundColor: colors.card, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.85 : 1 },
            scheme === 'light' && shadows.card,
          ]}
          testID="today-pill"
        >
          <Text variant="caption" color="textSecondary">
            Today
          </Text>
          <Text variant="headline" tabular>
            {formatNaira(today.total)}
          </Text>
          <View style={[styles.sep, { backgroundColor: colors.border }]} />
          <Text variant="subhead" color="textSecondary" tabular>
            {today.trips} {today.trips === 1 ? 'trip' : 'trips'}
          </Text>
        </Pressable>
        <IconButton icon="locate" variant="floating" accessibilityLabel="Centre on my location" onPress={() => map.current?.recenter(d.position)} />
      </View>

      {/* Bottom panel. */}
      <View
        onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
        style={[styles.panel, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 }, scheme === 'light' && shadows.card]}
      >
        {d.tripNotice ? (
          <View style={[styles.issue, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite" testID="trip-notice">
            <Icon name="info" size="sm" color="text" />
            <Text variant="footnote" style={styles.flex}>
              {d.tripNotice}
            </Text>
            <Pressable onPress={d.clearTripNotice} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}>
              <Icon name="close" size="xs" color="textSecondary" />
            </Pressable>
          </View>
        ) : null}

        {!approved ? (
          <>
            <ScrollView style={{ maxHeight: Math.round(height * (height < 700 ? 0.5 : 0.55)) }} contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false} bounces={false}>
              <ConnectionPill state={relay.state} host={relay.host} testID="relay-pill" />
              <VerificationCard showAction={false} application={d.application} onOpenStep={(step) => router.push(STEP_ROUTES[step])} onSubmit={submit} onResubmit={resubmit} />
              <Pressable onPress={() => router.push('/onboarding')} accessibilityRole="link" hitSlop={6} style={styles.allSteps}>
                <Text variant="footnote" weight="semibold" color="textSecondary">
                  See all registration steps
                </Text>
              </Pressable>
            </ScrollView>
            <VerificationAction application={d.application} onOpenStep={(step) => router.push(STEP_ROUTES[step])} onSubmit={submit} onResubmit={resubmit} />
            <View style={styles.locked}>
              <Icon name="lock" size="xs" color="textSecondary" />
              <Text variant="caption" weight="regular" color="textSecondary" testID="online-locked">
                Go online opens once you’re approved.
              </Text>
            </View>
          </>
        ) : (
        <>
        <ConnectionPill state={relay.state} host={relay.host} testID="relay-pill" />
        <View style={styles.status}>
          <StatusDot online={online} />
          <View style={styles.flex}>
            <Text variant="title3" accessibilityRole="header" accessibilityLiveRegion="polite" testID="drive-status">
              {online ? (d.canReceive ? 'You’re online' : 'Online, requests paused') : 'You’re offline'}
            </Text>
            <Text variant="footnote" color="textSecondary">
              {online ? (d.canReceive ? 'Looking for trips near you…' : 'Fix the issue below to get requests.') : 'Go online when you’re ready to take trips.'}
            </Text>
          </View>
          {online ? <SimulatedBadge /> : null}
        </View>

        {online && issues.length ? (
          <View style={[styles.issue, { backgroundColor: colors.warningSurface }]} accessibilityLiveRegion="polite">
            <Icon name="warning" size="sm" color="warning" />
            <Text variant="footnote" style={styles.flex}>
              {trackingIssueMessage(issues[0])}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push('/access')}
          accessibilityRole="button"
          accessibilityLabel={d.subscription && d.hasAccess ? `${passName(d.subscription)}, ${formatRemaining(d.subscription.expiresAt - now)} left` : 'No access pass. Get one to go online'}
          style={({ pressed }) => [styles.pass, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}
          testID="pass-row"
        >
          <View style={[styles.passIcon, { backgroundColor: colors.card }]}>
            <Icon name="ticket" size="sm" color={d.hasAccess ? 'text' : 'textSecondary'} />
          </View>
          <View style={styles.flex}>
            <Text variant="subhead" weight="semibold">
              {d.hasAccess ? passName(d.subscription) : 'No access pass'}
            </Text>
            <Text variant="footnote" color="textSecondary">
              {d.hasAccess && d.subscription ? `${formatRemaining(d.subscription.expiresAt - now)} left · 0% commission` : 'Get a daily or monthly pass to go online'}
            </Text>
          </View>
          <Text variant="subhead" weight="semibold" color={d.hasAccess ? 'textSecondary' : 'text'}>
            {d.hasAccess ? 'Extend' : 'Get pass'}
          </Text>
        </Pressable>

        <Button
          title={online ? 'Go offline' : 'Go online'}
          variant={online ? 'secondary' : 'primary'}
          leadingIcon="power"
          loading={busy}
          loadingLabel="Going online"
          onPress={toggle}
          testID="online-toggle"
        />
        </>
        )}
      </View>
    </View>
  );
}

/** Online: a soft repeating pulse around a green dot. Offline: grey dot. Reduce Motion: still. */
function StatusDot({ online }: { online: boolean }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!online || reduce) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
  }, [online, reduce, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 1.6 }] }));
  const tint = online ? colors.success : colors.textSecondary;
  return (
    <View style={styles.dotWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {online ? <Animated.View style={[styles.dot, styles.ring, { backgroundColor: tint }, ring]} /> : null}
      <View style={[styles.dot, { backgroundColor: tint }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: 999 },
  sep: { width: 1, height: 16 },
  panel: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    borderRadius: layout.sheetRadius,
    padding: spacing.lg,
    gap: spacing.md,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs },
  issue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius },
  cardScroll: { gap: spacing.md },
  allSteps: { alignSelf: 'center', minHeight: 32, justifyContent: 'center' },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  pass: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: layout.controlRadius },
  passIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  ring: { position: 'absolute' },
});
