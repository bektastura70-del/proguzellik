import { render } from "../src/email/templates";
import { memberInvite } from "../src/platform/platform.controller";
import { present, SafeUser } from "../src/platform/platform-users.service";

/** Veritabanı kullanmayan birim testleri. */
describe("Kullanıcı yönetimi (birim)", () => {
  const base = { fullName: "Ayşe", salon: "Gül Salon", link: "https://x/davet?token=abc", days: 7 };

  it("davet e-postası rolü yazar; rol yoksa sahip metni değişmez", () => {
    expect(render({ name: "tenant_invite", vars: { ...base, role: "personel" } }).text).toMatch(/Gül Salon işletmesine personel olarak/);
    const owner = render({ name: "tenant_invite", vars: base }).text;
    expect(owner).toMatch(/Gül Salon işletmesinin yöneticisi olarak/);
    expect(owner).not.toMatch(/olarak ProGüzellik'e davet edildiniz\. .*personel/);
  });

  it("rol HTML'e kaçışlanarak eklenir", () => {
    expect(render({ name: "tenant_invite", vars: { ...base, role: "<b>x</b>" } }).html).not.toContain("<b>x</b>");
  });

  it("ekip daveti şeması sahip rolünü ve geçersiz girdiyi reddeder, e-postayı küçültür", () => {
    expect(memberInvite.safeParse({ fullName: "Ayşe", email: "a@b.co", role: "OWNER" }).success).toBe(false);
    expect(memberInvite.safeParse({ fullName: "A", email: "a@b.co", role: "STAFF" }).success).toBe(false);
    expect(memberInvite.safeParse({ fullName: "Ayşe", email: "gecersiz", role: "STAFF" }).success).toBe(false);
    const ok = memberInvite.parse({ fullName: " Ayşe ", email: " A@B.CO ", role: "RECEPTION" });
    expect(ok).toEqual({ fullName: "Ayşe", email: "a@b.co", role: "RECEPTION" });
  });

  it("kullanıcı çıktısında gizli alan yok; durum bayrakları türetilir", () => {
    const u = {
      id: "1", email: "a@b.co", fullName: "A", phone: null, isActive: true, isPlatformAdmin: false, mustChangePassword: false,
      emailVerifiedAt: new Date(), mfaEnabledAt: null, lockedUntil: new Date(Date.now() + 60_000), lastLoginAt: null, createdAt: new Date(), memberships: [],
    } as SafeUser;
    const out = present(u);
    expect(out).toMatchObject({ emailVerified: true, mfaEnabled: false, locked: true });
    for (const k of ["passwordHash", "mfaSecretEnc", "mfaPendingSecretEnc", "emailVerifiedAt", "mfaEnabledAt", "lockedUntil"]) expect(out).not.toHaveProperty(k);
    expect(present({ ...u, lockedUntil: new Date(Date.now() - 1000) }).locked).toBe(false);
  });
});
