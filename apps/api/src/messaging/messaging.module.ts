import { Global, Module } from "@nestjs/common";
import { ChannelsController } from "./channels.controller";
import { ChannelsService } from "./channels.service";
import { ConversationsController } from "./conversations.controller";
import { AppointmentsModule } from "../appointments/appointments.module";
import { ChatAgent, chatAgentFactory } from "./chat/chat-agent";
import { ChatTools } from "./chat/chat-tools";
import { ConversationEngine, ConversationQueue } from "./chat/conversation-engine";
import { InboundSink } from "./inbound-sink";
import { InboxService } from "./inbox.service";
import { MetaGateway, metaGatewayFactory, MockMetaGateway } from "./meta.gateway";
import { MetaWebhooksController } from "./webhooks.controller";

@Global()
@Module({
  imports: [AppointmentsModule],
  controllers: [ChannelsController, ConversationsController, MetaWebhooksController],
  providers: [
    MockMetaGateway,
    { provide: MetaGateway, useFactory: metaGatewayFactory, inject: [MockMetaGateway] },
    ChannelsService,
    InboxService,
    ChatTools,
    { provide: ChatAgent, useFactory: chatAgentFactory },
    ConversationEngine,
    ConversationQueue,
    { provide: InboundSink, useExisting: ConversationQueue },
  ],
  exports: [MetaGateway, MockMetaGateway, ChannelsService, InboxService, ConversationEngine, ChatTools, ChatAgent],
})
export class MessagingModule {}
