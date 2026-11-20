import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ProjetoDetalhe } from '../../lib/tipos';
import { Aviso, Botao, Caixa, Modal } from '../../ui';
import './reiniciar.css';

export type PassoReinicio = 'EXAME' | 'MAPA' | 'PLANO' | 'TRATAMENTO' | 'INSPECAO';

const OPCOES: { valor: PassoReinicio; titulo: string; descricao: string }[] = [
  {
    valor: 'EXAME',
    titulo: 'Exame da imagem',
    descricao: 'A equipe examina a imagem de novo e refaz a grade e o mapa. O que já foi aplicado na imagem fica.',
  },
  {
    valor: 'MAPA',
    titulo: 'Mapa de referências',
    descricao: 'A equipe revê as referências e o mapa. Você aprova de novo.',
  },
  {
    valor: 'PLANO',
    titulo: 'Plano de tratamento',
    descricao: 'A equipe refaz o plano das partes que ainda não foram concluídas e segue para o tratamento.',
  },
  {
    valor: 'TRATAMENTO',
    titulo: 'Tratamento das partes',
    descricao: 'As opções ainda não escolhidas são apagadas e a equipe cria novas.',
  },
  {
    valor: 'INSPECAO',
    titulo: 'Inspeção final',
    descricao: 'A equipe confere a imagem inteira de novo.',
  },
];

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

export function Reiniciar({
  projeto,
  aberto,
  passoInicial,
  aoFechar,
  aoAtualizar,
}: {
  projeto: ProjetoDetalhe;
  aberto: boolean;
  passoInicial?: PassoReinicio;
  aoFechar: () => void;
  aoAtualizar: (p: ProjetoDetalhe) => void;
}) {
  const mapaAprovado = projeto.mapaStatus === 'APROVADO';
  const [passo, setPasso] = useState<PassoReinicio>('EXAME');
  const [doZero, setDoZero] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ao abrir, começa no passo pedido (ou no exame, se o pedido não puder ser feito agora).
  useEffect(() => {
    if (!aberto) return;
    const bloqueadoInicial =
      (passoInicial === 'PLANO' || passoInicial === 'TRATAMENTO') && !mapaAprovado;
    setPasso(passoInicial && !bloqueadoInicial ? passoInicial : 'EXAME');
    setDoZero(false);
    setConfirmado(false);
    setErro(null);
    // Só abertura e passo pedido: mudar o estado do mapa com o modal aberto não zera a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, passoInicial]);

  function bloqueado(p: PassoReinicio): boolean {
    return (p === 'PLANO' || p === 'TRATAMENTO') && !mapaAprovado;
  }

  function escolher(p: PassoReinicio) {
    setPasso(p);
    if (p !== 'EXAME') {
      setDoZero(false);
      setConfirmado(false);
    }
  }

  async function reiniciar() {
    if (bloqueado(passo)) {
      setErro('Aprove o mapa antes de reiniciar esta etapa.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await api.post<ProjetoDetalhe>(`/projetos/${projeto.id}/reiniciar`, {
        passo,
        doZero: passo === 'EXAME' && doZero,
      });
      aoAtualizar(resposta);
      aoFechar();
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setEnviando(false);
    }
  }

  const zeroMarcado = passo === 'EXAME' && doZero;
  const semConfirmacao = zeroMarcado && !confirmado;

  return (
    <Modal
      aberto={aberto}
      titulo="Reiniciar o processo"
      aoFechar={() => {
        if (!enviando) aoFechar();
      }}
    >
      <fieldset className="reiniciar-passos" disabled={enviando}>
        <legend>A partir de onde?</legend>
        {OPCOES.map((o) => {
          const desabilitada = bloqueado(o.valor);
          return (
            <label
              key={o.valor}
              className={
                'reiniciar-opcao' +
                (passo === o.valor ? ' reiniciar-opcao-marcada' : '') +
                (desabilitada ? ' reiniciar-opcao-desabilitada' : '')
              }
            >
              <input
                type="radio"
                name="passo-reinicio"
                value={o.valor}
                checked={passo === o.valor}
                disabled={desabilitada}
                onChange={() => escolher(o.valor)}
              />
              <span className="reiniciar-opcao-texto">
                <strong>{o.titulo}</strong>
                <span>{o.descricao}</span>
                {desabilitada && <small className="reiniciar-dica">Aprove o mapa primeiro.</small>}
              </span>
            </label>
          );
        })}
      </fieldset>

      {passo === 'EXAME' && (
        <div className="reiniciar-zero">
          <Caixa rotulo="Recomeçar do zero" marcado={doZero} aoMudar={setDoZero} />
          {doZero && (
            <>
              <p className="reiniciar-perigo">
                Volta à imagem original e apaga todas as partes, opções, ligações do mapa e referências geradas.
                As suas referências importadas ficam. As versões antigas continuam no histórico.
              </p>
              <Caixa
                rotulo="Entendi que isso não pode ser desfeito"
                marcado={confirmado}
                aoMudar={setConfirmado}
              />
            </>
          )}
        </div>
      )}

      <Aviso tipo="info">Os trabalhos que a equipe está fazendo agora nesta imagem são cancelados.</Aviso>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="oficina-modal-acoes">
        <Botao variante="secundario" aoClicar={() => !enviando && aoFechar()} desabilitado={enviando}>
          Cancelar
        </Botao>
        <Botao
          variante={zeroMarcado ? 'perigo' : 'primario'}
          aoClicar={reiniciar}
          desabilitado={enviando || semConfirmacao}
        >
          Reiniciar
        </Botao>
      </div>
    </Modal>
  );
}
