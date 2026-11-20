import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CenaResolvida, TipoVolume, VolumeResolvido } from '../../lib/tiposCena';

// Visualizador puro do mapa 3D da foto. Não busca nada: recebe a cena resolvida pronta.
// Contrato em docs/CENA.md. Convenção do mundo: X direita, Y frente (afastando da câmera), Z para cima.
// O three.js usa Y para cima; por isso o ponto (x, y, z) do mundo vira (x, z, -y).

export type VistaCena = 'livre' | 'camera' | 'cima' | 'lado';

export interface PropsCena3D {
  cena: CenaResolvida;
  urlDaFoto: string | null; // imagem do projeto, para o plano de imagem da câmera
  volumeEmFoco: number | null; // índice em cena.volumes
  aoFocarVolume: (indice: number | null) => void;
  vista: VistaCena;
}

const COR_TIPO: Record<TipoVolume, number> = {
  PESSOA: 0xe4572e,
  OBJETO: 0x2e86ab,
  PAREDE: 0x8d99ae,
  OUTRO: 0x6a994e,
};

const COR_CAMERA = 0xf59e0b;
const COR_GRADE = 0x64748b;
const COR_FOCO = 0xffffff;
const OPACIDADE_GRADE = 0.35;
const OPACIDADE_VOLUME = 0.25;
const OPACIDADE_VOLUME_FOCO = 0.6;
const OPACIDADE_PLANO_FOTO = 0.85;
const DISTANCIA_PLANO_FOTO = 1.2; // metros, da câmera ao plano de imagem
const DISTANCIA_FRUSTO_CAMERA = 1.2; // metros, até onde vai a pirâmide de visão (igual ao plano)
const FOV_PADRAO = 45; // graus, vista livre
const RAIO_MINIMO_PROXIMOS_M = 15; // metros: volumes até max(3 × mediana, 15) entram no enquadramento
const FATOR_MEDIANA_PROXIMOS = 3;
const LIMITE_MAXIMO_PROXIMOS_M = 80;
const TAMANHO_MAXIMO_CHAO_M = 200; // metros, lado da grade do chão
const DISTANCIA_MAXIMA_VISTA_M = 600; // metros, para ficar bem dentro do far (1000) da câmera
const MOVIMENTO_MAXIMO_CLIQUE_PX = 5;
const MENSAGEM_SEM_WEBGL = 'Este navegador não conseguiu abrir a vista 3D.';

const Y_PARA_CIMA = new THREE.Vector3(0, 1, 0);

interface MalhaVolume {
  malha: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  linhas: THREE.LineSegments;
  linhaMat: THREE.LineBasicMaterial;
  cor: number;
}

interface Contexto {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  palco: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controles: OrbitControls;
  raycaster: THREE.Raycaster;
  malhas: MalhaVolume[];
  planoFoto: THREE.Mesh | null;
  desenhar: () => void;
}

interface OrientacaoDaFoto {
  posicao: THREE.Vector3; // three.js
  frente: THREE.Vector3; // direção do eixo óptico, three.js
  cima: THREE.Vector3; // direção "para cima" da imagem, three.js
  direita: THREE.Vector3; // direção "para a direita" da imagem, three.js
  quat: THREE.Quaternion;
  fov: number; // graus
}

// Ponto do mundo (metros) para o referencial do three.js.
function paraThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

function vetorDoMundo(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return paraThree(v.x, v.y, v.z);
}

// Câmera da foto: mesma posição, orientação e fov que a matemática do servidor usou.
function orientacaoDaFoto(c: CenaResolvida['camera']): OrientacaoDaFoto {
  const theta = THREE.MathUtils.degToRad(c.inclinacao);
  const rolagem = THREE.MathUtils.degToRad(c.rolagem);
  const cosT = Math.cos(theta);
  const senT = Math.sin(theta);
  const cosR = Math.cos(rolagem);
  const senR = Math.sin(rolagem);

  // Eixo óptico, e "para cima" da câmera sem rolagem (ver resolverCena, passo 6).
  const frenteMundo = new THREE.Vector3(0, cosT, senT);
  const cimaSemRolagem = new THREE.Vector3(0, -senT, cosT);
  const direitaSemRolagem = new THREE.Vector3(1, 0, 0);

  // A rolagem gira a imagem em torno do eixo óptico.
  const direitaMundo = direitaSemRolagem.clone().multiplyScalar(cosR).addScaledVector(cimaSemRolagem, -senR);
  const cimaMundo = direitaSemRolagem.clone().multiplyScalar(senR).addScaledVector(cimaSemRolagem, cosR);

  const frente = vetorDoMundo(frenteMundo);
  const cima = vetorDoMundo(cimaMundo);
  const direita = vetorDoMundo(direitaMundo);
  const costas = frente.clone().negate(); // a câmera do three.js olha para -Z

  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(direita, cima, costas));
  return {
    posicao: paraThree(0, 0, c.altura),
    frente,
    cima,
    direita,
    quat,
    fov: c.fovVertical,
  };
}

// Volumes que entram no enquadramento: os próximos (até max(3 × mediana, 15) m, no máximo 80 m).
// Se nenhum couber, entra só o mais próximo. Os demais continuam desenhados, só ficam fora da vista inicial.
function volumesProximos(cena: CenaResolvida): VolumeResolvido[] {
  if (cena.volumes.length === 0) return [];
  const ordenadas = cena.volumes.map((v) => v.distancia).sort((a, b) => a - b);
  const n = ordenadas.length;
  const mediana = n % 2 === 1 ? ordenadas[(n - 1) / 2] : (ordenadas[n / 2 - 1] + ordenadas[n / 2]) / 2;
  const limite = Math.min(LIMITE_MAXIMO_PROXIMOS_M, Math.max(FATOR_MEDIANA_PROXIMOS * mediana, RAIO_MINIMO_PROXIMOS_M));
  const dentro = cena.volumes.filter((v) => v.distancia <= limite);
  if (dentro.length > 0) return dentro;
  let maisProximo = cena.volumes[0];
  for (const v of cena.volumes) if (v.distancia < maisProximo.distancia) maisProximo = v;
  return [maisProximo];
}

interface Enquadramento {
  centro: THREE.Vector3; // three.js, centro da caixa que engloba a câmera e os volumes próximos
  diagonal: number; // metros
  tamanhoChao: number; // metros, lado da grade
}

// A câmera da foto (origem) sempre entra no enquadramento.
function enquadramentoDaCena(cena: CenaResolvida): Enquadramento {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let minZ = cena.camera.altura;
  let maxZ = cena.camera.altura;
  for (const v of volumesProximos(cena)) {
    const { centro: c, tamanho: t } = v;
    minX = Math.min(minX, c.x - t.x / 2);
    maxX = Math.max(maxX, c.x + t.x / 2);
    minY = Math.min(minY, c.y - t.y / 2);
    maxY = Math.max(maxY, c.y + t.y / 2);
    minZ = Math.min(minZ, c.z - t.z / 2);
    maxZ = Math.max(maxZ, c.z + t.z / 2);
  }
  const centro = paraThree((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const raioChao = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
  const tamanhoChao = Math.min(TAMANHO_MAXIMO_CHAO_M, Math.max(20, Math.ceil(raioChao) * 2 + 4));
  return { centro, diagonal, tamanhoChao };
}

// Libera geometrias, materiais e texturas de uma árvore de objetos.
function descartarArvore(objeto: THREE.Object3D): void {
  objeto.traverse((filho) => {
    const malha = filho as THREE.Mesh;
    malha.geometry?.dispose();
    const materiais = Array.isArray(malha.material) ? malha.material : [malha.material];
    for (const material of materiais) {
      if (!material) continue;
      const textura = (material as THREE.MeshBasicMaterial).map;
      textura?.dispose();
      material.dispose();
    }
  });
}

function criarRenderer(): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
}

// Troca os controles de órbita por uns novos com o "para cima" pedido e o alvo dado.
// O OrbitControls guarda a orientação do "para cima" no construtor, por isso é preciso recriar.
function reposicionarControles(ctx: Contexto, cima: THREE.Vector3, alvo: THREE.Vector3, posicao: THREE.Vector3): void {
  ctx.controles.removeEventListener('change', ctx.desenhar);
  ctx.controles.dispose();

  ctx.camera.up.copy(cima);
  ctx.camera.position.copy(posicao);
  ctx.camera.updateProjectionMatrix();

  const novos = new OrbitControls(ctx.camera, ctx.canvas);
  novos.enableDamping = false; // sem damping não há laço de animação: desenha no change
  novos.target.copy(alvo);
  novos.addEventListener('change', ctx.desenhar);
  novos.update();
  ctx.controles = novos;
}

// Destaque: a caixa em foco fica mais opaca e com arestas brancas.
function aplicarDestaque(ctx: Contexto, volumeEmFoco: number | null): void {
  ctx.malhas.forEach((m, indice) => {
    const emFoco = indice === volumeEmFoco;
    m.mat.opacity = emFoco ? OPACIDADE_VOLUME_FOCO : OPACIDADE_VOLUME;
    m.linhaMat.color.setHex(emFoco ? COR_FOCO : m.cor);
  });
}

function aplicarVista(ctx: Contexto, cena: CenaResolvida, vista: VistaCena): void {
  if (ctx.planoFoto) ctx.planoFoto.visible = vista !== 'camera';

  if (vista === 'camera') {
    const foto = orientacaoDaFoto(cena.camera);
    ctx.camera.fov = foto.fov;
    const alvo = foto.posicao.clone().addScaledVector(foto.frente, 5);
    reposicionarControles(ctx, foto.cima, alvo, foto.posicao);
    return;
  }

  ctx.camera.fov = FOV_PADRAO;
  const enquadrado = enquadramentoDaCena(cena);
  const alvo = enquadrado.centro;
  const distancia = Math.min(DISTANCIA_MAXIMA_VISTA_M, Math.max(6, enquadrado.diagonal * 1.2 + 4));
  let deslocamento: THREE.Vector3;
  if (vista === 'cima') deslocamento = new THREE.Vector3(0, distancia, 0.001);
  else if (vista === 'lado') deslocamento = new THREE.Vector3(distancia, 0, 0);
  else deslocamento = new THREE.Vector3(distancia * 0.6, distancia * 0.5, distancia * 0.8);

  reposicionarControles(ctx, Y_PARA_CIMA, alvo, alvo.clone().add(deslocamento));
}

export function Cena3D(props: PropsCena3D): JSX.Element {
  const { cena, urlDaFoto, volumeEmFoco, aoFocarVolume, vista } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Contexto | null>(null);
  // Últimos valores de foco e vista, lidos pelos efeitos sem fazê-los rodar de novo.
  const focoRef = useRef<number | null>(volumeEmFoco);
  const vistaRef = useRef<VistaCena>(vista);
  const aoFocarRef = useRef(aoFocarVolume);
  const [semWebgl, setSemWebgl] = useState(false);

  useEffect(() => {
    aoFocarRef.current = aoFocarVolume;
  }, [aoFocarVolume]);

  // Montagem: renderizador, câmera, controles e clique. Não há laço de animação.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = criarRenderer();
    if (!renderer) {
      setSemWebgl(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    container.appendChild(canvas);

    const palco = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_PADRAO, 1, 0.05, 1000);
    const raycaster = new THREE.Raycaster();

    const desenhar = () => renderer.render(palco, camera);
    const controles = new OrbitControls(camera, canvas);
    controles.enableDamping = false;
    controles.addEventListener('change', desenhar);

    const ctx: Contexto = {
      renderer,
      canvas,
      palco,
      camera,
      controles,
      raycaster,
      malhas: [],
      planoFoto: null,
      desenhar,
    };
    ctxRef.current = ctx;

    // Clique (sem arrastar) numa caixa foca o volume; no vazio, tira o foco.
    let inicio: { x: number; y: number } | null = null;
    const aoBaixar = (e: PointerEvent) => {
      inicio = { x: e.clientX, y: e.clientY };
    };
    const aoSoltar = (e: PointerEvent) => {
      const origem = inicio;
      inicio = null;
      if (!origem) return;
      if (Math.hypot(e.clientX - origem.x, e.clientY - origem.y) > MOVIMENTO_MAXIMO_CLIQUE_PX) return;
      const retangulo = canvas.getBoundingClientRect();
      if (retangulo.width === 0 || retangulo.height === 0) return;
      const ndc = new THREE.Vector2(
        ((e.clientX - retangulo.left) / retangulo.width) * 2 - 1,
        -((e.clientY - retangulo.top) / retangulo.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const acertos = raycaster.intersectObjects(
        ctx.malhas.map((m) => m.malha),
        false,
      );
      const indice = acertos.length > 0 ? Number(acertos[0].object.userData.indice) : null;
      aoFocarRef.current(indice);
    };
    canvas.addEventListener('pointerdown', aoBaixar);
    canvas.addEventListener('pointerup', aoSoltar);

    // Tamanho: redesenha só quando o contêiner muda de tamanho.
    const redimensionar = () => {
      const largura = container.clientWidth;
      const altura = container.clientHeight;
      if (largura <= 0 || altura <= 0) return;
      renderer.setSize(largura, altura, false);
      camera.aspect = largura / altura;
      camera.updateProjectionMatrix();
      desenhar();
    };
    const observador = new ResizeObserver(redimensionar);
    observador.observe(container);
    redimensionar();

    return () => {
      observador.disconnect();
      canvas.removeEventListener('pointerdown', aoBaixar);
      canvas.removeEventListener('pointerup', aoSoltar);
      ctx.controles.removeEventListener('change', desenhar);
      ctx.controles.dispose();
      ctx.malhas = [];
      ctx.planoFoto = null;
      ctxRef.current = null;
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  // Mantém as refs em dia antes dos efeitos de montagem, destaque e vista.
  useEffect(() => {
    focoRef.current = volumeEmFoco;
    vistaRef.current = vista;
  }, [volumeEmFoco, vista]);

  // Geometria da cena (só muda com a cena ou a foto): chão, pirâmide da câmera, plano da foto e caixas.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const grupo = new THREE.Group();
    ctx.palco.add(grupo);
    let descartado = false;

    // Chão: grade de 1 m, cobre os limites da cena (no mínimo 20 m).
    const tamanhoChao = enquadramentoDaCena(cena).tamanhoChao;
    const grade = new THREE.GridHelper(tamanhoChao, tamanhoChao, COR_GRADE, COR_GRADE);
    const materialGrade = grade.material as THREE.LineBasicMaterial;
    materialGrade.transparent = true;
    materialGrade.opacity = OPACIDADE_GRADE;
    grupo.add(grade);

    // Câmera da foto: pirâmide de visão e plano de imagem.
    const foto = orientacaoDaFoto(cena.camera);
    const aspecto = cena.altura > 0 ? cena.largura / cena.altura : 1;
    const semiAltura = DISTANCIA_FRUSTO_CAMERA * Math.tan(THREE.MathUtils.degToRad(foto.fov) / 2);
    const semiLargura = semiAltura * aspecto;
    const cantos = [
      [-semiLargura, -semiAltura],
      [semiLargura, -semiAltura],
      [semiLargura, semiAltura],
      [-semiLargura, semiAltura],
    ].map(([x, y]) =>
      foto.posicao
        .clone()
        .addScaledVector(foto.direita, x)
        .addScaledVector(foto.cima, y)
        .addScaledVector(foto.frente, DISTANCIA_FRUSTO_CAMERA),
    );
    const pontos: number[] = [];
    const empurrar = (v: THREE.Vector3) => pontos.push(v.x, v.y, v.z);
    for (const canto of cantos) {
      empurrar(foto.posicao);
      empurrar(canto);
    }
    for (let i = 0; i < cantos.length; i++) {
      empurrar(cantos[i]);
      empurrar(cantos[(i + 1) % cantos.length]);
    }
    const geometriaCamera = new THREE.BufferGeometry();
    geometriaCamera.setAttribute('position', new THREE.Float32BufferAttribute(pontos, 3));
    grupo.add(new THREE.LineSegments(geometriaCamera, new THREE.LineBasicMaterial({ color: COR_CAMERA })));

    if (urlDaFoto) {
      const materialPlano = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: OPACIDADE_PLANO_FOTO,
        side: THREE.DoubleSide,
      });
      const plano = new THREE.Mesh(new THREE.PlaneGeometry(2 * semiLargura, 2 * semiAltura), materialPlano);
      plano.position.copy(foto.posicao.clone().addScaledVector(foto.frente, DISTANCIA_PLANO_FOTO));
      plano.quaternion.copy(foto.quat);
      plano.visible = vistaRef.current !== 'camera'; // na vista da câmera o plano taparia a cena
      grupo.add(plano);
      ctx.planoFoto = plano;

      new THREE.TextureLoader().load(urlDaFoto, (textura) => {
        if (descartado) {
          textura.dispose();
          return;
        }
        textura.colorSpace = THREE.SRGBColorSpace;
        materialPlano.map = textura;
        materialPlano.needsUpdate = true;
        ctx.desenhar();
      });
    }

    // Uma caixa por volume, com arestas.
    ctx.malhas = cena.volumes.map((volume, indice) => {
      const t = volume.tamanho;
      const geometria = new THREE.BoxGeometry(t.x, t.z, t.y); // three: largura em X, altura em Y, profundidade em Z
      const cor = COR_TIPO[volume.tipo];
      const mat = new THREE.MeshBasicMaterial({
        color: cor,
        transparent: true,
        opacity: OPACIDADE_VOLUME,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const malha = new THREE.Mesh(geometria, mat);
      malha.position.copy(vetorDoMundo(volume.centro));
      malha.userData.indice = indice;
      const linhaMat = new THREE.LineBasicMaterial({ color: cor });
      const linhas = new THREE.LineSegments(new THREE.EdgesGeometry(geometria), linhaMat);
      malha.add(linhas);
      grupo.add(malha);
      return { malha, mat, linhas, linhaMat, cor };
    });

    aplicarDestaque(ctx, focoRef.current);
    ctx.desenhar();

    return () => {
      descartado = true;
      ctx.palco.remove(grupo);
      ctx.malhas = [];
      ctx.planoFoto = null;
      descartarArvore(grupo);
    };
  }, [cena, urlDaFoto]);

  // Destaque: trocar o volume em foco só muda cor e opacidade; não reposiciona a câmera.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    aplicarDestaque(ctx, volumeEmFoco);
    ctx.desenhar();
  }, [volumeEmFoco]);

  // Vista: reposiciona a câmera só quando a vista ou a identidade da cena muda; depois o usuário gira livremente.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    aplicarVista(ctx, cena, vista);
    ctx.desenhar();
  }, [vista, cena]);

  return (
    <div
      ref={containerRef}
      className="cena-vista"
      role={semWebgl ? undefined : 'img'}
      aria-label={semWebgl ? undefined : `Mapa 3D com ${cena.volumes.length} volumes`}
    >
      {semWebgl && <p className="cena-aviso">{MENSAGEM_SEM_WEBGL}</p>}
    </div>
  );
}
