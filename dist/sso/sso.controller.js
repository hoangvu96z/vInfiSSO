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
    async me(req) {
        const token = this.getToken(req);
        const user = await this.ssoService.resolveSession(token);
        return {
            user: user ? this.ssoService.sanitizeUser(user) : null,
            token: user ? token : null,
        };
    }
    async register(body, res) {
        const { token, user } = await this.ssoService.register(body);
        this.setSessionCookie(res, token);
        return { success: true, token, user };
    }
    async login(body, req, res) {
        const appOrigin = req.headers.origin ?? req.headers.referer;
        const { token, user } = await this.ssoService.login({
            ...body,
            appOrigin: typeof appOrigin === 'string' ? appOrigin : undefined,
        });
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
        const { token } = await this.ssoService.oauthLogin(req.user, 'google');
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
    __param(1, (0, common_1.Res)({ passthrough: true })),
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
exports.SsoController = SsoController = __decorate([
    (0, common_1.Controller)('sso'),
    __metadata("design:paramtypes", [sso_service_1.SsoService,
        config_1.ConfigService])
], SsoController);
//# sourceMappingURL=sso.controller.js.map