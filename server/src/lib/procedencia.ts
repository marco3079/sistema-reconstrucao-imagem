import { prisma } from './prisma';

// Procedência da imagem: tipo de fonte digital do IPTC (DigitalSourceType) gravado no arquivo baixado.

export const FONTE_COMPOSTA_IA = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
export const FONTE_REALCADA = 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced';

const PALAVRA_CHAVE_XMP = 'XML:com.adobe.xmp';
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// URI IPTC do projeto: FONTE_COMPOSTA_IA se alguma opção escolhida veio do Canva;
// FONTE_REALCADA se há opção escolhida só com filtros locais; null se nenhuma opção foi escolhida.
export async function fonteDigitalDoProjeto(projetoId: number): Promise<string | null> {
  const escolhidas = await prisma.opcao.findMany({
    where: { projetoId, status: 'ESCOLHIDA' },
    select: { origem: true },
  });
  if (escolhidas.length === 0) return null;
  return escolhidas.some((o) => o.origem === 'CANVA') ? FONTE_COMPOSTA_IA : FONTE_REALCADA;
}

// Pacote XMP com o tipo de fonte digital e o programa que gerou o arquivo.
export function montarXmp(fonte: string): string {
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" ' +
    'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
    'xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
    `Iptc4xmpExt:DigitalSourceType="${fonte}" ` +
    'xmp:CreatorTool="Restaura"/>' +
    '</rdf:RDF>' +
    '</x:xmpmeta>' +
    '<?xpacket end="w"?>'
  );
}

// Tabela do CRC-32 do PNG (polinômio 0xEDB88320).
const TABELA_CRC: Uint32Array = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Monta um chunk PNG: comprimento, tipo, dados e CRC-32 (sobre tipo + dados).
function montarChunk(tipo: string, dados: Buffer): Buffer {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(dados.length, 0);
  cabecalho.write(tipo, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, 'latin1'), dados])), 0);
  return Buffer.concat([cabecalho, dados, crc]);
}

// Chunk iTXt com o XMP: palavra-chave, compressão 0, método 0, língua vazia, tradução vazia e texto UTF-8.
function chunkItxtXmp(xmp: string): Buffer {
  const dados = Buffer.concat([
    Buffer.from(PALAVRA_CHAVE_XMP, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(xmp, 'utf8'),
  ]);
  return montarChunk('iTXt', dados);
}

// Confere se um chunk iTXt tem a palavra-chave do XMP.
function ehItxtXmp(dados: Buffer): boolean {
  const fim = dados.indexOf(0);
  if (fim < 0) return false;
  return dados.toString('latin1', 0, fim) === PALAVRA_CHAVE_XMP;
}

// Insere o XMP num PNG como iTXt logo depois do IHDR. Substitui um XMP já existente.
// Se o buffer não for PNG, devolve o próprio buffer sem mudança.
export function embutirXmpEmPng(png: Buffer, xmp: string): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(ASSINATURA_PNG)) return png;

  const ihdrLen = png.length >= 16 ? png.readUInt32BE(8) : -1;
  if (ihdrLen < 0 || png.toString('latin1', 12, 16) !== 'IHDR') return png;
  const fimIhdr = 8 + 12 + ihdrLen;
  if (fimIhdr > png.length) return png;

  const partes: Buffer[] = [png.subarray(0, fimIhdr), chunkItxtXmp(xmp)];

  // Copia o restante, deixando de fora iTXt de XMP anteriores.
  let pos = fimIhdr;
  while (pos + 12 <= png.length) {
    const len = png.readUInt32BE(pos);
    const fimChunk = pos + 12 + len;
    if (fimChunk > png.length) break;
    const tipo = png.toString('latin1', pos + 4, pos + 8);
    const dados = png.subarray(pos + 8, pos + 8 + len);
    const descartar = tipo === 'iTXt' && ehItxtXmp(dados);
    if (!descartar) partes.push(png.subarray(pos, fimChunk));
    pos = fimChunk;
  }
  if (pos < png.length) partes.push(png.subarray(pos));

  return Buffer.concat(partes);
}
