// ESQUELETO: as assinaturas são o contrato (docs/CONTRATOS.md). O gerador g02 implementa os corpos.

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { lerArquivo } from '../../lib/arquivos';
import { recalcularStatusDoProjeto } from '../../lib/acesso';
import { analisarLocal, PROBLEMAS } from '../../lib/analise-local';
import type { Metricas, Problema, ProblemaGlobal } from '../../lib/analise-local';
import { recriarGrade } from '../../lib/grade';
import { registrarEvento } from '../agentes/servico';

export interface AnaliseDoAgente {
  descricao: string;
  tipoSugerido: string; // FOTO | LOGO | DOCUMENTO | PRODUTO | PAISAGEM | OUTRO
  qualidade?: number; // 0 a 100; se ausente, mantém a medida local
  problemas: ProblemaGlobal[];
  promptBase: string;
}

export interface DadosDeRegiao {
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  problema: Problema;
  gravidade: number;
  descricao: string;
}

// Forma gravada em Projeto.analise (JSON).
interface Analise {
  feitaEm: string;
  comIA: boolean;
  descricao: string;
  tipoSugerido: string;
  qualidade: number;
  metricas: Metricas;
  problemas: ProblemaGlobal[];
  promptBase: string;
}

const TIPOS_DO_PROJETO = ['FOTO', 'LOGO', 'DOCUMENTO', 'PRODUTO', 'PAISAGEM', 'OUTRO'];

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function lerAnalise(bruto: unknown): Analise | null {
  return bruto === null || bruto === undefined ? null : (bruto as Analise);
}

// Mede a imagem atual do projeto, grava Projeto.analise (comIA: false), recria a sugestão de imagem inteira
// (origem LOCAL) e monta a grade de reconstrução (recriarGrade). Não mexe em regiões MANUAL, IA, nem nas já trabalhadas.
export async function aplicarAnaliseLocal(projetoId: number): Promise<void> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  const conteudo = await lerArquivo(projeto.atualArquivo);
  const medida = await analisarLocal(conteudo);

  const anterior = lerAnalise(projeto.analise);
  const feitaEm = new Date().toISOString();
  const analise: Analise =
    anterior?.comIA === true
      ? { ...anterior, metricas: medida.metricas, feitaEm }
      : {
          feitaEm,
          comIA: false,
          descricao: '',
          tipoSugerido: projeto.tipo,
          qualidade: medida.qualidade,
          metricas: medida.metricas,
          problemas: medida.problemas,
          promptBase: '',
        };

  await prisma.projeto.update({
    where: { id: projetoId },
    data: { analise: analise as unknown as Prisma.InputJsonValue },
  });

  // Só a sugestão de imagem inteira vira região; as localizadas ficam com a grade.
  const apaga = { x: 0, y: 0, largura: 1, altura: 1 };
  await prisma.regiao.deleteMany({
    where: {
      projetoId,
      origem: 'LOCAL',
      classe: 'DEFEITO',
      status: 'PENDENTE',
      opcoes: { none: {} },
      NOT: apaga,
    },
  });
  const sugestaoInteira = medida.regioes.find(
    (r) => r.x === 0 && r.y === 0 && r.largura === 1 && r.altura === 1
  );
  if (sugestaoInteira) {
    const jaExiste = await prisma.regiao.findFirst({
      where: { projetoId, classe: 'DEFEITO', ...apaga },
      select: { id: true },
    });
    if (!jaExiste) {
      await prisma.regiao.create({
        data: {
          projetoId,
          nome: 'Imagem inteira',
          x: 0,
          y: 0,
          largura: 1,
          altura: 1,
          problema: sugestaoInteira.problema,
          gravidade: sugestaoInteira.gravidade,
          descricao: sugestaoInteira.descricao,
          classe: 'DEFEITO',
          origem: 'LOCAL',
          ordem: 0,
          // Nasce desmarcada: a imagem inteira e as partes da grade se sobrepõem, e o usuário escolhe uma coisa ou outra.
          selecionada: false,
        },
      });
    }
  }

  const grade = await recriarGrade(projetoId);
  const comProblema = await prisma.regiao.count({
    where: { projetoId, classe: 'CELULA', problema: { not: 'NENHUM' } },
  });
  await registrarEvento(
    projetoId,
    'sistema',
    'nota',
    `Medição local: qualidade ${analise.qualidade}/100. Grade de ${grade.linhas} × ${grade.colunas} montada, ${comProblema} partes com problema.`
  );
  await recalcularStatusDoProjeto(projetoId);
}

// Grava a análise feita pelo agente analista por cima das medidas locais (comIA: true).
// Se o projeto ainda não tiver medidas, chama aplicarAnaliseLocal antes.
export async function salvarAnaliseDoAgente(projetoId: number, dados: AnaliseDoAgente): Promise<void> {
  let projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  if (projeto.analise === null) {
    await aplicarAnaliseLocal(projetoId);
    projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
    if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  }
  const anterior = lerAnalise(projeto.analise);
  if (!anterior) throw new HttpError(500, 'Análise local indisponível');

  const descricao = typeof dados.descricao === 'string' ? dados.descricao.trim() : '';
  if (descricao.length === 0) throw new HttpError(400, 'A descrição da análise não pode ficar vazia');

  const tipoSugerido =
    typeof dados.tipoSugerido === 'string' && TIPOS_DO_PROJETO.includes(dados.tipoSugerido)
      ? dados.tipoSugerido
      : 'OUTRO';

  if (!Array.isArray(dados.problemas)) throw new HttpError(400, 'problemas deve ser uma lista');
  const problemas: ProblemaGlobal[] = dados.problemas.map((p, i) => {
    const codigo = p?.codigo as string;
    if (!(PROBLEMAS as string[]).includes(codigo)) {
      throw new HttpError(400, `Problema ${i + 1}: código "${codigo}" desconhecido`);
    }
    if (!Number.isInteger(p.gravidade) || p.gravidade < 1 || p.gravidade > 5) {
      throw new HttpError(400, `Problema ${i + 1}: gravidade deve ser um inteiro de 1 a 5`);
    }
    return { codigo: codigo as Problema, gravidade: p.gravidade, descricao: String(p.descricao ?? '') };
  });

  const qualidade =
    typeof dados.qualidade === 'number' && Number.isFinite(dados.qualidade)
      ? limitar(Math.round(dados.qualidade), 0, 100)
      : anterior.qualidade;

  const nova: Analise = {
    ...anterior,
    feitaEm: new Date().toISOString(),
    comIA: true,
    descricao,
    tipoSugerido,
    problemas,
    promptBase: typeof dados.promptBase === 'string' ? dados.promptBase : '',
    qualidade,
  };

  await prisma.projeto.update({
    where: { id: projetoId },
    data: {
      analise: nova as unknown as Prisma.InputJsonValue,
      ...(projeto.tipo === 'OUTRO' && tipoSugerido !== 'OUTRO' ? { tipo: tipoSugerido } : {}),
    },
  });
  await recalcularStatusDoProjeto(projetoId);
}

// Valida (frações dentro de 0..1, problema conhecido, gravidade 1..5) e cria a região. Devolve o id.
export async function criarRegiao(projetoId: number, dados: DadosDeRegiao, origem: 'IA' | 'MANUAL'): Promise<number> {
  const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
  if (nome.length < 1 || nome.length > 80) throw new HttpError(400, 'O nome da região deve ter de 1 a 80 caracteres');

  const { x, y } = dados;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x >= 1) {
    throw new HttpError(400, 'O campo x deve estar entre 0 e menos de 1');
  }
  if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y >= 1) {
    throw new HttpError(400, 'O campo y deve estar entre 0 e menos de 1');
  }
  const { largura: larguraInformada, altura: alturaInformada } = dados;
  if (typeof larguraInformada !== 'number' || !Number.isFinite(larguraInformada) || larguraInformada <= 0 || larguraInformada > 1) {
    throw new HttpError(400, 'O campo largura deve ser maior que 0 e no máximo 1');
  }
  if (typeof alturaInformada !== 'number' || !Number.isFinite(alturaInformada) || alturaInformada <= 0 || alturaInformada > 1) {
    throw new HttpError(400, 'O campo altura deve ser maior que 0 e no máximo 1');
  }
  const largura = Math.min(larguraInformada, 1 - x);
  const altura = Math.min(alturaInformada, 1 - y);

  if (!(PROBLEMAS as string[]).includes(dados.problema)) {
    throw new HttpError(400, 'O campo problema é desconhecido');
  }
  const { gravidade } = dados;
  if (!Number.isInteger(gravidade) || gravidade < 1 || gravidade > 5) {
    throw new HttpError(400, 'O campo gravidade deve ser um inteiro de 1 a 5');
  }
  const descricao = dados.descricao === undefined || dados.descricao === null ? '' : dados.descricao;
  if (typeof descricao !== 'string' || descricao.length > 1000) {
    throw new HttpError(400, 'O campo descricao deve ser texto de até 1000 caracteres');
  }

  const ordem = await prisma.regiao.count({ where: { projetoId } });
  const regiao = await prisma.regiao.create({
    data: {
      projetoId,
      nome,
      x,
      y,
      largura,
      altura,
      problema: dados.problema,
      gravidade,
      descricao,
      origem,
      ordem,
    },
  });
  await recalcularStatusDoProjeto(projetoId);
  return regiao.id;
}
