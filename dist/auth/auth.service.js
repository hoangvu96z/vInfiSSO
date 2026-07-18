"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
let AuthService = class AuthService {
    logins = [];
    createLogin(dto) {
        const login = {
            id: `${Date.now()}`,
            username: dto.username,
            passwordHash: (0, node_crypto_1.createHash)('sha256').update(dto.password).digest('hex'),
            appId: dto.appId ?? null,
            appName: dto.appName ?? null,
            notes: dto.notes ?? '',
            createdAt: new Date().toISOString(),
        };
        this.logins.push(login);
        return { success: true, login };
    }
    listLogins() {
        return { logins: this.logins };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)()
], AuthService);
//# sourceMappingURL=auth.service.js.map