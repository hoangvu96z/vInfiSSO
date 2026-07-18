"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemberAppService = void 0;
const common_1 = require("@nestjs/common");
let MemberAppService = class MemberAppService {
    memberApps = [];
    createMember(dto) {
        const memberApp = {
            id: `${Date.now()}`,
            appName: dto.appName,
            appId: dto.appId ?? null,
            memberName: dto.memberName,
            email: dto.email,
            role: dto.role ?? 'member',
            status: dto.status ?? 'active',
            createdAt: new Date().toISOString(),
        };
        this.memberApps.push(memberApp);
        return { success: true, memberApp };
    }
    listMembers() {
        return { memberApps: this.memberApps };
    }
};
exports.MemberAppService = MemberAppService;
exports.MemberAppService = MemberAppService = __decorate([
    (0, common_1.Injectable)()
], MemberAppService);
//# sourceMappingURL=member-app.service.js.map