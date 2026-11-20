import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, Selo, formatarDataHora } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { useDados } from '../../lib/useDados';
import { useTema } from '../../lib/tema';
import type { PreferenciaTema } from '../../lib/tema';
import type { StatusAgentes, StatusCanva } from '../../lib/tipos';
import './configuracoes.css';

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// ---------- Canva ----------

function CartaoCanva() {
  const [params, setParams] = useSearchParams();
  const retorno = params.get('canva');
  const [avisoRetorno, setAvisoRetorno] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const status = useDados<StatusCanva>('/canva/status');
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  // Mostra o resultado do retorno do Canva e limpa o parâmetro da URL (o aviso continua na tela).
  useEffect(() => {
    if (retorno !== 'ok' && retorno !== 'erro') return;
    setAvisoRetorno(
      retorno === 'ok'
        ? { tipo: 'sucesso', texto: 'Canva conectado.' }
        : { tipo: 'erro', texto: 'Não foi possível conectar ao Canva. Tente de novo.' },
    );
    const proximo = new URLSearchParams(params);
    proximo.delete('canva');
    setParams(proximo, { replace: true });
  }, [retorno, params, setParams]);

  async function conectar(): Promise<void> {
    setAbrindo(true);
    setErro(null);
    try {
      const resposta = await api.post<{ url: string }>('/canva/conectar');
      window.location.assign(resposta.url);
    } catch (e) {
      setErro(mensagemDe(e));
      setAbrindo(false);
    }
  }

  async function desconectar(): Promise<void> {
    setDesconectando(true);
    setErro(null);
    try {
      await api.del('/canva/conexao');
      setConfirmarDesconexao(false);
      status.recarregar();
    } catch (e) {
      setErro(mensagemDe(e));
      setConfirmarDesconexao(false);
    } finally {
      setDesconectando(false);
    }
  }

  const conectado = status.dados?.conectado === true;

  return (
    <Cartao titulo="Canva">
      {avisoRetorno && <Aviso tipo={avisoRetorno.tipo}>{avisoRetorno.texto}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {status.erro && <Aviso tipo="erro">{status.erro}</Aviso>}
      {status.carregando && !status.dados && !status.erro && <Carregando />}

      <p>
        O Restaura usa a sua conta do Canva para gerar as partes que faltam nas imagens, guiado pelas referências.
      </p>

      {status.dados && (
        <div className="config-linha">
          {conectado ? <Selo cor="verde">Conectado</Selo> : <Selo cor="cinza">Não conectado</Selo>}
          {conectado ? (
            <Botao variante="secundario" aoClicar={() => setConfirmarDesconexao(true)}>
              Desconectar
            </Botao>
          ) : (
            <Botao desabilitado={abrindo} aoClicar={() => void conectar()}>
              {abrindo ? 'Abrindo o Canva...' : 'Conectar ao Canva'}
            </Botao>
          )}
        </div>
      )}

      <Modal
        aberto={confirmarDesconexao}
        titulo="Desconectar do Canva"
        aoFechar={() => setConfirmarDesconexao(false)}
      >
        <p>Desconectar a sua conta do Canva? Você pode conectar de novo depois.</p>
        <div className="config-acoes">
          <Botao variante="perigo" desabilitado={desconectando} aoClicar={() => void desconectar()}>
            Desconectar
          </Botao>
          <Botao variante="secundario" aoClicar={() => setConfirmarDesconexao(false)}>
            Cancelar
          </Botao>
        </div>
      </Modal>
    </Cartao>
  );
}

// ---------- Equipe de agentes ----------

// Conteúdo do arquivo agentes/.mcp.json para a ligação MCP.
function conteudoMcp(url: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { restaura: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

function BlocoConexaoMcp() {
  const { dados, erro, carregando } = useDados<{ url: string; token: string }>('/agentes/conexao');
  const [mostrarToken, setMostrarToken] = useState(false);
  const [copiado, setCopiado] = useState<'token' | 'arquivo' | null>(null);
  const [erroCopia, setErroCopia] = useState<string | null>(null);

  // "Copiado" some depois de 2 s.
  useEffect(() => {
    if (copiado === null) return;
    const id = window.setTimeout(() => setCopiado(null), 2000);
    return () => window.clearTimeout(id);
  }, [copiado]);

  async function copiar(texto: string, qual: 'token' | 'arquivo'): Promise<void> {
    setErroCopia(null);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
    } catch {
      setErroCopia('Não foi possível copiar.');
    }
  }

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (carregando && !dados) return <Carregando />;
  if (!dados) return null;

  return (
    <section className="config-mcp">
      <h3>Conexão MCP</h3>
      {erroCopia && <Aviso tipo="erro">{erroCopia}</Aviso>}

      <div className="config-mcp-dados">
        <div className="config-campo-leitura">
          <span className="config-rotulo">Endereço (url)</span>
          <code>{dados.url}</code>
        </div>
        <div className="config-campo-leitura">
          <span className="config-rotulo">Token</span>
          <code>{mostrarToken ? dados.token : '•'.repeat(24)}</code>
          <div className="config-acoes-curtas">
            <Botao variante="texto" aoClicar={() => setMostrarToken((v) => !v)}>
              {mostrarToken ? 'Esconder' : 'Mostrar'}
            </Botao>
            <Botao variante="texto" aoClicar={() => void copiar(dados.token, 'token')}>
              {copiado === 'token' ? 'Copiado' : 'Copiar'}
            </Botao>
          </div>
        </div>
      </div>

      <p>O instalador já grava este arquivo. Use os dados abaixo só se precisar refazer a ligação.</p>
      <pre className="config-pre">
        {conteudoMcp(dados.url, mostrarToken ? dados.token : 'COLE_AQUI_O_TOKEN_DOS_AGENTES')}
      </pre>
      <div className="config-acoes">
        <Botao
          variante="secundario"
          aoClicar={() => void copiar(conteudoMcp(dados.url, dados.token), 'arquivo')}
        >
          {copiado === 'arquivo' ? 'Copiado' : 'Copiar arquivo'}
        </Botao>
      </div>
    </section>
  );
}

function CartaoAgentes() {
  const { usuario } = useAuth();
  const { dados, carregando, erro, recarregar } = useDados<StatusAgentes>('/agentes/status');

  // Atualiza o estado da equipe a cada 5 s.
  useEffect(() => {
    const id = window.setInterval(recarregar, 5000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  return (
    <Cartao titulo="Equipe de agentes">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && !erro && <Carregando />}

      {dados && (
        <>
          <div className="config-linha">
            {dados.conectado ? (
              <Selo cor="verde">Conectada</Selo>
            ) : (
              <Selo cor="amarelo">Aguardando sessão do Claude Code</Selo>
            )}
          </div>
          <ul className="config-contagem">
            <li>Último contato: {dados.ultimoContato ? formatarDataHora(dados.ultimoContato) : 'nunca'}</li>
            <li>Na fila: {dados.naFila}</li>
            <li>Em andamento: {dados.emAndamento}</li>
          </ul>
        </>
      )}

      <h3>Como ligar a equipe</h3>
      <ol className="config-passos">
        <li>
          Abra o Claude Code e escolha a pasta <code>agentes</code> que fica dentro da pasta do Restaura.
        </li>
        <li>Na primeira vez, aceite o servidor MCP <code>restaura</code> quando o Claude Code perguntar.</li>
        <li>
          Abra a imagem em Imagens, vá na aba <strong>Equipe ao vivo</strong> e copie o comando de conexão
          (<code>/restaurar</code> seguido do número da imagem).
        </li>
        <li>
          Digite o comando no Claude Code e deixe a sessão aberta. A sessão trabalha naquela imagem; para outra
          imagem, abra outra sessão ou rode o comando com o outro número.
        </li>
      </ol>

      {usuario?.perfil === 'ADMIN' && <BlocoConexaoMcp />}
    </Cartao>
  );
}

// ---------- Aparência ----------

const OPCOES_TEMA: { valor: PreferenciaTema; rotulo: string }[] = [
  { valor: 'claro', rotulo: 'Claro' },
  { valor: 'escuro', rotulo: 'Escuro' },
  { valor: 'sistema', rotulo: 'Seguir o aparelho' },
];

function CartaoAparencia() {
  const { preferencia, definir } = useTema();

  return (
    <Cartao titulo="Aparência">
      <div className="config-temas">
        {OPCOES_TEMA.map((o) => {
          const ativo = preferencia === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              className={ativo ? 'config-tema config-tema-ativo' : 'config-tema'}
              aria-pressed={ativo}
              onClick={() => definir(o.valor)}
            >
              {o.rotulo}
            </button>
          );
        })}
      </div>
    </Cartao>
  );
}

// ---------- Página ----------

function Configuracoes() {
  return (
    <Pagina titulo="Configurações">
      <CartaoCanva />
      <CartaoAgentes />
      <CartaoAparencia />
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/configuracoes`,
    rotulo: 'Configurações',
    icone: 'engrenagem',
    perfis: TODOS_OS_PERFIS,
    elemento: <Configuracoes />,
    ordem: 80,
  },
];
