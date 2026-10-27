import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";
import { SessionService } from "./session.service";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_SECRET,
          signOptions: { algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RateLimitService, SessionService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, RateLimitService, SessionService],
})
export class AuthModule {}
