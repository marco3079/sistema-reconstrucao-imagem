# Como contribuir

Obrigado pelo interesse em melhorar o Restaura. Este guia explica como relatar problemas, preparar o ambiente, organizar o código e enviar mudanças.

## Relatar um defeito ou sugerir uma melhoria

Use as **issues** do repositório: https://github.com/marco3079/sistema-reconstrucao-imagem/issues

- Para um defeito, use o modelo "Relatar um defeito". Diga o que aconteceu, o que era esperado e como reproduzir.
- Para uma sugestão, use o modelo "Sugerir uma melhoria". Diga qual problema ela resolve.
- Não cole senhas, tokens, o conteúdo do arquivo `.env` nem o conteúdo de `agentes/.mcp.json` em issues, pull requests ou comentários.
- Vulnerabilidades de segurança não devem virar issue pública. Veja o arquivo [SECURITY.md](SECURITY.md).

## Preparar o ambiente

### Para testar com Docker (recomendado)

Requisitos: Docker com Docker Compose.

- Windows: `instalar.ps1`.
- Linux e macOS: `bash instalar.sh`.

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios e sobe os contêineres. As instruções completas estão em [INSTALAR.md](INSTALAR.md) e no [README.md](README.md).

### Para desenvolver sem Docker

Suba só o banco pelo Compose e rode a API e o site com Node.js 20. O passo a passo está na seção "Desenvolvimento" do [README.md](README.md).

## Estrutura do código

```
server/                          API (Node 20, Express, Prisma, PostgreSQL)
  prisma/schema.prisma           modelo de dados
  src/app.ts                     monta a API e carrega os módulos
  src/lib/                       código compartilhado (erros, autenticação, acesso, imagem, grade, cena, Canva, MCP)
  src/modules/<modulo>/routes.ts rotas HTTP de cada módulo
  src/modules/<modulo>/ferramentas.ts  ferramentas MCP dos agentes (quando o módulo tem)
client/                          site (React, TypeScript, Vite)
  src/lib/                       código compartilhado (API, autenticação, tipos)
  src/ui/                        componentes visuais e estilo.css
  src/layout/                    casca do app, menu e login
  src/modules/<modulo>/index.tsx telas de cada módulo, com a lista `rotas`
agentes/                         equipe de agentes (instruções de cada agente e a skill restaurar)
docs/                            contratos, normas, grade, cena e arquitetura
```

Cada módulo é uma pasta. O servidor carrega todas as pastas de `server/src/modules/` que têm um `routes.ts`, e o site carrega todas as pastas de `client/src/modules/` que têm um `index.tsx` exportando `rotas`. Para criar um módulo novo, basta criar a pasta com o arquivo esperado; não é preciso editar uma lista central.

Para a visão completa, veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Para os contratos de rotas, tipos e ferramentas MCP, veja [docs/CONTRATOS.md](docs/CONTRATOS.md).

## Convenções

- TypeScript em modo estrito (`strict: true`), no servidor e no site.
- Nomes de domínio, rotas da API e mensagens para a pessoa usuária em português do Brasil.
- Erros da API devolvem `{ "erro": "mensagem em português" }`, com o status HTTP adequado.
- Em toda rota, use os utilitários de `server/src/lib/erros.ts` e confira o dono dos dados com `server/src/lib/acesso.ts`.
- Não adicione dependência sem necessidade. Antes de instalar um pacote, confirme que a funcionalidade não existe no que já está no projeto.
- Não mexa nos arquivos que os contratos marcam como fixos sem alinhar antes (por exemplo, `client/src/lib/tipos.ts`, citado em `docs/CONTRATOS.md`).

## Verificação antes do pull request

Rode estes comandos antes de abrir um pull request:

```bash
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
cd client && npx vite build
```

O projeto não tem script de testes automatizados no `package.json`. Por isso, descreva no pull request como você testou a mudança.

## Mensagens de commit

- Curtas, no imperativo e em português. Exemplos: `Adiciona filtro de partes por categoria`, `Corrige ordem das rodadas da equipe`.
- Uma mudança por commit, sempre que possível.

## Fluxo de pull request

1. Crie uma branch a partir do ramo principal do repositório.
2. Faça a mudança e rode a verificação acima.
3. Abra o pull request preenchendo o modelo. Descreva o que mudou, por que e como foi testado.
4. Quando a mudança alterar a tela, inclua prints (antes e depois, se for o caso).
5. Mantenha a documentação em dia: `docs/CONTRATOS.md` para rotas, tipos e ferramentas MCP, e `docs/ARQUITETURA.md` para a estrutura.

Ao contribuir, você concorda em seguir o [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
