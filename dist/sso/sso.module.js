"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsoModule = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const sso_controller_1 = require("./sso.controller");
const sso_service_1 = require("./sso.service");
const users_module_1 = require("../users/users.module");
const google_strategy_1 = require("./strategies/google.strategy");
const facebook_strategy_1 = require("./strategies/facebook.strategy");
let SsoModule = class SsoModule {
};
exports.SsoModule = SsoModule;
exports.SsoModule = SsoModule = __decorate([
    (0, common_1.Module)({
        imports: [passport_1.PassportModule, users_module_1.UsersModule],
        controllers: [sso_controller_1.SsoController],
        providers: [sso_service_1.SsoService, google_strategy_1.GoogleStrategy, facebook_strategy_1.FacebookStrategy],
        exports: [sso_service_1.SsoService],
    })
], SsoModule);
//# sourceMappingURL=sso.module.js.map