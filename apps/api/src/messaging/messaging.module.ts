import { Global, Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { MetaGateway, metaGatewayFactory, MockMetaGateway } from "./meta.gateway";
import { MetaWebhooksController } from "./webhooks.controller";

@Global()
@Module({
  controllers: [ChannelsController, MetaWebhooksController],
  providers: [MockMetaGateway, { provide: MetaGateway, useFactory: metaGatewayFactory, inject: [MockMetaGateway] }, ChannelsService],
  exports: [MetaGateway, MockMetaGateway, ChannelsService],
})
export class MessagingModule {}
