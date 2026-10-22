import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { VEHICLE_DOCUMENTS } from '@gobye/core';
import { PageHeader, Screen, SettingsGroup, SettingsRow, StatusBadge, Text, spacing } from '@gobye/ui';
import { SimNote } from '@/features/common/SimNote';
import { useDriver } from '@/state/driver';

const ID_LABEL = { nin: 'NIN', voters_card: 'Voter’s card', passport: 'Passport' } as const;

/** D17 Documents: what was submitted and its status. Changing a document sends it for review again. */
export default function Documents() {
  const { application, verification } = useDriver();
  const l = application.licence;
  const i = application.identity;
  const approved = verification === 'approved';
  const status = <StatusBadge kind={approved ? 'successful' : 'pending'} label={approved ? 'Verified' : 'In review'} />;

  return (
    <Screen header={<PageHeader title="Documents" onBack={() => router.back()} />}>
      <View style={styles.groups}>
        <SettingsGroup title="You">
          <SettingsRow icon="idcard" title="Driver’s licence" subtitle={l ? `${l.number} · expires ${l.expiry}` : 'Not added'} trailing={status} />
          <SettingsRow icon="userSecurity" title={i ? ID_LABEL[i.type] : 'Identity'} subtitle={i ? `Ending ${i.number.slice(-4)} · selfie added` : 'Not added'} trailing={status} />
        </SettingsGroup>
        <SettingsGroup title="Vehicle" footer="To update a document, contact support. Your account stays active while we review the new one.">
          {VEHICLE_DOCUMENTS.map((d) => (
            <SettingsRow key={d.id} icon="certificate" title={d.title} subtitle={application.documents[d.id] ? 'Photo added' : 'Missing'} trailing={status} />
          ))}
        </SettingsGroup>
        <Text variant="footnote" color="textSecondary">
          Your documents are only used to verify you. Riders never see them.
        </Text>
        <SimNote>Verification is simulated in this preview.</SimNote>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ groups: { gap: spacing.lg, paddingTop: spacing.sm } });
