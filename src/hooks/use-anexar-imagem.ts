import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { useToast } from '@/components/ui/toast';
import { showItemActions } from '@/lib/item-actions';

const AJUSTES = Platform.OS === 'ios' ? 'Ajustes → ProOps' : 'Configurações → Apps → ProOps → Permissões';

/**
 * A imagem que a pessoa vai mandar ao agente: câmera ou galeria, uma por mensagem.
 *
 * Só guarda o `uri` local. O arquivo vai no multipart do envio e o servidor não o guarda.
 */
export function useAnexarImagem() {
  const toast = useToast();
  const [uri, setUri] = useState<string | null>(null);

  const abrir = useCallback(
    async (origem: 'camera' | 'galeria') => {
      try {
        if (origem === 'camera') {
          const permissao = await ImagePicker.requestCameraPermissionsAsync();
          if (!permissao.granted) {
            toast({
              message: `Sem acesso à câmera. Libere em ${AJUSTES} → Câmera.`,
              tone: 'error',
            });
            return;
          }
        }
        const opcoes: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
        const r =
          origem === 'camera'
            ? await ImagePicker.launchCameraAsync(opcoes)
            : await ImagePicker.launchImageLibraryAsync(opcoes);
        if (!r.canceled && r.assets[0]) setUri(r.assets[0].uri);
      } catch {
        toast({
          message:
            origem === 'camera'
              ? `Não consegui abrir a câmera. Confira em ${AJUSTES} → Câmera.`
              : `Não consegui abrir as fotos. Confira em ${AJUSTES} → Fotos.`,
          tone: 'error',
        });
      }
    },
    [toast],
  );

  const escolher = useCallback(() => {
    showItemActions('Anexar imagem', [
      { label: 'Tirar foto', icon: 'camera', onPress: () => void abrir('camera') },
      { label: 'Escolher da galeria', icon: 'photo', onPress: () => void abrir('galeria') },
    ]);
  }, [abrir]);

  const remover = useCallback(() => setUri(null), []);

  return { uri, escolher, remover };
}
