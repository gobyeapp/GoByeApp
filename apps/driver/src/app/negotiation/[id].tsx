import { useLocalSearchParams } from 'expo-router';
import { RequestView } from '@/features/requests/RequestView';

/** D12 Incoming negotiation: accept the rider's offer, counter once, or decline. */
export default function NegotiationRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RequestView id={String(id)} />;
}
