import { NextResponse } from 'next/server';

type ErrorCode = 'QUOTA_EXCEEDED' | 'PLAN_RESTRICTED' | 'VALIDATION_ERROR' | 'NOT_FOUND';

interface ApiErrorOptions {
  code?: ErrorCode;
  limit?: number;
  usage?: number;
  allowedProviders?: string[];
}

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message: string, options?: ApiErrorOptions) {
  return NextResponse.json(
    { error: message, ...options },
    { status: 403 }
  );
}

export function badRequest(message: string, options?: ApiErrorOptions) {
  return NextResponse.json(
    { error: message, ...options },
    { status: 400 }
  );
}

export function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message = 'Internal server error', logError?: unknown) {
  if (logError) {
    console.error(message, logError);
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
