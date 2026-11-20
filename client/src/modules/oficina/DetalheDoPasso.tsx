import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ROTULO_AGENTE } from '../../lib/tipos';
import type { Atividade, CodigoPasso, Evento, ProjetoDetalhe, TelaDaOficina, TipoTrabalho } from '../../lib/tipos';
import { Aviso, Botao, Carregando, Modal, Selo, formatarData, formatarDataHora } from '../../ui';
import './reiniciar.css';

const TELA_DO_PASSO: Record<CodigoPasso, TelaDaOficina> = {
  EXAME: 'analise',
  MAPA: 'referencias',
  APROVAR_MAPA: 'referencias',
  PLANO: 'analise',
  TRATAMENTO: 'reconstrucao',
  ESCOLHA: 'reconstrucao',
  INSPECAO: 'resultado',
  LAUDO: 'resultado',
};

// Classifica um evento num passo da restauração (regra do mini-plano).
function passoDoEvento(evento: Evento, tipoDoTrabalho: TipoTrabalho | undefined): CodigoPasso | null {
  const texto = evento.texto;
  const ehReferencia = tipoDoTrabalho === 'ANALISE' || tipoDoTrabalho === 'REFERENCIAS';
  switch (evento.agente) {
    case 'analista':
      return 'EXAME';
    case 'cartografo':
      return 'MAPA';
    case 'conservador':
      return 'PLANO';
    case 'restaurador':
    case 'gerador-canva':
      return ehReferencia ? 'MAPA' : 'TRATAMENTO';
    case 'revisor':
      return ehReferencia || texto.startsWith('Referência') ? 'MAPA' : 'TRATAMENTO';
    case 'inspetor':
      return 'INSPECAO';
    case 'sistema':
      if (texto.startsWith('Mapa de referências aprovado')) return 'APROVAR_MAPA';
      if (texto.startsWith('Opção aplicada')) return 'ESCOLHA';
      if (texto.startsWith('Medição local')) return 'EXAME';
      return null;
    case 'maestro':
      switch (tipoDoTrabalho) {
        case 'ANALISE':
          return 'EXAME';
        case 'REFERENCIAS':
          return 'MAPA';
        case 'PLANO':
        case 'REGIAO':
          return 'TRATAMENTO';
        case 'INSPECAO':
          return 'INSPECAO';
        default:
          return null;
      }
    default:
      return null;
  }
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Uma ou duas linhas com o resultado do passo, a partir dos dados do projeto.
function resultadoDoPasso(codigo: CodigoPasso, projeto: ProjetoDetalhe): string[] {
  const regioes = projeto.regioes;
  switch (codigo) {
    case 'EXAME': {
      const elementos = regioes.filter((r) => r.classe === 'ELEMENTO').length;
      const celulas = regioes.filter((r) => r.classe === 'CELULA').length;
      const qualidade = projeto.analise ? `Qualidade: ${projeto.analise.qualidade}` : 'Sem análise';
      return [qualidade, `${regioes.length} partes: ${elementos} elementos e ${celulas} células`];
    }
    case 'MAPA':
      return [`${projeto.referencias.length} referências, ${projeto.vinculos.length} ligações no mapa`];
    case 'APROVAR_MAPA':
      return [
        projeto.mapaAprovadoEm
          ? `Mapa aprovado em ${formatarData(projeto.mapaAprovadoEm)}`
          : 'Ainda não aprovado',
      ];
    case 'PLANO':
      return [`${regioes.filter((r) => r.plano.trim() !== '').length} partes com plano`];
    case 'TRATAMENTO': {
      const ativas = regioes.filter((r) => r.status !== 'IGNORADA');
      const concluidas = ativas.filter((r) => r.status === 'RESOLVIDA').length;
      return [`${concluidas} de ${ativas.length} partes concluídas`];
    }
    case 'ESCOLHA':
      return [`${projeto.versoes.length} versões criadas`];
    case 'INSPECAO':
    case 'LAUDO':
      return ['Veja na tela Resultado'];
  }
}

export function DetalheDoPasso({
  projeto,
  codigo,
  aberto,
  aoFechar,
  aoIr,
  aoReiniciar,
}: {
  projeto: ProjetoDetalhe;
  codigo: CodigoPasso | null;
  aberto: boolean;
  aoFechar: () => void;
  aoIr: (tela: TelaDaOficina) => void;
  aoReiniciar: (codigo: CodigoPasso) => void;
}) {
  const [atividade, setAtividade] = useState<Atividade | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ao abrir, busca a atividade da imagem (linha do tempo dos passos).
  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    api
      .get<Atividade>(`/projetos/${projeto.id}/atividade?depois=0`)
      .then((a) => {
        if (!cancelado) setAtividade(a);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(mensagem(e));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [aberto, projeto.id]);

  const eventosDoPasso = useMemo(() => {
    if (!atividade || !codigo) return [];
    const tipoPorTrabalho = new Map(atividade.trabalhos.map((t) => [t.id, t.tipo]));
    return atividade.eventos.filter((e) => {
      const tipo = e.trabalhoId !== null ? tipoPorTrabalho.get(e.trabalhoId) : undefined;
      return passoDoEvento(e, tipo) === codigo;
    });
  }, [atividade, codigo]);

  if (!codigo) {
    return <Modal aberto={false} titulo="Passo" aoFechar={aoFechar} />;
  }

  const indice = projeto.situacao.passos.findIndex((p) => p.codigo === codigo);
  const passo = projeto.situacao.passos[indice];
  const titulo = passo?.titulo ?? codigo;
  const feito = passo?.estado === 'feito';
  const atual = passo?.estado === 'atual';
  const quemFaz = passo?.quem === 'VOCE' ? 'Você' : 'Equipe';

  return (
    <Modal aberto={aberto} titulo={`Passo ${indice + 1} de ${projeto.situacao.total}: ${titulo}`} aoFechar={aoFechar}>
      <div className="detalhe-passo">
        <div className="detalhe-passo-estado">
          {feito && <Selo cor="verde">Concluído</Selo>}
          {atual && <Selo cor="azul">Em andamento</Selo>}
          {!feito && !atual && <Selo cor="cinza">Ainda não chegou aqui</Selo>}
          <span className="detalhe-passo-quem">Quem faz: {quemFaz}</span>
        </div>

        <section className="detalhe-passo-bloco">
          <h3>O que aconteceu</h3>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {carregando && !atividade && <Carregando />}
          {atividade && eventosDoPasso.length === 0 && (
            <p className="detalhe-passo-vazio">Nada registrado neste passo ainda.</p>
          )}
          {eventosDoPasso.length > 0 && (
            <ol className="detalhe-passo-linha">
              {eventosDoPasso.map((e) => (
                <li key={e.id} className="detalhe-passo-evento">
                  <span className="detalhe-passo-data">{formatarDataHora(e.criadoEm)}</span>
                  <strong>{ROTULO_AGENTE[e.agente]}</strong>
                  <span>{e.texto}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="detalhe-passo-bloco">
          <h3>Resultado deste passo</h3>
          {resultadoDoPasso(codigo, projeto).map((linha, i) => (
            <p key={i}>{linha}</p>
          ))}
        </section>

        <div className="oficina-modal-acoes">
          <Botao
            variante="secundario"
            aoClicar={() => {
              aoFechar();
              aoIr(TELA_DO_PASSO[codigo]);
            }}
          >
            Abrir a tela deste passo
          </Botao>
          <Botao
            variante="secundario"
            aoClicar={() => {
              aoFechar();
              aoReiniciar(codigo);
            }}
          >
            Reiniciar a partir daqui
          </Botao>
          <Botao aoClicar={aoFechar}>Fechar</Botao>
        </div>
      </div>
    </Modal>
  );
}
