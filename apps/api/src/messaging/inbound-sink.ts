import { ChannelConnection } from "@prisma/client";

/** Yeni gelen metin mesajı sonrası yapılacak iş (yapay zekâ kuyruğu). Varsayılan: hiçbir şey (personel yanıtlar). */
export abstract class InboundSink {
  abstract inbound(conn: ChannelConnection, conversationId: string, messageId: string): Promise<void>;
}

export class NoopInboundSink extends InboundSink {
  async inbound() {}
}
