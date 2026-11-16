/** Meta JavaScript SDK (Facebook Login for Business). Yalnız ayrı güvenlik politikası olan bağlama sayfalarında kullanılır. */
export type MetaSdkConfig = { appId: string; graphVersion: string };
export type FbLoginResponse = { authResponse?: { code?: string } | null };
type FB = { init: (o: Record<string, unknown>) => void; login: (cb: (r: FbLoginResponse) => void, o: Record<string, unknown>) => void };
declare global {
  interface Window { FB?: FB; fbAsyncInit?: () => void }
}

/** Meta JavaScript SDK'yı bir kez yükler. Bu sayfanın güvenlik politikası yalnız Meta alan adlarına izin verir. */
export function loadSdk(es: MetaSdkConfig): Promise<FB> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: es.appId, autoLogAppEvents: true, xfbml: false, version: es.graphVersion });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Meta bağlantı penceresi yüklenemedi. Reklam engelleyiciyi kapatıp sayfayı yenileyin."));
    document.body.appendChild(s);
  });
}

