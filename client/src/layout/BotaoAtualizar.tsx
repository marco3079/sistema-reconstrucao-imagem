import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { RAIZ } from '../lib/rotas';
import type { AtualizacaoDTO } from '../modules/atualizacao/Atualizacao';
import '../modules/atualizacao/atualizacao.css';
import { Icone } from '../ui/icones';

const INTERVALO_MS = 30 * 60 * 1000;

// Botão redondo do topo: aparece só para administrador e só quando há versão nova do sistema.
// Não abre diálogo nem pega o foco ao montar (o popup "Sua vez" fica por conta do AvisoSuaVez).
export function BotaoAtualizar() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const admin = usuario?.perfil === 'ADMIN';
  const [dados, setDados] = useState<AtualizacaoDTO | null>(null);

  useEffect(() => {
    if (!admin) {
      setDados(null);
      return;
    }
    let ativo = true;
    function consultar() {
      api
        .get<AtualizacaoDTO>('/atualizacao')
        .then((d) => {
          if (ativo) setDados(d);
        })
        .catch(() => undefined);
    }
    consultar();
    const intervalo = window.setInterval(consultar, INTERVALO_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [admin]);

  if (!admin || !dados || !dados.haNovidade) return null;

  return (
    <button
      type="button"
      className="casca-botao-redondo atu-botao-topo"
      aria-label="Há uma versão nova do sistema"
      title="Há uma versão nova do sistema"
      onClick={() => navigate(`${RAIZ}/atualizacao`)}
    >
      <Icone nome="seta-baixo" tamanho={22} />
      <span className="atu-ponto" aria-hidden="true" />
    </button>
  );
}
