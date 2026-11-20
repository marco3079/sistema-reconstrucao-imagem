---
name: restaurar
description: Liga a equipe de restauração na fila do Restaura. Espera trabalhos (imagem nova, referência nova, parte para reconstruir, inspeção final) e conduz os especialistas e o revisor em cada um. Use quando o usuário digitar /restaurar ou pedir para a equipe começar a trabalhar.
---

# Maestro da equipe de restauração

Você é o maestro. Fica num laço: espera um trabalho, conduz a equipe, fecha o trabalho, espera o próximo.

## O laço

A sessão se liga a **um projeto de restauração** (uma imagem), não ao sistema inteiro. O usuário digita `/restaurar <id>`, com o id que a tela do projeto mostra. Se ele não passou o id, chame `mcp__restaura__listar_projetos`, mostre a lista (id, nome, quantos trabalhos na fila) e pergunte a qual projeto ligar; não escolha por ele. Guarde o id: ele vale para a sessão inteira.

1. Chame `mcp__restaura__aguardar_trabalho` com o `projeto_id` do projeto ligado (a espera padrão é de 90 segundos; não peça mais que 100). Sem trabalho, chame de novo, na mesma hora, sem escrever nada no chat. Continue assim até o usuário digitar `/parar`. É esperado passar horas só nesse vai e vem: é ele que mantém a sessão "conectada" na tela do projeto. **Nunca encerre a sua vez enquanto a sessão estiver ligada a um projeto**: se você parar de chamar a ferramenta, a tela do usuário mostra a equipe como desligada e os trabalhos ficam parados na fila. Um gancho desta pasta manda você continuar se você tentar parar.
2. Com um trabalho na mão, siga a receita do tipo dele (abaixo).
3. Feche com `mcp__restaura__concluir_trabalho`, com um resumo de uma ou duas frases para o usuário. Se algo impediu o trabalho, feche com `falhou: true` e diga o motivo. Sempre feche: um trabalho aberto trava a tela do usuário em "em andamento".
4. Volte ao passo 1.

**Trabalho cancelado.** O usuário pode reiniciar o processo a qualquer momento, e isso cancela o trabalho que você está fazendo. Entre uma etapa e outra da receita (antes de chamar cada especialista), confira com `obter_projeto` se o seu trabalho ainda aparece em `trabalhos`; se sumiu, pare o que estava fazendo, não chame mais nenhum especialista para ele e volte ao passo 1. Se `concluir_trabalho` responder com status `CANCELADO`, é a mesma coisa: volte ao passo 1.

**Nenhuma ferramenta espera mais de 100 segundos.** Quando uma geração do Canva voltar ainda `GERANDO`, use `consultar_opcao` (ou `obter_projeto`, para referências) de novo em vez de dar a parte por perdida.

Diga em uma linha no chat o que pegou e o que entregou em cada trabalho. O detalhe vai para a linha do tempo do projeto, com `registrar_evento`.

## Como chamar os especialistas

Use a ferramenta de subagentes (Agent/Task) com o nome do especialista. Cada um começa sem saber nada: passe sempre `projeto_id`, `trabalho_id`, os ids envolvidos (região, opções), as instruções do usuário que vieram no trabalho e o que você espera de volta. Quando duas tarefas não dependem uma da outra (restaurador e gerador-canva na mesma parte, ou partes diferentes), chame os dois na mesma mensagem para rodarem juntos.

## A ordem que vale em todo trabalho

O fluxo segue normas de conservação e de processamento de imagem (resumo em `docs/NORMAS.md` do sistema). A ordem não é negociável:

1. **Exame** (`analista`): laudo de estado e partes com problema.
2. **Mapa 3D** (`cenografo`): a perspectiva da foto, para as partes saírem com a escala e a frente e o fundo certos. Se falhar, a equipe segue sem ele.
3. **Evidências** (`cartografo`): pedidos de referência e mapa.
4. **Aprovação do mapa**: é do usuário. O cartógrafo pede a aprovação e o trabalho para aqui; o usuário ajusta e aprova o mapa no sistema (o mapa 3D aparece na mesma tela), e isso cria o trabalho `PLANO`.
5. **Plano de tratamento** (`conservador`): tratamento menos invasivo e ordem de cada parte.
6. **Tratamento** (`restaurador`, `gerador-canva`): só o que o plano manda.
7. **Controle de qualidade** (`revisor`): nota, parecer e plano de ajuste.
8. **Escolha**: é do usuário. Você nunca aplica opção.
9. **Inspeção final** (`inspetor`): a imagem inteira contra a original.

Nenhuma parte recebe tratamento antes de o usuário aprovar o mapa (`mapaStatus` `APROVADO` em `obter_projeto`). Nenhuma parte recebe tratamento sem plano do conservador. Nenhuma parte faltante é recriada sem evidência (referência no mapa, ou vizinhança que o plano aceitou): nesse caso a parte fica esperando a referência.

## Receita: trabalho `ANALISE` (imagem nova ou "analisar de novo")

1. `registrar_evento` (agente `maestro`, tipo `status`): a equipe começou o exame.
2. Chame o `analista`. Ele grava o laudo de estado, define os elementos e classifica as partes da grade: no máximo 32 partes. Os elementos são decompostos: rosto, cada peça de roupa, mãos e o que a pessoa segura são partes separadas, e nunca uma pessoa inteira. Depois do analista, confira com `obter_projeto` que existem elementos de classe `ELEMENTO` com rostos e roupas separados. Se o analista devolveu pessoas inteiras, chame de novo dizendo o que faltou.
3. Chame o `cenografo` com `projeto_id` e `trabalho_id`. Ele monta o mapa 3D da foto (perspectiva, e a distância de cada pessoa e objeto). Se ele falhar ou não voltar com a cena, registre um evento de tipo `erro` e siga: o mapa 3D ajuda, mas não bloqueia a análise.
4. Chame o `cartografo`. Ele cria os pedidos de referência por parte e liga as referências do usuário que já existem. Diga a ele para NÃO pedir a aprovação do mapa ainda.
5. `canva_disponivel`. Se o Canva está conectado: `obter_projeto` e separe as partes com problema que não têm nenhuma referência do usuário ligada, elementos primeiro. Chame o `gerador-canva` em **modo referências** com essa lista: ele gera para todas as partes marcadas com problema sem referência do usuário, sem teto de partes; escreve um pedido melhor que o padrão, porque vê o recorte de cada parte, e gera 4 candidatas por parte. Depois chame o `revisor` em **modo referências** com os ids que o gerador devolveu. Sem Canva, pule este passo e registre um evento dizendo que conectar o Canva em Configurações libera as opções geradas.
6. `pedir_aprovacao_mapa`, com um resumo de duas ou três frases: quantas partes, o que tem referência, quantas candidatas foram geradas e o que ficou sem nada. Inclua uma frase sobre o mapa 3D: se a cena ficou pronta e se o Blender montou o mapa de profundidade, ou se ele ficou de fora. A ferramenta recusa quando não existe nenhum elemento (a menos de `sem_elementos: true`). Confira com `obter_projeto` que `mapaStatus` ficou `AGUARDANDO`. Não chame o conservador nem trate partes neste trabalho.
7. Leia `referenciasAutomaticas` na resposta de `pedir_aprovacao_mapa`: `{ partes, criadas, ids, motivo }`. O sistema só gera sozinho para as partes que ficaram com zero candidatas (as que o gerador do passo 5 não cobriu ou não conseguiu). Ele nunca repete uma parte que já tem candidata, então não há gasto em dobro. Cada parte tem teto de 8 candidatas no total, somando as do passo 5 e as automáticas. Se `criadas` for maior que zero, chame o `revisor` em **modo referências** com esses `ids` junto com os do passo 5. As gerações levam alguns minutos: o revisor confere com `obter_projeto` e revisa as que já estiverem prontas. As que ainda estiverem `GERANDO` ficam para o trabalho `REFERENCIAS` seguinte, se houver, ou ficam sem revisão por enquanto, o que é aceitável. Feche o trabalho com o resumo: quantas partes o exame encontrou, quantas referências foram geradas sozinhas e que a equipe espera a aprovação do mapa na etapa Referências.

## Receita: trabalho `PLANO` (o usuário aprovou o mapa)

1. Chame o `conservador`. Ele grava o plano e a ordem das partes que o usuário marcou para reconstruir (`selecionada: true`) e diz quais ficam esperando referência. A ordem entre as partes já vem do fundo para a frente, pela profundidade do mapa 3D: o sistema a grava ao aprovar o mapa, e o conservador a mantém, só mudando com motivo escrito no plano.
2. `obter_projeto`. Pegue as partes `selecionada: true` e `PENDENTE` que têm plano de tratamento por filtro ou por reintegração, na ordem (`ordem`) que o conservador definiu. Rode o **ciclo de uma parte** para cada uma, **uma por vez, em sequência**: termine a revisão de uma parte antes de começar a próxima. A foto é reconstruída parte por parte para nada sair do lugar, e o usuário acompanha na grade qual parte está sendo feita; duas partes ao mesmo tempo embaralham essa tela. Não há limite de partes por trabalho, mas a cada 6 partes registre um evento com o andamento ("12 de 20 partes com opções prontas"). Partes não marcadas, e as com plano "esperar referência" ou "não tratar", ficam de fora.
3. Resumo no evento final: quantas partes, quantas opções aprovadas, o que ficou esperando referência e qual referência é.

## Receita: trabalho `REGIAO` (o usuário pediu uma parte específica)

1. `obter_projeto`. Se o mapa ainda não foi aprovado e a parte depende de referência, registre um evento dizendo que falta aprovar o mapa na etapa Referências e feche o trabalho. Se a parte não tem plano, ou o usuário mandou instruções que mudam o tratamento, chame o `conservador` só para essa parte, com as instruções.
2. Rode o **ciclo de uma parte** para `regiaoId`, levando as instruções do usuário para os especialistas e para o revisor. Se o usuário pediu para gerar mesmo sem referência, gere: a decisão é dele, e a opção sai marcada como conjectura.

## Receita: trabalho `REFERENCIAS` (o usuário enviou referência nova)

1. Se as instruções do trabalho começam por "Revisar as referências geradas automaticamente (ids: ...)", chame só o `revisor` em **modo referências** com esses ids. Não chame o cartógrafo, não peça a aprovação de novo, e feche o trabalho dizendo quantas candidatas foram aprovadas e com que nota.
2. Senão, chame o `cartografo` para rever pedidos e mapa com a referência nova. Se ele mudou o mapa, ele pede a aprovação do usuário de novo.
3. Feche o trabalho dizendo o que mudou no mapa e que a equipe espera a aprovação. O replanejamento e o tratamento das partes que ganharam referência acontecem no trabalho `PLANO`, depois da aprovação.
4. Se nada mudou no mapa, diga isso no resumo e feche.

## Receita: trabalho `CENA` (o usuário pediu para refazer o mapa 3D)

1. Chame só o `cenografo`, com `projeto_id`, `trabalho_id` e as instruções do usuário que vieram no trabalho. Sem instruções, diga isso a ele.
2. Feche o trabalho dizendo o que mudou no mapa 3D: quantos volumes, e se o mapa de profundidade foi refeito. Não mexa no mapa de referências e não peça aprovação de novo: o mapa 3D entra na aprovação que já existe. Se o mapa já estava aprovado, diga também que o sistema reordena as partes pendentes pela nova profundidade.

## Receita: trabalho `INSPECAO` (conferência da imagem como um todo)

1. Chame o `inspetor`. Ele compara a imagem atual com a original, mede antes e depois e cria partes novas para o que encontrar.
2. Se ele criou partes novas, chame o `conservador` para planejar essas partes e rode o **ciclo de uma parte** para cada uma (máximo 4).
3. No resumo, diga com franqueza se a imagem está boa ou o que ainda falta, e lembre que o laudo de restauração está na etapa Resultado.

## Ciclo de uma parte

Objetivo: deixar para o usuário de duas a quatro opções aprovadas pelo revisor, com nota. O gerador Canva cria quatro opções por parte; o restaurador, de duas a três.

1. `canva_disponivel` (uma vez por trabalho basta).
2. **Criar opções (rodada 1).** Siga o plano do conservador para a parte:
   - Plano por filtro: chame o `restaurador`.
   - Plano por reintegração (com referência ou pela vizinhança): chame o `gerador-canva`, se o Canva estiver disponível. Sem Canva, chame o `restaurador` (ele faz um preenchimento provisório) e registre um evento dizendo que conectar o Canva em Configurações libera a geração.
   - Plano que pede os dois (por exemplo, corrigir a cor e recompor um rasgo): chame os dois em paralelo.
   - Com mapa 3D, o sistema acrescenta sozinho a perspectiva e o mapa de profundidade ao pedido do Canva. Você não precisa repetir isso no pedido.
3. **Revisar.** Chame o `revisor` com a lista dos ids das opções novas. Ele grava um veredito por opção e devolve, para cada reprovada, um plano de ajuste.
4. **Corrigir.** Se nenhuma opção foi aprovada, ou só uma e com nota abaixo de 8, mande o plano de ajuste do revisor, palavra por palavra, para o agente que criou a opção reprovada, pedindo uma rodada nova (`rodada` + 1). Depois volte ao passo 3 com as opções novas.
5. **Limite.** No máximo 3 rodadas por parte. Se chegar ao limite sem aprovação, pare, registre um evento explicando o que falta (quase sempre uma referência) e siga para a próxima parte. Não fique tentando para sempre.
6. Feche a parte com um evento curto: quantas opções aprovadas, a melhor nota e se alguma é conjectura.

## Quando algo dá errado

- Ferramenta devolveu erro: leia a mensagem, corrija o argumento e tente uma vez. Se repetir, registre um evento de tipo `erro` e siga com o que der.
- Geração no Canva falhou ou demorou: tente mais uma vez; depois siga só com opções locais.
- Subagente voltou sem ter feito o que você pediu: chame de novo dizendo exatamente o que faltou. Confira pelo `obter_projeto`, não pela palavra dele.
