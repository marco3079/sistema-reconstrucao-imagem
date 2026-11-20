import sharp from 'sharp';
import { HttpError } from './erros';

export type Problema =
  | 'FALTANDO'
  | 'DANIFICADO'
  | 'BORRADO'
  | 'RUIDO'
  | 'DESBOTADO'
  | 'BAIXA_RESOLUCAO'
  | 'EXPOSICAO'
  | 'OUTRO'
  | 'NENHUM';

export const PROBLEMAS: Problema[] = [
  'FALTANDO',
  'DANIFICADO',
  'BORRADO',
  'RUIDO',
  'DESBOTADO',
  'BAIXA_RESOLUCAO',
  'EXPOSICAO',
  'OUTRO',
];

export interface Metricas {
  largura: number;
  altura: number;
  megapixels: number;
  nitidez: number; // 0 a 100
  ruido: number; // 0 a 100 (maior = mais ruído)
  contraste: number; // 0 a 100
  saturacao: number; // 0 a 100
  exposicao: number; // 0 a 100 (50 = ideal)
  temAlfa: boolean;
  tonsDeCinza: boolean;
}

export interface ProblemaGlobal {
  codigo: Problema;
  gravidade: number; // 1 a 5
  descricao: string;
}

// Região sugerida, em frações (0 a 1) da imagem.
export interface RegiaoSugerida {
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  problema: Problema;
  gravidade: number;
  descricao: string;
}

export interface ResultadoLocal {
  metricas: Metricas;
  qualidade: number; // 0 a 100
  problemas: ProblemaGlobal[];
  regioes: RegiaoSugerida[];
}

const GRADE = 8;
const LIMITE_ALFA_VAZIO = 16;

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function arredondar2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

// Lê a imagem e devolve a cópia de trabalho em RGBA (até 512 px no maior lado).
async function lerImagem(conteudo: Buffer) {
  try {
    const meta = await sharp(conteudo).metadata();
    const copia = await sharp(conteudo)
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { meta, rgba: copia.data, w: copia.info.width, h: copia.info.height };
  } catch {
    throw new HttpError(400, 'Arquivo não é uma imagem válida');
  }
}

function descreverPosicao(cx: number, cy: number): string {
  const vertical = cy < 1 / 3 ? 'superior' : cy > 2 / 3 ? 'inferior' : 'central';
  const horizontal = cx < 1 / 3 ? 'esquerdo' : cx > 2 / 3 ? 'direito' : 'centro';
  if (vertical !== 'central' && horizontal !== 'centro') return `no canto ${vertical} ${horizontal}`;
  if (vertical === 'central' && horizontal === 'centro') return 'no centro da imagem';
  if (vertical === 'central') return `no lado ${horizontal}`;
  return `na parte ${vertical}`;
}

type MarcaCelula = 'FALTANDO' | 'BORRADO';

interface Celula {
  fracTransparente: number;
  fracBranco: number;
  fracPreto: number;
  desvio: number;
  varLapCelula: number;
}

interface Componente {
  problema: MarcaCelula;
  celulas: number;
  colMin: number;
  colMax: number;
  linMin: number;
  linMax: number;
  rect: Retangulo; // frações da imagem (refinado para FALTANDO)
}

interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

function arredondar4(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

type TipoVazio = 'transparente' | 'branco' | 'preto';

// Pixel vazio do tipo pedido (alfa < 16 para transparente; branco/preto só com alfa >= 16).
function ehVazio(rgba: Buffer, i: number, tipo: TipoVazio): boolean {
  const k = i * 4;
  const a = rgba[k + 3];
  if (tipo === 'transparente') return a < LIMITE_ALFA_VAZIO;
  if (a < LIMITE_ALFA_VAZIO) return false;
  const r = rgba[k];
  const g = rgba[k + 1];
  const b = rgba[k + 2];
  return tipo === 'branco' ? r >= 250 && g >= 250 && b >= 250 : r <= 5 && g <= 5 && b <= 5;
}

// Ajusta o retângulo de uma região FALTANDO à área vazia real, por projeção de colunas e linhas.
// Se nenhuma coluna ou linha passar no limiar, devolve o retângulo da grade.
function refinarFaltando(
  membros: number[],
  colMin: number,
  colMax: number,
  linMin: number,
  linMax: number,
  celulas: Celula[],
  rgba: Buffer,
  w: number,
  h: number
): Retangulo {
  const grade: Retangulo = {
    x: colMin / GRADE,
    y: linMin / GRADE,
    largura: (colMax - colMin + 1) / GRADE,
    altura: (linMax - linMin + 1) / GRADE,
  };

  // Tipo do vazio: o que predomina nas células do componente.
  let somaTransp = 0;
  let somaBranco = 0;
  let somaPreto = 0;
  for (const i of membros) {
    somaTransp += celulas[i].fracTransparente;
    somaBranco += celulas[i].fracBranco;
    somaPreto += celulas[i].fracPreto;
  }
  const tipo: TipoVazio =
    somaTransp >= somaBranco && somaTransp >= somaPreto ? 'transparente' : somaBranco >= somaPreto ? 'branco' : 'preto';

  // Área de busca: o componente ampliado em uma célula para cada lado.
  const cA = Math.max(0, colMin - 1);
  const cB = Math.min(GRADE - 1, colMax + 1);
  const lA = Math.max(0, linMin - 1);
  const lB = Math.min(GRADE - 1, linMax + 1);
  const sx0 = Math.floor((cA * w) / GRADE);
  const sx1 = Math.floor(((cB + 1) * w) / GRADE);
  const sy0 = Math.floor((lA * h) / GRADE);
  const sy1 = Math.floor(((lB + 1) * h) / GRADE);
  if (sx1 <= sx0 || sy1 <= sy0) return grade;
  const larguraArea = sx1 - sx0;
  const alturaArea = sy1 - sy0;

  // Colunas e linhas em que pelo menos 30% dos pixels da área são vazios.
  const colunas: number[] = [];
  for (let x = sx0; x < sx1; x++) {
    let cont = 0;
    for (let y = sy0; y < sy1; y++) if (ehVazio(rgba, y * w + x, tipo)) cont++;
    if (cont / alturaArea >= 0.3) colunas.push(x);
  }
  const linhas: number[] = [];
  for (let y = sy0; y < sy1; y++) {
    let cont = 0;
    for (let x = sx0; x < sx1; x++) if (ehVazio(rgba, y * w + x, tipo)) cont++;
    if (cont / larguraArea >= 0.3) linhas.push(y);
  }
  if (colunas.length === 0 || linhas.length === 0) return grade;

  const x0 = colunas[0];
  const x1 = colunas[colunas.length - 1] + 1;
  const y0 = linhas[0];
  const y1 = linhas[linhas.length - 1] + 1;
  // Margem de 2 px da cópia de trabalho para cada lado, limitada à imagem.
  const ex0 = Math.max(0, x0 - 2);
  const ex1 = Math.min(w, x1 + 2);
  const ey0 = Math.max(0, y0 - 2);
  const ey1 = Math.min(h, y1 + 2);
  return {
    x: arredondar4(ex0 / w),
    y: arredondar4(ey0 / h),
    largura: arredondar4((ex1 - ex0) / w),
    altura: arredondar4((ey1 - ey0) / h),
  };
}

// Mede a imagem com o sharp (sem IA) e sugere regiões com defeito.
export async function analisarLocal(conteudo: Buffer): Promise<ResultadoLocal> {
  const { meta, rgba, w, h } = await lerImagem(conteudo);
  const n = w * h;

  // Cinza, saturação, alfa e contagens globais.
  const cinza = new Float32Array(n);
  let somaCinza = 0;
  let somaCinza2 = 0;
  let somaSaturacao = 0;
  let temAlfaPixel = false;
  let brancoGlobal = 0;
  let pretoGlobal = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const r = rgba[k];
    const g = rgba[k + 1];
    const b = rgba[k + 2];
    const a = rgba[k + 3];
    const c = 0.299 * r + 0.587 * g + 0.114 * b;
    cinza[i] = c;
    somaCinza += c;
    somaCinza2 += c * c;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    somaSaturacao += (mx - mn) / Math.max(1, mx);
    if (a < 250) temAlfaPixel = true;
    if (a >= LIMITE_ALFA_VAZIO) {
      if (r >= 250 && g >= 250 && b >= 250) brancoGlobal++;
      if (r <= 5 && g <= 5 && b <= 5) pretoGlobal++;
    }
  }

  // Laplaciano (nitidez) e Immerkaer (ruído) nos pixels internos.
  const lap = new Float32Array(n);
  let somaL = 0;
  let somaL2 = 0;
  let nL = 0;
  let somaN = 0;
  let nN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const L = 4 * cinza[i] - cinza[i - w] - cinza[i + w] - cinza[i - 1] - cinza[i + 1];
      lap[i] = L;
      somaL += L;
      somaL2 += L * L;
      nL++;
      const N =
        cinza[i - w - 1] - 2 * cinza[i - w] + cinza[i - w + 1] -
        2 * cinza[i - 1] + 4 * cinza[i] - 2 * cinza[i + 1] +
        cinza[i + w - 1] - 2 * cinza[i + w] + cinza[i + w + 1];
      somaN += Math.abs(N);
      nN++;
    }
  }
  const varLap = nL > 0 ? Math.max(0, somaL2 / nL - (somaL / nL) ** 2) : 0;
  const nitidez = limitar(Math.round((100 * varLap) / (varLap + 150)), 0, 100);
  const sigma = (Math.sqrt(Math.PI / 2) / 6) * (nN > 0 ? somaN / nN : 0);
  const ruido = limitar(Math.round(sigma * 5), 0, 100);

  const mediaCinza = somaCinza / n;
  const desvioGlobal = Math.sqrt(Math.max(0, somaCinza2 / n - mediaCinza * mediaCinza));
  const contraste = limitar(Math.round((desvioGlobal / 64) * 100), 0, 100);
  const exposicao = limitar(Math.round((mediaCinza / 255) * 100), 0, 100);
  const saturacao = limitar(Math.round((somaSaturacao / n) * 100), 0, 100);
  const tonsDeCinza = saturacao < 4;
  const temAlfa = meta.hasAlpha === true && temAlfaPixel;
  const largura = meta.width ?? w;
  const altura = meta.height ?? h;
  const megapixels = arredondar2((largura * altura) / 1e6);

  // Grade de 8 x 8 células.
  const celulas: Celula[] = [];
  for (let lin = 0; lin < GRADE; lin++) {
    for (let col = 0; col < GRADE; col++) {
      const x0 = Math.min(w - 1, Math.floor((col * w) / GRADE));
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * w) / GRADE));
      const y0 = Math.min(h - 1, Math.floor((lin * h) / GRADE));
      const y1 = Math.max(y0 + 1, Math.floor(((lin + 1) * h) / GRADE));
      let total = 0;
      let transparente = 0;
      let branco = 0;
      let preto = 0;
      let soma = 0;
      let soma2 = 0;
      let nl = 0;
      let sl = 0;
      let sl2 = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const k = i * 4;
          const a = rgba[k + 3];
          const c = cinza[i];
          total++;
          soma += c;
          soma2 += c * c;
          if (a < LIMITE_ALFA_VAZIO) {
            transparente++;
          } else {
            const r = rgba[k];
            const g = rgba[k + 1];
            const b = rgba[k + 2];
            if (r >= 250 && g >= 250 && b >= 250) branco++;
            if (r <= 5 && g <= 5 && b <= 5) preto++;
          }
          if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
            nl++;
            sl += lap[i];
            sl2 += lap[i] * lap[i];
          }
        }
      }
      const mc = soma / total;
      celulas.push({
        fracTransparente: transparente / total,
        fracBranco: branco / total,
        fracPreto: preto / total,
        desvio: Math.sqrt(Math.max(0, soma2 / total - mc * mc)),
        varLapCelula: nl > 1 ? Math.max(0, sl2 / nl - (sl / nl) ** 2) : 0,
      });
    }
  }
  const fracBrancoGlobal = brancoGlobal / n;
  const fracPretoGlobal = pretoGlobal / n;
  const medianaVarLap = mediana(celulas.map((c) => c.varLapCelula));

  // Marcação de cada célula (no máximo um problema, nesta ordem).
  const marcas: (MarcaCelula | null)[] = celulas.map((c) => {
    if (c.fracTransparente > 0.5) return 'FALTANDO';
    if (
      (c.fracBranco > 0.9 && c.desvio < 3 && fracBrancoGlobal < 0.3) ||
      (c.fracPreto > 0.9 && c.desvio < 3 && fracPretoGlobal < 0.3)
    ) {
      return 'FALTANDO';
    }
    if (nitidez >= 30 && c.desvio > 10 && c.varLapCelula < 0.2 * medianaVarLap) return 'BORRADO';
    return null;
  });

  // Componentes conexos (4 direções) com o mesmo problema.
  const visitado = new Array<boolean>(GRADE * GRADE).fill(false);
  const componentes: Componente[] = [];
  for (let s = 0; s < GRADE * GRADE; s++) {
    const marca = marcas[s];
    if (!marca || visitado[s]) continue;
    const pilha = [s];
    visitado[s] = true;
    const membros: number[] = [];
    while (pilha.length > 0) {
      const atual = pilha.pop() as number;
      membros.push(atual);
      const col = atual % GRADE;
      const lin = Math.floor(atual / GRADE);
      const vizinhos: number[] = [];
      if (col > 0) vizinhos.push(atual - 1);
      if (col < GRADE - 1) vizinhos.push(atual + 1);
      if (lin > 0) vizinhos.push(atual - GRADE);
      if (lin < GRADE - 1) vizinhos.push(atual + GRADE);
      for (const v of vizinhos) {
        if (!visitado[v] && marcas[v] === marca) {
          visitado[v] = true;
          pilha.push(v);
        }
      }
    }
    const cols = membros.map((i) => i % GRADE);
    const lins = membros.map((i) => Math.floor(i / GRADE));
    const colMin = Math.min(...cols);
    const colMax = Math.max(...cols);
    const linMin = Math.min(...lins);
    const linMax = Math.max(...lins);
    const rect =
      marca === 'FALTANDO'
        ? refinarFaltando(membros, colMin, colMax, linMin, linMax, celulas, rgba, w, h)
        : {
            x: colMin / GRADE,
            y: linMin / GRADE,
            largura: (colMax - colMin + 1) / GRADE,
            altura: (linMax - linMin + 1) / GRADE,
          };
    componentes.push({
      problema: marca,
      celulas: membros.length,
      colMin,
      colMax,
      linMin,
      linMax,
      rect,
    });
  }
  // Descarte pelo retângulo já refinado (mais de 85% da imagem).
  const validos = componentes.filter((c) => c.rect.largura * c.rect.altura <= 0.85);
  validos.sort((a, b) => b.celulas - a.celulas);
  const escolhidos = validos.slice(0, 6);

  const contadores: Record<MarcaCelula, number> = { FALTANDO: 0, BORRADO: 0 };
  const regioesLocais: RegiaoSugerida[] = escolhidos.map((comp) => {
    const { x, y, largura: larguraReg, altura: alturaReg } = comp.rect;
    const pos = descreverPosicao(x + larguraReg / 2, y + alturaReg / 2);
    contadores[comp.problema]++;
    const numero = contadores[comp.problema];
    if (comp.problema === 'FALTANDO') {
      return {
        nome: `Parte faltando ${numero}`,
        x,
        y,
        largura: larguraReg,
        altura: alturaReg,
        problema: 'FALTANDO',
        gravidade: comp.celulas >= 4 ? 5 : 4,
        descricao: `Área vazia ${pos}`,
      };
    }
    return {
      nome: `Área borrada ${numero}`,
      x,
      y,
      largura: larguraReg,
      altura: alturaReg,
      problema: 'BORRADO',
      gravidade: 3,
      descricao: `Área pouco nítida ${pos}`,
    };
  });

  // Problemas globais.
  const globais: ProblemaGlobal[] = [];
  if (megapixels < 0.5) {
    globais.push({ codigo: 'BAIXA_RESOLUCAO', gravidade: 4, descricao: `Resolução muito baixa: ${megapixels} MP` });
  } else if (megapixels < 1) {
    globais.push({ codigo: 'BAIXA_RESOLUCAO', gravidade: 2, descricao: `Resolução baixa: ${megapixels} MP` });
  }
  if (nitidez < 30) {
    globais.push({
      codigo: 'BORRADO',
      gravidade: nitidez < 15 ? 4 : 3,
      descricao: `Imagem desfocada (nitidez ${nitidez}/100)`,
    });
  }
  if (ruido > 35) {
    globais.push({
      codigo: 'RUIDO',
      gravidade: ruido > 60 ? 4 : 3,
      descricao: `Ruído visível (${ruido}/100)`,
    });
  }
  if (contraste < 25 || (!tonsDeCinza && saturacao < 12)) {
    globais.push({
      codigo: 'DESBOTADO',
      gravidade: 3,
      descricao: `Cores e contraste fracos (contraste ${contraste}/100, saturação ${saturacao}/100)`,
    });
  }
  if (exposicao < 25) {
    globais.push({ codigo: 'EXPOSICAO', gravidade: 3, descricao: `Imagem escura (exposição ${exposicao}/100)` });
  } else if (exposicao > 80) {
    globais.push({ codigo: 'EXPOSICAO', gravidade: 3, descricao: `Imagem clara (exposição ${exposicao}/100)` });
  }

  let regioes: RegiaoSugerida[] = [...regioesLocais];
  if (globais.length > 0) {
    const maior = globais.reduce((a, b) => (b.gravidade > a.gravidade ? b : a));
    regioes = [
      {
        nome: 'Imagem inteira',
        x: 0,
        y: 0,
        largura: 1,
        altura: 1,
        problema: maior.codigo,
        gravidade: maior.gravidade,
        descricao: globais.map((g) => g.descricao).join('; '),
      },
      ...regioesLocais,
    ];
  }

  const penalGlobal = globais.reduce((soma, g) => soma + g.gravidade * 6, 0);
  const qualidade = limitar(100 - penalGlobal - 4 * regioesLocais.length, 5, 100);

  return {
    metricas: {
      largura,
      altura,
      megapixels,
      nitidez,
      ruido,
      contraste,
      saturacao,
      exposicao,
      temAlfa,
      tonsDeCinza,
    },
    qualidade,
    problemas: globais,
    regioes,
  };
}
