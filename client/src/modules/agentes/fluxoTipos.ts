// Contrato entre a tela "Fluxo ao vivo" (Fluxo.tsx) e o quadro de nós (QuadroFluxo.tsx).
// O quadro só desenha; quem decide o estado de cada nó e de cada ligação é a tela.

import type { NomeIcone } from '../../ui/icones';

// parado: sem atividade. espera: aguardando algo (fila, sessão, escolha do usuário).
// ativo: trabalhando agora. feito: já atuou no trabalho em andamento. erro: o último evento foi um erro.
export type EstadoNo = 'parado' | 'espera' | 'ativo' | 'feito' | 'erro';

export type CorNo = 'azul' | 'roxo' | 'verde' | 'laranja' | 'cinza';

export interface NoFluxo {
  id: string;
  titulo: string;
  subtitulo: string; // papel do nó, em poucas palavras
  icone: NomeIcone;
  cor: CorNo;
  x: number; // canto superior esquerdo, em unidades do quadro (px com zoom 1)
  y: number;
  estado: EstadoNo;
  texto: string; // o que o nó está fazendo ou fez por último; pode ser ''
  contador?: number; // bolinha com número no canto do nó; omitido ou 0 não aparece
}

export interface LigacaoFluxo {
  id: string;
  de: string; // id do nó de origem
  para: string; // id do nó de destino
  rotulo?: string;
  ativa: boolean; // dados passando agora: linha colorida e animada
  retorno?: boolean; // volta (plano de ajuste): tracejada, em arco por fora dos nós
}

export interface PropsQuadroFluxo {
  nos: NoFluxo[];
  ligacoes: LigacaoFluxo[];
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
}

export const LARGURA_NO = 210;
export const ALTURA_NO = 104;

export const ROTULO_ESTADO: Record<EstadoNo, string> = {
  parado: 'Parado',
  espera: 'Esperando',
  ativo: 'Trabalhando',
  feito: 'Concluiu',
  erro: 'Erro',
};
