// Teste da matemática do mapa 3D. Rodar: npx tsx src/lib/cena.teste.ts (a partir de server/)
import * as assert from 'node:assert/strict';
import { HttpError } from './erros';
import {
  validarCenaEntrada,
  resolverCena,
  projetar,
  distanciaDaParte,
  textoDePerspectiva,
  resumoDaCena,
  VolumeEntrada,
  CenaEntrada,
} from './cena';

const LARGURA = 1600;
const ALTURA = 1200;

const pessoa: VolumeEntrada = {
  nome: 'Pessoa da frente',
  regiaoId: 1,
  tipo: 'PESSOA',
  x: 0.4, y: 0.3, largura: 0.1, altura: 0.5,
  apoio: 'CHAO',
};

function entrada(parcial: Partial<CenaEntrada>): CenaEntrada {
  return validarCenaEntrada({ ...parcial });
}

function proximo(valor: { u: number; v: number } | null): { u: number; v: number } {
  assert.notEqual(valor, null);
  return valor as { u: number; v: number };
}

// (a) sem pontos de fuga nem fov
{
  const cena = resolverCena(entrada({}), LARGURA, ALTURA);
  assert.equal(cena.camera.fovVertical, 45);
  assert.equal(cena.camera.origemFoco, 'PADRAO');
  assert.deepEqual(cena.volumes, []);
  assert.deepEqual(cena.limites, { perto: 0.5, longe: 20 });
}

// (b) dois pontos de fuga horizontais
{
  const cena = resolverCena(
    entrada({
      pontosDeFuga: [
        { x: -1.0, y: 0.4, eixo: 'X' },
        { x: 2.2, y: 0.4, eixo: 'Y' },
      ],
    }),
    LARGURA,
    ALTURA
  );
  assert.equal(cena.camera.origemFoco, 'PONTOS_DE_FUGA');
  assert.ok(Math.abs(cena.camera.horizonteY - 0.4) <= 0.0001, `horizonteY ${cena.camera.horizonteY}`);
  assert.ok(cena.camera.inclinacao < 0, `inclinacao ${cena.camera.inclinacao}`);
}

// (c) volume CHAO, caixa 0.4/0.3/0.1/0.5, camera 1.5 m, horizonte 0.45, fov 50
const cenaC = resolverCena(
  entrada({
    camera: { alturaCamera: 1.5, horizonteY: 0.45, fovVertical: 50 },
    volumes: [pessoa],
  }),
  LARGURA,
  ALTURA
);
{
  const vol = cenaC.volumes[0];
  assert.equal(vol.metodo, 'CHAO');
  assert.ok(vol.centro.y > 0);
  const pe = proximo(projetar(cenaC, { x: vol.centro.x, y: vol.centro.y, z: 0 }));
  assert.ok(Math.abs(pe.u - 0.45) <= 0.002, `pe.u ${pe.u}`);
  assert.ok(Math.abs(pe.v - 0.8) <= 0.002, `pe.v ${pe.v}`);
  const topo = proximo(projetar(cenaC, { x: vol.centro.x, y: vol.centro.y, z: vol.tamanho.z }));
  assert.ok(Math.abs(topo.v - 0.3) <= 0.002, `topo.v ${topo.v}`);
}

// (d) mesmo volume com a base cortada pela borda
{
  const cena = resolverCena(
    entrada({
      camera: { alturaCamera: 1.5, horizonteY: 0.45, fovVertical: 50 },
      volumes: [{ ...pessoa, y: 0.5, altura: 0.5 }],
    }),
    LARGURA,
    ALTURA
  );
  assert.equal(cena.volumes[0].metodo, 'TAMANHO');
}

// (e) volume SUSPENSO
{
  const cena = resolverCena(
    entrada({
      camera: { alturaCamera: 1.5, horizonteY: 0.45, fovVertical: 50 },
      volumes: [{ ...pessoa, apoio: 'SUSPENSO' }],
    }),
    LARGURA,
    ALTURA
  );
  const vol = cena.volumes[0];
  assert.equal(vol.metodo, 'TAMANHO');
  const p = proximo(projetar(cena, vol.centro));
  assert.ok(Math.abs(p.u - 0.45) <= 0.002, `u ${p.u}`);
  assert.ok(Math.abs(p.v - 0.55) <= 0.002, `v ${p.v}`);
}

// (f) dois volumes: ordenados por distancia decrescente, camada 0 no mais distante
{
  const cena = resolverCena(
    entrada({
      camera: { alturaCamera: 1.5, horizonteY: 0.45, fovVertical: 50 },
      volumes: [
        { ...pessoa, nome: 'Perto', y: 0.3, altura: 0.5 },
        { ...pessoa, nome: 'Longe', regiaoId: null, x: 0.1, y: 0.1, altura: 0.3 },
      ],
    }),
    LARGURA,
    ALTURA
  );
  assert.equal(cena.volumes.length, 2);
  assert.ok(cena.volumes[0].distancia >= cena.volumes[1].distancia);
  assert.equal(cena.volumes[0].camada, 0);
  assert.equal(cena.volumes[1].camada, 1);
  assert.equal(cena.volumes[0].nome, 'Longe');
}

// (g) rolagem de 5 graus com volume CHAO: o pé volta ao ponto base-centro original
{
  const cena = resolverCena(
    entrada({
      camera: { alturaCamera: 1.5, horizonteY: 0.45, fovVertical: 50, inclinacaoLateral: 5 },
      volumes: [pessoa],
    }),
    LARGURA,
    ALTURA
  );
  assert.equal(cena.camera.rolagem, 5);
  const vol = cena.volumes[0];
  assert.equal(vol.metodo, 'CHAO');
  const pe = proximo(projetar(cena, { x: vol.centro.x, y: vol.centro.y, z: 0 }));
  assert.ok(Math.abs(pe.u - 0.45) <= 0.003, `pe.u ${pe.u}`);
  assert.ok(Math.abs(pe.v - 0.8) <= 0.003, `pe.v ${pe.v}`);
}

// (h) validação
{
  const erroDe = (bruto: unknown): unknown => {
    try {
      validarCenaEntrada(bruto);
    } catch (e) {
      return e;
    }
    return null;
  };
  const e1 = erroDe({ camera: { fovVertical: 5 } });
  assert.ok(e1 instanceof HttpError && e1.status === 400);

  const volumes = Array.from({ length: 25 }, (_, i) => ({ ...pessoa, nome: `V${i}` }));
  const e2 = erroDe({ volumes });
  assert.ok(e2 instanceof HttpError && e2.status === 400);

  const e3 = erroDe({
    pontosDeFuga: [
      { x: 0.1, y: 0.2, eixo: 'X' },
      { x: 0.3, y: 0.2, eixo: 'X' },
    ],
  });
  assert.ok(e3 instanceof HttpError && e3.status === 400);

  const e4 = erroDe({ volumes: [{ ...pessoa, altura: 0 }] });
  assert.ok(e4 instanceof HttpError);
  assert.equal((e4 as HttpError).message, 'Volume 1: altura deve ser maior que 0');

  const limpo = validarCenaEntrada({});
  assert.deepEqual(limpo, { camera: {}, pontosDeFuga: [], volumes: [], observacoes: '' });

  const cortado = validarCenaEntrada({ volumes: [{ ...pessoa, x: 0.9, largura: 0.5 }] });
  assert.ok(Math.abs(cortado.volumes[0].largura - 0.1) < 1e-9);
}

// (i) texto de perspectiva
{
  const parte = { id: 1, x: 0.4, y: 0.3, largura: 0.1, altura: 0.5 };
  const texto = textoDePerspectiva(cenaC, parte);
  assert.ok(!/[\r\n]/.test(texto));
  assert.ok(texto.endsWith('Keep perspective lines, relative scale and occlusion consistent with this geometry.'));
  const semDistancia = textoDePerspectiva(cenaC, { x: 0, y: 0, largura: 0.01, altura: 0.01 });
  assert.ok(semDistancia.endsWith('Keep perspective lines, relative scale and occlusion consistent with this geometry.'));
  assert.ok(!/[\r\n]/.test(semDistancia));
}

// (j) distanciaDaParte nas quatro situações
{
  const volDist = cenaC.volumes[0].distancia;
  assert.equal(distanciaDaParte(cenaC, { x: 0, y: 0, largura: 0.1, altura: 0.1, profundidade: 3.2 }), 3.2);
  assert.equal(distanciaDaParte(cenaC, { id: 1, x: 0, y: 0, largura: 0.1, altura: 0.1 }), volDist);
  assert.equal(distanciaDaParte(cenaC, { x: 0.4, y: 0.3, largura: 0.1, altura: 0.5 }), volDist);
  assert.equal(distanciaDaParte(cenaC, { x: 0, y: 0, largura: 0.1, altura: 0.1, profundidade: null }), null);
}

// resumo em português
{
  const resumo = resumoDaCena(cenaC);
  assert.ok(resumo.length > 0);
  assert.ok(resumo.includes('Pessoa da frente'));
}

console.log('TUDO OK');
