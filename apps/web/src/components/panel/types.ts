export type Customer = {
  id: string; firstName: string; lastName: string; phone: string | null; email: string | null; tags: string[];
  birthDate: string | null; notes: string | null; kvkkConsentAt: string | null; marketingConsent: boolean; createdAt: string; source: string | null;
};
export type Service = { id: string; name: string; durationMin: number; price: string; isActive: boolean; onlineBookable: boolean; color: string | null; category: { id: string; name: string } | null; staff: { staffId: string }[]; description: string | null };
export type Staff = {
  id: string; displayName: string; title: string | null; phone: string | null; color: string | null; commissionRate: string; isActive: boolean; onlineBookable: boolean; userId: string | null;
  services: { serviceId: string }[]; workingHours: { weekday: number; startMin: number; endMin: number }[];
};
export type Appointment = {
  id: string; startsAt: string; endsAt: string; status: string; price: string; source: string; notes: string | null; customerPackageId: string | null;
  customer: { id: string; firstName: string; lastName: string; phone: string | null };
  staff: { id: string; displayName: string; color: string | null };
  service: { id: string; name: string; durationMin: number; color: string | null };
};
export type Txn = {
  id: string; type: "INCOME" | "EXPENSE" | "REFUND"; category: string; amount: string; method: string; description: string | null; occurredAt: string; refundOfId: string | null;
  customer: { id: string; firstName: string; lastName: string } | null; staff: { id: string; displayName: string } | null;
  refundedAmount?: string; refundable?: string;
};
export type Product = { id: string; name: string; sku: string | null; unit: string; kind: "RETAIL" | "CONSUMABLE"; stockQty: string; minQty: string; costPrice: string | null; salePrice: string | null };
