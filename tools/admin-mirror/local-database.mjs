import { execFileSync } from "node:child_process";

/** Resolve only the dedicated local Docker database; production URLs are rejected. */
export function localDatabaseUrl(configuration) {
  const url = new URL(configuration.ownerUrl);
  if (url.hostname !== "127.0.0.1" || url.port !== "54348" || url.pathname !== "/admin_mirror" || url.username !== "admin_mirror_owner") throw new Error("MIRROR_LOCAL_DATABASE_REQUIRED");
  const internal = execFileSync("docker", ["network", "inspect", "--format", "{{.Internal}}", "peticao-admin-mirror"], { encoding: "utf8" }).trim();
  const networks = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Networks}}", "peticao-admin-mirror-db"], { encoding: "utf8" }));
  const address = networks["peticao-admin-mirror"]?.IPAddress;
  if (internal !== "true" || !/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\d/.test(address ?? "")) throw new Error("MIRROR_LOCAL_NETWORK_REQUIRED");
  // Internal Docker networks do not publish ports on this host; use the verified local bridge address.
  url.hostname = address; url.port = "5432";
  return url.href;
}
