import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, CSSProperties, DragEvent, ReactElement } from 'react';
import { api } from '../../lib/api';
import { TAMANHO_MAXIMO_ENVIO, TIPOS_DE_IMAGEM_ACEITOS, urlArquivo, urlRecorte } from '../../lib/arquivos';
import { CATEGORIAS, ROTULO_CATEGORIA, ROTULO_PROBLEMA } from '../../lib/tipos';
import type { Categoria, Opcao, Problema, ProjetoDetalhe, Referencia, Regiao, StatusCanva, Vinculo } from '../../lib/tipos';
import { Link } from 'react-router-dom';
import { RAIZ } from '../../lib/rotas';
import { Aviso, Botao, Modal, Selo, formatarDataHora } from '../../ui';
import { GradeReconstrucao } from './GradeReconstrucao';
import { PainelCena } from './PainelCena';

interface PropsMapa {
  projeto: ProjetoDetalhe;
  aoAtualizar: (p: ProjetoDetalhe) => void;
  recarregar: () => void;
}

interface GrupoDePartes {
  categoria: Categoria;
  partes: Regiao[];
}

type Versao = 'original' | 'atual';

// Força da ligação de uma referência do usuário ou gerada aprovada (0 = não usa).
const NIVEIS_FORCA: { peso: number; rotulo: string }[] = [
  { peso: 1, rotulo: 'Fraca' },
  { peso: 2, rotulo: 'Média' },
  { peso: 3, rotulo: 'Forte' },
];

const PROBLEMAS_DE_FALTA: Problema[] = ['FALTANDO', 'DANIFICADO'];
const ALTURA_MAXIMA_RECORTE = 360;
// Com geração em andamento, 4 s; só com revisão pendente, 10 s.
const INTERVALO_GERANDO_MS = 4000;
const INTERVALO_PENDENTE_MS = 10000;

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado.';
}

function plural(n: number, singular: string, emPlural: string): string {
  return `${n} ${n === 1 ? singular : emPlural}`;
}

function nomeSemExtensao(nome: string): string {
  const semExtensao = nome.replace(/\.[^.]+$/, '').trim();
  return semExtensao || 'Referência';
}

// Mensagem de erro para um arquivo que não pode ser enviado (null = pode enviar).
function erroDoArquivo(arquivo: File): string | null {
  if (!arquivo.type.startsWith('image/')) return `${arquivo.name}: não é uma imagem.`;
  if (arquivo.size > TAMANHO_MAXIMO_ENVIO) return `${arquivo.name}: passa do limite de 30 MB.`;
  return null;
}

// Importa uma referência do usuário já ligada à parte (o servidor cria o vínculo com peso 3).
function enviarReferenciaDaParte(projetoId: number, regiaoId: number, arquivo: File): Promise<Referencia> {
  const nome = nomeSemExtensao(arquivo.name);
  return api.enviarArquivo<Referencia>(
    '/projetos/' + projetoId + '/referencias?nome=' + encodeURIComponent(nome) + '&papel=GERAL&regiaoId=' + regiaoId,
    arquivo,
    arquivo.type || 'application/octet-stream',
  );
}

// Recorte da parte feito no servidor (só a região, em alta): o fundo ocupa a caixa inteira.
function estiloRecorte(regiao: Regiao, arquivo: string, lado: number): CSSProperties {
  return {
    backgroundImage: `url("${urlRecorte(arquivo, regiao, lado)}")`,
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
  };
}

// Proporção (largura / altura) da parte em pixels da imagem.
function proporcaoDaParte(regiao: Regiao, projeto: ProjetoDetalhe): number {
  const largura = regiao.largura * projeto.largura;
  const altura = regiao.altura * projeto.altura;
  return largura > 0 && altura > 0 ? largura / altura : 1;
}

function rotuloNota(prefixo: string, nota: number | null): string {
  return nota === null ? prefixo : `${prefixo}: ${nota}/10`;
}

// Escolha de força com três botões (Fraca / Média / Forte).
function SeletorForca({
  atual,
  desabilitado,
  aoEscolher,
}: {
  atual: number;
  desabilitado: boolean;
  aoEscolher: (peso: number) => void;
}) {
  return (
    <div className="ref-el-forca" role="group" aria-label="Força da referência nesta parte">
      {NIVEIS_FORCA.map((nivel) => (
        <button
          key={nivel.peso}
          type="button"
          className="ref-el-chip"
          aria-pressed={atual === nivel.peso}
          disabled={desabilitado}
          onClick={() => aoEscolher(nivel.peso)}
        >
          {nivel.rotulo}
        </button>
      ))}
    </div>
  );
}

// Linha de uma referência importada pelo usuário.
function LinhaReferenciaUsuario({
  referencia,
  peso,
  ocupado,
  aoMudarForca,
  aoTirar,
}: {
  referencia: Referencia;
  peso: number;
  ocupado: boolean;
  aoMudarForca: (peso: number) => void;
  aoTirar: () => void;
}) {
  return (
    <li className="ref-el-item">
      <img className="ref-el-thumb" src={urlArquivo(referencia.arquivo, 160)} alt="" />
      <span className="ref-el-item-nome">{referencia.nome}</span>
      <div className="ref-el-item-acoes">
        <SeletorForca atual={peso} desabilitado={ocupado} aoEscolher={aoMudarForca} />
        <Botao variante="texto" desabilitado={ocupado} aoClicar={aoTirar}>
          Tirar desta parte
        </Botao>
      </div>
    </li>
  );
}

// Cartão de uma opção gerada no Canva, com o recorte original pequeno ao lado.
function CartaoOpcaoCanva({
  referencia,
  estiloOriginal,
  peso,
  ocupado,
  aoLigar,
  aoApagar,
}: {
  referencia: Referencia;
  estiloOriginal: CSSProperties;
  peso: number;
  ocupado: boolean;
  aoLigar: (peso: number) => void;
  aoApagar: () => void;
}) {
  const reprovada = referencia.status === 'REPROVADA';

  let imagem: ReactElement;
  if (referencia.status === 'GERANDO') {
    imagem = <div className="ref-el-esqueleto" aria-hidden="true" />;
  } else if (referencia.status === 'FALHOU') {
    imagem = <div className="ref-el-sem-imagem" aria-hidden="true" />;
  } else {
    imagem = (
      <img
        className={reprovada ? 'ref-el-opcao-imagem ref-el-opcao-esmaecida' : 'ref-el-opcao-imagem'}
        src={urlArquivo(referencia.arquivo, 400)}
        alt={`Opção gerada: ${referencia.nome}`}
      />
    );
  }

  let conteudo: ReactElement;
  if (referencia.status === 'GERANDO') {
    conteudo = (
      <p className="ref-el-status" role="status">
        Gerando no Canva...
      </p>
    );
  } else if (referencia.status === 'PENDENTE') {
    conteudo = <Selo cor="cinza">Esperando o revisor</Selo>;
  } else if (referencia.status === 'APROVADA') {
    conteudo = (
      <>
        <Selo cor="verde">{rotuloNota('Aprovada pelo revisor', referencia.nota)}</Selo>
        {referencia.parecer && <p className="ref-ajuda">{referencia.parecer}</p>}
        {peso === 0 ? (
          <div className="ref-el-item-acoes">
            <Botao desabilitado={ocupado} aoClicar={() => aoLigar(2)}>
              Usar como referência
            </Botao>
          </div>
        ) : (
          <div className="ref-el-item-acoes">
            <SeletorForca atual={peso} desabilitado={ocupado} aoEscolher={aoLigar} />
            <Botao variante="texto" desabilitado={ocupado} aoClicar={() => aoLigar(0)}>
              Não usar
            </Botao>
          </div>
        )}
      </>
    );
  } else if (referencia.status === 'REPROVADA') {
    conteudo = (
      <>
        <Selo cor="vermelho">{rotuloNota('Reprovada', referencia.nota)}</Selo>
        {referencia.parecer && <p className="ref-ajuda">{referencia.parecer}</p>}
      </>
    );
  } else {
    conteudo = (
      <>
        <p className="ref-el-erro">{referencia.erro ?? 'Não foi possível gerar esta opção.'}</p>
        <div className="ref-el-item-acoes">
          <Botao variante="secundario" desabilitado={ocupado} aoClicar={aoApagar}>
            Apagar
          </Botao>
        </div>
      </>
    );
  }

  return (
    <article className="ref-el-opcao">
      <div className="ref-el-opcao-linha">
        <div className="ref-el-opcao-original" style={estiloOriginal} role="img" aria-label="Recorte original, para comparar" />
        <div className="ref-el-opcao-corpo">
          {imagem}
          {conteudo}
        </div>
      </div>
    </article>
  );
}

export function MapaElementos({ projeto, aoAtualizar, recarregar }: PropsMapa) {
  const [parteEscolhida, setParteEscolhida] = useState<number | null>(null);
  const [versao, setVersao] = useState<Versao>('original');
  const [selecaoEditada, setSelecaoEditada] = useState<Set<number> | null>(null);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [erroOpcoes, setErroOpcoes] = useState<string | null>(null);
  const [canvaConectado, setCanvaConectado] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [errosEnvio, setErrosEnvio] = useState<string[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [erroAprovacao, setErroAprovacao] = useState<string | null>(null);
  const [sucessoAprovacao, setSucessoAprovacao] = useState<string | null>(null);
  const [confirmandoGerar, setConfirmandoGerar] = useState(false);
  const [pedindoGerar, setPedindoGerar] = useState(false);
  const [avisoGerar, setAvisoGerar] = useState<{ tipo: 'sucesso' | 'erro'; texto: string; configuracoes: boolean } | null>(null);
  const inputImportar = useRef<HTMLInputElement>(null);

  // Lista de vínculos usada como base dos PUTs: a resposta do último PUT, ou o projeto quando não há PUT em andamento.
  const vinculosRef = useRef<Vinculo[]>(projeto.vinculos);
  const projetoRef = useRef(projeto);
  projetoRef.current = projeto;
  const filaVinculos = useRef<Promise<void>>(Promise.resolve());
  const pendentesVinculos = useRef(0);
  useEffect(() => {
    if (pendentesVinculos.current === 0) vinculosRef.current = projeto.vinculos;
  }, [projeto.vinculos]);

  // Partes na ordem da tela: sem ignoradas, agrupadas por categoria, por ordem e id.
  const partesOrdenadas = useMemo(
    () =>
      projeto.regioes
        .filter((r) => r.status !== 'IGNORADA')
        .sort((a, b) => a.ordem - b.ordem || a.id - b.id),
    [projeto.regioes],
  );
  const grupos = useMemo<GrupoDePartes[]>(
    () =>
      CATEGORIAS.map((categoria) => ({
        categoria,
        partes: partesOrdenadas.filter((p) => p.categoria === categoria),
      })).filter((g) => g.partes.length > 0),
    [partesOrdenadas],
  );
  const naOrdemDaTela = useMemo(() => grupos.flatMap((g) => g.partes), [grupos]);

  const parte: Regiao | null = naOrdemDaTela.find((p) => p.id === parteEscolhida) ?? naOrdemDaTela[0] ?? null;

  // Seleção das partes a reconstruir: começa nas marcadas pelo servidor, até o usuário mexer.
  const selecaoPadrao = useMemo(
    () => new Set(projeto.regioes.filter((r) => r.selecionada).map((r) => r.id)),
    [projeto.regioes],
  );
  const selecao = selecaoEditada ?? selecaoPadrao;
  const idsSelecionados = naOrdemDaTela.filter((p) => selecao.has(p.id)).map((p) => p.id);

  const algumaGerando = projeto.referencias.some((r) => r.status === 'GERANDO');
  const algumaPendente = projeto.referencias.some((r) => r.status === 'PENDENTE');

  // Enquanto há geração (4 s) ou só revisão pendente (10 s), recarrega.
  const recarregarRef = useRef(recarregar);
  useEffect(() => {
    recarregarRef.current = recarregar;
  }, [recarregar]);
  const intervaloAtualizacao = algumaGerando ? INTERVALO_GERANDO_MS : algumaPendente ? INTERVALO_PENDENTE_MS : 0;
  useEffect(() => {
    if (intervaloAtualizacao === 0) return;
    const id = window.setInterval(() => recarregarRef.current(), intervaloAtualizacao);
    return () => window.clearInterval(id);
  }, [intervaloAtualizacao]);

  // Opções geradas do projeto (para a grade de reconstrução).
  useEffect(() => {
    let vivo = true;
    api
      .get<Opcao[]>('/projetos/' + projeto.id + '/opcoes')
      .then((lista) => {
        if (!vivo) return;
        setOpcoes(lista);
        setErroOpcoes(null);
      })
      .catch((err: unknown) => {
        if (vivo) setErroOpcoes(mensagemDeErro(err));
      });
    return () => {
      vivo = false;
    };
    // Só refaz quando o projeto muda de fato (id ou data de atualização).
  }, [projeto.id, projeto.atualizadoEm]);

  // Canva conectado ou não (controla o botão de gerar).
  useEffect(() => {
    let vivo = true;
    api
      .get<StatusCanva>('/canva/status')
      .then((r) => {
        if (vivo) setCanvaConectado(r.conectado);
      })
      .catch(() => {
        if (vivo) setCanvaConectado(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  function pesoDe(referenciaId: number, regiaoId: number): number {
    return projeto.vinculos.find((v) => v.referenciaId === referenciaId && v.regiaoId === regiaoId)?.peso ?? 0;
  }

  function estatisticasDaParte(p: Regiao) {
    const ligacoes = projeto.vinculos.filter((v) => v.regiaoId === p.id).length;
    const paraAvaliar = projeto.referencias.filter(
      (r) => r.origem === 'CANVA' && r.regiaoId === p.id && r.status === 'APROVADA' && pesoDe(r.id, p.id) === 0,
    ).length;
    const semReferencia = ligacoes === 0 && PROBLEMAS_DE_FALTA.includes(p.problema);
    return { ligacoes, paraAvaliar, semReferencia };
  }

  // Executa uma mudança no servidor com os controles travados; erro vai para o aviso da coluna.
  async function executar(acao: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setOcupado(false);
    }
  }

  // Mudanças de vínculo entram numa fila: cada PUT parte da resposta do anterior (lista completa).
  function alterarVinculo(referenciaId: number, regiaoId: number, peso: number): Promise<void> {
    pendentesVinculos.current += 1;
    setOcupado(true);
    setErro(null);
    const tarefa = filaVinculos.current.then(async () => {
      const vinculos: Omit<Vinculo, 'id'>[] = vinculosRef.current
        .filter((v) => !(v.referenciaId === referenciaId && v.regiaoId === regiaoId))
        .map((v) => ({ referenciaId: v.referenciaId, regiaoId: v.regiaoId, peso: v.peso }));
      if (peso > 0) vinculos.push({ referenciaId, regiaoId, peso });
      const resposta = await api.put<Vinculo[]>('/projetos/' + projetoRef.current.id + '/mapa', { vinculos });
      vinculosRef.current = resposta;
      aoAtualizar({ ...projetoRef.current, vinculos: resposta });
    });
    const fim = tarefa
      .catch((err: unknown) => {
        setErro(mensagemDeErro(err));
      })
      .finally(() => {
        pendentesVinculos.current -= 1;
        if (pendentesVinculos.current === 0) {
          setOcupado(false);
          recarregarRef.current();
        }
      });
    filaVinculos.current = fim;
    return fim;
  }

  function gerarOpcoes(regiao: Regiao): Promise<void> {
    return executar(async () => {
      await api.post<Referencia[]>('/regioes/' + regiao.id + '/referencias/gerar', { quantidade: 4 });
      recarregar();
    });
  }

  function apagarReferencia(referencia: Referencia): Promise<void> {
    return executar(async () => {
      await api.del('/referencias/' + referencia.id);
      recarregar();
    });
  }

  // Envia uma a uma as imagens soltas, coladas ou escolhidas para a parte atual.
  async function importar(lista: File[]) {
    if (!parte || ocupado || lista.length === 0) return;
    const erros: string[] = [];
    const validos: File[] = [];
    for (const arquivo of lista) {
      const problema = erroDoArquivo(arquivo);
      if (problema) erros.push(problema);
      else validos.push(arquivo);
    }
    setErrosEnvio(erros);
    setErro(null);
    if (validos.length === 0) return;

    const regiaoId = parte.id;
    setOcupado(true);
    try {
      for (const arquivo of validos) {
        try {
          await enviarReferenciaDaParte(projeto.id, regiaoId, arquivo);
        } catch (err) {
          erros.push(`${arquivo.name}: ${mensagemDeErro(err)}`);
          setErrosEnvio([...erros]);
        }
      }
    } finally {
      setOcupado(false);
      recarregar();
    }
  }

  async function aprovar() {
    if (ocupado) return;
    setOcupado(true);
    setErroAprovacao(null);
    setSucessoAprovacao(null);
    try {
      const resposta = await api.post<ProjetoDetalhe>('/projetos/' + projeto.id + '/mapa/aprovar', {
        selecao: idsSelecionados,
      });
      aoAtualizar(resposta);
      setSucessoAprovacao('Mapa aprovado. A equipe vai reconstruir só as partes marcadas, uma por vez.');
    } catch (err) {
      setErroAprovacao(mensagemDeErro(err));
    } finally {
      setOcupado(false);
    }
  }

  const aprovado = projeto.mapaStatus === 'APROVADO';
  const quantidade = idsSelecionados.length;

  // Geração em lote: mesmo critério do servidor (gerar-faltantes).
  // Fora: parte com qualquer vínculo a referência do usuário; com candidata CANVA GERANDO, PENDENTE ou APROVADA;
  // com 8 ou mais candidatas CANVA (de qualquer status).
  const idsUsuaria = new Set(projeto.referencias.filter((r) => r.origem === 'USUARIO').map((r) => r.id));
  const partesComUsuaria = new Set(projeto.vinculos.filter((v) => idsUsuaria.has(v.referenciaId)).map((v) => v.regiaoId));
  const partesComCandidataAtiva = new Set(
    projeto.referencias
      .filter((r) => r.origem === 'CANVA' && r.regiaoId !== null && ['GERANDO', 'PENDENTE', 'APROVADA'].includes(r.status))
      .map((r) => r.regiaoId as number),
  );
  const candidatasPorParte = new Map<number, number>();
  for (const r of projeto.referencias) {
    if (r.origem !== 'CANVA' || r.regiaoId === null) continue;
    candidatasPorParte.set(r.regiaoId, (candidatasPorParte.get(r.regiaoId) ?? 0) + 1);
  }
  const elegiveisParaGerar = projeto.regioes.filter(
    (r) =>
      r.selecionada &&
      r.problema !== 'NENHUM' &&
      r.status === 'PENDENTE' &&
      (r.classe === 'ELEMENTO' || r.classe === 'CELULA') &&
      !partesComUsuaria.has(r.id) &&
      !partesComCandidataAtiva.has(r.id) &&
      (candidatasPorParte.get(r.id) ?? 0) < 8,
  );
  const geracoesParaGerar = elegiveisParaGerar.length * 4;
  const restantesGerando = projeto.referencias.filter((r) => r.status === 'GERANDO').length;

  async function gerarFaltantes() {
    setConfirmandoGerar(false);
    setPedindoGerar(true);
    setAvisoGerar(null);
    try {
      const resposta = await api.post<{
        partes: number;
        criadas: number;
        ids: number[];
        motivo: string | null;
        revisao: 'PEDIDA' | 'SEM_SESSAO' | 'NAO_NECESSARIA';
      }>('/projetos/' + projeto.id + '/referencias/gerar-faltantes');
      const semSessao = resposta.revisao === 'SEM_SESSAO'
        ? ' A equipe não está conectada: as candidatas ficam sem a nota do revisor.'
        : '';
      if (resposta.criadas > 0) {
        setAvisoGerar({
          tipo: 'sucesso',
          texto: `Gerando ${resposta.criadas} candidatas para ${plural(resposta.partes, 'parte', 'partes')}. Elas aparecem em cada parte conforme ficam prontas.${semSessao}`,
          configuracoes: false,
        });
      } else {
        setAvisoGerar({
          tipo: 'erro',
          texto: (resposta.motivo ?? 'Nenhuma candidata foi criada.') + semSessao,
          configuracoes: true,
        });
      }
      recarregar();
    } catch (err) {
      setAvisoGerar({ tipo: 'erro', texto: mensagemDeErro(err), configuracoes: false });
    } finally {
      setPedindoGerar(false);
    }
  }

  function aoSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    importar(Array.from(e.dataTransfer.files));
  }

  function aoColar(e: ClipboardEvent<HTMLElement>) {
    const lista = Array.from(e.clipboardData.files);
    if (lista.length === 0) return;
    e.preventDefault();
    importar(lista);
  }

  function aoEscolherArquivos(e: ChangeEvent<HTMLInputElement>) {
    const lista: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    importar(lista);
  }

  if (!parte) {
    return (
      <div className="ref-el-tela">
        <p className="ref-vazio">A análise ainda não marcou partes.</p>
      </div>
    );
  }

  const proporcao = proporcaoDaParte(parte, projeto);
  const estiloProporcional: CSSProperties = {
    aspectRatio: String(proporcao),
    maxWidth: `${ALTURA_MAXIMA_RECORTE * proporcao}px`,
  };
  const arquivoAtual = versao === 'original' ? projeto.originalArquivo : projeto.atualArquivo;
  const estiloOriginal: CSSProperties = {
    ...estiloRecorte(parte, projeto.originalArquivo, 400),
    aspectRatio: String(proporcao),
  };

  const usuariasLigadas = projeto.referencias.filter((r) => r.origem === 'USUARIO' && pesoDe(r.id, parte.id) > 0);
  const usuariasLivres = projeto.referencias.filter((r) => r.origem === 'USUARIO' && pesoDe(r.id, parte.id) === 0);
  const canvaDaParte = projeto.referencias
    .filter((r) => r.origem === 'CANVA' && r.regiaoId === parte.id)
    .sort((a, b) => b.id - a.id);

  return (
    <div className="ref-el-tela">
      {projeto.mapaStatus === 'AGUARDANDO' && (
        <Aviso tipo="info">
          O cartógrafo montou o mapa e espera a sua aprovação. Confira as partes e as referências, ajuste o que quiser e
          aprove.
        </Aviso>
      )}
      {projeto.mapaStatus === 'RASCUNHO' && (
        <p className="ref-ajuda">O mapa ainda é um rascunho. Ajuste e aprove para a equipe planejar o tratamento.</p>
      )}
      {aprovado && (
        <div className="ref-el-estado">
          <Selo cor="verde">Mapa aprovado</Selo>
          <p className="ref-ajuda">Se você mudar o mapa, aprove de novo para a equipe refazer o plano.</p>
        </div>
      )}

      <PainelCena projeto={projeto} podeRefazer={!aprovado} />

      <Modal aberto={confirmandoGerar} titulo="Gerar referências" aoFechar={() => setConfirmandoGerar(false)}>
        <p>
          {plural(elegiveisParaGerar.length, 'parte', 'partes')}, {plural(geracoesParaGerar, 'geração', 'gerações')}.
          Cada geração usa créditos do seu Canva.
        </p>
        <div className="pagina-acoes">
          <Botao variante="secundario" aoClicar={() => setConfirmandoGerar(false)}>
            Cancelar
          </Botao>
          <Botao aoClicar={gerarFaltantes}>Gerar</Botao>
        </div>
      </Modal>

      <div className="ref-el-quadro">
        <aside className="ref-el-partes" aria-label="Partes da imagem">
          {(elegiveisParaGerar.length > 0 || restantesGerando > 0) && (
            <div className="ref-el-gerar">
              <div className="ref-el-gerar-linha">
                <Botao
                  desabilitado={ocupado || pedindoGerar || restantesGerando > 0}
                  aoClicar={() => setConfirmandoGerar(true)}
                >
                  {restantesGerando > 0
                    ? `Gerando... (${restantesGerando} restantes)`
                    : 'Gerar referências para todas as partes sem referência'}
                </Botao>
                <p className="ref-ajuda">Gera 4 candidatas no Canva por parte. Usa créditos do seu Canva.</p>
              </div>
              {avisoGerar && (
                <Aviso tipo={avisoGerar.tipo}>
                  {avisoGerar.texto}
                  {avisoGerar.configuracoes && (
                    <>
                      {' '}
                      <Link to={`${RAIZ}/configuracoes`}>Abrir Configurações</Link>
                    </>
                  )}
                </Aviso>
              )}
            </div>
          )}
          {grupos.map((grupo) => (
            <div key={grupo.categoria} className="ref-el-grupo">
              <h3 className="ref-el-grupo-titulo">
                <span>{ROTULO_CATEGORIA[grupo.categoria]}</span>
                <span>{grupo.partes.length}</span>
              </h3>
              {grupo.partes.map((p) => {
                const ativa = p.id === parte.id;
                const est = estatisticasDaParte(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={ativa ? 'ref-el-parte ref-el-parte-ativa' : 'ref-el-parte'}
                    aria-pressed={ativa}
                    onClick={() => setParteEscolhida(p.id)}
                  >
                    <span className="ref-el-miniatura" style={estiloRecorte(p, projeto.atualArquivo, 240)} aria-hidden="true" />
                    <span className="ref-el-parte-texto">
                      <strong>{p.nome}</strong>
                      <span className="ref-el-meta">{ROTULO_PROBLEMA[p.problema]}</span>
                      <span className="ref-el-selos">
                        <span className="ref-el-meta">{plural(est.ligacoes, 'referência', 'referências')}</span>
                        {est.semReferencia && <Selo cor="amarelo">Sem referência</Selo>}
                        {est.paraAvaliar > 0 && <Selo cor="azul">{`${est.paraAvaliar} para avaliar`}</Selo>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section
          className="ref-el-detalhe"
          aria-labelledby="ref-el-titulo-parte"
          tabIndex={0}
          onPaste={aoColar}
        >
          <header className="ref-el-cabecalho">
            <h3 id="ref-el-titulo-parte">{parte.nome}</h3>
            <div className="ref-el-selos">
              <Selo>{ROTULO_CATEGORIA[parte.categoria]}</Selo>
              <Selo>{ROTULO_PROBLEMA[parte.problema]}</Selo>
            </div>
            {parte.descricao && <p className="ref-ajuda">{parte.descricao}</p>}
          </header>

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          <div className="ref-el-bloco">
            <div className="ref-el-bloco-topo">
              <h4>Como está hoje</h4>
              <div className="ref-el-selos" role="group" aria-label="Imagem mostrada">
                <button
                  type="button"
                  className="ref-el-chip"
                  aria-pressed={versao === 'original'}
                  onClick={() => setVersao('original')}
                >
                  Original
                </button>
                <button
                  type="button"
                  className="ref-el-chip"
                  aria-pressed={versao === 'atual'}
                  onClick={() => setVersao('atual')}
                >
                  Atual
                </button>
              </div>
            </div>
            <div
              className="ref-el-recorte"
              style={{ ...estiloRecorte(parte, arquivoAtual, 1000), ...estiloProporcional }}
              role="img"
              aria-label={`${parte.nome}, ${versao === 'original' ? 'original' : 'atual'}`}
            />
            <p className="ref-ajuda">Recorte do original, ampliado. Fica aqui para você comparar com cada referência.</p>
          </div>

          <div className="ref-el-bloco">
            <h4>Suas referências para esta parte</h4>
            <div
              className={arrastando ? 'ref-el-zona ref-el-zona-arrastando' : 'ref-el-zona'}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={aoSoltar}
            >
              <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => inputImportar.current?.click()}>
                Importar referência
              </Botao>
              <span className="ref-ajuda">Arraste uma imagem para cá ou cole com Ctrl+V.</span>
              <input
                ref={inputImportar}
                type="file"
                multiple
                accept={TIPOS_DE_IMAGEM_ACEITOS}
                hidden
                onChange={aoEscolherArquivos}
              />
            </div>
            {errosEnvio.length > 0 && (
              <Aviso tipo="erro">
                <ul className="ref-el-erros">
                  {errosEnvio.map((texto, i) => (
                    <li key={`${i}-${texto}`}>{texto}</li>
                  ))}
                </ul>
              </Aviso>
            )}

            {usuariasLigadas.length === 0 ? (
              <p className="ref-vazio">Nenhuma referência sua ligada a esta parte ainda.</p>
            ) : (
              <ul className="ref-el-lista">
                {usuariasLigadas.map((r) => (
                  <LinhaReferenciaUsuario
                    key={r.id}
                    referencia={r}
                    peso={pesoDe(r.id, parte.id)}
                    ocupado={ocupado}
                    aoMudarForca={(peso) => alterarVinculo(r.id, parte.id, peso)}
                    aoTirar={() => alterarVinculo(r.id, parte.id, 0)}
                  />
                ))}
              </ul>
            )}

            {usuariasLivres.length > 0 && (
              <>
                <h5 className="ref-el-subtitulo">Outras referências desta imagem</h5>
                <ul className="ref-el-lista">
                  {usuariasLivres.map((r) => (
                    <li key={r.id} className="ref-el-item">
                      <img className="ref-el-thumb" src={urlArquivo(r.arquivo, 160)} alt="" />
                      <span className="ref-el-item-nome">{r.nome}</span>
                      <div className="ref-el-item-acoes">
                        <Botao
                          variante="secundario"
                          desabilitado={ocupado}
                          aoClicar={() => alterarVinculo(r.id, parte.id, 2)}
                        >
                          Usar nesta parte
                        </Botao>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="ref-el-bloco">
            <div className="ref-el-bloco-topo">
              <h4>Opções geradas no Canva</h4>
              <Botao desabilitado={ocupado || canvaConectado !== true} aoClicar={() => gerarOpcoes(parte)}>
                Gerar 4 opções no Canva
              </Botao>
            </div>
            {canvaConectado === false && (
              <p className="ref-ajuda">Conecte o Canva em Configurações para gerar opções.</p>
            )}
            <p className="ref-aviso-palpite">
              Opção gerada é um palpite da IA a partir do recorte. Só uma referência sua prova como a parte era.
            </p>

            {canvaDaParte.length === 0 ? (
              <p className="ref-vazio">Nenhuma opção gerada para esta parte ainda.</p>
            ) : (
              <div className="ref-el-opcoes">
                {canvaDaParte.map((r) => (
                  <CartaoOpcaoCanva
                    key={r.id}
                    referencia={r}
                    estiloOriginal={estiloOriginal}
                    peso={pesoDe(r.id, parte.id)}
                    ocupado={ocupado}
                    aoLigar={(peso) => alterarVinculo(r.id, parte.id, peso)}
                    aoApagar={() => apagarReferencia(r)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="ref-el-grade-bloco">
        <h3>Partes a reconstruir</h3>
        <p className="ref-ajuda">
          Marque as partes que a equipe deve reconstruir. As que têm problema já vêm marcadas. Cada parte é refeita no
          lugar dela, uma por vez.
        </p>
        {erroOpcoes && <Aviso tipo="erro">{erroOpcoes}</Aviso>}
        <GradeReconstrucao
          projeto={projeto}
          opcoes={opcoes}
          modo="selecao"
          selecao={selecao}
          aoMudarSelecao={(ids) => setSelecaoEditada(new Set(ids))}
        />
      </section>

      <div className={aprovado ? 'ref-el-aprovacao ref-el-aprovacao-ok' : 'ref-el-aprovacao ref-el-aprovacao-pendente'}>
        <div className="ref-el-aprovacao-texto">
          {aprovado ? (
            <>
              <strong>{`Mapa aprovado${projeto.mapaAprovadoEm ? ` em ${formatarDataHora(projeto.mapaAprovadoEm)}` : ''}`}</strong>
            </>
          ) : (
            <>
              <strong>Aprovação necessária</strong>
              <p className="ref-ajuda">
                A equipe só planeja e reconstrói depois que você aprovar. Você pode mudar e aprovar de novo.
              </p>
            </>
          )}
          {quantidade === 0 && <p className="ref-ajuda">Marque ao menos uma parte.</p>}
        </div>
        <div className="ref-el-aprovacao-acoes">
          {aprovado ? (
            <Botao variante="secundario" desabilitado={ocupado || quantidade === 0} aoClicar={aprovar}>
              Aprovar de novo com a seleção atual
            </Botao>
          ) : (
            <Botao desabilitado={ocupado || quantidade === 0} aoClicar={aprovar}>
              {`Aprovar mapa e reconstruir ${plural(quantidade, 'parte', 'partes')}`}
            </Botao>
          )}
        </div>
        {erroAprovacao && <Aviso tipo="erro">{erroAprovacao}</Aviso>}
        {sucessoAprovacao && <Aviso tipo="sucesso">{sucessoAprovacao}</Aviso>}
      </div>
    </div>
  );
}
