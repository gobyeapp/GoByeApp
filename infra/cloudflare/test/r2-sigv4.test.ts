import { describe, expect, it } from 'vitest';
import { hexToBase64, presignR2, presignSigV4, uriEncode } from '../src/r2/sigv4';

describe('SigV4 presigning', () => {
  it('matches the published AWS presigned-URL example', async () => {
    // Public example from the AWS S3 documentation ("Authenticating Requests: Using Query Parameters").
    const url = await presignSigV4({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      expiresIn: 86400,
      at: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('presigns R2 path-style URLs, signs required headers, and bounds expiry to 1 hour', async () => {
    const creds = { accountId: 'a'.repeat(32), accessKeyId: 'TESTKEY', secretAccessKey: 'TESTSECRET' };
    const url = new URL(await presignR2(creds, { method: 'PUT', bucket: 'gobye-staging-private-uploads', key: 'driver_licence/abc/2026/10/f1.jpg', expiresIn: 99999, at: new Date('2026-10-22T12:00:00Z'), signedHeaders: { 'content-type': 'image/jpeg', 'content-length': '5000' } }));
    expect(url.host).toBe(`${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe('/gobye-staging-private-uploads/driver_licence/abc/2026/10/f1.jpg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('TESTKEY/20261022/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect((await presignR2(creds, { method: 'GET', bucket: 'gobye-staging-private-documents', key: 'k.jpg' })).includes('X-Amz-Expires=300')).toBe(true);
  });

  it('refuses malformed accounts, buckets and keys', async () => {
    const creds = { accountId: 'a'.repeat(32), accessKeyId: 'k', secretAccessKey: 's' };
    expect(() => presignR2({ ...creds, accountId: 'nope' }, { method: 'GET', bucket: 'b-1', key: 'k' })).toThrow();
    expect(() => presignR2(creds, { method: 'GET', bucket: 'Bad_Bucket', key: 'k' })).toThrow();
    expect(() => presignR2(creds, { method: 'GET', bucket: 'bucket', key: '../secret' })).toThrow();
    await expect(presignSigV4({ method: 'GET', url: 'https://x/y', accessKeyId: 'k', secretAccessKey: 's', region: 'auto', expiresIn: 0, at: new Date() })).rejects.toThrow();
  });

  it('encodes like S3 and converts checksums for x-amz-checksum-sha256', () => {
    expect(uriEncode("a b/c!'()*", true)).toBe('a%20b/c%21%27%28%29%2A');
    expect(hexToBase64('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});
