import { prisma } from './prisma';
import { HttpError } from './erros';
import { sessaoConectada } from '../modules/agentes/servico';

// Situação do projeto no fluxo: em que passo está e de quem é a vez.
// Réplica do tipo `Situacao` de client/src/lib/tipos.ts. Ver CLAUDE.md (fluxo do squad) para a tabela de regras.

export type CodigoPasso = 'EXAME' | 'MAPA' | 'APROVAR_MAPA' | 'PLANO' | 'TRATAMENTO' | 'ESCOLHA' | 'INSPECAO' | 'LAUDO';

export type TelaDaOficina = 'analise' | 'referencias' | 'reconstrucao' | 'resultado' | 'equipe';

export interface PassoDoFluxo {
  codigo: CodigoPasso;
  titulo: string;
  quem: 'VOCE' | 'EQUIPE';
  estado: 'feito' | 'atual' | 'depois';
}

export interface Situacao {
  passo: number;
  total: number;
  codigo: CodigoPasso;
  titulo: string;
  descricao: string;
  quem: 'VOCE' | 'EQUIPE' | 'CONCLUIDO';
  aprovacao: boolean;
  acao: { rotulo: string; tela: TelaDaOficina } | null;
  parada: boolean;
  esperandoEscolha: number;
  passos: PassoDoFluxo[];
}

export interface DadosDaSituacao {
  mapaStatus: string; // RASCUNHO | AGUARDANDO | APROVADO
  analiseComIA: boolean; // Projeto.analise?.comIA === true
  regioes: { status: string; plano: string }[];
  trabalhos: { tipo: string; status: string }[]; // todos os do projeto que estão em FILA ou EM_ANDAMENTO
  inspecaoConcluida: boolean; // inspeção CONCLUIDO mais nova que a última versão da imagem (ou basta existir, sem versão)
  esperandoEscolha: number; // opções PRONTA com nota não nula em regiões PENDENTE ou EM_ANDAMENTO
  pedidosAbertos: number; // pedidos de referência do projeto com atendido = false
  algumEmAndamento: boolean; // algum trabalho do projeto com status EM_ANDAMENTO (sessão ocupada, não parada)
  sessaoConectada: boolean; // sessaoConectada(projetoId) do módulo agentes (memória)
}

// Dados que o projeto já traz (regiões e trabalhos ativos) mais o que falta buscar.
export interface ProjetoParaSituacao {
  id: number;
  mapaStatus: string;
  analise: unknown;
  regioes: { status: string; plano: string; selecionada: boolean }[];
  trabalhos: { tipo: string; status: string }[];
}

// Os 8 passos fixos, nesta ordem.
const PASSOS: { codigo: CodigoPasso; titulo: string; quem: 'VOCE' | 'EQUIPE' }[] = [
  { codigo: 'EXAME', titulo: 'Exame da imagem', quem: 'EQUIPE' },
  { codigo: 'MAPA', titulo: 'Mapa de referências', quem: 'EQUIPE' },
  { codigo: 'APROVAR_MAPA', titulo: 'Você aprova o mapa', quem: 'VOCE' },
  { codigo: 'PLANO', titulo: 'Plano de tratamento', quem: 'EQUIPE' },
  { codigo: 'TRATAMENTO', titulo: 'Tratamento e revisão', quem: 'EQUIPE' },
  { codigo: 'ESCOLHA', titulo: 'Você escolhe as opções', quem: 'VOCE' },
  { codigo: 'INSPECAO', titulo: 'Inspeção final', quem: 'EQUIPE' },
  { codigo: 'LAUDO', titulo: 'Laudo e resultado', quem: 'VOCE' },
];

const ESTADOS_ATIVOS = ['FILA', 'EM_ANDAMENTO'];
const REGIOES_PENDENTES = ['PENDENTE', 'EM_ANDAMENTO'];
const ROTULO_VER_EQUIPE = 'Ver a equipe trabalhando';
const ROTULO_LIGAR_EQUIPE = 'Ligar a equipe a esta imagem';
const AVISO_PARADA = ' Parado: nenhuma sessão do Claude Code está ligada a esta imagem.';

interface Decisao {
  codigo: CodigoPasso;
  quem: 'VOCE' | 'EQUIPE' | 'CONCLUIDO';
  aprovacao: boolean;
  descricao: string;
  acao: { rotulo: string; tela: TelaDaOficina } | null;
}

function comIA(analise: unknown): boolean {
  return typeof analise === 'object' && analise !== null && (analise as { comIA?: unknown }).comIA === true;
}

// Regras em ordem: a primeira que casar decide.
function decidir(d: DadosDaSituacao): Decisao {
  const ativo = (tipo: string) => d.trabalhos.some((t) => t.tipo === tipo);
  const vivas = d.regioes.filter((r) => r.status !== 'IGNORADA');
  const pendentes = d.regioes.filter((r) => REGIOES_PENDENTES.includes(r.status));
  const algumPlano = vivas.some((r) => r.plano !== '');
  const planejando = ativo('PLANO') || ativo('REGIAO');
  const nOpcoes = d.esperandoEscolha;
  const rotuloOpcoes = nOpcoes === 1 ? 'opção aprovada' : 'opções aprovadas';

  // 1
  if (ativo('ANALISE')) {
    return {
      codigo: 'EXAME',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A equipe está examinando a imagem e marcando as partes com problema.',
      acao: { rotulo: ROTULO_VER_EQUIPE, tela: 'equipe' },
    };
  }
  // 2 (trabalho CENA conta como REFERENCIAS, sem tirar o mapa de AGUARDANDO/APROVADO)
  const cenaAtiva = ativo('CENA') && d.mapaStatus !== 'AGUARDANDO' && d.mapaStatus !== 'APROVADO';
  if (ativo('REFERENCIAS') || cenaAtiva) {
    return {
      codigo: 'MAPA',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A equipe está revendo o mapa de referências.',
      acao: { rotulo: ROTULO_VER_EQUIPE, tela: 'equipe' },
    };
  }
  // 3
  if (d.mapaStatus === 'AGUARDANDO') {
    return {
      codigo: 'APROVAR_MAPA',
      quem: 'VOCE',
      aprovacao: true,
      descricao:
        'O mapa de referências está pronto. Confira as partes e as referências, marque o que quer reconstruir e aprove para a equipe continuar.',
      acao: { rotulo: 'Revisar e aprovar o mapa', tela: 'referencias' },
    };
  }
  // 4
  if (planejando && !algumPlano) {
    return {
      codigo: 'PLANO',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A equipe está escrevendo o plano de tratamento de cada parte.',
      acao: { rotulo: ROTULO_VER_EQUIPE, tela: 'equipe' },
    };
  }
  // 5
  if (planejando) {
    const aviso = nOpcoes > 0 ? ` Já há ${nOpcoes} ${rotuloOpcoes} esperando a sua escolha.` : '';
    return {
      codigo: 'TRATAMENTO',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A equipe está criando e revisando as opções de correção.' + aviso,
      acao: { rotulo: ROTULO_VER_EQUIPE, tela: 'equipe' },
    };
  }
  // 6
  if (nOpcoes > 0) {
    return {
      codigo: 'ESCOLHA',
      quem: 'VOCE',
      aprovacao: true,
      descricao: `Há ${nOpcoes} ${rotuloOpcoes} pelo revisor. Escolha uma para cada parte.`,
      acao: { rotulo: 'Escolher as opções', tela: 'reconstrucao' },
    };
  }
  // 7
  if (ativo('INSPECAO')) {
    return {
      codigo: 'INSPECAO',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A equipe está conferindo a imagem inteira contra a original.',
      acao: { rotulo: ROTULO_VER_EQUIPE, tela: 'equipe' },
    };
  }
  // 8
  if (d.mapaStatus !== 'APROVADO') {
    if (d.analiseComIA || vivas.length > 0) {
      return {
        codigo: 'APROVAR_MAPA',
        quem: 'VOCE',
        aprovacao: true,
        descricao:
          'O mapa de referências ainda não foi aprovado. Confira as partes, importe as referências que tiver, marque o que quer reconstruir e aprove.',
        acao: { rotulo: 'Revisar e aprovar o mapa', tela: 'referencias' },
      };
    }
    return {
      codigo: 'EXAME',
      quem: 'EQUIPE',
      aprovacao: false,
      descricao: 'A imagem ainda não foi examinada pela equipe.',
      acao: { rotulo: ROTULO_LIGAR_EQUIPE, tela: 'equipe' },
    };
  }
  // 9a: a equipe está parada esperando referência do usuário
  if (pendentes.length > 0 && d.pedidosAbertos > 0) {
    const np = d.pedidosAbertos;
    return {
      codigo: 'TRATAMENTO',
      quem: 'VOCE',
      aprovacao: false,
      descricao: `A equipe espera ${np} ${np === 1 ? 'referência sua' : 'referências suas'} para continuar. Envie a referência pedida, ou marque como ignorada a parte que não precisa de tratamento.`,
      acao: { rotulo: 'Enviar referências', tela: 'referencias' },
    };
  }
  // 9b
  if (pendentes.length > 0) {
    const n = pendentes.length;
    return {
      codigo: 'TRATAMENTO',
      quem: 'VOCE',
      aprovacao: false,
      descricao: `Há ${n} parte${n === 1 ? '' : 's'} sem opção aprovada. Peça uma nova rodada à equipe, gere opções você mesmo ou marque como ignorada a parte que não precisa de tratamento.`,
      acao: { rotulo: 'Abrir a reconstrução', tela: 'reconstrucao' },
    };
  }
  // 10
  if (vivas.length > 0 && !d.inspecaoConcluida) {
    return {
      codigo: 'INSPECAO',
      quem: 'VOCE',
      aprovacao: false,
      descricao: 'Todas as partes foram tratadas. Peça a inspeção final para a equipe conferir a imagem inteira.',
      acao: { rotulo: 'Ver o resultado', tela: 'resultado' },
    };
  }
  // 11
  return {
    codigo: 'LAUDO',
    quem: 'CONCLUIDO',
    aprovacao: false,
    descricao:
      vivas.length === 0
        ? 'Nenhuma parte precisa de tratamento. Baixe a imagem quando quiser.'
        : 'Restauração concluída. Baixe a imagem e o laudo.',
    acao: { rotulo: 'Ver o resultado e o laudo', tela: 'resultado' },
  };
}

// Função pura, sem banco.
export function calcularSituacao(d: DadosDaSituacao): Situacao {
  const decisao = decidir(d);
  const indice = PASSOS.findIndex((p) => p.codigo === decisao.codigo);
  const passoAtual = PASSOS[indice];

  // Trabalho em andamento significa sessão ocupada: não é parada.
  const parada = decisao.quem === 'EQUIPE' && !d.sessaoConectada && !d.algumEmAndamento;
  const descricao = parada ? decisao.descricao + AVISO_PARADA : decisao.descricao;
  const acao = parada ? { rotulo: ROTULO_LIGAR_EQUIPE, tela: 'equipe' as const } : decisao.acao;

  const concluido = decisao.quem === 'CONCLUIDO';
  const passos: PassoDoFluxo[] = PASSOS.map((p, i) => ({
    codigo: p.codigo,
    titulo: p.titulo,
    quem: p.quem,
    estado: concluido || i < indice ? 'feito' : i === indice ? 'atual' : 'depois',
  }));

  return {
    passo: indice + 1,
    total: PASSOS.length,
    codigo: passoAtual.codigo,
    titulo: passoAtual.titulo,
    descricao,
    quem: decisao.quem,
    aprovacao: decisao.aprovacao,
    acao,
    parada,
    esperandoEscolha: d.esperandoEscolha,
    passos,
  };
}

// Inspeção vale só se for mais nova que a última mudança na imagem.
function inspecaoEmDia(inspecoes: { concluidoEm: Date | null }[], ultimaMudanca: Date | null): boolean {
  if (inspecoes.length === 0) return false;
  if (ultimaMudanca === null) return true;
  return inspecoes.some((i) => i.concluidoEm !== null && i.concluidoEm >= ultimaMudanca);
}

// Monta os dados completos a partir do que o projeto já traz e do que falta buscar.
function montarDados(
  projeto: ProjetoParaSituacao,
  extras: {
    esperandoEscolha: number;
    pedidosAbertos: number;
    inspecoes: { concluidoEm: Date | null }[];
    ultimaMudanca: Date | null;
  }
): DadosDaSituacao {
  return {
    mapaStatus: projeto.mapaStatus,
    analiseComIA: comIA(projeto.analise),
    // Partes não selecionadas ficam fora do fluxo: como se não existissem.
    regioes: projeto.regioes.filter((r) => r.selecionada === true).map((r) => ({ status: r.status, plano: r.plano })),
    trabalhos: projeto.trabalhos,
    inspecaoConcluida: inspecaoEmDia(extras.inspecoes, extras.ultimaMudanca),
    esperandoEscolha: extras.esperandoEscolha,
    pedidosAbertos: extras.pedidosAbertos,
    algumEmAndamento: projeto.trabalhos.some((t) => t.status === 'EM_ANDAMENTO'),
    sessaoConectada: sessaoConectada(projeto.id),
  };
}

// Situação de um projeto já carregado: só faz as consultas que faltam.
export async function situacaoComDados(projeto: ProjetoParaSituacao): Promise<Situacao> {
  const [esperandoEscolha, pedidosAbertos, ultimaVersao, inspecoes] = await Promise.all([
    prisma.opcao.count({
      where: {
        projetoId: projeto.id,
        status: 'PRONTA',
        nota: { not: null },
        regiao: { selecionada: true, status: { in: REGIOES_PENDENTES } },
      },
    }),
    prisma.pedidoReferencia.count({ where: { projetoId: projeto.id, atendido: false } }),
    prisma.versao.findFirst({
      where: { projetoId: projeto.id },
      orderBy: [{ criadoEm: 'desc' }, { numero: 'desc' }],
      select: { criadoEm: true },
    }),
    prisma.trabalho.findMany({
      where: { projetoId: projeto.id, tipo: 'INSPECAO', status: 'CONCLUIDO' },
      select: { concluidoEm: true },
    }),
  ]);

  return calcularSituacao(
    montarDados(projeto, {
      esperandoEscolha,
      pedidosAbertos,
      inspecoes,
      ultimaMudanca: ultimaVersao?.criadoEm ?? null,
    })
  );
}

// Situação de um projeto, buscando tudo no banco.
export async function situacaoDoProjeto(projetoId: number): Promise<Situacao> {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: {
      id: true,
      mapaStatus: true,
      analise: true,
      regioes: { select: { status: true, plano: true, selecionada: true } },
      trabalhos: { where: { status: { in: ESTADOS_ATIVOS } }, select: { tipo: true, status: true } },
    },
  });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');
  return situacaoComDados(projeto);
}

// Situações de vários projetos, em lote (poucas consultas, sem uma por projeto).
export async function situacoesDosProjetos(projetoIds: number[]): Promise<Map<number, Situacao>> {
  const mapa = new Map<number, Situacao>();
  if (projetoIds.length === 0) return mapa;

  const [projetos, trabalhos, inspecoes, versoes, escolhas, pedidos] = await Promise.all([
    prisma.projeto.findMany({
      where: { id: { in: projetoIds } },
      select: {
        id: true,
        mapaStatus: true,
        analise: true,
        regioes: { select: { status: true, plano: true, selecionada: true } },
      },
    }),
    prisma.trabalho.findMany({
      where: { projetoId: { in: projetoIds }, status: { in: ESTADOS_ATIVOS } },
      select: { projetoId: true, tipo: true, status: true },
    }),
    prisma.trabalho.findMany({
      where: { projetoId: { in: projetoIds }, tipo: 'INSPECAO', status: 'CONCLUIDO' },
      select: { projetoId: true, concluidoEm: true },
    }),
    prisma.versao.groupBy({
      by: ['projetoId'],
      where: { projetoId: { in: projetoIds } },
      _max: { criadoEm: true },
    }),
    prisma.opcao.groupBy({
      by: ['projetoId'],
      where: {
        projetoId: { in: projetoIds },
        status: 'PRONTA',
        nota: { not: null },
        regiao: { selecionada: true, status: { in: REGIOES_PENDENTES } },
      },
      _count: { _all: true },
    }),
    prisma.pedidoReferencia.groupBy({
      by: ['projetoId'],
      where: { projetoId: { in: projetoIds }, atendido: false },
      _count: { _all: true },
    }),
  ]);

  const ativosPorProjeto = new Map<number, { tipo: string; status: string }[]>();
  for (const t of trabalhos) {
    const lista = ativosPorProjeto.get(t.projetoId) ?? [];
    lista.push({ tipo: t.tipo, status: t.status });
    ativosPorProjeto.set(t.projetoId, lista);
  }
  const inspecoesPorProjeto = new Map<number, { concluidoEm: Date | null }[]>();
  for (const i of inspecoes) {
    const lista = inspecoesPorProjeto.get(i.projetoId) ?? [];
    lista.push({ concluidoEm: i.concluidoEm });
    inspecoesPorProjeto.set(i.projetoId, lista);
  }
  const ultimaMudancaPorProjeto = new Map(versoes.map((v) => [v.projetoId, v._max.criadoEm] as const));
  const esperandoPorProjeto = new Map(escolhas.map((g) => [g.projetoId, g._count._all] as const));
  const pedidosPorProjeto = new Map(pedidos.map((g) => [g.projetoId, g._count._all] as const));

  for (const p of projetos) {
    const projeto: ProjetoParaSituacao = {
      id: p.id,
      mapaStatus: p.mapaStatus,
      analise: p.analise,
      regioes: p.regioes,
      trabalhos: ativosPorProjeto.get(p.id) ?? [],
    };
    mapa.set(
      p.id,
      calcularSituacao(
        montarDados(projeto, {
          esperandoEscolha: esperandoPorProjeto.get(p.id) ?? 0,
          pedidosAbertos: pedidosPorProjeto.get(p.id) ?? 0,
          inspecoes: inspecoesPorProjeto.get(p.id) ?? [],
          ultimaMudanca: ultimaMudancaPorProjeto.get(p.id) ?? null,
        })
      )
    );
  }
  return mapa;
}
