import { useLocalSearchParams } from 'expo-router';
import { RequestView } from '@/features/requests/RequestView';

/** D11 Incoming Quick Match request. */
export default function QuickMatchRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RequestView id={String(id)} />;
}
