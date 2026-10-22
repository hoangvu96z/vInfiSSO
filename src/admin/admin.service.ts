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
    const totalReadings = await this.readingRepo.count();

    const readings = await this.readingRepo.find({ select: { app: true } });
    let totalIchingReadings = 0;
    let totalTarotReadings = 0;
    let totalTuviReadings = 0;
    readings.forEach((r) => {
      const a = (r.app || '').toLowerCase();
      if (a === 'iching') totalIchingReadings += 1;
      else if (a === 'tarot') totalTarotReadings += 1;
      else if (a.includes('tuvi') || a === 'tuvinow') totalTuviReadings += 1;
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStr = startOfToday.toISOString().split('T')[0];

    const todayLogins = await this.auditLogRepo.count({
      where: { action: 'login', createdAt: MoreThan(startOfToday) },
    });

    // Query AI usage from ai_usage table (accurate, not parsed from readings.data)
    const allUsage = await this.aiUsageRepo.find({
      select: { dailyCount: true, monthlyCount: true, date: true },
    });
    const totalAiQuestions = allUsage.reduce(
      (sum, r) => sum + (r.monthlyCount || 0),
      0,
    );
    const todayAiQuestions = allUsage
      .filter((r) => r.date === todayStr)
      .reduce((sum, r) => sum + (r.dailyCount || 0), 0);

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

  async getUsers(page = 1, limit = 20, search = '', role = '') {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
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
      .orderBy('user.createdAt', 'DESC');

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
      const sessions = (await this.dataSource.query(
        `SELECT user_id AS "userId", COUNT(*)::int AS count
         FROM sessions WHERE user_id = ANY($1::uuid[]) AND expires_at > NOW()
         GROUP BY user_id`,
        [userIds],
      )) as Array<{ userId: string; count: number }>;
      for (const row of sessions)
        activeSessionsByUser.set(row.userId, Number(row.count));

      const readingCounts = (await this.dataSource.query(
        `SELECT user_id AS "userId", COUNT(*)::int AS count
         FROM readings WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
        [userIds],
      )) as Array<{ userId: string; count: number }>;
      for (const row of readingCounts) {
        userStatsMap.set(row.userId, {
          readingsCount: Number(row.count),
          aiQuestionsCount: 0,
        });
      }
      const aiCounts = (await this.dataSource.query(
        `SELECT "userId" AS "userId", COALESCE(SUM("monthlyCount"), 0)::int AS count
         FROM ai_usage WHERE "userId" = ANY($1::uuid[]) GROUP BY "userId"`,
        [userIds],
      )) as Array<{ userId: string; count: number }>;
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
    const query = this.auditLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .orderBy('log.createdAt', 'DESC');

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

    if (dateFrom || dateTo) {
      const start = dateFrom ? new Date(dateFrom) : undefined;
      const end = dateTo ? new Date(dateTo) : undefined;
      if (
        (start && Number.isNaN(start.getTime())) ||
        (end && Number.isNaN(end.getTime())) ||
        (start && end && start > end)
      ) {
        throw new BadRequestException('Invalid audit log date range');
      }
      if (start) query.andWhere('log.createdAt >= :dateFrom', { dateFrom: start });
      if (end) query.andWhere('log.createdAt < :dateTo', { dateTo: end });
    }

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

  async getAiUsageStats() {
    const rows = (await this.dataSource.query(
      `SELECT u.id AS "userId", u.email AS email,
        COALESCE(u."displayName", u.username, 'User') AS "displayName", COALESCE(u.role, 'user') AS role,
        COALESCE(r."ichingReadings", 0)::int AS "ichingReadings",
        COALESCE(r."tarotReadings", 0)::int AS "tarotReadings",
        COALESCE(r."tuviReadings", 0)::int AS "tuviReadings",
        COALESCE(ai."totalAiQuestions", 0)::int AS "totalAiQuestions",
        COALESCE(r."lastActive", ai."lastAiActive") AS "lastActive"
       FROM users u
       LEFT JOIN (
         SELECT user_id,
           COUNT(*) FILTER (WHERE lower(app) = 'iching')::int AS "ichingReadings",
           COUNT(*) FILTER (WHERE lower(app) = 'tarot')::int AS "tarotReadings",
           COUNT(*) FILTER (WHERE lower(app) LIKE '%tuvi%')::int AS "tuviReadings",
           MAX(created_at) AS "lastActive"
         FROM readings GROUP BY user_id
       ) r ON r.user_id = u.id
       LEFT JOIN (
         SELECT "userId", SUM("monthlyCount")::int AS "totalAiQuestions", MAX("updatedAt") AS "lastAiActive"
         FROM ai_usage GROUP BY "userId"
       ) ai ON ai."userId" = u.id
       WHERE r.user_id IS NOT NULL OR ai."userId" IS NOT NULL`,
    )) as Array<{
      userId: string;
      email: string;
      displayName: string;
      role: string;
      ichingReadings: number;
      tarotReadings: number;
      tuviReadings: number;
      totalAiQuestions: number;
      lastActive: Date | null;
    }>;
    const list = rows
      .map((row) => ({
        ...row,
        ichingReadings: Number(row.ichingReadings),
        tarotReadings: Number(row.tarotReadings),
        tuviReadings: Number(row.tuviReadings),
        totalAiQuestions: Number(row.totalAiQuestions),
      }))
      .sort((a, b) => b.totalAiQuestions - a.totalAiQuestions);

    const totalIchingReadings = list.reduce(
      (acc, curr) => acc + curr.ichingReadings,
      0,
    );
    const totalTarotReadings = list.reduce(
      (acc, curr) => acc + curr.tarotReadings,
      0,
    );
    const totalTuviReadings = list.reduce(
      (acc, curr) => acc + curr.tuviReadings,
      0,
    );
    const totalAiQuestions = list.reduce(
      (acc, curr) => acc + curr.totalAiQuestions,
      0,
    );

    return {
      summary: {
        totalUsersWithReadings: list.length,
        totalIchingReadings,
        totalTarotReadings,
        totalTuviReadings,
        totalAiQuestions,
      },
      userAiStats: list,
    };
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

      const loc =
        log.metadata?.city ||
        log.metadata?.country ||
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

    const readings = await this.readingRepo.find({ select: { app: true } });
    let ichingCount = 0;
    let tarotCount = 0;
    let tuviCount = 0;
    readings.forEach((r) => {
      const a = (r.app || '').toLowerCase();
      if (a === 'iching') ichingCount += 1;
      else if (a === 'tarot') tarotCount += 1;
      else if (a.includes('tuvi') || a === 'tuvinow') tuviCount += 1;
    });

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
