import { useLocalSearchParams } from 'expo-router';
import { ReceiptView } from '@/features/receipt/ReceiptView';

/** R18 — Ride detail from Activity (same content as the receipt). */
export default function RideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptView id={id} title="Ride details" />;
}
