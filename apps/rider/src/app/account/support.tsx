import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, RadioRow, Screen, Section, SimulatedBadge, Text, TextField, spacing, useToast } from '@gobye/ui';
import { PageHeader } from '@/features/account/ui';
import { useAccount } from '@/state/account';

const TOPICS = ['Fare or payment issue', 'Lost item', 'Driver behaviour', 'Safety concern', 'Account', 'Something else'];

/** R26 — Support request (simulated submission; support channel is open question Q-015). */
export default function Support() {
  const { trip } = useLocalSearchParams<{ trip?: string }>();
  const toast = useToast();
  const { addSupportRequest, supportRequests } = useAccount();
  const [topic, setTopic] = useState<string | null>(trip ? TOPICS[0] : null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sentId, setSentId] = useState<string | null>(null);

  const submit = () => {
    if (!topic) return setError('Choose a topic.');
    if (message.trim().length < 10) return setError('Tell us a little more (at least 10 characters).');
    const id = addSupportRequest(topic, `${trip ? `[Trip ${trip}] ` : ''}${message.trim()}`);
    setSentId(id);
    toast('Request saved (simulated)', 'success');
  };

  if (sentId) {
    return (
      <Screen header={<PageHeader title="Help and support" onBack={() => router.back()} />} footer={<Button title="Done" onPress={() => router.back()} />}>
        <EmptyState icon="checkCircle" title="Request recorded" body={`Reference ${sentId}. Saved on this device only in this preview.`} />
      </Screen>
    );
  }

  return (
    <Screen header={<PageHeader title="Help and support" onBack={() => router.back()} />} footer={<Button title="Submit request" onPress={submit} testID="support-submit" />}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <SimulatedBadge />
        <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
          Support isn’t connected yet. For emergencies call 112.
        </Text>
      </View>
      <Section title="What do you need help with?">
        <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
          {TOPICS.map((t) => (
            <RadioRow key={t} title={t} selected={topic === t} onSelect={() => { setTopic(t); setError(undefined); }} />
          ))}
        </View>
      </Section>
      <TextField label="Describe the issue" value={message} onChangeText={(t) => { setMessage(t); setError(undefined); }} multiline error={error} helper={trip ? `About trip ${trip}` : undefined} />
      {supportRequests.length ? (
        <Text variant="footnote" color="textSecondary">
          Previous requests on this device: {supportRequests.length}
        </Text>
      ) : null}
    </Screen>
  );
}
