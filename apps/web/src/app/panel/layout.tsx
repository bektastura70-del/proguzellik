import { PanelShell } from "@/components/panel/shell";
import { SessionProvider } from "@/components/panel/session";

export const metadata = { title: "Panel" };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PanelShell>{children}</PanelShell>
    </SessionProvider>
  );
}
