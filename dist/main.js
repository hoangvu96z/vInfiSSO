"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    app.enableCors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    });
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(process.env.PORT ?? 3000);
    console.log(`🚀 vInfiSSO running at http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
//# sourceMappingURL=main.js.map