// Tipos compartilhados com a API. Contrato completo em docs/CONTRATOS.md.

export type Perfil = 'ADMIN' | 'USUARIO';

export interface UsuarioLogado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
}

export type TipoProjeto = 'FOTO' | 'LOGO' | 'DOCUMENTO' | 'PRODUTO' | 'PAISAGEM' | 'OUTRO';
export type StatusProjeto = 'NOVO' | 'ANALISADO' | 'EM_RECONSTRUCAO' | 'CONCLUIDO';
export type Problema =
  | 'FALTANDO'
  | 'DANIFICADO'
  | 'BORRADO'
  | 'RUIDO'
  | 'DESBOTADO'
  | 'BAIXA_RESOLUCAO'
  | 'EXPOSICAO'
  | 'OUTRO'
  | 'NENHUM'; // parte da grade sem problema
export type StatusRegiao = 'PENDENTE' | 'EM_ANDAMENTO' | 'RESOLVIDA' | 'IGNORADA';
export type OrigemRegiao = 'LOCAL' | 'IA' | 'MANUAL';
// DEFEITO: parte marcada à mão ou a "Imagem inteira". ELEMENTO: rosto, roupa, objeto... inteiro. CELULA: célula da grade.
export type ClasseRegiao = 'DEFEITO' | 'ELEMENTO' | 'CELULA';
export type Categoria = 'ROSTO' | 'CORPO' | 'ROUPA' | 'OBJETO' | 'TEXTO' | 'FUNDO' | 'COR' | 'OUTRO';
export const CATEGORIAS: Categoria[] = ['ROSTO', 'CORPO', 'ROUPA', 'OBJETO', 'TEXTO', 'FUNDO', 'COR', 'OUTRO'];
export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  ROSTO: 'Rostos',
  CORPO: 'Corpos',
  ROUPA: 'Roupas',
  OBJETO: 'Objetos',
  TEXTO: 'Textos',
  FUNDO: 'Fundo e cenário',
  COR: 'Cores',
  OUTRO: 'Outras partes',
};
export type StatusReferencia = 'GERANDO' | 'PENDENTE' | 'APROVADA' | 'REPROVADA' | 'FALHOU';
export type PapelReferencia = 'ROSTO' | 'OBJETO' | 'ESTILO' | 'COR' | 'TEXTO' | 'CENARIO' | 'GERAL';
export type StatusOpcao = 'GERANDO' | 'PRONTA' | 'FALHOU' | 'ESCOLHIDA' | 'REPROVADA';
export type TipoTrabalho = 'ANALISE' | 'REFERENCIAS' | 'PLANO' | 'REGIAO' | 'INSPECAO' | 'CENA';
export type StatusMapa = 'RASCUNHO' | 'AGUARDANDO' | 'APROVADO';
export type StatusTrabalho = 'FILA' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'FALHOU' | 'CANCELADO';
export type NomeAgente =
  | 'maestro'
  | 'analista'
  | 'cartografo'
  | 'cenografo'
  | 'conservador'
  | 'restaurador'
  | 'gerador-canva'
  | 'revisor'
  | 'inspetor'
  | 'sistema';

export const TIPOS_PROJETO: { valor: TipoProjeto; rotulo: string }[] = [
  { valor: 'FOTO', rotulo: 'Foto' },
  { valor: 'LOGO', rotulo: 'Logo ou arte gráfica' },
  { valor: 'DOCUMENTO', rotulo: 'Documento ou texto' },
  { valor: 'PRODUTO', rotulo: 'Produto ou objeto' },
  { valor: 'PAISAGEM', rotulo: 'Paisagem ou ambiente' },
  { valor: 'OUTRO', rotulo: 'Outro' },
];

export const ROTULO_STATUS_PROJETO: Record<StatusProjeto, string> = {
  NOVO: 'Novo',
  ANALISADO: 'Analisado',
  EM_RECONSTRUCAO: 'Em reconstrução',
  CONCLUIDO: 'Concluído',
};

export const ROTULO_PROBLEMA: Record<Problema, string> = {
  FALTANDO: 'Parte faltando',
  DANIFICADO: 'Danificado',
  BORRADO: 'Borrado',
  RUIDO: 'Ruído',
  DESBOTADO: 'Desbotado',
  BAIXA_RESOLUCAO: 'Baixa resolução',
  EXPOSICAO: 'Exposição',
  OUTRO: 'Outro',
  NENHUM: 'Sem problema',
};

export const ROTULO_PAPEL: Record<PapelReferencia, string> = {
  ROSTO: 'Rosto ou pessoa',
  OBJETO: 'Objeto',
  ESTILO: 'Estilo',
  COR: 'Cor',
  TEXTO: 'Texto ou fonte',
  CENARIO: 'Cenário',
  GERAL: 'Geral',
};

export const ROTULO_AGENTE: Record<NomeAgente, string> = {
  maestro: 'Maestro',
  analista: 'Analista',
  cartografo: 'Cartógrafo de referências',
  cenografo: 'Cenógrafo',
  conservador: 'Conservador',
  restaurador: 'Restaurador',
  'gerador-canva': 'Gerador Canva',
  revisor: 'Revisor',
  inspetor: 'Inspetor',
  sistema: 'Sistema',
};

export interface Metricas {
  largura: number;
  altura: number;
  megapixels: number;
  nitidez: number; // 0 a 100
  ruido: number; // 0 a 100 (maior = mais ruído)
  contraste: number; // 0 a 100
  saturacao: number; // 0 a 100
  exposicao: number; // 0 a 100 (50 = ideal)
  temAlfa: boolean;
  tonsDeCinza: boolean;
}

export interface ProblemaGlobal {
  codigo: Problema;
  gravidade: number; // 1 a 5
  descricao: string;
}

export interface Analise {
  feitaEm: string;
  comIA: boolean;
  descricao: string;
  tipoSugerido: TipoProjeto;
  qualidade: number; // 0 a 100
  metricas: Metricas;
  problemas: ProblemaGlobal[];
  promptBase: string;
}

export interface Regiao {
  id: number;
  projetoId: number;
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  problema: Problema;
  gravidade: number;
  descricao: string;
  origem: OrigemRegiao;
  status: StatusRegiao;
  ordem: number;
  plano: string; // plano de tratamento da parte, escrito pelo conservador ('' se ainda não há)
  classe: ClasseRegiao;
  categoria: Categoria;
  selecionada: boolean; // o usuário quer reconstruir esta parte
  linha: number | null; // só para CELULA
  coluna: number | null;
  profundidade: number | null; // distância da parte à câmera, em metros (null = desconhecida)
}

export interface Referencia {
  id: number;
  projetoId: number;
  nome: string;
  arquivo: string;
  largura: number;
  altura: number;
  papel: PapelReferencia;
  observacao: string;
  origem: 'USUARIO' | 'CANVA'; // importada pelo usuário ou gerada no Canva para uma parte
  regiaoId: number | null; // parte para a qual foi importada ou gerada
  status: StatusReferencia; // as importadas já nascem APROVADA; as geradas passam pelo revisor
  nota: number | null;
  parecer: string;
  erro: string | null;
  criadoEm: string;
}

export interface Vinculo {
  id: number;
  referenciaId: number;
  regiaoId: number;
  peso: number; // 1 a 3
}

export interface PedidoReferencia {
  id: number;
  projetoId: number;
  regiaoId: number | null;
  descricao: string;
  papel: PapelReferencia;
  atendido: boolean;
  referenciaId: number | null;
}

export interface Revisao {
  id: number;
  opcaoId: number;
  veredito: 'APROVADA' | 'REPROVADA';
  nota: number;
  parecer: string;
  planoAjuste: string;
  criadoEm: string;
}

export interface Opcao {
  id: number;
  projetoId: number;
  regiaoId: number;
  origem: 'LOCAL' | 'CANVA';
  rotulo: string;
  // parametros.conjectura === true: opção do Canva gerada sem nenhuma referência no mapa da parte.
  parametros: { contexto: { x: number; y: number; largura: number; altura: number }; conjectura?: boolean; [chave: string]: unknown };
  arquivo: string | null;
  status: StatusOpcao;
  erro: string | null;
  rodada: number;
  nota: number | null;
  parecer: string | null;
  criadoEm: string;
  revisoes: Revisao[];
}

export interface Versao {
  id: number;
  projetoId: number;
  numero: number;
  arquivo: string;
  descricao: string;
  criadoEm: string;
}

export interface Trabalho {
  id: number;
  projetoId: number;
  tipo: TipoTrabalho;
  regiaoId: number | null;
  instrucoes: string;
  status: StatusTrabalho;
  resumo: string;
  criadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
}

export interface Evento {
  id: number;
  projetoId: number;
  trabalhoId: number | null;
  agente: NomeAgente;
  tipo: 'status' | 'acao' | 'nota' | 'revisao' | 'erro';
  texto: string;
  criadoEm: string;
}

export interface Projeto {
  id: number;
  nome: string;
  descricao: string;
  tipo: TipoProjeto;
  status: StatusProjeto;
  originalArquivo: string;
  atualArquivo: string;
  largura: number;
  altura: number;
  analise: Analise | null;
  mapaStatus: StatusMapa; // AGUARDANDO: o cartógrafo montou o mapa e espera a aprovação do usuário
  mapaAprovadoEm: string | null;
  gradeLinhas: number; // 0 = grade ainda não montada
  gradeColunas: number;
  criadoEm: string;
  atualizadoEm: string;
}

// Em que passo do fluxo a imagem está e de quem é a vez. Calculado pelo servidor (server/src/lib/situacao.ts).
export type CodigoPasso =
  | 'EXAME'
  | 'MAPA'
  | 'APROVAR_MAPA'
  | 'PLANO'
  | 'TRATAMENTO'
  | 'ESCOLHA'
  | 'INSPECAO'
  | 'LAUDO';

export type TelaDaOficina = 'analise' | 'referencias' | 'reconstrucao' | 'resultado' | 'equipe';

export interface PassoDoFluxo {
  codigo: CodigoPasso;
  titulo: string; // ex.: "Você aprova o mapa"
  quem: 'VOCE' | 'EQUIPE'; // quem faz este passo
  estado: 'feito' | 'atual' | 'depois';
}

export interface Situacao {
  passo: number; // 1 a 8: posição do passo atual
  total: number; // sempre 8
  codigo: CodigoPasso;
  titulo: string; // nome do passo atual
  descricao: string; // o que está acontecendo ou o que falta, em uma ou duas frases
  quem: 'VOCE' | 'EQUIPE' | 'CONCLUIDO'; // de quem é a vez agora
  aprovacao: boolean; // true quando a vez é do usuário e o que ele precisa fazer é aprovar ou escolher
  acao: { rotulo: string; tela: TelaDaOficina } | null; // botão que leva à tela onde se resolve
  parada: boolean; // é a vez da equipe, mas não há sessão do Claude Code ligada a esta imagem
  esperandoEscolha: number; // opções aprovadas pelo revisor que esperam a escolha do usuário
  passos: PassoDoFluxo[]; // os 8 passos, em ordem
}

export interface ProjetoResumo extends Omit<Projeto, 'analise'> {
  regioesTotal: number;
  regioesResolvidas: number;
  trabalhosAtivos: number;
  situacao: Situacao;
}

export interface ProjetoDetalhe extends Projeto {
  regioes: Regiao[];
  referencias: Referencia[];
  pedidos: PedidoReferencia[];
  vinculos: Vinculo[];
  versoes: Versao[];
  trabalhos: Trabalho[]; // só os que estão em FILA ou EM_ANDAMENTO
  situacao: Situacao;
  temCena: boolean; // o projeto tem mapa 3D gravado (a cena não vem aqui; ver GET /projetos/:id/cena)
}

export interface Atividade {
  trabalhos: Trabalho[];
  eventos: Evento[];
}

export interface StatusAgentes {
  conectado: boolean; // uma sessão do Claude Code chamou aguardar_trabalho nos últimos 90 s
  ultimoContato: string | null;
  naFila: number;
  emAndamento: number;
}

// Tela "Fluxo ao vivo": tudo o que a equipe está fazendo nos projetos do usuário.
export interface TrabalhoDoFluxo extends Trabalho {
  projetoNome: string;
  regiaoNome: string | null;
}

export interface EventoDoFluxo extends Evento {
  projetoNome: string;
}

export interface FluxoAgentes {
  status: StatusAgentes;
  trabalhos: TrabalhoDoFluxo[]; // ativos (FILA, EM_ANDAMENTO) e os 10 últimos encerrados, por id crescente
  eventos: EventoDoFluxo[]; // por id crescente
  aguardandoEscolha: number; // opções aprovadas pelo revisor que esperam a escolha do usuário
  mapasAguardando: number; // projetos do usuário com mapaStatus AGUARDANDO
}

// Laudo de restauração (GET /projetos/:id/laudo). Ver docs/NORMAS.md.
export interface PrincipioDoLaudo {
  titulo: string;
  texto: string;
  norma: string;
}

export interface TratamentoDaParte {
  opcaoId: number;
  origem: 'LOCAL' | 'CANVA';
  rotulo: string;
  rodada: number;
  nota: number | null;
  parecer: string | null;
  conjectura: boolean;
}

export interface ParteDoLaudo {
  id: number;
  nome: string;
  problema: Problema;
  gravidade: number;
  status: StatusRegiao;
  plano: string;
  classe: ClasseRegiao;
  categoria: Categoria;
  selecionada: boolean;
  referencias: number; // quantas referências estão no mapa da parte
  tratamento: TratamentoDaParte | null; // opção escolhida pelo usuário, se houver
}

export interface Laudo {
  geradoEm: string;
  projeto: { id: number; nome: string; tipo: TipoProjeto; status: StatusProjeto; largura: number; altura: number; criadoEm: string };
  descricao: string; // descrição do analista ('' se não houve)
  problemas: ProblemaGlobal[];
  medidas: { antes: Metricas; depois: Metricas; qualidadeAntes: number; qualidadeDepois: number };
  partes: ParteDoLaudo[];
  versoes: { numero: number; descricao: string; criadoEm: string }[];
  conteudoGerado: boolean; // alguma opção escolhida veio do Canva
  conjecturas: number; // quantas opções escolhidas são conjectura
  fonteDigital: string | null; // URI IPTC gravada no arquivo baixado; null se nada foi alterado
  principios: PrincipioDoLaudo[];
}

export interface StatusCanva {
  conectado: boolean;
  expiraEm: string | null;
}

export interface Painel {
  projetos: number;
  concluidos: number;
  regioesPendentes: number;
  opcoesGeradas: number;
  recentes: ProjetoResumo[];
  canva: StatusCanva;
  agentes: StatusAgentes;
  esperandoVoce: number; // imagens que esperam uma aprovação ou escolha do usuário
}
