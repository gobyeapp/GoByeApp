import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { spacing, useTheme } from '@gobye/ui';
import type { PromotionPlacement } from '@gobye/core';
import { useServiceConfig } from '@/state/config';
import { PromoCard } from './PromoCard';
import { usePromotions } from './usePromotions';

/**
 * Swipeable promotions with pagination dots. Auto advances at the admin-configured interval; pauses
 * while the user touches it, after they open an offer (until the screen is focused again) and under
 * Reduce Motion. One promotion = a single static card with no dots. All slides share one size.
 */
export function PromoCarousel({ placement, testID }: { placement: PromotionPlacement; testID?: string }) {
  const promos = usePromotions(placement);
  const { promotions } = useServiceConfig();
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const list = useRef<FlatList>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [touching, setTouching] = useState(false);
  const [opened, setOpened] = useState(false);
  const count = promos.length;

  // Coming back to the screen resumes auto advance after an offer was opened.
  useFocusEffect(
    useCallback(() => {
      setOpened(false);
    }, []),
  );

  const intervalMs = promotions.autoAdvanceSeconds * 1000;
  useEffect(() => {
    if (count < 2 || reduce || touching || opened || !intervalMs || !width) return;
    const t = setTimeout(() => {
      const next = (page + 1) % count;
      list.current?.scrollToOffset({ offset: next * width, animated: true });
      setPage(next);
    }, intervalMs);
    return () => clearTimeout(t);
  }, [page, count, reduce, touching, opened, intervalMs, width]);

  if (!count) return null;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    setTouching(false);
  };
  const open = (id: string) => {
    setOpened(true);
    router.push({ pathname: '/promo/[id]', params: { id } });
  };

  if (count === 1) {
    const p = promos[0];
    return (
      <PromoCard title={p.title} body={p.body} art={p.art} accessibilityLabel={`${p.title}. ${p.body} Opens offer`} onPress={() => open(p.id)} testID={testID} />
    );
  }

  return (
    <View onLayout={onLayout} testID={testID} accessibilityRole="adjustable" accessibilityLabel={`Offers, ${page + 1} of ${count}`}>
      {width ? (
        <FlatList
          ref={list}
          data={promos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.id}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScrollBeginDrag={() => setTouching(true)}
          onMomentumScrollEnd={onEnd}
          onTouchStart={() => setTouching(true)}
          onTouchEnd={() => setTouching(false)}
          renderItem={({ item }) => (
            <View style={{ width }}>
              <PromoCard title={item.title} body={item.body} art={item.art} accessibilityLabel={`${item.title}. ${item.body} Opens offer`} onPress={() => open(item.id)} testID={`promo-${item.id}`} />
            </View>
          )}
        />
      ) : null}
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {promos.map((p, i) => (
          <View key={p.id} style={[styles.dot, { width: i === page ? 16 : 6, backgroundColor: i === page ? colors.text : colors.border }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: spacing.sm },
  dot: { height: 6, borderRadius: 3 },
});
