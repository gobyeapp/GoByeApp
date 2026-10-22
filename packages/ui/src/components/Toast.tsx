import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons/Icon';
import { useTheme } from '../theme/useTheme';
import { radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, message, kind });
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.id} item={toast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const icon = item.kind === 'success' ? 'checkCircle' : item.kind === 'error' ? 'warning' : 'info';
  const iconColor = item.kind === 'success' ? 'successOnInverse' : item.kind === 'error' ? 'dangerOnInverse' : 'onInverse';
  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + spacing.sm }]}>
      <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOut.duration(150)} style={[styles.toast, shadows.float, { backgroundColor: colors.inverseSurface }]}>
        <Icon name={icon} variant="filled" size="sm" color={iconColor} />
        <Text variant="subhead" color="onInverse" style={styles.text}>
          {item.message}
        </Text>
      </Animated.View>
    </View>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.lg, maxWidth: 560 },
  text: { flexShrink: 1 },
});
