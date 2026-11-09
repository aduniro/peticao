import { requestOrigin } from "./net";
type RequestSource = Pick<Request, "url" | "headers">;
export const returnsToPresident = (req: RequestSource) => new URL(req.url).searchParams.get("portal") === "presidente";
/** The only additional return target is a fixed internal portal, never a submitted URL. */
export function batchReturnUrl(req: RequestSource, id?: number) {
  const portal = returnsToPresident(req), url = new URL(portal ? "/admin/presidente" : "/admin/lotes", requestOrigin(req.headers));
  if (portal && id !== undefined && Number.isInteger(id) && id > 0 && id <= 2147483647) url.searchParams.set("lote", String(id));
  return url;
}
