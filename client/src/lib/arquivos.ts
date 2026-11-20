// Endereço de uma imagem guardada no servidor. `largura` pede uma miniatura com essa largura máxima.
export function urlArquivo(nome: string | null | undefined, largura?: number): string {
  if (!nome) return '';
  return `/api/arquivos/${nome}${largura ? `?l=${largura}` : ''}`;
}

// Endereço do recorte de uma parte, com a resolução real dela. `ret` em frações (0 a 1); `lado` = lado maior em pixels.
export function urlRecorte(
  arquivo: string | null | undefined,
  ret: { x: number; y: number; largura: number; altura: number },
  lado: number,
): string {
  if (!arquivo) return '';
  const f = (n: number) => Math.min(1, Math.max(0, n)).toFixed(4);
  return `/api/arquivos/${arquivo}?x=${f(ret.x)}&y=${f(ret.y)}&w=${f(ret.largura)}&h=${f(ret.altura)}&l=${Math.round(lado)}`;
}

export const TIPOS_DE_IMAGEM_ACEITOS = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff';

// Tamanho máximo de envio (30 MB), igual ao do servidor.
export const TAMANHO_MAXIMO_ENVIO = 30 * 1024 * 1024;
