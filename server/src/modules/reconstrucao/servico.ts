// Reconstrução de regiões: filtros locais (sharp) e opções do Canva. Dono: g05.

import sharp from 'sharp';
import type { Opcao, Prisma, Projeto, Regiao } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { apagarArquivo, lerArquivo, salvarArquivo } from '../../lib/arquivos';
import { compor, contextoDaRegiao, recortar, retanguloDaRegiao } from '../../lib/imagem';
import type { Retangulo } from '../../lib/imagem';
import { enviarImagemAoCanva, gerarImagemNoCanva, proporcaoMaisProxima } from '../../lib/canva';
import { proximoNumeroDeVersao, recalcularStatusDoProjeto } from '../../lib/acesso';
import { criarTrabalho, registrarEvento } from '../agentes/servico';
import { cenaDoProjeto, recorteDeProfundidade } from '../cena/servico';
import { textoDePerspectiva } from '../../lib/cena';

export interface FiltroLocal {
  codigo: string; // NITIDEZ | RUIDO | COR | CONTRASTE | EXPOSICAO | AMPLIAR | PREENCHER
  rotulo: string;
  indicadoPara: string[]; // códigos de problema
}

// Lista dos filtros locais disponíveis.
export const FILTROS_LOCAIS: FiltroLocal[] = [
  { codigo: 'NITIDEZ', rotulo: 'Nitidez', indicadoPara: ['BORRADO', 'BAIXA_RESOLUCAO', 'OUTRO'] },
  { codigo: 'DETALHE', rotulo: 'Realce de detalhe', indicadoPara: ['BORRADO', 'BAIXA_RESOLUCAO'] },
  { codigo: 'RUIDO', rotulo: 'Redução de ruído', indicadoPara: ['RUIDO', 'DANIFICADO'] },
  { codigo: 'COR', rotulo: 'Cor e saturação', indicadoPara: ['DESBOTADO', 'OUTRO'] },
  { codigo: 'CONTRASTE', rotulo: 'Contraste', indicadoPara: ['DESBOTADO', 'EXPOSICAO'] },
  { codigo: 'EXPOSICAO', rotulo: 'Exposição', indicadoPara: ['EXPOSICAO'] },
  { codigo: 'PREENCHER', rotulo: 'Preenchimento suave (provisório)', indicadoPara: ['FALTANDO', 'DANIFICADO'] },
];

// Retângulo da região em pixels, relativo ao recorte de contexto.
interface RegiaoNoRecorte {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

// Preenche a região por difusão (pull-push) a partir dos pixels conhecidos ao redor.
// Os pixels conhecidos fora da região são mantidos. Devolve PNG sem alfa, do tamanho do recorte.
async function preencherPorDifusao(recorte: Buffer, reg: RegiaoNoRecorte, intensidade: 1 | 2 | 3): Promise<Buffer> {
  const i = intensidade - 1;
  const meta = await sharp(recorte).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const bruto = await sharp(recorte).ensureAlpha().raw().toBuffer(); // W*H*4

  const dentroRegiao = (px: number, py: number): boolean =>
    px >= reg.x && px < reg.x + reg.largura && py >= reg.y && py < reg.y + reg.altura;

  // Grade reduzida para a difusão.
  const e = Math.min(1, 256 / Math.max(W, H));
  const w = Math.max(2, Math.round(W * e));
  const h = Math.max(2, Math.round(H * e));
  const rgba = await sharp(recorte).ensureAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const rx0 = Math.floor(reg.x * e);
  const ry0 = Math.floor(reg.y * e);
  const rx1 = Math.ceil((reg.x + reg.largura) * e);
  const ry1 = Math.ceil((reg.y + reg.altura) * e);
  const foraReduzida = (px: number, py: number): boolean => !(px >= rx0 && px < rx1 && py >= ry0 && py < ry1);

  let temForaDaRegiao = false;
  let temAlgum = false;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (rgba[(py * w + px) * 4 + 3] >= 128) {
        temAlgum = true;
        if (foraReduzida(px, py)) temForaDaRegiao = true;
      }
    }
  }
  if (!temAlgum) return sharp(recorte).removeAlpha().png().toBuffer();
  // Se a região cobre o recorte inteiro, "conhecido" é só o alfa.
  const apenasAlfa = !temForaDaRegiao;

  const n = w * h;
  const p0 = new Float32Array(n);
  const r0 = new Float32Array(n);
  const g0 = new Float32Array(n);
  const b0 = new Float32Array(n);
  let somaR = 0;
  let somaG = 0;
  let somaB = 0;
  let cont = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const conhecido = rgba[idx * 4 + 3] >= 128 && (apenasAlfa || foraReduzida(px, py));
      if (!conhecido) continue;
      p0[idx] = 1;
      r0[idx] = rgba[idx * 4];
      g0[idx] = rgba[idx * 4 + 1];
      b0[idx] = rgba[idx * 4 + 2];
      somaR += r0[idx];
      somaG += g0[idx];
      somaB += b0[idx];
      cont++;
    }
  }
  const mediaR = somaR / cont;
  const mediaG = somaG / cont;
  const mediaB = somaB / cont;

  // Pirâmide: cada célula soma os até 4 filhos.
  type Nivel = { w: number; h: number; p: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array };
  const niveis: Nivel[] = [{ w, h, p: p0, r: r0, g: g0, b: b0 }];
  while (Math.min(niveis[niveis.length - 1].w, niveis[niveis.length - 1].h) > 1) {
    const atual = niveis[niveis.length - 1];
    const nw = Math.ceil(atual.w / 2);
    const nh = Math.ceil(atual.h / 2);
    const novo: Nivel = {
      w: nw,
      h: nh,
      p: new Float32Array(nw * nh),
      r: new Float32Array(nw * nh),
      g: new Float32Array(nw * nh),
      b: new Float32Array(nw * nh),
    };
    for (let y = 0; y < atual.h; y++) {
      for (let x = 0; x < atual.w; x++) {
        const si = y * atual.w + x;
        const di = (y >> 1) * nw + (x >> 1);
        novo.p[di] += atual.p[si];
        novo.r[di] += atual.r[si];
        novo.g[di] += atual.g[si];
        novo.b[di] += atual.b[si];
      }
    }
    niveis.push(novo);
  }

  // Descida: do mais grosso ao mais fino, preenchendo as células vazias com a cor do pai.
  for (let l = niveis.length - 1; l >= 0; l--) {
    const N = niveis[l];
    for (let y = 0; y < N.h; y++) {
      for (let x = 0; x < N.w; x++) {
        const idx = y * N.w + x;
        if (N.p[idx] === 0) {
          if (l === niveis.length - 1) {
            N.r[idx] = mediaR;
            N.g[idx] = mediaG;
            N.b[idx] = mediaB;
          } else {
            const pai = niveis[l + 1];
            const pidx = (y >> 1) * pai.w + (x >> 1);
            N.r[idx] = pai.r[pidx];
            N.g[idx] = pai.g[pidx];
            N.b[idx] = pai.b[pidx];
          }
          N.p[idx] = 1;
        } else {
          const pesoCel = N.p[idx];
          N.r[idx] /= pesoCel;
          N.g[idx] /= pesoCel;
          N.b[idx] /= pesoCel;
          N.p[idx] = 1;
        }
      }
    }
  }

  // Nível 0 em RGB (pixels conhecidos mantêm a cor; os demais, a cor preenchida).
  const nivel0 = niveis[0];
  const rgb = Buffer.alloc(w * h * 3);
  for (let idx = 0; idx < w * h; idx++) {
    rgb[idx * 3] = Math.max(0, Math.min(255, Math.round(nivel0.r[idx])));
    rgb[idx * 3 + 1] = Math.max(0, Math.min(255, Math.round(nivel0.g[idx])));
    rgb[idx * 3 + 2] = Math.max(0, Math.min(255, Math.round(nivel0.b[idx])));
  }
  const sigma = Math.min(200, Math.max(1, ([1.5, 3, 5][i] / Math.max(e, 0.05)) * 0.5));
  const suavizada = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .resize(W, H, { fit: 'fill', kernel: 'cubic' })
    .blur(sigma)
    .removeAlpha()
    .png()
    .toBuffer();

  // Pixels conhecidos fora da região voltam a ser os originais (resolução total).
  const preRaw = await sharp(suavizada).removeAlpha().raw().toBuffer(); // W*H*3
  const saida = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      const conhecidoOriginal = bruto[idx * 4 + 3] >= 128 && (apenasAlfa || !dentroRegiao(px, py));
      const origem = conhecidoOriginal ? bruto : preRaw;
      const deslocamento = conhecidoOriginal ? idx * 4 : idx * 3;
      saida[idx * 3] = origem[deslocamento];
      saida[idx * 3 + 1] = origem[deslocamento + 1];
      saida[idx * 3 + 2] = origem[deslocamento + 2];
    }
  }
  return sharp(saida, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

// Aplica um filtro local ao recorte. Devolve PNG com o mesmo tamanho do recorte.
// `regiaoNoContexto` é a região em pixels, relativa ao recorte (x e y a partir do canto do recorte).
export async function aplicarFiltro(
  codigo: string,
  recorte: Buffer,
  intensidade: 1 | 2 | 3,
  regiaoNoContexto: RegiaoNoRecorte
): Promise<Buffer> {
  const i = intensidade - 1;
  switch (codigo) {
    case 'NITIDEZ':
      return sharp(recorte).removeAlpha().sharpen({ sigma: [0.8, 1.2, 1.8][i] }).png().toBuffer();
    case 'DETALHE': {
      const metadata = await sharp(recorte).metadata();
      const w = metadata.width ?? 1;
      const h = metadata.height ?? 1;
      const ampliada = await sharp(recorte)
        .removeAlpha()
        .resize(w * 2, h * 2, { kernel: 'lanczos3' })
        .sharpen({ sigma: [1, 1.4, 2][i] })
        .png()
        .toBuffer();
      return sharp(ampliada).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
    }
    case 'RUIDO': {
      let imagem = sharp(recorte).removeAlpha().median([3, 3, 5][i]);
      if (i >= 1) imagem = imagem.sharpen({ sigma: 0.6 });
      return imagem.png().toBuffer();
    }
    case 'COR':
      return sharp(recorte).removeAlpha().normalise().modulate({ saturation: [1.1, 1.25, 1.45][i] }).png().toBuffer();
    case 'CONTRASTE': {
      const a = [1.1, 1.2, 1.35][i];
      return sharp(recorte).removeAlpha().linear(a, -(128 * (a - 1))).png().toBuffer();
    }
    case 'EXPOSICAO': {
      const stats = await sharp(recorte).stats();
      const canais = stats.channels.slice(0, 3);
      const media = canais.reduce((soma, canal) => soma + canal.mean, 0) / canais.length;
      const alvo = Math.min(1.8, Math.max(0.6, 128 / Math.max(media, 1)));
      const fator = 1 + (alvo - 1) * [0.5, 0.75, 1][i];
      return sharp(recorte).removeAlpha().modulate({ brightness: fator }).png().toBuffer();
    }
    case 'PREENCHER':
      return preencherPorDifusao(recorte, regiaoNoContexto, intensidade);
    default:
      throw new HttpError(400, 'Filtro desconhecido: ' + codigo);
  }
}

// Converte um retângulo para o formato JSON guardado em parametros.
function paraJson(r: Retangulo): { x: number; y: number; largura: number; altura: number } {
  return { x: r.x, y: r.y, largura: r.largura, altura: r.altura };
}

// Contexto da região; se a região cobre a imagem inteira, o contexto é a própria região.
function contextoDaRegiaoNoProjeto(ret: Retangulo, projeto: Projeto): Retangulo {
  if (ret.x === 0 && ret.y === 0 && ret.largura === projeto.largura && ret.altura === projeto.altura) return ret;
  return contextoDaRegiao(ret, projeto.largura, projeto.altura);
}

// Carrega região, projeto, imagem atual e os retângulos (região e contexto) em pixels.
async function carregar(regiaoId: number) {
  const regiao = await prisma.regiao.findUnique({ where: { id: regiaoId }, include: { projeto: true } });
  if (!regiao) throw new HttpError(404, 'Região não encontrada');
  const projeto = regiao.projeto;
  const atual = await lerArquivo(projeto.atualArquivo);
  const ret = retanguloDaRegiao(regiao, projeto.largura, projeto.altura);
  const contexto = contextoDaRegiaoNoProjeto(ret, projeto);
  return { regiao, projeto, atual, ret, contexto };
}

// Marca a região como EM_ANDAMENTO quando a primeira opção é criada.
async function marcarEmAndamento(regiao: Regiao): Promise<void> {
  if (regiao.status !== 'PENDENTE') return;
  await prisma.regiao.update({ where: { id: regiao.id }, data: { status: 'EM_ANDAMENTO' } });
  await recalcularStatusDoProjeto(regiao.projetoId);
}

// Gera opções locais (uma por filtro) para a região e devolve as criadas, já PRONTA.
// Sem `filtros`, usa os indicados para o problema da região. Intensidade de 1 a 3 (padrão 2).
export async function gerarOpcoesLocais(regiaoId: number, filtros?: string[], intensidade = 2, rodada = 1): Promise<Opcao[]> {
  const nivel = Math.min(3, Math.max(1, Math.round(intensidade))) as 1 | 2 | 3;
  const { regiao, projeto, atual, ret, contexto } = await carregar(regiaoId);

  let codigos: string[];
  if (filtros && filtros.length > 0) {
    const validos = new Set(FILTROS_LOCAIS.map((f) => f.codigo));
    const desconhecidos = filtros.filter((c) => !validos.has(c));
    if (desconhecidos.length > 0) throw new HttpError(400, 'Filtro desconhecido: ' + desconhecidos.join(', '));
    codigos = filtros;
  } else {
    codigos = FILTROS_LOCAIS.filter((f) => f.indicadoPara.includes(regiao.problema)).map((f) => f.codigo);
    if (codigos.length === 0) codigos = ['NITIDEZ', 'COR'];
  }

  const recorte = await recortar(atual, contexto);
  const criadas: Opcao[] = [];
  for (const codigo of codigos) {
    const filtro = FILTROS_LOCAIS.find((f) => f.codigo === codigo);
    if (!filtro) throw new HttpError(400, 'Filtro desconhecido: ' + codigo);
    const buffer = await aplicarFiltro(codigo, recorte, nivel, {
      x: ret.x - contexto.x,
      y: ret.y - contexto.y,
      largura: ret.largura,
      altura: ret.altura,
    });
    const arquivo = await salvarArquivo(buffer, 'png');
    const opcao = await prisma.opcao.create({
      data: {
        projetoId: projeto.id,
        regiaoId: regiao.id,
        origem: 'LOCAL',
        rotulo: `${filtro.rotulo} (intensidade ${nivel})`,
        parametros: { contexto: paraJson(contexto), regiao: paraJson(ret), filtro: codigo, intensidade: nivel },
        arquivo,
        status: 'PRONTA',
        rodada,
      },
    });
    criadas.push(opcao);
  }
  await marcarEmAndamento(regiao);
  return criadas;
}

// Texto padrão para pedir ao Canva a correção de uma região.
const PROBLEMA_EM_INGLES: Record<string, string> = {
  FALTANDO: 'missing content that must be recreated so it blends seamlessly with the surroundings',
  DANIFICADO: 'physical damage, scratches, tears or stains to remove',
  BORRADO: 'blur; make it sharp and detailed',
  RUIDO: 'noise and grain to remove while keeping detail',
  DESBOTADO: 'faded colors; restore natural color and contrast',
  BAIXA_RESOLUCAO: 'low resolution; add realistic fine detail',
  EXPOSICAO: 'bad exposure; balance the light',
  OUTRO: 'general quality issues',
};

export function promptPadrao(projeto: Projeto, regiao: Regiao, instrucoes?: string): string {
  const analise = projeto.analise as { descricao?: string } | null;
  const descricao = analise && typeof analise.descricao === 'string' ? analise.descricao : '';
  const partes: string[] = [
    'Restore this image region faithfully. Keep the same composition, framing, perspective, colors and lighting as the first reference image, which is the damaged crop to be repaired.',
  ];
  if (descricao) partes.push(`The full picture shows: ${descricao}.`);
  partes.push(`Region: ${regiao.nome}. Problem: ${PROBLEMA_EM_INGLES[regiao.problema] ?? PROBLEMA_EM_INGLES.OUTRO}.`);
  if (regiao.descricao) partes.push(`Details: ${regiao.descricao}.`);
  partes.push('Do not add text, borders, watermarks or new objects. Output only the repaired region with the same framing.');
  if (instrucoes && instrucoes.trim()) partes.push(`Extra instructions: ${instrucoes.trim()}`);
  return partes.join(' ');
}

// Cria uma opção CANVA com status GERANDO e começa a geração em segundo plano. Devolve a opção criada.
export async function gerarOpcaoCanva(
  regiaoId: number,
  dados: { prompt: string; usarReferencias: boolean; rodada?: number; rotulo?: string }
): Promise<Opcao> {
  const { regiao, projeto, ret, contexto } = await carregar(regiaoId);
  const texto = dados.prompt.trim();
  if (!texto) throw new HttpError(400, 'Prompt vazio');
  const rodada = dados.rodada ?? 1;
  // Conjectura: parte recriada sem nenhuma referência do usuário aprovada vinculada (ou sem usar referências).
  // Referência gerada (origem CANVA) é palpite da IA: não conta como base real.
  const [deUsuario, geradas] = await Promise.all([
    prisma.vinculo.count({
      where: { regiaoId: regiao.id, referencia: { origem: 'USUARIO', status: 'APROVADA' } },
    }),
    prisma.vinculo.count({
      where: { regiaoId: regiao.id, referencia: { origem: 'CANVA', status: 'APROVADA' } },
    }),
  ]);
  const conjectura = !dados.usarReferencias || deUsuario === 0;
  // Mapa 3D (cena): o texto de perspectiva da parte entra no prompt. O mapa de profundidade só vai se o Blender já montou a cena.
  const cena = await cenaDoProjeto(projeto.id);
  const promptFinal = cena ? `${texto} ${textoDePerspectiva(cena.resolvida, regiao)}` : texto;
  const opcao = await prisma.opcao.create({
    data: {
      projetoId: projeto.id,
      regiaoId: regiao.id,
      origem: 'CANVA',
      rotulo: dados.rotulo ?? `Canva (rodada ${rodada})`,
      parametros: {
        contexto: paraJson(contexto),
        regiao: paraJson(ret),
        prompt: promptFinal,
        usarReferencias: dados.usarReferencias,
        conjectura,
        referenciasGeradas: dados.usarReferencias && geradas > 0,
        ...(cena ? { perspectiva: true } : {}),
        ...(cena?.blender ? { profundidade: true } : {}),
      },
      status: 'GERANDO',
      rodada,
    },
  });
  await marcarEmAndamento(regiao);
  void processarCanva(opcao.id).catch(() => undefined);
  return opcao;
}

// Frase que explica o mapa de profundidade ao Canva (vai só quando o mapa é enviado).
const FRASE_PROFUNDIDADE =
  'The second reference image is a depth map of the same crop (white = near the camera, black = far or empty). Use it only for spatial layout; never copy its look.';

// Gera a imagem no Canva em segundo plano e grava o resultado na opção.
async function processarCanva(opcaoId: number): Promise<void> {
  try {
    const opcao = await prisma.opcao.findUnique({ where: { id: opcaoId } });
    if (!opcao) throw new HttpError(404, 'Opção não encontrada');
    const regiao = await prisma.regiao.findUnique({ where: { id: opcao.regiaoId }, include: { projeto: true } });
    if (!regiao) throw new HttpError(404, 'Região não encontrada');
    const projeto = regiao.projeto;
    const atual = await lerArquivo(projeto.atualArquivo);
    const params = opcao.parametros as unknown as {
      contexto: Retangulo;
      prompt: string;
      usarReferencias: boolean;
      profundidade?: boolean;
    };
    const contexto = params.contexto;

    const recorte = await recortar(atual, contexto);
    const idRecorte = await enviarImagemAoCanva(projeto.usuarioId, recorte, 'restaura-regiao-' + regiao.id + '.png');

    const referencias: string[] = [idRecorte];
    // Mapa de profundidade do recorte (só com cena do Blender). Falha aqui não derruba a geração: segue sem ele.
    let comProfundidade = false;
    if (params.profundidade) {
      try {
        const mapa = await recorteDeProfundidade(projeto.id, contexto);
        if (mapa) {
          referencias.push(
            await enviarImagemAoCanva(projeto.usuarioId, mapa, 'restaura-profundidade-' + regiao.id + '.png')
          );
          comProfundidade = true;
        }
      } catch (e) {
        console.error('Falha ao enviar o mapa de profundidade ao Canva', opcaoId, e instanceof Error ? e.message : String(e));
      }
      if (!comProfundidade) {
        await prisma.opcao.update({
          where: { id: opcao.id },
          data: { parametros: { ...(opcao.parametros as object), profundidade: false } as Prisma.InputJsonObject },
        });
      }
    }
    // Com o mapa de profundidade como segunda referência, sobram 2 vagas para as outras (total continua 4).
    const limiteDeReferencias = comProfundidade ? 2 : 3;

    if (params.usarReferencias) {
      const vinculos = await prisma.vinculo.findMany({
        where: { regiaoId: regiao.id, referencia: { status: 'APROVADA', arquivo: { not: '' } } },
        include: { referencia: true },
        orderBy: [{ peso: 'desc' }, { id: 'asc' }],
      });
      // Vagas reservadas: primeiro as importadas pelo usuário (USUARIO, por peso);
      // as geradas (CANVA) só completam o que sobrar até o limite.
      const doUsuario = vinculos.filter((v) => v.referencia.origem === 'USUARIO');
      const geradasVinculadas = vinculos.filter((v) => v.referencia.origem !== 'USUARIO');
      for (const vinculo of [...doUsuario, ...geradasVinculadas].slice(0, limiteDeReferencias)) {
        const ref = vinculo.referencia;
        let mediaId = ref.canvaMediaId;
        if (!mediaId) {
          const bytes = await lerArquivo(ref.arquivo);
          const extensao = ref.arquivo.split('.').pop() ?? 'png';
          mediaId = await enviarImagemAoCanva(projeto.usuarioId, bytes, 'restaura-referencia-' + ref.id + '.' + extensao);
          await prisma.referencia.update({ where: { id: ref.id }, data: { canvaMediaId: mediaId } });
        }
        referencias.push(mediaId);
      }
    }

    const imagem = await gerarImagemNoCanva(projeto.usuarioId, {
      prompt: comProfundidade ? `${params.prompt} ${FRASE_PROFUNDIDADE}` : params.prompt,
      referencias,
      proporcao: proporcaoMaisProxima(contexto.largura, contexto.altura),
    });
    const ajustada = await sharp(imagem)
      .resize(contexto.largura, contexto.altura, { fit: 'fill' })
      .removeAlpha()
      .png()
      .toBuffer();
    const arquivo = await salvarArquivo(ajustada, 'png');
    await prisma.opcao.update({ where: { id: opcao.id }, data: { arquivo, status: 'PRONTA' } });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error('Falha ao gerar opção do Canva', opcaoId, mensagem);
    await prisma.opcao
      .update({ where: { id: opcaoId }, data: { status: 'FALHOU', erro: mensagem.slice(0, 500) } })
      .catch(() => undefined);
  }
}

// Espera a opção sair de GERANDO, até `limiteMs`. Devolve o estado atual da opção.
export async function aguardarOpcao(opcaoId: number, limiteMs: number): Promise<Opcao> {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const opcao = await prisma.opcao.findUnique({ where: { id: opcaoId } });
    if (!opcao) throw new HttpError(404, 'Opção não encontrada');
    const resta = fim - Date.now();
    if (opcao.status !== 'GERANDO' || resta <= 0) return opcao;
    await new Promise<void>((resolver) => setTimeout(resolver, Math.min(2000, resta)));
  }
}

// Fila por projeto: ler a imagem atual e gravar a nova não é atômico, então as aplicações de um mesmo
// projeto rodam uma de cada vez. Uma tarefa falhar não trava a fila.
const filasPorProjeto = new Map<number, Promise<void>>();

function noProjeto<T>(projetoId: number, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filasPorProjeto.get(projetoId) ?? Promise.resolve();
  const resultado = anterior.then(tarefa);
  const fim = resultado.then(
    () => undefined,
    () => undefined
  );
  filasPorProjeto.set(projetoId, fim);
  void fim.then(() => {
    if (filasPorProjeto.get(projetoId) === fim) filasPorProjeto.delete(projetoId);
  });
  return resultado;
}

// Aplica uma opção ao projeto, na fila do próprio projeto.
// Trocar a opção já aplicada numa parte resolvida continua permitido (a tela oferece "Usar esta" nas PRONTA).
export async function escolherOpcao(opcaoId: number): Promise<void> {
  const opcao = await prisma.opcao.findUnique({ where: { id: opcaoId }, select: { projetoId: true } });
  if (!opcao) throw new HttpError(404, 'Opção não encontrada');
  return noProjeto(opcao.projetoId, () => aplicarOpcao(opcaoId));
}

// Aplica a opção na imagem atual do projeto (sem fila: quem chama já está na fila do projeto).
async function aplicarOpcao(opcaoId: number): Promise<void> {
  const opcao = await prisma.opcao.findUnique({ where: { id: opcaoId }, include: { regiao: true, projeto: true } });
  if (!opcao) throw new HttpError(404, 'Opção não encontrada');
  if (opcao.status === 'ESCOLHIDA') throw new HttpError(409, 'Esta opção já está aplicada');
  if (!opcao.arquivo || !['PRONTA', 'REPROVADA'].includes(opcao.status)) {
    throw new HttpError(409, 'Esta opção ainda não está pronta');
  }
  const { regiao, projeto } = opcao;
  const atual = await lerArquivo(projeto.atualArquivo);
  const remendo = await lerArquivo(opcao.arquivo);
  const params = opcao.parametros as unknown as { contexto: Retangulo; regiao?: Retangulo };
  const contexto = params.contexto;
  // Região no momento da criação da opção (se a região foi editada depois, usa a antiga).
  const regiaoGuardada = params.regiao;
  const ret: Retangulo =
    regiaoGuardada &&
    [regiaoGuardada.x, regiaoGuardada.y, regiaoGuardada.largura, regiaoGuardada.altura].every((n) => typeof n === 'number')
      ? regiaoGuardada
      : retanguloDaRegiao(regiao, projeto.largura, projeto.altura);
  // Restringe a região à interseção com o contexto da opção.
  const x0 = Math.max(ret.x, contexto.x);
  const y0 = Math.max(ret.y, contexto.y);
  const x1 = Math.min(ret.x + ret.largura, contexto.x + contexto.largura);
  const y1 = Math.min(ret.y + ret.altura, contexto.y + contexto.altura);
  if (x1 - x0 < 1 || y1 - y0 < 1) {
    throw new HttpError(409, 'A parte mudou de lugar depois que esta opção foi criada. Gere a opção de novo.');
  }
  const interseccao: Retangulo = { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
  const nova = await compor(atual, remendo, contexto, interseccao);
  const arquivo = await salvarArquivo(nova, 'png');
  const numero = await proximoNumeroDeVersao(projeto.id);

  await prisma.$transaction([
    prisma.projeto.update({ where: { id: projeto.id }, data: { atualArquivo: arquivo } }),
    prisma.versao.create({
      data: { projetoId: projeto.id, numero, arquivo, descricao: `Região "${regiao.nome}": ${opcao.rotulo}` },
    }),
    prisma.opcao.updateMany({
      where: { regiaoId: regiao.id, status: 'ESCOLHIDA', NOT: { id: opcao.id } },
      data: { status: 'PRONTA' },
    }),
    prisma.opcao.update({ where: { id: opcao.id }, data: { status: 'ESCOLHIDA' } }),
    prisma.regiao.update({ where: { id: regiao.id }, data: { status: 'RESOLVIDA' } }),
  ]);

  const status = await recalcularStatusDoProjeto(projeto.id);
  await registrarEvento(projeto.id, 'sistema', 'nota', `Opção aplicada na região "${regiao.nome}": ${opcao.rotulo}.`);
  if (status === 'CONCLUIDO') await criarTrabalho(projeto.id, 'INSPECAO');
}

// Aplica, em ordem, a melhor opção PRONTA (maior nota, com nota >= notaMinima) de cada parte selecionada
// que ainda está PENDENTE ou EM_ANDAMENTO. Uma por vez: cada escolha altera a imagem atual.
// Devolve quantas opções foram aplicadas. Se uma falhar, para e relança o erro com o nome da parte.
export async function aplicarMelhores(
  projetoId: number,
  notaMinima: number
): Promise<{ aplicadas: number; conjecturas: number }> {
  return noProjeto(projetoId, async () => {
    const candidatas = await prisma.regiao.findMany({
      where: { projetoId, selecionada: true, status: { in: REGIOES_PENDENTES_APLICAR } },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    let aplicadas = 0;
    let conjecturas = 0;
    try {
      for (const candidata of candidatas) {
        // Relê a parte: pode ter sido resolvida ou ignorada desde a lista acima.
        const parte = await prisma.regiao.findUnique({
          where: { id: candidata.id },
          select: { id: true, nome: true, status: true, selecionada: true },
        });
        if (!parte || !parte.selecionada || parte.status === 'RESOLVIDA' || parte.status === 'IGNORADA') continue;
        const melhor = await prisma.opcao.findFirst({
          where: { regiaoId: parte.id, status: 'PRONTA', nota: { gte: notaMinima } },
          orderBy: [{ nota: 'desc' }, { id: 'desc' }],
        });
        if (!melhor) continue;
        try {
          await aplicarOpcao(melhor.id);
        } catch (e) {
          const mensagem = e instanceof Error ? e.message : String(e);
          const status = e instanceof HttpError ? e.status : 500;
          throw new HttpError(
            status,
            `Parte "${parte.nome}": ${mensagem}. ${aplicadas} parte(s) já aplicada(s) antes da falha.`
          );
        }
        aplicadas++;
        if (ehConjectura(melhor.parametros)) conjecturas++;
      }
    } finally {
      if (aplicadas > 0) {
        const sufixo =
          conjecturas > 0 ? `; ${conjecturas} ${conjecturas === 1 ? 'dela' : 'delas'} sem referência dele (conjectura)` : '';
        const texto = `${aplicadas} ${aplicadas === 1 ? 'opção aplicada' : 'opções aplicadas'} de uma vez pelo usuário${sufixo}.`;
        await registrarEvento(projetoId, 'sistema', 'nota', texto);
      }
    }
    return { aplicadas, conjecturas };
  });
}

const REGIOES_PENDENTES_APLICAR = ['PENDENTE', 'EM_ANDAMENTO'];

// Lê parametros.conjectura com checagem de tipo.
function ehConjectura(parametros: unknown): boolean {
  if (typeof parametros !== 'object' || parametros === null) return false;
  return (parametros as { conjectura?: unknown }).conjectura === true;
}

// Opções presas em GERANDO (servidor reiniciado no meio da geração) viram FALHOU.
export async function falharOpcoesPresas(): Promise<void> {
  await prisma.opcao.updateMany({
    where: { status: 'GERANDO' },
    data: { status: 'FALHOU', erro: 'A geração foi interrompida. Gere de novo.' },
  });
}

// Imagem "antes e depois" lado a lado (JPEG) de uma opção, para o revisor comparar.
export async function comparativoDaOpcao(opcaoId: number): Promise<Buffer> {
  const opcao = await prisma.opcao.findUnique({ where: { id: opcaoId }, include: { projeto: true } });
  if (!opcao) throw new HttpError(404, 'Opção não encontrada');
  if (!opcao.arquivo) throw new HttpError(409, 'Opção sem imagem');
  const contexto = (opcao.parametros as unknown as { contexto: Retangulo }).contexto;

  // Opção já aplicada: a imagem atual já tem a correção, então o "antes" vem do original.
  const arquivoAntes = opcao.status === 'ESCOLHIDA' ? opcao.projeto.originalArquivo : opcao.projeto.atualArquivo;
  const antesOriginal = await recortar(await lerArquivo(arquivoAntes), contexto);
  const depoisOriginal = await lerArquivo(opcao.arquivo);

  const h = Math.min(640, contexto.altura);
  const w = Math.max(1, Math.round((contexto.largura * h) / contexto.altura));
  const antes = await sharp(antesOriginal).resize(w, h, { fit: 'fill' }).png().toBuffer();
  const depois = await sharp(depoisOriginal).resize(w, h, { fit: 'fill' }).png().toBuffer();

  return sharp({ create: { width: w * 2 + 16, height: h, channels: 3, background: '#ffffff' } })
    .composite([
      { input: antes, left: 0, top: 0 },
      { input: depois, left: w + 16, top: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}
