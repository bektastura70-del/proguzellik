import { Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import { SettingsController } from "./settings.controller";

@Module({ controllers: [SettingsController, OnboardingController] })
export class SettingsModule {}
