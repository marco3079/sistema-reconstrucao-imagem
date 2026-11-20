<p align="center"><img src="client/public/logo.svg" alt="Restaura" width="120"></p>

<h1 align="center">Restaura</h1>

<p align="center">Reconstrução de imagens por partes com uma equipe de agentes. Você envia a imagem, por pior que esteja, e escolhe a correção de cada parte.</p>

<p align="center">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT">
  <img src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose">
  <img src="https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white" alt="Node 20">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
</p>

<p align="center"><img src="docs/imagens/inicio.png" alt="Início" width="900"></p>

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Como funciona](#como-funciona)
- [Telas](#telas)
- [Instalação rápida](#instalação-rápida)
- [Primeiro acesso](#primeiro-acesso)
- [Enviar uma imagem](#enviar-uma-imagem)
- [Ligar a equipe de agentes](#ligar-a-equipe-de-agentes)
- [Ligar o Canva](#ligar-o-canva)
- [Atualizar o sistema](#atualizar-o-sistema)
- [Acesso pela rede local](#acesso-pela-rede-local)
- [Limites conhecidos](#limites-conhecidos)
- [Configuração](#configuração)
- [Tecnologia](#tecnologia)
- [Arquitetura](#arquitetura)
- [Desenvolvimento](#desenvolvimento)
- [Documentos](#documentos)
- [Segurança](#segurança)
- [Licença](#licença)

## Visão geral

O Restaura reconstrói imagens danificadas, parte por parte. Você envia a imagem. O servidor mede a qualidade, e uma equipe de agentes (uma sessão do Claude Code ligada ao sistema) examina a imagem, descobre o que falta, pede as referências, monta um mapa de referências e prepara opções de correção para cada parte. Você escolhe a opção de cada parte, envia referências novas quando quiser e baixa o resultado.

Você instala no seu computador com Docker. Os dados ficam no seu banco PostgreSQL, e as imagens ficam num volume do Docker.

## Funcionalidades

**Imagens e análise**

- Cada imagem vira um projeto. O original nunca é alterado: o servidor mede nitidez, ruído, contraste, saturação, exposição e resolução, e o laudo mostra as medidas antes e depois.
- Laudo de estado escrito pelo analista, com as partes que precisam de tratamento.
- Escolha de cada parte: cada opção escolhida vira uma versão, e dá para voltar a qualquer uma.
- Download do resultado em PNG, com o metadado IPTC que identifica conteúdo gerado por IA quando alguma parte veio do Canva.

**Partes e grade**

- A imagem é separada em até 32 partes: os elementos importantes inteiros (rosto, corpo, roupa, objeto, texto) e, para o resto, células de uma grade regular.
- Cada parte é reconstruída sozinha, e o resultado é colado só dentro do retângulo dela. Nada sai do lugar.
- Você marca quais partes quer reconstruir. As outras ficam como estão.

**Mapa de referências**

- O cartógrafo pede as referências que faltam e propõe o mapa (qual referência serve a qual parte).
- Você confere o mapa numa tela interativa, ajusta as ligações e aprova. A equipe só segue depois disso.

**Mapa 3D da foto**

- Antes da reconstrução, a equipe monta um mapa 3D da foto: a câmera, a linha do horizonte e um volume por pessoa ou objeto importante, na distância em que parecem estar.
- A perspectiva entra no pedido de cada parte, e o revisor reprova opção que quebre a perspectiva ou a escala.
- O Blender instalado no computador monta a cena e gera o modelo 3D e o mapa de profundidade. Ele é opcional: sem ele, a perspectiva continua valendo.

**Controle de qualidade**

- O revisor compara a opção com o original, dá uma nota e aprova ou reprova. Opção reprovada volta ao autor com um plano de ajuste, até 3 rodadas por parte.
- A inspeção final confere a imagem inteira contra a original, com as medidas antes e depois.

## Como funciona

O fluxo segue princípios de normas de conservação, de processamento de imagem e de marcação de conteúdo gerado por IA (resumo e fontes em `docs/NORMAS.md`).

1. **Original preservado.** A imagem vira um projeto. O original nunca é alterado; o servidor mede nitidez, ruído, contraste, saturação, exposição e resolução.
2. **Exame.** O analista descreve a imagem, escreve o laudo de estado e marca cada parte com problema.
3. **Evidências.** O cartógrafo pede as referências que faltam e monta o mapa de referências.
4. **Aprovação do mapa.** Você confere o mapa numa tela interativa, ajusta as ligações e aprova. A equipe só segue depois disso.
5. **Plano de tratamento.** O conservador escolhe o tratamento menos invasivo de cada parte e a ordem: tom e cor, ruído, partes faltantes, nitidez por último.
6. **Tratamento.** O restaurador corrige com filtros locais; o gerador Canva recria o que falta com base nas referências. Opção gerada sem referência sai marcada como conjectura.
7. **Controle de qualidade.** O revisor compara antes e depois, dá nota e aprova ou reprova. Opção reprovada volta ao autor com um plano de ajuste, por até 3 rodadas.
8. **Escolha.** Você escolhe uma opção por parte. Cada escolha vira uma versão, e dá para voltar a qualquer uma.
9. **Inspeção final.** O inspetor confere a imagem inteira contra a original e mede antes e depois.
10. **Laudo e procedência.** A etapa Resultado traz o laudo de restauração, e o arquivo baixado leva o metadado IPTC que identifica conteúdo gerado por IA.

Detalhes do mapa 3D em `docs/CENA.md`, da grade em `docs/GRADE.md` e dos contratos entre as partes em `docs/CONTRATOS.md`.

### A equipe de agentes

| Agente | Papel |
|---|---|
| `analista` | Examina a imagem, escreve o laudo de estado, define os elementos e classifica as partes da grade |
| `cenografo` | Monta o mapa 3D da foto: pontos de fuga, horizonte, e a caixa e a altura real de cada pessoa e objeto |
| `cartografo` | Junta as evidências: pede as referências que faltam e monta o mapa de referências |
| `conservador` | Escreve o plano de tratamento de cada parte, pelo caminho menos invasivo, e define a ordem |
| `restaurador` | Cria opções com filtros locais (nitidez, ruído, cor, contraste, exposição) |
| `gerador-canva` | Gera no Canva as referências candidatas de cada parte e, depois, as opções de reconstrução |
| `revisor` | Aprova ou reprova as referências geradas e as opções de reconstrução, com nota e plano de ajuste |
| `inspetor` | Confere a imagem inteira depois das escolhas do usuário, contra a original e pelas medidas |

A equipe não aplica nada na imagem sozinha. Ela prepara e classifica as opções; quem escolhe é você.

## Telas

| | |
|---|---|
| ![Início](docs/imagens/inicio.png) | ![Imagens](docs/imagens/projetos.png) |
| ![Análise](docs/imagens/exame.png) | ![Referências](docs/imagens/referencias.png) |
| ![Mapa 3D](docs/imagens/mapa-3d.png) | ![Reconstrução](docs/imagens/reconstrucao.png) |
| ![Equipe ao vivo](docs/imagens/equipe.png) | ![Resultado](docs/imagens/resultado.png) |
| ![Entrada](docs/imagens/login.png) | |

## Instalação rápida

Você precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto.

```
git clone https://github.com/marco3079/sistema-reconstrucao-imagem.git
cd sistema-reconstrucao-imagem
```

- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\instalar.ps1`
- Linux e macOS: `bash instalar.sh`

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios, grava a ligação MCP da equipe de agentes em `agentes/.mcp.json` e sobe os contêineres. No fim, mostra o endereço do site (padrão `http://localhost:8095`).

O passo a passo completo, com perguntas frequentes, está em [INSTALAR.md](INSTALAR.md). Para instalar com a ajuda de um assistente de IA, veja [AGENTS.md](AGENTS.md).

## Primeiro acesso

- E-mail: `admin@restaura.local`
- Senha: `admin1234`

Troque a senha em **Meu perfil** logo no primeiro acesso. A senha padrão é a mesma para qualquer instalação, então não deixe o site acessível na rede com ela.

## Enviar uma imagem

1. Abra **Imagens** e envie a imagem (até 30 MB). Dê um nome ao projeto.
2. Abra o projeto. A medição local aparece logo, e a análise da equipe começa quando a sessão de agentes estiver ligada.
3. Acompanhe a etapa **Equipe ao vivo**, confira o mapa de referências e escolha a opção de cada parte.

## Ligar a equipe de agentes

Os agentes rodam numa sessão do Claude Code, que liga no sistema pelo servidor MCP `restaura` (`http://localhost:3095/mcp`, com o token de `AGENTES_TOKEN`). Cada sessão se liga a **uma imagem** (um projeto de restauração).

1. Abra o Claude Code e escolha a pasta `agentes`.
2. Na primeira vez, aceite o servidor MCP `restaura`.
3. No site, abra a imagem, vá na aba **Equipe ao vivo** e copie o comando de conexão.
4. Digite o comando (`/restaurar` seguido do número da imagem) e deixe a sessão aberta. Para encerrar, digite `/parar`.

A aba **Equipe ao vivo** da imagem mostra o fluxograma, o que cada agente está fazendo e se há sessão ligada. Sem sessão ligada, os trabalhos daquela imagem esperam na fila, e você continua podendo gerar opções à mão.

## Ligar o Canva

Em **Configurações**, clique em **Conectar ao Canva** e autorize com a sua conta. O Restaura usa o conector MCP do Canva para enviar o recorte e as referências e gerar a parte que falta.

## Atualizar o sistema

Quem atualiza é o contêiner `atualizador`, criado pelo instalador junto com os outros. Há dois jeitos:

- **Pelo botão da tela**: quando houver versão nova, aparece um botão no topo; em **Atualização**, clique em **Atualizar agora**. Não precisa instalar nada além do sistema.
- **Pelo script**: no Windows, `powershell -ExecutionPolicy Bypass -File .\atualizar.ps1`; no Linux e no macOS, `sh atualizar.sh`.

O que a atualização faz, nesta ordem: guarda uma cópia do banco de dados na pasta `backups/`, roda `git pull --ff-only` e reconstrói os contêineres. Seus dados não são apagados. As imagens enviadas ficam no volume `dados_arquivos` e não entram na cópia do banco. Se você alterou arquivos do sistema e eles conflitarem com a versão nova, a atualização para sem apagar nada e mostra o erro na tela.

O atualizador só sabe fazer isso: o servidor grava um arquivo de pedido em `atualizacao/`, e o atualizador responde atualizando a partir do repositório de origem. Nenhum comando vem da tela. Ele tem acesso ao Docker do computador e à pasta do projeto.

## Acesso pela rede local

O site fica publicado na porta `8095` de todas as interfaces do computador. Outro aparelho na mesma rede abre `http://<IP-do-computador>:8095`. O sistema não tem HTTPS: use só em rede de confiança.

A API e o banco aceitam conexões somente deste computador (`127.0.0.1`).

## Limites conhecidos

- A medição local encontra bem áreas transparentes, brancas ou pretas chapadas; rasgos e manchas dependem do analista ou de você marcar à mão.
- O filtro "Preenchimento suave (provisório)" só disfarça um buraco com as cores vizinhas. Recriar conteúdo de verdade depende do Canva.
- A geração do Canva devolve uma imagem inteira; o sistema a ajusta ao recorte e cola só a área da parte, com borda suave. Por isso o texto do pedido e as referências decidem o encaixe.
- Os arquivos de imagem são servidos por endereço com nome aleatório de 32 caracteres hexadecimais, sem login. Quem tiver o endereço exato de um arquivo consegue abri-lo.

## Configuração

O arquivo `.env` (criado pelo instalador a partir de [.env.example](.env.example)) guarda:

| Variável | Para que serve | Padrão |
|---|---|---|
| `POSTGRES_PASSWORD` | Senha do banco | aleatória |
| `JWT_SECRET` | Segredo dos logins e base da cifra dos tokens guardados no banco | aleatório |
| `AGENTES_TOKEN` | Token que a sessão do Claude Code usa para ligar no servidor MCP | aleatório |
| `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` | Conta administradora criada na primeira subida | `Administrador`, `admin@restaura.local`, `admin1234` |
| `WEB_PORT` | Porta do site | `8095` |
| `API_PORT` | Porta da API e do servidor MCP (só neste computador) | `3095` |
| `DB_PORT` | Porta do banco (só neste computador) | `5435` |
| `URL_PUBLICA` | Endereço do site como você abre no navegador (o retorno do login do Canva usa este endereço) | `http://localhost:8095` |
| `FUSO_HORARIO` | Fuso horário da API | `America/Sao_Paulo` |

Se você trocar o `JWT_SECRET`, a conexão com o Canva precisa ser feita de novo, porque os tokens guardados deixam de abrir.

Nome da conta, senha e demais preferências ficam em **Meu perfil** e **Configurações**, dentro do sistema.

## Tecnologia

- **Site**: React 18, TypeScript 5.6, Vite 5, React Router 6 e Three.js (visualizador do mapa 3D), servido pelo nginx.
- **API**: Node 20, TypeScript, Express 4, Prisma 5, zod para validar, sharp para as imagens e bcryptjs para as senhas.
- **Banco**: PostgreSQL 16.
- **Agentes**: Claude Code, com o servidor MCP da própria API. A geração de partes usa o conector MCP do Canva.
- **Mapa 3D**: Blender (opcional, instalado no computador; o script fica em `agentes/blender/`).

## Arquitetura

Três contêineres principais, mais o atualizador: `db` (PostgreSQL 16), `api` (Node 20, Express, Prisma) e `web` (site React servido pelo nginx, que também encaminha `/api/` para a API). O contêiner `atualizador` cuida das atualizações.

```
server/
  prisma/schema.prisma            modelo de dados
  src/app.ts                      carrega os módulos de src/modules sozinho
  src/lib/                        regras e serviços compartilhados (imagem, grade, cena, Canva, MCP, cifra)
  src/modules/<modulo>/routes.ts  rotas HTTP de cada módulo
  src/modules/<modulo>/ferramentas.ts  ferramentas MCP dos agentes (quando o módulo tem)
client/
  src/layout/                     casca (menu, topo), login e busca
  src/ui/                         componentes e estilo
  src/modules/<modulo>/index.tsx  telas de cada módulo
agentes/
  .claude/agents/                 instruções de cada agente
  .claude/skills/restaurar/       passo a passo da sessão (/restaurar e /parar)
  blender/                        script que monta a cena 3D no Blender
docs/                             contratos, normas, grade, cena e arquitetura
```

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Desenvolvimento

Para rodar com Docker, use o instalador. Para desenvolver sem Docker, suba só o banco e rode a API e o site à parte:

```
docker compose up -d db
```

A API não lê o arquivo `.env` sozinha: antes de subir, exporte as variáveis no terminal (no PowerShell, use `$env:NOME="valor"`). Os valores de `POSTGRES_PASSWORD`, `JWT_SECRET` e `AGENTES_TOKEN` são os do seu `.env`:

```
export DATABASE_URL="postgresql://restaura:SENHA_DO_BANCO@localhost:5435/restaura?schema=public"
export JWT_SECRET="o JWT_SECRET do .env"
export AGENTES_TOKEN="o AGENTES_TOKEN do .env"
export ADMIN_EMAIL="admin@restaura.local"
export ADMIN_SENHA="admin1234"
export DIR_ARQUIVOS="/caminho/para/uma/pasta/de/imagens"
export PORT=3095
```

`DIR_ARQUIVOS` é opcional (sem ela, as imagens vão para `server/dados/arquivos`). `PORT=3095` é necessário: o proxy do Vite (`client/vite.config.ts`) encaminha `/api` para `http://localhost:3095`, e a API sem essa variável sobe na porta 3000.

```
cd server && npm install && npm run db:push && npm run seed && npm run dev
```

```
cd client && npm install && npm run dev
```

O site de desenvolvimento abre em `http://localhost:5173`.

Verificações antes de entregar uma mudança:

```
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
cd client && npx vite build
```

Como contribuir: [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [docs/README.md](docs/README.md) | Índice dos documentos da pasta `docs/` |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como o sistema é montado: contêineres, módulos e ligação com a equipe |
| [docs/CONTRATOS.md](docs/CONTRATOS.md) | Rotas HTTP, tipos e ferramentas MCP |
| [docs/NORMAS.md](docs/NORMAS.md) | Normas que guiam o fluxo, com as fontes |
| [docs/GRADE.md](docs/GRADE.md) | Grade de partes, mapa por elementos e reinício |
| [docs/CENA.md](docs/CENA.md) | Mapa 3D da foto |
| [INSTALAR.md](INSTALAR.md) | Instalação passo a passo |
| [AGENTS.md](AGENTS.md) | Instruções para assistentes de IA que instalam ou operam o sistema |

## Segurança

Veja [SECURITY.md](SECURITY.md). Em resumo: troque a senha padrão no primeiro acesso, não exponha o site à internet sem HTTPS e lembre que as imagens e os laudos ficam no seu computador, mas o que é enviado ao Canva e ao Claude sai dele.

## Licença

[MIT](LICENSE).
