import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  formatNaira,
  nairaAccessibilityLabel,
  validateRatingComment,
  type DriverSummary,
  type Kobo,
  type PaymentStatus,
  type Rating,
} from '@gobye/core';
import { Avatar, Button, Icon, StatusBadge, Text, TextField, layout, spacing, useTheme, type ColorTokens, type IconName, type StatusKind } from '@gobye/ui';

/* ---------- Driver identity: photo (or initials), name, rating, completed trips ---------- */

export function DriverHeader({ driver, trailing }: { driver: DriverSummary; trailing?: React.ReactNode }) {
  const name = [driver.firstName, driver.lastName].filter(Boolean).join(' ');
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Driver ${name}, rated ${driver.rating.toFixed(1)}, ${driver.completedTrips.toLocaleString('en-NG')} completed trips`}
    >
      <Avatar uri={driver.photoUrl} name={name} size={52} />
      <View style={styles.flex}>
        <Text variant="headline">{name}</Text>
        <View style={styles.inline}>
          <Icon name="star" variant="filled" size="xs" color="accent" />
          <Text variant="footnote" color="textSecondary">
            {driver.rating.toFixed(1)} · {driver.completedTrips.toLocaleString('en-NG')} trips
          </Text>
        </View>
      </View>
      {trailing}
    </View>
  );
}

/* ---------- Pickup PIN ---------- */

export function PinCard({ pin, riderName }: { pin: string; riderName?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.pin, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
      accessible
      accessibilityLabel={`Pickup PIN ${pin.split('').join(' ')}. ${riderName ? `Share it with ${riderName} so they can give it to the driver.` : 'Tell your driver this PIN before the trip starts.'}`}
    >
      <View style={styles.pinText}>
        <Text variant="subhead" color="textSecondary">
          Pickup PIN
        </Text>
        <Text variant="footnote" color="textSecondary">
          {riderName ? `Share with ${riderName}` : 'Tell your driver before you get in'}
        </Text>
      </View>
      <View style={styles.pinDigits}>
        {pin.split('').map((d, i) => (
          <View key={i} style={[styles.digit, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text variant="title2" tabular>
              {d}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------- Grouped trip-detail rows ---------- */

export function DetailRow({ icon, label, value, iconColor }: { icon: IconName; label: string; value: string; iconColor?: 'primary' | 'accent' | 'text' }) {
  const { colors } = useTheme();
  return (
    <View style={styles.detailRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.iconBox, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name={icon} variant="filled" size="sm" color={iconColor ?? 'text'} />
      </View>
      <View style={styles.flex}>
        <Text variant="caption" color="textSecondary">
          {label}
        </Text>
        <Text variant="callout" numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      {title ? (
        <Text variant="footnote" weight="semibold" color="textSecondary" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={[styles.groupBox, { backgroundColor: colors.surfaceMuted }]}>{children}</View>
    </View>
  );
}


/* ---------- Inset group (car.jpg / drive.jpg): titled pale container holding raised inner cards ---------- */

export function InsetGroup({ title, children, testID }: { title?: string; children: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.inset, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} testID={testID}>
      {title ? (
        <Text variant="subhead" color="textSecondary" accessibilityRole="header" style={styles.insetTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** Raised card inside an InsetGroup. */
export function InsetCard({ children, style }: { children: React.ReactNode; style?: object }) {
  const { colors } = useTheme();
  return <View style={[styles.insetCard, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

/** One label/value line inside an inset card: leading icon, label, trailing value. */
export function InsetLine({ icon, iconColor, label, value, valueMuted, labelNode }: { icon?: IconName; iconColor?: keyof ColorTokens; label: string; value?: string; valueMuted?: string; labelNode?: React.ReactNode }) {
  return (
    <View style={styles.insetLine} accessible accessibilityLabel={`${label}${value ? `, ${value}` : ''}${valueMuted ? ` ${valueMuted}` : ''}`}>
      {labelNode ?? (icon ? <Icon name={icon} variant="filled" size="sm" color={iconColor ?? 'textSecondary'} /> : null)}
      <Text variant="callout" style={styles.flexShrink} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.flex} />
      {value ? (
        <Text variant="callout" color="textSecondary" tabular>
          {value}
          {valueMuted ? <Text variant="callout" color="textSecondary">{`  ${valueMuted}`}</Text> : null}
        </Text>
      ) : null}
    </View>
  );
}

/** Circular header control (car.jpg back / more buttons). */
export function CircleButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [styles.circle, { backgroundColor: pressed ? colors.secondaryPressed : colors.surfaceMuted, borderColor: colors.border }]}
    >
      <Icon name={icon} size="sm" color="text" />
    </Pressable>
  );
}

/* ---------- Payment status labels (paid only when confirmed) ---------- */

export function paymentStatusBadge(status: PaymentStatus | undefined, completed: boolean): { kind: StatusKind; label: string } {
  if (completed || status === 'paid') return { kind: 'successful', label: 'Paid' };
  switch (status) {
    case 'processing':
      return { kind: 'processing', label: 'Processing' };
    case 'failed':
      return { kind: 'failed', label: 'Payment failed' };
    case 'reversed':
      return { kind: 'reversed', label: 'Reversed' };
    case 'refunded':
      return { kind: 'reversed', label: 'Refunded' };
    default:
      return { kind: 'pending', label: 'Payment outstanding' };
  }
}

export function PaymentStatusBadge({ status, completed }: { status: PaymentStatus | undefined; completed: boolean }) {
  const b = paymentStatusBadge(status, completed);
  return <StatusBadge kind={b.kind} label={b.label} />;
}

/* ---------- Big amount ---------- */

export function Amount({ value, label }: { value: Kobo; label?: string }) {
  return (
    <View style={styles.amount} accessible accessibilityLabel={`${label ? `${label}, ` : ''}${nairaAccessibilityLabel(value)}`}>
      {label ? (
        <Text variant="subhead" color="textSecondary">
          {label}
        </Text>
      ) : null}
      <Text variant="largeTitle" tabular align="center">
        {formatNaira(value)}
      </Text>
    </View>
  );
}

/* ---------- Star track (drive.jpg composition, but five discrete stars instead of a slider) ---------- */

export function StarTrack({ value, onChange }: { value: number; onChange: (v: 1 | 2 | 3 | 4 | 5) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.trackRow}>
      <View
        style={[styles.track, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Rate your driver"
        accessibilityValue={{ min: 0, max: 5, now: value, text: value ? `${value} of 5 stars` : 'Not rated' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange((e.nativeEvent.actionName === 'increment' ? Math.min(5, value + 1) : Math.max(1, value - 1)) as 1 | 2 | 3 | 4 | 5)}
      >
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={({ pressed }) => [styles.trackStar, pressed && { opacity: 0.6 }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={`star-${n}`}
          >
            <Icon name="star" variant={n <= value ? 'filled' : 'regular'} size="lg" color={n <= value ? 'accent' : 'textSecondary'} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ---------- Inline rating (1–5 stars, reasons below 3) ---------- */

const LOW_REASONS = ['Late pickup', 'Unsafe driving', 'Rude behaviour', 'Vehicle condition', 'Wrong route', 'Fare issue'];
const HIGH_REASONS = ['Great driving', 'Friendly', 'Clean car', 'On time'];

export function RatingPanel({ bookingId, existing, onSubmit }: { bookingId: string; existing?: Rating; onSubmit: (r: Rating) => void }) {
  const { colors } = useTheme();
  const [stars, setStars] = useState<Rating['stars'] | 0>(existing?.stars ?? 0);
  const [reasons, setReasons] = useState<string[]>(existing?.reasons ?? []);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(!!existing);
  const options = stars > 0 && stars < 3 ? LOW_REASONS : HIGH_REASONS;

  const submit = () => {
    if (!stars) return;
    const c = validateRatingComment(comment);
    if (!c.ok) return setError(c.error);
    if (stars < 3 && reasons.length === 0) return setError('Choose what went wrong.');
    onSubmit({ bookingId, stars, comment: c.value, reasons });
    setSaved(true);
  };

  if (saved && stars) {
    return (
      <View style={styles.inline} accessible accessibilityLabel={`You rated this trip ${stars} out of 5`}>
        <Icon name="star" variant="filled" size="sm" color="accent" />
        <Text variant="callout">You rated this trip {stars} of 5. Thanks!</Text>
      </View>
    );
  }
  return (
    <View style={styles.rating}>
      <StarTrack
        value={stars}
        onChange={(v) => {
          setStars(v);
          setReasons([]);
          setError(undefined);
        }}
      />
      {stars > 0 ? (
        <>
          <View style={styles.chips}>
            {options.map((r) => {
              const on = reasons.includes(r);
              return (
                <Pressable
                  key={r}
                  onPress={() => setReasons((xs) => (on ? xs.filter((x) => x !== r) : [...xs, r]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.chip, { backgroundColor: on ? colors.surfaceSelected : colors.surfaceMuted, borderColor: on ? colors.primary : 'transparent' }]}
                >
                  <Text variant="subhead">{r}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextField label="Comment (optional)" value={comment} onChangeText={setComment} multiline maxLength={320} helper={`${comment.length}/300`} error={error} />
          <Button title="Submit" size="md" onPress={submit} testID="submit-rating" />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  inset: { borderRadius: 24, padding: spacing.sm, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth },
  insetTitle: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  insetCard: { borderRadius: 16, paddingHorizontal: layout.container, paddingVertical: spacing.md, gap: spacing.md, borderWidth: StyleSheet.hairlineWidth },
  insetLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  pin: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.md, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  pinText: { flex: 1, minWidth: 130, gap: 2 },
  pinDigits: { flexDirection: 'row', gap: spacing.xs },
  digit: { width: 40, height: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 52 },
  iconBox: { width: layout.iconBox, height: layout.iconBox, borderRadius: layout.iconBox / 2, alignItems: 'center', justifyContent: 'center' },
  group: { gap: spacing.sm },
  groupBox: { borderRadius: layout.cardRadius, paddingHorizontal: layout.container, paddingVertical: spacing.sm, gap: spacing.xs },
  amount: { alignItems: 'center', gap: spacing.xxs },
  rating: { gap: spacing.md },
  trackRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  track: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderRadius: 20, minHeight: 60, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.xs },
  trackStar: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 22, justifyContent: 'center', borderWidth: 1.5 },
});
