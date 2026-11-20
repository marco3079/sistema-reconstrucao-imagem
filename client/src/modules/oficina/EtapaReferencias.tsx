import { useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, FormEvent } from 'react';
import { api } from '../../lib/api';
import { TAMANHO_MAXIMO_ENVIO, TIPOS_DE_IMAGEM_ACEITOS, urlArquivo } from '../../lib/arquivos';
import { ROTULO_PAPEL } from '../../lib/tipos';
import type { PapelReferencia, PedidoReferencia, ProjetoDetalhe, Referencia } from '../../lib/tipos';
import { AreaTexto, Aviso, Botao, Campo, Cartao, Modal, Selecao, Selo } from '../../ui';
import { Icone } from '../../ui/icones';
import { MapaElementos } from './MapaElementos';
import type { PropsEtapa } from './tipos';
import './referencias.css';

const PAPEIS = Object.keys(ROTULO_PAPEL) as PapelReferencia[];
const OPCOES_PAPEL = PAPEIS.map((valor) => ({ valor, rotulo: ROTULO_PAPEL[valor] }));

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado.';
}

function comoPapel(valor: string): PapelReferencia {
  return PAPEIS.find((papel) => papel === valor) ?? 'GERAL';
}

function nomeSemExtensao(nome: string): string {
  const semExtensao = nome.replace(/\.[^.]+$/, '').trim();
  return semExtensao || 'Referência';
}

// Nome do pedido: a descrição, cortada em 60 caracteres.
function nomeDoPedido(descricao: string): string {
  const cortado = Array.from(descricao.trim()).slice(0, 60).join('');
  return cortado || 'Referência';
}

// Mensagem de erro para um arquivo que não pode ser enviado (null = pode enviar).
function erroDoArquivo(arquivo: File): string | null {
  if (!arquivo.type.startsWith('image/')) return `${arquivo.name}: não é uma imagem.`;
  if (arquivo.size > TAMANHO_MAXIMO_ENVIO) return `${arquivo.name}: passa do limite de 30 MB.`;
  return null;
}

// Cria uma referência nova: corpo bruto da imagem, nome e papel na query string.
function enviarReferencia(
  projetoId: number,
  arquivo: File,
  nome: string,
  papel: PapelReferencia,
): Promise<Referencia> {
  return api.enviarArquivo<Referencia>(
    '/projetos/' + projetoId + '/referencias?nome=' + encodeURIComponent(nome) + '&papel=' + papel,
    arquivo,
    arquivo.type || 'application/octet-stream',
  );
}

// ---------- Bloco 1: referências pedidas ----------

function BlocoPedidos({
  projeto,
  recarregar,
  aoSelecionarRegiao,
}: {
  projeto: ProjetoDetalhe;
  recarregar: () => void;
  aoSelecionarRegiao: (id: number | null) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputEnvio = useRef<HTMLInputElement>(null);
  const pedidoDoEnvio = useRef<PedidoReferencia | null>(null);

  async function atualizarPedido(pedido: PedidoReferencia, corpo: { atendido?: boolean; referenciaId?: number | null }) {
    setOcupado(true);
    setErro(null);
    try {
      await api.put<PedidoReferencia>('/pedidos/' + pedido.id, corpo);
      recarregar();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setOcupado(false);
    }
  }

  function abrirEnvio(pedido: PedidoReferencia) {
    pedidoDoEnvio.current = pedido;
    inputEnvio.current?.click();
  }

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const pedido = pedidoDoEnvio.current;
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    pedidoDoEnvio.current = null;
    if (!pedido || !arquivo) return;

    const problema = erroDoArquivo(arquivo);
    if (problema) {
      setErro(problema);
      return;
    }

    setOcupado(true);
    setErro(null);
    try {
      const referencia = await enviarReferencia(projeto.id, arquivo, nomeDoPedido(pedido.descricao), pedido.papel);
      await api.put<PedidoReferencia>('/pedidos/' + pedido.id, { referenciaId: referencia.id });
      recarregar();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setOcupado(false);
    }
  }

  const opcoesReferencias = projeto.referencias.map((r) => ({ valor: String(r.id), rotulo: r.nome }));

  return (
    <Cartao titulo="Referências pedidas">
      <input
        ref={inputEnvio}
        type="file"
        accept={TIPOS_DE_IMAGEM_ACEITOS}
        hidden
        onChange={aoEscolherArquivo}
      />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {projeto.pedidos.length === 0 ? (
        <p className="ref-vazio">
          Nenhum pedido por enquanto. Quando os agentes precisarem de uma referência, o pedido aparece aqui.
        </p>
      ) : (
        <ul className="ref-lista">
          {projeto.pedidos.map((pedido) => {
            const regiao =
              pedido.regiaoId === null ? undefined : projeto.regioes.find((r) => r.id === pedido.regiaoId);
            const referencia =
              pedido.referenciaId === null
                ? undefined
                : projeto.referencias.find((r) => r.id === pedido.referenciaId);

            return (
              <li key={pedido.id} className="ref-pedido">
                <div className="ref-pedido-cabecalho">
                  <span className="ref-pedido-icone" aria-hidden="true">
                    <Icone nome="imagem" tamanho={20} />
                  </span>
                  <div className="ref-pedido-texto">
                    <strong>{pedido.descricao}</strong>
                    <div className="ref-pedido-meta">
                      <Selo>{ROTULO_PAPEL[pedido.papel]}</Selo>
                      {regiao && (
                        <button
                          type="button"
                          className="ref-link"
                          onClick={() => aoSelecionarRegiao(regiao.id)}
                        >
                          {regiao.nome}
                        </button>
                      )}
                      {pedido.atendido ? <Selo cor="verde">Atendido</Selo> : <Selo cor="amarelo">Aguardando</Selo>}
                    </div>
                  </div>
                </div>

                {pedido.atendido && referencia && (
                  <div className="ref-pedido-atendido">
                    <img className="ref-miniatura-pequena" src={urlArquivo(referencia.arquivo, 96)} alt="" />
                    <span>{referencia.nome}</span>
                  </div>
                )}

                <div className="ref-pedido-acoes">
                  {pedido.atendido ? (
                    <Botao
                      variante="texto"
                      desabilitado={ocupado}
                      aoClicar={() => atualizarPedido(pedido, { atendido: false, referenciaId: null })}
                    >
                      Reabrir
                    </Botao>
                  ) : (
                    <>
                      <Botao desabilitado={ocupado} aoClicar={() => abrirEnvio(pedido)}>
                        Enviar imagem
                      </Botao>
                      {projeto.referencias.length > 0 && (
                        <Selecao
                          rotulo="Usar uma já enviada"
                          valor=""
                          vazio="Escolha uma referência"
                          opcoes={opcoesReferencias}
                          aoMudar={(valor) => {
                            if (valor !== '') atualizarPedido(pedido, { referenciaId: Number(valor) });
                          }}
                        />
                      )}
                      <Botao
                        variante="texto"
                        desabilitado={ocupado}
                        aoClicar={() => atualizarPedido(pedido, { atendido: true })}
                      >
                        Não tenho
                      </Botao>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

// ---------- Bloco 2: suas referências ----------

// Modal com a imagem grande e o formulário de edição de uma referência.
function EditarReferencia({
  referencia,
  aoFechar,
  aoSalvar,
}: {
  referencia: Referencia;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(referencia.nome);
  const [papel, setPapel] = useState<PapelReferencia>(referencia.papel);
  const [observacao, setObservacao] = useState(referencia.observacao);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro('Dê um nome para a referência.');
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      await api.put<Referencia>('/referencias/' + referencia.id, { nome: nomeLimpo, papel, observacao });
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir a referência "${referencia.nome}"? Essa ação não pode ser desfeita.`)) return;
    setOcupado(true);
    setErro(null);
    try {
      await api.del('/referencias/' + referencia.id);
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo={referencia.nome} aoFechar={aoFechar}>
      <img
        className="ref-imagem-grande"
        src={urlArquivo(referencia.arquivo, 1600)}
        alt={referencia.nome}
      />
      <form onSubmit={salvar}>
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Selecao
          rotulo="Papel"
          valor={papel}
          aoMudar={(valor) => setPapel(comoPapel(valor))}
          opcoes={OPCOES_PAPEL}
        />
        <p className="ref-ajuda">
          Diga o que usar desta imagem: o rosto, a cor do vestido, a fonte do letreiro...
        </p>
        <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={4} />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="ref-modal-acoes">
          <Botao variante="perigo" desabilitado={ocupado} aoClicar={excluir}>
            Excluir
          </Botao>
          <Botao tipo="submit" desabilitado={ocupado}>
            Salvar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

function BlocoReferencias({ projeto, recarregar }: { projeto: ProjetoDetalhe; recarregar: () => void }) {
  const [papel, setPapel] = useState<PapelReferencia>('GERAL');
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState<{ atual: number; total: number } | null>(null);
  const [errosEnvio, setErrosEnvio] = useState<string[]>([]);
  const [editando, setEditando] = useState<Referencia | null>(null);
  const inputArquivos = useRef<HTMLInputElement>(null);

  // Envia um de cada vez; no fim recarrega o projeto.
  async function enviarArquivos(lista: File[]) {
    if (lista.length === 0 || enviando) return;

    const erros: string[] = [];
    const validos: File[] = [];
    for (const arquivo of lista) {
      const problema = erroDoArquivo(arquivo);
      if (problema) erros.push(problema);
      else validos.push(arquivo);
    }
    setErrosEnvio(erros);
    if (validos.length === 0) return;

    for (let i = 0; i < validos.length; i++) {
      const arquivo = validos[i];
      setEnviando({ atual: i + 1, total: validos.length });
      try {
        await enviarReferencia(projeto.id, arquivo, nomeSemExtensao(arquivo.name), papel);
      } catch (err) {
        erros.push(`${arquivo.name}: ${mensagemDeErro(err)}`);
        setErrosEnvio([...erros]);
      }
    }
    setEnviando(null);
    recarregar();
  }

  function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const lista: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    enviarArquivos(lista);
  }

  function aoSoltar(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setArrastando(false);
    enviarArquivos(Array.from(e.dataTransfer.files));
  }

  function aoColar(e: ClipboardEvent<HTMLDivElement>) {
    const lista = Array.from(e.clipboardData.files);
    if (lista.length === 0) return;
    e.preventDefault();
    enviarArquivos(lista);
  }

  return (
    <Cartao titulo="Suas referências">
      <div className="ref-colar" tabIndex={0} onPaste={aoColar}>
        <div className="ref-envio-topo">
          <div className="ref-zona-area">
            <button
              type="button"
              className={arrastando ? 'ref-zona ref-zona-arrastando' : 'ref-zona'}
              onClick={() => inputArquivos.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={aoSoltar}
            >
              <Icone nome="imagem" tamanho={28} />
              <span className="ref-zona-titulo">Arraste as imagens para cá</span>
              <span>ou clique para escolher. Também dá para colar com Ctrl+V.</span>
            </button>
          </div>
          <div className="ref-envio-papel">
            <Selecao
              rotulo="Papel"
              valor={papel}
              aoMudar={(valor) => setPapel(comoPapel(valor))}
              opcoes={OPCOES_PAPEL}
            />
          </div>
        </div>
        <input
          ref={inputArquivos}
          type="file"
          multiple
          accept={TIPOS_DE_IMAGEM_ACEITOS}
          hidden
          onChange={aoEscolher}
        />
        <p className="ref-ajuda">Ao enviar uma referência, os agentes revisam o mapa sozinhos.</p>
        {enviando && (
          <p className="ref-progresso" role="status">
            {`Enviando ${enviando.atual} de ${enviando.total}...`}
          </p>
        )}
        {errosEnvio.length > 0 && (
          <Aviso tipo="erro">
            <ul className="ref-erros">
              {errosEnvio.map((texto, i) => (
                <li key={`${i}-${texto}`}>{texto}</li>
              ))}
            </ul>
          </Aviso>
        )}
      </div>

      {projeto.referencias.length === 0 ? (
        <p className="ref-vazio">Nenhuma referência enviada.</p>
      ) : (
        <div className="ref-grade">
          {projeto.referencias.map((referencia) => {
            const partes = projeto.vinculos.filter((v) => v.referenciaId === referencia.id).length;
            return (
              <article key={referencia.id} className="ref-cartao">
                <button
                  type="button"
                  className="ref-cartao-miniatura"
                  aria-label={`Abrir ${referencia.nome}`}
                  onClick={() => setEditando(referencia)}
                >
                  <img src={urlArquivo(referencia.arquivo, 400)} alt="" />
                </button>
                <div className="ref-cartao-corpo">
                  <strong className="ref-cartao-nome">{referencia.nome}</strong>
                  <span>
                    <Selo>{ROTULO_PAPEL[referencia.papel]}</Selo>
                  </span>
                  <span className="ref-cartao-meta">
                    {`ligada a ${partes} ${partes === 1 ? 'parte' : 'partes'}`}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editando && (
        <EditarReferencia
          key={editando.id}
          referencia={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            recarregar();
          }}
        />
      )}
    </Cartao>
  );
}

// ---------- Etapa ----------

export function EtapaReferencias(props: PropsEtapa) {
  const { projeto, recarregar, regiaoSelecionada, aoSelecionarRegiao, irPara } = props;

  return (
    <div className="ref-etapa">
      <BlocoPedidos projeto={projeto} recarregar={recarregar} aoSelecionarRegiao={aoSelecionarRegiao} />
      <BlocoReferencias projeto={projeto} recarregar={recarregar} />
      <Cartao titulo="Mapa de referências">
        <MapaElementos projeto={projeto} aoAtualizar={props.aoAtualizar} recarregar={recarregar} />
      </Cartao>
      <div className="ref-rodape">
        <Botao variante="secundario" aoClicar={() => irPara('analise')}>
          Voltar para análise
        </Botao>
        <Botao aoClicar={() => irPara('reconstrucao')}>Ir para reconstrução</Botao>
      </div>
    </div>
  );
}
