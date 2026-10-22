import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNaira, type Place } from '@gobye/core';
import { Avatar, Bone, Button, SearchField, Icon, IconButton, MapSheet, SkeletonGroup, Text, layout, minTouch, radii, shadows, spacing, useTheme, useToast } from '@gobye/ui';
import { PassengerSheet, PickupSheet } from '@/features/home/HomeSheets';
import { PromoCarousel } from '@/features/promo/PromoCarousel';
import { MapCanvas, type MapCanvasHandle } from '@/features/map/MapCanvas';
import { liveBannerCopy, liveRoute } from '@/features/navigation/reset';
import { useAccount } from '@/state/account';
import { useBooking } from '@/state/booking';
import { useServiceConfig } from '@/state/config';
import { FALLBACK_CENTER, useCurrentLocation } from '@/state/location';
import { useServices } from '@/state/services';
import { useSession } from '@/state/session';

/**
 * R07 — Home (brief §3–4). Destination entry comes first: a bold "Where are you going?" with the
 * search field right under it. The passenger's own photo is visible; "who's riding" is a selector;
 * pickup is detected but always editable (search, map or current location). Saved places and
 * referrals stay secondary.
 */
export default function Home() {
  const { colors, scheme } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Compact phones (320–359 pt wide or short screens): smaller heading and a lower sheet so the map stays useful.
  const compact = width < 360 || height < 700;
  // The sheet opens tall enough to show everything from "Where are you going?" down to the Home, Work
  // and Saved shortcuts (measured), and expands further for recents.
  const [trayBottom, setTrayBottom] = useState<number | null>(null);
  const opening = trayBottom ? Math.min(Math.max(trayBottom + 28 + spacing.lg, 300), height * 0.8) : compact ? 320 : 360;
  const sheetSnaps = [Math.round(opening), Math.round(Math.max(opening + 120, Math.min(height * 0.86, opening + 260)))];
  const { maps } = useServices();
  const session = useSession();
  const location = useCurrentLocation();
  const { savedPlaces, recentPlaces, ready, unreadCount } = useAccount();
  const { referral } = useServiceConfig();
  const { pickup, setPickup, setDestination, booking, rider, finish } = useBooking();
  const live = booking && booking.status !== 'quoted' ? booking : null;
  const mapRef = useRef<MapCanvasHandle>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [passengerOpen, setPassengerOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const user = session.user;
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  // Auto-fill pickup from the device location (reverse geocoded; simulated addresses in this build).
  // Cancelled if the passenger sets a pickup themselves first, so a late lookup never overwrites it.
  useEffect(() => {
    if (!location.coordinate || pickup) return;
    let active = true;
    maps.reverseGeocode(location.coordinate).then((p) => {
      if (active) setPickup({ ...p, title: 'Current location', subtitle: p.title });
    });
    return () => {
      active = false;
    };
  }, [location.coordinate, pickup, maps, setPickup]);

  // One trip at a time: an unpaid trip is settled before a new booking starts.
  const unpaid = live?.status === 'payment_pending';
  const settleFirst = () => {
    const confirming = live?.paymentStatus === 'processing' || (live?.paymentStatus === 'pending' && !!live.paymentNotice);
    toast(confirming ? 'Your last payment is still being confirmed.' : 'Pay for your last trip first.', 'info');
    router.push('/trip-complete');
  };
  // A paid trip whose summary was never closed is recorded (Activities) before the next booking starts.
  const closePaid = () => {
    if (live?.status === 'completed') finish();
  };

  const goSearch = () => {
    if (unpaid) return settleFirst();
    closePaid();
    if (location.permission === 'undetermined' && !session.locationPrimerSeen) {
      router.push({ pathname: '/permission-location', params: { next: 'search' } });
      return;
    }
    router.push({ pathname: '/booking/search', params: { field: 'destination' } });
  };

  const chooseDestination = (place: Place) => {
    if (unpaid) return settleFirst();
    closePaid();
    setDestination(place);
    if (!pickup) return router.push({ pathname: '/booking/search', params: { field: 'pickup' } });
    router.push('/booking/options');
  };

  const home = savedPlaces.find((p) => p.label === 'home');
  const work = savedPlaces.find((p) => p.label === 'work');

  return (
    <View style={styles.root}>
      <MapCanvas
        ref={mapRef}
        center={location.coordinate ?? FALLBACK_CENTER}
        pickup={pickup?.coordinate}
        pickupAvatarUri={rider ? null : user?.photoUri}
        pickupName={rider?.name ?? user?.firstName}
        showsUserLocation={location.permission === 'granted'}
        bottomInset={sheetSnaps[sheetIndex] ?? sheetSnaps[0]}
        topInset={insets.top + 56}
        testID="home-map"
      />
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.push('/(tabs)/account')}
          accessibilityRole="button"
          accessibilityLabel={`Your account${fullName ? `, ${fullName}` : ''}`}
          style={[styles.avatarButton, shadows.card, { backgroundColor: colors.surface }]}
          testID="home-avatar"
        >
          <Avatar uri={user?.photoUri} name={fullName} size={40} />
        </Pressable>
        <Pressable
          onPress={() => setPassengerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={rider ? `Riding: ${rider.name}. Change passenger` : 'Riding: me. Book for someone else'}
          style={[styles.passenger, shadows.card, { backgroundColor: colors.surface }]}
          testID="passenger-selector"
        >
          <Icon name={rider ? 'userAdd' : 'account'} size="sm" color="text" />
          <Text variant="subhead" weight="semibold" numberOfLines={1} style={styles.passengerText}>
            {rider ? `For ${rider.name.split(' ')[0]}` : 'For me'}
          </Text>
          <Icon name="chevronDown" size="sm" color="textSecondary" />
        </Pressable>
        <View style={styles.flex} />
        {/* The one unread indicator: a dot on the notification bell. */}
        <View>
          <IconButton
            icon="notification"
            variant="floating"
            accessibilityLabel={unreadCount ? `Notifications, ${unreadCount} new` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            testID="home-bell"
          />
          {unreadCount > 0 ? <View pointerEvents="none" style={[styles.bellDot, { backgroundColor: colors.navActive, borderColor: colors.background }]} /> : null}
        </View>
        <IconButton
          icon="locate"
          variant="floating"
          accessibilityLabel="Show my location"
          onPress={() => {
            if (location.permission === 'granted' && location.coordinate) mapRef.current?.recenter(location.coordinate);
            else if (location.permission === 'undetermined') router.push('/permission-location');
            else location.openSettings();
          }}
        />
      </View>

      <MapSheet snapPoints={sheetSnaps} index={sheetIndex} onIndexChange={setSheetIndex} safeAreaBottom={false} testID="home-sheet">
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Everything down to the shortcut tray, measured as one block: the opening snap must show the tray.
              (On the web, onLayout only fires on size changes, so measuring the tray alone missed the
              moment the promo carousel above it finished sizing and pushed it down.) */}
          <View style={styles.lead} onLayout={(e) => setTrayBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          {live ? (
            <Pressable
              onPress={() => router.push(liveRoute(live.status))}
              accessibilityRole="button"
              accessibilityLabel={`${liveBannerCopy(live).title} to ${live.destination.title}. ${liveBannerCopy(live).action}`}
              style={({ pressed }) => [styles.banner, { backgroundColor: colors.brandBanner }, pressed && { opacity: 0.9 }]}
              testID="live-ride-banner"
            >
              <Icon name="car" variant="filled" color={colors.onBrandBanner} />
              <View style={styles.flex}>
                <Text variant="subhead" weight="semibold" style={{ color: colors.onBrandBanner }}>
                  {liveBannerCopy(live).title}
                </Text>
                <Text variant="footnote" style={{ color: colors.onBrandBanner, opacity: 0.85 }} numberOfLines={1}>
                  To {live.destination.title}
                </Text>
              </View>
              <Icon name="chevronRight" color={colors.onBrandBanner} />
            </Pressable>
          ) : null}

          <Text variant={compact ? 'title2' : 'title1'} accessibilityRole="header">
            Where are you going?
          </Text>

          {/* Journey panel: pale outer panel holding a raised card (wallet / profile pattern) */}
          <View style={[styles.panel, { backgroundColor: colors.surfaceMuted }]}>
            <SearchField
              label="Where are you going? Search destination"
              placeholder="Search destination"
              onPress={goSearch}
              action={{ label: 'Search destination', onPress: goSearch }}
              testID="where-to"
            />
            <Pressable
              onPress={() => setPickupOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Pickup: ${pickup ? `${pickup.title}, ${pickup.subtitle}` : 'not set'}. Edit pickup`}
              style={styles.pickupRow}
              testID="edit-pickup"
            >
              <View style={[styles.dot, { backgroundColor: colors.text, borderColor: colors.surfaceMuted }]} />
              <View style={styles.flex}>
                <Text variant="caption" color="textSecondary">
                  Pickup{location.permission === 'granted' && location.accuracyMeters && pickup?.title === 'Current location' ? ` · ±${Math.round(location.accuracyMeters)} m` : ''}
                </Text>
                {!pickup && location.loading ? (
                  <SkeletonGroup label="Finding your location" style={styles.pickupSkeleton}>
                    <Bone width="70%" height={13} />
                  </SkeletonGroup>
                ) : (
                  <Text variant="subhead" weight="medium" numberOfLines={2}>
                    {pickup ? (pickup.title === 'Current location' ? pickup.subtitle : pickup.title) : 'Set pickup point'}
                  </Text>
                )}
              </View>
              <Icon name="edit" size="sm" color="textSecondary" />
            </Pressable>
          </View>

          <LocationNotice />

          {/* Admin-managed promotions (genuine campaigns), right after the location notice. */}
          <PromoCarousel placement="home" testID="home-promo" />

          <View>
          {/* Saved places: one compact shortcut tray. Pale grey container with three equal white items
              (dark: two neutral greys). Addresses aren't previewed here; they show on the next screen. */}
          {!ready ? (
            <SkeletonGroup label="Loading saved places" style={[styles.tray, { backgroundColor: colors.surfaceMuted }]}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.tile, { backgroundColor: scheme === 'dark' ? colors.surfaceSelected : colors.card }]}>
                  <Bone width={18} height={18} radius={9} />
                  <Bone width="50%" height={10} />
                </View>
              ))}
            </SkeletonGroup>
          ) : (
            <View style={[styles.tray, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: scheme === 'dark' ? StyleSheet.hairlineWidth : 0 }]}>
              {[
                {
                  key: 'home',
                  label: 'Home',
                  icon: 'homePlace' as const,
                  a11y: home ? `Go home, ${home.title}` : 'Add home address',
                  onPress: () => (home ? chooseDestination(home) : router.push({ pathname: '/booking/search', params: { field: 'save-home' } })),
                },
                {
                  key: 'work',
                  label: 'Work',
                  icon: 'work' as const,
                  a11y: work ? `Go to work, ${work.title}` : 'Add work address',
                  onPress: () => (work ? chooseDestination(work) : router.push({ pathname: '/booking/search', params: { field: 'save-work' } })),
                },
                { key: 'saved', label: 'Saved', icon: 'heart' as const, a11y: 'Saved places', onPress: () => router.push('/account/places') },
              ].map((t) => (
                <Pressable
                  key={t.key}
                  onPress={t.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={t.a11y}
                  testID={`shortcut-${t.key}`}
                  style={({ pressed }) => [
                    styles.tile,
                    { backgroundColor: pressed ? colors.secondaryPressed : scheme === 'dark' ? colors.surfaceSelected : colors.card },
                    scheme === 'light' && !pressed && styles.tileLift,
                  ]}
                >
                  <Icon name={t.icon} size={18} color="text" />
                  <Text variant="caption" weight="semibold" numberOfLines={1}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          </View>
          </View>

          {recentPlaces.length ? (
            <View style={styles.recents}>
              <Text variant="subhead" weight="semibold" color="textSecondary" accessibilityRole="header">
                Recent
              </Text>
              {recentPlaces.slice(0, 3).map((p, i) => (
                <Pressable
                  key={p.id}
                  onPress={() => chooseDestination(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}, ${p.subtitle}`}
                  style={({ pressed }) => [styles.recentRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}
                >
                  <View style={[styles.recentIcon, { backgroundColor: colors.surfaceMuted }]}>
                    <Icon name="clock" size="sm" color="text" />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="callout" weight="medium" numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                      {p.subtitle}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

        </ScrollView>
      </MapSheet>

      <PassengerSheet visible={passengerOpen} onClose={() => setPassengerOpen(false)} />
      <PickupSheet visible={pickupOpen} onClose={() => setPickupOpen(false)} />
    </View>
  );
}

function LocationNotice() {
  const location = useCurrentLocation();
  const { colors } = useTheme();
  if (location.permission === 'denied' || location.permission === 'restricted') {
    return (
      <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite">
        <Icon name="info" color="textSecondary" />
        <View style={styles.flex}>
          <Text variant="subhead" weight="semibold">
            Location is off
          </Text>
          <Text variant="footnote" color="textSecondary">
            Search for your pickup, or turn location on in Settings.
          </Text>
        </View>
        <Button title="Settings" size="md" variant="secondary" onPress={location.openSettings} />
      </View>
    );
  }
  if (location.permission === 'undetermined') {
    return (
      <Pressable
        onPress={() => router.push('/permission-location')}
        accessibilityRole="button"
        accessibilityLabel="Use my location for pickup"
        style={[styles.notice, { backgroundColor: colors.surfaceSelected }]}
      >
        <Icon name="locate" color="primary" />
        <Text variant="subhead" style={styles.flex}>
          Use your current location for pickup
        </Text>
        <Icon name="chevronRight" color="textSecondary" />
      </Pressable>
    );
  }
  if (location.error) {
    return (
      <View style={[styles.notice, { backgroundColor: colors.dangerSurface }]}>
        <Icon name="warning" color="danger" />
        <Text variant="footnote" style={styles.flex}>
          {location.error}
        </Text>
        <Button title="Retry" size="md" variant="secondary" onPress={location.refresh} />
      </View>
    );
  }
  if (location.approximate) {
    return (
      <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}>
        <Icon name="info" color="textSecondary" />
        <Text variant="footnote" color="textSecondary" style={styles.flex}>
          Approximate location. Check your pickup point.
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  bellDot: { position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: { position: 'absolute', left: layout.page, right: layout.page, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  passenger: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: minTouch, paddingHorizontal: spacing.md, borderRadius: radii.pill, maxWidth: 200 },
  passengerText: { flexShrink: 1 },
  sheetContent: { gap: spacing.lg, paddingBottom: spacing.xxl },
  lead: { gap: spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: layout.container, borderRadius: layout.cardRadius, minHeight: 64 },
  panel: { borderRadius: layout.cardRadius + 4, padding: spacing.xs + 2, gap: 0 },
  pickupRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 56, paddingHorizontal: layout.container - 2, paddingVertical: spacing.sm },
  pickupSkeleton: { paddingTop: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, marginHorizontal: 4 },
  tray: { flexDirection: 'row', gap: spacing.xs + 2, padding: spacing.xs + 2, borderRadius: 18 },
  tile: { flex: 1, minWidth: 0, minHeight: 56, borderRadius: 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tileLift: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.05)' } as object,
  recents: { gap: spacing.xs },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: layout.iconGap, minHeight: 56, paddingVertical: spacing.sm },
  recentIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  invite: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: layout.cardRadius, padding: spacing.md },
  inviteSeal: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, minHeight: minTouch },
});
