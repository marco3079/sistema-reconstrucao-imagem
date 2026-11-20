import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { urlArquivo } from '../../lib/arquivos';
import { CATEGORIAS, ROTULO_CATEGORIA, ROTULO_PROBLEMA } from '../../lib/tipos';
import type { Opcao, ProjetoDetalhe, Regiao, Revisao, StatusRegiao } from '../../lib/tipos';
import { AreaTexto, Aviso, Botao, Caixa, Cartao, Modal, Selecao, Selo } from '../../ui';
import { GradeReconstrucao, estadoDaParte } from './GradeReconstrucao';
import type { EstadoDaParte } from './GradeReconstrucao';
import { Visualizador } from './Visualizador';
import type { PropsEtapa } from './tipos';
import './reconstrucao.css';

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

// Selo de cada estado da parte (regras em estadoDaParte).
const ESTADO_VISUAL: Record<EstadoDaParte, { rotulo: string; cor: CorSelo }> = {
  fora: { rotulo: 'Fora da reconstrução', cor: 'cinza' },
  espera: { rotulo: 'Aguardando', cor: 'amarelo' },
  gerando: { rotulo: 'Gerando', cor: 'azul' },
  revisao: { rotulo: 'Em revisão', cor: 'azul' },
  escolha: { rotulo: 'Sua vez', cor: 'amarelo' },
  aplicada: { rotulo: 'Aplicada', cor: 'verde' },
  ignorada: { rotulo: 'Ignorada', cor: 'cinza' },
};

// ---------- Comparador antes/depois (reutilizado pela etapa de resultado) ----------

interface PropsComparador {
  antes: ReactNode;
  depois: ReactNode;
  proporcao: number; // largura / altura da área comparada
  alturaMaxima?: boolean; // limita a altura a 70% da janela
}

export function Comparador({ antes, depois, proporcao, alturaMaxima = false }: PropsComparador) {
  const [posicao, setPosicao] = useState(50);
  const razao = proporcao > 0 && Number.isFinite(proporcao) ? proporcao : 1;
  const larguraCaixa = alturaMaxima ? `min(100%, calc(70vh * ${razao}))` : '100%';

  return (
    <div className="rec-comparador" style={{ width: larguraCaixa }}>
      <div className="rec-comparador-imagem" style={{ aspectRatio: String(razao) }}>
        <div className="rec-comparador-camada">{antes}</div>
        <div
          className="rec-comparador-camada"
          style={{ clipPath: `inset(0 0 0 ${posicao}%)` }}
        >
          {depois}
        </div>
        <span className="rec-etiqueta rec-etiqueta-antes">Antes</span>
        <span className="rec-etiqueta rec-etiqueta-depois">Depois</span>
      </div>
      <input
        type="range"
        className="rec-comparador-controle"
        min={0}
        max={100}
        value={posicao}
        aria-label="Deslizar entre antes e depois"
        onChange={(e) => setPosicao(Number(e.target.value))}
      />
    </div>
  );
}

// Comparador de uma opção: "antes" é a área atual da imagem, "depois" é o recorte da opção.
function ComparativoOpcao({
  opcao,
  arquivo,
  projeto,
  alturaMaxima = false,
}: {
  opcao: Opcao;
  arquivo: string;
  projeto: ProjetoDetalhe;
  alturaMaxima?: boolean;
}) {
  const ctx = opcao.parametros.contexto;
  const dx = projeto.largura - ctx.largura;
  const dy = projeto.altura - ctx.altura;
  const tamanhoFundo = `${(projeto.largura / ctx.largura) * 100}% ${(projeto.altura / ctx.altura) * 100}%`;
  const posicaoFundo = `${dx === 0 ? 0 : (ctx.x / dx) * 100}% ${dy === 0 ? 0 : (ctx.y / dy) * 100}%`;

  const antes = (
    <div
      role="img"
      aria-label="Imagem atual nesta área"
      style={{
        backgroundImage: `url("${urlArquivo(projeto.atualArquivo, 1600)}")`,
        backgroundSize: tamanhoFundo,
        backgroundPosition: posicaoFundo,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
  const depois = <img src={urlArquivo(arquivo, 800)} alt="Opção gerada" />;

  return (
    <Comparador
      antes={antes}
      depois={depois}
      proporcao={ctx.largura / ctx.altura}
      alturaMaxima={alturaMaxima}
    />
  );
}

// ---------- Helpers ----------

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado';
}

function corDaNota(nota: number): CorSelo {
  if (nota >= 7) return 'verde';
  if (nota >= 5) return 'amarelo';
  return 'vermelho';
}

function ultimaRevisaoDe(opcao: Opcao): Revisao | null {
  let ultima: Revisao | null = null;
  for (const r of opcao.revisoes) {
    if (ultima === null || r.id > ultima.id) ultima = r;
  }
  return ultima;
}

// ESCOLHIDA primeiro, depois por nota decrescente (sem nota por último), depois as mais novas.
function ordenarOpcoes(lista: Opcao[]): Opcao[] {
  return [...lista].sort((a, b) => {
    const escolhidaA = a.status === 'ESCOLHIDA' ? 0 : 1;
    const escolhidaB = b.status === 'ESCOLHIDA' ? 0 : 1;
    if (escolhidaA !== escolhidaB) return escolhidaA - escolhidaB;

    if (a.nota !== b.nota) {
      if (a.nota === null) return 1;
      if (b.nota === null) return -1;
      return b.nota - a.nota;
    }

    return b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id;
  });
}

// Assinatura do que a tela usa das opções: muda só quando id, status, nota ou arquivo mudam.
function assinaturaOpcoes(lista: Opcao[]): string {
  return JSON.stringify(lista.map((o) => [o.id, o.regiaoId, o.status, o.nota, o.arquivo]));
}

// ---------- Cartão de opção ----------

interface PropsCartaoOpcao {
  opcao: Opcao;
  projeto: ProjetoDetalhe;
  ocupado: boolean;
  aoEscolher: (opcao: Opcao) => void;
  aoDescartar: (opcao: Opcao) => void;
  aoAmpliar: (opcao: Opcao) => void;
}

function CartaoOpcao({ opcao, projeto, ocupado, aoEscolher, aoDescartar, aoAmpliar }: PropsCartaoOpcao) {
  const ultima = ultimaRevisaoDe(opcao);
  const podeUsar = opcao.status === 'PRONTA' || (opcao.status === 'REPROVADA' && opcao.arquivo !== null);
  const ctx = opcao.parametros.contexto;
  const razao = ctx.altura > 0 ? ctx.largura / ctx.altura : 1;
  const conjectura = opcao.parametros.conjectura === true;

  return (
    <article className={opcao.status === 'ESCOLHIDA' ? 'rec-cartao-opcao rec-cartao-escolhida' : 'rec-cartao-opcao'}>
      {opcao.arquivo && <ComparativoOpcao opcao={opcao} arquivo={opcao.arquivo} projeto={projeto} />}

      {!opcao.arquivo && opcao.status === 'GERANDO' && (
        <div className="rec-carregando-opcao" role="status" style={{ aspectRatio: String(razao) }}>
          Gerando no Canva...
        </div>
      )}

      {opcao.status === 'FALHOU' && <Aviso tipo="erro">{opcao.erro ?? 'A geração falhou.'}</Aviso>}

      <div>
        <strong className="rec-rotulo-opcao">{opcao.rotulo}</strong>
      </div>

      <div className="rec-selos">
        <Selo cor={opcao.origem === 'CANVA' ? 'azul' : 'cinza'}>{opcao.origem === 'CANVA' ? 'Canva' : 'Local'}</Selo>
        <Selo>{`rodada ${opcao.rodada}`}</Selo>
        {opcao.nota !== null && <Selo cor={corDaNota(opcao.nota)}>{`Revisor: ${opcao.nota}/10`}</Selo>}
        {opcao.status === 'REPROVADA' && <Selo cor="vermelho">Reprovada</Selo>}
        {opcao.status === 'ESCOLHIDA' && <Selo cor="verde">Aplicada</Selo>}
        {conjectura && <Selo cor="amarelo">Conjectura</Selo>}
      </div>

      {conjectura && (
        <p className="rec-texto-pequeno">
          Gerada sem referência. Envie uma referência para a equipe refazer com base em evidência.
        </p>
      )}

      {opcao.parametros.referenciasGeradas === true && (
        <p className="rec-texto-pequeno">Usou referência gerada pela IA.</p>
      )}

      {opcao.parecer && <p className="rec-texto-pequeno">{opcao.parecer}</p>}

      {opcao.status === 'REPROVADA' && ultima?.planoAjuste && (
        <p className="rec-texto-pequeno">{`Plano de ajuste: ${ultima.planoAjuste}`}</p>
      )}

      <div className="rec-acoes-opcao">
        {podeUsar && (
          <Botao desabilitado={ocupado} aoClicar={() => aoEscolher(opcao)}>
            Usar esta
          </Botao>
        )}
        {opcao.arquivo && (
          <Botao variante="texto" aoClicar={() => aoAmpliar(opcao)}>
            Ampliar
          </Botao>
        )}
        {opcao.status !== 'ESCOLHIDA' && (
          <Botao variante="texto" desabilitado={ocupado} aoClicar={() => aoDescartar(opcao)}>
            Descartar
          </Botao>
        )}
      </div>
    </article>
  );
}

// ---------- Etapa 3: reconstrução por partes ----------

export function EtapaReconstrucao({
  projeto,
  aoAtualizar,
  recarregar,
  regiaoSelecionada,
  aoSelecionarRegiao,
  irPara,
}: PropsEtapa) {
  // Partes que estão em uso (ignoradas ficam de fora), na ordem do projeto.
  const partes = useMemo<Regiao[]>(
    () => projeto.regioes.filter((r) => r.status !== 'IGNORADA').sort((a, b) => a.ordem - b.ordem),
    [projeto.regioes],
  );
  const parte = partes.find((r) => r.id === regiaoSelecionada) ?? null;
  const regiaoId = parte?.id ?? null;
  const resolvidas = partes.filter((r) => r.status === 'RESOLVIDA').length;
  const percentual = partes.length > 0 ? Math.round((resolvidas / partes.length) * 100) : 0;

  const [todasOpcoes, setTodasOpcoes] = useState<Opcao[]>([]);
  // Opções de todas as partes do projeto: dão o estado de cada parte na grade e na lista.
  const [opcoesDoProjeto, setOpcoesDoProjeto] = useState<Opcao[]>([]);
  const [versaoOpcoes, setVersaoOpcoes] = useState(0);
  const [mostrarReprovadas, setMostrarReprovadas] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ampliada, setAmpliada] = useState<Opcao | null>(null);
  const [modal, setModal] = useState<'canva' | 'agentes' | null>(null);
  const [instrucoesCanva, setInstrucoesCanva] = useState('');
  const [quantidadeCanva, setQuantidadeCanva] = useState('4');
  const [usarReferencias, setUsarReferencias] = useState(true);
  const [erroCanva, setErroCanva] = useState<string | null>(null);
  const [instrucoesAgentes, setInstrucoesAgentes] = useState('');
  const [confirmarMelhores, setConfirmarMelhores] = useState(false);
  const [avisoMelhores, setAvisoMelhores] = useState<string | null>(null);
  const [erroMelhores, setErroMelhores] = useState<string | null>(null);
  const [rolarPainel, setRolarPainel] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);
  // Sempre a versão mais recente de recarregar, sem fazer o polling reiniciar a cada render.
  const recarregarRef = useRef(recarregar);
  recarregarRef.current = recarregar;

  const opcoesDaParte = todasOpcoes.filter((o) => o.regiaoId === regiaoId);

  // Estado de cada parte (regras de estadoDaParte), com as opções do projeto inteiro.
  const estados = useMemo(() => {
    const mapa = new Map<number, EstadoDaParte>();
    for (const r of partes) {
      mapa.set(r.id, estadoDaParte(r, opcoesDoProjeto.filter((o) => o.regiaoId === r.id)));
    }
    return mapa;
  }, [partes, opcoesDoProjeto]);

  // Partes marcadas para reconstruir: são as da lista e as da ordem de "Próxima parte".
  const partesDoFluxo = useMemo(() => partes.filter((r) => r.selecionada), [partes]);
  // Lista da tela: partes marcadas mais a que estiver em foco.
  const listaPartes = useMemo(
    () => partes.filter((r) => r.selecionada || r.id === regiaoId),
    [partes, regiaoId],
  );

  const temParteAtiva = partes.some((r) => {
    const estado = estados.get(r.id);
    return estado === 'gerando' || estado === 'revisao';
  });
  // Trabalho ativo ou parte gerando/em revisão: a etapa recarrega o projeto no polling.
  const precisaAtualizarProjeto = projeto.trabalhos.length > 0 || temParteAtiva;
  const temEscolhaPendente = partes.some((r) => estados.get(r.id) === 'escolha');

  const trabalhoEmAndamento = projeto.trabalhos.some((t) => t.status === 'EM_ANDAMENTO');
  const opcaoGerando = opcoesDaParte.some((o) => o.status === 'GERANDO');
  // 3 s com geração ou trabalho em andamento; 15 s só com trabalho na fila; sem trabalho, sem repetição.
  const intervaloPolling =
    opcaoGerando || temParteAtiva || trabalhoEmAndamento ? 3000 : precisaAtualizarProjeto ? 15000 : 0;

  // Melhores opções que "Aplicar as melhores" vai usar (regra do servidor: nota 8 ou mais, maior nota, depois id maior).
  const melhoresParaAplicar = useMemo(() => {
    const escolhidas: Opcao[] = [];
    for (const r of partesDoFluxo) {
      if (r.status !== 'PENDENTE' && r.status !== 'EM_ANDAMENTO') continue;
      const candidatas = opcoesDoProjeto
        .filter((o) => o.regiaoId === r.id && o.status === 'PRONTA' && o.nota !== null && o.nota >= 8)
        .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0) || b.id - a.id);
      if (candidatas[0]) escolhidas.push(candidatas[0]);
    }
    return escolhidas;
  }, [partesDoFluxo, opcoesDoProjeto]);
  const totalMelhores = melhoresParaAplicar.length;
  const conjecturasMelhores = melhoresParaAplicar.filter((o) => o.parametros.conjectura === true).length;

  // Selecione sozinho uma parte marcada quando a atual não existe na lista.
  useEffect(() => {
    if (partes.length === 0 || parte) return;
    const candidata = partesDoFluxo.find((r) => r.status !== 'RESOLVIDA') ?? partesDoFluxo[0];
    if (candidata) aoSelecionarRegiao(candidata.id);
  }, [partes, partesDoFluxo, parte, aoSelecionarRegiao]);

  // Ao trocar de parte, esconde avisos da parte anterior.
  useEffect(() => {
    setAviso(null);
    setErroAcao(null);
  }, [regiaoId]);

  // Clicar numa parte da grade rola até o painel de opções dela.
  useEffect(() => {
    if (!rolarPainel) return;
    setRolarPainel(false);
    painelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [rolarPainel]);

  // Busca as opções da parte e as do projeto inteiro; repete a cada 3 s enquanto houver geração ou trabalho em andamento.
  useEffect(() => {
    if (regiaoId === null) return;
    let cancelado = false;
    const buscar = () => {
      if (precisaAtualizarProjeto) recarregarRef.current();
      api
        .get<Opcao[]>(`/regioes/${regiaoId}/opcoes`)
        .then((lista) => {
          if (!cancelado) setTodasOpcoes((atual) => (assinaturaOpcoes(atual) === assinaturaOpcoes(lista) ? atual : lista));
        })
        .catch(() => undefined);
      api
        .get<Opcao[]>(`/projetos/${projeto.id}/opcoes`)
        .then((lista) => {
          // Só troca o estado quando algo mudou, para os useMemo não recalcularem a cada volta.
          if (!cancelado) setOpcoesDoProjeto((atual) => (assinaturaOpcoes(atual) === assinaturaOpcoes(lista) ? atual : lista));
        })
        .catch(() => undefined);
    };
    buscar();
    const intervalo = intervaloPolling > 0 ? window.setInterval(buscar, intervaloPolling) : undefined;
    return () => {
      cancelado = true;
      if (intervalo !== undefined) window.clearInterval(intervalo);
    };
  }, [regiaoId, projeto.id, versaoOpcoes, intervaloPolling, precisaAtualizarProjeto]);

  function atualizarOpcoes() {
    setVersaoOpcoes((v) => v + 1);
  }

  async function executar(acao: () => Promise<void>, sucesso?: string) {
    setOcupado(true);
    setErroAcao(null);
    setAviso(null);
    try {
      await acao();
      if (sucesso) setAviso(sucesso);
    } catch (erro) {
      setErroAcao(mensagemDeErro(erro));
    } finally {
      setOcupado(false);
      atualizarOpcoes();
    }
  }

  function gerarLocais() {
    if (!parte) return;
    const id = parte.id;
    return executar(async () => {
      await api.post<Opcao[]>(`/regioes/${id}/opcoes/locais`, {});
    });
  }

  async function gerarCanva() {
    if (!parte) return;
    const id = parte.id;
    setOcupado(true);
    setErroCanva(null);
    try {
      await api.post<Opcao[]>(`/regioes/${id}/opcoes/canva`, {
        instrucoes: instrucoesCanva,
        quantidade: Number(quantidadeCanva),
        usarReferencias,
      });
      setModal(null);
      setInstrucoesCanva('');
    } catch (erro) {
      setErroCanva(mensagemDeErro(erro));
    } finally {
      setOcupado(false);
      atualizarOpcoes();
    }
  }

  function pedirAosAgentes() {
    if (!parte) return;
    const id = parte.id;
    setModal(null);
    return executar(
      async () => {
        await api.post(`/projetos/${projeto.id}/trabalhos`, {
          tipo: 'REGIAO',
          regiaoId: id,
          instrucoes: instrucoesAgentes,
        });
        setInstrucoesAgentes('');
        recarregar();
      },
      'Pedido na fila. Acompanhe no painel da equipe.',
    );
  }

  function escolher(opcao: Opcao) {
    return executar(
      async () => {
        const resposta = await api.post<ProjetoDetalhe>(`/opcoes/${opcao.id}/escolher`);
        aoAtualizar(resposta);
      },
      'Opção aplicada na imagem.',
    );
  }

  function descartar(opcao: Opcao) {
    return executar(async () => {
      await api.del(`/opcoes/${opcao.id}`);
    });
  }

  function mudarStatus(status: StatusRegiao) {
    if (!parte) return;
    const id = parte.id;
    return executar(async () => {
      await api.put<Regiao>(`/regioes/${id}`, { status });
      recarregar();
    });
  }

  function fecharCanva() {
    setModal(null);
    setErroCanva(null);
  }

  // Clique numa parte da grade: seleciona a mesma parte na lista e rola até o painel dela.
  function selecionarNaGrade(id: number | null) {
    if (id === null) return;
    aoSelecionarRegiao(id);
    setRolarPainel(true);
  }

  async function aplicarMelhores() {
    setConfirmarMelhores(false);
    setOcupado(true);
    setErroMelhores(null);
    setAvisoMelhores(null);
    try {
      const resposta = await api.post<{ aplicadas: number; conjecturas?: number; projeto: ProjetoDetalhe }>(
        `/projetos/${projeto.id}/opcoes/aplicar-melhores`,
        { notaMinima: 8 },
      );
      aoAtualizar(resposta.projeto);
      const n = resposta.aplicadas;
      const m = resposta.conjecturas ?? conjecturasMelhores;
      setAvisoMelhores(
        `${n} parte${n === 1 ? '' : 's'} aplicada${n === 1 ? '' : 's'}; ${m} sem referência sua (conjectura).`,
      );
    } catch (erro) {
      setErroMelhores(mensagemDeErro(erro));
    } finally {
      setOcupado(false);
      atualizarOpcoes();
    }
  }

  if (partes.length === 0) {
    return (
      <Cartao>
        <Aviso tipo="info">Nenhuma parte marcada. Volte para a análise e marque as partes.</Aviso>
        <Botao variante="secundario" aoClicar={() => irPara('analise')}>
          Ir para análise
        </Botao>
      </Cartao>
    );
  }

  const indiceAtual = partesDoFluxo.findIndex((r) => r.id === regiaoId);
  const proxima =
    partesDoFluxo.slice(indiceAtual + 1).find((r) => r.status !== 'RESOLVIDA') ??
    partesDoFluxo.find((r, i) => i !== indiceAtual && r.status !== 'RESOLVIDA') ??
    null;

  function irProxima() {
    if (proxima) aoSelecionarRegiao(proxima.id);
    else irPara('resultado');
  }

  const visiveis = ordenarOpcoes(opcoesDaParte).filter((o) => mostrarReprovadas || o.status !== 'REPROVADA');
  // Partes com opção aprovada pelo revisor (PRONTA com nota) esperando a escolha do usuário.
  const partesComOpcaoAprovada = new Set(
    opcoesDoProjeto.filter((o) => o.status === 'PRONTA' && o.nota !== null).map((o) => o.regiaoId),
  );
  const esperaEscolha = (r: Regiao) =>
    (r.status === 'PENDENTE' || r.status === 'EM_ANDAMENTO') && partesComOpcaoAprovada.has(r.id);
  const aguardandoEscolha = parte !== null && esperaEscolha(parte);
  const vinculosDaParte = new Set(
    projeto.vinculos.filter((v) => regiaoId !== null && v.regiaoId === regiaoId).map((v) => v.referenciaId),
  ).size;

  return (
    <div className="rec-layout">
      <div className="rec-grade-card">
        <Cartao titulo="Grade de reconstrução">
          <GradeReconstrucao
            modo="aoVivo"
            projeto={projeto}
            opcoes={opcoesDoProjeto}
            regiaoSelecionada={regiaoId}
            aoSelecionarRegiao={selecionarNaGrade}
          />

          {temEscolhaPendente && (
            <div className="rec-grade-acoes">
              <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => setConfirmarMelhores(true)}>
                Aplicar as melhores (nota 8 ou mais)
              </Botao>
            </div>
          )}
          {avisoMelhores && <Aviso tipo="sucesso">{avisoMelhores}</Aviso>}
          {erroMelhores && <Aviso tipo="erro">{erroMelhores}</Aviso>}

          <Modal
            aberto={confirmarMelhores}
            titulo="Aplicar as melhores"
            aoFechar={() => setConfirmarMelhores(false)}
          >
            {totalMelhores > 0 ? (
              <p>{`Vou aplicar a melhor opção em ${totalMelhores} parte(s).`}</p>
            ) : (
              <p>Nenhuma parte alcança a nota 8.</p>
            )}
            {conjecturasMelhores > 0 && (
              <Aviso tipo="info">
                {`${conjecturasMelhores} dela(s) foram refeitas sem uma referência sua: é palpite da IA.`}
              </Aviso>
            )}
            <div className="rec-acoes-opcao">
              <Botao variante="secundario" aoClicar={() => setConfirmarMelhores(false)}>
                Cancelar
              </Botao>
              <Botao desabilitado={ocupado || totalMelhores === 0} aoClicar={aplicarMelhores}>
                Aplicar
              </Botao>
            </div>
          </Modal>
        </Cartao>
      </div>

      <Cartao>
        <div className="rec-progresso">
          <p className="rec-texto-pequeno">{`${resolvidas} de ${partes.length} partes resolvidas`}</p>
          <div
            className="rec-progresso-barra"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={partes.length}
            aria-valuenow={resolvidas}
          >
            <div className="rec-progresso-preenchido" style={{ width: `${percentual}%` }} />
          </div>
        </div>

        {listaPartes.length === 0 ? (
          <div>
            <Aviso tipo="info">Nenhuma parte marcada. Volte para a análise e marque as partes.</Aviso>
            <Botao variante="secundario" aoClicar={() => irPara('analise')}>
              Ir para análise
            </Botao>
          </div>
        ) : (
          CATEGORIAS.map((categoria) => {
            const doGrupo = listaPartes.filter((r) => r.categoria === categoria);
            if (doGrupo.length === 0) return null;
            return (
              <section key={categoria} className="rec-grupo-partes">
                <h3 className="rec-grupo-titulo">{ROTULO_CATEGORIA[categoria]}</h3>
                <ul className="rec-lista-partes">
                  {doGrupo.map((r) => {
                    const visual = ESTADO_VISUAL[estados.get(r.id) ?? 'espera'];
                    const selecionada = r.id === regiaoId;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          className={selecionada ? 'rec-item-parte rec-item-selecionado' : 'rec-item-parte'}
                          aria-pressed={selecionada}
                          onClick={() => aoSelecionarRegiao(r.id)}
                        >
                          <span className="rec-item-nome">{r.nome}</span>
                          <span className="rec-selos">
                            <Selo>{ROTULO_PROBLEMA[r.problema]}</Selo>
                            <Selo cor={visual.cor}>{visual.rotulo}</Selo>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </Cartao>

      {parte && (
        <div className="rec-painel-parte" ref={painelRef}>
          <Cartao>
            {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
            {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

            <div className="rec-cabecalho-parte">
              <div className="rec-visualizador-pequeno">
                <Visualizador
                  arquivo={projeto.atualArquivo}
                  largura={projeto.largura}
                  altura={projeto.altura}
                  regioes={[parte]}
                  selecionada={parte.id}
                />
              </div>
              <div>
                <h2>{parte.nome}</h2>
                {parte.descricao && <p>{parte.descricao}</p>}
                {vinculosDaParte > 0 ? (
                  <p className="rec-texto-pequeno">
                    {vinculosDaParte === 1
                      ? '1 referência ligada a esta parte.'
                      : `${vinculosDaParte} referências ligadas a esta parte.`}
                  </p>
                ) : (
                  <div className="rec-texto-pequeno">
                    <span>Sem referências ligadas a esta parte. </span>
                    <Botao variante="texto" aoClicar={() => irPara('referencias')}>
                      Abrir mapa
                    </Botao>
                  </div>
                )}
              </div>
            </div>

            {parte.plano !== '' && (
              <p className="oficina-plano">
                <strong>Plano de tratamento:</strong> {parte.plano}
              </p>
            )}

            <div className="rec-barra-gerar">
              <Botao variante="secundario" desabilitado={ocupado} aoClicar={gerarLocais}>
                Opções locais
              </Botao>
              <Botao desabilitado={ocupado} aoClicar={() => setModal('canva')}>
                Gerar no Canva
              </Botao>
              <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => setModal('agentes')}>
                Pedir aos agentes
              </Botao>
            </div>

            <Caixa
              rotulo="Mostrar reprovadas pelo revisor"
              marcado={mostrarReprovadas}
              aoMudar={setMostrarReprovadas}
            />

            {aguardandoEscolha && (
              <div className="rec-sua-vez" role="status">
                <strong>Sua vez: escolha uma opção para esta parte.</strong>
                <span>A escolha vira uma versão e pode ser desfeita.</span>
              </div>
            )}

            {visiveis.length === 0 ? (
              <p className="rec-vazio">Ainda não há opções para esta parte. Gere agora ou espere a equipe de agentes.</p>
            ) : (
              <div className="rec-grade-opcoes">
                {visiveis.map((opcao) => (
                  <CartaoOpcao
                    key={opcao.id}
                    opcao={opcao}
                    projeto={projeto}
                    ocupado={ocupado}
                    aoEscolher={escolher}
                    aoDescartar={descartar}
                    aoAmpliar={setAmpliada}
                  />
                ))}
              </div>
            )}

            <div className="rec-rodape">
              <div className="rec-acoes-opcao">
                <Botao variante="texto" desabilitado={ocupado} aoClicar={() => mudarStatus('RESOLVIDA')}>
                  Marcar como resolvida sem mudar
                </Botao>
                <Botao variante="texto" desabilitado={ocupado} aoClicar={() => mudarStatus('IGNORADA')}>
                  Ignorar esta parte
                </Botao>
                {parte.status === 'RESOLVIDA' && (
                  <Botao variante="texto" desabilitado={ocupado} aoClicar={() => mudarStatus('PENDENTE')}>
                    Reabrir
                  </Botao>
                )}
              </div>
              <Botao aoClicar={irProxima}>{proxima ? 'Próxima parte' : 'Ver resultado'}</Botao>
            </div>
          </Cartao>
        </div>
      )}

      <Modal aberto={modal === 'canva'} titulo="Gerar no Canva" aoFechar={fecharCanva}>
        <p className="rec-dica">Ex.: o vestido é azul-marinho, mantenha o sorriso da referência.</p>
        <AreaTexto
          rotulo="Instruções (opcional)"
          valor={instrucoesCanva}
          aoMudar={setInstrucoesCanva}
        />
        <Selecao
          rotulo="Quantas opções"
          valor={quantidadeCanva}
          aoMudar={(v) => {
            if (v) setQuantidadeCanva(v);
          }}
          opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: String(n) }))}
        />
        <Caixa rotulo="Usar as referências do mapa" marcado={usarReferencias} aoMudar={setUsarReferencias} />
        {erroCanva && (
          <Aviso tipo="erro">
            <span>{erroCanva} </span>
            <Link to="/app/configuracoes">Abrir configurações</Link>
          </Aviso>
        )}
        <Botao desabilitado={ocupado} aoClicar={gerarCanva}>
          Gerar
        </Botao>
      </Modal>

      <Modal aberto={modal === 'agentes'} titulo="Pedir aos agentes" aoFechar={() => setModal(null)}>
        <AreaTexto
          rotulo="O que você quer nesta parte (opcional)"
          valor={instrucoesAgentes}
          aoMudar={setInstrucoesAgentes}
        />
        <Botao desabilitado={ocupado} aoClicar={pedirAosAgentes}>
          Enviar para a equipe
        </Botao>
      </Modal>

      <Modal
        aberto={ampliada !== null}
        titulo={ampliada?.rotulo ?? 'Opção'}
        aoFechar={() => setAmpliada(null)}
      >
        {ampliada?.arquivo && (
          <ComparativoOpcao opcao={ampliada} arquivo={ampliada.arquivo} projeto={projeto} alturaMaxima />
        )}
      </Modal>
    </div>
  );
}
