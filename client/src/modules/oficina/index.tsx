import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Oficina } from './Oficina';
import './oficina.css';

export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/projetos/:id`,
    rotulo: 'Oficina',
    icone: 'imagem',
    perfis: TODOS_OS_PERFIS,
    elemento: <Oficina />,
    menu: false,
  },
];
