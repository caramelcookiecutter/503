import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplTokenMetadata, createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { createSignerFromKeypair, signerIdentity, publicKey, percentAmount } from "@metaplex-foundation/umi";
import fs from "fs";

// --- Fill these in ---
const RPC = "https://api.mainnet-beta.solana.com";
const MINT_ADDRESS = "PASTE_YOUR_TOKEN_MINT_ADDRESS_HERE";
const METADATA_URI = "https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/metadata.json";
const TOKEN_NAME = "$503";
const TOKEN_SYMBOL = "503";
const DECIMALS = 9;

const umi = createUmi(RPC).use(mplTokenMetadata());

// Only the treasury (mint authority) is allowed to attach metadata
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync("./treasury-keypair.json", "utf8")));
const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
const signer = createSignerFromKeypair(umi, umiKeypair);
umi.use(signerIdentity(signer));

async function main() {
  await createV1(umi, {
    mint: publicKey(MINT_ADDRESS),
    authority: signer,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    uri: METADATA_URI,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: DECIMALS,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);

  console.log("Metadata attached! Check Phantom/Solscan in a minute — it may take a bit to refresh.");
}

main().catch((err) => {
  console.error("Failed to add metadata:", err);
});
