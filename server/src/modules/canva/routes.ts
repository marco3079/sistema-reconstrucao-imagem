import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { prisma } from '../../lib/prisma';
import {
  basePublica,
  canvaConectado,
  concluirConexao,
  desconectar,
  iniciarConexao,
} from '../../lib/canva';

export const publico = Router();
const router = Router();

router.get(
  '/canva/status',
  asyncHandler(async (req, res) => {
    const conectado = await canvaConectado(req.usuario.id);
    const conexao = await prisma.canvaConexao.findUnique({
      where: { usuarioId: req.usuario.id },
      select: { expiraEm: true },
    });
    res.json({ conectado, expiraEm: conexao ? conexao.expiraEm.toISOString() : null });
  })
);

router.post(
  '/canva/conectar',
  asyncHandler(async (req, res) => {
    const url = await iniciarConexao(req.usuario.id);
    res.json({ url });
  })
);

publico.get(
  '/canva/retorno',
  asyncHandler(async (req, res) => {
    const base = basePublica();
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      console.error('Retorno do Canva sem code ou state.');
      res.redirect(base + '/app/configuracoes?canva=erro');
      return;
    }
    try {
      await concluirConexao(code, state);
      res.redirect(base + '/app/configuracoes?canva=ok');
    } catch (erro) {
      console.error('Falha ao concluir a conexão com o Canva:', erro instanceof Error ? erro.message : erro);
      res.redirect(base + '/app/configuracoes?canva=erro');
    }
  })
);

router.delete(
  '/canva/conexao',
  asyncHandler(async (req, res) => {
    await desconectar(req.usuario.id);
    res.status(204).end();
  })
);

export default router;
