import ExpoModulesCore

/// Só existe para o autolinking levar o pod: o trabalho é o `+load` de `ProOpsRedeDosTimers.m`.
public class ProOpsRelogioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ProOpsRelogio")
  }
}
