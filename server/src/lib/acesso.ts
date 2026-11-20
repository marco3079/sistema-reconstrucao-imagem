import type { Projeto, Regiao, Opcao, Referencia } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { situacaoComDados } from './situacao';

// Funções de acesso compartilhadas pelas rotas: conferem o dono e montam o detalhe do projeto.

export async function projetoDoUsuario(usuarioId: number, projetoId: number): Promise<Projeto> {
  const projeto = await prisma.projeto.findFirst({ where: { id: projetoId, usuarioId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  return projeto;
}

export async function regiaoDoUsuario(usuarioId: number, regiaoId: number): Promise<Regiao & { projeto: Projeto }> {
  const regiao = await prisma.regiao.findFirst({
    where: { id: regiaoId, projeto: { usuarioId } },
    include: { projeto: true },
  });
  if (!regiao) throw new HttpError(404, 'Região não encontrada');
  return regiao;
}

export async function opcaoDoUsuario(usuarioId: number, opcaoId: number): Promise<Opcao> {
  const opcao = await prisma.opcao.findFirst({ where: { id: opcaoId, projeto: { usuarioId } } });
  if (!opcao) throw new HttpError(404, 'Opção não encontrada');
  return opcao;
}

export async function referenciaDoUsuario(usuarioId: number, referenciaId: number): Promise<Referencia> {
  const referencia = await prisma.referencia.findFirst({ where: { id: referenciaId, projeto: { usuarioId } } });
  if (!referencia) throw new HttpError(404, 'Referência não encontrada');
  return referencia;
}

// Projeto completo, no formato ProjetoDetalhe do cliente (client/src/lib/tipos.ts).
export async function detalheDoProjeto(projetoId: number) {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    include: {
      regioes: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }] },
      referencias: { orderBy: { id: 'asc' } },
      pedidos: { orderBy: { id: 'asc' } },
      versoes: { orderBy: { numero: 'desc' } },
      trabalhos: { where: { status: { in: ['FILA', 'EM_ANDAMENTO'] } }, orderBy: { id: 'asc' } },
    },
  });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  const vinculos = await prisma.vinculo.findMany({
    where: { regiao: { projetoId } },
    orderBy: { id: 'asc' },
  });
  // O JSON da cena (Projeto.cena) não vai para o cliente: só a presença dela.
  const { usuarioId: _dono, referencias, cena, ...resto } = projeto;
  return {
    ...resto,
    temCena: cena !== null && cena !== undefined,
    // O id da mídia no Canva é interno: não vai para o cliente.
    referencias: referencias.map(({ canvaMediaId: _canva, ...r }) => r),
    vinculos,
    situacao: await situacaoComDados(projeto),
  };
}

// Próximo número de versão do projeto.
export async function proximoNumeroDeVersao(projetoId: number): Promise<number> {
  const ultima = await prisma.versao.findFirst({ where: { projetoId }, orderBy: { numero: 'desc' } });
  return (ultima?.numero ?? 0) + 1;
}

// Atualiza o status do projeto conforme as regiões: todas resolvidas/ignoradas = CONCLUIDO.
export async function recalcularStatusDoProjeto(projetoId: number): Promise<string> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, include: { regioes: true } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  let status = projeto.status;
  // Partes ativas: selecionadas pelo usuário e não ignoradas.
  const ativas = projeto.regioes.filter((r) => r.selecionada === true && r.status !== 'IGNORADA');
  if (projeto.analise === null) status = 'NOVO';
  else if (ativas.length > 0 && ativas.every((r) => r.status === 'RESOLVIDA')) status = 'CONCLUIDO';
  else if (projeto.regioes.some((r) => r.status === 'RESOLVIDA' || r.status === 'EM_ANDAMENTO')) status = 'EM_RECONSTRUCAO';
  else status = 'ANALISADO';
  if (status !== projeto.status) await prisma.projeto.update({ where: { id: projetoId }, data: { status } });
  return status;
}
