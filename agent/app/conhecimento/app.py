"""Catálogo do que o agente sabe dizer sobre o PRÓPRIO app.

O modelo nunca escreve estas respostas: ele só ESCOLHE ids (`ajuda.escolher`), e o texto sai
daqui. Resposta livre sobre "onde fica cada tela" é a porta por onde o agente inventaria telas que
não existem. Cada `rota` é um caminho expo-router real (`tests/test_conhecimento_sincronia.py`
confere contra `src/app/` e contra o `GUIA` de `src/lib/dicas.ts`); o caminho para o WhatsApp vai
ESCRITO na resposta, porque lá não há botão.

Entrada nova: `perguntas` são frases como a pessoa fala (3 a 6), e a `resposta` fica curta.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Entrada:
    id: str
    titulo: str
    perguntas: tuple[str, ...]
    resposta: str
    rota: str | None = None
    tela: str = ""  # nome do botão "Abrir <tela>" no chat do app


SUPORTE = "Isso eu ainda não sei responder. Fale com o suporte em Perfil → Ajuda e suporte."

CATALOGO: tuple[Entrada, ...] = (
    Entrada(
        "agente_faz", "O que o agente faz",
        ("o que você consegue fazer?", "como você funciona?", "me ajuda", "quem é você?",
         "você lança parcelado?", "o que posso pedir pra você?"),
        "👋 Eu lanço gastos, guardo notas e crio lembretes por mensagem. Ex.: \"gastei 45 no mercado\", "
        "\"anota: ligar pro dentista\", \"quanto gastei esse mês?\". Antes de mudar algo eu confirmo "
        "(responda *sim*).",
    ),
    Entrada(
        # Resposta CURTA e sem rota: agradecer não é pedir a tela de ajuda (15/10/2026: "valeu, ajudou muito"
        # recebia a apresentação inteira do agente).
        "agradecimento", "Agradecimento ou despedida",
        ("valeu", "muito obrigado", "brigadão", "tchau", "até mais", "agradeço"),
        "😊 Por nada! É só mandar quando precisar.",
    ),
    Entrada(
        "agente_nao_faz", "O que o agente não faz",
        ("o que você não faz?", "você importa extrato?", "você consegue cancelar minha assinatura?",
         "você apaga minha conta?", "você dá conselho de investimento?"),
        "Eu não faço: importar extrato ou fatura em arquivo (isso é no app, Perfil → Importar "
        "extrato), mudar ou cancelar assinatura, baixar seus dados, apagar sua conta, nem dar "
        "conselho de investimento. Também não mudo nada sem o seu *sim*.",
        "/import", "Importar extrato",
    ),
    Entrada(
        "lancar", "Lançar um gasto ou receita",
        ("onde faço um lançamento?", "como lanço um gasto?", "como registro uma receita?",
         "onde adiciono uma despesa?", "como lançar à mão?"),
        "Pelo app: *Finanças → Lançar* (botão +) e escolha *Gasto ou receita*. Ou fale comigo: "
        "\"gastei 45 no mercado\" que eu monto o lançamento e peço seu *sim*.",
        "/finance/lancar", "Lançar",
    ),
    Entrada(
        "lancar_recorrente", "Lançar algo recorrente",
        ("como cadastro uma conta fixa?", "como lanço um salário que cai todo mês?",
         "como crio uma assinatura que repete?", "onde faço um lançamento recorrente?"),
        "*Finanças → Lançar → Recorrente*: título, valor, quando repete e até quando. "
        "Ou diga: \"me lembra de pagar o aluguel todo dia 5\" ou \"recebo 3000 todo dia 5\".",
        "/finance/lancar", "Lançar",
    ),
    Entrada(
        "lancar_financiamento", "Cadastrar um financiamento",
        ("como cadastro um financiamento?", "onde coloco meu empréstimo?",
         "como registro uma dívida com parcelas?", "como cadastro o financiamento do carro?"),
        "*Finanças → Lançar → Financiamento*: nome, valor, parcelas e vencimento. "
        "As dívidas ficam em *Finanças → Gerenciar → Dívidas*, onde você paga cada parcela.",
        "/finance/lancar", "Lançar",
    ),
    Entrada(
        "lancar_parcelado", "Compra parcelada",
        ("como lanço uma compra parcelada?", "onde vejo minhas parcelas?",
         "como parcelo um gasto no cartão?", "você lança parcelado?"),
        "Diga: \"comprei um notebook em 6x de 700 no nubank\" e eu monto as parcelas na fatura. "
        "No app, *Finanças → Lançar* com o cartão e o número de parcelas. "
        "O acompanhamento fica em *Finanças → Gerenciar → Parceladas*.",
        "/finance/installments", "Parceladas",
    ),
    Entrada(
        "voz", "Lançar por voz",
        ("posso lançar falando?", "como lanço por voz?", "dá pra mandar áudio?",
         "tem como ditar o gasto?"),
        "No app: *Finanças → Lançar → Por voz* (ou o microfone do chat *Agente*). Você fala, revisa "
        "o texto e o lançamento abre preenchido para você salvar. No WhatsApp é só mandar um áudio.",
        "/finance/lancar", "Lançar",
    ),
    Entrada(
        "compartilhar", "Compartilhar comprovante",
        ("posso mandar a foto do comprovante?", "como lanço a partir de um comprovante?",
         "dá pra compartilhar um print do Pix?", "como lançar a partir de uma foto?"),
        "Pode sim. No chat *Agente* do app, toque no clipe ao lado do campo (*Tirar foto* ou "
        "*Escolher da galeria*, com legenda se quiser). No WhatsApp, mande a foto, o PDF ou um áudio. "
        "Também dá para compartilhar o comprovante de outro app com o ProOps: ele monta o "
        "lançamento preenchido e você só confere e salva.",
    ),
    Entrada(
        "notificacoes", "Lançar pelas notificações do banco",
        ("dá pra lançar pelas notificações do banco?", "como o app lê a notificação do banco?",
         "captura automática de gastos"),
        "No Android, *Perfil → Lançar pelas notificações* deixa o app ler a notificação do banco "
        "e sugerir o lançamento. Nada é lançado sozinho: você confirma na lista *A confirmar*.",
        "/captura-notificacoes", "Lançar pelas notificações",
    ),
    Entrada(
        "importar", "Importar extrato ou fatura",
        ("como importo o extrato?", "onde importo a fatura do cartão?",
         "como subo o arquivo do banco?", "aceita OFX ou CSV?"),
        "*Perfil → Importar extrato* (ou *Finanças → Gerenciar → Importar extrato*): escolha a "
        "conta ou o cartão, o arquivo do banco, confira a prévia e importe. O que já está no app "
        "fica de fora. O histórico fica em *Perfil → Importações*.",
        "/import", "Importar extrato",
    ),
    Entrada(
        "contas", "Contas",
        ("como cadastro uma conta?", "onde vejo o saldo das contas?", "como vejo o extrato de uma conta?",
         "onde crio uma carteira?", "como defino a conta padrão?"),
        "*Finanças → Contas*: toque numa conta para ver o saldo e o extrato; o + cadastra uma nova. "
        "Também dá para dizer: \"cria a conta Nubank\".",
        "/finance/accounts", "Contas",
    ),
    Entrada(
        "cartoes", "Cartões de crédito",
        ("como cadastro um cartão?", "onde vejo meus cartões?", "como adiciono um cartão de crédito?",
         "onde defino o fechamento e o vencimento?"),
        "*Finanças → Cartões* (ou *Contas → +*, tipo cartão): nome, dia de fechamento, dia de "
        "vencimento e limite. Também dá para dizer: \"cadastra o cartão Nubank, fecha dia 3 e "
        "vence dia 10\".",
        "/finance/cards", "Cartões",
    ),
    Entrada(
        "fatura", "Ver a fatura do cartão",
        ("onde vejo a fatura?", "como vejo o que tem na fatura do cartão?",
         "qual o valor da fatura?", "onde ficam as faturas anteriores?"),
        "*Finanças → Cartões* e toque no cartão (ou *Gerenciar → Faturas*): você vê as compras, "
        "o total e o vencimento. Pergunte também: \"qual a fatura do nubank?\".",
        "/finance/invoices", "Faturas",
    ),
    Entrada(
        "fatura_pagar", "Pagar ou adiar a fatura",
        ("como pago a fatura?", "como marco a fatura como paga?", "como adio a fatura?",
         "paguei só uma parte da fatura, e agora?", "como desfaço o pagamento da fatura?"),
        "Abra a fatura (*Finanças → Cartões*, toque no cartão) e use *Pagar*: você escolhe de "
        "onde saiu o dinheiro (ou só marca como paga) e o valor, que pode ser parcial. Se não "
        "pagou, *Jogar para a próxima* adia o saldo para a fatura seguinte. Tudo se desfaz "
        "apagando o pagamento.",
        "/finance/invoices", "Faturas",
    ),
    Entrada(
        "parceladas", "Compras parceladas",
        ("onde vejo as compras parceladas?", "como edito uma compra parcelada?",
         "como adianto parcelas?", "como mudo o número de parcelas?"),
        "*Finanças → Gerenciar → Parceladas*: cada compra com as parcelas a seguir e as já pagas. "
        "Em *Editar a compra* você muda total, parcelas, conta e categoria.",
        "/finance/installments", "Parceladas",
    ),
    Entrada(
        "recorrentes", "Recorrentes e assinaturas",
        ("onde vejo minhas contas fixas?", "como edito uma assinatura?", "como pauso uma recorrência?",
         "como encerro uma conta que repete?", "onde ficam os lançamentos recorrentes?"),
        "*Finanças → Gerenciar → Recorrentes*: veja as próximas ocorrências, edite a série, pause "
        "ou encerre em uma data.",
        "/finance/recurring", "Recorrentes",
    ),
    Entrada(
        "orcamentos", "Orçamentos",
        ("como defino um limite por categoria?", "onde crio um orçamento?",
         "como saber se estourei o orçamento?", "como controlo meus gastos por categoria?"),
        "*Finanças → Gerenciar → Orçamentos*: defina um limite por categoria (padrão ou só de um "
        "mês) e acompanhe quanto já usou. Também dá para dizer: \"limite de 800 para mercado\".",
        "/finance/budgets", "Orçamentos",
    ),
    Entrada(
        "metas", "Metas",
        ("como crio uma meta?", "onde guardo dinheiro para um objetivo?", "como adiciono dinheiro numa meta?",
         "onde vejo minhas metas?"),
        "*Finanças → Gerenciar → Metas*: crie a meta com valor e prazo, e use *Guardar* para "
        "somar dinheiro. Ou diga: \"guardei 200 na meta viagem\".",
        "/finance/goals", "Metas",
    ),
    Entrada(
        "dividas", "Dívidas e financiamentos",
        ("onde vejo minhas dívidas?", "como pago uma parcela do financiamento?",
         "quanto falta pagar do financiamento?", "como acompanho meus empréstimos?"),
        "*Finanças → Gerenciar → Dívidas*: toque na dívida para ver as parcelas e usar *Paguei*. "
        "Também pergunte: \"quanto falta do carro?\".",
        "/finance/debts", "Dívidas",
    ),
    Entrada(
        "projecao", "Projeção e \"E se…?\"",
        ("como vejo meu saldo nos próximos meses?", "como simulo uma compra?", "o que é o E se?",
         "dá pra projetar o caixa?", "posso comprar isso?"),
        "*Finanças → Projeção*: o saldo mês a mês até a data que você escolher. Lá, *Nova hipótese* "
        "(\"E se…?\") simula uma compra, uma entrada ou um parcelamento antes de você fazer.",
        "/finance/forecast", "Projeção",
    ),
    Entrada(
        "ciclo", "Mês, ciclo e dia de fechamento",
        ("como mudo o dia que o mês fecha?", "o que é ciclo?", "como faço o mês começar no dia 11?",
         "qual a diferença entre mês e ciclo?", "como vejo o fechamento do ciclo?"),
        "O ciclo é o seu mês financeiro, que fecha no dia em que você paga as contas. Escolha o dia "
        "em *Perfil* (linha do ciclo do mês). Nas telas há o botão *Mês | Ciclo* para alternar, e "
        "*Finanças → Ciclo* mostra o que entra e sai nele.",
        "/finance/cycle", "Ciclo",
    ),
    Entrada(
        "patrimonio", "Patrimônio",
        ("onde vejo meu patrimônio?", "como cadastro um imóvel ou carro?", "como acompanho investimentos?",
         "onde vejo meus bens?"),
        "*Finanças → Gerenciar → Patrimônio*: caixa, investimentos, bens e dívidas num número só. "
        "Cadastre bens e atualize o valor deles quando mudar.",
        "/finance/net-worth", "Patrimônio",
    ),
    Entrada(
        "lancamentos", "Lista de lançamentos",
        ("onde vejo todos os lançamentos?", "como busco um gasto?", "como filtro por categoria?",
         "onde vejo o extrato do mês?"),
        "*Finanças → Lançamentos*: tudo do mês ou do ciclo, com busca e filtros. Toque num "
        "lançamento para editar ou apagar.",
        "/finance/transactions", "Lançamentos",
    ),
    Entrada(
        "editar_apagar", "Corrigir ou apagar um lançamento",
        ("como corrijo um gasto?", "como apago um lançamento?", "errei o valor, como mudo?",
         "como desfaço o último lançamento?"),
        "No app, toque no lançamento em *Finanças → Lançamentos*. Comigo, é só dizer: "
        "\"apaga o último\" ou \"o mercado foi 52, não 45\". Eu mostro o que vou mudar e só faço "
        "depois do seu *sim*.",
        "/finance/transactions", "Lançamentos",
    ),
    Entrada(
        "categorias", "Categorias",
        ("como crio uma categoria?", "como renomeio uma categoria?", "como junto duas categorias?",
         "como troco o ícone de uma categoria?"),
        "*Perfil → Categorias* para criar, renomear, trocar ícone e cor ou juntar.",
        "/finance/categories", "Categorias",
    ),
    Entrada(
        "regras", "Regras",
        ("onde vejo as regras do agente?", "como faço o app categorizar sozinho?",
         "como faço a nota ir direto para uma pasta?", "como apago uma regra?"),
        "*Perfil → Regras*: por palavra, o lançamento ganha a categoria (tudo com \"uber\" vira "
        "transporte) e a nota vai para a pasta. Comigo: \"sempre que eu citar proops numa nota, "
        "põe na pasta proops\".",
        "/finance/rules", "Regras",
    ),
    Entrada(
        "relatorios", "Relatórios e Imposto de Renda",
        ("onde exporto para o imposto de renda?", "tem relatório?", "como vejo para onde foi meu dinheiro?",
         "como exporto meus lançamentos?"),
        "*Finanças → Gerenciar → Relatórios* reúne os relatórios, inclusive os bens e direitos "
        "de 31/12 para o Imposto de Renda. Para onde o dinheiro foi: bloco \"Para onde foi\" em *Finanças*.",
        "/finance/reports", "Relatórios",
    ),
    Entrada(
        "favoritos", "Favoritos",
        ("o que são favoritos?", "como salvo um lançamento que repito sempre?", "como duplico um lançamento?"),
        "Favoritos são modelos de lançamento: em *Finanças → Gerenciar → Favoritos* ficam os que "
        "você salvou, e ao lançar eles preenchem o formulário. Para repetir um lançamento, use "
        "*Duplicar* no menu dele.",
        "/finance/favorites", "Favoritos",
    ),
    Entrada(
        "notas", "Notas",
        ("onde vejo minhas notas?", "como anoto algo?", "como crio uma pasta de notas?",
         "como recupero uma nota apagada?", "dá para criar pasta dentro de pasta?"),
        "Aba *Notas*: anote, organize em pastas e arquive. Pasta pode ficar dentro de pasta (até 5 "
        "níveis): diga \"anota em trabalho / 2026: ...\" ou \"crie a pasta 2026 dentro de trabalho\" "
        "e eu crio o que faltar. Ou diga: \"anota: ligar pro dentista\". "
        "Apagadas vão para a lixeira e podem voltar.",
        "/notes", "Notas",
    ),
    Entrada(
        "notas_arquivadas", "Notas arquivadas",
        ("onde ficam as notas arquivadas?", "como desarquivo uma nota?", "arquivei uma nota sem querer"),
        "As notas arquivadas ficam no fim da aba *Notas*; de lá elas voltam.",
        "/notes/archived", "Notas arquivadas",
    ),
    Entrada(
        "financas", "A aba Finanças",
        ("o que tem na aba Finanças?", "onde vejo o resumo do meu dinheiro?", "onde fica o financeiro?"),
        "A aba *Finanças* é o centro do dinheiro: o painel do ciclo (toque nele para ver como o "
        "valor é calculado), seus cartões, os atalhos, os últimos lançamentos e *Gerenciar* para "
        "tudo o resto.",
        "/finance", "Finanças",
    ),
    Entrada(
        "lembretes", "Lembretes",
        ("como crio um lembrete?", "onde vejo meus lembretes?", "como faço um lembrete que repete?",
         "como me avisam de uma conta?"),
        "Diga: \"me lembra de pagar o aluguel todo dia 5 às 9h\". Os do dia aparecem em *Hoje*; a "
        "lista inteira (criar, editar, pausar) fica em *Perfil → Lembretes*. Chegam por notificação e WhatsApp.",
        "/reminders", "Lembretes",
    ),
    Entrada(
        "hoje", "A tela Hoje",
        ("o que tem na tela Hoje?", "onde vejo o que vence hoje?", "o que é o dá para gastar?"),
        "A aba *Hoje* mostra o seu dia: o que vence, o lembrete, quanto dá para gastar e o que "
        "você gastou. Toque no valor para ver como ele é calculado.",
        "/today", "Hoje",
    ),
    Entrada(
        "agente_app", "Conversar com o agente no app",
        ("posso falar com você pelo app?", "onde fica o chat?", "preciso do WhatsApp para usar o agente?"),
        "Aba *Agente*: é a mesma conversa do WhatsApp, dentro do app. Dá para usar o produto sem "
        "WhatsApp.",
        "/agent/new", "Agente",
    ),
    Entrada(
        "whatsapp", "Conectar o WhatsApp",
        ("como conecto meu WhatsApp?", "como vinculo meu número?", "como troco o telefone?",
         "por que o agente não responde no WhatsApp?"),
        "*Perfil → Conta → Conectar o WhatsApp*: informe seu número e confirme o código que "
        "chega no WhatsApp. Só depois disso o agente responde por lá.",
        "/link-phone", "Conectar o WhatsApp",
    ),
    Entrada(
        "plano", "Assinatura e plano",
        ("quanto custa?", "como assino?", "como cancelo a assinatura?", "qual o meu plano?",
         "quantas mensagens de IA eu tenho?"),
        "*Perfil → Plano* mostra seu plano, o uso de IA do mês e permite gerenciar ou cancelar a "
        "assinatura. O preço e o teste grátis aparecem na tela de assinar.",
        "/finance/plan", "Plano",
    ),
    Entrada(
        "membros", "Convidar pessoas",
        ("posso dividir com outra pessoa?", "como convido meu marido ou esposa?", "como adiciono um membro?"),
        "*Perfil → Pessoas* convida alguém pelo telefone para compartilhar o mesmo espaço, "
        "conforme o limite do seu plano.",
        "/profile/members", "Pessoas",
    ),
    Entrada(
        "privacidade", "Privacidade e seus dados",
        ("como baixo meus dados?", "como apago minha conta?", "o que fazem com meus dados?",
         "como paro de receber novidades?", "como oculto os valores?"),
        "Em *Perfil → Privacidade e dados*: baixar seus dados, escolher se recebe novidades e ofertas. "
        "Apagar a conta é em *Perfil → Apagar conta* (ou *Ajuda e suporte → Como apagar a conta*). "
        "Os Termos e a Política de Privacidade ficam em *Perfil → Ajuda e suporte*.",
        "/ajuda", "Ajuda e suporte",
    ),
    Entrada(
        "suporte", "Falar com o suporte",
        ("como falo com o suporte?", "preciso de ajuda de uma pessoa", "achei um erro no app",
         "onde reporto um problema?"),
        "*Perfil → Ajuda e suporte → Falar com o suporte* abre um e-mail já com a versão do app. "
        "Lá também está *Como usar o ProOps*.",
        "/ajuda", "Ajuda e suporte",
    ),
    Entrada(
        "guia", "Guia de uso do app",
        ("tem um tutorial?", "como uso o app?", "por onde começo?", "onde fica o guia?"),
        "*Perfil → Ajuda e suporte → Como usar o ProOps* reúne tudo que dá para fazer, em grupos "
        "curtos. Para começar, cadastre uma conta (*Finanças → Contas*) e diga um gasto para mim.",
        "/guia", "Como usar o ProOps",
    ),
)

POR_ID: dict[str, Entrada] = {e.id: e for e in CATALOGO}

# A ajuda geral (saudação, "o que você faz") e o aviso de "não entendi" saem da MESMA entrada.
AJUDA_GERAL = POR_ID["agente_faz"].resposta
