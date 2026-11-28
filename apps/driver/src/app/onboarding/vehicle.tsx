import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MIN_VEHICLE_YEAR, VEHICLE_CATEGORIES, validateName, validatePlate, validateVehicleYear, type VehicleCategoryId } from '@gobye/core';
import { Button, ColourPicker, Illustration, Text, TextField, carArt, spacing, vehicleColour } from '@gobye/ui';
import { ChoiceRow, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';

const CATEGORY_OPTIONS = VEHICLE_CATEGORIES.map((c) => ({ id: c.id, label: c.name.replace('GoBye ', '') }));

/** D06 Vehicle: what riders will look for at the kerb (colour, make/model, plate) and the ride category. */
export default function Vehicle() {
  const { application, updateApplication } = useDriver();
  const v = application.vehicle;
  const [category, setCategory] = useState<VehicleCategoryId>(v?.category ?? 'go');
  const [make, setMake] = useState(v?.make ?? '');
  const [model, setModel] = useState(v?.model ?? '');
  const [year, setYear] = useState(v ? String(v.year) : '');
  // A colour typed before the picker existed that isn't on the list starts empty, so the driver picks one.
  const [colour, setColour] = useState(vehicleColour(v?.colour)?.name ?? '');
  const [plate, setPlate] = useState(v?.plate ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const save = () => {
    const mk = validateName(make, 'Make');
    const md = validateName(model, 'Model');
    const yr = validateVehicleYear(year, Date.now());
    const cl = validateName(colour, 'Colour');
    const pl = validatePlate(plate);
    setErrors({ make: mk.ok ? undefined : mk.error, model: md.ok ? undefined : md.error, year: yr.ok ? undefined : yr.error, colour: cl.ok ? undefined : cl.error, plate: pl.ok ? undefined : pl.error });
    if (!mk.ok || !md.ok || !yr.ok || !cl.ok || !pl.ok) return;
    goNext('vehicle', updateApplication({ vehicle: { category, make: mk.value, model: md.value, year: yr.value, colour: cl.value, plate: pl.value } }, 'vehicle'));
  };

  return (
    <StepShell
      step="vehicle"
      title="Your vehicle"
      subtitle={`Riders look for the colour, model and plate at pickup. ${MIN_VEHICLE_YEAR} or newer.`}
      footer={<Button title="Continue" onPress={save} disabled={!make || !model || !year || !colour || !plate} testID="vehicle-continue" />}
    >
      <ChoiceRow label="Ride type" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
      <TextField label="Make" value={make} onChangeText={setMake} placeholder="Toyota" error={errors.make} testID="vehicle-make" />
      <TextField label="Model" value={model} onChangeText={setModel} placeholder="Corolla" error={errors.model} testID="vehicle-model" />
      <TextField label="Year" value={year} onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="2016" error={errors.year} testID="vehicle-year" />
      <ColourPicker label="Colour" value={colour} onChange={setColour} error={errors.colour} testID="vehicle-colour" />
      {colour ? (
        <View style={styles.preview} accessible accessibilityLabel={`Riders will see a ${colour.toLowerCase()} car`}>
          <Illustration name="sedan" source={carArt(colour)} size={132} still />
          <Text variant="footnote" color="textSecondary" align="center">
            Riders see your car in this colour.
          </Text>
        </View>
      ) : null}
      <TextField label="Plate number" value={plate} onChangeText={setPlate} autoCapitalize="characters" autoCorrect={false} placeholder="KJA 123 AB" error={errors.plate} testID="vehicle-plate" />
    </StepShell>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: spacing.xs },
});
