import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { gerarToken } from '../../lib/auth';

export const publico = Router();
const router = Router();

// Limite de tentativas de login: 10 falhas em 10 minutos por IP + e-mail.
const JANELA_MS = 10 * 60 * 1000;
const FALHAS_LIMITE = 10;
const falhasLogin = new Map<string, number[]>();

function falhasRecentes(chave: string, agora: number): number[] {
  return (falhasLogin.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
}

function paraResposta(u: { id: number; nome: string; email: string; perfil: string }) {
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil };
}

publico.get('/saude', (_req, res) => {
  res.json({ ok: true });
});

const loginSchema = z.object({ email: z.string().min(1), senha: z.string().min(1) });

publico.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, senha } = validar(loginSchema, req.body);
    const chave = (req.ip ?? '') + '|' + email.toLowerCase();
    const agora = Date.now();
    const recentes = falhasRecentes(chave, agora);
    if (recentes.length >= FALHAS_LIMITE) {
      throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    }
    const usuario = await prisma.usuario.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
    });
    const confere = usuario && usuario.ativo ? await bcrypt.compare(senha, usuario.senhaHash) : false;
    if (!usuario || !confere) {
      if (falhasLogin.size > 5000) falhasLogin.clear();
      falhasLogin.set(chave, [...recentes, agora]);
      throw new HttpError(401, 'E-mail ou senha inválidos');
    }
    falhasLogin.delete(chave);
    res.json({ token: gerarToken({ id: usuario.id, perfil: usuario.perfil }), usuario: paraResposta(usuario) });
  })
);

router.post('/auth/sair', (_req, res) => {
  res.status(204).end();
});

router.get(
  '/auth/eu',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario || !usuario.ativo) throw new HttpError(401, 'Não autenticado');
    res.json(paraResposta(usuario));
  })
);

const perfilSchema = z.object({ nome: z.string().trim().min(2).max(120) });

router.put(
  '/auth/perfil',
  asyncHandler(async (req, res) => {
    const { nome } = validar(perfilSchema, req.body);
    const usuario = await prisma.usuario.update({ where: { id: req.usuario.id }, data: { nome } });
    res.json(paraResposta(usuario));
  })
);

const senhaSchema = z.object({ atual: z.string().min(1), nova: z.string().min(8).max(200) });

router.put(
  '/auth/senha',
  asyncHandler(async (req, res) => {
    const { atual, nova } = validar(senhaSchema, req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) throw new HttpError(401, 'Não autenticado');
    if (!(await bcrypt.compare(atual, usuario.senhaHash))) throw new HttpError(400, 'Senha atual incorreta');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
    res.status(204).end();
  })
);

export default router;
