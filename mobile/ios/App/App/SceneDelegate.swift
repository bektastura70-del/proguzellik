import UIKit
import Capacitor

/// Uygulama penceresi. Derin bağlantılar (proguzellik://r/salon, https://proguzellik.com/r/salon) yerel giriş
/// ekranına `?open=` olarak verilir; hangi adresin açılabileceğine giriş ekranındaki izin listesi karar verir.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // Soğuk açılış: uygulama bir bağlantıyla başlatıldıysa web görünümü yüklendikten sonra o bağlantıya gidilir.
        let link = connectionOptions.urlContexts.first?.url
            ?? connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL
        if let link = link {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.openDeepLink(link) }
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        if let url = URLContexts.first?.url { openDeepLink(url) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL {
            openDeepLink(url)
        }
    }

    private func openDeepLink(_ url: URL) {
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.webView,
              let local = vc.bridge?.config.localURL else { return }
        var comps = URLComponents(url: local.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "open", value: url.absoluteString)]
        if let target = comps?.url { webView.load(URLRequest(url: target)) }
    }
}

/// Capacitor görünümü; iPhone'da kenardan kaydırarak geri gitme hareketini açar.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
