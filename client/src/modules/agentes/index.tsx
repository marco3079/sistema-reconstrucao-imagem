import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Aviso, Cartao, Carregando, Pagina, Selo, formatarDataHora } from '../../ui';
import { Fluxo } from './Fluxo';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { RAIZ, TODOS_OS_PERFIS } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { useDados } from '../../lib/useDados';
import { ROTULO_AGENTE } from '../../lib/tipos';
import type { NomeAgente, StatusAgentes } from '../../lib/tipos';
import './agentes.css';

const AGENTES: { nome: NomeAgente; icone: NomeIcone; funcao: string }[] = [
  {
    nome: 'maestro',
    icone: 'grupo',
    funcao:
      'Pega cada trabalho da fila, distribui as tarefas e garante que o revisor aprove antes de mostrar as opções a você.',
  },
  {
    nome: 'analista',
    icone: 'busca',
    funcao:
      'Olha a imagem, descreve o que ela mostra e marca cada parte faltando, danificada, borrada ou desbotada.',
  },
  {
    nome: 'cenografo',
    icone: 'grade',
    funcao: 'Observa a foto em perspectiva e monta o mapa 3D: câmera, horizonte e a posição de cada pessoa e objeto.',
  },
  {
    nome: 'cartografo',
    icone: 'link',
    funcao: 'Decide quais referências pedir e monta o mapa: qual referência serve a qual parte.',
  },
  {
    nome: 'conservador',
    icone: 'tarefa',
    funcao:
      'Escreve o plano de tratamento de cada parte pelo caminho menos invasivo e define a ordem das correções.',
  },
  {
    nome: 'restaurador',
    icone: 'lapis',
    funcao: 'Corrige com filtros locais: nitidez, ruído, cor, contraste e exposição.',
  },
  {
    nome: 'gerador-canva',
    icone: 'paleta',
    funcao: 'Escreve o pedido e gera no Canva as partes que faltam, guiado pelas referências.',
  },
  {
    nome: 'revisor',
    icone: 'visto',
    funcao:
      'Compara antes e depois, dá nota e aprova ou reprova. Quando reprova, escreve o plano de ajuste que o agente segue para refazer.',
  },
  {
    nome: 'inspetor',
    icone: 'medalha',
    funcao: 'Confere a imagem final contra a original, mede antes e depois e aponta o que ainda falta.',
  },
];

const PASSOS_DA_EQUIPE: string[] = [
  'Você envia a imagem. O original fica guardado e a equipe trabalha em cópias.',
  'O analista examina a imagem e escreve o laudo de estado.',
  'O cartógrafo pede as referências que faltam e monta o mapa.',
  'Você confere o mapa de referências, ajusta o que quiser e aprova.',
  'O conservador escreve o plano de tratamento de cada parte, do menos invasivo para o mais invasivo.',
  'O restaurador e o gerador Canva criam as opções. Parte recriada sem referência sai marcada como conjectura.',
  'O revisor aprova ou devolve com um plano de ajuste (até 3 rodadas).',
  'Você escolhe a opção de cada parte. Cada escolha pode ser desfeita.',
  'O inspetor confere a imagem final e o sistema monta o laudo de restauração.',
];

function Agentes() {
  const { dados, carregando, erro, recarregar } = useDados<StatusAgentes>('/agentes/status');

  // Atualiza o estado da equipe a cada 5 s.
  useEffect(() => {
    const id = window.setInterval(recarregar, 5000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  return (
    <Pagina
      titulo="Equipe de agentes"
      acoes={
        <Link className="botao botao-secundario" to={`${RAIZ}/agentes/fluxo`}>
          Ver fluxo ao vivo
        </Link>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && !erro && <Carregando />}

      {dados && (
        <Cartao>
          <div className="agentes-estado">
            {dados.conectado ? (
              <Selo cor="verde">Conectada</Selo>
            ) : (
              <Selo cor="amarelo">Aguardando sessão do Claude Code</Selo>
            )}
            <span>
              Último contato: {dados.ultimoContato ? formatarDataHora(dados.ultimoContato) : 'nunca'}
            </span>
          </div>
          <ul className="agentes-contagem">
            <li>Na fila: {dados.naFila}</li>
            <li>Em andamento: {dados.emAndamento}</li>
          </ul>
          {!dados.conectado && (
            <Aviso tipo="info">
              A sessão do Claude Code se liga a uma imagem por vez. Abra a imagem, vá na etapa Equipe ao vivo e
              siga os passos de conexão.
            </Aviso>
          )}
        </Cartao>
      )}

      <div className="agentes-grade">
        {AGENTES.map((a) => (
          <article className="agentes-card" key={a.nome}>
            <span className="agentes-icone">
              <Icone nome={a.icone} tamanho={22} />
            </span>
            <h3>{ROTULO_AGENTE[a.nome]}</h3>
            <p>{a.funcao}</p>
          </article>
        ))}
      </div>

      <Cartao titulo="Como a equipe trabalha">
        <ol className="agentes-passos">
          {PASSOS_DA_EQUIPE.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
        <p>
          O fluxo segue princípios da Carta de Veneza, de códigos de ética de conservação, das diretrizes SWGDE e
          FADGI e do padrão IPTC para conteúdo gerado por IA.
        </p>
      </Cartao>
    </Pagina>
  );
}

export const rotas: RotaModulo[] = [
  {
    caminho: `${RAIZ}/agentes`,
    rotulo: 'Equipe de agentes',
    icone: 'grupo',
    perfis: TODOS_OS_PERFIS,
    elemento: <Agentes />,
    ordem: 30,
  },
  {
    caminho: `${RAIZ}/agentes/fluxo`,
    rotulo: 'Fluxo ao vivo',
    icone: 'atividade',
    perfis: TODOS_OS_PERFIS,
    elemento: <Fluxo />,
    ordem: 31,
  },
];
