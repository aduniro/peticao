/** These screens must not publish visitor events or show campaign sharing controls. */
export function privateUiPath(path: string) {
  return path.startsWith("/admin") || path.startsWith("/dev") || path === "/presidente" || path.startsWith("/presidente/");
}
