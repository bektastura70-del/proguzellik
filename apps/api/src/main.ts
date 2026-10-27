import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { loadEnv } from "./config/env";

async function bootstrap() {
  const env = loadEnv();
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(env.API_PORT);
}

void bootstrap();
