import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  categoryName,
  enabledCategories,
  formatDistance,
  formatDuration,
  formatNaira,
  isQuoteExpired,
  nairaAccessibilityLabel,
  type BookingMode,
  type CategoryAvailability,
  type FareQuote,
  type RouteEstimate,
  type VehicleCategoryId,
} from '@gobye/core';
import { Button, ErrorState, Icon, IconButton, Bone, MapSheet, SimulatedBadge, Skeleton, SkeletonGroup, Text, layout, minTouch, spacing, useTheme, useToast } from '@gobye/ui';
import { CategoryCard } from '@/features/booking/CategoryCard';
import { FareBreakdownView } from '@/features/booking/components';
import { PickupNoteSheet } from '@/features/booking/PickupNoteSheet';
import { MapCanvas } from '@/features/map/MapCanvas';
import { liveRoute, resetTo } from '@/features/navigation/reset';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useServiceConfig } from '@/state/config';
import { useHaptics } from '@/state/haptics';
import { useNow } from '@/state/useNow';
import { useServices } from '@/state/services';

/**
 * R09 — Ride options: route preview, ETA and distance, vehicle category, suggested fare and
 * the Quick Match / Negotiate choice (shown only now that a destination and fare exist).
 */
export default function RideOptions() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Short screens give the sheet more room so the fare and booking method show without scrolling;
  // narrow screens stack the two booking-method cards so their explanations stay readable.
  const sheetSnaps = height < 700 ? [0.74, 0.92] : [0.62, 0.9];
  const stackModes = width < 360;
  const { colors } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const { maps, pricing } = useServices();
  const { defaultPayment } = useAccount();
  const serviceConfig = useServiceConfig();
  const categories = useMemo(() => enabledCategories(serviceConfig), [serviceConfig]);
  const booking = useBooking();
  const { pickup, destination } = booking;

  const [route, setRoute] = useState<RouteEstimate | null>(null);
  const [quotes, setQuotes] = useState<FareQuote[]>([]);
  const [availability, setAvailability] = useState<CategoryAvailability[]>([]);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState<VehicleCategoryId>('go');
  const [mode, setMode] = useState<BookingMode>('quick_match');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const now = useNow(1000);
  const navigation = useNavigation();

  // Each load gets an id; a slower, older response never overwrites a newer pickup/destination.
  const loadId = useRef(0);
  const load = useCallback(async () => {
    if (!pickup || !destination) return;
    const id = ++loadId.current;
    setError(false);
    // Clear the old route and fare so Book stays disabled until the new pickup is priced.
    setRoute(null);
    setQuotes([]);
    try {
      const r = await maps.getRoute(pickup.coordinate, destination.coordinate);
      const [q, a] = await Promise.all([pricing.quoteAll(r), pricing.availability(pickup.coordinate)]);
      if (id !== loadId.current) return;
      setRoute(r);
      setQuotes(q);
      setAvailability(a);
      setCategory((c) => (a.find((x) => x.category === c)?.available ? c : (a.find((x) => x.available)?.category ?? c)));
    } catch {
      if (id === loadId.current) setError(true);
    }
  }, [pickup, destination, maps, pricing]);

  useEffect(() => {
    // Focus-aware: never navigate from this screen while another screen is on top of it.
    if (!pickup || !destination) {
      if (navigation.isFocused() && router.canGoBack()) router.back();
    } else void load();
  }, [load, pickup, destination, navigation]);

  const quote = quotes.find((q) => q.category === category) ?? null;
  const expired = quote ? isQuoteExpired(quote, now) : false;

  // BR-022: refresh an expired quote automatically and tell the user.
  useEffect(() => {
    if (expired && route && navigation.isFocused()) {
      pricing
        .quoteAll(route)
        .then((q) => {
          setQuotes(q);
          toast('Prices refreshed', 'info');
        })
        .catch(() => setError(true));
    }
  }, [expired, route, pricing, toast, navigation]);

  const avail = useMemo(() => new Map(availability.map((a) => [a.category, a])), [availability]);
  const loading = !route || !quotes.length;

  const book = () => {
    if (!route || !quote || expired) return;
    // One trip at a time: an unpaid or ongoing trip must be settled first.
    const current = booking.booking;
    if (current && current.status !== 'quoted' && current.status !== 'cancelled' && current.status !== 'failed') {
      toast(current.status === 'payment_pending' ? 'Pay for your last trip first.' : 'You already have a ride in progress.', 'error');
      return router.push(liveRoute(current.status));
    }
    setSubmitting(true);
    // Payment is chosen and confirmed after the trip (brief §6/§9); the default method is only a starting point.
    booking.start({ route, quote, mode, paymentMethod: defaultPayment, rider: booking.rider ?? undefined });
    if (mode === 'quick_match') {
      const r = booking.submitQuickMatch();
      setSubmitting(false);
      if (!r.ok) return toast(r.error, 'error');
      haptic('impact');
      resetTo('/booking/searching');
    } else {
      setSubmitting(false);
      // Replace so Options is not left mounted underneath the rest of the journey.
      router.replace('/booking/negotiate');
    }
  };

  // The action names what happens in the selected mode.
  const cta =
    mode === 'quick_match'
      ? { title: 'Find a driver', label: quote ? `Find a ${categoryName(serviceConfig, quote.category)} driver at ${nairaAccessibilityLabel(quote.suggested)}` : 'Find a driver' }
      : { title: 'Offer your fare', label: 'Offer your fare' };

  return (
    <View style={styles.root}>
      <MapCanvas
        center={pickup?.coordinate ?? destination?.coordinate ?? { latitude: 6.5, longitude: 3.37 }}
        pickup={pickup?.coordinate}
        destination={destination?.coordinate}
        route={route?.polyline}
        bottomInset={460}
        topInset={insets.top + 56}
      />
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <IconButton icon="back" variant="floating" accessibilityLabel="Back" onPress={() => router.back()} />
      </View>

      <MapSheet snapPoints={sheetSnaps} header={null}>
        {error ? (
          <ErrorState title="Couldn’t load ride options" body="Check your connection, then retry." onRetry={load} />
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {/* 1. Journey: pickup and destination joined by a vertical route indicator, each editable. */}
              <View style={[styles.journey, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <JourneyRow
                  kind="pickup"
                  label="Pickup"
                  value={pickup ? (pickup.title === 'Current location' ? pickup.subtitle : pickup.title) : 'Set pickup'}
                  onEdit={() => router.push({ pathname: '/booking/search', params: { field: 'pickup', from: 'options' } })}
                  testID="options-edit-pickup"
                />
                <View style={styles.connector}>
                  <View style={[styles.connectorLine, { backgroundColor: colors.border }]} />
                </View>
                <JourneyRow
                  kind="destination"
                  label="Destination"
                  value={destination?.title ?? ''}
                  onEdit={() => router.push({ pathname: '/booking/search', params: { field: 'destination', from: 'options' } })}
                />
                <Pressable
                  onPress={() => setNoteOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={booking.pickupNote ? `Pickup note: ${booking.pickupNote}. Edit` : 'Add a pickup note for your driver'}
                  style={[styles.noteRow, { borderTopColor: colors.border }]}
                  testID="pickup-note"
                >
                  <Icon name={booking.pickupNote ? 'message' : 'plus'} size="sm" color="primary" />
                  <Text variant="footnote" color={booking.pickupNote ? 'text' : 'primary'} weight={booking.pickupNote ? 'regular' : 'semibold'} style={styles.flex} numberOfLines={2}>
                    {booking.pickupNote ? booking.pickupNote : 'Add pickup note'}
                  </Text>
                </Pressable>
              </View>

              {/* 2. Suggested fare first, with time and distance beside it. */}
              <View style={styles.fareBlock} accessible accessibilityLabel={quote && route ? `Suggested fare ${nairaAccessibilityLabel(quote.suggested)}. About ${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)}. Simulated estimate` : 'Loading fare'}>
                <View style={styles.flex}>
                  <Text variant="footnote" color="textSecondary">
                    Suggested fare
                  </Text>
                  {quote ? (
                    <Text variant="largeTitle" tabular>
                      {formatNaira(quote.suggested)}
                    </Text>
                  ) : (
                    <Skeleton width={140} height={34} />
                  )}
                </View>
                <View style={styles.fareMeta}>
                  {route ? (
                    <>
                      <Text variant="headline">{formatDuration(route.durationSeconds)}</Text>
                      <Text variant="footnote" color="textSecondary">
                        {formatDistance(route.distanceMeters)}
                      </Text>
                    </>
                  ) : (
                    <Skeleton width={70} height={20} />
                  )}
                </View>
              </View>
              <SimulatedBadge label="Simulated estimate" />

              {/* 3. Booking method: two clearly selectable options. */}
              <View style={[styles.modes, stackModes && styles.modesStacked]} accessibilityRole="radiogroup" accessibilityLabel="How do you want to book?">
                <ModeOption
                  selected={mode === 'quick_match'}
                  icon="car"
                  title="Quick Match"
                  body="Ride at the suggested fare."
                  onSelect={() => {
                    haptic('selection');
                    setMode('quick_match');
                  }}
                  testID="mode-quick"
                  stacked={stackModes}
                />
                <ModeOption
                  selected={mode === 'negotiate'}
                  icon="coin"
                  title="Negotiate"
                  body={quote ? `Offer ${formatNaira(quote.negotiationRange.min)} to ${formatNaira(quote.negotiationRange.max)}.` : 'Offer your fare.'}
                  onSelect={() => {
                    haptic('selection');
                    setMode('negotiate');
                  }}
                  testID="mode-negotiate"
                  stacked={stackModes}
                />
              </View>

              {/* 4. Vehicle: the category comes from admin configuration (one at launch). */}
              <View style={styles.vehicles} accessibilityRole={categories.length > 1 ? 'radiogroup' : undefined} accessibilityLabel="Vehicle type">
                {loading
                  ? [0].map((i) => (
                      <SkeletonGroup key={i} label="Loading vehicle options">
                        <View style={[styles.catSkeleton, { borderColor: colors.border }]}>
                          <Bone width={84} height={56} radius={12} />
                          <View style={styles.catSkeletonText}>
                            <Bone width="55%" height={15} />
                            <Bone width="80%" height={11} />
                            <Bone width="45%" height={11} />
                          </View>
                        </View>
                      </SkeletonGroup>
                    ))
                  : quotes.map((q) => {
                      const a = avail.get(q.category);
                      const cfg = categories.find((c) => c.id === q.category);
                      if (!cfg) return null;
                      return (
                        <CategoryCard
                          key={q.category}
                          category={cfg}
                          single={categories.length === 1}
                          fare={categories.length > 1 ? q.suggested : null}
                          etaSeconds={a?.pickupEtaSeconds}
                          available={a?.available ?? true}
                          reason={a?.reason}
                          selected={category === q.category}
                          onSelect={() => {
                            haptic('selection');
                            setCategory(q.category);
                          }}
                        />
                      );
                    })}
              </View>

              {/* 5. Expandable breakdown (only applicable charges). */}
              {quote ? (
                <Pressable onPress={() => setShowBreakdown((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showBreakdown }} style={styles.breakdownToggle}>
                  <Text variant="subhead" color="primary" weight="semibold">
                    {showBreakdown ? 'Hide fare breakdown' : 'See fare breakdown'}
                  </Text>
                  <Icon name={showBreakdown ? 'chevronUp' : 'chevronDown'} size="sm" color="primary" />
                </Pressable>
              ) : null}
              {quote && showBreakdown ? <FareBreakdownView breakdown={quote.breakdown} /> : null}

              <View style={[styles.payNote, { backgroundColor: colors.surfaceMuted }]} accessible>
                <Icon name="wallet" size="sm" color="textSecondary" />
                <Text variant="footnote" color="textSecondary" style={styles.flex}>
                  {mode === 'quick_match' ? 'Fixed fare, no meter.' : 'You pay the fare you agree.'} Choose wallet or bank transfer after the trip.
                </Text>
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <Button
                title={cta.title}
                accessibilityLabel={cta.label}
                onPress={book}
                loading={submitting}
                disabled={loading || !quote || expired || !(avail.get(category)?.available ?? true)}
                testID="book-ride"
              />
            </View>
          </>
        )}
      </MapSheet>
      <PickupNoteSheet visible={noteOpen} value={booking.pickupNote} onSave={booking.setPickupNote} onClose={() => setNoteOpen(false)} />
    </View>
  );
}

function JourneyRow({ kind, label, value, onEdit, testID }: { kind: 'pickup' | 'destination'; label: string; value: string; onEdit: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Edit`} style={styles.journeyRow} testID={testID}>
      <View style={styles.marker}>
        {kind === 'pickup' ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : <View style={[styles.square, { backgroundColor: colors.text }]} />}
      </View>
      <View style={styles.flex}>
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
        <Text variant="subhead" weight="semibold" numberOfLines={2}>
          {value}
        </Text>
      </View>
      <Icon name="edit" size="sm" color="textSecondary" />
    </Pressable>
  );
}

function ModeOption({ selected, icon, title, body, onSelect, testID, stacked }: { selected: boolean; icon: 'car' | 'coin'; title: string; body: string; onSelect: () => void; testID?: string; stacked?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
      style={[styles.mode, stacked && styles.modeStacked, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.surfaceSelected : colors.card }]}
    >
      <View style={styles.modeTop}>
        <Icon name={icon} variant={selected ? 'filled' : 'regular'} color={selected ? 'primary' : 'text'} />
        <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>
      </View>
      <Text variant="headline">{title}</Text>
      <Text variant="footnote" color="textSecondary">
        {body}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  topBar: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  content: { gap: spacing.lg, paddingBottom: spacing.lg },
  journey: { borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: layout.container, paddingVertical: spacing.xs },
  journeyRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 56 },
  marker: { width: 24, alignItems: 'center' },
  connector: { width: 24, alignItems: 'center', height: 8 },
  connectorLine: { width: 2, flex: 1, borderRadius: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  square: { width: 12, height: 12, borderRadius: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: 2 },
  fareBlock: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  fareMeta: { alignItems: 'flex-end' },
  modes: { flexDirection: 'row', gap: spacing.sm },
  modesStacked: { flexDirection: 'column' },
  modeStacked: { flex: 0, minHeight: 0 },
  mode: { flex: 1, borderWidth: 1.5, borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.xs, minHeight: 128 },
  modeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  vehicles: { gap: spacing.sm },
  catSkeleton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: layout.cardRadius, padding: spacing.sm, paddingRight: layout.container, minHeight: 96 },
  catSkeletonText: { flex: 1, gap: 6 },
  breakdownToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: minTouch },
  payNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 14 },
  footer: { paddingTop: spacing.sm },
});
