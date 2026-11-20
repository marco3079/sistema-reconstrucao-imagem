"""
Monta a cena 3D de <pasta>/cena.json (CenaResolvida) e gera, em <pasta>:
cena.blend, cena.glb, profundidade.png, volumes.png e resultado.json.

profundidade.png: cinza 8 bits com DISPARIDADE normalizada (inverso da distancia):
branco = limites.perto, preto = limites.longe ou vazio (ver material_profundidade).

Uso: blender --background --python montar_cena.py -- <pasta>
"""
import bpy
import json
import math
import os
import sys
import traceback

from mathutils import Matrix
from bpy_extras.object_utils import world_to_camera_view

LADO_PX = 1024
CHAO_SIMULADO = 400.0   # metros, chao usado no render
CHAO_GLB = 20.0         # metros, chao exportado no glb
CORES_TIPO = {
    'PESSOA': '#E4572E',
    'OBJETO': '#2E86AB',
    'PAREDE': '#8D99AE',
    'OUTRO': '#6A994E',
}
COR_CHAO = '#DDDDDD'


def hex_para_linear(cor):
    """Cor sRGB #RRGGBB -> valores lineares (o Blender trabalha em linear)."""
    h = cor.lstrip('#')
    saida = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        saida.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(saida)


def pasta_do_argumento():
    if '--' not in sys.argv:
        raise ValueError('Uso: blender --background --python montar_cena.py -- <pasta>')
    i = sys.argv.index('--')
    if i + 1 >= len(sys.argv):
        raise ValueError('Falta a pasta depois de --')
    return os.path.abspath(sys.argv[i + 1])


def escrever_resultado(pasta, dados):
    with open(os.path.join(pasta, 'resultado.json'), 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)


def identificador_eevee(scene):
    itens = [e.identifier for e in scene.render.bl_rna.properties['engine'].enum_items]
    for nome in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        if nome in itens:
            return nome
    for nome in itens:
        if 'EEVEE' in nome:
            return nome
    raise RuntimeError('EEVEE nao encontrado. Motores: ' + ', '.join(itens))


def nova_cena():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def configurar_resolucao(scene, largura, altura):
    a = largura / altura
    if a >= 1:
        rx, ry = LADO_PX, max(1, round(LADO_PX / a))
    else:
        ry, rx = LADO_PX, max(1, round(LADO_PX * a))
    scene.render.resolution_x = rx
    scene.render.resolution_y = ry
    scene.render.resolution_percentage = 100


def criar_camera(scene, cena):
    cam_info = cena['camera']
    dados = bpy.data.cameras.new('Camera')
    dados.sensor_fit = 'VERTICAL'
    dados.angle_y = math.radians(cam_info['fovVertical'])
    cam = bpy.data.objects.new('Camera', dados)
    scene.collection.objects.link(cam)
    cam.location = (0.0, 0.0, cam_info['altura'])
    # Camera do Blender olha para -Z local. Com rotacao X de 90 graus ela olha para +Y
    # e com o Z para cima; a inclinacao soma (positivo = para cima).
    # Rolagem: rotacao em torno do eixo optico (sinal: rolagem positiva deixa a cena
    # girada no sentido anti-horario na imagem).
    inc = math.radians(cam_info['inclinacao'])
    rol = math.radians(cam_info['rolagem'])
    rot = Matrix.Rotation(math.pi / 2 + inc, 4, 'X') @ Matrix.Rotation(-rol, 4, 'Z')
    cam.rotation_mode = 'XYZ'
    cam.rotation_euler = rot.to_euler('XYZ')
    scene.camera = cam
    bpy.context.view_layer.update()
    return cam


def criar_volumes(scene, cena):
    saida = []
    for v in cena['volumes']:
        cx, cy, cz = v['centro']['x'], v['centro']['y'], v['centro']['z']
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy, cz))
        obj = bpy.context.active_object
        obj.name = v['nome']
        obj.data.name = v['nome']
        obj.scale = (v['tamanho']['x'], v['tamanho']['y'], v['tamanho']['z'])
        saida.append((obj, v))
    bpy.context.view_layer.update()
    return saida


def criar_chao(scene):
    bpy.ops.mesh.primitive_plane_add(size=CHAO_SIMULADO, location=(0.0, 0.0, 0.0))
    chao = bpy.context.active_object
    chao.name = 'Chao'
    chao.data.name = 'Chao'
    return chao


def material_emissao(nome, cor):
    mat = bpy.data.materials.new(nome)
    mat.use_nodes = True
    nos = mat.node_tree.nodes
    nos.clear()
    saida = nos.new('ShaderNodeOutputMaterial')
    emi = nos.new('ShaderNodeEmission')
    emi.inputs['Color'].default_value = (cor[0], cor[1], cor[2], 1.0)
    emi.inputs['Strength'].default_value = 1.0
    mat.node_tree.links.new(emi.outputs['Emission'], saida.inputs['Surface'])
    return mat


def material_profundidade(perto, longe):
    """Emissao cinza = disparidade normalizada (inverso da distancia), nao a distancia linear.

    cinza = clamp((1/z - 1/longe) / (1/perto - 1/longe), 0, 1), z = View Z Depth
    (distancia ao longo do eixo optico). perto -> 1.0 (branco), longe -> 0.0 (preto).
    Motivo: com distancia linear, um longe grande (ex.: 700 m) deixa 2,7 m por nivel de
    8 bits e pessoa a 3 m e caixa a 8 m ficam com o mesmo cinza; o inverso espalha os
    niveis pelo perto.
    Nos: Camera Data -> Math DIVIDE (1 / z) -> SUBTRACT (- 1/longe) -> MULTIPLY (k, clamp 0..1).
    """
    if not (0.0 < perto < longe):
        raise ValueError('limites invalidos para profundidade: perto=%s longe=%s' % (perto, longe))
    k = 1.0 / (1.0 / perto - 1.0 / longe)
    mat = bpy.data.materials.new('Profundidade')
    mat.use_nodes = True
    nos = mat.node_tree.nodes
    links = mat.node_tree.links
    nos.clear()
    saida = nos.new('ShaderNodeOutputMaterial')
    emi = nos.new('ShaderNodeEmission')
    emi.inputs['Strength'].default_value = 1.0
    cam_data = nos.new('ShaderNodeCameraData')

    inverso = nos.new('ShaderNodeMath')
    inverso.operation = 'DIVIDE'
    inverso.inputs[0].default_value = 1.0
    links.new(cam_data.outputs['View Z Depth'], inverso.inputs[1])

    subtrai = nos.new('ShaderNodeMath')
    subtrai.operation = 'SUBTRACT'
    subtrai.inputs[1].default_value = 1.0 / longe
    links.new(inverso.outputs['Value'], subtrai.inputs[0])

    # MULTIPLY com use_clamp = resultado preso em 0..1 (Math nao tem operacao CLAMP no Blender 5.3)
    escala = nos.new('ShaderNodeMath')
    escala.operation = 'MULTIPLY'
    escala.use_clamp = True
    escala.inputs[1].default_value = k
    links.new(subtrai.outputs['Value'], escala.inputs[0])

    links.new(escala.outputs['Value'], emi.inputs['Color'])
    links.new(emi.outputs['Emission'], saida.inputs['Surface'])
    return mat


def atribuir(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def configurar_cor(scene, transparente, view_transform):
    scene.render.film_transparent = transparente
    scene.view_settings.view_transform = view_transform
    if 'None' in [l.identifier for l in scene.view_settings.bl_rna.properties['look'].enum_items]:
        scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    if hasattr(scene.view_settings, 'dither'):
        scene.view_settings.dither = 0.0


def configurar_motor(scene, motor, amostras):
    if motor == 'CYCLES':
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = amostras
        scene.cycles.use_denoising = False
    else:
        scene.render.engine = identificador_eevee(scene)
        scene.eevee.taa_render_samples = amostras


def renderizar(scene, caminho, modo_cor):
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.color_mode = modo_cor
    scene.render.filepath = caminho
    res = bpy.ops.render.render(write_still=True)
    if 'FINISHED' not in res or not os.path.exists(caminho):
        raise RuntimeError('Render falhou: ' + caminho)


def conferir_projecoes(scene, cam, volumes):
    saida = []
    for obj, v in volumes:
        co = world_to_camera_view(scene, cam, obj.location)
        saida.append({'nome': v['nome'], 'u': round(co.x, 6), 'v': round(1.0 - co.y, 6)})
    return saida


def gerar(pasta, cena, motor):
    scene = nova_cena()
    configurar_resolucao(scene, cena['largura'], cena['altura'])
    cam = criar_camera(scene, cena)
    volumes = criar_volumes(scene, cena)
    chao = criar_chao(scene)
    projecoes = conferir_projecoes(scene, cam, volumes)

    perto = cena['limites']['perto']
    longe = cena['limites']['longe']

    # 1) profundidade.png: todos os objetos (chao incluido), fundo preto
    scene.world = None
    mat_prof = material_profundidade(perto, longe)
    atribuir(chao, mat_prof)
    for obj, _ in volumes:
        atribuir(obj, mat_prof)
    configurar_cor(scene, False, 'Raw')
    configurar_motor(scene, motor, 1)
    renderizar(scene, os.path.join(pasta, 'profundidade.png'), 'BW')

    # 2) volumes.png: sem chao, fundo transparente, cor por tipo
    chao.hide_render = True
    for obj, v in volumes:
        atribuir(obj, material_emissao('Tipo_' + v['tipo'], hex_para_linear(CORES_TIPO[v['tipo']])))
    configurar_cor(scene, True, 'Standard')
    configurar_motor(scene, motor, 4)
    renderizar(scene, os.path.join(pasta, 'volumes.png'), 'RGBA')

    # 3) cena.glb (chao reduzido a 20 x 20 m) e cena.blend
    chao.hide_render = False
    escala = CHAO_GLB / CHAO_SIMULADO
    chao.scale = (escala, escala, 1.0)
    atribuir(chao, material_emissao('Chao', hex_para_linear(COR_CHAO)))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(pasta, 'cena.glb'),
        export_format='GLB',
        export_cameras=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(pasta, 'cena.blend'))
    return projecoes


def main():
    pasta = None
    try:
        pasta = pasta_do_argumento()
        with open(os.path.join(pasta, 'cena.json'), encoding='utf-8') as f:
            cena = json.load(f)
        try:
            projecoes = gerar(pasta, cena, 'EEVEE')
            motor = 'EEVEE'
        except Exception as erro:
            print('EEVEE falhou, tentando CYCLES (CPU): ' + str(erro))
            projecoes = gerar(pasta, cena, 'CYCLES')
            motor = 'CYCLES'
        escrever_resultado(pasta, {
            'ok': True,
            'versao': bpy.app.version_string,
            'motor': motor,
            'projecoes': projecoes,
        })
        print('montar_cena: ok (' + motor + ')')
    except Exception as erro:
        traceback.print_exc()
        if pasta and os.path.isdir(pasta):
            escrever_resultado(pasta, {'ok': False, 'erro': str(erro)})
        sys.exit(1)


main()
