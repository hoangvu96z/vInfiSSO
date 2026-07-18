"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsoService = void 0;
const common_1 = require("@nestjs/common");
let SsoService = class SsoService {
    sessions = new Map();
    login({ username, password }) {
        if (!username || !password) {
            throw new Error('username and password are required');
        }
        const token = `sso_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const expiresAt = Date.now() + 1000 * 60 * 60;
        this.sessions.set(token, { user: { username }, expiresAt });
        return { token, user: { username }, expiresAt };
    }
    resolveSession(token) {
        if (!token) {
            return null;
        }
        const session = this.sessions.get(token);
        if (!session) {
            return null;
        }
        if (session.expiresAt < Date.now()) {
            this.sessions.delete(token);
            return null;
        }
        return session;
    }
    logout(token) {
        if (token) {
            this.sessions.delete(token);
        }
    }
};
exports.SsoService = SsoService;
exports.SsoService = SsoService = __decorate([
    (0, common_1.Injectable)()
], SsoService);
//# sourceMappingURL=sso.service.js.map