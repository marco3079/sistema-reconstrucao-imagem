import { useState } from 'react';
import { api } from '../../lib/api';
import { urlArquivo } from '../../lib/arquivos';
import { ROTULO_STATUS_PROJETO } from '../../lib/tipos';
import type { ProjetoDetalhe, StatusProjeto, Versao } from '../../lib/tipos';
import { Aviso, Botao, Cartao, Modal, Selo, formatarDataHora } from '../../ui';
import { Comparador } from './EtapaReconstrucao';
import { Laudo } from './Laudo';
import type { PropsEtapa } from './tipos';
import './reconstrucao.css';

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const COR_STATUS_PROJETO: Record<StatusProjeto, CorSelo> = {
  NOVO: 'cinza',
  ANALISADO: 'azul',
  EM_RECONSTRUCAO: 'amarelo',
  CONCLUIDO: 'verde',
};

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Erro inesperado';
}

// Nome do arquivo baixado: sem caracteres estranhos.
function nomeSeguro(nome: string): string {
  const limpo = nome.replace(/[^A-Za-z0-9À-ÿ _-]+/g, '').trim();
  return limpo || 'imagem';
}

export function EtapaResultado({ projeto, aoAtualizar, recarregar, irPara }: PropsEtapa) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versaoParaRestaurar, setVersaoParaRestaurar] = useState<Versao | null>(null);
  const [erroRestauracao, setErroRestauracao] = useState<string | null>(null);

  const partes = projeto.regioes.filter((r) => r.status !== 'IGNORADA');
  const resolvidas = partes.filter((r) => r.status === 'RESOLVIDA').length;
  const pendentes = partes.length - resolvidas;
  const proporcao = projeto.altura > 0 ? projeto.largura / projeto.altura : 1;

  // Versões chegam da mais nova para a mais antiga; a atual é a primeira com o mesmo arquivo.
  const indiceAtual = projeto.versoes.findIndex((v) => v.arquivo === projeto.atualArquivo);

  async function baixar() {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await api.baixar(`/projetos/${projeto.id}/baixar`, nomeSeguro(projeto.nome) + '-restaurada.png');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function pedirInspecao() {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/projetos/${projeto.id}/trabalhos`, { tipo: 'INSPECAO' });
      recarregar();
      setAviso('Inspeção final pedida. Acompanhe no painel da equipe.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(versao: Versao) {
    setOcupado(true);
    setErroRestauracao(null);
    try {
      const resposta = await api.post<ProjetoDetalhe>(
        `/projetos/${projeto.id}/versoes/${versao.id}/restaurar`,
      );
      aoAtualizar(resposta);
      setVersaoParaRestaurar(null);
    } catch (e) {
      setErroRestauracao(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rec-resultado">
      <Cartao titulo="Antes e depois">
        <Comparador
          antes={<img src={urlArquivo(projeto.originalArquivo, 1600)} alt="Imagem original" />}
          depois={<img src={urlArquivo(projeto.atualArquivo, 1600)} alt="Imagem atual" />}
          proporcao={proporcao}
          alturaMaxima
        />
      </Cartao>

      <Cartao titulo="Resumo">
        <p>
          <Selo cor={COR_STATUS_PROJETO[projeto.status]}>{ROTULO_STATUS_PROJETO[projeto.status]}</Selo>
        </p>
        <p>{`${resolvidas} de ${partes.length} partes resolvidas`}</p>
        {pendentes > 0 && (
          <>
            <Aviso tipo="info">{`Ainda há ${pendentes} partes pendentes.`}</Aviso>
            <Botao variante="secundario" aoClicar={() => irPara('reconstrucao')}>
              Voltar para reconstrução
            </Botao>
          </>
        )}
      </Cartao>

      <Cartao titulo="Ações">
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="rec-acoes-resultado">
          <Botao desabilitado={ocupado} aoClicar={baixar}>
            Baixar imagem
          </Botao>
          <Botao variante="secundario" desabilitado={ocupado} aoClicar={pedirInspecao}>
            Pedir inspeção final aos agentes
          </Botao>
        </div>
      </Cartao>

      <Cartao titulo="Histórico de versões">
        {projeto.versoes.length === 0 ? (
          <p className="rec-vazio">Ainda não há versões.</p>
        ) : (
          <ul className="rec-lista-versoes">
            {projeto.versoes.map((versao, i) => (
              <li key={versao.id} className="rec-versao">
                <img
                  className="rec-versao-miniatura"
                  src={urlArquivo(versao.arquivo, 240)}
                  alt={`Miniatura da versão ${versao.numero}`}
                  loading="lazy"
                />
                <div className="rec-versao-texto">
                  <strong>{`Versão ${versao.numero}`}</strong>
                  {versao.descricao && <p className="rec-texto-pequeno">{versao.descricao}</p>}
                  <p className="rec-texto-pequeno">{formatarDataHora(versao.criadoEm)}</p>
                  {i === indiceAtual ? (
                    <Selo cor="verde">Atual</Selo>
                  ) : (
                    <Botao variante="texto" desabilitado={ocupado} aoClicar={() => setVersaoParaRestaurar(versao)}>
                      Voltar para esta
                    </Botao>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Modal
        aberto={versaoParaRestaurar !== null}
        titulo={versaoParaRestaurar ? `Voltar para a versão ${versaoParaRestaurar.numero}` : 'Voltar para versão'}
        aoFechar={() => {
          setVersaoParaRestaurar(null);
          setErroRestauracao(null);
        }}
      >
        <p>A imagem volta a ser como nesta versão. As versões seguintes continuam no histórico.</p>
        {erroRestauracao && <Aviso tipo="erro">{erroRestauracao}</Aviso>}
        <div className="rec-acoes-resultado">
          <Botao desabilitado={ocupado} aoClicar={() => versaoParaRestaurar && restaurar(versaoParaRestaurar)}>
            Voltar para esta
          </Botao>
          <Botao
            variante="secundario"
            aoClicar={() => {
              setVersaoParaRestaurar(null);
              setErroRestauracao(null);
            }}
          >
            Cancelar
          </Botao>
        </div>
      </Modal>

      <Cartao titulo="Laudo de restauração">
        <p className="rec-texto-pequeno">
          Registro do que foi examinado, corrigido e recriado, com as medidas antes e depois.
        </p>
        <Laudo projetoId={projeto.id} />
      </Cartao>
    </div>
  );
}
