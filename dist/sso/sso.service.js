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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsoService = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("../users/users.service");
let SsoService = class SsoService {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    async register(dto) {
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
        const token = await this.usersService.createSession(user.id, 'register');
        return { token, user: this.sanitizeUser(user) };
    }
    async login(dto) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new common_1.UnauthorizedException('Email hoặc mật khẩu không đúng');
        }
        const valid = await this.usersService.verifyPassword(user, dto.password);
        if (!valid) {
            throw new common_1.UnauthorizedException('Email hoặc mật khẩu không đúng');
        }
        const token = await this.usersService.createSession(user.id, dto.appOrigin);
        return { token, user: this.sanitizeUser(user) };
    }
    async oauthLogin(user, appOrigin) {
        const token = await this.usersService.createSession(user.id, appOrigin);
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
        await this.usersService.deleteSessionByToken(rawToken);
    }
    sanitizeUser(user) {
        const { passwordHash: _, ...safe } = user;
        return safe;
    }
};
exports.SsoService = SsoService;
exports.SsoService = SsoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], SsoService);
//# sourceMappingURL=sso.service.js.map