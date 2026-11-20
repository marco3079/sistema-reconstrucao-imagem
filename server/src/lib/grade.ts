import sharp from 'sharp';
import { prisma } from './prisma';
import { HttpError } from './erros';
import { lerArquivo } from './arquivos';
import { retanguloDaRegiao } from './imagem';
import { analisarLocal } from './analise-local';
import type { Problema } from './analise-local';

// Grade de reconstrução: a foto é separada em elementos (inteiros) e células regulares.
// Ver docs/GRADE.md.

export type Categoria = 'ROSTO' | 'CORPO' | 'ROUPA' | 'OBJETO' | 'TEXTO' | 'FUNDO' | 'COR' | 'OUTRO';

export const CATEGORIAS: Categoria[] = ['ROSTO', 'CORPO', 'ROUPA', 'OBJETO', 'TEXTO', 'FUNDO', 'COR', 'OUTRO'];

export const MAX_PARTES = 32;

// Retângulo em frações (0 a 1) da imagem.
export interface RetFracao {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface Celula extends RetFracao {
  linha: number;
  coluna: number;
  nome: string;
}

const AMOSTRAS = 20;
const LIMITE_COBERTO = 0.6;
const FORMATO_MIN = 0.6;
const FORMATO_MAX = 1.67;
const LADO_MIN = 2;
const LADO_MAX = 8;
const MIN_CELULAS = 4;
const CONCORRENCIA_MEDICAO = 4;

// Fração (0 a 1) da célula coberta pela união dos retângulos: malha de 20 x 20 pontos dentro da célula.
export function fracaoCoberta(celula: RetFracao, retangulos: RetFracao[]): number {
  let cobertos = 0;
  for (let i = 0; i < AMOSTRAS; i++) {
    const py = celula.y + ((i + 0.5) / AMOSTRAS) * celula.altura;
    for (let j = 0; j < AMOSTRAS; j++) {
      const px = celula.x + ((j + 0.5) / AMOSTRAS) * celula.largura;
      const dentro = retangulos.some(
        (r) => px >= r.x && px < r.x + r.largura && py >= r.y && py < r.y + r.altura
      );
      if (dentro) cobertos++;
    }
  }
  return cobertos / (AMOSTRAS * AMOSTRAS);
}

// Todas as células de uma grade linhas x colunas, em ordem de linha. Nome: "Parte A1".
export function celulasDaGrade(linhas: number, colunas: number): Celula[] {
  const celulas: Celula[] = [];
  for (let linha = 0; linha < linhas; linha++) {
    for (let coluna = 0; coluna < colunas; coluna++) {
      celulas.push({
        x: coluna / colunas,
        y: linha / linhas,
        largura: 1 / colunas,
        altura: 1 / linhas,
        linha,
        coluna,
        nome: `Parte ${String.fromCharCode(65 + linha)}${coluna + 1}`,
      });
    }
  }
  return celulas;
}

interface CandidatoAvaliado {
  linhas: number;
  colunas: number;
  formato: number;
  distancia: number; // |formato - 1|
  celulas: Celula[];
}

// Escolhe a grade e devolve só as células que ficam (as cobertas em 60% ou mais por `elementos` saem). PURA.
export function montarGrade(
  larguraPx: number,
  alturaPx: number,
  elementos: RetFracao[],
  maxCelulas: number
): { linhas: number; colunas: number; celulas: Celula[] } {
  const limite = Math.max(MIN_CELULAS, Math.floor(maxCelulas));

  const todos: CandidatoAvaliado[] = [];
  for (let linhas = LADO_MIN; linhas <= LADO_MAX; linhas++) {
    for (let colunas = LADO_MIN; colunas <= LADO_MAX; colunas++) {
      const formato = (larguraPx / colunas) / (alturaPx / linhas);
      const celulas = celulasDaGrade(linhas, colunas).filter(
        (c) => fracaoCoberta(c, elementos) < LIMITE_COBERTO
      );
      todos.push({ linhas, colunas, formato, distancia: Math.abs(formato - 1), celulas });
    }
  }

  // Candidatos de formato aceitável; se nenhum, o de formato mais próximo de 1.
  let pool = todos.filter((c) => c.formato >= FORMATO_MIN && c.formato <= FORMATO_MAX);
  if (pool.length === 0) {
    const mais = todos.reduce((a, b) => (b.distancia < a.distancia ? b : a));
    pool = [mais];
  }

  // Mais células que caibam no limite; empate: formato mais próximo de 1.
  // Se nenhum couber, usa todos os candidatos (sempre há 2x2, com no máximo 4 células).
  let cabem = pool.filter((c) => c.celulas.length <= limite);
  if (cabem.length === 0) cabem = todos.filter((c) => c.celulas.length <= limite);
  if (cabem.length === 0) cabem = [todos.reduce((a, b) => (b.celulas.length < a.celulas.length ? b : a))];

  const escolhido = cabem.reduce((a, b) => {
    if (b.celulas.length !== a.celulas.length) return b.celulas.length > a.celulas.length ? b : a;
    return b.distancia < a.distancia ? b : a;
  });

  return { linhas: escolhido.linhas, colunas: escolhido.colunas, celulas: escolhido.celulas };
}

// Células livres de uma grade já existente (linhas x colunas fixas): em ordem de linha, sem as posições
// já ocupadas por células mantidas e sem as cobertas em 60% ou mais pelos `obstaculos`. PURA.
// Não corta pelo limite: o corte é feito depois de medir, com `escolherPrioritarias`.
export function celulasLivres(
  linhas: number,
  colunas: number,
  obstaculos: RetFracao[],
  ocupadas: { linha: number; coluna: number }[]
): Celula[] {
  return celulasDaGrade(linhas, colunas).filter(
    (c) =>
      !ocupadas.some((o) => o.linha === c.linha && o.coluna === c.coluna) &&
      fracaoCoberta(c, obstaculos) < LIMITE_COBERTO
  );
}

export interface Pontuada {
  problema: Problema;
  gravidade: number;
}

// Corta uma lista já medida até `maximo`: primeiro as com problema (gravidade decrescente), depois as sem
// problema, em ordem de linha. Devolve o resultado em ordem de linha (ordem original). PURA.
export function escolherPrioritarias<T extends Pontuada>(itens: T[], maximo: number): T[] {
  const limite = Math.max(0, Math.floor(maximo));
  if (itens.length <= limite) return itens;
  return itens
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => {
      const comProblemaA = a.item.problema !== 'NENHUM' ? 1 : 0;
      const comProblemaB = b.item.problema !== 'NENHUM' ? 1 : 0;
      if (comProblemaA !== comProblemaB) return comProblemaB - comProblemaA;
      if (a.item.gravidade !== b.item.gravidade) return b.item.gravidade - a.item.gravidade;
      return a.indice - b.indice;
    })
    .slice(0, limite)
    .sort((a, b) => a.indice - b.indice)
    .map((x) => x.item);
}

interface Medida {
  problema: Problema;
  gravidade: number;
  descricao: string;
}

const NENHUM_PROBLEMA: Medida = { problema: 'NENHUM', gravidade: 1, descricao: '' };

// Imagem decodificada uma vez (RGBA cru), para recortar as células sem decodificar o arquivo de novo.
interface ImagemCrua {
  dados: Buffer;
  largura: number;
  altura: number;
}

// Mede uma célula: recorta a imagem crua e roda a análise local. Falha vira NENHUM.
async function medirCelula(imagem: ImagemCrua, celula: Celula): Promise<Medida> {
  try {
    const ret = retanguloDaRegiao(celula, imagem.largura, imagem.altura);
    const recorte = await sharp(imagem.dados, {
      raw: { width: imagem.largura, height: imagem.altura, channels: 4 },
    })
      .extract({ left: ret.x, top: ret.y, width: ret.largura, height: ret.altura })
      .png()
      .toBuffer();
    const resultado = await analisarLocal(recorte);
    let melhor: (typeof resultado.problemas)[number] | null = null;
    for (const p of resultado.problemas) {
      if (p.codigo === 'BAIXA_RESOLUCAO') continue;
      if (!melhor || p.gravidade > melhor.gravidade) melhor = p;
    }
    if (melhor && melhor.gravidade >= 3) {
      return { problema: melhor.codigo, gravidade: melhor.gravidade, descricao: melhor.descricao };
    }
    return NENHUM_PROBLEMA;
  } catch {
    return NENHUM_PROBLEMA;
  }
}

// Medidas de todas as células, com concorrência limitada.
async function medirTodas(imagem: ImagemCrua, celulas: Celula[]): Promise<Medida[]> {
  const medidas: Medida[] = new Array(celulas.length);
  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    while (proximo < celulas.length) {
      const i = proximo++;
      medidas[i] = await medirCelula(imagem, celulas[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA_MEDICAO, celulas.length) }, () => trabalhador())
  );
  return medidas;
}

// Uma execução por projeto de cada vez: a segunda chamada espera a primeira terminar.
const emCurso = new Map<number, Promise<{ linhas: number; colunas: number }>>();

// Recria as células do projeto no banco. Devolve o tamanho da grade.
export function recriarGrade(projetoId: number): Promise<{ linhas: number; colunas: number }> {
  const anterior = emCurso.get(projetoId) ?? Promise.resolve(undefined);
  const atual = anterior
    .catch(() => undefined)
    .then(() => recriarGradeAgora(projetoId));
  emCurso.set(projetoId, atual);
  atual
    .catch(() => undefined)
    .then(() => {
      if (emCurso.get(projetoId) === atual) emCurso.delete(projetoId);
    });
  return atual;
}

async function recriarGradeAgora(projetoId: number): Promise<{ linhas: number; colunas: number }> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');

  const regioes = await prisma.regiao.findMany({
    where: { projetoId },
    include: { opcoes: { select: { id: true } }, vinculos: { select: { id: true } } },
  });

  const ehInteira = (r: { x: number; y: number; largura: number; altura: number }) =>
    r.x === 0 && r.y === 0 && r.largura === 1 && r.altura === 1;

  const elementos = regioes.filter((r) => r.classe === 'ELEMENTO' && r.status !== 'IGNORADA');
  // DEFEITO manual (que não seja a imagem inteira) também cobre células.
  const defeitosParciais = regioes.filter((r) => r.classe === 'DEFEITO' && !ehInteira(r));
  const mantidas = regioes.filter(
    (r) =>
      r.classe === 'CELULA' &&
      (r.status !== 'PENDENTE' || r.opcoes.length > 0 || r.vinculos.length > 0)
  );

  // Tudo que não é célula (qualquer status, imagem inteira e DEFEITO manual) mais as mantidas.
  const outras = regioes.filter((r) => r.classe !== 'CELULA').length;
  const maxCelulas = MAX_PARTES - outras - mantidas.length;

  const obstaculos: RetFracao[] = [...elementos, ...defeitosParciais].map((r) => ({
    x: r.x,
    y: r.y,
    largura: r.largura,
    altura: r.altura,
  }));

  // Com célula mantida e grade já montada: reusa linhas x colunas e gera só as posições livres.
  // Senão, escolhe grade nova (as mantidas, se houver, entram como obstáculo).
  const reutilizar = projeto.gradeLinhas > 0 && mantidas.length > 0;
  let linhas: number;
  let colunas: number;
  let candidatas: Celula[];
  if (reutilizar) {
    linhas = projeto.gradeLinhas;
    colunas = projeto.gradeColunas;
    candidatas = celulasLivres(
      linhas,
      colunas,
      obstaculos,
      mantidas.map((m) => ({ linha: m.linha ?? -1, coluna: m.coluna ?? -1 }))
    );
  } else {
    const obstaculosNovaGrade =
      mantidas.length > 0
        ? [...obstaculos, ...mantidas.map((m) => ({ x: m.x, y: m.y, largura: m.largura, altura: m.altura }))]
        : obstaculos;
    const grade = montarGrade(projeto.largura, projeto.altura, obstaculosNovaGrade, maxCelulas);
    linhas = grade.linhas;
    colunas = grade.colunas;
    candidatas = grade.celulas;
  }

  // Lê e decodifica a imagem uma vez. Erro aqui acontece antes de qualquer gravação.
  let medidas: Medida[] = [];
  if (candidatas.length > 0) {
    const conteudo = await lerArquivo(projeto.atualArquivo);
    const { data, info } = await sharp(conteudo)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const imagem: ImagemCrua = { dados: data, largura: info.width, altura: info.height };
    medidas = await medirTodas(imagem, candidatas);
  }

  // Mede tudo antes de cortar: se passar do limite, fica com as que têm problema e completa com as demais.
  const medidasNaGrade = candidatas.map((celula, indice) => ({
    celula,
    ...(medidas[indice] ?? NENHUM_PROBLEMA),
  }));
  const escolhidas = reutilizar
    ? escolherPrioritarias(medidasNaGrade, maxCelulas)
    : medidasNaGrade;

  const novas = escolhidas.map(({ celula, problema, gravidade, descricao }, indice) => ({
    projetoId,
    nome: celula.nome,
    x: celula.x,
    y: celula.y,
    largura: celula.largura,
    altura: celula.altura,
    classe: 'CELULA',
    categoria: 'OUTRO',
    origem: 'LOCAL',
    linha: celula.linha,
    coluna: celula.coluna,
    problema,
    gravidade,
    descricao,
    selecionada: problema !== 'NENHUM',
    ordem: 100 + indice,
  }));

  // Gravação atômica: apaga as pendentes sem opções nem vínculos, não cria posição já ocupada por
  // célula que sobrou, e grava a grade.
  await prisma.$transaction(async (tx) => {
    await tx.regiao.deleteMany({
      where: {
        projetoId,
        classe: 'CELULA',
        status: 'PENDENTE',
        opcoes: { none: {} },
        vinculos: { none: {} },
      },
    });
    const sobraram = await tx.regiao.findMany({
      where: { projetoId, classe: 'CELULA' },
      select: { linha: true, coluna: true },
    });
    const ocupadas = new Set(sobraram.map((r) => `${r.linha}:${r.coluna}`));
    const criar = novas.filter((n) => !ocupadas.has(`${n.linha}:${n.coluna}`));
    if (criar.length > 0) await tx.regiao.createMany({ data: criar });
    await tx.projeto.update({
      where: { id: projetoId },
      data: { gradeLinhas: linhas, gradeColunas: colunas },
    });
  });

  return { linhas, colunas };
}
