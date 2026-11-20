import { Router } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import type { Projeto } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  apagarArquivo,
  corpoDeImagem,
  imagemDoCorpo,
  lerArquivo,
  nomeDeArquivoValido,
  salvarArquivo,
} from '../../lib/arquivos';
import { canvaConectado } from '../../lib/canva';
import { normalizarEntrada } from '../../lib/imagem';
import { detalheDoProjeto, projetoDoUsuario, proximoNumeroDeVersao } from '../../lib/acesso';
import { criarTrabalho, registrarEvento, statusAgentes } from '../agentes/servico';
import { aplicarAnaliseLocal } from '../analise/servico';
import { embutirXmpEmPng, fonteDigitalDoProjeto, montarXmp } from '../../lib/procedencia';
import { situacoesDosProjetos, type Situacao } from '../../lib/situacao';
import type { CenaGravada } from '../cena/servico';

export const publico = Router();
const router = Router();

const TIPOS = ['FOTO', 'LOGO', 'DOCUMENTO', 'PRODUTO', 'PAISAGEM', 'OUTRO'] as const;
const ROTULO_STATUS: Record<string, string> = {
  NOVO: 'Novo',
  ANALISADO: 'Analisado',
  EM_RECONSTRUCAO: 'Em reconstrução',
  CONCLUIDO: 'Concluído',
};
const TIPO_IMAGEM: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const CACHE = 'private, max-age=31536000, immutable';

// Fração de 0 a 1 vinda da query; null se faltar ou for inválida.
function fracaoDaQuery(valor: unknown): number | null {
  if (typeof valor !== 'string' || !/^\d(\.\d+)?$/.test(valor)) return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

// Arquivos (público: o nome aleatório é a chave de acesso).
publico.get(
  '/arquivos/:nome',
  asyncHandler(async (req, res) => {
    const nome = req.params.nome;
    if (typeof nome !== 'string' || !nomeDeArquivoValido(nome)) {
      throw new HttpError(400, 'Nome de arquivo inválido');
    }
    const buf = await lerArquivo(nome);
    // O cabeçalho de cache só entra nas respostas boas: erro de validação não pode ficar guardado no navegador.
    const cachear = () => res.setHeader('Cache-Control', CACHE);

    const l = req.query.l;

    // Recorte: x, y, w, h em frações (0 a 1) da imagem; l = lado maior do resultado, em pixels.
    // Serve o recorte de uma parte com a resolução real dela, em vez de uma miniatura da imagem inteira.
    const { x, y, w, h } = req.query;
    if (x !== undefined || y !== undefined || w !== undefined || h !== undefined) {
      const fx = fracaoDaQuery(x);
      const fy = fracaoDaQuery(y);
      const fw = fracaoDaQuery(w);
      const fh = fracaoDaQuery(h);
      if (fx === null || fy === null || fw === null || fh === null || fw <= 0 || fh <= 0 || fx >= 1 || fy >= 1) {
        throw new HttpError(400, 'Recorte inválido');
      }
      const lado = typeof l === 'string' && /^\d+$/.test(l) ? Number(l) : 800;
      if (!Number.isSafeInteger(lado) || lado < 16 || lado > 2000) throw new HttpError(400, 'Largura inválida');
      const meta = await sharp(buf).metadata();
      const larguraTotal = meta.width ?? 0;
      const alturaTotal = meta.height ?? 0;
      if (larguraTotal < 1 || alturaTotal < 1) throw new HttpError(400, 'Imagem inválida');
      const left = Math.min(Math.floor(fx * larguraTotal), larguraTotal - 1);
      const top = Math.min(Math.floor(fy * alturaTotal), alturaTotal - 1);
      const width = Math.max(1, Math.min(Math.ceil(fw * larguraTotal), larguraTotal - left));
      const height = Math.max(1, Math.min(Math.ceil(fh * alturaTotal), alturaTotal - top));
      const recorte = await sharp(buf)
        .extract({ left, top, width, height })
        .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
      cachear();
      res.setHeader('Content-Type', 'image/webp');
      res.send(recorte);
      return;
    }

    if (l === undefined) {
      const extensao = nome.split('.').pop() ?? '';
      cachear();
      res.setHeader('Content-Type', TIPO_IMAGEM[extensao] ?? 'application/octet-stream');
      res.send(buf);
      return;
    }
    if (typeof l !== 'string' || !/^\d+$/.test(l)) {
      throw new HttpError(400, 'Largura inválida');
    }
    const largura = Number(l);
    if (!Number.isSafeInteger(largura) || largura < 16 || largura > 2000) {
      throw new HttpError(400, 'Largura inválida');
    }
    const miniatura = await sharp(buf).resize({ width: largura, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    cachear();
    res.setHeader('Content-Type', 'image/webp');
    res.send(miniatura);
  })
);

// Resumo de um projeto para listas: sem análise, sem dono e com contagens.
type ProjetoComContagens = Projeto & {
  regioes: { status: string }[];
  trabalhos: { id: number }[];
};

function resumo(projeto: ProjetoComContagens) {
  // A cena (Projeto.cena) não vai para listas: o JSON é do mapa 3D, não do resumo.
  const { analise: _analise, usuarioId: _dono, cena: _cena, regioes, trabalhos, ...resto } = projeto;
  return {
    ...resto,
    regioesTotal: regioes.length,
    regioesResolvidas: regioes.filter((r) => r.status === 'RESOLVIDA').length,
    trabalhosAtivos: trabalhos.length,
  };
}

// Situação calculada em lote: todo projeto pedido tem que estar no mapa.
function situacaoDe(situacoes: Map<number, Situacao>, projetoId: number): Situacao {
  const situacao = situacoes.get(projetoId);
  if (!situacao) throw new HttpError(404, 'Projeto não encontrado');
  return situacao;
}

router.get(
  '/painel',
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario.id;
    const [projetos, concluidos, regioesPendentes, opcoesGeradas, recentes, conectado, agentes, todos] = await Promise.all([
      prisma.projeto.count({ where: { usuarioId } }),
      prisma.projeto.count({ where: { usuarioId, status: 'CONCLUIDO' } }),
      prisma.regiao.count({ where: { status: { in: ['PENDENTE', 'EM_ANDAMENTO'] }, projeto: { usuarioId } } }),
      prisma.opcao.count({ where: { projeto: { usuarioId } } }),
      prisma.projeto.findMany({
        where: { usuarioId },
        orderBy: { atualizadoEm: 'desc' },
        take: 6,
        include: {
          regioes: { select: { status: true } },
          trabalhos: { where: { status: { in: ['FILA', 'EM_ANDAMENTO'] } }, select: { id: true } },
        },
      }),
      canvaConectado(usuarioId),
      statusAgentes(),
      prisma.projeto.findMany({ where: { usuarioId }, select: { id: true } }),
    ]);
    const situacoes = await situacoesDosProjetos(todos.map((p) => p.id));
    const esperandoVoce = todos.filter((p) => {
      const situacao = situacoes.get(p.id);
      return situacao?.quem === 'VOCE' && situacao.aprovacao === true;
    }).length;
    res.json({
      projetos,
      concluidos,
      regioesPendentes,
      opcoesGeradas,
      recentes: recentes.map((p) => ({ ...resumo(p), situacao: situacaoDe(situacoes, p.id) })),
      canva: { conectado, expiraEm: null },
      agentes,
      esperandoVoce,
    });
  })
);

router.get(
  '/busca',
  asyncHandler(async (req, res) => {
    const bruto = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (bruto.length < 2) {
      res.json([]);
      return;
    }
    const projetos = await prisma.projeto.findMany({
      where: { usuarioId: req.usuario.id, nome: { contains: bruto, mode: 'insensitive' } },
      orderBy: { atualizadoEm: 'desc' },
      take: 8,
      select: { id: true, nome: true, status: true },
    });
    res.json(
      projetos.map((p) => ({
        tipo: 'Projeto',
        titulo: p.nome,
        subtitulo: ROTULO_STATUS[p.status] ?? p.status,
        caminho: '/app/projetos/' + p.id,
      }))
    );
  })
);

router.get(
  '/projetos',
  asyncHandler(async (req, res) => {
    const projetos = await prisma.projeto.findMany({
      where: { usuarioId: req.usuario.id },
      orderBy: { atualizadoEm: 'desc' },
      include: {
        regioes: { select: { status: true } },
        trabalhos: { where: { status: { in: ['FILA', 'EM_ANDAMENTO'] } }, select: { id: true } },
      },
    });
    const situacoes = await situacoesDosProjetos(projetos.map((p) => p.id));
    res.json(projetos.map((p) => ({ ...resumo(p), situacao: situacaoDe(situacoes, p.id) })));
  })
);

router.post(
  '/projetos',
  corpoDeImagem,
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario.id;
    const nomeBruto = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
    const nome = nomeBruto.length > 0 ? nomeBruto.slice(0, 120) : 'Imagem sem nome';
    const tipoBruto = typeof req.query.tipo === 'string' ? req.query.tipo : '';
    const tipo = (TIPOS as readonly string[]).includes(tipoBruto) ? tipoBruto : 'OUTRO';

    const { png, largura, altura } = await normalizarEntrada(imagemDoCorpo(req.body));
    const arquivo = await salvarArquivo(png, 'png');

    const projeto = await prisma.projeto.create({
      data: {
        usuarioId,
        nome,
        tipo,
        largura,
        altura,
        originalArquivo: arquivo,
        atualArquivo: arquivo,
        versoes: { create: { numero: 1, arquivo, descricao: 'Imagem original' } },
      },
    });

    try {
      await aplicarAnaliseLocal(projeto.id);
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      await registrarEvento(projeto.id, 'sistema', 'erro', 'Falha na medição local: ' + mensagem);
    }
    await criarTrabalho(projeto.id, 'ANALISE');
    res.status(201).json(await detalheDoProjeto(projeto.id));
  })
);

router.get(
  '/projetos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    res.json(await detalheDoProjeto(id));
  })
);

const atualizarSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  descricao: z.string().max(2000).optional(),
  tipo: z.enum(TIPOS).optional(),
});

router.put(
  '/projetos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const dados = validar(atualizarSchema, req.body);
    await prisma.projeto.update({ where: { id }, data: dados });
    res.json(await detalheDoProjeto(id));
  })
);

router.delete(
  '/projetos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const projeto = await projetoDoUsuario(req.usuario.id, id);
    const [versoes, referencias, opcoes] = await Promise.all([
      prisma.versao.findMany({ where: { projetoId: id }, select: { arquivo: true } }),
      prisma.referencia.findMany({ where: { projetoId: id }, select: { arquivo: true } }),
      prisma.opcao.findMany({ where: { projetoId: id }, select: { arquivo: true } }),
    ]);
    const nomes = new Set<string>();
    // Arquivos do Blender da cena (mapa 3D), se houver.
    const blender = (projeto.cena as unknown as CenaGravada | null)?.blender ?? null;
    const candidatos: (string | null | undefined)[] = [
      projeto.originalArquivo,
      projeto.atualArquivo,
      ...versoes.map((v) => v.arquivo),
      ...referencias.map((r) => r.arquivo),
      ...opcoes.map((o) => o.arquivo),
      blender?.profundidadeArquivo,
      blender?.volumesArquivo,
      blender?.previaArquivo,
      blender?.glbArquivo,
    ];
    for (const nome of candidatos) {
      if (nome) nomes.add(nome);
    }
    await prisma.projeto.delete({ where: { id } });
    for (const nome of nomes) {
      await apagarArquivo(nome);
    }
    res.status(204).end();
  })
);

router.get(
  '/projetos/:id/baixar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const projeto = await projetoDoUsuario(req.usuario.id, id);
    const buf = await lerArquivo(projeto.atualArquivo);
    const fonte = await fonteDigitalDoProjeto(id);
    const saida = fonte === null ? buf : embutirXmpEmPng(buf, montarXmp(fonte));
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="restaurado-${id}.png"`);
    res.send(saida);
  })
);

router.post(
  '/projetos/:id/versoes/:versaoId/restaurar',
  asyncHandler(async (req, res) => {
    const id = idParam(req, 'id');
    const versaoId = idParam(req, 'versaoId');
    await projetoDoUsuario(req.usuario.id, id);
    const versao = await prisma.versao.findFirst({ where: { id: versaoId, projetoId: id } });
    if (!versao) throw new HttpError(404, 'Versão não encontrada');
    await prisma.projeto.update({ where: { id }, data: { atualArquivo: versao.arquivo } });
    await prisma.versao.create({
      data: {
        projetoId: id,
        numero: await proximoNumeroDeVersao(id),
        arquivo: versao.arquivo,
        descricao: 'Restaurada a versão ' + versao.numero,
      },
    });
    res.json(await detalheDoProjeto(id));
  })
);

export default router;
