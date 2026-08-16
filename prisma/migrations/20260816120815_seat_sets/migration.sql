-- CreateTable
CREATE TABLE "SeatSet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hint" TEXT NOT NULL DEFAULT '',
    "minSeats" INTEGER NOT NULL DEFAULT 5,
    "vanOnly" BOOLEAN NOT NULL DEFAULT false,
    "frontOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "SeriesPrice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seriesId" INTEGER NOT NULL,
    "seatSetId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "oldPrice" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SeriesPrice_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeriesPrice_seatSetId_fkey" FOREIGN KEY ("seatSetId") REFERENCES "SeatSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "seriesId" INTEGER,
    "showcaseSlug" TEXT,
    "seriesName" TEXT NOT NULL,
    "carLabel" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "seatSetSlug" TEXT NOT NULL DEFAULT '',
    "seatSetName" TEXT NOT NULL DEFAULT '',
    "optionsJson" TEXT NOT NULL DEFAULT '[]',
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "total" INTEGER NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("carLabel", "colorName", "id", "optionsJson", "orderId", "quantity", "seriesId", "seriesName", "showcaseSlug", "total", "unitPrice") SELECT "carLabel", "colorName", "id", "optionsJson", "orderId", "quantity", "seriesId", "seriesName", "showcaseSlug", "total", "unitPrice" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SeatSet_slug_key" ON "SeatSet"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesPrice_seriesId_seatSetId_key" ON "SeriesPrice"("seriesId", "seatSetId");
