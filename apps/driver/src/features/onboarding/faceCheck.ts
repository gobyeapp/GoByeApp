import { assessFacePhoto, type DetectedFace, type Result } from '@gobye/core';

/**
 * Checks a just-taken photo for one clear face, on the phone, with Google ML Kit (D-098). Free, works
 * offline, and the photo never leaves the device for this. If the detector isn't in this build (an old
 * build, or it failed to load), the photo is accepted as before: staff review and the identity provider's
 * face match are the real checks.
 */
export async function checkFacePhoto(photo: { uri: string; width: number; height: number }): Promise<Result<true>> {
  let faces: DetectedFace[];
  try {
    // Loaded only when needed, so a build without the native module still starts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    const FaceDetection = (require('@react-native-ml-kit/face-detection') as typeof import('@react-native-ml-kit/face-detection')).default;
    faces = await FaceDetection.detect(photo.uri, { performanceMode: 'accurate', classificationMode: 'all', minFaceSize: 0.08 });
  } catch {
    return { ok: true, value: true };
  }
  if (!photo.width || !photo.height) return { ok: true, value: true };
  return assessFacePhoto(faces, photo);
}
