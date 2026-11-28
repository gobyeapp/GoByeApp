import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

/**
 * A small square-ish copy of a profile photo as a data: link (about 128 px wide, a few KB), so it can be
 * shown to the rider with the ride (D-107). Returns undefined if the phone can't make one: the rider then
 * sees the driver's initials, as before.
 */
export async function makeThumb(uri: string): Promise<string | undefined> {
  try {
    const out = await manipulateAsync(uri, [{ resize: { width: 128 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    // Anything unexpectedly large would bloat every ride row: skip it.
    return out.base64 && out.base64.length < 60_000 ? `data:image/jpeg;base64,${out.base64}` : undefined;
  } catch {
    return undefined;
  }
}
