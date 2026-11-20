import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Perfil } from '@prisma/client';

export interface UsuarioToken {
  id: number;
  perfil: Perfil;
}

declare global {
  namespace Express {
    interface Request {
      usuario: UsuarioToken;
    }
  }
}

const SEGREDO_DE_EXEMPLO = 'troque-este-segredo-de-exemplo';

// Calculado uma vez na subida. Se o segredo estiver ausente ou for o de exemplo,
// gera um aleatório para a execução.
const SEGREDO_JWT: string = (() => {
  const valor = process.env.JWT_SECRET ?? '';
  if (valor.length < 16 || valor === SEGREDO_DE_EXEMPLO) {
    console.warn(
      'Aviso: JWT_SECRET ausente ou de exemplo. Um segredo aleatório foi gerado para esta execução; os logins expiram quando o servidor reiniciar. Defina JWT_SECRET no .env (o instalador faz isso).'
    );
    return crypto.randomBytes(48).toString('hex');
  }
  return valor;
})();

// Segredo efetivo do servidor. Usado também para derivar a chave de lib/cripto.ts.
export function segredoDoServidor(): string {
  return SEGREDO_JWT;
}

export function gerarToken(u: UsuarioToken): string {
  return jwt.sign({ id: u.id, perfil: u.perfil }, SEGREDO_JWT, { expiresIn: '12h' });
}

export const autenticar: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const cabecalho = req.headers.authorization ?? '';
  if (!cabecalho.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  const token = cabecalho.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, SEGREDO_JWT) as jwt.JwtPayload;
    req.usuario = { id: payload.id, perfil: payload.perfil as Perfil };
  } catch {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  next();
};

export function permitir(...perfis: Perfil[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || !perfis.includes(req.usuario.perfil)) {
      res.status(403).json({ erro: 'Sem permissão' });
      return;
    }
    next();
  };
}

// Token fixo da equipe de agentes (sessão do Claude Code). Vem de AGENTES_TOKEN no .env.
// Sem a variável, um token aleatório é gerado e mostrado no log da subida.
const TOKEN_AGENTES: string = (() => {
  const valor = (process.env.AGENTES_TOKEN ?? '').trim();
  if (valor.length >= 16) return valor;
  const gerado = crypto.randomBytes(24).toString('hex');
  console.warn(`Aviso: AGENTES_TOKEN ausente. Token dos agentes desta execução: ${gerado}`);
  return gerado;
})();

export function tokenDosAgentes(): string {
  return TOKEN_AGENTES;
}

// Confere o token dos agentes sem vazar tempo de comparação.
export function tokenDeAgenteValido(recebido: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(TOKEN_AGENTES);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
