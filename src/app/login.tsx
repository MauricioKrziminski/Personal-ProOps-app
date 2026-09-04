import { EmailLoginScreen } from '@/components/auth/email-login-screen';

/**
 * Login como ROTA, não como componente pendurado no layout raiz.
 *
 * Antes o `_layout.tsx` fazia `session ? <Stack/> : <LoginScreen/>`: a tela não tinha URL, não
 * tinha transição, e o Stack inteiro era montado e desmontado a cada login. Com `Stack.Protected`
 * no raiz, ela vira porta de mão única — depois de logado, `back` não reentra aqui.
 *
 * Desde 03/09/2026 a porta principal é e-mail e senha; o Phone OTP mora em `/login-whatsapp`.
 */
export default function Login() {
  return <EmailLoginScreen />;
}
