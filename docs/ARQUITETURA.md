# Arquitetura

Como o Restaura é montado: contêineres, módulos do servidor e do site, ligação com a equipe de agentes e o caminho de uma imagem até o resultado. Os contratos detalhados (rotas, tipos e ferramentas MCP) estão em [CONTRATOS.md](CONTRATOS.md).

## Contêineres

| Contêiner | Imagem ou build | Função | Porta |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Banco PostgreSQL | `127.0.0.1:DB_PORT` (padrão 5435) |
| `api` | build de `server/` | API HTTP e servidor MCP (Node 20, Express 4, Prisma 5) | `127.0.0.1:API_PORT` (padrão 3095) |
| `web` | build de `client/` | Site estático no nginx, que encaminha `/api/` para a API | `WEB_PORT` (padrão 8095, em todas as interfaces) |
| `atualizador` | build de `atualizador/` | Aplica as atualizações pedidas pela tela | sem porta publicada |

Na subida, a API aplica o modelo de dados (`prisma db push`), roda `prisma/seed.ts` (que cria a conta administradora inicial) e só então inicia o servidor. As imagens enviadas ficam no volume `dados_arquivos`, e o banco no volume `dados_db`.

## Servidor (`server/src`)

`app.ts` carrega toda pasta de `modules/` que tenha `routes.ts`. O `default` de cada um é um roteador montado em `/api`, com autenticação; um `publico` é um roteador sem login. Quando a pasta tem `ferramentas.ts`, as ferramentas MCP dos agentes são registradas ao carregar.

| Módulo | O que faz |
|---|---|
| `auth` | Login, saída, dados do usuário logado, troca de senha |
| `usuarios` | Cadastro de usuários (perfis `ADMIN` e `USUARIO`) |
| `projetos` | Imagens (projetos), versões, download e painel |
| `analise` | Medição da imagem, laudo escrito pelo analista e regiões com problema |
| `referencias` | Referências, pedidos de referência e o mapa que liga cada referência a cada parte |
| `cena` | Mapa 3D da foto (câmera, volumes e perspectiva) |
| `canva` | Conexão com o Canva e geração de imagens por ele |
| `reconstrucao` | Opções de correção de cada parte (filtros locais e Canva) e a escolha de uma delas |
| `agentes` | Fila de trabalhos, eventos da linha do tempo, status da equipe e as ferramentas MCP |
| `laudo` | Laudo de restauração da etapa Resultado |
| `reinicio` | Reinício do processo a partir de um passo |
| `atualizacao` | Versão instalada, pedido de atualização, cópias do banco e restauração (rotas em `/api/atualizacao`, só administrador) |

Código compartilhado em `server/src/lib/`: `erros.ts` (erros HTTP e validação com zod), `auth.ts` (JWT e token da equipe), `acesso.ts` (confere o dono dos dados), `cripto.ts` (AES-256-GCM para os tokens guardados), `imagem.ts` (leitura, recorte e composição), `analise-local.ts` (medição da imagem), `grade.ts` (divisão em partes), `cena.ts` (matemática do mapa 3D), `canva.ts`, `mcp.ts` (servidor MCP em `POST /mcp`), `procedencia.ts` (metadado IPTC do arquivo baixado), `situacao.ts` e `arquivos.ts` (gravação das imagens).

## Site (`client/src`)

`App.tsx` junta as telas com `import.meta.glob`, lendo `client/src/modules/<modulo>/index.tsx`. Cada módulo exporta `rotas`, e o ícone e a ordem de cada uma definem o menu.

| Módulo do site | Tela |
|---|---|
| `inicio` | Início (painel) |
| `projetos` | Imagens: lista e envio |
| `oficina` | Oficina de uma imagem, com as etapas de análise, referências, reconstrução e resultado |
| `agentes` | Equipe de agentes |
| `configuracoes` | Configurações (incluindo a conexão com o Canva) |
| `conta` | Meu perfil |
| `atualizacao` | Tela Atualização: versão, botão de atualizar e cópias do banco (só administrador) |

`client/src/ui/` tem os componentes e o estilo; `client/src/layout/` tem a casca do app, o menu, a busca e o login; `client/src/lib/` tem a chamada à API, a autenticação e os tipos (`tipos.ts`).

## Caminho de uma imagem

1. O usuário envia a imagem (cria um projeto). O servidor mede a imagem e grava o original, que não é alterado.
2. A API põe um trabalho de análise na fila. A equipe de agentes, numa sessão do Claude Code ligada por MCP, pega o trabalho e grava o laudo, as regiões e o mapa de referências.
3. O usuário aprova o mapa. A equipe cria as opções de cada parte (filtros locais e geração pelo Canva), e o revisor dá nota e aprova ou reprova cada uma.
4. O usuário escolhe uma opção por parte. Cada escolha vira uma versão, e a inspeção final confere a imagem inteira contra a original.

## Atualização

O site não executa comandos no computador. A tela de atualização e o servidor conversam por arquivos na pasta `atualizacao/`: o servidor grava um pedido, e o contêiner `atualizador` (que tem acesso ao Docker e à pasta do projeto) responde com a sequência fixa: cópia do banco na pasta `backups/`, `git pull --ff-only` e reconstrução de `api` e `web`. Os scripts `atualizar.ps1` e `atualizar.sh` fazem a mesma sequência pelo computador.
