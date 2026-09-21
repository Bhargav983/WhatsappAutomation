import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.scheduledmessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("Recent Scheduled Messages:");
  console.dir(messages, { depth: null });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

