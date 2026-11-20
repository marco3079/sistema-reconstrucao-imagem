// Seed: cria só a conta de administrador.
// Senha inicial: ADMIN_SENHA do .env (8 caracteres ou mais) ou, se ausente/curta, a senha padrão admin1234.
// Idempotente: se já houver usuários, não faz nada.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SENHA_PADRAO = 'admin1234';

async function main(): Promise<void> {
  if ((await prisma.usuario.count()) > 0) {
    console.log('Banco já possui dados, seed ignorado.');
    return;
  }

  const nome = process.env.ADMIN_NOME || 'Administrador';
  const email = (process.env.ADMIN_EMAIL || 'admin@restaura.local').trim().toLowerCase();
  let senha = process.env.ADMIN_SENHA || '';
  let padrao = false;
  if (senha.length < 8) {
    senha = SENHA_PADRAO;
    padrao = true;
  }

  await prisma.usuario.create({
    data: { nome, email, perfil: 'ADMIN', ativo: true, senhaHash: bcrypt.hashSync(senha, 10) },
  });

  console.log('==== ADMINISTRADOR CRIADO ====');
  console.log(`E-mail: ${email}`);
  if (padrao) console.log(`Senha padrão: ${SENHA_PADRAO}`);
  console.log('Troque a senha em "Meu perfil" depois do primeiro acesso.');
  console.log('==============================');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error('Erro ao executar o seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
