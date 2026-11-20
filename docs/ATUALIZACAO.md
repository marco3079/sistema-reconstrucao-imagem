# Atualização do sistema: contrato das rotas e dos arquivos

Este documento é o contrato entre três partes:

- a **API** (`server/src/modules/atualizacao/routes.ts`), que mostra o estado e grava pedidos;
- o **atualizador** (`atualizador/vigia.js`, contêiner `atualizador`), que atende os pedidos;
- a **tela** "Atualização" do site, que consome a API.

A API nunca executa comando nenhum. Ela só lê e grava arquivos na pasta `atualizacao/` (montada na API em `/atualizacao`). O atualizador lê o pedido, apaga o arquivo e faz o trabalho.

Todas as rotas exigem token de administrador (`Authorization: Bearer <token>`). Sem token: 401 `{ "erro": "Não autenticado" }`. Com token de usuário comum: 403 `{ "erro": "Sem permissão" }`.

## Rotas

Base: `/api`. Respostas em JSON.

### GET /api/atualizacao

- Quem pode: ADMIN.
- Corpo: nenhum.
- Resposta 200: `AtualizacaoDTO` (ver abaixo).
- Observação: a consulta ao GitHub fica guardada no servidor por 5 minutos.
- Erros: 401, 403. Falhas do GitHub não dão erro HTTP: vêm no campo `erroDoGitHub`.

### GET /api/atualizacao?conferir=1

- Quem pode: ADMIN.
- Igual ao anterior, mas consulta o GitHub agora (ignora a guarda de 5 minutos).

### POST /api/atualizacao/pedir

- Quem pode: ADMIN.
- Corpo: `{}` (ignorado).
- Grava `pedido.json` com `tipo: "ATUALIZAR"`.
- Resposta 202: `AtualizacaoDTO` (estado depois do pedido).
- Erros:
  - 400 `{ "erro": "O atualizador não está ligado neste computador. ..." }` quando `vigiaAtivo` é falso;
  - 409 `{ "erro": "Já há uma atualização em andamento." }` quando `ultimaAtualizacao.situacao` é `ATUALIZANDO` ou já há `pedido.json` pendente;
  - 401, 403.

### GET /api/atualizacao/copias

- Quem pode: ADMIN.
- Lista as cópias do banco guardadas na pasta `backups/` (montada na API só para leitura). Só entram nomes `restaura-AAAAMMDD-HHMMSS.sql` com tamanho maior que zero.
- Resposta 200:

```json
{
  "copias": [
    { "arquivo": "restaura-20261120-031500.sql", "feitaEm": "2026-11-20T03:15:00", "tamanho": 123456 }
  ],
  "vigiaAtivo": true
}
```

  - `copias` vem do mais novo para o mais antigo.
  - `feitaEm` é a hora local do computador em que a cópia foi feita (sem fuso).
- Erros: 401, 403.

### POST /api/atualizacao/copiar

- Quem pode: ADMIN.
- Corpo: `{}` (ignorado).
- Pede uma cópia do banco agora, sem atualizar nada. Grava `pedido.json` com `tipo: "COPIAR"`.
- Resposta 202: `AtualizacaoDTO`.
- Erros:
  - 400 quando o atualizador não está ligado;
  - 409 `{ "erro": "Já há uma atualização, restauração ou cópia em andamento." }`;
  - 401, 403.

### POST /api/atualizacao/restaurar

- Quem pode: ADMIN.
- Corpo: `{ "arquivo": "restaura-AAAAMMDD-HHMMSS.sql" }`. O nome tem de casar com a regex `^restaura-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql$`.
- Grava `pedido.json` com `tipo: "RESTAURAR"` e `arquivo`. O servidor não mexe no banco.
- Resposta 202: `AtualizacaoDTO`.
- Erros:
  - 400 `{ "erro": "Dados inválidos", "detalhes": [...] }` quando o nome não casa com a regex (ou o corpo é inválido);
  - 404 `{ "erro": "Cópia não encontrada" }` quando o arquivo não existe em `backups/`;
  - 400 quando o atualizador não está ligado;
  - 409 `{ "erro": "Já há uma atualização ou restauração em andamento." }`;
  - 401, 403.

## Objeto `AtualizacaoDTO`

```ts
interface AtualizacaoDTO {
  // null: o atualizador ainda não gravou versao.json (não se sabe qual commit está instalado)
  instalada: { commit: string; data: string | null; mensagem: string | null; repositorio: string; ramo: string } | null;
  ultima: { commit: string; data: string | null; mensagem: string } | null; // último commit no GitHub
  novidades: { commit: string; data: string | null; mensagem: string }[];   // commits que faltam, do mais novo ao mais antigo (até 30)
  haNovidade: boolean;                                                     // novidades.length > 0
  erroDoGitHub: string | null;
  vigiaAtivo: boolean;              // o atualizador bateu há menos de 60 segundos
  pedidoPendente: boolean;          // há pedido.json ainda não atendido
  ultimaAtualizacao: {
    situacao: 'ATUALIZANDO' | 'OK' | 'ERRO';
    mensagem: string;
    em: string | null;              // ISO 8601 (UTC, com Z)
    progresso: number | null;       // 0 a 100 enquanto atualiza; null quando não se sabe
    inicio: string | null;          // ISO 8601: quando a atualização em andamento começou
  } | null;
}
```

Notas:

- `commit` é o hash completo (40 caracteres) em `instalada`; a tela mostra os 7 primeiros.
- `ultimaAtualizacao` é `null` quando `estado.json` não existe ou tem situação diferente de `ATUALIZANDO`, `OK` ou `ERRO` (por exemplo `PARADO`).
- `pedidoPendente` vira falso sozinho quando o pedido tem mais de 10 minutos sem ser atendido: a API apaga o arquivo.

## Arquivos da pasta `atualizacao/`

Todos ficam em `atualizacao/` na raiz do projeto. Gravados em UTF-8; a API aceita BOM no início.

### `versao.json` (gravado pelo atualizador)

Gravado ao subir o atualizador e depois de cada atualização.

```json
{
  "commit": "9f3c2a1b0d...(40 caracteres)",
  "data": "2026-11-20T10:12:00-03:00",
  "mensagem": "Ajusta a tela de cópias",
  "ramo": "main",
  "repositorio": "dono/restaura",
  "gravadoEm": "2026-11-20T13:05:10Z"
}
```

- `commit`: obrigatório, hash hexadecimal de 7 a 40 caracteres. Sem isso a API considera a versão desconhecida (`instalada: null`).
- `repositorio`: obrigatório, no formato `dono/nome`. Sem isso, `instalada` também é `null`.
- `ramo`: obrigatório, nome de ramo (letras, números, `_ . / -`, até 100 caracteres, sem `..`).
- `data` e `mensagem`: opcionais (texto ou `null`).
- `gravadoEm`: informativo.

### `estado.json` (gravado pelo atualizador)

Gravado a cada etapa de uma atualização, cópia ou restauração, e a cada 5 segundos como batimento.

```json
{
  "situacao": "ATUALIZANDO",
  "mensagem": "Baixando a versão nova do GitHub...",
  "em": "2026-11-20T13:00:02Z",
  "progresso": 10,
  "inicio": "2026-11-20T13:00:00Z",
  "vigiaVistoEm": "2026-11-20T13:00:07Z"
}
```

- `situacao`: `ATUALIZANDO`, `OK`, `ERRO` ou `PARADO` (estado inicial do atualizador, antes de qualquer pedido; a API trata como "sem última atualização").
- `mensagem`: texto para a tela.
- `em`: quando a situação foi gravada (ISO 8601 UTC).
- `progresso`: 0 a 100 durante a atualização; `null` fora dela.
- `inicio`: início da atualização em andamento; `null` fora dela.
- `vigiaVistoEm`: batimento do atualizador. A API considera o atualizador ligado (`vigiaAtivo: true`) quando esse horário tem menos de 60 segundos.

### `pedido.json` (gravado pela API, apagado pelo atualizador)

```json
{ "tipo": "RESTAURAR", "arquivo": "restaura-20261120-031500.sql", "pedidoEm": "2026-11-20T13:20:00.000Z" }
```

- `tipo`: `ATUALIZAR`, `COPIAR` ou `RESTAURAR`. O atualizador trata qualquer outro valor como `ATUALIZAR`.
- `arquivo`: só em `RESTAURAR`. O nome da cópia, validado pela regex da API e de novo pelo atualizador. Quando é inválido, o atualizador recusa o pedido.
- `pedidoEm`: ISO 8601. A API usa para descartar pedidos com mais de 10 minutos.
- Regra de segurança: o atualizador **não executa nada** do pedido. Ele usa só o `tipo` (comparado com valores fixos) e o `arquivo` (validado por regex e conferido na pasta `backups/`).

## Situações e o que significam

| Situação (`estado.json`) | Tela / API | Significado |
|---|---|---|
| `ATUALIZANDO` | `ultimaAtualizacao.situacao` = `ATUALIZANDO` | Uma atualização, cópia ou restauração está rodando. `mensagem` e `progresso` dizem em que etapa está. |
| `OK` | `ultimaAtualizacao` com `OK` | A última operação terminou bem. A mensagem diz se atualizou (`Atualizado de X para Y`), se já estava na última versão, ou se criou/restaurou uma cópia. |
| `ERRO` | `ultimaAtualizacao` com `ERRO` | A última operação falhou. A mensagem traz o motivo (até 400 caracteres). Na restauração, o atualizador tenta religar a API e o site antes de gravar o erro. |
| `PARADO` | `ultimaAtualizacao` = `null` | O atualizador subiu e ainda não houve operação. |

Condições da API (vêm dos campos, não de `estado.json`):

| Condição | Significado |
|---|---|
| `instalada: null` | `versao.json` ausente ou inválido: o atualizador ainda não gravou a versão. |
| `vigiaAtivo: false` | Nenhum batimento há mais de 60 segundos: o contêiner `atualizador` está parado. Pedidos são recusados com 400. |
| `pedidoPendente: true` | `pedido.json` existe e ainda não foi atendido. |
| `haNovidade: true` | Há commits no GitHub depois do commit instalado. |
| `erroDoGitHub` preenchido | Não foi possível consultar o GitHub (limite de consultas, repositório não encontrado ou sem resposta). |
| `ATUALIZANDO` parado há muito tempo | Se o atualizador foi interrompido no meio (computador desligado, por exemplo), ao subir de novo ele grava `ERRO` ("A atualização foi interrompida. Tente de novo."). |

## O que cada pedido faz

- **ATUALIZAR** (padrão):
  1. copia o banco para `backups/restaura-AAAAMMDD-HHMMSS.sql` (pg_dump; ficam as 5 mais recentes);
  2. `git pull --ff-only origin <ramo>` no projeto: só avança; se houver alteração local que conflite, para sem apagar nada e grava `ERRO`;
  3. reconstrói os serviços `api` e `web` (`docker compose build`) e religa a API (espera ela responder) e o site;
  4. grava `versao.json`; se o commit mudou e o atualizador ou o `docker-compose.yml` mudaram, recria o contêiner `atualizador`.
- **COPIAR**: só o passo 1 do ATUALIZAR, sem atualizar o código.
- **RESTAURAR**: copia o banco atual (sem podar as cópias), para a API e o site, troca o banco pela cópia pedida em uma única transação (se falhar, o banco continua como estava), e religa a API e o site.

## O que a cópia não cobre

- A cópia de banco (`backups/`) guarda **só o banco de dados PostgreSQL** (`pg_dump` do banco `restaura`).
- **As imagens enviadas não entram na cópia.** Elas ficam no volume `dados_arquivos` (montado em `/dados/arquivos` na API), e o atualizador não as copia nem as restaura.
- Por isso, restaurar uma cópia devolve o banco ao estado daquele momento, mas as imagens continuam como estão no volume. Isso tem dois riscos, com consequências diferentes:
  - **Imagens, versões e mapas 3D apagados depois da cópia voltam como registros.** O banco volta a ter as linhas que descrevem esses arquivos, mas os arquivos já não estão no volume `dados_arquivos`. A tela mostra esses itens com imagem quebrada.
  - **Arquivos criados depois da cópia ficam sem registro.** As imagens, versões e mapas enviados ou gerados depois da cópia continuam no volume, mas o banco restaurado não tem a linha que os descreve. Eles não aparecem no sistema e continuam ocupando espaço em disco.
- Antes de restaurar, confira se a cópia é a que você quer. A restauração não apaga arquivos do volume, então o espaço só volta quando eles forem removidos à mão.
- A atualização não remove o volume `dados_arquivos`.

## Pastas e contêineres

- `atualizacao/`: troca de arquivos entre API e atualizador (`versao.json`, `estado.json`, `pedido.json`, `medidas.json`). Montada na API como `/atualizacao` (leitura e escrita) e no atualizador como `/projeto/atualizacao`.
- `backups/`: cópias do banco. Montada na API como `/backups` (somente leitura) e no atualizador como `/projeto/backups` (escrita).
- Contêiner `atualizador`: monta a pasta do projeto em `/projeto` e o `docker.sock` do computador. Não tem porta publicada.
