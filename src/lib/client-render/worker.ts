/**
 * Web Worker entry point for client-side rendering.
 * Receives ClientRenderOptions via postMessage, runs the render pipeline,
 * and posts progress updates + final Blob back.
 */
import { render } from './renderer';
import type { WorkerMessage, WorkerResponse } from './types';

// eslint-disable-next-line
const workerSelf = self as any;

workerSelf.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, options } = event.data;

  if (type !== 'start') return;

  try {
    const blob = await render(options, (progress) => {
      const msg: WorkerResponse = { type: 'progress', progress };
      workerSelf.postMessage(msg);
    });

    // Transfer the blob back to the main thread
    const msg: WorkerResponse = { type: 'complete', blob };
    workerSelf.postMessage(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const msg: WorkerResponse = { type: 'error', message };
    workerSelf.postMessage(msg);
  }
};
