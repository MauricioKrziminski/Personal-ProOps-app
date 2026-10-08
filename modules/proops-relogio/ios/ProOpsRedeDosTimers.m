/*
 * Rede de segurança dos timers do JS no iOS.
 *
 * O `RCTTiming` do React Native (núcleo pré-compilado) dispara `setTimeout`, `setInterval` e
 * `requestAnimationFrame` pelo CADisplayLink da thread do JS e, fora do primeiro plano, por um
 * NSTimer na thread principal. O estado que escolhe entre os dois (`_paused`, `_inBackground`) é
 * escrito pelas duas threads sem trava. Num iPhone real, voltando do Face ID na abertura
 * (08/10/2026), ele ficou num estado em que nenhum dos dois caminhos dispara: os timers do JS
 * morreram para sempre enquanto o toque e o Reanimated seguiam vivos — a cortina não subia, e
 * todo `setTimeout` do app parava junto.
 *
 * A rede não depende de saber qual corrida aconteceu: a cada timer criado, e depois de cada
 * disparo dela, um CFRunLoopTimer na PRÓPRIA thread do JS é armado para o alvo mais próximo +
 * `kFolga`. Com o RCTTiming saudável ele acorda e não acha nada vencido. Achando timer vencido,
 * ele o dispara (`didUpdateFrame:`) e ressincroniza o display link (`startTimers` com `_paused`
 * forçado), devolvendo o caminho normal. Tudo roda na thread do JS, a mesma dos quadros.
 *
 * Mexe em ivars e seletores privados do RCTTiming: se algum sumir numa atualização do React
 * Native, a rede não se instala (log "[ProOpsRelogio]"), nunca quebra o app.
 * `modules/proops-relogio/README.md` diz como conferir depois de subir o React Native.
 */
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>

static const CFTimeInterval kFolga = 0.25;
static const void *kChaveDaRede = &kChaveDaRede;

@interface ProOpsRede : NSObject {
@public
  CFRunLoopTimerRef timer;
  CFRunLoopRef loop;
}
@end

@implementation ProOpsRede
- (void)dealloc
{
  if (timer) {
    CFRunLoopTimerInvalidate(timer);
    CFRelease(timer);
  }
}
@end

static BOOL *boolDoIvar(id obj, const char *nome)
{
  Ivar ivar = class_getInstanceVariable(object_getClass(obj), nome);
  return ivar ? (BOOL *)((uint8_t *)(__bridge void *)obj + ivar_getOffset(ivar)) : NULL;
}

static NSMutableDictionary *timersDe(id timing)
{
  Ivar ivar = class_getInstanceVariable(object_getClass(timing), "_timers");
  return ivar ? object_getIvar(timing, ivar) : nil;
}

/// O alvo mais próximo entre os timers pendentes, ou nil.
static NSDate *proximoAlvo(id timing)
{
  NSMutableDictionary *timers = timersDe(timing);
  if (!timers) return nil;
  NSDate *alvo = nil;
  @synchronized(timers) {
    for (id t in timers.allValues) {
      NSDate *d = [t valueForKey:@"target"];
      if (d && (!alvo || [d compare:alvo] == NSOrderedAscending)) alvo = d;
    }
  }
  return alvo;
}

static void armar(id timing);

static void socorrer(id timing)
{
  NSDate *alvo = proximoAlvo(timing);
  if (!alvo || [alvo timeIntervalSinceNow] > 0) return;
  // Venceu e ninguém disparou: dispara aqui, na thread do JS, e devolve o display link.
  ((void (*)(id, SEL, id))objc_msgSend)(timing, @selector(didUpdateFrame:), nil);
  BOOL *fundo = boolDoIvar(timing, "_inBackground");
  BOOL *pausado = boolDoIvar(timing, "_paused");
  if (fundo && pausado && !*fundo) {
    *pausado = YES;
    ((void (*)(id, SEL))objc_msgSend)(timing, NSSelectorFromString(@"startTimers"));
  }
}

static void armar(id timing)
{
  ProOpsRede *rede = objc_getAssociatedObject(timing, kChaveDaRede);
  if (!rede) {
    rede = [ProOpsRede new];
    __weak id fraco = timing;
    // Repete de propósito (intervalo enorme): um timer que já disparou fica inválido e não
    // aceitaria a próxima data. Quem decide a próxima é sempre `armar`.
    rede->timer = CFRunLoopTimerCreateWithHandler(
        kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + 1e9, 1e9, 0, 0, ^(CFRunLoopTimerRef _) {
          id forte = fraco;
          if (!forte) return;
          socorrer(forte);
          armar(forte);
        });
    // A thread de quem cria o timer é a do JS: a rede mora no runloop dela, em todos os modos.
    rede->loop = CFRunLoopGetCurrent();
    CFRunLoopAddTimer(rede->loop, rede->timer, kCFRunLoopCommonModes);
    objc_setAssociatedObject(timing, kChaveDaRede, rede, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  NSDate *alvo = proximoAlvo(timing);
  CFAbsoluteTime quando = alvo ? alvo.timeIntervalSinceReferenceDate + kFolga : CFAbsoluteTimeGetCurrent() + 1e9;
  CFRunLoopTimerSetNextFireDate(rede->timer, quando);
}

@interface ProOpsRedeDosTimers : NSObject
@end

@implementation ProOpsRedeDosTimers

+ (void)load
{
  Class cls = NSClassFromString(@"RCTTiming");
  SEL criar = NSSelectorFromString(@"createTimerForNextFrame:duration:jsSchedulingTime:repeats:");
  Method metodo = cls ? class_getInstanceMethod(cls, criar) : NULL;
  if (!metodo || !class_getInstanceVariable(cls, "_timers") || !class_getInstanceVariable(cls, "_paused") ||
      !class_getInstanceVariable(cls, "_inBackground") ||
      !class_getInstanceMethod(cls, NSSelectorFromString(@"startTimers")) ||
      !class_getInstanceMethod(cls, @selector(didUpdateFrame:))) {
    NSLog(@"[ProOpsRelogio] RCTTiming mudou: a rede dos timers NÃO foi instalada.");
    return;
  }
  typedef void (*Criar)(id, SEL, NSNumber *, NSTimeInterval, NSDate *, BOOL);
  Criar original = (Criar)method_getImplementation(metodo);
  method_setImplementation(
      metodo,
      imp_implementationWithBlock(^(id timing, NSNumber *callbackID, NSTimeInterval duracao, NSDate *agendado, BOOL repete) {
        original(timing, criar, callbackID, duracao, agendado, repete);
        armar(timing);
      }));
}

@end
