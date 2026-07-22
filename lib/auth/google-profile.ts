import { getOAuthState } from "better-auth/api";
import {
  verifyGoogleIdToken,
  type VerifyGoogleIdTokenOptions
} from "better-auth/social-providers";

const GOOGLE_ISSUER = "https://accounts.google.com";
const MAX_ID_TOKEN_AGE_SECONDS = 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

export const OAUTH_NONCE_STATE_KEY = "knfNonce";

export type VerifyGoogleToken = (
  options: VerifyGoogleIdTokenOptions
) => Promise<GoogleTokenClaims | null>;

type GoogleTokenClaims = {
  [key: string]: unknown;
  aud?: string | string[];
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
  iss?: string;
  name?: string;
  nonce?: string;
  picture?: string;
  sub?: string;
};

export function createVerifiedGoogleUserInfo(
  clientId: string,
  verifyToken: VerifyGoogleToken = verifyGoogleIdToken,
  now: () => Date = () => new Date()
) {
  return async function getUserInfo(tokens: { idToken?: string }) {
    const oauthState = await getOAuthState();
    const nonce = oauthState?.[OAUTH_NONCE_STATE_KEY];

    if (
      tokens.idToken === undefined ||
      typeof nonce !== "string" ||
      nonce.length < 32
    ) {
      return null;
    }

    const claims = await verifyToken({
      token: tokens.idToken,
      audience: clientId,
      nonce
    });

    if (!isAcceptedGoogleIdentity(claims, clientId, nonce, now())) {
      return null;
    }

    return {
      user: {
        id: claims.sub,
        name: typeof claims.name === "string" ? claims.name : "",
        email: claims.email,
        image: typeof claims.picture === "string" ? claims.picture : undefined,
        emailVerified: true
      },
      data: {
        issuer: claims.iss,
        subject: claims.sub
      }
    };
  };
}

function isAcceptedGoogleIdentity(
  claims: GoogleTokenClaims | null,
  clientId: string,
  nonce: string,
  now: Date
): claims is GoogleTokenClaims & {
  sub: string;
  email: string;
  email_verified: true;
  nonce: string;
} {
  if (
    claims === null ||
    claims.iss !== GOOGLE_ISSUER ||
    claims.aud !== clientId ||
    claims.nonce !== nonce ||
    claims.email_verified !== true ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    claims.sub.length > 255 ||
    typeof claims.email !== "string" ||
    claims.email.length === 0 ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number"
  ) {
    return false;
  }

  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return (
    claims.exp > nowSeconds - MAX_CLOCK_SKEW_SECONDS &&
    claims.iat <= nowSeconds + MAX_CLOCK_SKEW_SECONDS &&
    claims.iat >= nowSeconds - MAX_ID_TOKEN_AGE_SECONDS - MAX_CLOCK_SKEW_SECONDS
  );
}
