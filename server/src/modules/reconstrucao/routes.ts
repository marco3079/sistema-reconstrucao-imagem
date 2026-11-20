import { Router } from 'express';
import type { Opcao } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { detalheDoProjeto, opcaoDoUsuario, projetoDoUsuario, regiaoDoUsuario } from '../../lib/acesso';
import { apagarArquivo } from '../../lib/arquivos';
import { canvaConectado } from '../../lib/canva';
import {
  FILTROS_LOCAIS,
  aplicarMelhores,
  escolherOpcao,
  falharOpcoesPresas,
  gerarOpcaoCanva,
  gerarOpcoesLocais,
  promptPadrao,
} from './servico';

const router = Router();

// Ao carregar o módulo, opções que ficaram em GERANDO (servidor reiniciado) viram FALHOU.
falharOpcoesPresas().catch(() => undefined);

const LETRAS_CANVA = ['A', 'B', 'C', 'D'];

const locaisSchema = z.object({
  filtros: z.array(z.string()).max(7).optional(),
  intensidade: z.number().int().min(1).max(3).optional(),
});

const canvaSchema = z.object({
  instrucoes: z.string().max(2000).optional(),
  quantidade: z.number().int().min(1).max(4).optional(),
  usarReferencias: z.boolean().optional(),
});

const aplicarMelhoresSchema = z.object({
  notaMinima: z.number().min(0).max(10).optional(),
});

// Próxima rodada de opções de uma região: 1 + a maior rodada existente (ou 1).
async function proximaRodada(regiaoId: number): Promise<number> {
  const ultima = await prisma.opcao.findFirst({ where: { regiaoId }, orderBy: { rodada: 'desc' } });
  return (ultima?.rodada ?? 0) + 1;
}

router.get('/reconstrucao/filtros', (_req, res) => {
  res.json(FILTROS_LOCAIS);
});

router.get(
  '/projetos/:id/opcoes',
  asyncHandler(async (req, res) => {
    const projeto = await projetoDoUsuario(req.usuario.id, idParam(req));
    const opcoes = await prisma.opcao.findMany({
      where: { projetoId: projeto.id },
      include: { revisoes: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' },
    });
    res.json(opcoes);
  })
);

router.get(
  '/regioes/:id/opcoes',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const opcoes = await prisma.opcao.findMany({
      where: { regiaoId: regiao.id },
      include: { revisoes: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' },
    });
    res.json(opcoes);
  })
);

router.post(
  '/regioes/:id/opcoes/locais',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const { filtros, intensidade } = validar(locaisSchema, req.body ?? {});
    const rodada = await proximaRodada(regiao.id);
    const criadas = await gerarOpcoesLocais(regiao.id, filtros, intensidade, rodada);
    res.status(201).json(criadas.map((opcao) => ({ ...opcao, revisoes: [] })));
  })
);

router.post(
  '/regioes/:id/opcoes/canva',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const { instrucoes, quantidade = 4, usarReferencias = true } = validar(canvaSchema, req.body ?? {});
    if (!(await canvaConectado(req.usuario.id))) {
      throw new HttpError(409, 'Canva não conectado. Conecte em Configurações.');
    }
    const prompt = promptPadrao(regiao.projeto, regiao, instrucoes);
    const rodada = await proximaRodada(regiao.id);
    const criadas: Opcao[] = [];
    for (let k = 0; k < quantidade; k++) {
      criadas.push(
        await gerarOpcaoCanva(regiao.id, {
          prompt,
          usarReferencias,
          rodada,
          rotulo: `Canva ${LETRAS_CANVA[k] ?? k + 1}`,
        })
      );
    }
    res.status(201).json(criadas.map((opcao) => ({ ...opcao, revisoes: [] })));
  })
);

router.post(
  '/projetos/:id/opcoes/aplicar-melhores',
  asyncHandler(async (req, res) => {
    const projeto = await projetoDoUsuario(req.usuario.id, idParam(req));
    const { notaMinima = 8 } = validar(aplicarMelhoresSchema, req.body ?? {});
    const { aplicadas, conjecturas } = await aplicarMelhores(projeto.id, notaMinima);
    res.json({ aplicadas, conjecturas, projeto: await detalheDoProjeto(projeto.id) });
  })
);

router.post(
  '/opcoes/:id/escolher',
  asyncHandler(async (req, res) => {
    const opcao = await opcaoDoUsuario(req.usuario.id, idParam(req));
    await escolherOpcao(opcao.id);
    res.json(await detalheDoProjeto(opcao.projetoId));
  })
);

router.delete(
  '/opcoes/:id',
  asyncHandler(async (req, res) => {
    const opcao = await opcaoDoUsuario(req.usuario.id, idParam(req));
    if (opcao.status === 'ESCOLHIDA') throw new HttpError(409, 'Não é possível apagar a opção escolhida');
    await apagarArquivo(opcao.arquivo);
    await prisma.opcao.delete({ where: { id: opcao.id } });
    res.status(204).end();
  })
);

export default router;
