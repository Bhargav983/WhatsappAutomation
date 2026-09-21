
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

async function main() {
    const email = "test@api.com";
    const apiKey = "wag_TESTAPIKEY123";
    const password = await bcrypt.hash("password123", 10);

    const user = await prisma.user.upsert({
        where: { email },
        update: { apiKey, role: 'SUPERADMIN', updatedAt: new Date() },
        create: {
            id: "test_user_id_123",
            email,
            password,
            name: "Test User",
            apiKey,
            role: 'SUPERADMIN',
            updatedAt: new Date()
        }
    });

    console.log(`User ${user.email} ready with API Key: ${user.apiKey}`);
    
    // Also ensure a session exists for testing
    const session = await prisma.session.upsert({
        where: { sessionId: "test-session" },
        update: { userId: user.id, updatedAt: new Date() },
        create: {
            id: "test-session",
            sessionId: "test-session",
            name: "Test Session",
            userId: user.id,
            status: "CONNECTED",
            updatedAt: new Date()
        }
    });
    console.log(`Session ${session.sessionId} ready.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
