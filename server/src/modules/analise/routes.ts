import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, idParam, validar } from '../../lib/erros';
import { detalheDoProjeto, projetoDoUsuario, recalcularStatusDoProjeto, regiaoDoUsuario } from '../../lib/acesso';
import { apagarArquivo } from '../../lib/arquivos';
import { PROBLEMAS } from '../../lib/analise-local';
import type { Problema } from '../../lib/analise-local';
import { criarTrabalho } from '../agentes/servico';
import { aplicarAnaliseLocal, criarRegiao } from './servico';

const router = Router();

const categoriaSchema = z.enum(['ROSTO', 'CORPO', 'ROUPA', 'OBJETO', 'TEXTO', 'FUNDO', 'COR', 'OUTRO']);

const analisarSchema =z.object({ instrucoes: z.string().max(2000).optional() });

router.post(
  '/projetos/:id/analisar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const { instrucoes } = validar(analisarSchema, req.body ?? {});
    await aplicarAnaliseLocal(id);
    await criarTrabalho(id, 'ANALISE', { instrucoes });
    res.json(await detalheDoProjeto(id));
  })
);

router.post(
  '/projetos/:id/regioes',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const regiaoId = await criarRegiao(id, req.body ?? {}, 'MANUAL');
    // Parte marcada à mão pode vir com "o que é" (categoria); inválida ou ausente fica OUTRO.
    const categoria = categoriaSchema.safeParse((req.body ?? {}).categoria);
    const regiao = categoria.success
      ? await prisma.regiao.update({ where: { id: regiaoId }, data: { categoria: categoria.data } })
      : await prisma.regiao.findUnique({ where: { id: regiaoId } });
    res.status(201).json(regiao);
  })
);

const regiaoSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  x: z.number().min(0).lt(1).optional(),
  y: z.number().min(0).lt(1).optional(),
  largura: z.number().gt(0).max(1).optional(),
  altura: z.number().gt(0).max(1).optional(),
  // 'NENHUM' vale para partes da grade sem defeito.
  problema: z.enum(['NENHUM', ...PROBLEMAS] as [Problema, ...Problema[]]).optional(),
  gravidade: z.number().int().min(1).max(5).optional(),
  descricao: z.string().max(1000).optional(),
  status: z.enum(['PENDENTE', 'EM_ANDAMENTO', 'RESOLVIDA', 'IGNORADA']).optional(),
  categoria: categoriaSchema.optional(),
  selecionada: z.boolean().optional(),
});

router.put(
  '/regioes/:id',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const dados = validar(regiaoSchema, req.body ?? {});
    // Mesmo ajuste de criarRegiao: o retângulo não pode sair da imagem.
    const x = dados.x ?? regiao.x;
    const y = dados.y ?? regiao.y;
    const largura = Math.min(dados.largura ?? regiao.largura, 1 - x);
    const altura = Math.min(dados.altura ?? regiao.altura, 1 - y);
    // Problema novo sem escolha explícita: a parte passa a ser reconstruída se tem defeito, e sai se não tem.
    const mudouProblema = dados.problema !== undefined && dados.problema !== regiao.problema;
    const selecionada =
      dados.selecionada ?? (mudouProblema ? dados.problema !== 'NENHUM' : regiao.selecionada);
    const atualizada = await prisma.regiao.update({
      where: { id: regiao.id },
      data: { ...dados, x, y, largura, altura, selecionada },
    });
    await recalcularStatusDoProjeto(regiao.projetoId);
    res.json(atualizada);
  })
);

router.delete(
  '/regioes/:id',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const opcoes = await prisma.opcao.findMany({ where: { regiaoId: regiao.id }, select: { arquivo: true } });
    for (const opcao of opcoes) await apagarArquivo(opcao.arquivo);
    await prisma.regiao.delete({ where: { id: regiao.id } });
    await recalcularStatusDoProjeto(regiao.projetoId);
    res.status(204).end();
  })
);

export default router;
