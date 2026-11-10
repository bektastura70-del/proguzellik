/** ProGüzellik Meta uygulaması ayarları (test değerleri). Ortam önbelleğe alınmadan önce yüklenmesi için ilk import olmalı. */
export const META_APP = {
  appId: "2059349714909229",
  appSecret: "fedcba9876543210fedcba9876543210",
  configId: "1234567890123",
  verifyToken: "test-app-webhook-verify-token",
};
process.env.META_APP_ID = META_APP.appId;
process.env.META_APP_SECRET = META_APP.appSecret;
process.env.META_ES_CONFIG_ID = META_APP.configId;
process.env.META_WEBHOOK_VERIFY_TOKEN = META_APP.verifyToken;
