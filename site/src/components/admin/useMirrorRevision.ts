"use client";
import { useEffect, useState } from "react";

export const MIRROR_REVISION_EVENT = "admin:mirror-revision";

/** Re-fetch data without remounting the page or resetting its filters and selection. */
export function useMirrorRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(MIRROR_REVISION_EVENT, refresh);
    return () => window.removeEventListener(MIRROR_REVISION_EVENT, refresh);
  }, []);
  return revision;
}
