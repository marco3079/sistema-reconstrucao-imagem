# Contratos entre as partes do Restaura

Este arquivo é a fonte da verdade para quem implementa um módulo. Se algo aqui contradiz o seu mini-plano, pergunte ao `main`.

## Visão geral

- `server/`: Node 20, TypeScript (CommonJS, rodando com `tsx`), Express 4, Prisma 5 (PostgreSQL), `sharp` para imagens, `zod` para validar.
- `client/`: React 18, TypeScript, Vite 5, React Router 6. Sem biblioteca de componentes: use `client/src/ui`.
- Toda rota HTTP fica sob `/api`. O servidor MCP dos agentes fica em `POST /mcp`.
- Idioma: tudo em português do Brasil (nomes de variáveis, textos, mensagens de erro).
- Em desenvolvimento a API roda na porta 3095 (`server/.env`) e o Vite em 5173, com proxy de `/api`.

Fluxo do sistema:

1. O usuário envia uma imagem (cria um **Projeto**). O servidor mede a imagem (análise local) e põe um **Trabalho** `ANALISE` na fila.
2. A equipe de agentes (uma sessão do Claude Code ligada por MCP) pega o trabalho: o analista descreve a imagem e marca **Regiões** com problema; o cartógrafo cria **Pedidos de referência** e o **mapa** (Vínculos); o restaurador e o gerador Canva criam **Opções** para cada região; o revisor dá nota e aprova ou reprova cada opção com um plano de ajuste.
3. O usuário vê as opções aprovadas, escolhe uma por região (ou pede novas), envia referências novas quando quiser e baixa o resultado.

O mapa 3D da foto (câmera, volumes e perspectiva, com a montagem no Blender) tem contrato próprio em `docs/CENA.md`.

## Regras do servidor

- Módulo = pasta `server/src/modules/<nome>/`. `routes.ts` exporta `default` (Router autenticado, montado em `/api`) e, se precisar, `publico` (Router sem login). `ferramentas.ts` (opcional) registra ferramentas MCP ao ser carregado. `app.ts` carrega tudo sozinho: **não edite `app.ts`**.
- Em toda rota use `asyncHandler`, `validar` (zod), `idParam` e `HttpError` de `lib/erros.ts`. O usuário logado está em `req.usuario` (`{ id, perfil }`).
- Sempre confira o dono com `lib/acesso.ts`: `projetoDoUsuario(req.usuario.id, id)`, `regiaoDoUsuario`, `opcaoDoUsuario`, `referenciaDoUsuario` (lançam 404).
- Resposta de projeto completo: `detalheDoProjeto(projetoId)` de `lib/acesso.ts` (formato `ProjetoDetalhe`).
- Depois de mudar status de região: `recalcularStatusDoProjeto(projetoId)`.
- Arquivos: `lib/arquivos.ts` (`salvarArquivo(buffer, 'png')`, `lerArquivo(nome)`, `apagarArquivo(nome)`, `corpoDeImagem`, `imagemDoCorpo(req.body)`). Uploads chegam como **corpo bruto** (não é multipart): a rota usa o middleware `corpoDeImagem` e lê `imagemDoCorpo(req.body)`; nome, tipo e papel vêm na query string.
- Rotas fixas antes das rotas com parâmetro.
- Erros: `{ "erro": "mensagem" }` com o status certo. Nunca devolva `usuarioId`, tokens ou `canvaMediaId`.
- Verificação obrigatória: `cd server && npx tsc --noEmit` sem erros.

## Tipos

Os tipos do cliente estão em `client/src/lib/tipos.ts` e as respostas da API têm exatamente esses formatos (datas em ISO). Não edite esse arquivo. Valores fixos:

| Campo | Valores |
|---|---|
| `Projeto.tipo` | `FOTO`, `LOGO`, `DOCUMENTO`, `PRODUTO`, `PAISAGEM`, `OUTRO` |
| `Projeto.status` | `NOVO`, `ANALISADO`, `EM_RECONSTRUCAO`, `CONCLUIDO` |
| `Regiao.problema` | `FALTANDO`, `DANIFICADO`, `BORRADO`, `RUIDO`, `DESBOTADO`, `BAIXA_RESOLUCAO`, `EXPOSICAO`, `OUTRO` |
| `Regiao.status` | `PENDENTE`, `EM_ANDAMENTO`, `RESOLVIDA`, `IGNORADA` |
| `Regiao.origem` | `LOCAL`, `IA`, `MANUAL` |
| `Referencia.papel` | `ROSTO`, `OBJETO`, `ESTILO`, `COR`, `TEXTO`, `CENARIO`, `GERAL` |
| `Opcao.origem` | `LOCAL`, `CANVA` |
| `Opcao.status` | `GERANDO`, `PRONTA`, `FALHOU`, `ESCOLHIDA`, `REPROVADA` |
| `Trabalho.tipo` | `ANALISE`, `REFERENCIAS`, `REGIAO`, `INSPECAO` |
| `Trabalho.status` | `FILA`, `EM_ANDAMENTO`, `CONCLUIDO`, `FALHOU`, `CANCELADO` |
| `Evento.agente` | `maestro`, `analista`, `cartografo`, `restaurador`, `gerador-canva`, `revisor`, `sistema` |
| `Evento.tipo` | `status`, `acao`, `nota`, `revisao`, `erro` |

Região: `x`, `y`, `largura`, `altura` são frações de 0 a 1 da imagem (canto superior esquerdo + tamanho). Uma região "Imagem inteira" é `x=0, y=0, largura=1, altura=1`.

Opção: `arquivo` é o **recorte de contexto** já corrigido (PNG). `parametros.contexto` é o retângulo desse recorte em pixels da imagem do projeto (`{ x, y, largura, altura }`). Escolher a opção cola o recorte na imagem atual, mudando só a área da região, com borda suave.

`Projeto.analise` (JSON, tipo `Analise`): `{ feitaEm, comIA, descricao, tipoSugerido, qualidade, metricas, problemas, promptBase }`.

## Bibliotecas do servidor (assinaturas nos arquivos; quem implementa está entre parênteses)

- `lib/imagem.ts` (g01): `normalizarEntrada`, `paraJpeg`, `retanguloDaRegiao`, `contextoDaRegiao`, `recortar`, `compor`, tipo `Retangulo`.
- `lib/analise-local.ts` (g02): `analisarLocal(buffer) -> ResultadoLocal`, tipos `Metricas`, `ProblemaGlobal`, `RegiaoSugerida`, `Problema`, constante `PROBLEMAS`.
- `modules/analise/servico.ts` (g02): `aplicarAnaliseLocal(projetoId)`, `salvarAnaliseDoAgente(projetoId, dados)`, `criarRegiao(projetoId, dados, origem)`.
- `modules/referencias/servico.ts` (g03): `criarPedido`, `vincular`, `desvincular`, `sugerirMapa`.
- `lib/canva.ts` (g04): `canvaConectado(usuarioId)`, `enviarImagemAoCanva(usuarioId, buffer, nome) -> mediaId`, `gerarImagemNoCanva(usuarioId, { prompt, referencias, proporcao }) -> Buffer`, `proporcaoMaisProxima(largura, altura)`.
- `modules/reconstrucao/servico.ts` (g05): `FILTROS_LOCAIS`, `gerarOpcoesLocais`, `gerarOpcaoCanva`, `aguardarOpcao`, `escolherOpcao`, `promptPadrao`, `comparativoDaOpcao`.
- `modules/agentes/servico.ts` (pronto, feito pelo main): `criarTrabalho(projetoId, tipo, { regiaoId?, instrucoes? })`, `registrarEvento(projetoId, agente, tipo, texto, trabalhoId?)`, `aguardarTrabalho(segundos)`, `concluirTrabalho(id, resumo, falhou)`, `devolverTrabalhosParados()`, `statusAgentes()`, `marcarContato()`.
- `lib/mcp.ts` (pronto): `registrarFerramenta`, `argNumero`, `argNumeroOpcional`, `argTexto`, `argTextoOpcional`, `imagemMcp`.
- `lib/acesso.ts` (pronto): ver "Regras do servidor", mais `proximoNumeroDeVersao(projetoId)`.

Os arquivos marcados "ESQUELETO" já existem com as assinaturas certas e corpos que lançam erro. Quem é dono troca o corpo e **não muda a assinatura**. Quem só usa importa normalmente.

## Rotas HTTP (todas sob `/api`; autenticadas, salvo "PÚBLICA")

### auth (pronto)

`GET /saude` PÚBLICA, `POST /auth/login` PÚBLICA, `POST /auth/sair`, `GET /auth/eu`, `PUT /auth/perfil { nome }`, `PUT /auth/senha { atual, nova }`.

### projetos (g01)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /arquivos/:nome` PÚBLICA, opcional `?l=<16..2000>` | | bytes do arquivo; com `l`, miniatura WebP dessa largura (sem ampliar). `Cache-Control: private, max-age=31536000, immutable`. 404 se não existir, 400 se o nome for inválido |
| `GET /painel` | | `Painel` |
| `GET /busca?q=` | | `[{ tipo: 'Projeto', titulo, subtitulo, caminho: '/app/projetos/<id>' }]`, até 8 |
| `GET /projetos` | | `ProjetoResumo[]`, mais recentes primeiro |
| `POST /projetos?nome=&tipo=` | corpo bruto da imagem | 201 `ProjetoDetalhe` |
| `GET /projetos/:id` | | `ProjetoDetalhe` |
| `PUT /projetos/:id` | `{ nome?, descricao?, tipo? }` | `ProjetoDetalhe` |
| `DELETE /projetos/:id` | | 204 |
| `GET /projetos/:id/baixar` | | PNG da imagem atual, como anexo |
| `POST /projetos/:id/versoes/:versaoId/restaurar` | | `ProjetoDetalhe` |

### analise (g02)

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /projetos/:id/analisar` | `{ instrucoes?: string }` | `ProjetoDetalhe` |
| `POST /projetos/:id/regioes` | `{ nome, x, y, largura, altura, problema, gravidade, descricao }` | 201 `Regiao` |
| `PUT /regioes/:id` | qualquer campo acima, mais `status?` | `Regiao` |
| `DELETE /regioes/:id` | | 204 |

### referencias (g03)

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /projetos/:id/referencias?nome=&papel=` | corpo bruto da imagem | 201 `Referencia` |
| `PUT /referencias/:id` | `{ nome?, papel?, observacao? }` | `Referencia` |
| `DELETE /referencias/:id` | | 204 |
| `PUT /projetos/:id/mapa` | `{ vinculos: [{ referenciaId, regiaoId, peso }] }` | `Vinculo[]` (substitui o mapa inteiro) |
| `POST /projetos/:id/mapa/sugerir` | | `Vinculo[]` (mapa inteiro depois de acrescentar as sugestões) |
| `PUT /pedidos/:id` | `{ atendido?, referenciaId? }` | `PedidoReferencia` |
| `DELETE /pedidos/:id` | | 204 |

### canva (g04)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /canva/status` | | `StatusCanva` |
| `POST /canva/conectar` | | `{ url }` (o cliente faz `window.location.assign(url)`) |
| `GET /canva/retorno?code=&state=` PÚBLICA | | redireciona para `<URL_PUBLICA>/app/configuracoes?canva=ok` ou `?canva=erro` |
| `DELETE /canva/conexao` | | 204 |

### reconstrucao (g05)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /reconstrucao/filtros` | | `FiltroLocal[]` (`{ codigo, rotulo, indicadoPara }`) |
| `GET /projetos/:id/opcoes` | | `Opcao[]` do projeto (com `revisoes`), mais novas primeiro |
| `GET /regioes/:id/opcoes` | | `Opcao[]` da região (com `revisoes`), mais novas primeiro |
| `POST /regioes/:id/opcoes/locais` | `{ filtros?: string[], intensidade?: 1..3 }` | 201 `Opcao[]` |
| `POST /regioes/:id/opcoes/canva` | `{ instrucoes?: string, quantidade?: 1..4, usarReferencias?: boolean }` | 201 `Opcao[]` (status `GERANDO`; o cliente consulta `GET /regioes/:id/opcoes` a cada 3 s) |
| `POST /opcoes/:id/escolher` | | `ProjetoDetalhe` |
| `DELETE /opcoes/:id` | | 204 |

### agentes (g06)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /agentes/status` | | `StatusAgentes` |
| `GET /agentes/fluxo?depois=<idDoEvento>` | | `FluxoAgentes` dos projetos do usuário logado: `status`; `trabalhos` = todos em `FILA` ou `EM_ANDAMENTO` (até 50) mais os 10 últimos encerrados, por id crescente, cada um com `projetoNome` e `regiaoNome`; `eventos` com `projetoNome`, por id crescente: com `depois` > 0, os de id maior que `depois` (até 200); sem `depois` ou 0, os 60 mais recentes; `aguardandoEscolha` = opções `PRONTA` com nota, em regiões `PENDENTE` ou `EM_ANDAMENTO` |
| `GET /agentes/conexao` (só ADMIN) | | `{ url, token }` do servidor MCP (`url` = variável `URL_MCP`, padrão `http://localhost:3095/mcp`) |
| `GET /projetos/:id/atividade?depois=<idDoEvento>` | | `Atividade`: `trabalhos` = os 20 mais recentes; `eventos` = os de id maior que `depois` (padrão 0), em ordem crescente, até 200 |
| `POST /projetos/:id/trabalhos` | `{ tipo, regiaoId?, instrucoes? }` | 201 `Trabalho` |
| `POST /trabalhos/:id/cancelar` | | `Trabalho` (só se estiver em `FILA`; senão 409) |

### fluxo guiado por normas (ver docs/NORMAS.md)

- Agentes: `maestro`, `analista`, `cartografo`, `conservador`, `restaurador`, `gerador-canva`, `revisor`, `inspetor` (e `sistema`).
- `Regiao.plano` (texto, padrão ''): plano de tratamento da parte, escrito pelo conservador pela ferramenta `atualizar_regiao` (argumentos novos `plano` e `ordem`).
- Opção do Canva criada quando a parte não tem nenhuma referência no mapa (nenhum `Vinculo`) leva `parametros.conjectura = true`; com referência, `false`.
- Aprovação do mapa pelo usuário: `Projeto.mapaStatus` (`RASCUNHO` | `AGUARDANDO` | `APROVADO`) e `Projeto.mapaAprovadoEm`. O cartógrafo termina chamando a ferramenta `pedir_aprovacao_mapa` (`projeto_id`, `resumo`), que põe `AGUARDANDO`. O usuário ajusta o mapa na etapa Referências e aprova com `POST /projetos/:id/mapa/aprovar` (→ `ProjetoDetalhe`), que põe `APROVADO`, grava `mapaAprovadoEm` e cria um trabalho `PLANO` (conservador + tratamento das partes). `FluxoAgentes.mapasAguardando` conta os projetos do usuário em `AGUARDANDO`.
- Tipos de trabalho: `ANALISE` (exame + evidências, para na aprovação do mapa), `REFERENCIAS` (rever o mapa, para na aprovação), `PLANO` (plano de tratamento + tratamento), `REGIAO`, `INSPECAO`.
- Sessão ligada ao projeto: a sessão do Claude Code roda `/restaurar <id>` e chama `aguardar_trabalho` com `projeto_id` (obrigatório), pegando só trabalhos daquele projeto; `listar_projetos` lista os projetos para escolher. `GET /agentes/status?projeto=<id>` e `GET /agentes/fluxo?projeto=<id>` devolvem presença, fila, trabalhos e eventos só daquele projeto (dono conferido); sem `projeto`, a visão geral do usuário.
- Passo atual: `ProjetoDetalhe.situacao` e `ProjetoResumo.situacao` (tipo `Situacao` em `client/src/lib/tipos.ts`), calculados por `server/src/lib/situacao.ts`. Oito passos fixos: Exame, Mapa de referências, Você aprova o mapa, Plano de tratamento, Tratamento e revisão, Você escolhe, Inspeção final, Laudo. `quem` diz de quem é a vez; `aprovacao` marca os momentos em que o usuário precisa aprovar ou escolher; `parada` avisa que a equipe tem trabalho na fila mas não há sessão ligada à imagem.
- `GET /projetos/:id/laudo` devolve `Laudo` (tipo em `client/src/lib/tipos.ts`).
- `GET /projetos/:id/baixar` grava no PNG o metadado XMP do IPTC (`Iptc4xmpExt:DigitalSourceType`): `compositeWithTrainedAlgorithmicMedia` se alguma opção escolhida veio do Canva; `algorithmicallyEnhanced` se só houve filtros; sem opção escolhida, o arquivo sai sem o metadado.

## Ferramentas MCP (g06, `server/src/modules/agentes/ferramentas.ts`)

Nomes exatos (o agente chama `mcp__restaura__<nome>`). Todas devolvem texto JSON, salvo as que dizem "imagem".

| Ferramenta | Argumentos | O que faz |
|---|---|---|
| `aguardar_trabalho` | `espera_segundos?` (padrão 45) | Espera um trabalho da fila. Devolve `{ trabalho, projeto: { id, nome, tipo, status } }` ou `{ trabalho: null }` |
| `concluir_trabalho` | `trabalho_id`, `resumo`, `falhou?` | Fecha o trabalho |
| `registrar_evento` | `projeto_id`, `agente`, `tipo`, `texto`, `trabalho_id?` | Escreve na linha do tempo que o usuário vê |
| `obter_projeto` | `projeto_id` | Detalhe: projeto, análise, regiões, referências, pedidos, vínculos e opções (id, regiaoId, origem, rotulo, status, rodada, nota) |
| `medir_imagem` | `projeto_id` | Roda a análise local na imagem atual e devolve métricas, problemas e regiões sugeridas (não grava) |
| `ver_imagem` | `projeto_id`, `alvo?` (`atual` ou `original`), `regiao_id?`, `lado_maximo?` (padrão 1280) | imagem JPEG da imagem inteira ou do recorte de contexto da região |
| `ver_referencia` | `referencia_id`, `lado_maximo?` | imagem JPEG da referência |
| `ver_opcao` | `opcao_id` | imagem JPEG "antes e depois" lado a lado, mais texto com os dados da opção |
| `salvar_analise` | `projeto_id`, `descricao`, `tipo_sugerido`, `qualidade?`, `problemas` (lista de `{ codigo, gravidade, descricao }`), `prompt_base` | Grava a análise do analista |
| `criar_regiao` | `projeto_id`, `nome`, `x`, `y`, `largura`, `altura`, `problema`, `gravidade`, `descricao` | Cria região de origem `IA`; devolve `{ regiao_id }` |
| `atualizar_regiao` | `regiao_id` e qualquer campo de região, mais `status?`, `plano?` (até 2000 caracteres) e `ordem?` (inteiro >= 0) | Altera a região |
| `remover_regiao` | `regiao_id` | Apaga a região (só `PENDENTE` e sem opção escolhida) |
| `pedir_referencia` | `projeto_id`, `descricao`, `papel`, `regiao_id?` | Cria um pedido de referência para o usuário |
| `vincular_referencia` | `referencia_id`, `regiao_id`, `peso` (1 a 3) | Põe a referência no mapa da região |
| `desvincular_referencia` | `referencia_id`, `regiao_id` | Tira do mapa |
| `listar_filtros` | | Filtros locais disponíveis |
| `gerar_opcoes_locais` | `regiao_id`, `filtros?`, `intensidade?`, `rodada?` | Cria opções com filtros locais; devolve a lista |
| `gerar_opcao_canva` | `regiao_id`, `prompt`, `usar_referencias?` (padrão true), `rodada?`, `rotulo?` | Gera no Canva e espera até 150 s; devolve a opção (`PRONTA`, `FALHOU` ou ainda `GERANDO`) |
| `consultar_opcao` | `opcao_id`, `espera_segundos?` | Estado atual da opção (espera se estiver `GERANDO`) |
| `revisar_opcao` | `opcao_id`, `veredito` (`APROVADA` ou `REPROVADA`), `nota` (0 a 10), `parecer`, `plano_ajuste?` | Grava a `Revisao`, copia `nota` e `parecer` para a opção; `REPROVADA` muda o status da opção para `REPROVADA` |
| `canva_disponivel` | `projeto_id` | `{ conectado: boolean }` para o dono do projeto |

## Regras do cliente

- Módulo = pasta `client/src/modules/<nome>/` com `index.tsx` exportando `rotas: RotaModulo[]` (`lib/rotas.ts`). `App.tsx` junta tudo sozinho: **não edite `App.tsx`, `layout/`, `lib/` nem `ui/`**.
- Raiz das telas: `RAIZ = '/app'`. Perfis: `TODOS_OS_PERFIS` ou `['ADMIN']`.
- Dados: `useDados<T>(caminho)` de `lib/useDados.ts` (`{ dados, carregando, erro, recarregar }`); chamadas: `api.get/post/put/del`, `api.enviarArquivo<T>(caminho, arquivo, arquivo.type)` e `api.baixar(caminho, nomeDoArquivo)` de `lib/api.ts`. Os caminhos não levam `/api`.
- Imagens: `<img src={urlArquivo(nome, largura?)} />` de `lib/arquivos.ts`.
- Componentes: `Pagina`, `Cartao`, `Grade`, `Botao`, `Selo`, `Aviso`, `Carregando`, `Tabela`, `Campo`, `AreaTexto`, `Selecao`, `Caixa`, `Modal`, `Abas`, `Avatar`, `formatarData`, `formatarDataHora` de `ui/index.tsx`; `Icone` e `NomeIcone` de `ui/icones.tsx` (use só nomes que existem em `NomeIcone`). Leia as assinaturas no arquivo antes de usar.
- CSS: um arquivo `.css` por módulo, importado no `.tsx`. Classes com prefixo do módulo (ex.: `oficina-`, `ref-`, `rec-`). Use **somente** as variáveis de `ui/estilo.css` (`--cor-superficie`, `--cor-texto`, `--cor-texto-suave`, `--cor-borda`, `--cor-primaria`, `--cor-primaria-suave`, `--raio`, `--sombra` etc.; confira os nomes no arquivo) para funcionar nos temas claro e escuro. Nada de cor fixa para texto ou fundo. Layout responsivo: uma coluna abaixo de 900 px.
- Sem dependências novas. Sem `any`. Textos em português.
- Verificação obrigatória: `cd client && npx tsc --noEmit` sem erros.

### Oficina (tela do projeto, `client/src/modules/oficina/`)

Rota `/app/projetos/:id` (`menu: false`). Tipos em `modules/oficina/tipos.ts` (pronto):

```ts
export type Etapa = 'analise' | 'referencias' | 'reconstrucao' | 'resultado';
export interface PropsEtapa {
  projeto: ProjetoDetalhe;
  aoAtualizar: (projeto: ProjetoDetalhe) => void; // troca o projeto em memória (resposta de uma rota)
  recarregar: () => void;                         // busca o projeto de novo
  regiaoSelecionada: number | null;
  aoSelecionarRegiao: (id: number | null) => void;
  irPara: (etapa: Etapa) => void;
}
```

Arquivos e donos: `index.tsx`, `Oficina.tsx`, `Visualizador.tsx`, `EtapaAnalise.tsx`, `PainelAgentes.tsx`, `oficina.css` (g08); `EtapaReferencias.tsx`, `referencias.css` (g09); `EtapaReconstrucao.tsx`, `EtapaResultado.tsx`, `reconstrucao.css` (g10). Os arquivos das etapas e o `Visualizador.tsx` já existem como esqueleto com as props certas.

`Visualizador` (g08), usado também por g09 e g10:

```ts
export interface PropsVisualizador {
  arquivo: string;                 // nome do arquivo da imagem
  largura: number;                 // pixels da imagem (para a proporção)
  altura: number;
  regioes?: Regiao[];              // retângulos desenhados por cima
  selecionada?: number | null;
  aoSelecionar?: (id: number | null) => void;
  desenhando?: boolean;            // true: arrastar com o mouse ou o dedo desenha um retângulo novo
  aoDesenhar?: (ret: { x: number; y: number; largura: number; altura: number }) => void; // frações 0..1
}
export function Visualizador(props: PropsVisualizador): JSX.Element;
```
