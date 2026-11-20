import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Aviso, Botao, Campo, Carregando, Pagina, Selo, Selecao, formatarData } from '../../ui';
import { Icone } from '../../ui/icones';
import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { useDados } from '../../lib/useDados';
import { urlArquivo } from '../../lib/arquivos';
import { ROTULO_STATUS_PROJETO } from '../../lib/tipos';
import type { ProjetoResumo, Situacao, StatusProjeto } from '../../lib/tipos';
import { NovoProjeto } from './NovoProjeto';
import './projetos.css';

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const COR_STATUS: Record<StatusProjeto, CorSelo> = {
  NOVO: 'cinza',
  ANALISADO: 'azul',
  EM_RECONSTRUCAO: 'amarelo',
  CONCLUIDO: 'verde',
};

const OPCOES_STATUS: { valor: string; rotulo: string }[] = (
  Object.keys(ROTULO_STATUS_PROJETO) as StatusProjeto[]
).map((s) => ({ valor: s, rotulo: ROTULO_STATUS_PROJETO[s] }));

// Etiqueta de quem é a vez: texto e classe de cor.
function etiquetaDaVez(situacao: Situacao): { rotulo: string; classe: string } {
  if (situacao.quem === 'CONCLUIDO') return { rotulo: 'Concluído', classe: 'projetos-vez-concluido' };
  if (situacao.quem === 'VOCE') {
    return situacao.aprovacao
      ? { rotulo: 'Sua vez: aprovar', classe: 'projetos-vez-aprovacao' }
      : { rotulo: 'Sua vez', classe: 'projetos-vez-voce' };
  }
  return situacao.parada
    ? { rotulo: 'Parado: equipe desligada', classe: 'projetos-vez-parada' }
    : { rotulo: 'Vez da equipe', classe: 'projetos-vez-equipe' };
}

// Mostra, fora da imagem, em que passo ela está e de quem é a vez.
export function SeloDeSituacao({ situacao }: { situacao: Situacao }) {
  const vez = etiquetaDaVez(situacao);
  const percentual = situacao.total > 0 ? (situacao.passo / situacao.total) * 100 : 0;
  return (
    <div className="projetos-situacao">
      <span className={`projetos-vez ${vez.classe}`}>{vez.rotulo}</span>
      <span className="projetos-passo">
        Passo {situacao.passo} de {situacao.total}: {situacao.titulo}
      </span>
      <div
        className="projetos-passo-barra"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={situacao.total}
        aria-valuenow={situacao.passo}
        aria-label={`Passo ${situacao.passo} de ${situacao.total}`}
      >
        <span style={{ width: `${percentual}%` }} />
      </div>
    </div>
  );
}

// Ordem da lista: primeiro as que pedem sua aprovação, depois as que esperam você, depois o resto.
function prioridade(p: ProjetoResumo): number {
  if (p.situacao?.aprovacao) return 0;
  if (p.situacao?.quem === 'VOCE') return 1;
  return 2;
}

function Projetos() {
  const [params, setParams] = useSearchParams();
  const [modalAberto, setModalAberto] = useState<boolean>(params.get('novo') === '1');
  const { dados, carregando, erro } = useDados<ProjetoResumo[]>('/projetos');
  const [filtroNome, setFiltroNome] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [soEsperandoVoce, setSoEsperandoVoce] = useState(false);

  const esperandoVoce = useMemo(
    () => (dados ?? []).filter((p) => p.situacao?.quem === 'VOCE').length,
    [dados],
  );

  const filtrados = useMemo(() => {
    const termo = filtroNome.trim().toLowerCase();
    const base = (dados ?? []).filter(
      (p) =>
        (filtroStatus === '' || p.status === filtroStatus) &&
        p.nome.toLowerCase().includes(termo) &&
        (!soEsperandoVoce || p.situacao?.quem === 'VOCE'),
    );
    // sort é estável: dentro de cada grupo, a ordem atual se mantém.
    return [...base].sort((a, b) => prioridade(a) - prioridade(b));
  }, [dados, filtroNome, filtroStatus, soEsperandoVoce]);

  function abrirModal() {
    setModalAberto(true);
  }

  // Ao fechar, tira ?novo=1 da URL para que um recarregamento não reabra o modal.
  function fecharModal() {
    setModalAberto(false);
    if (params.has('novo')) setParams({}, { replace: true });
  }

  const acoes = <Botao aoClicar={abrirModal}>Nova imagem</Botao>;

  return (
    <Pagina titulo="Imagens" acoes={acoes}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}

      {dados && dados.length === 0 && (
        <div className="projetos-vazio">
          <Icone nome="imagem" tamanho={64} />
          <p>
            <strong>Nenhuma imagem ainda</strong>
          </p>
          <Botao aoClicar={abrirModal}>Enviar imagem</Botao>
        </div>
      )}

      {dados && dados.length > 0 && (
        <>
          <div className="projetos-filtros-fila" role="group" aria-label="Mostrar imagens">
            <button
              type="button"
              className="projetos-filtro"
              aria-pressed={!soEsperandoVoce}
              onClick={() => setSoEsperandoVoce(false)}
            >
              Todas
            </button>
            <button
              type="button"
              className="projetos-filtro"
              aria-pressed={soEsperandoVoce}
              onClick={() => setSoEsperandoVoce(true)}
            >
              Esperando você ({esperandoVoce})
            </button>
          </div>

          <div className="barra-ferramentas">
            <div className="filtros">
              <Campo rotulo="Buscar por nome" valor={filtroNome} aoMudar={setFiltroNome} />
              <Selecao
                rotulo="Status"
                valor={filtroStatus}
                aoMudar={setFiltroStatus}
                vazio="Todos"
                opcoes={OPCOES_STATUS}
              />
            </div>
          </div>

          {filtrados.length === 0 ? (
            <p className="projetos-semresultado">Nenhuma imagem com esse filtro.</p>
          ) : (
            <div className="projetos-grade">
              {filtrados.map((p) => {
                const percentual = p.regioesTotal > 0 ? (p.regioesResolvidas / p.regioesTotal) * 100 : 0;
                const situacao = p.situacao;
                const pedeAprovacao = situacao?.aprovacao === true;
                const acao = situacao?.quem === 'VOCE' ? situacao.acao : null;
                return (
                  <article
                    key={p.id}
                    className={`projetos-cartao${pedeAprovacao ? ' projetos-cartao-aprovacao' : ''}`}
                  >
                    <Link to={`${RAIZ}/projetos/${p.id}`} className="projetos-cartao-abrir">
                      <div className="projetos-miniatura">
                        <img
                          src={urlArquivo(p.atualArquivo, 480)}
                          alt={p.nome}
                          loading="lazy"
                        />
                      </div>
                      <span className="projetos-nome" title={p.nome}>
                        {p.nome}
                      </span>
                      <div className="projetos-selos">
                        <Selo cor={COR_STATUS[p.status]}>{ROTULO_STATUS_PROJETO[p.status]}</Selo>
                        {p.trabalhosAtivos > 0 && <Selo cor="azul">Agentes trabalhando</Selo>}
                      </div>
                      {situacao && <SeloDeSituacao situacao={situacao} />}
                      <div className="projetos-barra" aria-hidden="true">
                        <span style={{ width: `${percentual}%` }} />
                      </div>
                      <span className="projetos-progresso">
                        {p.regioesResolvidas} de {p.regioesTotal} partes
                      </span>
                      <span className="projetos-data">Atualizado em {formatarData(p.atualizadoEm)}</span>
                    </Link>
                    {acao && (
                      <Link
                        to={`${RAIZ}/projetos/${p.id}?etapa=${acao.tela}`}
                        className="botao botao-primario projetos-acao"
                      >
                        {acao.rotulo}
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      <NovoProjeto aberto={modalAberto} aoFechar={fecharModal} />
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/projetos`,
    rotulo: 'Imagens',
    icone: 'imagem',
    perfis: TODOS_OS_PERFIS,
    elemento: <Projetos />,
    ordem: 10,
  },
];
