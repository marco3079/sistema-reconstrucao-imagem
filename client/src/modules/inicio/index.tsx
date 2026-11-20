import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Aviso, Botao, Carregando, Cartao, Pagina, Selo } from '../../ui';
import type { NomeIcone } from '../../ui/icones';
import { Icone } from '../../ui/icones';
import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { useDados } from '../../lib/useDados';
import { urlArquivo } from '../../lib/arquivos';
import { ROTULO_STATUS_PROJETO } from '../../lib/tipos';
import type { Painel, ProjetoResumo, StatusProjeto } from '../../lib/tipos';
import { SeloDeSituacao } from '../projetos';
import './inicio.css';

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const COR_STATUS: Record<StatusProjeto, CorSelo> = {
  NOVO: 'cinza',
  ANALISADO: 'azul',
  EM_RECONSTRUCAO: 'amarelo',
  CONCLUIDO: 'verde',
};

const MAXIMO_NA_ESPERA = 5;

function CartaoProjeto({ projeto }: { projeto: ProjetoResumo }) {
  return (
    <Link to={`${RAIZ}/projetos/${projeto.id}`} className="inicio-projeto">
      <img
        className="inicio-projeto-miniatura"
        src={urlArquivo(projeto.atualArquivo, 480)}
        alt={projeto.nome}
        loading="lazy"
      />
      <span className="inicio-projeto-nome">{projeto.nome}</span>
      <Selo cor={COR_STATUS[projeto.status]}>{ROTULO_STATUS_PROJETO[projeto.status]}</Selo>
      {projeto.situacao && <SeloDeSituacao situacao={projeto.situacao} />}
      <span className="inicio-projeto-progresso">
        {projeto.regioesResolvidas} de {projeto.regioesTotal} partes resolvidas
      </span>
    </Link>
  );
}

// Bloco no topo: imagens que esperam uma aprovação sua.
function EsperandoVoce({ painel, recentes }: { painel: Painel; recentes: ProjetoResumo[] }) {
  const pedem = recentes.filter((p) => p.situacao?.quem === 'VOCE' && p.situacao.aprovacao);

  // Se o servidor ainda não manda esperandoVoce, vale a quantidade listada.
  // Pode haver pendência fora das imagens recentes: por isso o total vem do painel.
  const total = Math.max(painel.esperandoVoce ?? 0, pedem.length);

  if (total === 0) {
    return <p className="inicio-espera-discreto">Nada esperando a sua aprovação.</p>;
  }

  const listados = pedem.slice(0, MAXIMO_NA_ESPERA);
  const titulo =
    total === 1
      ? 'Sua vez: 1 aprovação esperando'
      : `Sua vez: ${total} aprovações esperando`;

  return (
    <section className="inicio-espera" aria-labelledby="inicio-espera-titulo">
      <h2 className="inicio-espera-titulo" id="inicio-espera-titulo">
        {titulo}
      </h2>
      {listados.length > 0 && (
      <ul className="inicio-espera-lista">
        {listados.map((p) => {
          const situacao = p.situacao;
          return (
            <li key={p.id} className="inicio-espera-item">
              <div className="inicio-espera-info">
                <span className="inicio-espera-nome" title={p.nome}>
                  {p.nome}
                </span>
                <span className="inicio-espera-passo">
                  Passo {situacao.passo} de {situacao.total}: {situacao.titulo}
                </span>
              </div>
              {situacao.acao && (
                <Link
                  to={`${RAIZ}/projetos/${p.id}?etapa=${situacao.acao.tela}`}
                  className="botao botao-primario"
                >
                  {situacao.acao.rotulo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      )}
      {total > listados.length && (
        <Link to={`${RAIZ}/projetos`} className="inicio-link">
          Ver todas
        </Link>
      )}
    </section>
  );
}

function Inicio() {
  const navegar = useNavigate();
  const { dados, carregando, erro, recarregar } = useDados<Painel>('/painel');

  // Atualiza o painel sozinho a cada 15 s.
  useEffect(() => {
    const id = window.setInterval(recarregar, 15000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  const novaImagem = () => navegar(`${RAIZ}/projetos?novo=1`);

  const acoes = <Botao aoClicar={novaImagem}>Nova imagem</Botao>;

  if (!dados) {
    return (
      <Pagina titulo="Início" acoes={acoes}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && !erro && <Carregando />}
      </Pagina>
    );
  }

  const indicadores: { icone: NomeIcone; valor: number; rotulo: string }[] = [
    { icone: 'imagem', valor: dados.projetos, rotulo: 'Imagens' },
    { icone: 'visto', valor: dados.concluidos, rotulo: 'Concluídas' },
    { icone: 'lista', valor: dados.regioesPendentes, rotulo: 'Partes pendentes' },
    { icone: 'paleta', valor: dados.opcoesGeradas, rotulo: 'Opções geradas' },
  ];

  return (
    <Pagina titulo="Início" acoes={acoes}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <EsperandoVoce painel={dados} recentes={dados.recentes} />

      <div className="inicio-indicadores">
        {indicadores.map((i) => (
          <div className="inicio-indicador" key={i.rotulo}>
            <span className="inicio-indicador-icone">
              <Icone nome={i.icone} tamanho={20} />
            </span>
            <span className="inicio-indicador-valor">{i.valor}</span>
            <span className="inicio-indicador-rotulo">{i.rotulo}</span>
          </div>
        ))}
      </div>

      <div className="inicio-colunas">
        <Cartao titulo="Imagens recentes">
          {dados.recentes.length === 0 ? (
            <div className="inicio-vazio">
              <p>Você ainda não enviou nenhuma imagem.</p>
              <Botao aoClicar={novaImagem}>Enviar a primeira imagem</Botao>
            </div>
          ) : (
            <div className="inicio-projetos">
              {dados.recentes.map((p) => (
                <CartaoProjeto key={p.id} projeto={p} />
              ))}
            </div>
          )}
        </Cartao>

        <div className="inicio-lateral">
          <Cartao titulo="Equipe de agentes">
            <p>
              {dados.agentes.conectado ? (
                <Selo cor="verde">Conectada</Selo>
              ) : (
                <Selo cor="amarelo">Aguardando sessão do Claude Code</Selo>
              )}
            </p>
            <ul className="inicio-lista">
              <li>Na fila: {dados.agentes.naFila}</li>
              <li>Em andamento: {dados.agentes.emAndamento}</li>
            </ul>
            <Link to={`${RAIZ}/agentes`} className="inicio-link">
              Ver a equipe
            </Link>
          </Cartao>

          <Cartao titulo="Canva">
            <p>
              {dados.canva.conectado ? (
                <Selo cor="verde">Conectado</Selo>
              ) : (
                <Selo cor="cinza">Não conectado</Selo>
              )}
            </p>
            <Link to={`${RAIZ}/configuracoes`} className="inicio-link">
              Abrir configurações
            </Link>
          </Cartao>
        </div>
      </div>
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: RAIZ,
    rotulo: 'Início',
    icone: 'inicio',
    perfis: TODOS_OS_PERFIS,
    elemento: <Inicio />,
    ordem: 1,
  },
];
