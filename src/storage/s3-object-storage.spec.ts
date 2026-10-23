import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3ObjectStorage } from './s3-object-storage';

describe('S3ObjectStorage', () => {
  const options = {
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'vinfi-private',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    forcePathStyle: true,
  };

  let send: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  let storage: S3ObjectStorage;

  beforeEach(() => {
    send = jest.fn().mockResolvedValue({});
    storage = new S3ObjectStorage(options, { send } as unknown as S3Client);
  });

  it('puts objects without a public ACL or URL', async () => {
    const body = Buffer.from('webp-image');
    await storage.put('notes/abc.webp', body, 'image/webp');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'vinfi-private',
      Key: 'notes/abc.webp',
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'private, no-store',
    });
    expect(command.input.ACL).toBeUndefined();
  });

  it('reads object bytes and reports missing keys as null', async () => {
    send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2, 3])),
      },
    });
    await expect(storage.get('notes/abc.webp')).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);

    send.mockRejectedValueOnce(
      Object.assign(new Error('not found'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(storage.get('notes/missing.webp')).resolves.toBeNull();
  });

  it('deletes objects and surfaces non-404 failures', async () => {
    await storage.delete('notes/abc.webp');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);

    send.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(storage.get('notes/abc.webp')).rejects.toThrow(
      'network unavailable',
    );
  });

  it('rejects unsafe object keys before contacting S3', async () => {
    await expect(storage.get('notes/../../private.env')).rejects.toThrow(
      'Invalid object storage key',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
