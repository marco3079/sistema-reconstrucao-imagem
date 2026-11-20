// Gancho da sessão da equipe de restauração: não deixa o laço do /restaurar acabar sozinho.
//
// Uso (ver .claude/settings.json):
//   node laco.js prompt   -> evento UserPromptSubmit: liga o laço em "/restaurar ...", desliga em "/parar" ou "parar".
//   node laco.js parar    -> evento Stop: enquanto o laço estiver ligado, manda a sessão continuar.
//
// O estado fica em .claude/restaura-ativo.json (fora do git). Para desligar à mão, apague esse arquivo.

const fs = require('fs');
const path = require('path');

const MARCA = path.join(__dirname, '..', 'restaura-ativo.json');
const modo = process.argv[2];

function lerMarca() {
  try {
    return JSON.parse(fs.readFileSync(MARCA, 'utf8'));
  } catch {
    return null;
  }
}

function gravarMarca(dados) {
  try {
    fs.writeFileSync(MARCA, JSON.stringify(dados));
  } catch {
    // Sem permissão de escrita: o gancho deixa de segurar o laço, mas não atrapalha a sessão.
  }
}

function apagarMarca() {
  try {
    fs.unlinkSync(MARCA);
  } catch {
    // Já não existia.
  }
}

let entrada = '';
process.stdin.on('data', (pedaco) => {
  entrada += pedaco;
});
process.stdin.on('end', () => {
  let dados = {};
  try {
    dados = JSON.parse(entrada || '{}');
  } catch {
    dados = {};
  }

  if (modo === 'prompt') {
    const texto = String(dados.prompt || '').trim().toLowerCase();
    if (texto.startsWith('/restaurar')) {
      const id = texto.replace('/restaurar', '').trim();
      gravarMarca({ projeto: id, desde: Date.now(), paradas: [] });
    } else if (texto === '/parar' || texto === 'parar' || texto.startsWith('parar ') || texto.startsWith('pare')) {
      apagarMarca();
    }
    process.exit(0);
  }

  if (modo === 'parar') {
    const marca = lerMarca();
    if (!marca) process.exit(0);

    // Trava de segurança: se a sessão tentou parar 6 vezes em 60 s, algo está falhando em laço
    // (servidor fora do ar, ferramenta com erro). Solta o laço para não gastar à toa.
    const agora = Date.now();
    const paradas = (Array.isArray(marca.paradas) ? marca.paradas : []).filter((t) => agora - t < 60000);
    paradas.push(agora);
    if (paradas.length >= 6) {
      apagarMarca();
      process.exit(0);
    }
    gravarMarca({ ...marca, paradas });

    const alvo = marca.projeto ? ` com projeto_id ${marca.projeto}` : '';
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          `A sessão está ligada a uma imagem do Restaura e o laço não pode parar: chame mcp__restaura__aguardar_trabalho${alvo} de novo agora. ` +
          'Se a ferramenta devolveu erro de conexão, espere e tente de novo. Só pare quando o usuário digitar /parar.',
      })
    );
    process.exit(0);
  }

  process.exit(0);
});
