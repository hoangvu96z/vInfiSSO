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
const sso_service_1 = require("./sso.service");
let SsoController = class SsoController {
    ssoService;
    constructor(ssoService) {
        this.ssoService = ssoService;
    }
    getTokenFromCookie(req) {
        const cookieHeader = req.headers.cookie ?? '';
        const cookieEntry = cookieHeader
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith('sso_token='));
        if (!cookieEntry) {
            return undefined;
        }
        const [, rawValue] = cookieEntry.split('=');
        return rawValue ? decodeURIComponent(rawValue) : undefined;
    }
    me(req) {
        const token = this.getTokenFromCookie(req);
        const session = this.ssoService.resolveSession(token);
        return { user: session?.user ?? null };
    }
    login(body, res) {
        const session = this.ssoService.login(body);
        res.cookie('sso_token', session.token, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 1000 * 60 * 60,
        });
        return { success: true, user: session.user };
    }
    logout(req, res) {
        const token = this.getTokenFromCookie(req);
        this.ssoService.logout(token);
        res.clearCookie('sso_token', { path: '/' });
        return { success: true };
    }
};
exports.SsoController = SsoController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SsoController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SsoController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], SsoController.prototype, "logout", null);
exports.SsoController = SsoController = __decorate([
    (0, common_1.Controller)('sso'),
    __metadata("design:paramtypes", [sso_service_1.SsoService])
], SsoController);
//# sourceMappingURL=sso.controller.js.map