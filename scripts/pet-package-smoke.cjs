/**
 * 用户 PetDex ZIP 的真实 Electron smoke test。
 * 宠物只安装到新建的系统临时目录，并由 Chromium 再解码一次图集；
 * finally 会删除临时文件，不会写入 TaskPet 正式的 src/assets/pets 宠物目录。
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
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
      // 直接导航到图片在部分 Windows/Electron 环境会返回 ERR_FAILED；正式桌宠实际是
      // 从 HTML/CSS 加载图集，因此 smoke 也通过一个隔离 HTML 页面验证同一条路径。
      const decodePagePath = path.join(smokeRoot, "decode.html");
      fs.writeFileSync(decodePagePath, `<!doctype html><img id="pet" src=${JSON.stringify(
        pathToFileURL(installed.spritesheetPath).toString()
      )}>`, "utf8");
      await decodeWindow.loadFile(decodePagePath);
      const browserDecodedSize = await decodeWindow.webContents.executeJavaScript(`(async () => {
        const image = document.images[0];
        if (!image) return null;
        if (!image.complete) {
          await new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", () => reject(new Error("image decode failed")), { once: true });
          });
        }
        return { width: image.naturalWidth, height: image.naturalHeight };
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
