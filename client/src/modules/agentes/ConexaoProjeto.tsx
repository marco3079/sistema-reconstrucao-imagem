import { useEffect, useState } from 'react';
import type { StatusAgentes } from '../../lib/tipos';
import { Aviso, Botao, Cartao, Carregando, Selo, formatarDataHora } from '../../ui';

export interface PropsConexaoProjeto {
  // null na demonstração: o comando aparece com o texto genérico.
  projetoId: number | null;
  status: StatusAgentes | null;
}

const TEMPO_COPIADO_MS = 2000;

export function ConexaoProjeto({ projetoId, status }: PropsConexaoProjeto) {
  const comando = projetoId === null ? '/restaurar <número da imagem>' : `/restaurar ${projetoId}`;
  const [copiado, setCopiado] = useState<boolean>(false);
  const [erroCopia, setErroCopia] = useState<string | null>(null);

  // "Copiado" some depois de alguns segundos.
  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), TEMPO_COPIADO_MS);
    return () => window.clearTimeout(id);
  }, [copiado]);

  async function copiar(): Promise<void> {
    setErroCopia(null);
    try {
      await navigator.clipboard.writeText(comando);
      setCopiado(true);
    } catch {
      setErroCopia('Não foi possível copiar. Selecione o comando e copie.');
    }
  }

  return (
    <Cartao titulo="Sessão deste projeto">
      {status === null ? (
        <Carregando />
      ) : (
        <>
          <div className="fluxo-conexao-topo">
            {status.conectado ? (
              <Selo cor="verde">Sessão conectada a este projeto</Selo>
            ) : (
              <Selo cor="amarelo">Sem sessão ligada a este projeto</Selo>
            )}
            <span className="fluxo-suave">
              Último contato: {status.ultimoContato ? formatarDataHora(status.ultimoContato) : 'nunca'}
            </span>
            <span>Na fila: {status.naFila}</span>
            <span>Em andamento: {status.emAndamento}</span>
          </div>

          {status.conectado ? (
            <p className="fluxo-suave fluxo-conexao-pequeno">Sessão ligada com {comando}</p>
          ) : (
            <>
              <p>1. Abra o Claude Code na pasta agentes do Restaura.</p>
              <p>2. Digite o comando abaixo e deixe a sessão aberta.</p>
              <div className="fluxo-comando">
                <code>{comando}</code>
                <Botao variante="secundario" aoClicar={() => void copiar()}>
                  {copiado ? 'Copiado' : 'Copiar'}
                </Botao>
              </div>
              {erroCopia && <Aviso tipo="erro">{erroCopia}</Aviso>}
            </>
          )}
        </>
      )}
    </Cartao>
  );
}
