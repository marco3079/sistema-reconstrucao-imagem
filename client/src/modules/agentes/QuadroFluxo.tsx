import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Icone } from '../../ui/icones';
import { ALTURA_NO, LARGURA_NO, ROTULO_ESTADO } from './fluxoTipos';
import type { LigacaoFluxo, NoFluxo, PropsQuadroFluxo } from './fluxoTipos';
import './quadro.css';

interface Vista {
  x: number;
  y: number;
  escala: number;
}

interface Posicao {
  x: number;
  y: number;
}

interface Ponto {
  x: number;
  y: number;
}

type Arrasto =
  | {
      tipo: 'quadro';
      inicioX: number;
      inicioY: number;
      vistaX: number;
      vistaY: number;
      movido: boolean;
    }
  | {
      tipo: 'no';
      id: string;
      inicioX: number;
      inicioY: number;
      posX: number;
      posY: number;
      escala: number;
      movido: boolean;
    };

const ESCALA_MIN = 0.3;
const ESCALA_MAX = 1.6;
const ESCALA_AJUSTE_MAX = 1;
const FOLGA_ARCO = 130;
const LIMIAR_ARRASTO = 4;
const PASSO_PONTOS = 22;
const ALTURA_ARCO = 120;

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

// Enquadra todos os nós no quadro (escala limitada a [0.3, 1], centralizado).
function calcularAjuste(largura: number, altura: number, nos: NoFluxo[]): Vista {
  if (nos.length === 0) {
    return { x: largura / 2, y: altura / 2, escala: 1 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const no of nos) {
    minX = Math.min(minX, no.x);
    maxX = Math.max(maxX, no.x + LARGURA_NO);
    minY = Math.min(minY, no.y);
    maxY = Math.max(maxY, no.y + ALTURA_NO);
  }
  const topo = minY - FOLGA_ARCO;
  const base = maxY + FOLGA_ARCO;
  const caixaLargura = maxX - minX;
  const caixaAltura = base - topo;
  const escala = limitar(
    Math.min(ESCALA_AJUSTE_MAX, (largura - 80) / caixaLargura, (altura - 80) / caixaAltura),
    ESCALA_MIN,
    ESCALA_AJUSTE_MAX,
  );
  const centroX = (minX + maxX) / 2;
  const centroY = (topo + base) / 2;
  return {
    x: largura / 2 - centroX * escala,
    y: altura / 2 - centroY * escala,
    escala,
  };
}

// Zoom em torno de um ponto (coordenadas do quadro, em px).
function zoomarEm(vista: Vista, px: number, py: number, fator: number): Vista {
  const novaEscala = limitar(vista.escala * fator, ESCALA_MIN, ESCALA_MAX);
  const razao = novaEscala / vista.escala;
  return {
    escala: novaEscala,
    x: px - (px - vista.x) * razao,
    y: py - (py - vista.y) * razao,
  };
}

function montarCurva(
  x1: number,
  y1: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x2: number,
  y2: number,
): { d: string; meio: Ponto } {
  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    // Ponto da cúbica em t = 0.5
    meio: {
      x: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
      y: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
    },
  };
}

function caminhoLigacao(de: Posicao, para: Posicao, retorno: boolean): { d: string; meio: Ponto } {
  if (!retorno) {
    const x1 = de.x + LARGURA_NO;
    const y1 = de.y + ALTURA_NO / 2;
    const x2 = para.x;
    const y2 = para.y + ALTURA_NO / 2;
    const folga = Math.max(60, Math.abs(x2 - x1) / 2);
    return montarCurva(x1, y1, x1 + folga, y1, x2 - folga, y2, x2, y2);
  }
  const centroDe = de.y + ALTURA_NO / 2;
  const centroPara = para.y + ALTURA_NO / 2;
  const paraAcima = centroPara < centroDe;
  const x1 = de.x + LARGURA_NO / 2;
  const x2 = para.x + LARGURA_NO / 2;
  const y1 = paraAcima ? de.y : de.y + ALTURA_NO;
  const y2 = paraAcima ? para.y : para.y + ALTURA_NO;
  const controle = paraAcima
    ? Math.min(y1, y2) - ALTURA_ARCO
    : Math.max(y1, y2) + ALTURA_ARCO;
  return montarCurva(x1, y1, x1, controle, x2, controle, x2, y2);
}

export function QuadroFluxo(props: PropsQuadroFluxo): JSX.Element {
  const { nos, ligacoes, selecionado, aoSelecionar } = props;

  const quadroRef = useRef<HTMLDivElement>(null);
  const mexeu = useRef(false);
  const arrasto = useRef<Arrasto | null>(null);
  const ajustarRef = useRef<() => void>(() => undefined);
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, escala: 1 });
  const [deslocados, setDeslocados] = useState<Record<string, Posicao>>({});
  const [arrastando, setArrastando] = useState(false);

  const idBase = useId().replace(/[^a-zA-Z0-9]/g, '');
  const idSetaCinza = `${idBase}-seta-cinza`;
  const idSetaPrimaria = `${idBase}-seta-primaria`;

  // Posição efetiva de cada nó (arrastado pelo usuário ou a da prop).
  const posicoes = new Map<string, Posicao>();
  for (const no of nos) {
    posicoes.set(no.id, deslocados[no.id] ?? { x: no.x, y: no.y });
  }

  // Ajuste da tela: sempre com a versão mais recente dos nós.
  useEffect(() => {
    ajustarRef.current = () => {
      const el = quadroRef.current;
      if (!el || mexeu.current) return;
      setVista(calcularAjuste(el.clientWidth, el.clientHeight, nos));
    };
  }, [nos]);

  // Ajusta ao montar e quando o tamanho do quadro muda (enquanto o usuário não mexeu).
  useEffect(() => {
    ajustarRef.current();
    const el = quadroRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => ajustarRef.current());
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // Zoom com a roda do mouse (listener não passivo para poder usar preventDefault).
  useEffect(() => {
    const el = quadroRef.current;
    if (!el) return;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const fator = Math.exp(-e.deltaY * 0.0015);
      mexeu.current = true;
      setVista((v) => zoomarEm(v, px, py, fator));
    };
    el.addEventListener('wheel', aoRolar, { passive: false });
    return () => el.removeEventListener('wheel', aoRolar);
  }, []);

  const zoomarBotao = useCallback((fator: number) => {
    const el = quadroRef.current;
    if (!el) return;
    mexeu.current = true;
    setVista((v) => zoomarEm(v, el.clientWidth / 2, el.clientHeight / 2, fator));
  }, []);

  const aoAjustar = () => {
    mexeu.current = false;
    setDeslocados({});
    const el = quadroRef.current;
    if (!el) return;
    setVista(calcularAjuste(el.clientWidth, el.clientHeight, nos));
  };

  const aoApertarQuadro = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('.quadro-no, .quadro-controles')) {
      return;
    }
    arrasto.current = {
      tipo: 'quadro',
      inicioX: e.clientX,
      inicioY: e.clientY,
      vistaX: vista.x,
      vistaY: vista.y,
      movido: false,
    };
    quadroRef.current?.setPointerCapture(e.pointerId);
  };

  const aoApertarNo = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    const pos = posicoes.get(id);
    if (!pos) return;
    arrasto.current = {
      tipo: 'no',
      id,
      inicioX: e.clientX,
      inicioY: e.clientY,
      posX: pos.x,
      posY: pos.y,
      escala: vista.escala,
      movido: false,
    };
    quadroRef.current?.setPointerCapture(e.pointerId);
  };

  const aoMover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.inicioX;
    const dy = e.clientY - a.inicioY;
    if (!a.movido) {
      if (Math.hypot(dx, dy) < LIMIAR_ARRASTO) return;
      a.movido = true;
      mexeu.current = true;
      if (a.tipo === 'quadro') setArrastando(true);
    }
    if (a.tipo === 'quadro') {
      const vx = a.vistaX + dx;
      const vy = a.vistaY + dy;
      setVista((v) => ({ ...v, x: vx, y: vy }));
    } else {
      const nx = a.posX + dx / a.escala;
      const ny = a.posY + dy / a.escala;
      const id = a.id;
      setDeslocados((d) => ({ ...d, [id]: { x: nx, y: ny } }));
    }
  };

  const finalizar = (e: ReactPointerEvent<HTMLDivElement>, cancelado: boolean) => {
    const a = arrasto.current;
    arrasto.current = null;
    setArrastando(false);
    const el = quadroRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    if (!a || cancelado || a.movido) return;
    if (a.tipo === 'quadro') {
      aoSelecionar(null);
    } else {
      aoSelecionar(a.id);
    }
  };

  const aoTeclarNo = (e: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      aoSelecionar(id);
    }
  };

  const ligacoesDesenho = ligacoes.flatMap((lig: LigacaoFluxo) => {
    const de = posicoes.get(lig.de);
    const para = posicoes.get(lig.para);
    if (!de || !para) return [];
    const { d, meio } = caminhoLigacao(de, para, lig.retorno === true);
    return [{ lig, d, meio }];
  });

  const estiloLigacaoSeta = (ativa: boolean) =>
    ativa ? `url(#${idSetaPrimaria})` : `url(#${idSetaCinza})`;

  return (
    <div
      className={arrastando ? 'quadro quadro-arrastando' : 'quadro'}
      ref={quadroRef}
      onPointerDown={aoApertarQuadro}
      onPointerMove={aoMover}
      onPointerUp={(e) => finalizar(e, false)}
      onPointerCancel={(e) => finalizar(e, true)}
      style={{
        backgroundSize: `${PASSO_PONTOS * vista.escala}px ${PASSO_PONTOS * vista.escala}px`,
        backgroundPosition: `${vista.x}px ${vista.y}px`,
      }}
    >
      <div
        className="quadro-mundo"
        style={{
          transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="quadro-ligacoes" aria-hidden="true">
          <defs>
            <marker
              id={idSetaCinza}
              className="quadro-seta-cinza"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker
              id={idSetaPrimaria}
              className="quadro-seta-primaria"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {ligacoesDesenho.map(({ lig, d }) => {
            const classe = [
              'quadro-ligacao',
              lig.retorno ? 'quadro-ligacao-retorno' : '',
              lig.ativa ? 'quadro-ligacao-ativa' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g key={lig.id}>
                <path d={d} className={classe} markerEnd={estiloLigacaoSeta(lig.ativa)} />
                {lig.ativa ? (
                  <circle r={4} className="quadro-bolinha-fluxo">
                    <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
                  </circle>
                ) : null}
              </g>
            );
          })}
        </svg>

        {ligacoesDesenho.map(({ lig, meio }) =>
          lig.rotulo ? (
            <div
              key={`rotulo-${lig.id}`}
              className={lig.ativa ? 'quadro-rotulo quadro-rotulo-ativo' : 'quadro-rotulo'}
              style={{ left: meio.x, top: meio.y }}
            >
              {lig.rotulo}
            </div>
          ) : null,
        )}

        {nos.map((no: NoFluxo) => {
          const pos = posicoes.get(no.id) ?? { x: no.x, y: no.y };
          const sel = selecionado === no.id;
          const classe = [
            'quadro-no',
            `quadro-no-${no.estado}`,
            `quadro-cor-${no.cor}`,
            sel ? 'quadro-no-selecionado' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={no.id}
              className={classe}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              aria-label={`${no.titulo}: ${ROTULO_ESTADO[no.estado]}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => aoApertarNo(e, no.id)}
              onKeyDown={(e) => aoTeclarNo(e, no.id)}
            >
              <span className="quadro-porta quadro-porta-entrada" aria-hidden="true" />
              <span className="quadro-porta quadro-porta-saida" aria-hidden="true" />
              {no.contador && no.contador > 0 ? (
                <span className="quadro-contador">{no.contador}</span>
              ) : null}
              <div className="quadro-no-topo">
                <span className="quadro-no-icone">
                  <Icone nome={no.icone} tamanho={22} />
                </span>
                <div className="quadro-no-titulos">
                  <span className="quadro-no-titulo">{no.titulo}</span>
                  <span className="quadro-no-subtitulo">{no.subtitulo}</span>
                </div>
              </div>
              <span className="quadro-no-estado">
                <span className="quadro-bolinha-estado" aria-hidden="true" />
                {ROTULO_ESTADO[no.estado]}
              </span>
              {no.texto !== '' ? <p className="quadro-no-texto">{no.texto}</p> : null}
            </div>
          );
        })}
      </div>

      <div
        className="quadro-controles"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Aproximar" onClick={() => zoomarBotao(1.2)}>
          +
        </button>
        <button type="button" aria-label="Afastar" onClick={() => zoomarBotao(1 / 1.2)}>
          −
        </button>
        <button type="button" aria-label="Ajustar à tela" onClick={aoAjustar}>
          Ajustar
        </button>
      </div>
    </div>
  );
}
