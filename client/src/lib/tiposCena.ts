// Tipos do mapa 3D da foto (cena). Contrato em docs/CENA.md.

export type TipoVolume = 'PESSOA' | 'OBJETO' | 'PAREDE' | 'OUTRO';
export type ApoioVolume = 'CHAO' | 'SUSPENSO';

export interface PontoDeFuga {
  x: number;
  y: number;
  eixo: 'X' | 'Y' | 'Z';
}

export interface VolumeEntrada {
  nome: string;
  regiaoId?: number | null;
  tipo: TipoVolume;
  x: number;
  y: number;
  largura: number;
  altura: number;
  alturaReal?: number | null;
  espessura?: number | null;
  apoio: ApoioVolume;
}

export interface CenaEntrada {
  camera: {
    fovVertical?: number | null;
    horizonteY?: number | null;
    alturaCamera?: number | null;
    inclinacaoLateral?: number | null;
  };
  pontosDeFuga: PontoDeFuga[];
  volumes: VolumeEntrada[];
  observacoes: string;
}

export interface Vetor3 {
  x: number;
  y: number;
  z: number;
}

export interface VolumeResolvido {
  nome: string;
  regiaoId: number | null;
  tipo: TipoVolume;
  caixa: { x: number; y: number; largura: number; altura: number };
  centro: Vetor3;
  tamanho: Vetor3;
  distancia: number;
  metodo: 'CHAO' | 'TAMANHO';
  camada: number;
}

export interface CenaResolvida {
  versao: 1;
  largura: number;
  altura: number;
  camera: {
    fovVertical: number;
    foco: number;
    inclinacao: number;
    rolagem: number;
    altura: number;
    horizonteY: number;
    origemFoco: 'PONTOS_DE_FUGA' | 'ESTIMADO' | 'PADRAO';
  };
  pontosDeFuga: PontoDeFuga[];
  volumes: VolumeResolvido[];
  limites: { perto: number; longe: number };
  avisos: string[];
}

export interface CenaGravada {
  entrada: CenaEntrada;
  resolvida: CenaResolvida;
  blender: null | {
    profundidadeArquivo: string;
    volumesArquivo: string;
    previaArquivo: string;
    glbArquivo: string;
    versao: string;
    feitoEm: string;
  };
  atualizadaEm: string;
}

// Resposta de GET /projetos/:id/cena.
export interface RespostaCena {
  cena: CenaGravada | null;
  resumo: string | null;
  refazendo: boolean;
}
