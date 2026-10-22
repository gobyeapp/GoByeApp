import { useEffect, useState } from 'react';
import { validateName, validateNigerianPhone } from '@gobye/core';
import { Button, RadioRow, Sheet, Text, TextField } from '@gobye/ui';
import { useBooking } from '@/state/booking';

/**
 * Passenger selector (brief §3): "Book for someone else" lives here rather than as a home tile.
 * The named passenger's details go on the booking so the driver knows who to pick up.
 */
export function PassengerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { rider, setRider } = useBooking();
  const [other, setOther] = useState(!!rider);
  const [name, setName] = useState(rider?.name ?? '');
  const [phone, setPhone] = useState(rider?.phone ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (visible) {
      setOther(!!rider);
      setName(rider?.name ?? '');
      setPhone(rider?.phone ?? '');
      setErrors({});
      setConfirming(false);
    }
  }, [visible, rider]);

  // Typed details that weren't saved: ask before throwing them away (brief §16).
  const dirty = other && (name.trim() !== (rider?.name ?? '') || phone.trim() !== (rider?.phone ?? ''));
  const requestClose = () => (dirty ? setConfirming(true) : onClose());

  const save = () => {
    if (!other) {
      setRider(null);
      return onClose();
    }
    const n = validateName(name, 'Name');
    const p = validateNigerianPhone(phone);
    if (!n.ok || !p.ok) return setErrors({ name: n.ok ? undefined : n.error, phone: p.ok ? undefined : p.error });
    setRider({ name: n.value, phone: p.value });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={requestClose}
      title="Who’s riding?"
      subtitle="Drivers see the first name only."
      footer={
        confirming ? (
          <>
            <Text variant="callout" weight="semibold">
              Discard these details?
            </Text>
            <Button title="Keep editing" variant="secondary" onPress={() => setConfirming(false)} />
            <Button title="Discard" variant="destructive" onPress={onClose} testID="passenger-discard" />
          </>
        ) : (
          <Button title="Done" onPress={save} testID="passenger-done" />
        )
      }
      testID="passenger-sheet"
    >
      <RadioRow title="Me" leadingIcon="account" selected={!other} onSelect={() => setOther(false)} testID="passenger-me" />
      <RadioRow title="Someone else" subtitle="Book a ride for a friend or family member" leadingIcon="userAdd" selected={other} onSelect={() => setOther(true)} testID="passenger-other" />
      {other ? (
        <>
          <TextField label="Passenger’s name" value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" textContentType="name" testID="passenger-name" />
          <TextField label="Passenger’s phone" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" textContentType="telephoneNumber" prefix="+234" testID="passenger-phone" />
          <Text variant="footnote" color="textSecondary">
            You’ll get their pickup PIN to share.
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

// Change pickup lives in its own file; re-exported so existing imports keep working.
export { PickupSheet } from './PickupSheet';
