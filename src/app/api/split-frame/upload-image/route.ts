import { NextRequest } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { makeS3v3Client, S3_BUCKET, S3_REGION } from '@/lib/s3-client';
import { badRequest, ok, serverError, unauthorized } from '@shared/lib/api-response';

/**
 * POST /api/split-frame/upload-image
 *
 * Multipart-form upload for the still image that will go into the bottom half
 * of a Split-Frame render. Accepts a single `image` field (`File`), uploads it
 * to S3 at `split-frame/<userId>/<uuid>.<ext>`, and returns the S3 URL the
 * client will hand back in the render manifest.
 *
 * Video uploads still go through the standard multipart-upload flow via
 * `VideoUploadService` (background session, chunked); images are small
 * enough that a single foreground `POST` is fine.
 *
 * The route rejects non-image content types up-front so a caller can't smuggle
 * a random file into the split-frame S3 prefix.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Cap on image size — 25 MB is comfortably larger than any HEIC iPhone photo
 *  but stops someone from POSTing a raw camera roll dump. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest('Expected multipart/form-data body');
    }

    const file = formData.get('image');
    if (!file || !(file instanceof File)) {
      return badRequest('Missing "image" file field');
    }

    const contentType = file.type || 'application/octet-stream';
    if (!ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase())) {
      return badRequest(
        `Unsupported image type: ${contentType}. Allowed: ${Array.from(ALLOWED_IMAGE_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return badRequest(`Image is too large (${file.size} bytes); max ${MAX_IMAGE_BYTES} bytes`, {
        code: 'VALIDATION_ERROR',
      });
    }

    // Preserve the original extension so downstream tooling (FFmpeg's image
    // decoder, S3 content-type sniffing, etc.) sees a well-formed key.
    const ext = extForContentType(contentType);
    const key = `split-frame/${user.id}/${randomUUID()}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const s3 = makeS3v3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const imageUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

    return ok({ imageUrl, s3Key: key });
  } catch (err) {
    return serverError('Failed to upload split-frame image', err);
  }
}

function extForContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[ct.toLowerCase()] ?? 'jpg';
}
