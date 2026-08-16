-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "showcaseSlug" TEXT;

-- CreateTable
CREATE TABLE "Palette" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "surcharge" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "Showcase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "carModelId" INTEGER,
    "carLabel" TEXT NOT NULL,
    "year" INTEGER,
    "seriesId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "materialNote" TEXT NOT NULL DEFAULT '',
    "colorNote" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "oldPrice" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Showcase_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "CarModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Showcase_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShowcasePhoto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showcaseId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'covers',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "ShowcasePhoto_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "Showcase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Series" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "materialId" INTEGER NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "featuresJson" TEXT NOT NULL DEFAULT '[]',
    "includesJson" TEXT NOT NULL DEFAULT '[]',
    "basePrice" INTEGER NOT NULL,
    "oldPrice" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 18,
    "productionDays" INTEGER NOT NULL DEFAULT 5,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "allowCustomColors" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Series_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Series" ("active", "basePrice", "createdAt", "description", "featuresJson", "id", "includesJson", "materialId", "name", "oldPrice", "popular", "productionDays", "seoDescription", "seoTitle", "shortDescription", "slug", "sortOrder", "tagline", "tier", "warrantyMonths") SELECT "active", "basePrice", "createdAt", "description", "featuresJson", "id", "includesJson", "materialId", "name", "oldPrice", "popular", "productionDays", "seoDescription", "seoTitle", "shortDescription", "slug", "sortOrder", "tagline", "tier", "warrantyMonths" FROM "Series";
DROP TABLE "Series";
ALTER TABLE "new_Series" RENAME TO "Series";
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Palette_slug_key" ON "Palette"("slug");

-- CreateIndex
CREATE INDEX "Palette_kind_idx" ON "Palette"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Showcase_slug_key" ON "Showcase"("slug");

-- CreateIndex
CREATE INDEX "Showcase_published_idx" ON "Showcase"("published");

-- CreateIndex
CREATE INDEX "Showcase_carModelId_idx" ON "Showcase"("carModelId");

-- CreateIndex
CREATE INDEX "ShowcasePhoto_showcaseId_idx" ON "ShowcasePhoto"("showcaseId");
