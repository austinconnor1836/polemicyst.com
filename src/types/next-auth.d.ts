// src/types/next-auth.d.ts
//
// Module augmentation for next-auth v4.
// Also re-declares types whose barrel re-exports break under
// moduleResolution: "bundler" (AuthOptions, NextAuthOptions, getServerSession).

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      providers?: string[];
      googleAccessToken?: string;
      facebookAccessToken?: string;
    };
  }

  interface User {
    id: string;
  }

  // next-auth v4's index.d.ts re-exports these via `export * from "./core/types"`
  // and `export * from "./next"`, but TypeScript "bundler" resolution can't follow
  // those internal subpaths because they're missing from the package exports map.
  // Re-declare them here so the rest of the codebase can import from "next-auth".
  export interface AuthOptions {
    providers: any[];
    adapter?: any;
    callbacks?: any;
    events?: any;
    pages?: any;
    session?: any;
    secret?: string;
    debug?: boolean;
    logger?: any;
    theme?: any;
    [key: string]: any;
  }

  export type NextAuthOptions = AuthOptions;

  export interface Account {
    provider: string;
    providerAccountId: string;
    type: string;
    access_token?: string | null;
    refresh_token?: string | null;
    expires_at?: number | null;
    scope?: string | null;
    token_type?: string | null;
    id_token?: string | null;
    [key: string]: any;
  }

  export function getServerSession(...args: any[]): Promise<Session | null>;
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    sub?: string;
    email?: string | null;
    name?: string | null;
    picture?: string | null;
    googleAccessToken?: string;
    googleRefreshToken?: string;
    facebookAccessToken?: string;
    accessTokenExpires?: number;
    error?: string;
  }

  export function encode(params: { token: JWT; secret: string; maxAge?: number }): Promise<string>;
  export function decode(params: { token: string; secret: string }): Promise<JWT | null>;
  export function getToken(params: {
    req: any;
    secret?: string;
    secureCookie?: boolean;
    cookieName?: string;
    raw?: boolean;
    decode?: (params: { token: string; secret: string }) => Promise<JWT | null>;
  }): Promise<JWT | null>;
}
