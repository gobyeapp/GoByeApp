import { assessFacePhoto, type DetectedFace } from '../index';

const IMG = { width: 1000, height: 1000 };
const face = (o: Partial<DetectedFace> & { frame?: DetectedFace['frame'] } = {}): DetectedFace => ({ frame: { left: 300, top: 300, width: 400, height: 400 }, rotationY: 0, rotationZ: 0, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9, ...o });
const why = (faces: DetectedFace[]) => {
  const r = assessFacePhoto(faces, IMG);
  return r.ok ? 'ok' : r.error;
};

describe('face photo check (D-098)', () => {
  it('accepts one clear, centred face', () => {
    expect(why([face()])).toBe('ok');
    // A poster in the background doesn't count as a second person.
    expect(why([face(), face({ frame: { left: 10, top: 10, width: 50, height: 50 } })])).toBe('ok');
    // No eye readings (detector without classification): not refused for that.
    expect(why([face({ leftEyeOpenProbability: undefined, rightEyeOpenProbability: undefined })])).toBe('ok');
  });
  it('says what to fix', () => {
    expect(why([])).toMatch(/couldn’t see your face/);
    expect(why([face(), face({ frame: { left: 0, top: 300, width: 300, height: 300 } })])).toMatch(/Only you/);
    expect(why([face({ frame: { left: 400, top: 400, width: 200, height: 200 } })])).toMatch(/Move closer/);
    expect(why([face({ frame: { left: 0, top: 300, width: 400, height: 400 } })])).toMatch(/middle/);
    expect(why([face({ rotationY: 35 })])).toMatch(/straight/);
    expect(why([face({ rotationZ: -30 })])).toMatch(/straight/);
    expect(why([face({ leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.2 })])).toMatch(/eyes/);
    // One eye reading low (a wink, or glare on one lens) is let through.
    expect(why([face({ leftEyeOpenProbability: 0.1 })])).toBe('ok');
  });
});
