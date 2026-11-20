import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Aviso, Botao, Campo, Modal, Selecao } from '../../ui';
import { api } from '../../lib/api';
import { TAMANHO_MAXIMO_ENVIO, TIPOS_DE_IMAGEM_ACEITOS } from '../../lib/arquivos';
import { RAIZ } from '../../lib/rotas';
import { TIPOS_PROJETO } from '../../lib/tipos';
import type { ProjetoDetalhe, TipoProjeto } from '../../lib/tipos';

function ehTipo(valor: string): valor is TipoProjeto {
  return TIPOS_PROJETO.some((t) => t.valor === valor);
}

// Nome do arquivo sem a extensão final.
function nomeSemExtensao(nomeArquivo: string): string {
  const ponto = nomeArquivo.lastIndexOf('.');
  return ponto > 0 ? nomeArquivo.slice(0, ponto) : nomeArquivo;
}

function tamanhoEmMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

// Devolve a mensagem de erro do arquivo, ou null se ele pode ser enviado.
function problemaDoArquivo(arquivo: File): string | null {
  if (!arquivo.type.startsWith('image/')) return 'O arquivo escolhido não é uma imagem.';
  if (arquivo.size > TAMANHO_MAXIMO_ENVIO) return 'A imagem passa de 30 MB.';
  return null;
}

export function NovoProjeto({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const navegar = useNavigate();
  const entradaRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoProjeto>('FOTO');
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Prévia com URL temporária: revogada ao trocar o arquivo e ao desmontar.
  useEffect(() => {
    if (!arquivo || !arquivo.type.startsWith('image/')) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  // Colar: uma imagem copiada vai para o formulário enquanto o modal está aberto.
  useEffect(() => {
    if (!aberto) return;
    function aoColar(e: ClipboardEvent) {
      const imagem = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!imagem) return;
      e.preventDefault();
      escolher(imagem);
    }
    document.addEventListener('paste', aoColar);
    return () => document.removeEventListener('paste', aoColar);
    // escolher usa só setters estáveis; o efeito depende apenas de `aberto`.
  }, [aberto]);

  function escolher(f: File | null | undefined) {
    if (!f) return;
    const problema = problemaDoArquivo(f);
    setErro(problema);
    if (problema) return;
    setArquivo(f);
    setNome(nomeSemExtensao(f.name));
  }

  function limpar() {
    setArquivo(null);
    setNome('');
    setTipo('FOTO');
    setErro(null);
    setArrastando(false);
  }

  function fechar() {
    if (enviando) return;
    limpar();
    aoFechar();
  }

  function aoSoltar(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files[0]);
  }

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    escolher(e.target.files?.[0]);
    e.target.value = '';
  }

  async function enviar() {
    if (!arquivo) {
      setErro('Escolha uma imagem para enviar.');
      return;
    }
    const problema = problemaDoArquivo(arquivo);
    if (problema) {
      setErro(problema);
      return;
    }

    setErro(null);
    setEnviando(true);
    try {
      const projeto = await api.enviarArquivo<ProjetoDetalhe>(
        '/projetos?nome=' + encodeURIComponent(nome) + '&tipo=' + tipo,
        arquivo,
        arquivo.type || 'application/octet-stream',
      );
      navegar(`${RAIZ}/projetos/${projeto.id}`);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
      setEnviando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Nova imagem" aoFechar={fechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <button
        type="button"
        className={arrastando ? 'novo-soltar novo-soltar-ativo' : 'novo-soltar'}
        onClick={() => entradaRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
      >
        {arquivo ? (
          <>
            {previa && <img className="novo-previa" src={previa} alt="Prévia da imagem escolhida" />}
            <span className="novo-arquivo">
              {arquivo.name} ({tamanhoEmMb(arquivo.size)})
            </span>
            <span className="novo-dica">Clique ou solte outra imagem para trocar</span>
          </>
        ) : (
          <>
            <span className="novo-soltar-titulo">Solte a imagem aqui</span>
            <span className="novo-dica">ou clique para escolher, ou cole com Ctrl+V</span>
          </>
        )}
      </button>
      <input
        ref={entradaRef}
        type="file"
        accept={TIPOS_DE_IMAGEM_ACEITOS}
        hidden
        onChange={aoEscolherArquivo}
      />

      <div className="novo-campos">
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} />
        <Selecao
          rotulo="Tipo de imagem"
          valor={tipo}
          aoMudar={(valor) => {
            if (ehTipo(valor)) setTipo(valor);
          }}
          opcoes={TIPOS_PROJETO}
        />
      </div>

      <p className="novo-ajuda">
        Assim que a imagem entrar, o sistema mede a qualidade e a equipe de agentes começa a análise.
      </p>

      <Botao desabilitado={enviando} aoClicar={enviar}>
        {enviando ? 'Enviando...' : 'Enviar imagem'}
      </Botao>
    </Modal>
  );
}
