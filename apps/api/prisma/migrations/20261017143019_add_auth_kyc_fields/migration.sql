-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "stripeVerificationSessionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fullName" TEXT;
