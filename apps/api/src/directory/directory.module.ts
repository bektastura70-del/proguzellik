import { Module } from "@nestjs/common";
import { DirectoryController, PlatformDirectoryController, PublicDirectoryController } from "./directory.controller";
import { DirectoryService } from "./directory.service";

@Module({
  controllers: [DirectoryController, PublicDirectoryController, PlatformDirectoryController],
  providers: [DirectoryService],
})
export class DirectoryModule {}
