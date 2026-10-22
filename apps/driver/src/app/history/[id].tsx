import { useLocalSearchParams } from 'expo-router';
import { TripStatement } from '@/features/trip/TripStatement';
import { useDriver } from '@/state/driver';

/** D16 detail: one past trip as a branded earnings statement. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useDriver().history.find((t) => t.id === id);
  return <TripStatement trip={trip} />;
}
