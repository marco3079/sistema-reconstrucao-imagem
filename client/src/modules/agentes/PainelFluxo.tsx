import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { RAIZ } from '../../lib/rotas';
import { ROTULO_AGENTE } from '../../lib/tipos';
import type {
  Evento,
  EventoDoFluxo,
  FluxoAgentes,
  NomeAgente,
  Opcao,
  ProjetoDetalhe,
  StatusTrabalho,
  TipoTrabalho,
  TrabalhoDoFluxo,
} from '../../lib/tipos';
import { Aviso, Cartao, Carregando, Selo } from '../../ui';
import { Icone } from '../../ui/icones';
import { QuadroFluxo } from './QuadroFluxo';
import type { EstadoNo, LigacaoFluxo, NoFluxo } from './fluxoTipos';
import { ROTULO_ESTADO } from './fluxoTipos';
import { ConexaoProjeto } from './ConexaoProjeto';
import { GradeReconstrucao } from '../oficina/GradeReconstrucao';
import {
  AGENTES_DO_FLUXO,
  COR_ESTADO,
  DetalheAgente,
  ROTULO_TIPO_TRABALHO,
  STATUS_TRABALHO,
  horaCompleta,
} from './DetalheAgente';

// ---------- Constantes ----------

const INTERVALO_BUSCA_MS = 2500;
const INTERVALO_PROJETO_MS = 5000;
const MAXIMO_EVENTOS = 300;
const MINUTOS_ERRO_MS = 600000;
const MAXIMO_EVENTOS_LISTA = 40;
const MAXIMO_TRABALHOS_LISTA = 12;
const MAXIMO_PASSOS_CARTAO = 3;

const CHAVE_VISAO = 'restaura.fluxo.visao';
type Visao = 'fluxo' | 'agentes';

// Nós fixos: posição, título e aparência. Estado e texto são calculados em montarFluxo.
const NOS_BASE: Omit<NoFluxo, 'estado' | 'texto' | 'contador'>[] = [
  { id: 'entrada', titulo: 'Original preservado', subtitulo: 'Cópia de trabalho e medição', icone: 'imagem', cor: 'cinza', x: 0, y: 210 },
  { id: 'maestro', titulo: 'Maestro', subtitulo: 'Distribui as tarefas', icone: 'grupo', cor: 'azul', x: 260, y: 210 },
  { id: 'analista', titulo: 'Analista', subtitulo: 'Exame e laudo de estado', icone: 'busca', cor: 'roxo', x: 520, y: 50 },
  { id: 'cenografo', titulo: 'Cenógrafo', subtitulo: 'Mapa 3D da foto', icone: 'grade', cor: 'roxo', x: 520, y: 210 },
  { id: 'cartografo', titulo: 'Cartógrafo', subtitulo: 'Evidências: referências', icone: 'link', cor: 'roxo', x: 520, y: 370 },
  { id: 'mapa', titulo: 'Você aprova o mapa', subtitulo: 'Ajuste e aprovação', icone: 'fixar', cor: 'cinza', x: 780, y: 370 },
  { id: 'conservador', titulo: 'Conservador', subtitulo: 'Plano de tratamento', icone: 'tarefa', cor: 'azul', x: 1040, y: 210 },
  { id: 'restaurador', titulo: 'Restaurador', subtitulo: 'Correção por filtros', icone: 'lapis', cor: 'laranja', x: 1300, y: 50 },
  { id: 'gerador-canva', titulo: 'Gerador Canva', subtitulo: 'Reintegração de perdas', icone: 'paleta', cor: 'laranja', x: 1300, y: 370 },
  { id: 'revisor', titulo: 'Revisor', subtitulo: 'Controle de qualidade', icone: 'visto', cor: 'verde', x: 1560, y: 210 },
  { id: 'usuario', titulo: 'Você escolhe', subtitulo: 'Escolha reversível', icone: 'perfil', cor: 'cinza', x: 1820, y: 210 },
  { id: 'inspetor', titulo: 'Inspetor', subtitulo: 'Inspeção final', icone: 'medalha', cor: 'verde', x: 2080, y: 50 },
  { id: 'laudo', titulo: 'Laudo e procedência', subtitulo: 'Registro do tratamento', icone: 'documento', cor: 'cinza', x: 2080, y: 370 },
];

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// ---------- Regras ----------

// Função pura: a tela real e a demonstração passam por aqui.
// projetoId só muda o texto do nó maestro quando não há sessão (null na demonstração).
export function montarFluxo(
  dados: FluxoAgentes,
  agora: number,
  projetoId: number | null = null,
): { nos: NoFluxo[]; ligacoes: LigacaoFluxo[] } {
  const emAndamento = dados.trabalhos.filter((t) => t.status === 'EM_ANDAMENTO');
  const naFila = dados.trabalhos.filter((t) => t.status === 'FILA').sort((a, b) => a.id - b.id);
  const eventos = [...dados.eventos].sort((a, b) => a.id - b.id);

  const inicioDo = (t: TrabalhoDoFluxo): number => Date.parse(t.iniciadoEm ?? t.criadoEm);

  const pertence = (e: EventoDoFluxo, t: TrabalhoDoFluxo): boolean => {
    if (e.trabalhoId === t.id) return true;
    return e.trabalhoId === null && e.projetoId === t.projetoId && Date.parse(e.criadoEm) >= inicioDo(t);
  };

  const eventosAtivos = eventos.filter(
    (e) => e.agente !== 'sistema' && emAndamento.some((t) => pertence(e, t)),
  );

  // Último evento (maior id) de cada agente entre todos os carregados.
  const ultimo = new Map<NomeAgente, EventoDoFluxo>();
  for (const e of eventos) ultimo.set(e.agente, e);

  // Agentes especialistas que são o último a atuar em algum trabalho em andamento.
  const agentesAtivos = new Set<NomeAgente>();
  for (const t of emAndamento) {
    for (let i = eventos.length - 1; i >= 0; i--) {
      const e = eventos[i];
      if (e.agente === 'maestro' || e.agente === 'sistema') continue;
      if (pertence(e, t)) {
        agentesAtivos.add(e.agente);
        break;
      }
    }
  }

  const estadoEspecialista = (a: NomeAgente): EstadoNo => {
    const u = ultimo.get(a);
    if (u && u.tipo === 'erro' && agora - Date.parse(u.criadoEm) < MINUTOS_ERRO_MS) return 'erro';
    if (agentesAtivos.has(a)) return 'ativo';
    if (eventosAtivos.some((e) => e.agente === a)) return 'feito';
    return 'parado';
  };

  const estados: Record<string, { estado: EstadoNo; texto: string; contador?: number }> = {};

  for (const a of [
    'analista',
    'cenografo',
    'cartografo',
    'conservador',
    'restaurador',
    'gerador-canva',
    'revisor',
    'inspetor',
  ] as NomeAgente[]) {
    estados[a] = { estado: estadoEspecialista(a), texto: ultimo.get(a)?.texto ?? '' };
  }

  // Maestro.
  if (emAndamento.length > 0) {
    estados.maestro = {
      estado: 'ativo',
      texto: ultimo.get('maestro')?.texto || 'Conduzindo a equipe.',
      contador: emAndamento.length,
    };
  } else if (dados.status.conectado) {
    estados.maestro = { estado: 'espera', texto: 'Esperando o próximo trabalho.' };
  } else {
    estados.maestro = {
      estado: 'parado',
      texto:
        projetoId === null
          ? 'Sem sessão ligada a este projeto. Abra a pasta agentes no Claude Code e digite /restaurar e o número da imagem.'
          : `Sem sessão ligada a este projeto. Abra a pasta agentes no Claude Code e digite /restaurar ${projetoId}.`,
    };
  }

  // Entrada (fila).
  if (naFila.length > 0) {
    const proximo = naFila[0];
    estados.entrada = {
      estado: 'espera',
      texto: `${naFila.length} na fila. Próximo: ${ROTULO_TIPO_TRABALHO[proximo.tipo]} em ${proximo.projetoNome}.`,
      contador: naFila.length,
    };
  } else {
    estados.entrada = { estado: 'parado', texto: 'Nenhum trabalho esperando.', contador: 0 };
  }

  // Usuário (escolha).
  const aguardando = dados.aguardandoEscolha;
  if (aguardando > 0) {
    estados.usuario = {
      estado: 'espera',
      texto:
        aguardando === 1
          ? '1 opção aprovada esperando a sua escolha.'
          : `${aguardando} opções aprovadas esperando a sua escolha.`,
      contador: aguardando,
    };
  } else {
    estados.usuario = { estado: 'parado', texto: 'Nada para escolher agora.', contador: 0 };
  }

  // Mapa de referências: espera a aprovação do usuário (servidor antigo pode não mandar o campo).
  const mapasAguardando = dados.mapasAguardando ?? 0;
  estados.mapa =
    mapasAguardando > 0
      ? {
          estado: 'espera',
          texto:
            mapasAguardando === 1
              ? '1 mapa esperando a sua aprovação.'
              : `${mapasAguardando} mapas esperando a sua aprovação.`,
          contador: mapasAguardando,
        }
      : { estado: 'parado', texto: 'Nenhum mapa esperando aprovação.', contador: 0 };

  // Laudo: pronto quando há uma inspeção final concluída.
  const inspecaoConcluida = dados.trabalhos.some((t) => t.tipo === 'INSPECAO' && t.status === 'CONCLUIDO');
  estados.laudo = inspecaoConcluida
    ? { estado: 'feito', texto: 'Laudo pronto na etapa Resultado da imagem.' }
    : { estado: 'parado', texto: 'Disponível na etapa Resultado de cada imagem.' };

  const nos: NoFluxo[] = NOS_BASE.map((base) => {
    const e = estados[base.id];
    return { ...base, estado: e.estado, texto: e.texto, contador: e.contador };
  });

  const est = (id: string): EstadoNo => estados[id].estado;
  const revisorNaoFeito = est('revisor') !== 'feito';

  const ligacoes: LigacaoFluxo[] = [
    {
      id: 'l-entrada',
      de: 'entrada',
      para: 'maestro',
      rotulo: 'trabalho',
      ativa: est('maestro') === 'ativo' || (naFila.length > 0 && dados.status.conectado),
    },
    { id: 'l-analista', de: 'maestro', para: 'analista', ativa: est('analista') === 'ativo' },
    { id: 'l-cartografo', de: 'maestro', para: 'cartografo', ativa: est('cartografo') === 'ativo' },
    { id: 'l-cenografo', de: 'maestro', para: 'cenografo', ativa: est('cenografo') === 'ativo' },
    {
      id: 'l-partes',
      de: 'analista',
      para: 'conservador',
      rotulo: 'partes',
      ativa: est('conservador') === 'ativo',
    },
    {
      id: 'l-mapa',
      de: 'cartografo',
      para: 'mapa',
      rotulo: 'mapa',
      ativa: mapasAguardando > 0,
    },
    {
      id: 'l-aprovado',
      de: 'mapa',
      para: 'conservador',
      rotulo: 'aprovado',
      ativa: est('conservador') === 'ativo',
    },
    {
      id: 'l-plano-r',
      de: 'conservador',
      para: 'restaurador',
      rotulo: 'plano',
      ativa: est('restaurador') === 'ativo' && revisorNaoFeito,
    },
    {
      id: 'l-plano-g',
      de: 'conservador',
      para: 'gerador-canva',
      rotulo: 'plano',
      ativa: est('gerador-canva') === 'ativo' && revisorNaoFeito,
    },
    {
      id: 'l-opcoes-r',
      de: 'restaurador',
      para: 'revisor',
      rotulo: 'opções',
      ativa: est('revisor') === 'ativo' && est('restaurador') === 'feito',
    },
    {
      id: 'l-opcoes-g',
      de: 'gerador-canva',
      para: 'revisor',
      rotulo: 'opções',
      ativa: est('revisor') === 'ativo' && est('gerador-canva') === 'feito',
    },
    {
      id: 'l-aprovadas',
      de: 'revisor',
      para: 'usuario',
      rotulo: 'aprovadas',
      ativa: aguardando > 0 && (est('revisor') === 'ativo' || est('revisor') === 'feito'),
    },
    {
      id: 'l-ajuste-r',
      de: 'revisor',
      para: 'restaurador',
      rotulo: 'plano de ajuste',
      retorno: true,
      ativa: est('restaurador') === 'ativo' && est('revisor') === 'feito',
    },
    {
      id: 'l-ajuste-g',
      de: 'revisor',
      para: 'gerador-canva',
      rotulo: 'plano de ajuste',
      retorno: true,
      ativa: est('gerador-canva') === 'ativo' && est('revisor') === 'feito',
    },
    {
      id: 'l-escolhas',
      de: 'usuario',
      para: 'inspetor',
      rotulo: 'escolhas',
      ativa: est('inspetor') === 'ativo',
    },
    {
      id: 'l-registro',
      de: 'usuario',
      para: 'laudo',
      rotulo: 'versões',
      ativa: est('laudo') === 'feito',
    },
  ];

  return { nos, ligacoes };
}

// ---------- Demonstração ----------

const NOME_PROJETO_DEMO = 'Foto de exemplo';
const TRABALHO_ANALISE_DEMO = -1;
const TRABALHO_PLANO_DEMO = -2;
const TRABALHO_INSPECAO_DEMO = -3;
const TOTAL_PASSOS_DEMO = 20;
const INTERVALO_PASSO_DEMO_MS = 1800;

const DADOS_DEMO_INICIAIS: FluxoAgentes = {
  status: { conectado: true, ultimoContato: null, naFila: 0, emAndamento: 0 },
  trabalhos: [],
  eventos: [],
  aguardandoEscolha: 0,
  mapasAguardando: 0,
};

// Aplica um passo do roteiro. Ids negativos para não colidir com os dados reais.
function avancarDemo(d: FluxoAgentes, passo: number, agora: number): FluxoAgentes {
  const iso = new Date(agora).toISOString();
  const novos: EventoDoFluxo[] = [];
  const evento = (
    agente: NomeAgente,
    tipo: Evento['tipo'],
    texto: string,
    trabalhoId: number = TRABALHO_ANALISE_DEMO,
  ): void => {
    novos.push({
      id: -1000 + d.eventos.length + novos.length,
      projetoId: -1,
      trabalhoId,
      agente,
      tipo,
      texto,
      criadoEm: iso,
      projetoNome: NOME_PROJETO_DEMO,
    });
  };

  const trabalhoDemo = (id: number, tipo: TipoTrabalho, status: StatusTrabalho): TrabalhoDoFluxo => ({
    id,
    projetoId: -1,
    tipo,
    regiaoId: null,
    instrucoes: '',
    status,
    resumo: '',
    criadoEm: iso,
    iniciadoEm: null,
    concluidoEm: null,
    projetoNome: NOME_PROJETO_DEMO,
    regiaoNome: null,
  });

  // Atualiza um trabalho da demonstração pelo id (cria se ainda não existe, com o tipo dado).
  let trabalhos: TrabalhoDoFluxo[] = [...d.trabalhos];
  const alterar = (id: number, tipo: TipoTrabalho, mudanca: Partial<TrabalhoDoFluxo>): void => {
    const existe = trabalhos.some((t) => t.id === id);
    if (!existe) trabalhos = [...trabalhos, trabalhoDemo(id, tipo, 'FILA')];
    trabalhos = trabalhos.map((t) => (t.id === id ? { ...t, ...mudanca } : t));
  };
  let aguardando = d.aguardandoEscolha;
  let mapas = d.mapasAguardando;

  switch (passo) {
    case 1:
      alterar(TRABALHO_ANALISE_DEMO, 'ANALISE', { status: 'FILA', criadoEm: iso });
      evento('sistema', 'status', 'Trabalho na fila: Analisar a imagem.');
      break;
    case 2:
      alterar(TRABALHO_ANALISE_DEMO, 'ANALISE', { status: 'EM_ANDAMENTO', iniciadoEm: iso });
      evento('maestro', 'status', 'Trabalho iniciado: Analisar a imagem.');
      break;
    case 3:
      evento('analista', 'acao', 'Examinando a imagem e medindo a qualidade.');
      break;
    case 4:
      evento('analista', 'nota', 'Laudo de estado: canto rasgado, rosto borrado e céu desbotado.');
      break;
    case 5:
      evento('cartografo', 'acao', 'Pedi 1 referência do rosto e liguei 2 referências ao mapa.');
      break;
    case 6:
      evento('cartografo', 'status', 'Mapa de referências pronto para a sua aprovação.');
      mapas = 1;
      break;
    case 7:
      alterar(TRABALHO_ANALISE_DEMO, 'ANALISE', { status: 'CONCLUIDO', concluidoEm: iso });
      evento('maestro', 'status', 'Trabalho concluído: 3 partes; esperando você aprovar o mapa.');
      break;
    case 8:
      mapas = 0;
      evento('sistema', 'status', 'Mapa de referências aprovado por você.');
      alterar(TRABALHO_PLANO_DEMO, 'PLANO', { status: 'FILA', criadoEm: iso });
      break;
    case 9:
      alterar(TRABALHO_PLANO_DEMO, 'PLANO', { status: 'EM_ANDAMENTO', iniciadoEm: iso });
      evento('maestro', 'status', 'Trabalho iniciado: Planejar e tratar as partes.', TRABALHO_PLANO_DEMO);
      break;
    case 10:
      evento(
        'conservador',
        'nota',
        'Plano: 1) céu por filtro de cor; 2) canto rasgado com a referência 2; 3) rosto com nitidez leve, por último.',
        TRABALHO_PLANO_DEMO,
      );
      break;
    case 11:
      evento('restaurador', 'acao', 'Corrigindo a cor do céu com filtro local.', TRABALHO_PLANO_DEMO);
      break;
    case 12:
      evento('gerador-canva', 'acao', 'Recriando o canto rasgado com a referência do mapa.', TRABALHO_PLANO_DEMO);
      break;
    case 13:
      evento(
        'revisor',
        'revisao',
        'Reprovada (nota 5/10) a opção "Cor forte": céu saturado demais. Plano de ajuste: refazer com intensidade 1.',
        TRABALHO_PLANO_DEMO,
      );
      break;
    case 14:
      evento(
        'restaurador',
        'acao',
        'Refazendo a cor com intensidade 1, conforme o plano de ajuste.',
        TRABALHO_PLANO_DEMO,
      );
      break;
    case 15:
      evento(
        'revisor',
        'revisao',
        'Aprovada (nota 9/10) a opção "Cor suave": tom fiel à referência.',
        TRABALHO_PLANO_DEMO,
      );
      aguardando = 2;
      break;
    case 16:
      alterar(TRABALHO_PLANO_DEMO, 'PLANO', { status: 'CONCLUIDO', concluidoEm: iso });
      evento('maestro', 'status', 'Trabalho concluído: 3 partes, 2 opções aprovadas.', TRABALHO_PLANO_DEMO);
      break;
    case 17:
      aguardando = 0;
      evento('sistema', 'nota', 'Opção aplicada na parte "Céu desbotado": Cor suave.');
      alterar(TRABALHO_INSPECAO_DEMO, 'INSPECAO', { status: 'FILA', criadoEm: iso });
      break;
    case 18:
      alterar(TRABALHO_INSPECAO_DEMO, 'INSPECAO', { status: 'EM_ANDAMENTO', iniciadoEm: iso });
      evento('maestro', 'status', 'Trabalho iniciado: Inspeção final da imagem.', TRABALHO_INSPECAO_DEMO);
      evento(
        'inspetor',
        'acao',
        'Comparando a imagem final com a original e medindo antes e depois.',
        TRABALHO_INSPECAO_DEMO,
      );
      break;
    case 19:
      evento('inspetor', 'nota', 'Sem emendas visíveis. Qualidade medida: de 48 para 81.', TRABALHO_INSPECAO_DEMO);
      break;
    case 20:
      alterar(TRABALHO_INSPECAO_DEMO, 'INSPECAO', { status: 'CONCLUIDO', concluidoEm: iso });
      evento(
        'maestro',
        'status',
        'Trabalho concluído: imagem conferida, laudo disponível.',
        TRABALHO_INSPECAO_DEMO,
      );
      break;
    default:
      break;
  }

  const emAndamento = trabalhos.filter((t) => t.status === 'EM_ANDAMENTO').length;
  const naFila = trabalhos.filter((t) => t.status === 'FILA').length;

  return {
    status: { conectado: true, ultimoContato: iso, naFila, emAndamento },
    trabalhos,
    eventos: [...d.eventos, ...novos],
    aguardandoEscolha: aguardando,
    mapasAguardando: mapas,
  };
}

interface EstadoDemo {
  dados: FluxoAgentes;
  passo: number;
  agora: number;
}

function iniciarDemo(): EstadoDemo {
  const agora = Date.now();
  return { dados: avancarDemo(DADOS_DEMO_INICIAIS, 1, agora), passo: 1, agora };
}

// ---------- Preferência de visão ----------

function lerVisao(): Visao {
  try {
    return localStorage.getItem(CHAVE_VISAO) === 'agentes' ? 'agentes' : 'fluxo';
  } catch {
    return 'fluxo';
  }
}

function gravarVisao(v: Visao): void {
  try {
    localStorage.setItem(CHAVE_VISAO, v);
  } catch {
    // Sem armazenamento: a escolha vale só nesta tela.
  }
}

// ---------- Painel ----------

export interface PropsPainelFluxo {
  projetoId: number;
  demonstracao?: boolean;
}

export function PainelFluxo({ projetoId, demonstracao = false }: PropsPainelFluxo) {
  const [real, setReal] = useState<FluxoAgentes | null>(null);
  const [agoraReal, setAgoraReal] = useState<number>(() => Date.now());
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [projeto, setProjeto] = useState<ProjetoDetalhe | null>(null);
  const [opcoes, setOpcoes] = useState<Opcao[] | null>(null);
  const [demo, setDemo] = useState<EstadoDemo | null>(() => (demonstracao ? iniciarDemo() : null));
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const navegar = useNavigate();

  const ultimoId = useRef<number>(0);
  const emVoo = useRef<boolean>(false);
  const temDados = useRef<boolean>(false);

  // Eventos deste projeto (a cada 2,5 s). Trocar de projeto recomeça o acúmulo.
  useEffect(() => {
    if (demonstracao) return;
    let ativo = true;
    ultimoId.current = 0;
    emVoo.current = false;
    temDados.current = false;
    setReal(null);
    setErroBusca(null);

    const buscar = () => {
      if (emVoo.current) return;
      emVoo.current = true;
      api
        .get<FluxoAgentes>(`/agentes/fluxo?depois=${ultimoId.current}&projeto=${projetoId}`)
        .then((resposta) => {
          if (!ativo) return;
          temDados.current = true;
          for (const e of resposta.eventos) {
            if (e.id > ultimoId.current) ultimoId.current = e.id;
          }
          setAgoraReal(Date.now());
          setErroBusca(null);
          setReal((atual) => {
            const todos = atual ? [...atual.eventos, ...resposta.eventos] : [...resposta.eventos];
            const cortados = todos.length > MAXIMO_EVENTOS ? todos.slice(todos.length - MAXIMO_EVENTOS) : todos;
            return {
              status: resposta.status,
              trabalhos: resposta.trabalhos,
              eventos: cortados,
              aguardandoEscolha: resposta.aguardandoEscolha,
              mapasAguardando: resposta.mapasAguardando ?? 0,
            };
          });
        })
        .catch((e: unknown) => {
          // Erro pontual é ignorado; só a primeira busca falhando aparece na tela.
          if (ativo && !temDados.current) setErroBusca(mensagem(e));
        })
        .finally(() => {
          emVoo.current = false;
        });
    };

    buscar();
    const intervalo = window.setInterval(buscar, INTERVALO_BUSCA_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [projetoId, demonstracao]);

  // Dados do projeto para o detalhe dos agentes (a cada 5 s).
  useEffect(() => {
    if (demonstracao) return;
    let ativo = true;
    setProjeto(null);
    setOpcoes(null);

    const buscar = () => {
      Promise.all([
        api.get<ProjetoDetalhe>(`/projetos/${projetoId}`),
        api.get<Opcao[]>(`/projetos/${projetoId}/opcoes`),
      ])
        .then(([p, o]) => {
          if (!ativo) return;
          setProjeto(p);
          setOpcoes(o);
        })
        .catch(() => {
          // Sem detalhe por enquanto: a próxima rodada tenta de novo.
        });
    };

    buscar();
    const intervalo = window.setInterval(buscar, INTERVALO_PROJETO_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [projetoId, demonstracao]);

  // Roteiro da demonstração: um passo a cada 1,8 s, parado no último.
  useEffect(() => {
    if (!demo || demo.passo >= TOTAL_PASSOS_DEMO) return;
    const id = window.setTimeout(() => {
      setDemo((d) => {
        if (!d || d.passo >= TOTAL_PASSOS_DEMO) return d;
        const agora = Date.now();
        return { dados: avancarDemo(d.dados, d.passo + 1, agora), passo: d.passo + 1, agora };
      });
    }, INTERVALO_PASSO_DEMO_MS);
    return () => window.clearTimeout(id);
  }, [demo]);

  const escolherVisao = (v: Visao) => {
    setVisao(v);
    gravarVisao(v);
  };

  const dadosAtivos: FluxoAgentes | null = demo ? demo.dados : real;
  const agoraAtivo = demo ? demo.agora : agoraReal;

  const quadro = useMemo(
    () => (dadosAtivos ? montarFluxo(dadosAtivos, agoraAtivo, demonstracao ? null : projetoId) : null),
    [dadosAtivos, agoraAtivo, demonstracao, projetoId],
  );

  const noSelecionado = quadro?.nos.find((n) => n.id === selecionado) ?? null;

  const detalhe = (no: NoFluxo, variante: 'flutuante' | 'fixo') =>
    dadosAtivos && (
      <DetalheAgente
        no={no}
        dados={dadosAtivos}
        projetoId={projetoId}
        projeto={projeto}
        opcoes={opcoes}
        demonstracao={demonstracao}
        variante={variante}
        aoFechar={() => setSelecionado(null)}
      />
    );

  return (
    <>
      <ConexaoProjeto projetoId={demonstracao ? null : projetoId} status={dadosAtivos ? dadosAtivos.status : null} />

      {!demonstracao && projeto && opcoes && (
        <Cartao titulo="Reconstrução ao vivo">
          <GradeReconstrucao
            modo="aoVivo"
            projeto={projeto}
            opcoes={opcoes}
            aoSelecionarRegiao={() => navegar(`${RAIZ}/projetos/${projetoId}?etapa=reconstrucao`)}
          />
        </Cartao>
      )}

      {!dadosAtivos && (erroBusca ? <Aviso tipo="erro">{erroBusca}</Aviso> : <Carregando />)}

      {dadosAtivos && quadro && (
        <>
          {!demonstracao && (
            <div className="fluxo-faixa">
              <Selo cor={dadosAtivos.status.conectado ? 'verde' : 'amarelo'}>
                {dadosAtivos.status.conectado ? 'Equipe conectada' : 'Aguardando sessão deste projeto'}
              </Selo>
              <Selo>Na fila: {dadosAtivos.trabalhos.filter((t) => t.status === 'FILA').length}</Selo>
              <Selo cor="azul">
                Em andamento: {dadosAtivos.trabalhos.filter((t) => t.status === 'EM_ANDAMENTO').length}
              </Selo>
              <Selo cor="amarelo">Esperando sua escolha: {dadosAtivos.aguardandoEscolha}</Selo>
            </div>
          )}

          <div className="fluxo-alternador" role="group" aria-label="Forma de ver a equipe">
            <button
              type="button"
              className="botao botao-secundario"
              aria-pressed={visao === 'fluxo'}
              onClick={() => escolherVisao('fluxo')}
            >
              Fluxograma
            </button>
            <button
              type="button"
              className="botao botao-secundario"
              aria-pressed={visao === 'agentes'}
              onClick={() => escolherVisao('agentes')}
            >
              Agentes
            </button>
          </div>

          {visao === 'fluxo' ? (
            <div className="fluxo-area">
              <div className="fluxo-quadro">
                <QuadroFluxo
                  nos={quadro.nos}
                  ligacoes={quadro.ligacoes}
                  selecionado={selecionado}
                  aoSelecionar={setSelecionado}
                />
              </div>

              {!selecionado && (
                <p className="fluxo-suave fluxo-dica">
                  Clique num nó para ver o que ele está fazendo. Arraste para mover, use a roda do mouse para o zoom.
                </p>
              )}

              <div aria-live="polite" className="fluxo-painel-area">
                {noSelecionado && detalhe(noSelecionado, 'flutuante')}
              </div>
            </div>
          ) : (
            <div aria-live="polite" className={`fluxo-visao-agentes${noSelecionado ? ' fluxo-com-detalhe' : ''}`}>
              <div className="fluxo-agentes">
                {quadro.nos.map((no) => (
                  <CartaoAgente
                    key={no.id}
                    no={no}
                    eventos={dadosAtivos.eventos}
                    selecionado={no.id === selecionado}
                    aoSelecionar={() => setSelecionado(no.id === selecionado ? null : no.id)}
                  />
                ))}
              </div>
              {noSelecionado && <div className="fluxo-agentes-detalhe">{detalhe(noSelecionado, 'fixo')}</div>}
            </div>
          )}

          <div className="fluxo-baixo">
            <ListaTrabalhos trabalhos={dadosAtivos.trabalhos} />
            <ListaEventos eventos={dadosAtivos.eventos} />
          </div>
        </>
      )}
    </>
  );
}

// ---------- Cartão de um nó na visão "Agentes" ----------

function CartaoAgente({
  no,
  eventos,
  selecionado,
  aoSelecionar,
}: {
  no: NoFluxo;
  eventos: EventoDoFluxo[];
  selecionado: boolean;
  aoSelecionar: () => void;
}) {
  const ehAgente = AGENTES_DO_FLUXO.includes(no.id);
  const passos = ehAgente
    ? eventos
        .filter((e) => e.agente === no.id)
        .slice(-MAXIMO_PASSOS_CARTAO)
        .reverse()
    : [];
  const classes = [
    'fluxo-agente',
    `fluxo-cor-${no.cor}`,
    no.estado === 'ativo' ? 'fluxo-agente-ativo' : '',
    selecionado ? 'fluxo-agente-selecionado' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  return (
    <button type="button" className={classes} aria-pressed={selecionado} onClick={aoSelecionar}>
      <span className="fluxo-agente-topo">
        <span className="fluxo-agente-icone">
          <Icone nome={no.icone} tamanho={22} />
        </span>
        <span className="fluxo-agente-titulos">
          <strong>{no.titulo}</strong>
          <span className="fluxo-suave">{no.subtitulo}</span>
        </span>
      </span>
      <Selo cor={COR_ESTADO[no.estado]}>{ROTULO_ESTADO[no.estado]}</Selo>
      {no.texto && <span className="fluxo-agente-texto">{no.texto}</span>}
      {passos.map((e) => (
        <span key={e.id} className="fluxo-agente-passo">
          <span className="fluxo-hora">{horaCompleta(e.criadoEm)}</span> {e.texto}
        </span>
      ))}
    </button>
  );
}

// ---------- Listas ----------

function ListaTrabalhos({ trabalhos }: { trabalhos: TrabalhoDoFluxo[] }) {
  const lista = [...trabalhos].sort((a, b) => b.id - a.id).slice(0, MAXIMO_TRABALHOS_LISTA);
  return (
    <Cartao titulo="Trabalhos">
      {lista.length === 0 ? (
        <p className="fluxo-suave">Nenhum trabalho ainda.</p>
      ) : (
        <ul className="fluxo-lista">
          {lista.map((t) => (
            <li key={t.id}>
              <strong>{ROTULO_TIPO_TRABALHO[t.tipo]}</strong>
              {t.projetoId > 0 ? (
                <Link to={`${RAIZ}/projetos/${t.projetoId}`}>{t.projetoNome}</Link>
              ) : (
                <span className="fluxo-suave">{t.projetoNome}</span>
              )}
              {t.regiaoNome && <span className="fluxo-suave">{t.regiaoNome}</span>}
              <Selo cor={STATUS_TRABALHO[t.status].cor}>{STATUS_TRABALHO[t.status].rotulo}</Selo>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function ListaEventos({ eventos }: { eventos: EventoDoFluxo[] }) {
  const lista = eventos.slice(-MAXIMO_EVENTOS_LISTA).reverse();
  return (
    <Cartao titulo="Últimos eventos">
      {lista.length === 0 ? (
        <p className="fluxo-suave">Nada por aqui ainda.</p>
      ) : (
        <ul className="fluxo-lista fluxo-eventos">
          {lista.map((e) => (
            <li key={e.id} className={e.tipo === 'erro' ? 'fluxo-evento-erro' : undefined}>
              <span className="fluxo-hora">{horaCompleta(e.criadoEm)}</span>
              <strong>{ROTULO_AGENTE[e.agente]}</strong>
              <span className="fluxo-suave">{e.projetoNome}</span>
              <span>{e.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
