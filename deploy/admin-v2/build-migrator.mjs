import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const dependencies = process.env.MIGRATOR_BUILD_DEPS;
if (!dependencies || !process.argv[2]) throw new Error("explicit_dependency_cache_and_output_required");
const require = createRequire(resolve(dependencies, "../package.json"));
const esbuild = require("esbuild"), db = resolve(root, "site/src/lib/db.ts"), output = resolve(process.argv[2]);
const result = await esbuild.build({
  entryPoints: [resolve(here, "migrate.ts")], outfile: output, bundle: true,
  platform: "node", target: "node20", format: "cjs", external: ["pg-native"],
  nodePaths: [dependencies], metafile: true,
  plugins: [{ name: "frozen-base-schema", setup(build) {
    build.onResolve({ filter: /^peticao:migration-base-schema$/ }, () => ({ path: db, namespace: "schema-export" }));
    build.onLoad({ filter: /.*/, namespace: "schema-export" }, () => ({ loader: "ts", resolveDir: dirname(db),
      contents: readFileSync(db, "utf8") + "\nexport { SCHEMA_SQL as MIGRATION_BASE_SCHEMA_SQL };\n" }));
  } }],
});
const sha = data => createHash("sha256").update(data).digest("hex");
const inputs = Object.keys(result.metafile.inputs).map(name => {
  const path = name.startsWith("schema-export:") ? name.slice("schema-export:".length) : resolve(name);
  return { path, sha256: sha(readFileSync(path)) };
});
writeFileSync(output + ".manifest.json", JSON.stringify({ bundleSha256: sha(readFileSync(output)),
  builderSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  virtualExport: "SCHEMA_SQL as MIGRATION_BASE_SCHEMA_SQL; original db.ts bytes preserved", inputs,
  containsCredentials: false, sourceFilesModified: false, activatesApplication: false }, null, 2) + "\n");
console.log(JSON.stringify({ output, inputs: inputs.length, bundleSha256: sha(readFileSync(output)) }));
