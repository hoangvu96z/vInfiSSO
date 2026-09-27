/**
 * Device, Browser, and IP Geolocation detector for Contact messages
 */

export interface ParsedDeviceInfo {
  device: string;
  browser: string;
  os: string;
}

export interface GeoLocationInfo {
  location: string;
  isp?: string;
}

/**
 * Parse User-Agent string and optional client metadata into user-friendly device, browser, and OS info.
 */
export function parseUserAgent(ua = '', clientMeta?: Record<string, any>): ParsedDeviceInfo {
  const uaLower = ua.toLowerCase();

  // 1. Detect OS & Device Model
  let os = 'Unknown OS';
  let device = 'Desktop';

  if (/iphone/i.test(ua)) {
    const vMatch = ua.match(/OS (\d+[._]\d+)/i);
    const v = vMatch ? vMatch[1].replace('_', '.') : '';
    os = v ? `iOS ${v}` : 'iOS';
    device = 'iPhone';
  } else if (/ipad/i.test(ua)) {
    const vMatch = ua.match(/OS (\d+[._]\d+)/i);
    const v = vMatch ? vMatch[1].replace('_', '.') : '';
    os = v ? `iPadOS ${v}` : 'iPadOS';
    device = 'iPad';
  } else if (/android/i.test(ua)) {
    const vMatch = ua.match(/Android\s*([0-9.]+)/i);
    const v = vMatch ? vMatch[1] : '';
    os = v ? `Android ${v}` : 'Android';

    // Try to extract Android manufacturer/model
    const modelMatch = ua.match(/;\s*([A-Za-z0-9\s-]+)\s+Build\//i);
    if (modelMatch && modelMatch[1]) {
      const rawModel = modelMatch[1].trim();
      if (/SM-/i.test(rawModel)) device = `Samsung (${rawModel})`;
      else if (/Redmi|Mi\s|POCO/i.test(rawModel)) device = `Xiaomi (${rawModel})`;
      else if (/CPH|RMX/i.test(rawModel)) device = `Oppo/Realme (${rawModel})`;
      else if (/V2/i.test(rawModel)) device = `Vivo (${rawModel})`;
      else if (/Pixel/i.test(rawModel)) device = rawModel;
      else device = `Android (${rawModel})`;
    } else {
      device = clientMeta?.isMobile ? 'Android Phone' : 'Android Device';
    }
  } else if (/macintosh|mac os x/i.test(ua)) {
    const vMatch = ua.match(/Mac OS X (\d+[._]\d+)/i);
    const v = vMatch ? vMatch[1].replace('_', '.') : '';
    os = v ? `macOS ${v}` : 'macOS';
    device = 'Mac / MacBook';
  } else if (/windows nt/i.test(ua)) {
    const vMatch = ua.match(/Windows NT (\d+\.\d+)/i);
    const ver = vMatch ? vMatch[1] : '';
    if (ver === '10.0') os = 'Windows 10 / 11';
    else if (ver === '6.3') os = 'Windows 8.1';
    else if (ver === '6.1') os = 'Windows 7';
    else os = ver ? `Windows (NT ${ver})` : 'Windows';
    device = 'Windows PC';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
    device = 'Linux PC';
  }

  // 2. Detect Browser
  let browser = 'Unknown Browser';

  // Check In-App Browsers first (very common on mobile from social shares)
  if (/zalo/i.test(ua)) {
    browser = 'Zalo In-App Browser';
  } else if (/fban|fbav/i.test(ua)) {
    browser = 'Facebook In-App Browser';
  } else if (/instagram/i.test(ua)) {
    browser = 'Instagram In-App Browser';
  } else if (/musical_ly|tiktok/i.test(ua)) {
    browser = 'TikTok In-App Browser';
  } else if (/coc_coc/i.test(ua)) {
    const m = ua.match(/coc_coc_browser\/(\d+[\.\d]*)/i);
    browser = m ? `Cốc Cốc ${m[1]}` : 'Cốc Cốc';
  } else if (/samsungbrowser/i.test(ua)) {
    const m = ua.match(/SamsungBrowser\/(\d+[\.\d]*)/i);
    browser = m ? `Samsung Internet ${m[1]}` : 'Samsung Internet';
  } else if (/edg(?:e|a|ios)?\/(\d+[\.\d]*)/i.test(ua)) {
    const m = ua.match(/Edg(?:e|A|iOS)?\/(\d+[\.\d]*)/i);
    browser = m ? `Microsoft Edge ${m[1]}` : 'Microsoft Edge';
  } else if (/chrome\/(\d+[\.\d]*)/i.test(ua) && !/edg/i.test(ua) && !/opr/i.test(ua)) {
    const m = ua.match(/Chrome\/(\d+[\.\d]*)/i);
    browser = m ? `Chrome ${m[1]}` : 'Google Chrome';
  } else if (/firefox\/(\d+[\.\d]*)/i.test(ua)) {
    const m = ua.match(/Firefox\/(\d+[\.\d]*)/i);
    browser = m ? `Firefox ${m[1]}` : 'Mozilla Firefox';
  } else if (/opr\/(\d+[\.\d]*)/i.test(ua)) {
    const m = ua.match(/OPR\/(\d+[\.\d]*)/i);
    browser = m ? `Opera ${m[1]}` : 'Opera';
  } else if (/version\/(\d+[\.\d]*).*safari/i.test(ua)) {
    const m = ua.match(/Version\/(\d+[\.\d]*)/i);
    browser = m ? `Safari ${m[1]}` : 'Safari';
  } else if (/safari/i.test(ua)) {
    browser = 'Safari Mobile';
  }

  // Refine device label with screen if available
  if (clientMeta?.screen) {
    device = `${device} · ${clientMeta.screen}`;
  }

  return { device, browser, os };
}

/**
 * Look up location and ISP by IP address using ip-api.com (free, no API key required).
 * Times out after 2.5 seconds to never slow down message submission.
 */
export async function lookupIpLocation(rawIp?: string | null): Promise<GeoLocationInfo | null> {
  if (!rawIp) return null;

  // Clean IP (e.g. IPv6 mapped IPv4 '::ffff:113.161.x.x')
  const ip = rawIp.replace(/^::ffff:/, '').trim();

  // Skip local / private network IPs
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === 'localhost' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.')
  ) {
    return {
      location: 'Localhost / Mạng nội bộ',
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,city,regionName,isp`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    if (data.status === 'success') {
      const parts: string[] = [];
      if (data.city) parts.push(data.city);
      if (data.regionName && data.regionName !== data.city) parts.push(data.regionName);
      if (data.country) parts.push(data.country);

      return {
        location: parts.join(', ') || 'Việt Nam',
        isp: data.isp || undefined,
      };
    }
  } catch {
    // Fail gracefully on timeout or network error
  }

  return null;
}
