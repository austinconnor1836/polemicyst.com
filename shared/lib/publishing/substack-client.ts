import { SubstackError } from './errors';

interface SubstackUser {
  id: number;
  name: string;
  email: string;
  photo_url?: string;
  publicationUsers?: Array<{
    publication: {
      id: number;
      subdomain: string;
      name: string;
      logo_url?: string;
    };
    role: string;
  }>;
}

interface SubstackPublication {
  id: number;
  subdomain: string;
  name: string;
  logo_url?: string;
  author_name?: string;
  custom_domain?: string;
}

interface SubstackImageResponse {
  url: string;
  width: number;
  height: number;
}

interface SubstackDraft {
  id: number;
  title: string;
  subtitle?: string;
  slug: string;
  draft_title: string;
  type: string;
  audience: string;
}

interface SubstackDraftInput {
  title: string;
  subtitle?: string;
  body: Record<string, unknown>; // ProseMirror JSON
  type?: string;
  audience?: string;
}

export interface VerifyResult {
  user: SubstackUser;
  publicationName: string;
  publicationId: number;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class SubstackClient {
  private baseUrl: string;
  private cookie: string;

  constructor(subdomain: string, sessionCookie: string) {
    this.baseUrl = `https://${subdomain}.substack.com`;
    this.cookie = sessionCookie;
  }

  /**
   * Discover the user's publication subdomain using only the session cookie.
   * Calls the main substack.com domain (not a subdomain), so no subdomain is needed upfront.
   * Used by iOS where in-browser API calls are blocked by CSRF.
   */
  static async discoverSubdomain(sessionCookie: string): Promise<string> {
    // If the cookie string already contains "name=value" pairs, use it as-is (iOS sends all cookies).
    // Otherwise, construct the header from just the session ID value (web flow).
    const cookieHeader = sessionCookie.includes('=')
      ? sessionCookie
      : `substack.sid=${sessionCookie}; connect.sid=${sessionCookie}`;
    const browserUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

    // Try multiple endpoints — Substack's API structure varies between main domain and subdomains
    const endpoints = ['https://substack.com/api/v1/me', 'https://substack.com/api/v1/user/self'];

    let lastStatus = 0;
    let lastBody = '';

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Cookie: cookieHeader,
            Accept: 'application/json',
            'User-Agent': browserUA,
          },
          redirect: 'follow',
        });

        lastStatus = response.status;

        if (!response.ok) {
          lastBody = await response.text().catch(() => '');
          console.log(
            `[SubstackClient] ${endpoint} returned ${response.status}: ${lastBody.slice(0, 200)}`
          );
          continue;
        }

        const data = (await response.json()) as Record<string, unknown>;

        // Try publicationUsers (from /api/v1/me)
        const pubUsers = data.publicationUsers as
          | Array<{ publication?: { subdomain?: string } }>
          | undefined;
        if (pubUsers?.length && pubUsers[0].publication?.subdomain) {
          return pubUsers[0].publication.subdomain;
        }

        // Try primaryPublication
        const primary = data.primaryPublication as Record<string, unknown> | undefined;
        if (primary?.subdomain && typeof primary.subdomain === 'string') {
          return primary.subdomain;
        }

        // Fall back to first publication in list
        const publications = data.publications as Array<Record<string, unknown>> | undefined;
        if (publications?.length && typeof publications[0].subdomain === 'string') {
          return publications[0].subdomain;
        }

        // Fall back to username
        if (data.username && typeof data.username === 'string') {
          return data.username;
        }

        console.log(
          `[SubstackClient] ${endpoint} returned 200 but no subdomain found in:`,
          Object.keys(data)
        );
      } catch (err) {
        console.log(`[SubstackClient] ${endpoint} threw:`, (err as Error).message);
      }
    }

    if (lastStatus === 401 || lastStatus === 403) {
      throw new SubstackError('auth_expired', 'Substack session has expired', lastStatus);
    }

    throw new SubstackError(
      'invalid_response',
      `Could not discover Substack subdomain (last status: ${lastStatus}): ${lastBody.slice(0, 200)}`
    );
  }

  /**
   * Validate the session cookie and return user info + publication.
   */
  async verifyConnection(): Promise<VerifyResult> {
    const data = await this.fetchWithRetry<SubstackUser>('/api/v1/me', {
      method: 'GET',
    });

    if (!data.id) {
      throw new SubstackError('auth_expired', 'Invalid session — no user returned', 401);
    }

    // Find the publication for this subdomain
    const pubUser = data.publicationUsers?.[0];
    if (!pubUser?.publication) {
      throw new SubstackError('invalid_response', 'No publication found for this account');
    }

    return {
      user: data,
      publicationName: pubUser.publication.name,
      publicationId: pubUser.publication.id,
    };
  }

  /**
   * Get publication metadata.
   */
  async getPublication(): Promise<SubstackPublication> {
    return this.fetchWithRetry<SubstackPublication>('/api/v1/publication', {
      method: 'GET',
    });
  }

  /**
   * Upload an image (PNG buffer) to Substack's CDN.
   */
  async uploadImage(buffer: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: 'image/png' });
    formData.append('image', blob, filename);

    const response = await this.fetchRaw('/api/v1/images', {
      method: 'POST',
      body: formData,
      // Don't set Content-Type — fetch handles multipart boundary
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new SubstackError(
        'image_upload_failed',
        `Image upload failed (${response.status}): ${text}`,
        response.status,
        response.status >= 500
      );
    }

    const data = (await response.json()) as SubstackImageResponse;
    return data.url;
  }

  /**
   * Create a new draft post.
   */
  async createDraft(post: SubstackDraftInput): Promise<SubstackDraft> {
    return this.fetchWithRetry<SubstackDraft>('/api/v1/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_title: post.title,
        draft_subtitle: post.subtitle || '',
        draft_body: JSON.stringify(post.body),
        type: post.type || 'newsletter',
        audience: post.audience || 'everyone',
      }),
    });
  }

  /**
   * Update an existing draft.
   */
  async updateDraft(draftId: string, post: SubstackDraftInput): Promise<SubstackDraft> {
    return this.fetchWithRetry<SubstackDraft>(`/api/v1/drafts/${draftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_title: post.title,
        draft_subtitle: post.subtitle || '',
        draft_body: JSON.stringify(post.body),
      }),
    });
  }

  /**
   * Publish a draft live.
   */
  async publishDraft(draftId: string): Promise<void> {
    await this.fetchWithRetry(`/api/v1/drafts/${draftId}/publish`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  // ─── Internal ────────────────────────────────────────

  private async fetchRaw(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers || {});
    // Substack renamed their session cookie from connect.sid to substack.sid — send both for compatibility
    headers.set('Cookie', `substack.sid=${this.cookie}; connect.sid=${this.cookie}`);

    try {
      return await fetch(url, { ...init, headers });
    } catch (err) {
      throw new SubstackError(
        'connection_failed',
        `Failed to connect to Substack: ${(err as Error).message}`,
        undefined,
        true
      );
    }
  }

  private async fetchWithRetry<T>(path: string, init: RequestInit, attempt = 1): Promise<T> {
    const response = await this.fetchRaw(path, init);

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Auth errors — not retryable
    if (response.status === 401 || response.status === 403) {
      throw new SubstackError(
        'auth_expired',
        'Substack session has expired — please reconnect',
        response.status
      );
    }

    // Rate limit or server error — retryable
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
      return this.fetchWithRetry<T>(path, init, attempt + 1);
    }

    const text = await response.text().catch(() => '');
    if (response.status === 429) {
      throw new SubstackError('rate_limited', 'Substack rate limit exceeded', 429, true);
    }

    throw new SubstackError(
      'publish_failed',
      `Substack API error (${response.status}): ${text}`,
      response.status,
      response.status >= 500
    );
  }
}
