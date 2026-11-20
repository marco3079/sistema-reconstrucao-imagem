import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { RAIZ } from '../lib/rotas';
import type { ProjetoResumo, TelaDaOficina } from '../lib/tipos';
import { Botao, Modal } from '../ui';
import { Icone } from '../ui/icones';
import './aviso-sua-vez.css';

const INTERVALO_MS = 8000;
const CHAVE_DISPENSADAS = 'restaura.suavez.dispensadas';
const PREFIXO_CONTADOR = /^\(\d+\) /;

interface Pendencia {
  chave: string;
  projeto: ProjetoResumo;
}

function lerVistas(): string[] {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DISPENSADAS);
    if (!bruto) return [];
    const lista: unknown = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function guardarVistas(lista: string[]): void {
  try {
    sessionStorage.setItem(CHAVE_DISPENSADAS, JSON.stringify(lista));
  } catch {
    // Sem sessionStorage (modo privado, cota cheia): o popup só pode reaparecer.
  }
}

// Pendência = a vez é do usuário e o que ele precisa fazer é aprovar ou escolher.
function pendenciasDe(lista: ProjetoResumo[]): Pendencia[] {
  return lista
    .filter((p) => p.situacao.quem === 'VOCE' && p.situacao.aprovacao === true)
    .map((p) => ({
      chave: `${p.id}:${p.situacao.codigo}:${p.situacao.passo}`,
      projeto: p,
    }));
}

// Há outro diálogo aberto ou o usuário está digitando? Então o popup espera o próximo ciclo.
function ocupado(): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return true;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

// Imagem mais recentemente atualizada primeiro.
function maisRecentesPrimeiro(a: Pendencia, b: Pendencia): number {
  return new Date(b.projeto.atualizadoEm).getTime() - new Date(a.projeto.atualizadoEm).getTime();
}

function telaDaPendencia(p: Pendencia): TelaDaOficina | null {
  return p.projeto.situacao.acao?.tela ?? null;
}

// Já está na tela que resolve a pendência?
function naTelaDaPendencia(p: Pendencia, pathname: string, search: string): boolean {
  const tela = telaDaPendencia(p);
  if (!tela) return false;
  const caminho = pathname.replace(/\/+$/, '');
  return caminho.endsWith(`/projetos/${p.projeto.id}`) && new URLSearchParams(search).get('etapa') === tela;
}

// Popup "Sua vez": avisa quando uma imagem espera uma aprovação ou escolha do usuário.
export function AvisoSuaVez() {
  const local = useLocation();
  const navegar = useNavigate();
  // null = ainda não houve uma busca bem-sucedida.
  const [lista, setLista] = useState<Pendencia[] | null>(null);
  const pendencias = lista ?? [];
  const [vistas, setVistas] = useState<string[]>(lerVistas);
  const [aberta, setAberta] = useState<Pendencia | null>(null);

  const buscar = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const lista = await api.get<ProjetoResumo[]>('/projetos');
      setLista(pendenciasDe(lista));
    } catch {
      // Erros são ignorados: a próxima tentativa acontece em 8 s.
    }
  }, []);

  // Busca ao montar, a cada 8 s, e na hora quando a aba volta a ficar visível.
  useEffect(() => {
    buscar();
    const intervalo = window.setInterval(buscar, INTERVALO_MS);
    function aoMudarVisibilidade() {
      if (document.visibilityState === 'visible') buscar();
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [buscar]);

  // Guarda as chaves já vistas ou dispensadas.
  useEffect(() => {
    guardarVistas(vistas);
  }, [vistas]);

  // Pendência que sai da lista (resolvida) perde a chave: se voltar depois, abre de novo.
  useEffect(() => {
    if (!lista) return;
    const atuais = new Set(lista.map((p) => p.chave));
    setVistas((v) => {
      const nova = v.filter((c) => atuais.has(c));
      return nova.length === v.length ? v : nova;
    });
  }, [lista]);

  // Escolhe a próxima pendência ainda não vista e abre o popup (um de cada vez).
  useEffect(() => {
    if (aberta || ocupado()) return;
    const novas = pendencias
      .filter((p) => !vistas.includes(p.chave))
      .sort(maisRecentesPrimeiro);
    const proxima = novas[0];
    if (!proxima) return;
    if (naTelaDaPendencia(proxima, local.pathname, local.search)) {
      setVistas((v) => (v.includes(proxima.chave) ? v : [...v, proxima.chave]));
      return;
    }
    setAberta(proxima);
  }, [pendencias, vistas, aberta, local.pathname, local.search]);

  // Prefixo "(N) " no título da aba enquanto houver pendências.
  const quantidade = pendencias.length;
  useEffect(() => {
    const base = document.title.replace(PREFIXO_CONTADOR, '');
    document.title = quantidade > 0 ? `(${quantidade}) ${base}` : base;
    return () => {
      document.title = document.title.replace(PREFIXO_CONTADOR, '');
    };
  }, [quantidade, local.pathname]);

  // Fechar (Depois, ×, fundo, ver a tela): conta só a pendência aberta como vista.
  function dispensar() {
    if (aberta) {
      const chave = aberta.chave;
      setVistas((v) => (v.includes(chave) ? v : [...v, chave]));
    }
    setAberta(null);
  }

  const outras = pendencias.length - 1;
  const tela = aberta ? telaDaPendencia(aberta) : null;
  const projeto = aberta?.projeto;

  return (
    <Modal aberto={aberta !== null} titulo="Sua vez de decidir" aoFechar={dispensar}>
      {aberta && projeto && (
        <div className="suavez">
          <div className="suavez-cabecalho">
            <Icone nome="sino" tamanho={20} />
            <strong className="suavez-imagem">{projeto.nome}</strong>
          </div>
          <p className="suavez-passo">{`Passo ${projeto.situacao.passo} de ${projeto.situacao.total}: ${projeto.situacao.titulo}`}</p>
          <p className="suavez-descricao">{projeto.situacao.descricao}</p>

          {outras > 0 && (
            <p className="suavez-mais">
              <span>{`e mais ${outras} esperando`}</span>{' '}
              <Link to={`${RAIZ}/projetos`} className="suavez-link" onClick={dispensar}>
                Ver todas
              </Link>
            </p>
          )}

          <div className="suavez-acoes">
            <Botao variante="secundario" aoClicar={dispensar}>
              Depois
            </Botao>
            {projeto.situacao.acao && tela && (
              <Botao
                aoClicar={() => {
                  dispensar();
                  navegar(`${RAIZ}/projetos/${projeto.id}?etapa=${tela}`);
                }}
              >
                {projeto.situacao.acao.rotulo}
              </Botao>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
