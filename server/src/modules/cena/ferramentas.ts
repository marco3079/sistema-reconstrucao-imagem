import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { argNumero, argTexto, argTextoOpcional, registrarFerramenta } from '../../lib/mcp';
import { resumoDaCena, validarCenaEntrada } from '../../lib/cena';
import { marcarContato } from '../agentes/servico';
import { cenaDoProjeto, definirCena, salvarCenaBlender } from './servico';

// Ferramentas MCP do mapa 3D da foto (docs/CENA.md, "Ferramentas MCP novas"). Dono: g02.
// Convenção: frações u (0 esquerda → 1 direita) e v (0 topo → 1 base) da foto. Os argumentos usam snake_case;
// convertemos para camelCase antes de validar.

type Args = Record<string, unknown>;

// ---------- Leitura de argumentos ----------

function inteiro(args: Args, nome: string): number {
  const n = argNumero(args, nome);
  if (!Number.isInteger(n)) throw new HttpError(400, `Argumento "${nome}" deve ser um número inteiro`);
  return n;
}

// Base64 dos arquivos que o Blender gerou (a ferramenta recebe texto, o servidor grava bytes).
function arquivoBase64(args: Args, nome: string): Buffer {
  const bytes = Buffer.from(argTexto(args, nome), 'base64');
  if (bytes.length === 0) throw new HttpError(400, `Argumento "${nome}" deve ser um arquivo em base64`);
  return bytes;
}

// snake_case → camelCase, recursivo (objetos e listas).
function camel(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(camel);
  if (typeof valor === 'object' && valor !== null) {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([chave, v]) => [
        chave.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
        camel(v),
      ])
    );
  }
  return valor;
}

async function projetoExistente(id: number): Promise<void> {
  const projeto = await prisma.projeto.findUnique({ where: { id }, select: { id: true } });
  if (!projeto) throw new HttpError(404, `Projeto ${id} não existe`);
}

// ---------- Esquemas ----------

function esquema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object' as const, properties, required };
}

const CAMERA = {
  type: 'object',
  description:
    'Câmera da foto. Omita o que não der para estimar: o servidor usa os padrões (campo de visão pelos pontos de fuga ou 45 graus, altura de 1.5 m, sem inclinação).',
  properties: {
    fov_vertical: {
      type: 'number',
      minimum: 10,
      maximum: 120,
      description: 'Campo de visão vertical em graus (10 a 120). Omita se não souber.',
    },
    horizonte_y: {
      type: 'number',
      minimum: -5,
      maximum: 6,
      description:
        'Linha do horizonte como fração v da foto (0 = topo, 1 = base; pode sair de 0..1). Omita se o horizonte não estiver visível ou se houver pontos de fuga.',
    },
    altura_camera: {
      type: 'number',
      minimum: 0.1,
      maximum: 50,
      description: 'Altura dos olhos da câmera acima do chão, em metros (padrão 1.5).',
    },
    inclinacao_lateral: {
      type: 'number',
      minimum: -45,
      maximum: 45,
      description: 'Rolagem da câmera em graus (padrão 0). Omita se a foto não estiver torta.',
    },
  },
  additionalProperties: false,
};

const PONTOS_DE_FUGA = {
  type: 'array',
  maxItems: 3,
  description:
    'Pontos de fuga (0 a 3). x e y são frações u e v da foto; podem sair de 0..1 (limite -20..20) quando a fuga fica fora da foto. eixo: X e Y são as duas direções horizontais perpendiculares (ex.: X = linhas que correm para a esquerda/direita, Y = linhas que se afastam da câmera); Z é a vertical (linhas verticais convergem para cima ou para baixo).',
  items: {
    type: 'object',
    properties: {
      x: { type: 'number', minimum: -20, maximum: 20, description: 'Fração u (0 esquerda → 1 direita).' },
      y: { type: 'number', minimum: -20, maximum: 20, description: 'Fração v (0 topo → 1 base).' },
      eixo: { type: 'string', enum: ['X', 'Y', 'Z'], description: 'Direção do ponto de fuga.' },
    },
    required: ['x', 'y', 'eixo'],
    additionalProperties: false,
  },
};

const VOLUMES = {
  type: 'array',
  maxItems: 24,
  description:
    'Volumes (0 a 24): uma caixa por pessoa, objeto ou parede visível na foto. A caixa (x, y, largura, altura) é em frações 0..1 da foto: x e y do canto superior esquerdo, largura e altura do tamanho. apoio CHAO quando a base do elemento toca o chão visível. altura_real em metros (opcional, padrão pelo tipo). espessura em metros no eixo Y (opcional).',
  items: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 80, description: 'Nome curto do elemento (até 80 caracteres).' },
      regiao_id: {
        type: ['integer', 'null'],
        description: 'Id da parte (região) do projeto que corresponde a este volume, se houver; senão null.',
      },
      tipo: {
        type: 'string',
        enum: ['PESSOA', 'OBJETO', 'PAREDE', 'OUTRO'],
        description: 'Tipo do elemento: PESSOA, OBJETO, PAREDE ou OUTRO.',
      },
      x: { type: 'number', minimum: 0, maximum: 1, description: 'Fração u do canto esquerdo da caixa.' },
      y: { type: 'number', minimum: 0, maximum: 1, description: 'Fração v do canto superior da caixa.' },
      largura: { type: 'number', minimum: 0, maximum: 1, description: 'Largura da caixa, fração da largura da foto.' },
      altura: { type: 'number', minimum: 0, maximum: 1, description: 'Altura da caixa, fração da altura da foto.' },
      altura_real: {
        type: ['number', 'null'],
        minimum: 0.02,
        maximum: 100,
        description: 'Altura real estimada em metros (0.02 a 100). Use null se não souber.',
      },
      espessura: {
        type: ['number', 'null'],
        minimum: 0.01,
        maximum: 100,
        description: 'Espessura em metros no eixo Y (0.01 a 100). Use null para o padrão.',
      },
      apoio: {
        type: 'string',
        enum: ['CHAO', 'SUSPENSO'],
        description: 'CHAO: a base da caixa toca o chão visível na foto. SUSPENSO: não toca (ex.: objeto no ar).',
      },
    },
    required: ['nome', 'tipo', 'x', 'y', 'largura', 'altura', 'apoio'],
    additionalProperties: false,
  },
};

const OBSERVACOES = {
  type: 'string',
  maxLength: 2000,
  description: 'Observações livres do cenógrafo sobre a cena (até 2000 caracteres). Pode ficar vazio.',
};

// ---------- Ferramentas ----------

registrarFerramenta({
  nome: 'definir_cena',
  descricao:
    'Grava o mapa 3D da foto: câmera, pontos de fuga e volumes (caixas observadas na foto). O servidor resolve a geometria, calcula a distância de cada parte e grava. Apaga os arquivos do Blender anteriores (é preciso rodar o Blender de novo). Devolve o resumo e a cena resolvida.',
  esquema: esquema(
    {
      projeto_id: { type: 'integer', description: 'Id do projeto.' },
      camera: CAMERA,
      pontos_de_fuga: PONTOS_DE_FUGA,
      volumes: VOLUMES,
      observacoes: OBSERVACOES,
    },
    ['projeto_id', 'camera', 'pontos_de_fuga', 'volumes']
  ),
  async executar(args) {
    const projetoId = inteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const entrada = validarCenaEntrada({
      camera: camel(args.camera ?? {}),
      pontosDeFuga: camel(args.pontos_de_fuga ?? []),
      volumes: camel(args.volumes ?? []),
      observacoes: argTextoOpcional(args, 'observacoes') ?? '',
    });
    const gravada = await definirCena(projetoId, entrada);
    return { resumo: resumoDaCena(gravada.resolvida), cena: gravada.resolvida };
  },
});

registrarFerramenta({
  nome: 'obter_cena',
  descricao:
    'Mostra o mapa 3D gravado do projeto (entrada, cena resolvida e arquivos do Blender) e o resumo em português. cena é null se o projeto não tem mapa 3D.',
  esquema: esquema({ projeto_id: { type: 'integer', description: 'Id do projeto.' } }, ['projeto_id']),
  async executar(args) {
    const projetoId = inteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const cena = await cenaDoProjeto(projetoId);
    return { cena, resumo: cena ? resumoDaCena(cena.resolvida) : null };
  },
});

registrarFerramenta({
  nome: 'salvar_cena_blender',
  descricao:
    'Grava o que o Blender montou para a cena já definida: profundidade_png (mapa de profundidade), volumes_png (volumes RGBA) e glb (cena em glTF), os três em base64, e a versão do Blender. O servidor monta a prévia, recalcula a profundidade de cada parte pelo mapa e devolve as partes. Exige cena definida (definir_cena antes).',
  esquema: esquema(
    {
      projeto_id: { type: 'integer', description: 'Id do projeto.' },
      profundidade_png: {
        type: 'string',
        description: 'PNG em tons de cinza, em base64: branco = perto, preto = longe ou vazio. Até 1,2 MB.',
      },
      volumes_png: {
        type: 'string',
        description: 'PNG RGBA em base64, fundo transparente, com os volumes vistos pela câmera. Até 1,2 MB.',
      },
      glb: { type: 'string', description: 'Cena em glTF binário (.glb) em base64. Até 1,2 MB.' },
      versao: { type: 'string', description: 'Versão do Blender que montou a cena (ex.: "5.2.0").' },
    },
    ['projeto_id', 'profundidade_png', 'volumes_png', 'glb', 'versao']
  ),
  async executar(args) {
    const projetoId = inteiro(args, 'projeto_id');
    marcarContato(projetoId);
    await projetoExistente(projetoId);
    const partes = await salvarCenaBlender(projetoId, {
      profundidadePng: arquivoBase64(args, 'profundidade_png'),
      volumesPng: arquivoBase64(args, 'volumes_png'),
      glb: arquivoBase64(args, 'glb'),
      versao: argTexto(args, 'versao'),
    });
    return {
      ok: true,
      partes: partes.map((p) => ({ regiao_id: p.regiaoId, nome: p.nome, profundidade: p.profundidade })),
    };
  },
});
