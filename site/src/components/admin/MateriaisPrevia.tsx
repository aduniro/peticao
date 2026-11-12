"use client";
import type { MaterialVersion } from "@/lib/materials-contract";
import { materialPreviewUrl } from "@/lib/materials-ui";
import { MATERIALS_UI_DRAFT_COPY as C } from "@/lib/materials-ui-copy";
export default function MateriaisPrevia({ version }: { version: MaterialVersion | null }) {
  const url = materialPreviewUrl(version);
  return <section className="v2-secao" aria-label={C.preview}><h2>{C.preview}</h2>
    {url && version ? <><p>{C.revision}: {version.revision} · <code>{version.sha256}</code></p><a className="adm-btn" href={url} target="_blank" rel="noopener noreferrer">{C.previewOpen}</a></> : <p>{C.previewEmpty}</p>}
  </section>;
}
