import sharp from 'sharp';
import { HttpError } from './erros';

// Retângulo em pixels inteiros dentro da imagem.
export interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(valor, minimo), maximo);
}

// Lê qualquer imagem aceita, aplica a rotação do EXIF, limita o maior lado a 4096 px e devolve PNG.
// Lança HttpError(400, 'Arquivo não é uma imagem válida') se o sharp não conseguir ler.
export async function normalizarEntrada(conteudo: Buffer): Promise<{ png: Buffer; largura: number; altura: number }> {
  try {
    const { data, info } = await sharp(conteudo, { failOn: 'none' })
      .rotate()
      .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: data, largura: info.width, altura: info.height };
  } catch {
    throw new HttpError(400, 'Arquivo não é uma imagem válida');
  }
}

// JPEG com o maior lado limitado a `ladoMaximo` (sem ampliar). Fundo branco se houver transparência.
export async function paraJpeg(conteudo: Buffer, ladoMaximo: number, qualidade = 85): Promise<Buffer> {
  return sharp(conteudo)
    .resize({ width: ladoMaximo, height: ladoMaximo, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: qualidade })
    .toBuffer();
}

// Converte uma região em frações (0 a 1) para pixels, dentro dos limites da imagem. Mínimo de 8 px por lado.
export function retanguloDaRegiao(
  regiao: { x: number; y: number; largura: number; altura: number },
  larguraImagem: number,
  alturaImagem: number
): Retangulo {
  // Se a imagem tiver menos de 8 px num lado, usa o lado inteiro.
  const minW = Math.min(8, larguraImagem);
  const minH = Math.min(8, alturaImagem);
  const x = limitar(Math.round(regiao.x * larguraImagem), 0, larguraImagem - minW);
  const y = limitar(Math.round(regiao.y * alturaImagem), 0, alturaImagem - minH);
  const largura = limitar(Math.round(regiao.largura * larguraImagem), minW, larguraImagem - x);
  const altura = limitar(Math.round(regiao.altura * alturaImagem), minH, alturaImagem - y);
  return { x, y, largura, altura };
}

// Amplia o retângulo em `margem` (fração do lado, padrão 0.35) para cada lado, sem sair da imagem.
export function contextoDaRegiao(ret: Retangulo, larguraImagem: number, alturaImagem: number, margem = 0.35): Retangulo {
  const dx = Math.round(ret.largura * margem);
  const dy = Math.round(ret.altura * margem);
  const x0 = Math.max(0, ret.x - dx);
  const y0 = Math.max(0, ret.y - dy);
  const x1 = Math.min(larguraImagem, ret.x + ret.largura + dx);
  const y1 = Math.min(alturaImagem, ret.y + ret.altura + dy);
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

// Recorte em PNG.
export async function recortar(conteudo: Buffer, ret: Retangulo): Promise<Buffer> {
  return sharp(conteudo)
    .extract({ left: ret.x, top: ret.y, width: ret.largura, height: ret.altura })
    .png()
    .toBuffer();
}

// Cola `remendo` (imagem do tamanho de `contexto`) sobre `base`, mudando só a área de `regiao`
// com borda suave (pena). `contexto` e `regiao` estão em pixels da imagem base. Devolve PNG.
export async function compor(base: Buffer, remendo: Buffer, contexto: Retangulo, regiao: Retangulo): Promise<Buffer> {
  const remendoAjustado = await sharp(remendo)
    .resize({ width: contexto.largura, height: contexto.altura, fit: 'fill' })
    .removeAlpha()
    .png()
    .toBuffer();

  const mesmoRetangulo =
    regiao.x === contexto.x &&
    regiao.y === contexto.y &&
    regiao.largura === contexto.largura &&
    regiao.altura === contexto.altura;

  if (mesmoRetangulo) {
    return sharp(base)
      .composite([{ input: remendoAjustado, left: contexto.x, top: contexto.y }])
      .png()
      .toBuffer();
  }

  // Máscara em tons de cinza: branco na região, preto no resto do contexto, com borda suave.
  const mascaraPng = await sharp({
    create: { width: contexto.largura, height: contexto.altura, channels: 3, background: '#000000' },
  })
    .composite([
      {
        input: { create: { width: regiao.largura, height: regiao.altura, channels: 3, background: '#ffffff' } },
        left: regiao.x - contexto.x,
        top: regiao.y - contexto.y,
      },
    ])
    .png()
    .toBuffer();

  const sigma = Math.max(1.5, Math.min(regiao.largura, regiao.altura) * 0.04);
  const mascaraRaw = await sharp(mascaraPng).blur(sigma).extractChannel(0).raw().toBuffer();

  const remendoComAlfa = await sharp(remendoAjustado)
    .joinChannel(mascaraRaw, { raw: { width: contexto.largura, height: contexto.altura, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: remendoComAlfa, left: contexto.x, top: contexto.y }])
    .png()
    .toBuffer();
}
