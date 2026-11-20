import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { HttpError } from './lib/erros';
import { autenticar, tokenDeAgenteValido } from './lib/auth';
import { tratarMcp } from './lib/mcp';

interface ModuloRotas {
  publico?: Router;
  default?: Router;
}

// Cada pasta de src/modules pode ter routes.ts (rotas HTTP) e ferramentas.ts (ferramentas MCP dos agentes).
function carregarModulos(): { nome: string; mod: ModuloRotas }[] {
  const dirModulos = path.join(__dirname, 'modules');
  const existe = (pasta: string, base: string) =>
    fs.existsSync(path.join(dirModulos, pasta, `${base}.ts`)) || fs.existsSync(path.join(dirModulos, pasta, `${base}.js`));
  const pastas = fs
    .readdirSync(dirModulos, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const modulos: { nome: string; mod: ModuloRotas }[] = [];
  for (const nome of pastas) {
    if (existe(nome, 'ferramentas')) {
      // O arquivo registra as ferramentas ao ser carregado.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(path.join(dirModulos, nome, 'ferramentas'));
    }
    if (existe(nome, 'routes')) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(dirModulos, nome, 'routes')) as ModuloRotas;
      modulos.push({ nome, mod });
    }
  }
  return modulos;
}

function tratarErro(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (e instanceof HttpError) {
    res.status(e.status).json({ erro: e.message, detalhes: e.detalhes });
    return;
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      res.status(409).json({ erro: 'Registro duplicado' });
      return;
    }
    if (e.code === 'P2025') {
      res.status(404).json({ erro: 'Registro não encontrado' });
      return;
    }
  }
  if ((e as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ erro: 'JSON inválido' });
    return;
  }
  if ((e as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ erro: 'Arquivo grande demais' });
    return;
  }
  console.error(`Erro em ${req.method} ${req.originalUrl}:`, e);
  res.status(500).json({ erro: 'Erro interno' });
}

export function criarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  // MCP recebe a cena do Blender em base64 (três arquivos de até 1,2 MB cada): precisa de mais que 2 MB.
  // Registrado antes do parser global; este já lê o corpo e o global não lê de novo (body-parser marca req._body).
  app.use('/mcp', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '2mb' }));

  const modulos = carregarModulos();

  // Servidor MCP da equipe de agentes: só com o token dos agentes.
  app.post('/mcp', (req, res, next) => {
    const cabecalho = req.headers.authorization ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!tokenDeAgenteValido(token)) {
      res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Token dos agentes inválido' } });
      return;
    }
    tratarMcp(req, res).catch(next);
  });
  // Sem fluxo de eventos: o cliente MCP usa só POST.
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ erro: 'Use POST' });
  });

  // Primeiro todas as rotas públicas, depois as autenticadas.
  for (const { mod } of modulos) {
    if (mod.publico) app.use('/api', mod.publico);
  }
  for (const { mod } of modulos) {
    if (mod.default) app.use('/api', autenticar, mod.default);
  }

  app.use((_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  app.use(tratarErro);

  return app;
}
