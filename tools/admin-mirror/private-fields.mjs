import { createCipheriv, createDecipheriv, createHash, constants, randomBytes, publicEncrypt, privateDecrypt } from "node:crypto";

export function decodeCacheField(value, secret, id) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw new Error("MIRROR_FIELD_FORMAT");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret.trim()).digest(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from("signup-contact:v1:" + id)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sealEmail(plain, publicKey, id) {
  if (typeof plain !== "string" || plain.length > 2048) throw new Error("MIRROR_EMAIL_FIELD");
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("mirror-transfer-email:" + id));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, key);
  return ["mirror-mail-v1", wrapped, iv, cipher.getAuthTag(), data].map(value => typeof value === "string" ? value : value.toString("base64url")).join(".");
}

export function protectForLocal(plain, secret, id) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret.trim()).digest(), iv);
  cipher.setAAD(Buffer.from("signup-contact:v1:" + id));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openEmail(envelope, privateKey, localSecret, id) {
  const [version, wrapped, iv, tag, data] = envelope.split(".");
  if (version !== "mirror-mail-v1") throw new Error("MIRROR_FIELD_ENVELOPE");
  const key = privateDecrypt({ key: privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(wrapped, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from("mirror-transfer-email:" + id)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  return protectForLocal(plain, localSecret, id);
}
