import { HttpError } from './erros';

// Contrato em docs/CENA.md. Funções puras: sem banco, sem disco, sem sharp.

export type TipoVolume = 'PESSOA' | 'OBJETO' | 'PAREDE' | 'OUTRO';
export type ApoioVolume = 'CHAO' | 'SUSPENSO';

export interface PontoDeFuga { x: number; y: number; eixo: 'X' | 'Y' | 'Z' }

export interface VolumeEntrada {
  nome: string;
  regiaoId?: number | null;
  tipo: TipoVolume;
  x: number; y: number; largura: number; altura: number;
  alturaReal?: number | null;
  espessura?: number | null;
  apoio: ApoioVolume;
}

export interface CenaEntrada {
  camera: {
    fovVertical?: number | null;
    horizonteY?: number | null;
    alturaCamera?: number | null;
    inclinacaoLateral?: number | null;
  };
  pontosDeFuga: PontoDeFuga[];
  volumes: VolumeEntrada[];
  observacoes: string;
}

export interface Vetor3 { x: number; y: number; z: number }

export interface VolumeResolvido {
  nome: string;
  regiaoId: number | null;
  tipo: TipoVolume;
  caixa: { x: number; y: number; largura: number; altura: number };
  centro: Vetor3;
  tamanho: Vetor3;
  distancia: number;
  metodo: 'CHAO' | 'TAMANHO';
  camada: number;
}

export interface CenaResolvida {
  versao: 1;
  largura: number; altura: number;
  camera: {
    fovVertical: number;
    foco: number;
    inclinacao: number;
    rolagem: number;
    altura: number;
    horizonteY: number;
    origemFoco: 'PONTOS_DE_FUGA' | 'ESTIMADO' | 'PADRAO';
  };
  pontosDeFuga: PontoDeFuga[];
  volumes: VolumeResolvido[];
  limites: { perto: number; longe: number };
  avisos: string[];
}

export interface CenaGravada {
  entrada: CenaEntrada;
  resolvida: CenaResolvida;
  blender: null | {
    profundidadeArquivo: string;
    volumesArquivo: string;
    previaArquivo: string;
    glbArquivo: string;
    versao: string;
    feitoEm: string;
  };
  atualizadaEm: string;
}

export interface ParteParaCena { id?: number; x: number; y: number; largura: number; altura: number; profundidade?: number | null }

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const TIPOS: TipoVolume[] = ['PESSOA', 'OBJETO', 'PAREDE', 'OUTRO'];
const APOIOS: ApoioVolume[] = ['CHAO', 'SUSPENSO'];
const EIXOS: string[] = ['X', 'Y', 'Z'];

function falha(mensagem: string): never {
  throw new HttpError(400, mensagem);
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numero(v: unknown, rotulo: string, min: number, max: number, pre: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) falha(`${pre}${rotulo} deve ser um número`);
  if (v < min || v > max) falha(`${pre}${rotulo} deve estar entre ${min} e ${max}`);
  return v;
}

function estaVazio(v: unknown): boolean {
  return v === undefined || v === null;
}

function fracao(v: unknown, rotulo: string, pre: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) {
    falha(`${pre}${rotulo} deve estar entre 0 e 1 (sem chegar a 1)`);
  }
  return v;
}

function positivo(v: unknown, rotulo: string, pre: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) falha(`${pre}${rotulo} deve ser maior que 0`);
  return v;
}

function validarCamera(bruto: unknown): CenaEntrada['camera'] {
  if (estaVazio(bruto)) return {};
  if (!ehObjeto(bruto)) falha('camera deve ser um objeto');
  const cam: CenaEntrada['camera'] = {};
  if (!estaVazio(bruto.fovVertical)) cam.fovVertical = numero(bruto.fovVertical, 'camera.fovVertical (graus)', 10, 120, '');
  if (!estaVazio(bruto.horizonteY)) cam.horizonteY = numero(bruto.horizonteY, 'camera.horizonteY', -5, 6, '');
  if (!estaVazio(bruto.alturaCamera)) cam.alturaCamera = numero(bruto.alturaCamera, 'camera.alturaCamera (metros)', 0.1, 50, '');
  if (!estaVazio(bruto.inclinacaoLateral)) cam.inclinacaoLateral = numero(bruto.inclinacaoLateral, 'camera.inclinacaoLateral (graus)', -45, 45, '');
  return cam;
}

function validarPontos(bruto: unknown): PontoDeFuga[] {
  if (estaVazio(bruto)) return [];
  if (!Array.isArray(bruto)) falha('pontosDeFuga deve ser uma lista');
  if (bruto.length > 3) falha('No máximo 3 pontos de fuga');
  const usados = new Set<string>();
  return bruto.map((item: unknown, i: number): PontoDeFuga => {
    const pre = `Ponto de fuga ${i + 1}: `;
    if (!ehObjeto(item)) falha(`${pre}formato inválido`);
    const eixo = item.eixo;
    if (typeof eixo !== 'string' || !EIXOS.includes(eixo)) falha(`${pre}eixo deve ser X, Y ou Z`);
    if (usados.has(eixo)) falha(`Eixo ${eixo} repetido: no máximo um ponto de fuga por eixo`);
    usados.add(eixo);
    return {
      x: numero(item.x, 'x', -20, 20, pre),
      y: numero(item.y, 'y', -20, 20, pre),
      eixo: eixo as PontoDeFuga['eixo'],
    };
  });
}

function validarVolumes(bruto: unknown): VolumeEntrada[] {
  if (estaVazio(bruto)) return [];
  if (!Array.isArray(bruto)) falha('volumes deve ser uma lista');
  if (bruto.length > 24) falha('No máximo 24 volumes');
  return bruto.map((item: unknown, i: number): VolumeEntrada => {
    const pre = `Volume ${i + 1}: `;
    if (!ehObjeto(item)) falha(`${pre}formato inválido`);
    const nome = typeof item.nome === 'string' ? item.nome.trim() : '';
    if (nome.length < 1 || nome.length > 80) falha(`${pre}nome deve ter de 1 a 80 caracteres`);
    let regiaoId: number | null = null;
    if (!estaVazio(item.regiaoId)) {
      if (typeof item.regiaoId !== 'number' || !Number.isInteger(item.regiaoId)) falha(`${pre}regiaoId deve ser um número inteiro`);
      regiaoId = item.regiaoId;
    }
    const tipo = item.tipo;
    if (typeof tipo !== 'string' || !TIPOS.includes(tipo as TipoVolume)) {
      falha(`${pre}tipo deve ser PESSOA, OBJETO, PAREDE ou OUTRO`);
    }
    const x = fracao(item.x, 'x', pre);
    const y = fracao(item.y, 'y', pre);
    const largura0 = positivo(item.largura, 'largura', pre);
    const altura0 = positivo(item.altura, 'altura', pre);
    let alturaReal: number | null = null;
    if (!estaVazio(item.alturaReal)) alturaReal = numero(item.alturaReal, 'alturaReal (metros)', 0.02, 100, pre);
    let espessura: number | null = null;
    if (!estaVazio(item.espessura)) espessura = numero(item.espessura, 'espessura (metros)', 0.01, 100, pre);
    const apoio = item.apoio;
    if (typeof apoio !== 'string' || !APOIOS.includes(apoio as ApoioVolume)) {
      falha(`${pre}apoio deve ser CHAO ou SUSPENSO`);
    }
    return {
      nome,
      regiaoId,
      tipo: tipo as TipoVolume,
      x,
      y,
      largura: Math.min(largura0, 1 - x),
      altura: Math.min(altura0, 1 - y),
      alturaReal,
      espessura,
      apoio: apoio as ApoioVolume,
    };
  });
}

export function validarCenaEntrada(bruto: unknown): CenaEntrada {
  if (!ehObjeto(bruto)) falha('Cena inválida: envie um objeto com camera, pontosDeFuga, volumes e observacoes');
  const obs = bruto.observacoes;
  if (!estaVazio(obs) && (typeof obs !== 'string' || obs.length > 2000)) {
    falha('observacoes deve ser um texto de até 2000 caracteres');
  }
  return {
    camera: validarCamera(bruto.camera),
    pontosDeFuga: validarPontos(bruto.pontosDeFuga),
    volumes: validarVolumes(bruto.volumes),
    observacoes: typeof obs === 'string' ? obs : '',
  };
}

// ---------------------------------------------------------------------------
// Resolução (9 passos de docs/CENA.md)
// ---------------------------------------------------------------------------

const PADRAO_ALTURA: Record<TipoVolume, number> = { PESSOA: 1.7, OBJETO: 0.5, PAREDE: 2.6, OUTRO: 1.0 };

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function limitar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function graus(rad: number): number {
  return (rad * 180) / Math.PI;
}

function rad(g: number): number {
  return (g * Math.PI) / 180;
}

export function resolverCena(entrada: CenaEntrada, largura: number, altura: number): CenaResolvida {
  const a = largura / altura;
  const avisos: string[] = [];
  const cam = entrada.camera ?? {};

  // Passo 1: rolagem. Coordenadas normalizadas: xn = (u - 0.5) * a, yn = 0.5 - v.
  const norm = (u: number, v: number) => ({ x: (u - 0.5) * a, y: 0.5 - v });
  const pX = entrada.pontosDeFuga.find((p) => p.eixo === 'X');
  const pY = entrada.pontosDeFuga.find((p) => p.eixo === 'Y');

  let rolagemGraus = cam.inclinacaoLateral ?? 0;
  if (pX && pY) {
    const nX = norm(pX.x, pX.y);
    const nY = norm(pY.x, pY.y);
    let ang = graus(Math.atan2(nY.y - nX.y, nY.x - nX.x));
    if (ang > 90) ang -= 180;
    else if (ang <= -90) ang += 180;
    if (Math.abs(ang) > 45) {
      avisos.push(`Inclinação lateral dos pontos de fuga (${ang.toFixed(1)} graus) limitada a 45 graus`);
    }
    rolagemGraus = limitar(ang, -45, 45);
  }
  const cr = Math.cos(rad(rolagemGraus));
  const sr = Math.sin(rad(rolagemGraus));
  // Gira por -rolagem em torno do centro.
  const girar = (p: { x: number; y: number }) => ({ x: p.x * cr + p.y * sr, y: -p.x * sr + p.y * cr });

  const rX = pX ? girar(norm(pX.x, pX.y)) : null;
  const rY = pY ? girar(norm(pY.x, pY.y)) : null;

  // Passo 2: foco f.
  let fovBruto: number;
  let origemFoco: CenaResolvida['camera']['origemFoco'];
  if (rX && rY && rX.x * rY.x + rX.y * rY.y < 0) {
    const f0 = Math.sqrt(-(rX.x * rY.x + rX.y * rY.y));
    fovBruto = graus(2 * Math.atan(0.5 / f0));
    origemFoco = 'PONTOS_DE_FUGA';
  } else if (cam.fovVertical !== undefined && cam.fovVertical !== null) {
    fovBruto = cam.fovVertical;
    origemFoco = 'ESTIMADO';
  } else {
    fovBruto = 45;
    origemFoco = 'PADRAO';
  }
  const fovGraus = limitar(fovBruto, 15, 100);
  if (fovGraus !== fovBruto) {
    avisos.push(`Campo de visão ajustado de ${fovBruto.toFixed(1)} para ${fovGraus.toFixed(1)} graus (limite de 15 a 100)`);
  }
  const f = 0.5 / Math.tan(rad(fovGraus) / 2);

  // Passo 3: horizonte yh (normalizado).
  const ysPontos = [rX, rY].filter((p): p is { x: number; y: number } => p !== null).map((p) => p.y);
  let yh: number;
  if (ysPontos.length > 0) yh = ysPontos.reduce((s, y) => s + y, 0) / ysPontos.length;
  else if (cam.horizonteY !== undefined && cam.horizonteY !== null) yh = 0.5 - cam.horizonteY;
  else yh = 0;

  // Passo 4: inclinação.
  const thetaRad = -Math.atan(yh / f);
  const inclinacao = graus(thetaRad);
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);

  // Passo 5: altura da câmera.
  const hc = cam.alturaCamera ?? 1.5;

  // Passo 6: raio de um ponto (já girado).
  const raio = (p: { x: number; y: number }): Vetor3 => ({
    x: p.x,
    y: f * cosT - p.y * sinT,
    z: f * sinT + p.y * cosT,
  });

  // Passo 7: volumes.
  const brutos: { volume: VolumeResolvido; distancia: number }[] = [];
  for (const v of entrada.volumes) {
    const cxImg = v.x + v.largura / 2;
    const dB = raio(girar(norm(cxImg, v.y + v.altura)));
    const dT = raio(girar(norm(cxImg, v.y)));
    const dC = raio(girar(norm(cxImg, v.y + v.altura / 2)));
    const H = v.alturaReal ?? PADRAO_ALTURA[v.tipo];

    let centro: Vetor3;
    let metodo: VolumeResolvido['metodo'];
    let tamZ: number;

    // Altura que o método do chão daria. Perto do horizonte o cálculo é mal condicionado (um erro pequeno
    // no horizonte informado vira metros de erro), então, quando o resultado foge muito da altura real
    // informada, vale a altura real (método TAMANHO).
    let chaoConfiavel = v.apoio === 'CHAO' && v.y + v.altura < 0.985 && dB.z < -0.001;
    if (chaoConfiavel && v.alturaReal !== undefined && v.alturaReal !== null) {
      const sPe = -hc / dB.z;
      const altChao = hc + ((sPe * dB.y) / dT.y) * dT.z;
      const razao = altChao / v.alturaReal;
      if (!(Number.isFinite(razao) && razao >= 0.6 && razao <= 1.6)) {
        chaoConfiavel = false;
        avisos.push(
          `Volume "${v.nome}": pelo chão a altura daria ${Number.isFinite(altChao) ? altChao.toFixed(1).replace('.', ',') : '?'} m, longe dos ${String(v.alturaReal).replace('.', ',')} m informados; posição calculada pela altura real`
        );
      }
    }

    if (chaoConfiavel) {
      metodo = 'CHAO';
      const s = -hc / dB.z;
      const pe = { x: s * dB.x, y: s * dB.y, z: 0 };
      const s2 = pe.y / dT.y;
      let alt = hc + s2 * dT.z;
      if (!(Number.isFinite(alt) && alt >= 0.05 && alt <= 50)) {
        avisos.push(`Volume "${v.nome}": altura calculada pelo chão fora de 0,05 a 50 m; usada ${H} m`);
        alt = H;
      }
      centro = { x: pe.x, y: pe.y, z: alt / 2 };
      tamZ = alt;
    } else {
      metodo = 'TAMANHO';
      const k = H / v.altura; // p / f
      centro = { x: k * dC.x, y: k * dC.y, z: hc + k * dC.z };
      if (v.apoio === 'CHAO') {
        const baseZ = hc + k * dB.z;
        if (baseZ < 0) centro.z += -baseZ;
      }
      tamZ = H;
    }

    const p = centro.y * cosT + (centro.z - hc) * sinT; // profundidade no eixo óptico
    const tamX = limitar((v.largura * a * p) / f, 0.02, 100);
    const tamYBase = tamZ;
    const tamZc = limitar(tamYBase, 0.02, 100);
    let espessura: number;
    if (v.espessura !== undefined && v.espessura !== null) espessura = v.espessura;
    else if (v.tipo === 'PESSOA') espessura = 0.35;
    else if (v.tipo === 'PAREDE') espessura = 0.12;
    else espessura = Math.min(tamX, tamZc);
    const tamY = limitar(espessura, 0.02, 100);

    const distancia = Math.sqrt(centro.x * centro.x + centro.y * centro.y + (centro.z - hc) * (centro.z - hc));

    brutos.push({
      distancia,
      volume: {
        nome: v.nome,
        regiaoId: v.regiaoId ?? null,
        tipo: v.tipo,
        caixa: { x: v.x, y: v.y, largura: v.largura, altura: v.altura },
        centro,
        tamanho: { x: tamX, y: tamY, z: tamZc },
        distancia,
        metodo,
        camada: 0,
      },
    });
  }

  // Passo 8: ordenação por distância decrescente.
  brutos.sort((p, q) => q.distancia - p.distancia);
  const volumes: VolumeResolvido[] = brutos.map((b, i) => ({
    ...b.volume,
    camada: i,
    centro: { x: r4(b.volume.centro.x), y: r4(b.volume.centro.y), z: r4(b.volume.centro.z) },
    tamanho: { x: r4(b.volume.tamanho.x), y: r4(b.volume.tamanho.y), z: r4(b.volume.tamanho.z) },
    distancia: r4(b.volume.distancia),
  }));

  // Passo 9: limites.
  let limites: { perto: number; longe: number };
  if (brutos.length === 0) {
    limites = { perto: 0.5, longe: 20 };
  } else {
    const menor = brutos[brutos.length - 1].distancia;
    const maior = brutos[0].distancia;
    const perto = Math.max(0.2, 0.7 * menor);
    const longe = Math.max(perto + 1, 1.6 * maior);
    limites = { perto: r4(perto), longe: r4(longe) };
  }

  return {
    versao: 1,
    largura,
    altura,
    camera: {
      fovVertical: r4(fovGraus),
      foco: r4(f),
      inclinacao: r4(inclinacao),
      rolagem: r4(rolagemGraus),
      altura: r4(hc),
      horizonteY: r4(0.5 - yh),
      origemFoco,
    },
    pontosDeFuga: entrada.pontosDeFuga.map((p) => ({ x: p.x, y: p.y, eixo: p.eixo })),
    volumes,
    limites,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Projeção e consultas
// ---------------------------------------------------------------------------

export function projetar(cena: CenaResolvida, p: Vetor3): { u: number; v: number } | null {
  const hc = cena.camera.altura;
  const th = rad(cena.camera.inclinacao);
  const cosT = Math.cos(th);
  const sinT = Math.sin(th);
  const wx = p.x;
  const wy = p.y;
  const wz = p.z - hc;
  const xc = wx;
  const zc = wy * cosT + wz * sinT;
  const yc = -wy * sinT + wz * cosT;
  if (zc <= 1e-6) return null;
  const xn = (cena.camera.foco * xc) / zc;
  const yn = (cena.camera.foco * yc) / zc;
  // Desfaz a rolagem: gira por +rolagem em torno do centro.
  const r = rad(cena.camera.rolagem);
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const xr = xn * cr - yn * sr;
  const yr = xn * sr + yn * cr;
  const a = cena.largura / cena.altura;
  return { u: xr / a + 0.5, v: 0.5 - yr };
}

function cobertura(caixa: { x: number; y: number; largura: number; altura: number }, parte: ParteParaCena): number {
  const area = parte.largura * parte.altura;
  if (!(area > 0)) return 0;
  const x1 = Math.max(caixa.x, parte.x);
  const y1 = Math.max(caixa.y, parte.y);
  const x2 = Math.min(caixa.x + caixa.largura, parte.x + parte.largura);
  const y2 = Math.min(caixa.y + caixa.altura, parte.y + parte.altura);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return (w * h) / area;
}

export function distanciaDaParte(cena: CenaResolvida, parte: ParteParaCena): number | null {
  if (typeof parte.profundidade === 'number') return parte.profundidade;
  if (parte.id !== undefined) {
    const doId = cena.volumes.filter((v) => v.regiaoId === parte.id);
    if (doId.length > 0) return Math.min(...doId.map((v) => v.distancia));
  }
  const cobrem = cena.volumes.filter((v) => cobertura(v.caixa, parte) >= 0.3);
  if (cobrem.length > 0) return Math.min(...cobrem.map((v) => v.distancia));
  return null;
}

function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim();
}

export function textoDePerspectiva(cena: CenaResolvida, parte: ParteParaCena): string {
  const c = cena.camera;
  let camara = `Camera at ${c.altura.toFixed(1)} m height, vertical field of view ${Math.round(c.fovVertical)} degrees, horizon at ${Math.round(c.horizonteY * 100)}% of the image height from the top`;
  if (c.inclinacao >= 3) camara += ', camera tilted up';
  else if (c.inclinacao <= -3) camara += ', camera tilted down';

  const frases: string[] = [];
  const d = distanciaDaParte(cena, parte);
  if (d !== null) {
    frases.push(`${camara}; the part is about ${d.toFixed(1)} m from the camera.`);
    const frente = cena.volumes
      .filter((v) => cobertura(v.caixa, parte) >= 0.05 && v.distancia < d - 0.3)
      .sort((p, q) => p.distancia - q.distancia)
      .slice(0, 3)
      .map((v) => nomeLimpo(v.nome));
    const atras = cena.volumes
      .filter((v) => cobertura(v.caixa, parte) >= 0.05 && v.distancia > d + 0.3)
      .sort((p, q) => p.distancia - q.distancia)
      .slice(0, 3)
      .map((v) => nomeLimpo(v.nome));
    if (frente.length > 0) frases.push(`Elements in front of it: ${frente.join(', ')}.`);
    if (atras.length > 0) frases.push(`Elements behind it: ${atras.join(', ')}.`);
  } else {
    frases.push(`${camara}.`);
  }
  frases.push('Keep perspective lines, relative scale and occlusion consistent with this geometry.');
  return frases.join(' ');
}

function fmt(n: number, casas: number): string {
  return n.toFixed(casas).replace('.', ',');
}

export function resumoDaCena(cena: CenaResolvida): string {
  const c = cena.camera;
  const origem = {
    PONTOS_DE_FUGA: 'pelos pontos de fuga',
    ESTIMADO: 'pelo campo de visão informado',
    PADRAO: 'pelo valor padrão',
  }[c.origemFoco];
  let inclin = '';
  if (c.inclinacao >= 3) inclin = ', câmera inclinada para cima';
  else if (c.inclinacao <= -3) inclin = ', câmera inclinada para baixo';

  const frases: string[] = [
    `Câmera a ${fmt(c.altura, 1)} m de altura, campo de visão vertical de ${Math.round(c.fovVertical)} graus (foco ${origem}), horizonte a ${Math.round(c.horizonteY * 100)}% do topo${inclin}.`,
  ];

  const n = cena.volumes.length;
  if (n === 0) {
    frases.push('Nenhum volume foi marcado.');
  } else {
    const maisDistante = cena.volumes[0];
    const maisProximo = cena.volumes[n - 1];
    if (n === 1) {
      frases.push(`Há 1 volume: "${nomeLimpo(maisProximo.nome)}", a ${fmt(maisProximo.distancia, 1)} m da câmera.`);
    } else {
      frases.push(
        `Há ${n} volumes: o mais próximo é "${nomeLimpo(maisProximo.nome)}", a ${fmt(maisProximo.distancia, 1)} m, e o mais distante é "${nomeLimpo(maisDistante.nome)}", a ${fmt(maisDistante.distancia, 1)} m.`
      );
    }
  }
  if (cena.avisos.length > 0) frases.push(`Avisos: ${cena.avisos.join('; ')}.`);
  return frases.join(' ');
}
