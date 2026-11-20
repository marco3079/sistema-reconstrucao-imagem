# Grade de reconstrução, mapa por elementos e reinício

Contrato desta rodada. Vale junto com `docs/CONTRATOS.md` e `docs/NORMAS.md`. Tipos do cliente em `client/src/lib/tipos.ts`; modelo em `server/prisma/schema.prisma`.

## Ideia

A foto é separada em **até 32 partes**: os **elementos** importantes inteiros (rosto, corpo, roupa, objeto, texto...) e, para o resto, **células** de uma grade regular. Cada parte tem posição fixa e é reconstruída **uma por vez**, colando o resultado só dentro do retângulo dela, para nada sair do lugar. O usuário escolhe quais partes reconstruir. O mapa de referências é por parte: o recorte original fica sempre visível, o usuário importa referências, e a equipe gera candidatas no Canva que um revisor aprova.

## Modelo

`Regiao` (uma parte):
- `classe`: `DEFEITO` (marcada à mão, ou a "Imagem inteira"), `ELEMENTO` (definida pelo analista) ou `CELULA` (célula da grade).
- `categoria`: `ROSTO` | `CORPO` | `ROUPA` | `OBJETO` | `TEXTO` | `FUNDO` | `COR` | `OUTRO`.
- `selecionada`: o usuário quer reconstruir a parte. Parte não selecionada fica fora do fluxo (para passo atual, plano, tratamento e status do projeto conta como ignorada).
- `linha`, `coluna`: só em `CELULA`, a partir de 0.
- `problema` aceita também `NENHUM` (parte sem defeito).

`Projeto.gradeLinhas`, `Projeto.gradeColunas`: tamanho da grade (0 = não montada).

`Referencia`:
- `origem`: `USUARIO` (importada) ou `CANVA` (gerada para uma parte).
- `regiaoId`: parte para a qual foi importada ou gerada (pode ser null).
- `status`: `GERANDO` | `PENDENTE` (gerada, espera o revisor) | `APROVADA` | `REPROVADA` | `FALHOU`. Importadas nascem `APROVADA`.
- `nota`, `parecer` (do revisor), `prompt`, `erro`. Enquanto `GERANDO`, `arquivo` é `''` e largura/altura são 0.

Uma referência só entra no mapa (um `Vinculo`) por decisão do usuário. Referência gerada é palpite da IA: opção do Canva criada sem nenhuma referência de origem `USUARIO` vinculada continua `conjectura: true`, e ganha `parametros.referenciasGeradas: true` se usou alguma gerada.

## Grade (`server/src/lib/grade.ts`)

- Limite: 32 partes somando elementos, células e a parte "Imagem inteira" (se existir).
- Escolha da grade: entre todas as combinações `linhas × colunas` com 2 a 8 de cada lado, pega a de mais células cujo formato da célula em pixels seja próximo de quadrado (largura/altura entre 0,6 e 1,67) e que caiba no limite depois de descartar as células cobertas em 60% ou mais por elementos.
- Nome da célula: letra da linha e número da coluna, "Parte A1", "Parte B3".
- Cada célula é medida (análise local do recorte, sem considerar baixa resolução): se houver problema de gravidade 3 ou mais, vira o `problema` dela; senão `NENHUM`. `selecionada` = `problema !== 'NENHUM'`.
- Recriar a grade apaga só células `PENDENTE` sem opções; células já trabalhadas ficam.

## Ferramentas MCP novas

| Ferramenta | Argumentos | Efeito |
|---|---|---|
| `definir_elementos` | `projeto_id`, `elementos` (lista de até 24 objetos `{ nome, categoria, x, y, largura, altura, problema, gravidade, descricao }`, frações 0..1) | Substitui os elementos `PENDENTE` sem opções, recria a grade e devolve `{ grade: { linhas, colunas }, partes: [...] }`. Recusa com 400 elemento com área (largura × altura) maior que 0,30 da foto; e elemento de categoria `CORPO` ou `OUTRO` com área maior que 0,08, altura maior que 0,35 e altura maior que 1,3 vez a largura (pessoa inteira: separar em rosto, roupa, mãos, objetos; mão ou braço em close: reduzir o retângulo a essa parte; roupa: `ROUPA`). Recusa também quando elementos novos somados às partes que não são célula e ficam (manuais, imagem inteira, já trabalhadas) passam de 28; a mensagem diz quantos cabem. Elementos não devem se sobrepor |
| `criar_regiao` | como hoje | Não usar para pessoas, rostos, roupas ou objetos (isso é com `definir_elementos`); usar para a parte "Imagem inteira" ou um defeito que atravessa várias partes |
| `pedir_aprovacao_mapa` | `projeto_id`, `resumo`, `sem_elementos?` (booleano) | Marca o mapa `AGUARDANDO`. Sem nenhuma parte `ELEMENTO` no projeto, recusa com 400 (a não ser com `sem_elementos: true`). Depois de marcar, chama `gerarReferenciasQueFaltam(projetoId, { automatico: true })`: só partes com zero candidatas do Canva (de qualquer status). Erro na geração não derruba a ferramenta: devolve `referenciasAutomaticas` com `motivo: "Erro ao gerar: ..."`. Devolve `{ ok, mapaStatus, referenciasAutomaticas: { partes, criadas, ids, motivo }, proximo? }`; `proximo` (chamar o revisor em modo referências para os ids) só quando `criadas > 0` |
| `classificar_partes` | `projeto_id`, `partes` (lista de `{ regiao_id, nome?, categoria?, problema?, gravidade?, descricao? }`) | Atualiza várias partes de uma vez; quando `problema` muda, `selecionada` passa a `problema !== 'NENHUM'` |
| `gerar_referencias_canva` | `regiao_id`, `prompt`, `quantidade?` (1 a 4, padrão 4) | Gera candidatas a referência da parte; espera até 150 s; devolve a lista |
| `revisar_referencia` | `referencia_id`, `veredito` (`APROVADA` ou `REPROVADA`), `nota` (0 a 10), `parecer` | Grava o veredito do revisor na referência gerada |

## Rotas novas ou alteradas

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /regioes/:id/referencias/gerar` | `{ instrucoes?: string, quantidade?: 1..4 }` (padrão 4) | 201 `Referencia[]` em `GERANDO`; 409 se o Canva não está conectado |
| `POST /projetos/:id/referencias/gerar-faltantes` | sem corpo | 200 `{ partes, criadas, ids, motivo, revisao }` (`ResultadoReferenciasFaltantes` mais `revisao: 'PEDIDA' \| 'SEM_SESSAO' \| 'NAO_NECESSARIA'`; `PEDIDA` = trabalho `REFERENCIAS` criado (ou já na fila) porque há sessão da equipe ligada; `SEM_SESSAO` = criou candidatas mas não cria trabalho, as candidatas ficam sem revisão; `NAO_NECESSARIA` = nada criado). Dono do projeto. Gera no Canva 4 candidatas para cada parte que não tem referência do usuário (só `ELEMENTO` e `CELULA`, com defeito, `PENDENTE`, e sem geração no Canva em `GERANDO`, `PENDENTE` ou `APROVADA`); `ELEMENTO` antes de `CELULA`. Teto de 8 candidatas do Canva por parte, de qualquer status (parte com 8 ou mais fica de fora; o botão também refaz partes que só têm `FALHOU` ou `REPROVADA`). Para no limite de opções geradas (`motivo`). Erro numa parte para o laço e devolve os ids já criados com `motivo: "Erro ao gerar: ..."`. Sem Canva conectado, não lança: `motivo` = "Canva não conectado". Serializada por projeto. Se criou alguma, cria trabalho `REFERENCIAS` (instruções: revisar os ids) se não houver um na fila |
| `POST /projetos/:id/referencias?nome=&papel=&regiaoId=` | imagem | Como hoje; com `regiaoId` (parte do projeto) grava `Referencia.regiaoId` e cria o vínculo com peso 3 |
| `PUT /projetos/:id/grade/selecao` | `{ ids: number[] }` | `ProjetoDetalhe`. Marca `selecionada` nas partes da lista e desmarca as outras que não estão `RESOLVIDA` |
| `POST /projetos/:id/mapa/aprovar` | `{ selecao?: number[] }` | Como hoje; com `selecao`, aplica a seleção antes de aprovar |
| `POST /regioes/:id/opcoes/canva` | como hoje | `quantidade` passa a ter padrão 4 |
| `POST /projetos/:id/opcoes/aplicar-melhores` | `{ notaMinima?: number }` (padrão 8) | `{ aplicadas: number, projeto: ProjetoDetalhe }`. Para cada parte selecionada `PENDENTE`/`EM_ANDAMENTO`, em ordem, aplica a opção `PRONTA` de maior nota que alcance o mínimo |
| `POST /projetos/:id/reiniciar` | `{ passo: 'EXAME' \| 'MAPA' \| 'PLANO' \| 'TRATAMENTO' \| 'INSPECAO', doZero?: boolean }` | `ProjetoDetalhe`. Ver "Reinício" |

## Reinício

`POST /projetos/:id/reiniciar` cancela todos os trabalhos do projeto em `FILA` e `EM_ANDAMENTO` (status `CANCELADO`), registra o evento (`sistema`, `status`) "Processo reiniciado a partir de: <passo>." e:

| passo | Efeito |
|---|---|
| `EXAME` | `mapaStatus` volta a `RASCUNHO`; cria trabalho `ANALISE`. Com `doZero: true`, antes disso: a imagem atual volta a ser a original (nova versão "Reinício do zero"), e são apagadas todas as opções, todos os vínculos, todos os pedidos de referência, as referências de origem `CANVA` e todas as partes; a grade local é remontada. As referências importadas pelo usuário ficam |
| `MAPA` | `mapaStatus` volta a `RASCUNHO`; cria trabalho `REFERENCIAS` |
| `PLANO` | exige mapa `APROVADO` (senão 409 "Aprove o mapa antes de reiniciar o plano"); limpa o `plano` das partes que não estão `RESOLVIDA`; cria trabalho `PLANO` |
| `TRATAMENTO` | exige mapa `APROVADO`; apaga as opções não escolhidas (status diferente de `ESCOLHIDA`) das partes que não estão `RESOLVIDA`, e essas partes voltam a `PENDENTE`; cria trabalho `PLANO` |
| `INSPECAO` | cria trabalho `INSPECAO` |

`doZero` só vale com `EXAME`. Trabalho `CANCELADO` nunca volta a `CONCLUIDO`: `concluir_trabalho` num trabalho cancelado responde `{ ok: true, status: 'CANCELADO' }` sem mudar nada.

## Estado de cada parte na tela (`client/src/modules/oficina/GradeReconstrucao.tsx`)

`estadoDaParte(regiao, opcoesDaParte)`, na ordem:
1. `status === 'IGNORADA'` → `ignorada`
2. `status === 'RESOLVIDA'` → `aplicada`
3. `!selecionada` → `fora`
4. alguma opção `GERANDO` → `gerando`
5. alguma opção `PRONTA` com `nota === null` → `revisao`
6. alguma opção `PRONTA` com `nota !== null` → `escolha`
7. `status === 'EM_ANDAMENTO'` → `gerando`
8. senão → `espera`

Componente:
```ts
export type EstadoDaParte = 'fora' | 'espera' | 'gerando' | 'revisao' | 'escolha' | 'aplicada' | 'ignorada';
export function estadoDaParte(regiao: Regiao, opcoes: Opcao[]): EstadoDaParte;
export function GradeReconstrucao(props: {
  projeto: ProjetoDetalhe;
  opcoes: Opcao[];                               // todas as opções do projeto (GET /projetos/:id/opcoes)
  modo: 'selecao' | 'aoVivo';
  selecao?: Set<number>;                         // modo selecao: ids marcados
  aoMudarSelecao?: (ids: Set<number>) => void;
  regiaoSelecionada?: number | null;             // modo aoVivo: parte em foco
  aoSelecionarRegiao?: (id: number | null) => void;
}): JSX.Element;
```

## Fluxo da equipe

1. `ANALISE`: analista (laudo + `definir_elementos` + `classificar_partes`) → cartógrafo (pedidos e mapa por parte) → `pedir_aprovacao_mapa` (marca `AGUARDANDO`; o servidor gera sozinho no Canva as candidatas das partes sem referência do usuário, via `gerarReferenciasQueFaltam`, se o Canva estiver ligado) → revisor em modo referências (`revisar_referencia`) para os ids devolvidos → para. O usuário não clica parte por parte; a rota `POST /projetos/:id/referencias/gerar-faltantes` faz o mesmo sob demanda.
2. O usuário, na tela Referências: vê o recorte de cada parte, importa referências, decide quais geradas usar, marca as partes a reconstruir e aprova.
3. `PLANO`: conservador (plano e ordem só das partes selecionadas) → para cada parte selecionada, **uma por vez**, na ordem: restaurador ou gerador Canva (4 opções) → revisor → plano de ajuste até 3 rodadas → próxima parte.
4. O usuário escolhe uma opção por parte, ou aplica as melhores de uma vez.
