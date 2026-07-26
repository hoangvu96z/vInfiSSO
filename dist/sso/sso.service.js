"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsoService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const users_service_1 = require("../users/users.service");
const audit_log_entity_1 = require("../users/audit-log.entity");
let SsoService = class SsoService {
    usersService;
    auditLogRepo;
    constructor(usersService, auditLogRepo) {
        this.usersService = usersService;
        this.auditLogRepo = auditLogRepo;
    }
    async register(dto, reqMeta) {
        if (!dto.email || !dto.password) {
            throw new common_1.BadRequestException('Email và mật khẩu là bắt buộc');
        }
        if (dto.password.length < 8) {
            throw new common_1.BadRequestException('Mật khẩu phải có ít nhất 8 ký tự');
        }
        const user = await this.usersService.createUser({
            email: dto.email,
            password: dto.password,
            displayName: dto.displayName,
        });
        await this.auditLogRepo.save({
            userId: user.id,
            action: 'register',
            app: 'sso',
            ipAddress: reqMeta?.ipAddress || null,
            userAgent: reqMeta?.userAgent || null,
            metadata: { email: user.email, ...reqMeta?.metadata },
        });
        return {
            message: 'Đăng ký thành công! Vui lòng kiểm tra hộp thư email của bạn để xác nhận tài khoản trong vòng 24 giờ.',
            email: user.email,
        };
    }
    async login(dto, reqMeta) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new common_1.UnauthorizedException('Email hoặc mật khẩu không đúng');
        }
        const valid = await this.usersService.verifyPassword(user, dto.password);
        if (!valid) {
            throw new common_1.UnauthorizedException('Email hoặc mật khẩu không đúng');
        }
        if (!user.isVerified) {
            throw new common_1.ForbiddenException({
                statusCode: 403,
                error: 'EMAIL_NOT_VERIFIED',
                message: 'Tài khoản chưa được xác nhận email. Vui lòng kiểm tra hộp thư của bạn hoặc nhấn gửi lại email xác nhận.',
                requiresVerification: true,
                email: user.email,
            });
        }
        const token = await this.usersService.createSession(user.id, dto.appOrigin);
        await this.auditLogRepo.save({
            userId: user.id,
            action: 'login',
            app: 'sso',
            ipAddress: reqMeta?.ipAddress || null,
            userAgent: reqMeta?.userAgent || null,
            metadata: { appOrigin: dto.appOrigin || 'direct', ...reqMeta?.metadata },
        });
        return { token, user: this.sanitizeUser(user) };
    }
    async oauthLogin(user, appOrigin, reqMeta) {
        if (!user.isVerified) {
            await this.usersService.markAsVerified(user.id);
            user.isVerified = true;
        }
        const token = await this.usersService.createSession(user.id, appOrigin);
        await this.auditLogRepo.save({
            userId: user.id,
            action: 'login_oauth',
            app: 'sso',
            ipAddress: reqMeta?.ipAddress || null,
            userAgent: reqMeta?.userAgent || null,
            metadata: { appOrigin: appOrigin || 'oauth', ...reqMeta?.metadata },
        });
        return { token, user: this.sanitizeUser(user) };
    }
    async resolveSession(rawToken) {
        if (!rawToken)
            return null;
        return this.usersService.resolveSessionByToken(rawToken);
    }
    async logout(rawToken) {
        if (!rawToken)
            return;
        const user = await this.resolveSession(rawToken);
        if (user) {
            await this.auditLogRepo.save({
                userId: user.id,
                action: 'logout',
                app: 'sso',
            });
        }
        await this.usersService.deleteSessionByToken(rawToken);
    }
    sanitizeUser(user) {
        const { passwordHash: _, emailVerificationToken: __, passwordResetToken: ___, ...safe } = user;
        return safe;
    }
    async verifyEmail(token) {
        return this.usersService.verifyEmail(token);
    }
    async resendVerificationEmail(email) {
        return this.usersService.resendVerificationEmail(email);
    }
    async requestPasswordReset(email) {
        return this.usersService.requestPasswordReset(email);
    }
    async resetPassword(token, newPassword) {
        return this.usersService.resetPassword(token, newPassword);
    }
    async createSessionForUser(userId) {
        return this.usersService.createSession(userId);
    }
};
exports.SsoService = SsoService;
exports.SsoService = SsoService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(audit_log_entity_1.AuditLog)),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        typeorm_2.Repository])
], SsoService);
//# sourceMappingURL=sso.service.js.map