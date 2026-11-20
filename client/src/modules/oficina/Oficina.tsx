import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { ROTULO_STATUS_PROJETO, TIPOS_PROJETO } from '../../lib/tipos';
import type { CodigoPasso, ProjetoDetalhe, StatusProjeto } from '../../lib/tipos';
import { Aviso, Botao, Campo, Carregando, Modal, Selecao, Selo } from '../../ui';
import type { Etapa, PropsEtapa } from './tipos';
import { EtapaAnalise } from './EtapaAnalise';
import { EtapaReferencias } from './EtapaReferencias';
import { EtapaReconstrucao } from './EtapaReconstrucao';
import { EtapaResultado } from './EtapaResultado';
import { PainelAgentes } from './PainelAgentes';
import { BarraSituacao } from './BarraSituacao';
import { Reiniciar } from './Reiniciar';
import type { PassoReinicio } from './Reiniciar';
import { DetalheDoPasso } from './DetalheDoPasso';
import { PainelFluxo } from '../agentes/PainelFluxo';

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: 'analise', rotulo: 'Análise' },
  { id: 'referencias', rotulo: 'Referências' },
  { id: 'reconstrucao', rotulo: 'Reconstrução' },
  { id: 'resultado', rotulo: 'Resultado' },
  { id: 'equipe', rotulo: 'Equipe ao vivo' },
];

const COR_STATUS: Record<StatusProjeto, CorSelo> = {
  NOVO: 'cinza',
  ANALISADO: 'azul',
  EM_RECONSTRUCAO: 'amarelo',
  CONCLUIDO: 'verde',
};

// Passo da trilha -> passo de onde o reinício começa.
const PASSO_DO_REINICIO: Record<CodigoPasso, PassoReinicio> = {
  EXAME: 'EXAME',
  MAPA: 'MAPA',
  APROVAR_MAPA: 'MAPA',
  PLANO: 'PLANO',
  TRATAMENTO: 'TRATAMENTO',
  ESCOLHA: 'TRATAMENTO',
  INSPECAO: 'INSPECAO',
  LAUDO: 'INSPECAO',
};

// Intervalos da atualização automática: mais rápido enquanto há trabalho na fila ou em andamento.
const INTERVALO_COM_TRABALHO_MS = 4000;
const INTERVALO_SEM_TRABALHO_MS = 20000;

interface FormProjeto {
  nome: string;
  descricao: string;
  tipo: string;
}

function ehEtapa(valor: string | null): valor is Etapa {
  return ETAPAS.some((e) => e.id === valor);
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Contador de cada passo, mostrado sob o rótulo.
function contadorDoPasso(id: Etapa, projeto: ProjetoDetalhe): string | null {
  if (id === 'analise') {
    const n = projeto.regioes.length;
    return `${n} ${n === 1 ? 'parte' : 'partes'}`;
  }
  if (id === 'referencias') {
    const n = projeto.referencias.length;
    return `${n} ${n === 1 ? 'referência' : 'referências'}`;
  }
  if (id === 'reconstrucao') {
    const ativas = projeto.regioes.filter((r) => r.status !== 'IGNORADA');
    const resolvidas = ativas.filter((r) => r.status === 'RESOLVIDA').length;
    return `${resolvidas}/${ativas.length}`;
  }
  return null;
}

export function Oficina() {
  const { id } = useParams();
  const projetoId = Number(id);
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();

  const etapaDaUrl = params.get('etapa');
  const etapa: Etapa = ehEtapa(etapaDaUrl) ? etapaDaUrl : 'analise';

  const [projeto, setProjeto] = useState<ProjetoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [regiaoSelecionada, setRegiaoSelecionada] = useState<number | null>(null);

  const [formProjeto, setFormProjeto] = useState<FormProjeto | null>(null);
  const [salvandoProjeto, setSalvandoProjeto] = useState(false);
  const [excluirAberto, setExcluirAberto] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [reinicioAberto, setReinicioAberto] = useState(false);
  const [reinicioPasso, setReinicioPasso] = useState<PassoReinicio | undefined>(undefined);
  const [passoEmDetalhe, setPassoEmDetalhe] = useState<CodigoPasso | null>(null);

  function abrirReinicio(codigo?: CodigoPasso) {
    setReinicioPasso(codigo ? PASSO_DO_REINICIO[codigo] : undefined);
    setReinicioAberto(true);
  }

  const carregar = useCallback(() => {
    api
      .get<ProjetoDetalhe>('/projetos/' + projetoId)
      .then((p) => {
        setProjeto(p);
        setErro(null);
      })
      .catch((e: unknown) => setErro(mensagem(e)));
  }, [projetoId]);

  // Ao abrir (ou trocar) o projeto, começa do zero.
  useEffect(() => {
    setProjeto(null);
    setErro(null);
    setRegiaoSelecionada(null);
    carregar();
  }, [carregar]);

  // Atualização automática: 4 s com trabalho ativo, 20 s sem.
  const comTrabalho = (projeto?.trabalhos.length ?? 0) > 0;
  useEffect(() => {
    const intervalo = window.setInterval(
      carregar,
      comTrabalho ? INTERVALO_COM_TRABALHO_MS : INTERVALO_SEM_TRABALHO_MS,
    );
    return () => window.clearInterval(intervalo);
  }, [carregar, comTrabalho]);

  if (!projeto) {
    return (
      <section className="pagina oficina">
        {erro ? (
          <Aviso tipo="erro">
            {erro} <Link to="/app/projetos">Voltar para Imagens</Link>
          </Aviso>
        ) : (
          <Carregando />
        )}
      </section>
    );
  }

  function irPara(nova: Etapa) {
    const proximos = new URLSearchParams(params);
    proximos.set('etapa', nova);
    setParams(proximos, { replace: true });
  }

  function abrirRenomear() {
    if (!projeto) return;
    setErroModal(null);
    setFormProjeto({ nome: projeto.nome, descricao: projeto.descricao, tipo: projeto.tipo });
  }

  async function salvarProjeto() {
    if (!formProjeto) return;
    const nome = formProjeto.nome.trim();
    if (!nome) {
      setErroModal('Dê um nome para a imagem.');
      return;
    }
    setSalvandoProjeto(true);
    setErroModal(null);
    try {
      const atualizado = await api.put<ProjetoDetalhe>('/projetos/' + projetoId, {
        nome,
        descricao: formProjeto.descricao,
        tipo: formProjeto.tipo,
      });
      setProjeto(atualizado);
      setFormProjeto(null);
    } catch (e) {
      setErroModal(mensagem(e));
    } finally {
      setSalvandoProjeto(false);
    }
  }

  async function excluirProjeto() {
    setExcluindo(true);
    setErroModal(null);
    try {
      await api.del('/projetos/' + projetoId);
      navegar('/app/projetos');
    } catch (e) {
      setErroModal(mensagem(e));
      setExcluindo(false);
    }
  }

  const propsEtapa: PropsEtapa = {
    projeto,
    aoAtualizar: (p) => setProjeto(p),
    recarregar: carregar,
    regiaoSelecionada,
    aoSelecionarRegiao: setRegiaoSelecionada,
    irPara,
  };

  let conteudoEtapa;
  switch (etapa) {
    case 'analise':
      conteudoEtapa = <EtapaAnalise {...propsEtapa} />;
      break;
    case 'referencias':
      conteudoEtapa = <EtapaReferencias {...propsEtapa} />;
      break;
    case 'reconstrucao':
      conteudoEtapa = <EtapaReconstrucao {...propsEtapa} />;
      break;
    case 'resultado':
      conteudoEtapa = <EtapaResultado {...propsEtapa} />;
      break;
    case 'equipe':
      conteudoEtapa = <PainelFluxo projetoId={projeto.id} />;
      break;
  }

  const pedidosEmAberto = projeto.pedidos.some((p) => p.atendido === false);
  // Aba que resolve a pendência do usuário (ganha o ponto "Sua vez aqui").
  const telaPendente =
    projeto.situacao && projeto.situacao.quem === 'VOCE' && projeto.situacao.acao
      ? projeto.situacao.acao.tela
      : null;

  return (
    <section className="pagina oficina">
      <header className="oficina-cabecalho">
        <Link to="/app/projetos" className="oficina-voltar">
          ← Imagens
        </Link>
        <div className="oficina-titulo">
          <h1>{projeto.nome}</h1>
          <Selo cor={COR_STATUS[projeto.status]}>{ROTULO_STATUS_PROJETO[projeto.status]}</Selo>
        </div>
        <div className="oficina-acoes">
          <Botao variante="secundario" aoClicar={abrirRenomear}>
            Renomear
          </Botao>
          <Botao
            variante="perigo"
            aoClicar={() => {
              setErroModal(null);
              setExcluirAberto(true);
            }}
          >
            Excluir
          </Botao>
        </div>
      </header>

      {projeto.situacao && (
        <BarraSituacao
          situacao={projeto.situacao}
          aoIr={irPara}
          aoVerPasso={(codigo) => setPassoEmDetalhe(codigo)}
          aoReiniciar={abrirReinicio}
        />
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <p className="oficina-telas-rotulo">Telas</p>
      <nav aria-label="Telas da imagem">
        <ol className="oficina-passos">
          {ETAPAS.map((e) => {
            const ativa = e.id === etapa;
            const contador = contadorDoPasso(e.id, projeto);
            const atencao = e.id === 'referencias' && pedidosEmAberto;
            const pendente = e.id === telaPendente;
            // "Equipe ao vivo" não é um passo da restauração: fica separada à direita.
            const passo = e.id !== 'equipe';
            return (
              <li key={e.id} className={passo ? undefined : 'oficina-passo-separado'}>
                <button
                  type="button"
                  className={
                    (ativa ? 'oficina-passo oficina-passo-ativo' : 'oficina-passo') +
                    (pendente ? ' oficina-passo-pendente' : '')
                  }
                  aria-current={ativa ? 'page' : undefined}
                  onClick={() => irPara(e.id)}
                >
                  <span className="oficina-passo-texto">
                    <strong>{e.rotulo}</strong>
                    {contador && <small>{contador}</small>}
                  </span>
                  {atencao && (
                    <span className="oficina-passo-atencao" role="img" aria-label="Há pedidos de referência sem atender">
                      !
                    </span>
                  )}
                  {pendente && (
                    <span className="oficina-passo-sua-vez" role="img" aria-label="Sua vez aqui" />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={etapa === 'equipe' ? 'oficina-corpo oficina-corpo-tela-cheia' : 'oficina-corpo'}>
        <div className="oficina-etapa">
          {conteudoEtapa}
        </div>
        {etapa !== 'equipe' && (
          <aside className="oficina-lateral">
            <PainelAgentes
              projetoId={projeto.id}
              trabalhos={projeto.trabalhos}
              aoMudar={carregar}
              aoVerEquipe={() => irPara('equipe')}
            />
          </aside>
        )}
      </div>

      <Modal
        aberto={formProjeto !== null}
        titulo="Renomear imagem"
        aoFechar={() => {
          if (!salvandoProjeto) setFormProjeto(null);
        }}
      >
        {formProjeto && (
          <>
            <Campo
              rotulo="Nome"
              valor={formProjeto.nome}
              aoMudar={(v) => setFormProjeto({ ...formProjeto, nome: v })}
              obrigatorio
            />
            <label className="campo">
              <span className="campo-rotulo">Descrição</span>
              <textarea
                className="campo-controle"
                rows={4}
                value={formProjeto.descricao}
                onChange={(e) => setFormProjeto({ ...formProjeto, descricao: e.target.value })}
              />
            </label>
            <Selecao
              rotulo="Tipo"
              valor={formProjeto.tipo}
              aoMudar={(v) => setFormProjeto({ ...formProjeto, tipo: v })}
              opcoes={TIPOS_PROJETO.map((t) => ({ valor: t.valor, rotulo: t.rotulo }))}
            />
            {erroModal && <Aviso tipo="erro">{erroModal}</Aviso>}
            <div className="oficina-modal-acoes">
              <Botao variante="secundario" aoClicar={() => setFormProjeto(null)} desabilitado={salvandoProjeto}>
                Cancelar
              </Botao>
              <Botao aoClicar={salvarProjeto} desabilitado={salvandoProjeto}>
                Salvar
              </Botao>
            </div>
          </>
        )}
      </Modal>

      <Modal
        aberto={excluirAberto}
        titulo="Excluir imagem"
        aoFechar={() => {
          if (!excluindo) setExcluirAberto(false);
        }}
      >
        <p>Excluir esta imagem e tudo o que foi feito nela? Não dá para desfazer.</p>
        {erroModal && <Aviso tipo="erro">{erroModal}</Aviso>}
        <div className="oficina-modal-acoes">
          <Botao variante="secundario" aoClicar={() => setExcluirAberto(false)} desabilitado={excluindo}>
            Cancelar
          </Botao>
          <Botao variante="perigo" aoClicar={excluirProjeto} desabilitado={excluindo}>
            Excluir
          </Botao>
        </div>
      </Modal>

      <DetalheDoPasso
        projeto={projeto}
        codigo={passoEmDetalhe}
        aberto={passoEmDetalhe !== null}
        aoFechar={() => setPassoEmDetalhe(null)}
        aoIr={irPara}
        aoReiniciar={(codigo) => {
          setPassoEmDetalhe(null);
          abrirReinicio(codigo);
        }}
      />

      <Reiniciar
        projeto={projeto}
        aberto={reinicioAberto}
        passoInicial={reinicioPasso}
        aoFechar={() => setReinicioAberto(false)}
        aoAtualizar={(p) => setProjeto(p)}
      />
    </section>
  );
}
