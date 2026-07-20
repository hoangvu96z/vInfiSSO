"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./auth/auth.module");
const member_app_module_1 = require("./member-app/member-app.module");
const sso_module_1 = require("./sso/sso.module");
const users_module_1 = require("./users/users.module");
const user_entity_1 = require("./users/user.entity");
const oauth_account_entity_1 = require("./users/oauth-account.entity");
const session_entity_1 = require("./users/session.entity");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    type: 'postgres',
                    host: config.get('DATABASE_HOST', 'localhost'),
                    port: config.get('DATABASE_PORT', 5432),
                    username: config.get('DATABASE_USER', 'postgres'),
                    password: config.get('DATABASE_PASSWORD', ''),
                    database: config.get('DATABASE_NAME', 'vinfi_sso'),
                    entities: [user_entity_1.User, oauth_account_entity_1.OAuthAccount, session_entity_1.Session],
                    synchronize: true,
                    logging: config.get('NODE_ENV') !== 'production',
                }),
            }),
            users_module_1.UsersModule,
            auth_module_1.AuthModule,
            member_app_module_1.MemberAppModule,
            sso_module_1.SsoModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map