import { useState } from 'react';
import { MIN_VEHICLE_YEAR, VEHICLE_CATEGORIES, validateName, validatePlate, validateVehicleYear, type VehicleCategoryId } from '@gobye/core';
import { Button, TextField } from '@gobye/ui';
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
  const [colour, setColour] = useState(v?.colour ?? '');
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
      <TextField label="Colour" value={colour} onChangeText={setColour} placeholder="Silver" error={errors.colour} testID="vehicle-colour" />
      <TextField label="Plate number" value={plate} onChangeText={setPlate} autoCapitalize="characters" autoCorrect={false} placeholder="KJA 123 AB" error={errors.plate} testID="vehicle-plate" />
    </StepShell>
  );
}
