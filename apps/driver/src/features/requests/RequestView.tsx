import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { counterSuggestions, formatDistance, formatDuration, formatNaira, nairaAccessibilityLabel, type IncomingRequest, type Kobo } from '@gobye/core';
import { Avatar, Badge, Button, Icon, SimulatedBadge, Text, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { MapCanvas } from '@gobye/ui/src/map/MapCanvas';
import { PAYMENT_LABEL } from '@/features/common/format';
import { resetTo } from '@/features/navigation/reset';
import { useDriver } from '@/state/driver';
import { useHaptics } from '@/state/settings';
import { useNow } from '@/state/useNow';

/**
 * D11 / D12 Incoming request. One layout for both modes so drivers learn it once:
 * countdown → route preview → the money → stops → rider → actions.
 * Quick Match: Accept or Decline. Negotiate: accept the rider's offer, send one counter, or decline.
 */
export function RequestView({ id }: { id: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const haptic = useHaptics();
  const d = useDriver();
  const now = useNow(250);
  const [initial] = useState(d.request);
  const req: IncomingRequest | null = d.request?.id === id ? d.request : null;
  const shown = req ?? (initial?.id === id ? initial : null);
  const [counter, setCounter] = useState<Kobo | null>(null);
  const [accepting, setAccepting] = useState(false);
  const left = req ? Math.max(0, req.expiresAt - now) : 0;
  const total = shown ? shown.expiresAt - shown.createdAt : 1;
  const waiting = d.counter?.status === 'waiting';
  const declined = d.counter?.status === 'declined';
  const closing = useRef(false);

  // Accepted (directly or by the rider accepting a counter) → the trip.
  useEffect(() => {
    if (d.activeTrip && !closing.current) {
      closing.current = true;
      haptic('success');
      resetTo('/trip');
    }
  }, [d.activeTrip, haptic]);

  // Expired or withdrawn → back to the map with a short note.
  useEffect(() => {
    if (!req && !d.activeTrip && !declined && !closing.current) {
      closing.current = true;
      toast('Request expired', 'info');
      router.back();
    }
  }, [req, d.activeTrip, declined, toast]);

  if (!shown) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  const negotiate = shown.kind === 'negotiate';
  const options = negotiate ? counterSuggestions(shown) : [];

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    const r = await d.acceptRequest();
    setAccepting(false);
    if (r.ok) return;
    toast(r.error, 'error');
    // Another driver claimed it: nothing left to answer, back to the map.
    if (/another driver/i.test(r.error)) {
      closing.current = true;
      d.declineRequest();
      router.back();
    }
  };
  const sendCounter = () => {
    if (!counter) return;
    const r = d.sendCounter(counter);
    if (!r.ok) toast(r.error, 'error');
    else haptic('selection');
  };
  const decline = () => {
    closing.current = true;
    d.declineRequest();
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Countdown: a bar that drains, plus the seconds in words for screen readers. */}
      <View style={styles.head}>
        <View style={styles.headRow}>
          <Badge label={negotiate ? 'Negotiation' : 'Quick Match'} icon={negotiate ? 'chat' : 'car'} tone={negotiate ? 'brand' : 'neutral'} />
          <SimulatedBadge />
          <View style={styles.flex} />
          {!waiting && !declined ? (
            <Text variant="subhead" weight="semibold" tabular accessibilityLabel={`${Math.ceil(left / 1000)} seconds to respond`}>
              {Math.ceil(left / 1000)}s
            </Text>
          ) : null}
        </View>
        {!waiting && !declined ? (
          <View style={[styles.timer, { backgroundColor: colors.surfaceMuted }]}>
            <View style={[styles.timerFill, { width: `${(left / total) * 100}%`, backgroundColor: left < 6000 ? colors.warning : colors.primary }]} />
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.map, { backgroundColor: colors.surfaceMuted }]}>
          <MapCanvas center={shown.pickup.coordinate} pickup={shown.pickup.coordinate} destination={shown.destination.coordinate} route={shown.route.polyline} driver={d.position} />
        </View>

        <View style={styles.money} accessible accessibilityLabel={negotiate ? `Rider offers ${nairaAccessibilityLabel(shown.amount)}. Suggested fare ${nairaAccessibilityLabel(shown.suggested)}` : `Fare ${nairaAccessibilityLabel(shown.amount)}`}>
          <Text variant="footnote" color="textSecondary">
            {negotiate ? `${shown.rider.firstName} offers` : 'Fare · you keep all of it'}
          </Text>
          <Text style={styles.amount} tabular>
            {formatNaira(shown.amount)}
          </Text>
          <Text variant="footnote" color="textSecondary">
            {negotiate ? `Suggested fare ${formatNaira(shown.suggested)} · ` : ''}
            {PAYMENT_LABEL[shown.paymentMethod]}
          </Text>
        </View>

        <View style={[styles.stops, { backgroundColor: colors.surfaceMuted }]}>
          <Stop icon="pickup" label="Pickup" title={shown.pickup.title} meta={`${formatDuration(shown.pickupEtaSeconds)} · ${formatDistance(shown.pickupDistanceMeters)} from you`} />
          <View style={[styles.stopLine, { backgroundColor: colors.border }]} />
          <Stop icon="flag" label="Drop off" title={shown.destination.title} meta={`${formatDuration(shown.route.durationSeconds)} · ${formatDistance(shown.route.distanceMeters)} trip`} />
        </View>

        <View style={styles.rider}>
          <Avatar name={shown.rider.firstName} size={40} />
          <View style={styles.flex}>
            <Text variant="headline">{shown.rider.firstName}</Text>
            <View style={styles.inline}>
              <Icon name="star" variant="filled" size="xs" color="accent" />
              <Text variant="footnote" color="textSecondary">
                {shown.rider.rating.toFixed(2)} · {shown.rider.completedTrips} trips
              </Text>
            </View>
          </View>
        </View>

        {shown.pickupNote ? (
          <View style={[styles.note, { borderColor: colors.border }]}>
            <Icon name="message" size="sm" color="textSecondary" />
            <Text variant="callout" style={styles.flex}>
              “{shown.pickupNote}”
            </Text>
          </View>
        ) : null}

        {negotiate && !waiting && !declined && options.length ? (
          <View style={styles.counter}>
            <Text variant="subhead" weight="semibold">
              Or counter once
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Counteroffer">
              {options.map((a) => {
                const on = counter === a;
                return (
                  <Pressable
                    key={a}
                    onPress={() => setCounter(on ? null : a)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={nairaAccessibilityLabel(a)}
                    testID={`counter-${a}`}
                    style={({ pressed }) => [styles.chip, { backgroundColor: on ? colors.primary : colors.surfaceMuted, borderColor: on ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Text variant="headline" tabular style={{ color: on ? colors.onPrimary : colors.text }}>
                      {formatNaira(a)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg), borderTopColor: colors.border }]}>
        {waiting ? (
          <View style={styles.wait} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.text} />
            <Text variant="callout" style={styles.flex}>
              Sent {formatNaira(d.counter!.amount)}. Waiting for {shown.rider.firstName} to reply…
            </Text>
          </View>
        ) : declined ? (
          <>
            <Text variant="callout" align="center" accessibilityLiveRegion="polite">
              {shown.rider.firstName} chose another driver.
            </Text>
            <Button title="Back to the map" variant="secondary" onPress={decline} testID="request-back" />
          </>
        ) : negotiate && counter ? (
          <>
            <Button title={`Send ${formatNaira(counter)}`} onPress={sendCounter} testID="send-counter" />
            <Button title={`Accept ${formatNaira(shown.amount)} instead`} variant="tertiary" onPress={accept} />
          </>
        ) : (
          <>
            <Button title={negotiate ? `Accept ${formatNaira(shown.amount)}` : 'Accept'} onPress={accept} loading={accepting} loadingLabel="Accepting" testID="accept-request" />
            <Button title="Decline" variant="tertiary" onPress={decline} testID="decline-request" />
          </>
        )}
      </View>
    </View>
  );
}

function Stop({ icon, label, title, meta }: { icon: 'pickup' | 'flag'; label: string; title: string; meta: string }) {
  return (
    <View style={styles.stop} accessible accessibilityLabel={`${label}: ${title}. ${meta}`}>
      <Icon name={icon} size="sm" color="text" variant={icon === 'flag' ? 'filled' : 'regular'} />
      <View style={styles.flex}>
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="footnote" color="textSecondary">
          {meta}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  head: { paddingHorizontal: layout.page, paddingTop: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timer: { height: 6, borderRadius: 3, overflow: 'hidden' },
  timerFill: { height: 6, borderRadius: 3 },
  content: { paddingHorizontal: layout.page, paddingVertical: spacing.lg, gap: spacing.lg },
  map: { height: 180, borderRadius: layout.cardRadius, overflow: 'hidden' },
  money: { alignItems: 'center', gap: 2 },
  amount: { fontFamily: 'Inter_700Bold', fontSize: 44, lineHeight: 52, letterSpacing: -1 },
  stops: { borderRadius: layout.cardRadius, padding: spacing.lg, gap: spacing.xs },
  stop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stopLine: { width: 2, height: 14, marginLeft: 9, borderRadius: 1 },
  rider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: layout.controlRadius, borderWidth: 1 },
  counter: { gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { flexGrow: 1, minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: layout.controlRadius, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingHorizontal: layout.page, paddingTop: spacing.md, gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  wait: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
});
