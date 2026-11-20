import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { projetoDoUsuario } from '../../lib/acesso';
import { lerArquivo } from '../../lib/arquivos';
import { resumoDaCena } from '../../lib/cena';
import { criarTrabalho } from '../agentes/servico';
import { cenaDoProjeto } from './servico';

// Mapa 3D da foto (docs/CENA.md, "Rotas novas"). Dono: g02.
const router = Router();

const refazerSchema = z.object({
  instrucoes: z.string().max(1000).optional(),
});

// Há trabalho CENA na fila ou em andamento?
async function refazendoCena(projetoId: number): Promise<boolean> {
  const ativos = await prisma.trabalho.count({
    where: { projetoId, tipo: 'CENA', status: { in: ['FILA', 'EM_ANDAMENTO'] } },
  });
  return ativos > 0;
}

router.get(
  '/projetos/:id/cena',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const cena = await cenaDoProjeto(id);
    res.json({
      cena,
      resumo: cena ? resumoDaCena(cena.resolvida) : null,
      refazendo: await refazendoCena(id),
    });
  })
);

router.get(
  '/projetos/:id/cena/glb',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const cena = await cenaDoProjeto(id);
    if (!cena?.blender) throw new HttpError(404, 'O mapa 3D ainda não tem o arquivo .glb (Blender não rodou)');
    const glb = await lerArquivo(cena.blender.glbArquivo);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', `attachment; filename="cena-${id}.glb"`);
    res.send(glb);
  })
);

router.post(
  '/projetos/:id/cena/refazer',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const { instrucoes } = validar(refazerSchema, req.body ?? {});
    if (await refazendoCena(id)) throw new HttpError(409, 'O mapa 3D já está sendo refeito');
    await criarTrabalho(id, 'CENA', { instrucoes: instrucoes ?? '' });
    res.status(201).json({ ok: true });
  })
);

export default router;
