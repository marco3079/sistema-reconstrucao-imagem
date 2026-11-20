import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { urlArquivo } from '../../lib/arquivos';
import { ROTULO_PROBLEMA } from '../../lib/tipos';
import type { Regiao } from '../../lib/tipos';

export interface PropsVisualizador {
  arquivo: string; // nome do arquivo da imagem
  largura: number; // pixels da imagem (para a proporção)
  altura: number;
  regioes?: Regiao[]; // retângulos desenhados por cima
  selecionada?: number | null;
  aoSelecionar?: (id: number | null) => void;
  desenhando?: boolean; // true: arrastar com o mouse ou o dedo desenha um retângulo novo
  aoDesenhar?: (ret: { x: number; y: number; largura: number; altura: number }) => void; // frações 0..1
  classeDaRegiao?: (r: Regiao) => string; // classes CSS extras para variar o estilo de cada região (opcional)
}

interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

// Menor lado (em fração da imagem) para aceitar um retângulo desenhado.
const MINIMO_DESENHO = 0.01;

function ehImagemInteira(r: Regiao): boolean {
  return r.x === 0 && r.y === 0 && r.largura === 1 && r.altura === 1;
}

function estiloDoRetangulo(r: Retangulo): CSSProperties {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.largura * 100}%`,
    height: `${r.altura * 100}%`,
  };
}

function classesDaRegiao(r: Regiao, selecionada: boolean): string {
  const partes = ['oficina-regiao', `oficina-regiao-${r.problema}`];
  if (r.status === 'RESOLVIDA') partes.push('oficina-regiao-resolvida');
  if (r.status === 'IGNORADA') partes.push('oficina-regiao-ignorada');
  if (selecionada) partes.push('oficina-regiao-selecionada');
  return partes.join(' ');
}

export function Visualizador({
  arquivo,
  largura,
  altura,
  regioes = [],
  selecionada = null,
  aoSelecionar,
  desenhando = false,
  aoDesenhar,
  classeDaRegiao,
}: PropsVisualizador) {
  const palcoRef = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [rascunho, setRascunho] = useState<Retangulo | null>(null);

  // Ponto do ponteiro em frações 0..1 relativas ao palco.
  function pontoDoPonteiro(e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const palco = palcoRef.current;
    if (!palco) return null;
    const caixa = palco.getBoundingClientRect();
    if (caixa.width === 0 || caixa.height === 0) return null;
    const x = Math.min(1, Math.max(0, (e.clientX - caixa.left) / caixa.width));
    const y = Math.min(1, Math.max(0, (e.clientY - caixa.top) / caixa.height));
    return { x, y };
  }

  // Retângulo normalizado entre o ponto inicial e o ponto atual.
  function retanguloEntre(a: { x: number; y: number }, b: { x: number; y: number }): Retangulo {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      largura: Math.abs(b.x - a.x),
      altura: Math.abs(b.y - a.y),
    };
  }

  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    if (!desenhando) return;
    const ponto = pontoDoPonteiro(e);
    if (!ponto) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = ponto;
    setRascunho({ x: ponto.x, y: ponto.y, largura: 0, altura: 0 });
  }

  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const origem = inicio.current;
    if (!origem) return;
    const ponto = pontoDoPonteiro(e);
    if (!ponto) return;
    setRascunho(retanguloEntre(origem, ponto));
  }

  function aoSoltar(e: ReactPointerEvent<HTMLDivElement>) {
    const origem = inicio.current;
    if (!origem) return;
    const ponto = pontoDoPonteiro(e);
    inicio.current = null;
    setRascunho(null);
    if (!ponto) return;
    const ret = retanguloEntre(origem, ponto);
    if (ret.largura >= MINIMO_DESENHO && ret.altura >= MINIMO_DESENHO) {
      aoDesenhar?.(ret);
    }
  }

  function aoCancelarPonteiro() {
    inicio.current = null;
    setRascunho(null);
  }

  function aoClicarFundo() {
    // No modo desenho o clique que fecha um arrasto não deve limpar a seleção.
    if (desenhando) return;
    aoSelecionar?.(null);
  }

  const proporcaoLarga = Math.max(1, largura);
  const proporcaoAlta = Math.max(1, altura);

  const estiloPalco: CSSProperties = {
    aspectRatio: `${proporcaoLarga} / ${proporcaoAlta}`,
    maxWidth: `calc(70vh * ${proporcaoLarga} / ${proporcaoAlta})`,
    touchAction: desenhando ? 'none' : undefined,
  };

  const classesPalco = desenhando ? 'oficina-palco oficina-palco-desenhando' : 'oficina-palco';
  const classesCamada = desenhando ? 'oficina-camada oficina-camada-desenhando' : 'oficina-camada';

  return (
    <div className="oficina-visualizador">
      <div
        ref={palcoRef}
        className={classesPalco}
        style={estiloPalco}
        onClick={aoClicarFundo}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoCancelarPonteiro}
      >
        <img src={urlArquivo(arquivo, 1600)} alt="" draggable={false} />
        <div className={classesCamada}>
          {regioes.map((r) => {
            const rotulo = ROTULO_PROBLEMA[r.problema];
            const nomeCompleto = `${r.nome}: ${rotulo}`;
            const extra = classeDaRegiao ? ' ' + classeDaRegiao(r) : '';

            if (ehImagemInteira(r)) {
              return (
                <div
                  key={r.id}
                  className={classesDaRegiao(r, false) + ' oficina-regiao-inteira' + extra}
                  aria-hidden="true"
                />
              );
            }

            const ativa = selecionada === r.id;
            return (
              <button
                key={r.id}
                type="button"
                className={classesDaRegiao(r, ativa) + extra}
                style={estiloDoRetangulo(r)}
                title={nomeCompleto}
                aria-label={nomeCompleto}
                onClick={(e) => {
                  e.stopPropagation();
                  aoSelecionar?.(r.id);
                }}
              >
                {ativa && <span className="oficina-regiao-etiqueta">{r.nome}</span>}
              </button>
            );
          })}
        </div>
        {rascunho && <div className="oficina-rascunho" style={estiloDoRetangulo(rascunho)} />}
      </div>
    </div>
  );
}
