import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { RateLimitService } from "./rate-limit.service";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_SECRET,
          signOptions: { expiresIn: env.JWT_EXPIRES_IN as `${number}h`, algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RateLimitService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, RateLimitService],
})
export class AuthModule {}
