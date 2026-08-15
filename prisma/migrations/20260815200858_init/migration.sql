-- CreateTable
CREATE TABLE "Brand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "intro" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CarModel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER,
    "seats" INTEGER NOT NULL DEFAULT 5,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "splitRearSeat" BOOLEAN NOT NULL DEFAULT true,
    "rearArmrest" BOOLEAN NOT NULL DEFAULT false,
    "airbagInBackrest" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "intro" TEXT,
    CONSTRAINT "CarModel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "wearYears" INTEGER NOT NULL DEFAULT 5,
    "careNotes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "Series" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Series_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeriesImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "SeriesImage_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeriesColor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "insertHex" TEXT NOT NULL DEFAULT '',
    "threadHex" TEXT NOT NULL DEFAULT '#FFFFFF',
    "image" TEXT,
    "surcharge" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "SeriesColor_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BodyFactor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bodyType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factor" REAL NOT NULL DEFAULT 1.0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "ModelPrice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "carModelId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    CONSTRAINT "ModelPrice_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModelPrice_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "CarModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "deliveryMethod" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "warehouse" TEXT,
    "address" TEXT,
    "paymentMethod" TEXT NOT NULL,
    "comment" TEXT,
    "adminNote" TEXT,
    "itemsTotal" INTEGER NOT NULL,
    "deliveryCost" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "seriesId" INTEGER,
    "seriesName" TEXT NOT NULL,
    "carLabel" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL DEFAULT '[]',
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "total" INTEGER NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "author" TEXT NOT NULL,
    "city" TEXT,
    "carLabel" TEXT NOT NULL,
    "seriesId" INTEGER,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "text" TEXT NOT NULL,
    "photo" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL DEFAULT 'individual',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "carLabel" TEXT,
    "message" TEXT,
    "photosJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'new',
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cover" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "CarModel_bodyType_idx" ON "CarModel"("bodyType");

-- CreateIndex
CREATE UNIQUE INDEX "CarModel_brandId_slug_key" ON "CarModel"("brandId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Material_slug_key" ON "Material"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesColor_seriesId_slug_key" ON "SeriesColor"("seriesId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "BodyFactor_bodyType_key" ON "BodyFactor"("bodyType");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrice_seriesId_carModelId_key" ON "ModelPrice"("seriesId", "carModelId");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_slug_key" ON "AddOn"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Review_published_idx" ON "Review"("published");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");

-- CreateIndex
CREATE INDEX "Post_published_idx" ON "Post"("published");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
