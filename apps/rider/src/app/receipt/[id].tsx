import { useLocalSearchParams } from 'expo-router';
import { ReceiptView } from '@/features/receipt/ReceiptView';

/** R15 — Trip receipt. */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptView id={id} title="Receipt" />;
}
