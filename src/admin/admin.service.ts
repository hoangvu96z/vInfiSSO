import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../users/user.entity';
import { Session } from '../users/session.entity';
import { AuditLog } from '../users/audit-log.entity';
import { Reading } from '../readings/reading.entity';

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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayLogins = await this.auditLogRepo.count({
      where: { action: 'login', createdAt: MoreThan(startOfToday) },
    });

    const readings = await this.readingRepo.find({ select: { data: true, createdAt: true } });
    let totalAiQuestions = 0;
    let todayAiQuestions = 0;

    readings.forEach((r) => {
      const conv = r.data?.aiConversation;
      if (conv) {
        let count = 0;
        if (conv.initialInterpretation) count += 1;
        if (Array.isArray(conv.followUps)) count += conv.followUps.length;
        totalAiQuestions += count;

        if (r.createdAt >= startOfToday) {
          todayAiQuestions += count;
        }
      }
    });

    return {
      totalUsers,
      activeSessions,
      totalReadings,
      totalAiQuestions,
      todayLogins,
      todayAiQuestions,
    };
  }

  async getUsers(page = 1, limit = 20, search = '', role = '') {
    const query = this.userRepo.createQueryBuilder('user')
      .leftJoinAndSelect('user.sessions', 'session')
      .orderBy('user.createdAt', 'DESC');

    if (search) {
      query.andWhere('(user.email ILIKE :search OR user.displayName ILIKE :search OR user.username ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    if (role) {
      query.andWhere('user.role = :role', { role });
    }

    const [users, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const allReadings = await this.readingRepo.find({ select: { userId: true, app: true, data: true } });

    const userStatsMap = new Map<string, { readingsCount: number; aiQuestionsCount: number }>();

    allReadings.forEach((r) => {
      if (!r.userId) return;
      const stats = userStatsMap.get(r.userId) || { readingsCount: 0, aiQuestionsCount: 0 };
      stats.readingsCount += 1;

      const conv = r.data?.aiConversation;
      if (conv) {
        if (conv.initialInterpretation) stats.aiQuestionsCount += 1;
        if (Array.isArray(conv.followUps)) stats.aiQuestionsCount += conv.followUps.length;
      }
      userStatsMap.set(r.userId, stats);
    });

    const mappedUsers = users.map((u) => {
      const stats = userStatsMap.get(u.id) || { readingsCount: 0, aiQuestionsCount: 0 };
      const activeSessionsCount = u.sessions
        ? u.sessions.filter((s) => new Date(s.expiresAt) > new Date()).length
        : 0;

      const { passwordHash, emailVerificationToken, passwordResetToken, ...rest } = u;
      return {
        ...rest,
        activeSessionsCount,
        readingsCount: stats.readingsCount,
        aiQuestionsCount: stats.aiQuestionsCount,
      };
    });

    return {
      users: mappedUsers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateUserRole(userId: string, role: string) {
    const validRoles = ['user', 'admin', 'vip', 'editor'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(`Role không hợp lệ. Các role cho phép: ${validRoles.join(', ')}`);
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    user.role = role;
    await this.userRepo.save(user);

    await this.logActivity(userId, 'update_role', 'sso', null, null, { newRole: role });
    return { success: true, user: { id: user.id, email: user.email, role: user.role } };
  }

  async updateUserStatus(userId: string, isVerified: boolean) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    user.isVerified = isVerified;
    await this.userRepo.save(user);

    await this.logActivity(userId, 'update_status', 'sso', null, null, { isVerified });
    return { success: true, user: { id: user.id, email: user.email, isVerified: user.isVerified } };
  }

  async revokeUserSessions(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    await this.sessionRepo.delete({ user: { id: userId } });

    await this.logActivity(userId, 'revoke_sessions', 'sso', null, null, { revokedByAdmin: true });
    return { success: true, message: `Đã hủy tất cả phiên đăng nhập của ${user.email}` };
  }

  async getAuditLogs(page = 1, limit = 30, action = '', search = '') {
    const query = this.auditLogRepo.createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .orderBy('log.createdAt', 'DESC');

    if (action) {
      query.andWhere('log.action = :action', { action });
    }

    if (search) {
      query.andWhere('(user.email ILIKE :search OR log.ipAddress ILIKE :search OR log.app ILIKE :search)', {
        search: `%${search}%`,
      });
    }

    const [logs, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const mappedLogs = logs.map((l) => ({
      id: l.id,
      action: l.action,
      app: l.app,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      metadata: l.metadata,
      createdAt: l.createdAt,
      user: l.user ? { id: l.user.id, email: l.user.email, displayName: l.user.displayName, role: l.user.role } : null,
    }));

    return {
      logs: mappedLogs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAiUsageStats() {
    const readings = await this.readingRepo.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });

    const userMap = new Map<string, {
      userId: string;
      email: string;
      displayName: string;
      role: string;
      ichingReadings: number;
      tarotReadings: number;
      initialInterpretations: number;
      followUpQuestions: number;
      totalAiQuestions: number;
      lastActive: Date | null;
    }>();

    readings.forEach((r) => {
      const u = r.user;
      if (!u) return;
      const existing = userMap.get(u.id) || {
        userId: u.id,
        email: u.email,
        displayName: u.displayName || u.username || 'User',
        role: u.role || 'user',
        ichingReadings: 0,
        tarotReadings: 0,
        initialInterpretations: 0,
        followUpQuestions: 0,
        totalAiQuestions: 0,
        lastActive: null,
      };

      if (r.app === 'iching') existing.ichingReadings += 1;
      if (r.app === 'tarot') existing.tarotReadings += 1;

      const conv = r.data?.aiConversation;
      if (conv) {
        if (conv.initialInterpretation) existing.initialInterpretations += 1;
        if (Array.isArray(conv.followUps)) existing.followUpQuestions += conv.followUps.length;
      }

      existing.totalAiQuestions = existing.initialInterpretations + existing.followUpQuestions;

      if (!existing.lastActive || new Date(r.createdAt) > new Date(existing.lastActive)) {
        existing.lastActive = r.createdAt;
      }

      userMap.set(u.id, existing);
    });

    const list = Array.from(userMap.values()).sort((a, b) => b.totalAiQuestions - a.totalAiQuestions);

    const totalIchingReadings = list.reduce((acc, curr) => acc + curr.ichingReadings, 0);
    const totalTarotReadings = list.reduce((acc, curr) => acc + curr.tarotReadings, 0);
    const totalAiQuestions = list.reduce((acc, curr) => acc + curr.totalAiQuestions, 0);

    return {
      summary: {
        totalUsersWithReadings: list.length,
        totalIchingReadings,
        totalTarotReadings,
        totalAiQuestions,
      },
      userAiStats: list,
    };
  }

  async getAnalyticsData() {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentLogs = await this.auditLogRepo.find({
      where: { createdAt: MoreThan(fourteenDaysAgo) },
      order: { createdAt: 'ASC' },
    });

    const daysMap = new Map<string, { logins: number; registers: number; ai: number }>();
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

      const loc = log.metadata?.city || log.metadata?.country || (log.ipAddress === '127.0.0.1' || log.ipAddress === '::1' ? 'Localhost' : 'Hồ Chí Minh, VN');
      geoMap.set(loc, (geoMap.get(loc) || 0) + 1);
    });

    const readings = await this.readingRepo.find({ select: { app: true, data: true, createdAt: true } });
    let ichingCount = 0;
    let tarotCount = 0;

    readings.forEach((r) => {
      if (r.app === 'iching') ichingCount += 1;
      if (r.app === 'tarot') tarotCount += 1;

      const dateStr = new Date(r.createdAt).toISOString().split('T')[0];
      const entry = daysMap.get(dateStr);
      if (entry) {
        let count = 0;
        if (r.data?.aiConversation?.initialInterpretation || r.data?.aiInterpretation || r.data?.interpretation) count += 1;
        if (Array.isArray(r.data?.aiConversation?.followUps)) count += r.data.aiConversation.followUps.length;
        if (Array.isArray(r.data?.followUps)) count += r.data.followUps.length;
        entry.ai += count;
      }
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
      },
      topLocations,
    };
  }
}
