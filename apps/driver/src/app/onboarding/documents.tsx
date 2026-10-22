import { useState } from 'react';
import { VEHICLE_DOCUMENTS, type VehicleDocumentId } from '@gobye/core';
import { Button } from '@gobye/ui';
import { PhotoCapture, StepShell, goNext } from '@/features/onboarding/parts';
import { useDriver } from '@/state/driver';

/** D07 Vehicle papers: one photo per document. */
export default function Documents() {
  const { application, updateApplication } = useDriver();
  const [docs, setDocs] = useState<Partial<Record<VehicleDocumentId, string>>>(application.documents);
  const complete = VEHICLE_DOCUMENTS.every((d) => !!docs[d.id]);

  const save = () => {
    if (!complete) return;
    goNext('documents', updateApplication({ documents: docs }, 'documents'));
  };

  return (
    <StepShell
      step="documents"
      title="Vehicle papers"
      subtitle="Clear photos of each document. Make sure dates and names are readable."
      footer={<Button title="Continue" onPress={save} disabled={!complete} testID="documents-continue" />}
    >
      {VEHICLE_DOCUMENTS.map((d) => (
        <PhotoCapture key={d.id} label={d.title} hint={d.hint} uri={docs[d.id]} onChange={(uri) => setDocs((p) => ({ ...p, [d.id]: uri }))} testID={`doc-${d.id}`} />
      ))}
    </StepShell>
  );
}
