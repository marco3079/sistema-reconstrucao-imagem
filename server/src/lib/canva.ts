import crypto from 'crypto';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { cifrar, decifrar } from './cripto';

// Cliente MCP do conector do Canva (https://mcp.canva.com). OAuth 2.1 com PKCE, cliente público.

export type ProporcaoCanva =
  | 'SQUARE_1_1'
  | 'LANDSCAPE_16_9'
  | 'LANDSCAPE_4_3'
  | 'LANDSCAPE_3_2'
  | 'LANDSCAPE_5_4'
  | 'LANDSCAPE_2_1'
  | 'PORTRAIT_9_16'
  | 'PORTRAIT_3_4'
  | 'PORTRAIT_2_3'
  | 'PORTRAIT_4_5'
  | 'PORTRAIT_1_2';

export interface PedidoDeGeracao {
  prompt: string;
  referencias: string[]; // ids de mídia do Canva (devolvidos por enviarImagemAoCanva)
  proporcao?: ProporcaoCanva;
}

const MCP_BASE = 'https://mcp.canva.com';
const VERSAO_PROTOCOLO = '2025-06-18';
const EXPIROU = 'Conexão com o Canva expirou. Conecte de novo em Configurações.';
const MSG_RENOVACAO_FALHOU = 'O Canva não respondeu à renovação do acesso. Tente de novo em instantes.';

// Renovações de token em andamento, por usuário.
const renovando = new Map<number, Promise<string>>();

// expires_in do Canva em segundos; valor inválido vira 1 hora.
function segundosDeExpiracao(valor: unknown): number {
  const exp = Number(valor);
  return Number.isFinite(exp) && exp > 0 ? exp : 3600;
}
const JANELA_ESTADO_MS = 15 * 60 * 1000;
const ESPERA_GERACAO_MS = 180 * 1000;
const INTERVALO_GERACAO_MS = 4000;

// Endereço público do sistema (sem barra final).
export function basePublica(): string {
  return (process.env.URL_PUBLICA ?? 'http://localhost:8095').replace(/\/$/, '');
}

function redirectUri(): string {
  return basePublica() + '/api/canva/retorno';
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

// Sessões MCP em memória, por usuário.
const sessoes = new Map<number, string | null>();
let proximoId = 2;

// ---------- Transporte MCP ----------

async function lerRespostaMcp(resposta: Response, id: number): Promise<any> {
  const tipo = resposta.headers.get('content-type') ?? '';
  if (tipo.includes('text/event-stream')) {
    const texto = await resposta.text();
    const objetos: any[] = [];
    for (const linha of texto.split(/\r?\n/)) {
      if (!linha.startsWith('data:')) continue;
      try {
        objetos.push(JSON.parse(linha.slice('data:'.length).trim()));
      } catch {
        // linha que não é JSON: ignora
      }
    }
    const achado = objetos.find((o) => o && o.id === id);
    if (achado) return achado;
    const ultimo = [...objetos].reverse().find((o) => o && ('result' in o || 'error' in o));
    return ultimo ?? {};
  }
  return resposta.json();
}

async function rpc(
  token: string,
  sessao: string | null,
  metodo: string,
  params: object | undefined,
  id: number | null
): Promise<{ dados: any; sessao: string | null }> {
  const cabecalhos: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessao) cabecalhos['Mcp-Session-Id'] = sessao;
  if (metodo !== 'initialize') cabecalhos['MCP-Protocol-Version'] = VERSAO_PROTOCOLO;

  const corpo: Record<string, unknown> = { jsonrpc: '2.0', method: metodo, params };
  if (id !== null) corpo.id = id;

  const resposta = await fetch(MCP_BASE + '/mcp', {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(120000),
  });
  if (resposta.status === 401) throw new HttpError(409, EXPIROU);

  const novaSessao = resposta.headers.get('mcp-session-id') ?? sessao;
  if (id === null) {
    // Notificação: não há corpo para ler.
    resposta.body?.cancel().catch(() => undefined);
    return { dados: null, sessao: novaSessao };
  }

  const dados = await lerRespostaMcp(resposta, id);
  if (dados?.error) throw new HttpError(502, 'Canva: ' + dados.error.message);
  return { dados, sessao: novaSessao };
}

async function iniciarSessao(usuarioId: number, token: string): Promise<string | null> {
  const { sessao } = await rpc(
    token,
    null,
    'initialize',
    { protocolVersion: VERSAO_PROTOCOLO, capabilities: {}, clientInfo: { name: 'restaura', version: '1.0.0' } },
    1
  );
  sessoes.set(usuarioId, sessao);
  await rpc(token, sessao, 'notifications/initialized', undefined, null);
  return sessao;
}

// ---------- Tokens ----------

async function apagarConexao(usuarioId: number): Promise<void> {
  await prisma.canvaConexao.deleteMany({ where: { usuarioId } });
}

async function tokenValido(usuarioId: number): Promise<string> {
  const conexao = await prisma.canvaConexao.findUnique({ where: { usuarioId } });
  if (!conexao) throw new HttpError(409, 'Canva não conectado. Conecte em Configurações.');

  if (conexao.expiraEm.getTime() - Date.now() > 60000) {
    const token = decifrar(conexao.tokenAcesso);
    if (token !== null) return token;
    await apagarConexao(usuarioId);
    throw new HttpError(409, EXPIROU);
  }

  // Uma renovação por usuário por vez: quem chegar enquanto ela roda espera a mesma promessa.
  const emAndamento = renovando.get(usuarioId);
  if (emAndamento) return emAndamento;
  const promessa = renovarToken(usuarioId, conexao.clientId, conexao.tokenRenovacao);
  renovando.set(usuarioId, promessa);
  try {
    return await promessa;
  } finally {
    renovando.delete(usuarioId);
  }
}

async function renovarToken(usuarioId: number, clientId: string, tokenRenovacaoCifrado: string | null): Promise<string> {
  const renovacao = tokenRenovacaoCifrado ? decifrar(tokenRenovacaoCifrado) : null;
  if (!renovacao) {
    await apagarConexao(usuarioId);
    throw new HttpError(409, EXPIROU);
  }

  let resposta: Response;
  try {
    resposta = await fetch(MCP_BASE + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: renovacao,
        client_id: clientId,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new HttpError(502, MSG_RENOVACAO_FALHOU);
  }
  // Só o Canva recusando o refresh token (400/401) invalida a conexão.
  if (resposta.status === 400 || resposta.status === 401) {
    await apagarConexao(usuarioId);
    throw new HttpError(409, EXPIROU);
  }
  if (!resposta.ok) throw new HttpError(502, MSG_RENOVACAO_FALHOU);

  let dados: any;
  try {
    dados = await resposta.json();
  } catch {
    throw new HttpError(502, MSG_RENOVACAO_FALHOU);
  }
  if (!dados?.access_token) throw new HttpError(502, MSG_RENOVACAO_FALHOU);

  const novoRenovacao: string = dados.refresh_token ?? renovacao;
  await prisma.canvaConexao.update({
    where: { usuarioId },
    data: {
      tokenAcesso: cifrar(dados.access_token),
      tokenRenovacao: cifrar(novoRenovacao),
      expiraEm: new Date(Date.now() + segundosDeExpiracao(dados.expires_in) * 1000),
    },
  });
  return dados.access_token;
}

// ---------- Leitura de resultados (ajudas puras, exportadas) ----------

export function textoDoResultado(result: any): string {
  const itens: any[] = Array.isArray(result?.content) ? result.content : [];
  return itens
    .filter((i) => i?.type === 'text' && typeof i.text === 'string')
    .map((i) => i.text as string)
    .join('\n');
}

export function jsonDoResultado(result: any): unknown {
  if (result?.structuredContent != null) return result.structuredContent;
  try {
    return JSON.parse(textoDoResultado(result));
  } catch {
    return null;
  }
}

export function acharValor(obj: unknown, chaves: RegExp): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const achado = acharValor(item, chaves);
      if (achado !== null) return achado;
    }
    return null;
  }
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (chaves.test(chave)) {
      if (typeof valor === 'string' && valor.trim() !== '') return valor;
      if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
    }
    const achado = acharValor(valor, chaves);
    if (achado !== null) return achado;
  }
  return null;
}

export function acharUrls(obj: unknown): string[] {
  const achadas = new Set<string>();
  const visitar = (v: unknown): void => {
    if (typeof v === 'string') {
      const inteiro = v.trim();
      if (/^https:\/\/\S+$/.test(inteiro)) achadas.add(inteiro);
      for (const m of v.match(/https:\/\/[^\s"'<>)\]]+/g) ?? []) achadas.add(m);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visitar(item);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const valor of Object.values(v as Record<string, unknown>)) visitar(valor);
    }
  };
  visitar(obj);
  return [...achadas];
}

// ---------- Chamada de ferramenta ----------

export async function chamarFerramentaCanva(
  usuarioId: number,
  nome: string,
  args: Record<string, unknown>
): Promise<any> {
  const executar = async (): Promise<any> => {
    const token = await tokenValido(usuarioId);
    if (!sessoes.has(usuarioId)) await iniciarSessao(usuarioId, token);
    const { dados } = await rpc(
      token,
      sessoes.get(usuarioId) ?? null,
      'tools/call',
      { name: nome, arguments: args },
      proximoId++
    );
    return dados;
  };

  let dados: any;
  try {
    dados = await executar();
  } catch (erro) {
    if (erro instanceof HttpError && erro.status === 409) throw erro;
    sessoes.delete(usuarioId);
    dados = await executar();
  }

  const result = dados?.result ?? {};
  if (result.isError) {
    throw new HttpError(502, 'Canva: ' + textoDoResultado(result));
  }
  return result;
}

// ---------- Conexão ----------

export async function canvaConectado(usuarioId: number): Promise<boolean> {
  const conexao = await prisma.canvaConexao.findUnique({ where: { usuarioId } });
  if (!conexao) return false;
  return conexao.expiraEm.getTime() > Date.now() || conexao.tokenRenovacao != null;
}

export async function iniciarConexao(usuarioId: number): Promise<string> {
  await prisma.canvaEstado.deleteMany({
    where: { criadoEm: { lt: new Date(Date.now() - JANELA_ESTADO_MS) } },
  });

  const uri = redirectUri();
  const conexao = await prisma.canvaConexao.findUnique({ where: { usuarioId } });
  let clientId: string;
  if (conexao && conexao.redirectUri === uri) {
    clientId = conexao.clientId;
  } else {
    const registro = await fetch(MCP_BASE + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Restaura',
        redirect_uris: [uri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!registro.ok) throw new HttpError(502, 'Canva recusou o registro do aplicativo');
    const dados: any = await registro.json();
    clientId = dados.client_id;
  }

  const verificador = crypto.randomBytes(32).toString('base64url');
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');
  const state = crypto.randomBytes(24).toString('hex');

  await prisma.canvaEstado.create({
    data: { state, usuarioId, verificador, clientId, redirectUri: uri },
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: uri,
    state,
    code_challenge: desafio,
    code_challenge_method: 'S256',
    resource: MCP_BASE,
  });
  const escopos = await escoposSuportados();
  if (escopos.length > 0) params.set('scope', escopos.join(' '));
  return MCP_BASE + '/authorize?' + params.toString();
}

async function escoposSuportados(): Promise<string[]> {
  try {
    const resposta = await fetch(MCP_BASE + '/.well-known/oauth-protected-resource', {
      signal: AbortSignal.timeout(30000),
    });
    if (!resposta.ok) return [];
    const dados: any = await resposta.json();
    return Array.isArray(dados?.scopes_supported)
      ? dados.scopes_supported.filter((s: unknown): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function concluirConexao(code: string, state: string): Promise<void> {
  const estado = await prisma.canvaEstado.findUnique({ where: { state } });
  // O state é de uso único: apaga já, antes de falar com o Canva.
  await prisma.canvaEstado.deleteMany({ where: { state } });
  if (!estado || Date.now() - estado.criadoEm.getTime() > JANELA_ESTADO_MS) {
    throw new HttpError(400, 'Login do Canva expirado. Tente de novo.');
  }

  const resposta = await fetch(MCP_BASE + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: estado.redirectUri,
      client_id: estado.clientId,
      code_verifier: estado.verificador,
      resource: MCP_BASE,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resposta.ok) throw new HttpError(502, 'Canva recusou o login');

  const dados: any = await resposta.json();
  if (!dados?.access_token) throw new HttpError(502, 'Canva recusou o login');

  const gravados = {
    clientId: estado.clientId,
    redirectUri: estado.redirectUri,
    tokenAcesso: cifrar(dados.access_token),
    tokenRenovacao: dados.refresh_token ? cifrar(dados.refresh_token) : null,
    expiraEm: new Date(Date.now() + segundosDeExpiracao(dados.expires_in) * 1000),
  };
  await prisma.canvaConexao.upsert({
    where: { usuarioId: estado.usuarioId },
    create: { usuarioId: estado.usuarioId, ...gravados },
    update: gravados,
  });
  sessoes.delete(estado.usuarioId);
}

export async function desconectar(usuarioId: number): Promise<void> {
  await apagarConexao(usuarioId);
  sessoes.delete(usuarioId);
}

// ---------- Uso pelo sistema ----------

// Envia a imagem para a conta Canva do usuário e devolve o id da mídia.
// Lança HttpError(409, 'Canva não conectado...') sem conexão.
export async function enviarImagemAoCanva(usuarioId: number, conteudo: Buffer, nome: string): Promise<string> {
  const r = await chamarFerramentaCanva(usuarioId, 'create-upload-url', {
    user_intent: 'Enviar imagem para reconstrução',
  });
  const url = acharValor(jsonDoResultado(r) ?? {}, /^upload_?url$/i) ?? acharUrls(textoDoResultado(r))[0];
  if (!url) throw new HttpError(502, 'Canva não devolveu o endereço de envio');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(conteudo),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) throw new HttpError(502, 'Falha ao enviar a imagem ao Canva (' + resp.status + ')');

  const corpo = await resp.text();
  let json: unknown = null;
  try {
    json = JSON.parse(corpo);
  } catch {
    json = null;
  }
  const mediaId = acharValor(json, /^media_?id$/i) ?? acharValor(json, /^(asset_?id|id)$/i);
  if (!mediaId) {
    console.error('Resposta de envio do Canva sem id:', corpo.slice(0, 500));
    throw new HttpError(502, 'Canva não devolveu o id da imagem enviada');
  }
  console.log(`Imagem "${nome}" enviada ao Canva.`);
  return mediaId;
}

async function extrairImagem(result: any): Promise<Buffer | null> {
  const itens: any[] = Array.isArray(result?.content) ? result.content : [];
  for (const item of itens) {
    if (item?.type === 'image' && typeof item.data === 'string' && item.data !== '') {
      return Buffer.from(item.data, 'base64');
    }
  }
  for (const item of itens) {
    if (item?.type === 'resource' && typeof item.resource?.blob === 'string') {
      return Buffer.from(item.resource.blob, 'base64');
    }
  }
  for (const url of acharUrls([jsonDoResultado(result), textoDoResultado(result), result?.content])) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const tipo = resp.headers.get('content-type') ?? '';
      if (resp.ok && tipo.startsWith('image/')) return Buffer.from(await resp.arrayBuffer());
    } catch {
      // tenta a próxima url
    }
  }
  return null;
}

// Gera uma imagem no Canva (com as referências dadas), espera ficar pronta e devolve os bytes.
export async function gerarImagemNoCanva(usuarioId: number, pedido: PedidoDeGeracao): Promise<Buffer> {
  const args: Record<string, unknown> = {
    prompt: pedido.prompt,
    user_intent: 'Reconstruir parte de uma imagem',
  };
  if (pedido.referencias.length > 0) {
    args.imageReferences = pedido.referencias.map((id) => ({ type: 'MEDIA', id }));
  }
  if (pedido.proporcao) args.aspectRatio = pedido.proporcao;

  // Pede a geração. Sem jobId na resposta (o Canva às vezes responde só com um aviso, por exemplo de limite
  // de uso), espera um pouco e tenta mais uma vez; se repetir, o erro leva o que o Canva disse.
  const pedir = async (): Promise<{ jobId: string | null; dito: string }> => {
    const r = await chamarFerramentaCanva(usuarioId, 'generate-image', args);
    const json = jsonDoResultado(r);
    let id = acharValor(json ?? {}, /^job_?id$/i);
    if (!id) {
      const m = textoDoResultado(r).match(/job[_ ]?id["':\s]+([A-Za-z0-9_-]{6,})/i);
      id = m ? m[1] : null;
    }
    // Sem endereços: a resposta pode trazer links assinados, e este texto vai para a tela.
    const dito = (textoDoResultado(r) || (json ? JSON.stringify(json) : ''))
      .replace(/https?:\/\/[^\s"']+/g, '[link]')
      .replace(/\s+/g, ' ')
      .trim();
    return { jobId: id, dito };
  };
  let tentativa = await pedir();
  if (!tentativa.jobId) {
    console.error('Canva respondeu sem jobId (1ª tentativa):', tentativa.dito.slice(0, 1000));
    await dormir(12000);
    tentativa = await pedir();
  }
  const jobId = tentativa.jobId;
  if (!jobId) {
    console.error('Canva respondeu sem jobId (2ª tentativa):', tentativa.dito.slice(0, 1000));
    throw new HttpError(
      502,
      tentativa.dito
        ? 'O Canva não iniciou a geração. Resposta do Canva: ' + tentativa.dito.slice(0, 300)
        : 'Canva não devolveu o trabalho de geração'
    );
  }

  const fim = Date.now() + ESPERA_GERACAO_MS;
  let j: any;
  for (;;) {
    j = await chamarFerramentaCanva(usuarioId, 'get-generate-image-job', { jobId });
    const json = jsonDoResultado(j) ?? {};
    const status = (acharValor(json, /^status$/i) ?? '').toUpperCase();
    if (status.includes('FAIL') || status === 'ERROR') {
      throw new HttpError(
        502,
        'Canva não conseguiu gerar: ' + (acharValor(json, /^failure_?message$/i) ?? 'sem detalhes')
      );
    }
    // Pronto ou sem status reconhecido: tenta extrair a imagem; se não vier, continua esperando.
    const pronto = status.includes('SUCCESS') || status === 'COMPLETED' || status === 'DONE';
    if (pronto || status === '') {
      const imagem = await extrairImagem(j);
      if (imagem) return imagem;
    }
    if (Date.now() >= fim) break;
    await dormir(INTERVALO_GERACAO_MS);
  }

  console.error('Último retorno do Canva:', JSON.stringify(j).slice(0, 2000));
  throw new HttpError(504, 'O Canva demorou demais para gerar a imagem');
}

const PROPORCOES: Array<[ProporcaoCanva, number]> = [
  ['SQUARE_1_1', 1],
  ['LANDSCAPE_16_9', 16 / 9],
  ['LANDSCAPE_4_3', 4 / 3],
  ['LANDSCAPE_3_2', 3 / 2],
  ['LANDSCAPE_5_4', 5 / 4],
  ['LANDSCAPE_2_1', 2],
  ['PORTRAIT_9_16', 9 / 16],
  ['PORTRAIT_3_4', 3 / 4],
  ['PORTRAIT_2_3', 2 / 3],
  ['PORTRAIT_4_5', 4 / 5],
  ['PORTRAIT_1_2', 1 / 2],
];

// Proporção do Canva mais próxima de largura/altura.
export function proporcaoMaisProxima(largura: number, altura: number): ProporcaoCanva {
  const alvo = Math.log(largura / altura);
  let melhor: ProporcaoCanva = PROPORCOES[0][0];
  let menorDistancia = Infinity;
  for (const [chave, razao] of PROPORCOES) {
    const distancia = Math.abs(Math.log(razao) - alvo);
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      melhor = chave;
    }
  }
  return melhor;
}
