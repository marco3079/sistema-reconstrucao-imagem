import { useState } from 'react';
import { Avatar, Aviso, Botao, Caixa, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarData } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { useDados } from '../../lib/useDados';
import type { Perfil, UsuarioLogado } from '../../lib/tipos';
import './conta.css';

interface UsuarioAdmin {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  criadoEm: string;
}

interface Recado {
  tipo: 'erro' | 'sucesso';
  texto: string;
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// ---------- Meu perfil ----------

function CartaoDados() {
  const { usuario, atualizarUsuario } = useAuth();
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<Recado | null>(null);

  async function salvar(): Promise<void> {
    setSalvando(true);
    setRecado(null);
    try {
      const atualizado = await api.put<UsuarioLogado>('/auth/perfil', { nome });
      atualizarUsuario(atualizado);
      setNome(atualizado.nome);
      setRecado({ tipo: 'sucesso', texto: 'Dados salvos.' });
    } catch (e) {
      setRecado({ tipo: 'erro', texto: mensagemDe(e) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Dados">
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <div className="conta-identidade">
        <Avatar nome={usuario?.nome ?? ''} tamanho={56} />
        <div>
          <strong>{usuario?.nome}</strong>
          <span className="conta-suave">{usuario?.email}</span>
        </div>
      </div>
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <label className="campo">
        <span className="campo-rotulo">E-mail</span>
        <input className="campo-controle conta-leitura" type="email" value={usuario?.email ?? ''} readOnly />
      </label>
      <div className="conta-rodape">
        <Botao desabilitado={salvando} aoClicar={() => void salvar()}>
          Salvar
        </Botao>
      </div>
    </Cartao>
  );
}

function CartaoSenha() {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repita, setRepita] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<Recado | null>(null);

  async function trocar(): Promise<void> {
    setRecado(null);
    if (nova.length < 8) {
      setRecado({ tipo: 'erro', texto: 'A nova senha precisa ter 8 ou mais caracteres.' });
      return;
    }
    if (nova !== repita) {
      setRecado({ tipo: 'erro', texto: 'As senhas não conferem.' });
      return;
    }
    setSalvando(true);
    try {
      await api.put('/auth/senha', { atual, nova });
      setAtual('');
      setNova('');
      setRepita('');
      setRecado({ tipo: 'sucesso', texto: 'Senha alterada.' });
    } catch (e) {
      setRecado({ tipo: 'erro', texto: mensagemDe(e) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Senha">
      {recado && <Aviso tipo={recado.tipo}>{recado.texto}</Aviso>}
      <Campo rotulo="Senha atual" tipo="password" valor={atual} aoMudar={setAtual} />
      <Campo rotulo="Nova senha" tipo="password" valor={nova} aoMudar={setNova} />
      <Campo rotulo="Repita a nova senha" tipo="password" valor={repita} aoMudar={setRepita} />
      <div className="conta-rodape">
        <Botao desabilitado={salvando} aoClicar={() => void trocar()}>
          Alterar senha
        </Botao>
      </div>
    </Cartao>
  );
}

function MeuPerfil() {
  return (
    <Pagina titulo="Meu perfil">
      <div className="conta-grade">
        <CartaoDados />
        <CartaoSenha />
      </div>
    </Pagina>
  );
}

// ---------- Usuários (só ADMIN) ----------

interface FormUsuarioProps {
  alvo: UsuarioAdmin | null;
  aoFechar: () => void;
  aoSalvo: () => void;
}

function FormUsuario({ alvo, aoFechar, aoSalvo }: FormUsuarioProps) {
  const edicao = alvo !== null;
  const [nome, setNome] = useState(alvo?.nome ?? '');
  const [email, setEmail] = useState(alvo?.email ?? '');
  const [perfil, setPerfil] = useState<Perfil>(alvo?.perfil ?? 'USUARIO');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(alvo?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(): Promise<void> {
    setSalvando(true);
    setErro(null);
    try {
      if (alvo) {
        const corpo: { nome: string; email: string; perfil: Perfil; ativo: boolean; senha?: string } = {
          nome,
          email,
          perfil,
          ativo,
        };
        if (senha) corpo.senha = senha;
        await api.put<UsuarioAdmin>(`/usuarios/${alvo.id}`, corpo);
      } else {
        await api.post<UsuarioAdmin>('/usuarios', { nome, email, senha, perfil });
      }
      aoSalvo();
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo={edicao ? 'Editar usuário' : 'Novo usuário'} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
      <Selecao
        rotulo="Perfil"
        valor={perfil}
        aoMudar={(v) => setPerfil(v === 'ADMIN' ? 'ADMIN' : 'USUARIO')}
        opcoes={[
          { valor: 'ADMIN', rotulo: 'Administrador' },
          { valor: 'USUARIO', rotulo: 'Usuário' },
        ]}
        obrigatorio
      />
      <Campo
        rotulo={edicao ? 'Nova senha (deixe em branco para manter)' : 'Senha'}
        tipo="password"
        valor={senha}
        aoMudar={setSenha}
        obrigatorio={!edicao}
      />
      {edicao && <Caixa rotulo="Ativo" marcado={ativo} aoMudar={setAtivo} />}
      <div className="conta-rodape">
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
        <Botao desabilitado={salvando} aoClicar={() => void salvar()}>
          Salvar
        </Botao>
      </div>
    </Modal>
  );
}

function Usuarios() {
  const { dados, carregando, erro, recarregar } = useDados<UsuarioAdmin[]>('/usuarios');
  const [formAberto, setFormAberto] = useState(false);
  const [alvo, setAlvo] = useState<UsuarioAdmin | null>(null);
  const [excluindo, setExcluindo] = useState<UsuarioAdmin | null>(null);
  const [excluindoEmAndamento, setExcluindoEmAndamento] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  function abrirNovo(): void {
    setAlvo(null);
    setFormAberto(true);
  }

  function abrirEdicao(usuario: UsuarioAdmin): void {
    setAlvo(usuario);
    setFormAberto(true);
  }

  function abrirExclusao(usuario: UsuarioAdmin): void {
    setErroExclusao(null);
    setExcluindo(usuario);
  }

  async function confirmarExclusao(): Promise<void> {
    if (!excluindo) return;
    setExcluindoEmAndamento(true);
    setErroExclusao(null);
    try {
      await api.del(`/usuarios/${excluindo.id}`);
      setExcluindo(null);
      recarregar();
    } catch (e) {
      setErroExclusao(mensagemDe(e));
    } finally {
      setExcluindoEmAndamento(false);
    }
  }

  const colunas: ColunaTabela<UsuarioAdmin>[] = [
    { titulo: 'Nome', celula: (u) => u.nome },
    { titulo: 'E-mail', celula: (u) => u.email },
    {
      titulo: 'Perfil',
      celula: (u) =>
        u.perfil === 'ADMIN' ? <Selo cor="azul">Administrador</Selo> : <Selo cor="cinza">Usuário</Selo>,
    },
    {
      titulo: 'Situação',
      celula: (u) => (u.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="vermelho">Inativo</Selo>),
    },
    { titulo: 'Criado em', celula: (u) => formatarData(u.criadoEm) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (u) => (
        <span className="conta-acoes-linha">
          <Botao variante="texto" aoClicar={() => abrirEdicao(u)}>
            Editar
          </Botao>
          <Botao variante="texto" aoClicar={() => abrirExclusao(u)}>
            Excluir
          </Botao>
        </span>
      ),
    },
  ];

  return (
    <Pagina titulo="Usuários" acoes={<Botao aoClicar={abrirNovo}>Novo usuário</Botao>}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && !erro && <Carregando />}
      {dados && (
        <Tabela colunas={colunas} dados={dados} chave={(u) => u.id} vazio="Nenhum usuário cadastrado." />
      )}

      {formAberto && (
        <FormUsuario
          alvo={alvo}
          aoFechar={() => setFormAberto(false)}
          aoSalvo={() => {
            setFormAberto(false);
            recarregar();
          }}
        />
      )}

      <Modal aberto={excluindo !== null} titulo="Excluir usuário" aoFechar={() => setExcluindo(null)}>
        {excluindo && (
          <>
            {erroExclusao && <Aviso tipo="erro">{erroExclusao}</Aviso>}
            <p>
              Excluir {excluindo.nome}? As imagens dessa pessoa também são apagadas.
            </p>
            <div className="conta-rodape">
              <Botao variante="secundario" aoClicar={() => setExcluindo(null)}>
                Cancelar
              </Botao>
              <Botao
                variante="perigo"
                desabilitado={excluindoEmAndamento}
                aoClicar={() => void confirmarExclusao()}
              >
                Excluir
              </Botao>
            </div>
          </>
        )}
      </Modal>
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/perfil`,
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: TODOS_OS_PERFIS,
    elemento: <MeuPerfil />,
    ordem: 95,
  },
  {
    caminho: `${RAIZ}/usuarios`,
    rotulo: 'Usuários',
    icone: 'usuarios',
    perfis: ['ADMIN'],
    elemento: <Usuarios />,
    ordem: 85,
  },
];
