import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { Icon, Screen, Text, spacing } from '@gobye/ui';
import { PageHeader, SettingsGroup, SettingsRow } from '@/features/account/ui';
import { useAccount } from '@/state/account';

/** R21 Saved places. Adding uses the search screen in "save" mode. */
export default function SavedPlaces() {
  const { savedPlaces, removePlace } = useAccount();
  const home = savedPlaces.find((p) => p.label === 'home');
  const work = savedPlaces.find((p) => p.label === 'work');
  const others = savedPlaces.filter((p) => p.label === 'other');

  const remove = (id: string, name: string) =>
    Alert.alert(`Remove ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePlace(id) },
    ]);
  const edit = (label: 'home' | 'work' | 'other') => router.push({ pathname: '/booking/search', params: { field: `save-${label}` } });
  const removeButton = (id: string, name: string) => (
    <Pressable onPress={() => remove(id, name)} accessibilityRole="button" accessibilityLabel={`Remove ${name}`} hitSlop={10} style={styles.remove}>
      <Icon name="delete" size="sm" color="textSecondary" />
    </Pressable>
  );

  return (
    <Screen header={<PageHeader title="Saved places" onBack={() => router.back()} />}>
      <SettingsGroup title="Shortcuts">
        <SettingsRow icon="homePlace" title="Home" subtitle={home ? `${home.title}, ${home.subtitle}` : 'Not set'} onPress={() => edit('home')} trailing={home ? removeButton(home.id, 'Home') : 'chevron'} />
        <SettingsRow icon="work" title="Work" subtitle={work ? `${work.title}, ${work.subtitle}` : 'Not set'} onPress={() => edit('work')} trailing={work ? removeButton(work.id, 'Work') : 'chevron'} />
      </SettingsGroup>
      <SettingsGroup title="Other places">
        {others.map((p) => (
          <SettingsRow key={p.id} icon="heart" title={p.name} subtitle={p.subtitle} trailing={removeButton(p.id, p.name)} />
        ))}
        <SettingsRow icon="plusCircle" title="Add a place" onPress={() => edit('other')} />
      </SettingsGroup>
      <Text variant="footnote" color="textSecondary">
        Saved places appear on Home so you can book them in one tap.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.xs },
});
