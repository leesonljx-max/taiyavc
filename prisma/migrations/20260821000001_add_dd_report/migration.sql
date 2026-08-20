-- 尽调报告（DeepSeek Harness 架构）
-- CreateTable
CREATE TABLE "DDReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "frameworkJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gapsJson" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DDReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DDModuleResult" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "moduleName" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "conclusion" TEXT,
    "citationsJson" TEXT,
    "missing" TEXT,
    "inputHash" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DDModuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DDReport_projectId_key" ON "DDReport"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DDModuleResult_reportId_moduleKey_key" ON "DDModuleResult"("reportId", "moduleKey");

-- CreateIndex
CREATE INDEX "DDModuleResult_reportId_idx" ON "DDModuleResult"("reportId");

-- AddForeignKey
ALTER TABLE "DDReport" ADD CONSTRAINT "DDReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DDModuleResult" ADD CONSTRAINT "DDModuleResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DDReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
