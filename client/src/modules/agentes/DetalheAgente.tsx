import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RAIZ } from '../../lib/rotas';
import { ROTULO_CATEGORIA, ROTULO_PROBLEMA } from '../../lib/tipos';
import type {
  FluxoAgentes,
  Opcao,
  ProjetoDetalhe,
  StatusMapa,
  StatusOpcao,
  StatusTrabalho,
  TipoTrabalho,
} from '../../lib/tipos';
import { Botao, Selo, formatarData } from '../../ui';
import type { EstadoNo, NoFluxo } from './fluxoTipos';
import { ROTULO_ESTADO } from './fluxoTipos';

// Constantes compartilhadas pelo painel, pela grade de agentes e pelo detalhe.

export const AGENTES_DO_FLUXO: string[] = [
  'maestro',
  'analista',
  'cenografo',
  'cartografo',
  'conservador',
  'restaurador',
  'gerador-canva',
  'revisor',
  'inspetor',
];

// Nós que mostram a seção "O que este agente produziu".
const NOS_QUE_PRODUZEM: string[] = [
  'entrada',
  'maestro',
  'analista',
  'cartografo',
  'mapa',
  'conservador',
  'restaurador',
  'gerador-canva',
  'revisor',
  'usuario',
  'laudo',
];

const MAXIMO_PASSOS_AGENTE = 8;
const MAXIMO_OPCOES_DETALHE = 8;
const MAXIMO_PARTES_DETALHE = 12;

export const ROTULO_TIPO_TRABALHO: Record<TipoTrabalho, string> = {
  ANALISE: 'Analisar a imagem',
  REFERENCIAS: 'Rever o mapa de referências',
  PLANO: 'Planejar e tratar as partes',
  REGIAO: 'Reconstruir uma parte',
  INSPECAO: 'Inspeção final',
  CENA: 'Mapa 3D',
};

export const STATUS_TRABALHO: Record<StatusTrabalho, { rotulo: string; cor: 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza' }> = {
  FILA: { rotulo: 'Na fila', cor: 'cinza' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', cor: 'azul' },
  CONCLUIDO: { rotulo: 'Concluído', cor: 'verde' },
  FALHOU: { rotulo: 'Falhou', cor: 'vermelho' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'cinza' },
};

export const COR_ESTADO: Record<EstadoNo, 'azul' | 'verde' | 'vermelho' | 'amarelo' | 'cinza'> = {
  ativo: 'azul',
  feito: 'verde',
  erro: 'vermelho',
  espera: 'amarelo',
  parado: 'cinza',
};

const STATUS_OPCAO: Record<StatusOpcao, { rotulo: string; cor: 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza' }> = {
  GERANDO: { rotulo: 'Gerando', cor: 'azul' },
  PRONTA: { rotulo: 'Pronta', cor: 'verde' },
  FALHOU: { rotulo: 'Falhou', cor: 'vermelho' },
  ESCOLHIDA: { rotulo: 'Escolhida', cor: 'verde' },
  REPROVADA: { rotulo: 'Reprovada', cor: 'vermelho' },
};

const MAPA_STATUS: Record<StatusMapa, { rotulo: string; cor: 'verde' | 'amarelo' | 'cinza' }> = {
  RASCUNHO: { rotulo: 'Rascunho', cor: 'cinza' },
  AGUARDANDO: { rotulo: 'Esperando a sua aprovação', cor: 'amarelo' },
  APROVADO: { rotulo: 'Aprovado', cor: 'verde' },
};

export const PAPEL_NO: Record<string, string> = {
  entrada: 'O original nunca é alterado: a equipe trabalha em cópias e o sistema mede a imagem na chegada.',
  maestro: 'Pega cada trabalho da fila e distribui as tarefas entre a equipe.',
  analista: 'Examina a imagem e escreve o laudo de estado antes de qualquer correção.',
  cartografo: 'Junta as evidências: pede referências e liga cada uma à parte em que serve.',
  cenografo: 'Observa a foto em perspectiva e monta o mapa 3D: câmera, horizonte e a posição de cada pessoa e objeto.',
  mapa: 'Você confere o mapa de referências que o cartógrafo montou, ajusta as ligações e aprova. A equipe só planeja e trata as partes depois disso.',
  conservador:
    'Escreve o plano de tratamento de cada parte, sempre pelo caminho menos invasivo, e define a ordem: tom e cor, ruído, partes faltantes e nitidez por último.',
  restaurador: 'Corrige com filtros locais, sem inventar conteúdo.',
  'gerador-canva': 'Recria o que falta com base nas referências. Sem referência, a opção sai marcada como conjectura.',
  revisor: 'Confere fidelidade, emendas e artefatos, dá nota e devolve um plano de ajuste quando reprova.',
  usuario: 'É você quem escolhe a opção final de cada parte. Cada escolha vira uma versão e pode ser desfeita.',
  inspetor: 'Compara a imagem final com a original e mede antes e depois.',
  laudo:
    'O laudo lista o que é original, o que foi corrigido e o que foi recriado; o arquivo baixado leva a marcação de conteúdo gerado por IA.',
};

// Hora local no formato HH:MM:SS.
export function horaCompleta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------- Produção do nó (dados reais do projeto) ----------

interface PropsProducao {
  no: NoFluxo;
  dados: FluxoAgentes;
  projetoId: number;
  projeto: ProjetoDetalhe | null;
  opcoes: Opcao[] | null;
}

function conteudoDoNo(p: PropsProducao): ReactNode {
  const { no, dados, projetoId, projeto, opcoes } = p;
  const link = (etapa: string, texto: string): ReactNode => (
    <p>
      <Link to={`${RAIZ}/projetos/${projetoId}?etapa=${etapa}`}>{texto}</Link>
    </p>
  );

  if (no.id === 'maestro') {
    if (dados.trabalhos.length === 0) return <p className="fluxo-suave">Nada ainda.</p>;
    return (
      <ul className="fluxo-lista">
        {dados.trabalhos.map((t) => {
          const s = STATUS_TRABALHO[t.status];
          return (
            <li key={t.id}>
              <strong>{ROTULO_TIPO_TRABALHO[t.tipo]}</strong>
              <Selo cor={s.cor}>{s.rotulo}</Selo>
            </li>
          );
        })}
      </ul>
    );
  }

  if (no.id === 'laudo') return link('resultado', 'Abrir o laudo');

  if (!projeto) return <p className="fluxo-suave">Carregando os dados do projeto.</p>;

  const lista = opcoes ?? [];
  const regiaoDe = (id: number) => projeto.regioes.find((r) => r.id === id);

  switch (no.id) {
    case 'entrada': {
      const a = projeto.analise;
      return (
        <>
          <p>
            Imagem: {projeto.largura} × {projeto.altura} px.
          </p>
          <p>{a ? `Qualidade medida: ${a.qualidade}/100.` : 'Qualidade ainda não medida.'}</p>
          {link('analise', 'Abrir a análise')}
        </>
      );
    }
    case 'analista': {
      const a = projeto.analise;
      if (!a) return <p className="fluxo-suave">Ainda não analisada.</p>;
      return (
        <>
          <p>{a.descricao || 'Sem descrição.'}</p>
          <p>Qualidade: {a.qualidade}/100.</p>
          {(() => {
            const elementos = projeto.regioes.filter((r) => r.classe === 'ELEMENTO').length;
            const celulas = projeto.regioes.filter((r) => r.classe === 'CELULA').length;
            const comProblema = projeto.regioes.filter((r) => r.problema !== 'NENHUM').length;
            const destaques = [...projeto.regioes]
              .filter((r) => r.classe === 'ELEMENTO' || r.problema !== 'NENHUM')
              .sort((x, y) => x.ordem - y.ordem || x.id - y.id);
            const aMais = destaques.length - MAXIMO_PARTES_DETALHE;
            return (
              <>
                <p className="fluxo-suave">{`${elementos} elementos e ${celulas} células, ${comProblema} com problema`}</p>
                {destaques.length === 0 ? (
                  <p className="fluxo-suave">Nenhum elemento nem parte com problema.</p>
                ) : (
                  <ul className="fluxo-lista">
                    {destaques.slice(0, MAXIMO_PARTES_DETALHE).map((r) => (
                      <li key={r.id}>
                        <strong>{r.nome}</strong>
                        <span className="fluxo-suave">
                          {ROTULO_CATEGORIA[r.categoria]}, {ROTULO_PROBLEMA[r.problema]}
                        </span>
                      </li>
                    ))}
                    {aMais > 0 && <li className="fluxo-suave">{`e mais ${aMais}`}</li>}
                  </ul>
                )}
              </>
            );
          })()}
          {link('analise', 'Ver a análise')}
        </>
      );
    }
    case 'cartografo': {
      const abertos = projeto.pedidos.filter((p) => !p.atendido);
      const atendidos = projeto.pedidos.length - abertos.length;
      return (
        <>
          <p>
            Pedidos de referência em aberto: {abertos.length}. Atendidos: {atendidos}.
          </p>
          {abertos.length > 0 && (
            <ul className="fluxo-lista">
              {abertos.map((p) => (
                <li key={p.id}>{p.descricao}</li>
              ))}
            </ul>
          )}
          {(() => {
            const geradas = projeto.referencias.filter((r) => r.origem === 'CANVA');
            const aprovadas = geradas.filter((r) => r.status === 'APROVADA').length;
            const reprovadas = geradas.filter((r) => r.status === 'REPROVADA').length;
            const esperando = geradas.filter((r) => r.status === 'PENDENTE').length;
            return (
              <p>{`${geradas.length} geradas: ${aprovadas} aprovadas, ${reprovadas} reprovadas, ${esperando} esperando revisor`}</p>
            );
          })()}
          <p>Ligações no mapa: {projeto.vinculos.length}.</p>
          {link('referencias', 'Ver o mapa de referências')}
        </>
      );
    }
    case 'mapa': {
      const m = MAPA_STATUS[projeto.mapaStatus];
      const rotulo =
        projeto.mapaStatus === 'APROVADO' && projeto.mapaAprovadoEm
          ? `Aprovado em ${formatarData(projeto.mapaAprovadoEm)}`
          : m.rotulo;
      return (
        <>
          <p>
            <Selo cor={m.cor}>{rotulo}</Selo>
          </p>
          {link('referencias', 'Revisar o mapa')}
        </>
      );
    }
    case 'conservador': {
      const partes = projeto.regioes.filter((r) => r.selecionada).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
      if (partes.length === 0) {
        return (
          <>
            <p className="fluxo-suave">Nenhuma parte selecionada para reconstruir.</p>
            {link('analise', 'Ver as partes')}
          </>
        );
      }
      return (
        <>
          <ol className="fluxo-lista">
            {partes.map((r) => (
              <li key={r.id}>
                <strong>{r.nome}</strong>
                <span className="fluxo-suave">{r.plano || 'Sem plano ainda.'}</span>
              </li>
            ))}
          </ol>
          {link('analise', 'Ver as partes')}
        </>
      );
    }
    case 'restaurador':
    case 'gerador-canva': {
      const origem = no.id === 'restaurador' ? 'LOCAL' : 'CANVA';
      const itens = lista
        .filter((o) => o.origem === origem)
        .sort((a, b) => b.id - a.id)
        .slice(0, MAXIMO_OPCOES_DETALHE);
      return (
        <>
          {itens.length === 0 ? (
            <p className="fluxo-suave">Nada ainda.</p>
          ) : (
            <ul className="fluxo-lista">
              {itens.map((o) => {
                const s = STATUS_OPCAO[o.status];
                return (
                  <li key={o.id}>
                    <strong>{o.rotulo}</strong>
                    <span className="fluxo-suave">
                      {regiaoDe(o.regiaoId)?.nome ?? 'Parte'}, rodada {o.rodada}
                    </span>
                    <span className="fluxo-selos">
                      <Selo cor={s.cor}>{s.rotulo}</Selo>
                      {o.nota !== null && <Selo>{o.nota}/10</Selo>}
                      {origem === 'CANVA' && o.parametros.conjectura === true && (
                        <Selo cor="amarelo">Conjectura</Selo>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {link('reconstrucao', 'Abrir as opções')}
        </>
      );
    }
    case 'revisor': {
      const revisoes = lista
        .flatMap((o) => o.revisoes.map((r) => ({ r, rotulo: o.rotulo })))
        .sort((a, b) => b.r.id - a.r.id)
        .slice(0, MAXIMO_OPCOES_DETALHE);
      if (revisoes.length === 0) return <p className="fluxo-suave">Nada ainda.</p>;
      return (
        <ul className="fluxo-lista">
          {revisoes.map(({ r, rotulo }) => (
            <li key={r.id}>
              <span className="fluxo-selos">
                <Selo cor={r.veredito === 'APROVADA' ? 'verde' : 'vermelho'}>
                  {r.veredito === 'APROVADA' ? 'Aprovada' : 'Reprovada'}
                </Selo>
                <Selo>{r.nota}/10</Selo>
              </span>
              <strong>{rotulo}</strong>
              {r.parecer && <span>{r.parecer}</span>}
              {r.planoAjuste && <span className="fluxo-suave">Plano de ajuste: {r.planoAjuste}</span>}
            </li>
          ))}
        </ul>
      );
    }
    case 'usuario': {
      const esperando = lista.filter((o) => {
        if (o.status !== 'PRONTA') return false;
        const r = regiaoDe(o.regiaoId);
        return (
          r !== undefined && r.selecionada && (r.status === 'PENDENTE' || r.status === 'EM_ANDAMENTO')
        );
      });
      return (
        <>
          {esperando.length === 0 ? (
            <p className="fluxo-suave">Nada esperando a sua escolha.</p>
          ) : (
            <ul className="fluxo-lista">
              {esperando.map((o) => (
                <li key={o.id}>
                  <strong>{o.rotulo}</strong>
                  <span className="fluxo-suave">
                    {regiaoDe(o.regiaoId)?.nome ?? 'Parte'}
                    {o.nota !== null ? `, nota ${o.nota}/10` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p>Versões salvas: {projeto.versoes.length}.</p>
          {link('reconstrucao', 'Abrir as opções')}
        </>
      );
    }
    default:
      return null;
  }
}

// ---------- Painel de detalhe ----------

export interface PropsDetalheAgente {
  no: NoFluxo;
  dados: FluxoAgentes;
  projetoId: number;
  projeto: ProjetoDetalhe | null;
  opcoes: Opcao[] | null;
  demonstracao: boolean;
  variante: 'flutuante' | 'fixo';
  aoFechar: () => void;
}

export function DetalheAgente(props: PropsDetalheAgente) {
  const { no, dados, demonstracao, variante, aoFechar } = props;
  const ehAgente = AGENTES_DO_FLUXO.includes(no.id);
  const passos = ehAgente
    ? dados.eventos
        .filter((e) => e.agente === no.id)
        .slice(-MAXIMO_PASSOS_AGENTE)
        .reverse()
    : [];
  const naFila = dados.trabalhos.filter((t) => t.status === 'FILA').sort((a, b) => a.id - b.id);
  const classe = variante === 'fixo' ? 'fluxo-detalhe fluxo-detalhe-fixo' : 'fluxo-detalhe';

  return (
    <section className={classe}>
      <div className="fluxo-detalhe-cabecalho">
        <h2 className="cartao-titulo">{no.titulo}</h2>
        <Botao variante="texto" aoClicar={aoFechar}>
          Fechar
        </Botao>
      </div>
      <Selo cor={COR_ESTADO[no.estado]}>{ROTULO_ESTADO[no.estado]}</Selo>
      <p className="fluxo-papel">{PAPEL_NO[no.id] ?? ''}</p>
      {no.texto && <p className="fluxo-situacao">{no.texto}</p>}

      {!demonstracao && NOS_QUE_PRODUZEM.includes(no.id) && (
        <section className="fluxo-producao">
          <h3 className="fluxo-subtitulo">O que este agente produziu</h3>
          {conteudoDoNo(props)}
        </section>
      )}

      {ehAgente && (
        <>
          <h3 className="fluxo-subtitulo">Últimos passos</h3>
          {passos.length === 0 ? (
            <p className="fluxo-suave">Ainda não atuou.</p>
          ) : (
            <ul className="fluxo-lista">
              {passos.map((e) => (
                <li key={e.id}>
                  <span className="fluxo-hora">{horaCompleta(e.criadoEm)}</span>
                  <span className="fluxo-suave">{e.projetoNome}</span>
                  <span className={e.tipo === 'erro' ? 'fluxo-evento-erro' : undefined}>{e.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {no.id === 'entrada' && (
        <>
          <h3 className="fluxo-subtitulo">Na fila</h3>
          {naFila.length === 0 ? (
            <p className="fluxo-suave">Fila vazia.</p>
          ) : (
            <ul className="fluxo-lista">
              {naFila.map((t) => (
                <li key={t.id}>
                  <strong>{ROTULO_TIPO_TRABALHO[t.tipo]}</strong>
                  <span className="fluxo-suave">{t.projetoNome}</span>
                  {t.regiaoNome && <span className="fluxo-suave">{t.regiaoNome}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {(no.id === 'usuario' || no.id === 'mapa' || no.id === 'laudo') && (
        <p>
          <Link to={`${RAIZ}/projetos`}>Abrir as imagens</Link>
        </p>
      )}
    </section>
  );
}
