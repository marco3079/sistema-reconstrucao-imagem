import { useEffect, useRef } from 'react';
import { Botao } from '../../ui';
import { Icone } from '../../ui/icones';
import type { CodigoPasso, Situacao, TelaDaOficina } from '../../lib/tipos';
import './reiniciar.css';

type TipoMomento = 'aprovacao' | 'voce' | 'equipe' | 'parada' | 'concluido';

// Decide qual faixa do momento mostrar, a partir de quem tem a vez agora.
function tipoDoMomento(situacao: Situacao): TipoMomento {
  if (situacao.quem === 'CONCLUIDO') return 'concluido';
  if (situacao.quem === 'VOCE') return situacao.aprovacao ? 'aprovacao' : 'voce';
  return situacao.parada ? 'parada' : 'equipe';
}

const ETIQUETA_DO_MOMENTO: Record<TipoMomento, string> = {
  aprovacao: 'SUA VEZ: APROVAÇÃO',
  voce: 'Sua vez',
  equipe: 'Vez da equipe',
  parada: 'Parado: equipe desligada',
  concluido: 'Concluído',
};

export function BarraSituacao({
  situacao,
  aoIr,
  aoVerPasso,
  aoReiniciar,
}: {
  situacao: Situacao;
  aoIr: (tela: TelaDaOficina) => void;
  // Clique num passo feito ou atual: abre o detalhe do passo. Sem a prop, a trilha não tem botões.
  aoVerPasso?: (codigo: CodigoPasso) => void;
  // Sem a prop, o botão "Reiniciar..." não aparece.
  aoReiniciar?: (passo?: CodigoPasso) => void;
}) {
  const trilhaRef = useRef<HTMLOListElement>(null);
  const passoAtualRef = useRef<HTMLLIElement>(null);

  // Em telas estreitas a trilha rola na horizontal, só ela (não a página): mantém o passo atual à vista.
  useEffect(() => {
    const trilha = trilhaRef.current;
    const item = passoAtualRef.current;
    if (!trilha || !item) return;
    if (trilha.scrollWidth <= trilha.clientWidth) return;
    trilha.scrollTo({
      left: item.offsetLeft - trilha.clientWidth / 2 + item.offsetWidth / 2,
    });
  }, [situacao.passo]);

  const momento = tipoDoMomento(situacao);
  const acao = situacao.acao;

  // Só o botão primário na faixa de aprovação e na de parada; o da equipe fica secundário.
  const varianteDaAcao = momento === 'equipe' ? 'secundario' : 'primario';

  return (
    <div className="oficina-situacao">
      <ol className="oficina-trilha" aria-label="Passos da restauração" ref={trilhaRef}>
        {situacao.passos.map((passo, indice) => {
          const atual = passo.estado === 'atual';
          const feito = passo.estado === 'feito';
          const classeCirculo = passo.quem === 'VOCE'
            ? 'oficina-trilha-circulo oficina-trilha-circulo-voce'
            : 'oficina-trilha-circulo';
          return (
            <li
              key={passo.codigo}
              ref={atual ? passoAtualRef : undefined}
              className={`oficina-trilha-item oficina-trilha-${passo.estado}`}
              aria-current={atual ? 'step' : undefined}
            >
              {aoVerPasso && (feito || atual) ? (
                <button
                  type="button"
                  className="oficina-trilha-botao"
                  title={`Ver o passo ${passo.titulo}`}
                  aria-label={`Ver o passo ${passo.titulo}`}
                  onClick={() => aoVerPasso(passo.codigo)}
                >
                  <span className={classeCirculo} aria-hidden="true">
                    {feito ? <Icone nome="visto" tamanho={16} /> : indice + 1}
                  </span>
                  <span className="oficina-trilha-titulo">{passo.titulo}</span>
                  <span className="oficina-trilha-quem">{passo.quem === 'VOCE' ? 'você' : 'equipe'}</span>
                </button>
              ) : (
                <>
                  <span className={classeCirculo} aria-hidden="true">
                    {feito ? <Icone nome="visto" tamanho={16} /> : indice + 1}
                  </span>
                  <span className="oficina-trilha-titulo">{passo.titulo}</span>
                  <span className="oficina-trilha-quem">{passo.quem === 'VOCE' ? 'você' : 'equipe'}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div
        className={`oficina-momento oficina-momento-${momento}`}
        role="status"
        aria-label={momento === 'aprovacao' ? 'Sua vez: aprovação necessária' : undefined}
      >
        <div className="oficina-momento-texto">
          <span className="oficina-momento-etiqueta">
            {momento === 'equipe' && <span className="oficina-momento-ponto" aria-hidden="true" />}
            {momento === 'aprovacao' && (
              <span className="oficina-momento-icone">
                <Icone nome="sino" tamanho={20} />
              </span>
            )}
            {momento === 'concluido' && (
              <span className="oficina-momento-icone">
                <Icone nome="visto" tamanho={20} />
              </span>
            )}
            {ETIQUETA_DO_MOMENTO[momento]}
          </span>
          <strong className="oficina-momento-titulo">
            {`Passo ${situacao.passo} de ${situacao.total}: ${situacao.titulo}`}
          </strong>
          <p className="oficina-momento-descricao">{situacao.descricao}</p>
        </div>
        {(acao || aoReiniciar) && (
          <div className="oficina-momento-acao oficina-momento-botoes">
            {acao && (
              <Botao variante={varianteDaAcao} aoClicar={() => aoIr(acao.tela)}>
                {acao.rotulo}
              </Botao>
            )}
            {aoReiniciar && (
              <Botao variante="texto" aoClicar={() => aoReiniciar()}>
                Reiniciar...
              </Botao>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
