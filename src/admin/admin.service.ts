import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, MoreThan } from 'typeorm';
import { User } from '../users/user.entity';
import { Session } from '../users/session.entity';
import { AuditLog } from '../users/audit-log.entity';
import { Reading } from '../readings/reading.entity';
import { AiUsage } from '../plans/ai-usage.entity';
import { parseAdminDateRange } from '../common/admin-date-range.util';

function getExclusiveUtcDay(date?: Date): string | null {
  if (!date) return null;

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  if (date.getTime() > dayStart.getTime()) {
    dayStart.setUTCDate(dayStart.getUTCDate() + 1);
  }
  return dayStart.toISOString().slice(0, 10);
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @InjectRepository(Reading)
    private readonly readingRepo: Repository<Reading>,
    @InjectRepository(AiUsage)
    private readonly aiUsageRepo: Repository<AiUsage>,
    private readonly dataSource: DataSource,
  ) {}

  async logActivity(
    userId: string | null,
    action: string,
    app?: string | null,
    ipAddress?: string | null,
    userAgent?: string | null,
    metadata?: Record<string, any> | null,
  ): Promise<AuditLog> {
    const log = this.auditLogRepo.create({
      userId,
      action,
      app: app ?? 'sso',
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      metadata: metadata ?? null,
    });
    return this.auditLogRepo.save(log);
  }

  async getDashboardStats() {
    const totalUsers = await this.userRepo.count();
    const activeSessions = await this.sessionRepo.count({
      where: { expiresAt: MoreThan(new Date()) },
    });
    const readingStats = await this.readingRepo
      .createQueryBuilder('reading')
      .select('COUNT(*)', 'totalReadings')
      .addSelect(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'iching')`,
        'totalIchingReadings',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'tarot')`,
        'totalTarotReadings',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) LIKE '%tuvi%')`,
        'totalTuviReadings',
      )
      .getRawOne<{
        totalReadings: string | number;
        totalIchingReadings: string | number;
        totalTarotReadings: string | number;
        totalTuviReadings: string | number;
      }>();

    const totalReadings = Number(readingStats?.totalReadings ?? 0);
    const totalIchingReadings = Number(readingStats?.totalIchingReadings ?? 0);
    const totalTarotReadings = Number(readingStats?.totalTarotReadings ?? 0);
    const totalTuviReadings = Number(readingStats?.totalTuviReadings ?? 0);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStr = startOfToday.toISOString().split('T')[0];

    const todayLogins = await this.auditLogRepo.count({
      where: { action: 'login', createdAt: MoreThan(startOfToday) },
    });

    // Aggregate from ai_usage in the database rather than hydrating every row.
    const aiUsageStats = await this.aiUsageRepo
      .createQueryBuilder('usage')
      .select('COALESCE(SUM(usage.monthlyCount), 0)', 'totalAiQuestions')
      .addSelect(
        'COALESCE(SUM(CASE WHEN usage.date = :today THEN usage.dailyCount ELSE 0 END), 0)',
        'todayAiQuestions',
      )
      .setParameter('today', todayStr)
      .getRawOne<{
        totalAiQuestions: string | number;
        todayAiQuestions: string | number;
      }>();

    const totalAiQuestions = Number(aiUsageStats?.totalAiQuestions ?? 0);
    const todayAiQuestions = Number(aiUsageStats?.todayAiQuestions ?? 0);

    return {
      totalUsers,
      activeSessions,
      totalReadings,
      totalIchingReadings,
      totalTarotReadings,
      totalTuviReadings,
      totalAiQuestions,
      todayLogins,
      todayAiQuestions,
    };
  }

  async getUsers(
    page = 1,
    limit = 20,
    search = '',
    role = '',
    dateFrom?: string,
    dateTo?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const { start, end } = parseAdminDateRange(dateFrom, dateTo);
    const query = this.userRepo
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.username',
        'user.displayName',
        'user.role',
        'user.planName',
        'user.isVerified',
        'user.createdAt',
      ])
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'ASC');

    if (search) {
      query.andWhere(
        '(user.email ILIKE :search OR user.displayName ILIKE :search OR user.username ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    if (role) {
      query.andWhere('user.role = :role', { role });
    }

    if (start) {
      query.andWhere('user.createdAt >= :dateFrom', { dateFrom: start });
    }
    if (end) {
      query.andWhere('user.createdAt < :dateTo', { dateTo: end });
    }

    const [users, total] = await query
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    const userStatsMap = new Map<
      string,
      { readingsCount: number; aiQuestionsCount: number }
    >();
    const userIds = users.map((user) => user.id);
    const activeSessionsByUser = new Map<string, number>();
    if (userIds.length) {
      const sessions = await this.dataSource.query<
        Array<{ userId: string; count: number }>
      >(
        `SELECT user_id AS "userId", COUNT(*)::int AS count
         FROM sessions WHERE user_id = ANY($1::uuid[]) AND expires_at > NOW()
         GROUP BY user_id`,
        [userIds],
      );
      for (const row of sessions)
        activeSessionsByUser.set(row.userId, Number(row.count));

      const readingCounts = await this.dataSource.query<
        Array<{ userId: string; count: number }>
      >(
        `SELECT user_id AS "userId", COUNT(*)::int AS count
         FROM readings WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
        [userIds],
      );
      for (const row of readingCounts) {
        userStatsMap.set(row.userId, {
          readingsCount: Number(row.count),
          aiQuestionsCount: 0,
        });
      }
      const aiCounts = await this.dataSource.query<
        Array<{ userId: string; count: number }>
      >(
        `SELECT "userId" AS "userId", COALESCE(SUM("monthlyCount"), 0)::int AS count
         FROM ai_usage WHERE "userId" = ANY($1::uuid[]) GROUP BY "userId"`,
        [userIds],
      );
      for (const row of aiCounts) {
        const current = userStatsMap.get(row.userId) || {
          readingsCount: 0,
          aiQuestionsCount: 0,
        };
        current.aiQuestionsCount = Number(row.count);
        userStatsMap.set(row.userId, current);
      }
    }

    const mappedUsers = users.map((u) => {
      const stats = userStatsMap.get(u.id) || {
        readingsCount: 0,
        aiQuestionsCount: 0,
      };
      return {
        id: u.id,
        email: u.email,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        planName: u.planName,
        isVerified: u.isVerified,
        createdAt: u.createdAt,
        activeSessionsCount: activeSessionsByUser.get(u.id) || 0,
        readingsCount: stats.readingsCount,
        aiQuestionsCount: stats.aiQuestionsCount,
      };
    });

    return {
      users: mappedUsers,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async updateUserRole(
    userId: string,
    role: string,
    actorId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ) {
    const validRoles = ['user', 'admin', 'vip', 'editor'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Role không hợp lệ. Các role cho phép: ${validRoles.join(', ')}`,
      );
    }
    if (!actorId?.trim()) {
      throw new BadRequestException('Thiếu thông tin quản trị viên thực hiện');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'admin-role-change',
      ]);
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng');
      const previousRole = user.role;
      if (actorId === userId && previousRole === 'admin' && role !== 'admin') {
        throw new BadRequestException(
          'Không thể tự gỡ quyền quản trị của mình',
        );
      }
      if (previousRole === 'admin' && role !== 'admin') {
        const adminCount = await users.count({ where: { role: 'admin' } });
        if (adminCount <= 1)
          throw new BadRequestException(
            'Không thể gỡ quyền của quản trị viên cuối cùng',
          );
      }

      user.role = role;
      await users.save(user);
      if (previousRole !== role) {
        await manager.getRepository(Session).delete({ user: { id: userId } });
      }
      await manager.getRepository(AuditLog).save({
        userId: actorId,
        action: 'update_role',
        app: 'sso',
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          actorId,
          targetUserId: userId,
          previousRole,
          newRole: role,
        },
      });
      return {
        success: true,
        user: { id: user.id, email: user.email, role: user.role },
      };
    });
  }

  async updateUserStatus(userId: string, isVerified: boolean) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    user.isVerified = isVerified;
    await this.userRepo.save(user);

    await this.logActivity(userId, 'update_status', 'sso', null, null, {
      isVerified,
    });
    return {
      success: true,
      user: { id: user.id, email: user.email, isVerified: user.isVerified },
    };
  }

  async revokeUserSessions(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    await this.sessionRepo.delete({ user: { id: userId } });

    await this.logActivity(userId, 'revoke_sessions', 'sso', null, null, {
      revokedByAdmin: true,
    });
    return {
      success: true,
      message: `Đã hủy tất cả phiên đăng nhập của ${user.email}`,
    };
  }

  async revokeMultipleUserSessions(userIds: string[]) {
    if (!userIds || userIds.length === 0) return { success: true, count: 0 };
    for (const userId of userIds) {
      await this.sessionRepo.delete({ user: { id: userId } });
      await this.logActivity(
        userId,
        'revoke_sessions_batch',
        'sso',
        null,
        null,
        { revokedByAdmin: true },
      );
    }
    return {
      success: true,
      count: userIds.length,
      message: `Đã hủy phiên đăng nhập của ${userIds.length} người dùng`,
    };
  }

  async getAuditLogs(
    page = 1,
    limit = 30,
    action = '',
    search = '',
    dateFrom?: string,
    dateTo?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const { start, end } = parseAdminDateRange(dateFrom, dateTo);
    const query = this.auditLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'ASC');

    if (action) {
      query.andWhere('log.action = :action', { action });
    }

    if (search) {
      query.andWhere(
        '(user.email ILIKE :search OR log.ipAddress ILIKE :search OR log.app ILIKE :search)',
        {
          search: `%${search}%`,
        },
      );
    }

    if (start)
      query.andWhere('log.createdAt >= :dateFrom', { dateFrom: start });
    if (end) query.andWhere('log.createdAt < :dateTo', { dateTo: end });

    const [logs, total] = await query
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    const mappedLogs = logs.map((l) => ({
      id: l.id,
      action: l.action,
      app: l.app,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      metadata: l.metadata,
      createdAt: l.createdAt,
      user: l.user
        ? {
            id: l.user.id,
            email: l.user.email,
            displayName: l.user.displayName,
            role: l.user.role,
          }
        : null,
    }));

    return {
      logs: mappedLogs,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async getAiUsageStats(
    page?: number,
    limit?: number,
    search = '',
    dateFrom?: string,
    dateTo?: string,
  ) {
    const isPaginated = page !== undefined || limit !== undefined;
    const safePage = Math.max(1, page ?? 1);
    const safeLimit = Math.min(100, Math.max(1, limit ?? 20));
    const { start, end } = parseAdminDateRange(dateFrom, dateTo);
    const startDay = start?.toISOString().slice(0, 10) ?? null;
    const endDay = getExclusiveUtcDay(end);
    const parameters = [
      start?.toISOString() ?? null,
      end?.toISOString() ?? null,
      startDay,
      endDay,
      search.trim() ? `%${search.trim()}%` : null,
    ];
    const filteredStatsSql = `
      WITH reading_stats AS (
        SELECT reading.user_id,
          COUNT(*) FILTER (WHERE lower(reading.app) = 'iching')::int AS "ichingReadings",
          COUNT(*) FILTER (WHERE lower(reading.app) = 'tarot')::int AS "tarotReadings",
          COUNT(*) FILTER (WHERE lower(reading.app) LIKE '%tuvi%')::int AS "tuviReadings",
          MAX(reading.created_at) AS "lastActive"
        FROM readings reading
        WHERE ($1::timestamptz IS NULL OR reading.created_at >= $1::timestamptz)
          AND ($2::timestamptz IS NULL OR reading.created_at < $2::timestamptz)
        GROUP BY reading.user_id
      ), ai_stats AS (
        SELECT usage."userId",
          SUM(CASE WHEN $3::text IS NULL AND $4::text IS NULL
            THEN usage."monthlyCount" ELSE usage."dailyCount" END)::int AS "totalAiQuestions",
          MAX(usage."updatedAt") AS "lastAiActive"
        FROM ai_usage usage
        WHERE ($3::text IS NULL OR usage.date >= $3::text)
          AND ($4::text IS NULL OR usage.date < $4::text)
        GROUP BY usage."userId"
      )
      SELECT u.id AS "userId", u.email AS email,
        COALESCE(u."displayName", u.username, 'User') AS "displayName",
        COALESCE(u.role, 'user') AS role,
        COALESCE(r."ichingReadings", 0)::int AS "ichingReadings",
        COALESCE(r."tarotReadings", 0)::int AS "tarotReadings",
        COALESCE(r."tuviReadings", 0)::int AS "tuviReadings",
        COALESCE(ai."totalAiQuestions", 0)::int AS "totalAiQuestions",
        COALESCE(r."lastActive", ai."lastAiActive") AS "lastActive"
      FROM users u
      LEFT JOIN reading_stats r ON r.user_id = u.id
      LEFT JOIN ai_stats ai ON ai."userId" = u.id
      WHERE (r.user_id IS NOT NULL OR ai."userId" IS NOT NULL)
        AND ($5::text IS NULL OR u.email ILIKE $5::text
          OR COALESCE(u."displayName", u.username, 'User') ILIKE $5::text)
    `;
    const pageParameters = [
      ...parameters,
      safeLimit,
      (safePage - 1) * safeLimit,
    ];
    const orderSql = `${filteredStatsSql}
      ORDER BY "totalAiQuestions" DESC, email ASC, "userId" ASC`;
    const rowQuery = this.dataSource.query<
      Array<{
        userId: string;
        email: string;
        displayName: string;
        role: string;
        ichingReadings: number | string;
        tarotReadings: number | string;
        tuviReadings: number | string;
        totalAiQuestions: number | string;
        lastActive: Date | null;
      }>
    >(
      isPaginated ? `${orderSql}\nLIMIT $6 OFFSET $7` : orderSql,
      isPaginated ? pageParameters : parameters,
    );
    const aggregatesQuery = isPaginated
      ? this.dataSource.query<
          Array<{
            total: number | string;
            totalIchingReadings: number | string;
            totalTarotReadings: number | string;
            totalTuviReadings: number | string;
            totalAiQuestions: number | string;
          }>
        >(
          `SELECT COUNT(*)::int AS total,
            COALESCE(SUM("ichingReadings"), 0)::int AS "totalIchingReadings",
            COALESCE(SUM("tarotReadings"), 0)::int AS "totalTarotReadings",
            COALESCE(SUM("tuviReadings"), 0)::int AS "totalTuviReadings",
            COALESCE(SUM("totalAiQuestions"), 0)::int AS "totalAiQuestions"
           FROM (${filteredStatsSql}) filtered_stats`,
          parameters,
        )
      : Promise.resolve([]);
    const [rows, aggregates] = await Promise.all([rowQuery, aggregatesQuery]);
    const aggregate = aggregates[0] || {};
    const list = rows.map((row) => ({
      ...row,
      ichingReadings: Number(row.ichingReadings),
      tarotReadings: Number(row.tarotReadings),
      tuviReadings: Number(row.tuviReadings),
      totalAiQuestions: Number(row.totalAiQuestions),
    }));
    const total = isPaginated ? Number(aggregate.total ?? 0) : list.length;
    const fullListTotals = isPaginated
      ? null
      : list.reduce(
          (totals, row) => ({
            totalIchingReadings:
              totals.totalIchingReadings + row.ichingReadings,
            totalTarotReadings: totals.totalTarotReadings + row.tarotReadings,
            totalTuviReadings: totals.totalTuviReadings + row.tuviReadings,
            totalAiQuestions: totals.totalAiQuestions + row.totalAiQuestions,
          }),
          {
            totalIchingReadings: 0,
            totalTarotReadings: 0,
            totalTuviReadings: 0,
            totalAiQuestions: 0,
          },
        );

    const response = {
      summary: {
        totalUsersWithReadings: total,
        totalIchingReadings: isPaginated
          ? Number(aggregate.totalIchingReadings ?? 0)
          : fullListTotals!.totalIchingReadings,
        totalTarotReadings: isPaginated
          ? Number(aggregate.totalTarotReadings ?? 0)
          : fullListTotals!.totalTarotReadings,
        totalTuviReadings: isPaginated
          ? Number(aggregate.totalTuviReadings ?? 0)
          : fullListTotals!.totalTuviReadings,
        totalAiQuestions: isPaginated
          ? Number(aggregate.totalAiQuestions ?? 0)
          : fullListTotals!.totalAiQuestions,
      },
      userAiStats: list,
    };

    return isPaginated
      ? {
          ...response,
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        }
      : response;
  }

  async getAnalyticsData() {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split('T')[0];

    const recentLogs = await this.auditLogRepo.find({
      where: { createdAt: MoreThan(fourteenDaysAgo) },
      order: { createdAt: 'ASC' },
    });

    const daysMap = new Map<
      string,
      { logins: number; registers: number; ai: number }
    >();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      daysMap.set(dateStr, { logins: 0, registers: 0, ai: 0 });
    }

    const geoMap = new Map<string, number>();

    recentLogs.forEach((log) => {
      const dateStr = new Date(log.createdAt).toISOString().split('T')[0];
      const entry = daysMap.get(dateStr);
      if (entry) {
        if (log.action === 'login') entry.logins += 1;
        if (log.action === 'register') entry.registers += 1;
      }

      const metadataCity: unknown = log.metadata?.city;
      const metadataCountry: unknown = log.metadata?.country;
      const loc =
        (typeof metadataCity === 'string' && metadataCity) ||
        (typeof metadataCountry === 'string' && metadataCountry) ||
        (log.ipAddress === '127.0.0.1' || log.ipAddress === '::1'
          ? 'Localhost'
          : 'Hồ Chí Minh, VN');
      geoMap.set(loc, (geoMap.get(loc) || 0) + 1);
    });

    // Query AI usage from ai_usage table grouped by date (accurate)
    const recentAiUsage = await this.aiUsageRepo
      .createQueryBuilder('au')
      .select('au.date', 'date')
      .addSelect('SUM(au.dailyCount)', 'total')
      .where('au.date >= :from', { from: fourteenDaysAgoStr })
      .groupBy('au.date')
      .getRawMany<{ date: string; total: string }>();

    recentAiUsage.forEach(({ date, total }) => {
      const entry = daysMap.get(date);
      if (entry) entry.ai = parseInt(total, 10) || 0;
    });

    const readingStats = await this.readingRepo
      .createQueryBuilder('reading')
      .select(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'iching')`,
        'ichingCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'tarot')`,
        'tarotCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE LOWER(reading.app) LIKE '%tuvi%')`,
        'tuviCount',
      )
      .getRawOne<{
        ichingCount: string | number;
        tarotCount: string | number;
        tuviCount: string | number;
      }>();

    const ichingCount = Number(readingStats?.ichingCount ?? 0);
    const tarotCount = Number(readingStats?.tarotCount ?? 0);
    const tuviCount = Number(readingStats?.tuviCount ?? 0);

    const timeSeriesData = Array.from(daysMap.entries()).map(([date, val]) => ({
      date,
      ...val,
    }));

    const topLocations = Array.from(geoMap.entries())
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      timeSeries: timeSeriesData,
      appDistribution: {
        iching: ichingCount,
        tarot: tarotCount,
        tuvi: tuviCount,
      },
      topLocations,
    };
  }
}
