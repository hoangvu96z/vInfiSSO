import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import type { Request } from 'express';
import { PageVisit } from './page-visit.entity';
import { RecordVisitDto } from './dto/record-visit.dto';
import { parseUserAgent, lookupIpLocation } from '../contact/device-detector.util';

/**
 * Detect common bot/crawler/preview user agents to filter them out of real visitor stats
 */
function isBotUserAgent(ua = ''): boolean {
  if (!ua) return false;
  return /bot|crawler|spider|crawling|slurp|facebookexternalhit|whatsapp|telegrambot|googlebot|bingbot|yandex|duckduckbot|bytespider|gptbot|headlesschrome/i.test(ua);
}

/**
 * Extract clean client IP address from proxy headers or socket
 */
function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const firstIp = list.split(',')[0].trim();
    if (firstIp) return firstIp.replace(/^::ffff:/, '');
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim().replace(/^::ffff:/, '');
  }
  return (req.ip || req.socket?.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
}

/**
 * Normalize referrer to friendly name
 */
function normalizeReferrer(ref = ''): string {
  if (!ref) return 'Trực tiếp (Direct)';
  try {
    const u = new URL(ref);
    const host = u.hostname.toLowerCase();
    if (host.includes('facebook') || host.includes('fb.com')) return 'Facebook';
    if (host.includes('zalo') || host.includes('zadn')) return 'Zalo';
    if (host.includes('google')) return 'Google Search';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('vunph.id.vn')) return `Nội bộ (${u.pathname.split('/')[1] || 'root'})`;
    return host;
  } catch {
    return ref.slice(0, 50);
  }
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  // In-memory cache for throttling fast duplicate refreshes from same IP + App (10 seconds)
  private readonly recentPings = new Map<string, number>();

  constructor(
    @InjectRepository(PageVisit)
    private readonly visitRepo: Repository<PageVisit>,
  ) {
    // Periodic cleanup of recentPings map every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, ts] of this.recentPings.entries()) {
        if (now - ts > 30000) {
          this.recentPings.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Record an incoming page visit
   */
  async recordVisit(dto: RecordVisitDto, req: Request): Promise<{ ok: boolean }> {
    try {
      const ip = extractClientIp(req);
      const ua = req.headers['user-agent'] || '';
      const isBot = isBotUserAgent(ua);
      const app = (dto.app || 'talkwithme').toLowerCase().trim();

      // Throttle: ignore duplicate pings within 10s from same IP and app (e.g. quick F5)
      const throttleKey = `${ip}:${app}:${dto.path || '/'}`;
      const now = Date.now();
      const lastPing = this.recentPings.get(throttleKey);
      if (lastPing && now - lastPing < 10000) {
        return { ok: true };
      }
      this.recentPings.set(throttleKey, now);

      // Parse device, browser, OS
      const { device, browser, os } = parseUserAgent(ua, {
        screen: dto.screen,
        isMobile: dto.isMobile,
      });

      // Asynchronous IP location lookup (fails gracefully if localhost or offline)
      const geo = await lookupIpLocation(ip).catch(() => null);

      const visit = this.visitRepo.create({
        app,
        path: (dto.path || '/').slice(0, 255),
        ipAddress: ip.slice(0, 64),
        location: geo?.location || (ip === '127.0.0.1' ? 'Localhost' : null),
        isp: geo?.isp || null,
        device: device.slice(0, 100),
        browser: browser.slice(0, 100),
        os: os.slice(0, 80),
        userAgent: ua ? ua.slice(0, 1000) : null,
        referrer: dto.referrer ? dto.referrer.slice(0, 500) : null,
        screen: dto.screen ? dto.screen.slice(0, 50) : null,
        userId: dto.userId || null,
        isBot,
      });

      await this.visitRepo.save(visit);
    } catch (err) {
      this.logger.warn(`Failed to record page visit: ${err instanceof Error ? err.message : err}`);
    }

    return { ok: true };
  }

  /**
   * Query traffic statistics for dashboard
   */
  async getTrafficStats(days = 30, appFilter?: string) {
    const safeDays = Math.min(Math.max(days, 1), 90);
    const now = new Date();
    const sinceDate = new Date();
    sinceDate.setDate(now.getDate() - safeDays + 1);
    sinceDate.setHours(0, 0, 0, 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    // Build base query
    const qb = this.visitRepo.createQueryBuilder('v')
      .where('v.isBot = :isBot', { isBot: false })
      .andWhere('v.createdAt >= :sinceDate', { sinceDate });

    if (appFilter && appFilter !== 'all') {
      qb.andWhere('v.app = :app', { app: appFilter.toLowerCase() });
    }

    const visits = await qb.select([
      'v.id',
      'v.app',
      'v.ipAddress',
      'v.device',
      'v.browser',
      'v.os',
      'v.location',
      'v.referrer',
      'v.createdAt',
    ]).getMany();

    // Summary calculations
    let todayVisits = 0;
    const todayIps = new Set<string>();
    let yesterdayVisits = 0;
    const yesterdayIps = new Set<string>();
    const totalIps = new Set<string>();

    const deviceCounts = new Map<string, number>();
    const browserCounts = new Map<string, number>();
    const locationCounts = new Map<string, number>();
    const referrerCounts = new Map<string, number>();
    const appCounts = new Map<string, number>();

    // Daily breakdown map: 'YYYY-MM-DD' -> { total: 0, uniqueIps: Set }
    const dailyMap = new Map<string, { total: number; ips: Set<string> }>();

    // Prepopulate all days in range so chart has continuous timeline
    for (let d = new Date(sinceDate); d <= now; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dailyMap.set(dateStr, { total: 0, ips: new Set<string>() });
    }

    for (const v of visits) {
      const vTime = new Date(v.createdAt);
      const dateStr = vTime.toISOString().split('T')[0];
      const ip = v.ipAddress || 'unknown';

      totalIps.add(ip);

      if (vTime >= startOfToday) {
        todayVisits++;
        todayIps.add(ip);
      } else if (vTime >= startOfYesterday && vTime < startOfToday) {
        yesterdayVisits++;
        yesterdayIps.add(ip);
      }

      // Daily
      const dayEntry = dailyMap.get(dateStr);
      if (dayEntry) {
        dayEntry.total++;
        dayEntry.ips.add(ip);
      }

      // Device
      const dev = v.device ? v.device.split('·')[0].trim() : 'Desktop';
      deviceCounts.set(dev, (deviceCounts.get(dev) || 0) + 1);

      // Browser
      const br = v.browser || 'Unknown';
      browserCounts.set(br, (browserCounts.get(br) || 0) + 1);

      // Location
      const loc = v.location || 'Chưa xác định';
      locationCounts.set(loc, (locationCounts.get(loc) || 0) + 1);

      // Referrer
      const ref = normalizeReferrer(v.referrer || '');
      referrerCounts.set(ref, (referrerCounts.get(ref) || 0) + 1);

      // App
      const appName = v.app || 'talkwithme';
      appCounts.set(appName, (appCounts.get(appName) || 0) + 1);
    }

    const totalCount = visits.length;

    const toSortedArray = (m: Map<string, number>, limit = 10) =>
      Array.from(m.entries())
        .map(([name, count]) => ({
          name,
          count,
          percentage: totalCount > 0 ? Math.round((count / totalCount) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

    const dailySeries = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      visits: data.total,
      uniqueVisitors: data.ips.size,
    }));

    return {
      summary: {
        todayVisits,
        todayUniqueVisitors: todayIps.size,
        yesterdayVisits,
        yesterdayUniqueVisitors: yesterdayIps.size,
        totalVisits: totalCount,
        totalUniqueVisitors: totalIps.size,
        days: safeDays,
      },
      daily: dailySeries,
      devices: toSortedArray(deviceCounts, 8),
      browsers: toSortedArray(browserCounts, 8),
      locations: toSortedArray(locationCounts, 8),
      referrers: toSortedArray(referrerCounts, 8),
      apps: toSortedArray(appCounts, 10),
    };
  }

  /**
   * Paginated list of recent traffic visits with search
   */
  async getTrafficLogs(page = 1, limit = 50, appFilter?: string, search?: string) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    const qb = this.visitRepo.createQueryBuilder('v')
      .where('v.isBot = :isBot', { isBot: false })
      .orderBy('v.createdAt', 'DESC')
      .skip(skip)
      .take(safeLimit);

    if (appFilter && appFilter !== 'all') {
      qb.andWhere('v.app = :app', { app: appFilter.toLowerCase() });
    }

    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(v.ipAddress) LIKE :s OR LOWER(v.location) LIKE :s OR LOWER(v.device) LIKE :s OR LOWER(v.browser) LIKE :s OR LOWER(v.os) LIKE :s OR LOWER(v.path) LIKE :s OR LOWER(v.referrer) LIKE :s)',
        { s },
      );
    }

    const [logs, total] = await qb.getManyAndCount();

    return {
      logs,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }
}
