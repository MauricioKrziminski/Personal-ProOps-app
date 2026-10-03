import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Presenca } from '@/components/motion/presenca';
import { Button } from '@/components/ui/button';
import { useConceal } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Space } from '@/design/tokens';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import type { CategoryDetailLine } from '@/lib/category-detail-breakdown';
import { useCategoryDetailBreakdown } from '@/hooks/use-category-details';

/** The server's exact breakdown includes Sem detalhe; this view never recomputes finances. */
export function CategoryDetailBreakdown({from,to,parent,kind,workspaceId}:{from:string;to:string;parent:string;kind:'expense'|'income';workspaceId?:string}){
  const key=JSON.stringify([from,to,parent,kind,workspaceId]);
  const [session,setSession]=useState({key,expanded:false});
  if(session.key!==key)setSession({key,expanded:false});
  const expanded=session.key===key&&session.expanded;
  const query=useCategoryDetailBreakdown(from,to,parent,kind,workspaceId,expanded);
  const current=!query.isError&&query.data&&query.data.from===from&&query.data.to===to&&query.data.parent_category===parent
    &&query.data.kind===kind&&query.data.workspace_id===(workspaceId?.toLowerCase()??null)?query.data:null;
  const page=useAosPoucos(current?.lines??[],key);
  return <View style={styles.body}>
    <Row title="Detalhes" subtitle="Inclui Sem detalhe" chevron={false} accessibilityState={{expanded}}
      onPress={()=>setSession({key,expanded:!expanded})} />
    <Presenca key={key} visivel={expanded}>
      {expanded?<View style={styles.body}>
        {query.isPending?<ThemedText type="small" themeColor="textSecondary">Conferindo detalhes…</ThemedText>:null}
        {query.isError?<View style={styles.body}><ThemedText type="small" themeColor="danger" accessibilityRole="alert">Não consegui conferir estes detalhes.</ThemedText>
          <Button label="Tentar de novo" variant="secondary" onPress={()=>{void query.refetch();}} /></View>:null}
        {current?<>
          <Section>{page.visiveis.map(line=><CategoryDetailRow key={line.subcategory_id??'none'} line={line} />)}</Section>
          {!current.lines.length?<ThemedText type="small" themeColor="textSecondary">Sem registros neste período.</ThemedText>:null}
          {page.restantes?<Button label="Ver mais detalhes" variant="secondary" onPress={page.verMais} />:null}
          <Row title="Total da categoria" inlineValue trailing={<Money cents={current.total_cents} variant="footnote" />} />
        </>:null}
      </View>:null}
    </Presenca>
  </View>;
}
// Privacy stays live even while Presenca retains an exit layer.
function CategoryDetailRow({line}:{line:CategoryDetailLine}){
  const {concealed,ready}=useConceal();const hidden=concealed||!ready;
  return <Row title={hidden?'Detalhe oculto':line.name??'Sem detalhe'}
    subtitle={hidden?'Registros ocultos':`${line.tx_count} registros${line.workspace_name?` · ${line.workspace_name}`:''}`}
    trailing={<Money cents={line.total_cents} variant="footnote" />} />;
}
const styles=StyleSheet.create({body:{gap:Space.md}});
