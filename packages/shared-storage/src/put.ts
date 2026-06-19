import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client, type S3ClientOptions } from './client.ts';

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: string | Uint8Array;
  contentType?: string;
  /** Optional per-call client overrides (region/endpoint/creds). */
  client?: S3ClientOptions;
}

/** Upload an object to S3. On EC2 with no static keys, getS3Client falls back to
 *  the default credential provider chain (the instance role). */
export async function putObject(input: PutObjectInput): Promise<void> {
  await getS3Client(input.client).send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}
