import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { apagarArquivo, lerArquivo, salvarArquivo } from '../../lib/arquivos';
import { retanguloDaRegiao } from '../../lib/imagem';
import type { Retangulo } from '../../lib/imagem';
import { distanciaDaParte, resolverCena, resumoDaCena } from '../../lib/cena';
import type { CenaEntrada, CenaResolvida } from '../../lib/cena';
import { registrarEvento } from '../agentes/servico';

// Mapa 3D da foto (docs/CENA.md): grava a cena em Projeto.cena e as saídas do Blender.
// A matemática (3D a partir do que o cenógrafo observou) fica em lib/cena.ts.

// Dados gravados em Projeto.cena (docs/CENA.md, "Dados gravados").
export interface CenaGravada {
  entrada: CenaEntrada;
  resolvida: CenaResolvida;
  blender: null | {
    profundidadeArquivo: string; // PNG em tons de cinza, branco = perto (limites.perto), preto = longe ou vazio
    volumesArquivo: string; // PNG RGBA: os volumes vistos pela câmera, fundo transparente
    previaArquivo: string; // JPEG: a foto com os volumes por cima (montado pelo servidor)
    glbArquivo: string; // a cena em glTF binário
    versao: string; // versão do Blender
    feitoEm: string; // ISO
  };
  atualizadaEm: string; // ISO
}

const LIMITE_DE_ARQUIVO_BYTES = Math.round(1.2 * 1024 * 1024); // 1,2 MB por arquivo
const LADO_DA_PREVIA = 1280;
// Média (0..255) abaixo disso: o mapa de profundidade da parte está quase todo vazio.
const MEDIA_MINIMA_COM_MAPA = 4;

// ---------- Leitura ----------

export async function cenaDoProjeto(projetoId: number): Promise<CenaGravada | null> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId }, select: { cena: true } });
  if (!projeto || projeto.cena === null || projeto.cena === undefined) return null;
  return projeto.cena as unknown as CenaGravada;
}

// ---------- Arquivos do Blender ----------

async function apagarArquivosDoBlender(cena: CenaGravada | null): Promise<void> {
  const blender = cena?.blender;
  if (!blender) return;
  for (const nome of [blender.profundidadeArquivo, blender.volumesArquivo, blender.previaArquivo, blender.glbArquivo]) {
    await apagarArquivo(nome);
  }
}

function conferirTamanho(nome: string, conteudo: Buffer): void {
  if (conteudo.length > LIMITE_DE_ARQUIVO_BYTES) {
    throw new HttpError(400, `${nome} passa de 1,2 MB`);
  }
}

// Confere que o PNG abre no sharp e devolve as dimensões.
async function conferirPng(nome: string, conteudo: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(conteudo).metadata();
    if (!meta.width || !meta.height) throw new Error('sem dimensões');
    return { width: meta.width, height: meta.height };
  } catch {
    throw new HttpError(400, `${nome} não é uma imagem PNG válida`);
  }
}

// Escala um retângulo em pixels do projeto para os pixels de um PNG de outro tamanho (proporcional, mínimo 1 px).
function escalarRetangulo(ret: Retangulo, pw: number, ph: number, lw: number, lh: number): Retangulo {
  const sx = pw / lw;
  const sy = ph / lh;
  const x = Math.min(Math.max(Math.round(ret.x * sx), 0), pw - 1);
  const y = Math.min(Math.max(Math.round(ret.y * sy), 0), ph - 1);
  const largura = Math.max(1, Math.min(Math.round(ret.largura * sx), pw - x));
  const altura = Math.max(1, Math.min(Math.round(ret.altura * sy), ph - y));
  return { x, y, largura, altura };
}

// O sharp recorta com { left, top, width, height }.
function emRegiaoSharp(ret: Retangulo): { left: number; top: number; width: number; height: number } {
  return { left: ret.x, top: ret.y, width: ret.largura, height: ret.altura };
}

// Média dos tons de cinza (0..255) dentro do retângulo de um PNG de profundidade.
async function mediaDoRetangulo(png: Buffer, ret: Retangulo): Promise<number> {
  const { data } = await sharp(png).extract(emRegiaoSharp(ret)).greyscale().raw().toBuffer({ resolveWithObject: true });
  let soma = 0;
  for (const valor of data) soma += valor;
  return soma / data.length;
}

// Profundidade inversa normalizada do PNG: cinza/255 = (1/z - 1/longe) / (1/perto - 1/longe).
// Volta: z = 1 / (m/255 * (1/perto - 1/longe) + 1/longe). Branco = perto, preto = longe.
function profundidadeDoMapa(media: number, perto: number, longe: number): number {
  const inversa = (media / 255) * (1 / perto - 1 / longe) + 1 / longe;
  return 1 / inversa;
}

// Prévia: a foto atual (até 1280 px de lado) com os volumes por cima, em JPEG.
async function montarPrevia(atual: Buffer, volumesPng: Buffer): Promise<Buffer> {
  const base = await sharp(atual)
    .resize({ width: LADO_DA_PREVIA, height: LADO_DA_PREVIA, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const volumes = await sharp(volumesPng).resize(base.info.width, base.info.height, { fit: 'fill' }).png().toBuffer();
  return sharp(base.data)
    .composite([{ input: volumes, left: 0, top: 0 }])
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ---------- Escrita ----------

// Grava a cena (já validada) e recalcula a distância de cada parte pela geometria.
// Sem Blender: blender = null e apaga os arquivos do Blender anterior.
export async function definirCena(projetoId: number, entrada: CenaEntrada): Promise<CenaGravada> {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, largura: true, altura: true },
  });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  const partes = await prisma.regiao.findMany({
    where: { projetoId },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  });
  const idsDoProjeto = new Set(partes.map((p) => p.id));

  const resolvida = resolverCena(entrada, projeto.largura, projeto.altura);
  // Volume ligado a parte que não é do projeto fica sem parte (com aviso).
  const avisos = [...resolvida.avisos];
  const volumes = resolvida.volumes.map((v) => {
    if (v.regiaoId === null || idsDoProjeto.has(v.regiaoId)) return v;
    avisos.push(`Volume "${v.nome}": a parte ${v.regiaoId} não é do projeto; o volume ficou sem parte.`);
    return { ...v, regiaoId: null };
  });
  const resolvidaLimpa: CenaResolvida = { ...resolvida, volumes, avisos };
  const entradaLimpa: CenaEntrada = {
    ...entrada,
    volumes: entrada.volumes.map((v) =>
      v.regiaoId === null || v.regiaoId === undefined || idsDoProjeto.has(v.regiaoId) ? v : { ...v, regiaoId: null }
    ),
  };

  // Os arquivos do Blender anteriores só saem depois que a nova cena foi gravada.
  const anterior = await cenaDoProjeto(projetoId);

  const gravada: CenaGravada = {
    entrada: entradaLimpa,
    resolvida: resolvidaLimpa,
    blender: null,
    atualizadaEm: new Date().toISOString(),
  };
  await prisma.$transaction([
    prisma.projeto.update({
      where: { id: projetoId },
      data: { cena: gravada as unknown as Prisma.InputJsonObject },
    }),
    ...partes.map((p) =>
      prisma.regiao.update({
        where: { id: p.id },
        // Só a geometria (sem o valor antigo): a parte não tem profundidade de mapa nesta cena.
        data: {
          profundidade: distanciaDaParte(resolvidaLimpa, {
            id: p.id,
            x: p.x,
            y: p.y,
            largura: p.largura,
            altura: p.altura,
          }),
        },
      })
    ),
  ]);
  await apagarArquivosDoBlender(anterior);
  await registrarEvento(projetoId, 'cenografo', 'nota', resumoDaCena(resolvidaLimpa));
  return gravada;
}

// Grava os arquivos que o Blender montou (profundidade, volumes, glb), monta a prévia e
// recalcula a profundidade de cada parte pelo mapa. Com o mapa já aprovado, reordena as partes.
export async function salvarCenaBlender(
  projetoId: number,
  dados: { profundidadePng: Buffer; volumesPng: Buffer; glb: Buffer; versao: string }
): Promise<{ regiaoId: number; nome: string; profundidade: number | null }[]> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  const cena = await cenaDoProjeto(projetoId);
  if (!cena) throw new HttpError(409, 'Defina a cena antes de montar o mapa 3D no Blender');

  conferirTamanho('profundidade.png', dados.profundidadePng);
  conferirTamanho('volumes.png', dados.volumesPng);
  conferirTamanho('cena.glb', dados.glb);
  const dimensoes = await conferirPng('profundidade.png', dados.profundidadePng);
  await conferirPng('volumes.png', dados.volumesPng);
  if (dados.glb.length < 4 || dados.glb.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new HttpError(400, 'cena.glb não é um arquivo glTF válido');
  }

  const atual = await lerArquivo(projeto.atualArquivo);
  const previa = await montarPrevia(atual, dados.volumesPng);

  // Daqui em diante os arquivos novos já estão sendo gravados: se algo falhar, apaga os que já foram salvos.
  const novos: string[] = [];
  let medidas: { regiaoId: number; nome: string; profundidade: number | null }[];
  let gravada: CenaGravada;
  try {
    const blender = {
      profundidadeArquivo: await salvarArquivo(dados.profundidadePng, 'png'),
      volumesArquivo: '',
      previaArquivo: '',
      glbArquivo: '',
      versao: dados.versao,
      feitoEm: new Date().toISOString(),
    };
    novos.push(blender.profundidadeArquivo);
    blender.volumesArquivo = await salvarArquivo(dados.volumesPng, 'png');
    novos.push(blender.volumesArquivo);
    blender.previaArquivo = await salvarArquivo(previa, 'jpg');
    novos.push(blender.previaArquivo);
    blender.glbArquivo = await salvarArquivo(dados.glb, 'glb');
    novos.push(blender.glbArquivo);

    // Profundidade de cada parte pelo mapa (média do retângulo da parte).
    const partes = await prisma.regiao.findMany({
      where: { projetoId },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    });
    const { perto, longe } = cena.resolvida.limites;
    medidas = [];
    for (const p of partes) {
      const ret = escalarRetangulo(
        retanguloDaRegiao(p, projeto.largura, projeto.altura),
        dimensoes.width,
        dimensoes.height,
        projeto.largura,
        projeto.altura
      );
      // Volume da própria parte: a distância dele (o menor, se houver mais de um). O mapa não é consultado.
      const volumesDaParte = cena.resolvida.volumes.filter((v) => v.regiaoId === p.id);
      let profundidade: number | null;
      if (volumesDaParte.length > 0) {
        profundidade = Math.min(...volumesDaParte.map((v) => v.distancia));
      } else {
        const media = await mediaDoRetangulo(dados.profundidadePng, ret);
        profundidade =
          media < MEDIA_MINIMA_COM_MAPA
            ? distanciaDaParte(cena.resolvida, { id: p.id, x: p.x, y: p.y, largura: p.largura, altura: p.altura })
            : profundidadeDoMapa(media, perto, longe);
      }
      medidas.push({ regiaoId: p.id, nome: p.nome, profundidade });
    }

    // A cena pode ter sido refeita enquanto o Blender montava: nesse caso não grava por cima.
    const agora = await cenaDoProjeto(projetoId);
    if (agora?.atualizadaEm !== cena.atualizadaEm) {
      throw new HttpError(409, 'A cena mudou enquanto o Blender montava; rode de novo');
    }

    gravada = { ...cena, blender, atualizadaEm: new Date().toISOString() };
    await prisma.$transaction([
      prisma.projeto.update({
        where: { id: projetoId },
        data: { cena: gravada as unknown as Prisma.InputJsonObject },
      }),
      ...medidas.map((m) => prisma.regiao.update({ where: { id: m.regiaoId }, data: { profundidade: m.profundidade } })),
    ]);
  } catch (erro) {
    for (const nome of novos) await apagarArquivo(nome);
    throw erro;
  }
  // Os arquivos do Blender que a cena tinha antes saem só depois da gravação nova.
  await apagarArquivosDoBlender(cena);

  if (projeto.mapaStatus === 'APROVADO') await ordenarPorProfundidade(projetoId);
  await registrarEvento(projetoId, 'cenografo', 'acao', `Mapa 3D montado no Blender (${dados.versao}).`);
  return medidas;
}

// Apaga a cena e os arquivos do Blender. Partes ficam sem profundidade.
export async function apagarCena(projetoId: number): Promise<void> {
  const cena = await cenaDoProjeto(projetoId);
  await apagarArquivosDoBlender(cena);
  await prisma.$transaction([
    prisma.projeto.update({ where: { id: projetoId }, data: { cena: Prisma.DbNull } }),
    prisma.regiao.updateMany({ where: { projetoId }, data: { profundidade: null } }),
  ]);
}

// Ordem de tratamento: sem profundidade primeiro (fundo), depois do mais distante para o mais perto.
// Empate: ordem atual e depois id. Só as partes selecionadas e não resolvidas.
export async function ordenarPorProfundidade(projetoId: number): Promise<void> {
  const partes = await prisma.regiao.findMany({
    where: { projetoId, selecionada: true, status: { not: 'RESOLVIDA' } },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  });
  const porOrdemAtual = (a: { ordem: number; id: number }, b: { ordem: number; id: number }) =>
    a.ordem - b.ordem || a.id - b.id;
  const ordenadas = [...partes].sort((a, b) => {
    const pa = a.profundidade;
    const pb = b.profundidade;
    if (pa === null && pb === null) return porOrdemAtual(a, b);
    if (pa === null) return -1;
    if (pb === null) return 1;
    return pb - pa || porOrdemAtual(a, b);
  });
  if (ordenadas.length === 0) return;
  await prisma.$transaction(
    ordenadas.map((p, indice) => prisma.regiao.update({ where: { id: p.id }, data: { ordem: indice } }))
  );
}

// PNG do recorte do mapa de profundidade para o retângulo `ret` (pixels da imagem do projeto). Null sem Blender.
export async function recorteDeProfundidade(projetoId: number, ret: Retangulo): Promise<Buffer | null> {
  const cena = await cenaDoProjeto(projetoId);
  if (!cena?.blender) return null;
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { largura: true, altura: true },
  });
  if (!projeto) return null;
  const png = await lerArquivo(cena.blender.profundidadeArquivo);
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) return null;
  const recorte = escalarRetangulo(ret, meta.width, meta.height, projeto.largura, projeto.altura);
  return sharp(png).extract(emRegiaoSharp(recorte)).png().toBuffer();
}
