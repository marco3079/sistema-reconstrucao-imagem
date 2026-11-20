import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir, tokenDosAgentes } from '../../lib/auth';
import { projetoDoUsuario } from '../../lib/acesso';
import { criarTrabalho, devolverTrabalhosParados, statusAgentes } from './servico';

const router = Router();

// Trabalhos parados em andamento voltam para a fila: na carga e a cada 5 minutos.
devolverTrabalhosParados().catch(() => undefined);
setInterval(() => {
  devolverTrabalhosParados().catch(() => undefined);
}, 5 * 60 * 1000).unref();

// Estado da equipe: sem projeto, da conta toda; com projeto, só daquele projeto do usuário.
router.get(
  '/agentes/status',
  asyncHandler(async (req, res) => {
    const projetoId = projetoDaQuery(req.query.projeto);
    if (projetoId !== undefined) await projetoDoUsuario(req.usuario.id, projetoId);
    res.json(await statusAgentes(projetoId));
  })
);

// Estado da equipe, trabalhos ativos e recentes, eventos novos e escolhas pendentes, só dos projetos do usuário.
router.get(
  '/agentes/fluxo',
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario.id;
    const depois = depoisDaQuery(req.query.depois);
    const projetoId = projetoDaQuery(req.query.projeto);
    if (projetoId !== undefined) await projetoDoUsuario(usuarioId, projetoId);
    const filtroProjeto = projetoId !== undefined ? { projetoId } : {};
    const [status, ativos, concluidos, eventosBrutos, aguardandoEscolha, mapasAguardando] = await Promise.all([
      statusAgentes(projetoId),
      prisma.trabalho.findMany({
        where: { status: { in: ['FILA', 'EM_ANDAMENTO'] }, projeto: { usuarioId }, ...filtroProjeto },
        include: { projeto: { select: { nome: true } } },
        orderBy: { id: 'asc' },
        take: 50,
      }),
      prisma.trabalho.findMany({
        where: { status: { in: ['CONCLUIDO', 'FALHOU', 'CANCELADO'] }, projeto: { usuarioId }, ...filtroProjeto },
        include: { projeto: { select: { nome: true } } },
        orderBy: { id: 'desc' },
        take: 10,
      }),
      depois > 0
        ? prisma.evento.findMany({
            where: { id: { gt: depois }, projeto: { usuarioId }, ...filtroProjeto },
            include: { projeto: { select: { nome: true } } },
            orderBy: { id: 'asc' },
            take: 200,
          })
        : prisma.evento.findMany({
            where: { projeto: { usuarioId }, ...filtroProjeto },
            include: { projeto: { select: { nome: true } } },
            orderBy: { id: 'desc' },
            take: 60,
          }),
      prisma.opcao.count({
        where: {
          status: 'PRONTA',
          nota: { not: null },
          regiao: { status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
          projeto: { usuarioId },
          ...filtroProjeto,
        },
      }),
      projetoId !== undefined
        ? prisma.projeto.count({ where: { id: projetoId, usuarioId, mapaStatus: 'AGUARDANDO' } })
        : prisma.projeto.count({ where: { usuarioId, mapaStatus: 'AGUARDANDO' } }),
    ]);

    // Trabalho não tem relação Prisma com Regiao: os nomes vêm de uma consulta à parte.
    const trabalhosOrdenados = [...ativos, ...concluidos].sort((a, b) => a.id - b.id);
    const idsRegioes = trabalhosOrdenados
      .map((t) => t.regiaoId)
      .filter((id): id is number => id !== null);
    const regioes =
      idsRegioes.length > 0
        ? await prisma.regiao.findMany({
            where: { id: { in: idsRegioes } },
            select: { id: true, nome: true },
          })
        : [];
    const nomesRegioes = new Map(regioes.map((r) => [r.id, r.nome]));

    const trabalhos = trabalhosOrdenados.map(({ projeto, ...t }) => ({
      ...t,
      projetoNome: projeto.nome,
      regiaoNome: t.regiaoId === null ? null : (nomesRegioes.get(t.regiaoId) ?? null),
    }));

    // Sem depois: busca os 60 mais recentes em ordem desc; devolve em ordem crescente.
    const eventosOrdenados = depois > 0 ? eventosBrutos : [...eventosBrutos].reverse();
    const eventos = eventosOrdenados.map(({ projeto, ...e }) => ({
      ...e,
      projetoNome: projeto.nome,
    }));

    res.json({ status, trabalhos, eventos, aguardandoEscolha, mapasAguardando });
  })
);

router.get(
  '/agentes/conexao',
  permitir('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json({
      url: process.env.URL_MCP ?? 'http://localhost:3095/mcp',
      token: tokenDosAgentes(),
    });
  })
);

// Inteiro >= 0 vindo da query; inválido vira 0.
function depoisDaQuery(valor: unknown): number {
  if (typeof valor !== 'string') return 0;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

// Projeto da query: ausente vira undefined; fora isso, precisa ser inteiro > 0 (senão 400).
function projetoDaQuery(valor: unknown): number | undefined {
  if (valor === undefined) return undefined;
  const n = typeof valor === 'string' ? Number(valor) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Projeto inválido');
  return n;
}

router.get(
  '/projetos/:id/atividade',
  asyncHandler(async (req, res) => {
    const projetoId = idParam(req);
    await projetoDoUsuario(req.usuario.id, projetoId);
    const depois = depoisDaQuery(req.query.depois);
    const [trabalhos, eventos] = await Promise.all([
      prisma.trabalho.findMany({
        where: { projetoId },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      // Sem "depois": os 200 eventos MAIS RECENTES (num histórico longo, os primeiros 200 esconderiam os passos atuais).
      depois > 0
        ? prisma.evento.findMany({ where: { projetoId, id: { gt: depois } }, orderBy: { id: 'asc' }, take: 200 })
        : prisma.evento
            .findMany({ where: { projetoId }, orderBy: { id: 'desc' }, take: 200 })
            .then((lista) => lista.reverse()),
    ]);
    res.json({ trabalhos, eventos });
  })
);

const criarTrabalhoSchema = z.object({
  tipo: z.enum(['ANALISE', 'REFERENCIAS', 'PLANO', 'REGIAO', 'INSPECAO', 'CENA']),
  regiaoId: z.number().int().optional(),
  instrucoes: z.string().max(2000).optional(),
});

router.post(
  '/projetos/:id/trabalhos',
  asyncHandler(async (req, res) => {
    const projetoId = idParam(req);
    await projetoDoUsuario(req.usuario.id, projetoId);
    const dados = validar(criarTrabalhoSchema, req.body);
    if (dados.tipo === 'REGIAO' && dados.regiaoId === undefined) {
      throw new HttpError(400, 'Informe uma região do projeto');
    }
    if (dados.regiaoId !== undefined) {
      const regiao = await prisma.regiao.findFirst({ where: { id: dados.regiaoId, projetoId } });
      if (!regiao) throw new HttpError(400, 'Informe uma região do projeto');
    }
    // Só trabalho do tipo REGIAO leva região; nos outros tipos grava null.
    const trabalho = await criarTrabalho(projetoId, dados.tipo, {
      regiaoId: dados.tipo === 'REGIAO' ? dados.regiaoId : null,
      instrucoes: dados.instrucoes,
    });
    res.status(201).json(trabalho);
  })
);

router.post(
  '/trabalhos/:id/cancelar',
  asyncHandler(async (req, res) => {
    const trabalhoId = idParam(req);
    const trabalho = await prisma.trabalho.findFirst({
      where: { id: trabalhoId, projeto: { usuarioId: req.usuario.id } },
    });
    if (!trabalho) throw new HttpError(404, 'Trabalho não encontrado');
    if (trabalho.status !== 'FILA') {
      throw new HttpError(409, 'Só é possível cancelar um trabalho que está na fila');
    }
    const atualizado = await prisma.trabalho.update({
      where: { id: trabalhoId },
      data: { status: 'CANCELADO', concluidoEm: new Date() },
    });
    res.json(atualizado);
  })
);

export default router;
