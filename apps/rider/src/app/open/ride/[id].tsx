import { useLocalSearchParams } from 'expo-router';
import { WhatsAppRideLanding } from '@/features/whatsapp/WhatsAppRideLanding';

/** Deep link from a WhatsApp booking: gobye://open/ride/<id> (D-064). */
export default function OpenRide() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WhatsAppRideLanding rideId={String(id ?? '')} />;
}
