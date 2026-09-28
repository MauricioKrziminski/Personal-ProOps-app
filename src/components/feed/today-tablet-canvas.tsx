import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { PANE_GAP } from '@/design/adaptive-window';

interface TodayTabletCanvasProps {
  saudacao: ReactNode;
  passos: ReactNode;
  semana: ReactNode;
  dia: ReactNode;
  dinheiro: ReactNode;
  proximos: ReactNode;
  notas: ReactNode;
}

/**
 * Os MESMOS blocos da Hoje do celular, em duas colunas: à esquerda o dia (o que acontece e o que
 * vem), à direita o dinheiro e as notas. Uma coluna só repete a ordem do celular.
 */
export function TodayTabletCanvas({ saudacao, passos, semana, dia, dinheiro, proximos, notas }: TodayTabletCanvasProps) {
  return (
    <AdaptivePanes
      testID="today-tablet-canvas"
      main={<View style={styles.column}>{saudacao}{passos}{semana}{dia}{proximos}</View>}
      support={<View style={styles.column}>{dinheiro}{notas}</View>}
      singlePaneContent={
        <View style={styles.column}>{saudacao}{passos}{semana}{dia}{dinheiro}{proximos}{notas}</View>
      }
    />
  );
}

const styles = StyleSheet.create({
  column: { gap: PANE_GAP, minWidth: 0 },
});
