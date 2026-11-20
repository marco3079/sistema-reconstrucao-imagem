import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ROTULO_AGENTE } from '../../lib/tipos';
import type { Atividade, Evento, StatusAgentes, TipoTrabalho, Trabalho } from '../../lib/tipos';
import { Aviso, Botao, Selo } from '../../ui';
import { Icone } from '../../ui/icones';

const ROTULO_TRABALHO: Record<TipoTrabalho, string> = {
  ANALISE: 'Analisar a imagem',
  REFERENCIAS: 'Rever o mapa de referências',
  REGIAO: 'Reconstruir uma parte',
  INSPECAO: 'Inspeção final',
  PLANO: 'Planejar e tratar as partes',
  CENA: 'Mapa 3D',
};

// Intervalo mínimo entre dois avisos de mudança para a oficina recarregar o projeto.
const INTERVALO_AVISO_MS = 3000;

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Hora local no formato HH:MM.
function horaDoEvento(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function classesDoEvento(e: Evento): string {
  const partes = ['oficina-evento'];
  if (e.tipo === 'erro') partes.push('oficina-evento-erro');
  if (e.tipo === 'revisao') partes.push('oficina-evento-revisao');
  return partes.join(' ');
}

export function PainelAgentes({
  projetoId,
  trabalhos,
  aoMudar,
  aoVerEquipe,
}: {
  projetoId: number;
  trabalhos: Trabalho[];
  aoMudar: () => void;
  // Abre a aba "Equipe ao vivo". Sem ela, o botão não aparece.
  aoVerEquipe?: () => void;
}) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [trabalhosAtividade, setTrabalhosAtividade] = useState<Trabalho[]>([]);
  const [status, setStatus] = useState<StatusAgentes | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const ultimoId = useRef<number>(0);
  const aoMudarRef = useRef(aoMudar);
  const ultimoAviso = useRef<number>(0);
  const timerAviso = useRef<number | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const seguirFim = useRef<boolean>(true);

  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  // Chama aoMudar no máximo uma vez a cada INTERVALO_AVISO_MS; se chegar antes, agenda a chamada.
  const avisarMudanca = useCallback(() => {
    const agora = Date.now();
    const falta = INTERVALO_AVISO_MS - (agora - ultimoAviso.current);
    if (falta <= 0) {
      ultimoAviso.current = agora;
      aoMudarRef.current();
      return;
    }
    if (timerAviso.current === null) {
      timerAviso.current = window.setTimeout(() => {
        timerAviso.current = null;
        ultimoAviso.current = Date.now();
        aoMudarRef.current();
      }, falta);
    }
  }, []);

  // Linha do tempo e trabalhos: busca a cada 3 s, só com os eventos novos.
  useEffect(() => {
    let ativo = true;
    ultimoId.current = 0;
    setEventos([]);
    setTrabalhosAtividade([]);

    const buscar = () => {
      api
        .get<Atividade>(`/projetos/${projetoId}/atividade?depois=${ultimoId.current}`)
        .then((resposta) => {
          if (!ativo) return;
          setTrabalhosAtividade(resposta.trabalhos);
          if (resposta.eventos.length === 0) return;

          for (const e of resposta.eventos) {
            if (e.id > ultimoId.current) ultimoId.current = e.id;
          }

          setEventos((atuais) => {
            const vistos = new Set(atuais.map((e) => e.id));
            const novos = resposta.eventos.filter((e) => !vistos.has(e.id));
            return novos.length > 0 ? [...atuais, ...novos] : atuais;
          });

          if (resposta.eventos.some((e) => e.tipo === 'status' || e.tipo === 'revisao')) {
            avisarMudanca();
          }
        })
        .catch(() => {
          // Falha pontual de rede: a próxima busca tenta de novo.
        });
    };

    buscar();
    const intervalo = window.setInterval(buscar, 3000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [projetoId, avisarMudanca]);

  // Status dos agentes: a cada 10 s.
  useEffect(() => {
    let ativo = true;
    const buscar = () => {
      api
        .get<StatusAgentes>(`/agentes/status?projeto=${projetoId}`)
        .then((s) => {
          if (ativo) setStatus(s);
        })
        .catch(() => {
          // Sem resposta: mantém o último status conhecido.
        });
    };
    buscar();
    const intervalo = window.setInterval(buscar, 10000);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [projetoId]);

  // Cancela o aviso agendado ao trocar de projeto ou sair da tela.
  useEffect(() => {
    return () => {
      if (timerAviso.current !== null) {
        window.clearTimeout(timerAviso.current);
        timerAviso.current = null;
      }
    };
  }, [projetoId]);

  // Rola sozinha para o fim quando chega evento novo, a menos que o usuário tenha subido.
  useEffect(() => {
    const lista = listaRef.current;
    if (lista && seguirFim.current) {
      lista.scrollTop = lista.scrollHeight;
    }
  }, [eventos]);

  function aoRolarLinha() {
    const lista = listaRef.current;
    if (!lista) return;
    const distanciaDoFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight;
    seguirFim.current = distanciaDoFim < 24;
  }

  // Trabalhos ativos: a lista do projeto, atualizada pela resposta de atividade.
  const ativos = useMemo(() => {
    const mapa = new Map<number, Trabalho>();
    for (const t of trabalhos) mapa.set(t.id, t);
    for (const t of trabalhosAtividade) mapa.set(t.id, t);
    return Array.from(mapa.values())
      .filter((t) => t.status === 'FILA' || t.status === 'EM_ANDAMENTO')
      .sort((a, b) => a.id - b.id);
  }, [trabalhos, trabalhosAtividade]);

  async function cancelar(trabalhoId: number) {
    setErroAcao(null);
    try {
      await api.post<Trabalho>(`/trabalhos/${trabalhoId}/cancelar`);
      aoMudar();
    } catch (e) {
      setErroAcao(mensagem(e));
    }
  }

  async function pedirInspecao() {
    setErroAcao(null);
    try {
      await api.post<Trabalho>(`/projetos/${projetoId}/trabalhos`, { tipo: 'INSPECAO' });
      aoMudar();
    } catch (e) {
      setErroAcao(mensagem(e));
    }
  }

  const conectado = status?.conectado === true;

  return (
    <section className="cartao oficina-agentes" aria-label="Equipe de agentes">
      <header className="oficina-agentes-cabecalho">
        <h2 className="cartao-titulo">Equipe de agentes</h2>
        {status === null ? (
          <Selo cor="cinza">Verificando</Selo>
        ) : conectado ? (
          <Selo cor="verde">Sessão conectada</Selo>
        ) : (
          <Selo cor="amarelo">Sem sessão</Selo>
        )}
        {aoVerEquipe && (
          <Botao variante="texto" aoClicar={aoVerEquipe}>
            Ver a equipe ao vivo
          </Botao>
        )}
      </header>
      {status !== null && !conectado && (
        <p className="oficina-pequeno">{`Abra o Claude Code na pasta agentes e digite /restaurar ${projetoId}.`}</p>
      )}

      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      <h3 className="oficina-subtitulo">Trabalhos</h3>
      {ativos.length === 0 ? (
        <p className="oficina-pequeno">Nenhum trabalho ativo.</p>
      ) : (
        <ul className="oficina-trabalhos">
          {ativos.map((t) => (
            <li key={t.id} className="oficina-trabalho">
              <span>{ROTULO_TRABALHO[t.tipo]}</span>
              <span className="oficina-pulso-selo">
                {t.status === 'FILA' ? (
                  <Selo cor="cinza">Na fila</Selo>
                ) : (
                  <Selo cor="azul">
                    <span className="oficina-pulso-selo">
                      <span className="oficina-pulso" aria-hidden="true" />
                      Em andamento
                    </span>
                  </Selo>
                )}
                {t.status === 'FILA' && (
                  <Botao variante="texto" aoClicar={() => cancelar(t.id)}>
                    Cancelar
                  </Botao>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: '0.75rem' }}>
        <Botao variante="secundario" aoClicar={pedirInspecao}>
          Pedir inspeção da imagem
        </Botao>
      </div>

      <h3 className="oficina-subtitulo">Linha do tempo</h3>
      <div className="oficina-linha-tempo" ref={listaRef} onScroll={aoRolarLinha}>
        {eventos.length === 0 ? (
          <p className="oficina-vazio">Nada por aqui ainda.</p>
        ) : (
          <ol className="oficina-eventos">
            {eventos.map((e) => (
              <li key={e.id} className={classesDoEvento(e)}>
                <span className={`oficina-agente oficina-agente-${e.agente}`} aria-hidden="true" />
                <div className="oficina-evento-corpo">
                  <div className="oficina-evento-cabecalho">
                    <strong>{ROTULO_AGENTE[e.agente]}</strong>
                    <time dateTime={e.criadoEm}>{horaDoEvento(e.criadoEm)}</time>
                    {e.tipo === 'revisao' && <Icone nome="visto" tamanho={16} />}
                  </div>
                  <p>{e.texto}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
