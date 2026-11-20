import type { ProjetoDetalhe } from '../../lib/tipos';

// 'equipe' é a aba "Equipe ao vivo": fluxo e agentes deste projeto (não é um passo da restauração).
export type Etapa = 'analise' | 'referencias' | 'reconstrucao' | 'resultado' | 'equipe';

// Props comuns das quatro etapas da oficina. Contrato em docs/CONTRATOS.md.
export interface PropsEtapa {
  projeto: ProjetoDetalhe;
  aoAtualizar: (projeto: ProjetoDetalhe) => void; // troca o projeto em memória (resposta de uma rota)
  recarregar: () => void; // busca o projeto de novo
  regiaoSelecionada: number | null;
  aoSelecionarRegiao: (id: number | null) => void;
  irPara: (etapa: Etapa) => void;
}
