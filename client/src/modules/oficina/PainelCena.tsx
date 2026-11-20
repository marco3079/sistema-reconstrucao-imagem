import { Suspense, lazy, useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { urlArquivo } from '../../lib/arquivos';
import type { ProjetoDetalhe } from '../../lib/tipos';
import type { RespostaCena, TipoVolume } from '../../lib/tiposCena';
import { Aviso, Botao, Selo } from '../../ui';
import type { VistaCena } from './Cena3D';
import './cena.css';

// Three.js (e o Cena3D) só entram no navegador quando a seção do mapa 3D é aberta.
const Cena3D = lazy(() => import('./Cena3D').then((modulo) => ({ default: modulo.Cena3D })));

interface PropsPainelCena {
  projeto: ProjetoDetalhe;
  podeRefazer: boolean;
}

type AbaCena = 'vista' | 'volumes' | 'profundidade';

const INTERVALO_REBUSCA_MS = 5000;
const MAXIMO_INSTRUCOES = 1000;

const ABAS: { valor: AbaCena; rotulo: string }[] = [
  { valor: 'vista', rotulo: 'Vista 3D' },
  { valor: 'volumes', rotulo: 'Volumes sobre a foto' },
  { valor: 'profundidade', rotulo: 'Profundidade' },
];

const VISTAS: { valor: VistaCena; rotulo: string }[] = [
  { valor: 'livre', rotulo: 'Livre' },
  { valor: 'camera', rotulo: 'Vista da câmera' },
  { valor: 'cima', rotulo: 'De cima' },
  { valor: 'lado', rotulo: 'De lado' },
];

const ROTULO_TIPO: Record<TipoVolume, string> = {
  PESSOA: 'Pessoa',
  OBJETO: 'Objeto',
  PAREDE: 'Parede',
  OUTRO: 'Outro',
};

const ROTULO_ORIGEM_FOCO: Record<'PONTOS_DE_FUGA' | 'ESTIMADO' | 'PADRAO', string> = {
  PONTOS_DE_FUGA: 'pelos pontos de fuga',
  ESTIMADO: 'estimado pelo cenógrafo',
  PADRAO: 'valor padrão',
};

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado.';
}

// Mantém a mesma referência de cena quando a nova resposta traz a mesma cena (a rebusca de 5 s não
// deve reconstruir o visualizador 3D nem reposicionar a vista). Só refazendo e resumo são trocados.
function manterCenaEstavel(anterior: RespostaCena | null, nova: RespostaCena): RespostaCena {
  if (!anterior || !anterior.cena || !nova.cena) return nova;
  const a = anterior.cena;
  const b = nova.cena;
  const mesmaCena =
    a.atualizadaEm === b.atualizadaEm &&
    (a.blender?.feitoEm ?? null) === (b.blender?.feitoEm ?? null) &&
    (a.blender?.previaArquivo ?? null) === (b.blender?.previaArquivo ?? null) &&
    (a.blender?.profundidadeArquivo ?? null) === (b.blender?.profundidadeArquivo ?? null) &&
    (a.blender?.glbArquivo ?? null) === (b.blender?.glbArquivo ?? null);
  if (!mesmaCena) return nova;
  return { ...anterior, refazendo: nova.refazendo, resumo: nova.resumo };
}

// Metros com uma casa decimal e vírgula, no formato brasileiro: "3,2 m".
function formatarMetros(valor: number): string {
  return `${valor.toFixed(1).replace('.', ',')} m`;
}

// O resumo do servidor pode trazer " Avisos: ..." no fim; os avisos são mostrados só na lista.
function resumoSemAvisos(resumo: string): string {
  const i = resumo.indexOf(' Avisos:');
  return (i >= 0 ? resumo.slice(0, i) : resumo).trim();
}

// Nome de arquivo seguro para o download.
function nomeSeguro(nome: string): string {
  return nome.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'projeto';
}

// Descreve a inclinação da câmera: positivo = olhando para cima.
function descreverInclinacao(graus: number): string {
  const arredondado = Math.round(graus);
  if (arredondado === 0) return 'câmera reta';
  const sentido = arredondado > 0 ? 'para cima' : 'para baixo';
  return `inclinação de ${Math.abs(arredondado)}° ${sentido}`;
}

// Pedido de refazer (ou de gerar o mapa 3D, quando ainda não existe).
function PedidoRefazer({
  projetoId,
  podeRefazer,
  refazendo,
  rotuloBotao,
  rotuloCampo,
  exemplo,
  aoEnviado,
}: {
  projetoId: number;
  podeRefazer: boolean;
  refazendo: boolean;
  rotuloBotao: string;
  rotuloCampo: string;
  exemplo: string;
  aoEnviado: () => void;
}) {
  const idCampo = useId();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  if (!refazendo && !podeRefazer) return null;

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setErroEnvio(null);
    try {
      const instrucoes = texto.trim();
      await api.post(`/projetos/${projetoId}/cena/refazer`, instrucoes ? { instrucoes } : {});
      setAberto(false);
      setTexto('');
      aoEnviado();
    } catch (erro) {
      setErroEnvio(mensagem(erro));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="cena-refazer">
      {refazendo && <Selo cor="azul">A equipe está refazendo o mapa 3D</Selo>}
      {aberto && !refazendo ? (
        <form className="cena-form" onSubmit={enviar}>
          <label className="cena-rotulo" htmlFor={idCampo}>
            {rotuloCampo}
          </label>
          <textarea
            id={idCampo}
            className="cena-campo"
            rows={3}
            maxLength={MAXIMO_INSTRUCOES}
            placeholder={exemplo}
            value={texto}
            disabled={enviando}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="cena-form-acoes">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Enviando...' : 'Enviar pedido'}
            </Botao>
            <Botao variante="texto" desabilitado={enviando} aoClicar={() => setAberto(false)}>
              Cancelar
            </Botao>
          </div>
          {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
        </form>
      ) : (
        <>
          <Botao variante="secundario" desabilitado={refazendo} aoClicar={() => setAberto(true)}>
            {rotuloBotao}
          </Botao>
          {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
        </>
      )}
    </div>
  );
}

export function PainelCena({ projeto, podeRefazer }: PropsPainelCena) {
  const projetoId = projeto.id;
  const [dados, setDados] = useState<RespostaCena | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaCena>('vista');
  const [vista, setVista] = useState<VistaCena>('livre');
  const [volumeEmFoco, setVolumeEmFoco] = useState<number | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroGlb, setErroGlb] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      const resposta = await api.get<RespostaCena>(`/projetos/${projetoId}/cena`);
      setDados((anterior) => manterCenaEstavel(anterior, resposta));
      setErro(null);
    } catch (e) {
      setErro(mensagem(e));
    }
  }, [projetoId]);

  // Troca de projeto: zera o que era do projeto anterior.
  useEffect(() => {
    setDados(null);
    setErro(null);
    setVolumeEmFoco(null);
    setAba('vista');
    setVista('livre');
  }, [projetoId]);

  // Busca ao abrir e quando o projeto passa a ter (ou perde) o mapa 3D.
  useEffect(() => {
    void buscar();
  }, [buscar, projeto.temCena]);

  const cena = dados?.cena ?? null;
  const atualizadaEm = cena?.atualizadaEm ?? null;

  // Cena nova: o foco antigo não vale mais (os índices mudaram).
  useEffect(() => {
    setVolumeEmFoco(null);
  }, [atualizadaEm]);

  // Enquanto a equipe refaz o mapa, ou não há mapa, rebusca a cada 5 s.
  const girando = dados !== null && (dados.refazendo || dados.cena === null);
  useEffect(() => {
    if (!girando) return;
    const id = window.setInterval(() => {
      void buscar();
    }, INTERVALO_REBUSCA_MS);
    return () => window.clearInterval(id);
  }, [girando, buscar]);

  if (!dados) {
    return (
      <section className="cartao cena-painel" aria-labelledby="cena-titulo">
        <h2 id="cena-titulo" className="cartao-titulo">
          Mapa 3D
        </h2>
        {erro ? (
          <>
            <Aviso tipo="erro">Não foi possível carregar o mapa 3D.</Aviso>
            <p className="cena-ajuda">{erro}</p>
            <Botao
              variante="secundario"
              aoClicar={() => {
                setErro(null);
                void buscar();
              }}
            >
              Tentar de novo
            </Botao>
          </>
        ) : (
          <p className="cena-estado" role="status">
            Carregando o mapa 3D...
          </p>
        )}
      </section>
    );
  }

  if (!cena) {
    return (
      <section className="cartao cena-painel" aria-labelledby="cena-titulo">
        <h2 id="cena-titulo" className="cartao-titulo">
          Mapa 3D
        </h2>
        <p className="cena-texto">
          A equipe ainda não montou o mapa 3D desta foto. Ele mostra a câmera, o horizonte e a posição de cada pessoa e
          objeto.
        </p>
        <PedidoRefazer
          projetoId={projetoId}
          podeRefazer={podeRefazer}
          refazendo={dados.refazendo}
          rotuloBotao="Pedir o mapa 3D"
          rotuloCampo="Alguma instrução para a equipe? (opcional)"
          exemplo="Ex.: a câmera está na altura dos olhos"
          aoEnviado={() => {
            void buscar();
          }}
        />
      </section>
    );
  }

  const resolvida = cena.resolvida;
  const temBlender = cena.blender !== null;
  const abaEfetiva: AbaCena = temBlender ? aba : 'vista';
  const arquivoDaAba =
    cena.blender === null
      ? null
      : abaEfetiva === 'volumes'
        ? cena.blender.previaArquivo
        : abaEfetiva === 'profundidade'
          ? cena.blender.profundidadeArquivo
          : null;

  // Lista do mais próximo ao mais distante; o índice aponta para resolvida.volumes.
  const ordenados = resolvida.volumes
    .map((volume, indice) => ({ volume, indice }))
    .sort((a, b) => a.volume.distancia - b.volume.distancia);

  async function baixarGlb() {
    if (!cena || cena.blender === null) return;
    setBaixando(true);
    setErroGlb(null);
    try {
      await api.baixar(`/projetos/${projetoId}/cena/glb`, `${nomeSeguro(projeto.nome)}-mapa-3d.glb`);
    } catch (e) {
      setErroGlb(mensagem(e));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <section className="cartao cena-painel" aria-labelledby="cena-titulo">
      <h2 id="cena-titulo" className="cartao-titulo">
        Mapa 3D da foto
      </h2>
      {dados.resumo && <p className="cena-resumo">{resumoSemAvisos(dados.resumo)}</p>}
      {resolvida.avisos.length > 0 && (
        <ul className="cena-avisos">
          {resolvida.avisos.map((aviso, i) => (
            <li key={i}>{aviso}</li>
          ))}
        </ul>
      )}

      <div className="cena-corpo">
        <div className="cena-visual">
          {temBlender && (
            <div className="cena-grupo-botoes" role="group" aria-label="Como ver o mapa">
              {ABAS.map((a) => (
                <button
                  key={a.valor}
                  type="button"
                  className="cena-botao"
                  aria-pressed={abaEfetiva === a.valor}
                  onClick={() => setAba(a.valor)}
                >
                  {a.rotulo}
                </button>
              ))}
            </div>
          )}

          {abaEfetiva === 'vista' ? (
            <>
              <div className="cena-grupo-botoes" role="group" aria-label="Vista do mapa">
                {VISTAS.map((v) => (
                  <button
                    key={v.valor}
                    type="button"
                    className="cena-botao"
                    aria-pressed={vista === v.valor}
                    onClick={() => setVista(v.valor)}
                  >
                    {v.rotulo}
                  </button>
                ))}
              </div>
              <Suspense fallback={<p className="cena-estado" role="status">Carregando o mapa 3D...</p>}>
                <Cena3D
                  cena={resolvida}
                  urlDaFoto={projeto.atualArquivo ? urlArquivo(projeto.atualArquivo) : null}
                  volumeEmFoco={volumeEmFoco}
                  aoFocarVolume={setVolumeEmFoco}
                  vista={vista}
                />
              </Suspense>
            </>
          ) : (
            <figure className="cena-imagem">
              <img
                src={urlArquivo(arquivoDaAba)}
                alt={abaEfetiva === 'volumes' ? 'Foto com os volumes do mapa 3D por cima' : 'Mapa de profundidade da foto'}
                loading="lazy"
              />
              {abaEfetiva === 'profundidade' && <figcaption className="cena-legenda">Branco = perto, preto = longe</figcaption>}
            </figure>
          )}

          <p className="cena-camera">
            Câmera a {formatarMetros(resolvida.camera.altura)} do chão · campo de visão vertical de{' '}
            {Math.round(resolvida.camera.fovVertical)}° · {descreverInclinacao(resolvida.camera.inclinacao)} · origem do
            foco: {ROTULO_ORIGEM_FOCO[resolvida.camera.origemFoco]}
          </p>

          {temBlender ? (
            <div className="cena-acoes">
              <Botao variante="secundario" desabilitado={baixando} aoClicar={baixarGlb}>
                Baixar .glb
              </Botao>
              {erroGlb && <Aviso tipo="erro">{erroGlb}</Aviso>}
            </div>
          ) : (
            <Aviso tipo="info">O mapa de profundidade do Blender ainda não foi gerado. A posição dos volumes já vale.</Aviso>
          )}
        </div>

        <aside className="cena-volumes" aria-label="Volumes da cena">
          <h3 className="cena-subtitulo">Volumes, do mais próximo ao mais distante</h3>
          {ordenados.length === 0 ? (
            <p className="cena-texto">Nenhum volume foi marcado nesta foto.</p>
          ) : (
            <ul className="cena-lista">
              {ordenados.map(({ volume, indice }) => {
                const emFoco = volumeEmFoco === indice;
                return (
                  <li key={indice}>
                    <button
                      type="button"
                      className={emFoco ? 'cena-volume cena-volume-ativo' : 'cena-volume'}
                      aria-pressed={emFoco}
                      onClick={() => setVolumeEmFoco(indice)}
                    >
                      <span className="cena-volume-nome">{volume.nome}</span>
                      <span className="cena-volume-meta">
                        <span className={`cena-bolinha cena-bolinha-${volume.tipo.toLowerCase()}`} aria-hidden="true" />
                        {ROTULO_TIPO[volume.tipo]} · {formatarMetros(volume.distancia)} de distância · altura{' '}
                        {formatarMetros(volume.tamanho.z)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      <PedidoRefazer
        projetoId={projetoId}
        podeRefazer={podeRefazer}
        refazendo={dados.refazendo}
        rotuloBotao="Pedir para refazer"
        rotuloCampo="O que está errado? (opcional)"
        exemplo="Ex.: a mesa está mais perto que a pessoa"
        aoEnviado={() => {
          void buscar();
        }}
      />
    </section>
  );
}
