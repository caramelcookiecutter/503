import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { createSignerFromKeypair, signerIdentity, percentAmount, publicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { Keypair } from "@solana/web3.js";
import fs from "fs";

// --- Fill these in ---
const TOKEN_NAME = "503";
const TOKEN_SYMBOL = "503";
const DESCRIPTION = "A meme coin that burns every time AI goes down.";
const IMAGE_PATH = "./logo.png"; // put your logo image in this folder, name it exactly logo.png

async function main() {
  const umi = createUmi("https://api.mainnet-beta.solana.com").use(irysUploader());

  // Treasury holds mint authority, so it's the one that signs this
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync("./treasury-keypair.json", "utf8")));
  const treasuryWeb3 = Keypair.fromSecretKey(secretKey);
  const treasury = createSignerFromKeypair(umi, fromWeb3JsKeypair(treasuryWeb3));
  umi.use(signerIdentity(treasury));

  const { mint, decimals } = JSON.parse(fs.readFileSync("./token-config.json", "utf8"));

  console.log("Uploading logo image...");
  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const genericFile = {
    buffer: imageBuffer,
    fileName: "logo.png",
    displayName: "logo.png",
    uniqueName: "logo.png",
    contentType: "image/png",
    extension: "png",
    tags: [],
  };
  const [imageUri] = await umi.uploader.upload([genericFile]);
  console.log("Image uploaded:", imageUri);

  console.log("Uploading metadata JSON...");
  const metadataUri = await umi.uploader.uploadJson({
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: DESCRIPTION,
    image: imageUri,
  });
  console.log("Metadata uploaded:", metadataUri);

  console.log("Writing metadata on-chain...");
  await createV1(umi, {
    mint: publicKey(mint),
    authority: treasury,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    decimals,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  console.log("Metadata created! Your token should now show its name and logo everywhere.");
}

main().catch((err) => {
  console.error("Metadata creation failed:", err);
  process.exit(1);
});
