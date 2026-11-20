# Política de segurança

## Versões com suporte

Apenas a versão mais recente do ramo principal do repositório recebe correções de segurança.

## Como relatar uma vulnerabilidade

**Não abra issue pública para vulnerabilidades.** Relate em particular:

1. Acesse a aba **Security** do repositório: https://github.com/marco3079/sistema-reconstrucao-imagem/security
2. Escolha **Report a vulnerability**.
3. Descreva o problema com o máximo de detalhes que puder.

Os mantenedores respondem pelo próprio GitHub. Não há prazo garantido de resposta, pois o projeto é mantido de forma voluntária.

### O que incluir no relato

- Qual parte do sistema foi afetada (API, site, equipe de agentes, instalador, atualizador, banco).
- Versão ou commit usado.
- Passos para reproduzir o problema.
- Impacto esperado (por exemplo, acesso a imagens ou projetos de outro usuário).
- Se possível, uma sugestão de correção.

Não envie senhas reais, tokens válidos nem dados pessoais no relato. Use dados fictícios.

## Medidas de segurança já existentes

- **Senhas** são guardadas com bcrypt (biblioteca `bcryptjs`, com custo 10), nunca em texto puro. A resposta de usuário não inclui o hash da senha.
- **Login** por JWT enviado no cabeçalho `Authorization: Bearer`, com validade de 12 horas. Usuário inativo não consegue entrar. Todas as rotas da API exigem login, exceto a verificação de saúde, o login, o retorno do Canva e a leitura pública dos arquivos de imagem (ver "Pontos de atenção").
- **Perfis**: existem os perfis `ADMIN` e `USUARIO`. As rotas de usuários e a conexão da equipe de agentes (`/agentes/conexao`) exigem `ADMIN`.
- **Dono dos dados**: as rotas conferem se o projeto, a parte, a opção e a referência pertencem ao usuário logado (`server/src/lib/acesso.ts`).
- **Banco de dados e API** publicados somente em `127.0.0.1` (`docker-compose.yml`), ou seja, acessíveis apenas pelo próprio computador.
- **Segredos** (senha do banco, `JWT_SECRET`, `AGENTES_TOKEN`) são gerados pelo instalador de forma aleatória e gravados no arquivo `.env`, que não vai para o Git (está no `.gitignore`).
- **Token da equipe de agentes**: a sessão do Claude Code se liga ao servidor MCP com o token `AGENTES_TOKEN`. A comparação do token é feita em tempo constante. O instalador grava a ligação em `agentes/.mcp.json`, que também não vai para o Git.
- **Tokens do Canva** ficam cifrados no banco com AES-256-GCM (`server/src/lib/cripto.ts`). A chave é derivada do `JWT_SECRET`. Se o segredo mudar, a conexão com o Canva é apagada e precisa ser feita de novo.
- **Cabeçalhos de segurança no site**: o nginx envia `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` e `Referrer-Policy: strict-origin-when-cross-origin`.
- **Limite de tentativas de login**: 10 falhas em 10 minutos por combinação de IP e e-mail; depois disso, a API responde 429.
- **Tamanho das imagens**: o servidor aceita corpo de imagem de até 30 MB (`server/src/lib/arquivos.ts`), e o nginx aceita até 32 MB (`client/nginx.conf`).
- **Atualização**: o contêiner `atualizador` não publica porta. Ele não recebe comandos da tela: a API só grava um arquivo de pedido, e o atualizador atualiza a partir do repositório de origem.

## Pontos de atenção e limites conhecidos

- **Sem HTTPS próprio.** O projeto não traz certificado nem proxy com HTTPS. O site é publicado em HTTP na porta `8095` de todas as interfaces, ou seja, na rede local. Use só em rede de confiança.
- **A API também responde pela porta do site na rede local.** O nginx encaminha `/api/` para a API. Por isso, a API e o banco só estão protegidos pelo `127.0.0.1` na porta direta; pela porta do site, a API é alcançável na rede.
- **Senha padrão conhecida.** A conta administradora nasce com `admin1234` (`ADMIN_SENHA` no `.env`). Troque no primeiro acesso em "Meu perfil", principalmente se o site ficar acessível na rede.
- **Imagens públicas por nome.** `GET /api/arquivos/:nome` não exige login. O nome tem 32 caracteres hexadecimais aleatórios, mas quem tiver o endereço exato lê o arquivo.
- **Sem `JWT_SECRET` próprio, os logins caem a cada reinício.** Se a variável estiver ausente ou com o valor de exemplo, a API gera um segredo aleatório a cada subida. Nesse caso, os logins são invalidados quando o servidor reinicia, e os tokens do Canva guardados deixam de abrir. O instalador define o segredo.
- **Sem `AGENTES_TOKEN` próprio, o token aparece no log.** Se a variável tiver menos de 16 caracteres, a API gera um token e o imprime no log da subida. O instalador grava um valor próprio.
- **Token de login no navegador.** O token fica no armazenamento local do navegador. Em um computador compartilhado, saia do sistema ao terminar.
- **O que sai do computador.** As imagens e os recortes enviados ao Canva saem para o Canva, e o que a equipe de agentes lê passa pelo provedor do assistente (Claude). As imagens, os laudos e o banco ficam no seu computador.
- **Contêiner `atualizador` com acesso ao Docker.** Ele tem acesso ao socket do Docker do computador e à pasta do projeto. Quem controla o repositório de origem controla o que é instalado: mantenha a conta do GitHub protegida.
- **Os fluxos de agentes ainda não foram auditados** por uma pessoa de segurança. Trate o sistema como ferramenta de uso pessoal ou de uma equipe pequena, em rede de confiança.

## Recomendações antes de expor o sistema à internet

- **Use HTTPS.** Coloque um proxy reverso com certificado (por exemplo, Caddy, Nginx ou Traefik) na frente do site. O projeto não traz HTTPS pronto.
- Troque a senha do administrador e não use os valores de exemplo.
- Não exponha a porta da API nem a do banco: elas já estão publicadas só em `127.0.0.1`, e a API também responde pela porta do site.
- Mantenha o Docker e as imagens atualizados.
