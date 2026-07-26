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
exports.SsoController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const sso_service_1 = require("./sso.service");
const config_1 = require("@nestjs/config");
const COOKIE_NAME = 'sso_token';
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: (isProd ? 'none' : 'lax'),
    secure: isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};
let SsoController = class SsoController {
    ssoService;
    configService;
    constructor(ssoService, configService) {
        this.ssoService = ssoService;
        this.configService = configService;
    }
    getToken(req) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
            return authHeader.substring(7).trim();
        }
        const raw = req.headers.cookie ?? '';
        const entry = raw
            .split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith(`${COOKIE_NAME}=`));
        if (!entry)
            return undefined;
        const [, val] = entry.split('=');
        return val ? decodeURIComponent(val) : undefined;
    }
    setSessionCookie(res, token) {
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
    }
    extractRequestMetadata(req) {
        const ip = req.headers['cf-connecting-ip']
            || req.headers['x-real-ip']
            || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.ip
            || req.socket.remoteAddress
            || '127.0.0.1';
        const userAgent = req.headers['user-agent'] || '';
        const cfCountry = req.headers['cf-ipcountry'] || '';
        const cfCity = req.headers['cf-ipcity'] || '';
        let browser = 'Unknown Browser';
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg'))
            browser = 'Chrome';
        else if (userAgent.includes('Safari') && !userAgent.includes('Chrome'))
            browser = 'Safari';
        else if (userAgent.includes('Firefox'))
            browser = 'Firefox';
        else if (userAgent.includes('Edg'))
            browser = 'Edge';
        let os = 'Unknown OS';
        if (userAgent.includes('Mac OS'))
            os = 'macOS';
        else if (userAgent.includes('Windows'))
            os = 'Windows';
        else if (userAgent.includes('Android'))
            os = 'Android';
        else if (userAgent.includes('iPhone') || userAgent.includes('iPad'))
            os = 'iOS';
        else if (userAgent.includes('Linux'))
            os = 'Linux';
        let deviceType = 'Desktop';
        if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone'))
            deviceType = 'Mobile';
        if (userAgent.includes('iPad') || userAgent.includes('Tablet'))
            deviceType = 'Tablet';
        const city = cfCity ? decodeURIComponent(cfCity) : (cfCountry === 'VN' || ip === '127.0.0.1' || ip === '::1' ? 'Hồ Chí Minh' : 'Hà Nội');
        const country = cfCountry || 'VN';
        return {
            ipAddress: ip,
            userAgent,
            metadata: {
                browser,
                os,
                deviceType,
                city,
                country,
            },
        };
    }
    async me(req) {
        const token = this.getToken(req);
        const user = await this.ssoService.resolveSession(token);
        return {
            user: user ? this.ssoService.sanitizeUser(user) : null,
            token: user ? token : null,
        };
    }
    async register(body, req) {
        const reqMeta = this.extractRequestMetadata(req);
        const result = await this.ssoService.register(body, reqMeta);
        return { success: true, ...result };
    }
    async login(body, req, res) {
        const appOrigin = req.headers.origin ?? req.headers.referer;
        const reqMeta = this.extractRequestMetadata(req);
        const { token, user } = await this.ssoService.login({
            ...body,
            appOrigin: typeof appOrigin === 'string' ? appOrigin : undefined,
        }, reqMeta);
        this.setSessionCookie(res, token);
        return { success: true, token, user };
    }
    async logout(req, res) {
        const token = this.getToken(req);
        await this.ssoService.logout(token);
        res.clearCookie(COOKIE_NAME, { path: '/' });
        return { success: true };
    }
    googleLogin() {
    }
    async googleCallback(req, res) {
        if (!req.user) {
            throw new common_1.BadRequestException('Google OAuth failed');
        }
        const reqMeta = this.extractRequestMetadata(req);
        const { token } = await this.ssoService.oauthLogin(req.user, 'google', reqMeta);
        this.setSessionCookie(res, token);
        const redirect = this.configService.get('SSO_BASE_URL', 'http://localhost:3000');
        res.redirect(`${redirect}/ui/sso`);
    }
    facebookLogin() {
    }
    async facebookCallback(req, res) {
        if (!req.user) {
            throw new common_1.BadRequestException('Facebook OAuth failed');
        }
        const { token } = await this.ssoService.oauthLogin(req.user, 'facebook');
        this.setSessionCookie(res, token);
        const redirect = this.configService.get('SSO_BASE_URL', 'http://localhost:3000');
        res.redirect(`${redirect}/ui/sso`);
    }
    async verifyEmailGet(token, res) {
        try {
            await this.ssoService.verifyEmail(token);
            res.redirect('/ui/sso?verified=true');
        }
        catch (err) {
            const msg = encodeURIComponent(err.message || 'Xác nhận email thất bại');
            res.redirect(`/ui/sso?verify_error=${msg}`);
        }
    }
    async verifyEmail(body) {
        if (!body.token) {
            throw new common_1.BadRequestException('Token là bắt buộc');
        }
        const user = await this.ssoService.verifyEmail(body.token);
        return {
            success: true,
            message: 'Email đã được xác nhận thành công',
            user: user ? this.ssoService.sanitizeUser(user) : null,
        };
    }
    async resendVerification(body) {
        if (!body.email) {
            throw new common_1.BadRequestException('Email là bắt buộc');
        }
        await this.ssoService.resendVerificationEmail(body.email);
        return { success: true, message: 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư của bạn.' };
    }
    async resendVerificationEmail(body) {
        if (!body.email) {
            throw new common_1.BadRequestException('Email là bắt buộc');
        }
        await this.ssoService.resendVerificationEmail(body.email);
        return { success: true, message: 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư của bạn.' };
    }
    async forgotPassword(body) {
        if (!body.email) {
            throw new common_1.BadRequestException('Email là bắt buộc');
        }
        await this.ssoService.requestPasswordReset(body.email);
        return {
            success: true,
            message: 'Hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn',
        };
    }
    async resetPassword(body, res) {
        if (!body.token || !body.password) {
            throw new common_1.BadRequestException('Token và mật khẩu là bắt buộc');
        }
        const user = await this.ssoService.resetPassword(body.token, body.password);
        const token = await this.ssoService.createSessionForUser(user.id);
        this.setSessionCookie(res, token);
        return {
            success: true,
            message: 'Mật khẩu đã được đặt lại thành công',
            token,
            user: this.ssoService.sanitizeUser(user),
        };
    }
};
exports.SsoController = SsoController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('oauth/google'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('google')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SsoController.prototype, "googleLogin", null);
__decorate([
    (0, common_1.Get)('oauth/google/callback'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('google')),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "googleCallback", null);
__decorate([
    (0, common_1.Get)('oauth/facebook'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('facebook')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SsoController.prototype, "facebookLogin", null);
__decorate([
    (0, common_1.Get)('oauth/facebook/callback'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('facebook')),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "facebookCallback", null);
__decorate([
    (0, common_1.Get)('verify-email'),
    __param(0, (0, common_1.Query)('token')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "verifyEmailGet", null);
__decorate([
    (0, common_1.Post)('verify-email'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "verifyEmail", null);
__decorate([
    (0, common_1.Post)('resend-verification'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "resendVerification", null);
__decorate([
    (0, common_1.Post)('resend-verification-email'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "resendVerificationEmail", null);
__decorate([
    (0, common_1.Post)('forgot-password'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "forgotPassword", null);
__decorate([
    (0, common_1.Post)('reset-password'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SsoController.prototype, "resetPassword", null);
exports.SsoController = SsoController = __decorate([
    (0, common_1.Controller)('sso'),
    __metadata("design:paramtypes", [sso_service_1.SsoService,
        config_1.ConfigService])
], SsoController);
//# sourceMappingURL=sso.controller.js.map