import { RAIZ } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Atualizacao } from './Atualizacao';

// Só administrador: a API também recusa quem não é ADMIN (403).
export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/atualizacao`,
    rotulo: 'Atualização',
    icone: 'engrenagem',
    perfis: ['ADMIN'],
    elemento: <Atualizacao />,
    ordem: 97,
  },
];
