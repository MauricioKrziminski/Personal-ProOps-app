import ExpoModulesCore
import UIKit

/// A capa de tinta que esconde o app da foto do seletor de apps. Ver `index.ts`.
public class ProOpsPrivacidadeModule: Module {
  private var ativa = false
  private var capa: UIView?
  private var observadores: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ProOpsPrivacidade")

    OnCreate {
      let centro = NotificationCenter.default
      // `queue: nil` roda no mesmo instante em que o UIKit avisa (thread principal): a capa
      // precisa estar na janela ANTES de a foto ser tirada.
      self.observadores = [
        centro.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
          self?.cobrir()
        },
        centro.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
          self?.descobrir()
        },
      ]
    }

    OnDestroy {
      self.observadores.forEach { NotificationCenter.default.removeObserver($0) }
      self.observadores = []
    }

    Function("definirProtecao") { (ativa: Bool) in
      DispatchQueue.main.async {
        self.ativa = ativa
        if !ativa { self.descobrir() }
      }
    }
  }

  private func cobrir() {
    guard ativa, capa == nil, let janela = janelaPrincipal() else { return }
    let vista = UIView(frame: janela.bounds)
    // A tinta da cortina e da trava (`theme.curtain`, igual nos dois temas).
    vista.backgroundColor = UIColor(red: 11 / 255, green: 11 / 255, blue: 12 / 255, alpha: 1)
    vista.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    janela.addSubview(vista)
    capa = vista
  }

  private func descobrir() {
    guard let vista = capa else { return }
    capa = nil
    // Por baixo já está a tinta do JS (a trava ou o véu): o esmaecimento só costura as duas.
    UIView.animate(withDuration: 0.2, animations: { vista.alpha = 0 }) { _ in
      vista.removeFromSuperview()
    }
  }

  private func janelaPrincipal() -> UIWindow? {
    let janelas = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return janelas.first { $0.isKeyWindow } ?? janelas.first
  }
}
