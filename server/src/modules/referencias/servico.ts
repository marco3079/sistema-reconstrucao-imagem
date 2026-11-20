import sharp from 'sharp';
import type { PedidoReferencia, Projeto, Referencia, Regiao, Vinculo } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { apagarArquivo, lerArquivo, salvarArquivo } from '../../lib/arquivos';
import { contextoDaRegiao, recortar, retanguloDaRegiao } from '../../lib/imagem';
import { canvaConectado, enviarImagemAoCanva, gerarImagemNoCanva, proporcaoMaisProxima } from '../../lib/canva';
import { registrarEvento } from '../agentes/servico';

export type PapelReferencia = 'ROSTO' | 'OBJETO' | 'ESTILO' | 'COR' | 'TEXTO' | 'CENARIO' | 'GERAL';

export const PAPEIS: PapelReferencia[] = ['ROSTO', 'OBJETO', 'ESTILO', 'COR', 'TEXTO', 'CENARIO', 'GERAL'];

// Papel da referência gerada, pela categoria da parte.
const PAPEL_DA_CATEGORIA: Partial<Record<string, PapelReferencia>> = {
  ROSTO: 'ROSTO',
  TEXTO: 'TEXTO',
  CORPO: 'OBJETO',
  ROUPA: 'OBJETO',
  OBJETO: 'OBJETO',
  FUNDO: 'CENARIO',
  COR: 'COR',
};

// Cria um pedido de referência. Se já existir um pedido não atendido com a mesma descrição
// (sem diferenciar maiúsculas) no projeto, devolve o existente.
export async function criarPedido(
  projetoId: number,
  dados: { descricao: string; papel: PapelReferencia; regiaoId?: number | null }
): Promise<PedidoReferencia> {
  const descricao = (dados.descricao ?? '').trim();
  if (descricao.length < 3 || descricao.length > 500) {
    throw new HttpError(400, 'Descrição do pedido inválida');
  }
  if (!PAPEIS.includes(dados.papel)) {
    throw new HttpError(400, 'Papel inválido');
  }
  const regiaoId = dados.regiaoId ?? null;
  if (regiaoId !== null) {
    const regiao = await prisma.regiao.findUnique({ where: { id: regiaoId } });
    if (!regiao || regiao.projetoId !== projetoId) {
      throw new HttpError(400, 'Região não pertence ao projeto');
    }
  }
  const existente = await prisma.pedidoReferencia.findFirst({
    where: { projetoId, atendido: false, descricao: { equals: descricao, mode: 'insensitive' } },
    orderBy: { id: 'asc' },
  });
  if (existente) return existente;
  return prisma.pedidoReferencia.create({
    data: { projetoId, descricao, papel: dados.papel, regiaoId },
  });
}

// Limite de referências geradas ativas (não reprovadas nem falhas) por imagem.
// 4 candidatas para cada uma das até 32 partes.
const LIMITE_GERADAS = 128;

// Fila em memória por usuário: as gerações do Canva de um mesmo usuário rodam uma após a outra.
const filasCanva = new Map<number, Promise<void>>();

function enfileirarGeracao(usuarioId: number, tarefa: () => Promise<void>): void {
  const anterior = filasCanva.get(usuarioId) ?? Promise.resolve();
  const atual: Promise<void> = anterior.then(tarefa).catch(() => undefined);
  filasCanva.set(usuarioId, atual);
  void atual.then(() => {
    if (filasCanva.get(usuarioId) === atual) filasCanva.delete(usuarioId);
  });
}

// Cria ou atualiza o vínculo (peso de 1 a 3). Lança HttpError(400) se referência e região forem de projetos diferentes.
export async function vincular(referenciaId: number, regiaoId: number, peso: number): Promise<Vinculo> {
  const referencia = await prisma.referencia.findUnique({ where: { id: referenciaId } });
  if (!referencia) throw new HttpError(404, 'Referência não encontrada');
  if (referencia.status !== 'APROVADA') {
    throw new HttpError(409, 'Só referência aprovada pode entrar no mapa');
  }
  const regiao = await prisma.regiao.findUnique({ where: { id: regiaoId } });
  if (!regiao) throw new HttpError(404, 'Região não encontrada');
  if (referencia.projetoId !== regiao.projetoId) {
    throw new HttpError(400, 'Referência e região são de projetos diferentes');
  }
  // Peso inteiro entre 1 e 3 (valor inválido vira 2, o padrão do schema).
  const pesoLimpo = Number.isFinite(peso) ? Math.min(3, Math.max(1, Math.round(peso))) : 2;
  return prisma.vinculo.upsert({
    where: { referenciaId_regiaoId: { referenciaId, regiaoId } },
    create: { referenciaId, regiaoId, peso: pesoLimpo },
    update: { peso: pesoLimpo },
  });
}

export async function desvincular(referenciaId: number, regiaoId: number): Promise<void> {
  await prisma.vinculo.deleteMany({ where: { referenciaId, regiaoId } });
}

// Acrescenta vínculos óbvios sem apagar os que existem e devolve o mapa inteiro do projeto.
// Só referências APROVADAS entram no mapa (referência gerada espera o revisor e o usuário).
export async function sugerirMapa(projetoId: number): Promise<Vinculo[]> {
  const [referencias, regioes, pedidos] = await Promise.all([
    prisma.referencia.findMany({ where: { projetoId }, include: { vinculos: true }, orderBy: { id: 'asc' } }),
    prisma.regiao.findMany({ where: { projetoId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }),
    prisma.pedidoReferencia.findMany({ where: { projetoId }, orderBy: { id: 'asc' } }),
  ]);
  const regioesAbertas = regioes.filter((r) => r.status === 'PENDENTE' || r.status === 'EM_ANDAMENTO');

  for (const referencia of referencias) {
    if (referencia.status !== 'APROVADA') continue;
    let temVinculo = referencia.vinculos.length > 0;

    // Pedidos atendidos por esta referência indicam a região exata: peso 3.
    for (const pedido of pedidos) {
      if (pedido.referenciaId === referencia.id && pedido.regiaoId !== null) {
        await vincular(referencia.id, pedido.regiaoId, 3);
        temVinculo = true;
      }
    }

    // Sem nenhum vínculo: liga a todas as regiões abertas.
    if (!temVinculo) {
      const peso = ['GERAL', 'ESTILO', 'COR'].includes(referencia.papel) ? 2 : 1;
      for (const regiao of regioesAbertas) {
        await vincular(referencia.id, regiao.id, peso);
      }
    }
  }

  return prisma.vinculo.findMany({
    where: { regiao: { projetoId } },
    orderBy: { id: 'asc' },
  });
}

// Texto padrão (em inglês) para gerar uma referência fiel de uma parte.
export function promptDeReferencia(projeto: Projeto, regiao: Regiao, instrucoes?: string): string {
  const analise = projeto.analise as { promptBase?: unknown; descricao?: unknown } | null;
  let descricao = '';
  if (analise && typeof analise.promptBase === 'string' && analise.promptBase.trim()) {
    descricao = analise.promptBase.trim();
  } else if (analise && typeof analise.descricao === 'string' && analise.descricao.trim()) {
    descricao = analise.descricao.trim();
  }

  const partes: string[] = ['This is a crop of a damaged or low-quality image.'];
  if (descricao) partes.push(`The full picture shows: ${descricao}.`);
  partes.push(`Part: ${regiao.nome}. Category: ${regiao.categoria}.`);
  if (regiao.descricao.trim()) partes.push(`Details: ${regiao.descricao.trim()}.`);
  partes.push(
    'Recreate this exact crop as a clean, sharp, faithful reference: same subject, same pose and framing, same colors and lighting. Do not add or remove anything. No text, frame or watermark.'
  );
  if (instrucoes && instrucoes.trim()) partes.push(`Extra instructions: ${instrucoes.trim()}`);
  return partes.join(' ');
}

// Cria `quantidade` referências (1 a 4) com origem CANVA para a parte e começa a geração em segundo plano.
export async function gerarReferenciasCanva(
  regiaoId: number,
  dados: { prompt: string; quantidade: number }
): Promise<Referencia[]> {
  const texto = (dados.prompt ?? '').trim();
  if (!texto) throw new HttpError(400, 'Prompt vazio');
  if (!Number.isInteger(dados.quantidade) || dados.quantidade < 1 || dados.quantidade > 4) {
    throw new HttpError(400, 'Quantidade deve ser de 1 a 4');
  }
  const regiao = await prisma.regiao.findUnique({ where: { id: regiaoId }, include: { projeto: true } });
  if (!regiao) throw new HttpError(404, 'Região não encontrada');

  const ativas = await prisma.referencia.count({
    where: { projetoId: regiao.projetoId, origem: 'CANVA', status: { notIn: ['REPROVADA', 'FALHOU'] } },
  });
  if (ativas + dados.quantidade > LIMITE_GERADAS) {
    throw new HttpError(409, 'Limite de opções geradas desta imagem. Apague as que não vai usar.');
  }

  const existentes = await prisma.referencia.count({ where: { regiaoId, origem: 'CANVA' } });
  const papel: PapelReferencia = PAPEL_DA_CATEGORIA[regiao.categoria] ?? 'GERAL';

  const criadas: Referencia[] = [];
  for (let k = 0; k < dados.quantidade; k++) {
    const referencia = await prisma.referencia.create({
      data: {
        projetoId: regiao.projetoId,
        nome: `${regiao.nome} (Canva ${existentes + k + 1})`,
        arquivo: '',
        largura: 0,
        altura: 0,
        papel,
        origem: 'CANVA',
        regiaoId,
        status: 'GERANDO',
        prompt: texto,
      },
    });
    criadas.push(referencia);
  }

  // Uma de cada vez, em sequência, e as gerações do mesmo usuário também entram na fila.
  const ids = criadas.map((r) => r.id);
  enfileirarGeracao(regiao.projeto.usuarioId, async () => {
    for (const id of ids) {
      await processarReferencia(id);
    }
  });

  return criadas;
}

// ---------- Referências que faltam (geradas no Canva sem clique parte por parte) ----------

export interface ResultadoReferenciasFaltantes {
  partes: number; // partes que não tinham referência sua nem gerada em andamento
  criadas: number; // referências GERANDO criadas agora
  ids: number[];
  motivo: string | null;
}

// Uma fila por projeto: duas chamadas seguidas não geram a mesma parte duas vezes.
const filasFaltantes = new Map<number, Promise<unknown>>();

// Teto de candidatas do Canva por parte (conta todas, de qualquer status).
const TETO_CANDIDATAS_POR_PARTE = 8;

export async function gerarReferenciasQueFaltam(
  projetoId: number,
  opcoes: { automatico?: boolean } = {}
): Promise<ResultadoReferenciasFaltantes> {
  const anterior = filasFaltantes.get(projetoId) ?? Promise.resolve();
  const atual: Promise<ResultadoReferenciasFaltantes> = anterior
    .catch(() => undefined)
    .then(() => gerarFaltantesAgora(projetoId, opcoes.automatico === true));
  filasFaltantes.set(projetoId, atual);
  try {
    return await atual;
  } finally {
    if (filasFaltantes.get(projetoId) === atual) filasFaltantes.delete(projetoId);
  }
}

// Partes elegíveis: elemento ou célula, com defeito, pendentes, sem referência do usuário e sem geração em andamento.
// Ordem: elementos antes das células, depois ordem e id.
// `automatico`: só partes com ZERO candidatas do Canva (chamada vinda de pedir_aprovacao_mapa).
async function partesSemReferencia(projetoId: number, automatico: boolean): Promise<Regiao[]> {
  // Quantas candidatas do Canva cada parte já tem (de qualquer status).
  const contagens = await prisma.referencia.groupBy({
    by: ['regiaoId'],
    where: { projetoId, origem: 'CANVA', regiaoId: { not: null } },
    _count: { _all: true },
  });
  const porParte = new Map(contagens.map((c) => [c.regiaoId, c._count._all] as const));
  const candidatas = await prisma.regiao.findMany({
    where: {
      projetoId,
      selecionada: true,
      problema: { not: 'NENHUM' },
      status: 'PENDENTE',
      classe: { in: ['ELEMENTO', 'CELULA'] },
      vinculos: { none: { referencia: { origem: 'USUARIO' } } },
    },
  });
  const emGeracao = await prisma.referencia.findMany({
    where: {
      projetoId,
      origem: 'CANVA',
      regiaoId: { not: null },
      status: { in: ['GERANDO', 'PENDENTE', 'APROVADA'] },
    },
    select: { regiaoId: true },
  });
  const ocupadas = new Set(emGeracao.map((r) => r.regiaoId));
  return candidatas
    .filter((r) => !ocupadas.has(r.id))
    .filter((r) => {
      const total = porParte.get(r.id) ?? 0;
      if (total >= TETO_CANDIDATAS_POR_PARTE) return false;
      return !automatico || total === 0;
    })
    .sort((a, b) => {
      if (a.classe !== b.classe) return a.classe === 'ELEMENTO' ? -1 : 1;
      return a.ordem - b.ordem || a.id - b.id;
    });
}

async function gerarFaltantesAgora(projetoId: number, automatico: boolean): Promise<ResultadoReferenciasFaltantes> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) throw new HttpError(404, 'Projeto não encontrado');

  let motivo: string | null = null;
  let partes = 0;
  let criadas = 0;
  const ids: number[] = [];

  if (!(await canvaConectado(projeto.usuarioId))) {
    motivo = 'Canva não conectado';
  } else {
    const candidatas = await partesSemReferencia(projetoId, automatico);
    partes = candidatas.length;
    for (const regiao of candidatas) {
      try {
        const refs = await gerarReferenciasCanva(regiao.id, {
          prompt: promptDeReferencia(projeto, regiao),
          quantidade: 4,
        });
        criadas += refs.length;
        ids.push(...refs.map((r) => r.id));
      } catch (e) {
        // Erro de uma parte não derruba o resto: para, devolve o que já foi criado e diz o motivo.
        if (e instanceof HttpError && e.status === 409) {
          motivo = 'Parou ao bater o limite de opções geradas desta imagem.';
        } else {
          const mensagem = e instanceof Error ? e.message.slice(0, 120) : 'falha desconhecida';
          motivo = `Erro ao gerar: ${mensagem}`;
        }
        break;
      }
    }
  }

  const texto =
    motivo === 'Canva não conectado'
      ? 'Não gerei referências no Canva para as partes sem referência sua: Canva não conectado.'
      : partes === 0
        ? 'Nenhuma parte precisa de referência gerada no Canva: todas já têm referência sua ou em geração.'
        : `Gerando no Canva ${criadas} candidatas a referência para ${partes} partes que não têm referência sua.` +
          (motivo ? ' ' + motivo : '');
  await registrarEvento(projetoId, 'sistema', 'acao', texto);

  return { partes, criadas, ids, motivo };
}

// Recorte da parte (com margem) enviado ao Canva; a imagem gerada vira referência PENDENTE.
async function processarReferencia(referenciaId: number): Promise<void> {
  let arquivoSalvo: string | null = null;
  try {
    const referencia = await prisma.referencia.findUnique({ where: { id: referenciaId } });
    if (!referencia) throw new HttpError(404, 'Referência não encontrada');
    if (referencia.regiaoId === null) throw new HttpError(409, 'Referência sem parte');
    const regiao = await prisma.regiao.findUnique({
      where: { id: referencia.regiaoId },
      include: { projeto: true },
    });
    if (!regiao) throw new HttpError(404, 'Região não encontrada');
    const projeto = regiao.projeto;

    const atual = await lerArquivo(projeto.atualArquivo);
    const ret = retanguloDaRegiao(regiao, projeto.largura, projeto.altura);
    const contexto = contextoDaRegiao(ret, projeto.largura, projeto.altura, 0.15);
    const recorte = await recortar(atual, contexto);
    const idRecorte = await enviarImagemAoCanva(projeto.usuarioId, recorte, 'restaura-parte-' + regiao.id + '.png');

    const gerada = await gerarImagemNoCanva(projeto.usuarioId, {
      prompt: referencia.prompt,
      referencias: [idRecorte],
      proporcao: proporcaoMaisProxima(contexto.largura, contexto.altura),
    });
    const png = await sharp(gerada).png().toBuffer();
    const meta = await sharp(png).metadata();
    const arquivo = await salvarArquivo(png, 'png');
    arquivoSalvo = arquivo;

    await prisma.referencia.update({
      where: { id: referencia.id },
      data: { arquivo, largura: meta.width ?? 0, altura: meta.height ?? 0, status: 'PENDENTE' },
    });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error('Falha ao gerar referência do Canva', referenciaId, mensagem);
    // Arquivo já salvo sem referência gravada (ex.: referência apagada no meio): não deixa órfão.
    if (arquivoSalvo) await apagarArquivo(arquivoSalvo).catch(() => undefined);
    await prisma.referencia
      .update({ where: { id: referenciaId }, data: { status: 'FALHOU', erro: mensagem.slice(0, 500) } })
      .catch(() => undefined);
  }
}

// Espera as referências saírem de GERANDO, até `limiteMs`. Devolve o estado atual de todas.
export async function aguardarReferencias(ids: number[], limiteMs: number): Promise<Referencia[]> {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const atuais = await prisma.referencia.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const resta = fim - Date.now();
    if (!atuais.some((r) => r.status === 'GERANDO') || resta <= 0) return atuais;
    await new Promise<void>((resolver) => setTimeout(resolver, Math.min(2000, resta)));
  }
}

// Veredito do revisor numa referência gerada. Reprovada perde os vínculos.
export async function revisarReferencia(
  referenciaId: number,
  dados: { veredito: 'APROVADA' | 'REPROVADA'; nota: number; parecer: string }
): Promise<Referencia> {
  const referencia = await prisma.referencia.findUnique({ where: { id: referenciaId } });
  if (!referencia) throw new HttpError(404, 'Referência não encontrada');
  if (
    referencia.origem !== 'CANVA' ||
    !['PENDENTE', 'APROVADA', 'REPROVADA'].includes(referencia.status)
  ) {
    throw new HttpError(409, 'Só é possível revisar referência gerada e pronta');
  }
  if (!Number.isInteger(dados.nota) || dados.nota < 0 || dados.nota > 10) {
    throw new HttpError(400, 'Nota deve ser de 0 a 10');
  }
  const parecer = (dados.parecer ?? '').trim();

  const atualizada = await prisma.referencia.update({
    where: { id: referencia.id },
    data: { status: dados.veredito, nota: dados.nota, parecer },
  });
  if (dados.veredito === 'REPROVADA') {
    await prisma.vinculo.deleteMany({ where: { referenciaId: referencia.id } });
  }

  const regiao = referencia.regiaoId !== null
    ? await prisma.regiao.findUnique({ where: { id: referencia.regiaoId } })
    : null;
  const nomeParte = regiao?.nome ?? referencia.nome;
  const resultado = dados.veredito === 'APROVADA' ? 'aprovada' : 'reprovada';
  await registrarEvento(
    referencia.projetoId,
    'revisor',
    'revisao',
    `Referência ${resultado} (nota ${dados.nota}/10) para a parte "${nomeParte}": ${parecer}`
  );
  return atualizada;
}

// Na carga do servidor: referências presas em GERANDO (servidor reiniciado) viram FALHOU.
export async function falharReferenciasPresas(): Promise<void> {
  await prisma.referencia.updateMany({
    where: { status: 'GERANDO' },
    data: { status: 'FALHOU', erro: 'A geração foi interrompida. Gere de novo.' },
  });
}
