# Mapa 3D da foto (cena)

Contrato desta rodada. Vale junto com `docs/CONTRATOS.md` e `docs/GRADE.md`.

## Ideia

Antes de reconstruir, a equipe monta um **mapa 3D** da foto: a câmera (campo de visão, altura, inclinação), a linha do horizonte, os pontos de fuga e um **volume** (caixa) por pessoa e objeto, na posição e na distância estimadas. Serve para quatro coisas:

1. o texto de perspectiva entra sozinho no pedido de cada parte ao Canva;
2. o revisor reprova opção que quebra a perspectiva ou a escala;
3. as partes são reconstruídas do fundo para a frente;
4. o recorte do mapa de profundidade vai ao Canva como referência extra da parte.

O agente `cenografo` (na sessão do `/restaurar`) **observa em 2D** (pontos de fuga, horizonte, caixa de cada elemento na foto, altura real estimada). A **matemática** (servidor, `server/src/lib/cena.ts`) transforma isso em 3D. O **Blender** do computador do usuário (script em `agentes/blender/`) monta a cena, exporta `.glb` e renderiza o mapa de profundidade. O usuário vê tudo num visualizador 3D na tela de Referências e aprova junto com o mapa de referências; pode pedir para refazer.

Sem Blender (falhou ou não instalado) a cena matemática continua valendo: só faltam o mapa de profundidade e o `.glb`.

## Sistemas de coordenadas

- **Imagem**: frações `u` (0 esquerda → 1 direita) e `v` (0 topo → 1 base). `a = largura / altura`.
- **Imagem normalizada** (unidade = altura da imagem, centro na origem): `xn = (u - 0.5) * a`, `yn = 0.5 - v`.
- **Mundo** (metros, igual ao Blender): `X` direita, `Y` para a frente (afastando da câmera), `Z` para cima. Chão em `Z = 0`. Câmera em `(0, 0, alturaCamera)`.

## Entrada (o que o cenógrafo informa)

```ts
export type TipoVolume = 'PESSOA' | 'OBJETO' | 'PAREDE' | 'OUTRO';
export type ApoioVolume = 'CHAO' | 'SUSPENSO';

export interface PontoDeFuga { x: number; y: number; eixo: 'X' | 'Y' | 'Z' } // frações u, v; podem sair de 0..1 (limite -20..20). X e Y são as duas direções horizontais perpendiculares; Z é a vertical.

export interface VolumeEntrada {
  nome: string;                 // 1 a 80 caracteres
  regiaoId?: number | null;     // parte (Regiao) correspondente, se houver
  tipo: TipoVolume;
  x: number; y: number; largura: number; altura: number; // caixa na foto, frações 0..1
  alturaReal?: number | null;   // metros, 0.02 a 100
  espessura?: number | null;    // metros no eixo Y, 0.01 a 100
  apoio: ApoioVolume;           // CHAO: a base da caixa toca o chão visível na foto
}

export interface CenaEntrada {
  camera: {
    fovVertical?: number | null;        // graus, 10 a 120
    horizonteY?: number | null;         // fração v da linha do horizonte, -5 a 6
    alturaCamera?: number | null;       // metros, 0.1 a 50 (padrão 1.5)
    inclinacaoLateral?: number | null;  // graus, -45 a 45 (padrão 0)
  };
  pontosDeFuga: PontoDeFuga[];          // 0 a 3
  volumes: VolumeEntrada[];             // 0 a 24
  observacoes: string;                  // até 2000 caracteres
}
```

## Cena resolvida

```ts
export interface Vetor3 { x: number; y: number; z: number }

export interface VolumeResolvido {
  nome: string;
  regiaoId: number | null;
  tipo: TipoVolume;
  caixa: { x: number; y: number; largura: number; altura: number }; // a caixa 2D informada
  centro: Vetor3;        // metros
  tamanho: Vetor3;       // x = largura, y = espessura, z = altura (metros)
  distancia: number;     // metros, da câmera ao centro
  metodo: 'CHAO' | 'TAMANHO';
  camada: number;        // 0 = o mais distante
}

export interface CenaResolvida {
  versao: 1;
  largura: number; altura: number;      // pixels da imagem do projeto
  camera: {
    fovVertical: number;   // graus
    foco: number;          // f, em alturas de imagem: 0.5 / tan(fovVertical / 2)
    inclinacao: number;    // graus; positivo = câmera olhando para cima
    rolagem: number;       // graus
    altura: number;        // metros
    horizonteY: number;    // fração v
    origemFoco: 'PONTOS_DE_FUGA' | 'ESTIMADO' | 'PADRAO';
  };
  pontosDeFuga: PontoDeFuga[];
  volumes: VolumeResolvido[];           // ordenados por distancia decrescente
  limites: { perto: number; longe: number }; // metros, faixa do mapa de profundidade
  avisos: string[];                     // em português
}
```

## Matemática (`server/src/lib/cena.ts`, funções puras, sem banco)

```ts
export function validarCenaEntrada(bruto: unknown): CenaEntrada;          // lança HttpError 400 com mensagem clara em português
export function resolverCena(entrada: CenaEntrada, largura: number, altura: number): CenaResolvida;
export function projetar(cena: CenaResolvida, p: Vetor3): { u: number; v: number } | null; // null se atrás da câmera
export function distanciaDaParte(cena: CenaResolvida, parte: ParteParaCena): number | null;
export function textoDePerspectiva(cena: CenaResolvida, parte: ParteParaCena): string;    // em inglês, vai no pedido ao Canva
export function resumoDaCena(cena: CenaResolvida): string;                                 // em português, 2 a 4 frases
export interface ParteParaCena { id?: number; x: number; y: number; largura: number; altura: number; profundidade?: number | null }
```

`resolverCena`, nesta ordem:

1. **Rolagem**: `rolagem = camera.inclinacaoLateral ?? 0`. Se há pontos de fuga `X` e `Y`, a rolagem é o ângulo da reta que passa pelos dois (em coordenadas normalizadas) com o eixo horizontal, trazido para -45..45. Todos os pontos da imagem (pontos de fuga e cantos das caixas) são girados por `-rolagem` em torno do centro antes dos passos seguintes.
2. **Foco** `f`: com pontos de fuga `X` (p1) e `Y` (p2) e `p1·p2 < 0`: `f = sqrt(-(p1·p2))` (`origemFoco: 'PONTOS_DE_FUGA'`). Senão, com `camera.fovVertical`: `f = 0.5 / tan(fov/2)` (`'ESTIMADO'`). Senão `fov = 45` (`'PADRAO'`). O campo de visão final fica entre 15 e 100 graus; se precisou cortar, entra um aviso.
3. **Horizonte** `yh` (normalizado): média dos `yn` dos pontos de fuga `X` e `Y` informados (um ou dois); senão `0.5 - camera.horizonteY`; senão `0`.
4. **Inclinação** `θ = -atan(yh / f)`.
5. **Altura da câmera** `hc = camera.alturaCamera ?? 1.5`.
6. **Raio** de um ponto `(xn, yn)`: `d = (xn, f*cos θ - yn*sen θ, f*sen θ + yn*cos θ)`, partindo de `(0, 0, hc)`. Eixo óptico: `o = (0, cos θ, sen θ)`.
7. **Cada volume** (pontos: base-centro `b = (x + largura/2, y + altura)`, topo-centro `t = (x + largura/2, y)`, centro `c`):
   - Método `CHAO`, quando `apoio === 'CHAO'`, a base não está cortada pela borda da foto (`y + altura < 0.985`) e o raio de `b` desce (`d.z < -0.001`): o pé é onde o raio de `b` cruza `Z = 0`. A altura é o `Z` em que o raio de `t` alcança o mesmo `Y` do pé; se sair de 0.05..50 m, usa `alturaReal` (ou o padrão do tipo) e entra um aviso. Centro: `(pé.x, pé.y, altura/2)`. Quando `alturaReal` foi informada e a altura pelo chão fica fora de 0,6 a 1,6 vez ela (perto do horizonte o cálculo é mal condicionado), o volume cai para o método `TAMANHO`, com aviso.
   - Método `TAMANHO` (todo o resto): `H = alturaReal ??` padrão do tipo (`PESSOA` 1.7, `OBJETO` 0.5, `PAREDE` 2.6, `OUTRO` 1.0). Profundidade no eixo óptico `p = f * H / altura` (a `altura` da caixa é fração da altura da imagem). Centro: `câmera + (p / f) * d(c)`. Se `apoio === 'CHAO'` e a base ficar abaixo de `Z = 0`, o centro sobe até a base encostar no chão.
   - Largura: `largura * a * p / f`, com `p` = profundidade do centro no eixo óptico (`(centro - câmera) · o`). Espessura: `espessura ??` padrão (`PESSOA` 0.35, `PAREDE` 0.12, outros: o menor entre largura e altura). Tamanhos limitados a 0.02..100 m.
   - `distancia` = distância euclidiana da câmera ao centro.
8. Volumes ordenados por `distancia` decrescente; `camada` = índice.
9. `limites`: sem volumes, `{ perto: 0.5, longe: 20 }`. Com volumes: `perto = max(0.2, 0.7 * menor distancia)`, `longe = max(perto + 1, 1.6 * maior distancia)`.

`distanciaDaParte`: se `parte.profundidade` é número, devolve ele. Senão, se algum volume tem `regiaoId === parte.id`, a `distancia` dele. Senão, a menor `distancia` entre os volumes cuja caixa 2D cobre 30% ou mais da área da parte. Senão `null`.

`textoDePerspectiva` (inglês, 2 a 4 frases, sem quebra de linha): câmera (altura em m com uma casa, campo de visão vertical inteiro, horizonte em % da altura a partir do topo, e se a câmera olha para cima/para baixo quando `|inclinacao| >= 3`); a distância da parte, se conhecida; os volumes "in front of it" (caixa 2D cruza a parte em 5% ou mais da área da parte e `distancia` menor que a da parte em mais de 0.3 m) e "behind it" (mesmo critério, maior), até 3 nomes cada; e a ordem final "Keep perspective lines, relative scale and occlusion consistent with this geometry.". Com distância desconhecida, só câmera e a frase final.

## Dados gravados

- `Projeto.cena Json?`:
```ts
export interface CenaGravada {
  entrada: CenaEntrada;
  resolvida: CenaResolvida;
  blender: null | {
    profundidadeArquivo: string;  // PNG em tons de cinza, profundidade inversa normalizada (ver "Profundidade pelo mapa"): branco = perto (limites.perto), preto = longe (limites.longe) ou vazio
    volumesArquivo: string;       // PNG RGBA: os volumes vistos pela câmera, fundo transparente
    previaArquivo: string;        // JPEG: a foto com os volumes por cima (montado pelo servidor)
    glbArquivo: string;           // a cena em glTF binário
    versao: string;               // versão do Blender
    feitoEm: string;              // ISO
  };
  atualizadaEm: string;           // ISO
}
```
- `Regiao.profundidade Float?`: distância da parte em metros (null = desconhecida).
- Trabalho novo de tipo `CENA` (refazer o mapa 3D). Agente novo `cenografo` em `AGENTES`.

## Ferramentas MCP novas (`server/src/modules/cena/ferramentas.ts`)

| Ferramenta | Argumentos | Efeito |
|---|---|---|
| `definir_cena` | `projeto_id`, `camera` (objeto), `pontos_de_fuga` (lista), `volumes` (lista; em cada item `regiao_id`, `altura_real`, `espessura` em snake_case, o resto como em `VolumeEntrada`), `observacoes` | Valida, resolve, grava `Projeto.cena` com `blender: null` (apagando os arquivos do Blender anteriores), grava `Regiao.profundidade` de todas as partes com `distanciaDaParte` e devolve `{ resumo, cena: CenaResolvida }` |
| `obter_cena` | `projeto_id` | Devolve `{ cena: CenaGravada \| null, resumo }` |
| `salvar_cena_blender` | `projeto_id`, `profundidade_png`, `volumes_png`, `glb` (os três em base64), `versao` | Exige cena definida. Grava os arquivos, monta a prévia (a foto atual reduzida a no máximo 1280 px de lado, com `volumes_png` redimensionado por cima), preenche `cena.blender`, recalcula `Regiao.profundidade` pelo mapa de profundidade e devolve `{ ok: true, partes: [{ regiao_id, nome, profundidade }] }` |

Profundidade pelo mapa (regra de `salvar_cena_blender`, por parte):

1. Se algum volume da cena tem `regiaoId` igual ao id da parte, a profundidade da parte é a `distancia` desse volume (o menor, se houver mais de um). O mapa não é consultado.
2. Senão, a média `m` (0..255) dos pixels do retângulo da parte no PNG de profundidade. Se `m < 4` (quase tudo vazio), usa `distanciaDaParte` sem `profundidade` (pode dar null).
3. Senão, converte `m` com a fórmula da profundidade inversa normalizada.

O `profundidade.png` guarda profundidade INVERSA normalizada, não linear: `cinza/255 = (1/z - 1/longe) / (1/perto - 1/longe)`, com `z` a distância em metros. Volta: `z = 1 / (m/255 * (1/perto - 1/longe) + 1/longe)`. Branco = perto (`limites.perto`), preto = longe (`limites.longe`) ou vazio.

`obter_projeto` passa a trazer `cenaResumo` (texto de `resumoDaCena`, ou null) e, em cada parte, `profundidade`. `ver_opcao` acrescenta ao texto a `textoDePerspectiva` da parte, quando há cena.

## Rotas novas (`server/src/modules/cena/routes.ts`)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /projetos/:id/cena` | | `{ cena: CenaGravada \| null, resumo: string \| null, refazendo: boolean }` (`refazendo`: há trabalho `CENA` em `FILA` ou `EM_ANDAMENTO`) |
| `GET /projetos/:id/cena/glb` | | o arquivo `.glb` (`model/gltf-binary`, `Content-Disposition: attachment`); 404 sem Blender |
| `POST /projetos/:id/cena/refazer` | `{ instrucoes?: string }` (até 1000) | 201 `{ ok: true }`; cria trabalho `CENA`; 409 "O mapa 3D já está sendo refeito" se já houver um ativo |

`ProjetoDetalhe` ganha `temCena: boolean` e **não** carrega o JSON da cena; cada `Regiao` ganha `profundidade`.

## Efeitos no resto do sistema

- **Pedido ao Canva** (`gerarOpcaoCanva`): com cena, o texto de `textoDePerspectiva` da parte é acrescentado ao fim do prompt. Com `cena.blender`, o recorte do mapa de profundidade (mesmo retângulo de contexto do recorte da parte, em proporção) é enviado como segunda imagem de referência, e o prompt ganha "The second reference image is a depth map of the same crop (white = near the camera, black = far or empty). Use it only for spatial layout; never copy its look.". `parametros` da opção ganha `perspectiva: true` e `profundidade: true` conforme o caso.
- **Ordem**: ao aprovar o mapa (`POST /projetos/:id/mapa/aprovar`) e ao salvar a cena do Blender com mapa já aprovado, as partes selecionadas não resolvidas são reordenadas (`Regiao.ordem`) por `profundidade` decrescente (mais distante primeiro); partes sem profundidade vão primeiro (são fundo), mantendo a ordem relativa atual nos empates.
- **Reinício do zero** (`EXAME` com `doZero`): apaga a cena e os arquivos dela. Refazer a grade ou os elementos não apaga a cena.
- **Situação**: trabalho `CENA` ativo conta como a equipe trabalhando no passo `MAPA` (como `REFERENCIAS`), sem tirar o mapa de `AGUARDANDO` quando ele já espera o usuário.
- **Fluxo da equipe**: no trabalho `ANALISE`, o `cenografo` entra depois do analista e antes do cartógrafo. No trabalho `CENA`, só o cenógrafo.

## Blender (`agentes/blender/`)

- `montar_cena.py`: roda em `blender --background --python montar_cena.py -- <pasta>`. Lê `<pasta>/cena.json` (uma `CenaResolvida`) e escreve em `<pasta>`: `cena.blend`, `cena.glb`, `profundidade.png` (cinza 8 bits, profundidade inversa normalizada: `cinza/255 = (1/z - 1/longe) / (1/perto - 1/longe)`, branco = `limites.perto`, preto = `limites.longe` ou vazio; inclui o chão; ver "Profundidade pelo mapa"), `volumes.png` (RGBA, fundo transparente, volumes coloridos por tipo, sem o chão) e `resultado.json` (`{ ok, versao, erro? }`). Imagens com a proporção da foto e maior lado de 1024 px. A câmera do Blender reproduz a câmera da cena: um ponto do mundo aparece no render no mesmo `(u, v)` que `projetar` devolve.
- `cena.js` (Node 18+, sem dependências): `node blender/cena.js <projeto_id>`. Lê a URL e o cabeçalho do servidor MCP em `agentes/.mcp.json`, chama `obter_cena`, grava `agentes/cenas/<projeto_id>/cena.json`, roda o Blender (caminho na variável `BLENDER`, senão `C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe`, senão `blender` do PATH), chama `salvar_cena_blender` e imprime uma linha JSON com o resultado. Sai com código diferente de 0 e mensagem clara se algo falhar. Nunca imprime o token.
