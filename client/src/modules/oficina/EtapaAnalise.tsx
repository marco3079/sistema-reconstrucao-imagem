import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { CATEGORIAS, ROTULO_CATEGORIA, ROTULO_PROBLEMA } from '../../lib/tipos';
import type { Analise, ProjetoDetalhe, Regiao, StatusRegiao } from '../../lib/tipos';
import { AreaTexto, Aviso, Botao, Campo, Cartao, Modal, Selecao, Selo } from '../../ui';
import type { PropsEtapa } from './tipos';
import { Visualizador } from './Visualizador';

interface Retangulo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

// Formulário de parte: regiaoId null = parte nova (usa o retângulo desenhado); número = edição.
interface FormParte {
  regiaoId: number | null;
  retangulo: Retangulo | null;
  nome: string;
  categoria: string;
  problema: string;
  gravidade: string;
  descricao: string;
}

type Filtro = 'todas' | 'problema' | 'marcadas';

// O formulário não oferece "Sem problema": parte sem defeito não é marcada à mão.
const OPCOES_PROBLEMA = Object.entries(ROTULO_PROBLEMA)
  .filter(([valor]) => valor !== 'NENHUM')
  .map(([valor, rotulo]) => ({ valor, rotulo }));
const OPCOES_CATEGORIA = CATEGORIAS.map((c) => ({ valor: c, rotulo: ROTULO_CATEGORIA[c] }));
const OPCOES_GRAVIDADE = [1, 2, 3, 4, 5].map((n) => ({ valor: String(n), rotulo: String(n) }));

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'problema', rotulo: 'Com problema' },
  { valor: 'marcadas', rotulo: 'Marcadas' },
];

const ROTULO_ORIGEM: Record<Regiao['origem'], string> = {
  LOCAL: 'medição local',
  IA: 'agente analista',
  MANUAL: 'marcada por você',
};

const ROTULO_STATUS_REGIAO: Record<StatusRegiao, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDA: 'Resolvida',
  IGNORADA: 'Ignorada',
};

const COR_STATUS_REGIAO: Record<StatusRegiao, 'verde' | 'amarelo' | 'cinza'> = {
  PENDENTE: 'cinza',
  EM_ANDAMENTO: 'amarelo',
  RESOLVIDA: 'verde',
  IGNORADA: 'cinza',
};

const METRICAS: { chave: 'nitidez' | 'ruido' | 'contraste' | 'saturacao' | 'exposicao'; rotulo: string }[] = [
  { chave: 'nitidez', rotulo: 'Nitidez' },
  { chave: 'ruido', rotulo: 'Ruído' },
  { chave: 'contraste', rotulo: 'Contraste' },
  { chave: 'saturacao', rotulo: 'Saturação' },
  { chave: 'exposicao', rotulo: 'Exposição' },
];

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

function limitarPercentual(valor: number): number {
  return Math.min(100, Math.max(0, valor));
}

function faixaQualidade(qualidade: number): 'boa' | 'media' | 'ruim' {
  if (qualidade >= 70) return 'boa';
  if (qualidade >= 40) return 'media';
  return 'ruim';
}

// Elementos ficam com contorno mais forte; células, com contorno fino.
function classeDaRegiaoNaTela(r: Regiao): string {
  if (r.classe === 'ELEMENTO') return 'oficina-regiao-elemento';
  if (r.classe === 'CELULA') return 'oficina-regiao-celula';
  return '';
}

function passaFiltro(r: Regiao, filtro: Filtro): boolean {
  if (filtro === 'problema') return r.problema !== 'NENHUM';
  if (filtro === 'marcadas') return r.selecionada;
  return true;
}

function BlocoDiagnostico({ analise }: { analise: Analise | null }) {
  if (!analise) {
    return <p className="oficina-vazio">A análise ainda não começou.</p>;
  }

  const faixa = faixaQualidade(analise.qualidade);
  const medidas = analise.metricas;

  return (
    <>
      <div className="oficina-medidor">
        <span className={`oficina-qualidade oficina-qualidade-${faixa}`}>
          {analise.qualidade}
          <small>/100</small>
        </span>
        <div className={`oficina-barra oficina-barra-${faixa}`}>
          <span style={{ width: `${limitarPercentual(analise.qualidade)}%` }} />
        </div>
      </div>

      {analise.comIA ? (
        <Selo cor="azul">Com IA</Selo>
      ) : (
        <Selo cor="cinza">Só medição local, aguardando os agentes</Selo>
      )}

      {analise.descricao && <p style={{ marginTop: '0.75rem' }}>{analise.descricao}</p>}

      <div className="oficina-metricas">
        {METRICAS.map((c) => (
          <div key={c.chave} className="oficina-metrica">
            <span>{c.rotulo}</span>
            <div className="oficina-barra">
              <span style={{ width: `${limitarPercentual(medidas[c.chave])}%` }} />
            </div>
            <b>{medidas[c.chave]}</b>
          </div>
        ))}
      </div>
      <p className="oficina-resolucao">
        Resolução: {medidas.largura} x {medidas.altura} px (
        {medidas.megapixels.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MP)
      </p>

      {analise.problemas.length > 0 && (
        <>
          <h3 className="oficina-subtitulo">Problemas gerais</h3>
          <ul className="oficina-lista">
            {analise.problemas.map((p, i) => (
              <li key={`${p.codigo}-${i}`}>
                <div>
                  <strong>{ROTULO_PROBLEMA[p.codigo]}</strong>{' '}
                  <Selo cor="amarelo">gravidade {p.gravidade}</Selo>
                </div>
                <p>{p.descricao}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function EtapaAnalise({
  projeto,
  aoAtualizar,
  recarregar,
  regiaoSelecionada,
  aoSelecionarRegiao,
  irPara,
}: PropsEtapa) {
  const [desenhando, setDesenhando] = useState(false);

  const [form, setForm] = useState<FormParte | null>(null);
  const [salvandoParte, setSalvandoParte] = useState(false);
  const [erroParte, setErroParte] = useState<string | null>(null);

  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const [analisarAberto, setAnalisarAberto] = useState(false);
  const [instrucoes, setInstrucoes] = useState('');
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);

  const [paraExcluir, setParaExcluir] = useState<Regiao | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const [filtro, setFiltro] = useState<Filtro>('todas');

  const itensRef = useRef<Map<number, HTMLLIElement>>(new Map());

  // A parte selecionada (no visualizador ou na lista) aparece à vista.
  useEffect(() => {
    if (regiaoSelecionada === null) return;
    itensRef.current.get(regiaoSelecionada)?.scrollIntoView({ block: 'nearest' });
  }, [regiaoSelecionada]);

  const id = projeto.id;

  function atualizarForm(parcial: Partial<FormParte>) {
    setForm((atual) => (atual ? { ...atual, ...parcial } : atual));
  }

  function abrirNovaParte(ret: Retangulo) {
    setErroParte(null);
    setForm({
      regiaoId: null,
      retangulo: ret,
      nome: `Parte ${projeto.regioes.length + 1}`,
      categoria: 'OUTRO',
      problema: '',
      gravidade: '3',
      descricao: '',
    });
  }

  function abrirEdicao(r: Regiao) {
    setErroParte(null);
    setForm({
      regiaoId: r.id,
      retangulo: null,
      nome: r.nome,
      categoria: r.categoria,
      // Parte sem problema não tem opção no formulário: quem edita escolhe o problema.
      problema: r.problema === 'NENHUM' ? '' : r.problema,
      gravidade: String(r.gravidade),
      descricao: r.descricao,
    });
  }

  async function salvarParte() {
    if (!form) return;
    const nome = form.nome.trim();
    if (!nome) {
      setErroParte('Dê um nome para a parte.');
      return;
    }
    if (!form.problema) {
      setErroParte('Escolha o tipo de problema.');
      return;
    }

    const gravidade = Number(form.gravidade);
    setSalvandoParte(true);
    setErroParte(null);
    try {
      if (form.regiaoId === null) {
        const ret = form.retangulo;
        if (!ret) throw new Error('Marque a área da parte antes de salvar.');
        const criada = await api.post<Regiao>(`/projetos/${id}/regioes`, {
          nome,
          x: ret.x,
          y: ret.y,
          largura: ret.largura,
          altura: ret.altura,
          categoria: form.categoria,
          problema: form.problema,
          gravidade,
          descricao: form.descricao,
        });
        setForm(null);
        setDesenhando(false);
        recarregar();
        aoSelecionarRegiao(criada.id);
      } else {
        await api.put<Regiao>(`/regioes/${form.regiaoId}`, {
          nome,
          categoria: form.categoria,
          problema: form.problema,
          gravidade,
          descricao: form.descricao,
        });
        setForm(null);
        recarregar();
      }
    } catch (e) {
      setErroParte(mensagem(e));
    } finally {
      setSalvandoParte(false);
    }
  }

  async function alterarStatus(r: Regiao, status: 'PENDENTE' | 'IGNORADA') {
    setErroAcao(null);
    try {
      await api.put<Regiao>(`/regioes/${r.id}`, { status });
      recarregar();
    } catch (e) {
      setErroAcao(mensagem(e));
    }
  }

  async function excluirParte() {
    if (!paraExcluir) return;
    setExcluindo(true);
    setErroAcao(null);
    try {
      await api.del(`/regioes/${paraExcluir.id}`);
      if (regiaoSelecionada === paraExcluir.id) aoSelecionarRegiao(null);
      recarregar();
    } catch (e) {
      setErroAcao(mensagem(e));
    } finally {
      setExcluindo(false);
      setParaExcluir(null);
    }
  }

  async function analisarDeNovo() {
    setAnalisando(true);
    setErroAnalise(null);
    try {
      const atualizado = await api.post<ProjetoDetalhe>(`/projetos/${id}/analisar`, {
        instrucoes: instrucoes.trim(),
      });
      aoAtualizar(atualizado);
      setAnalisarAberto(false);
      setInstrucoes('');
    } catch (e) {
      setErroAnalise(mensagem(e));
    } finally {
      setAnalisando(false);
    }
  }

  // Uma parte na lista. Na grade (compacta) fica só a linha; nos demais blocos, com descrição e plano.
  function linhaDaParte(r: Regiao, compacta: boolean) {
    const semProblema = r.problema === 'NENHUM';
    const classes = ['oficina-parte'];
    if (compacta) classes.push('oficina-parte-compacta');
    if (r.id === regiaoSelecionada) classes.push('oficina-parte-selecionada');

    return (
      <li
        key={r.id}
        ref={(el) => {
          if (el) itensRef.current.set(r.id, el);
          else itensRef.current.delete(r.id);
        }}
        className={classes.join(' ')}
        onClick={() => aoSelecionarRegiao(r.id)}
      >
        <div className="oficina-parte-linha">
          <button type="button" className="oficina-parte-nome">
            {r.nome}
          </button>
          <Selo>{ROTULO_CATEGORIA[r.categoria]}</Selo>
          {semProblema ? (
            <Selo cor="cinza">{ROTULO_PROBLEMA[r.problema]}</Selo>
          ) : (
            <>
              <Selo cor="azul">{ROTULO_PROBLEMA[r.problema]}</Selo>
              <span className="oficina-parte-origem">gravidade {r.gravidade}</span>
            </>
          )}
          <Selo cor={r.selecionada ? 'azul' : 'cinza'}>
            {r.selecionada ? 'Vai ser reconstruída' : 'Fora da reconstrução'}
          </Selo>
          <Selo cor={COR_STATUS_REGIAO[r.status]}>{ROTULO_STATUS_REGIAO[r.status]}</Selo>
        </div>
        {!compacta && (
          <>
            <span className="oficina-parte-origem">{ROTULO_ORIGEM[r.origem]}</span>
            {r.descricao && <p>{r.descricao}</p>}
            {r.plano !== '' && (
              <p className="oficina-plano">
                <strong>Plano de tratamento:</strong> {r.plano}
              </p>
            )}
          </>
        )}
        <div className="oficina-parte-acoes" onClick={(e) => e.stopPropagation()}>
          <Botao variante="texto" aoClicar={() => abrirEdicao(r)}>
            Editar
          </Botao>
          {r.status === 'IGNORADA' ? (
            <Botao variante="texto" aoClicar={() => alterarStatus(r, 'PENDENTE')}>
              Reativar
            </Botao>
          ) : (
            <Botao variante="texto" aoClicar={() => alterarStatus(r, 'IGNORADA')}>
              Ignorar
            </Botao>
          )}
          <Botao variante="texto" aoClicar={() => setParaExcluir(r)}>
            Excluir
          </Botao>
        </div>
      </li>
    );
  }

  // Partes na ordem do projeto (ordem, depois id).
  const partesOrdenadas = [...projeto.regioes].sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  // Resumo sobre todas as partes, sem o filtro.
  const totalElementos = projeto.regioes.filter((r) => r.classe === 'ELEMENTO').length;
  const totalCelulas = projeto.regioes.filter((r) => r.classe === 'CELULA').length;
  const totalMarcadas = projeto.regioes.filter((r) => r.selecionada).length;

  // Partes que aparecem na lista, já com o filtro aplicado.
  const partesFiltradas = partesOrdenadas.filter((r) => passaFiltro(r, filtro));
  const elementos = partesFiltradas.filter((r) => r.classe === 'ELEMENTO');
  const celulas = partesFiltradas.filter((r) => r.classe === 'CELULA');
  const manuais = partesFiltradas.filter((r) => r.classe === 'DEFEITO');

  return (
    <div className="oficina-etapa-analise">
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      <div className="oficina-barra-acoes">
        <Botao variante="secundario" aoClicar={() => setDesenhando((v) => !v)}>
          Marcar parte à mão
        </Botao>
        <Botao
          variante="secundario"
          aoClicar={() => {
            setErroAnalise(null);
            setAnalisarAberto(true);
          }}
        >
          Analisar de novo
        </Botao>
        <Botao aoClicar={() => irPara('referencias')}>Ir para referências</Botao>
      </div>
      {desenhando && <p className="oficina-dica">Arraste sobre a imagem para marcar a parte.</p>}

      <Visualizador
        arquivo={projeto.atualArquivo}
        largura={projeto.largura}
        altura={projeto.altura}
        regioes={projeto.regioes}
        selecionada={regiaoSelecionada}
        aoSelecionar={aoSelecionarRegiao}
        desenhando={desenhando}
        aoDesenhar={abrirNovaParte}
        classeDaRegiao={classeDaRegiaoNaTela}
      />

      <div className="oficina-blocos">
        <Cartao titulo="Diagnóstico">
          <BlocoDiagnostico analise={projeto.analise} />
        </Cartao>

        <Cartao titulo="Partes">
          {projeto.regioes.length === 0 ? (
            <p className="oficina-vazio">
              Nenhuma parte marcada ainda. Os agentes marcam sozinhos, e você também pode marcar à mão.
            </p>
          ) : (
            <>
              <p className="oficina-resumo-partes">
                {`${projeto.regioes.length} partes: ${totalElementos} elementos e ${totalCelulas} células. ${totalMarcadas} marcadas para reconstruir.`}
              </p>

              <div className="oficina-filtros" role="group" aria-label="Filtrar partes">
                {FILTROS.map((f) => (
                  <button
                    key={f.valor}
                    type="button"
                    className="oficina-filtro"
                    aria-pressed={filtro === f.valor}
                    onClick={() => setFiltro(f.valor)}
                  >
                    {f.rotulo}
                  </button>
                ))}
              </div>

              {partesFiltradas.length === 0 && <p className="oficina-vazio">Nenhuma parte neste filtro.</p>}

              {elementos.length > 0 && (
                <section className="oficina-bloco-partes">
                  <h3 className="oficina-subtitulo">Elementos</h3>
                  {CATEGORIAS.map((c) => {
                    const itens = elementos.filter((r) => r.categoria === c);
                    if (itens.length === 0) return null;
                    return (
                      <div key={c} className="oficina-grupo-categoria">
                        <h4 className="oficina-categoria">{ROTULO_CATEGORIA[c]}</h4>
                        <ul className="oficina-partes">{itens.map((r) => linhaDaParte(r, false))}</ul>
                      </div>
                    );
                  })}
                </section>
              )}

              {celulas.length > 0 && (
                <section className="oficina-bloco-partes">
                  <h3 className="oficina-subtitulo">Grade</h3>
                  <p className="oficina-pequeno">
                    {`${projeto.gradeLinhas} × ${projeto.gradeColunas} células`}
                  </p>
                  <ul className="oficina-partes oficina-partes-grade">
                    {celulas.map((r) => linhaDaParte(r, true))}
                  </ul>
                </section>
              )}

              {manuais.length > 0 && (
                <section className="oficina-bloco-partes">
                  <h3 className="oficina-subtitulo">Marcadas à mão e imagem inteira</h3>
                  <ul className="oficina-partes">{manuais.map((r) => linhaDaParte(r, false))}</ul>
                </section>
              )}
            </>
          )}
        </Cartao>
      </div>

      <Modal
        aberto={form !== null}
        titulo={form?.regiaoId === null ? 'Nova parte' : 'Editar parte'}
        aoFechar={() => {
          if (!salvandoParte) setForm(null);
        }}
      >
        {form && (
          <>
            <Campo rotulo="Nome" valor={form.nome} aoMudar={(v) => atualizarForm({ nome: v })} obrigatorio />
            <Selecao
              rotulo="O que é"
              valor={form.categoria}
              aoMudar={(v) => atualizarForm({ categoria: v })}
              opcoes={OPCOES_CATEGORIA}
            />
            <Selecao
              rotulo="Problema"
              valor={form.problema}
              aoMudar={(v) => atualizarForm({ problema: v })}
              opcoes={OPCOES_PROBLEMA}
              obrigatorio
            />
            <Selecao
              rotulo="Gravidade (1 a 5)"
              valor={form.gravidade}
              aoMudar={(v) => atualizarForm({ gravidade: v })}
              opcoes={OPCOES_GRAVIDADE}
            />
            <AreaTexto
              rotulo="O que há de errado aqui"
              valor={form.descricao}
              aoMudar={(v) => atualizarForm({ descricao: v })}
            />
            {erroParte && <Aviso tipo="erro">{erroParte}</Aviso>}
            <div className="oficina-modal-acoes">
              <Botao variante="secundario" aoClicar={() => setForm(null)} desabilitado={salvandoParte}>
                Cancelar
              </Botao>
              <Botao aoClicar={salvarParte} desabilitado={salvandoParte}>
                Salvar
              </Botao>
            </div>
          </>
        )}
      </Modal>

      <Modal
        aberto={analisarAberto}
        titulo="Analisar de novo"
        aoFechar={() => {
          if (!analisando) setAnalisarAberto(false);
        }}
      >
        <AreaTexto
          rotulo="Instruções para os agentes (opcional)"
          valor={instrucoes}
          aoMudar={setInstrucoes}
        />
        {erroAnalise && <Aviso tipo="erro">{erroAnalise}</Aviso>}
        <div className="oficina-modal-acoes">
          <Botao variante="secundario" aoClicar={() => setAnalisarAberto(false)} desabilitado={analisando}>
            Cancelar
          </Botao>
          <Botao aoClicar={analisarDeNovo} desabilitado={analisando}>
            Analisar
          </Botao>
        </div>
      </Modal>

      <Modal
        aberto={paraExcluir !== null}
        titulo="Excluir parte"
        aoFechar={() => {
          if (!excluindo) setParaExcluir(null);
        }}
      >
        <p>Excluir a parte "{paraExcluir?.nome}"? Não dá para desfazer.</p>
        <div className="oficina-modal-acoes">
          <Botao variante="secundario" aoClicar={() => setParaExcluir(null)} desabilitado={excluindo}>
            Cancelar
          </Botao>
          <Botao variante="perigo" aoClicar={excluirParte} desabilitado={excluindo}>
            Excluir
          </Botao>
        </div>
      </Modal>
    </div>
  );
}
