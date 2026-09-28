import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for API keys stored in the database (AES-256-GCM). The key is
 * derived from APP_SECRET, which lives only in the environment, so a copy of
 * the database alone does not reveal the keys.
 */

const VERSION = "v1";

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

export const APP_SECRET_MISSING =
  "APP_SECRET is not set. Add a long random value to .env (and your Vercel settings) to store API keys from the dashboard.";

function appSecret(): string | null {
  const s = process.env.APP_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

export function encryptionReady(): boolean {
  return appSecret() !== null;
}

function key(): Buffer {
  const secret = appSecret();
  if (!secret) throw new SecretsError(APP_SECRET_MISSING);
  return createHash("sha256").update(`lead-finder:keys:${secret}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(ciphertext: string): string {
  const [version, iv, tag, data] = ciphertext.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new SecretsError("Stored key has an unknown format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretsError("A stored API key could not be decrypted. Was APP_SECRET changed? Re-add the key in Settings.");
  }
}

/** Stable fingerprint of a key, for duplicate detection. */
export function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim()).digest("hex");
}

export const lastFour = (key: string) => key.trim().slice(-4);
