import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCountdown, formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, noShowAvailableAt, pinAttemptsLeft, type DriverTrip, type LatLng } from '@gobye/core';
import { Avatar, Button, CodeBoxes, FieldMessage, Icon, IconButton, JourneyBar, SimulatedBadge, Text, layout, shadows, spacing, useTheme, useToast } from '@gobye/ui';
import { MapCanvas, type MapCanvasHandle } from '@gobye/ui/src/map/MapCanvas';
import { confirmAction } from '@/features/common/confirm';
import { PAYMENT_LABEL } from '@/features/common/format';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';
import { useNow } from '@/state/useNow';

/** Opens turn-by-turn directions in the phone's maps app (GoBye doesn't do navigation itself). */
function openDirections(to: LatLng) {
  const q = `${to.latitude},${to.longitude}`;
  const url = Platform.OS === 'ios' ? `maps://?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`));
}

/**
 * D13 Active trip: to pickup → arrived (confirm the rider's PIN) → in progress → complete.
 * Map on top with the route; one panel at the bottom whose content follows the stage. Leaving is
 * blocked (Android back does nothing) until the trip ends.
 */
export function ActiveTrip() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const d = useDriver();
  const map = useRef<MapCanvasHandle>(null);
  const [panelH, setPanelH] = useState(320);
  const trip = d.activeTrip;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, []),
  );

  useEffect(() => {
    if (!trip) resetTo('/(tabs)');
    else if (trip.stage === 'completed') resetTo('/trip-complete');
  }, [trip]);

  if (!trip || trip.stage === 'completed' || trip.stage === 'cancelled') return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const toPickup = trip.stage === 'to_pickup' || trip.stage === 'arrived';

  return (
    <View style={[styles.root, { backgroundColor: colors.surfaceMuted }]}>
      <MapCanvas
        ref={map}
        center={trip.pickup.coordinate}
        pickup={toPickup ? trip.pickup.coordinate : null}
        pickupName={trip.rider.firstName}
        destination={trip.destination.coordinate}
        route={trip.route.polyline}
        driverRoute={trip.stage === 'to_pickup' ? [d.position, trip.pickup.coordinate] : null}
        driver={d.position}
        topInset={insets.top + 56}
        bottomInset={panelH}
        testID="trip-map"
      />
      <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={[styles.stagePill, { backgroundColor: colors.card }, scheme === 'light' && shadows.card]}>
          <Icon name={toPickup ? 'pickup' : 'route'} size="sm" color="text" />
          <Text variant="subhead" weight="semibold">
            {trip.stage === 'to_pickup' ? 'Heading to pickup' : trip.stage === 'arrived' ? 'At pickup' : 'Trip in progress'}
          </Text>
          <SimulatedBadge />
        </View>
        <IconButton icon="locate" variant="floating" accessibilityLabel="Show the whole route" onPress={() => map.current?.fitAll()} />
      </View>

      <View
        onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
        style={[styles.panel, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, spacing.lg), borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 }, scheme === 'light' && shadows.card]}
      >
        {trip.stage === 'to_pickup' ? <ToPickup trip={trip} /> : trip.stage === 'arrived' ? <Arrived trip={trip} /> : <InProgress trip={trip} />}
      </View>
    </View>
  );
}

function RiderRow({ trip }: { trip: DriverTrip }) {
  const toast = useToast();
  const contact = (how: 'call' | 'message') => toast(how === 'call' ? 'Calls go through a masked number. Simulated in this preview.' : 'In-app messages are simulated in this preview.', 'info');
  return (
    <View style={styles.rider}>
      <Avatar name={trip.rider.firstName} size={44} />
      <View style={styles.flex}>
        <Text variant="headline">{trip.rider.firstName}</Text>
        <View style={styles.inline}>
          <Icon name="star" variant="filled" size="xs" color="accent" />
          <Text variant="footnote" color="textSecondary">
            {trip.rider.rating.toFixed(2)}
          </Text>
        </View>
      </View>
      <IconButton icon="message" variant="filled" accessibilityLabel={`Message ${trip.rider.firstName}`} onPress={() => contact('message')} />
      <IconButton icon="phone" variant="filled" accessibilityLabel={`Call ${trip.rider.firstName}`} onPress={() => contact('call')} />
    </View>
  );
}

function ToPickup({ trip }: { trip: DriverTrip }) {
  const d = useDriver();
  const haptic = useHaptics();
  const now = useNow(1000);
  const left = Math.max(0, trip.acceptedAt + 60_000 - now);
  const progress = Math.min(0.96, (now - trip.acceptedAt) / 60_000);

  const cancel = () =>
    confirmAction({
      title: 'Cancel this trip?',
      message: 'Cancelling after you accept affects your acceptance rate. The rider will be matched again.',
      cancel: 'Keep trip',
      confirm: 'Cancel trip',
      destructive: true,
      onConfirm: () => {
        const r = d.cancel('driver_cancelled');
        if (r.ok) resetTo('/(tabs)');
      },
    });

  return (
    <>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text variant="title2" accessibilityRole="header">
            Pick up {trip.rider.firstName}
          </Text>
          <Text variant="callout" color="textSecondary" numberOfLines={1}>
            {trip.pickup.title}
          </Text>
        </View>
        <View style={styles.eta}>
          <Text variant="title3" tabular>
            {left > 0 ? formatCountdown(left) : 'Now'}
          </Text>
          <Text variant="caption" color="textSecondary">
            away
          </Text>
        </View>
      </View>
      <JourneyBar value={progress} label="Progress to pickup" />
      {trip.pickupNote ? (
        <View style={styles.inline}>
          <Icon name="message" size="xs" color="textSecondary" />
          <Text variant="footnote" color="textSecondary">
            “{trip.pickupNote}”
          </Text>
        </View>
      ) : null}
      <RiderRow trip={trip} />
      <View style={styles.row2}>
        <Button title="Directions" variant="secondary" leadingIcon="navigation" onPress={() => openDirections(trip.pickup.coordinate)} style={styles.flex} />
        <Button
          title="I’ve arrived"
          onPress={() => {
            const r = d.arrive();
            if (r.ok) haptic('success');
          }}
          style={styles.flex}
          testID="arrived"
        />
      </View>
      <Button title="Cancel trip" variant="tertiary" size="md" onPress={cancel} />
    </>
  );
}

function Arrived({ trip }: { trip: DriverTrip }) {
  const d = useDriver();
  const haptic = useHaptics();
  const now = useNow(1000);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const noShowAt = noShowAvailableAt(trip) ?? now;
  const waited = now - (trip.arrivedAt ?? now);
  const locked = pinAttemptsLeft(trip) === 0;

  const start = (value = pin) => {
    const r = d.confirmPin(value);
    if (!r.ok) {
      setError(r.error);
      setPin('');
      haptic('error');
      return;
    }
    haptic('success');
  };

  const noShow = () =>
    confirmAction({
      title: `${trip.rider.firstName} didn’t come?`,
      message: 'The trip will be cancelled and the rider may be charged a no-show fee.',
      cancel: 'Keep waiting',
      confirm: 'Report no show',
      destructive: true,
      onConfirm: () => {
        const r = d.cancel('rider_no_show');
        if (r.ok) resetTo('/(tabs)');
      },
    });

  return (
    <>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text variant="title2" accessibilityRole="header">
            Ask {trip.rider.firstName} for their PIN
          </Text>
          <Text variant="callout" color="textSecondary">
            Start only when the 4 digits match. Never start without it.
          </Text>
        </View>
        <View style={styles.eta}>
          <Text variant="title3" tabular>
            {formatCountdown(waited)}
          </Text>
          <Text variant="caption" color="textSecondary">
            waiting
          </Text>
        </View>
      </View>
      <CodeBoxes
        length={4}
        value={pin}
        autoFocus={false}
        label="Rider’s 4 digit pickup PIN"
        disabled={locked}
        error={!!error}
        onChange={(v) => {
          setPin(v);
          setError(undefined);
          if (v.length === 4) start(v);
        }}
        testID="pin-input"
      />
      <FieldMessage
        error={error}
        info={
          d.relayTrip
            ? trip.pickupPin
              ? `Ask ${trip.rider.firstName} for the PIN on their screen.`
              : `Waiting for ${trip.rider.firstName}’s PIN to reach you…`
            : `Preview: ${trip.rider.firstName}’s PIN is ${trip.pickupPin}.`
        }
      />
      {locked ? (
        <Button title="Contact support" variant="secondary" leadingIcon="support" onPress={() => Linking.openURL('mailto:support@gobye.app')} />
      ) : (
        <Button title="Start trip" onPress={() => start()} disabled={pin.length < 4} testID="start-trip" />
      )}
      <RiderRow trip={trip} />
      <Button
        title={now >= noShowAt ? 'Rider didn’t come' : `No show available in ${formatCountdown(noShowAt - now)}`}
        variant="tertiary"
        size="md"
        disabled={now < noShowAt}
        onPress={noShow}
      />
    </>
  );
}

function InProgress({ trip }: { trip: DriverTrip }) {
  const { colors } = useTheme();
  const d = useDriver();
  const haptic = useHaptics();
  const now = useNow(1000);
  const elapsed = now - (trip.startedAt ?? now);
  const progress = Math.min(0.98, elapsed / 90_000);
  const remaining = Math.max(60, trip.route.durationSeconds * (1 - progress));

  const finish = () =>
    confirmAction({
      title: 'End the trip here?',
      message: `${trip.rider.firstName} pays ${formatNaira(trip.fare)} after you end it.`,
      cancel: 'Not yet',
      confirm: 'End trip',
      onConfirm: () => {
        const r = d.complete();
        if (r.ok) {
          haptic('success');
          resetTo('/trip-complete');
        }
      },
    });

  const sos = () =>
    Alert.alert('Safety', 'Call Nigeria’s emergency number, or tell GoBye’s safety team (simulated in this preview).', [
      { text: 'Close', style: 'cancel' },
      { text: 'Alert GoBye safety', onPress: () => undefined },
      { text: 'Call 112', style: 'destructive', onPress: () => Linking.openURL('tel:112') },
    ]);

  return (
    <>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text variant="title2" accessibilityRole="header" numberOfLines={1}>
            To {trip.destination.title}
          </Text>
          <Text variant="callout" color="textSecondary">
            {formatDuration(remaining)} · {formatDistance(trip.route.distanceMeters * (1 - progress))} left
          </Text>
        </View>
        <IconButton icon="sos" variant="filled" color="danger" accessibilityLabel="Safety and emergency" onPress={sos} />
      </View>
      <JourneyBar value={progress} label="Trip progress" end />
      <View style={[styles.fare, { backgroundColor: colors.surfaceMuted }]} accessible accessibilityLabel={`Fare ${nairaAccessibilityLabel(trip.fare)}, ${PAYMENT_LABEL[trip.paymentMethod]}`}>
        <View style={styles.flex}>
          <Text variant="caption" color="textSecondary">
            Fare · {PAYMENT_LABEL[trip.paymentMethod]}
          </Text>
          <Text variant="title2" tabular>
            {formatNaira(trip.fare)}
          </Text>
        </View>
      </View>
      <View style={styles.row2}>
        <Button title="Directions" variant="secondary" leadingIcon="navigation" onPress={() => openDirections(trip.destination.coordinate)} style={styles.flex} />
        <Button title="End trip" onPress={finish} style={styles.flex} testID="end-trip" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stagePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: 999 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    paddingHorizontal: layout.page,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  eta: { alignItems: 'flex-end' },
  rider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  row2: { flexDirection: 'row', gap: spacing.sm },
  fare: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: layout.controlRadius },
});
