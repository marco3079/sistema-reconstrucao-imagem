# Como instalar o Restaura

Este guia leva você do zero até o sistema funcionando no seu computador. Não precisa saber programar.

## O que você precisa

- **Docker Desktop**: programa que roda o sistema em "caixas" separadas. O instalador oferece instalar para você (no Windows, pelo winget). Também dá para baixar em https://www.docker.com/products/docker-desktop/.
- **Git**: programa para baixar o projeto. Baixe em https://git-scm.com/downloads. Se não quiser instalar o Git, use o botão "Code" > "Download ZIP" no repositório, descompacte e pule o comando `git clone`.
- Conexão com a internet na primeira instalação (o Docker baixa as dependências automaticamente).

## Jeito 1: pedir para um assistente de IA instalar

Se você usa um assistente com acesso ao terminal (Claude Code, Cursor, Copilot ou outro), copie o texto abaixo e cole no assistente:

> Instale o Restaura do repositório https://github.com/marco3079/sistema-reconstrucao-imagem neste computador seguindo o arquivo AGENTS.md do repositório. Ao terminar, me diga o endereço para abrir no navegador e o e-mail e a senha do administrador.

O assistente baixa o projeto, roda o instalador e avisa o endereço do site. A senha inicial do administrador é `admin1234` (e-mail `admin@restaura.local`); o assistente informa as duas e avisa para trocar a senha no primeiro acesso.

## Jeito 2: com um comando

Abra o terminal (no Windows, o **PowerShell**; no Linux ou macOS, o **Terminal**) e rode os comandos de acordo com o seu sistema.

**Windows (PowerShell):**

```powershell
git clone https://github.com/marco3079/sistema-reconstrucao-imagem.git
cd sistema-reconstrucao-imagem
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

**Linux e macOS (Terminal):**

```bash
git clone https://github.com/marco3079/sistema-reconstrucao-imagem.git
cd sistema-reconstrucao-imagem
bash instalar.sh
```

O instalador confere o Docker, oferece instalar o que faltar, cria o arquivo `.env` com segredos aleatórios, grava a ligação MCP da equipe de agentes em `agentes/.mcp.json`, baixa tudo e sobe o sistema. No fim ele mostra:

- o endereço do site (por exemplo, `http://localhost:8095`);
- o e-mail do administrador (`admin@restaura.local`);
- a senha do administrador (`admin1234`, a senha padrão; troque em "Meu perfil" no primeiro acesso).

Se o instalador parar com uma mensagem, leia a mensagem: ela diz o que fazer. Os códigos de saída estão em `AGENTS.md`.

### Opções do instalador

| Windows (PowerShell) | Linux e macOS | Para que serve |
|---|---|---|
| `-PortaWeb N` | `--porta-web N` | Porta do site (padrão `8095`) |
| `-PortaApi N` | `--porta-api N` | Porta da API e do servidor MCP, só neste computador (padrão `3095`) |
| `-PortaBanco N` | `--porta-banco N` | Porta do banco, só neste computador (padrão `5435`) |
| `-SemPerguntas` | `--sem-perguntas` | O instalador não pede confirmação |

## Primeiro acesso

1. Abra o endereço do site no navegador.
2. Entre com o e-mail e a senha mostrados no fim da instalação (`admin@restaura.local` e `admin1234`, se você não mudou o `.env`).
3. Troque a senha em **Meu perfil**, no menu do seu nome.
4. Abra **Imagens** e envie a primeira imagem. Os passos estão no [README.md](README.md#enviar-uma-imagem).

O sistema começa vazio, só com a conta do administrador.

## Ligar a equipe de agentes

A equipe de agentes não roda dentro do site: ela roda numa sessão do Claude Code aberta na pasta `agentes` do projeto. Sem essa sessão ligada, o sistema funciona, mas as análises e as opções da equipe ficam esperando na fila.

1. Instale o Claude Code e abra o terminal na pasta `agentes` (dentro da pasta do projeto). Digite `claude`.
2. Na primeira vez, aceite o servidor MCP `restaura` quando o Claude Code perguntar.
3. No site, abra a imagem, vá na aba **Equipe ao vivo** e copie o comando de conexão.
4. Digite o comando na sessão do Claude Code (`/restaurar` seguido do número da imagem) e deixe a sessão aberta.
5. Para desligar a equipe daquela imagem, digite `/parar` na sessão.

A ligação usa o token que está no `.env` (`AGENTES_TOKEN`), guardado no arquivo `agentes/.mcp.json` que o instalador grava. Não compartilhe esse arquivo.

## Usar em outro aparelho da rede

O site fica na porta `8095` (ou na que você escolheu) e aceita conexões de outros aparelhos da mesma rede. Para abrir, use `http://<IP-do-computador>:8095`. O IP do computador você descobre nas configurações de rede do sistema operacional.

O sistema não tem HTTPS. Use só em rede de confiança. A API e o banco aceitam conexões somente deste computador.

## Atualizar

Quem atualiza é o contêiner `atualizador`, criado pelo instalador. Há dois jeitos:

- **Pelo botão da tela**: quando houver versão nova, aparece um botão no topo; em **Atualização**, clique em **Atualizar agora**.
- **Pelo script**: no Windows, `powershell -ExecutionPolicy Bypass -File .\atualizar.ps1`; no Linux e no macOS, `sh atualizar.sh`.

A atualização guarda uma cópia do banco na pasta `backups/` (ficam as 5 mais recentes), baixa a versão nova e reconstrói os contêineres. Os dados do banco são mantidos. As imagens enviadas ficam no volume `dados_arquivos` e não entram na cópia do banco.

Se a atualização falhar, ela para sem apagar nada e mostra o erro. No Windows, para voltar uma cópia do banco, use `powershell -ExecutionPolicy Bypass -File .\atualizar.ps1 -Restaurar restaura-AAAAMMDD-HHMMSS.sql` (o script guarda antes o banco atual).

## Parar o sistema

Na pasta do projeto:

```bash
docker compose down
```

Os dados continuam guardados. Para ligar de novo, rode o instalador outra vez.

## Apagar tudo

Atenção: este comando **apaga o banco de dados e as imagens enviadas**.

```bash
docker compose down -v
```

## Problemas comuns

**O Docker não está aberto.** O instalador diz "o Docker está instalado, mas não está rodando". Abra o Docker Desktop, espere ele iniciar e rode o instalador de novo.

**Porta ocupada.** Se a porta do site, da API ou do banco já estiver em uso, o instalador escolhe a próxima livre e avisa qual usou. Confira o endereço no fim da instalação. Se já existe um arquivo `.env`, o instalador usa as portas dele e só avisa que estão ocupadas.

**Esqueci a senha do administrador.** Se você não trocou a senha, ela é `admin1234`, com o e-mail `admin@restaura.local` (ou o que estiver em `ADMIN_EMAIL` no arquivo `.env`). Se você definiu outra senha em `ADMIN_SENHA` no `.env`, ela está lá. Se já trocou e esqueceu, a saída é apagar o banco (`docker compose down -v`, o que apaga todos os dados) e instalar de novo.

**O instalador parou com a mensagem "Já existe um banco de dados desta instalação" (código 6).** O banco de uma instalação anterior ainda existe, mas o arquivo `.env` com a senha dele não está na pasta. Duas saídas: (a) se você tem o `.env` antigo, copie-o de volta para a pasta do projeto e rode o instalador de novo; (b) se você não precisa mais dos dados antigos, apague o banco com `docker compose down -v` (isso apaga tudo) e rode o instalador de novo. O instalador não apaga nada sozinho.

**A instalação falhou no meio.** Rode o instalador de novo. Ele não sobrescreve o `.env` que já existe.

**A API não respondeu (código 5).** Veja os logs com `docker compose logs --tail 100 api`. Se o erro for de banco, confira `docker compose logs --tail 100 db`.
