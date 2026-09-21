require('@next/env').loadEnvConfig(process.cwd());
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.systemConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', appName: 'WA-AKG', timezone: 'Asia/Kolkata', enableRegistration: false },
    update: { timezone: 'Asia/Kolkata', enableRegistration: false },
  });
  const user = await prisma.user.findUnique({ where: { email: 'ssy.balu@gmail.com' }, select: { email: true, role: true } });
  if (!user || user.role !== 'SUPERADMIN') throw new Error('Expected administrator missing');
  console.log('Administrator verified; India timezone configured; public registration disabled.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
