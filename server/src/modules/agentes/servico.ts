import type { Trabalho } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// Fila de trabalhos e linha do tempo da equipe de agentes.
// Os agentes rodam numa sessão do Claude Code ligada ao servidor MCP (POST /mcp).

export type TipoTrabalho = 'ANALISE' | 'REFERENCIAS' | 'PLANO' | 'REGIAO' | 'INSPECAO' | 'CENA';
export type NomeAgente =
  | 'maestro'
  | 'analista'
  | 'cartografo'
  | 'conservador'
  | 'restaurador'
  | 'gerador-canva'
  | 'revisor'
  | 'inspetor'
  | 'cenografo'
  | 'sistema';
export type TipoEvento = 'status' | 'acao' | 'nota' | 'revisao' | 'erro';

export const AGENTES: NomeAgente[] = [
  'maestro',
  'analista',
  'cartografo',
  'conservador',
  'restaurador',
  'gerador-canva',
  'revisor',
  'inspetor',
  'cenografo',
  'sistema',
];
export const TIPOS_EVENTO: TipoEvento[] = ['status', 'acao', 'nota', 'revisao', 'erro'];

const ROTULO_TRABALHO: Record<TipoTrabalho, string> = {
  ANALISE: 'Analisar a imagem',
  REFERENCIAS: 'Rever o mapa de referências',
  PLANO: 'Planejar e tratar as partes',
  REGIAO: 'Reconstruir uma região',
  INSPECAO: 'Inspeção final da imagem',
  CENA: 'Refazer o mapa 3D da foto',
};

export async function registrarEvento(
  projetoId: number,
  agente: NomeAgente,
  tipo: TipoEvento,
  texto: string,
  trabalhoId?: number | null
): Promise<void> {
  await prisma.evento.create({
    data: { projetoId, agente, tipo, texto: texto.slice(0, 4000), trabalhoId: trabalhoId ?? null },
  });
}

// Põe um trabalho na fila. Se já houver um igual esperando (mesmo projeto, tipo e região), devolve o que existe.
export async function criarTrabalho(
  projetoId: number,
  tipo: TipoTrabalho,
  opcoes: { regiaoId?: number | null; instrucoes?: string } = {}
): Promise<Trabalho> {
  const regiaoId = opcoes.regiaoId ?? null;
  const existente = await prisma.trabalho.findFirst({ where: { projetoId, tipo, regiaoId, status: 'FILA' } });
  if (existente) {
    if (opcoes.instrucoes && opcoes.instrucoes !== existente.instrucoes) {
      return prisma.trabalho.update({ where: { id: existente.id }, data: { instrucoes: opcoes.instrucoes } });
    }
    return existente;
  }
  const trabalho = await prisma.trabalho.create({
    data: { projetoId, tipo, regiaoId, instrucoes: opcoes.instrucoes ?? '' },
  });
  await registrarEvento(projetoId, 'sistema', 'status', `Trabalho na fila: ${ROTULO_TRABALHO[tipo]}.`, trabalho.id);
  acordarEspera();
  return trabalho;
}

// ---------- Presença da sessão do Claude Code e espera longa ----------

// A sessão do Claude Code se liga a UM projeto de restauração (/restaurar <id>): a presença é por projeto.
let ultimoContato: Date | null = null;
const contatoPorProjeto = new Map<number, Date>();
const esperando = new Set<() => void>();
// Janela larga de propósito: entre duas chamadas de ferramenta a sessão pode passar minutos pensando,
// esperando um subagente ou uma geração do Canva. Com 90 s a tela mostrava "desconectado" o tempo todo.
const JANELA_DE_PRESENCA_MS = 4 * 60_000;
// Com trabalho em andamento no projeto, a sessão conta como ligada por mais tempo sem contato.
const JANELA_COM_TRABALHO_MS = 15 * 60_000;
const emAndamentoPorProjeto = new Map<number, number>(); // projetoId -> trabalhos EM_ANDAMENTO (contagem em memória)

// Sem projetoId marca só a presença geral (qualquer ferramenta chamada); com projetoId, também a do projeto.
export function marcarContato(projetoId?: number): void {
  ultimoContato = new Date();
  if (projetoId !== undefined) contatoPorProjeto.set(projetoId, ultimoContato);
}

function recente(data: Date | null | undefined, janelaMs = JANELA_DE_PRESENCA_MS): boolean {
  return data !== null && data !== undefined && Date.now() - data.getTime() < janelaMs;
}

function janelaDoProjeto(projetoId: number): number {
  return (emAndamentoPorProjeto.get(projetoId) ?? 0) > 0 ? JANELA_COM_TRABALHO_MS : JANELA_DE_PRESENCA_MS;
}

// Mantém a presença do projeto viva durante uma espera longa (geração no Canva, espera de opção).
// Devolve a função que encerra a marcação. Use sempre com try/finally.
export function manterContato(projetoId: number): () => void {
  marcarContato(projetoId);
  const relogio = setInterval(() => marcarContato(projetoId), 20_000);
  relogio.unref();
  return () => clearInterval(relogio);
}

function acordarEspera(): void {
  for (const acordar of esperando) acordar();
  esperando.clear();
}

// Pega o trabalho mais antigo da fila e marca como EM_ANDAMENTO. null se a fila estiver vazia.
async function pegarDaFila(projetoId?: number): Promise<Trabalho | null> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    // Com projetoId, só os trabalhos daquele projeto.
    const proximo = await prisma.trabalho.findFirst({
      where: { status: 'FILA', ...(projetoId !== undefined ? { projetoId } : {}) },
      orderBy: { id: 'asc' },
    });
    if (!proximo) return null;
    const mudou = await prisma.trabalho.updateMany({
      where: { id: proximo.id, status: 'FILA' },
      data: { status: 'EM_ANDAMENTO', iniciadoEm: new Date() },
    });
    if (mudou.count === 1) {
      emAndamentoPorProjeto.set(proximo.projetoId, (emAndamentoPorProjeto.get(proximo.projetoId) ?? 0) + 1);
      await registrarEvento(proximo.projetoId, 'maestro', 'status', `Trabalho iniciado: ${ROTULO_TRABALHO[proximo.tipo as TipoTrabalho]}.`, proximo.id);
      return { ...proximo, status: 'EM_ANDAMENTO', iniciadoEm: new Date() };
    }
  }
  return null;
}

// Espera até `esperaSegundos` (máximo 100) por um trabalho. Devolve null se nada chegar.
export async function aguardarTrabalho(esperaSegundos: number, projetoId?: number): Promise<Trabalho | null> {
  // Teto de 100 s: o Claude Code passa para segundo plano toda chamada de ferramenta que dura mais de 2 minutos,
  // e aí o laço da sessão se perde. Abaixo disso, quanto mais longa a espera, menos voltas do laço.
  const limite = Date.now() + Math.min(Math.max(esperaSegundos, 0), 100) * 1000;
  for (;;) {
    marcarContato(projetoId);
    const trabalho = await pegarDaFila(projetoId);
    if (trabalho) return trabalho;
    const resta = limite - Date.now();
    if (resta <= 0) return null;
    await new Promise<void>((resolver) => {
      const acordar = () => {
        clearTimeout(relogio);
        esperando.delete(acordar);
        resolver();
      };
      // Reconfere a cada 5 s mesmo sem aviso (trabalhos criados por outro processo).
      const relogio = setTimeout(acordar, Math.min(resta, 5000));
      esperando.add(acordar);
    });
  }
}

export async function concluirTrabalho(trabalhoId: number, resumo: string, falhou: boolean): Promise<Trabalho> {
  marcarContato();
  const anterior = await prisma.trabalho.findUnique({ where: { id: trabalhoId } });
  // Trabalho cancelado (o usuário reiniciou o processo) não volta a concluído.
  if (anterior?.status === 'CANCELADO') return anterior;
  if (anterior?.status === 'EM_ANDAMENTO') {
    const resto = (emAndamentoPorProjeto.get(anterior.projetoId) ?? 1) - 1;
    if (resto > 0) emAndamentoPorProjeto.set(anterior.projetoId, resto);
    else emAndamentoPorProjeto.delete(anterior.projetoId);
  }
  const trabalho = await prisma.trabalho.update({
    where: { id: trabalhoId },
    data: { status: falhou ? 'FALHOU' : 'CONCLUIDO', resumo: resumo.slice(0, 4000), concluidoEm: new Date() },
  });
  await registrarEvento(
    trabalho.projetoId,
    'maestro',
    falhou ? 'erro' : 'status',
    `${falhou ? 'Trabalho falhou' : 'Trabalho concluído'}: ${resumo}`.slice(0, 4000),
    trabalho.id
  );
  return trabalho;
}

// Cancela todos os trabalhos do projeto que estão na fila ou em andamento (reinício pedido pelo usuário).
export async function cancelarTrabalhosDoProjeto(projetoId: number): Promise<number> {
  const mudou = await prisma.trabalho.updateMany({
    where: { projetoId, status: { in: ['FILA', 'EM_ANDAMENTO'] } },
    data: { status: 'CANCELADO', concluidoEm: new Date() },
  });
  emAndamentoPorProjeto.delete(projetoId);
  return mudou.count;
}

// O trabalho ainda está valendo? (false se foi cancelado, concluído ou não existe)
export async function trabalhoAtivo(trabalhoId: number): Promise<boolean> {
  const t = await prisma.trabalho.findUnique({ where: { id: trabalhoId }, select: { status: true } });
  return t?.status === 'EM_ANDAMENTO';
}

// Trabalhos parados há mais de 30 minutos em andamento voltam para a fila (sessão fechada no meio).
export async function devolverTrabalhosParados(): Promise<void> {
  const corte = new Date(Date.now() - 30 * 60 * 1000);
  const parados = await prisma.trabalho.findMany({
    where: { status: 'EM_ANDAMENTO', iniciadoEm: { lt: corte } },
    select: { id: true, projetoId: true },
  });
  // Trabalho longo com a sessão do projeto ainda em contato não é devolvido.
  const ids = parados.filter((t) => !recente(contatoPorProjeto.get(t.projetoId))).map((t) => t.id);
  if (ids.length === 0) return;
  for (const t of parados) if (ids.includes(t.id)) emAndamentoPorProjeto.delete(t.projetoId);
  await prisma.trabalho.updateMany({
    where: { id: { in: ids }, status: 'EM_ANDAMENTO' },
    data: { status: 'FILA', iniciadoEm: null },
  });
}

// Há sessão do Claude Code em contato com este projeto agora? Leitura em memória, sem banco.
export function sessaoConectada(projetoId: number): boolean {
  return recente(contatoPorProjeto.get(projetoId), janelaDoProjeto(projetoId));
}

// Sem projetoId: visão geral (alguma sessão em contato). Com projetoId: a sessão ligada àquele projeto e a fila dele.
export async function statusAgentes(projetoId?: number): Promise<{
  conectado: boolean;
  ultimoContato: string | null;
  naFila: number;
  emAndamento: number;
}> {
  const filtro = projetoId !== undefined ? { projetoId } : {};
  const [naFila, emAndamento] = await Promise.all([
    prisma.trabalho.count({ where: { status: 'FILA', ...filtro } }),
    prisma.trabalho.count({ where: { status: 'EM_ANDAMENTO', ...filtro } }),
  ]);
  const contato = projetoId !== undefined ? (contatoPorProjeto.get(projetoId) ?? null) : ultimoContato;
  return {
    conectado: projetoId !== undefined ? sessaoConectada(projetoId) : recente(contato),
    ultimoContato: contato ? contato.toISOString() : null,
    naFila,
    emAndamento,
  };
}
