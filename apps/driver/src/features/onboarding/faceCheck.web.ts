import type { Result } from '@gobye/core';

/** The browser test build has no face detector (ML Kit is in the phone apps only): photos are accepted. */
export async function checkFacePhoto(_photo: { uri: string; width: number; height: number }): Promise<Result<true>> {
  return { ok: true, value: true };
}
