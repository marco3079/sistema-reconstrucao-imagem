import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { urlArquivo } from '../../lib/arquivos';
import { ROTULO_CATEGORIA } from '../../lib/tipos';
import type { Categoria, Opcao, ProjetoDetalhe, Regiao } from '../../lib/tipos';
import { Botao } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import './grade.css';

// Estado de uma parte na tela, na ordem das regras de docs/GRADE.md.
export type EstadoDaParte = 'fora' | 'espera' | 'gerando' | 'revisao' | 'escolha' | 'aplicada' | 'ignorada';

// Visual de uma parte: no modo selecao, a parte marcada ganha 'marcada'.
type VisualParte = EstadoDaParte | 'marcada';

// Pura: decide o estado de uma parte só com as opções dela.
export function estadoDaParte(regiao: Regiao, opcoes: Opcao[]): EstadoDaParte {
  if (regiao.status === 'IGNORADA') return 'ignorada';
  if (regiao.status === 'RESOLVIDA') return 'aplicada';
  if (!regiao.selecionada) return 'fora';
  if (opcoes.some((o) => o.status === 'GERANDO')) return 'gerando';
  if (opcoes.some((o) => o.status === 'PRONTA' && o.nota === null)) return 'revisao';
  if (opcoes.some((o) => o.status === 'PRONTA' && o.nota !== null)) return 'escolha';
  if (regiao.status === 'EM_ANDAMENTO') return 'gerando';
  return 'espera';
}

const ICONE_CATEGORIA: Record<Categoria, NomeIcone> = {
  ROSTO: 'perfil',
  CORPO: 'grupo',
  ROUPA: 'paleta',
  COR: 'paleta',
  FUNDO: 'imagem',
  TEXTO: 'documento',
  OBJETO: 'estrela',
  OUTRO: 'grade',
};

const ROTULO_VISUAL: Record<VisualParte, string> = {
  fora: 'fora da reconstrução',
  marcada: 'marcada para reconstrução',
  espera: 'aguardando',
  gerando: 'gerando',
  revisao: 'em revisão',
  escolha: 'sua vez de escolher',
  aplicada: 'aplicada',
  ignorada: 'ignorada',
};

const ESTADOS_LEGENDA: { estado: EstadoDaParte; rotulo: string }[] = [
  { estado: 'fora', rotulo: 'Fora' },
  { estado: 'espera', rotulo: 'Aguardando' },
  { estado: 'gerando', rotulo: 'Gerando' },
  { estado: 'revisao', rotulo: 'Em revisão' },
  { estado: 'escolha', rotulo: 'Sua vez' },
  { estado: 'aplicada', rotulo: 'Aplicada' },
];

// Abaixo desta largura (em px) a etiqueta some; o botão continua clicável e com aria-label.
const LARGURA_MINIMA_ETIQUETA = 44;

const SEM_SELECAO: Set<number> = new Set<number>();
const SEM_OPCOES: Opcao[] = [];

// Imagem inteira: DEFEITO que cobre a foto toda. Não vira retângulo na grade.
function ehImagemInteira(r: Regiao): boolean {
  return r.classe === 'DEFEITO' && r.x === 0 && r.y === 0 && r.largura === 1 && r.altura === 1;
}

// Nome curto da etiqueta: célula mostra só "A1"; elemento mostra o nome.
function etiquetaDe(r: Regiao): string {
  return r.classe === 'CELULA' ? r.nome.replace(/^Parte\s+/, '') : r.nome;
}

function visualDaParte(
  regiao: Regiao,
  opcoes: Opcao[],
  modo: 'selecao' | 'aoVivo',
  marcadas: Set<number>,
): VisualParte {
  if (modo === 'selecao') {
    if (regiao.status === 'RESOLVIDA') return 'aplicada';
    return marcadas.has(regiao.id) ? 'marcada' : 'fora';
  }
  return estadoDaParte(regiao, opcoes);
}

interface PropsBotaoParte {
  regiao: Regiao;
  visual: VisualParte;
  modo: 'selecao' | 'aoVivo';
  emFoco: boolean;
  mostrarEtiqueta: boolean;
  inteira?: boolean;
  estilo?: CSSProperties;
  aoClicar: () => void;
}

function BotaoParte({ regiao, visual, modo, emFoco, mostrarEtiqueta, inteira = false, estilo, aoClicar }: PropsBotaoParte) {
  const desabilitado = modo === 'selecao' && regiao.status === 'RESOLVIDA';
  const classes = ['grade-parte', `grade-parte-${visual}`];
  classes.push(regiao.classe === 'CELULA' ? 'grade-celula' : 'grade-elemento');
  if (inteira) classes.push('grade-inteira');
  if (emFoco) classes.push('grade-em-foco');

  const texto = visual === 'escolha' ? 'Sua vez' : etiquetaDe(regiao);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={estilo}
      aria-label={`${regiao.nome}: ${ROTULO_CATEGORIA[regiao.categoria]}, ${ROTULO_VISUAL[visual]}`}
      aria-pressed={modo === 'selecao' ? visual === 'marcada' : undefined}
      aria-current={emFoco ? 'true' : undefined}
      disabled={desabilitado}
      onClick={aoClicar}
    >
      {visual === 'gerando' && <span className="grade-varredura" aria-hidden="true" />}
      {visual === 'gerando' && <span className="grade-girador" aria-hidden="true" />}
      {visual === 'revisao' && (
        <span className="grade-centro" aria-hidden="true">
          <Icone nome="visto" tamanho={18} className="grade-pulso" />
        </span>
      )}
      {visual === 'aplicada' && (
        <span className="grade-visto" aria-hidden="true">
          <Icone nome="visto" tamanho={12} />
        </span>
      )}
      {visual === 'marcada' && (
        <span className="grade-caixa" aria-hidden="true">
          <Icone nome="visto" tamanho={12} />
        </span>
      )}
      {(mostrarEtiqueta || inteira) && (
        <span className="grade-etiqueta">
          <Icone nome={ICONE_CATEGORIA[regiao.categoria]} tamanho={12} />
          <span className="grade-etiqueta-texto">{inteira ? 'Imagem inteira' : texto}</span>
        </span>
      )}
    </button>
  );
}

interface PropsGrade {
  projeto: ProjetoDetalhe;
  opcoes: Opcao[]; // todas as opções do projeto (GET /projetos/:id/opcoes)
  modo: 'selecao' | 'aoVivo';
  selecao?: Set<number>; // modo selecao: ids marcados
  aoMudarSelecao?: (ids: Set<number>) => void;
  regiaoSelecionada?: number | null; // modo aoVivo: parte em foco
  aoSelecionarRegiao?: (id: number | null) => void;
}

interface Camadas {
  arquivos: [string, string];
  topo: 0 | 1;
}

export function GradeReconstrucao({
  projeto,
  opcoes,
  modo,
  selecao,
  aoMudarSelecao,
  regiaoSelecionada = null,
  aoSelecionarRegiao,
}: PropsGrade) {
  const quadroRef = useRef<HTMLDivElement>(null);
  const [larguraQuadro, setLarguraQuadro] = useState<number>(0);
  const [avisoConflito, setAvisoConflito] = useState<boolean>(false);
  const arquivoAtual = projeto.atualArquivo;
  const [camadas, setCamadas] = useState<Camadas>(() => ({
    arquivos: [arquivoAtual, arquivoAtual],
    topo: 0,
  }));

  // Troca a imagem alternando as duas camadas: a nova entra e a antiga sai com transição.
  useEffect(() => {
    setCamadas((c) => {
      if (c.arquivos[c.topo] === arquivoAtual) return c;
      const novoTopo: 0 | 1 = c.topo === 0 ? 1 : 0;
      const arquivos: [string, string] = [c.arquivos[0], c.arquivos[1]];
      arquivos[novoTopo] = arquivoAtual;
      return { arquivos, topo: novoTopo };
    });
  }, [arquivoAtual]);

  // Largura do quadro em px, para esconder a etiqueta de retângulos pequenos.
  useEffect(() => {
    const el = quadroRef.current;
    if (!el) return;
    const medir = () => setLarguraQuadro(el.clientWidth);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const partesVisiveis = useMemo(
    () => projeto.regioes.filter((r) => r.status !== 'IGNORADA').sort((a, b) => a.ordem - b.ordem),
    [projeto.regioes],
  );

  const opcoesPorParte = useMemo(() => {
    const mapa = new Map<number, Opcao[]>();
    for (const o of opcoes) {
      const lista = mapa.get(o.regiaoId);
      if (lista) lista.push(o);
      else mapa.set(o.regiaoId, [o]);
    }
    return mapa;
  }, [opcoes]);

  const marcadas = selecao ?? SEM_SELECAO;

  const visuais = useMemo(() => {
    const mapa = new Map<number, VisualParte>();
    for (const r of partesVisiveis) {
      mapa.set(r.id, visualDaParte(r, opcoesPorParte.get(r.id) ?? SEM_OPCOES, modo, marcadas));
    }
    return mapa;
  }, [partesVisiveis, opcoesPorParte, modo, marcadas]);

  const imagensInteiras = partesVisiveis.filter(ehImagemInteira);
  const celulas = partesVisiveis.filter((r) => r.classe === 'CELULA');
  // Elementos (e DEFEITO marcado à mão) por cima das células.
  const elementos = partesVisiveis.filter((r) => r.classe !== 'CELULA' && !ehImagemInteira(r));

  const razao = projeto.largura > 0 && projeto.altura > 0 ? projeto.largura / projeto.altura : 1;

  function estiloDaParte(r: Regiao): CSSProperties {
    return {
      left: `${r.x * 100}%`,
      top: `${r.y * 100}%`,
      width: `${r.largura * 100}%`,
      height: `${r.altura * 100}%`,
    };
  }

  function clicarParte(r: Regiao) {
    if (modo === 'aoVivo') {
      aoSelecionarRegiao?.(r.id);
      return;
    }
    if (r.status === 'RESOLVIDA') return;
    const novo = new Set(marcadas);
    let desmarcou = false;
    if (novo.has(r.id)) {
      novo.delete(r.id);
    } else if (idsInteira.has(r.id)) {
      // Marcar a imagem inteira desmarca as demais.
      for (const id of novo) {
        novo.delete(id);
        desmarcou = true;
      }
      novo.add(r.id);
    } else {
      // Marcar outra parte desmarca a imagem inteira.
      for (const id of idsInteira) {
        if (novo.delete(id)) desmarcou = true;
      }
      novo.add(r.id);
    }
    setAvisoConflito(desmarcou);
    aoMudarSelecao?.(novo);
  }

  function substituirSelecao(ids: number[]) {
    aoMudarSelecao?.(new Set(ids));
  }

  const marcaveis = partesVisiveis.filter((r) => r.status !== 'RESOLVIDA');
  // Imagem inteira não combina com as outras partes: marcar uma desmarca a outra.
  const idsInteira = new Set(imagensInteiras.map((r) => r.id));
  const marcaveisSemInteira = marcaveis.filter((r) => !idsInteira.has(r.id));
  const totalMarcadas = marcaveis.filter((r) => marcadas.has(r.id)).length;

  // Modo aoVivo: progresso sobre as partes selecionadas.
  const fluxo = partesVisiveis.filter((r) => r.selecionada);
  const feitas = fluxo.filter((r) => r.status === 'RESOLVIDA').length;
  const percentual = fluxo.length > 0 ? Math.round((feitas / fluxo.length) * 100) : 0;
  const reconstruindo =
    partesVisiveis.find((r) => visuais.get(r.id) === 'gerando') ??
    partesVisiveis.find((r) => visuais.get(r.id) === 'revisao') ??
    null;

  function renderParte(r: Regiao, inteira = false) {
    const visual = visuais.get(r.id) ?? 'fora';
    const estilo = inteira ? undefined : estiloDaParte(r);
    return (
      <BotaoParte
        key={r.id}
        regiao={r}
        visual={visual}
        modo={modo}
        emFoco={modo === 'aoVivo' && r.id === regiaoSelecionada}
        mostrarEtiqueta={(r.largura * larguraQuadro) >= LARGURA_MINIMA_ETIQUETA}
        inteira={inteira}
        estilo={estilo}
        aoClicar={() => clicarParte(r)}
      />
    );
  }

  return (
    <div className="grade-reconstrucao">
      {modo === 'aoVivo' ? (
        <div className="grade-resumo">
          <p className="grade-texto">{`${feitas} de ${fluxo.length} partes prontas`}</p>
          {fluxo.length > 0 && (
            <div
              className="grade-progresso"
              role="progressbar"
              aria-label="Partes prontas"
              aria-valuemin={0}
              aria-valuemax={fluxo.length}
              aria-valuenow={feitas}
            >
              <div className="grade-progresso-preenchido" style={{ width: `${percentual}%` }} />
            </div>
          )}
          <p className="grade-agora" role="status">
            {reconstruindo
              ? `Reconstruindo agora: ${reconstruindo.nome} (${ROTULO_CATEGORIA[reconstruindo.categoria]})`
              : 'Nenhuma parte em reconstrução agora.'}
          </p>
        </div>
      ) : (
        <div className="grade-resumo">
          <p className="grade-texto">{`${totalMarcadas} de ${marcaveis.length} partes marcadas`}</p>
          <div className="grade-acoes-marcacao">
            <Botao
              variante="secundario"
              aoClicar={() =>
                substituirSelecao(marcaveisSemInteira.filter((r) => r.problema !== 'NENHUM').map((r) => r.id))
              }
            >
              Marcar as com problema
            </Botao>
            <Botao variante="texto" aoClicar={() => substituirSelecao(marcaveisSemInteira.map((r) => r.id))}>
              Marcar todas
            </Botao>
            <Botao variante="texto" aoClicar={() => substituirSelecao([])}>
              Limpar
            </Botao>
          </div>
          {avisoConflito && (
            <p className="grade-aviso-conflito" role="status">
              Imagem inteira e partes se sobrepõem: escolha uma coisa ou outra.
            </p>
          )}
        </div>
      )}

      {imagensInteiras.length > 0 && (
        <div className="grade-topo">{imagensInteiras.map((r) => renderParte(r, true))}</div>
      )}

      <div
        className="grade-quadro"
        ref={quadroRef}
        style={{ aspectRatio: String(razao) }}
      >
        {[0, 1].map((i) => (
          <img
            key={i}
            className={camadas.topo === i ? 'grade-imagem grade-imagem-visivel' : 'grade-imagem'}
            src={urlArquivo(camadas.arquivos[i], 1600)}
            alt={camadas.topo === i ? 'Imagem atual do projeto' : ''}
            aria-hidden={camadas.topo !== i}
            draggable={false}
          />
        ))}
        <div className="grade-camada">
          {celulas.map((r) => renderParte(r))}
          {elementos.map((r) => renderParte(r))}
        </div>
      </div>

      {modo === 'aoVivo' && (
        <ul className="grade-legenda" aria-label="Legenda dos estados">
          {ESTADOS_LEGENDA.map((item) => {
            const quantidade = partesVisiveis.filter((r) => visuais.get(r.id) === item.estado).length;
            return (
              <li key={item.estado} className="grade-legenda-item">
                <span className={`grade-amostra grade-parte-${item.estado}`} aria-hidden="true" />
                <span>{`${item.rotulo}: ${quantidade}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
