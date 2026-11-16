/** Turns a user agent into the short, safe strings the protocol allows (ShortText, 1 to 40 chars). */
export function describeBrowser(ua: string): { browser: string; os: string } {
  const pick = (re: RegExp): string | null => {
    const m = re.exec(ua);
    return m === null ? null : (m[1] ?? null);
  };
  let browser = 'Unknown browser';
  const edge = pick(/Edg(?:e|A|iOS)?\/(\d+)/);
  const opera = pick(/OPR\/(\d+)/);
  const firefox = pick(/Firefox\/(\d+)/);
  const chrome = pick(/Chrome\/(\d+)/);
  const safari = pick(/Version\/(\d+)[\d.]* .*Safari/);
  if (edge !== null) browser = `Edge ${edge}`;
  else if (opera !== null) browser = `Opera ${opera}`;
  else if (firefox !== null) browser = `Firefox ${firefox}`;
  else if (chrome !== null) browser = `Chrome ${chrome}`;
  else if (safari !== null) browser = `Safari ${safari}`;

  let os = 'Unknown system';
  if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Windows NT 6\.[23]/.test(ua)) os = 'Windows 8';
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10 or 11';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser: browser.slice(0, 40), os: os.slice(0, 40) };
}
