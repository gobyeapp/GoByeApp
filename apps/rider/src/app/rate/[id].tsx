import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { validateRatingComment, type Rating } from '@gobye/core';
import { Button, Screen, StarRating, Text, TextField, spacing, useTheme, useToast } from '@gobye/ui';
import { DriverCard } from '@/features/booking/components';
import { useAccount } from '@/state/account';

const LOW_REASONS = ['Late pickup', 'Unsafe driving', 'Rude behaviour', 'Vehicle condition', 'Wrong route', 'Fare issue'];
const HIGH_REASONS = ['Great driving', 'Friendly', 'Clean car', 'On time'];

/** R16 — Rate driver (BR-111: 1–5 stars, comment ≤ 300, reasons prompted below 3). */
export default function RateDriver() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: 'receipt' }>();
  // Opened from a receipt: return to it; after a trip: replace with the receipt.
  const leave = () => (from === 'receipt' && router.canGoBack() ? router.back() : router.replace({ pathname: '/receipt/[id]', params: { id } }));
  const { colors } = useTheme();
  const toast = useToast();
  const { history, addRating } = useAccount();
  const trip = history.find((h) => h.bookingId === id);
  const [stars, setStars] = useState<Rating['stars'] | 0>(0);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>();

  const options = stars > 0 && stars < 3 ? LOW_REASONS : HIGH_REASONS;

  const submit = () => {
    if (!stars) return;
    const c = validateRatingComment(comment);
    if (!c.ok) return setError(c.error);
    if (stars < 3 && reasons.length === 0) return setError('Choose what went wrong.');
    addRating({ bookingId: id, stars, comment: c.value, reasons });
    toast('Thanks for your feedback', 'success');
    leave();
  };

  return (
    <Screen
      footer={
        <>
          <Button title="Submit rating" onPress={submit} disabled={!stars} testID="submit-rating" />
          <Button title="Skip" variant="tertiary" onPress={leave} />
        </>
      }
    >
      <View style={styles.header}>
        <Text variant="title1" align="center" accessibilityRole="header">
          How was your trip?
        </Text>
        {trip?.driver ? <DriverCard driver={trip.driver} /> : null}
      </View>
      <StarRating value={stars} onChange={(v) => { setStars(v); setReasons([]); setError(undefined); }} />
      {stars > 0 ? (
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
      ) : null}
      <TextField label="Comment (optional)" value={comment} onChangeText={setComment} multiline maxLength={320} helper={`${comment.length}/300`} error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.lg, marginTop: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: 22, justifyContent: 'center', borderWidth: 1.5 },
});
