import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { isChatPhoto } from '@gobye/core';

/**
 * Takes a photo of where the person is and shrinks it to something small enough to send as a message
 * (D-108): about 480 px wide. Returns the picture as a data: link, null if they backed out, or an error
 * to show. The camera is only asked for at this moment.
 */
export async function snapForChat(): Promise<{ ok: true; image: string | null } | { ok: false; error: string }> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Allow the camera in Settings to send a photo, or describe where you are.' };
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5 });
    const asset = !res.canceled ? res.assets[0] : undefined;
    if (!asset) return { ok: true, image: null };
    // A second, smaller try covers a very detailed picture that is still too big after the first.
    for (const [width, compress] of [[480, 0.5], [360, 0.4]] as const) {
      const out = await manipulateAsync(asset.uri, [{ resize: { width } }], { compress, format: SaveFormat.JPEG, base64: true });
      const image = out.base64 ? `data:image/jpeg;base64,${out.base64}` : '';
      if (isChatPhoto(image)) return { ok: true, image };
    }
    return { ok: false, error: 'That photo is too large to send. Try again, or describe where you are.' };
  } catch {
    return { ok: false, error: 'We couldn’t open the camera. Describe where you are instead.' };
  }
}
