-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "stellarAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "collateralAmount" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "debtAmount" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "userId" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(50),
    "bio" VARCHAR(280),
    "website" VARCHAR(2048),
    "timezone" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_stellarAddress_key" ON "accounts"("stellarAddress");

-- CreateIndex
CREATE INDEX "positions_asset_idx" ON "positions"("asset");

-- CreateIndex
CREATE UNIQUE INDEX "positions_accountId_asset_key" ON "positions"("accountId", "asset");

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
