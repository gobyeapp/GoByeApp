import type { Result } from '../types';

/**
 * Is this a usable photo of one person's face? (D-098) A quick check on the phone, from what a face
 * detector reports, so a driver is told to retake a bad photo straight away. It does NOT prove who the
 * person is: matching the face to the ID and checking it is a live person is done on the server by the
 * identity provider.
 */
export interface DetectedFace {
  /** The face's box in image pixels. */
  frame: { left: number; top: number; width: number; height: number };
  /** Head turned left / right, in degrees (0 = facing the camera). */
  rotationY?: number;
  /** Head tilted sideways, in degrees. */
  rotationZ?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
}

export const FACE_PHOTO_RULES = {
  /** The face must be at least this share of the picture's width. */
  minFaceWidth: 0.25,
  /** The middle of the face must be within this share of the picture's middle, each way. */
  maxOffCentre: 0.25,
  /** Degrees the head may be turned or tilted. */
  maxTurn: 20,
  /** Below this for both eyes, the eyes count as closed. */
  eyesOpen: 0.4,
} as const;

export function assessFacePhoto(faces: readonly DetectedFace[], image: { width: number; height: number }): Result<true> {
  const R = FACE_PHOTO_RULES;
  // Tiny faces in the background (a poster, a passer-by far away) don't count as a second person.
  const real = faces.filter((f) => f.frame.width >= image.width * 0.08);
  if (real.length === 0) return { ok: false, error: 'We couldn’t see your face. Face the camera in good light and try again.' };
  if (real.length > 1) return { ok: false, error: 'Only you should be in the photo. Try again on your own.' };
  const f = real[0]!;
  if (f.frame.width < image.width * R.minFaceWidth) return { ok: false, error: 'Move closer so your face fills more of the photo.' };
  const cx = (f.frame.left + f.frame.width / 2) / image.width;
  const cy = (f.frame.top + f.frame.height / 2) / image.height;
  if (Math.abs(cx - 0.5) > R.maxOffCentre || Math.abs(cy - 0.5) > R.maxOffCentre) return { ok: false, error: 'Keep your face in the middle of the photo.' };
  if (Math.abs(f.rotationY ?? 0) > R.maxTurn || Math.abs(f.rotationZ ?? 0) > R.maxTurn) return { ok: false, error: 'Look straight at the camera with your head level.' };
  const l = f.leftEyeOpenProbability;
  const r = f.rightEyeOpenProbability;
  if (l !== undefined && r !== undefined && l < R.eyesOpen && r < R.eyesOpen) return { ok: false, error: 'Your eyes look closed. Take off sunglasses and try again.' };
  return { ok: true, value: true };
}
