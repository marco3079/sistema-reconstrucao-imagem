import { Router } from 'express';
import type { Referencia } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  detalheDoProjeto,
  projetoDoUsuario,
  recalcularStatusDoProjeto,
  referenciaDoUsuario,
  regiaoDoUsuario,
} from '../../lib/acesso';
import { apagarArquivo, corpoDeImagem, imagemDoCorpo, salvarArquivo } from '../../lib/arquivos';
import { normalizarEntrada } from '../../lib/imagem';
import { canvaConectado } from '../../lib/canva';
import { criarTrabalho, registrarEvento, sessaoConectada } from '../agentes/servico';
import { ordenarPorProfundidade } from '../cena/servico';
import {
  PAPEIS,
  PapelReferencia,
  falharReferenciasPresas,
  gerarReferenciasCanva,
  gerarReferenciasQueFaltam,
  promptDeReferencia,
  sugerirMapa,
  vincular,
} from './servico';

const router = Router();

// Ao carregar o módulo, referências que ficaram em GERANDO (servidor reiniciado) viram FALHOU.
falharReferenciasPresas().catch(() => undefined);

const LIMITE_REFERENCIAS = 30;

// Nunca devolve o id da mídia no Canva.
function paraResposta(r: Referencia) {
  const { canvaMediaId: _canva, ...resto } = r;
  return resto;
}

const papelSchema = z.enum(PAPEIS as [PapelReferencia, ...PapelReferencia[]]);

// Seleção de partes: marca as da lista e desmarca as outras que não estão RESOLVIDA.
async function aplicarSelecao(projetoId: number, ids: number[]): Promise<void> {
  const unicos = [...new Set(ids)];
  const regioes = await prisma.regiao.findMany({ where: { projetoId }, select: { id: true } });
  const doProjeto = new Set(regioes.map((r) => r.id));
  if (unicos.some((regiaoId) => !doProjeto.has(regiaoId))) {
    throw new HttpError(400, 'Informe uma parte do projeto');
  }
  await prisma.$transaction([
    prisma.regiao.updateMany({ where: { projetoId, id: { in: unicos } }, data: { selecionada: true } }),
    prisma.regiao.updateMany({
      where: { projetoId, id: { notIn: unicos }, status: { not: 'RESOLVIDA' } },
      data: { selecionada: false },
    }),
  ]);
}

router.post(
  '/projetos/:id/referencias',
  corpoDeImagem,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);

    const nomeBruto = typeof req.query.nome === 'string' ? req.query.nome.trim().slice(0, 120) : '';
    const nome = nomeBruto || 'Referência';
    const papelQuery = typeof req.query.papel === 'string' ? req.query.papel : '';
    const papel: PapelReferencia = (PAPEIS as string[]).includes(papelQuery)
      ? (papelQuery as PapelReferencia)
      : 'GERAL';

    // Com regiaoId, a referência é importada para uma parte do projeto.
    let regiaoId: number | null = null;
    if (typeof req.query.regiaoId === 'string' && req.query.regiaoId !== '') {
      const candidata = Number(req.query.regiaoId);
      const regiao = Number.isInteger(candidata)
        ? await prisma.regiao.findFirst({ where: { id: candidata, projetoId: id }, select: { id: true } })
        : null;
      if (!regiao) throw new HttpError(400, 'Informe uma parte do projeto');
      regiaoId = regiao.id;
    }

    // Só as importadas pelo usuário contam para o limite; as geradas não bloqueiam o upload.
    const total = await prisma.referencia.count({ where: { projetoId: id, origem: 'USUARIO' } });
    if (total >= LIMITE_REFERENCIAS) {
      throw new HttpError(400, `Limite de ${LIMITE_REFERENCIAS} referências por projeto`);
    }

    const { png, largura, altura } = await normalizarEntrada(imagemDoCorpo(req.body));
    const arquivo = await salvarArquivo(png, 'png');
    const referencia = await prisma.referencia.create({
      data: { projetoId: id, nome, arquivo, largura, altura, papel, regiaoId },
    });
    if (regiaoId !== null) {
      await vincular(referencia.id, regiaoId, 3);
    }

    // Referência importada direto para uma parte já está no lugar que o usuário escolheu: a equipe não precisa
    // rever o mapa, e o passo não volta para "vez da equipe". Sem parte, o cartógrafo decide onde ela serve.
    if (regiaoId === null) {
      await criarTrabalho(id, 'REFERENCIAS', {
        instrucoes: `Nova referência enviada: "${nome}" (papel ${papel}).`,
      });
    }

    res.status(201).json(paraResposta(referencia));
  })
);

const geracaoSchema = z.object({
  instrucoes: z.string().max(1000).optional(),
  quantidade: z.number().int().min(1).max(4).optional(),
});

// Gera candidatas no Canva para uma parte. Ficam em GERANDO e depois PENDENTE para o revisor.
router.post(
  '/regioes/:id/referencias/gerar',
  asyncHandler(async (req, res) => {
    const regiao = await regiaoDoUsuario(req.usuario.id, idParam(req));
    const { instrucoes, quantidade = 4 } = validar(geracaoSchema, req.body ?? {});
    if (!(await canvaConectado(req.usuario.id))) {
      throw new HttpError(409, 'Conecte o Canva em Configurações para gerar referências');
    }
    const criadas = await gerarReferenciasCanva(regiao.id, {
      prompt: promptDeReferencia(regiao.projeto, regiao, instrucoes),
      quantidade,
    });
    res.status(201).json(criadas.map(paraResposta));
  })
);

// Gera no Canva, sem clique, as candidatas das partes que ainda não têm referência sua (dono do projeto).
// Se criou alguma, enfileira a revisão em modo referências (sem duplicar um trabalho REFERENCIAS na fila).
router.post(
  '/projetos/:id/referencias/gerar-faltantes',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const resultado = await gerarReferenciasQueFaltam(id);
    // Revisão só com sessão da equipe ligada ao projeto; sem sessão, não cria trabalho (a tela não ficaria esperando).
    let revisao: 'PEDIDA' | 'SEM_SESSAO' | 'NAO_NECESSARIA' = 'NAO_NECESSARIA';
    if (resultado.criadas > 0) {
      if (!sessaoConectada(id)) {
        revisao = 'SEM_SESSAO';
      } else {
        revisao = 'PEDIDA';
        const enfileirado = await prisma.trabalho.findFirst({
          where: { projetoId: id, tipo: 'REFERENCIAS', status: 'FILA' },
        });
        if (!enfileirado) {
          await criarTrabalho(id, 'REFERENCIAS', {
            instrucoes: `Revisar as referências geradas automaticamente (ids: ${resultado.ids.join(', ')}). Só o revisor, em modo referências; não mexer no mapa.`,
          });
        }
      }
    }
    res.json({ ...resultado, revisao });
  })
);

const referenciaSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  papel: papelSchema.optional(),
  observacao: z.string().max(1000).optional(),
});

router.put(
  '/referencias/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await referenciaDoUsuario(req.usuario.id, id);
    const dados = validar(referenciaSchema, req.body);
    const atualizada = await prisma.referencia.update({ where: { id }, data: dados });
    res.json(paraResposta(atualizada));
  })
);

router.delete(
  '/referencias/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const referencia = await referenciaDoUsuario(req.usuario.id, id);
    await prisma.pedidoReferencia.updateMany({
      where: { referenciaId: id },
      data: { referenciaId: null, atendido: false },
    });
    await prisma.referencia.delete({ where: { id } });
    // Referência em GERANDO ainda não tem arquivo.
    if (referencia.arquivo !== '') await apagarArquivo(referencia.arquivo);
    res.status(204).end();
  })
);

const selecaoSchema = z.object({
  ids: z.array(z.number().int()).max(64),
});

// O usuário marca as partes que quer reconstruir.
router.put(
  '/projetos/:id/grade/selecao',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const { ids } = validar(selecaoSchema, req.body);
    await aplicarSelecao(id, ids);
    await recalcularStatusDoProjeto(id);
    res.json(await detalheDoProjeto(id));
  })
);

const mapaSchema = z.object({
  vinculos: z
    .array(
      z.object({
        referenciaId: z.number().int(),
        regiaoId: z.number().int(),
        peso: z.number().int().min(1).max(3),
      })
    )
    .max(500),
});

router.put(
  '/projetos/:id/mapa',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const { vinculos } = validar(mapaSchema, req.body);

    const refIds = [...new Set(vinculos.map((v) => v.referenciaId))];
    const regIds = [...new Set(vinculos.map((v) => v.regiaoId))];
    const [referenciasDoProjeto, regioesDoProjeto] = await Promise.all([
      prisma.referencia.findMany({ where: { projetoId: id, id: { in: refIds } }, select: { id: true, status: true } }),
      prisma.regiao.findMany({ where: { projetoId: id, id: { in: regIds } }, select: { id: true } }),
    ]);
    if (referenciasDoProjeto.length !== refIds.length || regioesDoProjeto.length !== regIds.length) {
      throw new HttpError(400, 'Vínculo com item de outro projeto');
    }
    if (referenciasDoProjeto.some((r) => r.status !== 'APROVADA')) {
      throw new HttpError(400, 'Só referência aprovada pode entrar no mapa');
    }

    // Sem duplicar o par referência+região: vale a primeira ocorrência.
    const unicos = new Map<string, { referenciaId: number; regiaoId: number; peso: number }>();
    for (const v of vinculos) {
      const chave = `${v.referenciaId}|${v.regiaoId}`;
      if (!unicos.has(chave)) unicos.set(chave, v);
    }

    await prisma.$transaction(async (tx) => {
      await tx.vinculo.deleteMany({ where: { regiao: { projetoId: id } } });
      for (const v of unicos.values()) {
        await tx.vinculo.create({ data: v });
      }
    });

    const resultado = await prisma.vinculo.findMany({
      where: { regiao: { projetoId: id } },
      orderBy: { id: 'asc' },
    });
    res.json(resultado);
  })
);

const aprovarSchema = z.object({
  selecao: z.array(z.number().int()).max(64).optional(),
});

// O usuário aprova o mapa (qualquer mapaStatus) e a equipe segue para o plano de tratamento.
// Com `selecao`, aplica a seleção de partes antes de aprovar.
router.post(
  '/projetos/:id/mapa/aprovar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    const { selecao } = validar(aprovarSchema, req.body ?? {});
    if (selecao !== undefined) {
      if (selecao.length === 0) {
        throw new HttpError(400, 'Marque ao menos uma parte para reconstruir');
      }
      await aplicarSelecao(id, selecao);
      await recalcularStatusDoProjeto(id);
    }
    await prisma.projeto.update({
      where: { id },
      data: { mapaStatus: 'APROVADO', mapaAprovadoEm: new Date() },
    });
    await registrarEvento(id, 'sistema', 'status', 'Mapa de referências aprovado por você.');
    // Mais distante primeiro (mapa 3D); sem cena, a ordem não muda.
    await ordenarPorProfundidade(id);
    await criarTrabalho(id, 'PLANO');
    res.json(await detalheDoProjeto(id));
  })
);

router.post(
  '/projetos/:id/mapa/sugerir',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await projetoDoUsuario(req.usuario.id, id);
    res.json(await sugerirMapa(id));
  })
);

const pedidoSchema = z.object({
  atendido: z.boolean().optional(),
  referenciaId: z.number().int().nullable().optional(),
});

router.put(
  '/pedidos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const pedido = await prisma.pedidoReferencia.findFirst({
      where: { id, projeto: { usuarioId: req.usuario.id } },
    });
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
    const dados = validar(pedidoSchema, req.body);

    const dadosAtualizacao: { atendido?: boolean; referenciaId?: number | null } = {};
    if (dados.referenciaId !== undefined) {
      if (dados.referenciaId !== null) {
        const referencia = await prisma.referencia.findFirst({
          where: { id: dados.referenciaId, projetoId: pedido.projetoId },
        });
        if (!referencia) throw new HttpError(400, 'Referência não pertence ao projeto');
        if (referencia.status !== 'APROVADA') {
          throw new HttpError(409, 'Só referência aprovada pode entrar no mapa');
        }
        // Ao ligar uma referência, o pedido fica atendido (a menos que `atendido` venha explícito).
        dadosAtualizacao.atendido = dados.atendido ?? true;
      }
      dadosAtualizacao.referenciaId = dados.referenciaId;
    }
    if (dados.atendido !== undefined) dadosAtualizacao.atendido = dados.atendido;

    const atualizado = await prisma.pedidoReferencia.update({ where: { id }, data: dadosAtualizacao });
    if (atualizado.regiaoId !== null && atualizado.referenciaId !== null) {
      await vincular(atualizado.referenciaId, atualizado.regiaoId, 3);
    }
    res.json(atualizado);
  })
);

router.delete(
  '/pedidos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const pedido = await prisma.pedidoReferencia.findFirst({
      where: { id, projeto: { usuarioId: req.usuario.id } },
    });
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
    await prisma.pedidoReferencia.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
