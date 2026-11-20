import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { LOGO, PLATAFORMA } from '../lib/plataforma';
import { RAIZ } from '../lib/rotas';
import { Aviso, Botao, Campo } from '../ui';
import { Icone } from '../ui/icones';
import { BotaoTema } from './Layout';
import './login.css';

export function Login() {
  const { usuario, entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={RAIZ} replace />;

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
      setEnviando(false);
    }
  }

  return (
    <main className="entrada">
      <div className="entrada-tema">
        <BotaoTema />
      </div>
      <aside className="entrada-marca">
        <div className="entrada-marca-topo">
          <img src={LOGO} alt="" className="entrada-logo" width={56} height={56} />
          <span className="entrada-marca-nome">{PLATAFORMA.nome}</span>
        </div>

        <div className="entrada-marca-meio">
          <h2 className="entrada-frase">{PLATAFORMA.slogan}</h2>
          <p className="entrada-marca-apoio">Reconstrução de imagens por partes, do diagnóstico ao resultado.</p>
          <ul className="entrada-destaques">
            <li>
              <Icone nome="busca" tamanho={20} />
              <span>Análise do que falta e do que está danificado</span>
            </li>
            <li>
              <Icone nome="imagem" tamanho={20} />
              <span>Mapa de referências para guiar cada parte</span>
            </li>
            <li>
              <Icone nome="grupo" tamanho={20} />
              <span>Equipe de agentes com revisor, e você escolhe as opções</span>
            </li>
          </ul>
        </div>
      </aside>

      <section className="entrada-formulario">
        <form className="entrada-cartao" onSubmit={enviar}>
          <div className="entrada-cartao-marca">
            <img src={LOGO} alt="" className="entrada-logo" width={56} height={56} />
            <span>{PLATAFORMA.nome}</span>
          </div>
          <h1 className="entrada-titulo">Entrar</h1>
          <p className="entrada-apoio">Use seu e-mail e sua senha.</p>
          <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
          <Campo rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="entrada-botao">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Entrando...' : 'Entrar'}
            </Botao>
          </div>
        </form>
      </section>
    </main>
  );
}
