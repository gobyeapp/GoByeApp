import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Place, SavedPlaceLabel } from '@gobye/core';
import { EmptyState, ErrorState, Icon, IconButton, ListItem, Section, SkeletonGroup, SkeletonRow, spacing, Text, SearchField, useTheme, useToast } from '@gobye/ui';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useCurrentLocation } from '@/state/location';
import { useServices } from '@/state/services';

type Field = 'destination' | 'pickup' | `save-${SavedPlaceLabel}`;

/**
 * R08 — Destination / pickup search. Searches as the user types (HIG search fields) with
 * saved and recent places as suggestions. Results come from the mock MapService (simulated).
 */
export default function SearchScreen() {
  const { field = 'destination', from } = useLocalSearchParams<{ field?: Field; from?: 'options' }>();
  const { colors } = useTheme();
  const toast = useToast();
  const { maps } = useServices();
  const location = useCurrentLocation();
  const account = useAccount();
  const { pickup, destination, setPickup, setDestination } = useBooking();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<TextInput>(null);

  const isSave = field.startsWith('save-');
  const title = isSave ? `Set ${field.replace('save-', '')} address` : field === 'pickup' ? 'Pickup point' : 'Where are you going?';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    const t = setTimeout(() => {
      maps
        .searchPlaces(query, location.coordinate ?? pickup?.coordinate)
        .then((r) => active && setResults(r))
        .catch(() => active && setFailed(true))
        .finally(() => active && setLoading(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, attempt, maps, location.coordinate, pickup?.coordinate]);

  const choose = (place: Place) => {
    if (isSave) {
      account.savePlace(field.replace('save-', '') as SavedPlaceLabel, place);
      toast('Place saved', 'success');
      return router.back();
    }
    account.addRecentPlace(place);
    if (field === 'pickup') {
      setPickup(place);
      if (from === 'options' || !destination) return router.back();
      return router.replace('/booking/options');
    }
    setDestination(place);
    if (!pickup) return router.setParams({ field: 'pickup' });
    // Opened from Options: go back to it (it reloads); otherwise open Options in place of Search.
    if (from === 'options') return router.back();
    router.replace('/booking/options');
  };

  const useCurrent = async () => {
    if (!location.coordinate) return;
    const p = await maps.reverseGeocode(location.coordinate);
    choose({ ...p, title: 'Current location', subtitle: p.title });
  };

  const showSuggestions = !query.trim();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Close" onPress={() => router.back()} />
        <Text variant="headline" style={styles.flex} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
      </View>
      <View style={styles.fields}>
        {!isSave && field === 'destination' ? (
          <Pressable
            style={styles.pickupSummary}
            onPress={() => router.setParams({ field: 'pickup' })}
            accessibilityRole="button"
            accessibilityLabel={`From ${pickup ? pickup.title : 'pickup not set'}. Change pickup`}
          >
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text variant="footnote" color="textSecondary" numberOfLines={1} style={styles.flex}>
              From: {pickup ? pickup.title : 'pickup not set yet'}
            </Text>
            <Icon name="edit" size="xs" color="textSecondary" />
          </Pressable>
        ) : null}
        <SearchField
          ref={input}
          label={field === 'pickup' ? 'Pickup address' : 'Destination'}
          action={query ? { icon: 'close', label: 'Clear search', onPress: () => setQuery('') } : null}
          placeholder={field === 'pickup' ? 'Search pickup address' : 'Search destination'}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          autoCorrect={false}
          testID="search-input"
        />
      </View>

      <FlatList
        data={results ?? []}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          showSuggestions ? (
            <View style={styles.suggestions}>
              {field === 'pickup' && location.permission === 'granted' && location.coordinate ? (
                <ListItem title="Use my location" subtitle={location.accuracyMeters ? `About ±${Math.round(location.accuracyMeters)} m` : undefined} leadingIcon="locate" leadingIconColor="primary" leadingBadge onPress={useCurrent} />
              ) : null}
              {field === 'pickup' ? (
                <ListItem
                  title="Choose on map"
                  leadingIcon="map"
                  leadingIconColor="primary"
                  leadingBadge
                  trailing="chevron"
                  onPress={() => router.replace({ pathname: '/booking/pickup-map', params: from ? { from } : {} })}
                  testID="search-pickup-map"
                />
              ) : null}
              {!isSave && account.savedPlaces.length ? (
                <Section title="Saved">
                  {account.savedPlaces.map((p) => (
                    <ListItem key={p.id} title={p.name} subtitle={`${p.title}, ${p.subtitle}`} leadingIcon={p.label === 'home' ? 'homePlace' : p.label === 'work' ? 'work' : 'heart'} leadingBadge onPress={() => choose(p)} />
                  ))}
                </Section>
              ) : null}
              {account.recentPlaces.length ? (
                <Section title="Recent">
                  {account.recentPlaces.map((p) => (
                    <ListItem key={`r-${p.id}`} title={p.title} subtitle={p.subtitle} leadingIcon="clock" leadingBadge onPress={() => choose(p)} />
                  ))}
                </Section>
              ) : null}
              <Text variant="footnote" weight="semibold" color="textSecondary" accessibilityRole="header">
                PLACES NEARBY
              </Text>
            </View>
          ) : loading && !results?.length ? (
            <SkeletonGroup label="Searching places" style={styles.loading}>
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonRow key={i} trailing={false} avatar />
              ))}
            </SkeletonGroup>
          ) : null
        }
        renderItem={({ item }) => (
          <ListItem title={item.title} subtitle={item.subtitle} leadingIcon="destination" leadingBadge onPress={() => choose(item)} testID={`place-${item.id}`} />
        )}
        ListEmptyComponent={
          failed ? (
            <ErrorState title="Search isn’t working" body="Check your connection, then retry." onRetry={() => setAttempt((a) => a + 1)} />
          ) : !loading && query.trim() ? (
            <EmptyState icon="search" title="No places found" body="Try a landmark, street or area." />
          ) : null
        }
      />
      {!showSuggestions ? null : (
        <View style={styles.footerNote}>
          <Icon name="info" size="xs" color="textSecondary" />
          <Text variant="caption" color="textSecondary">
            Preview addresses: Lagos and Abuja landmarks only.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.md },
  fields: { paddingHorizontal: spacing.screen, gap: spacing.sm, paddingBottom: spacing.sm },
  pickupSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.huge },
  suggestions: { gap: spacing.sm },
  loading: { marginTop: spacing.sm },
  footerNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', padding: spacing.md },
});
