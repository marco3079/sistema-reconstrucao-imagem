import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { apagarArquivo, lerArquivo } from '../../lib/arquivos';
import { analisarLocal, PROBLEMAS } from '../../lib/analise-local';
import type { ProblemaGlobal } from '../../lib/analise-local';
import { contextoDaRegiao, paraJpeg, recortar, retanguloDaRegiao } from '../../lib/imagem';
import type { Retangulo } from '../../lib/imagem';
import { canvaConectado } from '../../lib/canva';
import { detalheDoProjeto, recalcularStatusDoProjeto } from '../../lib/acesso';
import { CATEGORIAS, recriarGrade } from '../../lib/grade';
import type { Categoria } from '../../lib/grade';
import {
  registrarFerramenta,
  argNumero,
  argNumeroOpcional,
  argTexto,
  argTextoOpcional,
  imagemMcp,
} from '../../lib/mcp';
import type { ConteudoMcp, FerramentaMcp } from '../../lib/mcp';
import { criarRegiao, salvarAnaliseDoAgente } from '../analise/servico';
import { cenaDoProjeto } from '../cena/servico';
import { resumoDaCena, textoDePerspectiva } from '../../lib/cena';
import type { DadosDeRegiao } from '../analise/servico';
import {
  criarPedido,
  desvincular,
  vincular,
  PAPEIS,
  aguardarReferencias,
  gerarReferenciasCanva,
  gerarReferenciasQueFaltam,
  revisarReferencia,
} from '../referencias/servico';
import type { PapelReferencia } from '../referencias/servico';
import {
  FILTROS_LOCAIS,
  aguardarOpcao,
  comparativoDaOpcao,
  gerarOpcaoCanva,
  gerarOpcoesLocais,
} from '../reconstrucao/servico';
import {
  AGENTES,
  TIPOS_EVENTO,
  aguardarTrabalho,
  concluirTrabalho,
  manterContato,
  marcarContato,
  registrarEvento,
} from './servico';
import type { NomeAgente, TipoEvento } from './servico';

// Ferramentas MCP da equipe de agentes. Nomes, argumentos e efeitos: docs/CONTRATOS.md ("Ferramentas MCP").

type Args = Record<string, unknown>;
type Esquema = FerramentaMcp['esquema'];

// ---------- Esquemas ----------

function esquema(properties: Record<string, unknown>, required: string[] = []): Esquema {
  return { type: 'object', properties, required };
}

const PROP = {
  inteiro: (descricao: string) => ({ type: 'integer', description: descricao }),
  numero: (descricao: string) => ({ type: 'number', description: descricao }),
  texto: (descricao: string) => ({ type: 'string', description: descricao }),
  booleano: (descricao: string) => ({ type: 'boolean', description: descricao }),
  fracao: (descricao: string) => ({ type: 'number', minimum: 0, maximum: 1, description: descricao }),
  escolha: (valores: readonly string[], descricao: string) => ({
    type: 'string',
    enum: [...valores],
    description: descricao,
  }),
  lista: (descricao: string) => ({ type: 'array', items: { type: 'string' }, description: descricao }),
  listaDeObjetos: (descricao: string, propriedades: Record<string, unknown>) => ({
    type: 'array',
    items: { type: 'object', properties: propriedades, additionalProperties: false },
    description: descricao,
  }),
};

// Problema de uma parte: os de defeito e NENHUM (parte sem defeito).
const PROBLEMAS_DA_PARTE = [...PROBLEMAS, 'NENHUM'] as const;
type ProblemaDaParte = (typeof PROBLEMAS_DA_PARTE)[number];

// ---------- Leitura de argumentos ----------

function ausente(valor: unknown): boolean {
  return valor === undefined || valor === null || valor === '';
}

function argInteiro(args: Args, nome: string): number {
  const n = argNumero(args, nome);
  if (!Number.isInteger(n)) throw new HttpError(400, `Argumento "${nome}" deve ser um número inteiro`);
  return n;
}

function argInteiroOpcional(args: Args, nome: string): number | undefined {
  return ausente(args[nome]) ? undefined : argInteiro(args, nome);
}

function argEscolha<T extends string>(args: Args, nome: string, valores: readonly T[]): T {
  const valor = argTexto(args, nome);
  const achado = valores.find((v) => v === valor);
  if (!achado) throw new HttpError(400, `Argumento "${nome}" deve ser um de: ${valores.join(', ')}`);
  return achado;
}

function argEscolhaOpcional<T extends string>(args: Args, nome: string, valores: readonly T[], padrao: T): T {
  return ausente(args[nome]) ? padrao : argEscolha(args, nome, valores);
}

function argBooleano(args: Args, nome: string, padrao: boolean): boolean {
  return argBooleanoOpcional(args, nome) ?? padrao;
}

function argBooleanoOpcional(args: Args, nome: string): boolean | undefined {
  const valor = args[nome];
  if (ausente(valor)) return undefined;
  if (valor === true || valor === 'true') return true;
  if (valor === false || valor === 'false') return false;
  throw new HttpError(400, `Argumento "${nome}" deve ser true ou false`);
}

function argCategoriaOpcional(args: Args, nome: string): Categoria | undefined {
  return ausente(args[nome]) ? undefined : argEscolha(args, nome, CATEGORIAS);
}

function argProblemaDaParteOpcional(args: Args, nome: string): ProblemaDaParte | undefined {
  return ausente(args[nome]) ? undefined : argEscolha(args, nome, PROBLEMAS_DA_PARTE);
}

// Lista de objetos (cada item é um Record<string, unknown>), com no máximo `maximo` itens.
function argListaDeObjetos(args: Args, nome: string, maximo: number): Args[] {
  const valor = args[nome];
  if (!Array.isArray(valor)) throw new HttpError(400, `Argumento "${nome}" deve ser uma lista de objetos`);
  if (valor.length > maximo) throw new HttpError(400, `Argumento "${nome}" deve ter no máximo ${maximo} itens`);
  return valor.map((item: unknown, i: number) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new HttpError(400, `${nome}[${i}] deve ser um objeto`);
    }
    return item as Args;
  });
}

function argFracao(args: Args, nome: string): number {
  const n = argNumero(args, nome);
  if (n < 0 || n > 1) throw new HttpError(400, `Argumento "${nome}" deve estar entre 0 e 1 (fração da imagem)`);
  return n;
}

function argFracaoOpcional(args: Args, nome: string): number | undefined {
  return ausente(args[nome]) ? undefined : argFracao(args, nome);
}

function argGravidade(args: Args, nome: string): number {
  const n = argInteiro(args, nome);
  if (n < 1 || n > 5) throw new HttpError(400, `Argumento "${nome}" deve estar entre 1 e 5`);
  return n;
}

function argGravidadeOpcional(args: Args, nome: string): number | undefined {
  return ausente(args[nome]) ? undefined : argGravidade(args, nome);
}

// Lista de textos: aceita array ou string separada por vírgula.
function argListaTextos(args: Args, nome: string): string[] | undefined {
  const valor = args[nome];
  if (ausente(valor)) return undefined;
  if (typeof valor === 'string') {
    return valor
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  if (Array.isArray(valor) && valor.every((v) => typeof v === 'string')) {
    return (valor as string[]).map((s) => s.trim()).filter((s) => s !== '');
  }
  throw new HttpError(400, `Argumento "${nome}" deve ser uma lista de textos`);
}

// Problemas globais: aceita array ou o mesmo array em texto JSON.
function argProblemas(args: Args, nome: string): ProblemaGlobal[] {
  let bruto: unknown = args[nome];
  if (typeof bruto === 'string') {
    try {
      bruto = JSON.parse(bruto);
    } catch {
      throw new HttpError(400, `Argumento "${nome}" deve ser uma lista de { codigo, gravidade, descricao }`);
    }
  }
  if (!Array.isArray(bruto)) {
    throw new HttpError(400, `Argumento "${nome}" deve ser uma lista de { codigo, gravidade, descricao }`);
  }
  return bruto.map((item: unknown, i: number) => {
    if (typeof item !== 'object' || item === null) {
      throw new HttpError(400, `${nome}[${i}] deve ser um objeto com codigo, gravidade e descricao`);
    }
    const p = item as Args;
    const codigo = PROBLEMAS.find((v) => v === p.codigo);
    if (!codigo) throw new HttpError(400, `${nome}[${i}].codigo deve ser um de: ${PROBLEMAS.join(', ')}`);
    return {
      codigo,
      gravidade: argGravidade(p, 'gravidade'),
      descricao: argTextoOpcional(p, 'descricao') ?? '',
    };
  });
}

// Plano de tratamento da região: texto de até 2000 caracteres (vazio limpa o plano).
function argPlano(args: Args, nome: string): string | undefined {
  const plano = argTextoOpcional(args, nome);
  if (plano !== undefined && plano.length > 2000) {
    throw new HttpError(400, `Argumento "${nome}" deve ter até 2000 caracteres`);
  }
  return plano;
}

// Posição da região na ordem de tratamento: inteiro >= 0.
function argOrdem(args: Args, nome: string): number | undefined {
  const ordem = argInteiroOpcional(args, nome);
  if (ordem !== undefined && ordem < 0) {
    throw new HttpError(400, `Argumento "${nome}" deve ser um inteiro maior ou igual a 0`);
  }
  return ordem;
}

// Conjectura: opção gerada sem referência no mapa (lido de parametros.conjectura).
function conjecturaDaOpcao(parametros: unknown): boolean {
  return typeof parametros === 'object' && parametros !== null && 'conjectura' in parametros && parametros.conjectura === true;
}

// Lado máximo da imagem devolvida: entre 256 e 2000 px.
function ladoMaximo(args: Args, padrao: number): number {
  const n = argNumeroOpcional(args, 'lado_maximo') ?? padrao;
  return Math.round(Math.min(Math.max(n, 256), 2000));
}

// ---------- Buscas com erro que o agente entende ----------

async function projetoExistente(id: number) {
  const projeto = await prisma.projeto.findUnique({ where: { id } });
  if (!projeto) throw new HttpError(404, `Projeto ${id} não existe`);
  return projeto;
}

async function regiaoExistente(id: number) {
  const regiao = await prisma.regiao.findUnique({ where: { id } });
  if (!regiao) throw new HttpError(404, `Região ${id} não existe`);
  return regiao;
}

async function opcaoExistente(id: number) {
  const opcao = await prisma.opcao.findUnique({ where: { id } });
  if (!opcao) throw new HttpError(404, `Opção ${id} não existe`);
  return opcao;
}

async function referenciaExistente(id: number) {
  const referencia = await prisma.referencia.findUnique({ where: { id } });
  if (!referencia) throw new HttpError(404, `Referência ${id} não existe`);
  return referencia;
}

async function trabalhoExistente(id: number) {
  const trabalho = await prisma.trabalho.findUnique({ where: { id } });
  if (!trabalho) throw new HttpError(404, `Trabalho ${id} não existe`);
  return trabalho;
}

function regiaoDoProjeto(regiao: { id: number; projetoId: number }, projetoId: number): void {
  if (regiao.projetoId !== projetoId) {
    throw new HttpError(400, `Região ${regiao.id} não é do projeto ${projetoId}`);
  }
}

function json(valor: unknown): string {
  return JSON.stringify(valor, null, 2);
}

function fracao4(n: number): number {
  return Number(n.toFixed(4));
}

// Próxima rodada da região: 1 + a maior rodada existente (1 se não houver opções).
async function proximaRodada(regiaoId: number): Promise<number> {
  const ultima = await prisma.opcao.findFirst({
    where: { regiaoId },
    orderBy: { rodada: 'desc' },
    select: { rodada: true },
  });
  return (ultima?.rodada ?? 0) + 1;
}

// Agentes que podem registrar evento (todos menos o "sistema").
const AGENTES_EVENTO = AGENTES.filter((a) => a !== 'sistema');

// ---------- Fila de trabalhos ----------

registrarFerramenta({
  nome: 'listar_projetos',
  descricao: 'Lista os projetos de restauração (imagens) para escolher a qual a sessão vai se ligar.',
  esquema: esquema({}, []),
  async executar() {
    marcarContato();
    const projetos = await prisma.projeto.findMany({
      orderBy: { atualizadoEm: 'desc' },
      take: 50,
      select: { id: true, nome: true, tipo: true, status: true, mapaStatus: true, atualizadoEm: true },
    });
    const ids = projetos.map((p) => p.id);
    const contagens = await prisma.trabalho.groupBy({
      by: ['projetoId', 'status'],
      where: { projetoId: { in: ids }, status: { in: ['FILA', 'EM_ANDAMENTO'] } },
      _count: { _all: true },
    });
    const contar = (projetoId: number, status: string): number =>
      contagens.find((c) => c.projetoId === projetoId && c.status === status)?._count._all ?? 0;
    return {
      projetos: projetos.map((p) => ({
        id: p.id,
        nome: p.nome,
        tipo: p.tipo,
        status: p.status,
        mapaStatus: p.mapaStatus,
        naFila: contar(p.id, 'FILA'),
        emAndamento: contar(p.id, 'EM_ANDAMENTO'),
        atualizadoEm: p.atualizadoEm,
      })),
    };
  },
});

registrarFerramenta({
  nome: 'aguardar_trabalho',
  descricao:
    'Espera um trabalho da fila do projeto ao qual esta sessão está ligada. Chamar em laço mantém a sessão conectada ao projeto. Chame de novo sempre que voltar sem trabalho; a sessão só aparece como conectada enquanto este laço continua.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto de restauração ao qual esta sessão está ligada.'),
      espera_segundos: PROP.inteiro('Quantos segundos esperar pelo trabalho (padrão 90, máximo 100).'),
    },
    ['projeto_id']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
    if (!projeto) {
      throw new HttpError(404, `Projeto ${projetoId} não existe. Chame listar_projetos para ver os ids válidos.`);
    }
    const espera = Math.min(Math.max(argNumeroOpcional(args, 'espera_segundos') ?? 90, 0), 100);
    const trabalho = await aguardarTrabalho(espera, projetoId);
    if (!trabalho) return { trabalho: null, dica: 'Fila vazia. Chame aguardar_trabalho de novo.' };
    const projetoDoTrabalho = await projetoExistente(trabalho.projetoId);
    return {
      trabalho,
      projeto: {
        id: projetoDoTrabalho.id,
        nome: projetoDoTrabalho.nome,
        tipo: projetoDoTrabalho.tipo,
        status: projetoDoTrabalho.status,
      },
    };
  },
});

registrarFerramenta({
  nome: 'concluir_trabalho',
  descricao:
    'Fecha um trabalho da fila com um resumo do que foi feito. Use falhou=true se o trabalho não pôde ser concluído.',
  esquema: esquema(
    {
      trabalho_id: PROP.inteiro('Id do trabalho recebido em aguardar_trabalho.'),
      resumo: PROP.texto('Resumo curto do que foi feito ou do motivo da falha.'),
      falhou: PROP.booleano('true se o trabalho falhou (padrão false).'),
    },
    ['trabalho_id', 'resumo']
  ),
  async executar(args) {
    const trabalhoId = argInteiro(args, 'trabalho_id');
    const trabalhoAlvo = await trabalhoExistente(trabalhoId);
    marcarContato(trabalhoAlvo.projetoId);
    const trabalho = await concluirTrabalho(trabalhoId, argTexto(args, 'resumo'), argBooleano(args, 'falhou', false));
    if (trabalho.status === 'CANCELADO') {
      return {
        ok: true,
        status: trabalho.status,
        aviso: 'O usuário reiniciou o processo: este trabalho foi cancelado. Volte a aguardar trabalho.',
      };
    }
    return { ok: true, status: trabalho.status };
  },
});

registrarFerramenta({
  nome: 'registrar_evento',
  descricao:
    'Escreve uma linha na linha do tempo que o usuário vê no projeto. Use para contar o que você fez, achou ou decidiu.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      agente: PROP.escolha(AGENTES_EVENTO, `Quem está falando (${AGENTES_EVENTO.join(', ')}).`),
      tipo: PROP.escolha(TIPOS_EVENTO, 'Tipo do evento.'),
      texto: PROP.texto('Texto do evento, em português.'),
      trabalho_id: PROP.inteiro('Id do trabalho relacionado (opcional).'),
    },
    ['projeto_id', 'agente', 'tipo', 'texto']
  ),
  async executar(args) {
    const nomeAgente = argTexto(args, 'agente');
    const agente: NomeAgente | undefined = AGENTES_EVENTO.find((a) => a === nomeAgente);
    if (!agente) throw new HttpError(400, `Agente inválido "${nomeAgente}". Use um de: ${AGENTES_EVENTO.join(', ')}`);
    const nomeTipo = argTexto(args, 'tipo');
    const tipo: TipoEvento | undefined = TIPOS_EVENTO.find((t) => t === nomeTipo);
    if (!tipo) throw new HttpError(400, `Tipo inválido "${nomeTipo}". Use um de: ${TIPOS_EVENTO.join(', ')}`);
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const trabalhoId = argInteiroOpcional(args, 'trabalho_id');
    if (trabalhoId !== undefined) await trabalhoExistente(trabalhoId);
    await registrarEvento(projetoId, agente, tipo, argTexto(args, 'texto'), trabalhoId ?? null);
    return { ok: true };
  },
});

// ---------- Leitura do projeto ----------

registrarFerramenta({
  nome: 'obter_projeto',
  descricao:
    'Mostra o projeto completo: nome, status, análise, regiões, referências, pedidos, vínculos e opções (com nota). Use antes de agir sobre um projeto.',
  esquema: esquema({ projeto_id: PROP.inteiro('Id do projeto.') }, ['projeto_id']),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const detalhe = await detalheDoProjeto(projetoId);
    const cena = await cenaDoProjeto(projetoId);
    const opcoes = await prisma.opcao.findMany({
      where: { projetoId },
      select: {
        id: true,
        regiaoId: true,
        origem: true,
        rotulo: true,
        status: true,
        rodada: true,
        nota: true,
        parecer: true,
        parametros: true,
      },
      orderBy: { id: 'asc' },
    });
    return {
      ...detalhe,
      cenaResumo: cena ? resumoDaCena(cena.resolvida) : null,
      opcoes: opcoes.map(({ parametros, ...o }) => ({ ...o, conjectura: conjecturaDaOpcao(parametros) })),
    };
  },
});

registrarFerramenta({
  nome: 'medir_imagem',
  descricao:
    'Roda a análise local (sem IA) na imagem atual do projeto e devolve métricas, problemas e regiões sugeridas. Não grava nada.',
  esquema: esquema({ projeto_id: PROP.inteiro('Id do projeto.') }, ['projeto_id']),
  async executar(args) {
    const projeto = await projetoExistente(argInteiro(args, 'projeto_id'));
    marcarContato(projeto.id);
    return analisarLocal(await lerArquivo(projeto.atualArquivo));
  },
});

registrarFerramenta({
  nome: 'ver_imagem',
  descricao:
    'Mostra a imagem (JPEG) do projeto ou o recorte de contexto de uma região. Com regiao_id, devolve o recorte e diz onde a região fica dentro dele.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      alvo: PROP.escolha(['atual', 'original'], 'atual (padrão) ou original.'),
      regiao_id: PROP.inteiro('Id de uma região do projeto (opcional): mostra o recorte de contexto dela.'),
      lado_maximo: PROP.inteiro('Maior lado da imagem devolvida, de 256 a 2000 (padrão 1280).'),
    },
    ['projeto_id']
  ),
  async executar(args): Promise<ConteudoMcp[]> {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    const projeto = await projetoExistente(projetoId);
    const alvo =argEscolhaOpcional(args, 'alvo', ['atual', 'original'] as const, 'atual');
    const lado = ladoMaximo(args, 1280);
    const arquivo = alvo === 'original' ? projeto.originalArquivo : projeto.atualArquivo;
    const dimensao = `${projeto.largura}x${projeto.altura} px`;

    const regiaoId = argInteiroOpcional(args, 'regiao_id');
    if (regiaoId === undefined) {
      const jpeg = await paraJpeg(await lerArquivo(arquivo), lado);
      return [
        imagemMcp(jpeg),
        { type: 'text', text: `Imagem ${alvo} do projeto ${projetoId}: ${dimensao}.` },
      ];
    }

    const regiao = await regiaoExistente(regiaoId);
    regiaoDoProjeto(regiao, projetoId);
    const ret = retanguloDaRegiao(regiao, projeto.largura, projeto.altura);
    const cobreTudo = ret.x === 0 && ret.y === 0 && ret.largura >= projeto.largura && ret.altura >= projeto.altura;
    const ctx: Retangulo = cobreTudo ? ret : contextoDaRegiao(ret, projeto.largura, projeto.altura);
    const recorte = await recortar(await lerArquivo(arquivo), ctx);
    const jpeg = await paraJpeg(recorte, lado);

    const naImagem = {
      x: fracao4(ctx.x / projeto.largura),
      y: fracao4(ctx.y / projeto.altura),
      largura: fracao4(ctx.largura / projeto.largura),
      altura: fracao4(ctx.altura / projeto.altura),
    };
    const dentroDoRecorte = {
      x: fracao4((ret.x - ctx.x) / ctx.largura),
      y: fracao4((ret.y - ctx.y) / ctx.altura),
      largura: fracao4(ret.largura / ctx.largura),
      altura: fracao4(ret.altura / ctx.altura),
    };
    const textoRecorte = cobreTudo
      ? `A região cobre a imagem inteira; o recorte é a imagem toda.`
      : `Recorte de contexto: retângulo x=${ctx.x}, y=${ctx.y}, largura=${ctx.largura}, altura=${ctx.altura} px da imagem do projeto (frações da imagem: x=${naImagem.x}, y=${naImagem.y}, largura=${naImagem.largura}, altura=${naImagem.altura}).`;

    return [
      imagemMcp(jpeg),
      {
        type: 'text',
        text:
          `Imagem ${alvo} do projeto ${projetoId}: ${dimensao}. Região ${regiao.id} ("${regiao.nome}"). ` +
          `${textoRecorte} ` +
          `A região fica dentro do recorte em frações do recorte: x=${dentroDoRecorte.x}, y=${dentroDoRecorte.y}, largura=${dentroDoRecorte.largura}, altura=${dentroDoRecorte.altura}. ` +
          `A imagem enviada tem no máximo ${lado} px de lado; use as frações, não os pixels.`,
      },
    ];
  },
});

registrarFerramenta({
  nome: 'ver_referencia',
  descricao: 'Mostra a imagem (JPEG) de uma referência, com nome, papel e observação. Use para comparar antes de vincular.',
  esquema: esquema(
    {
      referencia_id: PROP.inteiro('Id da referência.'),
      lado_maximo: PROP.inteiro('Maior lado da imagem devolvida, de 256 a 2000 (padrão 1024).'),
    },
    ['referencia_id']
  ),
  async executar(args): Promise<ConteudoMcp[]> {
    const referencia = await referenciaExistente(argInteiro(args, 'referencia_id'));
    marcarContato(referencia.projetoId);
    const dados =
      `Referência ${referencia.id}: "${referencia.nome}". Origem: ${referencia.origem}. Status: ${referencia.status}. ` +
      `regiaoId: ${referencia.regiaoId ?? '(nenhuma)'}. Nota: ${referencia.nota ?? '(sem nota)'}. ` +
      `Papel: ${referencia.papel}. Observação: ${referencia.observacao || '(nenhuma)'}.`;
    if (referencia.status === 'GERANDO' || referencia.status === 'FALHOU') {
      const aviso =
        referencia.status === 'GERANDO'
          ? 'Ainda está sendo gerada: não há imagem para mostrar. Consulte de novo em alguns segundos.'
          : `Falhou, sem imagem.${referencia.erro ? ` Erro: ${referencia.erro}` : ''}`;
      return [{ type: 'text', text: `${dados} ${aviso}` }];
    }
    const jpeg = await paraJpeg(await lerArquivo(referencia.arquivo), ladoMaximo(args, 1024));
    return [imagemMcp(jpeg), { type: 'text', text: dados }];
  },
});

registrarFerramenta({
  nome: 'ver_opcao',
  descricao: 'Mostra a opção antes e depois lado a lado (JPEG), com os dados da opção. Use para revisar a qualidade da correção.',
  esquema: esquema({ opcao_id: PROP.inteiro('Id da opção.') }, ['opcao_id']),
  async executar(args): Promise<ConteudoMcp[]> {
    const opcao = await opcaoExistente(argInteiro(args, 'opcao_id'));
    marcarContato(opcao.projetoId);
    const imagem = await comparativoDaOpcao(opcao.id);
    const conjectura = conjecturaDaOpcao(opcao.parametros);
    // Mapa 3D: a perspectiva da parte (quando há cena) vai junto com os dados.
    const cena = await cenaDoProjeto(opcao.projetoId);
    const regiaoDaOpcao = cena ? await prisma.regiao.findUnique({ where: { id: opcao.regiaoId } }) : null;
    const perspectiva = cena && regiaoDaOpcao ? textoDePerspectiva(cena.resolvida, regiaoDaOpcao) : null;
    const dados = {
      id: opcao.id,
      regiaoId: opcao.regiaoId,
      origem: opcao.origem,
      rotulo: opcao.rotulo,
      status: opcao.status,
      rodada: opcao.rodada,
      conjectura,
      parametros: opcao.parametros,
    };
    const aviso = conjectura ? '\nOpção gerada sem referência no mapa: é conjectura.' : '';
    const texto = perspectiva ? `\nPerspectiva: ${perspectiva}` : '';
    return [imagemMcp(imagem), { type: 'text', text: 'Esquerda: antes. Direita: depois.\n' + json(dados) + aviso + texto }];
  },
});

// ---------- Análise e regiões ----------

registrarFerramenta({
  nome: 'salvar_analise',
  descricao:
    'Grava a análise do analista no projeto: descrição, tipo sugerido, qualidade (0 a 100), problemas globais e o prompt base.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      descricao: PROP.texto('Descrição da imagem, em português.'),
      tipo_sugerido: PROP.escolha(
        ['FOTO', 'LOGO', 'DOCUMENTO', 'PRODUTO', 'PAISAGEM', 'OUTRO'],
        'Tipo sugerido para o projeto.'
      ),
      qualidade: PROP.numero('Qualidade geral de 0 a 100 (opcional; sem ele mantém a medida local).'),
      problemas: {
        type: 'array',
        description: 'Problemas globais da imagem. Também aceita a mesma lista como texto JSON.',
        items: {
          type: 'object',
          properties: {
            codigo: PROP.escolha(PROBLEMAS, 'Código do problema.'),
            gravidade: { type: 'integer', minimum: 1, maximum: 5 },
            descricao: { type: 'string' },
          },
          required: ['codigo', 'gravidade', 'descricao'],
        },
      },
      prompt_base: PROP.texto('Prompt base para as correções desta imagem.'),
    },
    ['projeto_id', 'descricao', 'tipo_sugerido', 'problemas', 'prompt_base']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    await salvarAnaliseDoAgente(projetoId, {
      descricao: argTexto(args, 'descricao'),
      tipoSugerido: argTexto(args, 'tipo_sugerido'),
      qualidade: argNumeroOpcional(args, 'qualidade'),
      problemas: argProblemas(args, 'problemas'),
      promptBase: argTexto(args, 'prompt_base'),
    });
    return { ok: true };
  },
});

registrarFerramenta({
  nome: 'criar_regiao',
  descricao:
    'Cria uma região com problema na imagem (origem IA). Posição e tamanho são frações de 0 a 1 da imagem (canto superior esquerdo e tamanho). Não use para pessoas, rostos, roupas ou objetos: isso é com definir_elementos. Use para a parte "Imagem inteira" ou um defeito que atravessa várias partes.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      nome: PROP.texto('Nome curto da região.'),
      x: PROP.fracao('Fração da largura até a borda esquerda da região.'),
      y: PROP.fracao('Fração da altura até a borda superior da região.'),
      largura: PROP.fracao('Largura da região como fração da imagem.'),
      altura: PROP.fracao('Altura da região como fração da imagem.'),
      problema: PROP.escolha(PROBLEMAS_DA_PARTE, 'Tipo de problema (NENHUM = parte sem defeito).'),
      gravidade: PROP.inteiro('Gravidade de 1 a 5.'),
      descricao: PROP.texto('O que está errado nesta região e o que deve ser feito.'),
      categoria: PROP.escolha(CATEGORIAS, 'Categoria do conteúdo da região (opcional).'),
    },
    ['projeto_id', 'nome', 'x', 'y', 'largura', 'altura', 'problema', 'gravidade', 'descricao']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const problema = argEscolha(args, 'problema', PROBLEMAS_DA_PARTE);
    const categoria = argCategoriaOpcional(args, 'categoria');
    if (problema === 'NENHUM') {
      return { regiao_id: await criarRegiaoSemDefeito(projetoId, args, categoria) };
    }
    const dados: DadosDeRegiao = {
      nome: argTexto(args, 'nome'),
      x: argFracao(args, 'x'),
      y: argFracao(args, 'y'),
      largura: argFracao(args, 'largura'),
      altura: argFracao(args, 'altura'),
      problema,
      gravidade: argGravidade(args, 'gravidade'),
      descricao: argTextoOpcional(args, 'descricao') ?? '',
    };
    const regiaoId = await criarRegiao(projetoId, dados, 'IA');
    if (categoria !== undefined) {
      await prisma.regiao.update({ where: { id: regiaoId }, data: { categoria } });
    }
    return { regiao_id: regiaoId };
  },
});

// Parte sem defeito (problema NENHUM): criada direto, com as mesmas validações de criarRegiao.
// criarRegiao só aceita os problemas de defeito, por isso não é usada aqui (evita a janela entre criar e ajustar).
async function criarRegiaoSemDefeito(projetoId: number, args: Args, categoria: Categoria | undefined): Promise<number> {
  const nome = argTexto(args, 'nome').trim();
  if (nome.length < 1 || nome.length > 80) throw new HttpError(400, 'O nome da região deve ter de 1 a 80 caracteres');
  const x = argFracao(args, 'x');
  const y = argFracao(args, 'y');
  if (x >= 1 || y >= 1) throw new HttpError(400, 'x e y devem ser menores que 1');
  const larguraInformada = argFracao(args, 'largura');
  const alturaInformada = argFracao(args, 'altura');
  if (larguraInformada <= 0 || alturaInformada <= 0) throw new HttpError(400, 'largura e altura devem ser maiores que 0');
  const gravidade = argGravidade(args, 'gravidade');
  const descricao = argTextoOpcional(args, 'descricao') ?? '';
  if (descricao.length > 1000) throw new HttpError(400, 'A descricao deve ter até 1000 caracteres');
  const ordem = await prisma.regiao.count({ where: { projetoId } });
  const regiao = await prisma.regiao.create({
    data: {
      projetoId,
      nome,
      x,
      y,
      largura: Math.min(larguraInformada, 1 - x),
      altura: Math.min(alturaInformada, 1 - y),
      problema: 'NENHUM',
      selecionada: false,
      gravidade,
      descricao,
      origem: 'IA',
      ordem,
      ...(categoria !== undefined ? { categoria } : {}),
    },
  });
  await recalcularStatusDoProjeto(projetoId);
  return regiao.id;
}

// Partes do projeto na ordem de tratamento (formato das ferramentas de grade).
async function listarPartes(projetoId: number) {
  return prisma.regiao.findMany({
    where: { projetoId },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      classe: true,
      nome: true,
      categoria: true,
      x: true,
      y: true,
      largura: true,
      altura: true,
      problema: true,
      gravidade: true,
      selecionada: true,
      linha: true,
      coluna: true,
      status: true,
    },
  });
}

interface DadosDeElemento {
  nome: string;
  categoria: Categoria;
  x: number;
  y: number;
  largura: number;
  altura: number;
  problema: ProblemaDaParte;
  gravidade: number;
  descricao: string;
}

// Mesma validação e encaixe de criarRegiao.
// Elemento é uma coisa só: área máxima de 0,30 da foto; pessoa inteira (CORPO ou OUTRO) é recusada quando
// área > 0,08, altura > 0,35 e altura/largura > 1,3 (retângulo alto, do tamanho de uma pessoa).
function conferirTamanhoDosElementos(elementos: DadosDeElemento[]): void {
  for (const e of elementos) {
    const area = e.largura * e.altura;
    if (area > 0.3) {
      throw new HttpError(
        400,
        `Elemento "${e.nome}" cobre ${Math.round(area * 100)}% da foto. Elemento é uma coisa só (um rosto, uma roupa, uma mão, um objeto). O que é grande demais fica com a grade.`
      );
    }
    const alto = e.altura > 0.35 && e.altura > e.largura * 1.3;
    if ((e.categoria === 'CORPO' || e.categoria === 'OUTRO') && area > 0.08 && alto) {
      throw new HttpError(
        400,
        `Elemento "${e.nome}" parece uma pessoa inteira. Separe em partes: o rosto (ROSTO), o cabelo quando marcante, cada peça de roupa (ROUPA), mãos e pernas à mostra (CORPO), e o que a pessoa segura (OBJETO). Se é mesmo uma mão ou um braço em close, reduza o retângulo para só essa parte; se é roupa, use ROUPA.`
      );
    }
  }
}

// Máximo de partes que não são célula (elementos novos + as que ficam: manuais, imagem inteira, elementos já trabalhados).
const LIMITE_PARTES_SEM_CELULA = 28;

function dadosDoElemento(item: Args): DadosDeElemento {
  const nome = argTexto(item, 'nome').trim();
  if (nome.length < 1 || nome.length > 80) throw new HttpError(400, 'O nome do elemento deve ter de 1 a 80 caracteres');
  const x = argFracao(item, 'x');
  const y = argFracao(item, 'y');
  if (x >= 1 || y >= 1) throw new HttpError(400, 'x e y do elemento devem ser menores que 1');
  const larguraInformada = argFracao(item, 'largura');
  const alturaInformada = argFracao(item, 'altura');
  if (larguraInformada <= 0 || alturaInformada <= 0) throw new HttpError(400, 'largura e altura do elemento devem ser maiores que 0');
  const descricao = argTextoOpcional(item, 'descricao') ?? '';
  if (descricao.length > 1000) throw new HttpError(400, 'A descricao do elemento deve ter até 1000 caracteres');
  return {
    nome,
    categoria: argEscolha(item, 'categoria', CATEGORIAS),
    x,
    y,
    largura: Math.min(larguraInformada, 1 - x),
    altura: Math.min(alturaInformada, 1 - y),
    problema: argEscolha(item, 'problema', PROBLEMAS_DA_PARTE),
    gravidade: argGravidade(item, 'gravidade'),
    descricao,
  };
}

registrarFerramenta({
  nome: 'definir_elementos',
  descricao:
    'Define os elementos importantes da foto (rostos, corpos, roupas, objetos, textos), cada um inteiro no seu retângulo, e remonta a grade de reconstrução em volta deles. Substitui os elementos anteriores que ainda não foram trabalhados. Separe a foto em elementos de uma coisa só: cada rosto, cada roupa, mãos, pernas à mostra, objetos e itens do cenário, um por elemento. Nunca uma pessoa inteira como um elemento só (área máxima de 0,30 da foto; CORPO ou OUTRO não podem ter área acima de 0,08 com retângulo alto, altura acima de 0,35 e altura maior que 1,3 vez a largura; para mão ou braço em close, reduza o retângulo a essa parte; roupa é ROUPA). Partes que não são célula (elementos novos mais as que ficam) não passam de 28. Elementos não devem se sobrepor. O que for grande demais (fundo, paredes, chão) fica com a grade.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      elementos: PROP.listaDeObjetos('Elementos da foto, até 24. Cada um inteiro no seu retângulo, sem sobrepor os outros.', {
        nome: PROP.texto('Nome curto do elemento (1 a 80 caracteres).'),
        categoria: PROP.escolha(CATEGORIAS, 'Categoria do elemento.'),
        x: PROP.fracao('Fração da largura até a borda esquerda do elemento.'),
        y: PROP.fracao('Fração da altura até a borda superior do elemento.'),
        largura: PROP.fracao('Largura do elemento como fração da imagem.'),
        altura: PROP.fracao('Altura do elemento como fração da imagem.'),
        problema: PROP.escolha(PROBLEMAS_DA_PARTE, 'Problema do elemento (NENHUM = sem defeito).'),
        gravidade: PROP.inteiro('Gravidade de 1 a 5.'),
        descricao: PROP.texto('O que está errado no elemento e o que deve ser feito.'),
      }),
    },
    ['projeto_id', 'elementos']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const elementos = argListaDeObjetos(args, 'elementos', 24).map(dadosDoElemento);
    conferirTamanhoDosElementos(elementos);
    // Partes que não são célula e que ficam depois da troca (os elementos PENDENTE sem opções/vínculos/pedidos saem).
    const fixas = await prisma.regiao.count({
      where: {
        projetoId,
        classe: { not: 'CELULA' },
        NOT: {
          classe: 'ELEMENTO',
          status: 'PENDENTE',
          opcoes: { none: {} },
          vinculos: { none: {} },
          pedidos: { none: {} },
        },
      },
    });
    if (fixas + elementos.length > LIMITE_PARTES_SEM_CELULA) {
      const cabem = Math.max(0, LIMITE_PARTES_SEM_CELULA - fixas);
      throw new HttpError(
        400,
        `Só cabem ${cabem} elementos novos: ${fixas} partes que não são célula e ficam (manuais, imagem inteira ou já trabalhadas) ocupam o limite de ${LIMITE_PARTES_SEM_CELULA}. Envie no máximo ${cabem}.`
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.regiao.deleteMany({
        where: {
          projetoId,
          classe: 'ELEMENTO',
          status: 'PENDENTE',
          opcoes: { none: {} },
          // Com vínculo ou pedido de referência, a escolha do usuário ficaria perdida pela cascata: não apaga.
          vinculos: { none: {} },
          pedidos: { none: {} },
        },
      });
      for (let i = 0; i < elementos.length; i++) {
        const e = elementos[i];
        await tx.regiao.create({
          data: {
            projetoId,
            nome: e.nome,
            categoria: e.categoria,
            x: e.x,
            y: e.y,
            largura: e.largura,
            altura: e.altura,
            problema: e.problema,
            gravidade: e.gravidade,
            descricao: e.descricao,
            origem: 'IA',
            classe: 'ELEMENTO',
            ordem: i + 1,
            selecionada: e.problema !== 'NENHUM',
          },
        });
      }
    });
    const grade = await recriarGrade(projetoId);
    await recalcularStatusDoProjeto(projetoId);
    return { grade: { linhas: grade.linhas, colunas: grade.colunas }, partes: await listarPartes(projetoId) };
  },
});

registrarFerramenta({
  nome: 'classificar_partes',
  descricao: 'Classifica várias partes da grade de uma vez: o que cada uma contém (categoria) e que problema tem. Use depois de olhar as partes.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      partes: PROP.listaDeObjetos('Partes a classificar, até 40. Envie só os campos que mudam.', {
        regiao_id: PROP.inteiro('Id da parte.'),
        nome: PROP.texto('Novo nome (1 a 80 caracteres).'),
        categoria: PROP.escolha(CATEGORIAS, 'Categoria do conteúdo da parte.'),
        problema: PROP.escolha(PROBLEMAS_DA_PARTE, 'Problema da parte (NENHUM = sem defeito; deixa a parte fora do fluxo).'),
        gravidade: PROP.inteiro('Gravidade de 1 a 5.'),
        descricao: PROP.texto('Descrição do que está errado e do que fazer.'),
      }),
    },
    ['projeto_id', 'partes']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const itens = argListaDeObjetos(args, 'partes', 40);
    // Confere tudo antes de gravar: se uma parte estiver errada, nenhuma muda.
    const operacoes = [];
    for (const item of itens) {
      const regiao = await regiaoExistente(argInteiro(item, 'regiao_id'));
      regiaoDoProjeto(regiao, projetoId);
      const dados: {
        nome?: string;
        categoria?: string;
        problema?: string;
        selecionada?: boolean;
        gravidade?: number;
        descricao?: string;
      } = {};
      const nome = argTextoOpcional(item, 'nome');
      if (nome !== undefined) {
        if (nome.trim().length < 1 || nome.trim().length > 80) {
          throw new HttpError(400, 'O nome da parte deve ter de 1 a 80 caracteres');
        }
        dados.nome = nome.trim();
      }
      const categoria = argCategoriaOpcional(item, 'categoria');
      if (categoria !== undefined) dados.categoria = categoria;
      const problema = argProblemaDaParteOpcional(item, 'problema');
      if (problema !== undefined) {
        dados.problema = problema;
        dados.selecionada = problema !== 'NENHUM';
      }
      const gravidade = argGravidadeOpcional(item, 'gravidade');
      if (gravidade !== undefined) dados.gravidade = gravidade;
      const descricao = argTextoOpcional(item, 'descricao');
      if (descricao !== undefined) dados.descricao = descricao;
      operacoes.push(prisma.regiao.update({ where: { id: regiao.id }, data: dados }));
    }
    await prisma.$transaction(operacoes);
    await recalcularStatusDoProjeto(projetoId);
    return { ok: true, atualizadas: operacoes.length };
  },
});

registrarFerramenta({
  nome: 'atualizar_regiao',
  descricao:
    'Altera uma região existente. Envie só os campos que mudam. Use status para marcar andamento (PENDENTE, EM_ANDAMENTO, RESOLVIDA, IGNORADA). Use plano e ordem para registrar o plano de tratamento.',
  esquema: esquema(
    {
      regiao_id: PROP.inteiro('Id da região.'),
      nome: PROP.texto('Novo nome.'),
      x: PROP.fracao('Nova posição x (fração).'),
      y: PROP.fracao('Nova posição y (fração).'),
      largura: PROP.fracao('Nova largura (fração).'),
      altura: PROP.fracao('Nova altura (fração).'),
      problema: PROP.escolha(PROBLEMAS_DA_PARTE, 'Novo tipo de problema (NENHUM = parte sem defeito).'),
      gravidade: PROP.inteiro('Nova gravidade de 1 a 5.'),
      descricao: PROP.texto('Nova descrição.'),
      categoria: PROP.escolha(CATEGORIAS, 'Nova categoria do conteúdo da região.'),
      selecionada: PROP.booleano('Se o usuário quer reconstruir a parte. Sem ele, segue o problema (NENHUM = não selecionada).'),
      status: PROP.escolha(['PENDENTE', 'EM_ANDAMENTO', 'RESOLVIDA', 'IGNORADA'], 'Novo status da região.'),
      plano: PROP.texto('Plano de tratamento da parte: o que fazer, com qual agente e por quê. Escrito pelo conservador.'),
      ordem: PROP.inteiro('Posição da parte na ordem de tratamento (0 = primeira).'),
    },
    ['regiao_id']
  ),
  async executar(args) {
    const regiao = await regiaoExistente(argInteiro(args, 'regiao_id'));
    marcarContato(regiao.projetoId);
    const dados: {
      nome?: string;
      x?: number;
      y?: number;
      largura?: number;
      altura?: number;
      problema?: string;
      gravidade?: number;
      descricao?: string;
      categoria?: string;
      selecionada?: boolean;
      status?: string;
      plano?: string;
      ordem?: number;
    } = {};
    if (!ausente(args.nome)) dados.nome = argTexto(args, 'nome');
    dados.x = argFracaoOpcional(args, 'x');
    dados.y = argFracaoOpcional(args, 'y');
    dados.largura = argFracaoOpcional(args, 'largura');
    dados.altura = argFracaoOpcional(args, 'altura');
    const problema = argProblemaDaParteOpcional(args, 'problema');
    if (problema !== undefined) dados.problema = problema;
    dados.gravidade = argGravidadeOpcional(args, 'gravidade');
    dados.categoria = argCategoriaOpcional(args, 'categoria');
    // Sem "selecionada" explícito, a parte segue o problema (NENHUM = fora do fluxo).
    dados.selecionada = argBooleanoOpcional(args, 'selecionada') ?? (problema !== undefined ? problema !== 'NENHUM' : undefined);
    const descricao = argTextoOpcional(args, 'descricao');
    if (descricao !== undefined) dados.descricao = descricao;
    if (!ausente(args.status)) {
      dados.status = argEscolha(args, 'status', ['PENDENTE', 'EM_ANDAMENTO', 'RESOLVIDA', 'IGNORADA']);
    }
    dados.plano = argPlano(args, 'plano');
    dados.ordem = argOrdem(args, 'ordem');
    // Junta os valores novos com os atuais e encaixa o retângulo na imagem (mesma regra de criarRegiao).
    const x = dados.x ?? regiao.x;
    const y = dados.y ?? regiao.y;
    const largura = Math.min(dados.largura ?? regiao.largura, 1 - x);
    const altura = Math.min(dados.altura ?? regiao.altura, 1 - y);
    if (largura <= 0 || altura <= 0) throw new HttpError(400, 'A região ficou fora da imagem');
    dados.x = x;
    dados.y = y;
    dados.largura = largura;
    dados.altura = altura;
    // Remove as chaves não enviadas para não sobrescrever com undefined.
    for (const chave of Object.keys(dados) as (keyof typeof dados)[]) {
      if (dados[chave] === undefined) delete dados[chave];
    }
    const atualizada = await prisma.regiao.update({ where: { id: regiao.id }, data: dados });
    await recalcularStatusDoProjeto(regiao.projetoId);
    return atualizada;
  },
});

registrarFerramenta({
  nome: 'remover_regiao',
  descricao:
    'Apaga uma região que ainda está PENDENTE e não tem opção escolhida, junto com as opções dela. Use para descartar região criada por engano.',
  esquema: esquema({ regiao_id: PROP.inteiro('Id da região.') }, ['regiao_id']),
  async executar(args) {
    const regiao = await regiaoExistente(argInteiro(args, 'regiao_id'));
    marcarContato(regiao.projetoId);
    if (regiao.status !== 'PENDENTE') {
      throw new HttpError(409, `Só é possível remover região PENDENTE. A região ${regiao.id} está ${regiao.status}.`);
    }
    const opcoes = await prisma.opcao.findMany({ where: { regiaoId: regiao.id } });
    if (opcoes.some((o) => o.status === 'ESCOLHIDA')) {
      throw new HttpError(409, `A região ${regiao.id} tem opção escolhida e não pode ser removida.`);
    }
    for (const opcao of opcoes) await apagarArquivo(opcao.arquivo);
    await prisma.regiao.delete({ where: { id: regiao.id } });
    await recalcularStatusDoProjeto(regiao.projetoId);
    return { ok: true };
  },
});

// ---------- Referências ----------

registrarFerramenta({
  nome: 'pedir_referencia',
  descricao:
    'Cria um pedido de referência para o usuário enviar uma imagem (ex.: um rosto ou um objeto). Use quando a correção precisa de algo que não existe no projeto.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      descricao: PROP.texto('O que o usuário deve enviar.'),
      papel: PROP.escolha(PAPEIS, 'Papel da referência.'),
      regiao_id: PROP.inteiro('Região que a referência serviria (opcional).'),
    },
    ['projeto_id', 'descricao', 'papel']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const descricao = argTexto(args, 'descricao');
    const papel = argEscolha(args, 'papel', PAPEIS);
    const regiaoId = argInteiroOpcional(args, 'regiao_id');
    if (regiaoId !== undefined) regiaoDoProjeto(await regiaoExistente(regiaoId), projetoId);
    return criarPedido(projetoId, { descricao, papel: papel as PapelReferencia, regiaoId: regiaoId ?? null });
  },
});

registrarFerramenta({
  nome: 'vincular_referencia',
  descricao:
    'Põe uma referência no mapa de uma região, com peso de 1 (leve) a 3 (forte). Se já estiver vinculada, atualiza o peso.',
  esquema: esquema(
    {
      referencia_id: PROP.inteiro('Id da referência.'),
      regiao_id: PROP.inteiro('Id da região.'),
      peso: PROP.inteiro('Peso do vínculo, de 1 a 3.'),
    },
    ['referencia_id', 'regiao_id', 'peso']
  ),
  async executar(args) {
    const referenciaId = argInteiro(args, 'referencia_id');
    const regiaoId = argInteiro(args, 'regiao_id');
    await referenciaExistente(referenciaId);
    const regiao = await regiaoExistente(regiaoId);
    marcarContato(regiao.projetoId);
    const peso = argInteiro(args, 'peso');
    if (peso < 1 || peso > 3) throw new HttpError(400, 'Argumento "peso" deve estar entre 1 e 3');
    return vincular(referenciaId, regiaoId, peso);
  },
});

registrarFerramenta({
  nome: 'desvincular_referencia',
  descricao: 'Tira uma referência do mapa de uma região.',
  esquema: esquema(
    {
      referencia_id: PROP.inteiro('Id da referência.'),
      regiao_id: PROP.inteiro('Id da região.'),
    },
    ['referencia_id', 'regiao_id']
  ),
  async executar(args) {
    const referenciaId = argInteiro(args, 'referencia_id');
    const regiaoId = argInteiro(args, 'regiao_id');
    await referenciaExistente(referenciaId);
    const regiao = await regiaoExistente(regiaoId);
    marcarContato(regiao.projetoId);
    await desvincular(referenciaId, regiaoId);
    return { ok: true };
  },
});

registrarFerramenta({
  nome: 'gerar_referencias_canva',
  descricao:
    'Gera no Canva candidatas a referência para uma parte, a partir do recorte dela. Elas esperam o revisor; quem decide usar é o usuário. A espera é de até 100 s.',
  esquema: esquema(
    {
      regiao_id: PROP.inteiro('Id da parte.'),
      prompt: PROP.texto('O que as referências devem mostrar, em português ou inglês.'),
      quantidade: PROP.inteiro('Quantas candidatas, de 1 a 4 (padrão 4).'),
    },
    ['regiao_id', 'prompt']
  ),
  async executar(args) {
    const regiao = await regiaoExistente(argInteiro(args, 'regiao_id'));
    marcarContato(regiao.projetoId);
    const prompt = argTexto(args, 'prompt');
    const quantidade = argInteiroOpcional(args, 'quantidade') ?? 4;
    if (quantidade < 1 || quantidade > 4) throw new HttpError(400, 'Argumento "quantidade" deve estar entre 1 e 4');
    const projeto = await projetoExistente(regiao.projetoId);
    if (!(await canvaConectado(projeto.usuarioId))) {
      throw new HttpError(
        409,
        'Canva não conectado para o dono deste projeto. Use só opções locais e avise no evento.'
      );
    }
    const criadas = await gerarReferenciasCanva(regiao.id, { prompt, quantidade });
    const parar = manterContato(regiao.projetoId);
    let referencias;
    try {
      referencias = await aguardarReferencias(
        criadas.map((r) => r.id),
        100_000
      );
    } finally {
      parar();
    }
    const aindaGerando = referencias.some((r) => r.status === 'GERANDO');
    return {
      referencias: referencias.map((r) => ({ id: r.id, nome: r.nome, status: r.status, erro: r.erro })),
      ...(aindaGerando
        ? { aviso: 'Ainda gerando: consulte de novo com ver_referencia ou obter_projeto em alguns segundos.' }
        : {}),
    };
  },
});

registrarFerramenta({
  nome: 'revisar_referencia',
  descricao: 'Grava o veredito do revisor sobre uma referência gerada no Canva: APROVADA ou REPROVADA, nota de 0 a 10 e parecer.',
  esquema: esquema(
    {
      referencia_id: PROP.inteiro('Id da referência.'),
      veredito: PROP.escolha(['APROVADA', 'REPROVADA'], 'Veredito.'),
      nota: PROP.inteiro('Nota de 0 a 10.'),
      parecer: PROP.texto('Parecer curto, em português.'),
    },
    ['referencia_id', 'veredito', 'nota', 'parecer']
  ),
  async executar(args) {
    const referencia = await referenciaExistente(argInteiro(args, 'referencia_id'));
    marcarContato(referencia.projetoId);
    const veredito = argEscolha(args, 'veredito', ['APROVADA', 'REPROVADA'] as const);
    const nota = argInteiro(args, 'nota');
    if (nota < 0 || nota > 10) throw new HttpError(400, 'Argumento "nota" deve estar entre 0 e 10');
    const atualizada = await revisarReferencia(referencia.id, { veredito, nota, parecer: argTexto(args, 'parecer') });
    return { ok: true, status: atualizada.status };
  },
});

registrarFerramenta({
  nome: 'pedir_aprovacao_mapa',
  descricao:
    'Avisa o usuário que o mapa de referências está pronto e espera a aprovação dele. Chame ao terminar de montar ou rever o mapa. Antes, o projeto precisa ter elementos (definir_elementos), salvo sem_elementos. Ao pedir a aprovação, o servidor gera no Canva as candidatas das partes que não têm referência do usuário; se criar alguma, chame o revisor em modo referências para os ids devolvidos. A equipe só planeja e trata as partes depois que o usuário aprovar.',
  esquema: esquema(
    {
      projeto_id: PROP.inteiro('Id do projeto.'),
      resumo: PROP.texto('Resumo do mapa: o que ele liga e o que ainda falta (até 1000 caracteres).'),
      sem_elementos: PROP.booleano(
        'Use true só se a imagem realmente não tem elementos (um logotipo simples, uma textura). Sem elementos e sem este true, a ferramenta recusa.'
      ),
    },
    ['projeto_id', 'resumo']
  ),
  async executar(args) {
    const projetoId = argInteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const resumo = argTexto(args, 'resumo');
    if (resumo.length > 1000) throw new HttpError(400, 'Argumento "resumo" deve ter até 1000 caracteres');
    const semElementos = argBooleano(args, 'sem_elementos', false);
    const comElementos = await prisma.regiao.count({ where: { projetoId, classe: 'ELEMENTO' } });
    if (comElementos === 0 && !semElementos) {
      throw new HttpError(
        400,
        'Antes de pedir a aprovação, o analista precisa separar a foto em elementos com definir_elementos: cada rosto, cada roupa, mãos, objetos e itens do cenário, um por elemento. Se a imagem realmente não tem elementos (um logotipo simples, uma textura), chame de novo com sem_elementos: true.'
      );
    }
    await prisma.projeto.update({
      where: { id: projetoId },
      data: { mapaStatus: 'AGUARDANDO', mapaAprovadoEm: null },
    });
    await registrarEvento(projetoId, 'cartografo', 'status', 'Mapa de referências pronto para a sua aprovação. ' + resumo);
    // Erro na geração automática não derruba a ferramenta: o mapa já está AGUARDANDO e o motivo vai no resultado.
    const referenciasAutomaticas = await gerarReferenciasQueFaltam(projetoId, { automatico: true }).catch((e: unknown) => {
      const mensagem = e instanceof Error ? e.message.slice(0, 120) : 'falha desconhecida';
      return { partes: 0, criadas: 0, ids: [] as number[], motivo: `Erro ao gerar: ${mensagem}` };
    });
    return {
      ok: true,
      mapaStatus: 'AGUARDANDO',
      referenciasAutomaticas,
      ...(referenciasAutomaticas.criadas > 0
        ? { proximo: 'Chame o revisor em modo referências para esses ids antes de fechar o trabalho.' }
        : {}),
    };
  },
});

// ---------- Opções ----------

registrarFerramenta({
  nome: 'listar_filtros',
  descricao: 'Lista os filtros locais disponíveis para gerar opções sem IA, com os problemas que cada um resolve.',
  esquema: esquema({}, []),
  async executar() {
    marcarContato();
    return json(FILTROS_LOCAIS);
  },
});

registrarFerramenta({
  nome: 'gerar_opcoes_locais',
  descricao:
    'Gera opções com filtros locais (sem IA) para uma região, uma por filtro. Sem filtros, usa os indicados para o problema da região. Devolve a lista criada.',
  esquema: esquema(
    {
      regiao_id: PROP.inteiro('Id da região.'),
      filtros: PROP.lista('Códigos dos filtros (ver listar_filtros). Opcional.'),
      intensidade: PROP.inteiro('Intensidade de 1 a 3 (padrão 2).'),
      rodada: PROP.inteiro('Número da rodada (opcional).'),
    },
    ['regiao_id']
  ),
  async executar(args) {
    const regiao = await regiaoExistente(argInteiro(args, 'regiao_id'));
    marcarContato(regiao.projetoId);
    const filtros =argListaTextos(args, 'filtros');
    const intensidade = argInteiroOpcional(args, 'intensidade');
    if (intensidade !== undefined && (intensidade < 1 || intensidade > 3)) {
      throw new HttpError(400, 'Argumento "intensidade" deve estar entre 1 e 3');
    }
    const rodada = argInteiroOpcional(args, 'rodada') ?? (await proximaRodada(regiao.id));
    const opcoes = await gerarOpcoesLocais(
      regiao.id,
      filtros && filtros.length > 0 ? filtros : undefined,
      intensidade,
      rodada
    );
    return json(opcoes.map((o) => ({ id: o.id, rotulo: o.rotulo, status: o.status, rodada: o.rodada })));
  },
});

registrarFerramenta({
  nome: 'gerar_opcao_canva',
  descricao:
    'Gera uma opção no Canva para a região e espera até 100 s. Devolve a opção (PRONTA, FALHOU ou ainda GERANDO; se GERANDO, use consultar_opcao). Só funciona se o Canva estiver conectado ao dono do projeto (veja canva_disponivel).',
  esquema: esquema(
    {
      regiao_id: PROP.inteiro('Id da região.'),
      prompt: PROP.texto('O que deve ser corrigido na região, em português ou inglês.'),
      usar_referencias: PROP.booleano('Usar as referências vinculadas à região (padrão true).'),
      rodada: PROP.inteiro('Número da rodada (opcional).'),
      rotulo: PROP.texto('Nome curto para a opção (opcional).'),
    },
    ['regiao_id', 'prompt']
  ),
  async executar(args) {
    const regiao = await regiaoExistente(argInteiro(args, 'regiao_id'));
    marcarContato(regiao.projetoId);
    const prompt =argTexto(args, 'prompt');
    const usarReferencias = argBooleano(args, 'usar_referencias', true);
    const projeto = await projetoExistente(regiao.projetoId);
    if (!(await canvaConectado(projeto.usuarioId))) {
      throw new HttpError(
        409,
        'Canva não conectado para o dono deste projeto. Use só opções locais e avise no evento.'
      );
    }
    const rodada = argInteiroOpcional(args, 'rodada') ?? (await proximaRodada(regiao.id));
    const o = await gerarOpcaoCanva(regiao.id, {
      prompt,
      usarReferencias,
      rodada,
      rotulo: argTextoOpcional(args, 'rotulo'),
    });
    const parar = manterContato(projeto.id);
    let f;
    try {
      f = await aguardarOpcao(o.id, 100000);
    } finally {
      parar();
    }
    return { id: f.id, status: f.status, erro: f.erro, rotulo: f.rotulo, rodada: f.rodada };
  },
});

registrarFerramenta({
  nome: 'consultar_opcao',
  descricao:
    'Mostra o estado atual de uma opção. Se ela estiver GERANDO, espera até espera_segundos (máximo 100) para ela ficar pronta.',
  esquema: esquema(
    {
      opcao_id: PROP.inteiro('Id da opção.'),
      espera_segundos: PROP.inteiro('Segundos de espera se ainda estiver gerando (padrão 0, máximo 100).'),
    },
    ['opcao_id']
  ),
  async executar(args) {
    const opcaoId = argInteiro(args, 'opcao_id');
    const opcao = await opcaoExistente(opcaoId);
    marcarContato(opcao.projetoId);
    const espera = Math.min(Math.max(argNumeroOpcional(args, 'espera_segundos') ?? 0, 0), 100);
    const parar = manterContato(opcao.projetoId);
    let f;
    try {
      f = await aguardarOpcao(opcaoId, espera * 1000);
    } finally {
      parar();
    }
    return {
      id: f.id,
      regiaoId: f.regiaoId,
      origem: f.origem,
      rotulo: f.rotulo,
      status: f.status,
      erro: f.erro,
      rodada: f.rodada,
      nota: f.nota,
      parecer: f.parecer,
    };
  },
});

registrarFerramenta({
  nome: 'revisar_opcao',
  descricao:
    'Dá o veredito do revisor sobre uma opção PRONTA ou REPROVADA: APROVADA ou REPROVADA, nota de 0 a 10 e parecer. Reprovação exige plano_ajuste.',
  esquema: esquema(
    {
      opcao_id: PROP.inteiro('Id da opção.'),
      veredito: PROP.escolha(['APROVADA', 'REPROVADA'], 'Veredito.'),
      nota: PROP.inteiro('Nota de 0 a 10.'),
      parecer: PROP.texto('Parecer curto, em português.'),
      plano_ajuste: PROP.texto('O que ajustar na próxima rodada. Obrigatório se reprovada.'),
    },
    ['opcao_id', 'veredito', 'nota', 'parecer']
  ),
  async executar(args) {
    const opcaoId = argInteiro(args, 'opcao_id');
    const veredito = argEscolha(args, 'veredito', ['APROVADA', 'REPROVADA'] as const);
    const nota = argInteiro(args, 'nota');
    if (nota < 0 || nota > 10) throw new HttpError(400, 'Argumento "nota" deve estar entre 0 e 10');
    const parecer = argTexto(args, 'parecer');
    const planoBruto = argTextoOpcional(args, 'plano_ajuste') ?? '';
    const plano = planoBruto.trim();

    const opcao = await opcaoExistente(opcaoId);
    marcarContato(opcao.projetoId);
    if (opcao.status !== 'PRONTA' && opcao.status !== 'REPROVADA') {
      throw new HttpError(409, 'Só é possível revisar opção pronta');
    }
    if (veredito === 'REPROVADA' && plano === '') throw new HttpError(400, 'Reprovação exige plano_ajuste');

    await prisma.revisao.create({
      data: { opcaoId, veredito, nota, parecer, planoAjuste: planoBruto },
    });
    const atualizada = await prisma.opcao.update({
      where: { id: opcaoId },
      data: { nota, parecer, status: veredito === 'REPROVADA' ? 'REPROVADA' : 'PRONTA' },
    });
    const titulo = veredito === 'APROVADA' ? 'Aprovada' : 'Reprovada';
    await registrarEvento(
      opcao.projetoId,
      'revisor',
      'revisao',
      `${titulo} (nota ${nota}/10) a opção "${opcao.rotulo}": ${parecer}` +
        (plano ? ` Plano de ajuste: ${plano}` : '')
    );
    return { ok: true, status: atualizada.status };
  },
});

registrarFerramenta({
  nome: 'canva_disponivel',
  descricao: 'Diz se o Canva está conectado para o dono do projeto. Chame antes de gerar opção no Canva.',
  esquema: esquema({ projeto_id: PROP.inteiro('Id do projeto.') }, ['projeto_id']),
  async executar(args) {
    const projeto = await projetoExistente(argInteiro(args, 'projeto_id'));
    marcarContato(projeto.id);
    return { conectado: await canvaConectado(projeto.usuarioId) };
  },
});

export {};
