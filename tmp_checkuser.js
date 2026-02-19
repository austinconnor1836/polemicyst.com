const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({
    where: { id: '17139b6f-17bf-4101-ab6c-c7acc8bd0187' },
    select: { id: true, email: true },
  });
  console.log(user);
  await prisma.$disconnect();
})();
