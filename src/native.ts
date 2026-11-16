export type DesktopInfo = { addresses: string[]; port: number; platform: string; version: string; engine: string };
declare global {
  interface Window {
    backroomsDesktop?: { getConnectionInfo: () => Promise<DesktopInfo>; toggleFullscreen: () => Promise<boolean>; quit: () => Promise<null> };
  }
}
export async function desktopInfo(): Promise<DesktopInfo | null> {
  try { return window.backroomsDesktop ? await window.backroomsDesktop.getConnectionInfo() : null; }
  catch { return null; }
}
window.addEventListener('keydown', event => {
  if (event.code === 'F11' && window.backroomsDesktop) { event.preventDefault(); void window.backroomsDesktop.toggleFullscreen(); }
});
