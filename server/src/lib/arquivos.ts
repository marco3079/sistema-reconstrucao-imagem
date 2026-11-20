import crypto from 'crypto';
import express, { RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { HttpError } from './erros';

// Imagens ficam em disco (volume dados_arquivos no Docker). O banco guarda só o nome do arquivo.
// O nome é aleatório (32 hexadecimais + extensão): quem tem o nome pode ler o arquivo.

export const DIR_ARQUIVOS = path.resolve(process.env.DIR_ARQUIVOS ?? path.join(process.cwd(), 'dados', 'arquivos'));

fs.mkdirSync(DIR_ARQUIVOS, { recursive: true });

const NOME_VALIDO = /^[0-9a-f]{32}\.(png|jpg|webp|glb)$/;

export function nomeDeArquivoValido(nome: string): boolean {
  return NOME_VALIDO.test(nome);
}

export function caminhoDoArquivo(nome: string): string {
  if (!nomeDeArquivoValido(nome)) throw new HttpError(400, 'Nome de arquivo inválido');
  return path.join(DIR_ARQUIVOS, nome);
}

// Grava o conteúdo e devolve o nome gerado.
export async function salvarArquivo(conteudo: Buffer, extensao: 'png' | 'jpg' | 'webp' | 'glb' = 'png'): Promise<string> {
  const nome = `${crypto.randomBytes(16).toString('hex')}.${extensao}`;
  await fs.promises.writeFile(path.join(DIR_ARQUIVOS, nome), conteudo);
  return nome;
}

export async function lerArquivo(nome: string): Promise<Buffer> {
  try {
    return await fs.promises.readFile(caminhoDoArquivo(nome));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(404, 'Arquivo não encontrado');
  }
}

// Apaga sem reclamar se o arquivo já não existir.
export async function apagarArquivo(nome: string | null | undefined): Promise<void> {
  if (!nome || !nomeDeArquivoValido(nome)) return;
  await fs.promises.unlink(path.join(DIR_ARQUIVOS, nome)).catch(() => undefined);
}

// Middleware para rotas que recebem a imagem como corpo bruto (até 30 MB). O corpo chega em req.body (Buffer).
export const corpoDeImagem: RequestHandler = express.raw({
  type: ['image/*', 'application/octet-stream'],
  limit: '30mb',
});

// Devolve o Buffer do corpo bruto ou lança 400.
export function imagemDoCorpo(corpo: unknown): Buffer {
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) {
    throw new HttpError(400, 'Envie a imagem no corpo da requisição');
  }
  return corpo;
}
