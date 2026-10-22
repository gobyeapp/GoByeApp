import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  MOCK_PRICING_CONFIG,
  formatCountdown,
  formatNaira,
  isOfferOpen,
  kobo,
  nairaAccessibilityLabel,
  offerErrorMessage,
  selectableResponses,
  selectionErrorMessage,
  stepOffer,
  type Kobo,
} from '@gobye/core';
import { Badge, Bone, Button, Card, IconButton, Screen, ScreenHeader, SkeletonGroup, SkeletonRow, Text, TextField, layout, spacing, useTheme, useToast } from '@gobye/ui';
import { ResponseCard, SearchingPulse, SimulatedNote } from '@/features/booking/components';
import { useCancelRide, useConfirmBeforeBack } from '@/features/booking/useCancelRide';
import { resetTo } from '@/features/navigation/reset';
import { useBooking } from '@/state/booking';
import { useHaptics } from '@/state/haptics';
import { useNow } from '@/state/useNow';

const C = MOCK_PRICING_CONFIG;

/**
 * R11 — Negotiate. Passenger offers a fare within the allowed range (BR-040), drivers accept or
 * counter (BR-043), responses expire (BR-044), selection locks the fare (BR-046) and an
 * unavailable driver can't be assigned (BR-047). All enforced by @gobye/core.
 */
export default function Negotiate() {
  const { colors } = useTheme();
  const toast = useToast();
  const haptic = useHaptics();
  const booking = useBooking();
  const b = booking.booking;
  const now = useNow(500);
  const cancel = useCancelRide();
  const [amount, setAmount] = useState<Kobo>(() => (b?.offer?.amount ?? b?.quote.suggested ?? kobo(0)) as Kobo);
  const [text, setText] = useState(() => String(Math.round((b?.offer?.amount ?? b?.quote.suggested ?? 0) / 100)));
  const [error, setError] = useState<string | undefined>();
  const [composing, setComposing] = useState(!b?.offer);
  const [selecting, setSelecting] = useState<string | null>(null);

  const negotiating = b?.status === 'negotiating';
  useConfirmBeforeBack(negotiating, cancel);

  useEffect(() => {
    if (!b) resetTo('/(tabs)');
    else if (b.status === 'matched' || b.status === 'driver_en_route') resetTo('/trip');
  }, [b]);

  const offer = b?.offer;
  const open = isOfferOpen(offer, now);
  const responses = b ? selectableResponses(b.responses, offer, now) : [];
  const expiredResponses = b ? b.responses.filter((r) => r.offerId === offer?.id && r.expiresAt <= now) : [];
  const roundsLeft = C.negotiation.maxRounds - (offer?.round ?? 0);

  // Offer expiry feedback.
  const offerExpired = !!offer && !open && negotiating;
  useEffect(() => {
    if (offerExpired && responses.length === 0) haptic('warning');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerExpired]);

  if (!b) return null;
  const range = b.quote.negotiationRange;

  const setFromAmount = (k: Kobo) => {
    setAmount(k);
    setText(String(Math.round(k / 100)));
    setError(undefined);
  };

  const send = async () => {
    const naira = Number(text.replace(/[^\d]/g, ''));
    if (!b.offer && b.quote.expiresAt <= Date.now()) {
      const refreshed = await booking.rebook('negotiate');
      if (!refreshed.ok) return toast(refreshed.error, 'error');
      toast('Price refreshed', 'info');
    }
    const r = booking.sendOffer(naira * 100);
    if (!r.ok) {
      haptic('error');
      return setError(offerErrorMessage(r.error));
    }
    haptic('success');
    setComposing(false);
  };

  const select = (id: string) => {
    // Payment is chosen and confirmed after the trip (brief §6), so no wallet check here.
    setSelecting(id);
    const r = booking.selectResponse(id);
    setSelecting(null);
    if (!r.ok) {
      haptic('error');
      return toast(r.error === 'invalid_transition' ? 'This ride has already been matched.' : selectionErrorMessage(r.error), 'error');
    }
    haptic('success');
    toast('Fare agreed. Your driver is on the way.', 'success');
  };

  const startRaise = () => {
    const base = (offer?.amount ?? amount) as Kobo;
    setFromAmount(stepOffer(base, 1, b.quote, C));
    setComposing(true);
  };

  return (
    <Screen
      header={
        <ScreenHeader
          title="Negotiate"
          onBack={negotiating ? cancel : () => (router.canGoBack() ? router.back() : router.replace('/booking/options'))}
          backIcon={negotiating ? 'close' : 'back'}
        />
      }
      footer={
        composing ? (
          <Button
            title={offer ? 'Raise offer' : 'Send offer'}
            trailingText={formatNaira(kobo(Number(text.replace(/[^\d]/g, '') || 0) * 100))}
            onPress={send}
            testID="send-offer"
          />
        ) : (
          <View style={styles.footerRow}>
            {roundsLeft > 0 ? <Button title="Raise offer" variant="secondary" size="md" onPress={startRaise} style={styles.flex} /> : null}
            <Button
              title="Quick Match"
              variant="secondary"
              size="md"
              style={styles.flex}
              onPress={async () => {
                const r = await booking.rebook('quick_match');
                if (!r.ok) return toast(r.error, 'error');
                resetTo('/booking/searching');
              }}
            />
          </View>
        )
      }
    >
      <View style={[styles.farePanel, { backgroundColor: colors.surfaceMuted }]} accessible accessibilityLabel={`Suggested fare ${nairaAccessibilityLabel(b.quote.suggested)}. You can offer ${nairaAccessibilityLabel(range.min)} to ${nairaAccessibilityLabel(range.max)}`}>
        <View style={styles.flex}>
          <Text variant="footnote" color="textSecondary">
            Suggested fare
          </Text>
          <Text variant="title2" tabular>
            {formatNaira(b.quote.suggested)}
          </Text>
        </View>
        <View style={styles.rangeCol}>
          <Text variant="footnote" color="textSecondary">
            Your range
          </Text>
          <Text variant="callout" weight="semibold" tabular>
            {formatNaira(range.min)} to {formatNaira(range.max)}
          </Text>
        </View>
      </View>

      {composing ? (
        <View style={styles.composer}>
          <Text variant="headline" accessibilityRole="header">
            {offer ? 'Raise your offer' : 'Your offer'}
          </Text>
          <View style={styles.stepper}>
            <IconButton
              icon="minusCircle"
              variant="filled"
              accessibilityLabel={`Decrease by ${formatNaira(C.negotiation.stepKobo)}`}
              onPress={() => setFromAmount(stepOffer(amount, -1, b.quote, C))}
              disabled={amount <= Math.max(range.min, offer ? offer.amount + C.negotiation.stepKobo : 0)}
            />
            <View style={styles.flex}>
              <TextField
                label="Offer amount in naira"
                hideLabel
                prefix="₦"
                keyboardType="number-pad"
                value={text}
                onChangeText={(t) => {
                  const digits = t.replace(/[^\d]/g, '').slice(0, 7);
                  setText(digits);
                  setAmount(kobo(Number(digits || 0) * 100));
                  setError(undefined);
                }}
                error={error}
                testID="offer-input"
              />
            </View>
            <IconButton
              icon="plusCircle"
              variant="filled"
              accessibilityLabel={`Increase by ${formatNaira(C.negotiation.stepKobo)}`}
              onPress={() => setFromAmount(stepOffer(amount, 1, b.quote, C))}
              disabled={amount >= range.max}
            />
          </View>
          <Text variant="footnote" color="textSecondary">
            Open for {C.negotiation.offerTtlSeconds}s. You can only raise it
            {roundsLeft < C.negotiation.maxRounds ? ` · ${roundsLeft} left` : ''}.
          </Text>
        </View>
      ) : offer ? (
        <View style={styles.status}>
          <View style={[styles.offerBanner, { backgroundColor: open ? colors.surfaceSelected : colors.surfaceMuted }]}>
            <View style={styles.flex}>
              <Text variant="footnote" color="textSecondary">
                Your offer · round {offer.round} of {C.negotiation.maxRounds}
              </Text>
              <Text variant="title2" tabular accessibilityLabel={nairaAccessibilityLabel(offer.amount)}>
                {formatNaira(offer.amount)}
              </Text>
            </View>
            {open ? (
              <Badge label={`Open ${formatCountdown(offer.expiresAt - now)}`} icon="timer" tone="success" />
            ) : (
              <Badge label="Offer closed" icon="clock" tone="warning" />
            )}
          </View>

          {open && responses.length === 0 ? (
            <View style={styles.waiting}>
              <View style={styles.waitingHead}>
                <SearchingPulse />
                <Text variant="callout" color="textSecondary" style={styles.flex}>
                  Waiting for drivers
                </Text>
              </View>
              <SkeletonGroup label="Waiting for driver responses" style={styles.responses}>
                {[0, 1].map((i) => (
                  <View key={i} style={[styles.skeletonCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <SkeletonRow avatar />
                    <Bone height={44} radius={14} />
                  </View>
                ))}
              </SkeletonGroup>
            </View>
          ) : null}

          {!open && responses.length === 0 ? (
            <Card>
              <Text variant="headline">No driver took this offer</Text>
              <Text variant="callout" color="textSecondary">
                {roundsLeft > 0 ? 'Raise your offer or use Quick Match.' : 'Offer limit reached. Use Quick Match.'}
              </Text>
            </Card>
          ) : null}

          {responses.length > 0 ? (
            <Text variant="headline" accessibilityRole="header">
              {responses.length} driver{responses.length === 1 ? '' : 's'} responded
            </Text>
          ) : null}
          <ScrollView scrollEnabled={false} contentContainerStyle={styles.responses}>
            {responses.map((r) => (
              <ResponseCard key={r.id} response={r} now={now} passengerOffer={offer.amount} onSelect={() => select(r.id)} busy={selecting === r.id} />
            ))}
            {expiredResponses.slice(0, 3).map((r) => (
              <ResponseCard key={r.id} response={r} now={now} passengerOffer={offer.amount} onSelect={() => undefined} />
            ))}
          </ScrollView>
          <SimulatedNote text="Test drivers only" />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  composer: { gap: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  status: { gap: spacing.md },
  offerBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: layout.container + 4, borderRadius: layout.cardRadius },
  waiting: { gap: spacing.md },
  waitingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skeletonCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: layout.cardRadius, padding: layout.container, gap: spacing.sm },
  farePanel: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, padding: layout.container + 4, borderRadius: layout.cardRadius },
  rangeCol: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  responses: { gap: spacing.md },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
});
