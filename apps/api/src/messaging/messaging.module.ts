import { Global, Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { ConversationsController } from "./conversations.controller";
import { InboundSink, NoopInboundSink } from "./inbound-sink";
import { InboxService } from "./inbox.service";
import { MetaGateway, metaGatewayFactory, MockMetaGateway } from "./meta.gateway";
import { MetaWebhooksController } from "./webhooks.controller";

@Global()
@Module({
  controllers: [ChannelsController, ConversationsController, MetaWebhooksController],
  providers: [
    MockMetaGateway,
    { provide: MetaGateway, useFactory: metaGatewayFactory, inject: [MockMetaGateway] },
    ChannelsService,
    InboxService,
    { provide: InboundSink, useClass: NoopInboundSink },
  ],
  exports: [MetaGateway, MockMetaGateway, ChannelsService, InboxService],
})
export class MessagingModule {}
