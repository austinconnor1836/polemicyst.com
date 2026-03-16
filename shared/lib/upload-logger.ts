import { prisma } from './prisma';

export type UploadStage =
  | 'initiate'
  | 'part-url'
  | 'part-upload'
  | 'complete-multipart'
  | 'register'
  | 'from-url';

export type UploadStatus = 'started' | 'success' | 'failed';

interface LogUploadParams {
  userId: string;
  stage: UploadStage;
  status: UploadStatus;
  filename?: string;
  key?: string;
  uploadId?: string;
  partNumber?: number;
  fileSize?: number;
  contentType?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  userAgent?: string;
}

export async function logUpload(params: LogUploadParams): Promise<void> {
  try {
    await prisma.uploadLog.create({
      data: {
        userId: params.userId,
        stage: params.stage,
        status: params.status,
        filename: params.filename ?? null,
        key: params.key ?? null,
        uploadId: params.uploadId ?? null,
        partNumber: params.partNumber ?? null,
        fileSize: params.fileSize ?? null,
        contentType: params.contentType ?? null,
        durationMs: params.durationMs ?? null,
        error: params.error ?? null,
        metadata: (params.metadata as any) ?? undefined,
        userAgent: params.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[upload-logger] Failed to write upload log (non-fatal):', err);
  }
}

export function getUploadContext(req: { headers: { get: (name: string) => string | null } }) {
  return {
    userAgent: req.headers.get('user-agent') ?? undefined,
  };
}
