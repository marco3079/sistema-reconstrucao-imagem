import type { ReactNode } from 'react';
import type { Perfil } from './tipos';
import type { NomeIcone } from '../ui/icones';

// Raiz de todas as telas depois do login.
export const RAIZ = '/app';

export interface RotaModulo {
  caminho: string; // ex.: '/app/projetos' ou '/app/projetos/:id'
  rotulo: string; // texto do menu
  icone: NomeIcone; // nome de um ícone de ui/icones
  perfis: Perfil[];
  elemento: ReactNode;
  menu?: boolean; // padrão true; false para telas de detalhe
  ordem?: number; // posição no menu (menor primeiro); padrão 100
}

export const TODOS_OS_PERFIS: Perfil[] = ['ADMIN', 'USUARIO'];
