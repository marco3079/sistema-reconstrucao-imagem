import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, idParam } from '../../lib/erros';
import { projetoDoUsuario } from '../../lib/acesso';
import { lerArquivo } from '../../lib/arquivos';
import { analisarLocal } from '../../lib/analise-local';
import type { ProblemaGlobal } from '../../lib/analise-local';
import { fonteDigitalDoProjeto } from '../../lib/procedencia';

// Laudo de restauração (ver docs/NORMAS.md e docs/CONTRATOS.md). Dono: g02.
const router = Router();

// Princípios do laudo: lista fixa, nesta ordem.
export const principios = [
  {
    titulo: 'Original preservado',
    texto: 'O arquivo original nunca é alterado; todo o trabalho é feito em cópias.',
    norma: 'SWGDE Image Processing Guidelines',
  },
  {
    titulo: 'Exame antes do tratamento',
    texto: 'A imagem foi medida e examinada antes de qualquer correção.',
    norma: 'Códigos de ética de conservação (AIC, Icon)',
  },
  {
    titulo: 'Intervenção mínima',
    texto: 'Cada parte recebe o tratamento menos invasivo que resolve o problema.',
    norma: 'Códigos de ética de conservação (AIC, Icon)',
  },
  {
    titulo: 'Sem conjectura escondida',
    texto: 'Parte recriada sem referência é marcada como conjectura.',
    norma: 'Carta de Veneza, art. 9',
  },
  {
    titulo: 'Reintegração distinguível e reversível',
    texto: 'O laudo aponta o que foi recriado, e cada escolha pode ser desfeita pelas versões.',
    norma: 'Carta de Veneza, art. 12',
  },
  {
    titulo: 'Tratamento documentado',
    texto: 'Cada passo fica registrado com o filtro ou o pedido usado.',
    norma: 'SWGDE Image Processing Guidelines',
  },
  {
    titulo: 'Conteúdo gerado por IA identificado',
    texto: 'O arquivo baixado leva o tipo de fonte digital do IPTC.',
    norma: 'IPTC Digital Source Type',
  },
];

// Lê parametros.conjectura com checagem de tipo.
function ehConjectura(parametros: unknown): boolean {
  if (typeof parametros !== 'object' || parametros === null) return false;
  return (parametros as { conjectura?: unknown }).conjectura === true;
}

router.get(
  '/projetos/:id/laudo',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const projeto = await projetoDoUsuario(req.usuario.id, id);

    const analise = projeto.analise as { descricao?: unknown; problemas?: unknown } | null;
    const descricao = analise && typeof analise.descricao === 'string' ? analise.descricao : '';
    const problemas: ProblemaGlobal[] = analise && Array.isArray(analise.problemas) ? (analise.problemas as ProblemaGlobal[]) : [];

    const [medicaoAntes, medicaoDepois, regioes, versoes, fonteDigital] = await Promise.all([
      lerArquivo(projeto.originalArquivo).then((buf) => analisarLocal(buf)),
      lerArquivo(projeto.atualArquivo).then((buf) => analisarLocal(buf)),
      prisma.regiao.findMany({
        where: { projetoId: id },
        orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
        include: {
          _count: { select: { vinculos: true } },
          opcoes: { where: { status: 'ESCOLHIDA' }, orderBy: { id: 'desc' }, take: 1 },
        },
      }),
      prisma.versao.findMany({
        where: { projetoId: id },
        orderBy: { numero: 'asc' },
        select: { numero: true, descricao: true, criadoEm: true },
      }),
      fonteDigitalDoProjeto(id),
    ]);

    // Entram no laudo só as partes selecionadas ou que têm tratamento escolhido.
    const partes = regioes
      .filter((regiao) => regiao.selecionada || regiao.opcoes.length > 0)
      .map((regiao) => {
        const escolhida = regiao.opcoes[0] ?? null;
        const tratamento = escolhida
          ? {
              opcaoId: escolhida.id,
              origem: escolhida.origem === 'CANVA' ? ('CANVA' as const) : ('LOCAL' as const),
              rotulo: escolhida.rotulo,
              rodada: escolhida.rodada,
              nota: escolhida.nota,
              parecer: escolhida.parecer,
              conjectura: ehConjectura(escolhida.parametros),
            }
          : null;
        return {
          id: regiao.id,
          nome: regiao.nome,
          classe: regiao.classe,
          categoria: regiao.categoria,
          selecionada: regiao.selecionada,
          problema: regiao.problema,
          gravidade: regiao.gravidade,
          status: regiao.status,
          plano: regiao.plano,
          referencias: regiao._count.vinculos,
          tratamento,
        };
      });

    const conteudoGerado = partes.some((p) => p.tratamento !== null && p.tratamento.origem === 'CANVA');
    const conjecturas = partes.filter((p) => p.tratamento !== null && p.tratamento.conjectura === true).length;

    res.json({
      geradoEm: new Date().toISOString(),
      projeto: {
        id: projeto.id,
        nome: projeto.nome,
        tipo: projeto.tipo,
        status: projeto.status,
        largura: projeto.largura,
        altura: projeto.altura,
        criadoEm: projeto.criadoEm.toISOString(),
      },
      descricao,
      problemas,
      medidas: {
        antes: medicaoAntes.metricas,
        depois: medicaoDepois.metricas,
        qualidadeAntes: medicaoAntes.qualidade,
        qualidadeDepois: medicaoDepois.qualidade,
      },
      partes,
      versoes: versoes.map((v) => ({ numero: v.numero, descricao: v.descricao, criadoEm: v.criadoEm.toISOString() })),
      conteudoGerado,
      conjecturas,
      fonteDigital,
      principios,
    });
  })
);

export default router;
