-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "wearYears" INTEGER NOT NULL DEFAULT 5,
    "surcharge" INTEGER NOT NULL DEFAULT 0,
    "careNotes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);
INSERT INTO "new_Material" ("careNotes", "description", "id", "name", "shortName", "slug", "sortOrder", "wearYears") SELECT "careNotes", "description", "id", "name", "shortName", "slug", "sortOrder", "wearYears" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE UNIQUE INDEX "Material_slug_key" ON "Material"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
