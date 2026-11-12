export type OS = "macOS" | "Windows" | "Linux" | "Desktop";
export type DownloadPlatform = Exclude<OS, "Desktop">;

export function detectOS(): OS {
  if (typeof navigator === "undefined") return "Desktop";
  const ua = navigator.userAgent;

  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "Desktop";
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return "Linux";
  return "Desktop";
}
