import { Pressable, StyleSheet, View } from 'react-native';
import { Illustration, Text, layout, spacing, useTheme, type IllustrationName } from '@gobye/ui';

export interface Promo {
  /** Short, bold headline. */
  title: string;
  /** One concise supporting sentence (includes the key condition). */
  body: string;
  /** 3D render that matches the campaign: sedan for ride offers, gift for rewards, wallet for funding. */
  art: IllustrationName;
  /** Full spoken label, including conditions and where it leads. */
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/**
 * Compact promotional card (Home). Aubergine surface, headline and one sentence on the left, the
 * campaign's 3D render floating gently on the right. The whole card is the action (no separate button).
 * Light: soft layered shadow. Dark: hairline highlight, since shadows don't read on black.
 */
export function PromoCard({ title, body, art, accessibilityLabel, onPress, testID }: Promo) {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.brandBanner, borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'transparent', opacity: pressed ? 0.92 : 1 },
        scheme === 'light' ? styles.depthLight : styles.depthDark,
      ]}
    >
      <View style={styles.text}>
        <Text variant="headline" weight="bold" style={{ color: colors.onBrandBanner }} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="footnote" style={[styles.body, { color: colors.onBrandBanner }]} numberOfLines={2}>
          {body}
        </Text>
      </View>
      <Illustration name={art} size={72} style={styles.art} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 84,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: layout.container,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  depthLight: { boxShadow: '0px 1px 2px rgba(53, 26, 64, 0.16), 0px 6px 16px rgba(53, 26, 64, 0.14)' } as object,
  depthDark: { boxShadow: 'inset 0px 1px 0px rgba(255, 255, 255, 0.08)' } as object,
  text: { flex: 1, minWidth: 0, gap: 2 },
  body: { opacity: 0.86 },
  art: { marginVertical: -spacing.sm },
});
