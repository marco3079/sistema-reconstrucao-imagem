import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { detalheDoProjeto, projetoDoUsuario, recalcularStatusDoProjeto } from '../../lib/acesso';
import { apagarArquivo } from '../../lib/arquivos';
import { cancelarTrabalhosDoProjeto, criarTrabalho, registrarEvento } from '../agentes/servico';
import { aplicarAnaliseLocal } from '../analise/servico';
import { apagarCena } from '../cena/servico';

// Reinício do processo a partir de um passo (ver docs/GRADE.md, seção Reinício). Dono: g05.
const router = Router();

const PASSOS = ['EXAME', 'MAPA', 'PLANO', 'TRATAMENTO', 'INSPECAO'] as const;
type Passo = (typeof PASSOS)[number];

const reinicioSchema = z.object({
  passo: z.enum(PASSOS),
  doZero: z.boolean().optional(),
});

const ROTULOS: Record<Passo, string> = {
  EXAME: 'exame da imagem',
  MAPA: 'mapa de referências',
  PLANO: 'plano de tratamento',
  TRATAMENTO: 'tratamento das partes',
  INSPECAO: 'inspeção final',
};

// Apaga do disco os arquivos órfãos: só os que nenhuma versão, projeto, referência ou opção ainda usa.
// Falha aqui não derruba a rota.
async function apagarOrfaos(candidatos: string[]): Promise<void> {
  for (const nome of new Set(candidatos)) {
    try {
      const usos = await Promise.all([
        prisma.versao.count({ where: { arquivo: nome } }),
        prisma.projeto.count({ where: { OR: [{ originalArquivo: nome }, { atualArquivo: nome }] } }),
        prisma.referencia.count({ where: { arquivo: nome } }),
        prisma.opcao.count({ where: { arquivo: nome } }),
      ]);
      if (usos.every((n) => n === 0)) await apagarArquivo(nome);
    } catch {
      // Arquivo que não pôde ser conferido ou apagado fica no disco.
    }
  }
}

router.post(
  '/projetos/:id/reiniciar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const projeto = await projetoDoUsuario(req.usuario.id, id);
    const { passo, doZero } = validar(reinicioSchema, req.body);

    if (doZero && passo !== 'EXAME') {
      throw new HttpError(400, 'Recomeçar do zero só vale a partir do exame');
    }

    // Pré-condições: conferidas antes de cancelar qualquer coisa.
    if (passo === 'PLANO' && projeto.mapaStatus !== 'APROVADO') {
      throw new HttpError(409, 'Aprove o mapa antes de reiniciar o plano');
    }
    if (passo === 'TRATAMENTO' && projeto.mapaStatus !== 'APROVADO') {
      throw new HttpError(409, 'Aprove o mapa antes de reiniciar o tratamento');
    }

    await cancelarTrabalhosDoProjeto(id);

    if (passo === 'EXAME') {
      if (doZero) {
        // Arquivos candidatos a órfãos, lidos antes da transação.
        const [opcoesComArquivo, referenciasCanva] = await Promise.all([
          prisma.opcao.findMany({ where: { projetoId: id }, select: { arquivo: true } }),
          prisma.referencia.findMany({ where: { projetoId: id, origem: 'CANVA' }, select: { arquivo: true } }),
        ]);
        const candidatos = [...opcoesComArquivo, ...referenciasCanva]
          .map((item) => item.arquivo)
          .filter((nome): nome is string => typeof nome === 'string' && nome.length > 0);

        await prisma.$transaction(async (tx) => {
          await tx.opcao.deleteMany({ where: { projetoId: id } });
          await tx.vinculo.deleteMany({ where: { regiao: { projetoId: id } } });
          await tx.pedidoReferencia.deleteMany({ where: { projetoId: id } });
          await tx.referencia.deleteMany({ where: { projetoId: id, origem: 'CANVA' } });
          // As referências importadas pelo usuário ficam, mas deixam de apontar para partes apagadas.
          await tx.referencia.updateMany({ where: { projetoId: id }, data: { regiaoId: null } });
          await tx.regiao.deleteMany({ where: { projetoId: id } });

          const ultima = await tx.versao.findFirst({ where: { projetoId: id }, orderBy: { numero: 'desc' } });
          await tx.versao.create({
            data: {
              projetoId: id,
              numero: (ultima?.numero ?? 0) + 1,
              arquivo: projeto.originalArquivo,
              descricao: 'Reinício do zero',
            },
          });

          // Zera a análise: senão aplicarAnaliseLocal preserva a análise antiga (comIA: true).
          await tx.projeto.update({
            where: { id },
            data: {
              atualArquivo: projeto.originalArquivo,
              analise: Prisma.DbNull,
              mapaStatus: 'RASCUNHO',
              mapaAprovadoEm: null,
              gradeLinhas: 0,
              gradeColunas: 0,
            },
          });
        });

        await apagarOrfaos(candidatos);
        // A cena (mapa 3D) é do projeto original: sai junto com o recomeço.
        await apagarCena(id);

        try {
          await aplicarAnaliseLocal(id);
        } catch (erro) {
          const motivo = erro instanceof Error ? erro.message : String(erro);
          await registrarEvento(id, 'sistema', 'erro', `Falha ao remontar a grade local: ${motivo}`);
        }

        await registrarEvento(id, 'sistema', 'status', 'Processo reiniciado a partir de: exame da imagem, do zero.');
        await criarTrabalho(id, 'ANALISE');
      } else {
        await prisma.projeto.update({
          where: { id },
          data: { mapaStatus: 'RASCUNHO', mapaAprovadoEm: null },
        });
        await registrarEvento(id, 'sistema', 'status', `Processo reiniciado a partir de: ${ROTULOS.EXAME}.`);
        await criarTrabalho(id, 'ANALISE');
      }
    } else if (passo === 'MAPA') {
      await prisma.projeto.update({
        where: { id },
        data: { mapaStatus: 'RASCUNHO', mapaAprovadoEm: null },
      });
      await registrarEvento(id, 'sistema', 'status', `Processo reiniciado a partir de: ${ROTULOS.MAPA}.`);
      await criarTrabalho(id, 'REFERENCIAS');
    } else if (passo === 'PLANO') {
      await prisma.regiao.updateMany({
        where: { projetoId: id, status: { not: 'RESOLVIDA' } },
        data: { plano: '' },
      });
      await registrarEvento(id, 'sistema', 'status', `Processo reiniciado a partir de: ${ROTULOS.PLANO}.`);
      await criarTrabalho(id, 'PLANO');
    } else if (passo === 'TRATAMENTO') {
      // As revisões das opções apagadas saem em cascata (Revisao.opcao onDelete: Cascade).
      await prisma.opcao.deleteMany({
        where: {
          projetoId: id,
          status: { not: 'ESCOLHIDA' },
          regiao: { status: { not: 'RESOLVIDA' } },
        },
      });
      await prisma.regiao.updateMany({
        where: { projetoId: id, status: 'EM_ANDAMENTO' },
        data: { status: 'PENDENTE' },
      });
      await registrarEvento(id, 'sistema', 'status', `Processo reiniciado a partir de: ${ROTULOS.TRATAMENTO}.`);
      await criarTrabalho(id, 'PLANO');
    } else {
      await registrarEvento(id, 'sistema', 'status', `Processo reiniciado a partir de: ${ROTULOS.INSPECAO}.`);
      await criarTrabalho(id, 'INSPECAO');
    }

    await recalcularStatusDoProjeto(id);
    res.json(await detalheDoProjeto(id));
  })
);

export default router;
