/**
 * 用户 PetDex ZIP 的真实 Electron smoke test。
 * 宠物只安装到新建的系统临时目录，并由 Chromium 再解码一次图集；
 * finally 会删除临时文件，不会写入用户正式的 ~/.codex/pets。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  inspectPetSpritesheetFile,
  installPetPackageFromZipFile
} = require("../build/main/services/custom-pet-service");
const { discoverPets } = require("../src/pet-library");

const zipPathArgument = process.argv.slice(2).find((argument) => /\.zip$/i.test(argument));

app.whenReady().then(async () => {
  if (!zipPathArgument) throw new Error("Usage: npm run smoke:pet-zip -- <pet.zip>");
  const zipPath = path.resolve(zipPathArgument);
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "taskpet-pet-zip-smoke-"));
  try {
    const petsRoot = path.join(smokeRoot, "pets");
    let decodedImageSize = null;
    const installed = installPetPackageFromZipFile({
      petsRoot,
      zipPath,
      validateSpritesheet(filePath, manifest) {
        const imageSize = inspectPetSpritesheetFile(filePath);
        const expectedWidth = manifest.frame.width * manifest.frame.columns;
        const expectedHeight = manifest.frame.height * manifest.frame.rows;
        if (imageSize.width !== expectedWidth || imageSize.height !== expectedHeight) {
          throw new Error(
            `Unexpected spritesheet size ${imageSize.width}x${imageSize.height}; expected ${expectedWidth}x${expectedHeight}`
          );
        }
        if (imageSize.hasAlpha === false) {
          throw new Error("Spritesheet does not contain transparent pixels");
        }
        decodedImageSize = imageSize;
      }
    });
    const decodeWindow = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      await decodeWindow.loadFile(installed.spritesheetPath);
      const browserDecodedSize = await decodeWindow.webContents.executeJavaScript(`(() => {
        const image = document.images[0];
        return image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
      })()`);
      if (
        !browserDecodedSize
        || browserDecodedSize.width !== decodedImageSize.width
        || browserDecodedSize.height !== decodedImageSize.height
      ) {
        throw new Error("Chromium could not decode the imported spritesheet");
      }
    } finally {
      decodeWindow.destroy();
    }
    const discovered = discoverPets(petsRoot).find((pet) => pet.key === installed.key);
    if (!discovered) throw new Error("Imported package was not discovered by the pet library");
    const persistedManifest = JSON.parse(
      fs.readFileSync(path.join(installed.directory, "pet.json"), "utf8")
    );
    console.log(JSON.stringify({
      ok: true,
      sourceZip: zipPath,
      id: discovered.id,
      displayName: discovered.displayName,
      spritesheetFile: path.basename(discovered.spritesheetPath),
      imageSize: decodedImageSize,
      frame: discovered.frame,
      persistedManifest
    }, null, 2));
    app.exit(0);
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}).catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  app.exit(1);
});
