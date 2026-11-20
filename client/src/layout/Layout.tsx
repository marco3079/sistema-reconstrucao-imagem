import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { LOGO, PLATAFORMA } from '../lib/plataforma';
import { RAIZ } from '../lib/rotas';
import type { RotaModulo } from '../lib/rotas';
import { useTema } from '../lib/tema';
import { Icone } from '../ui/icones';
import { AvisoSuaVez } from './AvisoSuaVez';
import { BotaoAtualizar } from './BotaoAtualizar';
import { Busca } from './Busca';
import { agrupar } from './grupos';
import { MenuUsuario } from './MenuUsuario';
import './casca.css';

const CONSULTA_CELULAR = '(max-width: 899px)';
const PORTAL = 'Reconstrução de imagens';

// true abaixo de 900 px. Desktop e celular têm marcação diferente, então a escolha é feita em JS.
function useTelaEstreita(): boolean {
  const [estreita, setEstreita] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(CONSULTA_CELULAR).matches : false,
  );

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_CELULAR);
    const trocou = () => setEstreita(consulta.matches);
    consulta.addEventListener('change', trocou);
    return () => consulta.removeEventListener('change', trocou);
  }, []);

  return estreita;
}

// Botão redondo que alterna claro e escuro. Também usado na tela de login.
export function BotaoTema() {
  const { temaEfetivo, alternar } = useTema();
  const destino = temaEfetivo === 'escuro' ? 'claro' : 'escuro';
  const rotulo = `Mudar para o tema ${destino}`;
  return (
    <button type="button" className="casca-botao-redondo" aria-label={rotulo} title={rotulo} onClick={() => alternar()}>
      <Icone nome={temaEfetivo === 'escuro' ? 'sol' : 'lua'} tamanho={20} />
    </button>
  );
}

export function Layout({ menu }: { menu: RotaModulo[] }) {
  const { usuario, sair } = useAuth();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const estreita = useTelaEstreita();
  const local = useLocation();

  useEffect(() => {
    setGavetaAberta(false);
  }, [local.pathname]);

  useEffect(() => {
    if (!gavetaAberta) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setGavetaAberta(false);
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [gavetaAberta]);

  if (!usuario) return null;

  const grupos = agrupar(menu);
  const principais = menu.slice(0, 4);

  // Item só fica ativo no caminho exato quando outro item do menu começa pelo mesmo caminho.
  function exato(r: RotaModulo): boolean {
    return r.caminho === RAIZ || menu.some((o) => o !== r && o.caminho.startsWith(r.caminho + "/"));
  }

  function itemMenu(r: RotaModulo) {
    return (
      <NavLink
        key={r.caminho}
        to={r.caminho}
        end={exato(r)}
        className={({ isActive }) => (isActive ? 'casca-item casca-ativo' : 'casca-item')}
      >
        <Icone nome={r.icone} tamanho={20} className="casca-item-icone" />
        <span className="casca-item-rotulo">{r.rotulo}</span>
      </NavLink>
    );
  }

  function secoes() {
    return grupos.map((g) => (
      <div className="casca-grupo" key={g.titulo || 'inicio'}>
        {g.titulo && <p className="casca-grupo-titulo">{g.titulo}</p>}
        {g.rotas.map(itemMenu)}
      </div>
    ));
  }

  return (
    <div className={estreita ? 'casca casca-celular' : 'casca casca-desktop'}>
      {!estreita && (
        <aside className="casca-lateral">
          <div className="casca-marca">
            <img src={LOGO} alt="" className="casca-marca-logo" width={40} height={40} />
            <div className="casca-marca-texto">
              <strong className="casca-marca-nome">{PLATAFORMA.nome}</strong>
              <span className="casca-marca-portal">{PORTAL}</span>
            </div>
          </div>

          <nav className="casca-menu" aria-label="Menu principal">
            {secoes()}
          </nav>

          <div className="casca-cartao">
            <p className="casca-cartao-frase">{PLATAFORMA.slogan}</p>
            <div className="casca-cartao-ilustracao" aria-hidden="true" />
          </div>
        </aside>
      )}

      {estreita && (
        <header className="casca-topo-celular">
          <div className="casca-topo-celular-barra">
            <img src={LOGO} alt="" className="casca-topo-celular-logo" width={28} height={28} />
            <span className="casca-topo-celular-nome">{PLATAFORMA.nome}</span>
            <div className="casca-topo-celular-acoes">
              <BotaoAtualizar />
              <BotaoTema />
              <button
                type="button"
                className="casca-botao-redondo"
                aria-label="Abrir menu"
                onClick={() => setGavetaAberta(true)}
              >
                <Icone nome="menu" tamanho={22} />
              </button>
            </div>
          </div>
          <div className="casca-topo-celular-busca">
            <Busca telas={menu} />
          </div>
        </header>
      )}

      <main className="casca-principal">
        <div className="casca-area">
          {!estreita && (
            <header className="casca-topo">
              <Busca telas={menu} />
              <div className="casca-topo-acoes">
                <BotaoAtualizar />
                <BotaoTema />
                <MenuUsuario />
              </div>
            </header>
          )}
          <Outlet />
        </div>
      </main>

      <AvisoSuaVez />

      {estreita && (
        <nav className="casca-inferior" aria-label="Menu rápido">
          {principais.map((r) => (
            <NavLink
              key={r.caminho}
              to={r.caminho}
              end={exato(r)}
              className={({ isActive }) => (isActive ? 'casca-inferior-item casca-ativo' : 'casca-inferior-item')}
            >
              <Icone nome={r.icone} tamanho={22} className="casca-inferior-icone" />
              <span className="casca-inferior-rotulo">{r.rotulo}</span>
            </NavLink>
          ))}
          <button type="button" className="casca-inferior-item" onClick={() => setGavetaAberta(true)}>
            <Icone nome="mais" tamanho={22} className="casca-inferior-icone" />
            <span className="casca-inferior-rotulo">Mais</span>
          </button>
        </nav>
      )}

      {estreita && gavetaAberta && (
        <div className="casca-gaveta-fundo" onClick={() => setGavetaAberta(false)}>
          <div
            className="casca-gaveta"
            role="dialog"
            aria-modal="true"
            aria-label="Menu completo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="casca-gaveta-cabecalho">
              <div className="casca-marca-texto">
                <strong className="casca-marca-nome">{PLATAFORMA.nome}</strong>
                <span className="casca-marca-portal">{PORTAL}</span>
              </div>
              <button
                type="button"
                className="casca-botao-redondo"
                aria-label="Fechar menu"
                onClick={() => setGavetaAberta(false)}
              >
                <Icone nome="fechar" tamanho={20} />
              </button>
            </div>

            <nav className="casca-menu casca-menu-gaveta" aria-label="Menu completo">
              {secoes()}
            </nav>

            <div className="casca-gaveta-rodape">
              <span className="casca-usuario-nome">{usuario.nome}</span>
              <button type="button" className="casca-sair" onClick={sair}>
                <Icone nome="sair" tamanho={18} />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
