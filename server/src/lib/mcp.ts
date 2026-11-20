import { Request, Response } from 'express';
import { HttpError } from './erros';

// Servidor MCP mínimo (JSON-RPC 2.0 sobre HTTP, sem sessão) para a equipe de agentes.
// Uma sessão do Claude Code liga em POST /mcp com "Authorization: Bearer <AGENTES_TOKEN>".
// Cada módulo registra suas ferramentas com registrarFerramenta() num arquivo ferramentas.ts,
// carregado por app.ts na subida.

export type ConteudoMcp =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface FerramentaMcp {
  nome: string;
  descricao: string;
  // JSON Schema do objeto de argumentos (type: 'object').
  esquema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  executar(args: Record<string, unknown>): Promise<ConteudoMcp[] | string | object>;
}

const FERRAMENTAS = new Map<string, FerramentaMcp>();

export function registrarFerramenta(ferramenta: FerramentaMcp): void {
  if (FERRAMENTAS.has(ferramenta.nome)) {
    throw new Error(`Ferramenta MCP duplicada: ${ferramenta.nome}`);
  }
  FERRAMENTAS.set(ferramenta.nome, ferramenta);
}

export function ferramentasRegistradas(): string[] {
  return [...FERRAMENTAS.keys()];
}

// Ajudas para ler argumentos com mensagem de erro clara para o agente.
export function argNumero(args: Record<string, unknown>, nome: string): number {
  const v = args[nome];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `Argumento "${nome}" deve ser um número`);
  return n;
}

export function argNumeroOpcional(args: Record<string, unknown>, nome: string): number | undefined {
  if (args[nome] === undefined || args[nome] === null || args[nome] === '') return undefined;
  return argNumero(args, nome);
}

export function argTexto(args: Record<string, unknown>, nome: string): string {
  const v = args[nome];
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `Argumento "${nome}" deve ser um texto`);
  return v;
}

export function argTextoOpcional(args: Record<string, unknown>, nome: string): string | undefined {
  const v = args[nome];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `Argumento "${nome}" deve ser um texto`);
  return v;
}

// Conteúdo de imagem para devolver numa ferramenta.
export function imagemMcp(conteudo: Buffer, mimeType = 'image/jpeg'): ConteudoMcp {
  return { type: 'image', data: conteudo.toString('base64'), mimeType };
}

const VERSOES_ACEITAS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface PedidoRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function normalizar(resultado: ConteudoMcp[] | string | object): ConteudoMcp[] {
  if (typeof resultado === 'string') return [{ type: 'text', text: resultado }];
  if (Array.isArray(resultado)) return resultado as ConteudoMcp[];
  return [{ type: 'text', text: JSON.stringify(resultado, null, 2) }];
}

async function atender(pedido: PedidoRpc): Promise<object | null> {
  const id = pedido.id ?? null;
  const ehNotificacao = pedido.id === undefined;
  const metodo = pedido.method ?? '';

  if (metodo === 'initialize') {
    const pedida = String(pedido.params?.protocolVersion ?? '');
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: VERSOES_ACEITAS.includes(pedida) ? pedida : VERSOES_ACEITAS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'restaura', version: '1.0.0' },
        instructions:
          'Ferramentas do Restaura para a equipe de agentes de reconstrução de imagem. Comece por aguardar_trabalho.',
      },
    };
  }
  if (ehNotificacao) return null; // notifications/initialized e afins
  if (metodo === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (metodo === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [...FERRAMENTAS.values()].map((f) => ({
          name: f.nome,
          description: f.descricao,
          inputSchema: f.esquema,
        })),
      },
    };
  }
  if (metodo === 'tools/call') {
    const nome = String(pedido.params?.name ?? '');
    const ferramenta = FERRAMENTAS.get(nome);
    if (!ferramenta) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Ferramenta desconhecida: ${nome}` } };
    }
    const args = (pedido.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const resultado = await ferramenta.executar(args);
      return { jsonrpc: '2.0', id, result: { content: normalizar(resultado), isError: false } };
    } catch (e) {
      // Erro da ferramenta volta como resultado com isError, para o agente ler e se corrigir.
      const mensagem = e instanceof Error ? e.message : 'Erro inesperado';
      if (!(e instanceof HttpError)) console.error(`Erro na ferramenta MCP ${nome}:`, e);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Erro: ${mensagem}` }], isError: true },
      };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Método não suportado: ${metodo}` } };
}

// Trata POST /mcp (um pedido ou um lote).
export async function tratarMcp(req: Request, res: Response): Promise<void> {
  const corpo = req.body as PedidoRpc | PedidoRpc[];
  if (Array.isArray(corpo)) {
    const respostas = (await Promise.all(corpo.map(atender))).filter((r) => r !== null);
    if (respostas.length === 0) res.status(202).end();
    else res.json(respostas);
    return;
  }
  if (!corpo || typeof corpo !== 'object') {
    res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } });
    return;
  }
  const resposta = await atender(corpo);
  if (resposta === null) res.status(202).end();
  else res.json(resposta);
}
