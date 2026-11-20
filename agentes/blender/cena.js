// Monta o mapa 3D de um projeto no Blender e devolve os arquivos ao servidor.
// Uso (de dentro de agentes/): node blender/cena.js <projeto_id>
//                              node blender/cena.js --so-blender <pasta>
// Node 18+, sem dependencias. Nunca imprime cabecalhos nem token.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ_AGENTES = path.join(__dirname, '..');
const ARQUIVO_MCP = path.join(RAIZ_AGENTES, '.mcp.json');
const PASTA_CENAS = path.join(RAIZ_AGENTES, 'cenas');
const SCRIPT_BLENDER = path.join(__dirname, 'montar_cena.py');
const BLENDER_STEAM = 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const TIMEOUT_BLENDER_MS = 180000;
const LIMITE_ARQUIVO_BYTES = 1.2 * 1024 * 1024;

let contador = 0;

function erro(mensagem) {
  const e = new Error(mensagem);
  e.semDetalhe = true;
  return e;
}

// Le a URL e os cabecalhos do servidor MCP. Nunca expõe os valores.
function lerConfigMcp() {
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(ARQUIVO_MCP, 'utf8'));
  } catch (_) {
    throw erro('Nao consegui ler agentes/.mcp.json');
  }
  const restaura = bruto && bruto.mcpServers && bruto.mcpServers.restaura;
  if (!restaura || typeof restaura.url !== 'string') {
    throw erro('agentes/.mcp.json sem mcpServers.restaura.url');
  }
  return { url: restaura.url, headers: restaura.headers || {} };
}

async function chamar(config, nome, argumentos) {
  contador += 1;
  const corpo = {
    jsonrpc: '2.0',
    id: contador,
    method: 'tools/call',
    params: { name: nome, arguments: argumentos },
  };
  let resposta;
  try {
    resposta = await fetch(config.url, {
      method: 'POST',
      headers: { ...config.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (_) {
    throw erro('Falha de rede ao chamar ' + nome);
  }
  let json = null;
  try {
    json = await resposta.json();
  } catch (_) {
    json = null;
  }
  const result = json && json.result;
  if (!resposta.ok || !result || !Array.isArray(result.content) || !result.content[0]) {
    if (resposta.status === 413) throw erro('O servidor recusou o tamanho dos arquivos');
    const partes = [nome + ': HTTP ' + resposta.status];
    const msgServidor = json && ((typeof json.erro === 'string' && json.erro) || (json.error && json.error.message));
    if (msgServidor) partes.push(String(msgServidor));
    throw erro(partes.join(' - '));
  }
  const texto = result.content[0].text || '';
  if (result.isError) throw erro(texto || 'Erro em ' + nome);
  try {
    return JSON.parse(texto);
  } catch (_) {
    throw erro('Resposta de ' + nome + ' nao e JSON');
  }
}

function acharBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  if (fs.existsSync(BLENDER_STEAM)) return BLENDER_STEAM;
  return 'blender';
}

function rodarBlender(pasta) {
  const exe = acharBlender();
  const r = spawnSync(exe, ['--background', '--python', SCRIPT_BLENDER, '--', pasta], {
    timeout: TIMEOUT_BLENDER_MS,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const log = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(pasta, 'blender.log'), log, 'utf8');
  if (r.error) throw erro('Nao consegui rodar o Blender (' + exe + '): ' + r.error.code);
  if (r.signal) throw erro('Blender interrompido (' + r.signal + '). Veja blender.log');
  if (r.status !== 0) throw erro('Blender terminou com codigo ' + r.status + '. Veja blender.log');
}

function lerResultado(pasta) {
  const arq = path.join(pasta, 'resultado.json');
  if (!fs.existsSync(arq)) throw erro('Blender nao gerou resultado.json');
  const res = JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (!res.ok) throw erro('Blender falhou: ' + (res.erro || 'erro desconhecido'));
  for (const f of ['cena.glb', 'cena.blend', 'profundidade.png', 'volumes.png']) {
    if (!fs.existsSync(path.join(pasta, f))) throw erro('Arquivo faltando: ' + f);
  }
  return res;
}

function arquivoBase64(pasta, nome) {
  const buf = fs.readFileSync(path.join(pasta, nome));
  if (buf.length > LIMITE_ARQUIVO_BYTES) {
    throw erro(nome + ' tem ' + buf.length + ' bytes, acima do limite de 1,2 MB');
  }
  return buf.toString('base64');
}

async function main() {
  const args = process.argv.slice(2);
  let pasta;
  let projetoId = null;
  let config = null;
  let versaoBlender;
  let res;

  if (args[0] === '--so-blender') {
    if (!args[1]) throw erro('Uso: --so-blender <pasta>');
    pasta = path.resolve(args[1]);
    if (!fs.existsSync(path.join(pasta, 'cena.json'))) throw erro('Falta cena.json em ' + pasta);
    rodarBlender(pasta);
    res = lerResultado(pasta);
    return {
      ok: true,
      pasta,
      versao: res.versao,
      motor: res.motor,
      projecoes: res.projecoes,
    };
  }

  projetoId = args[0];
  if (!projetoId) throw erro('Uso: node blender/cena.js <projeto_id>');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projetoId)) throw erro('projeto_id invalido');

  config = lerConfigMcp();
  const dados = await chamar(config, 'obter_cena', { projeto_id: projetoId });
  if (!dados || !dados.cena) {
    throw erro('O projeto ainda não tem cena definida (definir_cena)');
  }
  const resolvida = dados.cena.resolvida;
  if (!resolvida) throw erro('Cena sem dados resolvidos');

  pasta = path.join(PASTA_CENAS, projetoId);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'cena.json'), JSON.stringify(resolvida, null, 2), 'utf8');

  rodarBlender(pasta);
  res = lerResultado(pasta);
  versaoBlender = res.versao;

  const arquivos = {
    profundidade_png: arquivoBase64(pasta, 'profundidade.png'),
    volumes_png: arquivoBase64(pasta, 'volumes.png'),
    glb: arquivoBase64(pasta, 'cena.glb'),
  };
  const salvo = await chamar(config, 'salvar_cena_blender', {
    projeto_id: projetoId,
    profundidade_png: arquivos.profundidade_png,
    volumes_png: arquivos.volumes_png,
    glb: arquivos.glb,
    versao: versaoBlender,
  });
  const partes = Array.isArray(salvo && salvo.partes) ? salvo.partes.length : 0;
  return {
    ok: true,
    projeto_id: projetoId,
    versao: versaoBlender,
    motor: res.motor,
    partes,
  };
}

main()
  .then((saida) => {
    console.log(JSON.stringify(saida));
  })
  .catch((e) => {
    const mensagem = e && e.message ? e.message : String(e);
    console.log(JSON.stringify({ ok: false, erro: mensagem }));
    process.exit(1);
  });
