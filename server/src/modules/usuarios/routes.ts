import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';

const router = Router();

const MSG_PROPRIO_ACESSO = 'Você não pode remover o próprio acesso de administrador';
const MSG_ULTIMO_ADMIN = 'Precisa existir ao menos um administrador ativo';

// Resposta de usuário: nunca inclui senhaHash.
function paraResposta(u: {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  ativo: boolean;
  criadoEm: Date;
}) {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo, criadoEm: u.criadoEm };
}

// Quantos administradores ativos existem, sem contar o usuário `excetoId`.
function contarOutrosAdminsAtivos(excetoId: number): Promise<number> {
  return prisma.usuario.count({ where: { perfil: 'ADMIN', ativo: true, id: { not: excetoId } } });
}

const emailSchema = z.string().trim().email('E-mail inválido').transform((v) => v.toLowerCase());

const criarSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: emailSchema,
  senha: z.string().min(8).max(200),
  perfil: z.enum(['ADMIN', 'USUARIO']),
});

const editarSchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  perfil: z.enum(['ADMIN', 'USUARIO']).optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(8).max(200).optional(),
});

router.get(
  '/usuarios',
  permitir('ADMIN'),
  asyncHandler(async (_req, res) => {
    const lista = await prisma.usuario.findMany({ orderBy: { nome: 'asc' } });
    res.json(lista.map((u) => paraResposta(u)));
  })
);

router.post(
  '/usuarios',
  permitir('ADMIN'),
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const criado = await prisma.usuario.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        senhaHash: await bcrypt.hash(dados.senha, 10),
        perfil: dados.perfil,
      },
    });
    res.status(201).json(paraResposta(criado));
  })
);

router.put(
  '/usuarios/:id',
  permitir('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(editarSchema, req.body);
    const alvo = await prisma.usuario.findUnique({ where: { id } });
    if (!alvo) throw new HttpError(404, 'Usuário não encontrado');

    const novoPerfil = dados.perfil ?? alvo.perfil;
    const novoAtivo = dados.ativo ?? alvo.ativo;

    // Não pode desativar a si mesmo nem tirar o próprio perfil ADMIN.
    if (id === req.usuario.id && (!novoAtivo || novoPerfil !== 'ADMIN')) {
      throw new HttpError(400, MSG_PROPRIO_ACESSO);
    }

    // Não pode deixar o sistema sem nenhum ADMIN ativo.
    const eraAdminAtivo = alvo.perfil === 'ADMIN' && alvo.ativo;
    const continuaAdminAtivo = novoPerfil === 'ADMIN' && novoAtivo;
    if (eraAdminAtivo && !continuaAdminAtivo && (await contarOutrosAdminsAtivos(id)) === 0) {
      throw new HttpError(400, MSG_ULTIMO_ADMIN);
    }

    const data: Prisma.UsuarioUpdateInput = {};
    if (dados.nome !== undefined) data.nome = dados.nome;
    if (dados.email !== undefined) data.email = dados.email;
    if (dados.perfil !== undefined) data.perfil = dados.perfil;
    if (dados.ativo !== undefined) data.ativo = dados.ativo;
    if (dados.senha !== undefined) data.senhaHash = await bcrypt.hash(dados.senha, 10);

    const atualizado = await prisma.usuario.update({ where: { id }, data });
    res.json(paraResposta(atualizado));
  })
);

router.delete(
  '/usuarios/:id',
  permitir('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    if (id === req.usuario.id) throw new HttpError(400, 'Você não pode excluir a própria conta');
    const alvo = await prisma.usuario.findUnique({ where: { id } });
    if (!alvo) throw new HttpError(404, 'Usuário não encontrado');
    if (alvo.perfil === 'ADMIN' && alvo.ativo && (await contarOutrosAdminsAtivos(id)) === 0) {
      throw new HttpError(400, MSG_ULTIMO_ADMIN);
    }
    await prisma.usuario.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
