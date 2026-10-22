import { Alert, Platform } from 'react-native';

/**
 * Two-button confirmation. Native: the system alert. Web QA build: react-native-web's Alert is a no-op,
 * so the browser's confirm dialog stands in (the web build exists only for screenshot testing).
 */
export function confirmAction(opts: { title: string; message: string; confirm: string; cancel?: string; destructive?: boolean; onConfirm: () => void }) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${opts.title}\n\n${opts.message}`)) opts.onConfirm();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancel ?? 'Cancel', style: 'cancel' },
    { text: opts.confirm, style: opts.destructive ? 'destructive' : 'default', onPress: opts.onConfirm },
  ]);
}
