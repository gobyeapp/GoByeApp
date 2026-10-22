import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import {
  formatCountdown,
  formatDuration,
  formatNaira,
  getCategory,
  nairaAccessibilityLabel,
  type DriverResponse,
  type DriverSummary,
  type FareBreakdown,
  type Kobo,
  type PaymentMethod,
  type VehicleCategoryId,
} from '@gobye/core';
import { Badge, Button, Card, Divider, Icon, RadioRow, SimulatedBadge, Text, spacing, useTheme, type IconName } from '@gobye/ui';

export const CATEGORY_ICON: Record<VehicleCategoryId, IconName> = {
  keke: 'keke',
  go: 'car',
  comfort: 'carComfort',
  xl: 'carXL',
};

export function paymentIcon(m: PaymentMethod): IconName {
  return m.type === 'cash' ? 'cash' : m.type === 'wallet' ? 'wallet' : 'bank';
}

/* ---------- Vehicle option ---------- */

export function VehicleOption(props: {
  category: VehicleCategoryId;
  fare: Kobo | null;
  etaSeconds?: number;
  available: boolean;
  reason?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const c = getCategory(props.category);
  const subtitle = props.available
    ? `${c.seats} seats · pickup ~${formatDuration(props.etaSeconds ?? 300)} (simulated)`
    : (props.reason ?? 'Unavailable right now');
  return (
    <RadioRow
      testID={`vehicle-${props.category}`}
      title={c.name}
      subtitle={subtitle}
      selected={props.selected}
      onSelect={props.onSelect}
      disabled={!props.available}
      leadingIcon={CATEGORY_ICON[props.category]}
      trailing={
        props.fare !== null ? (
          <Text variant="headline" tabular accessibilityLabel={nairaAccessibilityLabel(props.fare)}>
            {formatNaira(props.fare)}
          </Text>
        ) : null
      }
    />
  );
}

/* ---------- Fare breakdown ---------- */

export function FareBreakdownView({ breakdown, finalFare, title = 'Fare breakdown' }: { breakdown: FareBreakdown; finalFare?: Kobo; title?: string }) {
  const rows: [string, Kobo][] = breakdown.minimumApplied
    ? [['Minimum fare', (breakdown.total - breakdown.rounding) as Kobo]]
    : [
        ['Base fare', breakdown.base],
        ['Distance', breakdown.distance],
        ['Time', breakdown.time],
      ];
  if (breakdown.rounding > 0) rows.push(['Rounding', breakdown.rounding]);
  const negotiated = finalFare !== undefined && finalFare !== breakdown.total;
  return (
    <View style={styles.breakdown} accessibilityLabel={title}>
      <Text variant="subhead" weight="semibold">
        {title}
      </Text>
      {rows.map(([label, amount]) => (
        <Row key={label} label={label} amount={amount} />
      ))}
      {breakdown.multiplier > 1 ? <Row label={`Demand × ${breakdown.multiplier.toFixed(1)}`} text="applied" /> : null}
      <Divider />
      <Row label="Suggested fare" amount={breakdown.total} bold={!negotiated} />
      {negotiated ? <Row label="Agreed fare" amount={finalFare} bold /> : null}
      <Text variant="footnote" color="textSecondary">
        Prices in this preview use placeholder rates and are not final GoBye pricing.
      </Text>
    </View>
  );
}

function Row({ label, amount, text, bold }: { label: string; amount?: Kobo; text?: string; bold?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}, ${amount !== undefined ? nairaAccessibilityLabel(amount) : text}`}>
      <Text variant={bold ? 'headline' : 'callout'} color={bold ? 'text' : 'textSecondary'} style={styles.flex}>
        {label}
      </Text>
      <Text variant={bold ? 'headline' : 'callout'} tabular>
        {amount !== undefined ? formatNaira(amount) : text}
      </Text>
    </View>
  );
}

/* ---------- Driver card ---------- */

export function DriverCard({ driver, subtitle }: { driver: DriverSummary; subtitle?: string }) {
  const { colors } = useTheme();
  const v = driver.vehicle;
  return (
    <View style={styles.driver} accessible accessibilityLabel={`${driver.firstName}, rated ${driver.rating.toFixed(1)}. ${v.colour} ${v.make} ${v.model}, plate ${v.plate}`}>
      <View style={[styles.avatar, { backgroundColor: colors.identity }]}>
        <Text variant="title3" color="onIdentity">
          {driver.firstName[0]}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text variant="headline">{driver.firstName}</Text>
        <View style={styles.inline}>
          <Icon name="star" variant="filled" size="xs" color="accent" />
          <Text variant="footnote" color="textSecondary">
            {driver.rating.toFixed(1)} · {driver.completedTrips.toLocaleString('en-NG')} trips
          </Text>
        </View>
        <Text variant="footnote" color="textSecondary">
          {v.colour} {v.make} {v.model}
          {subtitle ? ` · ${subtitle}` : ''}
        </Text>
      </View>
      <View style={[styles.plate, { borderColor: colors.text }]}>
        <Text variant="subhead" weight="bold" tabular>
          {v.plate}
        </Text>
      </View>
    </View>
  );
}

/* ---------- Driver response (Negotiate) ---------- */

export function ResponseCard({
  response,
  now,
  passengerOffer,
  onSelect,
  busy,
}: {
  response: DriverResponse;
  now: number;
  passengerOffer: Kobo;
  onSelect: () => void;
  busy?: boolean;
}) {
  const remaining = response.expiresAt - now;
  const expired = remaining <= 0;
  const isCounter = response.kind === 'counter';
  return (
    <Card style={[styles.response, expired && { opacity: 0.55 }]}>
      <DriverCard driver={response.driver} subtitle={`${formatDuration(response.etaSeconds)} away`} />
      <View style={styles.responseFooter}>
        <View style={styles.flex}>
          <Text variant="title3" tabular accessibilityLabel={nairaAccessibilityLabel(response.amount)}>
            {formatNaira(response.amount)}
          </Text>
          <View style={styles.inline}>
            <Badge
              label={isCounter ? `Counteroffer +${formatNaira((response.amount - passengerOffer) as Kobo)}` : 'Accepts your price'}
              icon={isCounter ? 'coin' : 'checkCircle'}
              tone={isCounter ? 'warning' : 'success'}
            />
          </View>
        </View>
        <View style={styles.responseAction}>
          <Text variant="caption" color={expired ? 'danger' : remaining < 10_000 ? 'accentText' : 'textSecondary'} tabular accessibilityLiveRegion="none">
            {expired ? 'Expired' : `Expires in ${formatCountdown(remaining)}`}
          </Text>
          <Button
            title="Select"
            size="md"
            onPress={onSelect}
            disabled={expired}
            loading={busy}
            accessibilityLabel={`Select ${response.driver.firstName} for ${nairaAccessibilityLabel(response.amount)}`}
            testID={`select-${response.id}`}
          />
        </View>
      </View>
    </Card>
  );
}

/* ---------- Searching pulse ---------- */

export function SearchingPulse() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduce) t.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false);
  }, [reduce, t]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 0.55 + t.value * 0.45 }], opacity: 0.45 * (1 - t.value) }));
  return (
    <View style={styles.pulseWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.pulseRing, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} />
      {!reduce ? <Animated.View style={[styles.pulseRing, { backgroundColor: colors.mapRoute }, ring]} /> : null}
      <View style={[styles.pulseCore, { backgroundColor: colors.primary }]}>
        <Icon name="car" variant="filled" color="onPrimary" />
      </View>
    </View>
  );
}

export function SimulatedNote({ text }: { text: string }) {
  return (
    <View style={styles.inline}>
      <SimulatedBadge />
      <Text variant="footnote" color="textSecondary" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  breakdown: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driver: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  plate: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  response: { gap: spacing.md },
  responseFooter: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  responseAction: { alignItems: 'flex-end', gap: spacing.xs },
  pulseWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  pulseRing: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  pulseCore: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
